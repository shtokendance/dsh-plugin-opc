import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ReasoningEffortId, type ContextFormed, type LlmFailure } from '@deepseek-ai/dsh-llm'
import { analysisQuestions, AppDelivery, type AppDocument, fingerprint, worker } from './app-delivery.ts'
import { deliveryDataStrategies, proposalParameters } from './app-proposal-schema.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'opc-app-delivery': { kind: 'opc-app-delivery' } & ContextFormed
  }
}

const ANALYSIS_TIMEOUT_MS = 15 * 60_000
const REPLY_TIMEOUT_MS = 30 * 60_000
const MAX_REPEATED_VALIDATION_ERRORS = 3
const MAX_VALIDATION_FAILURES = 12

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
  if (action === 'read_current_proposal') return '📋 正在读取当前已提交方案'
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
    'resources', 'storage_mounts', 'verification', 'data_plan',
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
    readiness: proposal.readiness,
    issues: proposal.issues ?? [],
    unresolved: [...(proposal.unresolved ?? []), ...(prevContract.unresolved ?? [])],
    decisions: proposal.decisions ?? [],
    changes: (proposal.changes ?? []).map((c: AppDocument) => ({ id: c.id, path: c.path, reason: c.reason, group: c.group })),
    contract: compactContract,
  }
}

interface AnalysisRound {
  tools: Map<string, ToolDefinition>
  reply(text: string, signal: AbortSignal): Promise<string>
  ready: Promise<boolean>
}

interface AnalysisSession {
  handle?: AgentHandle
  round?: AnalysisRound
}

interface DeliveryObservation {
  kind: string
  target?: string
  request_id: string
  result: AppDocument
}

function readCurrentProposal(proposal: AppDocument | undefined, path = '', start = 1) {
  if (!proposal) return { available: false }
  let value: unknown = proposal
  for (const section of path ? path.split('.') : []) {
    if (!section || !value || typeof value !== 'object' || !Object.hasOwn(value, section)) {
      throw new Error(`当前方案没有字段 ${path}`)
    }
    value = (value as AppDocument)[section]
  }
  const json = JSON.stringify(value, null, 2) ?? 'null'
  if (!Number.isSafeInteger(start) || start < 1) throw new Error('start 必须是从 1 开始的字符位置')
  const end = start + 20_000
  return { path, start, text: json.slice(start - 1, end - 1), next_start: end <= json.length ? end : undefined }
}

export function attachAppAgent(ctx: Context, delivery: AppDelivery) {
  const sessions = new Map<string, AnalysisSession>()
  delivery.analyze = async (job, root, feedback, signal, onSessionReady, fromChat, assessment) => {
    const parent = ctx.agents.get(job.session as never)
    const configured = job.modelSelection
    const selection = configured ? { provider: configured.provider, model: configured.model,
      reasoningEffort: configured.reasoningEffort ? ReasoningEffortId(configured.reasoningEffort) : undefined }
      : job.analysisSessionId ? undefined : parent?.model.current() ?? parent?.session.requestHeader()?.config
    if (!selection && !job.analysisSessionId) throw new Error('请在当前会话选择此次应用交付使用的 AI 模型')
    const appCtxId = delivery.core.auth.contexts.applicationContextId!
    const isRepair = Boolean(job.failedRevision || job.failedSnapshot || job.failureContext || job.analysisMode === 'repair')
    const port = job.port ?? 8080
    const portLocked = job.portAuto !== true
    const updating = job.deliveryMode ? job.deliveryMode === 'update' : Boolean(job.upgrade)
    const skill = loadBundledSkillText(updating ? 'UPDATE.md' : 'SKILL.md')
    const inspectActions = [
      'inventory', 'scan_routes_and_pages', 'read', 'read_current_proposal', 'read_failed', 'reference', 'template',
      'inspect_local_storage', 'read_go_dependency', 'resources', 'config_values', 'read_source_connection',
      ...(updating ? ['active_version', 'version_file', 'database_schema'] : []),
    ]
    const observationKinds = ['state', 'http', 'operation', ...(updating ? ['rehearsal'] : [])]
    const repairInstructions = isRepair
      ? '\n修复失败部署时，先核对失败阶段和证据，需要时用 read_failed 读取失败制品。用 read_current_proposal 取得已接受的完整字段；由你判断只改配置、重试，还是提交必要的完整替换文件。'
      : ''
    const hasDeploymentLog = Boolean(job.failedRevision && job.failedRevision === job.deploymentLogRevision)
    const portInstructions = portLocked
      ? `本任务锁定的容器端口为 ${port}。`
      : `容器端口策略：优先识别并沿用应用自身默认监听端口（从源码、现有 Dockerfile 或真实配置文件核实）；若应用无默认端口（或依赖外部注入 PORT 且无兜底值），则使用 OPC 默认端口 ${port}。${job.upgrade ? `本次为升级部署，如新版未变更端口优先沿用线上当前端口 ${port}。` : ''}容器内必须监听 0.0.0.0（禁止监听 127.0.0.1），且契约 configs 中的 PORT 必须与 runtime.port 一致，不要引用 *.example 示例文件中冲突的 PORT 或占位密钥。`
    const prevPlan = compactPreviousPlan(job.proposal)
    const taskInstruction = assessment
      ? `当前是${assessment.phase === 'build' ? '构建产物' : '运行版本'}验收阶段。先通过 opc_delivery_observe 读取事实，然后提交 opc_delivery_assess 结论。`
      : isRepair
      ? '沿用已确认方案，先用失败制品核实根因，只修复导致中断的问题。'
      : prevPlan || job.analysisFailure ? '从已有方案、暂存文件与上次中断位置继续。只补本轮缺的内容。'
        : '按技能的三步完成本次应用改造。'

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
    const observations = new Map<string, DeliveryObservation>()
    let activeVersion: Promise<AppDocument> | undefined
    const readActiveVersion = () => activeVersion ??= (async (): Promise<AppDocument> => {
      if (!updating) throw new Error('首次部署没有可沿用的应用版本')
      const app = await delivery.platform(`/${job.slug}`, appCtxId)
      if (!app.can_manage) throw new Error('没有读取此应用版本的权限')
      const { versions } = await delivery.platform(`/${job.slug}/versions`, appCtxId)
      const releases: AppDocument[] = Array.isArray(versions) ? versions : []
      const active = releases.find(item => item.is_active === true && item.status === 'running')
        ?? (app.status === 'running' ? releases.find(item => item.version === app.current_version && item.status === 'running') : undefined)
      if (!active) throw new Error('找不到当前生效版本')
      return { ...active, storage_mounts: app.storage_mounts ?? active.storage_mounts }
    })().catch(error => { activeVersion = undefined; throw error })
    const readActiveSnapshot = async (active: AppDocument) => {
      if (!active.download_urls?.['confirmed-deployment.json']) return undefined
      const snapshot = await delivery.platform(`/${job.slug}/versions/${active.version}/artifacts/confirmed-deployment.json`, appCtxId)
      if (snapshot.config_revision !== active.config_revision) {
        activeVersion = undefined
        throw new Error('生效配置在读取期间已变化，请重新读取基线')
      }
      return snapshot
    }
    const rejectedProposals = new Set<string>()
    let consecutiveValidationErrors = 0
    let validationStopped = false
    let draftFileChanges: { id?: string; path?: string; reason?: string }[] = []
    try {
      const draftsRaw = JSON.parse(readFileSync(join(root, 'draft_files.json'), 'utf8'))
      if (draftsRaw && typeof draftsRaw === 'object') {
        draftFileChanges = Object.values(draftsRaw).map((c: any) => ({ id: c?.id, path: c?.path, reason: c?.reason }))
      }
    } catch { /* no staged draft files yet */ }
    const agentOptions = selection
      ? { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
      : undefined
    const live = sessions.get(job.id) ?? {}
    const round: AnalysisRound = {
      tools: new Map(),
      ready: sessionReady.promise,
      async reply(text, turnSignal) {
        if (assessment) return worker({ action: 'redact_feedback', root, text: text.slice(0, 20_000) }, AbortSignal.any([abort, turnSignal]))
        const safeText = await delivery.recordAnalysisReply(job, root, text, AbortSignal.any([abort, turnSignal]))
        validationErrors.length = 0
        rejectedProposals.clear()
        consecutiveValidationErrors = 0
        validationStopped = false
        replyCount++
        wakeReply?.()
        return safeText
      },
    }
    const register = (tool: ToolDefinition) => round.tools.set(tool.name, tool)
    const output = { schema: { type: 'string' as const }, render: (_: unknown, value: string) => [{ type: 'text' as const, text: value }] }
    register(defineTool({ name: 'opc_delivery_observe',
      description: '读取候选版本实际事实。state 读取状态和日志；运行态 http 或 operation 必须用 target 指定交付契约中的只读验收目标 ID。' +
        (updating ? '已确认 PostgreSQL 迁移时，rehearsal 在隔离库演练。' : ''),
      parameters: {
        kind: { type: 'string', enum: observationKinds, required: true },
        target: { type: 'string' },
        expected_statuses: { type: 'array', items: { type: 'number' } }, within_seconds: { type: 'number' },
        params: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
      }, output,
      async execute(args) {
        if (!assessment || assessment.result) throw new Error('当前没有可验收的部署阶段')
        if (!observationKinds.includes(args.kind)) throw new Error('当前部署任务不支持该验收操作')
        if (!job.requestId) throw new Error('当前没有可核对的部署请求回执')
        if (args.kind === 'http' || args.kind === 'operation') {
          const targets: AppDocument[] = job.proposal?.contract?.verification?.targets ?? []
          if (!args.target || !targets.some(target => target.id === args.target && target.kind === args.kind)) {
            throw new Error('请使用当前交付契约声明的同类型只读验收目标 ID')
          }
        }
        if (observations.size >= 30) throw new Error('本轮事实读取已达到上限，请据此提交结论')
        const result = await delivery.observeDeployment(job, root, args, appCtxId, abort)
        const id = randomUUID()
        observations.set(id, { kind: args.kind, target: args.target, request_id: job.requestId, result })
        return JSON.stringify({ id, result })
      },
    }))
    register(defineTool({ name: 'opc_delivery_assess', description: '根据本轮实际观察提交构建或运行验收结论。使用 opc_delivery_observe 返回的证据 ID。',
      parameters: {
        outcome: { type: 'string', required: true, enum: ['passed', 'failed'] },
        report: { type: 'string', required: true },
        evidence: { type: 'array', items: { type: 'string' }, required: true },
      }, output,
      async execute(args) {
        if (!assessment || assessment.result) throw new Error('当前没有可提交的部署验收')
        const ids = [...new Set(args.evidence)]
        if (!args.report.trim() || args.report.length > 2000 || !ids.length || ids.length > 12 || ids.some(id => !observations.has(id))) {
          throw new Error('请提交简短结论以及本轮工具读取的证据 ID')
        }
        const evidence = ids.map(id => observations.get(id)!)
        if (args.outcome === 'passed') {
          const enough = assessment.phase === 'build'
            ? evidence.some(item => item.kind === 'state' && item.result.status === 'built')
            : evidence.some(item => (item.kind === 'http' || item.kind === 'operation') && item.target &&
              Number.isInteger(item.result.status) && item.result.status >= 100 && item.result.status <= 599)
          if (!enough) throw new Error(assessment.phase === 'build'
            ? '构建通过需要本轮实际 built 回执'
            : '运行验收通过需要已声明验收目标的实际响应；状态、日志和连接失败不能作为业务响应')
        }
        assessment.result = { phase: assessment.phase, outcome: args.outcome,
          report: await worker({ action: 'redact_feedback', root, text: args.report }, abort),
          evidence: evidence.map(item => JSON.stringify(item)) }
        return '验收结论与证据已记录。'
      },
    }))
    register(defineTool({ name: 'opc_delivery_inspect',
      description: '只读检查应用。inventory 查看导入源码清单；read 或 read_failed 传 path；read_current_proposal 读取已接受的全量方案，可传 contract.configs 等字段作为 path，用返回的 next_start 作为续读 start；resources 读取平台资源；config_values 读取配置生效值；reference 传 name；template 传 language 和 version。也可用 scan_routes_and_pages、inspect_local_storage、read_go_dependency 和 read_source_connection。' +
        (updating ? 'active_version 读取线上基线；version_file 传 path 读取该版本文件；database_schema 读取应用专属 PostgreSQL 的结构。' : ''),
      parameters: {
        action: { type: 'string', enum: inspectActions, required: true },
        path: { type: 'string' },
        proposed: { type: 'boolean' },
        language: { type: 'string' },
        version: { type: 'string' },
        name: { type: 'string' },
        schema: { type: 'string' },
        table: { type: 'string' },
        key: { type: 'string' },
        source: { type: 'object', additionalProperties: true },
        bindings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          key: { type: 'string', required: true }, resource_id: { type: 'string', required: true }, resource_key: { type: 'string', required: true },
        } } },
        module: { type: 'string' },
        start: { type: 'number' },
      }, output,
      async execute(args) {
        if (!inspectActions.includes(args.action)) throw new Error('当前部署任务不支持该读取操作')
        if (args.action === 'reference' && !['delivery-files.md', 'contract.md', 'framework-checks.md'].includes(args.name ?? '')) {
          throw new Error('请读取 delivery-files.md、contract.md 或 framework-checks.md')
        }
        job.events.push(formatToolStep(args.action, args.path, args.language))
        delivery.core.emit('change')
        if (args.action === 'read_current_proposal') return JSON.stringify(readCurrentProposal(job.proposal, args.path, args.start))
        if (args.action === 'resources') {
          const response = await delivery.platform('/resources', appCtxId, { query: { slug: job.slug } })
          return JSON.stringify((response.resources ?? []).map(({ id, name, type, env_keys, is_default, supports_auto_migration, host, port, database_name }: AppDocument) =>
            ({ id, name, type, env_keys, is_default, supports_auto_migration, host, port, database_name })))
        }
        if (args.action === 'config_values') {
          const values = await delivery.previewDeliveryConfig(job, root, appCtxId, abort, job.status === 'review')
          return JSON.stringify({ configs: values, resources: await delivery.resolveResourceValues(job.slug, args.bindings ?? [], appCtxId) })
        }
        if (args.action === 'active_version') {
          const active = await readActiveVersion()
          const plan = active.download_urls?.['delivery.json']
            ? await delivery.platform(`/${job.slug}/versions/${active.version}/artifacts/delivery.json`, appCtxId)
            : undefined
          const snapshot = await readActiveSnapshot(active)
          return JSON.stringify({ version: active.version, config_revision: active.config_revision, container_port: active.container_port,
            configs: (active.app_config ?? snapshot?.app_config ?? []).map(({ key, value, effective_value, secret, resource_id, resource_key, has_value, preserve_on_upgrade }: AppDocument) =>
              ({ key, value: effective_value ?? value, secret, resource_id, resource_key, has_value, preserve_on_upgrade })),
            mounts: (snapshot?.storage_mounts ?? active.storage_mounts ?? []).map(({ name, container_path, resource_id, volume_name, storage_backend, kind, purpose }: AppDocument) =>
              ({ name, container_path, resource_id, volume_name, storage_backend, kind, purpose })),
            delivery: plan }, null, 2)
        }
        if (args.action === 'version_file') {
          const active = await readActiveVersion()
          if (!args.path) throw new Error('请提供上一版交付文件路径')
          const file = await delivery.platform(`/${job.slug}/versions/${active.version}/artifacts/app.tar`, appCtxId, { query: { file: args.path } })
          if (typeof file?.text !== 'string') throw new Error('平台尚未提供上一版交付文件读取接口')
          const text = file.text
          const start = Math.max(0, (args.start ?? 1) - 1)
          return JSON.stringify({ path: args.path, text: text.split('\n').slice(start, start + 200).join('\n') })
        }
        if (args.action === 'database_schema') {
          await readActiveVersion()
          return JSON.stringify(await delivery.platform(`/${job.slug}/database-schema`, appCtxId, {
            query: { ...(args.name ? { resource_id: args.name } : {}), ...(job.requestId ? { request_id: job.requestId } : {}),
              ...(args.table ? { table: args.table } : {}), ...(args.schema ? { schema: args.schema } : {}) },
          }))
        }
        if (args.action === 'template') {
          abort.throwIfAborted()
          const result = await delivery.platform('/dockerfile-templates', appCtxId, { query: { language: args.language ?? '', version: args.version ?? '' } })
          abort.throwIfAborted()
          return JSON.stringify(result.matched_template ?? null)
        }
        return JSON.stringify(await worker({ ...args, root, values_visible: true, revision: job.failedRevision || job.revision }, abort))
      } }))
    register(defineTool({ name: 'opc_delivery_propose_file', description: '暂存技能规定的 Dockerfile、配置或 SQL 文件。在 opc_delivery_submit 的 changes 中引用 ID 和实际部署路径。',
      parameters: {
        id: { type: 'string', required: true },
        path: { type: 'string', required: true },
        reason: { type: 'string', required: true },
        content: { type: 'string', required: true },
        executable: { type: 'boolean' },
        group: { type: 'string' },
      }, output,
      async execute(args) {
        if (assessment) throw new Error('当前正在验收，改造需回到原任务继续')
        if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
        job.events.push(formatToolStep('propose_file', args.path))
        delivery.core.emit('change')
        const res = await worker({ action: 'propose_file', root, ...args, skill_delivery: true }, abort)
        return JSON.stringify(res)
      } }))
    register(defineTool({ name: 'opc_delivery_submit', description: '以结构化字段提交完整改造提案。若已暂存文件，changes 可仅传 {id, path, reason, group}。旧版可用 proposal JSON 字符串。',
      parameters: proposalParameters(port, portLocked, updating), output,
      async execute(args) {
        if (job.status !== 'analyzing') throw new Error('本轮已提交方案')
        if (validationStopped) throw new Error('技术方案连续校验未通过，已停止自动重试')
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
          candidate.delivery_format = 1
          candidate.config_format = 1
          candidate.verification_format = 1
          const strategy = candidate.contract?.data_plan?.strategy
          const strategies = deliveryDataStrategies(updating)
          const waitingForDecision = candidate.unresolved?.length || candidate.contract?.unresolved?.length
          if ((strategy !== undefined || !waitingForDecision) && !strategies.includes(strategy)) {
            throw new Error(`${updating ? '应用更新' : '首次部署'}的 data_plan.strategy 只允许 ${strategies.join('、')}`)
          }
          const readiness = candidate.readiness
          if (!readiness || !['ready', 'blocked'].includes(readiness.outcome) ||
              typeof readiness.reason !== 'string' || !readiness.reason.trim()) {
            throw new Error('请根据实际证据提交 readiness.outcome（ready 或 blocked）及 readiness.reason')
          }
          if ((readiness.outcome === 'blocked') !== Boolean(waitingForDecision)) {
            throw new Error('readiness 必须与 unresolved 一致。待处理的阻塞要列明原因，准备就绪时清空已解决项')
          }
          let existingMounts: AppDocument[] = []
          if (updating) {
            const active = await readActiveVersion()
            candidate.base_version = active.version
            candidate.base_config_revision = active.config_revision ?? ''
            const needsSnapshot = active.app_config == null ||
              (Array.isArray(candidate.contract?.storage_mounts) && candidate.contract.storage_mounts.length > 0 && active.storage_mounts == null)
            const snapshot = needsSnapshot ? await readActiveSnapshot(active) : undefined
            const activeConfig = active.app_config ?? snapshot?.app_config ?? []
            existingMounts = snapshot?.storage_mounts ?? active.storage_mounts ?? []
            const previous = new Map(activeConfig.map((c: AppDocument) => [c.key, c]))
            for (const config of candidate.contract?.configs ?? []) {
              if (!previous.has(config.key) && config.value_plan?.kind === 'inherit') {
                throw new Error(`线上生效版本不存在配置 ${config.key}，请声明此项实际取值来源`)
              }
              if ((previous.get(config.key) as AppDocument | undefined)?.has_value && config.value_plan?.kind === 'generate') {
                throw new Error(`现有配置 ${config.key} 已有值，升级请继承线上配置，不能自动重新生成`)
              }
            }
          } else candidate.base_version = 0
          await delivery.submit(job, root, candidate, abort, { dockerfileOnly: true, resourceReview: { contextId: appCtxId, existingMounts } })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const detail = await worker({ action: 'redact_feedback', root, text: message.slice(0, 2000) }, abort)
          const duplicateError = validationErrors.includes(detail)
          consecutiveValidationErrors = validationErrors.at(-1) === detail ? consecutiveValidationErrors + 1 : 1
          validationErrors.push(detail)
          job.analysisFailure = detail
          let referencedDrafts: unknown[] = []
          if (Array.isArray(candidate?.changes) && candidate.changes.length) {
            try {
              const drafts: Record<string, AppDocument> = JSON.parse(readFileSync(join(root, 'draft_files.json'), 'utf8'))
              referencedDrafts = candidate.changes.map((change: AppDocument | null) => change?.id ? drafts[change.id]
                : change?.path ? Object.values(drafts).findLast(draft => draft.path === change.path) : undefined)
            } catch {}
          }
          const rejected = fingerprint({ proposal: candidate ?? args, referencedDrafts, reason: detail })
          validationStopped = rejectedProposals.has(rejected) || consecutiveValidationErrors >= MAX_REPEATED_VALIDATION_ERRORS ||
            validationErrors.length >= MAX_VALIDATION_FAILURES
          rejectedProposals.add(rejected)
          if (!duplicateError) job.events.push(`提案校验未通过：${detail}`)
          delivery.core.emit('change')
          if (validationStopped) cancel()
          throw new Error(detail)
        }
        const questions = analysisQuestions(job.proposal)
        return questions.length
          ? `方案已保存，等待用户回复。请在当前对话中列出待确认的问题与可选方案，再结束本轮：\n${questions.join('\n')}`
          : '方案已通过校验并保存。请向用户说明关键改造和待填项。OPC 随后生成交付包，实际准备结果以任务状态为准。'
      } }))
    const options: Omit<CreateAgentOptions, 'sessionId' | 'meta'> = {
      agentOptions,
      signal: abort,
      setup(child) {
        child.tools.restrict({ allow: [] })
        child.systemPrompt.section({ name: 'opc-delivery', order: 1,
          text: skill + '\n' + loadBundledSkillText('references/delivery-files.md') + '\n' + loadBundledSkillText('references/assessment.md'),
          complete: true, interpolate: false })
        for (const [name, tool] of round.tools) {
          child.tools.register({ ...tool, execute: (...args) => {
            const current = live.round?.tools.get(name)
            if (!current) throw new Error('请先继续当前应用准备')
            return current.execute(...args)
          } })
        }
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
            if (!text) continue
            if (!live.round) {
              await new Promise<void>((resolve, reject) => {
                delivery.startAnalysis(job.id, '', appCtxId, undefined, {
                  mode: 'resume', fromChat: true, onChatReady: resolve,
                }).catch(reject)
              })
            }
            const current = live.round
            if (!current || !await current.ready) throw new Error('当前应用会话未恢复，请核对任务状态后重试')
            const safeText = await current.reply(text, turnSignal)
            if (safeText) messages.push({ ...message, content: [{ type: 'text' as const, text: safeText }] })
          }
          return messages.length ? { ...decision, messages } : { kind: 'reject' }
        })
      },
    }
    live.round = round
    sessions.set(job.id, live)
    let analysis: AgentHandle
    try {
      analysis = live.handle ?? (job.analysisSessionId
        ? await ctx.agents.resume({ ...options, resumeSessionId: job.analysisSessionId as never })
        : await ctx.agents.create({ ...options, sessionId: randomUUID() as never, meta: { cwd: root } }))
      live.handle = analysis
    } catch (error) {
      sessions.delete(job.id)
      sessionReady.resolve(false)
      throw error
    }
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
      const session = analysis.agent.session
      const selectedModel = selection ?? analysis.agent.model?.current() ?? session.requestHeader?.()?.config
      if (!job.modelSelection && selectedModel) {
        job.modelSelection = { provider: selectedModel.provider, model: selectedModel.model, reasoningEffort: selectedModel.reasoningEffort }
      }
      const titles = ctx.get('sessionTitle')
      if (titles && titles.get(session)?.source.kind !== 'user') {
        titles.rename(session, `部署${job.name}`)
      }
      const previous = (job.published || job.upgrade)
        ? await delivery.platform('/' + job.slug, appCtxId).catch(() => undefined)
        : undefined
      const runtimeLogs = job.published && !hasDeploymentLog
        ? await delivery.platform('/' + job.slug + '/logs', appCtxId).catch(() => undefined)
        : undefined

      if (isRepair || (job.published && (previous?.error_message || previous?.build_log || runtimeLogs?.runtime_logs))) {
        const mergedFailure = [
          job.failureContext,
          !hasDeploymentLog && previous?.error_message,
          !hasDeploymentLog && previous?.build_log?.slice(-8000),
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
        instructions: portInstructions + repairInstructions,
        user_answers: job.feedbackHistory || feedback,
        previous_validation_failure: job.analysisFailure ?? '',
        draft_file_changes: draftFileChanges,
        analysis_mode: isRepair ? 'repair' : 'analysis',
        existing_deployment: Boolean(job.upgrade || job.published),
        previous_plan: prevPlan,
        previous_plan_available: Boolean(job.proposal),
        failed_snapshot: job.failedSnapshot,
        failure_log: job.failureContext ?? '',
        deployment_log: hasDeploymentLog ? '先调用 opc_delivery_inspect，action=read_failed，path=@deployment/logs，读取本次构建、部署与启动日志。用返回的 next_start 继续读取，直到定位报错和根因。' : undefined,
        assessment_phase: assessment?.phase,
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
      let prompt = taskInstruction
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
            if (job.status === 'review' && !analysisQuestions(job.proposal).length) return
            setDeadline(ANALYSIS_TIMEOUT_MS)
          } else {
            abort.throwIfAborted()
            if (!fromChat || attempt > 0) send(prompt)
          }
          await analysis.agent.whenIdle()
          if (assessment?.result) return
        } catch (err) {
          if (signal.aborted || (abort.aborted && !validationStopped)) throw err
          errorMessage = err instanceof Error ? err.message : String(err)
        }
        if (job.status === 'review') {
          if (!analysisQuestions(job.proposal).length) return
          attempt = -1
          continue
        }
        if (validationStopped) {
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
            : validationErrors.at(-1) || (assessment ? 'AI 尚未提交验收结论' : 'AI 尚未提交完整提案')
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
        prompt = `先用 read_current_proposal 读取已接受的相关字段并保留完整方案，按以下反馈只修正需要改动的字段。需要补证据时只重读对应位置：${reason}`
      }
    } finally {
      sessionReady.resolve(false)
      clearTimeout(deadline)
      stopObserving()
      abort.removeEventListener('abort', onAbort)
      if (live.round === round) live.round = undefined
    }
  }
  ctx.effect(() => async () => {
    delivery.analyze = undefined
    await Promise.allSettled([...sessions.values()].map(session => session.handle?.dispose()))
    sessions.clear()
  })
}
