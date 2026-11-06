import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, lstat, writeFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fromBuffer, type ZipFile, type Entry } from 'yauzl'
import { parse } from 'yaml'
import { OpcError, identityHash, type EnterpriseContext } from './context.ts'

export interface InstallRecord {
  tenant_id: string; catalog_id: string; name: string; version: string
  active_sha256: string; enabled: boolean; identity_hash: string; installed_at: number
}
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
function safeId(id: string): string { if (!idPattern.test(id)) throw new OpcError('INVALID_RESOURCE_ID'); return id }
function unsafe(): never { throw new OpcError('SKILL_PACKAGE_UNSAFE') }

/** Lazy entries and byte counters enforce limits before allocating full expanded archives. */
async function extract(bytes: Buffer, root: string): Promise<string> {
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(error) : resolve(value)))
  const names = new Set<string>(), skillPaths: string[] = []
  let entries = 0, files = 0, total = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => { zip.close(); reject(error) }
      zip.on('error', fail); zip.on('end', resolve)
      zip.on('entry', (entry: Entry) => { void (async () => {
        const name = entry.fileName
        const segments = name.replace(/\/$/, '').split('/')
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000
        if (++entries > 100_000 || name.startsWith('/') || /[\\:\x00]/.test(name) || segments.some(s => s === '..' || s === '.' || !s) || names.has(name.toLowerCase()) || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) || (entry.generalPurposeBitFlag & 1)) unsafe()
        names.add(name.toLowerCase())
        const destination = join(root, ...segments)
        if (name.endsWith('/')) { await mkdir(destination, { recursive: true }); zip.readEntry(); return }
        if (++files > 20_000 || entry.uncompressedSize > 32 * 1024 * 1024 || total + entry.uncompressedSize > 512 * 1024 * 1024) unsafe()
        const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => zip.openReadStream(entry, (error, value) => error || !value ? rejectStream(error) : resolveStream(value)))
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of stream) { const buffer = Buffer.from(chunk); size += buffer.length; total += buffer.length; if (size > 32 * 1024 * 1024 || total > 512 * 1024 * 1024) unsafe(); chunks.push(buffer) }
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 })
        if (segments.at(-1) === 'SKILL.md' && segments.length <= 2) skillPaths.push(segments.slice(0, -1).join('/'))
        zip.readEntry()
      })().catch(fail) })
      zip.readEntry()
    })
    if (skillPaths.length !== 1) unsafe()
    return join(root, skillPaths[0])
  } finally { zip.close() }
}

export class SkillInstaller {
  #locks = new Map<string, Promise<unknown>>()
  constructor(private readonly home: string) {}
  private root(context: EnterpriseContext, catalog: string): string {
    return join(this.home, 'enterprise-skills', 'catalog', identityHash(context), safeId(context.tenant), safeId(catalog))
  }
  private async serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
    const pending = (this.#locks.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
    this.#locks.set(key, pending)
    try { return await pending } finally { if (this.#locks.get(key) === pending) this.#locks.delete(key) }
  }
  async install(context: EnterpriseContext, input: { catalogId: string; expectedSha256: string; headerSha256: string | null; bytes: Buffer; name: string; version: string }, assertCurrent: () => void): Promise<InstallRecord> {
    const root = this.root(context, input.catalogId)
    return this.serialized(root, async () => {
      if (!/^[a-f0-9]{64}$/.test(input.expectedSha256) || input.headerSha256 !== input.expectedSha256 || createHash('sha256').update(input.bytes).digest('hex') !== input.expectedSha256) throw new OpcError('SKILL_HASH_MISMATCH')
      if (input.bytes.length > 256 * 1024 * 1024) unsafe()
      assertCurrent()
      await mkdir(join(root, 'versions'), { recursive: true })
      const staging = join(root, `.staging-${randomUUID()}`)
      const pointer = join(root, `.active-${randomUUID()}.tmp`)
      await mkdir(staging)
      try {
        const skillRoot = await extract(input.bytes, staging).catch(() => unsafe())
        const skill = await this.parseSkill(join(skillRoot, 'SKILL.md'))
        if (skill.name !== input.name) unsafe()
        assertCurrent()
        const version = join(root, 'versions', input.expectedSha256)
        try { await rename(skillRoot, version) } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          if (!(await lstat(version)).isDirectory()) unsafe()
        }
        const record: InstallRecord = { tenant_id: context.tenant, catalog_id: input.catalogId, name: input.name, version: input.version, active_sha256: input.expectedSha256, enabled: true, identity_hash: identityHash(context), installed_at: Math.floor(Date.now() / 1000) }
        await writeFile(pointer, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
        assertCurrent()
        await rename(pointer, join(root, 'active.json'))
        return record
      } finally { await rm(staging, { recursive: true, force: true }); await rm(pointer, { force: true }) }
    })
  }
  async parseSkill(path: string): Promise<{ name: string; description: string; content: string }> {
    const raw = await readFile(path, 'utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
    if (!match) unsafe()
    const metadata = parse(match[1], { maxAliasCount: 20 })
    if (!metadata || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || typeof metadata.description !== 'string') unsafe()
    return { name: metadata.name, description: metadata.description, content: match[2] }
  }
  async list(context: EnterpriseContext): Promise<InstallRecord[]> {
    const root = dirname(this.root(context, 'placeholder'))
    let names: string[]
    try { names = await readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const records: InstallRecord[] = []
    for (const name of names) {
      if (!idPattern.test(name)) continue
      try {
        const record = JSON.parse(await readFile(join(root, name, 'active.json'), 'utf8')) as InstallRecord
        if (record.catalog_id !== name || record.tenant_id !== context.tenant || record.identity_hash !== identityHash(context) || !/^[a-f0-9]{64}$/.test(record.active_sha256) || typeof record.enabled !== 'boolean') unsafe()
        records.push(record)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return records
  }
  async remove(context: EnterpriseContext, catalog: string): Promise<void> {
    const root = this.root(context, catalog)
    await this.serialized(root, () => rm(root, { recursive: true, force: true }))
  }
  async setEnabled(context: EnterpriseContext, catalog: string, enabled: boolean, assertCurrent: () => void): Promise<void> {
    const root = this.root(context, catalog)
    await this.serialized(root, async () => {
      const record = (await this.list(context)).find(r => r.catalog_id === catalog)
      if (!record) throw new OpcError('SKILL_NOT_INSTALLED')
      const temp = join(root, `.active-${randomUUID()}.tmp`)
      try { await writeFile(temp, JSON.stringify({ ...record, enabled }), { flag: 'wx', mode: 0o600 }); assertCurrent(); await rename(temp, join(root, 'active.json')) }
      finally { await rm(temp, { force: true }) }
    })
  }
  skillPath(context: EnterpriseContext, record: InstallRecord): string {
    if (!/^[a-f0-9]{64}$/.test(record.active_sha256)) unsafe()
    return join(this.root(context, record.catalog_id), 'versions', record.active_sha256, 'SKILL.md')
  }
}
