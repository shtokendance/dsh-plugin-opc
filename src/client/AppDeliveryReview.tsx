import React, { useEffect, useRef, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppDiscoveryReport } from './AppDiscoveryReport.tsx'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { translatePair, useI18n, type ClientLocale } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'

type DimensionMeta = {
  label: string
  subTitle: string
  icon: AppIconName
  pillClass: string
}

function getDimensionMeta(tag: string, locale: ClientLocale): DimensionMeta {
  const t = tag.trim()
  if (/应用定位|业务用途|项目用途|定位/.test(t)) {
    return { label: translatePair(locale, '应用定位', 'Positioning'), subTitle: translatePair(locale, '业务用途与定位', 'Business Purpose'), icon: 'sparkle', pillClass: 'oa-pill-accent' }
  }
  if (/运行环境|技术栈|开发语言|运行时|环境/.test(t)) {
    return { label: translatePair(locale, '运行环境', 'Runtime'), subTitle: translatePair(locale, '开发语言与技术栈', 'Language & Stack'), icon: 'code', pillClass: 'oa-pill-teal' }
  }
  if (/接口与页面|页面与接口|页面与业务视图|视图与路由/.test(t)) {
    return { label: translatePair(locale, '接口与页面', 'APIs & Pages'), subTitle: translatePair(locale, '全景契约与视图', 'Contract & Views'), icon: 'table', pillClass: 'oa-pill-warn' }
  }
  if (/后端\s*API|API\s*接口|服务接口|接口清单/.test(t)) {
    return { label: translatePair(locale, '后端接口', 'Backend APIs'), subTitle: translatePair(locale, 'API 接口全景', 'API Overview'), icon: 'plug', pillClass: 'oa-pill-accent' }
  }
  if (/页面与视图|页面清单|业务视图/.test(t)) {
    return { label: translatePair(locale, '页面视图', 'Pages & Views'), subTitle: translatePair(locale, '业务视图全景', 'View Overview'), icon: 'table', pillClass: 'oa-pill-warn' }
  }
  if (/登录与鉴权|鉴权与安全|安全凭据|权限与凭据/.test(t)) {
    return { label: translatePair(locale, '登录与鉴权', 'Auth & Security'), subTitle: translatePair(locale, '权限与安全策略', 'Permissions & Auth'), icon: 'shield', pillClass: 'oa-pill-ok' }
  }
  if (/数据与存储|存储与数据库|持久化|数据库/.test(t)) {
    return { label: translatePair(locale, '数据与存储', 'Data & Storage'), subTitle: translatePair(locale, '数据存储与持久化', 'Storage & Persistence'), icon: 'archive', pillClass: '' }
  }
  return { label: t, subTitle: translatePair(locale, '分析明细', 'Analysis Details'), icon: 'diamond', pillClass: '' }
}

function renderFormattedSummary(rawText: string, locale: ClientLocale) {
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
                const meta = getDimensionMeta(item.tag, locale)
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
  const { locale, tr } = useI18n()
  const [job, setJob] = useState<AppDeliveryJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [dismissedError, setDismissedError] = useState('')
  const [handoff, setHandoff] = useState<{ prompt: string; source_path?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [protectedValues, setProtectedValues] = useState<Record<string, string>>({})
  const [savingInputs, setSavingInputs] = useState(false)
  const [inputResult, setInputResult] = useState('')
  useEffect(() => {
    setProtectedValues({})
    setInputResult('')
    setDismissedError('')
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
      setInputResult(tr('已保存，第三步可核对或替换。', 'Saved; you can review or replace it in Step 3.'))
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
      if (result.status !== 'ready') setError(result.error || tr('交付包生成未完成', 'Delivery bundle preparation incomplete'))
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
        throw new Error(tr('应用或配置已变化，请先处理当前问题。', 'App or configuration has changed. Please resolve the current issue first.'))
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
    ? job?.status === 'preparing' ? tr('正在生成交付包', 'Preparing delivery bundle') : tr('AI 正在检查和改造', 'AI is inspecting and adapting')
    : activeError
      ? tr('应用准备暂停', 'App preparation paused')
      : questions.length
        ? tr('有 {count} 件事需要你决定', '{count} decision(s) needed', { count: questions.length })
        : checkingProposal
          ? tr('改造方案已通过校验', 'Proposal validated')
          : ready
            ? tr('交付包已生成，可以核对部署内容', 'Delivery bundle ready for review')
            : tr('正在读取应用', 'Loading application')

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
      <NoticeModal
        open={Boolean(activeError) && dismissedError !== activeError}
        variant="error"
        title={isConnectionError ? tr('暂时无法连接 AI 服务', 'Unable to connect to AI service') : tr('应用准备暂停', 'App preparation paused')}
        message={activeError}
        onClose={() => {
          setError('')
          setLoadError('')
          setDismissedError(activeError)
        }}
        actions={
          <>
            {(job?.status === 'review' || job?.failureStage === 'preparation') && !questions.length && (
              <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" disabled={running} onClick={() => { setDismissedError(activeError); void prepare() }}>
                {tr('重试准备', 'Retry preparation')}
              </button>
            )}
            {(job?.status === 'failed' || job?.status === 'cancelled') && api.appAnalyzeWithMode && (
              <button type="button" className={`oa-btn oa-btn-sm${job.failureStage === 'preparation' ? '' : ' oa-btn-primary'}`} disabled={running} onClick={() => { setDismissedError(activeError); void resumeAnalysis() }}>
                {job.failureStage === 'preparation' ? tr('让 AI 查看失败证据', 'Let AI inspect failure') : tr('让 AI 继续准备', 'Let AI continue')}
              </button>
            )}
          </>
        }
      />

      {(repairMode || job?.analysis_mode === 'repair' || job?.analysisMode === 'repair') && (
        <div className="oa-alert oa-alert-warn" style={{ margin: '12px 14px 0' }} aria-label={tr('部署失败修复状态', 'Repair status')}>
          <strong>{running ? tr('正在诊断失败并核对修复', 'Diagnosing failure and verifying fix') : ready ? tr('修复包已生成，等待部署验证', 'Fix bundle ready, awaiting deployment') : tr('部署失败专项修复', 'Deployment failure repair')}</strong>
          <span>{tr('对照失败制品与原始源码，保留业务和已有配置。提案、语法检查、服务器启动和业务验证分别记录。', 'Comparing failed artifacts with original source while preserving business logic and existing config.')}</span>
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
              <span className="oa-pill">{tr('第 {rev} 轮 · {name}', 'Round {rev} · {name}', { rev: revNum, name: job?.name || tr('准备应用', 'Preparing app') })}</span>
            </div>
            <p className="oa-hint" style={{ margin: '3px 0 0' }}>
              {chatActive
                ? tr('请在左侧分析会话的聊天框回复。AI 要求填写管理员账号时，也在这里回复。', 'Reply in the left analysis chat box, including admin account prompts from AI.')
                : ready
                  ? tr('交付包检查已完成。服务器构建、启动与业务访问将在部署时验证。', 'Delivery bundle check complete. Server build, startup, and access will be verified on deploy.')
                  : null}
            </p>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="oa-review-stream" aria-label={tr('应用改造进度与结果', 'Adaptation progress and results')}>
        {summaries.map((m, i) => (
          <article key={i} className="oa-msg-row">
            <div className="oa-avatar-badge">
              <AppIcon name="sparkle" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="oa-hint" style={{ marginBottom: 4 }}>{tr('第 {rev} 轮改造摘要', 'Round {rev} adaptation summary', { rev: m.revision || revNum })}</div>
              <div className="oa-bubble">{renderFormattedSummary(m.text, locale)}</div>
            </div>
          </article>
        ))}

        {!summaries.length && plan?.summary && (
          <article className="oa-msg-row">
            <div className="oa-avatar-badge">
              <AppIcon name="sparkle" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="oa-hint" style={{ marginBottom: 4 }}>{tr('AI 改造助手 · 第 {rev} 轮分析', 'AI Assistant · Round {rev} analysis', { rev: revNum })}</div>
              <div className="oa-bubble">{renderFormattedSummary(plan.summary, locale)}</div>
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
            <summary>{tr('查看已解析的部署配置', 'View resolved deployment configs')}</summary>
            <dl className="oa-cfg-ref-dl">
              {job.runtime_configs.filter(item => !item.needs_user_input).map(item => (
                <React.Fragment key={item.key}>
                  <dt><code>{item.key}</code></dt>
                  <dd><code>{item.effective_value || item.value || (item.resource_id ? tr('由所选资源在部署时提供', 'Provided by selected resource on deploy') : tr('未设置', 'Unset'))}</code></dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}

        {ready && requestedInputs.length > 0 && api.appSaveConfigDraft && (
          <form className="oa-subcard" aria-label={tr('填写部署配置', 'Fill Deployment Config')} onSubmit={event => { event.preventDefault(); void saveProtectedInputs() }}>
            <strong>{tr('填写部署配置', 'Fill Deployment Config')}</strong>
            <span className="oa-hint">{tr('在这里填写，第三步会带入这些值。部署会话可读取已填写的值。', 'Values entered here carry over to Step 3 and are readable by the deployment session.')}</span>
            {requestedInputs.map(item => (
              <label key={item.key} className="oa-field">
                <span className="oa-label"><code>{item.key}</code> {item.has_value ? tr('· 已填写', '· Filled') : item.required ? tr('· 必填', '· Required') : tr('· 选填', '· Optional')}</span>
                {item.description && <span className="oa-hint">{item.description}</span>}
                <input className="oa-input" type="text"
                  value={protectedValues[item.key] ?? item.value} disabled={savingInputs} autoComplete="off"
                  placeholder={item.has_value ? tr('保留已填写值，或在这里替换', 'Keep existing value or replace here') : tr('也可在第三步填写', 'Can also be filled in Step 3')}
                  onChange={event => { const value = event.target.value; setProtectedValues(current => ({ ...current, [item.key]: value })) }} />
              </label>
            ))}
            <div>
              <button type="submit" className="oa-btn oa-btn-sm" disabled={savingInputs || !requestedInputs.some(item => protectedValues[item.key])}>
                {tr('保存配置', 'Save Config')}
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
                    {running ? tr('AI 正在检查与改造应用…', 'AI is inspecting and adapting the app...') : activeError ? tr('AI 改造处理过程（执行中断）', 'AI adaptation process (interrupted)') : tr('AI 改造处理过程记录', 'AI adaptation process log')}
                  </strong>
                </div>
                <span className="oa-hint oa-mono">{tr('已记录 {count} 项进度', '{count} event(s)', { count: visibleEvents.length })}</span>
              </div>

              {recovering && <div role="status" className="oa-hint">{tr('AI 正在处理检查发现的问题，你的选择已保留。', 'AI is resolving issues found during inspection; your choices are preserved.')}</div>}

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
                    <span>{tr('正在连接 AI 改造引擎与代码沙箱…', 'Connecting to AI adaptation engine and sandbox...')}</span>
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
            <div className="oa-bubble" aria-label={tr('需要你决定的事项', 'Decisions required')}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--oa-warn)' }}>
                {job?.analysisChatStarting ? tr('正在恢复左侧分析会话', 'Resuming analysis session') : tr('请在左侧分析会话回答以下问题', 'Please answer these questions in the left analysis chat')}
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
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => void resumeAnalysis()}>{tr('恢复左侧分析会话', 'Resume Analysis Chat')}</button>
              )}
            </div>
          </div>
        )}

        {technicalEvents.length > 0 && (
          <details style={{ fontSize: 12, color: 'var(--oa-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>{tr('查看历史提案校验记录', 'View proposal validation history')}</summary>
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
                {isConnectionError ? tr('暂时无法连接 AI 服务。', 'Unable to connect to AI service.') : tr('这次应用准备没有完成。', 'App preparation did not complete.')}
                {job?.failureStage === 'preparation' && plan
                  ? tr(' 已通过校验的方案已保存，可以直接重试生成交付包。', ' Validated proposal saved; you can retry preparing the bundle.')
                  : job?.status === 'failed' || job?.status === 'cancelled'
                    ? tr(' 原始源码和你的选择已保留，可以继续准备。', ' Original source and choices are preserved.')
                    : tr(' 请重试当前操作。', ' Please retry the current operation.')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(job?.status === 'review' || job?.failureStage === 'preparation') && !questions.length && (
                  <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" disabled={running} onClick={() => void prepare()}>
                    {tr('重试准备', 'Retry preparation')}
                  </button>
                )}
                {(job?.status === 'failed' || job?.status === 'cancelled') && api.appAnalyzeWithMode && (
                  <button type="button" className={`oa-btn oa-btn-sm${job.failureStage === 'preparation' ? '' : ' oa-btn-primary'}`} disabled={running} onClick={() => void resumeAnalysis()}>
                    {job.failureStage === 'preparation' ? tr('让 AI 查看失败证据', 'Let AI inspect failure') : tr('让 AI 继续准备', 'Let AI continue')}
                  </button>
                )}
              </div>
              <details style={{ fontSize: 12 }}>
                <summary style={{ cursor: 'pointer' }}>{tr('查看技术详情', 'View technical details')}</summary>
                <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{activeError}</p>
              </details>
            </div>
          </div>
        )}

        {checkingProposal && !chatActive && (
          <div className="oa-bubble oa-alert-info">
            <div>{tr('当前方案已通过校验，可以生成交付包。', 'Proposal validated. Ready to generate delivery bundle.')}</div>
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => void prepare()}>{tr('生成交付包', 'Generate Bundle')}</button>
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
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tr('应用改造和交付包检查已完成', 'Adaptation and bundle verification complete')}</div>
                  <div className="oa-hint" style={{ marginTop: 2 }}>
                    {plan?.readiness?.reason || transformation?.headline || tr('可以核对要部署的应用内容和配置。', 'Ready to review deployment contents and config.')}
                  </div>
                </div>
                {footerMode === 'inline' && canContinue && (
                  <button type="button" className="oa-btn oa-btn-primary" onClick={() => void next()}>
                    {tr('下一步：核对部署内容', 'Next: Review Deployment')}
                  </button>
                )}
              </div>

              {transformation && (
                <div className="oa-subcard" style={{ marginTop: 4 }} aria-label={tr('第二步：应用改造完成报告', 'Step 2: Adaptation Report')}>
                  <div style={{ fontWeight: 600 }}>{tr('📋 改造简报（增减与改动一览）', 'Adaptation Summary')}</div>
                  <div className="oa-grid-2">
                    <div style={{ borderRadius: 8, border: '1px solid var(--oa-line)', background: 'var(--oa-paper)', padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{tr('➕ 新增了什么（{count} 项）', 'Added ({count})', { count: transformation.added_files?.length || 0 })}</div>
                      {transformation.added_files?.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--oa-muted)' }}>
                          {transformation.added_files.map((item: any) => (
                            <li key={item.path}>
                              <code className="oa-mono">{item.path}</code> · {item.reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="oa-hint">{tr('无新增文件', 'No added files')}</div>
                      )}
                    </div>
                    <div style={{ borderRadius: 8, border: '1px solid var(--oa-line)', background: 'var(--oa-paper)', padding: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{tr('🔧 改造了什么（{count} 项）', 'Modified ({count})', { count: transformation.modified_files?.length || 0 })}</div>
                      {transformation.modified_files?.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--oa-muted)' }}>
                          {transformation.modified_files.map((item: any) => (
                            <li key={item.path}>
                              <code className="oa-mono">{item.path}</code> · {item.reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="oa-hint">{tr('未改动业务源码（零侵入交付）', 'No source code modified (zero-intrusion delivery)')}</div>
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
              <strong>{tr('已生成交接说明并复制到剪贴板', 'Handoff prompt generated and copied to clipboard')}</strong>
              <button type="button" className="oa-btn-link" onClick={() => setHandoff(null)}>
                {tr('关闭', 'Close')}
              </button>
            </div>
            {handoff.source_path && <div className="oa-hint oa-mono">{tr('本机独立源码副本：', 'Local source copy: ')}{handoff.source_path}</div>}
            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--oa-accent)' }}>{tr('查看交接说明', 'View handoff prompt')}</summary>
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
              {copied ? tr('已复制交接说明', 'Copied handoff') : tr('复制交接说明', 'Copy handoff')}
            </button>
            {onReplaceSource && (
              <button type="button" disabled={running} className="oa-btn oa-btn-sm" onClick={onReplaceSource}>
                <AppIcon name="refresh" size={12} />
                {tr('已经改好了，重新导入源码', 'Changes done, re-import source')}
              </button>
            )}
          </div>
          {job?.analysisSessionId && job.analysisSessionId !== sessionId && (
            <button type="button" className="oa-btn oa-btn-sm" onClick={() => job && beginAnalysisNavigation?.()?.(job)}>
              {tr('打开左侧分析会话', 'Open Left Analysis Chat')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
