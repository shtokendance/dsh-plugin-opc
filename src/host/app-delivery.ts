import { createWriteStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFile, link, lstat, mkdir, readFile, readdir, stat, writeFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { followsDeploymentAttempt, type DeploymentAttemptProgress } from '../deployment-attempt.ts'
import type { OpcCore } from './core.ts'
import { identityHash } from './context.ts'
import { DEFAULT_APP_DOMAIN_ROOT } from './opc-config.ts'
import { resetPythonResolutionCache, resolvePythonInterpreter, workerEnv } from './python-runtime.ts'
import { ConfigChat } from './config-chat.ts'
import type { ConfigChatResult } from '../config-chat.ts'

export const ROLLBACK_NOTICE = '回滚恢复代码与运行配置，不自动回退数据库/卷中的业务数据；旧代码和新数据兼容性仍需验证。'
export type AppDocument = Record<string, any>
export interface DeliveryAssessment {
  phase: 'build' | 'runtime'
  outcome: 'passed' | 'failed'
  report: string
  evidence: string[]
}
export interface DeliveryAssessmentRun {
  phase: DeliveryAssessment['phase']
  result?: DeliveryAssessment
}
export interface DeliveryJob {
  id: string; name: string; slug: string; url: string; session: string
  analysisSessionId?: string
  deliveryMode?: 'initial' | 'update'
  archivedRevision?: string
  deploymentCheck?: 'domain'
  deploymentProgress?: DeploymentAttemptProgress
  assessment?: DeliveryAssessment
  assessmentPending?: boolean
  analysisSessions?: string[]
  autoPrepared?: boolean
  port?: number; portAuto?: boolean; description?: string; upgrade?: boolean; versionNote?: string
  status: 'importing' | 'draft' | 'analyzing' | 'review' | 'preparing' | 'ready' | 'publishing' | 'building' | 'verifying' | 'awaiting_page_verification' | 'verified' | 'failed' | 'unknown' | 'cancelled'
  events: string[]; error?: string; proposal?: AppDocument; revision?: string; failedRevision?: string
  revisionCount?: number; feedbackHistory?: string; analysisMode?: 'analysis' | 'repair'
  analysisFailure?: string
  deploymentLogRevision?: string
  failureStage?: 'import' | 'analysis' | 'preparation' | 'deployment' | 'verification'
  restoredVersion?: boolean
  conversation?: { role: 'user' | 'assistant'; text: string; revision?: number }[]
  discoveryReport?: AppDocument; transformationReport?: AppDocument; preparationChecks?: AppDocument[]
  diffs?: Record<string, string>; hasOriginalKeys?: string[]; skillMarkdown?: string; dockerfileContent?: string
  hashes?: Record<string, string>; version?: number; requestId?: string
  modelSelection?: { provider: string; model: string; reasoningEffort?: string }
  confirmationToken?: string
  checks?: AppDocument[]; published?: boolean; failureContext?: string; configFingerprint?: string
  generatedConfigKeys?: string[]
  configDraft?: { artifactHash: string; protectedOnly?: boolean; rows: { key: string; resource_id?: string; resource_key?: string; local_connection_confirmed?: boolean; has_value?: boolean; value_source?: string; secret?: boolean }[]; versionNote: string; storageBindings?: Record<string, string> }
  configKeys?: string[]; resourceIds?: string[]; failedSnapshot?: AppDocument; pagesVerified?: boolean; superseded?: boolean; createdAt?: number
}

export function analysisQuestions(proposal?: AppDocument): string[] {
  const pendingAccount = proposal?.adminAccountPending
    ? [`请${proposal?.contract?.admin_account?.mode === 'create' ? '设置' : '填写已有的'}管理员账号和密码，直接在当前对话回复「账号：…」和「密码：…」（可分两行或同行用空格隔开）。`]
    : []
  return [...new Set<string>([...pendingAccount, ...(proposal?.unresolved ?? []), ...(proposal?.contract?.unresolved ?? [])])]
}

type AdminReply = { profile: string; mode: 'create' | 'existing'; username: string; password: string }

export function readAdminReply(plan: AppDocument, text: string): AdminReply | undefined {
  let username = text.match(/^\s*(?:[-*•]\s*)?(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+)$/im)?.[1]?.trim()
  let password = text.match(/^\s*(?:[-*•]\s*)?(?:密码|password)\s*[：:=]\s*([^\r\n]+)$/im)?.[1]?.trim()
  if (!username || !password) {
    const userFirst = text.match(/(?:^|[\s,，;；])(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+?)[\s,，;；]+(?:密码|password)\s*[：:=]\s*([^\r\n]+)/i)
    const passFirst = userFirst ? undefined : text.match(/(?:^|[\s,，;；])(?:密码|password)\s*[：:=]\s*([^\r\n]+?)[\s,，;；]+(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+)/i)
    if (userFirst) {
      username = userFirst[1].replace(/[,，;；]+$/, '').trim()
      password = userFirst[2].trim()
    } else if (passFirst) {
      password = passFirst[1].replace(/[,，;；]+$/, '').trim()
      username = passFirst[2].trim()
    }
  }
  if (!username || !password || username.length > 4096 || password.length > 4096 || /\0/.test(username + password)) return undefined
  return { profile: plan.profile, mode: plan.mode, username, password }
}

function appendAnalysisFeedback(job: DeliveryJob, text: string) {
  job.conversation = [...(job.conversation ?? []), { role: 'user', text, revision: job.revisionCount }]
  job.feedbackHistory = job.feedbackHistory
    ? `${job.feedbackHistory}\n\n本次补充（有冲突时以本次为准）：\n${text}`
    : text
}
type CredentialStore = {
  read(id: string): Promise<Record<string, string>>
  write(id: string, values: Record<string, string>): Promise<void>
}
function matchesReceipt(log: unknown, hashes?: Record<string, string>) {
  return !!hashes?.['app.tar'] && !!hashes['skill.zip'] && typeof log === 'string' &&
    log.includes(`[Artifact] app.tar:${hashes['app.tar']}\n`) &&
    log.includes(`[Artifact] skill.zip:${hashes['skill.zip']}\n`) &&
    (!hashes['delivery.json'] || log.includes(`[Artifact] delivery.json:${hashes['delivery.json']}\n`))
}

function checkPublishReceipt(job: DeliveryJob, receipt: AppDocument) {
  if (receipt.request_id && receipt.request_id !== job.requestId) throw new Error('发布回执请求号不一致')
  if (receipt.app_url && receipt.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
  if ((receipt.app_tar_sha256 && receipt.app_tar_sha256 !== job.hashes?.['app.tar']) ||
      (receipt.skill_zip_sha256 && receipt.skill_zip_sha256 !== job.hashes?.['skill.zip']) ||
      (job.hashes?.['delivery.json'] && receipt.delivery_plan_sha256 !== job.hashes['delivery.json'])) {
    throw new Error('发布回执制品摘要不一致')
  }
  if (Object.hasOwn(receipt, 'published_version') &&
      (!Number.isSafeInteger(receipt.published_version) || receipt.published_version < 0 ||
        (receipt.status === 'running' && receipt.published_version !== receipt.version))) throw new Error('发布回执正式版本无效')
  if (['accepted', 'building', 'built', 'activating', 'runtime_ready', 'promoting', 'running', 'failed'].includes(receipt.status) &&
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

function isExampleConfigPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const suffixRe = /(?:^|[._-])(?:example|sample|template)$/
  return suffixRe.test(base) || suffixRe.test(stem)
}

export function isSensitiveConfigKey(key: string): boolean {
  return /password|passwd|secret|token|credential|api.?key|private.?key|dsn|connection.?string/i.test(key)
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const fingerprint = (value: unknown) => hash(JSON.stringify(value))
export function contains(actual: any, expected: any): boolean {
  if (expected === undefined) return false
  if (Array.isArray(expected)) return Array.isArray(actual) && (expected.length ? expected.every(e => actual.some(a => contains(a, e))) : !actual.length)
  if (expected && typeof expected === 'object') return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => contains(actual[k], v))
  return actual === expected
}

const workerQueues = new Map<string, Promise<void>>()

async function serializeByRoot<T>(rootKey: string | undefined, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  if (!rootKey) return fn()
  const resolved = resolve(rootKey)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const previous = workerQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolveGate => { release = resolveGate })
  const tail = previous.catch(() => {}).then(() => gate)
  workerQueues.set(key, tail)
  void tail.finally(() => {
    if (workerQueues.get(key) === tail) workerQueues.delete(key)
  })
  try {
    if (signal) {
      signal.throwIfAborted()
      let onAbort: (() => void) | undefined
      try {
        await Promise.race([
          previous.catch(() => {}),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
            signal.addEventListener('abort', onAbort, { once: true })
          }),
        ])
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort)
      }
    } else {
      await previous.catch(() => {})
    }
    signal?.throwIfAborted()
    return await fn()
  } finally {
    release()
  }
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES'])
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(src, dest)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (process.platform === 'win32' && code && retryable.has(code) && attempt < 6) {
        await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
}

/** Each helper runs as a short-lived process with only the plugin's protocol on stdin. */
export async function worker(input: AppDocument, signal?: AbortSignal): Promise<any> {
  const rootKey = typeof input?.root === 'string' && input.root ? input.root : undefined
  return serializeByRoot(rootKey, signal, async () => {
    const path = fileURLToPath(new URL('../../runtime/worker.py', import.meta.url))
    // Bundled Host entry lives in lib/index.js; source tests live in src/host/.
    const runtime = import.meta.url.endsWith('/lib/index.js') ? fileURLToPath(new URL('../runtime/worker.py', import.meta.url)) : path
    const python = await resolvePythonInterpreter({ signal })
    return new Promise((resolve, reject) => {
      const child = spawn(python.command, [...python.prefixArgs, '-I', '-B', '-X', 'utf8', runtime], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: workerEnv(),
        signal,
        timeout: 120_000,
        windowsHide: true,
      })
      let stdout = '', stderr = '', exceeded = false
      const outputLimit = ['assemble_proposal', 'validate', 'bundle'].includes(input.action) ? 64_000_000 : 8_000_000
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', data => { stdout += data; if (stdout.length > outputLimit) { exceeded = true; child.kill() } })
      child.stderr.on('data', data => { if (stderr.length < 2000) stderr += data })
      child.on('error', error => {
        if (error.message.includes('ENOENT')) resetPythonResolutionCache()
        reject(new Error(error.message.includes('ENOENT') ? '需要 Python 3.9 或以上版本：请安装后重新打开 DSH。原项目未改动。' : error.message))
      })
      child.on('close', (code, closeSignal) => {
        if (exceeded) return reject(new Error('分析输出超过限制，请缩小读取范围'))
        try { const result = JSON.parse(stdout); if (!result.ok) throw new Error(result.error); resolve(result.value) }
        catch (error) {
          if (stdout) {
            reject(new Error(error instanceof Error ? error.message : String(error)))
            return
          }
          const trimmedStderr = stderr.trim().slice(0, 500)
          const detail = trimmedStderr
            ? `：${trimmedStderr}`
            : closeSignal
              ? `（进程被信号 ${closeSignal} 中止）`
              : code !== 0 && code !== null
                ? `（退出码 ${code}）`
                : '（未返回任何输出）'
          reject(new Error(`应用准备工具未能启动${detail}`))
        }
      })
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(input))
    })
  })
}

export class AppRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly blockingRequestId?: string) { super(message) }
}

export interface AppDeliveryOptions {
  appDomainRoot?: string
  appDefaultPort?: number
  requireSkillDelivery?: boolean
}

export class AppDelivery {
  private busy = new Set<string>()
  private analyses = new Map<string, AbortController>()
  private adminReplies = new Map<string, AdminReply>()
  private preparedProposals = new Map<string, { revision: string; proposalHash: string; result: AppDocument }>()
  readonly configChat = new ConfigChat()
  attachConfigChat?: (job: DeliveryJob, expected: string, signal: AbortSignal) => Promise<void>
  analyze?: (
    job: DeliveryJob,
    root: string,
    feedback: string,
    signal: AbortSignal,
    onSessionReady: (sessionId: string) => Promise<void>,
    fromChat?: boolean,
    assessment?: DeliveryAssessmentRun,
  ) => Promise<void>
  constructor(readonly core: OpcCore, readonly home: string, private readonly credentials: CredentialStore, private options: AppDeliveryOptions = {}) {}
  getOptions(): Readonly<AppDeliveryOptions> {
    return { ...this.options }
  }
  updateOptions(next: AppDeliveryOptions): void {
    this.options = {
      ...this.options,
      ...(next.appDomainRoot !== undefined ? { appDomainRoot: next.appDomainRoot } : {}),
      ...(next.appDefaultPort !== undefined ? { appDefaultPort: next.appDefaultPort } : {}),
    }
    this.core.emit('change')
  }
  private scope(expected?: string) {
    const captured = this.core.auth.contexts.captureApplication(expected)
    const directory = join(this.home, 'opc', 'apps', identityHash(captured.context))
    return { ...captured, directory }
  }
  private async save(root: string, job: DeliveryJob) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temp = join(root, `job-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify(job), { mode: 0o600 })
      await renameWithRetry(temp, join(root, 'job.json'))
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
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
  private recordFailureState(job: DeliveryJob, errorMsg: string, extraLog?: string, remoteVersion?: number, stage: 'deployment' | 'verification' = 'deployment') {
    job.status = 'failed'
    job.failureStage = stage
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
  private async recoverInterrupted(root: string, job: DeliveryJob) {
    if (this.analyses.has(job.id)) return
    const interrupted = { importing: 'import', analyzing: 'analysis', preparing: 'preparation', verifying: 'verification' } as const
    if (job.status === 'publishing') {
      job.status = 'unknown'
      job.error = '发布结果未知，请查询状态，不要重复发布'
    } else if (job.status in interrupted) {
      if (job.status === 'verifying' && job.archivedRevision) job.assessmentPending = true
      job.failureStage = interrupted[job.status as keyof typeof interrupted]
      job.status = 'failed'
      job.error = '上次任务中断，可从当前步骤继续'
    } else return
    await this.save(root, job)
  }
  private async archivePublishedVersion(scopeDir: string, job: DeliveryJob, bundleDir: string) {
    const { slug, version, requestId, id: jobId } = job
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !version || version <= 0) return
    const verDir = join(scopeDir, 'versions', slug, `v${version}`)
    await mkdir(verDir, { recursive: true, mode: 0o700 })
    const hashes: Record<string, string> = {}
    for (const name of ['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json', 'delivery.json']) {
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
  private async applyPublishReceipt(scopeDir: string, root: string, job: DeliveryJob, receipt: AppDocument) {
    checkPublishReceipt(job, receipt)
    if (!['accepted', 'building', 'built', 'activating', 'runtime_ready', 'promoting', 'running', 'failed', 'cancelled'].includes(receipt.status)) return false
    if (receipt.progress?.phase) {
      const known = job.deploymentProgress
      job.deploymentProgress = receipt.progress.phase === 'unknown'
        ? { ...receipt.progress, last_observed_at: known?.last_observed_at,
          last_observed_phase: known?.phase === 'unknown' ? known.last_observed_phase : known?.phase }
        : { ...receipt.progress, last_observed_at: Date.now() }
    }
    job.published = true
    job.version = Object.hasOwn(receipt, 'published_version') ? receipt.published_version || undefined : receipt.version
    if (receipt.status === 'cancelled') {
      job.status = 'cancelled'
      job.error = undefined
    } else if (receipt.status === 'failed' && !followsDeploymentAttempt(job.deploymentProgress)) {
      const facts = [receipt.delivery_step && `发布阶段：${receipt.delivery_step}`,
        receipt.migration_execution && `数据库迁移回执：${receipt.migration_execution}`,
        receipt.build_log, receipt.runtime_logs].filter(Boolean).join('\n')
      job.deploymentLogRevision = undefined
      if (job.revision && /^[a-f0-9]{32}$/.test(job.revision)) {
        try {
          await writeFile(join(root, job.revision, 'failed-deployment.log'), [receipt.error_message, facts].filter(Boolean).join('\n'), { mode: 0o600 })
          job.deploymentLogRevision = job.revision
        } catch {
          job.events.push('本地未能保存完整部署日志，已保留失败摘要')
        }
      }
      this.recordFailureState(job, receipt.error_message || '部署失败', facts.slice(-8000), job.version)
    } else {
      job.status = 'building'
      job.error = undefined
      if (job.revision && job.version) {
        await this.archivePublishedVersion(scopeDir, job, join(root, job.revision, 'bundle'))
      }
    }
    return true
  }
  private async demoteOtherJobsForSlug(scopeDir: string, slug: string, activeJobId: string) {
    for (const parent of await this.directories(scopeDir)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e) && e !== activeJobId)) {
        const opened = await this.open(scopeDir, id).catch(() => undefined)
        if (opened && opened.job.slug === slug && ['verified', 'awaiting_page_verification'].includes(opened.job.status)) {
          opened.job.status = 'ready'
          opened.job.superseded = true
          opened.job.events.push('同应用已切换至其他生效版本，此历史任务技能已停用')
          await this.save(opened.root, opened.job)
        }
      }
    }
  }
  private async localJobIds(directory: string) {
    const directories = await this.directories(directory)
    const entries = (await Promise.all(directories.map(directory => readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })))).flat()
    return [...new Set(entries.filter(id => /^[a-f0-9-]{36}$/.test(id)))]
  }
  async list(expected: string) {
    const scope = this.scope(expected)
    const jobs = await Promise.all((await this.localJobIds(scope.directory)).map(async id => {
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
          await this.recoverInterrupted(root, job)
        })
      }
      if (!this.busy.has(id) && job.deploymentCheck === 'domain' && ['unknown', 'building'].includes(job.status)) {
        await this.verify(id, expected, { automatic: true }).catch(() => undefined)
        job = (await this.open(scope.directory, id)).job
      } else if (!this.busy.has(id) && ['unknown', 'building'].includes(job.status)) {
        const latestJob = await this.open(scope.directory, id)
        if (!this.busy.has(id) && latestJob.job.status === job.status && latestJob.job.requestId === job.requestId) {
          job = latestJob.job
          // List polling must not lock out explicit Verify while waiting on the network.
          try {
            if (job.requestId && (job.status === 'unknown' || !job.version)) {
              const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
              if ((job.status === 'unknown' || ['running', 'failed'].includes(receipt.status)) && !this.busy.has(id)) {
                await this.exclusive(id, async () => {
                  job = (await this.open(scope.directory, id)).job
                  if (job.status !== latestJob.job.status || job.requestId !== latestJob.job.requestId || job.version !== latestJob.job.version) return
                  if (await this.applyPublishReceipt(scope.directory, root, job, receipt)) await this.save(root, job)
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
              } else if (remote.status === 'running' && remote.current_version !== job.version && !this.busy.has(id)) {
                const history = await this.platform('/' + job.slug + '/versions', expected).catch(() => undefined)
                const attempted = history?.versions?.find((version: AppDocument) => version.version === job.version)
                if (attempted?.status === 'failed' && attempted.app_tar_sha256 === job.hashes?.['app.tar'] &&
                    attempted.skill_zip_sha256 === job.hashes?.['skill.zip']) {
                  await this.exclusive(id, async () => {
                    job = (await this.open(scope.directory, id)).job
                    if (job.status !== 'building' || job.version !== attempted.version) return
                    this.recordFailureState(job, attempted.error_message || '本次发布失败，旧版本仍在运行', attempted.build_log?.slice(-8000), job.version)
                    await this.save(root, job)
                  })
                }
              }
            }
          } catch { /* An inconclusive response leaves the current task available for status checks. */ }
        }
      }
      const view = this.public(job, root)
      if (job.status === 'verified') view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug)
      const sortAt = typeof job.createdAt === 'number'
        ? job.createdAt
        : await stat(join(root, 'job.json')).then(info => info.mtimeMs, () => 0)
      return { view, sortAt }
    }))
    scope.assertCurrent()
    return jobs
      .filter((entry): entry is { view: AppDocument; sortAt: number } => entry !== undefined)
      .sort((a, b) => {
        if (b.sortAt !== a.sortAt) return b.sortAt - a.sortAt
        const supDiff = Number(Boolean(a.view.superseded)) - Number(Boolean(b.view.superseded))
        if (supDiff !== 0) return supDiff
        return (Number(b.view.version ?? 0)) - (Number(a.view.version ?? 0))
      })
      .map(entry => entry.view)
  }
  async getJob(id: string, expected: string) {
    const scope = this.scope(expected)
    let { root, job } = await this.open(scope.directory, id)
    if (!this.busy.has(id) && ['importing', 'analyzing', 'preparing', 'verifying', 'publishing'].includes(job.status)) {
      await this.exclusive(id, async () => {
        job = (await this.open(scope.directory, id)).job
        await this.recoverInterrupted(root, job)
      })
    }
    scope.assertCurrent()
    const view = this.public(job, root)
    if (job.status === 'verified') view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug)
    return view
  }
  async getDeploymentFollowup(id: string, expected: string) {
    const scope = this.scope(expected)
    const { job } = await this.open(scope.directory, id)
    scope.assertCurrent()
    const state = job.status === 'ready' && job.superseded && job.published ? 'superseded' : job.status
    if (!['verified', 'awaiting_page_verification', 'superseded'].includes(state)) return undefined
    return { name: job.name, url: job.url, version: job.version, state }
  }
  async getJobByAnalysisSession(sessionId: string, expected: string) {
    const scope = this.scope(expected)
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) return null
    const jobs = await Promise.all((await this.localJobIds(scope.directory)).map(id =>
      this.open(scope.directory, id).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })))
    scope.assertCurrent()
    const match = jobs.find(entry => entry?.job.analysisSessions?.includes(sessionId))
    return match ? this.getJob(match.job.id, expected) : null
  }
  async checkSlug(slug: string, expected: string) {
    const trimmed = slug.trim()
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(trimmed)) throw new Error('应用唯一标识需为 3–40 位小写字母、数字或连字符，且以字母开头')
    const res = await this.platform('/check-slug', expected, { body: { slug: trimmed } })
    const configuredRoot = (this.options.appDomainRoot ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    if (configuredRoot && res?.slug) {
      res.app_url = `http://${res.slug}.${configuredRoot}`
    }
    return res
  }
  async opcConfig(expected: string) {
    this.scope(expected)
    const configuredRoot = (this.options.appDomainRoot ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    let appDomainRoot = configuredRoot
    if (!appDomainRoot) {
      try {
        const probe = await this.platform('/check-slug', expected, { body: { slug: 'app-domain-probe' } })
        if (typeof probe?.app_url === 'string' && probe.app_url.startsWith('http')) {
          const parsed = new URL(probe.app_url)
          if (parsed.host.startsWith('app-domain-probe.')) {
            appDomainRoot = parsed.host.slice('app-domain-probe.'.length)
          }
        }
      } catch {
        /* ignore fallback */
      }
    }
    const defaultPort = Number.isInteger(this.options.appDefaultPort) && this.options.appDefaultPort! >= 1 && this.options.appDefaultPort! <= 65535
      ? this.options.appDefaultPort!
      : 8080
    return {
      appDomainRoot: appDomainRoot || DEFAULT_APP_DOMAIN_ROOT,
      defaultPort,
      platformBaseUrl: this.core.auth?.http?.base?.toString()?.replace(/\/+$/, '') ?? '',
    }
  }
  public(job: DeliveryJob, root?: string): AppDocument {
    const { proposal, skillMarkdown: _sm, dockerfileContent: _df, configDraft, confirmationToken: _token, analysisSessions: _analysisSessions, autoPrepared, ...rest } = job
    const hasOrigSet = new Set(job.hasOriginalKeys ?? [])
    const generated = new Set(job.generatedConfigKeys ?? [])
    const supplied = new Map(configDraft?.rows.map(row => [row.key, row]))
    const effective = new Map<string, AppDocument>(proposal?.effective_configs?.map((row: AppDocument) => [row.key, row]))
    const runtimeConfigs = (proposal?.contract?.configs ?? []).map((c: AppDocument) => {
      const hasOrig = hasOrigSet.has(c.key) && Boolean(c.source)
      const resolved = effective.get(c.key)
      const isExample = typeof c.source?.path === 'string' && isExampleConfigPath(c.source.path)
      return {
        key: c.key,
        value: resolved && !resolved.resource_id ? resolved.value : c.resource_id ? '' : (c.value ?? c.default ?? ''),
        effective_value: resolved?.resource_id ? resolved.value : undefined,
        resource_id: resolved ? resolved.resource_id : c.resource_id,
        resource_key: resolved ? resolved.resource_key : c.resource_key,
        app_default: typeof c.app_default === 'string' ? c.app_default : '',
        description: c.description ?? '',
        required: Boolean(c.required),
        secret: Boolean(c.secret),
        has_value: hasOrig || generated.has(c.key) || Boolean(resolved?.value || c.value || c.default || c.resource_id) ||
          Boolean(c.value_plan?.kind === 'input' && supplied.get(c.key)?.has_value),
        ...(c.value_plan?.kind === 'input' ? { needs_user_input: true } : {}),
        has_original_value: hasOrig,
        ...(isExample ? { is_example_source: true } : {}),
        value_source: resolved?.value_source ?? (c.resource_id ? 'resource' : generated.has(c.key) ? 'generated' : hasOrig ? 'original' : 'manual'),
        source_label: c.source?.path ? `${isExample ? '示例模板参考' : '来自原项目'} ${c.source.path}` : undefined,
      }
    })
    const artifactFiles = job.hashes && job.revision && /^[a-z0-9]+$/i.test(job.revision)
      ? Object.fromEntries(['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json', 'delivery.json']
        .filter(name => name in job.hashes! || name === 'summary.json')
        .map(name => [name, root ? join(root, job.revision!, 'bundle', name) : join(job.revision!, 'bundle', name)]))
      : undefined
    const artifactHash = job.hashes ? fingerprint(job.hashes) : undefined
    return {
      ...rest,
      analysisChatStarting: !job.analysisSessionId && this.analyses.has(job.id),
      analysisChatActive: Boolean(job.analysisSessionId && this.analyses.has(job.id) && ['analyzing', 'review'].includes(job.status)),
      model: job.modelSelection?.model ?? '',
      reasoning_effort: job.modelSelection?.reasoningEffort ?? '',
      revision_count: job.revisionCount,
      analysis_mode: job.analysisMode,
      analysis_failure: job.analysisFailure,
      pages_verified: job.pagesVerified,
      artifactHash,
      deploymentReviewPending: Boolean(job.status === 'ready' && autoPrepared && artifactHash && (configDraft?.protectedOnly || configDraft?.artifactHash !== artifactHash)),
      proposalHash: proposal ? fingerprint(proposal) : undefined,
      artifacts: artifactFiles,
      runtime_configs: runtimeConfigs,
      verification: {
        status: job.status === 'verified'
          ? (job.checks?.some(check => check.operation === 'deployment_domain') ? 'deployment-domain-confirmed'
            : job.pagesVerified ? 'verified-deployed-page' : 'verified-deployed-api')
          : job.status === 'awaiting_page_verification'
          ? 'awaiting_page_verification'
          : job.status === 'failed' ? 'failed' : '',
        checks: (job.checks ?? []).map((c: AppDocument) => ({ operation: c.operation, status: c.status, passed: true })),
        pages_verified: Boolean(job.pagesVerified),
      },
      proposal: proposal && {
        delivery_format: proposal.delivery_format,
        readiness: proposal.readiness,
        summary: proposal.summary,
        issues: proposal.issues ?? [],
        unresolved: analysisQuestions(proposal),
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
          data_plan: proposal.contract.data_plan,
          runtime: proposal.contract.runtime,
          build_inputs: proposal.contract.build_inputs,
          health: proposal.contract.health,
          configs: (proposal.contract.configs ?? []).map((c: AppDocument) => ({
            ...c,
            default: c.default,
            has_original_value: hasOrigSet.has(c.key) || Boolean(c.has_original_value),
          })),
          resources: proposal.contract.resources ?? [],
          storage_mounts: proposal.contract.storage_mounts ?? [],
          verification_credential_fields: verificationCredentialFields(proposal.contract),
          has_embedded_admin: Boolean(job.skillMarkdown?.includes('<!-- opc-admin-login -->')),
          verification: proposal.contract.verification,
          apis: proposal.contract.apis?.map(({ id, purpose, method, path, auth, effect }: AppDocument) => ({ id, purpose, method, path, auth, effect })),
          pages: proposal.contract.pages?.map(({ purpose, path, actions }: AppDocument) => ({ purpose, path, actions })),
        },
      },
    }
  }
  async platform(path: string, expected: string, options: { method?: string; body?: unknown; form?: FormData; query?: Record<string, string>; download?: boolean; stream?: boolean; signal?: AbortSignal } = {}): Promise<any> {
    if (!/^\/(?:check-slug|resources|dockerfile-templates|publish|deliveries|backups(?:\/[A-Za-z0-9_-]+(?:\/download)?)?|[a-z][a-z0-9-]*(?:\/(?:logs|versions(?:\/[0-9]+\/artifacts\/(?:app\.tar|skill\.zip|Dockerfile|manifest\.json|delivery\.json|confirmed-deployment\.json))?|deliveries(?:\/[a-f0-9-]+\/artifacts\/(?:app\.tar|skill\.zip|delivery\.json))?|database-schema|storage(?:\/backups?)?|recheck|verify|rollback|migrate-data|config|config-values|runtime-management|requests\/[A-Za-z0-9_-]+(?:\/(?:assessment|rehearsal|probe|cancel))?))?)?$/.test(path)) throw new Error('不支持的应用操作')
    const scope = this.scope(expected)
    const token = await this.core.auth.token(); scope.assertCurrent()
    const url = new URL('/integration/v1/apps' + (path === '/' ? '' : path), this.core.auth.http.base)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    const response = await fetch(url, { method: options.method ?? (options.body || options.form ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${token}`, ...(options.form ? {} : { 'Content-Type': 'application/json' }) },
      body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined), redirect: 'error',
      signal: AbortSignal.any([scope.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(
        path.endsWith('/rollback') ? 660_000 : (path.endsWith('/storage/backup') || path.endsWith('/storage/backups')) ? 600_000 : options.form ? 180_000 : 30_000,
      )]) })
    scope.assertCurrent()
    if (response.ok && options.stream) return response
    if (response.status === 404 && ['/', '/check-slug', '/resources'].includes(path)) throw new AppRequestError(404, '测试服尚未启用企业应用部署接口，需要发布配套 Platform 版本')
    const contentType = response.headers.get('content-type') ?? ''
    if (response.ok && (options.download || path.endsWith('/skill.zip') || (path.endsWith('/app.tar') && !options.query?.file) || path.endsWith('/storage/backup') || contentType.includes('application/zip') || contentType.includes('application/x-tar') || contentType.includes('application/octet-stream'))) {
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
    if (!response.ok) throw new AppRequestError(response.status, result.error?.message ?? result.error ?? `应用接口 HTTP ${response.status}`,
      result.code ?? result.error?.code, result.blocking_request_id)
    return result
  }
  async create(input: AppDocument, session: string, expected: string) {
    const scope = this.scope(expected)
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(input.slug) || typeof input.name !== 'string' || !input.name.trim()) throw new Error('请填写应用名称和 3–40 位英文标识')
    let targetUrl: string
    let targetName = input.name.trim()
    const defaultPort = Number.isInteger(this.options.appDefaultPort) && this.options.appDefaultPort! >= 1 && this.options.appDefaultPort! <= 65535
      ? this.options.appDefaultPort!
      : 8080
    const portAuto = input.container_port === undefined
    let targetPort = portAuto ? defaultPort : input.container_port
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('容器端口必须为 1 至 65535 的整数')
    let targetDesc = typeof input.description === 'string' ? input.description.trim() : ''
    let defaultVersionNote = ''
    const previousRecord = input.previousJobId ? await this.open(scope.directory, input.previousJobId) : undefined
    const previous = previousRecord?.job
    if (previous && previous.slug !== input.slug) throw new Error('重新导入须保持原应用标识')
    const isUpgrade = Boolean(input.upgrade || previous?.upgrade || previous?.published)
    let reusedSource: string | undefined
    if (isUpgrade) {
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
      defaultVersionNote = '应用升级'
      if (input.reuseSourceVersion !== undefined) {
        const releaseVersion = input.reuseSourceVersion
        if (!Number.isSafeInteger(releaseVersion) || releaseVersion < 1 || !previousRecord || !previous ||
            previous.version !== releaseVersion || !previous.published || !previous.revision || !previous.hashes ||
            !/^[a-z0-9]+$/i.test(previous.revision)) {
          throw new Error('本机没有对应发布版本的源码副本，请选择本地源码')
        }
        const { versions } = await this.platform(`/${input.slug}/versions`, expected)
        const archived = (Array.isArray(versions) ? versions : []).find((version: AppDocument) => version.version === releaseVersion && version.status === 'running')
        if (!archived || archived.app_tar_sha256 !== previous.hashes['app.tar'] || archived.skill_zip_sha256 !== previous.hashes['skill.zip']) {
          throw new Error('本机源码对应的制品与服务器归档不一致，请选择本地源码')
        }
        reusedSource = join(previousRecord.root, previous.revision, 'approved/source')
      }
    } else {
      const reserved = await this.checkSlug(input.slug, expected)
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
      portAuto,
      description: targetDesc,
      upgrade: isUpgrade,
      deliveryMode: isUpgrade ? 'update' : 'initial',
      versionNote: defaultVersionNote,
      createdAt: Date.now(),
      modelSelection: input.modelSelection && typeof input.modelSelection.provider === 'string' && typeof input.modelSelection.model === 'string'
        ? { provider: input.modelSelection.provider, model: input.modelSelection.model, reasoningEffort: typeof input.modelSelection.reasoningEffort === 'string' ? input.modelSelection.reasoningEffort : undefined }
        : undefined,
      feedbackHistory: previous?.feedbackHistory,
      conversation: previous?.conversation?.filter(message => message.role === 'user'),
      session,
      status: 'importing',
      events: ['正在创建源码隔离副本'],
    }
    const root = join(scope.directory, job.id)
    await this.exclusive(job.id, async () => {
      await this.save(root, job)
      try {
        let source: string
        if (reusedSource) {
          source = reusedSource
        } else if (input.zip) {
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
      } catch (error) { job.status = 'failed'; job.failureStage = 'import'; job.error = String(error) }
      await this.save(root, job)
    })
    return this.public(job, root)
  }
  async reopenReview(id: string, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.failureStage === 'deployment' && job.deploymentProgress && !job.deploymentProgress.retry_safe) {
        throw new Error('请先确认本次部署已结束并完成清理')
      }
      if (!['ready', 'awaiting_page_verification', 'failed'].includes(job.status) || !job.proposal) throw new Error('当前状态无法返回改造方案核对')
      let validationError: string | undefined
      if (job.status === 'ready' && job.proposal.delivery_format === 1) {
        try {
          await worker({ action: 'validate_deployment_scope', root, proposal: job.proposal }, scope.signal)
        } catch (error) {
          scope.assertCurrent()
          validationError = error instanceof Error ? error.message : String(error)
        }
      }
      job.analysisFailure = validationError
      job.status = validationError ? 'failed' : 'review'
      if (validationError) job.failureStage = 'analysis'
      if (job.proposal.contract.admin_account && !job.proposal.contract.admin_account.source && !job.skillMarkdown && !this.adminReplies.has(id)) {
        job.proposal.adminAccountPending = true
      }
      job.confirmationToken = undefined
      job.error = validationError
      job.events.push(validationError ? '交付声明未通过校验，可在原分析会话继续修正' : '已返回改造方案核对阶段')
      await this.save(root, job)
      this.core.emit('skills-changed')
      return this.public(job, root)
    })
  }
  async reopenDeployment(id: string, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (!['failed', 'cancelled'].includes(job.status) || !job.published || !job.revision || !job.hashes || !job.proposal) {
        throw new Error('当前任务没有可重新部署的失败版本')
      }
      if (job.deploymentProgress && job.requestId) {
        const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
        checkPublishReceipt(job, receipt)
        if (receipt.progress?.retry_safe !== true) throw new Error('请等平台确认上一轮已结束并完成清理，再重试')
      }
      const remote = await this.platform(`/${job.slug}`, expected)
      if (remote.can_manage !== true || remote.app_url !== job.url) throw new Error('没有权限重新部署此应用，或应用地址已变化')
      const saved = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {}
      const config: AppDocument[] = saved.rows ? JSON.parse(saved.rows) : Array.isArray(remote.app_config) ? remote.app_config : []
      const declarations: AppDocument[] = job.proposal.contract.configs ?? []
      const allConfigs = [...declarations, ...config.filter(row => !declarations.some(declared => declared.key === row.key))]
      const rows = allConfigs.map(declared => {
        const existing = config.find(row => row.key === declared.key)
        return { key: declared.key, resource_id: existing?.resource_id, resource_key: existing?.resource_key, local_connection_confirmed: existing?.local_connection_confirmed === true,
          value_source: existing?.value_source, has_value: existing?.has_value, secret: declared.secret === true,
          value: existing?.resource_id ? '' : (existing?.value ?? (declared.secret ? '' : declared.default) ?? '') }
      })
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map((row: AppDocument) => [row.key, row.value])))
      scope.assertCurrent()
      const priorBindings = job.configDraft?.storageBindings ?? {}
      const existingMounts: AppDocument[] = Array.isArray(remote.storage_mounts) ? remote.storage_mounts : []
      const storageBindings: Record<string, string> = {}
      for (const mount of (job.proposal.contract.storage_mounts ?? []) as AppDocument[]) {
        const path = mount.container_path
        const fromDraft = typeof path === 'string' ? priorBindings[path] : undefined
        const fromRemote = typeof path === 'string'
          ? existingMounts.find(old => old.container_path === path)?.resource_id
          : undefined
        if (typeof fromDraft === 'string' && fromDraft) storageBindings[path] = fromDraft
        else if (typeof fromRemote === 'string' && fromRemote) storageBindings[path] = fromRemote
      }
      job.configDraft = {
        artifactHash: fingerprint(job.hashes),
        rows: rows.map(({ value: _value, ...row }) => row),
        versionNote: job.configDraft?.versionNote ?? job.versionNote ?? '',
        ...(Object.keys(storageBindings).length > 0 ? { storageBindings } : {}),
      }
      job.confirmationToken = undefined
      job.status = 'ready'
      if (!job.deploymentProgress && job.published) job.upgrade = true
      job.deploymentProgress = undefined
      job.published = undefined
      job.superseded = undefined
      job.events.push('已恢复失败版本的交付包和运行配置，请核对后重新部署')
      await this.save(root, job)
      return this.public(job, root)
    })
  }
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error('任务正在执行，请稍候')
    this.busy.add(id)
    try { return await fn() } finally { this.busy.delete(id) }
  }
  async startAnalysis(id: string, feedback: string, expected: string, session?: string, options?: { mode?: 'analysis' | 'repair' | 'resume'; fromChat?: boolean; onChatReady?: () => void }) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.failureStage === 'deployment' && job.deploymentProgress && !job.deploymentProgress.retry_safe) {
      throw new Error('请先确认本次部署已结束并完成清理')
    }
    if (!this.analyze) throw new Error('此 DSH 版本未提供应用分析所需的 Agent 扩展')
    if (this.busy.has(id) || ['building', 'publishing', 'unknown'].includes(job.status)) throw new Error('请先完成当前部署状态核对')
    if (job.assessmentPending && job.archivedRevision && options?.fromChat) {
      return this.exclusive(id, () => this.advancePreparedDelivery(root, job, expected, options.onChatReady))
    }
    const resume = options?.mode === 'resume'
    const waitingForReply = resume && job.status === 'review' && analysisQuestions(job.proposal).length > 0
    const editing = options?.fromChat && ['review', 'ready'].includes(job.status)
    if (resume && ((!waitingForReply && !editing && !['failed', 'cancelled'].includes(job.status)) || feedback.trim())) throw new Error('只能继续已暂停的应用准备')
    this.busy.add(id)
    if (session && !job.analysisSessionId && !job.analysisSessions?.includes(session)) job.session = session
    let trimmedFeedback: string
    try {
      trimmedFeedback = feedback.slice(0, 20_000)
    } catch (error) {
      this.busy.delete(id)
      throw error
    }
    const controller = new AbortController()
    const analysisSignal = AbortSignal.any([scope.signal, controller.signal])
    this.analyses.set(id, controller)
    if (resume && job.failureStage === 'preparation') job.analysisFailure ??= job.error
    if (!resume && job.status !== 'failed') {
      job.analysisFailure = undefined
      if (!job.proposal) await rm(join(root, 'draft_files.json'), { force: true }).catch(() => {})
    }
    if (!resume && (options?.mode === 'repair' || (job.revision && (job.published || job.status === 'failed')))) {
      job.analysisMode = 'repair'
      job.failedRevision = job.revision || job.failedRevision
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
    } else if (!resume) {
      job.analysisMode = job.analysisMode || 'analysis'
      job.failureContext = job.error || job.failureContext
    }
    job.confirmationToken = undefined
    if (!resume) {
      job.revisionCount = (job.revisionCount ?? 0) + 1
      if (trimmedFeedback.trim()) appendAnalysisFeedback(job, trimmedFeedback.trim())
    }
    job.status = waitingForReply ? 'review' : 'analyzing'
    job.failureStage = undefined
    job.error = undefined
    job.checks = undefined
    job.events.push(
      waitingForReply
        ? '正在恢复左侧分析会话'
        : resume
          ? '🔄 正在继续准备应用'
          : job.analysisMode === 'repair'
            ? '🔧 AI 正在读取失败制品与日志进行专项修复分析'
            : '🚀 AI 正在分析源码；尚未执行发布',
    )
    try {
      await rm(join(root, 'failed_files_read.json'), { force: true })
      await this.save(root, job)
    } catch (error) {
      this.analyses.delete(id)
      this.busy.delete(id)
      throw error
    }
    this.core.emit('skills-changed')
    void (async () => {
      try {
        await this.analyze!(job, root, trimmedFeedback, analysisSignal, async sessionId => {
          analysisSignal.throwIfAborted()
          scope.assertCurrent()
          const analysisSessions = [...(job.analysisSessions ?? []).filter(id => id !== sessionId), sessionId]
          await this.save(root, { ...job, analysisSessions, analysisSessionId: sessionId })
          job.analysisSessions = analysisSessions
          job.analysisSessionId = sessionId
          options?.onChatReady?.()
        }, options?.fromChat)
        analysisSignal.throwIfAborted()
        scope.assertCurrent()
        if (!job.proposal || job.status === 'analyzing') throw new Error('AI 未提交有效改造方案，请补充说明后重试')
        if (job.analysisSessionId && job.status === 'review' && !analysisQuestions(job.proposal).length) {
          await this.prepareJob(root, job, analysisSignal, scope.assertCurrent, expected, true)
        }
      } catch (error) {
        const msg = controller.signal.aborted
          ? '用户取消分析'
          : error instanceof Error ? error.message : String(error)
        job.status = controller.signal.aborted ? 'cancelled' : 'failed'
        if (!controller.signal.aborted) job.failureStage = 'analysis'
        job.error = msg
        if (!controller.signal.aborted && !job.analysisFailure) job.analysisFailure = msg
      }
      try { await this.save(root, job) } finally {
        const unused = this.preparedProposals.get(id)
        this.preparedProposals.delete(id)
        if (unused) await rm(join(root, unused.revision), { recursive: true, force: true }).catch(() => {})
        if (job.status !== 'review' || !job.proposal?.adminAccountPending) this.adminReplies.delete(id)
        this.analyses.delete(id)
        this.busy.delete(id)
        options?.onChatReady?.()
        this.core.emit('change')
      }
    })().catch(() => {})
    return this.public(job, root)
  }
  async recordAnalysisReply(job: DeliveryJob, root: string, text: string, signal: AbortSignal) {
    if (job.status !== 'analyzing' && job.status !== 'review') throw new Error('当前应用准备阶段无法接收回复')
    const account = job.proposal?.contract?.admin_account
    const adminReply = job.proposal?.adminAccountPending && account ? readAdminReply(account, text) : undefined
    const proposalWithAccount = adminReply && job.proposal
      ? { ...job.proposal, adminAccountPending: false } : undefined
    if (job.status === 'review' && adminReply && proposalWithAccount && !analysisQuestions(proposalWithAccount).length) {
      const next: DeliveryJob = {
        ...job, proposal: proposalWithAccount, analysisFailure: undefined,
        events: [...job.events, '已收到管理员账密，继续生成交付包'],
      }
      signal.throwIfAborted()
      // Credentials live in memory until packaging. If the host restarts
      // before then, the saved review can still ask for them again.
      await this.save(root, { ...next, proposal: job.proposal })
      this.adminReplies.set(job.id, adminReply)
      Object.assign(job, next)
      return ''
    }
    const reply: string = adminReply
      ? '用户已经在当前对话提供管理员账号和密码。保留上一版 admin_account 认证方案与实际存储位置并重新提交，OPC 会把账密写入应用和技能。'
      : text.slice(0, 20_000)
    signal.throwIfAborted()
    const next: DeliveryJob = {
      ...job,
      status: 'analyzing',
      revisionCount: (job.revisionCount ?? 0) + 1,
      analysisFailure: undefined,
      events: [...job.events, '已收到左侧会话的回复，AI 继续改造'],
    }
    appendAnalysisFeedback(next, reply.trim())
    await this.save(root, next)
    if (adminReply) this.adminReplies.set(job.id, adminReply)
    Object.assign(job, next)
    return reply
  }
  async cancelAnalysis(id: string, expected: string) {
    const scope = this.scope(expected)
    await this.open(scope.directory, id)
    scope.assertCurrent()
    const controller = this.analyses.get(id)
    if (!controller) throw new Error('当前没有可取消的分析')
    controller.abort()
  }

  async *watchConfigChat(id: string, artifact: string, session: string, expected: string, signal: AbortSignal): AsyncIterable<string> {
    const scope = this.scope(expected)
    const reviewSignal = AbortSignal.any([signal, scope.signal])
    const verify = async () => {
      const { job } = await this.open(scope.directory, id)
      reviewSignal.throwIfAborted()
      if (!session || job.analysisSessionId !== session) throw new Error('请在当前部署会话中核对配置')
      if (job.status !== 'ready' || !job.hashes || fingerprint(job.hashes) !== artifact) {
        throw new Error('交付版本已变化，请重新核对配置')
      }
      return job
    }
    const job = await verify()
    if (!this.attachConfigChat) throw new Error('当前 DSH 无法打开应用配置会话')
    const attach = this.attachConfigChat
    for await (const frame of this.configChat.connect(id, expected, async () => { await verify() },
      () => attach(job, expected, reviewSignal), reviewSignal)) {
      yield JSON.stringify(frame)
    }
  }

  async replyConfigChat(id: string, request: string, body: string, expected: string) {
    this.scope(expected).assertCurrent()
    const result = JSON.parse(body) as ConfigChatResult
    await this.configChat.reply(id, expected, request, result)
  }

  async configDraft(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.status !== 'ready') return null
    const sourceConfiguration = await worker({ action: 'source_configuration', root, values_visible: true }, scope.signal)
    const dockerfile = job.dockerfileContent ?? ''
    const authored = job.proposal?.delivery_format === 1
    const catalog = authored
      ? await this.platform('/resources', expected, { query: { slug: job.slug } })
      : undefined
    const resources = catalog?.resources
    const values = job.configDraft ? await this.credentials.read(`draft-${id}`) : {}
    const origAll = await this.credentials.read(`orig-${id}`)
    scope.assertCurrent()
    const originalValues = origAll
    if (catalog?.visible_config_values === true && Array.isArray(resources)) {
      const declarations: AppDocument[] = job.proposal?.contract?.configs ?? []
      const expectedKeys = new Set<string>(declarations.flatMap(c => [c.key, c.resource_key].filter(Boolean)))
      const requested = resources.flatMap((resource: AppDocument, index: number) =>
        (resource.env_keys ?? []).filter((key: string) => expectedKeys.has(key)).map((key: string) => ({
          key: `R${index}_${key}`, resource_id: resource.id, resource_key: key, index,
        })))
      for (let start = 0; start < requested.length; start += 256) {
        const batch = requested.slice(start, start + 256)
        const actual = await this.resolveResourceValues(job.slug, batch, expected)
        for (const entry of batch) {
          if (typeof actual[entry.key] !== 'string') continue
          const resource = resources[entry.index]
          resource.env_preview = { ...resource.env_preview, [entry.resource_key]: actual[entry.key] }
        }
      }
    }
    return {
      ...job.configDraft,
      artifactHash: fingerprint(job.hashes),
      rows: (job.configDraft?.rows ?? []).filter(row => !authored || job.proposal?.contract.configs?.some((config: AppDocument) => config.key === row.key))
        .map(row => ({ ...row, value: values[row.key] ?? '' })),
      originalValues,
      sourceConfiguration,
      dockerfile,
      resources,
    }
  }

  async saveConfigDraft(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status !== 'ready' || input.artifactHash !== fingerprint(job.hashes)) throw new Error('交付版本已变化，请重新核对配置')
      const rows = input.rows
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.key) ||
          typeof row.value !== 'string' || (row.resource_id !== undefined && typeof row.resource_id !== 'string')) ||
          new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('配置草稿格式无效')
      if (input.protectedInputs === true) {
        const declarations: AppDocument[] = job.proposal?.contract?.configs ?? []
        const allowed = new Map(declarations.filter(c => c.value_plan?.kind === 'input').map(c => [c.key, c]))
        if (!rows.length || rows.some(row => !allowed.has(row.key) || !row.value || row.value.includes('\0') || row.value.length > 16384)) {
          throw new Error('表单只接收当前提案声明的待填写配置')
        }
        const priorValues = job.configDraft ? await this.credentials.read(`draft-${id}`) : {}
        await this.credentials.write(`draft-${id}`, { ...priorValues, ...Object.fromEntries(rows.map(row => [row.key, row.value])) })
        scope.assertCurrent()
        const priorRows = (job.configDraft?.rows ?? []).filter(row => !rows.some(inputRow => inputRow.key === row.key))
        job.configDraft = {
          artifactHash: input.artifactHash,
          protectedOnly: job.configDraft?.protectedOnly || job.configDraft?.artifactHash !== input.artifactHash,
          rows: [...priorRows, ...rows.map(row => ({ key: row.key, has_value: true, value_source: 'manual', secret: Boolean(allowed.get(row.key)?.secret) }))],
          versionNote: job.configDraft?.versionNote ?? job.versionNote ?? '',
          storageBindings: job.configDraft?.storageBindings,
        }
        job.confirmationToken = undefined
        await this.save(root, job)
        return
      }
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map(row => [row.key, row.value])))
      scope.assertCurrent()
      job.configDraft = {
        artifactHash: input.artifactHash,
        rows: rows.map(row => ({
          key: row.key,
          resource_id: row.resource_id,
          resource_key: row.resource_key,
          local_connection_confirmed: row.local_connection_confirmed === true,
          has_value: row.has_value === true || Boolean(row.value),
          ...(row.value_source === 'original' || row.value_source === 'manual' || row.value_source === 'resource' || row.value_source === 'configured' || row.value_source === 'generated'
            ? { value_source: row.value_source } : {}),
          ...(row.secret === true ? { secret: true } : {}),
        })),
        storageBindings: readStorageBindings(input.storageBindings),
        versionNote: typeof input.versionNote === 'string' ? input.versionNote.slice(0, 1024) : '',
      }
      job.confirmationToken = undefined
      await this.save(root, job)
    })
  }

  async localArtifact(id: string, filename: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (!['ready', 'building', 'verifying', 'awaiting_page_verification', 'verified', 'failed'].includes(job.status) ||
        !job.revision || !/^[a-z0-9]+$/i.test(job.revision) ||
        !['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json', 'delivery.json'].includes(filename)) throw new Error('当前交付文件不可用')
    const path = join(root, job.revision, 'bundle', filename)
    const size = (await stat(path)).size
    if (size > 64 * 1024 * 1024) throw new Error('文件超过插件下载上限 64 MiB')
    const bytes = await readFile(path)
    scope.assertCurrent()
    if (filename !== 'summary.json' && hash(bytes) !== job.hashes?.[filename]) throw new Error('交付文件已发生变化')
    return { filename: `${job.slug}-${filename}`, base64: bytes.toString('base64') }
  }

  async saveLocalArtifact(id: string, filename: string, expected: string, downloads = join(homedir(), 'Downloads')) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (!['ready', 'building', 'verifying', 'awaiting_page_verification', 'verified', 'failed'].includes(job.status) ||
        !job.revision || !/^[a-z0-9]+$/i.test(job.revision) ||
        !['app.tar', 'skill.zip', 'app-manifest.json', 'summary.json', 'delivery.json'].includes(filename)) throw new Error('当前交付文件不可用')
    const src = join(root, job.revision, 'bundle', filename)
    const bytes = await readFile(src)
    scope.assertCurrent()
    if (filename !== 'summary.json' && hash(bytes) !== job.hashes?.[filename]) throw new Error('交付文件已发生变化')
    await mkdir(downloads, { recursive: true, mode: 0o700 })
    const outName = `${job.slug}-${filename}`
    const temp = join(downloads, `.opc-${randomUUID()}.artifact`)
    await writeFile(temp, bytes, { mode: 0o600 })
    try {
      const preferred = join(downloads, outName)
      let dest = preferred
      try { await link(temp, dest) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        dest = join(downloads, `${randomUUID().slice(0, 8)}-${outName}`)
        await link(temp, dest)
      }
      return { filename: outName, path: dest }
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
  }

  async skillPreview(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (job.status !== 'ready' || !job.skillMarkdown || !job.hashes?.['skill.zip'] || !job.revision) throw new Error('技能尚未生成')
    const bytes = await readFile(join(root, job.revision, 'bundle', 'skill.zip'))
    scope.assertCurrent()
    const result = await worker({ action: 'extract_skill_contract', root, skill_zip_b64: bytes.toString('base64'),
      expected_sha256: job.hashes['skill.zip'], slug: job.slug, app_url: job.url }, scope.signal)
    scope.assertCurrent()
    return { markdown: result.skill_markdown, contract: result.contract, sha256: result.sha256 }
  }

  async handoff(id: string, expected: string) {
    const scope = this.scope(expected)
    const { root, job } = await this.open(scope.directory, id)
    if (!['review', 'ready', 'failed'].includes(job.status)) throw new Error('请等待改造分析结束')
    return worker({ action: 'handoff', root, job: {
      name: job.name, slug: job.slug, url: job.url, port: job.port,
      revision: job.status === 'ready' ? job.revision : undefined,
      status: job.status, proposal: this.public(job).proposal,
      failure: job.analysisFailure || job.error || '',
      update: job.deliveryMode ? job.deliveryMode === 'update' : Boolean(job.upgrade),
      revision_count: job.revisionCount ?? 1, feedback: job.feedbackHistory ?? '',
    } }, scope.signal)
  }

  private async validateProposedResources(job: DeliveryJob, contract: AppDocument, expected: string, existingMounts: AppDocument[], signal: AbortSignal) {
    const bindings: AppDocument[] = (contract.configs ?? []).filter((config: AppDocument) => config.resource_id)
    const previous = new Map(existingMounts.map(mount => [mount.container_path, mount]))
    const mounts: AppDocument[] = contract.storage_mounts ?? []
    const conflicts = mounts.filter(mount => {
      const old = previous.get(mount.container_path)
      return old && mount.resource_id && mount.resource_id !== old.resource_id
    })
    if (conflicts.length) {
      throw new Error(`以下目录已有线上挂载，请沿用其资源：${conflicts.map(mount => mount.container_path).join('、')}。`)
    }
    const newMounts = mounts.filter(mount => !previous.has(mount.container_path))
    if (!bindings.length && !newMounts.length) return

    const { resources = [] }: { resources?: AppDocument[] } = await this.platform('/resources', expected, {
      query: { slug: job.slug }, signal,
    })
    if (!Array.isArray(resources)) throw new Error('Platform 未返回有效的资源目录，请重新读取 resources。')
    const byId = new Map(resources.map(resource => [resource.id, resource]))
    const errors: string[] = []
    const readable: AppDocument[] = []
    for (const row of bindings) {
      const resource = byId.get(row.resource_id)
      if (!resource || !resource.env_keys?.includes(row.resource_key)) {
        errors.push(`配置 ${row.key} 的绑定 ${row.resource_id} / ${row.resource_key} 不在当前资源目录中。请用 resources 返回的 id 和 env_keys。`)
      } else if (resource.type !== 'minio-app-storage') {
        readable.push(row)
      }
    }
    for (const mount of newMounts) {
      const resource = byId.get(mount.resource_id)
      if (!resource || !['local-directory', 'docker-volume', 'aliyun-oss-volume'].includes(resource.type)) {
        errors.push(`新增挂载 ${mount.container_path} 需要在 storage_mounts.resource_id 填写已核对的卷资源。请用 resources 查看可用卷并优先核对兼容的默认卷。`)
      } else if (mount.kind === 'sqlite' && resource.type === 'aliyun-oss-volume') {
        errors.push(`SQLite 挂载 ${mount.container_path} 需要使用本地磁盘卷。`)
      }
    }
    if (errors.length) throw new Error(errors.join('\n'))
    const values = await this.resolveResourceValues(job.slug, readable, expected, signal)
    const missing = readable.filter(row => typeof values[row.key] !== 'string' || !values[row.key])
    if (missing.length) {
      throw new Error(`平台资源未提供配置值：${missing.map(row => row.key).join('、')}。请核对 config_values，再提交可用绑定或说明实际阻塞。`)
    }
  }

  private keepUnchangedResourceDraft(job: DeliveryJob, contract: AppDocument) {
    const draft = job.configDraft
    if (!draft) return
    const previous = job.proposal?.contract
    const resource = (row?: AppDocument) => row?.resource_id ? [row.resource_id, row.resource_key || row.key].join('/') : undefined
    const previousConfigs = new Map<string, AppDocument>((previous?.configs ?? []).map((row: AppDocument) => [row.key, row]))
    const nextConfigs = new Map<string, AppDocument>((contract.configs ?? []).map((row: AppDocument) => [row.key, row]))
    draft.rows = draft.rows.filter(row => {
      const chosen = resource(nextConfigs.get(row.key))
      return !chosen || chosen === resource(previousConfigs.get(row.key)) || chosen === resource(row)
    })
    const previousMounts = new Map<string, string>((previous?.storage_mounts ?? []).map((mount: AppDocument) => [mount.container_path, mount.resource_id]))
    for (const mount of (contract.storage_mounts ?? []) as AppDocument[]) {
      if (draft.storageBindings && mount.resource_id && mount.resource_id !== previousMounts.get(mount.container_path)) {
        delete draft.storageBindings[mount.container_path]
      }
    }
  }

  async submit(job: DeliveryJob, root: string, proposal: AppDocument, signal: AbortSignal, options?: {
    dockerfileOnly: boolean
    resourceReview?: { contextId: string; existingMounts: AppDocument[] }
  }) {
    if (proposal.contract?.slug !== job.slug || proposal.contract?.base_url !== job.url) throw new Error('应用标识或地址与导入时不一致')
    if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    if (!Array.isArray(proposal.unresolved) || (proposal.contract.unresolved !== undefined && !Array.isArray(proposal.contract.unresolved))) {
      throw new Error('unresolved 必须为数组')
    }
    const account = proposal.contract.admin_account
    const adminReply = this.adminReplies.get(job.id)
    if (adminReply && (!account || account.profile !== adminReply.profile || account.mode !== adminReply.mode)) {
      throw new Error('用户已提交管理员账密，请保留原方案的 admin_account 及对应登录方式')
    }
    if ((job.upgrade || job.published) && account?.mode === 'create') throw new Error('已有部署请使用应用现有账号，改造副本不能替换线上账号')
    const previousLogin = job.skillMarkdown?.match(/^<!-- opc-admin-login -->\n```json\n([^\r\n]+)\n```$/m)?.[1]
    const canReusePrevious = previousLogin && !job.failedSnapshot?.verificationError && job.proposal?.contract?.admin_account?.profile === account?.profile &&
      job.proposal?.contract?.admin_account?.mode === account?.mode
    const adminAccountPending = Boolean(account && !account.source && !adminReply && !canReusePrevious)
    const hasQuestions = Boolean(proposal.unresolved.length || proposal.contract.unresolved?.length)
    if (!hasQuestions) {
      const expectedPort = job.port ?? 8080
      const actualPort = proposal.contract.runtime?.port
      const field = '交付契约 runtime.port'
      if (actualPort == null) {
        throw new Error(job.portAuto
          ? `${field} 缺失。请补全 runtime.port（1–65535 整数，优先填应用默认端口，无默认端口时填 ${expectedPort}）`
          : `${field} 缺失。请补全 runtime 并填写已锁定的数字 ${expectedPort}`)
      }
      if (!Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65535) {
        throw new Error(`${field} 必须是 1 至 65535 的整数`)
      }
      if (!job.portAuto && actualPort !== expectedPort) throw new Error(`${field} 填了 ${actualPort}，与已锁定的容器端口 ${expectedPort} 不一致。模型不能静默改变用户选择的容器端口`)
    }
    const allowUnresolved = hasQuestions || adminAccountPending
    // A complete AI proposal can keep its validated artifacts for the review
    // step. Blocked proposals need only validation until the user can continue.
    const preparedRevision = options?.dockerfileOnly && !allowUnresolved && proposal.config_format !== 1 ? randomUUID().replaceAll('-', '') : undefined
    const validated = await worker({
      action: preparedRevision ? 'bundle' : 'validate',
      revision: preparedRevision,
      root,
      proposal,
      allow_unresolved: allowUnresolved,
      dockerfile_only: options?.dockerfileOnly === true,
      reuse_source_admin: !job.upgrade && !job.published && !adminReply && !canReusePrevious,
      admin_reply: adminReply,
      previous_skill_markdown: canReusePrevious ? job.skillMarkdown : undefined,
      repair: Boolean(job.failedRevision),
      failed_revision: job.failedRevision ?? '',
      failure_feedback: job.failureContext ?? '',
      revision_count: job.revisionCount ?? 1,
      feedback: job.feedbackHistory ?? '',
      expected_port: job.portAuto ? null : (job.port ?? 8080),
    }, signal).catch(async error => {
      if (preparedRevision) await rm(join(root, preparedRevision), { recursive: true, force: true }).catch(() => {})
      throw error
    })
    const accepted = validated?.proposal ?? proposal
    if (options?.resourceReview && !allowUnresolved) {
      const { contextId, existingMounts } = options.resourceReview
      await this.validateProposedResources(job, accepted.contract, contextId, existingMounts, signal)
    }
    if (preparedRevision) {
      this.preparedProposals.set(job.id, { revision: preparedRevision, proposalHash: fingerprint(validated.proposal), result: validated })
    }
    signal.throwIfAborted(); if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
    if (options?.resourceReview && !allowUnresolved) this.keepUnchangedResourceDraft(job, accepted.contract)
    job.proposal = accepted
    const validatedPort = job.proposal?.contract?.runtime?.port
    if (job.portAuto && Number.isInteger(validatedPort) && validatedPort >= 1 && validatedPort <= 65535) {
      job.port = validatedPort
    }
    if (adminAccountPending && !job.proposal!.contract.admin_account?.source) job.proposal!.adminAccountPending = true
    else delete job.proposal!.adminAccountPending
    job.discoveryReport = validated?.discovery_report ?? job.discoveryReport
    job.transformationReport = validated?.transformation_report ?? job.transformationReport
    job.diffs = validated?.diffs ?? job.diffs
    job.hasOriginalKeys = validated?.has_original_keys ?? job.hasOriginalKeys
    if (job.proposal?.summary) {
      job.conversation = [...(job.conversation ?? []), { role: 'assistant', text: job.proposal.summary, revision: job.revisionCount ?? 1 }]
    }
    job.status = 'review'
    job.analysisFailure = undefined
    job.events.push(analysisQuestions(job.proposal).length
      ? '等待你在左侧会话回复' : '改造方案已通过校验')
    await this.save(root, job)
  }
  async prepare(id: string, proposalHash: string, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      const retry = job.status === 'failed' && job.failureStage === 'preparation'
      if ((job.status !== 'review' && !retry) || !job.proposal || fingerprint(job.proposal) !== proposalHash) {
        throw new Error('方案已变化，请刷新后核对')
      }
      if (analysisQuestions(job.proposal).length) throw new Error('请先在左侧会话处理待确认事项')
      await this.prepareJob(root, job, scope.signal, scope.assertCurrent, expected)
      return this.public(job, root)
    })
  }

  private async prepareJob(root: string, job: DeliveryJob, signal: AbortSignal, assertCurrent: () => void, expected: string, autoPrepared = false, confirmedConfigs?: AppDocument[]) {
    job.status = 'preparing'
    job.failureStage = undefined
    job.error = undefined
    job.events.push('正在生成并检查交付包')
    await this.save(root, job)
    try {
      if (job.proposal?.config_format === 1) {
        job.proposal = { ...job.proposal, effective_configs: confirmedConfigs ?? await this.previewDeliveryConfig(job, root, expected, signal, true) }
      }
      const prepared = this.preparedProposals.get(job.id)
      const reusable = prepared && prepared.proposalHash === fingerprint(job.proposal) ? prepared : undefined
      const revision = reusable?.revision ?? randomUUID().replaceAll('-', '')
      const result = reusable?.result ?? await worker({
        action: 'bundle',
        root,
        revision,
        proposal: job.proposal,
        admin_reply: this.adminReplies.get(job.id),
        previous_skill_markdown: job.skillMarkdown,
        repair: Boolean(job.failedRevision),
        failed_revision: job.failedRevision ?? '',
        failure_feedback: job.failureContext ?? '',
        expected_port: job.portAuto ? null : (job.port ?? 8080),
        revision_count: job.revisionCount ?? 1,
        feedback: job.feedbackHistory ?? '',
      }, signal)
      signal.throwIfAborted(); assertCurrent()
      if (reusable) this.preparedProposals.delete(job.id)
      job.revision = revision
      job.hashes = result.summary.files
      job.proposal = result.proposal ?? job.proposal
      const bundledPort = job.proposal?.contract?.runtime?.port
      if (Number.isInteger(bundledPort) && bundledPort >= 1 && bundledPort <= 65535) {
        job.port = bundledPort
      }
      job.discoveryReport = result.discovery_report ?? job.discoveryReport
      job.transformationReport = result.transformation_report ?? job.transformationReport
      job.preparationChecks = result.preparation_checks ?? job.preparationChecks
      job.skillMarkdown = result.skill_markdown || job.skillMarkdown
      this.adminReplies.delete(job.id)
      job.dockerfileContent = result.dockerfile_content || job.dockerfileContent
      job.hasOriginalKeys = result.has_original_keys ?? job.hasOriginalKeys
      job.diffs = result.diffs ?? job.diffs
      if (result.original_config_values && typeof result.original_config_values === 'object') {
        await this.credentials.write(`orig-${job.id}`, result.original_config_values)
      }
      if (Object.keys(result.skill_credentials ?? {}).length) {
        await this.credentials.write(`skill-credentials-${job.id}-${revision}`, result.skill_credentials)
      }
      if (job.proposal?.delivery_format === 1) {
        const generated = await this.generatedConfigValues(job, true)
        job.generatedConfigKeys = Object.keys(generated)
        job.archivedRevision = await this.archivePreparedRevision(root, job, revision, expected)
        job.events.push('本轮改造制品已归档')
      }
      signal.throwIfAborted(); assertCurrent()
      job.autoPrepared = autoPrepared
      job.status = 'ready'
      if (job.published) {
        job.upgrade = true
        if (!job.configDraft && job.requestId) {
          const priorPublished = await this.credentials.read(`publish-config-${job.requestId}`)
          const declaredResources = new Set<string>(job.proposal?.delivery_format === 1
            ? (job.proposal.contract?.configs ?? []).filter((config: AppDocument) => config.resource_id).map((config: AppDocument) => config.key)
            : [])
          const previousRows: AppDocument[] = priorPublished.rows ? JSON.parse(priorPublished.rows) : []
          const rows = previousRows.filter(row => !declaredResources.has(row.key))
          if (rows.length > 0) {
            await this.credentials.write(`draft-${job.id}`, Object.fromEntries(rows.map(row => [row.key, row.value ?? ''])))
            job.configDraft = {
              artifactHash: fingerprint(job.hashes),
              rows: rows.map(({ value: _value, ...row }) => ({
                key: row.key,
                resource_id: row.resource_id,
                resource_key: row.resource_key,
                local_connection_confirmed: row.local_connection_confirmed === true,
              })),
              versionNote: job.versionNote ?? '',
            }
          }
        }
      }
      job.version = undefined
      job.published = undefined
      job.restoredVersion = undefined
      job.requestId = randomUUID().replaceAll('-', '')
      job.confirmationToken = undefined
      job.assessment = undefined
      job.assessmentPending = undefined
      job.configFingerprint = undefined
      job.events.push('部署包已生成，等待用户确认后提交服务器构建')
    } catch (error) {
      signal.throwIfAborted()
      job.status = 'failed'
      job.failureStage = 'preparation'
      job.error = String(error)
    }
    await this.save(root, job)
  }
  private async archivePreparedRevision(root: string, job: DeliveryJob, revision: string, contextId: string) {
    const form = new FormData()
    form.append('slug', job.slug)
    form.append('revision', revision)
    for (const [name, field] of [['app.tar', 'app_tar'], ['skill.zip', 'skill_zip'], ['delivery.json', 'delivery_plan']]) {
      const bytes = await readFile(join(root, revision, 'bundle', name))
      if (hash(bytes) !== job.hashes?.[name]) throw new Error('待归档制品摘要发生变化')
      form.append(field, new Blob([new Uint8Array(bytes)]), name)
    }
    const receipt = await this.platform('/deliveries', contextId, { form })
    if (receipt?.revision?.replaceAll('-', '') !== revision || receipt.slug !== job.slug ||
        receipt.delivery_plan_sha256 !== job.hashes?.['delivery.json'] ||
        receipt.app_tar_sha256 !== job.hashes?.['app.tar'] || receipt.skill_zip_sha256 !== job.hashes?.['skill.zip']) {
      throw new Error('平台归档回执与本次制品不一致')
    }
    return String(receipt.revision)
  }
  async resolveResourceValues(slug: string, bindings: AppDocument[], expected: string, signal?: AbortSignal): Promise<Record<string, string>> {
    if (!bindings.length) return {}
    const result = await this.platform(`/${slug}/config-values`, expected, {
      body: { bindings: bindings.map(({ key, resource_id, resource_key }) => ({ key, resource_id, resource_key })) }, signal,
    })
    return result.values ?? {}
  }

  async previewDeliveryConfig(job: DeliveryJob, root: string, expected: string, signal: AbortSignal, allocate = false) {
    const declarations: AppDocument[] = job.proposal?.contract?.configs ?? []
    if (!declarations.length) return []
    const [original, generated, manual, active] = await Promise.all([
      worker({ action: 'original_config_values', root, configs: declarations }, signal),
      this.generatedConfigValues(job, allocate),
      job.configDraft ? this.credentials.read(`draft-${job.id}`) : {} as Record<string, string>,
      declarations.some(c => c.value_plan?.kind === 'inherit') ? this.platform(`/${job.slug}`, expected) : undefined,
    ])
    const inputs = new Map(job.configDraft?.rows.map(row => [row.key, row]))
    const prior = new Map<string, AppDocument>((active?.app_config ?? []).map((row: AppDocument) => [row.key, row]))
    const rows = declarations.map(c => {
      const draft = inputs.get(c.key)
      const kind = c.value_plan?.kind
      const old = kind === 'inherit' ? prior.get(c.key) : undefined
      if (kind === 'inherit' && !old) {
        throw new Error(`配置 ${c.key} 无法沿用：当前生效版本没有该配置项。请由所选 AI 重新声明本次的取值方式。`)
      }
      const resource_id = draft ? draft.resource_id : old?.resource_id ?? c.resource_id
      const resource_key = draft ? draft.resource_key : old?.resource_key ?? c.resource_key
      const value = resource_id ? '' : draft?.value_source === 'manual' ? manual[c.key] ?? ''
        : old ? old.value ?? '' : kind === 'generate' ? generated[c.key] ?? ''
        : kind === 'default' ? c.value ?? (c.default || c.app_default || '')
        : c.value ?? (kind === 'input' ? '' : original[c.key] ?? c.default ?? c.app_default ?? '')
      return { key: c.key, description: c.description ?? '', required: Boolean(c.required), secret: Boolean(c.secret),
        value, resource_id, resource_key, value_source: resource_id ? 'resource' : draft?.value_source ??
          (old ? 'configured' : kind === 'generate' ? 'generated' : original[c.key] !== undefined ? 'original' : 'manual') }
    })
    const resolved = await this.resolveResourceValues(job.slug, rows.filter(row => row.resource_id), expected, signal)
    return rows.map(row => row.resource_id ? { ...row, value: resolved[row.key] ?? '' } : row)
  }

  private async generatedConfigValues(job: DeliveryJob, allocate = false): Promise<Record<string, string>> {
    const plans = ((job.proposal?.contract?.configs ?? []) as AppDocument[]).filter(c => c.value_plan?.kind === 'generate')
    if (!plans.length) return {}
    const namespace = `generated-config-${job.id}`
    const prior = await this.credentials.read(namespace)
    const stored = { ...prior }
    const values: Record<string, string> = Object.create(null)
    for (const { key, value_plan: { bytes, encoding } } of plans) {
      if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128 || !['base64', 'base64url', 'hex'].includes(encoding)) {
        throw new Error(`配置 ${key} 的生成规格无效`)
      }
      const id = fingerprint({ key, bytes, encoding })
      if (allocate && !stored[id]) stored[id] = randomBytes(bytes).toString(encoding as BufferEncoding)
      if (stored[id]) values[key] = stored[id]
    }
    if (Object.keys(stored).length !== Object.keys(prior).length) await this.credentials.write(namespace, stored)
    return values
  }
  private async deploymentConfiguration(job: DeliveryJob, input: AppDocument, expected: string) {
    if (this.options.requireSkillDelivery && job.proposal?.delivery_format !== 1) {
      throw new Error('此旧交付稿缺少技能驱动的 AI 方案。请保留源码并由所选 AI 重新准备后再发布')
    }
    const migrationApproved = job.proposal?.contract?.data_plan?.strategy === 'postgres_copy' && input.migrationApproved === true
    if (job.proposal?.contract?.data_plan?.strategy === 'postgres_copy' && !migrationApproved) throw new Error('请确认本轮数据库迁移和停写窗口')
    const rawConfigs = input.config as { key: string; value: string; resource_id?: string; resource_key?: string; local_connection_confirmed?: boolean; has_value?: boolean; value_source?: string }[]
    if (!Array.isArray(rawConfigs) || rawConfigs.some(c => !c || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.key) || typeof c.value !== 'string' || (c.resource_id !== undefined && typeof c.resource_id !== 'string')) || new Set(rawConfigs.map(c => c.key)).size !== rawConfigs.length) throw new Error('配置格式无效')
    const declarations: AppDocument[] = job.proposal!.contract.configs ?? []
    if (job.proposal!.delivery_format === 1 && rawConfigs.some(row => !declarations.some(item => item.key === row.key))) {
      throw new Error('部署配置必须来自当前交付清单。如需新增配置，请返回改造会话更新方案。')
    }
    const origValues = await this.credentials.read(`orig-${job.id}`)
    const generated = await this.generatedConfigValues(job)
    const configs = rawConfigs.map(c => {
      if (!c.resource_id && !c.value && c.value_source === 'generated') {
        if (!generated[c.key]) throw new Error(`配置 ${c.key} 的生成值不可用，请重新生成交付包`)
        return { ...c, value: generated[c.key], value_source: 'generated' }
      }
      if (!c.resource_id && !c.value && (c.value_source === 'original' || (!c.has_value && c.value_source !== 'manual')) && origValues[c.key]) return { ...c, value: origValues[c.key], value_source: 'original' }
      return { ...c, value_source: c.resource_id ? 'resource' : 'manual' }
    })
    const storageBindings = readStorageBindings(input.storageBindings)
    const declaredMounts: AppDocument[] = job.proposal!.contract.storage_mounts ?? []
    if (Object.keys(storageBindings).some(path => !declaredMounts.some(mount => mount.container_path === path))) {
      throw new Error('存储选择必须对应已确认的持久化目录')
    }
    const existingMounts: AppDocument[] = (job.upgrade || job.published) && declaredMounts.length
      ? (await this.platform('/' + job.slug, expected)).storage_mounts ?? []
      : []
    if (job.proposal!.delivery_format === 1) {
      for (const mount of declaredMounts) {
        if (mount.resource_id && !storageBindings[mount.container_path] && !existingMounts.some(old => old.container_path === mount.container_path)) {
          storageBindings[mount.container_path] = mount.resource_id
        }
      }
    }
    const needsDefaultMountResolution = (job.proposal!.delivery_format === 1 || input.storageBindings !== undefined) && declaredMounts.some(mount =>
      !storageBindings[mount.container_path] && !existingMounts.some(old => old.container_path === mount.container_path))
    if (needsDefaultMountResolution && job.proposal!.delivery_format === 1) {
      throw new Error('新增挂载必须使用 AI 方案声明的资源，或由用户在核对页选择')
    }
    const ids = [...new Set(configs.flatMap(c => c.resource_id ? [c.resource_id] : []))].sort()
    const available: AppDocument[] = ids.length || Object.keys(storageBindings).length || needsDefaultMountResolution
      ? (await this.platform('/resources', expected, { query: { slug: job.slug } })).resources ?? [] : []
    if (needsDefaultMountResolution) {
      for (const mount of declaredMounts) {
        if (storageBindings[mount.container_path] || existingMounts.some(old => old.container_path === mount.container_path)) continue
        const compatibleDefault = available.find(resource =>
          resource.is_default === true &&
          (resource.type === 'local-directory' || (resource.type === 'aliyun-oss-volume' && mount.kind !== 'sqlite')))
        if (compatibleDefault) {
          storageBindings[mount.container_path] = compatibleDefault.id
        } else {
          throw new Error('请为新增持久化目录选择 Platform 卷资源')
        }
      }
    }
    for (const [path, id] of Object.entries(storageBindings)) {
      const resource = available.find(resource => resource.id === id &&
        ['local-directory', 'aliyun-oss-volume', 'docker-volume'].includes(resource.type))
      if (!resource) throw new Error(`持久化目录的存储资源不可用：${path}`)
      if (resource.type === 'aliyun-oss-volume' && declaredMounts.find(mount => mount.container_path === path)?.kind === 'sqlite') {
        throw new Error(`SQLite 目录必须使用本地磁盘卷：${path}`)
      }
    }
    const storageMounts = declaredMounts.map(mount => {
      const { resource_id: _resource, storage_node_id: _node, ...declaration } = mount
      return { ...declaration, resource_id: storageBindings[mount.container_path] }
    })
    for (const item of configs) {
      if (item.resource_id && (item.value || !available.some(r => r.id === item.resource_id && r.env_keys?.includes(item.resource_key || item.key)))) {
        throw new Error(`配置项的资源选择无效：${item.key}`)
      }
      if (job.proposal!.delivery_format !== 1 && !item.resource_id &&
          loopbackConnection(item.key, item.value) && item.local_connection_confirmed !== true) {
        throw new Error(`连接仍指向应用容器自己，请更换为服务器可访问地址；若服务确实就在同一容器内，请明确确认：${item.key}`)
      }
      if (item.key === 'PORT' && (item.resource_id || (item.value && item.value !== String(job.port ?? 8080)))) {
        throw new Error('PORT 必须与已确认的容器端口一致；如需更换端口，请重新分析生成交付包')
      }
    }
    const missing = declarations.filter(c => {
      const selected = configs.find(i => i.key === c.key)
      const preservedOnlineSecret = Boolean((job.upgrade || job.published) && selected?.has_value)
      return c.required && c.key !== 'PORT' && !selected?.value && !selected?.resource_id && !preservedOnlineSecret
    })
    if (missing.length) throw new Error(`请填写必填配置：${missing.map(c => c.key).join('、')}，或选择匹配的平台托管资源。`)
    const bindings = configs.map(c => ({
      key: c.key,
      value: c.value,
      ...(declarations.some(item => item.key === c.key && item.secret) ? { secret: true } : {}),
      ...(declarations.some(item => item.key === c.key && item.preserve_on_upgrade) ? { preserve_on_upgrade: true } : {}),
      value_source: c.value_source,
      ...(c.has_value === true && !c.value && !c.resource_id ? { has_value: true } : {}),
      resource_id: c.resource_id,
      resource_key: c.resource_id ? c.resource_key : undefined,
      required: declarations.some(item => item.key === c.key && item.required),
    }))
    const note = input.versionNote ?? input.version_note
    const versionNote = typeof note === 'string' && note.trim() ? note.trim() : job.versionNote ?? ''
    const digest = fingerprint({ hashes: job.hashes, url: job.url, port: job.port, bindings, ids, storageMounts, versionNote, migrationApproved })
    return { bindings, configs, ids, storageMounts, versionNote, digest, migrationApproved }
  }
  async confirmDeployment(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status !== 'ready' || !job.proposal || input.artifactHash !== fingerprint(job.hashes)) throw new Error('交付包已变化，请重新核对')
      await worker({ action: 'validate_deployment_scope', root, proposal: job.proposal }, scope.signal)
      let config = await this.deploymentConfiguration(job, input, expected)
      if (job.proposal.config_format === 1) {
        const resources = await this.resolveResourceValues(job.slug, config.bindings.filter(row => row.resource_id), expected)
        const byKey = new Map(config.bindings.map(row => [row.key, row]))
        const finalValues = (job.proposal.contract.configs as AppDocument[] ?? []).map(c => {
          const row = byKey.get(c.key)
          return { key: c.key, description: c.description ?? '', required: Boolean(c.required), secret: Boolean(c.secret),
            value: row?.resource_id ? resources[c.key] ?? '' : row?.value ?? '',
            resource_id: row?.resource_id, resource_key: row?.resource_key,
            value_source: row?.value_source ?? 'manual' }
        })
        const existing = job.proposal.effective_configs ?? []
        if (fingerprint(finalValues) !== fingerprint(existing)) {
          await this.prepareJob(root, job, scope.signal, scope.assertCurrent, expected, false, finalValues)
          if (job.status !== 'ready' || job.error) throw new Error(job.error || '无法按确认值重新生成交付包')
          config = await this.deploymentConfiguration(job, input, expected)
        }
      }
      const digest = config.digest
      const prior = await this.credentials.read(`confirm-${id}`)
      scope.assertCurrent()
      if (!job.confirmationToken || prior.digest !== digest) {
        job.confirmationToken = randomUUID()
        job.requestId = randomUUID().replaceAll('-', '')
        await this.credentials.write(`confirm-${id}`, { digest })
        await this.save(root, job)
      }
      return { confirmationToken: job.confirmationToken, requestId: job.requestId, artifactHash: fingerprint(job.hashes) }
    })
  }
  async publish(id: string, input: AppDocument, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (job.status === 'unknown') throw new Error('上次发布结果仍待确认，请先检查部署状态')
      if (job.status !== 'ready' || input.artifactHash !== fingerprint(job.hashes) || !job.proposal || !job.revision) throw new Error('交付包已变化，请重新核对')
      if (job.proposal.contract.runtime?.port !== (job.port ?? 8080)) throw new Error('交付包端口与已确认端口不一致，请重新分析并打包')
      await worker({ action: 'validate_deployment_scope', root, proposal: job.proposal }, scope.signal)
      await worker({ action: 'validate_credential_references', root, contract: job.proposal.contract }, scope.signal)
      const { bindings, configs, ids, storageMounts, versionNote, digest, migrationApproved } = await this.deploymentConfiguration(job, input, expected)
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
      if (job.proposal.delivery_format === 1) {
        if (job.archivedRevision?.replaceAll('-', '') !== job.revision) throw new Error('本轮交付尚未归档，请重新准备')
        const capabilities = await this.platform('/resources', expected, { query: { slug: job.slug } })
        if (capabilities.delivery_format !== 1) throw new Error('当前 Platform 版本不支持技能驱动交付，请升级平台后重新发布')
        if (capabilities.domain_deployment_check !== true) throw new Error('当前 Platform 版本不支持域名部署检查，请升级平台后重新发布')
        if (job.proposal.config_format === 1 && (capabilities.config_format !== 1 || capabilities.visible_config_values !== true)) {
          throw new Error('当前 Platform 版本不支持明文配置确认和版本归档，请先升级平台')
        }
        const plan = await readFile(join(folder, 'delivery.json'))
        if (hash(plan) !== job.hashes?.['delivery.json']) throw new Error('交付清单摘要不一致，拒绝发布')
        // A Blob preserves LF bytes. An empty filename keeps this part readable
        // as a form field by Platform, which checks the archived byte digest.
        form.append('delivery_plan', new Blob([new Uint8Array(plan)], { type: 'application/json' }), '')
        form.append('delivery_revision', job.archivedRevision)
        form.append('deployment_check', 'domain')
        job.deploymentCheck = 'domain'
        job.assessment = undefined
        job.assessmentPending = undefined
        if (migrationApproved) form.append('migration_approved', 'true')
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
        storage_mounts: JSON.stringify(storageMounts),
      })) form.append(key, String(value))
      scope.assertCurrent()
      await this.credentials.write(`publish-config-${requestId}`, { rows: JSON.stringify(configs) })
      scope.assertCurrent()
      job.status = 'publishing'; job.deploymentProgress = undefined; job.failureStage = undefined; job.error = undefined; job.checks = undefined; await this.save(root, job)
      this.core.emit('skills-changed')
      try {
        const result = await this.platform('/publish', expected, { form })
        if (result.app_url !== job.url) throw new Error('平台返回地址与确认地址不同')
        if (!await this.applyPublishReceipt(scope.directory, root, job, result)) throw new Error('平台尚未确认发布请求')
        job.events.push(job.deploymentCheck === 'domain' ? '已上传确认的交付包，等待服务器构建、启动并检查应用域名' : '已上传经过确认的同一交付包，等待服务器构建与业务验证')
      } catch (error) {
        if (error instanceof AppRequestError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
          job.status = 'ready'
          if (job.deploymentCheck === 'domain') {
            job.deploymentProgress = error.code === 'APP_DELIVERY_PENDING'
              ? { phase: 'blocked_previous', blocking_request_id: error.blockingRequestId }
              : { phase: 'submission_rejected' }
          }
          job.error = error.status === 409 && error.message === 'deployment artifacts do not match the archived delivery revision'
            ? '发布制品与平台归档不一致。请返回核对方案重新生成交付包，再确认发布。'
            : error.message
        } else {
          let reconciled = false
          try {
            const reqState = await this.platform(`/${job.slug}/requests/${requestId}`, expected)
            reconciled = await this.applyPublishReceipt(scope.directory, root, job, reqState)
            if (reconciled && reqState.status !== 'failed') {
              job.events.push('上传连接中断后已通过幂等请求号核实平台接收状态')
            }
          } catch { /* Preserve uncertainty until Platform returns a receipt. */ }
          if (!reconciled) {
            job.status = 'unknown'
            if (job.deploymentCheck === 'domain') job.deploymentProgress = { phase: 'unknown' }
            job.error = '发布结果未确认，禁止自动重试：' + String(error)
          }
        }
      }
      await this.save(root, job); return this.public(job, root)
    })
  }
  async verify(id: string, expected: string, options?: AppDocument) {
    const scope = this.scope(expected)
    if (options?.automatic === true && this.busy.has(id)) {
      const { root, job } = await this.open(scope.directory, id)
      if (job.deploymentProgress?.phase === 'blocked_previous') {
        const previous = job.deploymentProgress.blocking_request_id
        if (!previous) return this.public(job, root)
        const receipt = await this.platform(`/${job.slug}/requests/${previous}`, expected)
        if (receipt.request_id !== previous) throw new Error('平台返回了其他部署任务')
        if (receipt.progress?.retry_safe === true || receipt.progress?.phase === 'succeeded') {
          job.deploymentProgress = { phase: 'submission_rejected' }
          job.error = '上一轮部署已结束，可以返回第三步重新确认。'
          await this.save(root, job)
        }
        return this.public(job, root)
      }
      return this.public(job, root)
    }
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (options?.checkStartup === true) {
        if (!job.requestId) throw new Error('缺少本次发布请求号，无法重新检查应用启动状态')
        const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected, { query: { startup_check: '1' } })
        if (receipt.status === 'unknown') throw new Error('平台还未返回本次发布回执，请稍后再检查')
        checkPublishReceipt(job, receipt)
        const startupCheck = receipt.startup_check
        if (!startupCheck || typeof startupCheck.target_running !== 'boolean' ||
            typeof startupCheck.domain_reachable !== 'boolean' || typeof startupCheck.active_version_running !== 'boolean' ||
            !Number.isSafeInteger(startupCheck.active_version) || startupCheck.active_version < 0) {
          throw new Error('平台暂未提供本次发布的启动检查结果')
        }
        if (job.deploymentCheck === 'domain' && receipt.status === 'running' && startupCheck.target_running &&
            startupCheck.domain_reachable && startupCheck.active_version_running && startupCheck.active_version === receipt.published_version) {
          await this.completePreparedDelivery(root, job, receipt, expected)
        }
        return { ...this.public(job, root), startupCheck }
      }
      if (options?.automatic === true && !followsDeploymentAttempt(job.deploymentProgress) && !['building', 'unknown'].includes(job.status)) {
        const view = this.public(job, root)
        if (job.status === 'verified') view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug)
        return view
      }
      if (!['building', 'unknown', 'awaiting_page_verification', 'verified', 'failed', 'cancelled', 'publishing', 'verifying'].includes(job.status) || !job.hashes || !job.proposal) throw new Error('应用尚未发布')
      if (job.proposal.delivery_format === 1) {
        if (this.analyses.has(id) || (options?.automatic && job.assessmentPending)) return this.public(job, root)
        if (!job.archivedRevision || !job.requestId) throw new Error('缺少本轮交付归档或发布请求号，无法核对部署结果')
        return this.advancePreparedDelivery(root, job, expected)
      }
      if (job.status === 'unknown' || job.status === 'publishing' || (job.status === 'building' && !job.version && job.requestId)) {
        if (!job.requestId) throw new Error('缺少上次发布请求号，无法核对结果')
        const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected)
        if (!await this.applyPublishReceipt(scope.directory, root, job, receipt)) return this.public(job, root)
        await this.save(root, job)
        if (receipt.status === 'failed' || !job.version) return this.public(job, root)
      }
      const contract = job.proposal.contract
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
      const remote = await this.platform('/' + job.slug, expected)
      if (remote.status === 'running' && job.version && remote.current_version !== job.version) {
        const history = await this.platform('/' + job.slug + '/versions', expected)
        const attempted = history.versions?.find((version: AppDocument) => version.version === job.version)
        if (attempted?.status === 'failed' && attempted.app_tar_sha256 === job.hashes['app.tar'] &&
            attempted.skill_zip_sha256 === job.hashes['skill.zip']) {
          this.recordFailureState(job, attempted.error_message || '本次发布失败，旧版本仍在运行', attempted.build_log?.slice(-8000), job.version)
          await this.save(root, job)
          this.core.emit('skills-changed')
          return this.public(job, root)
        }
        if (attempted && ['accepted', 'building'].includes(attempted.status) &&
            attempted.app_tar_sha256 === job.hashes['app.tar'] && attempted.skill_zip_sha256 === job.hashes['skill.zip']) {
          return this.public(job, root)
        }
      }
      if (remote.status !== 'running') {
        if (!['failed', 'unhealthy'].includes(remote.status)) return this.public(job, root)
        if (job.version && remote.current_version !== job.version) throw new Error('线上版本发生变化，无法验证此交付任务')
        this.recordFailureState(job, remote.error_message || '应用构建或启动失败', remote.build_log?.slice(-8000), job.version)
        await this.save(root, job)
        this.core.emit('skills-changed')
        return this.public(job, root)
      }
      if (remote.app_url !== job.url || (job.version && remote.current_version !== job.version)) throw new Error('线上版本或地址不一致，拒绝启用技能')
      if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error('服务器制品回执不一致')
      job.status = 'verifying'; job.failureStage = undefined; job.error = undefined; job.checks = undefined; job.pagesVerified = undefined; await this.save(root, job)
      try {
        await worker({ action: 'validate_verification_contract', root, contract }, scope.signal)
        const credentials = { ...await this.readVersionCredentials(job, expected, remote.app_config), ...supplied }
        const healthPath = contract.health?.path
        const checks: AppDocument[] = []
        for (const test of contract.verification?.cases ?? []) {
          const api = contract.apis.find((a: AppDocument) => a.id === test.operation)
          if (!api) throw new Error(`业务验证接口不存在：${test.operation}`)
          if (api.path === healthPath) {
            if (job.restoredVersion) throw new Error('回滚后必须使用有效的只读业务接口验证')
            continue
          }
          if (api.effect !== 'read') throw new Error('业务验证只能使用只读接口')
          const result = await worker({ action: 'probe', root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials,
            skill_markdown: job.skillMarkdown }, scope.signal)
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
            job.superseded = undefined
            job.checks = [{ operation: 'page_verification', status: 200 }]
            job.pagesVerified = true
            job.version = remote.current_version
            job.status = 'verified'
            job.events.push('已完成人工页面验收')
          } else if (hasPages && !hasNonHealthApis) {
            scope.assertCurrent()
            job.configFingerprint = latest.config_fingerprint
            job.published = true
            job.superseded = undefined
            job.version = remote.current_version
            job.status = 'awaiting_page_verification'
            job.events.push('应用已部署，请在应用管理中完成页面验收')
          } else {
            throw new Error('缺少只读业务验证；页面应用需要单独验收，不能自动启用')
          }
        } else {
          scope.assertCurrent()
          await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id)
          job.configFingerprint = latest.config_fingerprint
          job.published = true
          job.superseded = undefined
          // Verification credentials are transient unless the user opts into local skill use.
          if (options?.rememberCredentials === true && Object.keys(supplied).length) {
            await this.credentials.write(`version-${job.id}-${remote.current_version}`, credentials)
          }
          job.checks = checks
          job.version = remote.current_version
          job.status = 'verified'
          job.events.push('只读业务验证通过；页面尚未验证')
        }
      } catch (error) {
        this.recordFailureState(job, String(error), remote.build_log?.slice(-8000), remote.current_version ?? job.version, 'verification')
      }
      await this.save(root, job); this.core.emit('skills-changed')
      const view = this.public(job, root)
      if (job.status === 'verified') view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug)
      return view
    })
  }

  private async advancePreparedDelivery(root: string, job: DeliveryJob, expected: string, onChatReady?: () => void) {
    const scope = this.scope(expected)
    const path = `/${job.slug}/requests/${job.requestId}`
    let receipt: AppDocument
    try {
      receipt = await this.platform(path, expected)
    } catch (error) {
      scope.assertCurrent()
      if (!job.deploymentProgress && job.deploymentCheck !== 'domain') throw error
      onChatReady?.()
      return this.unconfirmedDeployment(job, root)
    }
    checkPublishReceipt(job, receipt)
    if (receipt.status === 'unknown') {
      onChatReady?.()
      return (receipt.progress || job.deploymentProgress || job.deploymentCheck === 'domain')
        ? this.unconfirmedDeployment(job, root) : this.public(job, root)
    }
    if (receipt.status === 'running') {
      await this.completePreparedDelivery(root, job, receipt, expected)
      onChatReady?.()
      return this.public(job, root)
    }
    if (receipt.status === 'failed' || receipt.status === 'cancelled') {
      await this.applyPublishReceipt(scope.directory, root, job, receipt)
      job.assessmentPending = undefined
      await this.save(root, job)
      onChatReady?.()
      return this.public(job, root)
    }
    if (job.deploymentCheck === 'domain' || (receipt.status !== 'built' && receipt.status !== 'runtime_ready')) {
      if ((job.status !== 'building' || receipt.progress) && await this.applyPublishReceipt(scope.directory, root, job, receipt)) {
        job.assessmentPending = undefined
        job.failureStage = undefined
        await this.save(root, job)
      }
      onChatReady?.()
      return this.public(job, root)
    }
    if (!this.analyze) throw new Error('当前 DSH 版本不支持应用 AI 验收')
    const controller = new AbortController()
    const signal = AbortSignal.any([scope.signal, controller.signal])
    const run: DeliveryAssessmentRun = { phase: receipt.status === 'built' ? 'build' : 'runtime' }
    job.status = 'verifying'
    job.assessmentPending = undefined
    job.events.push(run.phase === 'build' ? 'AI 正在核对候选构建' : 'AI 正在验收运行中的候选版本')
    this.analyses.set(job.id, controller)
    try { await this.save(root, job) } catch (error) {
      this.analyses.delete(job.id)
      throw error
    }
    void (async () => {
      try {
        await this.analyze!(job, root, '', signal, async sessionId => {
          signal.throwIfAborted()
          job.analysisSessionId = sessionId
          job.analysisSessions = [...new Set([...(job.analysisSessions ?? []), sessionId])]
          await this.save(root, job)
          onChatReady?.()
        }, Boolean(onChatReady), run)
        if (!run.result) throw new Error('AI 尚未提交验收结论')
        job.assessment = run.result
        await this.save(root, job)
        const result = await this.platform(path + '/assessment', expected, { body: run.result })
        if (result.status === 'running') {
          await this.completePreparedDelivery(root, job, result, expected)
        } else {
          if (!await this.applyPublishReceipt(scope.directory, root, job, result)) throw new Error('平台未确认本轮验收')
          await this.save(root, job)
        }
      } catch (error) {
        if (scope.signal.aborted) return
        job.assessmentPending = true
        this.recordFailureState(job, String(error), undefined, job.version, 'verification')
        await this.save(root, job)
      } finally {
        this.analyses.delete(job.id)
        onChatReady?.()
        this.core.emit('change')
        this.core.emit('skills-changed')
      }
    })().catch(() => {})
    return this.public(job, root)
  }

  private unconfirmedDeployment(job: DeliveryJob, root: string) {
    const known = job.deploymentProgress
    const deploymentProgress: DeploymentAttemptProgress = { ...known, phase: 'unknown', can_cancel: false, retry_safe: false,
      last_observed_phase: known?.phase === 'unknown' ? known?.last_observed_phase : known?.phase }
    return { ...this.public(job, root), deploymentProgress }
  }

  async cancelDeployment(id: string, requestId: string, expected: string) {
    const scope = this.scope(expected)
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id)
      if (!job.archivedRevision || !job.requestId || job.requestId !== requestId) throw new Error('部署任务已变化，请重新检查')
      const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}/cancel`, expected, { body: {} })
      if (!await this.applyPublishReceipt(scope.directory, root, job, receipt)) throw new Error('平台尚未确认取消请求')
      await this.save(root, job)
      return this.public(job, root)
    })
  }

  private async completePreparedDelivery(root: string, job: DeliveryJob, receipt: AppDocument, expected: string) {
    const scope = this.scope(expected)
    checkPublishReceipt(job, receipt)
    let assessment: DeliveryAssessment | undefined
    if (job.deploymentCheck === 'domain') {
      if (receipt.is_active !== true) throw new Error('平台回执未确认本次版本已生效')
    } else {
      const reports: { build?: DeliveryAssessment; runtime?: DeliveryAssessment } =
        typeof receipt.delivery_assessment === 'string' ? JSON.parse(receipt.delivery_assessment || '{}') : {}
      assessment = reports.runtime
      if (reports.build?.outcome !== 'passed' || !reports.build.evidence?.length ||
          assessment?.outcome !== 'passed' || !assessment.evidence?.length) {
        throw new Error('发布记录缺少本版本的 AI 构建或业务验收结论')
      }
    }
    const remote = await this.platform(`/${job.slug}`, expected)
    if (remote.current_version !== receipt.published_version || remote.app_url !== job.url ||
        (job.deploymentCheck === 'domain' && remote.status !== 'running') || !matchesReceipt(remote.build_log, job.hashes)) {
      throw new Error('部署回执与当前生效版本不一致')
    }
    if (job.configFingerprint && job.configFingerprint !== remote.config_fingerprint) {
      throw new Error('运行配置已变化，请通过应用更新向导确认并重新部署。')
    }
    await this.applyPublishReceipt(scope.directory, root, job, receipt)
    await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id)
    job.status = 'verified'
    job.assessment = assessment
    job.assessmentPending = undefined
    job.configFingerprint = remote.config_fingerprint
    job.checks = [{ operation: job.deploymentCheck === 'domain' ? 'deployment_domain' : 'ai_delivery_assessment' }]
    job.superseded = undefined
    await this.save(root, job)
    if (job.deploymentCheck === 'domain') this.core.emit('skills-changed')
  }

  async observeDeployment(job: DeliveryJob, root: string, input: AppDocument, expected: string, signal: AbortSignal) {
    const request = `/${job.slug}/requests/${job.requestId}`
    const modern = job.proposal?.delivery_format === 1
    const receipt = await this.platform(request, expected, { signal })
    checkPublishReceipt(job, receipt)
    if (input.kind === 'rehearsal') {
      if (receipt.status !== 'built' || job.proposal?.contract?.data_plan?.strategy !== 'postgres_copy') throw new Error('本轮交付没有待演练的数据迁移')
      const path = `${request}/rehearsal`
      let rehearsal = await this.platform(path, expected, { body: {}, signal })
      while (rehearsal.status === 'running') {
        await delay(2000, undefined, { signal })
        rehearsal = await this.platform(path, expected, { signal })
      }
      return rehearsal
    }
    if (input.kind === 'state') {
      const logs = receipt.status === 'runtime_ready'
        ? await this.platform(modern ? `${request}/probe` : `/${job.slug}/logs`, expected, { signal }).catch(() => ({})) : {}
      signal.throwIfAborted()
      const log = [receipt.build_log, receipt.error_message, modern ? logs.logs : logs.runtime_logs].filter(Boolean).join('\n').slice(-8000)
      return { status: receipt.status, image: receipt.image, delivery_step: receipt.delivery_step, rehearsal: receipt.migration_rehearsal || undefined,
        migration: receipt.migration_execution || undefined, logs: await worker({ action: 'redact_feedback', root, text: log }, signal) }
    }
    if (receipt.status !== 'runtime_ready') throw new Error('候选版本还没有进入运行态')
    const targets: AppDocument[] = job.proposal?.contract?.verification?.targets ?? []
    const target = modern ? targets.find(item => item.id === input.target && item.kind === input.kind) : undefined
    if (modern && !target) throw new Error('请选择当前 AI 方案中声明的只读业务验收目标')
    if (input.kind === 'operation') {
      const contract = job.proposal!.contract
      const operation = target?.operation ?? input.operation
      const api = contract.apis.find((item: AppDocument) => item.id === operation)
      if (!api || api.effect !== 'read') throw new Error('验收只允许调用已声明的只读业务操作')
      const credentials = await this.readVersionCredentials(job, expected, undefined, operation, signal)
      const candidateProbe = modern ? {
        url: new URL(`/integration/v1/apps${request}/probe`, this.core.auth.http.base).href,
        token: await this.core.auth.token(),
        target: target?.id,
      } : undefined
      if (modern) this.scope(expected).assertCurrent()
      const result = await worker({ action: 'probe', root, contract, operation, params: input.params ?? {}, body: input.body,
        candidate_probe: candidateProbe, credentials, skill_markdown: job.skillMarkdown }, signal)
      let content = String(result.content ?? '').slice(0, 4000)
      for (const value of Object.values(credentials)) if (typeof value === 'string' && value) content = content.replaceAll(value, '[REDACTED]')
      return { operation, status: result.status, content_type: result.content_type,
        content: await worker({ action: 'redact_feedback', root, text: content }, signal),
        ...(typeof result.proof === 'string' ? { proof: result.proof } : {}) }
    }
    const path = String(target?.path ?? input.path ?? '/')
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\0\r\n#]/.test(path)) throw new Error('请提供该应用的站内路径')
    const url = new URL(path, job.url)
    if (url.origin !== new URL(job.url).origin) throw new Error('验收请求必须留在应用域名内')
    const expectedStatuses: number[] = input.expected_statuses ?? []
    const waitSeconds = input.within_seconds ?? 0
    if (!Array.isArray(expectedStatuses) || expectedStatuses.length > 20 || expectedStatuses.some(status => !Number.isInteger(status) || status < 100 || status > 599) ||
        !Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 90 || (waitSeconds > 0 && !expectedStatuses.length)) {
      throw new Error('等待入口就绪时需提供预期 HTTP 状态及 1–90 秒的等待时间')
    }
    const deadline = Date.now() + waitSeconds * 1000
    const method = (target?.method ?? input.method) === 'HEAD' ? 'HEAD' : 'GET'
    let last: AppDocument = { path }
    do {
      signal.throwIfAborted()
      const timeout = waitSeconds ? Math.min(10_000, Math.max(1, deadline - Date.now())) : 10_000
      try {
        const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        let status: number
        let contentType: string | undefined
        let location: string | undefined
        let content: string | undefined
        let proof: string | undefined
        if (modern) {
          const response = await this.platform(`${request}/probe`, expected, { body: { method, path, target: target?.id }, signal: attemptSignal })
          if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error('候选入口返回了无效回执')
          const entries = new Map(Object.entries(response.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
          status = response.status
          contentType = (entries.get('content-type') as string[] | undefined)?.[0]
          location = (entries.get('location') as string[] | undefined)?.[0]
          if (typeof response.proof === 'string') proof = response.proof
          if (method === 'GET' && typeof response.body === 'string' && response.body) {
            content = await worker({ action: 'redact_feedback', root, text: response.body.slice(0, 4000) }, signal)
          }
        } else {
          const response = await fetch(url, { method, redirect: 'manual', signal: attemptSignal })
          await response.body?.cancel()
          status = response.status
          contentType = response.headers.get('content-type') ?? undefined
          location = response.headers.get('location') ?? undefined
        }
        const redirectPath = location ? URL.parse(location, url) : undefined
        last = { path, status, content_type: contentType, ...(content === undefined ? {} : { content }),
          ...(proof === undefined ? {} : { proof }),
          redirect_path: redirectPath?.origin === url.origin ? redirectPath?.pathname : undefined }
        if (!expectedStatuses.length || expectedStatuses.includes(status)) return last
      } catch {
        signal.throwIfAborted()
        last = { path, connection_error: '未收到有效的 HTTP 响应' }
      }
      if (Date.now() < deadline) await delay(Math.min(1000, deadline - Date.now()), undefined, { signal })
    } while (Date.now() < deadline)
    return last
  }
  async versions(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/versions`, expected)
  }
  async logs(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/logs`, expected)
  }
  async deploymentLogs(id: string, expected: string) {
    const scope = this.scope(expected)
    const { job } = await this.open(scope.directory, id)
    scope.assertCurrent()
    if (!job.archivedRevision) return this.logs(job.slug, expected)
    if (!job.requestId) return {}
    const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected, { query: { live_logs: '1' } })
    if (receipt.status === 'unknown') return {}
    checkPublishReceipt(job, receipt)
    return { build_log: receipt.build_log, runtime_logs: receipt.runtime_logs, logs_unavailable: receipt.logs_unavailable }
  }
  async storage(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/storage`, expected)
  }
  private downloadTarget(slug: string, selection: AppDocument) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    if (selection.storage === true || typeof selection.mount === 'string' && selection.mount) {
      return { path: `/${slug}/storage/backup`, filename: `${slug}-storage-backup.tar.gz`,
        query: selection.mount ? { mount: String(selection.mount) } : undefined }
    }
    const { version, artifact } = selection
    if (!Number.isSafeInteger(version) || version < 1 || !['app.tar', 'skill.zip', 'Dockerfile', 'manifest.json', 'delivery.json', 'confirmed-deployment.json'].includes(artifact)) {
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
  async runtimeManagement(slug: string, expected: string, command?: AppDocument) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/runtime-management`, expected, command ? { method: 'POST', body: command } : {})
  }
  async updateConfig(slug: string, body: AppDocument, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    const scope = this.scope(expected)
    const current = await this.platform(`/${slug}`, expected)
    if (current.delivery_format === 1 || /\[Artifact\] delivery\.json:[a-f0-9]{64}/.test(current.build_log ?? '')) {
      throw new Error('请在应用更新向导中由所选 AI 分析配置变更。')
    }
    const result = await this.platform(`/${slug}/config`, expected, { method: 'PUT', body })
    const activeVersion = result.current_version ?? result.version
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir(parent).catch(() => [] as string[])
      for (const id of entries.filter(e => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => undefined)
        const eligibleStatus = ['verified', 'awaiting_page_verification'].includes(opened?.job.status ?? '') ||
          (opened?.job.published && opened.job.status === 'failed' && opened.job.failureStage === 'verification')
        if (opened && opened.job.slug === slug && !opened.job.superseded && eligibleStatus) {
          if (activeVersion && opened.job.version && opened.job.version !== activeVersion) continue
          if (Number.isInteger(body.container_port) && body.container_port >= 1 && body.container_port <= 65535) {
            opened.job.port = body.container_port
          }
          if (Array.isArray(body.app_config)) {
            const secretKeys = new Set(
              (opened.job.proposal?.contract?.configs ?? [])
                .filter((cfg: AppDocument) => cfg.secret)
                .map((cfg: AppDocument) => cfg.key),
            )
            const requestId = opened.job.requestId ||= randomUUID().replaceAll('-', '')
            const existingSaved = await this.credentials.read(`publish-config-${requestId}`)
            const existingRows: AppDocument[] = existingSaved.rows ? JSON.parse(existingSaved.rows) : []
            const existingByKey = new Map(existingRows.map(row => [row.key, row]))
            const nextRows: AppDocument[] = body.app_config.map((row: AppDocument) => {
              const prior = existingByKey.get(row.key)
              const keepSecret = secretKeys.has(row.key) && !row.resource_id && !row.value && prior && !prior.resource_id && prior.value
              return {
                ...row,
                value: row.resource_id ? '' : (keepSecret ? prior.value : (row.value ?? '')),
              }
            })
            await this.credentials.write(`publish-config-${requestId}`, { rows: JSON.stringify(nextRows) })
            if (opened.job.version) {
              const versionKey = `version-${opened.job.id}-${opened.job.version}`
              const versionCreds = await this.credentials.read(versionKey)
              const updatedVersionCreds = { ...versionCreds }
              let touchedVersionCreds = false
              for (const row of nextRows) {
                if (row.key in updatedVersionCreds && !row.resource_id && typeof row.value === 'string' && row.value) {
                  updatedVersionCreds[row.key] = row.value
                  touchedVersionCreds = true
                }
              }
              if (touchedVersionCreds) await this.credentials.write(versionKey, updatedVersionCreds)
            }
          }
          opened.job.status = 'building'
          opened.job.failureStage = undefined
          opened.job.error = undefined
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
  async createVolumeBackup(slug: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    return this.platform(`/${slug}/storage/backups`, expected, { method: 'POST', body: {} })
  }
  async listVolumeBackups(expected: string, all = false) {
    return this.platform('/backups', expected, all ? { query: { all: 'true' } } : {})
  }
  async saveVolumeBackupDownload(id: string, filename: string, expected: string, downloads = join(homedir(), 'Downloads')) {
    const cleanId = String(id || '').trim()
    if (!cleanId) throw new Error('无效备份 ID')
    const scope = this.scope(expected)
    const safeName = (String(filename || '').trim() || `app-backup-${cleanId}.tar.gz`).replace(/[/\\]/g, '_')
    await mkdir(downloads, { recursive: true, mode: 0o700 })
    const temp = join(downloads, `.opc-${randomUUID()}.download`)
    const response: Response = await this.platform(`/backups/${encodeURIComponent(cleanId)}/download`, expected, { stream: true })
    if (!response.body) throw new Error('平台未返回备份文件内容')
    try {
      let bytes = 0
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(null, chunk)
      } })
      await pipeline(response.body, counter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal: scope.signal })
      if (!bytes) throw new Error('平台返回备份文件为空')
      scope.assertCurrent()
      const preferred = join(downloads, safeName)
      let dest = preferred
      try { await link(temp, dest) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        dest = join(downloads, `${randomUUID().slice(0, 8)}-${safeName}`)
        await link(temp, dest)
      }
      return { path: dest, filename: safeName }
    } finally { await rm(temp, { force: true }) }
  }
  async deleteVolumeBackup(id: string, expected: string) {
    const cleanId = String(id || '').trim()
    if (!cleanId) throw new Error('无效备份 ID')
    return this.platform(`/backups/${encodeURIComponent(cleanId)}`, expected, { method: 'DELETE' })
  }
  async deleteApp(slug: string, optionsOrPurge: boolean | { purgeVolumes?: boolean; exportMode?: string; backupId?: string }, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error('无效应用标识')
    const opts = typeof optionsOrPurge === 'boolean'
      ? { purgeVolumes: optionsOrPurge }
      : (optionsOrPurge ?? {})
    const query: Record<string, string> = {}
    if (opts.purgeVolumes) query.purge_volumes = 'true'
    if (opts.exportMode) query.export_mode = opts.exportMode
    if (opts.backupId) query.backup_id = opts.backupId
    return this.platform(`/${slug}`, expected, {
      method: 'DELETE',
      query: Object.keys(query).length ? query : undefined,
    })
  }
  async rollback(slug: string, targetVersion: number, reason: string, expected: string) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !Number.isInteger(targetVersion) || targetVersion <= 0) throw new Error('回滚参数无效')
    const scope = this.scope(expected)
    const rbResult = await this.platform(`/${slug}/rollback`, expected, {
      method: 'POST',
      body: { target_version: targetVersion, reason: reason || `回退至版本 v${targetVersion}` },
    })
    try {
      return await this.syncRolledBackSkill(slug, targetVersion, expected, rbResult, scope)
    } catch (error) {
      scope.assertCurrent()
      return { ...rbResult, active_version: targetVersion, local_skill_synced: false, local_skill_verified: false,
        skill_enabled: false, verification: { status: 'probe-warning', detail: `应用已回退，技能未同步或未验证：${String(error)}` },
        rollback_notice: ROLLBACK_NOTICE }
    }
  }
  private async syncRolledBackSkill(slug: string, targetVersion: number, expected: string, rbResult: AppDocument, scope: ReturnType<AppDelivery['scope']>) {
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
        createdAt: Date.now(),
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
          opened.job.superseded = true
          opened.job.events.push(`应用已回退至 v${targetVersion}，旧任务技能已停用`)
          await this.save(opened.root, opened.job)
        } else if (opened.job.published && !opened.job.superseded) {
          opened.job.superseded = true
          await this.save(opened.root, opened.job)
        }
        continue
      }
      opened.job.version = targetVersion
      opened.job.published = true
      opened.job.restoredVersion = true
      opened.job.superseded = undefined
      opened.job.pagesVerified = undefined
        opened.job.checks = undefined
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
          await worker({ action: 'validate_verification_contract', root: opened.root, contract }, scope.signal)
          const archivedJobId = localMeta?.hashes?.['skill.zip'] === expectedSkillSha && localMeta?.hashes?.['app.tar'] === expectedAppTarSha
            && typeof localMeta.jobId === 'string' && /^[a-f0-9-]{36}$/.test(localMeta.jobId) ? localMeta.jobId : undefined
          if (archivedJobId && archivedJobId !== opened.job.id) {
            const saved = await this.credentials.read(`version-${archivedJobId}-${targetVersion}`)
            if (Object.keys(saved).length) await this.credentials.write(`version-${opened.job.id}-${targetVersion}`, saved)
          }
          const credentials = await this.readVersionCredentials(opened.job, expected, current.app_config)
          const checks: AppDocument[] = []
          for (const test of contract.verification?.cases ?? []) {
            const api = (contract.apis ?? []).find((a: AppDocument) => a.id === test.operation)
            if (!api || api.path === contract.health?.path || api.effect !== 'read') {
              throw new Error('回滚后必须使用有效的只读业务接口验证')
            }
            const res = await worker({ action: 'probe', root: opened.root, contract, operation: test.operation, params: test.params ?? {}, body: test.body, credentials,
              skill_markdown: opened.job.skillMarkdown }, scope.signal)
            if (!probeMatches(res, test.status ?? 200, test.json_contains)) {
              throw new Error(`回滚后业务验证失败：${test.operation}`)
            }
            checks.push({ operation: test.operation, status: res.status })
          }
          const latest = await this.platform(`/${slug}`, expected)
          if (latest.status !== 'running' || latest.current_version !== targetVersion || latest.app_url !== opened.job.url ||
              latest.config_fingerprint !== current.config_fingerprint || !matchesReceipt(latest.build_log, opened.job.hashes)) {
            throw new Error('回滚验证期间线上版本或配置发生变化')
          }
          if (checks.length > 0) {
            opened.job.checks = checks
            opened.job.failureStage = undefined
            opened.job.error = undefined
            opened.job.status = 'verified'
            opened.job.events.push(`已回退至 v${targetVersion}，历史技能与业务探针验证通过`)
            localSkillVerified = true
            verification = { status: 'verified-rolled-back' }
          } else if (Array.isArray(contract.pages) && contract.pages.length > 0 &&
              !(contract.apis ?? []).some((a: AppDocument) => a.path !== contract.health?.path)) {
            opened.job.status = 'awaiting_page_verification'
            opened.job.failureStage = undefined
            opened.job.error = undefined
            verification = { status: 'awaiting_page_verification', detail: '请打开页面完成人工验收' }
            opened.job.events.push(`已回退至 v${targetVersion}，请打开页面完成人工验收后启用技能`)
          } else {
            throw new Error('缺少只读业务验证，应用技能尚未启用')
          }
        } catch (error) {
          this.recordFailureState(opened.job, String(error), undefined, targetVersion, 'verification')
          verification = { status: 'probe-warning', detail: opened.job.error }
          opened.job.events.push(`已回退至 v${targetVersion}，请重新验证业务后启用技能`)
        }
      } else {
        this.recordFailureState(opened.job, '回滚完成，技能包或线上制品回执尚未核实', undefined, targetVersion, 'verification')
        verification = { status: 'probe-warning', detail: opened.job.error }
      }
      scope.assertCurrent()
      await this.save(opened.root, opened.job)
    }
    this.core.emit('skills-changed')
    return {
      ...rbResult,
      active_version: targetVersion,
      local_skill_synced: localSkillSynced,
      local_skill_verified: localSkillVerified,
      skill_enabled: localSkillVerified && !(await this.isSkillDisabled(scope.directory, slug)),
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
        await renameWithRetry(temp, path)
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
    return { job, root, signal: scope.signal, runtimeConfigs: remote.app_config as AppDocument[] | undefined }
  }
  async readSkillReference(id: string, expected: string, name: string, start: number, signal: AbortSignal) {
    const scope = this.scope(expected)
    const { job, root } = await this.verifiedJob(id, expected)
    const digest = job.hashes?.['skill.zip']
    if (!digest) throw new Error('当前技能没有已验证的技能包')
    const versionRoot = join(scope.directory, 'versions', job.slug, `v${job.version}`)
    const cachedVersion = existsSync(join(versionRoot, 'skill.zip'))
    if (!cachedVersion && !job.revision) throw new Error('当前技能没有可读取的技能包')
    return worker({ action: 'read_skill_reference', root: cachedVersion ? versionRoot : root,
      revision: cachedVersion ? undefined : job.revision, name, start, expected_sha256: digest },
    AbortSignal.any([scope.signal, signal]))
  }
  private async readVersionCredentials(job: DeliveryJob, expected: string, runtimeConfigs?: AppDocument[], operation?: string, signal?: AbortSignal) {
    if (!job.version && !job.requestId) return {}
    const config = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {}
    const contract = job.proposal!.contract
    const api = operation ? (contract.apis ?? []).find((item: AppDocument) => item.id === operation) : undefined
    const auth = api?.auth
    let credentialContract = contract
    if (operation) {
      credentialContract = auth?.type === 'header' || auth?.type === 'bearer'
        ? { apis: [api], auth_profile: auth.profile ? contract.auth_profiles?.[auth.profile] : contract.auth_profile }
        : {}
    }
    const authKeys = new Set(verificationCredentialFields(credentialContract).map(field => field.key))
    const rows: AppDocument[] = config.rows ? JSON.parse(config.rows) : []
    const selected = new Map(rows.filter(row => authKeys.has(row.key)).map(row => [row.key, row]))
    for (const row of runtimeConfigs ?? []) {
      if (authKeys.has(row.key) && (row.resource_id || row.value || !selected.has(row.key))) selected.set(row.key, row)
    }
    const configured = Object.fromEntries([...selected.values()].filter(row => !row.resource_id && row.value).map(row => [row.key, row.value]))
    const bound = [...selected.values()].filter(row => row.resource_id)
    const resolved = await this.resolveResourceValues(job.slug, bound.filter(row => typeof row.effective_value !== 'string'), expected, signal)
    for (const row of bound) {
      const value = row.effective_value ?? resolved[row.key]
      if (!value && job.proposal?.delivery_format === 1) throw new Error(`本应用的凭据资源未提供配置 ${row.key}`)
      if (typeof value !== 'string' || !value) continue
      configured[row.key] = value
    }
    const version = job.version ? await this.credentials.read(`version-${job.id}-${job.version}`) : {}
    const source = job.proposal?.delivery_format === 1 && job.revision
      ? await this.credentials.read(`skill-credentials-${job.id}-${job.revision}`)
      : {}
    const legacy = job.confirmationToken ? {} : await this.credentials.read(job.id)
    const current = job.proposal?.delivery_format === 1
      ? { ...legacy, ...source, ...version, ...configured }
      : { ...legacy, ...source, ...configured, ...version }
    return operation ? Object.fromEntries(Object.entries(current).filter(([key]) => authKeys.has(key))) : current
  }
  async invoke(id: string, operation: string, params: AppDocument, body: unknown, expected: string, approve: (reason: string) => Promise<boolean>, turn?: AbortSignal) {
    const { job, root, signal, runtimeConfigs } = await this.verifiedJob(id, expected)
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
    return worker({ action: 'probe', root, contract: job.proposal!.contract, operation, params, body, approved, strict_auth: job.proposal?.delivery_format === 1,
      credentials: await this.readVersionCredentials(job, expected, runtimeConfigs, operation, invocationSignal), skill_markdown: job.skillMarkdown }, invocationSignal).catch(error => {
      if (approved) throw new Error('操作结果未知，请先查询实际结果再决定下一步', { cause: error })
      throw error
    })
  }
}

function readStorageBindings(input: unknown): Record<string, string> {
  if (input === undefined) return {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('存储配置格式无效')
  const entries = Object.entries(input)
  if (entries.some(([path, id]) => !path.startsWith('/') || typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id))) {
    throw new Error('存储配置格式无效')
  }
  return Object.fromEntries(entries)
}
