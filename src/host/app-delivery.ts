import { createWriteStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, link, lstat, mkdir, readFile, readdir, stat, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { OpcCore } from './core.ts'
import { identityHash } from './context.ts'

export const ROLLBACK_NOTICE = '回滚恢复代码与运行配置，不自动回退数据库/卷中的业务数据；旧代码和新数据兼容性仍需验证。'
export type AppDocument = Record<string, any>
export interface DeliveryJob {
  id: string; name: string; slug: string; url: string; session: string
  port?: number; description?: string; upgrade?: boolean; versionNote?: string
  status: 'importing' | 'draft' | 'analyzing' | 'review' | 'preparing' | 'ready' | 'publishing' | 'building' | 'verifying' | 'awaiting_page_verification' | 'verified' | 'failed' | 'unknown' | 'cancelled'
  events: string[]; error?: string; proposal?: AppDocument; revision?: string; failedRevision?: string
  revisionCount?: number; feedbackHistory?: string; analysisMode?: 'analysis' | 'repair'
  conversation?: { role: 'user' | 'assistant'; text: string; revision?: number }[]
  discoveryReport?: AppDocument; transformationReport?: AppDocument; preparationChecks?: AppDocument[]
  diffs?: Record<string, string>; hasOriginalKeys?: string[]; skillMarkdown?: string; dockerfileContent?: string
  hashes?: Record<string, string>; version?: number; requestId?: string
  modelSelection?: { provider: string; model: string; reasoningEffort?: string }
  confirmationToken?: string
  checks?: AppDocument[]; published?: boolean; failureContext?: string; configFingerprint?: string
  configDraft?: { artifactHash: string; rows: { key: string; resource_id?: string; local_connection_confirmed?: boolean }[]; versionNote: string }
  configKeys?: string[]; resourceIds?: string[]; failedSnapshot?: AppDocument; pagesVerified?: boolean
}
type CredentialStore = {
  read(id: string): Promise<Record<string, string>>
  write(id: string, values: Record<string, string>): Promise<void>
}
function matchesReceipt(log: unknown, hashes?: Record<string, string>) {
  return !!hashes?.['app.tar'] && !!hashes['skill.zip'] && typeof log === 'string' &&
    log.includes(`[Artifact] app.tar:${hashes['app.tar']}\n`) &&
    log.includes(`[Artifact] skill.zip:${hashes['skill.zip']}\n`)
}

function checkPublishReceipt(job: DeliveryJob, receipt: AppDocument) {
  if (receipt.request_id && receipt.request_id !== job.requestId) throw new Error('发布回执请求号不一致')
  if (receipt.app_url && receipt.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
  if ((receipt.app_tar_sha256 && receipt.app_tar_sha256 !== job.hashes?.['app.tar']) ||
      (receipt.skill_zip_sha256 && receipt.skill_zip_sha256 !== job.hashes?.['skill.zip'])) {
    throw new Error('发布回执制品摘要不一致')
  }
  if (['accepted', 'building', 'running', 'failed'].includes(receipt.status) &&
      (!Number.isSafeInteger(receipt.version) || receipt.version < 1)) throw new Error('发布回执缺少有效版本')
}

export function verificationCredentialFields(contract: AppDocument) {
  const fields = new Map<string, 'session' | 'username' | 'password'>()
  for (const api of contract.apis ?? []) {
    if (['header', 'bearer'].includes(api.auth?.type) && api.auth.env) fields.set(api.auth.env, 'session')
  }
  for (const profile of [contract.auth_profile, ...Object.values(contract.auth_profiles ?? {})] as (AppDocument | undefined)[]) {
    if (profile?.token_env) fields.set(profile.token_env, 'session')
    if (profile?.username_env) fields.set(profile.username_env, 'username')
    if (profile?.password_env) fields.set(profile.password_env, 'password')
  }
  return [...fields].map(([key, kind]) => ({ key, kind }))
}

function probeMatches(result: AppDocument, status: number, expected: unknown): boolean {
  if (result.status !== status) return false
  try { return contains(JSON.parse(result.content), expected) } catch { return false }
}

export function loopbackConnection(key: string, value: string): boolean {
  if (['HOST', 'PORT', 'BIND_HOST', 'LISTEN_HOST'].includes(key.toUpperCase()) || !/URL|URI|DSN|HOST|ENDPOINT|CONNECTION|SERVER/i.test(key)) {
    return false
  }
  return /(?:^|:\/\/|@|tcp\(|(?:host|server)\s*=)(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/,;)]|$)/i.test(value.trim())
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const fingerprint = (value: unknown) => hash(JSON.stringify(value))
export function contains(actual: any, expected: any): boolean {
  if (expected === undefined) return false
  if (Array.isArray(expected)) return Array.isArray(actual) && (expected.length ? expected.every(e => actual.some(a => contains(a, e))) : !actual.length)
  if (expected && typeof expected === 'object') return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => contains(actual[k], v))
  return actual === expected
}

/** Each helper runs as a short-lived process with only the plugin's protocol on stdin. */
export function worker(input: AppDocument, signal?: AbortSignal): Promise<any> {
  const path = fileURLToPath(new URL('../../runtime/worker.py', import.meta.url))
  // Bundled Host entry lives in lib/index.js; source tests live in src/host/.
  const runtime = import.meta.url.endsWith('/lib/index.js') ? fileURLToPath(new URL('../runtime/worker.py', import.meta.url)) : path
  const executable = dirname(process.execPath)
  const bundled = [
    join(executable, '../Resources/runtime/primary-runtime/dependencies/python/bin/python3'),
    join(executable, '../../python/bin/python3'),
  ].find(candidate => existsSync(candidate))
  return new Promise((resolve, reject) => {
    const child = spawn(bundled ?? 'python3', ['-I', '-B', runtime], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8' }, signal, timeout: 120_000 })
    let stdout = '', stderr = '', exceeded = false
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 8_000_000) { exceeded = true; child.kill() } })
    child.stderr.on('data', data => { if (stderr.length < 2000) stderr += data })
    child.on('error', error => reject(new Error(error.message.includes('ENOENT') ? '需要 Python 3.9 或以上版本：请安装后重新打开 DSH。原项目未改动。' : error.message)))
    child.on('close', () => {
      if (exceeded) return reject(new Error('分析输出超过限制，请缩小读取范围'))
      try { const result = JSON.parse(stdout); if (!result.ok) throw new Error(result.error); resolve(result.value) }
      catch (error) { reject(new Error(stdout ? String(error) : `应用准备工具未能启动：${stderr.slice(0, 500)}`)) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}

export class AppRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export class AppDelivery {
  private busy = new Set<string>()
  private analyses = new Map<string, AbortController>()
  analyze?: (job: DeliveryJob, root: string, feedback: string, signal: AbortSignal) => Promise<void>
  constructor(readonly core: OpcCore, readonly home: string, private readonly credentials: CredentialStore) {}
  private scope(expected?: string) {
    const captured = this.core.auth.contexts.captureApplication(expected)
    const directory = join(this.home, 'opc', 'apps', identityHash(captured.context))
    return { ...captured, directory }
  }
  private async save(root: string, job: DeliveryJob) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temp = join(root, `job-${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(job), { mode: 0o600 }); await rename(temp, join(root, 'job.json'))
    this.core.emit('change')
  }
  private skillPreferencePath(directory: string, slug: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return join(directory, 'skill-preferences', slug)
  }
  private async isSkillDisabled(directory: string, slug: string) {
    return readFile(this.skillPreferencePath(directory, slug), 'utf8').then(value => value === 'disabled', error => {
      if (error.code === 'ENOENT') return false
      throw error
    })
  }
  private async directories(directory: string) {
    const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    return [directory, ...entries.filter(id => /^[a-f0-9]{64}$/.test(id)).map(id => join(directory, id))]
  }
  private async open(directory: string, id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效任务')
    for (const parent of await this.directories(directory)) {
      const root = join(parent, id)
      try {
        const job: DeliveryJob = JSON.parse(await readFile(join(root, 'job.json'), 'utf8'))
        return { root, job }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    throw Object.assign(new Error('应用任务不存在'), { code: 'ENOENT' })
  }
  private recordFailureState(job: DeliveryJob, errorMsg: string, extraLog?: string, remoteVersion?: number) {
    job.status = 'failed'
    job.error = errorMsg
    job.failedRevision = job.revision || job.failedRevision
    const combinedLog = [errorMsg, extraLog].filter(Boolean).join('\n')
    job.failureContext = (job.failureContext ? `${job.failureContext}\n${combinedLog}` : combinedLog).slice(-24_000)
    job.failedSnapshot = {
      artifactHashes: job.hashes,
      version: remoteVersion ?? job.version,
      configKeys: job.configKeys ?? [],
      resourceIds: job.resourceIds ?? [],
      storageMounts: job.proposal?.contract?.storage_mounts ?? [],
      verificationError: errorMsg,
    }
  }
  private async archivePublishedVersion(scopeDir: string, job: DeliveryJob, bundleDir: string) {
    const { slug, version, requestId, id: jobId } = job
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !version || version <= 0) return
    const verDir = join(scopeDir, 'versions', slug, `v${version}`)
    await mkdir(verDir, { recursive: true, mode: 0o700 })
    const hashes: Record<string, string> = {}
    for (const name of ['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json']) {
      try {
        const src = join(bundleDir, name)
        await copyFile(src, join(verDir, name))
        if (name === 'app.tar' || name === 'skill.zip') {
          hashes[name] = hash(await readFile(src))
        }
      } catch {
        /* ignore missing optional file */
      }
    }
    if (Object.keys(hashes).length > 0) {
      await writeFile(join(verDir, 'summary.json'), JSON.stringify({ version, hashes, jobId, requestId }, null, 2), { mode: 0o600 }).catch(() => {})
    }
  }
  private async demoteOtherJobsForSlug(scopeDir: string, slug: string, activeJobId: string) {
    for (const parent of await this.directories(scopeDir)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e) && e !== activeJobId)) {
        const opened = await this.open(scopeDir, id).catch(() => undefined)
        if (opened && opened.job.slug === slug && ['verified', 'awaiting_page_verification'].includes(opened.job.status)) {
          opened.job.status = 'ready'
          opened.job.events.push('同应用已切换至其他生效版本，此历史任务技能已停用')
          await this.save(opened.root, opened.job)
        }
      }
    }
  }
  async list(expected: string) {
    const scope = this.scope(expected)
    const directories = await this.directories(scope.directory)
    const entries = (await Promise.all(directories.map(directory => readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })))).flat()
    const jobs = await Promise.all([...new Set(entries.filter(id => /^[a-f0-9-]{36}$/.test(id)))].map(async id => {
      const result = await this.open(scope.directory, id).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (!result) return undefined
      let { job } = result
      const { root } = result
      if (!this.busy.has(id) && ['importing', 'analyzing', 'preparing', 'verifying', 'publishing'].includes(job.status)) {
        // A task can finish between the first disk read and the busy check.
        await this.exclusive(id, async () => {
          job = (await this.open(scope.directory, id)).job
          if (['importing', 'analyzing', 'preparing', 'verifying'].includes(job.status)) {
            job.status = 'failed'
            job.error = '上次任务中断，可重新分析或验证'
            await this.save(root, job)
          } else if (job.status === 'publishing') {
            job.status = 'unknown'
            job.error = '发布结果未知，请查询状态，不要重复发布'
            await this.save(root, job)
          }
        })
      }
      if (!this.busy.has(id) && ['unknown', 'building'].includes(job.status)) {
        const latestJob = await this.open(scope.directory, id)
        if (!this.busy.has(id) && latestJob.job.status === job.status && latestJob.job.requestId === job.requestId) {
          job = latestJob.job
          // List polling must not lock out explicit Verify while waiting on the network.
          try {
            if (job.status === 'unknown' && job.requestId) {
              const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
              checkPublishReceipt(job, receipt)
              if (['accepted', 'building', 'running', 'failed'].includes(receipt.status) && !this.busy.has(id)) {
                await this.exclusive(id, async () => {
                  job = (await this.open(scope.directory, id)).job
                  if (job.status !== 'unknown' || job.requestId !== latestJob.job.requestId) return
                  job.published = true
                  job.version = receipt.version
                  if (receipt.status === 'failed') {
                    this.recordFailureState(job, receipt.error_message || '部署失败', receipt.build_log?.slice(-8000), job.version)
                  } else {
                    job.status = 'building'
                    job.error = undefined
                    if (job.revision && job.version) {
                      await this.archivePublishedVersion(scope.directory, job, join(root, job.revision, 'bundle'))
                    }
                  }
                  await this.save(root, job)
                })
              }
            }
            if (job.status === 'building' && job.version) {
              const remote = await this.platform('/' + job.slug, expected)
              if (remote.status === 'failed' && remote.current_version === job.version && !this.busy.has(id)) {
                await this.exclusive(id, async () => {
                  job = (await this.open(scope.directory, id)).job
                  if (job.status !== 'building' || remote.current_version !== job.version) return
                  this.recordFailureState(job, remote.error_message || '部署失败', remote.build_log?.slice(-8000), remote.current_version)
                  await this.save(root, job)
                })
              }
            }
          } catch { /* An inconclusive response leaves the current task available for status checks. */ }
        }
      }
      const view = this.public(job)
      if (job.status === 'verified') view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug)
      return view
    }))
    scope.assertCurrent(); return jobs.filter((job): job is AppDocument => job !== undefined).reverse()
  }
  public(job: DeliveryJob): AppDocument {
    const { proposal, skillMarkdown: _sm, dockerfileContent: _df, configDraft: _draft, confirmationToken: _token, ...rest } = job
    const hasOrigSet = new Set(job.hasOriginalKeys ?? [])
    return {
      ...rest,
      artifactHash: job.hashes ? fingerprint(job.hashes) : undefined,
      proposalHash: proposal ? fingerprint(proposal) : undefined,
      proposal: proposal && {
        summary: proposal.summary,
        issues: proposal.issues ?? [],
        unresolved: proposal.unresolved ?? [],
        decisions: proposal.decisions ?? [],
        changes: proposal.changes?.map((change: AppDocument) => ({
          id: change.id,
          path: change.path,
          reason: change.reason,
          group: change.group ?? '',
          diff: job.diffs?.[change.path] ?? '',
        })),
        contract: {
          description: proposal.contract.description,
          runtime: proposal.contract.runtime,
          health: proposal.contract.health,
          configs: (proposal.contract.configs ?? []).map((c: AppDocument) => ({
            ...c,
            default: c.secret ? '' : c.default,
            has_original_value: hasOrigSet.has(c.key) || Boolean(c.has_original_value),
          })),
          resources: proposal.contract.resources ?? [],
          storage_mounts: proposal.contract.storage_mounts ?? [],
          verification_credential_fields: verificationCredentialFields(proposal.contract),
          verification: proposal.contract.verification,
          apis: proposal.contract.apis?.map(({ id, purpose, method, path, auth, effect }: AppDocument) => ({ id, purpose, method, path, auth, effect })),
          pages: proposal.contract.pages?.map(({ purpose, path, actions }: AppDocument) => ({ purpose, path, actions })),
        },
      },
    }
  }
  async platform(path: string, expected: string, options: { method?: string; body?: unknown; form?: FormData; query?: Record<string, string>; download?: boolean; stream?: boolean } = {}): Promise<any> {
    if (!/^\/(?:check-slug|resources|dockerfile-templates|publish|[a-z][a-z0-9-]*(?:\/(?:logs|versions(?:\/*[0-9]+\/artifacts\/(?:app\.tar|skill\.zip|Dockerfile|manifest\.json))?|storage(?:\/backup)?|recheck|verify|rollback|migrate-data|config|requests\/[A-Za-z0-9_-]+))?)?$/.test(path)) throw new Error('不支持的应用操作')
    const scope = this.scope(expected)
    const token = await this.core.auth.token(); scope.assertCurrent()
    const url = new URL('/integration/v1/apps' + (path === '/' ? '' : path), this.core.auth.http.base)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    const response = await fetch(url, { method: options.method ?? (options.body || options.form ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${token}`, ...(options.form ? {} : { 'Content-Type': 'application/json' }) },
      body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined), redirect: 'error',
      signal: AbortSignal.any([scope.signal, AbortSignal.timeout(
        path.endsWith('/rollback') ? 660_000 : path.endsWith('/storage/backup') ? 300_000 : options.form ? 180_000 : 30_000,
      )]) })
    scope.assertCurrent()
    if (response.ok && options.stream) return response
    if (response.status === 404 && ['/', '/check-slug', '/resources'].includes(path)) throw new AppRequestError(404, '测试服尚未启用企业应用部署接口，需要发布配套 Platform 版本')
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && (options.download || path.endsWith('/skill.zip') || path.endsWith('/app.tar') || path.endsWith('/storage/backup') || contentType.includes('application/zip') || contentType.includes('application/x-tar') || contentType.includes('application/octet-stream'))) {
      const chunks: Uint8Array[] = []
      let length = 0
      const reader = response.body?.getReader()
      if (!reader) throw new Error('平台未返回文件内容')
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > 64 * 1024 * 1024) throw new Error('文件超过插件下载上限 64 MiB，请从 Work-OPC 下载')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      scope.assertCurrent()
      return { bytes: Buffer.concat(chunks), sha256: response.headers.get('x-artifact-sha256') ?? undefined }
    }
    const result = await response.json().catch(() => { throw new AppRequestError(response.status, `应用接口 HTTP ${response.status}`) })
    if (!response.ok) throw new AppRequestError(response.status, result.error?.message ?? result.error ?? `应用接口 HTTP ${response.status}`)
    return result
  }
  async create(input: AppDocument, session: string, expected: string) {
    const scope = this.scope(expected)
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(input.slug) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('请填写应用名称和 3–40 位英文标识')
    let targetUrl: string
    let targetName = input.name.trim()
    let targetPort = input.container_port === undefined ? 8080 : input.container_port
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('容器端口必须为 1 至 65535 的整数')
    let targetDesc = typeof input.description === 'string' ? input.description.trim() : ''
    let defaultVersionNote = ''
    const previous = input.previousJobId ? (await this.open(scope.directory, input.previousJobId)).job : undefined
    if (previous && previous.slug !== input.slug) throw new Error('重新导入须保持原应用标识')
    if (input.upgrade) {
      const existing = await this.platform('/' + input.slug, expected)
      if (!existing.can_manage) throw new Error('只有应用创建人或管理员可以升级此应用')
      targetUrl = existing.app_url
      targetName = existing.name?.trim() || targetName
      if (input.container_port === undefined && Number.isInteger(existing.container_port) && existing.container_port >= 1 && existing.container_port <= 65535) {
        targetPort = existing.container_port
      }
      if (!targetDesc && typeof existing.description === 'string') {
        targetDesc = existing.description
      }
      defaultVersionNote = `升级到 v${(existing.current_version || 1) + 1}`
    } else {
      const reserved = await this.platform('/check-slug', expected, { body: { slug: input.slug } })
      if (!reserved.available) throw new Error('应用标识已被使用，请换一个标识；若需升级已有应用请选择升级')
      targetUrl = reserved.app_url
    }
    if (previous && previous.url !== targetUrl) throw new Error('重新导入须保持原应用地址')
    scope.assertCurrent()
    const job: DeliveryJob = {
      id: randomUUID(),
      name: targetName,
      slug: input.slug,
      url: targetUrl,
      port: targetPort,
      description: targetDesc,
      upgrade: Boolean(input.upgrade),
      versionNote: defaultVersionNote,
      modelSelection: input.modelSelection && typeof input.modelSelection.provider === 'string' && typeof input.modelSelection.model === 'string'
        ? { provider: input.modelSelection.provider, model: input.modelSelection.model, reasoningEffort: typeof input.modelSelection.reasoningEffort === 'string' ? input.modelSelection.reasoningEffort : undefined }
        : undefined,
      feedbackHistory: previous?.feedbackHistory,
      conversation: previous?.conversation,
      session,
      status: 'importing',
      events: ['正在创建源码隔离副本'],
    }
    const root = join(scope.directory, job.id)
    await this.exclusive(job.id, async () => {
      await this.save(root, job)
      try {
        let source: string
        if (input.zip) {
          if (typeof input.zip !== 'string' || input.zip.length > 90_000_000) throw new Error('ZIP 不能超过 64 MiB')
          const bytes = Buffer.from(input.zip, 'base64')
          if (bytes.length > 64 * 1024 * 1024) throw new Error('ZIP 不能超过 64 MiB')
          source = join(root, 'uploaded.zip'); await writeFile(source, bytes, { mode: 0o600 })
        } else {
          if (typeof input.source !== 'string' || !isAbsolute(input.source)) throw new Error('请选择 ZIP 或填写本机源码目录的完整路径')
          source = input.source
          const entry = await lstat(source)
          if (entry.isSymbolicLink() || (!entry.isDirectory() && (!entry.isFile() || !/\.zip$/i.test(source)))) {
            throw new Error('请输入本机源码文件夹或 ZIP 的完整路径')
          }
          if (entry.isFile() && entry.size > 64 * 1024 * 1024) throw new Error('ZIP 不能超过 64 MiB')
        }
        await worker({ action: 'prepare', root, source, slug: job.slug, url: job.url }, scope.signal)
        scope.assertCurrent(); job.status = 'draft'; job.events.push('已导入独立副本，原项目保持不变')
      } catch (error) { job.status = 'failed'; job.error = String(error) }
      await this.save(root, job)
    })
    return this.public(job)
  }
  async reopenReview(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    return this.exclusive(id, async () => {
      if (!['ready', 'awaiting_page_verification', 'failed'].includes(job.status) || !job.proposal) throw new Error('当前状态无法返回改造方案核对')
      job.status = 'review'
      job.confirmationToken = undefined
      job.error = undefined
      job.events.push('已返回改造方案核对阶段，可补充说明重新分析或重新打包')
      await this.save(root, job)
      this.core.emit('skills-changed')
      return this.public(job)
    })
  }
  async reopenDeployment(id: string, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status !== 'failed' || !job.published || !job.revision || !job.hashes || !job.proposal) {
        throw new Error('当前任务没有可重新部署的失败版本')
      }
      const remote = await this.platform(`/${job.slug}`, expected)
      if (remote.can_manage !== true || remote.app_url !== job.url) throw new Error('没有权限重新部署此应用，或应用地址已变化')
      const saved = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {}
      const config: AppDocument[] = saved.rows ? JSON.parse(saved.rows) : Array.isArray(remote.app_config) ? remote.app_config : []
      const declarations: AppDocument[] = job.proposal.contract.configs ?? []
      const allConfigs = [...declarations, ...config.filter(row => !declarations.some(declared => declared.key === row.key))]
      const rows = allConfigs.map(declared => {
        const existing = config.find(row => row.key === declared.key)
        return { key: declared.key, resource_id: existing?.resource_id, local_connection_confirmed: existing?.local_connection_confirmed === true,
          value: existing?.resource_id ? '' : (existing?.value ?? (declared.secret ? '' : declared.default) ?? '') }
      })
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map((row: AppDocument) => [row.key, row.value])))
      scope.assertCurrent()
      job.configDraft = { artifactHash: fingerprint(job.hashes), rows: rows.map(({ value: _value, ...row }) => row), versionNote: '' }
      job.confirmationToken = undefined
      job.status = 'ready'
      job.published = undefined
      job.events.push('已恢复失败版本的交付包和运行配置，请核对后重新部署')
      await this.save(root, job)
      return this.public(job)
    })
  }
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error('任务正在执行，请稍候')
    this.busy.add(id)
    try { return await fn() } finally { this.busy.delete(id) }
  }
  async startAnalysis(id: string, feedback: string, expected: string, session?: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (!this.analyze) throw new Error('此 DSH 版本未提供应用分析所需的 Agent 扩展')
    if (this.busy.has(id) || ['building', 'publishing', 'unknown'].includes(job.status)) throw new Error('请先完成当前部署状态核对')
    this.busy.add(id)
    job.session = session || job.session
    let trimmedFeedback: string
    try {
      trimmedFeedback = await worker({ action: 'redact_feedback', root, text: feedback.slice(0, 20_000) }, scope.signal)
    } catch (error) {
      this.busy.delete(id)
      throw error
    }
    const controller = new AbortController()
    const analysisSignal = AbortSignal.any([scope.signal, controller.signal])
    this.analyses.set(id, controller)
    if (job.revision && (job.published || job.status === 'failed')) {
      job.analysisMode = 'repair'
      job.failedRevision = job.revision
      const prevFailure = job.failureContext || job.error || ''
      job.failureContext = (prevFailure && trimmedFeedback ? `${prevFailure}\n${trimmedFeedback}` : (trimmedFeedback || prevFailure)).slice(-24_000)
      job.failedSnapshot = {
        artifactHashes: job.hashes,
        version: job.version,
        configKeys: job.configKeys ?? [],
        resourceIds: job.resourceIds ?? [],
        storageMounts: job.proposal?.contract?.storage_mounts ?? [],
        verificationError: job.error || job.failureContext,
      }
    } else {
      job.analysisMode = job.analysisMode || 'analysis'
      job.failureContext = job.error || job.failureContext
    }
    job.confirmationToken = undefined
    job.revisionCount = (job.revisionCount ?? 0) + 1
    if (trimmedFeedback.trim()) {
      job.conversation = [...(job.conversation ?? []), { role: 'user', text: trimmedFeedback.trim(), revision: job.revisionCount }]
      job.feedbackHistory = job.feedbackHistory
        ? `${job.feedbackHistory}\n\n本次补充（有冲突时以本次为准）：\n${trimmedFeedback.trim()}`
        : trimmedFeedback.trim()
    }
    job.status = 'analyzing'
    job.error = undefined
    job.checks = undefined
    job.events.push(job.analysisMode === 'repair' ? '🔧 AI 正在读取失败制品与日志进行专项修复分析' : '🚀 AI 正在分析源码；尚未执行发布')
    try { await this.save(root, job) } catch (error) {
      this.analyses.delete(id)
      this.busy.delete(id)
      throw error
    }
    this.core.emit('skills-changed')
    void (async () => {
      try {
        await this.analyze!(job, root, trimmedFeedback, analysisSignal)
        analysisSignal.throwIfAborted()
        scope.assertCurrent()
        if (!job.proposal || job.status === 'analyzing') throw new Error('AI 未提交有效改造方案，请补充说明后重试')
      } catch (error) {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed'
        job.error = controller.signal.aborted ? '用户取消分析' : String(error)
      }
      try { await this.save(root, job) } finally {
        this.analyses.delete(id)
        this.busy.delete(id)
        this.core.emit('change')
      }
    })().catch(() => {})
    return this.public(job)
  }
  async cancelAnalysis(id: string, expected: string) {
    const scope = this.scope(expected)
    await this.open(scope.directory, id)
    scope.assertCurrent()
    const controller = this.analyses.get(id)
    if (!controller) throw new Error('当前没有可取消的分析')
    controller.abort()
  }

  async configDraft(id: string, expected: string) {
    const scope = this.scope(expected)
    const { job } = await this.open(scope.directory, id)
    if (job.status !== 'ready' || !job.configDraft || job.configDraft.artifactHash !== fingerprint(job.hashes)) return null
    const values = await this.credentials.read(`draft-${id}`)
    scope.assertCurrent()
    return { ...job.configDraft, rows: job.configDraft.rows.map(row => ({ ...row, value: values[row.key] ?? '' })) }
  }

  async saveConfigDraft(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    return this.exclusive(id, async () => {
      if (job.status !== 'ready' || input.artifactHash !== fingerprint(job.hashes)) throw new Error('交付版本已变化，请重新核对配置')
      const rows = input.rows
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.key) ||
          typeof row.value !== 'string' || (row.resource_id !== undefined && typeof row.resource_id !== 'string')) ||
          new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('配置草稿格式无效')
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map(row => [row.key, row.value])))
      scope.assertCurrent()
      job.configDraft = {
        artifactHash: input.artifactHash,
        rows: rows.map(row => ({ key: row.key, resource_id: row.resource_id, local_connection_confirmed: row.local_connection_confirmed === true })),
        versionNote: typeof input.versionNote === 'string' ? input.versionNote.slice(0, 1024) : '',
      }
      job.confirmationToken = undefined
      await this.save(root, job)
    })
  }

  async localArtifact(id: string, filename: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.status !== 'ready' || !job.revision || !/^[a-z0-9]+$/i.test(job.revision) ||
        !['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json'].includes(filename)) throw new Error('当前交付文件不可用')
    const path = join(root, job.revision, 'bundle', filename)
    const size = (await stat(path)).size
    if (size > 64 * 1024 * 1024) throw new Error('文件超过插件下载上限 64 MiB')
    const bytes = await readFile(path)
    scope.assertCurrent()
    if (filename !== 'summary.json' && hash(bytes) !== job.hashes?.[filename]) throw new Error('交付文件已发生变化')
    return { filename, base64: bytes.toString('base64') }
  }

  async skillPreview(id: string, expected: string) {
    const { root, job } = await this.open(this.scope(expected).directory, id)
    if (job.status !== 'ready' || !job.skillMarkdown || !job.hashes?.['skill.zip']) throw new Error('技能尚未生成')
    const bundle = await this.localArtifact(id, 'skill.zip', expected)
    const scope = this.scope(expected)
    const result = await worker({ action: 'extract_skill_contract', root, skill_zip_b64: bundle.base64,
      expected_sha256: job.hashes['skill.zip'], slug: job.slug, app_url: job.url }, scope.signal)
    scope.assertCurrent()
    return { markdown: result.skill_markdown }
  }

  async handoff(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (!job.proposal || !['review', 'ready', 'failed'].includes(job.status)) throw new Error('请等待改造分析结束')
    return worker({ action: 'handoff', root, job: {
      name: job.name, slug: job.slug, url: job.url, port: job.port,
      revision: job.status === 'ready' ? job.revision : undefined,
      status: job.status, proposal: job.proposal,
    } }, scope.signal)
  }

  async submit(job: DeliveryJob, root: string, proposal: AppDocument, signal: AbortSignal) {
    if (proposal.contract?.slug !== job.slug || proposal.contract?.base_url !== job.url) throw new Error('应用标识或地址与导入时不一致')
    if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    if (!Array.isArray(proposal.unresolved)) throw new Error('unresolved 必须为数组')
    if (!proposal.unresolved.length && proposal.contract?.runtime?.port !== (job.port ?? 8080)) throw new Error('模型不能静默改变用户选择的容器端口')
    const validated = await worker({
      action: 'validate',
      root,
      proposal,
      allow_unresolved: Boolean(proposal.unresolved.length),
      repair: Boolean(job.failedRevision),
      failed_revision: job.failedRevision ?? '',
      failure_feedback: job.failureContext ?? '',
      revision_count: job.revisionCount ?? 1,
      feedback: job.feedbackHistory ?? '',
      expected_port: job.port ?? 8080,
    }, signal)
    signal.throwIfAborted(); if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    job.proposal = validated?.proposal ?? proposal
    job.discoveryReport = validated?.discovery_report ?? job.discoveryReport
    job.transformationReport = validated?.transformation_report ?? job.transformationReport
    job.diffs = validated?.diffs ?? job.diffs
    job.hasOriginalKeys = validated?.has_original_keys ?? job.hasOriginalKeys
    if (job.proposal?.summary) {
      job.conversation = [...(job.conversation ?? []), { role: 'assistant', text: job.proposal.summary, revision: job.revisionCount ?? 1 }]
    }
    job.status = 'review'
    job.events.push(job.proposal!.unresolved.length ? 'AI 分析完成，请回答待确认事项' : '方案校验通过，请核对改造内容并生成部署包')
  }
  async prepare(id: string, proposalHash: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    return this.exclusive(id, async () => {
      if (job.status !== 'review' || !job.proposal || fingerprint(job.proposal) !== proposalHash) throw new Error('方案已变化，请刷新后核对')
      job.status = 'preparing'; job.error = undefined; await this.save(root, job)
      try {
        const revision = randomUUID().replaceAll('-', '')
        const result = await worker({
          action: 'bundle',
          root,
          revision,
          proposal: job.proposal,
          repair: Boolean(job.failedRevision),
          failed_revision: job.failedRevision ?? '',
          failure_feedback: job.failureContext ?? '',
          expected_port: job.port ?? 8080,
          revision_count: job.revisionCount ?? 1,
          feedback: job.feedbackHistory ?? '',
        }, scope.signal)
        scope.assertCurrent()
        job.revision = revision
        job.hashes = result.summary.files
        job.proposal = result.proposal ?? job.proposal
        job.discoveryReport = result.discovery_report ?? job.discoveryReport
        job.transformationReport = result.transformation_report ?? job.transformationReport
        job.preparationChecks = result.preparation_checks ?? job.preparationChecks
        job.skillMarkdown = result.skill_markdown || job.skillMarkdown
        job.dockerfileContent = result.dockerfile_content || job.dockerfileContent
        job.hasOriginalKeys = result.has_original_keys ?? job.hasOriginalKeys
        job.diffs = result.diffs ?? job.diffs
        if (result.original_config_values && typeof result.original_config_values === 'object') {
          await this.credentials.write(`orig-${job.id}`, result.original_config_values)
        }
        job.status = 'ready'
        job.version = undefined
        job.published = undefined
        job.requestId = randomUUID().replaceAll('-', '')
        job.confirmationToken = undefined
        job.events.push('部署包已生成，服务器构建和业务验证尚未执行')
      } catch (error) { job.status = 'failed'; job.error = String(error) }
      await this.save(root, job); return this.public(job)
    })
  }
  private async deploymentConfiguration(job: DeliveryJob, input: AppDocument, expected: string) {
    const rawConfigs = input.config as { key: string; value: string; resource_id?: string; local_connection_confirmed?: boolean }[]
    if (!Array.isArray(rawConfigs) || rawConfigs.some(c => !c || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.key) || typeof c.value !== 'string' || (c.resource_id !== undefined && typeof c.resource_id !== 'string')) || new Set(rawConfigs.map(c => c.key)).size !== rawConfigs.length) throw new Error('配置格式无效')
    const origValues = await this.credentials.read(`orig-${job.id}`)
    const configs = rawConfigs.map(c => {
      if (!c.resource_id && !c.value && origValues[c.key]) return { ...c, value: origValues[c.key], value_source: 'original' }
      return { ...c, value_source: c.resource_id ? 'resource' : 'manual' }
    })
    const ids = [...new Set(configs.flatMap(c => c.resource_id ? [c.resource_id] : []))].sort()
    const available: AppDocument[] = ids.length ? (await this.platform('/resources', expected)).resources ?? [] : []
    for (const item of configs) {
      if (item.resource_id && (item.value || !available.some(r => r.id === item.resource_id && r.env_keys?.includes(item.key)))) {
        throw new Error(`配置项的资源选择无效：${item.key}`)
      }
      if (!item.resource_id && loopbackConnection(item.key, item.value) && item.local_connection_confirmed !== true) {
        throw new Error(`连接仍指向应用容器自己，请更换为服务器可访问地址；若服务确实就在同一容器内，请明确确认：${item.key}`)
      }
      if (item.key === 'PORT' && (item.resource_id || (item.value && item.value !== String(job.port ?? 8080)))) {
        throw new Error('PORT 必须与已确认的容器端口一致；如需更换端口，请重新分析生成交付包')
      }
    }
    const declarations: AppDocument[] = job.proposal!.contract.configs ?? []
    for (const c of declarations) {
      const selected = configs.find(i => i.key === c.key)
      if (c.required && !selected?.value && !selected?.resource_id) throw new Error(`请填写 ${c.key}`)
    }
    const bindings = configs.map(c => ({ key: c.key, value: c.value, value_source: c.value_source, resource_id: c.resource_id,
      required: declarations.some(item => item.key === c.key && item.required) }))
    const note = input.versionNote ?? input.version_note
    const versionNote = typeof note === 'string' && note.trim() ? note.trim() : job.versionNote ?? ''
    const digest = fingerprint({ hashes: job.hashes, url: job.url, port: job.port, bindings, ids, versionNote })
    return { bindings, configs, ids, versionNote, digest }
  }
  async confirmDeployment(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status !== 'ready' || !job.proposal || input.artifactHash !== fingerprint(job.hashes)) throw new Error('交付包已变化，请重新核对')
      const { digest } = await this.deploymentConfiguration(job, input, expected)
      const prior = await this.credentials.read(`confirm-${id}`)
      scope.assertCurrent()
      if (!job.confirmationToken || prior.digest !== digest) {
        job.confirmationToken = randomUUID()
        job.requestId = randomUUID().replaceAll('-', '')
        await this.credentials.write(`confirm-${id}`, { digest })
        await this.save(root, job)
      }
      return { confirmationToken: job.confirmationToken, requestId: job.requestId }
    })
  }
  async publish(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status === 'unknown') throw new Error('上次发布结果仍待确认，请先检查部署状态')
      if (job.status !== 'ready' || input.artifactHash !== fingerprint(job.hashes) || !job.proposal || !job.revision) throw new Error('交付包已变化，请重新核对')
      if (job.proposal.contract.runtime?.port !== (job.port ?? 8080)) throw new Error('交付包端口与已确认端口不一致，请重新分析并打包')
      await worker({ action: 'validate_credential_references', root, contract: job.proposal.contract }, scope.signal)
      const { bindings, configs, ids, versionNote, digest } = await this.deploymentConfiguration(job, input, expected)
      if (!job.confirmationToken || input.confirmationToken !== job.confirmationToken || (await this.credentials.read(`confirm-${id}`)).digest !== digest) {
        throw new Error('交付包、配置或资源与最终确认不一致，请重新确认')
      }
      const requestId = job.requestId || randomUUID().replaceAll('-', '')
      job.versionNote = versionNote
      job.requestId = requestId
      job.configKeys = bindings.map(c => c.key)
      job.resourceIds = ids
      const form = new FormData(), contract = job.proposal.contract
      const folder = join(root, job.revision, 'bundle')
      for (const name of ['app.tar', 'skill.zip']) {
        const bytes = await readFile(join(folder, name))
        if (hash(bytes) !== job.hashes?.[name]) throw new Error('制品摘要不一致，拒绝发布')
        form.append(name === 'app.tar' ? 'app_tar' : 'skill_zip', new Blob([new Uint8Array(bytes)]), name)
      }
      let dockerfileContent = job.dockerfileContent ?? ''
      if (!dockerfileContent) {
        dockerfileContent = await readFile(join(root, job.revision, 'approved/source/Dockerfile'), 'utf8').catch(() => '')
      }
      for (const [key, value] of Object.entries({
        slug: job.slug,
        name: job.name,
        description: contract.description || job.description || '',
        container_port: String(contract.runtime.port),
        language: contract.runtime.language,
        runtime_version: contract.runtime.version,
        dockerfile_content: dockerfileContent,
        request_id: requestId,
        skill_zip_sha256: job.hashes?.['skill.zip'] ?? '',
        version_note: versionNote,
        app_config: JSON.stringify(bindings),
        resource_ids: JSON.stringify(ids),
        storage_mounts: JSON.stringify(contract.storage_mounts ?? []),
      })) form.append(key, String(value))
      scope.assertCurrent()
      await this.credentials.write(`publish-config-${requestId}`, { rows: JSON.stringify(configs) })
      scope.assertCurrent()
      job.status = 'publishing'; job.error = undefined; job.checks = undefined; await this.save(root, job)
      this.core.emit('skills-changed')
      try {
        const result = await this.platform('/publish', expected, { form })
        checkPublishReceipt(job, result)
        if (result.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
        job.published = true
        job.version = result.version ?? 1
        if (result.status === 'failed') this.recordFailureState(job, result.error_message || '部署失败', result.build_log?.slice(-8000), job.version)
        else job.status = 'building'
        await this.archivePublishedVersion(scope.directory, job, folder)
        job.events.push(`已上传经过确认的同一交付包 (v${job.version})，等待服务器构建与业务验证`)
      } catch (error) {
        if (error instanceof AppRequestError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
          job.status = 'ready'
          job.error = error.message
        } else {
          let reconciled = false
          try {
            const reqState = await this.platform(`/${job.slug}/requests/${requestId}`, expected)
            checkPublishReceipt(job, reqState)
            if (reqState.status === 'failed') {
              job.published = true
              job.version = reqState.version
              this.recordFailureState(job, reqState.error_message || '部署失败', reqState.build_log?.slice(-8000), reqState.version)
              reconciled = true
            } else if (['accepted', 'building', 'running'].includes(reqState.status)) {
              if (reqState.app_url && reqState.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
              job.published = true
              job.version = reqState.version ?? 1
              job.status = 'building'
              job.error = undefined
              await this.archivePublishedVersion(scope.directory, job, folder)
              job.events.push('上传连接中断后已通过幂等请求号核实平台接收状态')
              reconciled = true
            }
          } catch { /* Preserve uncertainty until Platform returns a receipt. */ }
          if (!reconciled) {
            job.status = 'unknown'
            job.error = '发布结果未确认，禁止自动重试：' + String(error)
          }
        }
      }
      await this.save(root, job); return this.public(job)
    })
  }
  async verify(id: string, expected: string, options?: AppDocument) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    return this.exclusive(id, async () => {
      if (!['building', 'unknown', 'awaiting_page_verification', 'verified', 'failed', 'publishing', 'verifying'].includes(job.status) || !job.hashes || !job.proposal) throw new Error('应用尚未发布')
      if (job.status === 'unknown' || job.status === 'publishing') {
        if (!job.requestId) throw new Error('缺少上次发布请求号，无法核对结果')
        const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
        checkPublishReceipt(job, receipt)
        if (receipt.status === 'failed') {
          job.version = receipt.version
          job.published = true
          this.recordFailureState(job, receipt.error_message || '部署失败', receipt.build_log?.slice(-8000), job.version)
          await this.save(root, job)
          return this.public(job)
        }
        if (!['accepted', 'building', 'running'].includes(receipt.status)) throw new Error('平台尚未确认上次发布，请稍后再查询')
        job.published = true
        job.version = receipt.version
        job.status = 'building'
        if (job.revision) await this.archivePublishedVersion(scope.directory, job, join(root, job.revision, 'bundle'))
        await this.save(root, job)
      }
      const contract = job.proposal.contract
      await worker({ action: 'validate_verification_contract', root, contract }, scope.signal)
      const supplied: Record<string, string> = {}
      if (options?.credentials !== undefined) {
        if (!options.credentials || typeof options.credentials !== 'object' || Array.isArray(options.credentials)) {
          throw new Error('业务验证凭据格式无效')
        }
        const authKeys = new Set(verificationCredentialFields(contract).map(field => field.key))
        for (const [key, value] of Object.entries(options.credentials)) {
          if (!authKeys.has(key) || typeof value !== 'string' || value.length > 16384 || /[\r\n\0]/.test(value)) {
            throw new Error('业务验证凭据无效，请仅填写本应用声明的登录凭据')
          }
          supplied[key] = value
        }
      }
      let remote: AppDocument
      try { remote = await this.platform('/' + job.slug, expected) } catch (error) {
        throw error
      }
      if (remote.status === 'running' && job.version && remote.current_version !== job.version) {
        const history = await this.platform('/' + job.slug + '/versions', expected)
        const attempted = history.versions?.find((version: AppDocument) => version.version === job.version)
        if (attempted?.status === 'failed' && attempted.app_tar_sha256 === job.hashes['app.tar'] &&
            attempted.skill_zip_sha256 === job.hashes['skill.zip']) {
          this.recordFailureState(job, attempted.error_message || '本次发布失败，旧版本仍在运行', remote.build_log?.slice(-8000), job.version)
          await this.save(root, job)
          this.core.emit('skills-changed')
          return this.public(job)
        }
      }
      if (remote.status !== 'running') {
        if (remote.status === 'failed') {
          this.recordFailureState(job, remote.error_message || '部署失败', remote.build_log?.slice(-8000), remote.current_version ?? job.version)
        } else {
          job.status = 'building'
          job.error = remote.error_message
        }
        await this.save(root, job)
        this.core.emit('skills-changed')
        return this.public(job)
      }
      if (remote.app_url !== job.url || (job.version && remote.current_version !== job.version)) throw new Error('线上版本或地址不一致，拒绝启用技能')
      if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error('服务器制品回执不一致')
      job.status = 'verifying'; job.error = undefined; job.checks = undefined; job.pagesVerified = undefined; await this.save(root, job)
      try {
        const credentials = { ...await this.readVersionCredentials(job), ...supplied }
        const healthPath = contract.health?.path ?? '/healthz'
        const health = { base_url: job.url, apis: [{ id: 'health', path: healthPath, method: 'GET', effect: 'read', parameters: [], auth: { type: 'none' } }] }
        const probe = await worker({ action: 'probe', root, contract: health, operation: 'health' }, scope.signal)
        if (!probeMatches(probe, contract.health?.status ?? 200, contract.health?.json_contains ?? { service: job.slug })) throw new Error('应用健康身份验证失败')
        const checks: AppDocument[] = []
        for (const test of contract.verification?.cases ?? []) {
          const api = contract.apis.find((a: AppDocument) => a.id === test.operation)
          if (!api) throw new Error(`业务验证接口不存在：${test.operation}`)
          if (api.path === healthPath) continue
          if (api.effect !== 'read') throw new Error('业务验证只能使用只读接口')
          const result = await worker({ action: 'probe', root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials }, scope.signal)
          if (!probeMatches(result, test.status ?? 200, test.json_contains)) throw new Error(`业务验证失败：${test.operation}`)
          checks.push({ operation: test.operation, status: result.status })
        }
        const latest = await this.platform('/' + job.slug, expected)
        if (latest.status !== 'running' || latest.current_version !== remote.current_version ||
            latest.app_url !== job.url || latest.config_fingerprint !== remote.config_fingerprint || !matchesReceipt(latest.build_log, job.hashes)) {
          throw new Error('业务验证期间线上部署发生变化')
        }
        if (!checks.length) {
          const hasPages = Array.isArray(contract.pages) && contract.pages.length > 0
          const hasNonHealthApis = (contract.apis ?? []).some((a: AppDocument) => a.path !== healthPath)
          if (hasPages && !hasNonHealthApis && options?.confirmPageVerification === true) {
            scope.assertCurrent()
            await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id)
            job.configFingerprint = latest.config_fingerprint
            job.published = true
            job.checks = [{ operation: 'page_verification', status: 200 }]
            job.pagesVerified = true
            job.version = remote.current_version
            job.status = 'verified'
            job.events.push('已完成人工页面验收')
          } else if (hasPages && !hasNonHealthApis) {
            scope.assertCurrent()
            job.configFingerprint = latest.config_fingerprint
            job.published = true
            job.version = remote.current_version
            job.status = 'awaiting_page_verification'
            job.events.push('容器与健康身份已就绪，请打开应用页面完成人工验收后确认启用')
          } else {
            throw new Error('缺少只读业务验证；页面应用需要单独验收，不能自动启用')
          }
        } else {
          scope.assertCurrent()
          await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id)
          job.configFingerprint = latest.config_fingerprint
          job.published = true
          // Verification credentials are transient unless the user opts into local skill use.
          if (options?.rememberCredentials === true && Object.keys(supplied).length) {
            await this.credentials.write(`version-${job.id}-${remote.current_version}`, credentials)
          }
          job.checks = checks
          job.version = remote.current_version
          job.status = 'verified'
          job.events.push('健康身份和只读业务验证通过；页面尚未验证')
        }
      } catch (error) {
        this.recordFailureState(job, String(error), remote.build_log?.slice(-8000), remote.current_version ?? job.version)
      }
      await this.save(root, job); this.core.emit('skills-changed'); return this.public(job)
    })
  }
  async versions(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/versions`, expected)
  }
  async logs(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/logs`, expected)
  }
  async storage(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/storage`, expected)
  }
  private downloadTarget(slug: string, selection: AppDocument) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    if (selection.storage === true || typeof selection.mount === 'string' && selection.mount) {
      return { path: `/${slug}/storage/backup`, filename: `${slug}-storage-backup.tar`,
        query: selection.mount ? { mount: String(selection.mount) } : undefined }
    }
    const { version, artifact } = selection
    if (!Number.isSafeInteger(version) || version < 1 || !['app.tar', 'skill.zip', 'Dockerfile', 'manifest.json'].includes(artifact)) {
      throw new Error('无效版本文件')
    }
    return { path: `/${slug}/versions/${version}/artifacts/${artifact}`, filename: `${slug}-v${version}-${artifact}` }
  }
  async download(slug: string, selection: AppDocument, expected: string) {
    const scope = this.scope(expected)
    const { filename, path, query } = this.downloadTarget(slug, selection)
    const result = await this.platform(path, expected, { query, download: true })
    scope.assertCurrent()
    if (!Buffer.isBuffer(result.bytes) || !result.bytes.length || (result.sha256 && hash(result.bytes) !== result.sha256)) {
      throw new Error('平台返回文件为空或摘要不匹配')
    }
    return { filename, base64: result.bytes.toString('base64') }
  }
  async saveDownload(slug: string, selection: AppDocument, expected: string, downloads = join(homedir(), 'Downloads')) {
    const scope = this.scope(expected)
    const { filename, path, query } = this.downloadTarget(slug, selection)
    await mkdir(downloads, { recursive: true, mode: 0o700 })
    const temp = join(downloads, `.opc-${randomUUID()}.download`)
    const response: Response = await this.platform(path, expected, { query, stream: true })
    if (!response.body) throw new Error('平台未返回文件内容')
    try {
      const digest = createHash('sha256')
      let bytes = 0
      const checksum = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        digest.update(chunk)
        callback(null, chunk)
      } })
      await pipeline(response.body, checksum, createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal: scope.signal })
      const expectedHash = response.headers.get('x-artifact-sha256')
      if (!bytes || expectedHash && digest.digest('hex') !== expectedHash) throw new Error('平台返回文件为空或摘要不匹配')
      scope.assertCurrent()
      const preferred = join(downloads, filename)
      let dest = preferred
      try { await link(temp, dest) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        dest = join(downloads, `${randomUUID().slice(0, 8)}-${filename}`)
        await link(temp, dest)
      }
      return { path: dest }
    } finally { await rm(temp, { force: true }) }
  }
  async recheck(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/recheck`, expected, { method: 'POST', body: {} })
  }
  async updateConfig(slug: string, body: AppDocument, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    const scope = this.scope(expected)
    const result = await this.platform(`/${slug}/config`, expected, { method: 'PUT', body })
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => undefined)
        if (opened && opened.job.slug === slug && ['verified', 'awaiting_page_verification'].includes(opened.job.status)) {
          const activeVersion = result.current_version ?? result.version
          if (activeVersion && opened.job.version !== activeVersion) continue
          opened.job.status = 'building'
          opened.job.configFingerprint = undefined
          opened.job.pagesVerified = undefined
          opened.job.events.push('运行配置已更新，需重新验证业务后启用技能')
          await this.save(opened.root, opened.job)
        }
      }
    }
    this.core.emit('skills-changed')
    return result
  }
  async deleteApp(slug: string, purgeVolumes: boolean, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}`, expected, { method: 'DELETE', query: purgeVolumes ? { purge_volumes: 'true' } : undefined })
  }
  async rollback(slug: string, targetVersion: number, reason: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !Number.isInteger(targetVersion) || targetVersion <= 0) throw new Error('回滚参数无效')
    const scope = this.scope(expected)
    const rbResult = await this.platform(`/${slug}/rollback`, expected, {
      method: 'POST',
      body: { target_version: targetVersion, reason: reason || `回退至版本 v${targetVersion}` },
    })
    const current = await this.platform(`/${slug}`, expected)
    if (current.status !== 'running' || current.current_version !== targetVersion) {
      throw new Error('回滚后线上版本状态不一致')
    }
    if (rbResult.config_fingerprint && current.config_fingerprint && rbResult.config_fingerprint !== current.config_fingerprint) {
      throw new Error('回滚后运行配置指纹不一致')
    }
    const verInfo = rbResult.version ?? {}
    let expectedSkillSha = String(rbResult.skill_zip_sha256 || verInfo.skill_zip_sha256 || '').trim()
    let expectedAppTarSha = String(verInfo.app_tar_sha256 || '').trim()
    const localMeta = await readFile(join(scope.directory, 'versions', slug, `v${targetVersion}`, 'summary.json'), 'utf8')
      .then(s => JSON.parse(s)).catch(() => undefined)

    let skillZipBytes: Buffer | undefined
    try {
      const dl = await this.platform(`/${slug}/versions/${targetVersion}/artifacts/skill.zip`, expected)
      if (dl?.bytes && Buffer.isBuffer(dl.bytes) && dl.bytes.length > 0) {
        skillZipBytes = dl.bytes
      } else if (typeof dl?.skill_zip_b64 === 'string' && dl.skill_zip_b64.length > 0) {
        skillZipBytes = Buffer.from(dl.skill_zip_b64, 'base64')
      }
    } catch (error) {
      if (!(error instanceof AppRequestError) || error.status !== 404) throw error
      /* Platform confirmed the artifact is missing; use the local archive if it matches. */
      const verDir = join(scope.directory, 'versions', slug, `v${targetVersion}`)
      const localFallback = join(verDir, 'skill.zip')
      if (existsSync(localFallback)) {
        skillZipBytes = await readFile(localFallback).catch(() => undefined)
      }
      if (localMeta) {
        if (!expectedSkillSha && localMeta?.hashes?.['skill.zip']) expectedSkillSha = String(localMeta.hashes['skill.zip'])
        if (!expectedAppTarSha && localMeta?.hashes?.['app.tar']) expectedAppTarSha = String(localMeta.hashes['app.tar'])
      }
    }
    if (skillZipBytes) {
      if (!expectedSkillSha || hash(skillZipBytes) !== expectedSkillSha) {
        throw new Error('回滚技能包摘要不一致，拒绝启用')
      }
      const verDir = join(scope.directory, 'versions', slug, `v${targetVersion}`)
      await mkdir(verDir, { recursive: true, mode: 0o700 })
      await writeFile(join(verDir, 'skill.zip'), skillZipBytes, { mode: 0o600 }).catch(() => {})
    }

    const matchingJobs: { root: string; job: DeliveryJob }[] = []
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => undefined)
        if (opened && opened.job.slug === slug) {
          matchingJobs.push(opened)
        }
      }
    }

    // Only a task with matching version and artifacts can supply credentials for this version.
    let primary = matchingJobs.find(({ job }) => job.published && job.version === targetVersion &&
      job.hashes?.['app.tar'] === expectedAppTarSha && job.hashes?.['skill.zip'] === expectedSkillSha)
    if (!primary && skillZipBytes) {
      const newId = randomUUID()
      const newRoot = join(scope.directory, newId)
      const newJob: DeliveryJob = {
        id: newId,
        name: current.name || slug,
        slug,
        url: current.app_url || verInfo.app_url || '',
        session: 'rollback',
        status: 'building',
        published: true,
        version: targetVersion,
        requestId: typeof localMeta?.requestId === 'string' && /^[a-f0-9]+$/.test(localMeta.requestId) &&
          localMeta.hashes?.['app.tar'] === expectedAppTarSha && localMeta.hashes?.['skill.zip'] === expectedSkillSha ? localMeta.requestId : undefined,
        port: current.container_port ?? verInfo.container_port,
        events: [`从平台同步回退版本 v${targetVersion}`],
        proposal: { summary: `回退至版本 v${targetVersion}`, unresolved: [], changes: [], contract: {} },
      }
      await this.save(newRoot, newJob)
      primary = { root: newRoot, job: newJob }
      matchingJobs.push(primary)
    }

    let localSkillSynced = false
    let localSkillVerified = false
    let verification: AppDocument | undefined
    for (const opened of matchingJobs) {
      if (opened !== primary) {
        if (['verified', 'awaiting_page_verification'].includes(opened.job.status)) {
          opened.job.status = 'ready'
          opened.job.events.push(`应用已回退至 v${targetVersion}，旧任务技能已停用`)
          await this.save(opened.root, opened.job)
        }
        continue
      }
      opened.job.version = targetVersion
      opened.job.published = true
      opened.job.pagesVerified = undefined
      opened.job.configFingerprint = current.config_fingerprint ?? rbResult.config_fingerprint
      if (expectedAppTarSha && expectedSkillSha) {
        opened.job.hashes = {
          ...(opened.job.hashes ?? {}),
          'app.tar': expectedAppTarSha,
          'skill.zip': expectedSkillSha,
        }
      }
      if (skillZipBytes && opened.job.proposal) {
        const extracted = await worker({
          action: 'extract_skill_contract',
          root: opened.root,
          skill_zip_b64: skillZipBytes.toString('base64'),
          expected_sha256: expectedSkillSha,
          slug,
          app_url: opened.job.url || current.app_url || '',
        }, scope.signal)
        opened.job.proposal.contract = extracted.contract
        if (extracted.skill_markdown) {
          opened.job.skillMarkdown = extracted.skill_markdown
        }
        opened.job.hashes = {
          ...(opened.job.hashes ?? {}),
          'app.tar': expectedAppTarSha || opened.job.hashes?.['app.tar'] || '',
          'skill.zip': extracted.sha256,
        }
        localSkillSynced = true
      }

      if (localSkillSynced && opened.job.proposal?.contract && matchesReceipt(current.build_log, opened.job.hashes)) {
        try {
          const contract = opened.job.proposal.contract
          const archivedJobId = localMeta?.hashes?.['skill.zip'] === expectedSkillSha && localMeta?.hashes?.['app.tar'] === expectedAppTarSha
            && typeof localMeta.jobId === 'string' && /^[a-f0-9-]{36}$/.test(localMeta.jobId) ? localMeta.jobId : undefined
          if (archivedJobId && archivedJobId !== opened.job.id) {
            const saved = await this.credentials.read(`version-${archivedJobId}-${targetVersion}`)
            if (Object.keys(saved).length) await this.credentials.write(`version-${opened.job.id}-${targetVersion}`, saved)
          }
          const credentials = await this.readVersionCredentials(opened.job)
          const health = { base_url: opened.job.url, apis: [{ id: 'health', path: contract.health?.path ?? '/healthz', method: 'GET', effect: 'read', parameters: [], auth: { type: 'none' } }] }
          const probe = await worker({ action: 'probe', root: opened.root, contract: health, operation: 'health' }, scope.signal)
          if (!probeMatches(probe, contract.health?.status ?? 200, contract.health?.json_contains ?? { service: slug })) {
            throw new Error('回滚后健康身份验证失败')
          }
          const checks: AppDocument[] = []
          for (const test of contract.verification?.cases ?? []) {
            const api = (contract.apis ?? []).find((a: AppDocument) => a.id === test.operation)
            if (!api || api.path === '/healthz') continue
            if (api.effect !== 'read') throw new Error('业务验证只能使用只读接口')
            const res = await worker({ action: 'probe', root: opened.root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials }, scope.signal)
            if (!probeMatches(res, test.status ?? 200, test.json_contains)) {
              throw new Error(`回滚后业务验证失败：${test.operation}`)
            }
            checks.push({ operation: test.operation, status: res.status })
          }
          const latest = await this.platform(`/${slug}`, expected)
          if (latest.status !== 'running' || latest.current_version !== targetVersion ||
              latest.config_fingerprint !== current.config_fingerprint || !matchesReceipt(latest.build_log, opened.job.hashes)) {
            throw new Error('回滚验证期间线上版本或配置发生变化')
          }
          if (checks.length > 0) {
            opened.job.checks = checks
            opened.job.status = 'verified'
            opened.job.events.push(`已回退至 v${targetVersion}，历史技能与业务探针验证通过`)
            localSkillVerified = true
            verification = { status: 'verified-rolled-back' }
          } else if (Array.isArray(contract.pages) && contract.pages.length > 0 && !(contract.apis ?? []).some((a: AppDocument) => a.path !== '/healthz')) {
            opened.job.status = 'awaiting_page_verification'
            verification = { status: 'awaiting_page_verification', detail: '请打开页面完成人工验收' }
            opened.job.events.push(`已回退至 v${targetVersion}，请打开页面完成人工验收后启用技能`)
          } else {
            opened.job.status = 'building'
            opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
          }
        } catch (error) {
          opened.job.status = 'building'
          opened.job.error = String(error)
          verification = { status: 'probe-warning', detail: opened.job.error }
          opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
        }
      } else if (opened.job.status === 'verified') {
        opened.job.status = 'building'
        opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
      }
      await this.save(opened.root, opened.job)
    }
    this.core.emit('skills-changed')
    return {
      ...rbResult,
      local_skill_synced: localSkillSynced,
      local_skill_verified: localSkillVerified,
      verification,
      job_id: primary?.job.id,
      rollback_notice: ROLLBACK_NOTICE,
    }
  }
  async setSkillEnabled(id: string, enabled: boolean, expected: string) {
    const scope = this.scope(expected)
    await this.exclusive(id, async () => {
      const { job } = await this.open(scope.directory, id)
      if (job.status !== 'verified') throw new Error('应用尚未通过业务验证')
      if (enabled) await this.verifiedJob(id, expected, true)
      const path = this.skillPreferencePath(scope.directory, job.slug)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temp = join(dirname(path), randomUUID())
      try {
        await writeFile(temp, enabled ? 'enabled' : 'disabled', { mode: 0o600 })
        scope.assertCurrent()
        await rename(temp, path)
      } finally {
        await rm(temp, { force: true })
      }
      this.core.emit('skills-changed')
      this.core.emit('change')
    })
  }
  async verifiedJob(id: string, expected: string, allowDisabled = false) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.status !== 'verified' || !job.proposal || !job.checks?.length) throw new Error('应用尚未通过业务验证')
    await worker({ action: 'validate_credential_references', root, contract: job.proposal.contract }, scope.signal)
    const remote = await this.platform('/' + job.slug, expected)
    scope.assertCurrent()
    if (remote.status !== 'running' || remote.app_url !== job.url || remote.current_version !== job.version) throw new Error('应用线上版本发生变化，请重新验证')
    if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error('线上制品版本发生变化')
    if (job.configFingerprint !== remote.config_fingerprint) throw new Error('应用配置已变化，请重新验证业务')
    if (!allowDisabled && await this.isSkillDisabled(scope.directory, job.slug)) throw new Error('应用技能已停用')
    return { job, root, signal: scope.signal }
  }
  private async readVersionCredentials(job: DeliveryJob) {
    if (!job.version) return {}
    const config = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {}
    const authKeys = new Set(verificationCredentialFields(job.proposal!.contract).map(field => field.key))
    const rows: AppDocument[] = config.rows ? JSON.parse(config.rows) : []
    const configured = Object.fromEntries(rows.filter(row => authKeys.has(row.key) && !row.resource_id).map(row => [row.key, row.value]))
    const version = await this.credentials.read(`version-${job.id}-${job.version}`)
    const legacy = job.confirmationToken ? {} : await this.credentials.read(job.id)
    return { ...legacy, ...configured, ...version }
  }
  async invoke(id: string, operation: string, params: AppDocument, body: unknown, expected: string, approve: (reason: string) => Promise<boolean>, turn?: AbortSignal) {
    const { job, root, signal } = await this.verifiedJob(id, expected)
    const api = job.proposal!.contract.apis.find((a: AppDocument) => a.id === operation)
    if (!api) throw new Error('未找到应用操作')
    let approved = false
    if (api.effect !== 'read') {
      approved = await approve(`${job.name}：${api.purpose}\n${api.method} ${api.path}\n${JSON.stringify({ params, body })}`)
      if (!approved) throw new Error('操作未获批准')
      const current = await this.verifiedJob(id, expected)
      if (current.job.revision !== job.revision) throw new Error('审批期间应用版本发生变化')
    }
    const invocationSignal = turn ? AbortSignal.any([signal, turn]) : signal
    invocationSignal.throwIfAborted()
    return worker({ action: 'probe', root, contract: job.proposal!.contract, operation, params, body, approved,
      credentials: await this.readVersionCredentials(job) }, invocationSignal).catch(error => {
      if (approved) throw new Error('操作结果未知，请先查询实际结果再决定下一步', { cause: error })
      throw error
    })
  }
}
