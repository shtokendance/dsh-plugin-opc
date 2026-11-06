import React, { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { AuthState, OpcApi, Resource } from './api.ts'
export type PanelKind = 'knowledge' | 'skills' | 'mcp'
import { labels as titles, OpcIcon } from './branding.tsx'
const css = `.opc-panel{font:13px/1.6 system-ui,sans-serif;color:var(--text-primary,#263348);height:100%;overflow:auto;background:var(--background-primary,#fff)}.opc-panel *{box-sizing:border-box}.opc-panel header{padding:18px 20px;border-bottom:1px solid #dce3eb}.opc-panel h2{font-size:18px;margin:0;font-weight:650}.opc-panel small{color:#64748b}.opc-panel main{padding:16px 20px}.opc-panel button,.opc-panel input,.opc-panel select,.opc-panel textarea{font:inherit;border:1px solid #ced8e4;border-radius:6px;padding:7px 10px;color:inherit;background:var(--background-primary,#fff)}.opc-panel button{cursor:pointer}.opc-panel button:disabled{opacity:.45;cursor:wait}.opc-panel .primary{background:#245c9f;color:#fff;border-color:#245c9f}.opc-panel .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.opc-panel input{min-width:0;flex:1}.opc-panel article{padding:15px 0;border-bottom:1px solid #e5eaf0}.opc-panel h3{font-size:14px;margin:0 0 5px}.opc-panel p{margin:5px 0}.opc-panel .notice{background:#edf4fc;border-left:3px solid #356ca8;padding:10px 12px;margin:12px 0}.opc-panel .error{background:#fff1ef;border-left:3px solid #b73d32;padding:10px 12px;overflow-wrap:anywhere}.opc-panel .gate{padding:32px 22px}.opc-panel .gate h3{font-size:20px}.opc-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:10px}.opc-panel .badge{font-size:11px;color:#245c9f;background:#edf4fc;padding:2px 6px;border-radius:3px}.opc-panel .doc{overflow-wrap:anywhere}.opc-panel .doc img{max-width:100%}.opc-panel details{border-bottom:1px solid #dce3eb;padding:12px 0}.opc-panel summary{cursor:pointer;font-weight:600}`

export function Panel({ api, sessionId, kind }: { api: OpcApi; sessionId: string; kind: PanelKind }) {
  const [state, setState] = useState<AuthState>({ signedIn: false, loginInProgress: false, context: null })
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [q, setQ] = useState('')
  const [items, setItems] = useState<Resource[]>([]), [hits, setHits] = useState<Record<string, unknown>[]>([])
  const [kb, setKb] = useState(''), [doc, setDoc] = useState(''), [filter, setFilter] = useState('all')
  const [services, setServices] = useState<Record<string, unknown>[]>([])
  const pin = state.pinnedScopes?.[sessionId] ?? ''
  const epoch = useRef(0)
  const run = useCallback(async (action: () => Promise<void>) => {
    const version = epoch.current
    setBusy(true); setError('')
    try { await action() } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : '操作失败，请重试。') }
    finally { if (version === epoch.current) setBusy(false) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try { for await (const frame of api.watchState(controller.signal)) { if (!controller.signal.aborted) setState(JSON.parse(frame)) } }
      catch (e) { if (!controller.signal.aborted) setError(`状态连接中断：${e instanceof Error ? e.message : '请重新打开面板'}`) }
    })()
    return () => controller.abort()
  }, [api])
  const load = useCallback(async () => {
    const version = epoch.current
    if (kind === 'mcp') {
      const body = JSON.parse(await api.listMcpServices())
      if (version === epoch.current) setServices(body.data?.services ?? body.services ?? [])
    } else {
      const rows = JSON.parse(await (kind === 'skills' ? api.listSkillsCatalog(q) : api.listKnowledgeBases(q)))
      if (version === epoch.current) setItems(rows)
    }
  }, [api, kind, q])
  useEffect(() => {
    epoch.current++; setItems([]); setHits([]); setDoc(''); setServices([]); setKb(''); setBusy(false); setError('')
    if (state.signedIn) void run(load)
  }, [state.context?.contextId, sessionId, kind])
  const context = state.context
  const action = (fn: () => Promise<void>) => () => void run(fn)
  return <section className="opc-panel"><style>{css}</style><header><small>OPC 工作区</small><h2><OpcIcon size={20} /> {titles[kind]}</h2></header>
    {!state.signedIn || !context ? <div className="gate"><h3>连接 OPC 工作空间</h3><p>登录后使用 OPC 知识库、技能与 MCP。企业身份与 DSH 个人账号独立。</p>
      <div className="row"><button className="primary" disabled={busy || state.loginInProgress} onClick={action(async () => { await api.startLogin() })}>企业微信 / SSO 登录</button></div>
      {state.loginInProgress && <div className="notice">请在浏览器完成授权。{state.loginAuthorizeUrl && <p><a href={state.loginAuthorizeUrl} target="_blank" rel="noreferrer">重新打开授权页</a></p>}<button onClick={action(() => api.cancelLogin())}>取消登录</button></div>}
      {state.loginError && <p role="alert" className="error">{state.loginError.message}</p>}</div> : <main>
      <strong>{context.displayName || context.subject}</strong>{context.email && <small> · {context.email}</small>}
      <div className="row"><select aria-label="企业空间" value={context.tenant} disabled={busy} onChange={e => void run(() => api.switchTenant(e.target.value))}>{(context.spacesDetail ?? context.spaces.map(id => ({ id, name: id }))).map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select><button disabled={busy} onClick={action(load)}>刷新</button><button disabled={busy} onClick={action(() => api.logout())}>退出登录</button></div>
      {kind !== 'mcp' && <form className="row" onSubmit={e => { e.preventDefault(); void run(load) }}><input aria-label="搜索目录" placeholder="按名称搜索" value={q} onChange={e => setQ(e.target.value)}/><button disabled={busy}>搜索</button></form>}
      {kind === 'knowledge' && <>
        {pin && <div className="notice">当前对话限定：{items.find(item => item.knowledge_base_id === pin)?.name ?? pin} <button onClick={action(async () => { await api.setPinnedKnowledgeScope(sessionId, null, context.contextId) })}>取消限定</button></div>}
        {items.map(item => <article key={item.knowledge_base_id}><h3>{item.name}</h3><p>{item.description}</p><div className="row"><button disabled={busy || item.availability !== 'available'} onClick={action(async () => { await api.setPinnedKnowledgeScope(sessionId, item.knowledge_base_id!, context.contextId) })}>限定问答范围</button><button onClick={() => setKb(item.knowledge_base_id!)}>检索此库</button></div></article>)}
        <KnowledgeSearch key={context.contextId + sessionId} api={api} sessionId={sessionId} contextId={context.contextId} kb={kb} items={items} setKb={setKb} busy={busy} run={run} setHits={setHits}/>
        {hits.map((hit, i) => <article key={String(hit.knowledge_id) + i}><button onClick={action(async () => { const version = epoch.current; const result = JSON.parse(await api.readKnowledgeDocument(sessionId, String(hit.knowledge_id), context.contextId)); if (version === epoch.current) setDoc(result.data?.content ?? '') })}>{String(hit.title ?? hit.knowledge_id)}</button><small> · {typeof hit.score === 'number' ? hit.score.toFixed(2) : ''}</small><p>{String(hit.snippet ?? hit.content ?? '')}</p></article>)}
        {doc && <div className="doc"><button onClick={() => setDoc('')}>关闭正文</button><Markdown>{doc}</Markdown></div>}
      </>}
      {kind === 'skills' && <><div className="row"><select aria-label="安装状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部技能</option><option value="installed">已安装</option><option value="new">未安装</option></select></div>{items.filter(item => filter === 'all' || (filter === 'installed' ? !!item.installed : !item.installed)).map(item => <article key={item.catalog_id}><h3>/{item.name} <small>{item.version}</small></h3><p>{item.description}</p><span className="badge">{item.installed ? item.installed.enabled ? '已启用 · 输入 / 调用' : '已停用' : '未安装'}</span><div className="row">
        {(!item.installed || item.installed.active_sha256 !== item.bundle_sha256) && <button className="primary" disabled={busy || item.availability !== 'available'} onClick={action(async () => { await api.installSkill(item.catalog_id!, item.bundle_sha256!, context.contextId); await load() })}>{item.installed ? '更新版本' : '下载安装'}</button>}
        {item.installed && <><button disabled={busy} onClick={action(async () => { await api.setSkillEnabled(item.catalog_id!, !item.installed!.enabled, context.contextId); await load() })}>{item.installed.enabled ? '停用' : '启用'}</button><button disabled={busy} onClick={action(async () => { await api.uninstallSkill(item.catalog_id!, context.contextId); await load() })}>卸载</button></>}</div></article>)}</>}
      {state.approvals?.map(pending => <div className="notice" key={pending.id}><strong>审批企业操作：{pending.toolName}</strong><pre>{JSON.stringify(pending.arguments, null, 2)}</pre><button className="primary" onClick={() => void api.decideDebugInvocation(pending.id, true, pending.contextId).catch(e => setError(String(e)))}>允许一次</button> <button onClick={() => void api.decideDebugInvocation(pending.id, false, pending.contextId).catch(e => setError(String(e)))}>拒绝</button></div>)}
      {kind === 'mcp' && <><p className="notice">AI 可按权限调用以下服务。需要审批的操作会请求确认；{state.mountAvailable ? '挂载服务的审批显示在 OPC 面板。' : '当前客户端不支持原生挂载，可在下方调试工具。'}</p>{services.map(service => <details key={String(service.service_id)}><summary>{String(service.name ?? service.service_id)}</summary><p>{String(service.description ?? '')}</p>{state.mcpConnections?.[String(service.service_id)] && <p role="status">{state.mcpConnections[String(service.service_id)].state === 'connected' ? `已连接 · ${state.mcpConnections[String(service.service_id)].toolCount} 个工具` : `连接状态：${state.mcpConnections[String(service.service_id)].state}`}</p>}{state.mountAvailable && <button disabled={busy} onClick={action(() => state.mountedServices?.includes(String(service.service_id)) ? api.unmountMcpService(String(service.service_id), context.contextId) : api.mountMcpService(String(service.service_id), context.contextId))}>{state.mountedServices?.includes(String(service.service_id)) ? '取消挂载' : '挂载到 DSH'}</button>}{(Array.isArray(service.tools) ? service.tools : []).map((tool, i) => <article key={i}><strong>{typeof tool === 'string' ? tool : tool.name}</strong>{typeof tool !== 'string' && <><p>{tool.description}</p>{tool.risk && <span className="badge">{tool.risk === 'read' ? '只读' : tool.risk}{tool.require_approval ? ' · 需要审批' : ''}</span>}<pre>{JSON.stringify(tool.input_schema ?? tool.inputSchema ?? {}, null, 2)}</pre></>}<McpDebug api={api} serviceId={String(service.service_id)} toolName={typeof tool === 'string' ? tool : tool.name} contextId={context.contextId}/></article>)}</details>)}</>}
      {!busy && (kind === 'mcp' ? services.length === 0 : items.length === 0) && <p>当前没有可见资源。可切换空间或刷新目录。</p>}
    </main>}
    {busy && <p role="status" style={{ padding: '0 20px' }}>正在处理…</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>
}
function KnowledgeSearch({ api, sessionId, contextId, kb, items, setKb, busy, run, setHits }: { api: OpcApi; sessionId: string; contextId: string; kb: string; items: Resource[]; setKb: (s: string) => void; busy: boolean; run: (a: () => Promise<void>) => Promise<void>; setHits: (h: Record<string, unknown>[]) => void }) {
  const [query, setQuery] = useState('')
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  return <form onSubmit={e => { e.preventDefault(); void run(async () => { const result = JSON.parse(await api.searchKnowledge(sessionId, query, kb, contextId)); if (live.current) setHits(result.results) }) }}><h3 style={{ marginTop: 20 }}>在线文档检索</h3><select aria-label="检索知识库" value={kb} onChange={e => setKb(e.target.value)}><option value="">当前空间全部知识库</option>{items.map(item => <option key={item.knowledge_base_id} value={item.knowledge_base_id}>{item.name}</option>)}</select><div className="row"><input required aria-label="文档检索词" placeholder="输入要查找的内容" value={query} onChange={e => setQuery(e.target.value)}/><button className="primary" disabled={busy}>检索</button></div></form>
}

function McpDebug({ api, serviceId, toolName, contextId }: { api: OpcApi; serviceId: string; toolName: string; contextId: string }) {
  const [args, setArgs] = useState('{}'), [result, setResult] = useState(''), [pending, setPending] = useState(false)
  const generation = useRef(0)
  useEffect(() => { generation.current++; setResult(''); setPending(false); return () => { generation.current++ } }, [contextId])
  return <details><summary>在线调试调用</summary><textarea aria-label={`${toolName} JSON 参数`} value={args} onChange={e => setArgs(e.target.value)}/><button disabled={pending} onClick={() => {
    const current = generation.current; setPending(true); setResult('')
    void api.invokeMcpTool(serviceId, toolName, args, contextId).then(value => { if (current === generation.current) setResult(value) }, error => { if (current === generation.current) setResult(String(error)) }).finally(() => { if (current === generation.current) setPending(false) })
  }}>{pending ? '等待执行或审批…' : '调用'}</button>{result && <pre>{result}</pre>}</details>
}
