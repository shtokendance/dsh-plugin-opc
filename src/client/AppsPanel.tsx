import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { followsDeploymentAttempt, type DeploymentAttemptProgress } from '../deployment-attempt.ts'
import type {
  AppConfigItem,
  AppDeliveryJob,
  AppModelGroup,
  AppStorageOverview,
  AppStorageMountDetail,
  AppVersionItem,
  AppVolumeBackupItem,
  DeployedApp,
  OpcApi,
  ResourceSummary,
} from './api.ts'
import type { ConfigChatAction, ConfigChatFrame, ConfigChatResult, ConfigChatRow } from '../config-chat.ts'
import { AppDeleteModal } from './AppDeleteModal.tsx'
import { AppDeliveryArtifacts } from './AppDeliveryArtifacts.tsx'
import { DeletedAppBackupsView } from './DeletedAppBackupsView.tsx'
import { getIntlLocale, useI18n, translate, type ClientLocale } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'
import {
  getConfigPublishIssues,
  mergeJobConfigs,
  sanitizeConfigRowsForApi,
  validateConfigsForPublish,
  type ConfigDraftSnapshot,
  type SourceConfiguration,
} from './app-config-helpers.ts'
import { AppDeliveryConfig } from './AppDeliveryConfig.tsx'
import { AppDeliveryReview } from './AppDeliveryReview.tsx'
import type { PrepareAnalysisNavigation } from './app-analysis-navigation.tsx'
import { AppIcon } from './AppIcon.tsx'
import { AppSkillPreview } from './AppSkillPreview.tsx'
import { toAppSlug } from './appSlug.ts'
import { appsCss } from './appsStyles.ts'
import { DEFAULT_PAGE_SIZE, Pagination, paginateItems, paginationStyles } from './Pagination.tsx'

type ViewMode = 'list' | 'wizard' | 'detail' | 'backups'
type WizardStep = 1 | 2 | 3 | 4
type ConfigSubTab = 'configs' | 'skill' | 'dockerfile' | 'mounts'
type RuntimeOperation = {
  id: string
  kind: 'restart' | 'config' | 'restore' | 'baseline'
  state: 'pending' | 'restarting' | 'checking' | 'restoring' | 'unknown' | 'recovery_unknown' | 'failed' | 'restored' | 'succeeded'
  message: string
  config_number?: number
  config_revision?: string
  changed_keys?: string
  created_by?: string
  created_at?: string
}
type RuntimeManagementStatus = {
  operation: RuntimeOperation | null
  revisions: RuntimeOperation[]
  config_revision: string
  config_number: number
  editable_keys: string[]
}
type RuntimeApp = Pick<DeployedApp, 'slug' | 'name' | 'current_version'>
type RuntimeCommand = {
  kind: 'restart' | 'config' | 'restore' | 'recheck'
  operation_id?: string
  base_version?: number
  base_config_revision?: string
  changes?: Record<string, string>
}
function runtimeOperationBusy(operation?: RuntimeOperation | null) {
  return Boolean(operation && ['pending', 'restarting', 'checking', 'restoring'].includes(operation.state))
}
function runtimeOperationNeedsCheck(operation?: RuntimeOperation | null) {
  return Boolean(operation && (operation.state === 'unknown' || operation.state === 'recovery_unknown' || (operation.state === 'failed' && operation.kind === 'restart')))
}

type DetailTab = 'artifacts' | 'configs' | 'storage' | 'versions' | 'logs'
type LogSubTab = 'runtime' | 'build' | 'dockerfile'

type ConfigChatEdit = { before: AppConfigItem; after: AppConfigItem }

function configChatRow(item: AppConfigItem, resources: ResourceSummary[], mounts: AppStorageMountDetail[]): ConfigChatRow {
  const resource = resources.find(resource => resource.id === item.resource_id)
  const preview = resource?.env_preview?.[item.resource_key || item.key]
  const value = item.resource_id
    ? preview && preview !== '[REDACTED]' ? preview : item.effective_value ?? ''
    : item.value || (item.value_source !== 'generated' && item.value_source !== 'configured' ? item.app_default || '' : '')
  let blocked: string | undefined
  if (item.key === 'PORT' || ['HOST', 'BIND_HOST', 'LISTEN_HOST'].includes(item.key)) blocked = '监听地址和端口由改造方案确定，请返回核对方案'
  else if (item.resource_id) blocked = '已绑定平台资源，请返回核对方案后变更'
  else if (mounts.some(mount => value === mount.container_path || value.startsWith(mount.container_path + '/'))) {
    blocked = '此值指向持久化目录，请返回核对方案后变更'
  }
  return { key: item.key, value, description: item.description, source: resource?.name || item.resource_id || item.value_source, blocked }
}

interface OpcRuntimeConfig {
  appDomainRoot: string
  defaultPort: number
  platformBaseUrl: string
}

const SLUG_RE = /^[a-z][a-z0-9-]{2,39}$/
const MAX_ZIP_BYTES = 64 * 1024 * 1024
const DRAFT_DISMISS_STORAGE_PREFIX = 'opc-apps-dismissed-draft:'
const DEFAULT_OPC_CONFIG: OpcRuntimeConfig = {
  appDomainRoot: 'ai.benlai.com',
  defaultPort: 8080,
  platformBaseUrl: '',
}
const ROLLBACK_NOTICE =
  '版本回滚会重新激活历史版本的代码、交付产物、运行配置与容器镜像；不会自动回退已写入持久化卷或外部数据库中的业务数据。'

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!error) return fallback
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/^Error:\s*/i, '').trim()
  if (!cleaned) return fallback
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(cleaned.slice(jsonStart)) as { detail?: unknown; error?: unknown; message?: unknown }
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail.trim()
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    } catch {
      // Ignore JSON parsing failure and fall back to raw cleaned message.
    }
  }
  return cleaned
}

function formatLogOutput(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let text = raw.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      const unquoted = JSON.parse(text)
      if (typeof unquoted === 'string') text = unquoted
    } catch {
      // Keep original string if not JSON encoded.
    }
  }
  return text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim()
}

function formatDateTime(raw?: string | null): string {
  if (!raw) return '-'
  const ts = Date.parse(raw)
  if (Number.isNaN(ts)) return raw
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ts)
  } catch {
    return raw
  }
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('读取 ZIP 文件失败'))
    reader.readAsDataURL(file)
  })
}

function triggerBrowserDownload(filename: string, base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function jobStatusTone(status?: string, userDisabled?: boolean, locale: ClientLocale = 'zh'): { text: string; pillClass: string; spinning?: boolean } {
  switch (status) {
    case 'running':
      return { text: translate(locale, "apps.running"), pillClass: 'oa-pill-ok' }
    case 'verified':
      return userDisabled
        ? { text: translate(locale, "apps.skillDisabled"), pillClass: 'oa-pill-warn' }
        : { text: translate(locale, "apps.liveAndSkillReady"), pillClass: 'oa-pill-ok' }
    case 'awaiting_page_verification':
      return { text: translate(locale, "apps.awaitingPageVerify"), pillClass: 'oa-pill-warn' }
    case 'skill_disabled':
      return { text: translate(locale, "apps.skillDisabled_2"), pillClass: 'oa-pill-warn' }
    case 'verification_failed':
      return { text: translate(locale, "apps.verifyFailed"), pillClass: 'oa-pill-danger' }
    case 'failed':
    case 'unhealthy':
      return { text: translate(locale, "apps.failed"), pillClass: 'oa-pill-danger' }
    case 'unknown':
      return { text: translate(locale, "apps.statusUnknown"), pillClass: 'oa-pill-warn' }
    case 'building':
      return { text: translate(locale, "apps.building"), pillClass: 'oa-pill-accent', spinning: true }
    case 'verifying':
      return { text: translate(locale, "apps.verifying"), pillClass: 'oa-pill-teal', spinning: true }
    case 'analyzing':
    case 'preparing':
    case 'importing':
      return { text: translate(locale, "apps.analyzing"), pillClass: 'oa-pill-accent', spinning: true }
    case 'review':
      return { text: translate(locale, "apps.reviewPlan"), pillClass: 'oa-pill-warn' }
    case 'ready':
      return { text: translate(locale, "apps.readyToPublish"), pillClass: 'oa-pill-accent' }
    case 'draft':
    default:
      return { text: translate(locale, "apps.draft"), pillClass: '' }
  }
}

type AppHealthCheck = { ok: boolean; status: 'running' | 'failed' | 'unhealthy'; message: string }

function healthFailureDetail(message?: string): string {
  return message && !/^HTTP\s+2\d{2}\b/i.test(message.trim()) ? message : ''
}

function readAppHealthCheck(raw: string): AppHealthCheck {
  const check = parseJson<{
    ok?: boolean; healthy?: boolean; status?: string; message?: string; detail?: string; error?: string
    container_running?: boolean
  } | null>(raw, null)
  const ok = check?.ok ?? check?.healthy
  if (!check || typeof ok !== 'boolean') throw new Error('未收到有效的健康检查结果')
  const reported = healthFailureDetail(check.message || check.detail || check.error)
  const status = ok ? 'running' : check.container_running === false || check.status === 'failed' ? 'failed' : 'unhealthy'
  const message = ok ? '健康检查通过，应用正常运行。'
    : check.container_running === false ? '健康检查未通过：应用容器未运行。'
    : reported ? `健康检查未通过：${reported}` : '健康检查未通过，请查看服务器日志。'
  return { ok, status, message }
}

function isResumableJob(job: AppDeliveryJob): boolean {
  if (!job || !job.id || job.superseded) return false
  return [
    'draft',
    'importing',
    'analyzing',
    'review',
    'preparing',
    'ready',
    'building',
    'publishing',
    'verifying',
    'awaiting_page_verification',
    'unknown',
    'failed',
    'cancelled',
    'verification_failed',
  ].includes(job.status)
}

function isVerificationPending(job: AppDeliveryJob) {
  return job.status === 'awaiting_page_verification' || job.status === 'verification_failed' ||
    (job.status === 'failed' && job.failureStage === 'verification')
}

function isUpgradeTargetMissing(job: AppDeliveryJob, apps: DeployedApp[] | undefined) {
  return job.upgrade === true && apps !== undefined && !apps.some(app => app.slug === job.slug)
}

function showTaskBanner(job: AppDeliveryJob, apps: DeployedApp[] | undefined) {
  if (!isResumableJob(job) || isUpgradeTargetMissing(job, apps)) return false
  if (!job.published || !isVerificationPending(job)) return true
  // A previous version running must not hide an unfinished upgrade.
  return apps !== undefined && !apps.some(app => app.status === 'running' && app.slug === job.slug &&
    job.version != null && app.current_version === job.version)
}

function findAppJob(jobs: AppDeliveryJob[], app: Pick<DeployedApp, 'slug' | 'current_version'>): AppDeliveryJob | undefined {
  const forSlug = jobs.filter(job => job.slug === app.slug)
  return (
    forSlug.find(job => !job.superseded && app.current_version != null && job.version === app.current_version) ??
    forSlug.find(job => !job.superseded) ??
    forSlug[0]
  )
}

const attemptLabels: Record<DeploymentAttemptProgress['phase'], string> = {
  submitting: '正在提交部署',
  submission_rejected: '部署未提交',
  blocked_previous: '上一轮部署仍在处理',
  unknown: '暂时无法确认部署进度',
  queued: '等待构建',
  building: '正在构建镜像',
  preparing: '正在准备运行环境',
  migrating: '正在迁移数据',
  starting: '正在启动应用',
  checking_domain: '正在检查应用域名',
  confirming: '正在确认发布结果',
  succeeded: '部署成功',
  cancelling: '正在取消并清理',
  cleaning: '正在清理本次部署',
  cancelled: '已取消部署',
  restoring: '正在恢复应用服务',
  restored: '已恢复上一版本',
  failed: '部署失败',
  recovery_required: '需要平台处理后恢复',
}

function displayedAttempt(job: AppDeliveryJob) {
  const attempt = job.deploymentProgress
  if ((job.assessmentPending || (job.status === 'verifying' && job.deploymentCheck !== 'domain')) &&
      attempt && ['preparing', 'starting'].includes(attempt.phase)) return undefined
  return attempt
}

function attemptLabel(job: AppDeliveryJob, phase: DeploymentAttemptProgress['phase'], stalled = false) {
  if (phase === 'starting') {
    return stalled ? (job.upgrade ? '新版本启动比预期久' : '应用启动比预期久')
      : (job.upgrade ? '正在启动新版本' : attemptLabels.starting)
  }
  if (phase === 'failed') {
    switch (job.deploymentProgress?.failure_kind) {
      case 'build': return '镜像构建失败'
      case 'startup': return '应用启动失败'
      case 'domain': return '应用域名无法访问'
    }
  }
  return stalled ? (phase === 'cancelling' ? '正在取消，清理比预期久'
    : phase === 'cleaning' ? '本次部署清理比预期久'
    : phase === 'restoring' ? '应用恢复比预期久'
    : phase === 'checking_domain' ? '应用域名暂未就绪'
    : phase === 'queued' ? '构建排队比预期久'
    : phase === 'building' ? '镜像构建比预期久'
    : phase === 'migrating' ? '数据迁移比预期久'
    : attemptLabels[phase]) : attemptLabels[phase]
}

function elapsedAttemptTime(started?: number) {
  if (!started || started <= 0) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000))
  if (!minutes) return '不到 1 分钟'
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`
}

function deploymentProgress(job: AppDeliveryJob) {
  const attempt = displayedAttempt(job)
  if (attempt) {
    if (attempt.phase === 'succeeded' && job.status !== 'verified') return { label: attemptLabels.confirming, tone: 'warn' }
    const tone = attempt.phase === 'succeeded' ? 'ok' : ['failed', 'recovery_required', 'submission_rejected'].includes(attempt.phase)
      ? 'danger' : followsDeploymentAttempt(attempt) ? 'warn' : 'accent'
    return { label: attemptLabel(job, attempt.phase, attempt.stalled), tone }
  }
  if (job.archivedRevision) {
    if (job.status === 'verified') return { label: '部署成功', tone: 'ok' }
    if (job.assessmentPending) return { label: 'AI 验收已暂停', tone: 'danger' }
    if (job.status === 'failed') return { label: '部署失败', tone: 'danger' }
    if (job.status === 'verifying') return { label: 'AI 正在验收', tone: 'warn' }
  }
  if (job.status === 'verified' || job.status === 'verifying' || isVerificationPending(job)) {
    return { label: '部署成功', tone: 'ok' }
  }
  if (job.status === 'failed') return { label: '部署失败', tone: 'danger' }
  if (job.status === 'unknown') return { label: '正在核对发布结果…', tone: 'warn' }
  return { label: '正在构建部署…', tone: 'warn' }
}

function describeDeploymentStartup(job: AppDeliveryJob): string {
  const check = job.startupCheck
  if (!check) return '平台未返回应用启动检查结果。'
  if (job.status === 'verified' && check.target_running && check.domain_reachable &&
      check.active_version_running && check.active_version === job.version) return '本次版本已生效，应用域名可访问。'
  if (check.target_running) return check.domain_reachable
    ? '本次镜像已启动，应用域名可访问。平台尚未确认本次发布成功。'
    : '本次镜像已启动，应用域名暂时无法访问。'
  if (check.active_version_running && check.active_version > 0) return check.domain_reachable
    ? `应用域名可访问，运行的是版本 v${check.active_version}。本次部署尚未生效。`
    : `版本 v${check.active_version} 的容器正在运行，应用域名暂时无法访问。`
  return check.domain_reachable ? '应用域名有响应，但未能确认本次镜像已启动。' : '未能确认本次镜像已启动，应用域名暂时无法访问。'
}

function blockedByPreviousBuild(job: AppDeliveryJob) {
  const deploymentError = (job.error ?? '').split('; previous version recovery failed:', 1)[0]
  return job.failureStage === 'deployment' && /1108/.test(deploymentError) &&
    /Build in-progress for /i.test(deploymentError)
}

const isDeploymentInProgress = (status?: string) =>
  status === 'publishing' || status === 'building' || status === 'verifying' || status === 'unknown'

function DeploymentLogs({ fetchLogs, live, buildOnly, onCopy, copied }: {
  fetchLogs: () => Promise<string>
  live: boolean
  buildOnly: boolean
  onCopy: (text: string) => void
  copied: boolean
}) {
  const [open, setOpen] = useState(true)
  const [logs, setLogs] = useState('')
  const [error, setError] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const followTail = useRef(true)
  const terminalId = useId()
  useEffect(() => {
    if (!open) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const data = JSON.parse(await fetchLogs()) as { build_log?: string; runtime_logs?: string; logs?: string; content?: string; logs_unavailable?: boolean }
        const build = formatLogOutput(data.build_log)
        const runtime = buildOnly ? '' : formatLogOutput(data.runtime_logs ?? data.logs ?? data.content)
        const output = build && runtime && runtime !== build ? `${build}\n\n运行日志\n${runtime}` : build || runtime
        if (!active) return
        if (output) setLogs(current => data.logs_unavailable && current ? current : output)
        setError(Boolean(data.logs_unavailable))
      } catch {
        if (active) setError(true)
      } finally {
        if (active && live) timer = window.setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => { active = false; window.clearTimeout(timer) }
  }, [buildOnly, fetchLogs, live, open])
  useEffect(() => {
    const log = logRef.current
    if (log && followTail.current) log.scrollTop = log.scrollHeight
  }, [logs, open])

  return (
    <section className={`oa-deploy-logs${open ? ' is-open' : ''}`}>
      <div className="oa-deploy-log-toolbar">
        <button type="button" className="oa-deploy-log-toggle" aria-expanded={open} aria-controls={open ? terminalId : undefined} onClick={() => setOpen(current => !current)}>
          <AppIcon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          本次部署日志
        </button>
        {open && logs && <button type="button" className="oa-btn oa-btn-xs" onClick={() => onCopy(logs)}>
          <AppIcon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? '已复制' : '复制日志'}
        </button>}
      </div>
      {open && (
        <div className="oa-deploy-log-content" id={terminalId}>
          {error && <p className="oa-hint" role="status">{live ? '暂时无法读取最新日志，将自动重试。' : '暂时无法读取日志，可重新展开查看。'}</p>}
          <pre
            className="oa-log-terminal"
            tabIndex={0}
            aria-label="本次部署日志内容"
            ref={logRef}
            onScroll={event => {
              const element = event.currentTarget
              followTail.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 20
            }}
          >{logs || '等待输出…'}</pre>
        </div>
      )}
    </section>
  )
}

function inferStepForJob(job: AppDeliveryJob): WizardStep {
  if (job.deploymentProgress && (job.requestId || job.published)) return 4
  switch (job.status) {
    case 'ready':
      return job.deploymentReviewPending ? 2 : 3
    case 'building':
    case 'publishing':
    case 'verifying':
    case 'awaiting_page_verification':
    case 'verification_failed':
    case 'verified':
    case 'unknown':
      return 4
    case 'failed':
      if (job.failureStage === 'import') return 1
      if (job.failureStage === 'deployment' || job.failureStage === 'verification') return 4
      if (job.failureStage === 'analysis' || job.failureStage === 'preparation' || job.analysis_failure && !job.published) return 2
      if (job.published) return 4
      if (job.proposal) return 2
      return 1
    case 'draft':
    case 'importing':
    case 'analyzing':
    case 'review':
    case 'preparing':
    default:
      return 2
  }
}

export function AppsPanel({
  api,
  sessionId,
  contextId,
  refreshSignal = 0,
  active = true,
  prepareAnalysisNavigation,
}: {
  api: OpcApi
  sessionId: string
  contextId: string
  refreshSignal?: number
  active?: boolean
  prepareAnalysisNavigation?: PrepareAnalysisNavigation
}) {
  const { locale, t } = useI18n()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [loadingLinkedJob, setLoadingLinkedJob] = useState(Boolean(api.appJobByAnalysisSession))
  const [linkedJob, setLinkedJob] = useState<AppDeliveryJob | null>(null)
  const restoredLinkedJob = useRef(false)
  const analysisViewActive = useRef(false)
  useEffect(() => {
    analysisViewActive.current = active && viewMode === 'wizard'
    return () => { analysisViewActive.current = false }
  }, [active, viewMode])
  const beginAnalysisNavigation = () =>
    prepareAnalysisNavigation?.(sessionId, contextId, () => analysisViewActive.current)
  const [loadingList, setLoadingList] = useState(true)
  const [appsPage, setAppsPage] = useState(1)
  const [appsPageSize, setAppsPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [{ apps, jobs, loaded: appDirectoryLoaded }, setAppDirectory] = useState({
    apps: [] as DeployedApp[],
    jobs: [] as AppDeliveryJob[],
    loaded: false,
  })
  const knownApps = appDirectoryLoaded ? apps : undefined
  const [resources, setResources] = useState<ResourceSummary[]>([])
  const [opcConfig, setOpcConfig] = useState<OpcRuntimeConfig>(DEFAULT_OPC_CONFIG)
  const [modelGroups, setModelGroups] = useState<AppModelGroup[]>([])

  const [bannerError, setBannerError] = useState<string | null>(null)
  const [bannerNotice, setBannerNotice] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [dismissedDraftToken, setDismissedDraftToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(DRAFT_DISMISS_STORAGE_PREFIX + contextId) || ''
    } catch {
      return ''
    }
  })

  // Wizard State
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)
  const [wizardJob, setWizardJob] = useState<AppDeliveryJob | null>(null)
  const [wizardBusy, setWizardBusy] = useState(false)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [wizardNotice, setWizardNotice] = useState<string | null>(null)
  const [startupRecheck, setStartupRecheck] = useState<{ key: string; pending?: boolean; message?: string; error?: boolean }>()

  // Step 1 Form State
  const [upgradeTarget, setUpgradeTarget] = useState<DeployedApp | null>(null)
  const [previousJobId, setPreviousJobId] = useState<string | undefined>(undefined)
  const upgradingStep1 = Boolean(
    upgradeTarget ||
      (previousJobId && wizardJob?.id === previousJobId && (wizardJob.upgrade || wizardJob.published)),
  )
  const [appName, setAppName] = useState('')
  const [appSlug, setAppSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [appDescription, setAppDescription] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [reuseSourceVersion, setReuseSourceVersion] = useState<number>()
  const [dragActive, setDragActive] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState('')
  const [slugCheck, setSlugCheck] = useState<{ checking: boolean; available?: boolean; app_url?: string; error?: string }>({
    checking: false,
  })
  const isComposingRef = useRef(false)
  const isSlugComposingRef = useRef(false)
  const sourcePathInputRef = useRef<HTMLInputElement>(null)
  const sourceSelection = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Step 2 Footer Bridge
  const [step2State, setStep2State] = useState<{ jobId: string; canContinue: boolean; triggerNext: () => void } | null>(null)

  // Step 3 Config & Check State
  const [configSubTab, setConfigSubTab] = useState<ConfigSubTab>('configs')
  const [configDrafts, setConfigDrafts] = useState<AppConfigItem[]>([])
  const latestConfigDrafts = useRef<AppConfigItem[]>([])
  const replaceConfigDrafts = useCallback((rows: AppConfigItem[]) => {
    latestConfigDrafts.current = rows
    setConfigDrafts(rows)
  }, [])
  const draftTransition = useRef(false)
  const [aiConfigEdits, setAiConfigEdits] = useState<ConfigChatEdit[]>([])
  const [configChatStatus, setConfigChatStatus] = useState<'connecting' | 'ready' | 'unavailable'>('connecting')
  const [configChatError, setConfigChatError] = useState('')
  const [configChatReconnect, setConfigChatReconnect] = useState(0)
  const [step3Load, setStep3Load] = useState<{ jobId: string; artifactHash?: string; contextId: string; status: 'loading' | 'ready' | 'failed'; error?: string }>()
  const step3Request = useRef(0)
  const currentStep3Load = step3Load?.contextId === contextId && step3Load.jobId === wizardJob?.id &&
    step3Load.artifactHash === wizardJob?.artifactHash ? step3Load : undefined
  const step3Ready = currentStep3Load?.status === 'ready'
  const step3Loading = !step3Ready && currentStep3Load?.status !== 'failed'
  const skillDrivenDelivery = wizardJob?.proposal?.delivery_format === 1
  const configIssues = getConfigPublishIssues(configDrafts, wizardJob?.port ?? opcConfig.defaultPort, skillDrivenDelivery)
  const hasConfigIssues = configIssues.size > 0
  const [jobResources, setJobResources] = useState<ResourceSummary[]>()
  const deploymentResources = jobResources ?? resources
  const [storageBindings, setStorageBindings] = useState<Record<string, string>>({})
  const [existingStorage, setExistingStorage] = useState<AppStorageMountDetail[]>([])
  const volumeResources = deploymentResources.filter(resource => ['local-directory', 'docker-volume', 'aliyun-oss-volume'].includes(resource.type))
  const volumeMounts = wizardJob?.proposal?.contract?.storage_mounts ?? []
  const volumeOptions = (mount: AppStorageMountDetail) =>
    volumeResources.filter(resource => mount.kind !== 'sqlite' || resource.type !== 'aliyun-oss-volume')
  const storageSelections = Object.fromEntries(volumeMounts
    .filter(mount => !existingStorage.some(old => old.container_path === mount.container_path))
    .map(mount => {
      const options = volumeOptions(mount)
      const selected = options.find(resource => resource.id === (storageBindings[mount.container_path] ?? mount.resource_id))
      const fallback = skillDrivenDelivery ? undefined : options.find(resource => resource.is_default) ?? options[0]
      return [mount.container_path, (selected ?? fallback)?.id ?? '']
    }))
  const hasMissingStorage = volumeMounts.some(mount => !mount.container_path) || Object.values(storageSelections).some(id => !id)

  const [originalConfigs, setOriginalConfigs] = useState<AppConfigItem[]>([])
  const [sourceConfiguration, setSourceConfiguration] = useState<SourceConfiguration | null>(null)
  const [preparedDockerfile, setPreparedDockerfile] = useState<{ jobId: string; artifactHash?: string; content: string }>()
  const [versionNote, setVersionNote] = useState('')
  const draftSaveTimerRef = useRef<number | null>(null)
  const draftSaveRequest = useRef<Promise<void>>(Promise.resolve())

  // Step 4 Publish & Verify State

  // Detail View State
  const [detailApp, setDetailApp] = useState<DeployedApp | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('configs')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [runtimePanel, setRuntimePanel] = useState<{ app: RuntimeApp; confirmRestart: boolean } | null>(null)
  const [runtimeData, setRuntimeData] = useState<{ slug: string; status: RuntimeManagementStatus } | null>(null)
  const [runtimeError, setRuntimeError] = useState<{ slug: string; message: string } | null>(null)
  const [runtimeSubmitting, setRuntimeSubmitting] = useState(false)
  const [runtimeRefresh, setRuntimeRefresh] = useState(0)
  const [runtimeDraft, setRuntimeDraft] = useState<Record<string, string>>({})
  const [showRuntimeHistory, setShowRuntimeHistory] = useState(false)
  const refreshedRuntimeOperation = useRef<string | null>(null)
  const runtimeContext = useRef(contextId)
  runtimeContext.current = contextId
  const [detailNotice, setDetailNotice] = useState<string | null>(null)
  const [detailHealthCheck, setDetailHealthCheck] = useState<(AppHealthCheck & { slug: string }) | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const detailLoad = useRef(0)
  const formId = useId()
  const [versions, setVersions] = useState<AppVersionItem[]>([])
  const [storageOverview, setStorageOverview] = useState<AppStorageOverview | null>(null)
  const [volumeBackups, setVolumeBackups] = useState<AppVolumeBackupItem[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editPort, setEditPort] = useState<string>('8080')
  const [editConfigs, setEditConfigs] = useState<AppConfigItem[]>([])
  const [detailLogsSubTab, setDetailLogsSubTab] = useState<LogSubTab>('runtime')
  const [detailLogsData, setDetailLogsData] = useState<{ runtime: string; build: string; dockerfile: string }>({
    runtime: '',
    build: '',
    dockerfile: '',
  })
  const [rollbackTarget, setRollbackTarget] = useState<AppVersionItem | null>(null)
  const [rollbackReason, setRollbackReason] = useState('')

  const copyText = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1800)
    } catch {
      // Fallback ignored if clipboard permission unavailable.
    }
  }, [])

  const loadVolumeBackups = useCallback(async () => {
    if (!api.appVolumeBackupsList) return
    setLoadingBackups(true)
    try {
      const raw = await api.appVolumeBackupsList(contextId)
      const parsed = parseJson<{ backups?: AppVolumeBackupItem[] }>(raw, {})
      setVolumeBackups(Array.isArray(parsed.backups) ? parsed.backups : [])
    } catch {
      setVolumeBackups([])
    } finally {
      setLoadingBackups(false)
    }
  }, [api, contextId])

  const loadWorkspaceData = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingList(true)
      try {
        const [catalogRaw, jobsRaw, resourcesRaw, configRaw, modelsRaw, backupsRaw] = await Promise.all([
          api.appCatalog(contextId),
          api.appList(contextId).catch(() => '[]'),
          api.appResources(contextId).catch(() => '{"resources":[]}'),
          api.appOpcConfig?.(contextId).catch(() => '{}') ?? Promise.resolve('{}'),
          api.appModels(contextId).catch(() => '[]'),
          api.appVolumeBackupsList?.(contextId).catch(() => '{"backups":[]}') ?? Promise.resolve('{"backups":[]}'),
        ])
        const catalogData = parseJson<{ apps?: DeployedApp[] } | null>(catalogRaw, null)
        if (!Array.isArray(catalogData?.apps) || catalogData.apps.some(app => typeof app?.slug !== 'string')) {
          throw new Error('未收到有效的企业应用目录')
        }
        const jobList = parseJson<AppDeliveryJob[]>(jobsRaw, [])
        const resData = parseJson<{ resources?: ResourceSummary[] }>(resourcesRaw, { resources: [] })
        const cfg = parseJson<Partial<OpcRuntimeConfig>>(configRaw, {})
        const models = parseJson<AppModelGroup[]>(modelsRaw, [])
        const backupsData = parseJson<{ backups?: AppVolumeBackupItem[] }>(backupsRaw, { backups: [] })

        setAppDirectory({
          apps: catalogData.apps,
          jobs: Array.isArray(jobList) ? jobList : [],
          loaded: true,
        })
        setResources(Array.isArray(resData.resources) ? resData.resources : [])
        setVolumeBackups(Array.isArray(backupsData.backups) ? backupsData.backups : [])
        setOpcConfig({
          appDomainRoot: cfg.appDomainRoot || DEFAULT_OPC_CONFIG.appDomainRoot,
          defaultPort:
            Number.isInteger(cfg.defaultPort) && cfg.defaultPort! >= 1 && cfg.defaultPort! <= 65535
              ? cfg.defaultPort!
              : DEFAULT_OPC_CONFIG.defaultPort,
          platformBaseUrl: cfg.platformBaseUrl || '',
        })
        setModelGroups(Array.isArray(models) ? models : [])
      } catch (error) {
        setBannerError(readErrorMessage(error, '加载企业应用目录失败'))
      } finally {
        if (!silent) setLoadingList(false)
      }
    },
    [api, contextId],
  )

  useEffect(() => {
    void loadWorkspaceData(false)
  }, [loadWorkspaceData, refreshSignal])

  const selectedModelGroup = modelGroups.find(g => g.id === selectedProvider)
  const selectedModelItem = selectedModelGroup?.models.find(m => m.id === selectedModel)
  const availableEfforts = selectedModelItem?.reasoning?.efforts ?? []

  // Debounced slug check in Step 1 (new app only)
  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 1 || upgradingStep1) {
      setSlugCheck({ checking: false })
      return
    }
    const clean = appSlug.trim()
    if (!clean) {
      setSlugCheck({ checking: false })
      return
    }
    if (!SLUG_RE.test(clean)) {
      setSlugCheck({ checking: false, available: false, error: '需为 3–40 位小写字母、数字或短横线，且以字母开头' })
      return
    }
    if (!api.appCheckSlug) {
      setSlugCheck({
        checking: false,
        available: !apps.some(a => a.slug === clean),
        app_url: `http://${clean}.${opcConfig.appDomainRoot}`,
      })
      return
    }
    let cancelled = false
    setSlugCheck({ checking: true })
    const timer = window.setTimeout(() => {
      void api
        .appCheckSlug!(clean, contextId)
        .then(raw => {
          if (cancelled) return
          const res = parseJson<{ available?: boolean; app_url?: string }>(raw, {})
          setSlugCheck({
            checking: false,
            available: Boolean(res.available),
            app_url: res.app_url || `http://${clean}.${opcConfig.appDomainRoot}`,
            error: res.available ? undefined : '该应用标识已被占用',
          })
        })
        .catch(err => {
          if (cancelled) return
          setSlugCheck({ checking: false, error: readErrorMessage(err, '标识校验失败') })
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [api, appSlug, apps, contextId, opcConfig.appDomainRoot, upgradingStep1, viewMode, wizardStep])

  const refreshWizardJob = useCallback(
    async (jobId: string): Promise<AppDeliveryJob | null> => {
      try {
        const raw = api.appJob ? await api.appJob(jobId, contextId) : await api.appList(contextId)
        const parsed = api.appJob
          ? parseJson<AppDeliveryJob | null>(raw, null)
          : parseJson<AppDeliveryJob[]>(raw, []).find(j => j.id === jobId) ?? null
        if (parsed) {
          setWizardJob(parsed)
        }
        return parsed
      } catch {
        return null
      }
    },
    [api, contextId],
  )

  const syncStep3Drafts = useCallback(
    async (job: AppDeliveryJob) => {
      const request = ++step3Request.current
      const target = { jobId: job.id, artifactHash: job.artifactHash, contextId }
      setStep3Load({ ...target, status: 'loading' })
      try {
        const [draftRaw, detailsRaw] = await Promise.all([
          api.appConfigDraft?.(job.id, contextId),
          job.upgrade || job.published ? api.appDetails(job.slug, contextId) : undefined,
        ])
        if (request !== step3Request.current) return
        const draft = draftRaw === undefined ? null : JSON.parse(draftRaw) as ConfigDraftSnapshot | null
        if (api.appConfigDraft && (!draft || draft.artifactHash && draft.artifactHash !== job.artifactHash)) {
          throw new Error('交付包已变化，请返回核对方案后重试。')
        }
        if (job.proposal?.delivery_format === 1 && !draft) throw new Error('当前插件无法读取本次交付数据。')
        const detail = detailsRaw === undefined ? null : JSON.parse(detailsRaw) as DeployedApp | null
        if ((job.upgrade || job.published) && !detail) throw new Error('无法读取当前生效版本的配置和挂载。')
        const declarations = new Map(job.runtime_configs?.map(item => [item.key, item]))
        const plans = new Map(job.proposal?.contract?.configs?.map(item => [item.key, item.value_plan?.kind]))
        const inherited = job.proposal?.delivery_format === 1
          ? (detail?.app_config ?? []).filter(item => declarations.has(item.key) && (!plans.get(item.key) || plans.get(item.key) === 'inherit') && !draft?.rows?.some(row => row.key === item.key))
            .map(item => ({ key: item.key, value: item.value, effective_value: item.effective_value,
              has_value: item.has_value || Boolean(item.value), value_source: item.resource_id ? 'resource' : 'configured',
              resource_id: item.resource_id, resource_key: item.resource_key }))
          : []
        const { configs, originals } = mergeJobConfigs(job, { ...draft, rows: [...inherited, ...(draft?.rows ?? [])] }, opcConfig.defaultPort)
        setJobResources(draft?.resources)
        setSourceConfiguration(draft?.sourceConfiguration ?? null)
        setPreparedDockerfile({ jobId: job.id, artifactHash: job.artifactHash, content: draft?.dockerfile ?? '' })
        setOriginalConfigs(originals)
        replaceConfigDrafts(configs)
        setAiConfigEdits([])
        setVersionNote(draft?.versionNote ?? job.versionNote ?? '')
        setStorageBindings(draft?.storageBindings ?? {})
        setExistingStorage(detail?.storage_mounts ?? [])
        setStep3Load({ ...target, status: 'ready' })
      } catch (error) {
        if (request === step3Request.current) setStep3Load({ ...target, status: 'failed', error: readErrorMessage(error, '部署内容加载失败') })
      }
    },
    [api, contextId, opcConfig.defaultPort, replaceConfigDrafts],
  )

  const progressJobId = wizardJob?.id
  const progressRequestKey = `${progressJobId ?? ''}:${wizardJob?.requestId ?? ''}`
  const progressStatus = wizardJob?.status
  const watchingAttempt = followsDeploymentAttempt(wizardJob?.deploymentProgress)
  const hasAttemptProgress = Boolean(wizardJob?.deploymentProgress)
  const progressSlug = wizardJob?.slug
  const progressUsesReceipt = Boolean(wizardJob?.archivedRevision)
  const fetchDeploymentLogs = useCallback(
    async () => {
      if (progressUsesReceipt && api.appDeploymentLogs && progressJobId) return api.appDeploymentLogs(progressJobId, contextId)
      if (!api.appLogs || !progressSlug) throw new Error('没有可查询的部署日志')
      return api.appLogs(progressSlug, contextId)
    },
    [api, contextId, progressJobId, progressSlug, progressUsesReceipt],
  )

  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 4 || !progressJobId || wizardBusy ||
        !(watchingAttempt || isDeploymentInProgress(progressStatus))) return
    let alive = true
    let timer: number
    const poll = async () => {
      let keepPolling = true
      try {
        const raw = !hasAttemptProgress && (progressStatus === 'verifying' || progressStatus === 'publishing') && api.appJob
          ? await api.appJob(progressJobId, contextId)
          : await (api.appVerifyWithOptions
            ? api.appVerifyWithOptions(progressJobId, JSON.stringify({ automatic: true }), contextId)
            : api.appVerify(progressJobId, contextId))
        if (!alive) return
        const updated = JSON.parse(raw) as AppDeliveryJob
        setWizardError(null)
        setWizardJob(current => current?.id === updated.id ? updated : current)
        keepPolling = followsDeploymentAttempt(updated.deploymentProgress) || isDeploymentInProgress(updated.status)
        if (!keepPolling) void loadWorkspaceData(true)
      } catch (error) {
        if (!alive) return
        setWizardError(readErrorMessage(error, '暂时无法核对部署状态，将继续查询'))
      } finally {
        if (alive && keepPolling) timer = window.setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [api, contextId, loadWorkspaceData, progressJobId, progressStatus, viewMode, wizardBusy, wizardStep, watchingAttempt, hasAttemptProgress])

  // Load Step 3 draft data when entering Step 3
  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 3 || !wizardJob) return
    void syncStep3Drafts(wizardJob)
    return () => { step3Request.current++ }
  }, [syncStep3Drafts, viewMode, wizardJob?.id, wizardJob?.artifactHash, wizardStep])

  // Open Detail View & load all 5 tabs data
  const openAppDetail = useCallback(
    async (slug: string, initialTab: DetailTab = 'configs', preserveFeedback = false) => {
      const request = ++detailLoad.current
      setDetailHealthCheck(null)
      setViewMode('detail')
      setDetailTab(initialTab)
      setDetailLoading(true)
      if (!preserveFeedback) {
        setDetailError(null)
        setDetailNotice(null)
        setDetailApp(null)
      }
      setVersionsError(null)
      setLogsError(null)
      setRollbackTarget(null)
      try {
        const detail = JSON.parse(await api.appDetails(slug, contextId)) as DeployedApp | null
        if (request !== detailLoad.current) return
        if (!detail) throw new Error('未能读取应用详情')
        const [verRaw, stgRaw, logRaw] = await Promise.allSettled([
          api.appVersions?.(slug, contextId) ?? Promise.resolve('{"versions":[]}'),
          api.appStorage?.(slug, contextId).catch(() => 'null') ?? Promise.resolve('null'),
          api.appLogs?.(slug, contextId) ?? Promise.resolve('{}'),
        ])
        if (request !== detailLoad.current) return
        if (verRaw?.status === 'rejected') setVersionsError(readErrorMessage(verRaw.reason, '版本历史加载失败'))
        if (logRaw?.status === 'rejected') setLogsError(readErrorMessage(logRaw.reason, '日志加载失败'))
        const verParsed = parseJson<{ versions?: AppVersionItem[] }>(verRaw?.status === 'fulfilled' ? verRaw.value : null, { versions: [] })
        const stgParsed = parseJson<AppStorageOverview | null>(stgRaw?.status === 'fulfilled' ? stgRaw.value : null, null)
        const logParsed = parseJson<{ runtime_logs?: string; logs?: string; content?: string; build_log?: string; dockerfile?: string }>(
          logRaw?.status === 'fulfilled' ? logRaw.value : null,
          {},
        )
        setDetailApp(detail)
        setRuntimeDraft({})
        setEditPort(String(detail.container_port ?? opcConfig.defaultPort))
        setEditConfigs(Array.isArray(detail.app_config) ? detail.app_config.map(c => ({ ...c })) : [])
        setVersions(Array.isArray(verParsed.versions) ? verParsed.versions : [])
        setStorageOverview(stgParsed)
        setDetailLogsData({
          runtime: logParsed.runtime_logs ?? logParsed.logs ?? logParsed.content ?? '',
          build: logParsed.build_log ?? detail.build_log ?? '',
          dockerfile: logParsed.dockerfile ?? detail.dockerfile_content ?? '',
        })
      } catch (error) {
        if (request === detailLoad.current) setDetailError(readErrorMessage(error, '加载应用详情失败'))
      } finally {
        if (request === detailLoad.current) setDetailLoading(false)
      }
    },
    [api, contextId, opcConfig.defaultPort],
  )

  const runtimeSlug = runtimePanel?.app.slug ?? (viewMode === 'detail' && detailApp?.can_manage === true ? detailApp.slug : undefined)
  const runtimeStatus = runtimeData?.slug === runtimeSlug ? runtimeData?.status : undefined
  const runtimeOperation = runtimeStatus?.operation
  const currentRuntimeError = runtimeError?.slug === runtimeSlug ? runtimeError?.message : undefined

  useEffect(() => {
    if (!runtimeSlug || !api.appRuntimeStatus) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const status = JSON.parse(await api.appRuntimeStatus!(runtimeSlug, contextId)) as RuntimeManagementStatus
        if (stopped) return
        setRuntimeError(null)
        setRuntimeData({ slug: runtimeSlug, status })
        if (runtimeOperationBusy(status.operation)) timer = setTimeout(refresh, 2000)
      } catch (error) {
        if (stopped) return
        setRuntimeError({ slug: runtimeSlug, message: readErrorMessage(error, '暂时无法读取操作状态') })
      }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [api, contextId, runtimeSlug, runtimeRefresh])

  useEffect(() => {
    setRuntimePanel(null)
    setRuntimeData(null)
    setRuntimeError(null)
    setRuntimeSubmitting(false)
  }, [contextId])

  useEffect(() => {
    if (runtimeOperation?.state !== 'succeeded' || runtimeOperation.kind === 'restart' ||
        viewMode !== 'detail' || detailApp?.slug !== runtimeSlug ||
        refreshedRuntimeOperation.current === runtimeOperation.id) return
    refreshedRuntimeOperation.current = runtimeOperation.id
    if (runtimeStatus?.config_revision !== (versions.find(version => version.is_active)?.config_revision ?? '')) {
      void openAppDetail(runtimeSlug!, 'configs', true)
    }
  }, [runtimeOperation, runtimeStatus, viewMode, detailApp?.slug, runtimeSlug, versions, openAppDetail])

  const openRuntimePanel = (app: RuntimeApp, confirmRestart: boolean) => {
    setRuntimeError(null)
    setRuntimePanel({ app, confirmRestart })
    setRuntimeRefresh(value => value + 1)
  }

  const submitRuntimeChange = async (app: RuntimeApp, command: RuntimeCommand) => {
    if (!api.appRuntimeChange || runtimeSubmitting) return
    setRuntimeSubmitting(true)
    setRuntimeError(null)
    setRuntimePanel({ app, confirmRestart: false })
    try {
      const operation = JSON.parse(await api.appRuntimeChange(app.slug, JSON.stringify(command), contextId)) as RuntimeOperation
      if (runtimeContext.current !== contextId) return
      setRuntimeData(previous => ({
        slug: app.slug,
        status: {
          revisions: [], config_revision: command.base_config_revision ?? '', config_number: 1, editable_keys: [],
          ...(previous?.slug === app.slug ? previous.status : {}),
          operation,
        },
      }))
      setRuntimeRefresh(value => value + 1)
    } catch (error) {
      if (runtimeContext.current === contextId) setRuntimeError({ slug: app.slug, message: readErrorMessage(error, '操作提交失败') })
    } finally {
      if (runtimeContext.current === contextId) setRuntimeSubmitting(false)
    }
  }

  const refreshDetailLogs = useCallback(async () => {
    if (detailApp?.can_manage !== true) return
    setLogsError(null)
    try {
      const logRaw = await api.appLogs?.(detailApp.slug, contextId)
      const logParsed = parseJson<{ runtime_logs?: string; logs?: string; content?: string; build_log?: string; dockerfile?: string }>(
        logRaw,
        {},
      )
      setDetailLogsData({
        runtime: logParsed.runtime_logs ?? logParsed.logs ?? logParsed.content ?? '',
        build: logParsed.build_log ?? detailApp.build_log ?? '',
        dockerfile: logParsed.dockerfile ?? detailApp.dockerfile_content ?? '',
      })
    } catch (error) {
      setLogsError(readErrorMessage(error, '刷新日志失败'))
    }
  }, [api, contextId, detailApp])

  // Start New App or Upgrade Wizard
  const startWizardNew = useCallback(
    (upgradeApp?: DeployedApp, prevJob?: AppDeliveryJob, reuseSource = false) => {
      setViewMode('wizard')
      setWizardStep(1)
      setWizardJob(null)
      setWizardError(null)
      setWizardNotice(null)
      setUpgradeTarget(upgradeApp ?? null)
      setPreviousJobId(prevJob?.id)
      setAppName(upgradeApp?.name ?? prevJob?.name ?? '')
      setAppSlug(upgradeApp?.slug ?? prevJob?.slug ?? '')
      setSlugManual(Boolean(upgradeApp || prevJob))
      setAppDescription(upgradeApp?.description ?? prevJob?.description ?? '')
      sourceSelection.current++
      setDragActive(false)
      setZipFile(null)
      setSourcePath('')
      setReuseSourceVersion(reuseSource && upgradeApp ? prevJob?.version : undefined)
      setConfigSubTab('configs')
    },
    [],
  )

  const resumeWizardJob = useCallback(
    async (job: AppDeliveryJob, overrideStep?: WizardStep, useSnapshot = false) => {
      setWizardError(null)
      setWizardNotice(null)
      setConfigSubTab('configs')
      setViewMode('wizard')
      const fresh = useSnapshot ? job : (await refreshWizardJob(job.id)) ?? job
      setWizardJob(fresh)
      setUpgradeTarget(fresh.published || fresh.upgrade ? apps.find(a => a.slug === fresh.slug && a.can_manage === true) ?? null : null)
      const targetStep = overrideStep ?? inferStepForJob(fresh)
      setWizardStep(targetStep)
      if (targetStep === 1) {
        setPreviousJobId(fresh.id)
        setAppName(fresh.name)
        setAppSlug(fresh.slug)
        setSlugManual(true)
        setAppDescription(fresh.description ?? '')
      }
    },
    [apps, refreshWizardJob],
  )

  const openLinkedJob = useCallback(async (job: AppDeliveryJob, refresh = true) => {
    const fresh = refresh ? (await refreshWizardJob(job.id)) ?? job : job
    if (fresh.status === 'verified') await openAppDetail(fresh.slug)
    else await resumeWizardJob(fresh, undefined, true)
  }, [openAppDetail, refreshWizardJob, resumeWizardJob])

  useEffect(() => {
    if (!api.appJobByAnalysisSession) return
    let active = true
    void api.appJobByAnalysisSession(sessionId, contextId)
      .then(raw => {
        if (active) setLinkedJob(parseJson<AppDeliveryJob | null>(raw, null))
      })
      .catch(error => {
        if (active) setBannerError(readErrorMessage(error, '无法恢复与当前会话关联的任务'))
      })
      .finally(() => {
        if (active) setLoadingLinkedJob(false)
      })
    return () => { active = false }
  }, [api, contextId, sessionId])

  const restorableLinkedJob = linkedJob && !isUpgradeTargetMissing(linkedJob, knownApps) ? linkedJob : null
  const waitingForUpgradeCatalog = restorableLinkedJob?.upgrade === true && !knownApps && loadingList
  useEffect(() => {
    if (loadingLinkedJob || waitingForUpgradeCatalog || !restorableLinkedJob || restoredLinkedJob.current) return
    restoredLinkedJob.current = true
    void openLinkedJob(restorableLinkedJob, false)
  }, [restorableLinkedJob, waitingForUpgradeCatalog, loadingLinkedJob, openLinkedJob])

  useEffect(() => {
    if (viewMode !== 'wizard' || wizardJob?.id !== linkedJob?.id || upgradeTarget || !(wizardJob?.upgrade || wizardJob?.published)) return
    const target = apps.find(app => app.slug === wizardJob.slug && app.can_manage === true)
    if (target) setUpgradeTarget(target)
  }, [apps, linkedJob?.id, upgradeTarget, viewMode, wizardJob])

  // Step 1 Submit: Create Job & Trigger Analysis
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (wizardBusy) return
    sourceSelection.current++
    setWizardError(null)
    const cleanName = appName.trim()
    const cleanSlug = toAppSlug(appSlug, { allowTrailingDash: false })
    if (!cleanName) {
      setWizardError('请填写应用名称')
      return
    }
    if (!SLUG_RE.test(cleanSlug)) {
      setWizardError('应用标识须为 3–40 位小写字母、数字或短横线，且以字母开头')
      return
    }
    if (!upgradingStep1 && slugCheck.available === false) {
      setWizardError('该应用标识已被占用，请更换其他标识')
      return
    }
    if (selectedProvider && !selectedModelItem) {
      setWizardError('请选择此次交付的 AI 模型，或沿用当前会话模型')
      return
    }
    if (!reuseSourceVersion && !zipFile && !sourcePath.trim()) {
      setWizardError('请选择源码文件夹或 ZIP，或者填写完整路径')
      return
    }

    const navigate = beginAnalysisNavigation()
    setWizardBusy(true)
    try {
      const payload: Record<string, unknown> = {
        name: cleanName,
        slug: cleanSlug,
        description: appDescription.trim(),
        upgrade: upgradingStep1,
        previousJobId: previousJobId || undefined,
        modelSelection:
          selectedProvider && selectedModel
            ? {
                provider: selectedProvider,
                model: selectedModel,
                reasoningEffort: selectedEffort || undefined,
              }
            : undefined,
      }
      if (reuseSourceVersion) {
        payload.reuseSourceVersion = reuseSourceVersion
      } else if (zipFile) {
        payload.zip = await readFileAsBase64(zipFile)
      } else {
        payload.source = sourcePath.trim()
      }

      const rawJob = await api.appCreate(JSON.stringify(payload), sessionId, contextId)
      const created = parseJson<AppDeliveryJob>(rawJob, {} as AppDeliveryJob)
      if (!created || !created.id) throw new Error('创建交付任务失败')
      if (created.status === 'failed') {
        throw new Error(created.error || '导入源码失败')
      }

      setWizardJob(created)
      setWizardStep(2)
      void loadWorkspaceData(true)

      // Kick off analysis immediately in background so Step 2 displays live progress
      const analyzePromise = api.appAnalyzeWithMode
        ? api.appAnalyzeWithMode(created.id, '', sessionId, 'analysis', contextId)
        : api.appAnalyze(created.id, '', sessionId, contextId)
      void analyzePromise
        .then(updatedRaw => {
          const updated = parseJson<AppDeliveryJob | null>(updatedRaw, null)
          if (updated) {
            setWizardJob(updated)
            navigate?.(updated)
          }
          void loadWorkspaceData(true)
        })
        .catch(err => {
          setWizardError(readErrorMessage(err, '启动源码分析失败'))
          void refreshWizardJob(created.id)
        })
    } catch (error) {
      setWizardError(readErrorMessage(error, '创建任务并导入源码失败'))
    } finally {
      setWizardBusy(false)
    }
  }

  const selectZip = (file: File) => {
    if (wizardBusy) return
    sourceSelection.current++
    if (!/\.zip$/i.test(file.name) || file.size === 0 || file.size > MAX_ZIP_BYTES) {
      setWizardError('请使用有效的 ZIP 压缩包，大小不能超过 64 MiB')
      return
    }
    setWizardError(null)
    setReuseSourceVersion(undefined)
    setSourcePath('')
    setZipFile(file)
  }

  const selectSourcePath = (path: string) => {
    sourceSelection.current++
    setWizardError(null)
    setReuseSourceVersion(undefined)
    setZipFile(null)
    setSourcePath(path)
  }

  const handleBrowseFolder = async () => {
    const request = ++sourceSelection.current
    setWizardError(null)
    if (!api.appPickSourceFolder) {
      sourcePathInputRef.current?.focus()
      return
    }
    try {
      const res = parseJson<{ path?: string; cancelled?: boolean; unsupported?: boolean }>(
        await api.appPickSourceFolder(contextId),
        {},
      )
      if (request !== sourceSelection.current) return
      if (res.unsupported) {
        sourcePathInputRef.current?.focus()
        setWizardError('此环境不支持原生文件夹选择，请填写完整路径或选择 ZIP 压缩包')
      } else if (!res.cancelled && res.path) {
        selectSourcePath(res.path)
      }
    } catch (error) {
      if (request === sourceSelection.current) setWizardError(readErrorMessage(error, '打开目录选择器失败'))
    }
  }

  const saveDraft = useCallback((job: AppDeliveryJob, rows: AppConfigItem[], note: string, storage: Record<string, string>) => {
    if (!api.appSaveConfigDraft || !job.artifactHash) return Promise.resolve()
    const body = JSON.stringify({ artifactHash: job.artifactHash, rows: sanitizeConfigRowsForApi(rows), versionNote: note, storageBindings: storage })
    const request = draftSaveRequest.current.catch(() => {}).then(() => api.appSaveConfigDraft!(job.id, body, contextId))
    draftSaveRequest.current = request
    return request
  }, [api, contextId])

  const scheduleDraftSave = useCallback(
    (job: AppDeliveryJob, nextConfigs: AppConfigItem[], nextNote: string, storage: Record<string, string>) => {
      if (!api.appSaveConfigDraft || !job.artifactHash) return
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = window.setTimeout(() => {
        draftSaveTimerRef.current = null
        void saveDraft(job, nextConfigs, nextNote, storage).catch(error => {
          setWizardError(readErrorMessage(error, '配置草稿保存失败，请重试'))
        })
      }, 450)
    },
    [api, saveDraft],
  )

  const flushDraft = async () => {
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    if (wizardJob?.status === 'ready' && wizardStep === 3 && step3Ready) await saveDraft(wizardJob, latestConfigDrafts.current, versionNote, storageBindings)
  }

  const leaveWizard = async () => {
    if (wizardBusy) return
    sourceSelection.current++
    draftTransition.current = true
    setWizardBusy(true)
    try {
      await flushDraft()
      setViewMode('list')
      void loadWorkspaceData(true)
    } catch (error) {
      setWizardError(readErrorMessage(error, '配置草稿保存失败，请重试'))
    } finally { draftTransition.current = false; setWizardBusy(false) }
  }

  const handleStep3ConfigsChange = (nextConfigs: AppConfigItem[]) => {
    if (draftTransition.current) return
    replaceConfigDrafts(nextConfigs)
    if (wizardJob) scheduleDraftSave(wizardJob, nextConfigs, versionNote, storageBindings)
  }

  const saveChatEdits = async (edits: ConfigChatEdit[]) => {
    if (!wizardJob || !step3Ready || draftTransition.current || wizardBusy) throw new Error('当前部署草稿暂时不可编辑')
    const byKey = new Map(edits.map(edit => [edit.after.key, edit.after]))
    const rows = latestConfigDrafts.current.map(row => byKey.get(row.key) ?? row)
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = null
    replaceConfigDrafts(rows)
    await saveDraft(wizardJob, rows, versionNote, storageBindings)
  }

  const runConfigChatAction = useRef<(action: ConfigChatAction) => Promise<ConfigChatResult>>(async () => ({ error: '正在加载配置草稿' }))
  runConfigChatAction.current = async action => {
    if (!active || viewMode !== 'wizard' || wizardStep !== 3 || wizardJob?.analysisSessionId !== sessionId ||
        wizardBusy || draftTransition.current || !step3Ready) throw new Error('当前部署草稿暂时不可编辑')
    const rows = latestConfigDrafts.current
    const readRow = (row: AppConfigItem) => configChatRow(row, deploymentResources, [...volumeMounts, ...existingStorage])
    if (action.type === 'read') return { rows: rows.filter(row => row.key).map(readRow) }
    const expected = new Map(action.expected.map(row => [row.key, row]))
    const edits = action.changes.flatMap(({ key, value }) => {
      const before = rows.find(row => row.key === key)
      if (!before || JSON.stringify(readRow(before)) !== JSON.stringify(expected.get(key))) {
        throw new Error(`${key} 已变更，请重新读取右侧配置`)
      }
      const blocked = readRow(before).blocked
      if (blocked) throw new Error(blocked)
      if (value === before.value) return []
      return [{ before, after: { ...before, value, value_source: 'manual', has_value: Boolean(value), local_connection_confirmed: false } }]
    })
    if (!edits.length) return { changed: [] }
    setAiConfigEdits(edits)
    setConfigSubTab('configs')
    try {
      await saveChatEdits(edits)
    } catch (error) {
      setWizardError(readErrorMessage(error, '配置草稿保存失败，请重试'))
      throw error
    }
    return { changed: edits.map(edit => edit.after.key) }
  }

  const configChatJobId = active && viewMode === 'wizard' && wizardStep === 3 && step3Ready &&
    wizardJob?.status === 'ready' && wizardJob.analysisSessionId === sessionId ? wizardJob.id : undefined
  const configChatArtifact = configChatJobId ? wizardJob?.artifactHash : undefined
  useEffect(() => {
    if (!configChatJobId || !configChatArtifact || !api.appWatchConfigChat || !api.appReplyConfigChat || !api.appSaveConfigDraft) return
    const controller = new AbortController()
    setConfigChatStatus('connecting')
    setConfigChatError('')
    void (async () => {
      const delays = [1000, 2000, 4000]
      for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        if (controller.signal.aborted) return
        let lastError = ''
        try {
          for await (const raw of api.appWatchConfigChat!(configChatJobId, configChatArtifact, sessionId, contextId, controller.signal)) {
            if (controller.signal.aborted) return
            const frame = JSON.parse(raw) as ConfigChatFrame
            if (frame.type === 'ready') {
              setConfigChatStatus('ready')
              setConfigChatError('')
              attempt = 0
              continue
            }
            let result: ConfigChatResult
            try { result = await runConfigChatAction.current(frame.action) }
            catch (error) { result = { error: readErrorMessage(error, '无法处理配置草稿') } }
            if (controller.signal.aborted) return
            await api.appReplyConfigChat!(configChatJobId, frame.id, JSON.stringify(result), contextId)
          }
        } catch (error) {
          if (controller.signal.aborted) return
          lastError = readErrorMessage(error, '')
        }
        if (controller.signal.aborted) return
        if (attempt < delays.length) {
          setConfigChatStatus('connecting')
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, delays[attempt])
            controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
          continue
        }
        setConfigChatError(lastError)
        setConfigChatStatus('unavailable')
      }
    })()
    return () => controller.abort()
  }, [api, configChatJobId, configChatArtifact, configChatReconnect, contextId, sessionId])

  const undoAiConfigEdits = async () => {
    const undo = aiConfigEdits.filter(edit => latestConfigDrafts.current.includes(edit.after))
      .map(edit => ({ before: edit.after, after: edit.before }))
    if (!undo.length) return
    try {
      await saveChatEdits(undo)
      setAiConfigEdits([])
    } catch (error) {
      setWizardError(readErrorMessage(error, '撤销后保存草稿失败，请重试'))
    }
  }

  const handleStep3NoteChange = (nextNote: string) => {
    setVersionNote(nextNote)
    if (wizardJob) scheduleDraftSave(wizardJob, configDrafts, nextNote, storageBindings)
  }

  const handleReturnToReview = async () => {
    if (!wizardJob) return
    draftTransition.current = true
    setWizardBusy(true)
    setWizardError(null)
    try {
      await flushDraft()
      if (api.appReopenReview) {
        const raw = await api.appReopenReview(wizardJob.id, contextId)
        const updated = parseJson<AppDeliveryJob | null>(raw, null)
        if (updated) setWizardJob(updated)
      }
      setWizardStep(2)
    } catch (error) {
      setWizardError(readErrorMessage(error, '返回方案核对失败'))
    } finally {
      draftTransition.current = false
      setWizardBusy(false)
    }
  }

  const handlePublishApp = async () => {
    if (!wizardJob || !step3Ready) return
    setWizardError(null)
    if (getConfigPublishIssues(latestConfigDrafts.current, wizardJob.port ?? opcConfig.defaultPort, skillDrivenDelivery).size) {
      setConfigSubTab('configs')
      return
    }
    if (hasMissingStorage) {
      setConfigSubTab('mounts')
      return
    }
    if (!wizardJob.artifactHash) {
      setWizardError('交付包尚未准备完成，请返回方案核对重新生成交付包')
      return
    }
    const migration = wizardJob.proposal?.contract?.data_plan
    const migrationApproved = migration?.strategy === 'postgres_copy' &&
      window.confirm(`确认发布包含数据库迁移。正式复制期间会暂停旧实例写入。\n原库保留，目标库：${migration.target_resource_id ?? ''}\n\n${migration.summary}\n\n恢复方式：${migration.recovery}`)
    if (migration?.strategy === 'postgres_copy' && !migrationApproved) return

    draftTransition.current = true
    setWizardBusy(true)
    try {
      await flushDraft()
      const cleanConfigs = sanitizeConfigRowsForApi(latestConfigDrafts.current, {
        forPublish: true,
        lockedPort: wizardJob.port ?? opcConfig.defaultPort,
      })
      const confirmRaw = await api.appConfirmDeployment(
        wizardJob.id,
        JSON.stringify({
          artifactHash: wizardJob.artifactHash,
          config: cleanConfigs,
          storageBindings: storageSelections,
          versionNote: versionNote.trim(),
          migrationApproved,
        }),
        contextId,
      )
      const { confirmationToken, artifactHash, requestId } = parseJson<{ confirmationToken: string; artifactHash?: string; requestId?: string }>(confirmRaw, { confirmationToken: '' })
      if (!confirmationToken) throw new Error('未能获取发布确认凭证')
      setWizardJob({ ...wizardJob, status: 'publishing', requestId, deploymentProgress: { phase: 'submitting' } })
      setWizardStep(4)

      const publishRaw = await api.appPublish(
        wizardJob.id,
        JSON.stringify({
          artifactHash: artifactHash ?? wizardJob.artifactHash,
          confirmationToken,
          config: cleanConfigs,
          storageBindings: storageSelections,
          versionNote: versionNote.trim(),
          migrationApproved,
        }),
        contextId,
      )
      const published = parseJson<AppDeliveryJob | null>(publishRaw, null)
      if (published) setWizardJob(published)
      if (published?.status === 'ready' && !published.deploymentProgress) {
        setWizardStep(3)
        setWizardError(published.error || '平台未接受本次发布，请核对配置后重试')
        return
      }
      setWizardStep(4)
      void loadWorkspaceData(true)

    } catch (error) {
      setWizardError(readErrorMessage(error, '确认发布应用失败'))
      void refreshWizardJob(wizardJob.id)
    } finally {
      draftTransition.current = false
      setWizardBusy(false)
    }
  }

  const handleLaunchRepair = async () => {
    if (!wizardJob) return
    const navigate = beginAnalysisNavigation()
    setWizardBusy(true)
    setWizardError(null)
    try {
      const feedback =
        wizardJob.error ||
        wizardJob.verification?.detail ||
        '请根据本次失败阶段和日志定位根因，沿用已确认的部署方案。'
      if (api.appReopenReview) {
        await api.appReopenReview(wizardJob.id, contextId).catch(() => {})
      }
      const analyzePromise = api.appAnalyzeWithMode
        ? api.appAnalyzeWithMode(wizardJob.id, feedback, sessionId, 'repair', contextId)
        : api.appAnalyze(wizardJob.id, feedback, sessionId, contextId)
      setWizardStep(2)
      void analyzePromise
        .then(raw => {
          const updated = parseJson<AppDeliveryJob | null>(raw, null)
          if (updated) {
            setWizardJob(updated)
            navigate?.(updated)
          }
        })
        .catch(err => {
          setWizardError(readErrorMessage(err, '启动修复分析失败'))
          void refreshWizardJob(wizardJob.id)
        })
    } catch (error) {
      setWizardError(readErrorMessage(error, '进入修复流程失败'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleContinueAssessment = async () => {
    if (!wizardJob) return
    const navigate = beginAnalysisNavigation()
    setWizardBusy(true)
    try {
      const raw = await api.appVerify(wizardJob.id, contextId)
      const updated = parseJson<AppDeliveryJob | null>(raw, null)
      if (updated) { setWizardJob(updated); navigate?.(updated) }
    } catch (error) {
      setWizardError(readErrorMessage(error, '无法继续 AI 验收'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleRecheckStartup = async () => {
    if (!wizardJob || !api.appVerifyWithOptions || wizardBusy) return
    const { id, requestId } = wizardJob
    const key = progressRequestKey
    setWizardBusy(true)
    setStartupRecheck({ key, pending: true })
    try {
      const raw = await api.appVerifyWithOptions(id, JSON.stringify({ checkStartup: true }), contextId)
      const updated = JSON.parse(raw) as AppDeliveryJob
      if (updated.id !== id || updated.requestId !== requestId) throw new Error('平台返回了其他部署任务的检查结果')
      setWizardJob(current => current?.id === id && current.requestId === requestId ? updated : current)
      setStartupRecheck({ key, message: describeDeploymentStartup(updated), error: !updated.startupCheck })
      if (updated.status === 'verified') void loadWorkspaceData(true)
    } catch (error) {
      setStartupRecheck({ key, message: readErrorMessage(error, '无法重新检查应用启动状态'), error: true })
    } finally {
      setWizardBusy(false)
    }
  }

  const handleRetryDeployment = async () => {
    if (!wizardJob) return
    setWizardBusy(true)
    setWizardError(null)
    try {
      const raw = await api.appReopenDeployment(wizardJob.id, contextId)
      const reopened = parseJson<AppDeliveryJob | null>(raw, null)
      if (!reopened) throw new Error('无法恢复原交付包')
      await resumeWizardJob(reopened, 3)
    } catch (error) {
      setWizardError(readErrorMessage(error, '恢复原交付包失败'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleCheckAttempt = async () => {
    if (!wizardJob || !api.appVerifyWithOptions) return
    const { id, requestId } = wizardJob
    setWizardBusy(true)
    setWizardError(null)
    try {
      const updated = JSON.parse(await api.appVerifyWithOptions(id, JSON.stringify({ checkProgress: true }), contextId)) as AppDeliveryJob
      if (updated.id !== id || updated.requestId !== requestId) throw new Error('平台返回了其他部署任务')
      setWizardJob(current => current?.id === id && current.requestId === requestId ? updated : current)
      if (updated.status === 'verified') void loadWorkspaceData(true)
    } catch (error) {
      setWizardError(readErrorMessage(error, '暂时无法确认部署进度'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleCancelAttempt = async () => {
    if (!wizardJob?.requestId || !api.appCancelDeployment || !wizardJob.deploymentProgress?.can_cancel) return
    if (!window.confirm('要取消这一次部署吗？平台会停止本次任务并清理临时资源。')) return
    const { id, requestId } = wizardJob
    setWizardBusy(true)
    setWizardError(null)
    try {
      const updated = JSON.parse(await api.appCancelDeployment(id, requestId, contextId)) as AppDeliveryJob
      if (updated.id !== id || updated.requestId !== requestId) throw new Error('平台返回了其他部署任务')
      setWizardJob(current => current?.id === id && current.requestId === requestId ? updated : current)
    } catch (error) {
      setWizardError(readErrorMessage(error, '暂时无法取消本次部署，请重新检查'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleSaveLocalArtifact = async (jobId: string, filename: string) => {
    setWizardError(null)
    try {
      if (api.appSaveLocalArtifact) {
        const res = parseJson<{ path?: string }>(await api.appSaveLocalArtifact(jobId, filename, contextId), {})
        if (res.path) {
          setWizardNotice(`已保存到本地：${res.path}`)
          return
        }
      }
      if (api.appLocalArtifact) {
        const res = parseJson<{ filename?: string; base64?: string }>(await api.appLocalArtifact(jobId, filename, contextId), {})
        if (res.base64) {
          triggerBrowserDownload(res.filename || filename, res.base64)
          setWizardNotice(`已下载文件：${res.filename || filename}`)
        }
      }
    } catch (error) {
      setWizardError(readErrorMessage(error, `保存 ${filename} 失败`))
    }
  }

  const handleDownloadPlatformArtifact = async (slug: string, selection: Record<string, unknown>, label: string) => {
    setDetailError(null)
    try {
      const selectionJson = JSON.stringify(selection)
      const res = parseJson<{ path?: string }>(await api.appSaveDownload(slug, selectionJson, contextId), {})
      if (res.path) {
        setDetailNotice(`已保存 ${label} 到：${res.path}`)
        return
      }
      if (api.appDownload) {
        const fallback = parseJson<{ filename?: string; base64?: string }>(await api.appDownload(slug, selectionJson, contextId), {})
        if (fallback.base64) {
          triggerBrowserDownload(fallback.filename || `${slug}.bin`, fallback.base64)
          setDetailNotice(`已下载 ${label}`)
        }
      }
    } catch (error) {
      setDetailError(readErrorMessage(error, `下载 ${label} 失败`))
    }
  }

  const handleRecheckApp = async (slug: string, inDetail = false) => {
    const request = detailLoad.current
    if (inDetail) {
      setDetailBusy(true)
      setDetailError(null)
      setDetailNotice(null)
      setDetailHealthCheck(null)
    } else {
      setBannerError(null)
      setBannerNotice(null)
    }
    try {
      if (!api.appRecheck) throw new Error('当前插件版本不支持在线重新检测')
      const res = readAppHealthCheck(await api.appRecheck(slug, contextId))
      if (inDetail) {
        if (request !== detailLoad.current) return
        setDetailHealthCheck({ ...res, slug })
        setDetailApp(current => current?.slug === slug
          ? { ...current, status: res.status, error_message: res.ok ? undefined : res.message }
          : current)
      } else {
        if (res.ok) setBannerNotice(res.message)
        else setBannerError(res.message)
      }
      void loadWorkspaceData(true)
    } catch (error) {
      const msg = readErrorMessage(error, '重新检测应用状态失败')
      if (inDetail && request === detailLoad.current) setDetailError(msg)
      else if (!inDetail) setBannerError(msg)
    } finally {
      if (inDetail) setDetailBusy(false)
    }
  }

  const handleSyncSkill = async (slug: string) => {
    const request = detailLoad.current
    setDetailBusy(true)
    setDetailError(null)
    setDetailNotice(null)
    try {
      if (!api.appSyncSkill) throw new Error('当前插件版本不支持手动同步技能到 OPC 线上平台')
      const res = parseJson<{ ok?: boolean; catalog_skill_id?: string; skill_synced?: boolean }>(
        await api.appSyncSkill(slug, contextId),
        {},
      )
      if (request !== detailLoad.current) return
      setDetailApp(current => current?.slug === slug
        ? { ...current, skill_synced: res.skill_synced ?? true, catalog_skill_id: res.catalog_skill_id ?? current.catalog_skill_id }
        : current)
      setDetailNotice(t("apps.skillSyncedSuccess"))
      void loadWorkspaceData(true)
    } catch (error) {
      if (request === detailLoad.current) setDetailError(readErrorMessage(error, '同步技能到 OPC 线上平台失败'))
    } finally {
      setDetailBusy(false)
    }
  }

  const handleSaveDetailConfig = async () => {
    if (!detailApp || !api.appUpdateConfig) return
    const portNum = Number.parseInt(editPort, 10)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setDetailError('容器端口必须为 1 至 65535 的整数')
      return
    }
    const normalizedConfigs = editConfigs.map(c =>
      (c.key || '').trim() === 'PORT' && !c.resource_id
        ? { ...c, value: String(portNum) }
        : c)
    const validationErr = validateConfigsForPublish(normalizedConfigs, portNum)
    if (validationErr) {
      setDetailError(validationErr)
      return
    }
    setDetailBusy(true)
    setDetailError(null)
    setDetailNotice(null)
    try {
      setEditConfigs(normalizedConfigs)
      const sanitized = sanitizeConfigRowsForApi(normalizedConfigs)
      const resourceIds = Array.from(new Set(sanitized.map(c => c.resource_id).filter((id): id is string => Boolean(id))))
      await api.appUpdateConfig(
        detailApp.slug,
        JSON.stringify({
          container_port: portNum,
          app_config: sanitized,
          resource_ids: resourceIds,
        }),
        contextId,
      )
      let notice = '配置已更新并触发容器重启，正在刷新最新状态…'
      const activeJob = findAppJob(jobs, detailApp)
      if (activeJob) {
        try {
          const verifyRaw = api.appVerifyWithOptions
            ? await api.appVerifyWithOptions(activeJob.id, JSON.stringify({ automatic: true }), contextId)
            : await api.appVerify(activeJob.id, contextId)
          const verified = parseJson<AppDeliveryJob | null>(verifyRaw, null)
          if (verified?.status === 'verified') {
            notice = '配置已更新并完成业务重新验证，本地应用技能已同步启用。'
          } else if (verified?.status === 'awaiting_page_verification') {
            notice = '配置已更新，需重新完成页面验收后启用本地应用技能。'
          } else if (verified?.status === 'failed') {
            notice = `配置已更新，但本地技能自动重验未通过：${verified.error || '请在详情或向导第 4 步填写凭据重验。'}`
          } else {
            notice = '配置已更新；本地应用技能需重新验证后启用。'
          }
        } catch {
          notice = '配置已更新；本地应用技能需在重新验证后启用。'
        }
      }
      setDetailNotice(notice)
      await openAppDetail(detailApp.slug, 'configs', true)
      void loadWorkspaceData(true)
    } catch (error) {
      setDetailError(readErrorMessage(error, '保存运行配置失败'))
    } finally {
      setDetailBusy(false)
    }
  }

  const handleConfirmRollback = async () => {
    if (!detailApp || !rollbackTarget || !api.appRollback) return
    setDetailBusy(true)
    setDetailError(null)
    setDetailNotice(null)
    try {
      const raw = await api.appRollback(
        detailApp.slug,
        JSON.stringify({
          targetVersion: rollbackTarget.version,
          reason: rollbackReason.trim() || `回滚至 v${rollbackTarget.version}`,
        }),
        contextId,
      )
      const res = parseJson<{
        ok?: boolean
        active_version?: number
        current_version?: number
        skill_enabled?: boolean
        verification?: { status?: string; detail?: string }
        job_id?: string
      }>(raw, {})
      setRollbackTarget(null)
      setRollbackReason('')
      const restored = `已回滚至 v${res.active_version ?? res.current_version ?? rollbackTarget.version}`
      if (['awaiting_page_verification', 'probe-warning'].includes(res.verification?.status ?? '') && res.job_id) {
        const next = res.verification?.status === 'awaiting_page_verification' ? '请确认页面可用' : '请补充业务验证'
        setDetailNotice(`${restored}，${next}`)
        const job = await refreshWizardJob(res.job_id)
        if (job) {
          await resumeWizardJob(job, 4)
          setWizardNotice(`${restored}，${next}`)
          return
        }
      } else {
        const skillStatus = res.skill_enabled ? '业务验证已通过，技能可用'
          : res.verification?.status === 'verified-rolled-back' ? '业务验证已通过，技能仍保持停用'
          : res.verification?.detail || '应用技能尚未通过业务验证'
        setDetailNotice(`${restored}。 ${skillStatus}`)
      }
      await openAppDetail(detailApp.slug, 'versions', true)
      void loadWorkspaceData(true)
    } catch (error) {
      setDetailError(readErrorMessage(error, '版本回滚失败'))
    } finally {
      setDetailBusy(false)
    }
  }

  const linkedListJob = linkedJob && (wizardJob?.id === linkedJob.id
    ? wizardJob
    : jobs.find(job => job.id === linkedJob.id) ?? linkedJob)

  const resumableJob = useMemo(() => {
    const candidate = jobs.find(job => showTaskBanner(job, knownApps))
    if (!candidate) return null
    const token = `${candidate.id}:${candidate.status}`
    if (dismissedDraftToken === token) return null
    return candidate
  }, [knownApps, dismissedDraftToken, jobs])

  const dismissDraftBanner = (job: AppDeliveryJob) => {
    const token = `${job.id}:${job.status}`
    setDismissedDraftToken(token)
    try {
      sessionStorage.setItem(DRAFT_DISMISS_STORAGE_PREFIX + contextId, token)
    } catch {
      // Ignore storage errors.
    }
  }

  const currentVersion = (version: AppVersionItem) => version.is_active ||
    (detailApp?.status === 'running' && detailApp.current_version === version.version)
  const hasRunningVersion = detailApp?.status === 'running' || versions.some(v => v.status === 'running' || v.is_active)
  const visibleVersions = versions.filter((version, index) =>
    currentVersion(version) || version.status !== 'failed' || (!hasRunningVersion && index === 0))

  // Render View 1: App List
  const renderAppListView = () => (
    <div className="oa-app-list">
      <div className="oa-topbar">
        <div>
          <h2 className="oa-title">{t("apps.apps")}</h2>
          <p className="oa-subtitle">{t("apps.signInToDeployTheApp")}</p>
        </div>
        <div className="oa-app-list-toolbar">
          {api.appVolumeBackupsList && (
            <button type="button" className="oa-btn" onClick={() => { void loadVolumeBackups(); setViewMode('backups') }}>
              <AppIcon name="archive" size={14} />
              <span>{t("apps.backups")}</span>
              {volumeBackups.length > 0 && <span className="oa-pill oa-pill-accent">{volumeBackups.length}</span>}
            </button>
          )}
          <button type="button" className="oa-btn" disabled={loadingList} onClick={() => void loadWorkspaceData(false)}>
            <AppIcon name="refresh" size={14} className={loadingList ? 'oa-spin' : ''} />
            <span>{t("common.refresh")}</span>
          </button>
          <button type="button" className="oa-btn oa-btn-primary" onClick={() => startWizardNew()}>
            <AppIcon name="plus" size={14} />
            <span>{t("apps.newApp")}</span>
          </button>
        </div>
      </div>

      <NoticeModal
        open={Boolean(bannerError)}
        variant="error"
        message={bannerError || ''}
        onClose={() => setBannerError(null)}
      />

      <NoticeModal
        open={Boolean(bannerNotice)}
        variant="success"
        message={bannerNotice || ''}
        onClose={() => setBannerNotice(null)}
      />

      {linkedListJob && showTaskBanner(linkedListJob, knownApps) && (
        <div className="oa-draft-banner">
          <div><strong>{linkedListJob.name}</strong></div>
          <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => void openLinkedJob(linkedListJob)}>
            回到当前任务
          </button>
        </div>
      )}

      {resumableJob && resumableJob.id !== linkedJob?.id && (() => {
        const tone = jobStatusTone(resumableJob.status, resumableJob.userDisabled)
        return (
          <div className="oa-draft-banner">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <AppIcon name="sparkle" size={15} />
                <strong style={{ fontSize: 13.5, color: '#0f172a' }}>未完成的应用交付任务：{resumableJob.name}</strong>
                <span className="oa-code">{resumableJob.slug}</span>
                <span className={`oa-pill ${tone.pillClass}`}>
                  {tone.spinning && <span className="oa-dot oa-pulse" />}
                  {tone.text}
                </span>
              </div>
              <p className="oa-hint" style={{ marginTop: 4 }}>
                {resumableJob.status === 'awaiting_page_verification'
                  ? '容器与接口检查已就绪，请打开应用页面确认后启用智能体技能。'
                  : resumableJob.error || resumableJob.analysis_failure || '可从上次进度继续办理或调整源码方案。'}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => void resumeWizardJob(resumableJob)}>
                继续办理
              </button>
              <button type="button" className="oa-btn oa-btn-sm" onClick={() => dismissDraftBanner(resumableJob)}>
                隐藏提示
              </button>
            </div>
          </div>
        )
      })()}

      {loadingList && apps.length === 0 ? (
        <div className="oa-form-card" style={{ textAlign: 'center', padding: '44px 20px', color: '#64748b' }}>
          {t("apps.loadingApps")}
        </div>
      ) : apps.length === 0 ? (
        <div className="oa-form-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div className="oa-app-icon-box" style={{ margin: '0 auto 14px', width: 48, height: 48 }}>
            <AppIcon name="sparkle" size={22} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{t("apps.noDeployedAppsYet")}</div>
          <p className="oa-subtitle" style={{ maxWidth: 460, margin: '8px auto 18px' }}>
            {t("apps.uploadAZipOrChooseA")}
          </p>
          <button type="button" className="oa-btn oa-btn-primary" onClick={() => startWizardNew()}>
            <AppIcon name="plus" size={14} />
            <span>{t("apps.createFirstApp")}</span>
          </button>
        </div>
      ) : (() => {
        const { pageItems: pageApps, currentPage: currentAppsPage } = paginateItems(apps, appsPage, appsPageSize)
        return <>
        <div className="oa-apps-grid">
          {pageApps.map(app => {
            const tone = jobStatusTone(app.status, undefined, locale)
            const readOnly = app.can_manage !== true
            const isFailed = app.status === 'failed' || app.status === 'unhealthy'
            const matchingJob = findAppJob(jobs, app)
            return (
              <article key={app.slug} className="oa-app-card">
                <div className="oa-app-card-head">
                  <div className="oa-app-card-identity">
                    <div className="oa-app-icon-box"><AppIcon name="list" size={18} /></div>
                    <div className="oa-app-card-heading">
                      <div className="oa-app-card-name">
                        <h3 title={app.name}>{app.name}</h3>
                        {app.current_version ? <span className="oa-app-version">v{app.current_version}</span> : null}
                      </div>
                      <div className="oa-app-card-slug oa-mono" title={app.slug}>{app.slug}</div>
                    </div>
                  </div>
                  <span className={`oa-app-card-status oa-pill ${tone.pillClass}`}>
                    <span className={`oa-dot${tone.spinning ? ' oa-pulse' : ''}`} />
                    {tone.text}
                  </span>
                </div>

                <p className="oa-app-card-desc" title={app.description || undefined}>{app.description || t("apps.noDescription")}</p>

                <div className="oa-app-card-meta">
                  <div className="oa-app-card-row">
                    <span><AppIcon name="cloud" size={13} />{t("apps.url")}</span>
                    {app.app_url
                      ? <a className="oa-mono" href={app.app_url} target="_blank" rel="noreferrer" title={app.app_url}>{app.app_url}</a>
                      : <span>{t("apps.none")}</span>}
                  </div>
                  {!readOnly && (
                    <div className="oa-app-card-row">
                      <span><AppIcon name="sparkle" size={13} />{t("apps.localSkill")}</span>
                      <code className="oa-code" title={app.skill_name || `app-${app.slug}`}>{app.skill_name || `app-${app.slug}`}</code>
                    </div>
                  )}
                </div>

                {isFailed && app.error_message && (
                  <div className="oa-alert oa-alert-danger oa-app-card-error" role="status">
                    <AppIcon name="warning" size={14} />
                    <span>{healthFailureDetail(app.error_message) || t("apps.healthCheckFailedSeeLogs")}</span>
                  </div>
                )}

                <div className="oa-app-card-actions">
                  {readOnly ? <span className="oa-hint">{t("apps.sharedReadOnly")}</span> : isFailed ? (
                    <>
                      <button type="button" className="oa-btn oa-btn-xs" onClick={() => {
                        if (matchingJob?.published) void resumeWizardJob(matchingJob, 4)
                        else startWizardNew(app)
                      }}>
                        {t("apps.recoverRedeploy")}
                      </button>
                      {api.appRecheck && (
                        <button type="button" className="oa-btn oa-btn-xs" onClick={() => void handleRecheckApp(app.slug, false)}>
                          <AppIcon name="refresh" size={12} />{t("apps.recheck")}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" className="oa-btn oa-btn-xs" onClick={() => void openAppDetail(app.slug, 'versions')}>
                        {t("apps.versions")}
                      </button>
                      <button type="button" className="oa-btn oa-btn-xs oa-btn-accent-soft" onClick={() => startWizardNew(app, matchingJob)}>
                        {t("apps.upgrade")}
                      </button>
                    </>
                  )}
                  {!readOnly && (app.current_version ?? 0) > 0 && api.appRuntimeStatus && api.appRuntimeChange && (
                    <button type="button" className="oa-btn oa-btn-xs" onClick={() => openRuntimePanel(app, true)}>{t("apps.restart")}</button>
                  )}
                  <button type="button" className="oa-btn oa-btn-xs oa-btn-link oa-app-card-detail"
                    onClick={() => void openAppDetail(app.slug, isFailed && !readOnly ? 'logs' : 'configs')}>
                    {isFailed && !readOnly ? t("apps.logs") : t("apps.details")}<AppIcon name="chevronRight" size={12} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
        <Pagination
          totalItems={apps.length}
          page={currentAppsPage}
          pageSize={appsPageSize}
          onPageChange={setAppsPage}
          onPageSizeChange={size => { setAppsPageSize(size); setAppsPage(1) }}
        />
        </>
      })()}
    </div>
  )

  // Render View 2: 4-Step Wizard
  const renderWizardView = () => {
    const steps: Array<{ id: WizardStep; label: string }> = [
      { id: 1, label: '选择应用' },
      { id: 2, label: '与 AI 改造应用' },
      { id: 3, label: '核对部署内容' },
      { id: 4, label: '部署与使用' },
    ]
    const upgrading = Boolean(upgradeTarget || wizardJob?.upgrade || wizardJob?.published)
    const effectiveStep1Port = upgradeTarget?.container_port ?? wizardJob?.port ?? opcConfig.defaultPort

    const slugValid = SLUG_RE.test(toAppSlug(appSlug, { allowTrailingDash: false }))
    const canSubmitStep1 =
      !wizardBusy &&
      appName.trim().length > 0 &&
      slugValid &&
      (upgradingStep1 || slugCheck.available !== false) &&
      (!selectedProvider || Boolean(selectedModelItem)) &&
      Boolean(reuseSourceVersion || zipFile || sourcePath.trim())

    const dockerfile = preparedDockerfile?.jobId === wizardJob?.id && preparedDockerfile?.artifactHash === wizardJob?.artifactHash
      ? preparedDockerfile?.content : undefined
    const deliveryFiles = Object.keys(wizardJob?.artifacts ?? {})
    const sourceChanges = wizardJob?.proposal?.changes ?? []
    const dataPlan = wizardJob?.proposal?.contract?.data_plan

    return (
      <div className="oa-overlay-view">
        <header className="oa-overlay-header oa-wizard-header">
          <div className="oa-wizard-heading">
            <div className="oa-wizard-identity">
              <span className="oa-wizard-icon"><AppIcon name={upgrading ? 'refresh' : 'plus'} size={16} /></span>
              <div className="oa-wizard-title">
                <div className="oa-wizard-title-line">
                  <h2>{upgrading ? '升级应用并部署新版本' : '新建并部署应用'}</h2>
                  {(wizardJob?.slug || appSlug) && <span className="oa-code" title={wizardJob?.slug || appSlug}>{wizardJob?.slug || appSlug}</span>}
                </div>
                <p>{upgrading ? '选择新版源码，由 AI 检查改造方案，再核对并部署。' : '选择应用，AI 完成技术准备，你只需处理必要问题并确认部署。'}</p>
              </div>
            </div>
            <button
              type="button"
              className="oa-btn oa-btn-sm oa-wizard-return"
              disabled={wizardBusy}
              onClick={() => void leaveWizard()}
            >
              <AppIcon name="arrowLeft" size={13} />
              <span>{wizardStep === 3 ? '保存草稿并退出' : '返回列表'}</span>
            </button>
          </div>

          <ol className="oa-stepper" aria-label="应用部署步骤">
            {steps.map(step => {
              const stateClass = wizardStep === step.id ? 'active' : wizardStep > step.id ? 'done' : ''
              return (
                <li key={step.id} className={`oa-step-item ${stateClass}`} aria-current={wizardStep === step.id ? 'step' : undefined}>
                  {stateClass === 'done' ? <><AppIcon name="check" size={13} /><span className="oa-step-accessible">已完成</span></> : <span aria-hidden="true">{step.id}.</span>}
                  <span>{step.label}</span>
                </li>
              )
            })}
          </ol>
        </header>

        <div className="oa-overlay-body">
          <NoticeModal
            open={Boolean(wizardError)}
            variant="error"
            message={wizardError || ''}
            onClose={() => setWizardError(null)}
          />

          <NoticeModal
            open={Boolean(wizardNotice)}
            variant="success"
            message={wizardNotice || ''}
            onClose={() => setWizardNotice(null)}
          />

          {/* STEP 1 */}
          {wizardStep === 1 && (
            <form id={`${formId}-source-form`} onSubmit={e => void handleStep1Submit(e)} className="oa-source-form">
              {upgradeTarget && (
                <div className="oa-alert oa-alert-info">
                  <AppIcon name="sparkle" size={16} />
                  <div>
                    <strong>升级目标：{upgradeTarget.name}</strong>（<span className="oa-mono">{upgradeTarget.slug}</span>，{upgradeTarget.current_version ? `当前版本 v${upgradeTarget.current_version}` : '尚无成功部署版本'}）。将沿用原应用访问地址 <span className="oa-mono">{upgradeTarget.app_url}</span>。
                  </div>
                </div>
              )}

              <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="oa-field">
                  <label className="oa-label" htmlFor={`${formId}-app-name`}>应用名称 *</label>
                  <input
                    id={`${formId}-app-name`}
                    className="oa-input"
                    value={appName}
                    placeholder={t("apps.eGExpenseApprovalAssistant")}
                    onCompositionStart={() => {
                      isComposingRef.current = true
                    }}
                    onCompositionEnd={e => {
                      isComposingRef.current = false
                      const nextVal = e.currentTarget.value
                      setAppName(nextVal)
                      if (!upgradeTarget && !slugManual) {
                        setAppSlug(toAppSlug(nextVal, { allowTrailingDash: true }))
                      }
                    }}
                    onChange={e => {
                      const val = e.target.value
                      setAppName(val)
                      if (!upgradeTarget && !slugManual && !isComposingRef.current) {
                        setAppSlug(toAppSlug(val, { allowTrailingDash: true }))
                      }
                    }}
                  />
                </div>

                <div className="oa-field">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <label className="oa-label" htmlFor={`${formId}-app-slug`}>{t("apps.appSubdomainUniqueId")}</label>
                    {!upgradingStep1 && slugManual && appName.trim() && (
                      <button
                        type="button"
                        className="oa-btn-link"
                        style={{ fontSize: 11.5 }}
                        onClick={() => {
                          setSlugManual(false)
                          setAppSlug(toAppSlug(appName, { allowTrailingDash: false }))
                        }}
                      >
                        {t("apps.regenerateFromName")}
                      </button>
                    )}
                  </div>
                  <div className="oa-compound-url">
                    <span className="oa-compound-addon prefix">http://</span>
                    <input
                      id={`${formId}-app-slug`}
                      className="oa-compound-input oa-mono"
                      value={appSlug}
                      disabled={upgradingStep1}
                      placeholder={t("apps.eGDevopsAlyLowercaseLetters")}
                      onCompositionStart={() => {
                        isSlugComposingRef.current = true
                      }}
                      onCompositionEnd={e => {
                        isSlugComposingRef.current = false
                        setSlugManual(true)
                        setAppSlug(toAppSlug(e.currentTarget.value, { allowTrailingDash: true }))
                      }}
                      onChange={e => {
                        setSlugManual(true)
                        const val = e.target.value
                        setAppSlug(isSlugComposingRef.current ? val : toAppSlug(val, { allowTrailingDash: true }))
                      }}
                      onBlur={() => setAppSlug(prev => toAppSlug(prev, { allowTrailingDash: false }))}
                    />
                    <span className="oa-compound-addon suffix" title={`.${opcConfig.appDomainRoot}`}>
                      .{opcConfig.appDomainRoot}
                    </span>
                  </div>
                  <div className="oa-url-preview-bar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                      <span style={{ color: '#64748b', flexShrink: 0 }}>{t("apps.intranetUrl")}</span>
                      <span
                        className="oa-mono"
                        style={{ color: '#2563eb', fontWeight: 500, wordBreak: 'break-all', userSelect: 'all' }}
                      >
                        http://{appSlug.trim() || 'your-app'}.{opcConfig.appDomainRoot}
                      </span>
                      {!upgradingStep1 && slugCheck.checking && (
                        <span className="oa-pill">{t("apps.checking")}</span>
                      )}
                      {!upgradingStep1 && !slugCheck.checking && !slugCheck.error && slugCheck.available && (
                        <span className="oa-pill oa-pill-ok">{t("apps.available")}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, color: '#64748b', flexShrink: 0 }}>
                      {upgradingStep1
                        ? t("apps.containerPort", { port: effectiveStep1Port })
                        : t("apps.containerPortAutoDetectDefault", { port: effectiveStep1Port })}
                    </span>
                  </div>
                  {!upgradingStep1 && slugCheck.error && (
                    <div className="oa-hint" style={{ color: '#dc2626', marginTop: 4 }}>
                      {slugCheck.error}
                    </div>
                  )}
                </div>

                <div className="oa-field">
                  <label className="oa-label" htmlFor={`${formId}-description`}>{t("apps.description")}</label>
                  <textarea
                    id={`${formId}-description`}
                    className="oa-textarea"
                    rows={2}
                    value={appDescription}
                    placeholder={t("apps.brieflyDescribeTheAppUsedFor")}
                    onChange={e => setAppDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="oa-form-card">
                <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a', marginBottom: 4 }}>{t("apps.aiAnalysisModel")}</div>
                <p className="oa-hint" style={{ marginBottom: 12 }}>
                  {t("apps.selectedAiHandlesAppAnalysisAdaptation")}
                </p>
                {modelGroups.length === 0 ? (
                  <div className="oa-hint">{t("apps.usesTheAiModelSelectedIn")}</div>
                ) : (
                  <div className="oa-grid-3">
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-provider`}>{t("apps.provider")}</label>
                      <select id={`${formId}-provider`}
                        className="oa-select"
                        value={selectedProvider}
                        onChange={e => {
                          setSelectedProvider(e.target.value)
                          setSelectedModel('')
                          setSelectedEffort('')
                        }}
                      >
                        <option value="">{t("apps.useCurrentSessionModel")}</option>
                        {modelGroups.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name || g.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-model`}>{t("apps.model")}</label>
                      <select id={`${formId}-model`} className="oa-select" value={selectedModel} disabled={!selectedModelGroup}
                        onChange={e => {
                          setSelectedModel(e.target.value)
                          setSelectedEffort('')
                        }}>
                        <option value="">{selectedModelGroup ? t("apps.selectModel") : t("apps.sessionModel")}</option>
                        {(selectedModelGroup?.models ?? []).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-effort`}>{t("apps.reasoningEffort")}</label>
                      <select id={`${formId}-effort`}
                        className="oa-select"
                        value={selectedEffort}
                        disabled={availableEfforts.length === 0}
                        onChange={e => setSelectedEffort(e.target.value)}
                      >
                        <option value="">{t("apps.modelDefault")}</option>
                        {availableEfforts.map(ef => (
                            <option key={ef.id} value={ef.id}>
                              {ef.name || ef.id}
                            </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <section className="oa-form-card" aria-labelledby={`${formId}-source-label`}>
                <h3 id={`${formId}-source-label`} className="oa-source-label">{t("apps.selectAppSourceFolderOrZip")}<span aria-hidden="true"> *</span></h3>
                <div
                  className={`oa-dropzone${dragActive ? ' dragging' : ''}`}
                  onDragOver={event => {
                    event.preventDefault()
                    if (!wizardBusy) setDragActive(true)
                  }}
                  onDragLeave={event => {
                    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragActive(false)
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    setDragActive(false)
                    const files = event.dataTransfer.files
                    if (files.length === 1 && files[0]) selectZip(files[0])
                    else if (files.length > 1) setWizardError(t("apps.onlyOneZipArchiveCanBe"))
                  }}
                >
                  <span className="oa-source-icon"><AppIcon name="folder" size={22} /></span>
                  <strong>{t("apps.selectLocalAppSource")}</strong>
                  <div className="oa-hint">{t("apps.selectASourceFolderOrDrag")}</div>
                  <div className="oa-source-actions">
                    <button type="button" className="oa-btn oa-btn-primary" disabled={wizardBusy} onClick={() => void handleBrowseFolder()}>
                      <AppIcon name="folder" size={15} /> {t("apps.selectFolder")}
                    </button>
                    <button type="button" className="oa-btn" disabled={wizardBusy} onClick={() => fileInputRef.current?.click()}>
                      <AppIcon name="archive" size={15} /> {t("apps.selectZip")}
                    </button>
                    <input ref={fileInputRef} type="file" accept=".zip,application/zip" hidden onChange={event => {
                      const file = event.currentTarget.files?.[0]
                      event.currentTarget.value = ''
                      if (file) selectZip(file)
                    }} />
                  </div>
                </div>
                {(reuseSourceVersion || zipFile || sourcePath.trim()) && (
                  <div className="oa-source-choice" role="status">
                    <AppIcon name="check" size={16} />
                    <span>
                      {reuseSourceVersion
                        ? t("apps.selectedLocalSavedVSource", { version: reuseSourceVersion })
                        : zipFile
                          ? t("apps.selected", { name: zipFile.name, size: formatFileSize(zipFile.size) })
                          : t("apps.localSourcePathEntered")}
                    </span>
                    <button type="button" className="oa-btn oa-btn-xs" disabled={wizardBusy} onClick={() => selectSourcePath('')}>{t("apps.clear")}</button>
                  </div>
                )}
                <div className="oa-field">
                  <label className="oa-label" htmlFor={`${formId}-source-path`}>{t("apps.orEnterFullPathToSource")}</label>
                  <input id={`${formId}-source-path`} ref={sourcePathInputRef} className="oa-input oa-mono"
                    value={sourcePath} placeholder={t("apps.pathToMyAppOrPath")} disabled={wizardBusy}
                    onChange={event => selectSourcePath(event.currentTarget.value)} />
                </div>
              </section>
            </form>
          )}

          {/* STEP 2 */}
          {wizardStep === 2 && wizardJob && (
            <AppDeliveryReview
              key={wizardJob.id}
              api={api}
              sessionId={sessionId}
              contextId={contextId}
              jobId={wizardJob.id}
              beginAnalysisNavigation={beginAnalysisNavigation}
              footerMode="external"
              repairMode={wizardJob.analysis_mode === 'repair' || wizardJob.analysisMode === 'repair'}
              onReady={setWizardJob}
              onReplaceSource={() => {
                setReuseSourceVersion(undefined)
                setPreviousJobId(wizardJob.id)
                setAppName(wizardJob.name)
                setAppSlug(wizardJob.slug)
                setSlugManual(true)
                setAppDescription(wizardJob.description ?? '')
                if (wizardJob.upgrade || wizardJob.published) {
                  const target = apps.find(a => a.slug === wizardJob.slug && a.can_manage === true)
                  if (target) setUpgradeTarget(target)
                }
                setWizardStep(1)
              }}
              onNextStep={() => setWizardStep(3)}
              onInvalidate={() => void refreshWizardJob(wizardJob.id)}
              onStepStateChange={setStep2State}
            />
          )}

          {/* STEP 3 */}
          {wizardStep === 3 && wizardJob && (
            <div className="oa-deploy-review">
              <div className="oa-form-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: '#0f172a' }}>{wizardJob.name}</strong>
                      <span className="oa-code">{wizardJob.slug}</span>
                      <span className="oa-pill oa-pill-accent">{t("apps.port", { port: wizardJob.port ?? opcConfig.defaultPort })}</span>
                      {wizardJob.proposal?.contract?.runtime?.language && (
                        <span className="oa-pill oa-pill-teal">
                          {wizardJob.proposal.contract.runtime.language} {wizardJob.proposal.contract.runtime.version || ''}
                        </span>
                      )}
                    </div>
                    <div className="oa-hint" style={{ marginTop: 4 }}>
                      {t("apps.accessUrl")}<span className="oa-mono">{wizardJob.url}</span>
                    </div>
                  </div>

                  <div className="oa-segmented">
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'configs' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('configs')}
                    >
                      {t("apps.runtimeConfig")}
                      {hasConfigIssues && <span className="oa-dot oa-config-tab-warning" role="img" aria-label={t("apps.configActionNeeded")} />}
                    </button>
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'skill' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('skill')}
                    >
                      {t("apps.appSkill")}
                    </button>
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'dockerfile' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('dockerfile')}
                    >
                      Dockerfile
                    </button>
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'mounts' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('mounts')}
                    >
                      {t("apps.mounts")}
                      {hasMissingStorage && <span className="oa-dot oa-config-tab-warning" role="img" aria-label={t("apps.mountActionNeeded")} />}
                    </button>
                  </div>
                </div>

                <div className="oa-field" style={{ marginTop: 12 }}>
                  <label className="oa-label" htmlFor={`${formId}-version-note`}>{t("apps.releaseNoteOptional")}</label>
                  <input id={`${formId}-version-note`}
                    className="oa-input"
                    value={versionNote}
                    disabled={!step3Ready}
                    placeholder={wizardJob.upgrade ? t("apps.eGAddedApprovalExportApi") : t("apps.eGInitialRelease")}
                    onChange={e => handleStep3NoteChange(e.target.value)}
                  />
                </div>
              </div>

              {currentStep3Load?.status === 'failed' && (
                <div className="oa-alert oa-alert-danger" role="alert">
                  <div>{currentStep3Load.error}</div>
                  <button type="button" className="oa-btn oa-btn-sm" onClick={() => void syncStep3Drafts(wizardJob)}>{t("apps.reload")}</button>
                </div>
              )}
              {step3Loading && (
                <div className="oa-form-card oa-deploy-loading" role="status">
                  <div className="oa-deploy-loading-icon" aria-hidden="true">
                    <AppIcon name="refresh" size={22} className="oa-spin" />
                  </div>
                  <strong>{t("apps.loadingDeploymentReview")}</strong>
                  <span className="oa-hint">{t("apps.readingRuntimeConfigsDockerfileAndMount")}</span>
                </div>
              )}

              {step3Ready && (deliveryFiles.length > 0 || sourceChanges.length > 0) && (() => {
                const summaryParts = [
                  deliveryFiles.length > 0 ? t("apps.deliveryFiles", { count: deliveryFiles.length }) : '',
                  sourceChanges.length > 0 ? t("apps.sourceChanges", { count: sourceChanges.length }) : '',
                ].filter(Boolean)
                return (
                  <details className="oa-subcard oa-cfg-ref-details">
                    <summary>
                      <span>{t("apps.deliveryFilesAndSourceChanges")}{summaryParts.length > 0 ? ` (${summaryParts.join(' · ')})` : ''}</span>
                      <span className="oa-cfg-ref-toggle" aria-hidden="true">
                        <AppIcon name="chevronDown" size={14} />
                      </span>
                    </summary>
                    {deliveryFiles.length > 0 && (
                      <div className="oa-delivery-file-actions">
                        {deliveryFiles.map(filename => (
                          <button key={filename} type="button" className="oa-btn oa-btn-sm"
                            onClick={() => void handleSaveLocalArtifact(wizardJob.id, filename)}>
                            <AppIcon name="fileCode" size={13} />
                            <span className="oa-mono">{filename}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {sourceChanges.map((change, index) => (
                      <div key={change.id || index} className="oa-cfg-ref-file">
                        <code className="oa-code">{change.path}</code> {change.reason}
                        {change.diff && (
                          <details>
                            <summary>{t("apps.viewDiff")}</summary>
                            <pre className="oa-dockerfile-source oa-mono">{change.diff}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </details>
                )
              })()}

              {step3Ready && configSubTab === 'configs' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t("apps.runtimeEnvironmentConfig")}>
                  {api.appWatchConfigChat && wizardJob.analysisSessionId && (
                    <div className="oa-draft-banner">
                      <span>{wizardJob.analysisSessionId !== sessionId ? t("apps.askAiInTheOriginalDeployment")
                        : configChatStatus === 'ready' ? t("apps.linkedToLeftAiChatAsk")
                        : configChatStatus === 'connecting' ? t("apps.connectingToLeftAiConfigAssistant")
                        : t("apps.draftSyncTemporarilyUnavailableLeftChat") + (configChatError ? ` · ${configChatError}` : '')}</span>
                      {wizardJob.analysisSessionId !== sessionId && prepareAnalysisNavigation &&
                        <button type="button" className="oa-btn oa-btn-sm" onClick={() => beginAnalysisNavigation()?.(wizardJob)}>{t("apps.openDeploymentChat")}</button>}
                      {wizardJob.analysisSessionId === sessionId && configChatStatus === 'unavailable' &&
                        <button type="button" className="oa-btn oa-btn-sm" onClick={() => setConfigChatReconnect(value => value + 1)}>{t("apps.reconnect")}</button>}
                    </div>
                  )}
                  {aiConfigEdits.length > 0 && (
                    <div className="oa-draft-banner" role="status">
                      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <strong>{t("apps.aiUpdatedThisDraft")}</strong>
                        {aiConfigEdits.map(edit => (
                          <div key={edit.after.key} className="oa-hint">
                            {edit.after.description || edit.after.key} · {configChatRow(edit.before, deploymentResources, volumeMounts).value || t("apps.empty")}
                            {' → '}{configChatRow(edit.after, deploymentResources, volumeMounts).value || t("apps.empty")}
                          </div>
                        ))}
                      </div>
                      <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy || !aiConfigEdits.some(edit => configDrafts.includes(edit.after))}
                        onClick={() => void undoAiConfigEdits()}>{t("apps.undoAiEdits")}</button>
                    </div>
                  )}
                  <AppDeliveryConfig
                    configs={configDrafts}
                    allowNew={wizardJob.proposal?.delivery_format !== 1}
                    originals={originalConfigs}
                    resources={deploymentResources}
                    lockedPort={wizardJob.port ?? opcConfig.defaultPort}
                    publishIssues={configIssues}
                    skillDriven={skillDrivenDelivery}
                    readOnly={wizardBusy}
                    onChange={handleStep3ConfigsChange}
                  />

                  <details className="oa-subcard oa-cfg-ref-details">
                    <summary>
                      <span>
                        {t("apps.viewOriginalProjectConfigReference")}
                        {sourceConfiguration?.files?.length
                          ? t("apps.files", { count: sourceConfiguration.files.length })
                          : ''}
                      </span>
                      <span className="oa-hint">{t("apps.readOnlyReferenceEditSourceFiles")}</span>
                    </summary>
                    {!sourceConfiguration ? (
                      <p className="oa-hint" style={{ margin: '8px 0 0' }}>{t("apps.unableToReadOriginalAppConfig")}</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        {sourceConfiguration.files.map(file => (
                          <details key={file.path} className="oa-cfg-ref-file">
                            <summary>
                              <code>{file.path}</code>
                              {file.is_example && <span className="oa-pill">{t("apps.config.example")}</span>}
                              <span className="oa-hint">{t("apps.items", { count: file.fields.length })}</span>
                            </summary>
                            {file.fields.length > 0 && (
                              <dl className="oa-cfg-ref-dl">
                                {file.fields.map(({ key, value }, index) => (
                                  <React.Fragment key={`${key}-${index}`}>
                                    <dt><code>{key}</code></dt>
                                    <dd><code>{value || t("apps.empty_2")}</code></dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            )}
                          </details>
                        ))}
                        {sourceConfiguration.references.length > 0 && (
                          <div className="oa-cfg-ref-file">
                            <div className="oa-hint" style={{ fontWeight: 600, marginBottom: 4 }}>{t("apps.envVarsReferencedInSource")}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {sourceConfiguration.references.map(key => (
                                <code key={key} className="oa-code">{key}</code>
                              ))}
                            </div>
                          </div>
                        )}
                        {!sourceConfiguration.files.length && !sourceConfiguration.references.length && (
                          <p className="oa-hint" style={{ margin: '6px 0 0' }}>{t("apps.noConfigFilesOrEnvVar")}</p>
                        )}
                      </div>
                    )}
                  </details>
                </section>
              )}

              {step3Ready && configSubTab === 'mounts' && (
                <div className="oa-form-card">
                  {volumeMounts.length === 0 ? (
                    <div className="oa-hint">{t("apps.noDirectoryMountsForThisApp")}</div>
                  ) : (
                    <div className="oa-subcard">
                      <div className="oa-subcard-head">
                        <span>{t("apps.persistentDirectoriesAndStorageResources")}</span>
                        <span className="oa-pill oa-pill-ok">{t("apps.text", { count: volumeMounts.length })}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {volumeMounts.map((mount, index) => {
                          if (!mount.container_path) {
                            return (
                              <p key={index} className="oa-config-field-warning">
                                {t("apps.thisMountIsMissingAContainer")}
                              </p>
                            )
                          }
                          const existing = existingStorage.find(old => old.container_path === mount.container_path)
                          const options = volumeOptions(mount)
                          const missingResource = !existing && !storageSelections[mount.container_path]
                          const issueId = `${formId}-mount-issue-${index}`
                          return (
                            <div key={mount.container_path} className="oa-hint">
                              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                <span>
                                  <code>{mount.container_path}</code> {mount.purpose || ''}
                                </span>
                                {existing ? (
                                  <span>{t("apps.reuse", { loc: existing.storage_location || existing.host_path || existing.volume_name || t("apps.existingMount") })}</span>
                                ) : (
                                  <select
                                    aria-label={t("apps.storageResource", { path: mount.container_path })}
                                    aria-invalid={missingResource ? true : undefined}
                                    aria-describedby={missingResource ? issueId : undefined}
                                    value={storageSelections[mount.container_path]}
                                    disabled={wizardBusy || options.length === 0}
                                    onChange={event => {
                                      const next = { ...storageBindings, [mount.container_path]: event.target.value }
                                      setStorageBindings(next)
                                      scheduleDraftSave(wizardJob, configDrafts, versionNote, next)
                                    }}
                                  >
                                    {(skillDrivenDelivery || options.length === 0) && (
                                      <option value="" disabled>{options.length > 0 ? t("apps.selectStorageResource")
                                        : mount.kind === 'sqlite' ? t("apps.awaitingAdminLocalDiskVolume") : t("apps.awaitingAdminStorageConfig")}</option>
                                    )}
                                    {options.map(resource => (
                                      <option key={resource.id} value={resource.id}>
                                        {resource.name} · {resource.type === 'aliyun-oss-volume' ? t("apps.alibabaOss") : t("apps.localDisk")}
                                        {resource.is_default ? t("apps.default") : ''}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </label>
                              {missingResource && (
                                <p id={issueId} className="oa-config-field-warning">
                                  {options.length ? t("apps.pleaseSelectAStorageResourceFor") : t("apps.contactAnAdminToEnableA")}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {dataPlan && (
                    <details className="oa-subcard oa-cfg-ref-details" open={dataPlan.strategy === 'postgres_copy'}>
                      <summary>{t("apps.dataMigrationAndRecovery")}</summary>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{dataPlan.summary}</p>
                      {dataPlan.strategy === 'postgres_copy' && (
                        <div className="oa-hint">
                          {t("apps.source")} <code>{dataPlan.source_resource_id}</code> · {t("apps.staging")} <code>{dataPlan.rehearsal_resource_id}</code> · {t("apps.target")} <code>{dataPlan.target_resource_id}</code>
                          <p>{t("apps.releaseIncludesABriefWriteFreeze")}</p>
                        </div>
                      )}
                      {dataPlan.migration_files?.map(path => <div key={path}><code>{path}</code></div>)}
                      <p style={{ whiteSpace: 'pre-wrap' }}>{t("apps.recovery")}: {dataPlan.recovery}</p>
                    </details>
                  )}
                </div>
              )}

              {step3Ready && configSubTab === 'skill' && <AppSkillPreview api={api} contextId={contextId} job={wizardJob} />}

              {step3Ready && configSubTab === 'dockerfile' && (
                <section className="oa-subcard oa-dockerfile-panel" aria-label={t("apps.buildDockerfile")}>
                  <div className="oa-subcard-head">
                    <strong>{t("apps.buildDockerfile")}</strong>
                    {dockerfile && (
                      <button type="button" className="oa-btn oa-btn-sm" onClick={() => void copyText(`dockerfile-${wizardJob.id}`, dockerfile)}>
                        <AppIcon name={copiedKey === `dockerfile-${wizardJob.id}` ? 'check' : 'copy'} size={13} />
                        {copiedKey === `dockerfile-${wizardJob.id}` ? t("common.copied") : t("apps.copyDockerfile")}
                      </button>
                    )}
                  </div>
                  {dockerfile ? (
                    <pre className="oa-dockerfile-source oa-mono" tabIndex={0} aria-label={t("apps.dockerfileContent")}><code>{dockerfile}</code></pre>
                  ) : (
                    <p className="oa-hint" role="status">{dockerfile === undefined ? t("apps.loadingDockerfile") : t("apps.unableToReadDockerfile")}</p>
                  )}
                  {(wizardJob.proposal?.contract?.build_inputs?.length ?? 0) > 0 && (
                    <details className="oa-cfg-ref-details">
                      <summary>{t("apps.buildArgSources")}</summary>
                      <dl className="oa-cfg-ref-dl">
                        {wizardJob.proposal?.contract?.build_inputs?.map(input => (
                          <div key={input.arg}>
                            <dt><code>{input.arg}</code></dt>
                            <dd>{t("apps.fromConfirmedConfig")} <code>{input.key}</code></dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </section>
              )}
            </div>
          )}

          {/* STEP 4 */}
          {wizardStep === 4 && wizardJob && (() => {
            const progress = deploymentProgress(wizardJob)
            const failed = progress.tone === 'danger'
            const attempt = displayedAttempt(wizardJob)
            const liveLogs = followsDeploymentAttempt(attempt) || isDeploymentInProgress(wizardJob.status)
            const elapsed = elapsedAttemptTime(attempt?.phase_started_at)
            const previous = attempt?.blocking_request_id ? jobs.find(job => job.slug === wizardJob.slug && job.requestId === attempt.blocking_request_id) : undefined
            const recheck = startupRecheck?.key === progressRequestKey ? startupRecheck : undefined
            return (
              <div className="oa-deploy-progress">
                <div className="oa-deploy-status" role="status">
                  <span className={`oa-pill oa-pill-${progress.tone}`}>
                    <span className={`oa-dot${progress.tone === 'warn' ? ' oa-pulse' : ''}`} />
                    {progress.label}
                  </span>
                  {progress.tone === 'ok' && (
                    <a href={wizardJob.url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-sm">
                      <AppIcon name="external" size={13} /> {t("apps.openApp")}
                    </a>
                  )}
                  {attempt && progress.tone !== 'ok' && (
                    <div className="oa-deploy-actions">
                      {!['submitting', 'submission_rejected', 'cancelled', 'restored'].includes(attempt.phase) && api.appVerifyWithOptions && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleCheckAttempt()}>{t("apps.recheck")}</button>
                      )}
                      {attempt.can_cancel && !['unknown', 'cancelling', 'cleaning'].includes(attempt.phase) && api.appCancelDeployment && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleCancelAttempt()}>{t("apps.cancelDeployment")}</button>
                      )}
                      {attempt.phase === 'blocked_previous' && previous && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void resumeWizardJob(previous, 4)}>{t("apps.viewPreviousDeployment")}</button>
                      )}
                      {attempt.phase === 'submission_rejected' && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => setWizardStep(3)}>{t("apps.backToStep3")}</button>
                      )}
                      {attempt.retry_safe && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRetryDeployment()}>{t("apps.retryDeployment")}</button>
                      )}
                      {attempt.retry_safe && (attempt.failure_kind === 'build' || attempt.failure_kind === 'startup') && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleLaunchRepair()}>{t("apps.letAiDiagnoseAndFix")}</button>
                      )}
                      {attempt.phase === 'restored' && (
                        <a href={wizardJob.url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-sm">{t("apps.openCurrentVersion")}</a>
                      )}
                    </div>
                  )}
                </div>
                {attempt && (
                  <div className="oa-hint oa-deploy-message">
                    {attempt.phase === 'unknown' && <div>
                      {t("apps.checkingDeploymentStatus")}
                      {attempt.last_observed_phase && t("apps.lastSeenAt", { phase: attemptLabel(wizardJob, attempt.last_observed_phase) })}
                      {attempt.last_observed_at && ` ${new Date(attempt.last_observed_at).toLocaleTimeString(getIntlLocale(locale))}`}
                    </div>}
                    {attempt.phase === 'blocked_previous' && <div>{t("apps.onceThePreviousDeploymentFinishesCleanup")}</div>}
                    {attempt.stalled && elapsed && <div>{t("apps.elapsed", { elapsed })}{attempt.phase === 'starting' ? t("apps.appIsStillStarting") : '.'}</div>}
                    {attempt.active_version && progress.tone !== 'ok' ? <div>{t("apps.latestLiveVersionV", { version: attempt.active_version })}</div> : null}
                    {attempt.phase === 'recovery_required' && <div>{t("apps.platformIsProtectingAppDataPlease")}</div>}
                    {(failed || attempt.phase === 'restored') && wizardJob.error && <div>{wizardJob.error}</div>}
                  </div>
                )}
                {wizardJob.assessment && (
                  <div className="oa-subcard oa-deploy-message">
                    <strong>{t("apps.aiVerificationSummary")}</strong>
                    <p>{wizardJob.assessment.report}</p>
                  </div>
                )}
                {failed && !attempt && (
                  <>
                    <div className="oa-alert oa-alert-danger" role="alert">
                      <AppIcon name="warning" size={16} />
                      <div className="oa-deploy-message">{blockedByPreviousBuild(wizardJob)
                        ? t("apps.aPreviousBuildIsStillIn")
                        : wizardJob.error || t("apps.platformDidNotReturnASpecific")}</div>
                    </div>
                    <div className="oa-deploy-actions">
                      {api.appVerifyWithOptions && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRecheckStartup()}>
                          <AppIcon name="refresh" size={13} />
                          {recheck?.pending ? t("apps.checking_2") : t("apps.recheckIfAppHasStarted")}
                        </button>
                      )}
                      {wizardJob.assessmentPending ? (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleContinueAssessment()}>
                          {t("apps.continueAiVerification")}
                        </button>
                      ) : blockedByPreviousBuild(wizardJob) ? (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRetryDeployment()}>
                          {t("apps.verifyAndRedeploy")}
                        </button>
                      ) : (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleLaunchRepair()}>
                          {t("apps.letAiDiagnoseAndFix")}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {recheck?.message && (
                  <div className={`oa-hint oa-deploy-message${recheck.error ? ' oa-deploy-recheck-error' : ''}`} role="status">{recheck.message}</div>
                )}
                {(progressUsesReceipt ? api.appDeploymentLogs : api.appLogs) && (
                  <DeploymentLogs
                    key={progressRequestKey}
                    fetchLogs={fetchDeploymentLogs}
                    live={liveLogs}
                    buildOnly={liveLogs && !progressUsesReceipt}
                    onCopy={text => void copyText('wizard-logs', text)}
                    copied={copiedKey === 'wizard-logs'}
                  />
                )}
              </div>
            )
          })()}
        </div>

        <div className="oa-overlay-footer">
          {wizardStep === 1 && (
            <>
              <button
                type="button"
                className="oa-btn"
                onClick={() => {
                  setViewMode('list')
                  void loadWorkspaceData(true)
                }}
              >
                {t("apps.delete.cancel")}
              </button>
              <button type="submit" form={`${formId}-source-form`} className="oa-btn oa-btn-primary" disabled={!canSubmitStep1}>
                {wizardBusy ? t("apps.importingSource") : t("apps.createAndAnalyze")}
              </button>
            </>
          )}

          {wizardStep === 2 && wizardJob && (
            <>
              <button
                type="button"
                className="oa-btn"
                onClick={() => {
                  setReuseSourceVersion(undefined)
                  setPreviousJobId(wizardJob.id)
                  setAppName(wizardJob.name)
                  setAppSlug(wizardJob.slug)
                  setSlugManual(true)
                  setAppDescription(wizardJob.description ?? '')
                  if (wizardJob.upgrade || wizardJob.published) {
                    const target = apps.find(a => a.slug === wizardJob.slug && a.can_manage === true)
                    if (target) setUpgradeTarget(target)
                  }
                  setWizardStep(1)
                }}
              >
                {t("apps.backToSource")}
              </button>
              {step2State?.jobId === wizardJob.id && step2State.canContinue && (
                <button type="button" className="oa-btn oa-btn-primary" onClick={() => step2State.triggerNext()}>
                  {t("apps.review.nextReviewDeployment")}
                </button>
              )}
            </>
          )}

          {wizardStep === 3 && wizardJob && (
            <>
              <button type="button" className="oa-btn" disabled={wizardBusy} onClick={() => void handleReturnToReview()}>
                {t("apps.backToProposal")}
              </button>
              <button
                type="button"
                className="oa-btn oa-btn-primary"
                disabled={wizardBusy || !step3Ready || hasConfigIssues || hasMissingStorage}
                onClick={() => void handlePublishApp()}
              >
                {wizardBusy ? t("apps.deploying") : step3Loading ? t("apps.loadingDeployment") : t("apps.confirmAndDeploy")}
              </button>
            </>
          )}

          {wizardStep === 4 && (wizardJob && deploymentProgress(wizardJob).tone === 'warn' ? (
            <button type="button" className="oa-btn" disabled>{t("apps.deploying_2")}</button>
          ) : (
            <>
              <span className="oa-hint">{t("apps.manageConfigsVersionsAndBackupsFrom")}</span>
              <button
                type="button"
                className="oa-btn oa-btn-primary"
                onClick={() => {
                  setViewMode('list')
                  void loadWorkspaceData(false)
                }}
              >
                {t("apps.backToAppList")}
              </button>
            </>
          ))}
        </div>
      </div>
    )
  }

  // Render View 3: Full App Detail View
  const renderDetailView = () => {
    if (!detailApp && detailLoading) {
      return (
        <div className="oa-form-card" style={{ textAlign: 'center', padding: '44px 20px', color: '#64748b' }}>
          {t("apps.loadingAppDetails")}
        </div>
      )
    }
    if (!detailApp) {
      return (
        <div className="oa-form-card">
          <NoticeModal
            open={true}
            variant="error"
            message={detailError || t("apps.appNotFoundOrAccessDenied")}
            onClose={() => setViewMode('list')}
          />
          <button type="button" className="oa-btn" style={{ marginTop: 12 }} onClick={() => setViewMode('list')}>
            {t("apps.backToApps")}
          </button>
        </div>
      )
    }

    const tone = jobStatusTone(detailApp.status, undefined, locale)
    const readOnly = detailApp.can_manage !== true
    const lastHealthCheck = detailHealthCheck?.slug === detailApp.slug ? detailHealthCheck : null
    const unhealthy = detailApp.status === 'failed' || detailApp.status === 'unhealthy'
    const matchingJob = jobs.find(j => j.slug === detailApp.slug && j.version === detailApp.current_version) ?? jobs.find(j => j.slug === detailApp.slug)
    const activeVersion = versions.find(item => item.is_active) ?? versions.find(item => item.version === detailApp.current_version)
    const requiresAIUpdate = !activeVersion || Boolean(activeVersion.download_urls?.['delivery.json']) ||
      (matchingJob?.version === detailApp.current_version && matchingJob?.proposal?.delivery_format === 1)
    const activeLocalJob = matchingJob?.version === detailApp.current_version && matchingJob?.status === 'verified' ? matchingJob : undefined
    const detailTabs = {
      configs: t("apps.runtimeConfig"),
      storage: t("apps.storage"),
      versions: t("apps.versions_2", { n: visibleVersions.length }),
      logs: t("apps.logsAndDockerfile"),
      artifacts: t("apps.capabilitiesAndSkill"),
    } satisfies Record<DetailTab, string>

    const onlineRuntime = api.appRuntimeChange ? runtimeStatus : undefined
    const runtimeBlocked = runtimeOperationBusy(runtimeOperation) || runtimeOperation?.state === 'unknown' || runtimeOperation?.state === 'recovery_unknown'
    const runtimeEditable = onlineRuntime && !readOnly && !runtimeBlocked &&
      activeVersion && activeVersion.version === detailApp.current_version && (activeVersion.config_revision ?? '') === onlineRuntime.config_revision
    const runtimeOriginals = detailApp.app_config ?? []
    const editableRuntimeKeys = new Set(runtimeEditable && !runtimeSubmitting ? onlineRuntime.editable_keys : [])
    const runtimeChanges = Object.fromEntries(runtimeOriginals
      .filter(item => onlineRuntime?.editable_keys.includes(item.key) && Object.hasOwn(runtimeDraft, item.key) && item.value !== runtimeDraft[item.key])
      .map(item => [item.key, runtimeDraft[item.key]]))
    const runtimeConfigs = runtimeOriginals.map(item =>
      Object.hasOwn(runtimeChanges, item.key) ? { ...item, value: runtimeChanges[item.key], value_source: 'manual' } : item)
    const runtimeBaseline = { base_version: detailApp.current_version, base_config_revision: onlineRuntime?.config_revision }
    const logView = detailTab === 'logs'
    const detailLog = formatLogOutput(detailLogsData[detailLogsSubTab])
    const logSummary = detailLogsSubTab === 'runtime' ? t("apps.containerOutputLast500Lines")
      : detailLogsSubTab === 'build' ? t("apps.buildAndDeployLogs") : t("apps.archivedDockerfile")

    return (
      <div className="oa-overlay-view oa-app-detail-view">
        <div className="oa-overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => setViewMode('list')}>
              <AppIcon name="arrowLeft" size={13} />
              <span>{t("apps.back")}</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              <strong style={{ fontSize: 15, color: '#0f172a' }}>{detailApp.name}</strong>
              <span className="oa-code">{detailApp.slug}</span>
              {detailApp.current_version ? <span className="oa-pill oa-pill-accent">v{detailApp.current_version}</span> : null}
              <span className={`oa-pill ${tone.pillClass}`}>
                {tone.spinning && <span className="oa-dot oa-pulse" />}
                {tone.text}
              </span>
              {readOnly && <span className="oa-pill">{t("apps.readOnly")}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!readOnly && (detailApp.current_version ?? 0) > 0 && api.appRuntimeStatus && api.appRuntimeChange && (
              <button type="button" className="oa-btn oa-btn-sm" onClick={() => openRuntimePanel(detailApp, true)}>{t("apps.restart")}</button>
            )}
            <button
              type="button"
              className="oa-btn oa-btn-sm"
              disabled={detailLoading || detailBusy}
              onClick={() => void openAppDetail(detailApp.slug, detailTab)}
            >
              <AppIcon name="refresh" size={13} className={detailLoading ? 'oa-spin' : ''} />
              <span>{t("common.refresh")}</span>
            </button>
            {!readOnly && (
              <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => startWizardNew(detailApp, findAppJob(jobs, detailApp))}>
                <AppIcon name="plus" size={13} />
                <span>{t("apps.deployNewVersion")}</span>
              </button>
            )}
            {!readOnly && api.appDeleteWithOptions && (
              <button type="button" className="oa-btn oa-btn-sm oa-btn-danger" onClick={() => setDeleteModalOpen(true)}>
                <AppIcon name="trash" size={13} />
                <span>{t("apps.deleteApp")}</span>
              </button>
            )}
          </div>
        </div>

        <div className="oa-overlay-body">
          <NoticeModal
            open={Boolean(detailError)}
            variant="error"
            message={detailError || ''}
            onClose={() => setDetailError(null)}
          />

          <NoticeModal
            open={Boolean(detailNotice)}
            variant="success"
            message={detailNotice || ''}
            onClose={() => setDetailNotice(null)}
          />

          <NoticeModal
            open={Boolean(lastHealthCheck?.ok && !unhealthy)}
            variant="success"
            message={lastHealthCheck?.message || ''}
            onClose={() => setDetailHealthCheck(null)}
          />

          <NoticeModal
            open={Boolean(lastHealthCheck?.ok === false)}
            variant="error"
            title={t("apps.healthCheckFailed")}
            message={lastHealthCheck?.message || ''}
            onClose={() => setDetailHealthCheck(null)}
            actions={!readOnly ? (
              <button
                type="button"
                className="oa-btn oa-btn-sm"
                onClick={() => {
                  setDetailHealthCheck(null)
                  setDetailTab('logs')
                }}
              >
                {t("apps.viewLogs")}
              </button>
            ) : undefined}
          />

          {unhealthy && (
            <div className="oa-alert oa-alert-danger" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AppIcon name="warning" size={16} />
                <div>
                  <strong>{t("apps.appStatusAbnormal")}</strong>
                  <div style={{ marginTop: 2 }}>{healthFailureDetail(detailApp.error_message) || t("apps.pleaseRecheckStatusOrInspectServer")}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!readOnly && api.appRecheck && (
                  <button type="button" className="oa-btn oa-btn-xs" disabled={detailBusy} onClick={() => void handleRecheckApp(detailApp.slug, true)}>
                    {t("apps.recheck_2")}
                  </button>
                )}
                <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailTab('logs')}>
                  {t("apps.viewLogs")}
                </button>
              </div>
            </div>
          )}

          <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <span className="oa-mono" style={{ fontSize: 12.5, color: '#0f172a' }}>{detailApp.app_url}</span>
                <button type="button" className="oa-btn oa-btn-xs" onClick={() => void copyText('detail-url', detailApp.app_url)}>
                  <AppIcon name={copiedKey === 'detail-url' ? 'check' : 'copy'} size={11} />
                </button>
              </div>
              {detailApp.app_url && (
                <a href={detailApp.app_url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-xs">
                  <AppIcon name="external" size={12} />
                  <span>{t("apps.openApp")}</span>
                </a>
              )}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#334155' }}>
              {detailApp.description || t("apps.noDescription")}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 18px', paddingTop: 8, borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' }}>
              <span>{t("apps.port_2")}<strong className="oa-mono" style={{ color: '#0f172a' }}>{detailApp.container_port ?? opcConfig.defaultPort}</strong></span>
              <span>{t("apps.runtime")}<strong style={{ color: '#0f172a' }}>{detailApp.language || t("apps.unknown")} {detailApp.runtime_version || ''}</strong></span>
              <span>{t("apps.created")}{formatDateTime(detailApp.created_at)}</span>
              <span>{t("apps.updated")}{formatDateTime(detailApp.updated_at)}</span>
            </div>
          </div>

          {/* 5 Segmented Detail Tabs */}
          <div className="oa-segmented oa-detail-tab-list" role="tablist" aria-label="应用详情">
            {(Object.keys(detailTabs) as DetailTab[]).map((tab, index, tabs) => (
              <button key={tab} id={`${formId}-tab-${tab}`} type="button" role="tab"
                aria-selected={detailTab === tab} aria-controls={`${formId}-detail-panel`} tabIndex={detailTab === tab ? 0 : -1}
                className={`oa-segmented-btn ${detailTab === tab ? 'active' : ''}`} onClick={() => setDetailTab(tab)}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  setDetailTab(tabs[next])
                  document.getElementById(`${formId}-tab-${tabs[next]}`)?.focus()
                }}>
                {detailTabs[tab]}
              </button>
            ))}
          </div>

          <div id={`${formId}-detail-panel`} role="tabpanel" aria-labelledby={`${formId}-tab-${detailTab}`} tabIndex={0}
            className={logView ? 'oa-detail-tab-panel oa-detail-log-panel' : 'oa-detail-tab-panel'}>
          {detailTab === 'artifacts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14, color: '#0f172a' }}>{t("apps.agentSkill")}</strong>
                    <span className="oa-code">{detailApp.skill_name || `app-${detailApp.slug}`}</span>
                    {detailApp.skill_synced !== undefined && (
                      <span className={`oa-pill ${detailApp.skill_synced ? 'oa-pill-ok' : 'oa-pill-warn'}`}>
                        {detailApp.skill_synced ? t("apps.synced") : t("apps.pendingSync")}
                      </span>
                    )}
                  </div>
                  <div className="oa-hint">
                    {detailApp.skill_synced
                      ? t("apps.installedLocallyReadyToInvokeIn")
                      : t("apps.skillSyncsAutomaticallyAfterPageVerificati")}
                  </div>
                </div>
                {!readOnly && detailApp.skill_synced === false && api.appSyncSkill && (
                  <button
                    type="button"
                    className="oa-btn oa-btn-sm oa-btn-primary"
                    disabled={detailBusy}
                    onClick={() => void handleSyncSkill(detailApp.slug)}
                  >
                    <AppIcon name="sparkle" size={13} />
                    <span>{detailBusy ? t("apps.syncingToOpcPlatform") : t("apps.syncToOpcPlatform")}</span>
                  </button>
                )}
              </div>
              <AppDeliveryArtifacts
                api={api}
                contextId={contextId}
                slug={detailApp.slug}
                version={detailApp.current_version}
                readOnly={readOnly}
                onOpenVerification={job => void resumeWizardJob(job, 4)}
              />
            </div>
          )}

          {/* Tab 2: Configs */}
          <NoticeModal
            open={Boolean(detailTab === 'configs' && api.appRuntimeStatus && currentRuntimeError)}
            variant="error"
            title={t("apps.unableToLoadRuntimeConfig")}
            message={currentRuntimeError || ''}
            onClose={() => setRuntimeError(null)}
            actions={(
              <button type="button" className="oa-btn oa-btn-sm" onClick={() => {
                setRuntimeError(null)
                setRuntimeRefresh(value => value + 1)
              }}>{t("apps.reload_2")}</button>
            )}
          />
          {detailTab === 'configs' && !readOnly && api.appRuntimeStatus && !runtimeStatus && !currentRuntimeError && (
            <div className="oa-alert" role="status"><span className="oa-dot oa-pulse" /> {t("apps.loadingRuntimeConfig")}</div>
          )}
          {detailTab === 'configs' && (
            <div className="oa-form-card">
              <div className="oa-runtime-toolbar">
                <div>
                  <strong>{t("apps.liveRuntimeConfig")}</strong>
                  <div className="oa-hint">
                    {readOnly
                      ? t("apps.readOnlyViewHint")
                      : onlineRuntime
                      ? t("apps.appVConfigRev", { version: detailApp.current_version ?? '', num: onlineRuntime.config_number ?? '' })
                      : requiresAIUpdate
                        ? t("apps.aiAnalyzesConfigChangesInThe")
                        : t("apps.savingRestartsTheContainerToApply")}
                  </div>
                </div>
                {!readOnly && (onlineRuntime ? (
                  <div className="oa-runtime-actions">
                    <button type="button" className="oa-btn oa-btn-xs" onClick={() => setShowRuntimeHistory(value => !value)} aria-expanded={showRuntimeHistory}>{t("apps.configHistory")}</button>
                    <button type="button" className="oa-btn oa-btn-xs" disabled={runtimeBlocked} onClick={() => startWizardNew(detailApp, activeLocalJob, true)}>{t("apps.aiAnalyzeConfigUpdate")}</button>
                    <button type="button" className="oa-btn oa-btn-primary" disabled={!runtimeEditable || runtimeSubmitting || !Object.keys(runtimeChanges).length}
                      onClick={() => void submitRuntimeChange(detailApp, { kind: 'config', ...runtimeBaseline, changes: runtimeChanges })}>{t("apps.saveAndRestart")}</button>
                  </div>
                ) : requiresAIUpdate ? (
                  <button type="button" className="oa-btn oa-btn-primary" disabled={detailBusy}
                    onClick={() => startWizardNew(detailApp, activeLocalJob, true)}>
                    {t("apps.aiAnalyzeConfigUpdate")}
                  </button>
                ) : api.appUpdateConfig && (
                  <button type="button" className="oa-btn oa-btn-primary" disabled={detailBusy} onClick={() => void handleSaveDetailConfig()}>
                    {detailBusy ? t("apps.savingAndRestarting") : t("apps.saveConfigAndRestart")}
                  </button>
                ))}
              </div>
              {!readOnly && onlineRuntime && runtimeOperation && <button type="button" className="oa-btn oa-btn-link" onClick={() => openRuntimePanel(detailApp, false)}>{t("apps.viewRecentOperationStatus")}</button>}
              {onlineRuntime && showRuntimeHistory && <div className="oa-runtime-history">
                {onlineRuntime.revisions.length === 0 && <div className="oa-hint">{t("apps.currentConfigIsTheInitialConfig")}</div>}
                {onlineRuntime.revisions.map(revision => {
                  const active = revision.state === 'succeeded' && revision.config_revision === onlineRuntime.config_revision
                  return <div className="oa-runtime-toolbar" key={revision.id}>
                    <div>
                      <strong>{t("apps.configRev", { num: revision.config_number ?? '' })}{active ? t("apps.active") : ''}</strong>
                      <div className="oa-hint">{revision.changed_keys || t("apps.initialConfig")}{revision.created_at ? ' · ' + new Date(revision.created_at).toLocaleString(getIntlLocale(locale)) : ''}</div>
                      <div className="oa-hint">{revision.created_by} {revision.message}</div>
                    </div>
                    {revision.state === 'succeeded' && !active && <button type="button" className="oa-btn oa-btn-xs" disabled={!runtimeEditable || runtimeSubmitting}
                      onClick={() => void submitRuntimeChange(detailApp, { kind: 'restore', ...runtimeBaseline, operation_id: revision.id })}>{t("apps.restoreAndRestart")}</button>}
                  </div>
                })}
              </div>}

              <div className="oa-field" style={{ maxWidth: 260 }}>
                <label className="oa-label" htmlFor={`${formId}-edit-port`}>{t("apps.containerListenPort")}</label>
                <input id={`${formId}-edit-port`}
                  className={`oa-input oa-mono${onlineRuntime ? ' oa-cfg-readonly' : ''}`}
                  type="number"
                  min={1}
                  max={65535}
                  readOnly={Boolean(onlineRuntime)}
                  disabled={!onlineRuntime && (readOnly || requiresAIUpdate)}
                  value={editPort}
                  onChange={e => setEditPort(e.target.value)}
                />
              </div>

              <AppDeliveryConfig
                configs={onlineRuntime ? runtimeConfigs : editConfigs}
                originals={runtimeOriginals}
                resources={resources}
                lockedPort={onlineRuntime ? detailApp.container_port : undefined}
                runtimeEditableKeys={onlineRuntime ? editableRuntimeKeys : undefined}
                onChange={next => {
                  if (onlineRuntime) {
                    setRuntimeDraft(Object.fromEntries(next
                      .filter(item => editableRuntimeKeys.has(item.key))
                      .map(item => [item.key, item.value])))
                  } else if (!readOnly && !requiresAIUpdate) setEditConfigs(next)
                }}
                readOnly={Boolean(onlineRuntime) || readOnly || requiresAIUpdate}
              />
            </div>
          )}

          {detailTab === 'storage' && (
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div className="oa-grid-3" style={{ flex: 1, minWidth: 300 }}>
                  <div className="oa-subcard">
                    <div className="oa-hint">{t("apps.mounts_2")}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview ? t("apps.discovery.text", { n: storageOverview.mounts_count }) : '—'}</div>
                  </div>
                  <div className="oa-subcard">
                    <div className="oa-hint">{t("apps.totalFiles")}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview ? storageOverview.total_files : '—'}</div>
                  </div>
                  <div className="oa-subcard">
                    <div className="oa-hint">{t("apps.totalSize")}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview ? storageOverview.total_human : '—'}</div>
                  </div>
                </div>
                {!readOnly && storageOverview && storageOverview.mounts_count > 0 && (
                  <button
                    type="button"
                    className="oa-btn oa-btn-sm"
                    onClick={() => void handleDownloadPlatformArtifact(detailApp.slug, { storage: true }, t("apps.allVolumeBackups"))}
                  >
                    <AppIcon name="archive" size={13} />
                    <span>{t("apps.exportAllVolumes")}</span>
                  </button>
                )}
              </div>

              {!storageOverview ? (
                <div className="oa-alert oa-alert-info">{t("apps.noPersistentStorageStatsAvailable")}</div>
              ) : (
                <>
                  {storageOverview.object_storage && (
                    <div className="oa-subcard">
                      <strong>{t("apps.objectStorage")}</strong>
                      <div className="oa-hint">{t("apps.resourceBucket", { id: storageOverview.object_storage.resource_id })} <code>{storageOverview.object_storage.bucket}</code></div>
                    </div>
                  )}

                  {storageOverview.mounts.length === 0 ? (
                    <div className="oa-hint">{t("apps.thisAppHasNoDirectoryMounts")}</div>
                  ) : (
                    <div className="oa-table-box">
                      <div className="oa-storage-table-head">
                        <span>{t("apps.containerPath")}</span>
                        <span>{t("apps.purpose")}</span>
                        <span style={{ textAlign: 'center' }}>{t("apps.status")}</span>
                        <span style={{ textAlign: 'right' }}>{t("apps.files_2")}</span>
                        <span style={{ textAlign: 'right' }}>{t("apps.size")}</span>
                        <span style={{ textAlign: 'right' }}>{t("apps.actions")}</span>
                      </div>
                      {storageOverview.mounts.map(m => {
                        const statusText = m.status === 'mounted' ? t("apps.mounted") : m.status === 'pending' ? t("apps.pending") : m.status === 'mismatch' ? t("apps.mismatch") : m.status === 'missing' ? t("apps.missing") : (m.status || '-')
                        const statusClass = m.status === 'mounted' ? 'oa-pill-ok' : m.status === 'pending' ? 'oa-pill-warn' : m.status === 'mismatch' || m.status === 'missing' ? 'oa-pill-danger' : ''
                        return (
                          <div key={m.name} className="oa-storage-table-row">
                            <div style={{ minWidth: 0 }}>
                              <div className="oa-mono" style={{ fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.container_path}>
                                {m.container_path}
                              </div>
                              <div className="oa-hint oa-mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.storage_location || m.host_path || m.volume_name || ''}>
                                {m.resource_id ? `${m.resource_id} · ` : ''}{m.name}
                              </div>
                            </div>
                            <div className="oa-hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.purpose || ''}>
                              {m.purpose || '-'}
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <span className={`oa-pill ${statusClass}`}>{statusText}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>{m.file_count ?? 0}</div>
                            <div style={{ textAlign: 'right', fontWeight: 500 }}>{m.size_human ?? formatFileSize(m.size_bytes)}</div>
                            <div style={{ textAlign: 'right' }}>
                              {!readOnly ? (
                                <button
                                  type="button"
                                  className="oa-btn oa-btn-xs"
                                  onClick={() => void handleDownloadPlatformArtifact(detailApp.slug, { storage: true, mount: m.name }, t("apps.volumeBackup", { name: m.name }))}
                                >
                                  <AppIcon name="download" size={11} />
                                  <span>{t("apps.download")}</span>
                                </button>
                              ) : (
                                <span className="oa-hint">—</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tab 4: Version History & Rollback */}
          {detailTab === 'versions' && (
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="oa-subcard-head" style={{ marginBottom: 0 }}>
                <span>交付版本与制品归档</span>
                <span className="oa-hint">{readOnly ? t("apps.readOnlyViewHint") : '可下载源码包和技能包，也可以用历史源码发起更新'}</span>
              </div>

              {rollbackTarget && (
                <div className="oa-subcard" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                  <div style={{ fontWeight: 650, color: '#92400e', marginBottom: 6 }}>
                    确认回滚到历史版本 v{rollbackTarget.version}？
                  </div>
                  <p className="oa-hint" style={{ color: '#92400e', marginBottom: 10 }}>
                    {ROLLBACK_NOTICE}
                  </p>
                  <div className="oa-field" style={{ marginBottom: 10 }}>
                    <label className="oa-label" htmlFor={`${formId}-rollback-reason`}>回滚原因说明（可选）</label>
                    <input id={`${formId}-rollback-reason`}
                      className="oa-input"
                      value={rollbackReason}
                      placeholder={`例如：v${detailApp.current_version} 出现回归异常，临时切回 v${rollbackTarget.version}`}
                      onChange={e => setRollbackReason(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" disabled={detailBusy} onClick={() => void handleConfirmRollback()}>
                      {detailBusy ? t("apps.rollingBack") : t("apps.confirmRollbackToV", { version: rollbackTarget.version })}
                    </button>
                    <button type="button" className="oa-btn oa-btn-sm" disabled={detailBusy} onClick={() => setRollbackTarget(null)}>
                      {t("apps.delete.cancel")}
                    </button>
                  </div>
                </div>
              )}

              <NoticeModal
                open={Boolean(versionsError)}
                variant="error"
                title={t("apps.failedToLoadVersions")}
                message={versionsError ?? ''}
                onClose={() => setVersionsError(null)}
              />

              {visibleVersions.length === 0 ? (
                <div className="oa-hint">{t("apps.noVersionHistoryAvailable")}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleVersions.map(ver => (
                    <div key={ver.id || ver.version} className="oa-subcard">
                      <div className="oa-subcard-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5, color: '#0f172a' }}>v{ver.version}</strong>
                          {currentVersion(ver) && <span className="oa-pill oa-pill-ok">{t("apps.running_2")}</span>}
                          {ver.status === 'failed' && <span className="oa-pill oa-pill-danger">{t("apps.failedNotLive")}</span>}
                          {ver.status && ver.status !== 'failed' && !currentVersion(ver) && <span className="oa-pill">{jobStatusTone(ver.status, undefined, locale).text}</span>}
                          <span className="oa-hint">{formatDateTime(ver.created_at)}</span>
                          {ver.deployed_by && <span className="oa-hint">{t("apps.by")}{ver.deployed_by}</span>}
                        </div>

                        {!currentVersion(ver) && ver.status === 'running' && !readOnly && (requiresAIUpdate || ver.download_urls?.['delivery.json'] || api.appRollback) && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs oa-btn-accent-soft"
                            disabled={detailBusy}
                            onClick={() => {
                              if (requiresAIUpdate || ver.download_urls?.['delivery.json']) {
                                const local = jobs.find(job => job.slug === detailApp.slug && job.published && job.version === ver.version)
                                startWizardNew(detailApp, local, true)
                                setWizardNotice(
                                  t("apps.startingUpdateFromVSourceAi", { version: ver.version, extra: local ? '' : t("apps.pleaseImportTheSourceOfThat") })
                                )
                              } else if (api.appRollback) {
                                setRollbackTarget(ver)
                                setRollbackReason('')
                              }
                            }}
                          >
                            {requiresAIUpdate || ver.download_urls?.['delivery.json'] ? t("apps.updateFromThisVersion") : t("apps.rollbackToThisVersion")}
                          </button>
                        )}
                      </div>

                      {ver.version_note && <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 8 }}>{ver.version_note}</div>}

                      {!readOnly && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ver.app_tar_key && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'app.tar' }, `v${ver.version} app.tar`)
                            }
                          >
                            app.tar{ver.app_tar_size ? ` (${formatFileSize(ver.app_tar_size)})` : ''}
                          </button>
                        )}
                        {ver.skill_zip_key && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'skill.zip' }, `v${ver.version} skill.zip`)
                            }
                          >
                            skill.zip{ver.skill_zip_size ? ` (${formatFileSize(ver.skill_zip_size)})` : ''}
                          </button>
                        )}
                        {ver.dockerfile_key && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'Dockerfile' }, `v${ver.version} Dockerfile`)
                            }
                          >
                            Dockerfile
                          </button>
                        )}
                        {ver.manifest_key && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'manifest.json' }, `v${ver.version} manifest`)
                            }
                          >
                            manifest.json
                          </button>
                        )}
                        {ver.download_urls?.['delivery.json'] && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'delivery.json' }, `v${ver.version} delivery.json`)
                            }
                          >
                            delivery.json
                          </button>
                        )}
                        {ver.download_urls?.['confirmed-deployment.json'] && (
                          <button type="button" className="oa-btn oa-btn-xs"
                            onClick={() => void handleDownloadPlatformArtifact(detailApp.slug,
                              { version: ver.version, artifact: 'confirmed-deployment.json' }, t("apps.vConfirmedConfig", { version: ver.version }))}>
                            {t("apps.confirmedConfig")}
                          </button>
                        )}
                      </div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {detailTab === 'logs' && (
            <div className="oa-detail-log-card">
              <div className="oa-detail-log-toolbar">
                <div className="oa-segmented">
                  <button
                    type="button"
                    className={`oa-segmented-btn ${detailLogsSubTab === 'runtime' ? 'active' : ''}`}
                    onClick={() => setDetailLogsSubTab('runtime')}
                  >
                    {t("apps.runtimeLogsLast500Lines")}
                  </button>
                  <button
                    type="button"
                    className={`oa-segmented-btn ${detailLogsSubTab === 'build' ? 'active' : ''}`}
                    onClick={() => setDetailLogsSubTab('build')}
                  >
                    {t("apps.buildLogs")}
                  </button>
                  <button
                    type="button"
                    className={`oa-segmented-btn ${detailLogsSubTab === 'dockerfile' ? 'active' : ''}`}
                    onClick={() => setDetailLogsSubTab('dockerfile')}
                  >
                    Dockerfile
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="oa-btn oa-btn-xs"
                    disabled={!detailLog}
                    onClick={() => void copyText(`detail-log-${detailLogsSubTab}`, detailLog)}
                  >
                    <AppIcon name={copiedKey === `detail-log-${detailLogsSubTab}` ? 'check' : 'copy'} size={12} />
                    <span>{copiedKey === `detail-log-${detailLogsSubTab}` ? t("common.copied") : t("apps.copy")}</span>
                  </button>
                  <button type="button" className="oa-btn oa-btn-xs" onClick={() => void refreshDetailLogs()}>
                    <AppIcon name="refresh" size={12} />
                    <span>{t("apps.refreshLogs")}</span>
                  </button>
                </div>
              </div>

              <div className="oa-detail-log-meta">
                <span>{logSummary}</span>
                <span>{t("apps.linesLoaded", { count: detailLog ? detailLog.split('\n').length : 0 })}</span>
              </div>
              <NoticeModal
                open={Boolean(logsError)}
                variant="error"
                title={t("apps.failedToLoadLogs")}
                message={logsError ?? ''}
                onClose={() => setLogsError(null)}
              />
              <pre className="oa-log-terminal" tabIndex={0} aria-label={logSummary}>
                {detailLog || (logsError ? t("apps.logsUnavailable") : t("apps.noContent"))}
              </pre>
            </div>
          )}

          </div>

        </div>
      </div>
    )
  }

  return (
    <div className={`opc-apps-root${(viewMode === 'wizard' && wizardStep === 4) || (viewMode === 'detail' && detailTab === 'logs') ? ' oa-apps-log-view' : ''}`}>
      <style>{appsCss + paginationStyles}</style>
      {viewMode === 'list' && (loadingLinkedJob || restorableLinkedJob && !restoredLinkedJob.current
        ? <p role="status">正在查找当前会话的应用任务…</p>
        : renderAppListView())}
      {viewMode === 'wizard' && renderWizardView()}
      {viewMode === 'detail' && renderDetailView()}
      {viewMode === 'backups' && (
        <DeletedAppBackupsView
          api={api}
          contextId={contextId}
          backups={volumeBackups}
          loading={loadingBackups}
          onBack={() => setViewMode('list')}
          onRefresh={loadVolumeBackups}
        />
      )}
      {deleteModalOpen && detailApp && (
        <AppDeleteModal
          api={api}
          contextId={contextId}
          app={detailApp}
          storageOverview={storageOverview}
          onClose={() => setDeleteModalOpen(false)}
          onDeleted={({ name, backup }) => {
            setDeleteModalOpen(false)
            setDetailApp(null)
            setViewMode('list')
            setBannerNotice(
              backup
                ? `应用「${name}」已彻底删除，挂载卷归档已保留在「数据备份」中（30 天）。`
                : `应用「${name}」已彻底删除。`
            )
            void loadWorkspaceData(true)
          }}
        />
      )}
      {runtimePanel && (
        <div className="oa-runtime-backdrop">
          <section className="oa-form-card oa-runtime-panel" role="dialog" aria-modal="true" aria-labelledby={`${formId}-runtime-title`}
            onKeyDown={event => { if (event.key === 'Escape') setRuntimePanel(null) }}>
            <div className="oa-runtime-toolbar">
              <strong id={`${formId}-runtime-title`}>{runtimePanel.app.name} · 运行状态</strong>
              <button type="button" autoFocus className="oa-btn oa-btn-xs" onClick={() => setRuntimePanel(null)}>关闭状态</button>
            </div>
            {runtimeSubmitting && <div role="status"><span className="oa-dot oa-pulse" /> 正在提交操作…</div>}
            {!runtimeSubmitting && !runtimeStatus && !currentRuntimeError && <div role="status"><span className="oa-dot oa-pulse" /> 正在读取操作状态…</div>}
            {!runtimeSubmitting && runtimeOperation && <div role="status" className={`oa-alert ${runtimeOperation.state === 'succeeded' ? 'oa-alert-ok' : 'oa-alert-warn'}`}>
              {runtimeOperationBusy(runtimeOperation) && <span className="oa-dot oa-pulse" />}
              {runtimeOperation.message}
            </div>}
            {currentRuntimeError && <div role="alert" className="oa-alert oa-alert-danger">{currentRuntimeError}</div>}
            {runtimePanel.confirmRestart && runtimeStatus && !runtimeOperationBusy(runtimeOperation) &&
              !runtimeOperationNeedsCheck(runtimeOperation) && <div className="oa-hint">重启期间，应用访问可能短暂中断。</div>}
            <div className="oa-runtime-actions">
              {runtimePanel.confirmRestart && runtimeStatus && !runtimeOperationBusy(runtimeOperation) &&
                runtimeOperation?.state !== 'unknown' && runtimeOperation?.state !== 'recovery_unknown' && (
                <button type="button" className="oa-btn oa-btn-primary" disabled={runtimeSubmitting}
                  onClick={() => void submitRuntimeChange(runtimePanel.app, { kind: 'restart' })}>确认重启</button>
              )}
              {runtimeOperation && runtimeOperationNeedsCheck(runtimeOperation) && <button type="button" className="oa-btn" disabled={runtimeSubmitting}
                onClick={() => void submitRuntimeChange(runtimePanel.app, { kind: 'recheck', operation_id: runtimeOperation.id })}>重新检查</button>}
              {currentRuntimeError && <button type="button" className="oa-btn" onClick={() => setRuntimeRefresh(value => value + 1)}>刷新状态</button>}
              {runtimeOperation && <button type="button" className="oa-btn" onClick={() => {
                const slug = runtimePanel.app.slug
                setRuntimePanel(null)
                void openAppDetail(slug, 'logs')
              }}>查看日志</button>}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
