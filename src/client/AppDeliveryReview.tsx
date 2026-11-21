import React, { useEffect, useRef, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppDiscoveryReport } from './AppDiscoveryReport.tsx'
import { AppIcon, type AppIconName } from './AppIcon.tsx'

type DimensionMeta = {
  label: string
  subTitle: string
  icon: AppIconName
  pillClass: string
}

function getDimensionMeta(tag: string): DimensionMeta {
  const t = tag.trim()
  if (/应用定位|业务用途|项目用途|定位/.test(t)) {
    return { label: '应用定位', subTitle: '业务用途与定位', icon: 'sparkle', pillClass: 'oa-pill-accent' }
  }
  if (/运行环境|技术栈|开发语言|运行时|环境/.test(t)) {
    return { label: '运行环境', subTitle: '开发语言与技术栈', icon: 'code', pillClass: 'oa-pill-teal' }
  }
  if (/接口与页面|页面与接口|页面与业务视图|视图与路由/.test(t)) {
    return { label: '接口与页面', subTitle: '全景契约与视图', icon: 'table', pillClass: 'oa-pill-warn' }
  }
  if (/后端\s*API|API\s*接口|服务接口|接口清单/.test(t)) {
    return { label: '后端接口', subTitle: 'API 接口全景', icon: 'plug', pillClass: 'oa-pill-accent' }
  }
  if (/页面与视图|页面清单|业务视图/.test(t)) {
    return { label: '页面视图', subTitle: '业务视图全景', icon: 'table', pillClass: 'oa-pill-warn' }
  }
  if (/登录与鉴权|鉴权与安全|安全凭据|权限与凭据/.test(t)) {
    return { label: '登录与鉴权', subTitle: '权限与安全策略', icon: 'shield', pillClass: 'oa-pill-ok' }
  }
  if (/数据与存储|存储与数据库|持久化|数据库/.test(t)) {
    return { label: '数据与存储', subTitle: '数据存储与持久化', icon: 'archive', pillClass: '' }
  }
  return { label: t, subTitle: '分析明细', icon: 'diamond', pillClass: '' }
}

function renderFormattedSummary(rawText: string) {
  const trimmed = (rawText || '').trim()
  if (!trimmed) return null

  if (trimmed.length <= 50 && !trimmed.includes('\n') && !trimmed.includes('【') && !/第[一二三四]步/.test(trimmed)) {
    return <span>{trimmed}</span>
  }

  const rawLines = trimmed
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)

  const segments: string[] = []
  for (const line of rawLines) {
    if (!line.startsWith('【') && (/第[一二三四]步/.test(line) || line.length > 60)) {
      const byStep = line
        .split(/(?=(?:第一步(?:发现)?[：:]?|第二步(?:拟|改造)?[：:]?|第三步(?:契约)?[：:]?|第四步[：:]?|请确认))/)
        .map(s => s.trim())
        .filter(Boolean)
      if (byStep.length > 1) {
        for (const part of byStep) {
          if (part.length > 110) {
            segments.push(
              ...part
                .split(/(?<=[。；])\s*/)
                .map(s => s.trim())
                .filter(Boolean),
            )
          } else {
            segments.push(part)
          }
        }
        continue
      }
      const bySentence = line
        .split(/(?<=[。；])\s*/)
        .map(s => s.trim())
        .filter(Boolean)
      if (bySentence.length > 1) {
        segments.push(...bySentence)
        continue
      }
    }
    segments.push(line)
  }

  if (segments.length <= 1 && !trimmed.includes('【')) {
    return <span>{trimmed}</span>
  }

  type Block =
    | { type: 'cards'; items: { tag: string; content: string }[] }
    | { type: 'step'; label: string; text: string }
    | { type: 'bullet'; text: string }

  const blocks: Block[] = []
  let pendingCards: { tag: string; content: string }[] = []
  const flushCards = () => {
    if (pendingCards.length > 0) {
      blocks.push({ type: 'cards', items: pendingCards })
      pendingCards = []
    }
  }

  for (const seg of segments) {
    const bracketMatch = seg.match(/^【([^】]+)】\s*(.*)$/)
    if (bracketMatch) {
      pendingCards.push({ tag: bracketMatch[1], content: bracketMatch[2] })
      continue
    }
    flushCards()

    const stepMatch = seg.match(/^(第[一二三四]步[^：:，。]{0,6}|请确认)[：:]?\s*(.*)$/)
    if (stepMatch && stepMatch[2]) {
      blocks.push({ type: 'step', label: stepMatch[1], text: stepMatch[2] })
      continue
    }
    blocks.push({ type: 'bullet', text: seg.replace(/^[•\-*]\s*/, '') })
  }
  flushCards()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, lineHeight: 1.6 }}>
      {blocks.map((block, bIdx) => {
        if (block.type === 'cards') {
          return (
            <div key={bIdx} className="oa-grid-2">
              {block.items.map((item, itemIdx) => {
                const meta = getDimensionMeta(item.tag)
                const isWide = item.content.length > 110 || (block.items.length % 2 !== 0 && itemIdx === block.items.length - 1)
                return (
                  <div key={itemIdx} className={`oa-subcard ${isWide ? 'wide' : ''}`}>
                    <div className="oa-subcard-head">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`oa-pill ${meta.pillClass}`}>
                          <AppIcon name={meta.icon} size={11} />
                          {meta.label}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{meta.subTitle}</span>
                      </div>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--oa-ink)' }}>{item.content}</div>
                  </div>
                )
              })}
            </div>
          )
        }
        if (block.type === 'step') {
          return (
            <div key={bIdx} className="oa-subcard" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <span className="oa-pill oa-pill-accent">
                <AppIcon name="sparkle" size={11} />
                {block.label}
              </span>
              <span style={{ flex: 1 }}>{block.text}</span>
            </div>
          )
        }
        return (
          <div key={bIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: 'var(--oa-accent)', fontWeight: 700 }}>•</span>
            <span style={{ flex: 1 }}>{block.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function decisionOptionText(opt: string | { id: string; label: string; recommended?: boolean }): string {
  return typeof opt === 'string' ? opt : opt.label || opt.id
}

export function AppDeliveryReview({
  api,
  sessionId,
  contextId,
  jobId,
  onReady,
  onReplaceSource,
  onNextStep,
  onInvalidate,
  beginAnalysisNavigation,
  repairMode = false,
  footerMode = 'external',
  onStepStateChange,
}: {
  api: OpcApi
  sessionId: string
  contextId: string
  jobId: string
  onReady: (job: AppDeliveryJob) => void
  onReplaceSource?: () => void
  onNextStep?: () => void
  onInvalidate?: () => void
  beginAnalysisNavigation?: () => ((job: AppDeliveryJob) => void) | undefined
  repairMode?: boolean
  footerMode?: 'inline' | 'external'
  onStepStateChange?: (state: { jobId: string; canContinue: boolean; triggerNext: () => void } | null) => void
}) {
  const [job, setJob] = useState<AppDeliveryJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [handoff, setHandoff] = useState<{ prompt: string; source_path?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [protectedValues, setProtectedValues] = useState<Record<string, string>>({})
  const [savingInputs, setSavingInputs] = useState(false)
  const [inputResult, setInputResult] = useState('')
  useEffect(() => {
    setProtectedValues({})
    setInputResult('')
  }, [jobId])
  const inFlight = useRef(false)
  const currentRef = useRef(job)
  currentRef.current = job

  const loadJob = async (): Promise<AppDeliveryJob | null> => {
    if (api.appJob) {
      return JSON.parse(await api.appJob(jobId, contextId)) as AppDeliveryJob
    }
    const list = JSON.parse(await api.appList(contextId)) as AppDeliveryJob[]
    return list.find(j => j.id === jobId) || null
  }

  const accept = (result: AppDeliveryJob | null) => {
    if (result) setJob(result)
  }

  useEffect(() => {
    let alive = true
    const poll = async () => {
      if (inFlight.current) return
      try {
        const result = await loadJob()
        if (alive && !inFlight.current) {
          accept(result)
          setLoadError('')
        }
      } catch (e) {
        if (alive) setLoadError(String(e))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [jobId, contextId])

  const plan = job?.proposal
  const ready = job?.status === 'ready' && Boolean(job.artifactHash) && !plan?.unresolved?.length
  const running = busy || ['importing', 'analyzing', 'preparing'].includes(job?.status || '')
  const questions = !running && job?.status === 'review' ? plan?.unresolved || [] : []
  const text = (q: unknown) => (typeof q === 'string' ? q : JSON.stringify(q))
  const activeError = error || loadError || job?.error || ''
  const canContinue = ready && !running && !activeError && !savingInputs
  const requestedInputs = job?.runtime_configs?.filter(item => item.needs_user_input) ?? []
  const preparedHash = job?.artifactHash
  useEffect(() => {
    if (!ready || !preparedHash || !api.appConfigDraft) return
    let active = true
    api.appConfigDraft(jobId, contextId).then(raw => {
      const draft = JSON.parse(raw ?? 'null')
      const rows = draft?.rows ?? []
      if (active) setProtectedValues(current => ({
        ...Object.fromEntries(rows.filter((row: { value?: string }) => typeof row.value === 'string')
          .map((row: { key: string; value: string }) => [row.key, row.value])),
        ...current,
      }))
    }).catch(() => {})
    return () => { active = false }
  }, [ready, preparedHash, jobId, contextId, api])
  const saveProtectedInputs = async () => {
    if (!job?.artifactHash || !api.appSaveConfigDraft || savingInputs) return
    const rows = requestedInputs.filter(item => protectedValues[item.key]).map(item => ({ key: item.key, value: protectedValues[item.key] }))
    if (!rows.length) return
    setSavingInputs(true)
    setInputResult('')
    try {
      await api.appSaveConfigDraft(job.id, JSON.stringify({ artifactHash: job.artifactHash, protectedInputs: true, rows }), contextId)
      accept(await loadJob())
      setInputResult('已保存，第三步可核对或替换。')
    } catch (error) {
      setInputResult(String(error))
    } finally {
      setSavingInputs(false)
    }
  }
  const chatActive = Boolean(job?.analysisChatActive && job.analysisSessionId)

  const resumeAnalysis = async () => {
    if (!api.appAnalyzeWithMode || running || inFlight.current) return
    const navigate = beginAnalysisNavigation?.()
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const raw = await api.appAnalyzeWithMode(jobId, '', sessionId, 'resume', contextId)
      const result = JSON.parse(raw) as AppDeliveryJob
      accept(result)
      navigate?.(result)
      onInvalidate?.()
      setHandoff(null)
      setCopied(false)
    } catch (e) {
      setError(String(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const prepare = async () => {
    const pHash = currentRef.current?.proposalHash
    if (!pHash || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const raw = await api.appPrepare(jobId, pHash, contextId)
      const result = JSON.parse(raw) as AppDeliveryJob
      accept(result)
      if (result.status !== 'ready') setError(result.error || '交付包生成未完成')
    } catch (e) {
      setError(String(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const checkingProposal = job?.status === 'review' && !!plan && !questions.length && !activeError && !running
  const hasReport = Boolean(plan?.discovery_report || job?.discoveryReport || plan?.four_step_report || plan?.contract?.apis?.length || plan?.contract?.pages?.length)
  const transformation = (plan?.transformation_report as any) || job?.transformationReport
  const revNum = job?.revision_count ?? job?.revisionCount ?? 1

  const next = async () => {
    if (!canContinue) return
    setBusy(true)
    try {
      const result = await loadJob()
      if (!result || result.status !== 'ready' || result.artifactHash !== job?.artifactHash || result.proposal?.unresolved?.length) {
        accept(result)
        throw new Error('应用或配置已变化，请先处理当前问题。')
      }
      onReady(result)
      onNextStep?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => () => onStepStateChange?.(null), [onStepStateChange])
  useEffect(() => {
    onStepStateChange?.({
      jobId,
      canContinue: Boolean(canContinue),
      triggerNext: () => void nextRef.current(),
    })
  }, [jobId, canContinue, onStepStateChange])

  const title = running
    ? job?.status === 'preparing' ? '正在生成交付包' : 'AI 正在检查和改造'
    : activeError
      ? '应用准备暂停'
      : questions.length
        ? `有 ${questions.length} 件事需要你决定`
        : checkingProposal
          ? '改造方案已通过校验'
          : ready
            ? '交付包已生成，可以核对部署内容'
            : '正在读取应用'

  const summaries = (job?.conversation || []).filter(message => message.role === 'assistant')
  const events = job?.events || []
  const isRejected = (event: string) => event.startsWith('提案校验未通过')
  const isTechnicalEvent = (event: string) => isRejected(event) || event.includes('完整提案尚未通过')
  const visibleEvents = events.filter(event => !isTechnicalEvent(event))
  const technicalEvents = events.filter(isTechnicalEvent)
  const recovering = running && job?.status !== 'preparing' && Boolean(job?.analysis_failure)
  const isConnectionError = /timed out|超时|connection reset|连接中断/i.test(activeError)

  const chatScrollRef = useRef<HTMLDivElement>(null)
  const eventsScrollRef = useRef<HTMLDivElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el || (ready && hasReport)) return
    el.scrollTop = el.scrollHeight
  }, [events.length, summaries.length, running, ready, hasReport])

  useEffect(() => {
    const stream = chatScrollRef.current
    const report = reportRef.current
    if (!ready || !stream || !report) return
    stream.scrollTop += report.getBoundingClientRect().top - stream.getBoundingClientRect().top - 16
  }, [jobId, ready, hasReport])

  useEffect(() => {
    const el = eventsScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events.length, running])


  return (
    <section className="oa-review-shell">
      {(repairMode || job?.analysis_mode === 'repair' || job?.analysisMode === 'repair') && (
        <div className="oa-alert oa-alert-warn" style={{ margin: '12px 14px 0' }} aria-label="部署失败修复状态">
          <strong>{running ? '正在诊断失败并核对修复' : ready ? '修复包已生成，等待部署验证' : '部署失败专项修复'}</strong>
          <span>对照失败制品与原始源码，保留业务和已有配置。提案、语法检查、服务器启动和业务验证分别记录。</span>
        </div>
      )}

      <header className="oa-review-head" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span
            className={`oa-dot ${running ? 'oa-pulse' : ''}`}
            style={{
              marginTop: 6,
              background: running
                ? 'var(--oa-accent)'
                : activeError
                  ? 'var(--oa-danger)'
                  : questions.length
                    ? 'var(--oa-warn)'
                    : ready
                      ? 'var(--oa-ok)'
                      : 'var(--oa-muted)',
            }}
          />
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{title}</h3>
              <span className="oa-pill">第 {revNum} 轮 · {job?.name || '准备应用'}</span>
            </div>
            <p className="oa-hint" style={{ margin: '3px 0 0' }}>
              {chatActive
                ? '请在左侧分析会话的聊天框回复。AI 要求填写管理员账号时，也在这里回复。'
                : ready
                  ? '交付包检查已完成。服务器构建、启动与业务访问将在部署时验证。'
                  : null}
            </p>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="oa-review-stream" aria-label="应用改造进度与结果">
        {summaries.map((m, i) => (
          <article key={i} className="oa-msg-row">
            <div className="oa-avatar-badge">
              <AppIcon name="sparkle" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="oa-hint" style={{ marginBottom: 4 }}>第 {m.revision || revNum} 轮改造摘要</div>
              <div className="oa-bubble">{renderFormattedSummary(m.text)}</div>
            </div>
          </article>
        ))}

        {!summaries.length && plan?.summary && (
          <article className="oa-msg-row">
            <div className="oa-avatar-badge">
              <AppIcon name="sparkle" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="oa-hint" style={{ marginBottom: 4 }}>AI 改造助手 · 第 {revNum} 轮分析</div>
              <div className="oa-bubble">{renderFormattedSummary(plan.summary)}</div>
            </div>
          </article>
        )}

        {job && hasReport && (
          <div ref={reportRef}>
            <AppDiscoveryReport key={job.id} job={job} />
          </div>
        )}

        {ready && job?.runtime_configs?.some(item => !item.needs_user_input) && (
          <details className="oa-subcard">
            <summary>查看已解析的部署配置</summary>
            <dl className="oa-cfg-ref-dl">
              {job.runtime_configs.filter(item => !item.needs_user_input).map(item => (
                <React.Fragment key={item.key}>
                  <dt><code>{item.key}</code></dt>
                  <dd><code>{item.effective_value || item.value || (item.resource_id ? '由所选资源在部署时提供' : '未设置')}</code></dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}

        {ready && requestedInputs.length > 0 && api.appSaveConfigDraft && (
          <form className="oa-subcard" aria-label="填写部署配置" onSubmit={event => { event.preventDefault(); void saveProtectedInputs() }}>
            <strong>填写部署配置</strong>
            <span className="oa-hint">在这里填写，第三步会带入这些值。部署会话可读取已填写的值。</span>
            {requestedInputs.map(item => (
              <label key={item.key} className="oa-field">
                <span className="oa-label"><code>{item.key}</code> {item.has_value ? '· 已填写' : item.required ? '· 必填' : '· 选填'}</span>
                {item.description && <span className="oa-hint">{item.description}</span>}
                <input className="oa-input" type="text"
                  value={protectedValues[item.key] ?? item.value} disabled={savingInputs} autoComplete="off"
                  placeholder={item.has_value ? '保留已填写值，或在这里替换' : '也可在第三步填写'}
                  onChange={event => { const value = event.target.value; setProtectedValues(current => ({ ...current, [item.key]: value })) }} />
              </label>
            ))}
            <div>
              <button type="submit" className="oa-btn oa-btn-sm" disabled={savingInputs || !requestedInputs.some(item => protectedValues[item.key])}>
                保存配置
              </button>
              {inputResult && <p className="oa-hint" role="status">{inputResult}</p>}
            </div>
          </form>
        )}

        {(running || !!events.length) && (
          <article className="oa-msg-row">
            <div className={`oa-avatar-badge ${running ? 'oa-pulse' : activeError ? 'danger' : 'ok'}`}>
              <AppIcon name={running ? 'sparkle' : activeError ? 'warning' : 'check'} size={14} />
            </div>
            <div className="oa-bubble">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--oa-line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    className={`oa-dot ${running ? 'oa-pulse' : ''}`}
                    style={{ background: running ? 'var(--oa-accent)' : activeError ? 'var(--oa-danger)' : 'var(--oa-ok)' }}
                  />
                  <strong style={{ fontSize: 12.5 }}>
                    {running ? 'AI 正在检查与改造应用…' : activeError ? 'AI 改造处理过程（执行中断）' : 'AI 改造处理过程记录'}
                  </strong>
                </div>
                <span className="oa-hint oa-mono">已记录 {visibleEvents.length} 项进度</span>
              </div>

              {recovering && <div role="status" className="oa-hint">AI 正在处理检查发现的问题，你的选择已保留。</div>}

              <div ref={eventsScrollRef} className="oa-timeline-list">
                {visibleEvents.map((ev, idx) => {
                  const isLatest = idx === visibleEvents.length - 1
                  return (
                    <div key={idx} className={`oa-timeline-item ${running && isLatest ? 'latest' : ''}`}>
                      <span>{running && isLatest ? '▶' : '·'}</span>
                      <span style={{ wordBreak: 'break-word', flex: 1 }}>{ev}</span>
                    </div>
                  )
                })}
                {!visibleEvents.length && running && (
                  <div className="oa-timeline-item latest">
                    <AppIcon name="refresh" size={12} className="oa-spin" />
                    <span>正在连接 AI 改造引擎与代码沙箱…</span>
                  </div>
                )}
              </div>
            </div>
          </article>
        )}

        {!!questions.length && (
          <div className="oa-msg-row">
            <div className="oa-avatar-badge warn">
              <AppIcon name="sparkle" size={14} />
            </div>
            <div className="oa-bubble" aria-label="需要你决定的事项">
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--oa-warn)' }}>
                {job?.analysisChatStarting ? '正在恢复左侧分析会话' : '请在左侧分析会话回答以下问题'}
              </div>
              {questions.map((q, i) => {
                const question = text(q)
                const decision = plan?.decisions?.find(d => d.question === question)
                return (
                  <article key={decision?.id || question} style={{ paddingTop: i > 0 ? 10 : 0, borderTop: i > 0 ? '1px solid var(--oa-line)' : 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontWeight: 600 }}>
                      {questions.length > 1 ? `${i + 1}. ` : ''}
                      {question}
                    </div>
                    {decision?.impact && <div className="oa-hint">{decision.impact}</div>}
                    {!!decision?.options?.length && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {decision.options.map(option => <li key={decisionOptionText(option)}>{decisionOptionText(option)}</li>)}
                      </ul>
                    )}
                  </article>
                )
              })}
              {!chatActive && !job?.analysisChatStarting && api.appAnalyzeWithMode && (
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => void resumeAnalysis()}>恢复左侧分析会话</button>
              )}
            </div>
          </div>
        )}

        {technicalEvents.length > 0 && (
          <details style={{ fontSize: 12, color: 'var(--oa-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>查看历史提案校验记录</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {technicalEvents.map((ev, index) => (
                <li key={index}>{isRejected(ev) ? '× ' : ''}{ev}</li>
              ))}
            </ul>
          </details>
        )}

        {activeError && (
          <div className="oa-msg-row">
            <div className="oa-avatar-badge danger">
              <AppIcon name="warning" size={14} />
            </div>
            <div role="alert" className="oa-bubble oa-alert-danger">
              <div style={{ fontWeight: 600 }}>
                {isConnectionError ? '暂时无法连接 AI 服务。' : '这次应用准备没有完成。'}
                {job?.failureStage === 'preparation' && plan
                  ? ' 已通过校验的方案已保存，可以直接重试生成交付包。'
                  : job?.status === 'failed' || job?.status === 'cancelled' ? ' 原始源码和你的选择已保留，可以继续准备。' : ' 请重试当前操作。'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(job?.status === 'review' || job?.failureStage === 'preparation') && !questions.length && (
                  <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" disabled={running} onClick={() => void prepare()}>
                    重试准备
                  </button>
                )}
                {(job?.status === 'failed' || job?.status === 'cancelled') && api.appAnalyzeWithMode && (
                  <button type="button" className={`oa-btn oa-btn-sm${job.failureStage === 'preparation' ? '' : ' oa-btn-primary'}`} disabled={running} onClick={() => void resumeAnalysis()}>
                    {job.failureStage === 'preparation' ? '让 AI 查看失败证据' : '让 AI 继续准备'}
                  </button>
                )}
              </div>
              <details style={{ fontSize: 12 }}>
                <summary style={{ cursor: 'pointer' }}>查看技术详情</summary>
                <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{activeError}</p>
              </details>
            </div>
          </div>
        )}

        {checkingProposal && !chatActive && (
          <div className="oa-bubble oa-alert-info">
            <div>当前方案已通过校验，可以生成交付包。</div>
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => void prepare()}>生成交付包</button>
          </div>
        )}

        {ready && !questions.length && !activeError && !running && (
          <div className="oa-msg-row">
            <div className="oa-avatar-badge ok">
              <AppIcon name="check" size={14} />
            </div>
            <div className="oa-bubble oa-alert-ok">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>应用改造和交付包检查已完成</div>
                  <div className="oa-hint" style={{ marginTop: 2 }}>
                    {plan?.readiness?.reason || transformation?.headline || '可以核对要部署的应用内容和配置。'}
                  </div>
                </div>
                {footerMode === 'inline' && canContinue && (
                  <button type="button" className="oa-btn oa-btn-primary" onClick={() => void next()}>
                    下一步：核对部署内容
                  </button>
                )}
              </div>

              {transformation && (
                <div className="oa-subcard" style={{ marginTop: 4 }} aria-label="第二步：应用改造完成报告">
                  <div style={{ fontWeight: 600 }}>📋 改造简报（增减与改动一览）</div>
                  <div className="oa-grid-2">
                    <div style={{ borderRadius: 8, border: '1px solid var(--oa-line)', background: 'var(--oa-paper)', padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>➕ 新增了什么（{transformation.added_files?.length || 0} 项）</div>
                      {transformation.added_files?.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--oa-muted)' }}>
                          {transformation.added_files.map((item: any) => (
                            <li key={item.path}>
                              <code className="oa-mono">{item.path}</code> · {item.reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="oa-hint">无新增文件</div>
                      )}
                    </div>
                    <div style={{ borderRadius: 8, border: '1px solid var(--oa-line)', background: 'var(--oa-paper)', padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>🔧 改造了什么（{transformation.modified_files?.length || 0} 项）</div>
                      {transformation.modified_files?.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--oa-muted)' }}>
                          {transformation.modified_files.map((item: any) => (
                            <li key={item.path}>
                              <code className="oa-mono">{item.path}</code> · {item.reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="oa-hint">未改动业务源码（零侵入交付）</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!!job?.preparationChecks?.length && (
                <div style={{ paddingTop: 6, borderTop: '1px solid var(--oa-ok-line)', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                  {job.preparationChecks.map(c => (
                    <div key={c.label}>
                      <span>{c.status === 'passed' ? '✅' : '⏳'} </span>
                      <strong>{c.label}</strong>
                      <span className="oa-hint"> · {c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="oa-review-dock">
        {handoff && (
          <div className="oa-subcard" style={{ background: 'var(--oa-paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong>已生成交接说明并复制到剪贴板</strong>
              <button type="button" className="oa-btn-link" onClick={() => setHandoff(null)}>
                关闭
              </button>
            </div>
            {handoff.source_path && <div className="oa-hint oa-mono">本机独立源码副本：{handoff.source_path}</div>}
            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--oa-accent)' }}>查看交接说明</summary>
              <pre className="oa-mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', marginTop: 6, padding: 8, background: 'var(--oa-panel)', borderRadius: 8 }}>
                {handoff.prompt}
              </pre>
            </details>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              disabled={running || (!plan && job?.status !== 'failed')}
              className="oa-btn oa-btn-sm"
              onClick={async () => {
                if (!api.appHandoff) return
                try {
                  const r = JSON.parse(await api.appHandoff(jobId, contextId)) as { prompt: string; source_path?: string }
                  setHandoff(r)
                  await navigator.clipboard?.writeText(r.prompt)
                  setCopied(true)
                } catch (e) {
                  setError(String(e))
                }
              }}
            >
              <AppIcon name="copy" size={12} />
              {copied ? '已复制交接说明' : '复制交接说明'}
            </button>
            {onReplaceSource && (
              <button type="button" disabled={running} className="oa-btn oa-btn-sm" onClick={onReplaceSource}>
                <AppIcon name="refresh" size={12} />
                已经改好了，重新导入源码
              </button>
            )}
          </div>
          {job?.analysisSessionId && job.analysisSessionId !== sessionId && (
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => job && beginAnalysisNavigation?.()?.(job)}>
              打开左侧分析会话
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
