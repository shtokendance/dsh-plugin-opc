import React, { useEffect, useRef, useState } from 'react'
import type { OpcApi } from './api.ts'

interface JobConfig {
  key: string
  default: string
  secret: boolean
  required: boolean
  description: string
  source?: string
  has_original_value?: boolean
}
interface StorageMount {
  name?: string
  source_rel: string
  target: string
  kind?: string
  env_key?: string
  reason?: string
  seed?: boolean
}
interface DecisionItem {
  id: string
  question: string
  options: { id: string; label: string; description?: string; recommended?: boolean }[]
  default?: string
}
interface IssueItem {
  severity: string
  title: string
  detail: string
  file?: string
  resolution?: string
}
interface Job {
  id: string; name: string; slug: string; description?: string; containerPort?: number; url: string; status: string; events: string[]; error?: string
  artifactHash?: string; proposalHash?: string; version?: number; published?: boolean
  discoveryReport?: { framework?: string; language?: string; api_count?: number; page_count?: number; storage_count?: number }
  transformationReport?: { headline?: string; highlights?: string[]; verification_plan?: string[]; risk_notes?: string[] }
  decisions?: DecisionItem[]
  issues?: IssueItem[]
  proposal?: {
    summary: string
    unresolved: string[]
    decisions?: DecisionItem[]
    issues?: IssueItem[]
    changes: { path: string; reason: string; diff?: string }[]
    contract: {
      configs?: JobConfig[]
      storage_mounts?: StorageMount[]
      auth_profile?: { username_env?: string; password_env?: string }
      apis?: { id: string; purpose: string; method: string; path: string; auth?: { type?: string; env?: string } }[]
      pages?: { path: string; purpose: string }[]
    }
  }
}
interface CatalogApp {
  slug: string
  name: string
  description?: string
  container_port?: number
  app_url: string
  status: string
  current_version?: number
  can_manage: boolean
  skill_name?: string
}
interface StorageVolumeInfo {
  name?: string
  target: string
  source_rel?: string
  size_bytes?: number
  file_count?: number
  seed?: boolean
}
const deploymentStatus: Record<string, string> = { building: '构建中', running: '运行中', failed: '部署失败' }

const statusText: Record<string, string> = { importing: '导入中', draft: '等待分析', analyzing: 'AI 分析中', review: '等待核对方案', preparing: '正在打包', ready: '等待确认部署', publishing: '正在上传', building: '等待构建与验证', verifying: '正在验证业务', awaiting_page_verification: '待页面验收', verified: '技能可用', failed: '需要处理', unknown: '发布结果待核对' }
const active = new Set(['importing', 'analyzing', 'preparing', 'publishing', 'verifying'])
const ROLLBACK_NOTICE = '回滚恢复代码与运行配置，不自动回退数据库/卷中的业务数据；旧代码和新数据兼容性仍需验证。'

function isLoopbackConnection(key: string, value: string): boolean {
  const connectionKey = /(DATABASE|REDIS|MYSQL|POSTGRES|PG|MONGO|URL|URI|HOST|ENDPOINT|ADDR|PORT|DSN|BROKER|SERVER)/i.test(key)
  if (!connectionKey) return false
  return /(^|\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(value.trim())
}

function cleanEventText(text: string): string {
  if (!text) return ''
  return text
    .replace(/([:\s])(?:[^\s/]*[^\x00-\x7f\u4e00-\u9fa5\s/]+[^\s/]*(?:\/|\s))+/g, '$1')
    .replace(/([:\s])([^/:\s]+(?=\/(?:src|bff|app|lib|config|packages|server|client|api|doc|Dockerfile|package\.json)))/gi, '$1')
    .replace(/:\s+\//g, ': ')
}

export function AppsPanel({ api, sessionId, contextId, refreshSignal }: { api: OpcApi; sessionId: string; contextId: string; refreshSignal?: number }) {
  const [catalog, setCatalog] = useState<CatalogApp[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [jobs, setJobs] = useState<Job[]>([]), [selected, setSelected] = useState(''), [adding, setAdding] = useState(false), [upgrading, setUpgrading] = useState(false)
  const [name, setName] = useState(''), [slug, setSlug] = useState(''), [description, setDescription] = useState(''), [containerPort, setContainerPort] = useState(''), [source, setSource] = useState(''), [file, setFile] = useState<File>()
  const [feedback, setFeedback] = useState(''), [configs, setConfigs] = useState<Record<string, string>>({})
  const [localConfirmed, setLocalConfirmed] = useState<Record<string, boolean>>({})
  const [versionNote, setVersionNote] = useState('')
  const [probeCredentials, setProbeCredentials] = useState<Record<string, string>>({})
  const [resources, setResources] = useState<{ id: string; name: string; env_keys: string[] }[]>([])
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [logs, setLogs] = useState(''), [confirm, setConfirm] = useState(false)
  const [managingSlug, setManagingSlug] = useState(''), [versionList, setVersionList] = useState<{ version: number; status: string; version_note?: string }[]>([])
  const [storageVolumes, setStorageVolumes] = useState<StorageVolumeInfo[] | null>(null)
  const [purgeVolumes, setPurgeVolumes] = useState(false)
  const [editingConfigSlug, setEditingConfigSlug] = useState(''), [configDraftRows, setConfigDraftRows] = useState<{ key: string; value: string }[]>([])
  const [notice, setNotice] = useState('')
  const live = useRef(true)
  const [deployment, setDeployment] = useState<{ status: string; current_version: number; build_log?: string; error_message?: string }>()
  const job = jobs.find(j => j.id === selected)
  const eventsScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (eventsScrollRef.current) {
      eventsScrollRef.current.scrollTop = eventsScrollRef.current.scrollHeight
    }
  }, [job?.events?.length, job?.status])
  const currentStep = adding ? 1 : !job ? 0 : ['draft', 'analyzing', 'review'].includes(job.status) ? 2 : job.status === 'ready' ? 3 : 4

  async function load() {
    const value = JSON.parse(await api.appList(contextId))
    if (live.current) setJobs(value)
  }
  async function loadCatalog() {
    try {
      const result = JSON.parse(await api.appCatalog(contextId))
      if (live.current) { setCatalog(result.apps ?? []); setCatalogError('') }
    } catch (error) {
      if (live.current) { setCatalog([]); setCatalogError(error instanceof Error ? error.message : String(error)) }
    }
  }
  useEffect(() => {
    live.current = true
    void load().catch(e => setError(String(e)))
    void loadCatalog()
    const timer = setInterval(() => { void load().catch(e => { if (live.current) setError(String(e)) }) }, 3000)
    const catalogTimer = setInterval(() => void loadCatalog(), 15_000)
    return () => { live.current = false; clearInterval(timer); clearInterval(catalogTimer) }
  }, [contextId])
  useEffect(() => {
    if (refreshSignal) {
      void load().catch(e => setError(String(e)))
      void loadCatalog()
    }
  }, [refreshSignal])
  useEffect(() => {
    let current = true
    if (job?.status === 'ready') void api.appResources(contextId).then(value => {
      if (current) setResources(JSON.parse(value).resources ?? [])
    }, e => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [job?.id, job?.status, contextId, api])
  useEffect(() => {
    setBindings({})
    setConfigs(Object.fromEntries((job?.proposal?.contract?.configs ?? []).map(c => [c.key, c.secret ? '' : c.default ?? ''])))
    setLocalConfirmed({})
    setVersionNote('')
    setProbeCredentials({})
    setConfirm(false)
    setLogs('')
    setFeedback('')
  }, [selected, job?.artifactHash])
  useEffect(() => {
    setDeployment(undefined)
    if (!job || !['building', 'unknown', 'awaiting_page_verification', 'failed', 'verified'].includes(job.status) || (!job.published && job.status !== 'unknown')) return
    let current = true
    let pending = false
    const fetchStatus = async () => {
      if (pending) return
      pending = true
      try {
        const result = JSON.parse(await api.appDetails(job.slug, contextId))
        if (current) setDeployment(result)
      } catch { /* Manual verification shows the actionable server error. */ }
      finally { pending = false }
    }
    void fetchStatus()
    const timer = setInterval(() => void fetchStatus(), 3000)
    return () => { current = false; clearInterval(timer) }
  }, [job?.id, job?.status, job?.published, contextId, api])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn(); await load() } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (live.current) setBusy(false) }
  }
  const disabled = busy || !!job && active.has(job.status)
  const decisions = job?.decisions ?? job?.proposal?.decisions ?? []
  const issues = job?.issues ?? job?.proposal?.issues ?? []
  const storageMounts = job?.proposal?.contract?.storage_mounts ?? []
  const requiredAuthKeys = Array.from(new Set([
    ...(job?.proposal?.contract?.apis ?? []).map(a => a.auth?.env).filter((k): k is string => !!k),
    job?.proposal?.contract?.auth_profile?.username_env,
    job?.proposal?.contract?.auth_profile?.password_env,
  ].filter((k): k is string => !!k)))

  return <div className="opc-apps">
    <p className="apps-intro">把已有应用部署到 OPC，并让 AI 通过应用技能使用真实业务接口。</p>
    <div className="row" style={{ marginBottom: 16 }}>
      <button className="primary" onClick={() => { setAdding(true); setUpgrading(false); setName(''); setSlug(''); setDescription(''); setContainerPort(''); setSelected('') }}>部署新应用</button>
      <button onClick={() => void run(loadCatalog)}>刷新应用</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {(adding || !!job) && (
      <div className="wizard-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
            <button className="btn-back" type="button" onClick={() => { setSelected(''); setAdding(false); setUpgrading(false) }}>
              ← 返回应用列表
            </button>
            <span style={{ fontSize: 15, fontWeight: 650, color: '#0f172a' }}>
              {upgrading ? `升级应用 · ${name || slug}` : job ? `部署应用 · ${job.name}` : '新建并部署应用'}
            </span>
            {job && (
              <span className={`badge ${active.has(job.status) ? 'badge-warn' : job.status === 'failed' ? 'badge-danger' : job.status === 'ready' || job.status === 'verified' ? 'badge-ok' : ''}`}>
                {active.has(job.status) && <span className="status-dot dot-warn" />}
                {statusText[job.status] ?? job.status}
              </span>
            )}
          </div>
          {job?.url && (
            <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{job.url}</span>
          )}
        </div>

        {/* 4-Step Indicator Tabs */}
        <div className="stepper-grid">
          {[
            { s: 1, title: '1. 选择应用' },
            { s: 2, title: '2. 与 AI 改造应用' },
            { s: 3, title: '3. 核对部署内容' },
            { s: 4, title: '4. 部署与使用' },
          ].map(({ s, title }) => {
            const isCurrent = currentStep === s
            const isCompleted = currentStep > s
            return (
              <div key={s} className={`stepper-step ${isCurrent ? 'active' : isCompleted ? 'completed' : 'pending'}`}>
                {isCompleted ? `✓ ${title.slice(3)}` : title}
              </div>
            )
          })}
        </div>
      </div>
    )}

    {adding && (
      <div className="wizard-section-card">
        <form onSubmit={e => { e.preventDefault(); void run(async () => {
          let zip: string | undefined
          if (file) {
            if (file.size > 64 * 1024 * 1024) throw new Error('请选择小于 64 MiB 的 ZIP 文件')
            zip = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
          }
          const parsedPort = containerPort.trim() ? Number(containerPort.trim()) : undefined
          const created = JSON.parse(await api.appCreate(JSON.stringify({
            name,
            slug,
            description: description.trim() || undefined,
            container_port: parsedPort && Number.isInteger(parsedPort) ? parsedPort : undefined,
            source,
            zip,
            upgrade: upgrading || undefined,
          }), sessionId, contextId))
          setSelected(created.id); setAdding(false); setUpgrading(false)
        }) }}>
          <h3 className="wizard-section-title">{upgrading ? `升级已有应用 (${slug})` : '第一步：选择要部署的应用'}</h3>
          <label>应用名称<input required value={name} onChange={e => setName(e.target.value)} placeholder="例如：订单查询助手" /></label>
          <label>英文标识<input required disabled={upgrading} pattern="[a-z][a-z0-9-]{2,39}" value={slug} onChange={e => setSlug(e.target.value)} placeholder="例如：order-helper" /></label>
          <label>应用简介（可选）<input value={description} onChange={e => setDescription(e.target.value)} placeholder="简要说明应用业务用途" /></label>
          <label>容器监听端口（可选，留空由 AI 自动识别）<input type="number" min={1} max={65535} value={containerPort} onChange={e => setContainerPort(e.target.value)} placeholder="例如：8080" /></label>
          <label>源码 ZIP<input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0])}/></label>
          <label>或本机源码文件夹<input disabled={!!file} value={source} onChange={e => setSource(e.target.value)} placeholder="/Users/你的名字/Projects/my-app" /></label>
          <div className="notice" style={{ margin: '14px 0' }}>系统将在隔离副本中进行分析改造，原项目不受影响；本地扫描依赖本机 Python 3.9+ 环境。</div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" disabled={busy || (!file && !source)}>导入源码并开始分析</button>
            <button type="button" onClick={() => { setAdding(false); setUpgrading(false) }}>取消</button>
          </div>
        </form>
      </div>
    )}

    {!adding && !job && <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 10px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 650, margin: 0, color: '#0f172a' }}>已发布应用</h3>
        <span style={{ fontSize: 12, color: '#64748b' }}>共 {catalog.length} 个应用</span>
      </div>
      {catalogError ? <p role="alert" className="error">{catalogError}</p> : catalog.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
          <p style={{ fontSize: 14, margin: '0 0 6px' }}>暂无已发布应用</p>
          <p style={{ fontSize: 12 }}>点击上方「部署新应用」导入单应用源码并由 AI 进行分析改造</p>
        </div>
      )}
      <div className="cards-grid">
        {catalog.map(app => {
          const isRunning = app.status === 'running'
          const isFailed = app.status === 'failed'
          return (
            <div key={app.slug} className="resource-card">
              <div>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div className="card-icon" style={{ fontSize: 16 }}>🚀</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <h4 className="card-title" style={{ margin: 0 }}>{app.name}</h4>
                        <span className="badge" style={{ fontSize: 10, padding: '1px 5px' }}>v{app.current_version || 1}</span>
                      </div>
                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{app.slug}</span>
                    </div>
                  </div>
                  <div>
                    {isRunning ? (
                      <span className="badge badge-ok">
                        <span className="status-dot dot-ok" /> 运行中
                      </span>
                    ) : isFailed ? (
                      <span className="badge badge-danger">
                        <span className="status-dot dot-danger" /> 部署失败
                      </span>
                    ) : (
                      <span className="badge badge-warn">
                        <span className="status-dot dot-warn" /> {deploymentStatus[app.status] ?? app.status}
                      </span>
                    )}
                  </div>
                </div>

                <p className="card-desc">{app.description || '暂无应用业务描述'}</p>

                <div className="app-meta-box">
                  <div className="app-meta-row">
                    <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>🌐 内网地址</span>
                    {app.app_url ? (
                      <a href={app.app_url} target="_blank" rel="noreferrer" style={{ color: '#245c9f', textDecoration: 'none', fontFamily: 'monospace', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={app.app_url}>
                        {app.app_url}
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>-</span>
                    )}
                  </div>
                  {app.can_manage !== false && (
                    <div className="app-meta-row">
                      <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>⚡ 本地技能</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, color: '#334155' }}>
                        {app.skill_name || `app-${app.slug}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="card-actions" style={{ justifyContent: 'space-between' }}>
                  {isFailed ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {api.appLogs && (
                        <button disabled={busy} onClick={() => void run(async () => {
                          const res = JSON.parse(await api.appLogs!(app.slug, contextId))
                          setLogs(res.runtime_logs || '暂无运行日志')
                          setManagingSlug(app.slug)
                        })}>失败日志</button>
                      )}
                      {api.appRecheck && (
                        <button className="primary" disabled={busy} onClick={() => void run(async () => {
                          await api.appRecheck!(app.slug, contextId)
                          await loadCatalog()
                        })}>重新检查</button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/^https?:\/\//i.test(app.app_url) && (
                        <a href={app.app_url} target="_blank" rel="noreferrer" className="btn-link">打开应用</a>
                      )}
                      {app.can_manage && api.appVersions && (
                        <button disabled={busy} onClick={() => {
                          setName(app.name)
                          setSlug(app.slug)
                          setDescription(app.description ?? '')
                          setContainerPort(app.container_port ? String(app.container_port) : '')
                          setUpgrading(true)
                          setAdding(true)
                        }}>升级应用</button>
                      )}
                    </div>
                  )}

                  {app.can_manage && api.appVersions && (
                    <button disabled={busy} onClick={() => void run(async () => {
                      if (managingSlug === app.slug) {
                        setManagingSlug('')
                        setStorageVolumes(null)
                        setEditingConfigSlug('')
                        return
                      }
                      const res = JSON.parse(await api.appVersions!(app.slug, contextId))
                      setVersionList(res.versions ?? [])
                      setManagingSlug(app.slug)
                      setStorageVolumes(null)
                      setPurgeVolumes(false)
                    })}>{managingSlug === app.slug ? '收起管理' : '管理与回退'}</button>
                  )}
                </div>

                {app.can_manage && managingSlug === app.slug && (
                  <div className="app-drawer">
                    <div className="row" style={{ marginTop: 0 }}>
                      {api.appRecheck && (
                        <button disabled={busy} onClick={() => void run(async () => {
                          await api.appRecheck!(app.slug, contextId)
                          await loadCatalog()
                        })}>健康重检</button>
                      )}
                      {api.appLogs && (
                        <button disabled={busy} onClick={() => void run(async () => {
                          const res = JSON.parse(await api.appLogs!(app.slug, contextId))
                          setLogs(res.runtime_logs || '暂无运行日志')
                        })}>运行日志</button>
                      )}
                      {api.appStorage && (
                        <button disabled={busy} onClick={() => void run(async () => {
                          const res = JSON.parse(await api.appStorage!(app.slug, contextId))
                          setStorageVolumes(res.volumes ?? res.storage_mounts ?? [])
                        })}>持久化存储卷</button>
                      )}
                      {api.appUpdateConfig && (
                        <button disabled={busy} onClick={() => {
                          if (editingConfigSlug === app.slug) { setEditingConfigSlug(''); return }
                          setEditingConfigSlug(app.slug)
                          setConfigDraftRows([{ key: '', value: '' }])
                        }}>{editingConfigSlug === app.slug ? '取消配置更新' : '更新运行配置'}</button>
                      )}
                    </div>

                    {editingConfigSlug === app.slug && api.appUpdateConfig && (
                      <div style={{ marginTop: 10, padding: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8, color: '#334155' }}>在线更新运行配置（更新后自动重启容器，需重新验证业务）</div>
                        {configDraftRows.map((row, idx) => (
                          <div key={idx} className="row">
                            <input placeholder="环境变量名（如 API_KEY）" value={row.key} onChange={e => {
                              const next = [...configDraftRows]; next[idx] = { ...row, key: e.target.value }; setConfigDraftRows(next)
                            }} />
                            <input placeholder="配置值" value={row.value} onChange={e => {
                              const next = [...configDraftRows]; next[idx] = { ...row, value: e.target.value }; setConfigDraftRows(next)
                            }} />
                          </div>
                        ))}
                        <div className="row">
                          <button type="button" onClick={() => setConfigDraftRows([...configDraftRows, { key: '', value: '' }])}>+ 添加配置项</button>
                          <button className="primary" disabled={busy} onClick={() => void run(async () => {
                            const app_config = configDraftRows.filter(r => r.key.trim()).map(r => ({ key: r.key.trim(), value: r.value }))
                            await api.appUpdateConfig!(app.slug, JSON.stringify({ app_config, resource_ids: [] }), contextId)
                            setEditingConfigSlug('')
                            setNotice('运行配置已更新，请重新执行业务验证以启用技能。')
                            await loadCatalog()
                          })}>保存并重启应用</button>
                        </div>
                      </div>
                    )}

                    {storageVolumes && (
                      <div style={{ marginTop: 10, padding: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6, color: '#334155' }}>挂载卷状态</div>
                        {storageVolumes.length === 0 ? <p style={{ margin: 0, color: '#64748b' }}><small>未配置持久化挂载卷。</small></p> : (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {storageVolumes.map((vol, i) => (
                              <li key={i}>
                                <code>{vol.target}</code>{vol.source_rel ? ` ← ${vol.source_rel}` : ''}{typeof vol.file_count === 'number' ? ` · ${vol.file_count} 个文件` : ''}{typeof vol.size_bytes === 'number' ? ` (${vol.size_bytes} B)` : ''}{vol.seed ? ' · 含初始种子数据保护' : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <p style={{ margin: '4px 0 8px', color: '#64748b', fontSize: 11 }}>{ROLLBACK_NOTICE}</p>
                      {versionList.map(v => (
                        <div key={v.version} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #e2e8f0' }}>
                          <span><strong>v{v.version}</strong> ({v.status}){v.version_note ? ` · ${v.version_note}` : ''}</span>
                          {api.appRollback && v.version !== app.current_version && (
                            v.status === 'running' ? (
                              <button disabled={busy} onClick={() => void run(async () => {
                                const rb = JSON.parse(await api.appRollback!(app.slug, JSON.stringify({ targetVersion: v.version, reason: `回退至 v${v.version}` }), contextId))
                                setNotice(`${rb.message || `已回退至 v${v.version}`}（${rb.rollback_notice || ROLLBACK_NOTICE}）`)
                                await loadCatalog()
                              })}>回退到此版本</button>
                            ) : <small style={{ color: '#94a3b8' }}>部署未成功 · 不可回退</small>
                          )}
                        </div>
                      ))}
                    </div>

                    {api.appDelete && (
                      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
                        <label className="row" style={{ margin: 0, fontSize: 12 }}>
                          <input style={{ flex: 'none' }} type="checkbox" checked={purgeVolumes} onChange={e => setPurgeVolumes(e.target.checked)} />
                          同时清理持久化数据卷
                        </label>
                        <button style={{ color: '#dc2626', borderColor: '#fca5a5' }} disabled={busy} onClick={() => void run(async () => {
                          await api.appDelete!(app.slug, purgeVolumes, contextId)
                          setManagingSlug('')
                          await loadCatalog()
                        })}>删除应用</button>
                      </div>
                    )}

                    {logs && <pre style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', background: '#0f172a', color: '#f8fafc', padding: 8, borderRadius: 6, fontSize: 11 }}>{logs}</pre>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {jobs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 10px', color: '#0f172a' }}>本机部署任务</h3>
          <div className="cards-grid">
            {jobs.map(item => (
              <div key={item.id} className="resource-card" style={{ cursor: 'pointer' }} onClick={() => setSelected(item.id)}>
                <div className="card-header">
                  <h4 className="card-title" style={{ margin: 0 }}>{item.name}</h4>
                  <span className="badge">{statusText[item.status] ?? item.status}</span>
                </div>
                <div className="card-actions" style={{ marginTop: 8 }}>
                  <button className="primary" style={{ fontSize: 12 }} onClick={() => setSelected(item.id)}>继续任务向导 →</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>}

    {!adding && job && <>
      {job.error && <p className="error">{job.error}</p>}

      {/* AI Execution Step Timeline Card */}
      {(job.events.length > 0 || active.has(job.status)) && (
        <div className="ai-progress-card">
          <div className="ai-progress-header">
            <div className="ai-progress-title">
              {active.has(job.status) ? (
                <span className="pulse-indicator">
                  <span className="pulse-dot-ping" />
                  <span className="pulse-dot" />
                </span>
              ) : job.error ? (
                <span className="status-dot dot-danger" />
              ) : (
                <span className="status-dot dot-ok" />
              )}
              <span>
                {job.status === 'analyzing'
                  ? 'AI 正在深入分析与改造应用…'
                  : job.status === 'building'
                  ? '容器正在构建与部署…'
                  : job.status === 'verifying'
                  ? '正在执行业务探针验证…'
                  : job.error
                  ? 'AI 改造处理过程中断'
                  : 'AI 改造处理过程记录'}
              </span>
            </div>
            <span className="ai-progress-counter">
              {active.has(job.status)
                ? `正在执行第 ${job.events.length || 1} 步`
                : `共完成 ${job.events.length} 个步骤`}
            </span>
          </div>

          <div className="events-timeline" ref={eventsScrollRef}>
            {job.events.length === 0 && active.has(job.status) && (
              <div className="event-item current">
                <span className="event-step-badge">⏳</span>
                <span className="event-text">正在启动 AI 改造引擎与代码扫描沙箱…</span>
              </div>
            )}
            {job.events.map((ev, idx) => {
              const isLatest = idx === job.events.length - 1
              const isRunningStep = active.has(job.status) && isLatest
              const isFailedStep = !active.has(job.status) && !!job.error && isLatest
              return (
                <div key={idx} className={`event-item ${isRunningStep ? 'current' : isFailedStep ? 'failed' : 'done'}`}>
                  <span className="event-step-badge">{isRunningStep ? '▶' : isFailedStep ? '✕' : '✓'}</span>
                  <span className="event-text">{cleanEventText(ev)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* STEP 2: 与 AI 改造应用 */}
      {currentStep === 2 && (
        <div className="wizard-section-card">
          <h3 className="wizard-section-title">第二步：AI 分析与改造方案</h3>
          {job.status === 'analyzing' && (
            <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
              <span className="pulse-indicator"><span className="pulse-dot-ping"/><span className="pulse-dot"/></span>
              <span>AI 正在深入扫描源码目录、识别业务 API 并规划改造方案。分析完全在独立隔离副本中执行，原项目保持只读不受影响。请稍候…</span>
            </div>
          )}

          {job.discoveryReport && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', margin: '10px 0' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 4 }}>代码扫描结果</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                语言架构：<strong>{job.discoveryReport.language || '未知语言'}</strong>{job.discoveryReport.framework ? ` / ${job.discoveryReport.framework}` : ''} · API 接口：<strong>{job.discoveryReport.api_count ?? 0}</strong> 个 · 前端页面：<strong>{job.discoveryReport.page_count ?? 0}</strong> 个 · 存储目录：<strong>{job.discoveryReport.storage_count ?? 0}</strong> 处
              </div>
            </div>
          )}

          {job.proposal?.summary && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 14px', margin: '12px 0', fontSize: 13, color: '#1e3a8a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {job.proposal.summary}
            </div>
          )}

          {job.transformationReport?.highlights?.length ? (
            <details style={{ margin: '10px 0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
                改造与验证要点（{job.transformationReport.highlights.length}）
              </summary>
              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                {job.transformationReport.highlights.map((h, i) => <li key={i} style={{ margin: '4px 0', fontSize: 12, color: '#475569' }}>{h}</li>)}
              </ul>
            </details>
          ) : null}

          {!!issues.length && (
            <details style={{ margin: '10px 0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#b91c1c' }}>
                发现的问题与处理（{issues.length}）
              </summary>
              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                {issues.map((item, i) => (
                  <li key={i} style={{ margin: '4px 0', fontSize: 12 }}>
                    <strong>[{item.severity}] {item.title}</strong>：{item.detail}{item.resolution ? `（处理：${item.resolution}）` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!!decisions.length && (
            <div className="notice" style={{ margin: '12px 0' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>请确认改造选项</div>
              {decisions.map(d => (
                <div key={d.id} style={{ marginTop: 8 }}>
                  <p style={{ margin: '4px 0', fontWeight: 500 }}>{d.question}</p>
                  <div className="row" style={{ marginTop: 4 }}>
                    {d.options.map(opt => (
                      <button key={opt.id} type="button" disabled={disabled} onClick={() => {
                        const line = `关于「${d.question}」：选择「${opt.label}」`
                        setFeedback(prev => prev.trim() ? `${prev.trim()}
${line}` : line)
                      }}>
                        {opt.label}{opt.recommended ? '（推荐）' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!!job.proposal?.unresolved?.length && (
            <div className="notice" style={{ background: '#fffbeb', borderColor: '#f59e0b', color: '#92400e', margin: '12px 0' }}>
              <strong>需要补充的信息</strong>
              <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                {job.proposal.unresolved.map((q, i) => (
                  <li key={i}>{typeof q === 'string' ? q : JSON.stringify(q)}</li>
                ))}
              </ul>
            </div>
          )}

          {!!job.proposal?.changes?.length && (
            <details style={{ margin: '12px 0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#334155' }}>
                查看拟修改的文件（{job.proposal.changes.length}）
              </summary>
              <div style={{ marginTop: 8 }}>
                {job.proposal.changes.map(c => (
                  <div key={c.path} style={{ marginBottom: 10, padding: 8, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <p style={{ margin: '0 0 4px', fontSize: 12 }}><strong>{c.path}</strong>：{c.reason}</p>
                    {c.diff && <pre style={{ fontSize: 11, maxHeight: 160, overflow: 'auto', background: '#0f172a', color: '#f8fafc', padding: 8, borderRadius: 4 }}>{c.diff}</pre>}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={{ fontWeight: 600, fontSize: 13, color: '#334155', display: 'block', marginBottom: 6 }}>
              补充改造要求或与 AI 对话
            </label>
            <textarea
              aria-label="补充改造要求"
              value={feedback}
              disabled={disabled}
              onChange={e => setFeedback(e.target.value)}
              placeholder="可以告诉 AI 应用用途，或回答上面的待确认问题..."
              style={{ width: '100%', minHeight: 70 }}
            />
            <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <button disabled={disabled} onClick={() => void run(async () => { await api.appAnalyze(job.id, feedback, sessionId, contextId) })}>
                {job.proposal ? '补充说明并重新分析' : '开始 AI 分析'}
              </button>
              {job.status === 'review' && !job.proposal?.unresolved?.length && (
                <button className="primary" disabled={disabled} onClick={() => void run(async () => { await api.appPrepare(job.id, job.proposalHash!, contextId) })}>
                  确认改造方案，生成部署包 →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: 核对部署内容 */}
      {currentStep === 3 && (
        <div className="wizard-section-card">
          <h3 className="wizard-section-title">第三步：核对部署配置与存储</h3>
          <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 14px' }}>
            服务器将构建并运行这个应用。下面的配置仅供应用运行，不会暴露给模型。
          </p>

          {(job.proposal?.contract.configs ?? []).map(c => {
            const val = bindings[c.key] ? '' : configs[c.key] ?? ''
            const loopback = !bindings[c.key] && isLoopbackConnection(c.key, val)
            return (
              <div key={c.key} style={{ marginBottom: 12, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <label style={{ margin: 0, fontWeight: 500 }}>
                  {c.description || c.key} {c.required ? (c.has_original_value ? '（必填 · 已从原项目提取默认值）' : '（必填）') : ''}
                  <input
                    type={c.secret ? 'password' : 'text'}
                    autoComplete="off"
                    disabled={!!bindings[c.key]}
                    placeholder={c.has_original_value ? '已保留原配置值（留空沿用原值）' : undefined}
                    value={val}
                    onChange={e => { setConfigs({ ...configs, [c.key]: e.target.value }); setConfirm(false) }}
                    style={{ marginTop: 6 }}
                  />
                  {resources.some(r => r.env_keys.includes(c.key)) && (
                    <select aria-label={`${c.key} 的配置来源`} value={bindings[c.key] ?? ''} onChange={e => { setBindings({ ...bindings, [c.key]: e.target.value }); setConfirm(false) }} style={{ marginTop: 6, width: '100%' }}>
                      <option value="">手动填写</option>
                      {resources.filter(r => r.env_keys.includes(c.key)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </label>
                {loopback && (
                  <label className="row" style={{ marginTop: 6, fontSize: 12, color: '#d97706' }}>
                    <input style={{ flex: 'none' }} type="checkbox" checked={!!localConfirmed[c.key]} onChange={e => { setLocalConfirmed({ ...localConfirmed, [c.key]: e.target.checked }); setConfirm(false) }} />
                    <span>检测到 {c.key} 指向本机地址（{val}）。只有该服务确实和应用部署在同一容器网络内时才勾选。</span>
                  </label>
                )}
              </div>
            )
          })}

          {storageMounts.length > 0 && (
            <div style={{ margin: '14px 0', padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>持久化存储卷挂载（{storageMounts.length}）</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {storageMounts.map((m, i) => (
                  <li key={i} style={{ margin: '4px 0' }}>
                    <code>{m.source_rel}</code> → 容器 <code>{m.target}</code>{m.env_key ? `（环境变量 ${m.env_key}）` : ''}{m.seed !== false ? ' · 自动保留初始种子数据' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 500, fontSize: 13, display: 'block', marginBottom: 4 }}>
              版本备注（可选）
            </label>
            <input
              value={versionNote}
              onChange={e => setVersionNote(e.target.value)}
              placeholder="例如：新增订单导出接口并挂载数据卷"
            />
          </div>

          <details style={{ margin: '12px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#245c9f' }}>
              查看部署后 AI 可使用的业务技能接口（{((job.proposal?.contract.apis?.length ?? 0) + (job.proposal?.contract.pages?.length ?? 0))}）
            </summary>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
              {job.proposal?.contract.apis?.map(a => <p key={a.id} style={{ margin: '3px 0' }}>• 接口：{a.purpose} · <code>{a.method} {a.path}</code></p>)}
              {job.proposal?.contract.pages?.map(p => <p key={p.path} style={{ margin: '3px 0' }}>• 页面：{p.purpose} · <code>{p.path}</code></p>)}
            </div>
          </details>

          <label className="row" style={{ marginTop: 14, fontSize: 12 }}>
            <input style={{ flex: 'none' }} type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>
            <span>我已核对上述应用配置与存储卷挂载，确认发布到 OPC</span>
          </label>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={disabled || !confirm} onClick={() => void run(async () => {
              await api.appPublish(job.id, JSON.stringify({
                artifactHash: job.artifactHash,
                version_note: versionNote.trim() || undefined,
                config: Object.entries(configs).map(([key, value]) => ({
                  key,
                  value: bindings[key] ? '' : value,
                  resource_id: bindings[key] || undefined,
                  local_connection_confirmed: localConfirmed[key] || undefined,
                })),
              }), contextId)
              setConfigs({}); setConfirm(false); await loadCatalog()
            })}>确认发布到 OPC</button>
            {api.appReopenReview && (
              <button type="button" disabled={disabled} onClick={() => void run(async () => { await api.appReopenReview!(job.id, contextId) })}>
                返回调整方案
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 4: 部署验证与使用 */}
      {currentStep === 4 && (
        <div className="wizard-section-card">
          <h3 className="wizard-section-title">第四步：部署验证与使用</h3>
          {deployment && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', margin: '10px 0', fontSize: 12 }}>
              服务器状态：<strong>{deployment.status === 'running' ? '● 已启动并运行' : deployment.status === 'failed' ? '● 部署失败' : '● 正在构建中'}</strong> · 版本：<strong>v{deployment.current_version}</strong>
            </div>
          )}
          {deployment?.error_message && <p className="error">{deployment.error_message}</p>}

          {requiredAuthKeys.length > 0 && job.status !== 'verified' && (
            <details open={job.status === 'failed'} style={{ margin: '10px 0' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>验证凭据（可选，用于受保护接口探针或更新存储凭据）</summary>
              <div style={{ marginTop: 6 }}>
                {requiredAuthKeys.map(k => (
                  <label key={k} style={{ fontSize: 12, display: 'block', margin: '6px 0' }}>
                    {k}
                    <input type="password" autoComplete="off" value={probeCredentials[k] ?? ''} onChange={e => setProbeCredentials({ ...probeCredentials, [k]: e.target.value })} placeholder="留空则使用部署时保存的凭据" style={{ marginTop: 4 }} />
                  </label>
                ))}
              </div>
            </details>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={disabled} onClick={() => void run(async () => {
              const nonEmptyCreds = Object.fromEntries(Object.entries(probeCredentials).filter(([, v]) => v.trim() !== ''))
              if (Object.keys(nonEmptyCreds).length > 0 && api.appVerifyWithOptions) {
                await api.appVerifyWithOptions(job.id, JSON.stringify({ credentials: nonEmptyCreds }), contextId)
              } else {
                await api.appVerify(job.id, contextId)
              }
            })}>检查部署并验证业务</button>
            {api.appRecheck && <button disabled={busy} onClick={() => void run(async () => { await api.appRecheck!(job.slug, contextId) })}>健康重检</button>}
            <button disabled={busy} onClick={() => void run(async () => { const remote = JSON.parse(await api.appDetails(job.slug, contextId)); setLogs(remote.build_log || remote.error_message || '暂无日志') })}>查看构建日志</button>
            {api.appLogs && <button disabled={busy} onClick={() => void run(async () => { const remote = JSON.parse(await api.appLogs!(job.slug, contextId)); setLogs(remote.runtime_logs || '暂无运行日志') })}>查看运行日志</button>}
            {(job.status === 'failed' || deployment?.status === 'failed') && (
              <button style={{ color: '#dc2626', borderColor: '#fca5a5' }} disabled={disabled} onClick={() => void run(async () => {
                const diagParts = [
                  '部署或业务验证失败，请根据错误原因、构建日志和运行日志诊断问题并修复改造方案：',
                  job.error ? `错误摘要：${job.error}` : '',
                  deployment?.error_message ? `平台错误：${deployment.error_message}` : '',
                  feedback.trim() ? `补充说明：${feedback.trim()}` : '',
                ].filter(Boolean)
                await api.appAnalyze(job.id, diagParts.join('\n'), sessionId, contextId)
              })}>AI 诊断并修复失败</button>
            )}
          </div>

          {job.status === 'awaiting_page_verification' && (
            <div className="notice" style={{ marginTop: 14 }}>
              <p style={{ margin: '0 0 8px' }}>容器已启动并通过健康身份校验。纯页面应用请先打开页面完成人工验收，确认正常渲染后启用技能：</p>
              <div className="row">
                <a href={job.url} target="_blank" rel="noreferrer" className="btn-link">打开应用页面</a>
                <button className="primary" disabled={disabled} onClick={() => void run(async () => {
                  if (api.appVerifyWithOptions) await api.appVerifyWithOptions(job.id, JSON.stringify({ confirmPageVerification: true }), contextId)
                  else await api.appVerify(job.id, contextId)
                })}>已完成页面验收，启用技能</button>
              </div>
            </div>
          )}

          {job.status === 'verified' && (!deployment || (deployment.status === 'running' && deployment.current_version === job.version)) && (
            <div className="notice" style={{ background: '#ecfdf5', borderColor: '#10b981', color: '#065f46', marginTop: 14 }}>
              <strong>✓ 应用只读业务验证已通过，技能已成功就绪！</strong>
              <p style={{ margin: '6px 0 0' }}>回到对话框输入 <strong>/app-{job.slug}</strong> 即可唤起专属应用技能，让 AI 调用业务接口。页面操作尚未验证。<a href={job.url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: '#047857', fontWeight: 600 }}>打开应用页面 →</a></p>
            </div>
          )}

          {logs && (
            <pre style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', background: '#0f172a', color: '#f8fafc', padding: 10, borderRadius: 6, fontSize: 11 }}>
              {logs}
            </pre>
          )}
        </div>
      )}
    </>}
    <style>{`.opc-apps label{display:block;margin:12px 0}.opc-apps label input:not([type=checkbox]){box-sizing:border-box;display:block;width:100%;margin:5px 0}.opc-apps textarea{box-sizing:border-box;width:100%;min-height:90px;margin:10px 0}.opc-apps button{margin:4px 0}.opc-apps a{color:#245c9f}`}</style>
  </div>
}
