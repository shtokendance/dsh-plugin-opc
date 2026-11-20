import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ReasoningEffortId, type ContextFormed, type LlmFailure } from '@deepseek-ai/dsh-llm'
import { analysisQuestions, AppDelivery, type AppDocument, fingerprint, worker } from './app-delivery.ts'
import { proposalParameters } from './app-proposal-schema.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'opc-app-delivery': { kind: 'opc-app-delivery' } & ContextFormed
  }
}

const ANALYSIS_TIMEOUT_MS = 15 * 60_000
const REPLY_TIMEOUT_MS = 30 * 60_000
const MAX_VALIDATION_ERRORS = 10

function loadBundledSkillText(relativePath: string): string {
  const fromSrc = fileURLToPath(new URL(`../../runtime/app_delivery/${relativePath}`, import.meta.url))
  const fromLib = fileURLToPath(new URL(`../runtime/app_delivery/${relativePath}`, import.meta.url))
  const target = import.meta.url.endsWith('/lib/index.js') ? fromLib : fromSrc
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return readFileSync(fromSrc, 'utf8')
  }
}

function normalizeDisplayPath(raw?: string): string {
  if (!raw) return ''
  let cleaned = raw.replace(/\\/g, '/')
  // Remove garbled or redundant top-level directory prefixes
  cleaned = cleaned.replace(/^[^/]+(?=\/(?:src|bff|app|lib|config|packages|server|client|api|doc|Dockerfile|package\.json))/i, '')
  // Strip non-ascii and non-chinese path segments (e.g. corrupted zip encoding bytes)
  cleaned = cleaned.replace(/^[^\s/]*[^\x00-\x7f\u4e00-\u9fa5\s/]+[^\s/]*\/+/g, '')
  return cleaned.replace(/^\/+/, '') || raw
}

function formatToolStep(action: string, rawPath?: string, language?: string): string {
  const path = normalizeDisplayPath(rawPath)
  if (action === 'inventory') return `🔍 正在扫描源码目录结构${path ? ` (${path})` : ''}`
  if (action === 'scan_routes_and_pages') return '🧭 正在全量扫描应用后端 API 路由与前端页面视图'
  if (action === 'read') return path ? `📖 正在深入分析源码文件: ${path}` : '📖 正在读取源码文件'
  if (action === 'read_failed') return path ? `🩹 正在读取上次失败部署制品文件: ${path}` : '🩹 正在读取失败部署制品'
  if (action === 'reference') return '🔍 参考标准适配契约与架构模式'
  if (action === 'read_go_dependency') return '📦 分析 Go 模块依赖契约 (go.mod)'
  if (action === 'template') return `🐳 匹配官方适配 Dockerfile 容器模板${language ? ` (${language})` : ''}`
  if (action === 'inspect_local_storage') return '💾 检测本地数据存储与持久化卷需求'
  if (action === 'propose_file') return path ? `✏️ 规划文件修改建议: ${path}` : '✏️ 规划文件修改方案'
  if (action === 'submit') return '📋 汇总技术改造方案与业务技能契约'
  return `⚡ 执行分析工具: ${action}${path ? ` (${path})` : ''}`
}

function compactPreviousPlan(proposal?: AppDocument): AppDocument | undefined {
  if (!proposal || typeof proposal !== 'object') return undefined
  const prevContract = proposal.contract ?? {}
  const compactContract: AppDocument = {}
  for (const key of [
    'schema_version', 'slug', 'name', 'description', 'base_url', 'runtime', 'build_context',
    'auth_profile', 'auth_profiles', 'auth_rules', 'auth_blockers', 'admin_account',
    'resources', 'storage_mounts', 'verification',
  ]) {
    if (key in prevContract) compactContract[key] = prevContract[key]
  }
  const profileFields = ['login_url', 'login_method', 'token_json_path', 'username_env', 'password_env', 'token_env']
  const references = (profile: AppDocument) => Object.fromEntries(
    profileFields.filter(field => typeof profile?.[field] === 'string').map(field => [field, profile[field]]),
  )
  if (compactContract.auth_profile) compactContract.auth_profile = references(compactContract.auth_profile)
  if (compactContract.auth_profiles) compactContract.auth_profiles = Object.fromEntries(
    Object.entries(compactContract.auth_profiles).map(([id, profile]) => [id, references(profile as AppDocument)]),
  )
  return {
    summary: proposal.summary,
    issues: proposal.issues ?? [],
    unresolved: [...(proposal.unresolved ?? []), ...(prevContract.unresolved ?? [])],
    decisions: proposal.decisions ?? [],
    changes: (proposal.changes ?? []).map((c: AppDocument) => ({ id: c.id, path: c.path, reason: c.reason, group: c.group })),
    contract: compactContract,
  }
}

export function attachAppAgent(ctx: Context, delivery: AppDelivery) {
  delivery.analyze = async (job, root, feedback, signal, onSessionReady) => {
    const parent = ctx.agents.get(job.session as never)
    const configured = job.modelSelection
    const selection = configured ? { provider: configured.provider, model: configured.model,
      reasoningEffort: configured.reasoningEffort ? ReasoningEffortId(configured.reasoningEffort) : undefined }
      : parent?.model.current() ?? parent?.session.requestHeader()?.config
    const appCtxId = delivery.core.auth.contexts.applicationContextId!
    const isRepair = Boolean(job.failedRevision || job.failedSnapshot || job.failureContext || job.analysisMode === 'repair')
    const port = job.port ?? 8080
    const portLocked = job.portAuto !== true
    const skill = loadBundledSkillText('SKILL.md')
    const repairInstructions = isRepair
      ? '\n修复失败部署时，先核对失败阶段和日志，用 read_failed 读取实际失败制品并与原源码比对。只修正根因，提交完整替换文件。'
      : ''
    const portInstructions = portLocked
      ? `本任务锁定的容器端口为 ${port}。`
      : `容器端口策略：优先识别并沿用应用自身默认监听端口（从源码、现有 Dockerfile 或真实配置文件核实）；若应用无默认端口（或依赖外部注入 PORT 且无兜底值），则使用 OPC 默认端口 ${port}。${job.upgrade ? `本次为升级部署，如新版未变更端口优先沿用线上当前端口 ${port}。` : ''}容器内必须监听 0.0.0.0（禁止监听 127.0.0.1），且契约 configs 中的 PORT 必须与 runtime.port 一致，不要引用 *.example 示例文件中冲突的 PORT 或占位密钥。`
    const instructions = `${skill}\n${portInstructions}${repairInstructions}`
    const prevPlan = compactPreviousPlan(job.proposal)
    const taskInstruction = '按四步完成本次应用改造。' + (isRepair
      ? '先用失败制品核实根因。'
      : (prevPlan && feedback.trim()) ? '结合用户补充复核上一版方案。' : '')

    const timeout = new AbortController()
    const abort = AbortSignal.any([signal, timeout.signal])
    let deadline: ReturnType<typeof setTimeout> | undefined
    const setDeadline = (ms: number) => {
      clearTimeout(deadline)
      deadline = setTimeout(() => timeout.abort(new Error('AI 分析超时，原源码和已有回答已保留。请继续准备。')), ms)
      deadline.unref()
    }
    let wakeReply: (() => void) | undefined
    let replyCount = 0
    const sessionReady = Promise.withResolvers<boolean>()
    const validationErrors: string[] = []
    const rejectedProposals = new Set<string>()
    let repeatedProposal = false
    let draftFileChanges: { id?: string; path?: string; reason?: string }[] = []
    try {
      const draftsRaw = JSON.parse(readFileSync(join(root, 'draft_files.json'), 'utf8'))
      if (draftsRaw && typeof draftsRaw === 'object') {
        draftFileChanges = Object.values(draftsRaw).map((c: any) => ({ id: c?.id, path: c?.path, reason: c?.reason }))
      }
    } catch { /* no staged draft files yet */ }
    const agentOptions = selection
      ? { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
      : { ...parent?.options }
    const options: Omit<CreateAgentOptions, 'sessionId' | 'meta'> = {
      agentOptions,
      signal: abort,
      setup(child) {
        child.tools.restrict({ allow: [] })
        child.systemPrompt.section({ name: 'opc-delivery', order: 1, text: instructions, complete: true, interpolate: false })
        child.on('agent/pre-step', async ({ signal: turnSignal }, next) => {
          const decision = await next()
          if (decision.kind !== 'enter' || !decision.messages.length) return decision
          const messages = []
          for (const message of decision.messages) {
            if (message.source.kind !== 'user' || !('rpcId' in message.source)) {
              messages.push(message)
              continue
            }
            const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim()
            if (!text || !await sessionReady.promise) continue
            const safeText = await delivery.recordAnalysisReply(job, root, text, AbortSignal.any([abort, turnSignal]))
            validationErrors.length = 0
            rejectedProposals.clear()
            repeatedProposal = false
            replyCount++
            messages.push({ ...message, content: [{ type: 'text' as const, text: safeText }] })
            wakeReply?.()
          }
          return messages.length ? { ...decision, messages } : { kind: 'reject' }
        })
        const output = { schema: { type: 'string' as const }, render: (_: unknown, value: string) => [{ type: 'text' as const, text: value }] }
        child.tools.register(defineTool({ name: 'opc_delivery_inspect', description: '只读分析应用：action 支持 inventory / scan_routes_and_pages / read / read_failed / reference / template / inspect_local_storage / read_go_dependency。read_failed 读取上次实际部署包；template 传 language 和 version；read 传 path（可选 proposed=true 读取已暂存修改版本）；reference 传 name（contract.md/framework-checks.md/preparation-checks.md/integration.md）。',
          parameters: {
            action: { type: 'string', required: true },
            path: { type: 'string' },
            proposed: { type: 'boolean' },
            language: { type: 'string' },
            version: { type: 'string' },
            name: { type: 'string' },
            module: { type: 'string' },
            start: { type: 'number' },
          }, output,
          async execute(args) {
            const allowedActions = [
              'inventory',
              'scan_routes_and_pages',
              'read',
              'read_failed',
              'reference',
              'template',
              'inspect_local_storage',
              'read_go_dependency',
            ]
            if (!allowedActions.includes(args.action)) throw new Error('只允许读取源码与规范')
            job.events.push(formatToolStep(args.action, args.path, args.language))
            delivery.core.emit('change')
            if (args.action === 'template') {
              abort.throwIfAborted()
              const result = await delivery.platform('/dockerfile-templates', appCtxId, { query: { language: args.language ?? '', version: args.version ?? '' } })
              abort.throwIfAborted()
              return JSON.stringify(result.matched_template ?? null)
            }
            return JSON.stringify(await worker({ ...args, root, revision: job.failedRevision || job.revision }, abort))
          } }))
        child.tools.register(defineTool({ name: 'opc_delivery_propose_file', description: '暂存根目录 Dockerfile 或现有应用代码的必要改动。禁止新增或改写 ENV 环境变量默认值，禁止新增健康检查接口。原配置由用户维护。暂存文件在 opc_delivery_submit 的 changes 中按 id 和 path 引用。',
          parameters: {
            id: { type: 'string', required: true },
            path: { type: 'string', required: true },
            reason: { type: 'string', required: true },
            content: { type: 'string', required: true },
            executable: { type: 'boolean' },
            group: { type: 'string' },
          }, output,
          async execute(args) {
            if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
            job.events.push(formatToolStep('propose_file', args.path))
            delivery.core.emit('change')
            const res = await worker({ action: 'propose_file', root, ...args }, abort)
            return JSON.stringify(res)
          } }))
        child.tools.register(defineTool({ name: 'opc_delivery_submit', description: '以结构化字段提交完整改造提案。若已暂存文件，changes 可仅传 {id, path, reason, group}。旧版可用 proposal JSON 字符串。',
          parameters: proposalParameters(port, portLocked), output,
          async execute(args) {
            if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
            if (repeatedProposal || validationErrors.length >= MAX_VALIDATION_ERRORS) throw new Error('技术方案连续校验未通过，已停止自动重试')
            job.events.push(formatToolStep('submit'))
            delivery.core.emit('change')
            let candidate: AppDocument | undefined
            try {
              const { proposal, ...fields } = args
              candidate = proposal ? JSON.parse(proposal) : { issues: [], unresolved: [], changes: [], decisions: [], ...fields }
              if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('提案必须是完整的 JSON 对象')
              if (candidate && typeof candidate.contract === 'object' && candidate.contract !== null) {
                candidate.contract = { ...candidate.contract, slug: job.slug, base_url: job.url }
              }
              await delivery.submit(job, root, candidate!, abort)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              const detail = await worker({ action: 'redact_feedback', root, text: message.slice(0, 2000) }, abort)
              validationErrors.push(detail)
              job.analysisFailure = detail
              if (candidate) {
                const rej = fingerprint({
                  contract: candidate.contract,
                  issues: candidate.issues,
                  changes: candidate.changes,
                  unresolved: candidate.unresolved,
                  decisions: candidate.decisions,
                  reason: detail,
                })
                if (rejectedProposals.has(rej)) {
                  repeatedProposal = true
                  cancel()
                }
                rejectedProposals.add(rej)
              }
              job.events.push(`提案校验未通过：${detail}`)
              delivery.core.emit('change')
              if (validationErrors.length === MAX_VALIDATION_ERRORS) cancel()
              throw new Error(detail)
            }
            const questions = analysisQuestions(job.proposal)
            return questions.length
              ? `方案已保存，等待用户回复。请在当前对话中列出待确认的问题与可选方案，再结束本轮：\n${questions.join('\n')}`
              : '完整方案已通过校验。请简要说明结果并结束本轮，OPC 将自动生成交付包。'
          } }))
      },
    }
    // Always bind analysis turns to a fresh Session ID instead of resuming a disposed one:
    // DSH client marks disposed sessions as removed ("会话不可用") permanently.
    // taskContext already carries previous_plan, draft_file_changes, and user_answers.
    const analysis = await ctx.agents.create({
      ...options, sessionId: randomUUID() as never, meta: { cwd: root },
    })
    const turnOutcome: { failure?: LlmFailure; truncated?: boolean; stopped?: boolean } = {}
    const getTurnOutcome = () => ({ ...turnOutcome })
    const stopObserving = ctx.on('session/event', (session, event) => {
      if (session !== analysis.agent.session || event.type !== 'turn/end') return
      const reason = event.data.reason
      turnOutcome.failure = reason.kind === 'error' ? reason.error : undefined
      turnOutcome.truncated = reason.kind === 'max-tokens'
      turnOutcome.stopped = reason.kind === 'aborted' && reason.reason.kind === 'user'
    })
    const cancel = () => { analysis.agent.cancel({ kind: 'user' }) }
    const onAbort = () => {
      sessionReady.resolve(false)
      cancel()
      wakeReply?.()
    }
    abort.addEventListener('abort', onAbort, { once: true })
    const send = (text: string) => {
      analysis.agent.followup({
        id: randomUUID() as never,
        role: 'user',
        source: { kind: 'user' },
        content: [{
          type: 'text',
          text,
        }],
      })
    }
    try {
      abort.throwIfAborted()
      setDeadline(ANALYSIS_TIMEOUT_MS)
      const previous = (job.published || job.upgrade)
        ? await delivery.platform('/' + job.slug, appCtxId).catch(() => undefined)
        : undefined
      const runtimeLogs = job.published
        ? await delivery.platform('/' + job.slug + '/logs', appCtxId).catch(() => undefined)
        : undefined
      const rawResources = await delivery.platform('/resources', appCtxId).catch(() => ({ resources: [] }))
      const filteredRes = await worker({
        action: 'filter_resources',
        root,
        resources: rawResources?.resources ?? [],
        slug: job.slug,
        default_only: true,
      }, abort).catch(() => ({ resources: [] }))

      if (isRepair || (job.published && (previous?.error_message || previous?.build_log || runtimeLogs?.runtime_logs))) {
        const mergedFailure = [
          job.failureContext,
          previous?.error_message,
          previous?.build_log?.slice(-8000),
          runtimeLogs?.runtime_logs?.slice(-4000),
        ].filter(Boolean).join('\n')
        if (mergedFailure) {
          job.failureContext = await worker({ action: 'redact_feedback', root, text: mergedFailure.slice(-24_000) }, abort)
        }
      }

      const deployedBaseline = job.upgrade && previous ? {
        current_version: previous.current_version,
        container_port: previous.container_port,
        language: previous.language,
        runtime_version: previous.runtime_version,
        storage_mounts: Array.isArray(previous.storage_mounts)
          ? previous.storage_mounts.map((m: AppDocument) => ({
            id: m.id,
            kind: m.kind,
            container_path: m.container_path,
            resource_id: m.resource_id,
            seed_subpath: m.seed_subpath,
            description: m.description,
          }))
          : [],
        resource_ids: Array.isArray(previous.resource_ids) ? previous.resource_ids : [],
        config_keys: Array.isArray(previous.app_config)
          ? previous.app_config.map((c: AppDocument) => ({
            key: c.key,
            has_value: Boolean(c.has_value || c.value || c.resource_id),
            resource_id: c.resource_id || undefined,
          }))
          : [],
      } : undefined

      abort.throwIfAborted()
      const waitingForReply = job.status === 'review' && analysisQuestions(job.proposal).length > 0
      const taskContext = JSON.stringify({
        name: job.name,
        description: job.description ?? '',
        slug: job.slug,
        base_url: job.url,
        container_port: port,
        port_policy: portLocked ? 'locked' : 'prefer_app_default_else_opc_default',
        default_container_port: port,
        upgrade: Boolean(job.upgrade),
        deployed_baseline: deployedBaseline,
        available_resource_metadata: (filteredRes?.resources ?? []).map((resource: AppDocument) => ({
          id: resource.id,
          name: resource.name,
          type: resource.type,
          is_default: resource.is_default,
          env_keys: resource.env_keys,
          supports_auto_migration: resource.supports_auto_migration,
        })),
        user_answers: job.feedbackHistory || feedback,
        previous_validation_failure: job.analysisFailure ?? '',
        draft_file_changes: draftFileChanges,
        analysis_mode: isRepair ? 'repair' : 'analysis',
        existing_deployment: Boolean(job.upgrade || job.published),
        previous_plan: prevPlan,
        failed_snapshot: job.failedSnapshot,
        failure_log: job.failureContext ?? '',
        task: waitingForReply ? '请结合 previous_plan 中的待确认事项处理接下来收到的用户回复。' : taskInstruction,
      })
      analysis.agent.inject({
        id: randomUUID() as never,
        role: 'user',
        source: { kind: 'opc-app-delivery', form: 'notice', summary: 'OPC 应用改造任务已载入' },
        content: [{ type: 'text', text: taskContext }],
      })
      const pendingQuestions = waitingForReply ? analysisQuestions(job.proposal) : []
      if (pendingQuestions.length > 0) {
        analysis.agent.inject({
          id: randomUUID() as never,
          role: 'user',
          source: { kind: 'opc-app-delivery', form: 'notice', summary: `等待确认的问题：${pendingQuestions.join('；')}` },
          content: [{ type: 'text', text: pendingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n') }],
        })
      }
      await onSessionReady(String(analysis.agent.session.id))
      sessionReady.resolve(true)
      let prompt = '请开始准备应用。'
      for (let attempt = 0; ; attempt++) {
        turnOutcome.failure = undefined
        turnOutcome.truncated = false
        turnOutcome.stopped = false
        const repliesBeforeTurn = replyCount
        let errorMessage = ''
        try {
          if (job.status === 'review') {
            if (!analysisQuestions(job.proposal).length) return
            setDeadline(REPLY_TIMEOUT_MS)
            if (!abort.aborted) await new Promise<void>(resolve => { wakeReply = resolve })
            wakeReply = undefined
            signal.throwIfAborted()
            if (abort.aborted && replyCount === repliesBeforeTurn) return
            abort.throwIfAborted()
            setDeadline(ANALYSIS_TIMEOUT_MS)
          } else {
            abort.throwIfAborted()
            send(prompt)
          }
          await analysis.agent.whenIdle()
        } catch (err) {
          if (signal.aborted || (abort.aborted && !repeatedProposal)) throw err
          errorMessage = err instanceof Error ? err.message : String(err)
        }
        if (job.status === 'review') {
          if (!analysisQuestions(job.proposal).length) return
          attempt = -1
          continue
        }
        if (repeatedProposal || validationErrors.length >= MAX_VALIDATION_ERRORS) {
          throw new Error(validationErrors.at(-1) ?? '技术方案连续校验未通过，已停止自动重试')
        }
        abort.throwIfAborted()
        const { failure, truncated, stopped } = getTurnOutcome()
        if (stopped) throw new Error('已停止 AI 分析，原源码和已有回答已保留。')
        if (replyCount !== repliesBeforeTurn) attempt = 0
        const providerMessage = failure?.message ?? errorMessage
        const badToolJson = /tool input is invalid JSON/i.test(providerMessage)
        const invalidOutput = badToolJson || truncated
        const networkError = /(?:timed?\s*out|timeout|connection\s*reset|ECONNRESET|ETIMEDOUT|fetch failed|network|terminated)/i.test(providerMessage)
        const reason = invalidOutput
          ? (badToolJson ? '模型返回的工具参数不是合法 JSON' : '模型输出达到长度上限')
          : providerMessage
            ? await worker({ action: 'redact_feedback', root, text: providerMessage.slice(0, 2000) }, abort)
            : validationErrors.at(-1) || 'AI 尚未提交完整提案'
        job.analysisFailure = reason
        if (providerMessage && !invalidOutput && !networkError) throw new Error(reason)
        if (attempt === 2) {
          if (/(?:timed?\s*out|timeout|AI.*超时)/i.test(reason)) {
            throw new Error('AI 分析超时，原源码和已有回答已保留。请重试分析。')
          }
          if (/(?:connection\s*error|connection\s*reset|connect\s*timeout|ECONNRESET|ETIMEDOUT|fetch failed)/i.test(reason)) {
            throw new Error('AI 服务连接中断，原源码和已有回答已保留。请检查模型连接后重新分析。')
          }
          throw new Error(reason)
        }
        job.events.push(invalidOutput
          ? `🔄 ${reason}，正在缩短提交内容后重试（${attempt + 1}/2）`
          : networkError ? `🔄 AI 服务暂时中断，正在继续准备（${attempt + 1}/2）`
          : `🔄 正在修正应用准备检查（${attempt + 1}/2）`)
        delivery.core.emit('change')
        prompt = `修正校验反馈后按技能要求重提方案：${reason}`
      }
    } finally {
      sessionReady.resolve(false)
      clearTimeout(deadline)
      stopObserving()
      abort.removeEventListener('abort', onAbort)
      await analysis.dispose()
    }
  }
  ctx.effect(() => () => { delivery.analyze = undefined })
}
