import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  AppConfigItem,
  AppDeliveryJob,
  AppModelGroup,
  AppStorageOverview,
  AppStorageMountDetail,
  AppVersionItem,
  DeployedApp,
  OpcApi,
  ResourceSummary,
} from './api.ts'
import { AppDeliveryArtifacts } from './AppDeliveryArtifacts.tsx'
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

type ViewMode = 'list' | 'wizard' | 'detail'
type WizardStep = 1 | 2 | 3 | 4
type ConfigSubTab = 'configs' | 'skill' | 'dockerfile' | 'mounts'
type DetailTab = 'artifacts' | 'configs' | 'storage' | 'versions' | 'logs'
type LogSubTab = 'runtime' | 'build' | 'dockerfile'

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

function jobStatusTone(status?: string, userDisabled?: boolean): { text: string; pillClass: string; spinning?: boolean } {
  switch (status) {
    case 'running':
      return { text: '运行中', pillClass: 'oa-pill-ok' }
    case 'verified':
      return userDisabled
        ? { text: '技能已停用（待开启）', pillClass: 'oa-pill-warn' }
        : { text: '已上线并启用技能', pillClass: 'oa-pill-ok' }
    case 'awaiting_page_verification':
      return { text: '待确认页面可用', pillClass: 'oa-pill-warn' }
    case 'skill_disabled':
      return { text: '技能未启用', pillClass: 'oa-pill-warn' }
    case 'verification_failed':
      return { text: '验证未通过', pillClass: 'oa-pill-danger' }
    case 'failed':
    case 'unhealthy':
      return { text: '失败', pillClass: 'oa-pill-danger' }
    case 'unknown':
      return { text: '发布结果待确认', pillClass: 'oa-pill-warn' }
    case 'building':
      return { text: '构建发布中', pillClass: 'oa-pill-accent', spinning: true }
    case 'verifying':
      return { text: '服务验证中', pillClass: 'oa-pill-teal', spinning: true }
    case 'analyzing':
    case 'preparing':
    case 'importing':
      return { text: '分析准备中', pillClass: 'oa-pill-accent', spinning: true }
    case 'review':
      return { text: '待核对改造方案', pillClass: 'oa-pill-warn' }
    case 'ready':
      return { text: '待配置与发布', pillClass: 'oa-pill-accent' }
    case 'draft':
    default:
      return { text: '草稿待分析', pillClass: '' }
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

function deploymentProgress(job: AppDeliveryJob) {
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
  const [detailTab, setDetailTab] = useState<DetailTab>('artifacts')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailNotice, setDetailNotice] = useState<string | null>(null)
  const [detailHealthCheck, setDetailHealthCheck] = useState<(AppHealthCheck & { slug: string }) | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const detailLoad = useRef(0)
  const formId = useId()
  const [versions, setVersions] = useState<AppVersionItem[]>([])
  const [storageOverview, setStorageOverview] = useState<AppStorageOverview | null>(null)
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

  const loadWorkspaceData = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingList(true)
      try {
        const [catalogRaw, jobsRaw, resourcesRaw, configRaw, modelsRaw] = await Promise.all([
          api.appCatalog(contextId),
          api.appList(contextId).catch(() => '[]'),
          api.appResources(contextId).catch(() => '{"resources":[]}'),
          api.appOpcConfig?.(contextId).catch(() => '{}') ?? Promise.resolve('{}'),
          api.appModels(contextId).catch(() => '[]'),
        ])
        const catalogData = parseJson<{ apps?: DeployedApp[] } | null>(catalogRaw, null)
        if (!Array.isArray(catalogData?.apps) || catalogData.apps.some(app => typeof app?.slug !== 'string')) {
          throw new Error('未收到有效的企业应用目录')
        }
        const jobList = parseJson<AppDeliveryJob[]>(jobsRaw, [])
        const resData = parseJson<{ resources?: ResourceSummary[] }>(resourcesRaw, { resources: [] })
        const cfg = parseJson<Partial<OpcRuntimeConfig>>(configRaw, {})
        const models = parseJson<AppModelGroup[]>(modelsRaw, [])

        setAppDirectory({
          apps: catalogData.apps,
          jobs: Array.isArray(jobList) ? jobList : [],
          loaded: true,
        })
        setResources(Array.isArray(resData.resources) ? resData.resources : [])
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
        setConfigDrafts(configs)
        setVersionNote(draft?.versionNote ?? job.versionNote ?? '')
        setStorageBindings(draft?.storageBindings ?? {})
        setExistingStorage(detail?.storage_mounts ?? [])
        setStep3Load({ ...target, status: 'ready' })
      } catch (error) {
        if (request === step3Request.current) setStep3Load({ ...target, status: 'failed', error: readErrorMessage(error, '部署内容加载失败') })
      }
    },
    [api, contextId, opcConfig.defaultPort],
  )

  const progressJobId = wizardJob?.id
  const progressRequestKey = `${progressJobId ?? ''}:${wizardJob?.requestId ?? ''}`
  const progressStatus = wizardJob?.status
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
        !isDeploymentInProgress(progressStatus)) return
    let alive = true
    let timer: number
    const poll = async () => {
      let keepPolling = true
      try {
        const raw = (progressStatus === 'verifying' || progressStatus === 'publishing') && api.appJob
          ? await api.appJob(progressJobId, contextId)
          : await (api.appVerifyWithOptions
            ? api.appVerifyWithOptions(progressJobId, JSON.stringify({ automatic: true }), contextId)
            : api.appVerify(progressJobId, contextId))
        if (!alive) return
        const updated = JSON.parse(raw) as AppDeliveryJob
        setWizardError(null)
        setWizardJob(current => current?.id === updated.id ? updated : current)
        keepPolling = isDeploymentInProgress(updated.status)
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
  }, [api, contextId, loadWorkspaceData, progressJobId, progressStatus, viewMode, wizardBusy, wizardStep])

  // Load Step 3 draft data when entering Step 3
  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 3 || !wizardJob) return
    void syncStep3Drafts(wizardJob)
    return () => { step3Request.current++ }
  }, [syncStep3Drafts, viewMode, wizardJob?.id, wizardJob?.artifactHash, wizardStep])

  // Open Detail View & load all 5 tabs data
  const openAppDetail = useCallback(
    async (slug: string, initialTab: DetailTab = 'artifacts', preserveFeedback = false) => {
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
        const canManage = detail.can_manage === true
        const [verRaw, stgRaw, logRaw] = canManage ? await Promise.allSettled([
          api.appVersions?.(slug, contextId) ?? Promise.resolve('{"versions":[]}'),
          api.appStorage?.(slug, contextId).catch(() => 'null') ?? Promise.resolve('null'),
          api.appLogs?.(slug, contextId) ?? Promise.resolve('{}'),
        ]) : []
        if (request !== detailLoad.current) return
        if (!canManage) setDetailTab('artifacts')
        if (verRaw?.status === 'rejected') setVersionsError(readErrorMessage(verRaw.reason, '版本历史加载失败'))
        if (logRaw?.status === 'rejected') setLogsError(readErrorMessage(logRaw.reason, '日志加载失败'))
        const verParsed = parseJson<{ versions?: AppVersionItem[] }>(verRaw?.status === 'fulfilled' ? verRaw.value : null, { versions: [] })
        const stgParsed = parseJson<AppStorageOverview | null>(stgRaw?.status === 'fulfilled' ? stgRaw.value : null, null)
        const logParsed = parseJson<{ runtime_logs?: string; logs?: string; content?: string; build_log?: string; dockerfile?: string }>(
          logRaw?.status === 'fulfilled' ? logRaw.value : null,
          {},
        )
        setDetailApp(detail)
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
    if (wizardJob?.status === 'ready' && wizardStep === 3 && step3Ready) await saveDraft(wizardJob, configDrafts, versionNote, storageBindings)
  }

  const leaveWizard = async () => {
    if (wizardBusy) return
    sourceSelection.current++
    setWizardBusy(true)
    try {
      await flushDraft()
      setViewMode('list')
      void loadWorkspaceData(true)
    } catch (error) {
      setWizardError(readErrorMessage(error, '配置草稿保存失败，请重试'))
    } finally { setWizardBusy(false) }
  }

  const handleStep3ConfigsChange = (nextConfigs: AppConfigItem[]) => {
    setConfigDrafts(nextConfigs)
    if (wizardJob) scheduleDraftSave(wizardJob, nextConfigs, versionNote, storageBindings)
  }

  const handleStep3NoteChange = (nextNote: string) => {
    setVersionNote(nextNote)
    if (wizardJob) scheduleDraftSave(wizardJob, configDrafts, nextNote, storageBindings)
  }

  const handleReturnToReview = async () => {
    if (!wizardJob) return
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
      setWizardBusy(false)
    }
  }

  const handlePublishApp = async () => {
    if (!wizardJob || !step3Ready) return
    setWizardError(null)
    if (hasConfigIssues) {
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

    setWizardBusy(true)
    try {
      await flushDraft()
      const cleanConfigs = sanitizeConfigRowsForApi(configDrafts, {
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
      const { confirmationToken, artifactHash } = parseJson<{ confirmationToken: string; artifactHash?: string }>(confirmRaw, { confirmationToken: '' })
      if (!confirmationToken) throw new Error('未能获取发布确认凭证')

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
      if (published?.status === 'ready') {
        setWizardError(published.error || '平台未接受本次发布，请核对配置后重试')
        return
      }
      setWizardStep(4)
      void loadWorkspaceData(true)

    } catch (error) {
      setWizardError(readErrorMessage(error, '确认发布应用失败'))
      void refreshWizardJob(wizardJob.id)
    } finally {
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
          <h2 className="oa-title">应用中心</h2>
          <p className="oa-subtitle">企微登录即可部署。应用列表对所有已登录用户开放。</p>
        </div>
        <div className="oa-app-list-toolbar">
          <button type="button" className="oa-btn" disabled={loadingList} onClick={() => void loadWorkspaceData(false)}>
            <AppIcon name="refresh" size={14} className={loadingList ? 'oa-spin' : ''} />
            <span>刷新</span>
          </button>
          <button type="button" className="oa-btn oa-btn-primary" onClick={() => startWizardNew()}>
            <AppIcon name="plus" size={14} />
            <span>新建应用</span>
          </button>
        </div>
      </div>

      {bannerError && (
        <div role="alert" className="oa-alert oa-alert-danger">
          <AppIcon name="warning" size={16} />
          <div style={{ flex: 1 }}>{bannerError}</div>
          <button type="button" className="oa-btn oa-btn-xs" onClick={() => setBannerError(null)}>
            关闭
          </button>
        </div>
      )}

      {bannerNotice && (
        <div role="status" className="oa-alert oa-alert-ok">
          <AppIcon name="check" size={16} />
          <div style={{ flex: 1 }}>{bannerNotice}</div>
          <button type="button" className="oa-btn oa-btn-xs" onClick={() => setBannerNotice(null)}>
            关闭
          </button>
        </div>
      )}

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
          正在加载企业应用目录…
        </div>
      ) : apps.length === 0 ? (
        <div className="oa-form-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div className="oa-app-icon-box" style={{ margin: '0 auto 14px', width: 48, height: 48 }}>
            <AppIcon name="sparkle" size={22} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>暂无已部署的企业应用</div>
          <p className="oa-subtitle" style={{ maxWidth: 460, margin: '8px auto 18px' }}>
            上传项目压缩包或选择本地项目文件夹，AI 将自动分析运行环境、托管配置并发布到企业访问域名，同时生成同名应用技能。
          </p>
          <button type="button" className="oa-btn oa-btn-primary" onClick={() => startWizardNew()}>
            <AppIcon name="plus" size={14} />
            <span>新建第一个应用</span>
          </button>
        </div>
      ) : (
        <div className="oa-apps-grid">
          {apps.map(app => {
            const tone = jobStatusTone(app.status)
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

                <p className="oa-app-card-desc" title={app.description || undefined}>{app.description || '暂无应用描述'}</p>

                <div className="oa-app-card-meta">
                  <div className="oa-app-card-row">
                    <span><AppIcon name="cloud" size={13} />内网地址</span>
                    {app.app_url
                      ? <a className="oa-mono" href={app.app_url} target="_blank" rel="noreferrer" title={app.app_url}>{app.app_url}</a>
                      : <span>暂无</span>}
                  </div>
                  {!readOnly && (
                    <div className="oa-app-card-row">
                      <span><AppIcon name="sparkle" size={13} />本地技能</span>
                      <code className="oa-code" title={app.skill_name || `app-${app.slug}`}>{app.skill_name || `app-${app.slug}`}</code>
                    </div>
                  )}
                </div>

                {isFailed && app.error_message && (
                  <div className="oa-alert oa-alert-danger oa-app-card-error" role="status">
                    <AppIcon name="warning" size={14} />
                    <span>{healthFailureDetail(app.error_message) || '应用健康检查未通过，请查看日志。'}</span>
                  </div>
                )}

                <div className="oa-app-card-actions">
                  {readOnly ? <span className="oa-hint">共享应用 · 只读</span> : isFailed ? (
                    <>
                      <button type="button" className="oa-btn oa-btn-xs" onClick={() => {
                        if (matchingJob?.published) void resumeWizardJob(matchingJob, 4)
                        else startWizardNew(app)
                      }}>
                        恢复 / 重新部署
                      </button>
                      {api.appRecheck && (
                        <button type="button" className="oa-btn oa-btn-xs" onClick={() => void handleRecheckApp(app.slug, false)}>
                          <AppIcon name="refresh" size={12} />重新检查
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" className="oa-btn oa-btn-xs" onClick={() => void openAppDetail(app.slug, 'versions')}>
                        版本与回退
                      </button>
                      <button type="button" className="oa-btn oa-btn-xs oa-btn-accent-soft" onClick={() => startWizardNew(app, matchingJob)}>
                        升级新版本
                      </button>
                    </>
                  )}
                  <button type="button" className="oa-btn oa-btn-xs oa-btn-link oa-app-card-detail"
                    onClick={() => void openAppDetail(app.slug, isFailed && !readOnly ? 'logs' : 'artifacts')}>
                    {isFailed && !readOnly ? '失败日志' : '详情'}<AppIcon name="chevronRight" size={12} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
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
          {wizardError && (
            <div role="alert" className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>{wizardError}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setWizardError(null)}>
                关闭
              </button>
            </div>
          )}

          {wizardNotice && (
            <div role="status" className="oa-alert oa-alert-ok">
              <AppIcon name="check" size={16} />
              <div style={{ flex: 1 }}>{wizardNotice}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setWizardNotice(null)}>
                关闭
              </button>
            </div>
          )}

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
                    placeholder="例如：报销审批助手 / 阿里云效流水线"
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
                    <label className="oa-label" htmlFor={`${formId}-app-slug`}>应用访问子域名 (唯一标识) *</label>
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
                        根据应用名称重新生成
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
                      placeholder="例如：devops-aly（仅限小写字母、数字和中划线）"
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
                      <span style={{ color: '#64748b', flexShrink: 0 }}>内网访问直达地址：</span>
                      <span
                        className="oa-mono"
                        style={{ color: '#2563eb', fontWeight: 500, wordBreak: 'break-all', userSelect: 'all' }}
                      >
                        http://{appSlug.trim() || 'your-app'}.{opcConfig.appDomainRoot}
                      </span>
                      {!upgradingStep1 && slugCheck.checking && (
                        <span className="oa-pill">正在校验…</span>
                      )}
                      {!upgradingStep1 && !slugCheck.checking && !slugCheck.error && slugCheck.available && (
                        <span className="oa-pill oa-pill-ok">标识可用</span>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, color: '#64748b', flexShrink: 0 }}>
                      {upgradingStep1
                        ? `(容器端口: 沿用 ${effectiveStep1Port})`
                        : `(容器端口: 自动识别，默认 ${effectiveStep1Port})`}
                    </span>
                  </div>
                  {!upgradingStep1 && slugCheck.error && (
                    <div className="oa-hint" style={{ color: '#dc2626', marginTop: 4 }}>
                      {slugCheck.error}
                    </div>
                  )}
                </div>

                <div className="oa-field">
                  <label className="oa-label" htmlFor={`${formId}-description`}>应用描述</label>
                  <textarea
                    id={`${formId}-description`}
                    className="oa-textarea"
                    rows={2}
                    value={appDescription}
                    placeholder="简述该应用功能，将自动用于 AI 技能描述与调用匹配"
                    onChange={e => setAppDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="oa-form-card">
                <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a', marginBottom: 4 }}>AI 分析模型设置</div>
                <p className="oa-hint" style={{ marginBottom: 12 }}>
                  所选 AI 负责应用分析、改造和失败修复。平台通过应用域名检查部署结果。
                </p>
                {modelGroups.length === 0 ? (
                  <div className="oa-hint">将沿用当前会话已选的 AI 模型。</div>
                ) : (
                  <div className="oa-grid-3">
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-provider`}>模型提供商</label>
                      <select id={`${formId}-provider`}
                        className="oa-select"
                        value={selectedProvider}
                        onChange={e => {
                          setSelectedProvider(e.target.value)
                          setSelectedModel('')
                          setSelectedEffort('')
                        }}
                      >
                        <option value="">沿用当前会话模型</option>
                        {modelGroups.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name || g.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-model`}>分析模型</label>
                      <select id={`${formId}-model`} className="oa-select" value={selectedModel} disabled={!selectedModelGroup}
                        onChange={e => {
                          setSelectedModel(e.target.value)
                          setSelectedEffort('')
                        }}>
                        <option value="">{selectedModelGroup ? '请选择模型' : '当前会话模型'}</option>
                        {(selectedModelGroup?.models ?? []).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label" htmlFor={`${formId}-effort`}>推理深度</label>
                      <select id={`${formId}-effort`}
                        className="oa-select"
                        value={selectedEffort}
                        disabled={availableEfforts.length === 0}
                        onChange={e => setSelectedEffort(e.target.value)}
                      >
                        <option value="">模型默认值</option>
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
                <h3 id={`${formId}-source-label`} className="oa-source-label">选择应用源码（文件夹或 ZIP）<span aria-hidden="true"> *</span></h3>
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
                    else if (files.length > 1) setWizardError('一次只能选择一个 ZIP 压缩包')
                  }}
                >
                  <span className="oa-source-icon"><AppIcon name="folder" size={22} /></span>
                  <strong>选择本地应用源码</strong>
                  <div className="oa-hint">选择源码文件夹，或拖拽上传 ZIP 压缩包（最多 64 MiB）。分析会使用源码副本。</div>
                  <div className="oa-source-actions">
                    <button type="button" className="oa-btn oa-btn-primary" disabled={wizardBusy} onClick={() => void handleBrowseFolder()}>
                      <AppIcon name="folder" size={15} /> 选择源码文件夹
                    </button>
                    <button type="button" className="oa-btn" disabled={wizardBusy} onClick={() => fileInputRef.current?.click()}>
                      <AppIcon name="archive" size={15} /> 选择 ZIP 压缩包
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
                    <span>{reuseSourceVersion ? `已选择本机保存的 v${reuseSourceVersion} 源码` : zipFile ? `已选择：${zipFile.name}（${formatFileSize(zipFile.size)}）` : '已填写本机源码路径'}</span>
                    <button type="button" className="oa-btn oa-btn-xs" disabled={wizardBusy} onClick={() => selectSourcePath('')}>清除选择</button>
                  </div>
                )}
                <div className="oa-field">
                  <label className="oa-label" htmlFor={`${formId}-source-path`}>或输入源码文件夹 / ZIP 的完整路径</label>
                  <input id={`${formId}-source-path`} ref={sourcePathInputRef} className="oa-input oa-mono"
                    value={sourcePath} placeholder="/路径/my-app 或 /路径/application.zip" disabled={wizardBusy}
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
                      <span className="oa-pill oa-pill-accent">端口 {wizardJob.port ?? opcConfig.defaultPort}</span>
                      {wizardJob.proposal?.contract?.runtime?.language && (
                        <span className="oa-pill oa-pill-teal">
                          {wizardJob.proposal.contract.runtime.language} {wizardJob.proposal.contract.runtime.version || ''}
                        </span>
                      )}
                    </div>
                    <div className="oa-hint" style={{ marginTop: 4 }}>
                      访问地址：<span className="oa-mono">{wizardJob.url}</span>
                    </div>
                  </div>

                  <div className="oa-segmented">
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'configs' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('configs')}
                    >
                      运行配置
                      {hasConfigIssues && <span className="oa-dot oa-config-tab-warning" role="img" aria-label="有配置待处理" />}
                    </button>
                    <button
                      type="button"
                      className={`oa-segmented-btn ${configSubTab === 'skill' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('skill')}
                    >
                      应用技能
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
                      挂载信息
                      {hasMissingStorage && <span className="oa-dot oa-config-tab-warning" role="img" aria-label="有挂载待处理" />}
                    </button>
                  </div>
                </div>

                <div className="oa-field" style={{ marginTop: 12 }}>
                  <label className="oa-label" htmlFor={`${formId}-version-note`}>版本发布说明（可选）</label>
                  <input id={`${formId}-version-note`}
                    className="oa-input"
                    value={versionNote}
                    disabled={!step3Ready}
                    placeholder={wizardJob.upgrade ? '例如：新增审批导出接口、修复环境变量读取' : '例如：首次上线发布'}
                    onChange={e => handleStep3NoteChange(e.target.value)}
                  />
                </div>
              </div>

              {currentStep3Load?.status === 'failed' && (
                <div className="oa-alert oa-alert-danger" role="alert">
                  <div>{currentStep3Load.error}</div>
                  <button type="button" className="oa-btn oa-btn-sm" onClick={() => void syncStep3Drafts(wizardJob)}>重新加载</button>
                </div>
              )}
              {step3Loading && (
                <div className="oa-form-card oa-deploy-loading" role="status">
                  <div className="oa-deploy-loading-icon" aria-hidden="true">
                    <AppIcon name="refresh" size={22} className="oa-spin" />
                  </div>
                  <strong>正在加载部署核对内容</strong>
                  <span className="oa-hint">正在读取运行配置、Dockerfile 和挂载信息。</span>
                </div>
              )}

              {step3Ready && (deliveryFiles.length > 0 || sourceChanges.length > 0) && (
                <details className="oa-subcard oa-cfg-ref-details">
                  <summary>交付文件与源码改动</summary>
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
                          <summary>查看文件差异</summary>
                          <pre className="oa-dockerfile-source oa-mono">{change.diff}</pre>
                        </details>
                      )}
                    </div>
                  ))}
                </details>
              )}

              {step3Ready && configSubTab === 'configs' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="运行时环境变量配置">
                  <AppDeliveryConfig
                    configs={configDrafts}
                    allowNew={wizardJob.proposal?.delivery_format !== 1}
                    originals={originalConfigs}
                    resources={deploymentResources}
                    lockedPort={wizardJob.port ?? opcConfig.defaultPort}
                    publishIssues={configIssues}
                    skillDriven={skillDrivenDelivery}
                    onChange={handleStep3ConfigsChange}
                  />

                  <details className="oa-subcard oa-cfg-ref-details">
                    <summary>
                      <span>
                        查看原项目配置文件参考
                        {sourceConfiguration?.files?.length
                          ? `（${sourceConfiguration.files.length} 个文件）`
                          : ''}
                      </span>
                      <span className="oa-hint">仅只读参考；完整源文件需在本地编辑后重新导入</span>
                    </summary>
                    {!sourceConfiguration ? (
                      <p className="oa-hint" style={{ margin: '8px 0 0' }}>暂时无法读取原应用配置文件。</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        {sourceConfiguration.files.map(file => (
                          <details key={file.path} className="oa-cfg-ref-file">
                            <summary>
                              <code>{file.path}</code>
                              {file.is_example && <span className="oa-pill">示例模板</span>}
                              <span className="oa-hint">{file.fields.length} 项</span>
                            </summary>
                            {file.fields.length > 0 && (
                              <dl className="oa-cfg-ref-dl">
                                {file.fields.map(({ key, value }, index) => (
                                  <React.Fragment key={`${key}-${index}`}>
                                    <dt><code>{key}</code></dt>
                                    <dd><code>{value || '（空）'}</code></dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                            )}
                          </details>
                        ))}
                        {sourceConfiguration.references.length > 0 && (
                          <div className="oa-cfg-ref-file">
                            <div className="oa-hint" style={{ fontWeight: 600, marginBottom: 4 }}>源码引用的环境变量</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {sourceConfiguration.references.map(key => (
                                <code key={key} className="oa-code">{key}</code>
                              ))}
                            </div>
                          </div>
                        )}
                        {!sourceConfiguration.files.length && !sourceConfiguration.references.length && (
                          <p className="oa-hint" style={{ margin: '6px 0 0' }}>在导入的源码中未识别到配置文件或环境变量引用。</p>
                        )}
                      </div>
                    )}
                  </details>
                </section>
              )}

              {step3Ready && configSubTab === 'mounts' && (
                <div className="oa-form-card">
                  {volumeMounts.length === 0 ? (
                    <div className="oa-hint">此应用没有目录挂载。</div>
                  ) : (
                    <div className="oa-subcard">
                      <div className="oa-subcard-head">
                        <span>持久化目录与存储资源</span>
                        <span className="oa-pill oa-pill-ok">{volumeMounts.length} 项</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {volumeMounts.map((mount, index) => {
                          if (!mount.container_path) {
                            return (
                              <p key={index} className="oa-config-field-warning">
                                此挂载缺少容器内路径，请返回核对方案，由原会话的 AI 补全。
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
                                  <span>复用 {existing.storage_location || existing.host_path || existing.volume_name || '现有挂载'}</span>
                                ) : (
                                  <select
                                    aria-label={`存储资源 ${mount.container_path}`}
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
                                      <option value="" disabled>{options.length > 0 ? '请选择存储资源'
                                        : mount.kind === 'sqlite' ? '等待管理员配置本地磁盘卷' : '等待管理员配置存储'}</option>
                                    )}
                                    {options.map(resource => (
                                      <option key={resource.id} value={resource.id}>
                                        {resource.name} · {resource.type === 'aliyun-oss-volume' ? '阿里云 OSS' : '本地磁盘'}
                                        {resource.is_default ? '（默认）' : ''}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </label>
                              {missingResource && (
                                <p id={issueId} className="oa-config-field-warning">
                                  {options.length ? '请为此目录选择存储资源。' : '请联系管理员启用适用于此目录的存储资源。'}
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
                      <summary>数据变更与恢复</summary>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{dataPlan.summary}</p>
                      {dataPlan.strategy === 'postgres_copy' && (
                        <div className="oa-hint">
                          原库 <code>{dataPlan.source_resource_id}</code> · 演练库 <code>{dataPlan.rehearsal_resource_id}</code> · 目标库 <code>{dataPlan.target_resource_id}</code>
                          <p>发布包含一次停写窗口。先在演练库验证，正式复制期间暂停旧实例写入。</p>
                        </div>
                      )}
                      {dataPlan.migration_files?.map(path => <div key={path}><code>{path}</code></div>)}
                      <p style={{ whiteSpace: 'pre-wrap' }}>恢复方式　{dataPlan.recovery}</p>
                    </details>
                  )}
                </div>
              )}

              {step3Ready && configSubTab === 'skill' && <AppSkillPreview api={api} contextId={contextId} job={wizardJob} />}

              {step3Ready && configSubTab === 'dockerfile' && (
                <section className="oa-subcard oa-dockerfile-panel" aria-label="本次构建的 Dockerfile">
                  <div className="oa-subcard-head">
                    <strong>本次构建的 Dockerfile</strong>
                    {dockerfile && (
                      <button type="button" className="oa-btn oa-btn-sm" onClick={() => void copyText(`dockerfile-${wizardJob.id}`, dockerfile)}>
                        <AppIcon name={copiedKey === `dockerfile-${wizardJob.id}` ? 'check' : 'copy'} size={13} />
                        {copiedKey === `dockerfile-${wizardJob.id}` ? '已复制' : '复制 Dockerfile'}
                      </button>
                    )}
                  </div>
                  {dockerfile ? (
                    <pre className="oa-dockerfile-source oa-mono" tabIndex={0} aria-label="Dockerfile 正文"><code>{dockerfile}</code></pre>
                  ) : (
                    <p className="oa-hint" role="status">{dockerfile === undefined ? '正在读取 Dockerfile…' : '暂时无法读取本次构建的 Dockerfile。'}</p>
                  )}
                  {(wizardJob.proposal?.contract?.build_inputs?.length ?? 0) > 0 && (
                    <details className="oa-cfg-ref-details">
                      <summary>构建参数来源</summary>
                      <dl className="oa-cfg-ref-dl">
                        {wizardJob.proposal?.contract?.build_inputs?.map(input => (
                          <div key={input.arg}>
                            <dt><code>{input.arg}</code></dt>
                            <dd>取自本次确认的配置 <code>{input.key}</code></dd>
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
            const liveLogs = isDeploymentInProgress(wizardJob.status)
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
                      <AppIcon name="external" size={13} /> 打开应用
                    </a>
                  )}
                </div>
                {wizardJob.assessment && (
                  <div className="oa-subcard oa-deploy-message">
                    <strong>AI 验收结论</strong>
                    <p>{wizardJob.assessment.report}</p>
                  </div>
                )}
                {failed && (
                  <>
                    <div className="oa-alert oa-alert-danger" role="alert">
                      <AppIcon name="warning" size={16} />
                      <div className="oa-deploy-message">{blockedByPreviousBuild(wizardJob)
                        ? '服务器上一轮构建还在进行。等构建结束后，可核对并重新发布原交付包。'
                        : wizardJob.error || '平台未返回具体失败原因。'}</div>
                    </div>
                    <div className="oa-deploy-actions">
                      {api.appVerifyWithOptions && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRecheckStartup()}>
                          <AppIcon name="refresh" size={13} />
                          {recheck?.pending ? '正在检查…' : '重新检查应用是否已启动'}
                        </button>
                      )}
                      {wizardJob.assessmentPending ? (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleContinueAssessment()}>
                          继续 AI 验收
                        </button>
                      ) : blockedByPreviousBuild(wizardJob) ? (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRetryDeployment()}>
                          核对并重新部署
                        </button>
                      ) : (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleLaunchRepair()}>
                          让 AI 分析修复问题
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

        {/* Sticky Wizard Footer */}
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
                取消
              </button>
              <button type="submit" form={`${formId}-source-form`} className="oa-btn oa-btn-primary" disabled={!canSubmitStep1}>
                {wizardBusy ? '正在导入源码…' : '创建并开始 AI 分析'}
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
                返回重选源码
              </button>
              {step2State?.jobId === wizardJob.id && step2State.canContinue && (
                <button type="button" className="oa-btn oa-btn-primary" onClick={() => step2State.triggerNext()}>
                  下一步：核对部署内容
                </button>
              )}
            </>
          )}

          {wizardStep === 3 && wizardJob && (
            <>
              <button type="button" className="oa-btn" disabled={wizardBusy} onClick={() => void handleReturnToReview()}>
                返回核对方案
              </button>
              <button
                type="button"
                className="oa-btn oa-btn-primary"
                disabled={wizardBusy || !step3Ready || hasConfigIssues || hasMissingStorage}
                onClick={() => void handlePublishApp()}
              >
                {wizardBusy ? '正在提交发布…' : step3Loading ? '正在加载部署内容…' : '确认配置并发布上线'}
              </button>
            </>
          )}

          {wizardStep === 4 && (wizardJob && deploymentProgress(wizardJob).tone === 'warn' ? (
            <button type="button" className="oa-btn" disabled>部署处理中…</button>
          ) : (
            <>
              <span className="oa-hint">发布完成后可在应用列表中管理配置、版本与备份。</span>
              <button
                type="button"
                className="oa-btn oa-btn-primary"
                onClick={() => {
                  setViewMode('list')
                  void loadWorkspaceData(false)
                }}
              >
                返回应用列表
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
          正在加载应用详情…
        </div>
      )
    }
    if (!detailApp) {
      return (
        <div className="oa-form-card">
          <p className="oa-alert oa-alert-danger">{detailError || '应用详情不存在或无访问权限'}</p>
          <button type="button" className="oa-btn" style={{ marginTop: 12 }} onClick={() => setViewMode('list')}>
            返回应用列表
          </button>
        </div>
      )
    }

    const tone = jobStatusTone(detailApp.status)
    const readOnly = detailApp.can_manage !== true
    const lastHealthCheck = detailHealthCheck?.slug === detailApp.slug ? detailHealthCheck : null
    const unhealthy = detailApp.status === 'failed' || detailApp.status === 'unhealthy'
    const matchingJob = jobs.find(j => j.slug === detailApp.slug && j.version === detailApp.current_version) ?? jobs.find(j => j.slug === detailApp.slug)
    const activeVersion = versions.find(item => item.is_active) ?? versions.find(item => item.version === detailApp.current_version)
    const requiresAIUpdate = !activeVersion || Boolean(activeVersion.download_urls?.['delivery.json']) ||
      (matchingJob?.version === detailApp.current_version && matchingJob?.proposal?.delivery_format === 1)
    const activeLocalJob = matchingJob?.version === detailApp.current_version && matchingJob?.status === 'verified' ? matchingJob : undefined
    const detailTabs = {
      artifacts: '能力与技能',
      configs: '运行配置',
      storage: '持久化存储',
      versions: `版本历史 (${visibleVersions.length})`,
      logs: '日志与 Dockerfile',
    } satisfies Record<DetailTab, string>

    const logView = !readOnly && detailTab === 'logs'
    const detailLog = formatLogOutput(detailLogsData[detailLogsSubTab])
    const logSummary = detailLogsSubTab === 'runtime' ? '容器服务输出（最近 500 行）'
      : detailLogsSubTab === 'build' ? '构建与部署日志' : '已归档 Dockerfile'

    return (
      <div className="oa-overlay-view">
        <div className="oa-overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => setViewMode('list')}>
              <AppIcon name="arrowLeft" size={13} />
              <span>返回列表</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              <strong style={{ fontSize: 15, color: '#0f172a' }}>{detailApp.name}</strong>
              <span className="oa-code">{detailApp.slug}</span>
              {detailApp.current_version ? <span className="oa-pill oa-pill-accent">v{detailApp.current_version}</span> : null}
              <span className={`oa-pill ${tone.pillClass}`}>
                {tone.spinning && <span className="oa-dot oa-pulse" />}
                {tone.text}
              </span>
              {readOnly && <span className="oa-pill">共享只读</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="oa-btn oa-btn-sm"
              disabled={detailLoading || detailBusy}
              onClick={() => void openAppDetail(detailApp.slug, detailTab)}
            >
              <AppIcon name="refresh" size={13} className={detailLoading ? 'oa-spin' : ''} />
              <span>刷新</span>
            </button>
            {!readOnly && (
              <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => startWizardNew(detailApp, findAppJob(jobs, detailApp))}>
                <AppIcon name="plus" size={13} />
                <span>发布新版本</span>
              </button>
            )}
          </div>
        </div>

        <div className="oa-overlay-body">
          {detailError && (
            <div role="alert" className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>{detailError}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailError(null)}>
                关闭
              </button>
            </div>
          )}

          {detailNotice && (
            <div role="status" className="oa-alert oa-alert-ok">
              <AppIcon name="check" size={16} />
              <div style={{ flex: 1 }}>{detailNotice}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailNotice(null)}>
                关闭
              </button>
            </div>
          )}

          {lastHealthCheck?.ok && !unhealthy && (
            <div className="oa-health-result oa-alert oa-alert-ok" role="status">
              <AppIcon name="check" size={16} />
              <div>{lastHealthCheck.message}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailHealthCheck(null)}>关闭</button>
            </div>
          )}

          {(unhealthy || lastHealthCheck?.ok === false) && (
            <div className="oa-alert oa-alert-danger" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AppIcon name="warning" size={16} />
                <div>
                  <strong>{lastHealthCheck?.ok === false ? lastHealthCheck.message : '应用当前状态异常'}</strong>
                  {!lastHealthCheck && (
                    <div style={{ marginTop: 2 }}>{healthFailureDetail(detailApp.error_message) || '请重新检查状态或查看服务器日志。'}</div>
                  )}
                </div>
              </div>
              {!readOnly && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {api.appRecheck && (
                  <button type="button" className="oa-btn oa-btn-xs" disabled={detailBusy} onClick={() => void handleRecheckApp(detailApp.slug, true)}>
                    重新检测状态
                  </button>
                )}
                <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailTab('logs')}>
                  查看日志
                </button>
              </div>}
            </div>
          )}

          {/* Quick Overview Cards */}
          <div className="oa-grid-2">
            <div className="oa-form-card">
              <div className="oa-subcard-head">
                <span>服务访问与运行环境</span>
                {detailApp.app_url && (
                  <a href={detailApp.app_url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-xs">
                    <AppIcon name="external" size={12} />
                    <span>打开应用</span>
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#64748b' }}>访问地址：</span>
                  <span className="oa-mono">{detailApp.app_url}</span>
                  <button type="button" className="oa-btn oa-btn-xs" onClick={() => void copyText('detail-url', detailApp.app_url)}>
                    <AppIcon name={copiedKey === 'detail-url' ? 'check' : 'copy'} size={11} />
                  </button>
                </div>
                <div>
                  <span style={{ color: '#64748b' }}>容器端口：</span>
                  <span className="oa-mono">{detailApp.container_port ?? opcConfig.defaultPort}</span>
                  <span style={{ color: '#64748b', marginLeft: 14 }}>语言运行时：</span>
                  <span>
                    {detailApp.language || '未知'} {detailApp.runtime_version || ''}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  创建时间：{formatDateTime(detailApp.created_at)} · 更新：{formatDateTime(detailApp.updated_at)}
                </div>
              </div>
            </div>

            <div className="oa-form-card">
              <div className="oa-subcard-head">
                <span>智能体技能与业务描述</span>
                {detailApp.skill_synced !== undefined && (
                  <span className={`oa-pill ${detailApp.skill_synced ? 'oa-pill-ok' : 'oa-pill-warn'}`}>
                    {detailApp.skill_synced ? '技能已同步' : '待同步'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#334155' }}>
                <div>
                  <span style={{ color: '#64748b' }}>技能标识：</span>
                  <span className="oa-code">{detailApp.skill_name || `app-${detailApp.slug}`}</span>
                </div>
                <div style={{ color: '#475569' }}>{detailApp.description || '暂无应用描述'}</div>
                {matchingJob && !readOnly && matchingJob.status === 'awaiting_page_verification' && (
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="oa-btn oa-btn-xs oa-btn-primary"
                      onClick={() => void resumeWizardJob(matchingJob, 4)}
                    >
                      前往确认页面并启用技能
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5 Segmented Detail Tabs */}
          {!readOnly && (
            <div className="oa-segmented" role="tablist" aria-label="应用详情">
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
          )}

          {!readOnly && <div id={`${formId}-detail-panel`} role="tabpanel" aria-labelledby={`${formId}-tab-${detailTab}`} tabIndex={0}
            className={logView ? 'oa-detail-tab-panel oa-detail-log-panel' : 'oa-detail-tab-panel'}>
          {/* Tab 1: Artifacts & Skill */}
          {detailTab === 'artifacts' && (
            <AppDeliveryArtifacts
              api={api}
              contextId={contextId}
              slug={detailApp.slug}
              version={detailApp.current_version}
              onOpenVerification={job => void resumeWizardJob(job, 4)}
            />
          )}

          {/* Tab 2: Configs */}
          {detailTab === 'configs' && (
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>在线运行配置</strong>
                  <div className="oa-hint">{requiresAIUpdate ? '在更新向导中由所选 AI 分析配置变更。应用启动后，平台会检查分配的域名。' : '保存后会重启应用容器以应用运行配置。'}</div>
                </div>
                {!readOnly && requiresAIUpdate && (
                  <button type="button" className="oa-btn oa-btn-primary" disabled={detailBusy}
                    onClick={() => startWizardNew(detailApp, activeLocalJob, true)}>
                    让 AI 分析配置更新
                  </button>
                )}
                {!readOnly && !requiresAIUpdate && api.appUpdateConfig && (
                  <button type="button" className="oa-btn oa-btn-primary" disabled={detailBusy} onClick={() => void handleSaveDetailConfig()}>
                    {detailBusy ? '正在保存并重启…' : '保存配置并重启容器'}
                  </button>
                )}
              </div>

              <div className="oa-field" style={{ maxWidth: 260 }}>
                <label className="oa-label" htmlFor={`${formId}-edit-port`}>容器监听端口</label>
                <input id={`${formId}-edit-port`}
                  className="oa-input oa-mono"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={readOnly || requiresAIUpdate}
                  value={editPort}
                  onChange={e => setEditPort(e.target.value)}
                />
              </div>

              <AppDeliveryConfig
                configs={editConfigs}
                originals={detailApp.app_config ?? []}
                resources={resources}
                onChange={next => {
                  if (!readOnly && !requiresAIUpdate) setEditConfigs(next)
                }}
                readOnly={readOnly || requiresAIUpdate}
              />
            </div>
          )}

          {/* Tab 3: Persistent Storage */}
          {detailTab === 'storage' && (
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>持久化数据卷与文件备份</strong>
                  <div className="oa-hint">应用数据库、上传附件及业务持久化目录将在版本升级与重启时保留。</div>
                </div>
                {storageOverview && storageOverview.source !== 'swarm' && storageOverview.mounts_count > 0 && (
                  <button
                    type="button"
                    className="oa-btn oa-btn-sm"
                    onClick={() => void handleDownloadPlatformArtifact(detailApp.slug, { storage: true }, '全部存储卷备份')}
                  >
                    <AppIcon name="archive" size={13} />
                    <span>下载全部存储备份</span>
                  </button>
                )}
              </div>

              {!storageOverview ? (
                <div className="oa-alert oa-alert-info">暂无持久化存储统计信息。</div>
              ) : (
                <>
                  {storageOverview.object_storage && (
                    <div className="oa-subcard">
                      <strong>对象存储</strong>
                      <div className="oa-hint">资源 {storageOverview.object_storage.resource_id} · Bucket <code>{storageOverview.object_storage.bucket}</code></div>
                    </div>
                  )}
                  <div className="oa-grid-3">
                    <div className="oa-subcard">
                      <div className="oa-hint">挂载卷数量</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.mounts_count}</div>
                    </div>
                    <div className="oa-subcard">
                      <div className="oa-hint">存储文件总数</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.source === 'swarm' ? '—' : storageOverview.total_files}</div>
                    </div>
                    <div className="oa-subcard">
                      <div className="oa-hint">已占用空间</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.total_human}</div>
                    </div>
                  </div>

                  {storageOverview.mounts.length === 0 ? (
                    <div className="oa-hint">此应用没有目录挂载。</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {storageOverview.mounts.map(m => (
                        <div key={m.name} className="oa-subcard">
                          <div className="oa-subcard-head">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong style={{ color: '#0f172a' }}>{m.name}</strong>
                              <span className="oa-code">{m.container_path}</span>
                              {m.seed_protected && <span className="oa-pill oa-pill-ok">初始种子受保护</span>}
                              {m.status && <span className="oa-pill">{m.status}</span>}
                            </div>
                            {storageOverview.source !== 'swarm' && (
                              <button
                                type="button"
                                className="oa-btn oa-btn-xs"
                                onClick={() => void handleDownloadPlatformArtifact(detailApp.slug, { storage: true, mount: m.name }, `卷 ${m.name} 备份`)}
                              >
                                下载此卷备份
                              </button>
                            )}
                          </div>
                          <div className="oa-hint">
                            大小：{m.size_human ?? formatFileSize(m.size_bytes)}
                            {storageOverview.source === 'swarm' ? '' : ` · 文件数：${m.file_count ?? 0}`}
                            {m.resource_id ? ` · 资源：${m.resource_id}` : ''}
                            {m.storage_location ? ` · OSS：${m.storage_location}`
                              : m.host_path ? ` · 路径：${m.host_path}` : m.volume_name ? ` · 卷：${m.volume_name}` : ''}
                            {m.purpose ? ` · 用途：${m.purpose}` : ''}
                          </div>
                          {m.sample_files && m.sample_files.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {m.sample_files.slice(0, 6).map(sf => (
                                <span key={sf} className="oa-code">
                                  {sf}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
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
                <span className="oa-hint">可下载源码包和技能包，也可以用历史源码发起更新</span>
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
                      {detailBusy ? '正在回滚…' : `确认回滚到 v${rollbackTarget.version}`}
                    </button>
                    <button type="button" className="oa-btn oa-btn-sm" disabled={detailBusy} onClick={() => setRollbackTarget(null)}>
                      取消
                    </button>
                  </div>
                </div>
              )}

              {versionsError ? (
                <div role="alert" className="oa-alert oa-alert-danger">{versionsError}</div>
              ) : visibleVersions.length === 0 ? (
                <div className="oa-hint">暂无历史版本记录。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleVersions.map(ver => (
                    <div key={ver.id || ver.version} className="oa-subcard">
                      <div className="oa-subcard-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5, color: '#0f172a' }}>v{ver.version}</strong>
                          {currentVersion(ver) && <span className="oa-pill oa-pill-ok">当前运行</span>}
                          {ver.status === 'failed' && <span className="oa-pill oa-pill-danger">失败版本（未上线）</span>}
                          {ver.status && ver.status !== 'failed' && !currentVersion(ver) && <span className="oa-pill">{jobStatusTone(ver.status).text}</span>}
                          <span className="oa-hint">{formatDateTime(ver.created_at)}</span>
                          {ver.deployed_by && <span className="oa-hint">发布人：{ver.deployed_by}</span>}
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
                                setWizardNotice(`使用 v${ver.version} 的源码发起更新，所选 AI 会以当前线上版本和实际数据为基线分析。${local ? '' : '请导入该历史版本的源码。'}`)
                              } else if (api.appRollback) {
                                setRollbackTarget(ver)
                                setRollbackReason('')
                              }
                            }}
                          >
                            {requiresAIUpdate || ver.download_urls?.['delivery.json'] ? '用此版本源码发起更新' : '回滚到此版本'}
                          </button>
                        )}
                      </div>

                      {ver.version_note && <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 8 }}>{ver.version_note}</div>}

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                              { version: ver.version, artifact: 'confirmed-deployment.json' }, `v${ver.version} 已确认部署配置`)}>
                            已确认部署配置
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Logs & Dockerfile */}
          {detailTab === 'logs' && (
            <div className="oa-detail-log-card">
              <div className="oa-detail-log-toolbar">
                <div className="oa-segmented">
                  <button
                    type="button"
                    className={`oa-segmented-btn ${detailLogsSubTab === 'runtime' ? 'active' : ''}`}
                    onClick={() => setDetailLogsSubTab('runtime')}
                  >
                    运行日志（最近 500 行）
                  </button>
                  <button
                    type="button"
                    className={`oa-segmented-btn ${detailLogsSubTab === 'build' ? 'active' : ''}`}
                    onClick={() => setDetailLogsSubTab('build')}
                  >
                    构建日志
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
                    <span>{copiedKey === `detail-log-${detailLogsSubTab}` ? '已复制' : '复制内容'}</span>
                  </button>
                  <button type="button" className="oa-btn oa-btn-xs" onClick={() => void refreshDetailLogs()}>
                    <AppIcon name="refresh" size={12} />
                    <span>刷新日志</span>
                  </button>
                </div>
              </div>

              <div className="oa-detail-log-meta">
                <span>{logSummary}</span>
                <span>当前已加载 {detailLog ? detailLog.split('\n').length : 0} 行</span>
              </div>
              {logsError && <div role="alert" className="oa-alert oa-alert-danger">{logsError}</div>}
              <pre className="oa-log-terminal" tabIndex={0} aria-label={logSummary}>
                {detailLog || (logsError ? '日志暂不可用' : '暂无内容')}
              </pre>
            </div>
          )}

          </div>}

        </div>
      </div>
    )
  }

  return (
    <div className={`opc-apps-root${(viewMode === 'wizard' && wizardStep === 4) || (viewMode === 'detail' && detailApp?.can_manage === true && detailTab === 'logs') ? ' oa-apps-log-view' : ''}`}>
      <style>{appsCss}</style>
      {viewMode === 'list' && (loadingLinkedJob || restorableLinkedJob && !restoredLinkedJob.current
        ? <p role="status">正在查找当前会话的应用任务…</p>
        : renderAppListView())}
      {viewMode === 'wizard' && renderWizardView()}
      {viewMode === 'detail' && renderDetailView()}
    </div>
  )
}
