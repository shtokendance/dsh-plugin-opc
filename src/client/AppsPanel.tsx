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

export function AppsPanel({ api, sessionId, contextId }: { api: OpcApi; sessionId: string; contextId: string }) {
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
    <p>把已有应用部署到 OPC，并让 AI 通过应用技能使用真实业务接口。</p>
    <div className="row"><button className="primary" onClick={() => { setAdding(true); setUpgrading(false); setName(''); setSlug(''); setDescription(''); setContainerPort(''); setSelected('') }}>部署新应用</button><button onClick={() => void run(loadCatalog)}>刷新应用</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {adding && <form onSubmit={e => { e.preventDefault(); void run(async () => {
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
      <h3>{upgrading ? `1. 升级已有应用 (${slug})` : '1. 选择要部署的应用'}</h3>
      <label>应用名称<input required value={name} onChange={e => setName(e.target.value)} placeholder="例如：订单查询助手" /></label>
      <label>英文标识<input required disabled={upgrading} pattern="[a-z][a-z0-9-]{2,39}" value={slug} onChange={e => setSlug(e.target.value)} placeholder="例如：order-helper" /></label>
      <label>应用简介（可选）<input value={description} onChange={e => setDescription(e.target.value)} placeholder="简要说明应用业务用途" /></label>
      <label>容器监听端口（可选，留空由 AI 自动识别）<input type="number" min={1} max={65535} value={containerPort} onChange={e => setContainerPort(e.target.value)} placeholder="例如：8080" /></label>
      <label>源码 ZIP<input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0])}/></label>
      <label>或本机源码文件夹<input disabled={!!file} value={source} onChange={e => setSource(e.target.value)} placeholder="/Users/你的名字/Projects/my-app" /></label>
      <p>仅处理独立副本。会保留原项目。独立 Web 安装需本机提供 Python 3.9 或更新版本。</p>
      <div className="row"><button className="primary" disabled={busy || (!file && !source)}>导入源码</button><button type="button" onClick={() => { setAdding(false); setUpgrading(false) }}>取消</button></div>
    </form>}
    {!adding && !job && <>
      <h3>全部应用</h3>
      {catalogError ? <p role="alert" className="error">{catalogError}</p> : catalog.length === 0 && <p>暂无已发布应用。</p>}
      {catalog.map(app => <article key={app.slug}>
        <h4>{app.name} <span className="badge">{deploymentStatus[app.status] ?? app.status}</span></h4>
        {app.description && <p>{app.description}</p>}
        <p>{app.slug}{app.current_version ? ` · v${app.current_version}` : ''}</p>
        <div className="row">
          {/^https?:\/\//i.test(app.app_url) && <a href={app.app_url} target="_blank" rel="noreferrer">打开应用</a>}
          {app.can_manage && api.appVersions && <>
            <button disabled={busy} onClick={() => {
              setName(app.name)
              setSlug(app.slug)
              setDescription(app.description ?? '')
              setContainerPort(app.container_port ? String(app.container_port) : '')
              setUpgrading(true)
              setAdding(true)
            }}>升级应用</button>
            <button disabled={busy} onClick={() => void run(async () => {
              if (managingSlug === app.slug) { setManagingSlug(''); setStorageVolumes(null); setEditingConfigSlug(''); return }
              const res = JSON.parse(await api.appVersions!(app.slug, contextId))
              setVersionList(res.versions ?? []); setManagingSlug(app.slug); setStorageVolumes(null); setPurgeVolumes(false)
            })}>{managingSlug === app.slug ? '收起管理' : '管理与回退'}</button>
          </>}
        </div>
        {app.can_manage && managingSlug === app.slug && <div className="notice" style={{ marginTop: 8 }}>
          <div className="row">
            {api.appRecheck && <button disabled={busy} onClick={() => void run(async () => { await api.appRecheck!(app.slug, contextId); await loadCatalog() })}>健康重检</button>}
            {api.appLogs && <button disabled={busy} onClick={() => void run(async () => { const res = JSON.parse(await api.appLogs!(app.slug, contextId)); setLogs(res.runtime_logs || '暂无运行日志') })}>运行日志</button>}
            {api.appStorage && <button disabled={busy} onClick={() => void run(async () => {
              const res = JSON.parse(await api.appStorage!(app.slug, contextId))
              setStorageVolumes(res.volumes ?? res.storage_mounts ?? [])
            })}>持久化存储卷</button>}
            {api.appUpdateConfig && <button disabled={busy} onClick={() => {
              if (editingConfigSlug === app.slug) { setEditingConfigSlug(''); return }
              setEditingConfigSlug(app.slug)
              setConfigDraftRows([{ key: '', value: '' }])
            }}>{editingConfigSlug === app.slug ? '取消配置更新' : '更新运行配置'}</button>}
          </div>
          {editingConfigSlug === app.slug && api.appUpdateConfig && <div style={{ marginTop: 8 }}>
            <strong>在线更新运行配置（更新后自动重启容器，需重新验证业务）</strong>
            {configDraftRows.map((row, idx) => <div key={idx} className="row">
              <input placeholder="环境变量名（如 API_KEY）" value={row.key} onChange={e => {
                const next = [...configDraftRows]; next[idx] = { ...row, key: e.target.value }; setConfigDraftRows(next)
              }} />
              <input placeholder="配置值" value={row.value} onChange={e => {
                const next = [...configDraftRows]; next[idx] = { ...row, value: e.target.value }; setConfigDraftRows(next)
              }} />
            </div>)}
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
          </div>}
          {storageVolumes && <div style={{ marginTop: 8 }}>
            <strong>挂载卷状态</strong>
            {storageVolumes.length === 0 ? <p><small>未配置持久化挂载卷。</small></p> : <ul>
              {storageVolumes.map((vol, i) => <li key={i}>
                <code>{vol.target}</code>{vol.source_rel ? ` ← ${vol.source_rel}` : ''}{typeof vol.file_count === 'number' ? ` · ${vol.file_count} 个文件` : ''}{typeof vol.size_bytes === 'number' ? ` (${vol.size_bytes} B)` : ''}{vol.seed ? ' · 含初始种子数据保护' : ''}
              </li>)}
            </ul>}
          </div>}
          <p><small>{ROLLBACK_NOTICE}</small></p>
          {versionList.map(v => <div key={v.version} className="row">
            <span>v{v.version} ({v.status}){v.version_note ? ` · ${v.version_note}` : ''}</span>
            {api.appRollback && v.version !== app.current_version && (
              v.status === 'running' ? <button disabled={busy} onClick={() => void run(async () => {
                const rb = JSON.parse(await api.appRollback!(app.slug, JSON.stringify({ targetVersion: v.version, reason: `回退至 v${v.version}` }), contextId))
                setNotice(`${rb.message || `已回退至 v${v.version}`}（${rb.rollback_notice || ROLLBACK_NOTICE}）`)
                await loadCatalog()
              })}>回退到此版本</button> : <small>部署未成功 · 不可回退</small>
            )}
          </div>)}
          {api.appDelete && <div className="row" style={{ marginTop: 8 }}>
            <label className="row" style={{ margin: 0 }}><input style={{ flex: 'none' }} type="checkbox" checked={purgeVolumes} onChange={e => setPurgeVolumes(e.target.checked)} />同时清理持久化数据卷</label>
            <button disabled={busy} onClick={() => void run(async () => { await api.appDelete!(app.slug, purgeVolumes, contextId); setManagingSlug(''); await loadCatalog() })}>删除应用</button>
          </div>}
          {logs && <pre>{logs}</pre>}
        </div>}
      </article>)}
      {jobs.length > 0 && <><h3>本机部署任务</h3>{jobs.map(item => <article key={item.id}>
        <button onClick={() => setSelected(item.id)}>{item.name}</button> <span className="badge">{statusText[item.status] ?? item.status}</span>
      </article>)}</>}
    </>}
    {!adding && job && <>
      <button onClick={() => setSelected('')}>← 返回应用列表</button><h3 style={{ marginTop: 16 }}>{job.name} <span className="badge">{statusText[job.status]}</span></h3><p>{job.url}</p>
      
      {job.error && <p className="error">{job.error}</p>}
      {['draft', 'review', 'failed', 'ready'].includes(job.status) && <>
        <h3>2. AI 分析与改造</h3>
        {job.discoveryReport && <p><small>代码扫描：{job.discoveryReport.language || '未知语言'}{job.discoveryReport.framework ? ` / ${job.discoveryReport.framework}` : ''} · API {job.discoveryReport.api_count ?? 0} 个 · 页面 {job.discoveryReport.page_count ?? 0} 个 · 存储目录 {job.discoveryReport.storage_count ?? 0} 处</small></p>}
        {job.proposal?.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{job.proposal.summary}</p>}
        {job.transformationReport?.highlights?.length ? <details><summary>改造与验证要点（{job.transformationReport.highlights.length}）</summary><ul>{job.transformationReport.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></details> : null}
        {!!issues.length && <details><summary>发现的问题与处理（{issues.length}）</summary><ul>{issues.map((item, i) => <li key={i}><strong>[{item.severity}] {item.title}</strong>：{item.detail}{item.resolution ? `（处理：${item.resolution}）` : ''}</li>)}</ul></details>}
        {!!decisions.length && <div className="notice">
          <strong>请确认改造选项</strong>
          {decisions.map(d => <div key={d.id} style={{ marginTop: 6 }}>
            <p style={{ margin: '4px 0' }}>{d.question}</p>
            <div className="row">
              {d.options.map(opt => <button key={opt.id} type="button" onClick={() => {
                const line = `关于「${d.question}」：选择「${opt.label}」`
                setFeedback(prev => prev.trim() ? `${prev.trim()}\n${line}` : line)
              }}>{opt.label}{opt.recommended ? '（推荐）' : ''}</button>)}
            </div>
          </div>)}
        </div>}
        {!!job.proposal?.unresolved?.length && <div className="notice"><strong>需要补充的信息</strong><ul>{job.proposal.unresolved.map((q, i) => <li key={i}>{typeof q === 'string' ? q : JSON.stringify(q)}</li>)}</ul></div>}
        <textarea aria-label="补充改造要求" value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="可以告诉 AI 应用用途，或回答上面的待确认问题" />
        <button disabled={disabled} onClick={() => void run(async () => { await api.appAnalyze(job.id, feedback, sessionId, contextId) })}>{job.proposal ? '补充说明并重新分析' : '开始 AI 分析'}</button>
        {!!job.proposal?.changes?.length && <details><summary>查看拟修改的文件（{job.proposal.changes.length}）</summary>{job.proposal.changes.map(c => <div key={c.path}><p><strong>{c.path}</strong>：{c.reason}</p>{c.diff && <pre style={{ fontSize: 12, overflowX: 'auto' }}>{c.diff}</pre>}</div>)}</details>}
        {job.status === 'review' && !job.proposal?.unresolved?.length && <button className="primary" disabled={disabled} onClick={() => void run(async () => { await api.appPrepare(job.id, job.proposalHash!, contextId) })}>确认改造方案，生成部署包</button>}
      </>}
      {job.status === 'ready' && <>
        <h3>3. 核对部署内容</h3><p>服务器将构建并运行这个应用。下面的配置仅供应用运行，不会展示给模型。</p>
        {(job.proposal?.contract.configs ?? []).map(c => {
          const val = bindings[c.key] ? '' : configs[c.key] ?? ''
          const loopback = !bindings[c.key] && isLoopbackConnection(c.key, val)
          return <div key={c.key}>
            <label>{c.description || c.key} {c.required ? (c.has_original_value ? '（必填 · 已从原项目提取默认值）' : '（必填）') : ''}
              <input
                type={c.secret ? 'password' : 'text'}
                autoComplete="off"
                disabled={!!bindings[c.key]}
                placeholder={c.has_original_value ? '已保留原配置值（留空沿用原值）' : undefined}
                value={val}
                onChange={e => { setConfigs({ ...configs, [c.key]: e.target.value }); setConfirm(false) }}
              />
              {resources.some(r => r.env_keys.includes(c.key)) && <select aria-label={`${c.key} 的配置来源`} value={bindings[c.key] ?? ''} onChange={e => { setBindings({ ...bindings, [c.key]: e.target.value }); setConfirm(false) }}>
                <option value="">手动填写</option>
                {resources.filter(r => r.env_keys.includes(c.key)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>}
            </label>
            {loopback && <label className="row" style={{ marginTop: 4 }}>
              <input style={{ flex: 'none' }} type="checkbox" checked={!!localConfirmed[c.key]} onChange={e => { setLocalConfirmed({ ...localConfirmed, [c.key]: e.target.checked }); setConfirm(false) }} />
              <small>检测到 {c.key} 指向本机地址（{val}）。只有该服务确实和应用放在同一个容器内时，才勾选保留此连接</small>
            </label>}
          </div>
        })}
        {storageMounts.length > 0 && <details open><summary>持久化存储卷挂载（{storageMounts.length}）</summary><ul>
          {storageMounts.map((m, i) => <li key={i}><code>{m.source_rel}</code> → 容器 <code>{m.target}</code>{m.env_key ? `（环境变量 ${m.env_key}）` : ''}{m.seed !== false ? ' · 自动保留初始种子数据' : ''}</li>)}
        </ul></details>}
        <label>版本备注（可选）<input value={versionNote} onChange={e => setVersionNote(e.target.value)} placeholder="例如：修复订单查询接口并挂载 SQLite 数据卷" /></label>
        <details><summary>部署后 AI 能做什么</summary>{job.proposal?.contract.apis?.map(a => <p key={a.id}>{a.purpose} · {a.method} {a.path}</p>)}{job.proposal?.contract.pages?.map(p => <p key={p.path}>页面：{p.purpose} · {p.path}</p>)}</details>
        <label className="row"><input style={{ flex: 'none' }} type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>我已核对上述应用、访问地址和配置，确认发布到 OPC</label>
        <div className="row">
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
          })}>确认发布</button>
          {api.appReopenReview && <button type="button" disabled={disabled} onClick={() => void run(async () => { await api.appReopenReview!(job.id, contextId) })}>返回调整方案</button>}
        </div>
      </>}
      {['building', 'unknown', 'awaiting_page_verification', 'failed', 'verified'].includes(job.status) && job.artifactHash && <>
        <h3>4. 部署验证与使用</h3>
        {deployment && <p role="status">服务器状态：{deployment.status === 'running' ? '已启动' : deployment.status === 'failed' ? '部署失败' : '正在构建'} · v{deployment.current_version}</p>}
        {deployment?.error_message && <p className="error">{deployment.error_message}</p>}
        {requiredAuthKeys.length > 0 && job.status !== 'verified' && <details open={job.status === 'failed'}>
          <summary>验证凭据（可选，用于受保护接口探针或更新存储凭据）</summary>
          {requiredAuthKeys.map(k => <label key={k}>{k}<input type="password" autoComplete="off" value={probeCredentials[k] ?? ''} onChange={e => setProbeCredentials({ ...probeCredentials, [k]: e.target.value })} placeholder="留空则使用部署时保存的凭据" /></label>)}
        </details>}
        <div className="row">
          <button disabled={disabled} onClick={() => void run(async () => {
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
          {(job.status === 'failed' || deployment?.status === 'failed') && <button className="primary" disabled={disabled} onClick={() => void run(async () => {
            const diagParts = [
              '部署或业务验证失败，请根据错误原因、构建日志和运行日志诊断问题并修复改造方案：',
              job.error ? `错误摘要：${job.error}` : '',
              deployment?.error_message ? `平台错误：${deployment.error_message}` : '',
              feedback.trim() ? `补充说明：${feedback.trim()}` : '',
            ].filter(Boolean)
            await api.appAnalyze(job.id, diagParts.join('\n'), sessionId, contextId)
          })}>AI 诊断并修复失败</button>}
        </div>
        {job.status === 'awaiting_page_verification' && <div className="notice">
          <p>容器已启动并通过健康身份校验。纯页面应用请先打开页面完成人工验收，确认正常渲染后启用技能：</p>
          <div className="row">
            <a href={job.url} target="_blank" rel="noreferrer">打开应用页面</a>
            <button className="primary" disabled={disabled} onClick={() => void run(async () => {
              if (api.appVerifyWithOptions) await api.appVerifyWithOptions(job.id, JSON.stringify({ confirmPageVerification: true }), contextId)
              else await api.appVerify(job.id, contextId)
            })}>已完成页面验收，启用技能</button>
          </div>
        </div>}
        {job.status === 'verified' && (!deployment || (deployment.status === 'running' && deployment.current_version === job.version)) && <div className="notice">应用只读业务验证已通过。回到对话框输入 <strong>/app-{job.slug}</strong> 选择技能，然后描述要查询的内容。写入操作仍需确认。<p>页面操作尚未验证。<a href={job.url} target="_blank" rel="noreferrer">打开应用页面</a></p></div>}
        {logs && <pre>{logs}</pre>}
      </>}
      <details open={active.has(job.status)}><summary>任务进度</summary><ol>{job.events.map((event, i) => <li key={i}>{event}</li>)}</ol></details>
    </>}
    <style>{`.opc-apps label{display:block;margin:12px 0}.opc-apps label input:not([type=checkbox]){box-sizing:border-box;display:block;width:100%;margin:5px 0}.opc-apps textarea{box-sizing:border-box;width:100%;min-height:90px;margin:10px 0}.opc-apps button{margin:4px 0}.opc-apps a{color:#245c9f}`}</style>
  </div>
}
