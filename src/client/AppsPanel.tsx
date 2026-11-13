import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfigItem,
  AppDeliveryJob,
  AppModelGroup,
  AppStorageOverview,
  AppVersionItem,
  DeployedApp,
  OpcApi,
  ResourceSummary,
} from './api.ts'
import { AppDeliveryArtifacts } from './AppDeliveryArtifacts.tsx'
import { AppDeliveryConfig, needsConnectionDecision } from './AppDeliveryConfig.tsx'
import { AppDeliveryReview } from './AppDeliveryReview.tsx'
import { AppIcon } from './AppIcon.tsx'
import { AppSkillPreview } from './AppSkillPreview.tsx'
import { toAppSlug } from './appSlug.ts'
import { appsCss } from './appsStyles.ts'

type ViewMode = 'list' | 'wizard' | 'detail'
type WizardStep = 1 | 2 | 3 | 4
type SourceKind = 'zip' | 'folder'
type ConfigSubTab = 'configs' | 'skill' | 'artifacts'
type DetailTab = 'artifacts' | 'configs' | 'storage' | 'versions' | 'logs'
type LogSubTab = 'runtime' | 'build' | 'dockerfile'

interface OpcRuntimeConfig {
  appDomainRoot: string
  defaultPort: number
  platformBaseUrl: string
}

interface ConfigDraftRow {
  key: string
  value: string
  resource_id?: string
  local_connection_confirmed?: boolean
}

interface ConfigDraftSnapshot {
  artifactHash: string
  rows: ConfigDraftRow[]
  versionNote: string
}

const SLUG_RE = /^[a-z][a-z0-9-]{2,39}$/
const MAX_ZIP_BYTES = 64 * 1024 * 1024
const DRAFT_DISMISS_STORAGE_PREFIX = 'opc-apps-dismissed-draft:'
const DEFAULT_OPC_CONFIG: OpcRuntimeConfig = {
  appDomainRoot: 'apps.internal',
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

function isResumableJob(job: AppDeliveryJob): boolean {
  if (!job || !job.id) return false
  if (job.status === 'verified' && !job.userDisabled) return false
  return [
    'draft',
    'importing',
    'analyzing',
    'review',
    'preparing',
    'ready',
    'building',
    'verifying',
    'awaiting_page_verification',
    'unknown',
    'failed',
  ].includes(job.status)
}

function inferStepForJob(job: AppDeliveryJob): WizardStep {
  switch (job.status) {
    case 'ready':
      return 3
    case 'building':
    case 'verifying':
    case 'awaiting_page_verification':
    case 'verified':
    case 'unknown':
      return 4
    case 'failed':
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

function mergeJobConfigs(job: AppDeliveryJob, draft?: ConfigDraftSnapshot | null): { configs: AppConfigItem[]; originals: AppConfigItem[] } {
  const baseList: AppConfigItem[] = Array.isArray(job.runtime_configs)
    ? job.runtime_configs.map(c => ({ ...c }))
    : (job.proposal?.contract?.configs ?? []).map(c => ({
        key: c.key,
        value: c.secret ? '' : (c.default ?? ''),
        description: c.description ?? '',
        required: Boolean(c.required),
        secret: Boolean(c.secret),
        has_value: Boolean(c.has_original_value || c.default),
        has_original_value: Boolean(c.has_original_value),
        value_source: c.has_original_value ? 'original' : 'manual',
        source_label: c.source?.path ? `来自原项目 ${c.source.path}` : undefined,
      }))

  const originals = baseList.map(c => ({ ...c }))
  if (!draft || !Array.isArray(draft.rows) || draft.rows.length === 0) {
    return { configs: baseList, originals }
  }

  const rowMap = new Map(draft.rows.map(r => [r.key, r]))
  const merged = baseList.map(item => {
    const saved = rowMap.get(item.key)
    if (!saved) return item
    rowMap.delete(item.key)
    return {
      ...item,
      value: saved.resource_id ? '' : (saved.value ?? item.value),
      resource_id: saved.resource_id || undefined,
      value_source: saved.resource_id ? 'resource' : (saved.value ? 'manual' : item.value_source),
      local_connection_confirmed: saved.local_connection_confirmed === true,
    }
  })

  for (const extra of rowMap.values()) {
    merged.push({
      key: extra.key,
      value: extra.resource_id ? '' : (extra.value ?? ''),
      resource_id: extra.resource_id || undefined,
      value_source: extra.resource_id ? 'resource' : 'manual',
      local_connection_confirmed: extra.local_connection_confirmed === true,
      description: '',
    })
  }

  return { configs: merged, originals }
}

function sanitizeConfigRowsForApi(configs: AppConfigItem[]): Array<{
  key: string
  value: string
  resource_id?: string
  local_connection_confirmed?: boolean
}> {
  return configs
    .map(c => ({
      key: (c.key || '').trim(),
      value: c.resource_id ? '' : (c.value ?? ''),
      resource_id: c.resource_id || undefined,
      local_connection_confirmed: c.local_connection_confirmed === true ? true : undefined,
    }))
    .filter(c => c.key.length > 0)
}

function validateConfigsForPublish(configs: AppConfigItem[], expectedPort?: number): string | null {
  const seen = new Set<string>()
  for (const item of configs) {
    const key = (item.key || '').trim()
    if (!key) return '存在未填写变量名的配置项，请填写或删除空白行'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `配置变量名格式无效：${key}`
    if (seen.has(key)) return `存在重复的配置变量名：${key}`
    seen.add(key)

    if (key === 'PORT' && (item.resource_id || (item.value && expectedPort && item.value !== String(expectedPort)))) {
      return `PORT 必须与已确认的容器端口（${expectedPort}）一致，如需修改请返回上一步调整`
    }
    if (!item.resource_id && needsConnectionDecision(item)) {
      return `配置项 ${key} 当前指向本地回环地址（localhost / 127.0.0.1），请选用平台托管资源、填写可达主机地址，或明确勾选确认同容器运行`
    }
    if (item.required && !item.resource_id && !item.value && !item.has_value && !item.has_original_value) {
      return `请填写必填配置项：${key}`
    }
  }
  return null
}

export function AppsPanel({
  api,
  sessionId,
  contextId,
  refreshSignal = 0,
}: {
  api: OpcApi
  sessionId: string
  contextId: string
  refreshSignal?: number
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [loadingList, setLoadingList] = useState(true)
  const [apps, setApps] = useState<DeployedApp[]>([])
  const [jobs, setJobs] = useState<AppDeliveryJob[]>([])
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

  // Step 1 Form State
  const [upgradeTarget, setUpgradeTarget] = useState<DeployedApp | null>(null)
  const [previousJobId, setPreviousJobId] = useState<string | undefined>(undefined)
  const [appName, setAppName] = useState('')
  const [appSlug, setAppSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [containerPort, setContainerPort] = useState<string>('8080')
  const [appDescription, setAppDescription] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('zip')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState('')
  const [slugCheck, setSlugCheck] = useState<{ checking: boolean; available?: boolean; app_url?: string; error?: string }>({
    checking: false,
  })
  const isComposingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Step 2 Footer Bridge
  const [step2State, setStep2State] = useState<{ canContinue: boolean; running: boolean; triggerNext: () => void }>({
    canContinue: false,
    running: false,
    triggerNext: () => {},
  })
  const [reviewInitialFeedback, setReviewInitialFeedback] = useState('')

  // Step 3 Config & Check State
  const [configSubTab, setConfigSubTab] = useState<ConfigSubTab>('configs')
  const [configDrafts, setConfigDrafts] = useState<AppConfigItem[]>([])
  const [originalConfigs, setOriginalConfigs] = useState<AppConfigItem[]>([])
  const [versionNote, setVersionNote] = useState('')
  const draftSaveTimerRef = useRef<number | null>(null)

  // Step 4 Publish & Verify State
  const [verifyCredentials, setVerifyCredentials] = useState<Record<string, string>>({})
  const [rememberCredentials, setRememberCredentials] = useState(true)
  const [wizardLogsOpen, setWizardLogsOpen] = useState(false)
  const [wizardLogsLoading, setWizardLogsLoading] = useState(false)
  const [wizardLogsData, setWizardLogsData] = useState<{ runtime?: string; build?: string }>({})

  // Detail View State
  const [detailApp, setDetailApp] = useState<DeployedApp | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('artifacts')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailNotice, setDetailNotice] = useState<string | null>(null)
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
  const [purgeVolumes, setPurgeVolumes] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBoxOpen, setDeleteBoxOpen] = useState(false)

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
        const catalogData = parseJson<{ apps?: DeployedApp[] }>(catalogRaw, { apps: [] })
        const jobList = parseJson<AppDeliveryJob[]>(jobsRaw, [])
        const resData = parseJson<{ resources?: ResourceSummary[] }>(resourcesRaw, { resources: [] })
        const cfg = parseJson<Partial<OpcRuntimeConfig>>(configRaw, {})
        const models = parseJson<AppModelGroup[]>(modelsRaw, [])

        setApps(Array.isArray(catalogData.apps) ? catalogData.apps : [])
        setJobs(Array.isArray(jobList) ? jobList : [])
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

  // Initialize default provider / model / effort whenever modelGroups changes
  useEffect(() => {
    if (modelGroups.length === 0) return
    const currentGroup = modelGroups.find(g => g.id === selectedProvider) ?? modelGroups[0]
    if (!currentGroup) return
    if (currentGroup.id !== selectedProvider) setSelectedProvider(currentGroup.id)
    const currentModel = currentGroup.models.find(m => m.id === selectedModel) ?? currentGroup.models[0]
    if (!currentModel) return
    if (currentModel.id !== selectedModel) setSelectedModel(currentModel.id)
    const efforts = currentModel.reasoning?.efforts ?? []
    if (efforts.length > 0) {
      if (!efforts.some(e => e.id === selectedEffort)) {
        const preferred = efforts.find(e => e.id === 'medium') ?? efforts[0]
        setSelectedEffort(preferred.id)
      }
    } else if (selectedEffort) {
      setSelectedEffort('')
    }
  }, [modelGroups, selectedProvider, selectedModel, selectedEffort])

  const selectedModelGroup = useMemo(
    () => modelGroups.find(g => g.id === selectedProvider) ?? modelGroups[0],
    [modelGroups, selectedProvider],
  )
  const selectedModelItem = useMemo(
    () => selectedModelGroup?.models.find(m => m.id === selectedModel) ?? selectedModelGroup?.models[0],
    [selectedModelGroup, selectedModel],
  )
  const availableEfforts = selectedModelItem?.reasoning?.efforts ?? []

  // Debounced slug check in Step 1 (new app only)
  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 1 || upgradeTarget) {
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
  }, [api, appSlug, apps, contextId, opcConfig.appDomainRoot, upgradeTarget, viewMode, wizardStep])

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
      try {
        const draftRaw = api.appConfigDraft ? await api.appConfigDraft(job.id, contextId).catch(() => 'null') : 'null'
        const draft = parseJson<ConfigDraftSnapshot | null>(draftRaw, null)
        const { configs, originals } = mergeJobConfigs(job, draft)
        setConfigDrafts(configs)
        setOriginalConfigs(originals)
        setVersionNote(draft?.versionNote ?? job.versionNote ?? '')
      } catch {
        const { configs, originals } = mergeJobConfigs(job, null)
        setConfigDrafts(configs)
        setOriginalConfigs(originals)
        setVersionNote(job.versionNote ?? '')
      }
    },
    [api, contextId],
  )

  // Poll Step 4 while building or verifying
  const fetchWizardLogs = useCallback(
    async (slug: string) => {
      setWizardLogsLoading(true)
      try {
        const raw = await api.appLogs?.(slug, contextId)
        const parsed = parseJson<{ runtime_logs?: string; logs?: string; content?: string; build_log?: string }>(raw, {})
        setWizardLogsData({
          runtime: parsed.runtime_logs ?? parsed.logs ?? parsed.content ?? '',
          build: parsed.build_log ?? '',
        })
      } catch {
        // Non-fatal in log panel.
      } finally {
        setWizardLogsLoading(false)
      }
    },
    [api, contextId],
  )

  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 4 || !wizardJob) return
    if (wizardJob.status !== 'building' && wizardJob.status !== 'verifying') return
    const timer = window.setInterval(() => {
      void refreshWizardJob(wizardJob.id).then(updated => {
        if (updated && updated.status !== 'building' && updated.status !== 'verifying') {
          void loadWorkspaceData(true)
          if (updated.status === 'failed' || wizardLogsOpen) {
            void fetchWizardLogs(updated.slug)
          }
        }
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [fetchWizardLogs, loadWorkspaceData, refreshWizardJob, viewMode, wizardJob, wizardLogsOpen, wizardStep])

  // Load Step 3 draft data when entering Step 3
  useEffect(() => {
    if (viewMode !== 'wizard' || wizardStep !== 3 || !wizardJob) return
    void refreshWizardJob(wizardJob.id).then(fresh => {
      const target = fresh ?? wizardJob
      void syncStep3Drafts(target)
    })
  }, [refreshWizardJob, syncStep3Drafts, viewMode, wizardJob?.id, wizardStep])

  // Open Detail View & load all 5 tabs data
  const openAppDetail = useCallback(
    async (slug: string, initialTab: DetailTab = 'artifacts') => {
      setViewMode('detail')
      setDetailTab(initialTab)
      setDetailLoading(true)
      setDetailError(null)
      setDetailNotice(null)
      setRollbackTarget(null)
      setDeleteBoxOpen(false)
      setDeleteConfirmText('')
      try {
        const [detRaw, verRaw, stgRaw, logRaw] = await Promise.all([
          api.appDetails(slug, contextId),
          api.appVersions?.(slug, contextId).catch(() => '{"versions":[]}') ?? Promise.resolve('{"versions":[]}'),
          api.appStorage?.(slug, contextId).catch(() => 'null') ?? Promise.resolve('null'),
          api.appLogs?.(slug, contextId).catch(() => '{}') ?? Promise.resolve('{}'),
        ])
        const detail = parseJson<DeployedApp | null>(detRaw, null)
        if (!detail) throw new Error('未能读取应用详情')
        const verParsed = parseJson<{ versions?: AppVersionItem[] }>(verRaw, { versions: [] })
        const stgParsed = parseJson<AppStorageOverview | null>(stgRaw, null)
        const logParsed = parseJson<{ runtime_logs?: string; logs?: string; content?: string; build_log?: string; dockerfile?: string }>(
          logRaw,
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
        setDetailError(readErrorMessage(error, '加载应用详情失败'))
      } finally {
        setDetailLoading(false)
      }
    },
    [api, contextId, opcConfig.defaultPort],
  )

  const refreshDetailLogs = useCallback(async () => {
    if (!detailApp) return
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
      setDetailError(readErrorMessage(error, '刷新日志失败'))
    }
  }, [api, contextId, detailApp])

  // Start New App or Upgrade Wizard
  const startWizardNew = useCallback(
    (upgradeApp?: DeployedApp, prevJob?: AppDeliveryJob) => {
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
      setContainerPort(String(upgradeApp?.container_port ?? prevJob?.port ?? opcConfig.defaultPort))
      setAppDescription(upgradeApp?.description ?? prevJob?.description ?? '')
      setSourceKind('zip')
      setZipFile(null)
      setFolderPath('')
      setReviewInitialFeedback('')
      setConfigSubTab('configs')
      setVerifyCredentials({})
      setWizardLogsOpen(false)
      setWizardLogsData({})
    },
    [opcConfig.defaultPort],
  )

  const resumeWizardJob = useCallback(
    async (job: AppDeliveryJob, overrideStep?: WizardStep) => {
      setWizardError(null)
      setWizardNotice(null)
      setVerifyCredentials({})
      setWizardLogsOpen(false)
      setWizardLogsData({})
      setReviewInitialFeedback('')
      setConfigSubTab('configs')
      setViewMode('wizard')
      const fresh = (await refreshWizardJob(job.id)) ?? job
      setWizardJob(fresh)
      const targetStep = overrideStep ?? inferStepForJob(fresh)
      setWizardStep(targetStep)
      if (targetStep === 1) {
        setPreviousJobId(fresh.id)
        setAppName(fresh.name)
        setAppSlug(fresh.slug)
        setSlugManual(true)
        setContainerPort(String(fresh.port ?? opcConfig.defaultPort))
        setAppDescription(fresh.description ?? '')
        setUpgradeTarget(fresh.upgrade ? apps.find(a => a.slug === fresh.slug) ?? null : null)
      } else if (targetStep === 3) {
        await syncStep3Drafts(fresh)
      } else if (targetStep === 4 && (fresh.status === 'failed' || fresh.status === 'verification_failed')) {
        void fetchWizardLogs(fresh.slug)
      }
    },
    [apps, fetchWizardLogs, opcConfig.defaultPort, refreshWizardJob, syncStep3Drafts],
  )

  // Step 1 Submit: Create Job & Trigger Analysis
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    if (!upgradeTarget && slugCheck.available === false) {
      setWizardError('该应用标识已被占用，请更换其他标识')
      return
    }
    const parsedPort = Number.parseInt(containerPort, 10)
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setWizardError('容器端口必须为 1 至 65535 之间的整数')
      return
    }
    if (sourceKind === 'zip' && !zipFile) {
      setWizardError('请选择要上传的源码 ZIP 压缩包')
      return
    }
    if (sourceKind === 'zip' && zipFile && zipFile.size > MAX_ZIP_BYTES) {
      setWizardError('ZIP 文件大小不能超过 64 MiB')
      return
    }
    if (sourceKind === 'folder' && !folderPath.trim()) {
      setWizardError('请选择或填写本机源码目录的完整路径')
      return
    }

    setWizardBusy(true)
    try {
      const payload: Record<string, unknown> = {
        name: cleanName,
        slug: cleanSlug,
        container_port: parsedPort,
        description: appDescription.trim(),
        upgrade: Boolean(upgradeTarget),
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
      if (sourceKind === 'zip' && zipFile) {
        payload.zip = await readFileAsBase64(zipFile)
      } else {
        payload.source = folderPath.trim()
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
          if (updated) setWizardJob(updated)
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

  const handleBrowseFolder = async () => {
    if (!api.appPickSourceFolder) return
    setWizardError(null)
    try {
      const res = parseJson<{ path?: string; cancelled?: boolean; unsupported?: boolean }>(
        await api.appPickSourceFolder(contextId),
        {},
      )
      if (res.unsupported) {
        setWizardError('当前系统不支持原生目录选择框，请手动输入源码目录完整路径或切换为 ZIP 上传')
        return
      }
      if (!res.cancelled && res.path) {
        setFolderPath(res.path)
      }
    } catch (error) {
      setWizardError(readErrorMessage(error, '打开目录选择器失败'))
    }
  }

  // Step 3 Config draft persistence (debounced)
  const scheduleDraftSave = useCallback(
    (job: AppDeliveryJob, nextConfigs: AppConfigItem[], nextNote: string) => {
      if (!api.appSaveConfigDraft || !job.artifactHash) return
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = window.setTimeout(() => {
        const body = {
          artifactHash: job.artifactHash,
          rows: sanitizeConfigRowsForApi(nextConfigs),
          versionNote: nextNote,
        }
        void api.appSaveConfigDraft!(job.id, JSON.stringify(body), contextId).catch(() => {})
      }, 450)
    },
    [api, contextId],
  )

  const handleStep3ConfigsChange = (nextConfigs: AppConfigItem[]) => {
    setConfigDrafts(nextConfigs)
    if (wizardJob) scheduleDraftSave(wizardJob, nextConfigs, versionNote)
  }

  const handleStep3NoteChange = (nextNote: string) => {
    setVersionNote(nextNote)
    if (wizardJob) scheduleDraftSave(wizardJob, configDrafts, nextNote)
  }

  const handleReturnToReview = async () => {
    if (!wizardJob) return
    setWizardBusy(true)
    setWizardError(null)
    try {
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
    if (!wizardJob) return
    setWizardError(null)
    const validationErr = validateConfigsForPublish(configDrafts, wizardJob.port ?? opcConfig.defaultPort)
    if (validationErr) {
      setWizardError(validationErr)
      setConfigSubTab('configs')
      return
    }
    if (!wizardJob.artifactHash) {
      setWizardError('交付包尚未准备完成，请返回方案核对重新生成交付包')
      return
    }

    setWizardBusy(true)
    try {
      const cleanConfigs = sanitizeConfigRowsForApi(configDrafts)
      const confirmRaw = await api.appConfirmDeployment(
        wizardJob.id,
        JSON.stringify({
          artifactHash: wizardJob.artifactHash,
          config: cleanConfigs,
          versionNote: versionNote.trim(),
        }),
        contextId,
      )
      const { confirmationToken } = parseJson<{ confirmationToken: string }>(confirmRaw, { confirmationToken: '' })
      if (!confirmationToken) throw new Error('未能获取发布确认凭证')

      const publishRaw = await api.appPublish(
        wizardJob.id,
        JSON.stringify({
          artifactHash: wizardJob.artifactHash,
          confirmationToken,
          config: cleanConfigs,
          versionNote: versionNote.trim(),
        }),
        contextId,
      )
      const published = parseJson<AppDeliveryJob | null>(publishRaw, null)
      if (published) setWizardJob(published)
      setWizardStep(4)
      void loadWorkspaceData(true)

      if (published && (published.status === 'failed' || published.status === 'verification_failed')) {
        void fetchWizardLogs(published.slug)
      }
    } catch (error) {
      setWizardError(readErrorMessage(error, '确认发布应用失败'))
      void refreshWizardJob(wizardJob.id)
    } finally {
      setWizardBusy(false)
    }
  }

  // Step 4 Actions: Verify, Confirm Page Verification, Toggle Skill, Repair, Reopen
  const handleRunVerification = async (confirmPageVerification = false, useCredentials = false) => {
    if (!wizardJob) return
    setWizardBusy(true)
    setWizardError(null)
    setWizardNotice(null)
    try {
      const options: Record<string, unknown> = {}
      if (confirmPageVerification) options.confirmPageVerification = true
      if (useCredentials) {
        options.credentials = verifyCredentials
        options.rememberCredentials = rememberCredentials
      }
      const raw = api.appVerifyWithOptions
        ? await api.appVerifyWithOptions(wizardJob.id, JSON.stringify(options), contextId)
        : await api.appVerify(wizardJob.id, contextId)
      const updated = parseJson<AppDeliveryJob | null>(raw, null)
      if (updated) setWizardJob(updated)
      if (confirmPageVerification && updated?.status === 'verified' && updated.userDisabled && api.appSetSkillEnabled) {
        await api.appSetSkillEnabled(updated.id, true, contextId)
        await refreshWizardJob(updated.id)
      }
      if (updated?.status === 'verified') {
        setWizardNotice('验证已通过，应用与智能体技能状态已同步')
      }
      void loadWorkspaceData(true)
    } catch (error) {
      setWizardError(readErrorMessage(error, '执行验证失败'))
      void refreshWizardJob(wizardJob.id)
    } finally {
      setWizardBusy(false)
    }
  }

  const handleToggleWizardSkill = async (enabled: boolean) => {
    if (!wizardJob || !api.appSetSkillEnabled) return
    setWizardBusy(true)
    setWizardError(null)
    try {
      await api.appSetSkillEnabled(wizardJob.id, enabled, contextId)
      await refreshWizardJob(wizardJob.id)
      setWizardNotice(enabled ? `已启用智能体技能 app-${wizardJob.slug}` : `已停用智能体技能 app-${wizardJob.slug}`)
      void loadWorkspaceData(true)
    } catch (error) {
      setWizardError(readErrorMessage(error, '切换技能状态失败'))
    } finally {
      setWizardBusy(false)
    }
  }

  const handleLaunchRepair = async () => {
    if (!wizardJob) return
    setWizardBusy(true)
    setWizardError(null)
    try {
      const feedback =
        wizardJob.error ||
        wizardJob.verification?.detail ||
        '本次构建或验证未通过，请结合日志检查 Dockerfile、端口监听、健康检查与鉴权路径并修复'
      if (api.appReopenReview) {
        await api.appReopenReview(wizardJob.id, contextId).catch(() => {})
      }
      setReviewInitialFeedback(feedback)
      const analyzePromise = api.appAnalyzeWithMode
        ? api.appAnalyzeWithMode(wizardJob.id, feedback, sessionId, 'repair', contextId)
        : api.appAnalyze(wizardJob.id, feedback, sessionId, contextId)
      setWizardStep(2)
      void analyzePromise
        .then(raw => {
          const updated = parseJson<AppDeliveryJob | null>(raw, null)
          if (updated) setWizardJob(updated)
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

  const handleReopenDeployment = async () => {
    if (!wizardJob) return
    setWizardBusy(true)
    setWizardError(null)
    try {
      const raw = await api.appReopenDeployment(wizardJob.id, contextId)
      const updated = parseJson<AppDeliveryJob | null>(raw, null)
      if (updated) {
        setWizardJob(updated)
        await syncStep3Drafts(updated)
      }
      setWizardStep(3)
    } catch (error) {
      setWizardError(readErrorMessage(error, '重新打开部署配置失败'))
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
    if (inDetail) {
      setDetailBusy(true)
      setDetailError(null)
      setDetailNotice(null)
    } else {
      setBannerError(null)
      setBannerNotice(null)
    }
    try {
      if (!api.appRecheck) throw new Error('当前插件版本不支持在线重新检测')
      const res = parseJson<{ ok?: boolean; status?: string; error?: string; detail?: string }>(
        await api.appRecheck(slug, contextId),
        {},
      )
      const msg = res.detail || (res.ok ? `健康检测通过（状态：${res.status || 'running'}）` : res.error || '健康检测未通过')
      if (inDetail) {
        if (res.ok) setDetailNotice(msg)
        else setDetailError(msg)
        await openAppDetail(slug, detailTab)
      } else {
        if (res.ok) setBannerNotice(msg)
        else setBannerError(msg)
      }
      void loadWorkspaceData(true)
    } catch (error) {
      const msg = readErrorMessage(error, '重新检测应用状态失败')
      if (inDetail) setDetailError(msg)
      else setBannerError(msg)
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
    const validationErr = validateConfigsForPublish(editConfigs, portNum)
    if (validationErr) {
      setDetailError(validationErr)
      return
    }
    setDetailBusy(true)
    setDetailError(null)
    setDetailNotice(null)
    try {
      const sanitized = sanitizeConfigRowsForApi(editConfigs)
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
      setDetailNotice('配置已更新并触发容器重启，正在刷新最新状态…')
      await openAppDetail(detailApp.slug, 'configs')
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
        verification?: { status?: string; detail?: string }
        job_id?: string
      }>(raw, {})
      setRollbackTarget(null)
      setRollbackReason('')
      if (res.verification?.status === 'awaiting_page_verification' && res.job_id) {
        setDetailNotice(`已回滚至 v${res.active_version ?? rollbackTarget.version}，请前往发布验证页确认页面可用后启用技能`)
        const job = await refreshWizardJob(res.job_id)
        if (job) {
          await resumeWizardJob(job, 4)
          return
        }
      } else {
        setDetailNotice(`已成功回滚至 v${res.active_version ?? rollbackTarget.version}${res.verification?.detail ? `：${res.verification.detail}` : ''}`)
      }
      await openAppDetail(detailApp.slug, 'versions')
      void loadWorkspaceData(true)
    } catch (error) {
      setDetailError(readErrorMessage(error, '版本回滚失败'))
    } finally {
      setDetailBusy(false)
    }
  }

  const handleDeleteApp = async () => {
    if (!detailApp || !api.appDelete) return
    if (deleteConfirmText.trim() !== detailApp.slug) {
      setDetailError(`请输入完整应用标识「${detailApp.slug}」以确认删除`)
      return
    }
    setDetailBusy(true)
    setDetailError(null)
    try {
      await api.appDelete(detailApp.slug, purgeVolumes, contextId)
      setBannerNotice(`已下线并删除应用 ${detailApp.name}（${detailApp.slug}）`)
      setDetailApp(null)
      setViewMode('list')
      void loadWorkspaceData(false)
    } catch (error) {
      setDetailError(readErrorMessage(error, '下线删除应用失败'))
    } finally {
      setDetailBusy(false)
    }
  }

  const resumableJob = useMemo(() => {
    const candidate = jobs.find(isResumableJob)
    if (!candidate) return null
    const token = `${candidate.id}:${candidate.status}`
    if (dismissedDraftToken === token) return null
    return candidate
  }, [dismissedDraftToken, jobs])

  const dismissDraftBanner = (job: AppDeliveryJob) => {
    const token = `${job.id}:${job.status}`
    setDismissedDraftToken(token)
    try {
      sessionStorage.setItem(DRAFT_DISMISS_STORAGE_PREFIX + contextId, token)
    } catch {
      // Ignore storage errors.
    }
  }

  // Filter versions per work-opc convention: if any version is running/active, hide pure failed historical attempts
  const visibleVersions = useMemo(() => {
    const hasRunning = versions.some(v => v.status === 'running' || v.is_active)
    return hasRunning ? versions.filter(v => v.status !== 'failed' || v.is_active) : versions
  }, [versions])

  // Render View 1: App List
  const renderAppListView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="oa-topbar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="oa-title">企业应用</h2>
            <span className="oa-pill oa-pill-accent">{apps.length} 个应用</span>
          </div>
          <p className="oa-subtitle" style={{ marginTop: 4 }}>
            将本地项目接入平台运行环境，自动完成分析改造、配置托管与上线发布，同时生成可调用的智能体技能。
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <div className="oa-alert oa-alert-danger">
          <AppIcon name="warning" size={16} />
          <div style={{ flex: 1 }}>{bannerError}</div>
          <button type="button" className="oa-btn oa-btn-xs" onClick={() => setBannerError(null)}>
            关闭
          </button>
        </div>
      )}

      {bannerNotice && (
        <div className="oa-alert oa-alert-ok">
          <AppIcon name="check" size={16} />
          <div style={{ flex: 1 }}>{bannerNotice}</div>
          <button type="button" className="oa-btn oa-btn-xs" onClick={() => setBannerNotice(null)}>
            关闭
          </button>
        </div>
      )}

      {resumableJob && (() => {
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
            const readOnly = app.can_manage === false
            const isFailed = app.status === 'failed' || app.status === 'unhealthy'
            const matchingJob = jobs.find(j => j.slug === app.slug)
            return (
              <div key={app.slug} className="oa-app-card">
                <div className="oa-app-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div className="oa-app-icon-box">
                      <AppIcon name="code" size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 650,
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {app.name}
                      </div>
                      <div className="oa-mono" style={{ fontSize: 11.5, color: '#64748b' }}>
                        {app.slug}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {app.current_version ? <span className="oa-pill oa-pill-accent">v{app.current_version}</span> : null}
                    {readOnly && <span className="oa-pill">共享应用（只读）</span>}
                    <span className={`oa-pill ${tone.pillClass}`}>
                      {tone.spinning && <span className="oa-dot oa-pulse" />}
                      {tone.text}
                    </span>
                  </div>
                </div>

                <p className="oa-app-card-desc">{app.description || '暂无应用描述'}</p>

                <div className="oa-app-card-meta">
                  {app.app_url && (
                    <a
                      href={app.app_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <span className="oa-mono" style={{ fontSize: 11.5 }}>
                        {app.app_url}
                      </span>
                      <AppIcon name="external" size={11} />
                    </a>
                  )}
                  {app.container_port && <span>端口 {app.container_port}</span>}
                  {app.language && (
                    <span>
                      {app.language}
                      {app.runtime_version ? ` ${app.runtime_version}` : ''}
                    </span>
                  )}
                </div>

                {isFailed && app.error_message && (
                  <div className="oa-alert oa-alert-danger" style={{ padding: '8px 10px', fontSize: 12 }}>
                    <AppIcon name="warning" size={14} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.error_message}</span>
                  </div>
                )}

                <div className="oa-app-card-actions">
                  {isFailed ? (
                    <>
                      {!readOnly && (
                        <button
                          type="button"
                          className="oa-btn oa-btn-sm oa-btn-primary"
                          onClick={() => {
                            if (matchingJob && matchingJob.published) {
                              void resumeWizardJob(matchingJob, 4)
                            } else {
                              startWizardNew(app)
                            }
                          }}
                        >
                          恢复 / 重新部署
                        </button>
                      )}
                      {api.appRecheck && (
                        <button type="button" className="oa-btn oa-btn-sm" onClick={() => void handleRecheckApp(app.slug, false)}>
                          <AppIcon name="refresh" size={13} />
                          <span>重新检测</span>
                        </button>
                      )}
                      <button type="button" className="oa-btn oa-btn-sm" onClick={() => void openAppDetail(app.slug, 'logs')}>
                        查看日志
                      </button>
                    </>
                  ) : (
                    <>
                      {app.app_url && (
                        <a href={app.app_url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-sm">
                          <AppIcon name="external" size={13} />
                          <span>打开应用</span>
                        </a>
                      )}
                      <button type="button" className="oa-btn oa-btn-sm" onClick={() => void openAppDetail(app.slug, 'artifacts')}>
                        详情与管理
                      </button>
                      {!readOnly && (
                        <button type="button" className="oa-btn oa-btn-sm oa-btn-accent-soft" onClick={() => startWizardNew(app)}>
                          发布新版本
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // Render View 2: 4-Step Wizard
  const renderWizardView = () => {
    const steps: Array<{ id: WizardStep; label: string }> = [
      { id: 1, label: '源码与标识' },
      { id: 2, label: '方案核对' },
      { id: 3, label: '配置与检查' },
      { id: 4, label: '发布与验证' },
    ]

    const portNum = Number.parseInt(containerPort, 10)
    const slugValid = SLUG_RE.test(toAppSlug(appSlug, { allowTrailingDash: false }))
    const canSubmitStep1 =
      !wizardBusy &&
      appName.trim().length > 0 &&
      slugValid &&
      (Boolean(upgradeTarget) || slugCheck.available !== false) &&
      Number.isInteger(portNum) &&
      portNum >= 1 &&
      portNum <= 65535 &&
      (sourceKind === 'zip' ? Boolean(zipFile) : folderPath.trim().length > 0)

    const missingConfigAlert = wizardJob
      ? validateConfigsForPublish(configDrafts, wizardJob.port ?? opcConfig.defaultPort)
      : null

    return (
      <div className="oa-overlay-view">
        <div className="oa-overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              type="button"
              className="oa-btn oa-btn-sm"
              onClick={() => {
                setViewMode('list')
                void loadWorkspaceData(true)
              }}
            >
              <AppIcon name="arrowLeft" size={13} />
              <span>返回列表</span>
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15, color: '#0f172a' }}>{upgradeTarget ? '升级已有应用' : '新建企业应用'}</strong>
                {(wizardJob?.slug || appSlug) && <span className="oa-code">{wizardJob?.slug || appSlug}</span>}
              </div>
            </div>
          </div>

          <div className="oa-stepper">
            {steps.map((step, idx) => {
              const stateClass = wizardStep === step.id ? 'active' : wizardStep > step.id ? 'done' : ''
              return (
                <React.Fragment key={step.id}>
                  <div className={`oa-step-item ${stateClass}`}>
                    <span className="oa-step-num">{wizardStep > step.id ? '✓' : step.id}</span>
                    <span>{step.label}</span>
                  </div>
                  {idx < steps.length - 1 && <span className="oa-step-sep">/</span>}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        <div className="oa-overlay-body">
          {wizardError && (
            <div className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>{wizardError}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setWizardError(null)}>
                关闭
              </button>
            </div>
          )}

          {wizardNotice && (
            <div className="oa-alert oa-alert-ok">
              <AppIcon name="check" size={16} />
              <div style={{ flex: 1 }}>{wizardNotice}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setWizardNotice(null)}>
                关闭
              </button>
            </div>
          )}

          {/* STEP 1 */}
          {wizardStep === 1 && (
            <form id="opc-wizard-step1-form" onSubmit={e => void handleStep1Submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {upgradeTarget && (
                <div className="oa-alert oa-alert-info">
                  <AppIcon name="sparkle" size={16} />
                  <div>
                    <strong>升级目标：{upgradeTarget.name}</strong>（<span className="oa-mono">{upgradeTarget.slug}</span>，当前版本 v
                    {upgradeTarget.current_version || 1}）。将沿用原应用访问地址 <span className="oa-mono">{upgradeTarget.app_url}</span>。
                  </div>
                </div>
              )}

              <div className="oa-form-card">
                <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a', marginBottom: 12 }}>基本信息与访问标识</div>
                <div className="oa-grid-2">
                  <div className="oa-field">
                    <label className="oa-label">应用名称 *</label>
                    <input
                      className="oa-input"
                      value={appName}
                      placeholder="例如：费用报销助手"
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
                      <label className="oa-label">应用标识与访问地址 *</label>
                      {!upgradeTarget && slugManual && appName.trim() && (
                        <button
                          type="button"
                          className="oa-btn-link"
                          style={{ fontSize: 11.5 }}
                          onClick={() => {
                            setSlugManual(false)
                            setAppSlug(toAppSlug(appName, { allowTrailingDash: false }))
                          }}
                        >
                          恢复自动生成
                        </button>
                      )}
                    </div>
                    <div className="oa-compound-url">
                      <span className="oa-compound-addon">http://</span>
                      <input
                        className="oa-compound-input oa-mono"
                        value={appSlug}
                        disabled={Boolean(upgradeTarget)}
                        placeholder="my-app-slug"
                        onChange={e => {
                          setSlugManual(true)
                          setAppSlug(toAppSlug(e.target.value, { allowTrailingDash: true }))
                        }}
                        onBlur={() => setAppSlug(prev => toAppSlug(prev, { allowTrailingDash: false }))}
                      />
                      <span className="oa-compound-addon">.{opcConfig.appDomainRoot}</span>
                    </div>
                    {!upgradeTarget && (
                      <div className="oa-hint">
                        {slugCheck.checking ? (
                          '正在校验标识可用性…'
                        ) : slugCheck.error ? (
                          <span style={{ color: '#dc2626' }}>{slugCheck.error}</span>
                        ) : slugCheck.available ? (
                          <span style={{ color: '#15803d' }}>标识可用 · 预计访问地址：{slugCheck.app_url}</span>
                        ) : (
                          '3–40 位小写字母、数字或短横线，须以字母开头（支持输入中文名自动转拼音）'
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="oa-grid-2" style={{ marginTop: 12 }}>
                  <div className="oa-field">
                    <label className="oa-label">容器监听端口 *</label>
                    <input
                      className="oa-input oa-mono"
                      type="number"
                      min={1}
                      max={65535}
                      value={containerPort}
                      onChange={e => setContainerPort(e.target.value)}
                    />
                    <span className="oa-hint">应用容器实际监听的内部端口（默认 {opcConfig.defaultPort}），AI 会按此核对服务入口。</span>
                  </div>

                  <div className="oa-field">
                    <label className="oa-label">应用功能简介（可选）</label>
                    <input
                      className="oa-input"
                      value={appDescription}
                      placeholder="简述核心业务用途，方便智能体理解何时调用此应用"
                      onChange={e => setAppDescription(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="oa-form-card">
                <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a', marginBottom: 4 }}>AI 分析模型设置</div>
                <p className="oa-hint" style={{ marginBottom: 12 }}>
                  用于读取项目结构、生成改造代码与部署契约。若未配置则沿用工作区默认模型。
                </p>
                {modelGroups.length === 0 ? (
                  <div className="oa-alert oa-alert-warn">暂无可用分析模型列表，提交时将使用默认托管配置。</div>
                ) : (
                  <div className="oa-grid-3">
                    <div className="oa-field">
                      <label className="oa-label">模型提供商</label>
                      <select
                        className="oa-select"
                        value={selectedProvider}
                        onChange={e => setSelectedProvider(e.target.value)}
                      >
                        {modelGroups.map(g => (
                          <option key={g.id} value={g.id}>
                            {g.name || g.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label">分析模型</label>
                      <select className="oa-select" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                        {(selectedModelGroup?.models ?? []).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oa-field">
                      <label className="oa-label">推理深度</label>
                      <select
                        className="oa-select"
                        value={selectedEffort}
                        disabled={availableEfforts.length === 0}
                        onChange={e => setSelectedEffort(e.target.value)}
                      >
                        {availableEfforts.length === 0 ? (
                          <option value="">默认</option>
                        ) : (
                          availableEfforts.map(ef => (
                            <option key={ef.id} value={ef.id}>
                              {ef.name || ef.id}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="oa-form-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a' }}>导入项目源码 *</div>
                    <div className="oa-hint">导入后会在插件隔离工作区创建副本，不会改动您的原始代码目录。</div>
                  </div>
                  <div className="oa-segmented">
                    <button
                      type="button"
                      className={`oa-segmented-btn ${sourceKind === 'zip' ? 'active' : ''}`}
                      onClick={() => setSourceKind('zip')}
                    >
                      上传源码压缩包 (.zip)
                    </button>
                    <button
                      type="button"
                      className={`oa-segmented-btn ${sourceKind === 'folder' ? 'active' : ''}`}
                      onClick={() => setSourceKind('folder')}
                    >
                      选择本机源码目录
                    </button>
                  </div>
                </div>

                {sourceKind === 'zip' ? (
                  <div
                    className={`oa-dropzone ${dragActive ? 'active' : ''}`}
                    onDragOver={e => {
                      e.preventDefault()
                      setDragActive(true)
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={e => {
                      e.preventDefault()
                      setDragActive(false)
                      const file = e.dataTransfer.files?.[0]
                      if (file) setZipFile(file)
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) setZipFile(file)
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <AppIcon name="archive" size={24} />
                      {zipFile ? (
                        <>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>
                            已选择：{zipFile.name}（{formatFileSize(zipFile.size)}）
                          </div>
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={e => {
                              e.stopPropagation()
                              setZipFile(null)
                              if (fileInputRef.current) fileInputRef.current.value = ''
                            }}
                          >
                            重新选择
                          </button>
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>点击或拖拽 .zip 源码压缩包到此区域</div>
                          <div className="oa-hint">支持最大 64 MiB，自动忽略 node_modules / .git / __pycache__</div>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="oa-field">
                    <label className="oa-label">本机源码文件夹路径</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="oa-input oa-mono"
                        value={folderPath}
                        placeholder="/Users/.../my-project"
                        onChange={e => setFolderPath(e.target.value)}
                      />
                      {api.appPickSourceFolder && (
                        <button type="button" className="oa-btn" onClick={() => void handleBrowseFolder()}>
                          <AppIcon name="folder" size={14} />
                          <span>选择文件夹…</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}

          {/* STEP 2 */}
          {wizardStep === 2 && wizardJob && (
            <AppDeliveryReview
              api={api}
              sessionId={sessionId}
              contextId={contextId}
              jobId={wizardJob.id}
              footerMode="external"
              onlineResources={resources}
              repairMode={wizardJob.analysis_mode === 'repair' || wizardJob.analysisMode === 'repair'}
              initialFeedback={reviewInitialFeedback}
              onReady={updated => {
                setWizardJob(updated)
                void syncStep3Drafts(updated)
              }}
              onReplaceSource={() => {
                setPreviousJobId(wizardJob.id)
                setAppName(wizardJob.name)
                setAppSlug(wizardJob.slug)
                setSlugManual(true)
                setContainerPort(String(wizardJob.port ?? opcConfig.defaultPort))
                setAppDescription(wizardJob.description ?? '')
                setWizardStep(1)
              }}
              onNextStep={() => setWizardStep(3)}
              onInvalidate={() => void refreshWizardJob(wizardJob.id)}
              onStepStateChange={setStep2State}
            />
          )}

          {/* STEP 3 */}
          {wizardStep === 3 && wizardJob && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                      className={`oa-segmented-btn ${configSubTab === 'artifacts' ? 'active' : ''}`}
                      onClick={() => setConfigSubTab('artifacts')}
                    >
                      改造与检查
                    </button>
                  </div>
                </div>

                <div className="oa-field" style={{ marginTop: 12 }}>
                  <label className="oa-label">版本发布说明（可选）</label>
                  <input
                    className="oa-input"
                    value={versionNote}
                    placeholder={wizardJob.upgrade ? '例如：新增审批导出接口、修复环境变量读取' : '例如：首次上线发布'}
                    onChange={e => handleStep3NoteChange(e.target.value)}
                  />
                </div>
              </div>

              {missingConfigAlert ? (
                <div className="oa-alert oa-alert-warn">
                  <AppIcon name="warning" size={16} />
                  <div>{missingConfigAlert}</div>
                </div>
              ) : (
                <div className="oa-alert oa-alert-ok">
                  <AppIcon name="check" size={16} />
                  <div>运行配置与依赖资源已校验就绪，可点击右下角按钮确认并发布上线。</div>
                </div>
              )}

              {configSubTab === 'configs' && (
                <div className="oa-form-card">
                  <AppDeliveryConfig
                    configs={configDrafts}
                    originals={originalConfigs}
                    resources={resources}
                    onChange={handleStep3ConfigsChange}
                  />
                </div>
              )}

              {configSubTab === 'skill' && <AppSkillPreview api={api} contextId={contextId} job={wizardJob} />}

              {configSubTab === 'artifacts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(wizardJob.preparationChecks ?? []).length > 0 && (
                    <div className="oa-subcard">
                      <div className="oa-subcard-head">
                        <span>交付包生成与自检结果</span>
                        <span className="oa-pill oa-pill-ok">{wizardJob.preparationChecks!.length} 项</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {wizardJob.preparationChecks!.map((chk, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}>
                            <span className={`oa-pill ${chk.status === 'passed' ? 'oa-pill-ok' : 'oa-pill-warn'}`}>
                              {chk.status === 'passed' ? '通过' : chk.status}
                            </span>
                            <div>
                              <strong style={{ color: '#0f172a' }}>{chk.label}</strong>
                              <div className="oa-hint">{chk.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {wizardJob.artifacts && Object.keys(wizardJob.artifacts).length > 0 && (
                    <div className="oa-subcard">
                      <div className="oa-subcard-head">
                        <span>本地待交付文件</span>
                        <span className="oa-hint">点击可导出到本地检查</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {Object.keys(wizardJob.artifacts).map(filename => (
                          <button
                            key={filename}
                            type="button"
                            className="oa-btn oa-btn-sm"
                            onClick={() => void handleSaveLocalArtifact(wizardJob.id, filename)}
                          >
                            <AppIcon name="fileCode" size={13} />
                            <span className="oa-mono">{filename}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(wizardJob.proposal?.changes ?? []).length > 0 && (
                    <div className="oa-subcard">
                      <div className="oa-subcard-head">
                        <span>源码改造清单</span>
                        <span className="oa-pill oa-pill-accent">{wizardJob.proposal!.changes!.length} 项</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {wizardJob.proposal!.changes!.map((ch, idx) => (
                          <div key={ch.id || idx} style={{ borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: idx > 0 ? 8 : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="oa-code">{ch.path}</span>
                              {ch.group && <span className="oa-pill">{ch.group}</span>}
                            </div>
                            <div className="oa-hint" style={{ marginTop: 3 }}>
                              {ch.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 4 */}
          {wizardStep === 4 && wizardJob && (() => {
            const tone = jobStatusTone(wizardJob.status, wizardJob.userDisabled)
            const needsPageConfirm =
              wizardJob.status === 'awaiting_page_verification' ||
              (wizardJob.status === 'verified' && (wizardJob.userDisabled || wizardJob.verification?.skill_enabled === false))
            const isFailed = wizardJob.status === 'failed' || wizardJob.status === 'verification_failed' || wizardJob.status === 'unknown'
            const credFields = wizardJob.proposal?.contract?.verification_credential_fields ?? []

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="oa-form-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{wizardJob.name}</h3>
                        <span className="oa-code">{wizardJob.slug}</span>
                        {wizardJob.version && <span className="oa-pill oa-pill-accent">v{wizardJob.version}</span>}
                        <span className={`oa-pill ${tone.pillClass}`}>
                          {tone.spinning && <span className="oa-dot oa-pulse" />}
                          {tone.text}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <a
                          href={wizardJob.url}
                          target="_blank"
                          rel="noreferrer"
                          className="oa-mono"
                          style={{ fontSize: 12.5, color: '#2563eb', textDecoration: 'none' }}
                        >
                          {wizardJob.url}
                        </a>
                        <button type="button" className="oa-btn oa-btn-xs" onClick={() => void copyText('wizard-url', wizardJob.url)}>
                          <AppIcon name={copiedKey === 'wizard-url' ? 'check' : 'copy'} size={12} />
                          <span>{copiedKey === 'wizard-url' ? '已复制' : '复制地址'}</span>
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="oa-btn oa-btn-sm"
                      disabled={wizardBusy}
                      onClick={() => void refreshWizardJob(wizardJob.id)}
                    >
                      <AppIcon name="refresh" size={13} />
                      <span>刷新状态</span>
                    </button>
                  </div>

                  {wizardJob.error && (
                    <div className="oa-alert oa-alert-danger" style={{ marginTop: 12 }}>
                      <AppIcon name="warning" size={16} />
                      <div style={{ whiteSpace: 'pre-wrap' }}>{wizardJob.error}</div>
                    </div>
                  )}

                  {wizardJob.events?.length > 0 && (
                    <div className="oa-timeline-list" style={{ marginTop: 12 }}>
                      {wizardJob.events.map((ev, idx) => (
                        <div key={idx} className="oa-timeline-item">
                          <span className="oa-dot" style={{ marginTop: 6, background: '#94a3b8' }} />
                          <span>{ev}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Page Verification Card */}
                {needsPageConfirm && (
                  <div className="oa-subcard" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <strong style={{ color: '#92400e', fontSize: 13.5 }}>容器已上线，请确认页面可用后启用应用技能</strong>
                        <p className="oa-hint" style={{ marginTop: 4, color: '#92400e' }}>
                          {wizardJob.verification?.detail ||
                            `后端健康检查与接口冒烟已通过。请先打开 ${wizardJob.url} 确认页面渲染正常，再启用技能 app-${wizardJob.slug}。`}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <a href={wizardJob.url} target="_blank" rel="noreferrer" className="oa-btn oa-btn-sm">
                          <AppIcon name="external" size={13} />
                          <span>打开应用页面</span>
                        </a>
                        <button
                          type="button"
                          className="oa-btn oa-btn-sm oa-btn-primary"
                          disabled={wizardBusy}
                          onClick={() => void handleRunVerification(true, false)}
                        >
                          <AppIcon name="check" size={13} />
                          <span>页面可用，启用应用技能</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Verified & Skill Active Banner */}
                {wizardJob.status === 'verified' && !needsPageConfirm && (
                  <div className="oa-alert oa-alert-ok" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AppIcon name="check" size={16} />
                      <span>
                        <strong>部署与验证已完成</strong> · 智能体技能 <span className="oa-code">app-{wizardJob.slug}</span> 已启用并同步到当前工作区。
                      </span>
                    </div>
                    {api.appSetSkillEnabled && (
                      <button
                        type="button"
                        className="oa-btn oa-btn-sm"
                        disabled={wizardBusy}
                        onClick={() => void handleToggleWizardSkill(false)}
                      >
                        暂时停用技能
                      </button>
                    )}
                  </div>
                )}

                {/* Verification Check Details */}
                {wizardJob.verification && wizardJob.verification.checks?.length > 0 && (
                  <div className="oa-subcard">
                    <div className="oa-subcard-head">
                      <span>接口与业务验证结果</span>
                      <span className={`oa-pill ${wizardJob.verification.checks.every(c => c.passed) ? 'oa-pill-ok' : 'oa-pill-warn'}`}>
                        {wizardJob.verification.checks.filter(c => c.passed).length} / {wizardJob.verification.checks.length} 通过
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {wizardJob.verification.checks.map((chk, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                          <span className={`oa-pill ${chk.passed ? 'oa-pill-ok' : 'oa-pill-danger'}`}>
                            {chk.passed ? '通过' : '失败'}
                          </span>
                          <span className="oa-mono">{chk.operation}</span>
                          {chk.status !== undefined && <span className="oa-hint">HTTP {chk.status}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verification Credentials Form */}
                {(credFields.length > 0 || isFailed) && (
                  <div className="oa-subcard">
                    <div className="oa-subcard-head">
                      <span>带鉴权凭据重新验证</span>
                      <span className="oa-hint">若应用受登录保护，可填写测试账号密码或会话 Token 进行自动验证</span>
                    </div>
                    {credFields.length > 0 ? (
                      <div className="oa-grid-2" style={{ marginBottom: 10 }}>
                        {credFields.map(field => (
                          <div key={field.key} className="oa-field">
                            <label className="oa-label">
                              {field.key}（{field.kind === 'password' ? '密码' : field.kind === 'session' ? '会话/Token' : '账号'}）
                            </label>
                            <input
                              className="oa-input"
                              type={field.kind === 'password' ? 'password' : 'text'}
                              value={verifyCredentials[field.key] ?? ''}
                              onChange={e => setVerifyCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="oa-grid-2" style={{ marginBottom: 10 }}>
                        <div className="oa-field">
                          <label className="oa-label">测试账号 / Cookie / Bearer Token</label>
                          <input
                            className="oa-input"
                            value={verifyCredentials.username ?? ''}
                            placeholder="选填"
                            onChange={e => setVerifyCredentials(prev => ({ ...prev, username: e.target.value }))}
                          />
                        </div>
                        <div className="oa-field">
                          <label className="oa-label">密码 / Token 值</label>
                          <input
                            className="oa-input"
                            type="password"
                            value={verifyCredentials.password ?? ''}
                            placeholder="选填"
                            onChange={e => setVerifyCredentials(prev => ({ ...prev, password: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#475569' }}>
                        <input
                          type="checkbox"
                          checked={rememberCredentials}
                          onChange={e => setRememberCredentials(e.target.checked)}
                        />
                        <span>在本机加密凭据库记住测试凭据</span>
                      </label>
                      <button
                        type="button"
                        className="oa-btn oa-btn-sm oa-btn-primary"
                        disabled={wizardBusy}
                        onClick={() => void handleRunVerification(false, true)}
                      >
                        用凭据重试验证
                      </button>
                    </div>
                  </div>
                )}

                {/* Failure Recovery Actions */}
                {isFailed && (
                  <div className="oa-subcard" style={{ borderColor: '#fecaca' }}>
                    <div className="oa-subcard-head">
                      <span style={{ color: '#b91c1c' }}>失败恢复与排查</span>
                      <span className="oa-hint">可根据错误原因选择修复方式</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" disabled={wizardBusy} onClick={() => void handleLaunchRepair()}>
                        <AppIcon name="sparkle" size={13} />
                        <span>让 AI 分析修复问题</span>
                      </button>
                      {wizardJob.published && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleReopenDeployment()}>
                          <AppIcon name="sliders" size={13} />
                          <span>修改运行配置并重发</span>
                        </button>
                      )}
                      {wizardJob.proposal && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleReturnToReview()}>
                          返回方案核对
                        </button>
                      )}
                      {api.appRecheck && (
                        <button type="button" className="oa-btn oa-btn-sm" disabled={wizardBusy} onClick={() => void handleRunVerification(false, false)}>
                          <AppIcon name="refresh" size={13} />
                          <span>重新验证服务</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="oa-btn oa-btn-sm"
                        disabled={wizardBusy}
                        onClick={() => startWizardNew(upgradeTarget ?? undefined, wizardJob)}
                      >
                        重新导入源码
                      </button>
                    </div>
                  </div>
                )}

                {/* Expandable Server Logs */}
                <div className="oa-subcard">
                  <div className="oa-subcard-head" style={{ marginBottom: wizardLogsOpen ? 10 : 0 }}>
                    <span>服务器构建与运行日志</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {wizardLogsOpen && (
                        <>
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            onClick={() =>
                              void copyText(
                                'wizard-logs',
                                formatLogOutput(wizardLogsData.runtime) || formatLogOutput(wizardLogsData.build) || '',
                              )
                            }
                          >
                            <AppIcon name={copiedKey === 'wizard-logs' ? 'check' : 'copy'} size={12} />
                            <span>{copiedKey === 'wizard-logs' ? '已复制' : '复制日志'}</span>
                          </button>
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs"
                            disabled={wizardLogsLoading}
                            onClick={() => void fetchWizardLogs(wizardJob.slug)}
                          >
                            <AppIcon name="refresh" size={12} className={wizardLogsLoading ? 'oa-spin' : ''} />
                            <span>刷新</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="oa-btn oa-btn-xs"
                        onClick={() => {
                          const next = !wizardLogsOpen
                          setWizardLogsOpen(next)
                          if (next) void fetchWizardLogs(wizardJob.slug)
                        }}
                      >
                        {wizardLogsOpen ? '收起日志' : '展开查看日志'}
                      </button>
                    </div>
                  </div>
                  {wizardLogsOpen && (
                    <pre className="oa-log-terminal">
                      {wizardLogsLoading
                        ? '正在获取服务器日志…'
                        : formatLogOutput(wizardLogsData.runtime) || formatLogOutput(wizardLogsData.build) || '暂无日志输出'}
                    </pre>
                  )}
                </div>
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
              <button type="submit" form="opc-wizard-step1-form" className="oa-btn oa-btn-primary" disabled={!canSubmitStep1}>
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
                  setPreviousJobId(wizardJob.id)
                  setAppName(wizardJob.name)
                  setAppSlug(wizardJob.slug)
                  setSlugManual(true)
                  setContainerPort(String(wizardJob.port ?? opcConfig.defaultPort))
                  setAppDescription(wizardJob.description ?? '')
                  setWizardStep(1)
                }}
              >
                返回重选源码
              </button>
              <button
                type="button"
                className="oa-btn oa-btn-primary"
                disabled={!step2State.canContinue || step2State.running}
                onClick={() => step2State.triggerNext()}
              >
                {step2State.running ? '正在准备交付包…' : '确认改造方案，进入配置检查'}
              </button>
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
                disabled={wizardBusy || Boolean(missingConfigAlert)}
                onClick={() => void handlePublishApp()}
              >
                {wizardBusy ? '正在提交发布…' : '确认配置并发布上线'}
              </button>
            </>
          )}

          {wizardStep === 4 && (
            <>
              <span className="oa-hint">发布完成后可在应用列表中随时管理配置、版本回滚与存储备份</span>
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
          )}
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
    const readOnly = detailApp.can_manage === false
    const matchingJob = jobs.find(j => j.slug === detailApp.slug && j.version === detailApp.current_version) ?? jobs.find(j => j.slug === detailApp.slug)

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
              <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => startWizardNew(detailApp)}>
                <AppIcon name="plus" size={13} />
                <span>发布新版本</span>
              </button>
            )}
          </div>
        </div>

        <div className="oa-overlay-body">
          {detailError && (
            <div className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>{detailError}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailError(null)}>
                关闭
              </button>
            </div>
          )}

          {detailNotice && (
            <div className="oa-alert oa-alert-ok">
              <AppIcon name="check" size={16} />
              <div style={{ flex: 1 }}>{detailNotice}</div>
              <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailNotice(null)}>
                关闭
              </button>
            </div>
          )}

          {(detailApp.status === 'failed' || detailApp.status === 'unhealthy' || detailApp.error_message) && (
            <div className="oa-alert oa-alert-danger" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AppIcon name="warning" size={16} />
                <div>
                  <strong>应用当前状态异常</strong>
                  {detailApp.error_message && <div style={{ marginTop: 2 }}>{detailApp.error_message}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {api.appRecheck && (
                  <button type="button" className="oa-btn oa-btn-xs" disabled={detailBusy} onClick={() => void handleRecheckApp(detailApp.slug, true)}>
                    重新检测状态
                  </button>
                )}
                <button type="button" className="oa-btn oa-btn-xs" onClick={() => setDetailTab('logs')}>
                  查看日志
                </button>
              </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div className="oa-segmented">
              <button type="button" className={`oa-segmented-btn ${detailTab === 'artifacts' ? 'active' : ''}`} onClick={() => setDetailTab('artifacts')}>
                能力与技能
              </button>
              <button type="button" className={`oa-segmented-btn ${detailTab === 'configs' ? 'active' : ''}`} onClick={() => setDetailTab('configs')}>
                运行配置
              </button>
              <button type="button" className={`oa-segmented-btn ${detailTab === 'storage' ? 'active' : ''}`} onClick={() => setDetailTab('storage')}>
                持久化存储
              </button>
              <button type="button" className={`oa-segmented-btn ${detailTab === 'versions' ? 'active' : ''}`} onClick={() => setDetailTab('versions')}>
                版本历史 ({visibleVersions.length})
              </button>
              <button type="button" className={`oa-segmented-btn ${detailTab === 'logs' ? 'active' : ''}`} onClick={() => setDetailTab('logs')}>
                日志与 Dockerfile
              </button>
            </div>
          </div>

          {/* Tab 1: Artifacts & Skill */}
          {detailTab === 'artifacts' && (
            <AppDeliveryArtifacts
              api={api}
              contextId={contextId}
              slug={detailApp.slug}
              onVerified={() => {
                void openAppDetail(detailApp.slug, 'artifacts')
                void loadWorkspaceData(true)
              }}
            />
          )}

          {/* Tab 2: Configs */}
          {detailTab === 'configs' && (
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>在线运行配置</strong>
                  <div className="oa-hint">修改环境变量或平台托管资源绑定后，平台会安全重启应用容器使配置生效。</div>
                </div>
                {!readOnly && api.appUpdateConfig && (
                  <button type="button" className="oa-btn oa-btn-primary" disabled={detailBusy} onClick={() => void handleSaveDetailConfig()}>
                    {detailBusy ? '正在保存并重启…' : '保存配置并重启容器'}
                  </button>
                )}
              </div>

              <div className="oa-field" style={{ maxWidth: 260 }}>
                <label className="oa-label">容器监听端口</label>
                <input
                  className="oa-input oa-mono"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={readOnly}
                  value={editPort}
                  onChange={e => setEditPort(e.target.value)}
                />
              </div>

              <AppDeliveryConfig
                configs={editConfigs}
                originals={detailApp.app_config ?? []}
                resources={resources}
                onChange={next => {
                  if (!readOnly) setEditConfigs(next)
                }}
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
                {storageOverview && storageOverview.mounts_count > 0 && (
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
                  <div className="oa-grid-3">
                    <div className="oa-subcard">
                      <div className="oa-hint">挂载卷数量</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.mounts_count}</div>
                    </div>
                    <div className="oa-subcard">
                      <div className="oa-hint">存储文件总数</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.total_files}</div>
                    </div>
                    <div className="oa-subcard">
                      <div className="oa-hint">已占用空间</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{storageOverview.total_human}</div>
                    </div>
                  </div>

                  {storageOverview.mounts.length === 0 ? (
                    <div className="oa-hint">此应用未声明任何持久化存储挂载点。</div>
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
                            <button
                              type="button"
                              className="oa-btn oa-btn-xs"
                              onClick={() => void handleDownloadPlatformArtifact(detailApp.slug, { storage: true, mount: m.name }, `卷 ${m.name} 备份`)}
                            >
                              下载此卷备份
                            </button>
                          </div>
                          <div className="oa-hint">
                            大小：{m.size_human ?? formatFileSize(m.size_bytes)} · 文件数：{m.file_count ?? 0}
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
                <span className="oa-hint">支持下载任意版本镜像源码包、技能包或执行版本回滚</span>
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
                    <label className="oa-label">回滚原因说明（可选）</label>
                    <input
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

              {visibleVersions.length === 0 ? (
                <div className="oa-hint">暂无历史版本记录。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleVersions.map(ver => (
                    <div key={ver.id || ver.version} className="oa-subcard">
                      <div className="oa-subcard-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5, color: '#0f172a' }}>v{ver.version}</strong>
                          {ver.is_active && <span className="oa-pill oa-pill-ok">当前运行</span>}
                          {ver.status === 'failed' && <span className="oa-pill oa-pill-danger">失败版本（未上线）</span>}
                          {ver.status && ver.status !== 'failed' && !ver.is_active && <span className="oa-pill">{ver.status}</span>}
                          <span className="oa-hint">{formatDateTime(ver.created_at)}</span>
                          {ver.deployed_by && <span className="oa-hint">发布人：{ver.deployed_by}</span>}
                        </div>

                        {!readOnly && !ver.is_active && ver.status !== 'failed' && api.appRollback && (
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs oa-btn-accent-soft"
                            disabled={detailBusy}
                            onClick={() => {
                              setRollbackTarget(ver)
                              setRollbackReason('')
                            }}
                          >
                            回滚到此版本
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
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'app_tar' }, `v${ver.version} app.tar`)
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
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'skill_zip' }, `v${ver.version} skill.zip`)
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
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'dockerfile' }, `v${ver.version} Dockerfile`)
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
                              void handleDownloadPlatformArtifact(detailApp.slug, { version: ver.version, artifact: 'manifest' }, `v${ver.version} manifest`)
                            }
                          >
                            manifest.json
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
            <div className="oa-form-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
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
                    onClick={() =>
                      void copyText(
                        `detail-log-${detailLogsSubTab}`,
                        formatLogOutput(
                          detailLogsSubTab === 'runtime'
                            ? detailLogsData.runtime
                            : detailLogsSubTab === 'build'
                              ? detailLogsData.build
                              : detailLogsData.dockerfile,
                        ),
                      )
                    }
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

              <pre className="oa-log-terminal">
                {formatLogOutput(
                  detailLogsSubTab === 'runtime'
                    ? detailLogsData.runtime
                    : detailLogsSubTab === 'build'
                      ? detailLogsData.build
                      : detailLogsData.dockerfile,
                ) || '暂无内容'}
              </pre>
            </div>
          )}

          {/* Danger Zone: Delete App */}
          {!readOnly && api.appDelete && (
            <div className="oa-subcard" style={{ borderColor: '#fecaca', background: '#fff5f5' }}>
              <div className="oa-subcard-head" style={{ marginBottom: deleteBoxOpen ? 10 : 0 }}>
                <div>
                  <strong style={{ color: '#b91c1c', fontSize: 13.5 }}>危险操作：下线并删除应用</strong>
                  <div className="oa-hint" style={{ color: '#991b1b' }}>
                    将停止并移除平台上的应用容器、路由与已发布的同名技能。
                  </div>
                </div>
                {!deleteBoxOpen && (
                  <button type="button" className="oa-btn oa-btn-sm oa-btn-danger" onClick={() => setDeleteBoxOpen(true)}>
                    <AppIcon name="trash" size={13} />
                    <span>下线删除应用…</span>
                  </button>
                )}
              </div>

              {deleteBoxOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#991b1b' }}>
                    <input type="checkbox" checked={purgeVolumes} onChange={e => setPurgeVolumes(e.target.checked)} />
                    <span>同时彻底清理持久化数据卷内容（勾选后不可恢复）</span>
                  </label>
                  <div className="oa-field" style={{ maxWidth: 360 }}>
                    <label className="oa-label">请输入应用标识「{detailApp.slug}」以确认删除</label>
                    <input
                      className="oa-input oa-mono"
                      value={deleteConfirmText}
                      placeholder={detailApp.slug}
                      onChange={e => setDeleteConfirmText(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="oa-btn oa-btn-sm oa-btn-danger"
                      disabled={detailBusy || deleteConfirmText.trim() !== detailApp.slug}
                      onClick={() => void handleDeleteApp()}
                    >
                      {detailBusy ? '正在删除…' : '确认永久删除'}
                    </button>
                    <button
                      type="button"
                      className="oa-btn oa-btn-sm"
                      disabled={detailBusy}
                      onClick={() => {
                        setDeleteBoxOpen(false)
                        setDeleteConfirmText('')
                        setPurgeVolumes(false)
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="opc-apps-root">
      <style>{appsCss}</style>
      {viewMode === 'list' && renderAppListView()}
      {viewMode === 'wizard' && renderWizardView()}
      {viewMode === 'detail' && renderDetailView()}
    </div>
  )
}
