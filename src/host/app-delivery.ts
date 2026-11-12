import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OpcCore } from './core.ts'
import { identityHash } from './context.ts'

export const ROLLBACK_NOTICE = '回滚恢复代码与运行配置，不自动回退数据库/卷中的业务数据；旧代码和新数据兼容性仍需验证。'
export type AppDocument = Record<string, any>
export interface DeliveryJob {
  id: string; name: string; slug: string; url: string; session: string
  status: 'importing' | 'draft' | 'analyzing' | 'review' | 'preparing' | 'ready' | 'publishing' | 'building' | 'verifying' | 'awaiting_page_verification' | 'verified' | 'failed' | 'unknown'
  events: string[]; error?: string; proposal?: AppDocument; revision?: string; failedRevision?: string
  hashes?: Record<string, string>; version?: number; requestId?: string
  checks?: AppDocument[]; published?: boolean; failureContext?: string; configFingerprint?: string
  configKeys?: string[]; resourceIds?: string[]; failedSnapshot?: AppDocument; pagesVerified?: boolean; userDisabled?: boolean
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

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const fingerprint = (value: unknown) => hash(JSON.stringify(value))
export function contains(actual: any, expected: any): boolean {
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

class AppRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export class AppDelivery {
  private busy = new Set<string>()
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
      const { job, root } = result
      const previousStatus = job.status
      if (!this.busy.has(id) && ['importing', 'analyzing', 'preparing', 'verifying'].includes(job.status)) { job.status = 'failed'; job.error = '上次任务中断，可重新分析或验证' }
      if (!this.busy.has(id) && job.status === 'publishing') { job.status = 'unknown'; job.error = '发布结果未知，请查询状态，不要重复发布' }
      if (previousStatus !== job.status) await this.save(root, job)
      if (!this.busy.has(id) && job.status === 'unknown' && job.requestId) {
        try {
          const reqState = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
          if (['accepted', 'building', 'running'].includes(reqState.status)) {
            job.published = true
            job.version = reqState.version ?? job.version
            job.status = 'building'
            job.error = undefined
            await this.save(root, job)
          } else if (reqState.status === 'failed') {
            job.published = true
            job.version = reqState.version ?? job.version
            job.status = 'failed'
            job.error = reqState.error_message || job.error
            await this.save(root, job)
          }
        } catch (error) {
          if (error instanceof AppRequestError && error.status === 404) {
            job.status = 'ready'
            job.error = '服务器未收到上次上传，可重新确认发布'
            await this.save(root, job)
          }
        }
      }
      if (!this.busy.has(id) && ['building', 'unknown'].includes(job.status)) {
        try {
          const remote = await this.platform('/' + job.slug, expected)
          if (remote.status === 'failed') { job.status = 'failed'; job.error = remote.error_message; await this.save(root, job) }
        } catch { /* Preserve uncertainty until an explicit status check. */ }
      }
      return this.public(job)
    }))
    scope.assertCurrent(); return jobs.filter((job): job is AppDocument => job !== undefined).reverse()
  }
  public(job: DeliveryJob): AppDocument {
    const { proposal, ...rest } = job
    return {
      ...rest,
      artifactHash: job.hashes ? fingerprint(job.hashes) : undefined,
      proposalHash: proposal ? fingerprint(proposal) : undefined,
      proposal: proposal && {
        summary: proposal.summary,
        unresolved: proposal.unresolved,
        changes: proposal.changes?.map((change: AppDocument) => ({ path: change.path, reason: change.reason })),
        contract: {
          description: proposal.contract.description,
          configs: proposal.contract.configs,
          storage_mounts: proposal.contract.storage_mounts,
          auth_profile: proposal.contract.auth_profile,
          auth_profiles: proposal.contract.auth_profiles,
          apis: proposal.contract.apis?.map(({ id, purpose, method, path, auth }: AppDocument) => ({ id, purpose, method, path, auth })),
          pages: proposal.contract.pages?.map(({ purpose, path }: AppDocument) => ({ purpose, path })),
        },
      },
    }
  }
  async platform(path: string, expected: string, options: { method?: string; body?: unknown; form?: FormData; query?: Record<string, string> } = {}): Promise<any> {
    if (!/^\/(?:check-slug|resources|dockerfile-templates|publish|[a-z][a-z0-9-]*(?:\/(?:logs|versions(?:\/*[0-9]+\/artifacts\/(?:app\.tar|skill\.zip|Dockerfile|manifest\.json))?|storage(?:\/backup)?|recheck|verify|rollback|migrate-data|config|requests\/[A-Za-z0-9_-]+))?)?$/.test(path)) throw new Error('不支持的应用操作')
    const scope = this.scope(expected)
    const token = await this.core.auth.token(); scope.assertCurrent()
    const url = new URL('/integration/v1/apps' + (path === '/' ? '' : path), this.core.auth.http.base)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    const response = await fetch(url, { method: options.method ?? (options.body || options.form ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${token}`, ...(options.form ? {} : { 'Content-Type': 'application/json' }) },
      body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined), redirect: 'error',
      signal: AbortSignal.any([scope.signal, AbortSignal.timeout(options.form ? 180_000 : 30_000)]) })
    scope.assertCurrent()
    if (response.status === 404 && ['/', '/check-slug', '/resources'].includes(path)) throw new AppRequestError(404, '测试服尚未启用企业应用部署接口，需要发布配套 Platform 版本')
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && (path.endsWith('/skill.zip') || path.endsWith('/app.tar') || contentType.includes('application/zip') || contentType.includes('application/octet-stream'))) {
      const ab = await response.arrayBuffer()
      return { bytes: Buffer.from(ab), sha256: response.headers.get('x-artifact-sha256') ?? undefined }
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
    if (input.upgrade) {
      const existing = await this.platform('/' + input.slug, expected)
      if (!existing.can_manage) throw new Error('只有应用创建人或管理员可以升级此应用')
      targetUrl = existing.app_url
      targetName = existing.name?.trim() || targetName
    } else {
      const reserved = await this.platform('/check-slug', expected, { body: { slug: input.slug } })
      if (!reserved.available) throw new Error('应用标识已被使用，请换一个标识；若需升级已有应用请选择升级')
      targetUrl = reserved.app_url
    }
    scope.assertCurrent()
    const job: DeliveryJob = { id: randomUUID(), name: targetName, slug: input.slug, url: targetUrl, session, status: 'importing', events: ['正在创建源码隔离副本'] }
    const root = join(scope.directory, job.id)
    await this.save(root, job)
    await this.exclusive(job.id, async () => {
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
      job.error = undefined
      job.events.push('已返回改造方案核对阶段，可补充说明重新分析或重新打包')
      await this.save(root, job)
      this.core.emit('skills-changed')
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
    if (job.revision && (job.published || job.status === 'failed')) {
      job.failedRevision = job.revision
      job.failedSnapshot = {
        artifactHashes: job.hashes,
        version: job.version,
        configKeys: job.configKeys ?? [],
        resourceIds: job.resourceIds ?? [],
        storageMounts: job.proposal?.contract?.storage_mounts ?? [],
        verificationError: job.error || job.failureContext,
      }
    }
    job.status = 'analyzing'
    job.failureContext = job.error || job.failureContext
    job.error = undefined
    job.checks = undefined
    job.events.push('AI 正在分析源码；尚未执行发布')
    try { await this.save(root, job) } catch (error) { this.busy.delete(id); throw error }
    this.core.emit('skills-changed')
    void (async () => {
      try {
        await this.analyze!(job, root, feedback.slice(0, 20_000), scope.signal)
        scope.assertCurrent()
        if (!job.proposal || job.status === 'analyzing') throw new Error('AI 未提交有效改造方案，请补充说明后重试')
      } catch (error) {
        job.status = 'failed'
        job.error = String(error)
      }
      try { await this.save(root, job) } finally { this.busy.delete(id); this.core.emit('change') }
    })().catch(() => {})
    return this.public(job)
  }
  async submit(job: DeliveryJob, root: string, proposal: AppDocument, signal: AbortSignal) {
    if (proposal.contract?.slug !== job.slug || proposal.contract?.base_url !== job.url) throw new Error('应用标识或地址与导入时不一致')
    if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    if (!Array.isArray(proposal.unresolved)) throw new Error('unresolved 必须为数组')
    const validated = await worker({
      action: 'validate',
      root,
      proposal,
      allow_unresolved: Boolean(proposal.unresolved.length),
      repair: Boolean(job.failedRevision),
      failed_revision: job.failedRevision ?? '',
      failure_feedback: job.failureContext ?? '',
    }, signal)
    signal.throwIfAborted(); if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    job.proposal = validated?.proposal ?? proposal
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
        }, scope.signal)
        scope.assertCurrent(); job.revision = revision; job.hashes = result.summary.files; job.status = 'ready'; job.version = undefined; job.published = undefined; job.requestId = randomUUID().replaceAll('-', '')
        job.events.push('部署包已生成，服务器构建和业务验证尚未执行')
      } catch (error) { job.status = 'failed'; job.error = String(error) }
      await this.save(root, job); return this.public(job)
    })
  }
  async publish(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    return this.exclusive(id, async () => {
      if (job.status === 'unknown' && job.requestId && !input.forceReupload) {
        try {
          const reqState = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
          if (['accepted', 'building', 'running'].includes(reqState.status)) {
            job.published = true; job.version = reqState.version ?? job.version; job.status = 'building'; job.error = undefined
            job.events.push('已通过幂等请求号恢复服务端构建状态，无需重复上传')
            await this.save(root, job); return this.public(job)
          }
        } catch (error) {
          if (error instanceof AppRequestError && error.status === 404) {
            job.status = 'ready'; job.error = undefined
          } else {
            throw new Error('上次上传状态仍未确认，请先检查部署状态或明确确认重传')
          }
        }
      }
      if (job.status !== 'ready' || input.artifactHash !== fingerprint(job.hashes) || !job.proposal || !job.revision) throw new Error('交付包已变化，请重新核对')
      const configs = input.config as { key: string; value: string; resource_id?: string }[]
      if (!Array.isArray(configs) || configs.some(c => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.key) || typeof c.value !== 'string' || (c.resource_id !== undefined && typeof c.resource_id !== 'string')) || new Set(configs.map(c => c.key)).size !== configs.length) throw new Error('配置格式无效')
      for (const c of job.proposal.contract.configs ?? []) {
        const selected = configs.find(i => i.key === c.key)
        if (c.required && !selected?.value && !selected?.resource_id) throw new Error(`请填写 ${c.key}`)
      }
      const ids = [...new Set(configs.flatMap(c => c.resource_id ? [c.resource_id] : []))]
      const bindings = configs.map(c => ({ ...c, value_source: c.resource_id ? 'resource' : 'manual' }))
      const requestId = (typeof input.requestId === 'string' && input.requestId.trim()) || job.requestId || randomUUID().replaceAll('-', '')
      job.requestId = requestId
      job.configKeys = configs.map(c => c.key)
      job.resourceIds = ids
      const form = new FormData(), contract = job.proposal.contract
      const folder = join(root, job.revision, 'bundle')
      for (const name of ['app.tar', 'skill.zip']) {
        const bytes = await readFile(join(folder, name))
        if (hash(bytes) !== job.hashes?.[name]) throw new Error('制品摘要不一致，拒绝发布')
        form.append(name === 'app.tar' ? 'app_tar' : 'skill_zip', new Blob([new Uint8Array(bytes)]), name)
      }
      for (const [key, value] of Object.entries({ slug: job.slug, name: job.name, description: contract.description, container_port: String(contract.runtime.port), language: contract.runtime.language, runtime_version: contract.runtime.version, request_id: requestId, skill_zip_sha256: job.hashes?.['skill.zip'] ?? '', version_note: String(input.versionNote ?? ''), app_config: JSON.stringify(bindings), resource_ids: JSON.stringify(ids), storage_mounts: JSON.stringify(contract.storage_mounts ?? []) })) form.append(key, String(value))
      scope.assertCurrent()
      const authKeys = new Set<string>(contract.apis.flatMap((api: AppDocument) => api.auth?.env ? [api.auth.env] : []))
      for (const profile of [contract.auth_profile ?? {}, ...Object.values(contract.auth_profiles ?? {})] as AppDocument[]) {
        for (const key of ["username_env", "password_env", "token_env"]) if (typeof profile[key] === "string") authKeys.add(profile[key])
      }
      await this.credentials.write(job.id, Object.fromEntries(configs.filter(c => authKeys.has(c.key) && !c.resource_id).map(c => [c.key, c.value])))
      scope.assertCurrent()
      job.status = 'publishing'; job.error = undefined; job.checks = undefined; await this.save(root, job)
      try {
        const result = await this.platform('/publish', expected, { form })
        if (result.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
        job.published = true; job.version = result.version; job.status = 'building'; job.events.push('已上传，等待服务器构建')
      } catch (error) {
        if (error instanceof AppRequestError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
          job.status = 'ready'
          job.error = error.message
        } else {
          let reconciled = false
          try {
            const reqState = await this.platform(`/${job.slug}/requests/${requestId}`, expected)
            if (['accepted', 'building', 'running'].includes(reqState.status)) {
              if (reqState.app_url && reqState.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
              job.published = true
              job.version = reqState.version ?? 1
              job.status = 'building'
              job.error = undefined
              job.events.push('上传连接中断后已通过幂等请求号核实平台接收状态')
              reconciled = true
            }
          } catch (reqErr) {
            if (reqErr instanceof AppRequestError && reqErr.status === 404) {
              job.status = 'ready'
              job.error = '服务器未收到本次上传，可直接重试发布'
              reconciled = true
            }
          }
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
      if (job.status === 'unknown' && job.requestId) {
        try {
          const reqState = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
          if (['accepted', 'building', 'running'].includes(reqState.status)) {
            job.published = true
            job.version = reqState.version ?? job.version
          }
        } catch (reqErr) {
          if (reqErr instanceof AppRequestError && reqErr.status === 404) {
            job.status = 'ready'
            job.error = '服务器未收到上次上传，请重新确认发布'
            await this.save(root, job)
            return this.public(job)
          }
        }
      }
      const contract = job.proposal.contract
      if (options?.credentials && typeof options.credentials === 'object') {
        const authKeys = new Set<string>((contract.apis ?? []).flatMap((api: AppDocument) => api.auth?.env ? [api.auth.env] : []))
        for (const profile of [contract.auth_profile ?? {}, ...Object.values(contract.auth_profiles ?? {})] as AppDocument[]) {
          for (const key of ['username_env', 'password_env', 'token_env']) if (typeof profile[key] === 'string') authKeys.add(profile[key])
        }
        const supplied: Record<string, string> = {}
        for (const [k, v] of Object.entries(options.credentials)) {
          if (!authKeys.has(k) || typeof v !== 'string' || v.length > 16384 || /[\r\n\0]/.test(v)) throw new Error('业务验证凭据无效，请仅填写本应用声明的登录凭据')
          supplied[k] = v
        }
        const existingCreds = await this.credentials.read(job.id)
        await this.credentials.write(job.id, { ...existingCreds, ...supplied })
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
          job.status = 'failed'
          job.error = attempted.error_message || '本次发布失败，旧版本仍在运行'
          await this.save(root, job)
          this.core.emit('skills-changed')
          return this.public(job)
        }
      }
      if (remote.status !== 'running') {
        job.status = remote.status === 'failed' ? 'failed' : 'building'
        job.error = remote.error_message
        await this.save(root, job)
        this.core.emit('skills-changed')
        return this.public(job)
      }
      if (remote.app_url !== job.url || (job.version && remote.current_version !== job.version)) throw new Error('线上版本或地址不一致，拒绝启用技能')
      if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error('服务器制品回执不一致')
      job.status = 'verifying'; job.error = undefined; job.checks = undefined; await this.save(root, job)
      try {
        const credentials = await this.credentials.read(job.id)
        const health = { base_url: job.url, apis: [{ id: 'health', path: '/healthz', method: 'GET', effect: 'read', parameters: [], auth: { type: 'none' } }] }
        const probe = await worker({ action: 'probe', root, contract: health, operation: 'health' }, scope.signal)
        if (probe.status !== 200 || !probe.content_type.includes('application/json') || !contains(JSON.parse(probe.content), { service: job.slug })) throw new Error('应用健康身份验证失败')
        const checks: AppDocument[] = []
        for (const test of contract.verification?.cases ?? []) {
          const api = contract.apis.find((a: AppDocument) => a.id === test.operation)
          if (!api || api.path === '/healthz') continue
          if (api.effect !== 'read') throw new Error('业务验证只能使用只读接口')
          const result = await worker({ action: 'probe', root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials }, scope.signal)
          if (result.status !== (test.status ?? 200) || !result.content_type.includes('application/json') || !contains(JSON.parse(result.content), test.json_contains)) throw new Error(`业务验证失败：${test.operation}`)
          checks.push({ operation: test.operation, status: result.status })
        }
        const latest = await this.platform('/' + job.slug, expected)
        if (latest.status !== 'running' || latest.current_version !== remote.current_version ||
            latest.app_url !== job.url || !matchesReceipt(latest.build_log, job.hashes)) {
          throw new Error('业务验证期间线上部署发生变化')
        }
        if (!checks.length) {
          const hasPages = Array.isArray(contract.pages) && contract.pages.length > 0
          const hasNonHealthApis = (contract.apis ?? []).some((a: AppDocument) => a.path !== '/healthz')
          if (hasPages && options?.confirmPageVerification) {
            scope.assertCurrent()
            job.configFingerprint = latest.config_fingerprint
            job.published = true
            job.checks = [{ operation: 'page_verification', status: 200 }]
            job.pagesVerified = true
            job.version = remote.current_version
            job.status = 'verified'
            job.events.push('已完成人工页面验收，应用技能已启用')
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
          scope.assertCurrent(); job.configFingerprint = latest.config_fingerprint; job.published = true; job.checks = checks; job.version = remote.current_version; job.status = 'verified'; job.events.push('健康身份和只读业务验证通过；页面尚未验证')
        }
      } catch (error) {
        job.status = 'failed'
        job.error = String(error)
        job.failedRevision = job.revision || job.failedRevision
        job.failedSnapshot = {
          artifactHashes: job.hashes,
          version: remote.current_version ?? job.version,
          configKeys: job.configKeys ?? [],
          resourceIds: job.resourceIds ?? [],
          storageMounts: contract.storage_mounts ?? [],
          verificationError: String(error),
        }
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
        if (opened && opened.job.slug === slug && opened.job.status === 'verified') {
          opened.job.status = 'building'
          opened.job.configFingerprint = undefined
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
    const expectedSkillSha = String(rbResult.skill_zip_sha256 || verInfo.skill_zip_sha256 || '').trim()
    const expectedAppTarSha = String(verInfo.app_tar_sha256 || '').trim()

    let skillZipBytes: Buffer | undefined
    try {
      const dl = await this.platform(`/${slug}/versions/${targetVersion}/artifacts/skill.zip`, expected)
      if (dl?.bytes && Buffer.isBuffer(dl.bytes) && dl.bytes.length > 0) {
        skillZipBytes = dl.bytes
      } else if (typeof dl?.skill_zip_b64 === 'string' && dl.skill_zip_b64.length > 0) {
        skillZipBytes = Buffer.from(dl.skill_zip_b64, 'base64')
      }
    } catch {
      /* Artifact download optional when not provided by mock/server */
    }
    if (skillZipBytes) {
      if (!expectedSkillSha || hash(skillZipBytes) !== expectedSkillSha) {
        throw new Error('回滚技能包摘要不一致，拒绝启用')
      }
    }

    let localSkillSynced = false
    let localSkillVerified = false
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => undefined)
        if (opened && opened.job.slug === slug) {
          opened.job.version = targetVersion
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
            }, scope.signal)
            opened.job.proposal.contract = {
              ...opened.job.proposal.contract,
              ...extracted.contract,
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
              const credentials = await this.credentials.read(opened.job.id)
              const health = { base_url: opened.job.url, apis: [{ id: 'health', path: contract.health?.path ?? '/healthz', method: 'GET', effect: 'read', parameters: [], auth: { type: 'none' } }] }
              const probe = await worker({ action: 'probe', root: opened.root, contract: health, operation: 'health' }, scope.signal)
              if (probe.status !== (contract.health?.status ?? 200) || !probe.content_type.includes('application/json') || !contains(JSON.parse(probe.content), contract.health?.json_contains ?? { service: slug })) {
                throw new Error('回滚后健康身份验证失败')
              }
              const checks: AppDocument[] = []
              for (const test of contract.verification?.cases ?? []) {
                const api = (contract.apis ?? []).find((a: AppDocument) => a.id === test.operation)
                if (!api || api.path === '/healthz') continue
                if (api.effect !== 'read') throw new Error('业务验证只能使用只读接口')
                const res = await worker({ action: 'probe', root: opened.root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials }, scope.signal)
                if (res.status !== (test.status ?? 200) || !res.content_type.includes('application/json') || !contains(JSON.parse(res.content), test.json_contains)) {
                  throw new Error(`回滚后业务验证失败：${test.operation}`)
                }
                checks.push({ operation: test.operation, status: res.status })
              }
              if (checks.length > 0) {
                opened.job.checks = checks
                opened.job.status = 'verified'
                opened.job.events.push(`已回退至 v${targetVersion}，历史技能与业务探针验证通过`)
                localSkillVerified = true
              } else if (Array.isArray(contract.pages) && contract.pages.length > 0 && !(contract.apis ?? []).some((a: AppDocument) => a.path !== '/healthz')) {
                opened.job.status = 'awaiting_page_verification'
                opened.job.events.push(`已回退至 v${targetVersion}，请打开页面完成人工验收后启用技能`)
              } else {
                opened.job.status = 'building'
                opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
              }
            } catch {
              opened.job.status = 'building'
              opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
            }
          } else if (opened.job.status === 'verified') {
            opened.job.status = 'building'
            opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
          }
          await this.save(opened.root, opened.job)
        }
      }
    }
    this.core.emit('skills-changed')
    return {
      ...rbResult,
      local_skill_synced: localSkillSynced,
      local_skill_verified: localSkillVerified,
      rollback_notice: ROLLBACK_NOTICE,
    }
  }
  async verifiedJob(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.status !== 'verified' || !job.proposal || !job.checks?.length) throw new Error('应用尚未通过业务验证')
    const remote = await this.platform('/' + job.slug, expected)
    scope.assertCurrent()
    if (remote.status !== 'running' || remote.app_url !== job.url || remote.current_version !== job.version) throw new Error('应用线上版本发生变化，请重新验证')
    if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error('线上制品版本发生变化')
    if (job.configFingerprint !== remote.config_fingerprint) throw new Error('应用配置已变化，请重新验证业务')
    return { job, root, signal: scope.signal }
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
      credentials: await this.credentials.read(job.id) }, invocationSignal).catch(error => {
      if (approved) throw new Error('操作结果未知，请先查询实际结果再决定下一步', { cause: error })
      throw error
    })
  }
}
