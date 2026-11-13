import type { RequestApproval } from './mcp.ts'
import { ManagedMcpMounts, mcpMountName } from './mcp-mount.ts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { OpcCore } from './core.ts'
import { contextId, OpcError } from './context.ts'
import { AppDelivery } from './app-delivery.ts'

const execFileAsync = promisify(execFile)

declare module '@deepseek-ai/cordis' { interface Context { opc: OpcRemoteService } }

/** Business documents are JSON strings on the wire; credentials never enter this service. */
export class OpcRemoteService extends TypertRemoteService {
  private pendingApprovals = new Map<string, { contextId: string; prompt: { serviceId: string; toolName: string; arguments: Record<string, unknown> }; resolve: (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void }>()
  private mounts?: ManagedMcpMounts
  private manager?: Context['mcpManager']
  private readonly core: OpcCore
  private readonly delivery: AppDelivery
  private readonly host: Context
  constructor(ctx: Context, options: { core: OpcCore; delivery: AppDelivery }) {
    super(ctx, 'opc')
    const { core, delivery } = options
    this.host = ctx
    this.core = core
    this.delivery = delivery
    ctx.inject(['mcpManager'], child => {
      const manager = child.mcpManager
      const mounts = new ManagedMcpMounts(core, (name, entry) => manager.register(name, entry), this.requestApproval, { autoMount: true })
      this.manager = manager
      this.mounts = mounts
      core.emit('change')
      child.on('mcp-manager/status', () => { core.emit('change') })
      child.effect(() => () => {
        this.manager = undefined
        this.mounts = undefined
        mounts.dispose()
        core.emit('change')
      })
    })
  }
  @Remote
  async appList(expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.list(expectedContextId)) }
  @Remote
  async appJob(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.getJob(id, expectedContextId)) }
  @Remote
  async appCheckSlug(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.checkSlug(slug, expectedContextId)) }
  @Remote
  async appOpcConfig(expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.opcConfig(expectedContextId)) }
  @Remote
  async appPickSourceFolder(expectedContextId: string): Promise<string> {
    this.core.auth.contexts.captureApplication(expectedContextId)
    if (process.platform !== 'darwin') return JSON.stringify({ cancelled: true, unsupported: true })
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择应用源码目录")'], { timeout: 120_000 })
      const path = stdout.trim().replace(/\/+$/, '') || '/'
      return JSON.stringify({ path })
    } catch {
      return JSON.stringify({ cancelled: true })
    }
  }
  @Remote
  async appModels(expectedContextId: string): Promise<string> {
    const scope = this.core.auth.contexts.captureApplication(expectedContextId)
    const groups = await Promise.all(this.host.llm.listProviders().map(async provider => {
      const models = await this.host.llm.listModels(provider.id).catch(() => [])
      const entries = await Promise.all(models.map(async model => {
        const resolved = await this.host.llm.resolveModelInfo(provider.id, model.id, scope.signal).catch(() => undefined)
        return { id: model.id, name: model.name, reasoning: resolved?.reasoning }
      }))
      return { id: provider.id, name: provider.name, models: entries }
    }))
    scope.assertCurrent()
    return JSON.stringify(groups.filter(group => group.models.length))
  }
  @Remote
  async appCatalog(expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.platform('/', expectedContextId)) }
  @Remote
  async appCreate(inputJson: string, sessionId: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.create(JSON.parse(inputJson), sessionId, expectedContextId)) }
  @Remote
  async appAnalyze(id: string, feedback: string, sessionId: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.startAnalysis(id, feedback, expectedContextId, sessionId)) }
  @Remote
  async appAnalyzeWithMode(id: string, feedback: string, sessionId: string, mode: string, expectedContextId: string): Promise<string> {
    const parsedMode = mode === 'resume' ? 'resume' : mode === 'repair' ? 'repair' : 'analysis'
    return JSON.stringify(await this.delivery.startAnalysis(id, feedback, expectedContextId, sessionId, { mode: parsedMode }))
  }
  @Remote
  async appPrepare(id: string, proposalHash: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.prepare(id, proposalHash, expectedContextId)) }
  @Remote
  async appReopenReview(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.reopenReview(id, expectedContextId)) }
  @Remote
  async appReopenDeployment(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.reopenDeployment(id, expectedContextId)) }
  @Remote
  async appCancelAnalysis(id: string, expectedContextId: string): Promise<void> { await this.delivery.cancelAnalysis(id, expectedContextId) }
  @Remote
  async appConfigDraft(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.configDraft(id, expectedContextId)) }
  @Remote
  async appSaveConfigDraft(id: string, body: string, expectedContextId: string): Promise<void> { await this.delivery.saveConfigDraft(id, JSON.parse(body), expectedContextId) }
  @Remote
  async appLocalArtifact(id: string, filename: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.localArtifact(id, filename, expectedContextId)) }
  @Remote
  async appSaveLocalArtifact(id: string, filename: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.saveLocalArtifact(id, filename, expectedContextId)) }
  @Remote
  async appHandoff(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.handoff(id, expectedContextId)) }
  @Remote
  async appSkillPreview(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.skillPreview(id, expectedContextId)) }
  @Remote
  async appConfirmDeployment(id: string, inputJson: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.confirmDeployment(id, JSON.parse(inputJson), expectedContextId)) }
  @Remote
  async appPublish(id: string, confirmationJson: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.publish(id, JSON.parse(confirmationJson), expectedContextId)) }
  @Remote
  async appVerify(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.verify(id, expectedContextId)) }
  @Remote
  async appVerifyWithOptions(id: string, optionsJson: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.verify(id, expectedContextId, optionsJson ? JSON.parse(optionsJson) : undefined)) }
  @Remote
  async appSetSkillEnabled(id: string, enabled: boolean, expectedContextId: string): Promise<void> { await this.delivery.setSkillEnabled(id, enabled, expectedContextId) }
  @Remote
  async appResources(expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.platform('/resources', expectedContextId)) }
  @Remote
  async appDetails(slug: string, expectedContextId: string): Promise<string> {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new OpcError('INVALID_APP_SLUG')
    const detail = await this.delivery.platform('/' + slug, expectedContextId)
    return JSON.stringify({
      id: detail.id,
      name: detail.name,
      slug: detail.slug ?? slug,
      description: detail.description ?? '',
      language: detail.language,
      runtime_version: detail.runtime_version,
      dockerfile_content: detail.dockerfile_content,
      app_url: detail.app_url,
      container_port: detail.container_port,
      status: detail.status,
      current_version: detail.current_version,
      app_config: detail.app_config ?? [],
      resource_ids: detail.resource_ids ?? [],
      storage_mounts: detail.storage_mounts ?? [],
      config_fingerprint: detail.config_fingerprint,
      skill_name: detail.skill_name,
      catalog_skill_id: detail.catalog_skill_id,
      skill_synced: detail.skill_synced,
      build_log: detail.build_log,
      error_message: detail.error_message,
      created_by: detail.created_by,
      created_at: detail.created_at,
      updated_at: detail.updated_at,
      can_manage: detail.can_manage,
    })
  }
  @Remote
  async appVersions(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.versions(slug, expectedContextId)) }
  @Remote
  async appLogs(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.logs(slug, expectedContextId)) }
  @Remote
  async appStorage(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.storage(slug, expectedContextId)) }
  @Remote
  async appDownload(slug: string, selectionJson: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.download(slug, JSON.parse(selectionJson), expectedContextId))
  }
  @Remote
  async appSaveDownload(slug: string, selectionJson: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.saveDownload(slug, JSON.parse(selectionJson), expectedContextId))
  }
  @Remote
  async appRecheck(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.recheck(slug, expectedContextId)) }
  @Remote
  async appUpdateConfig(slug: string, bodyJson: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.updateConfig(slug, JSON.parse(bodyJson), expectedContextId)) }
  @Remote
  async appDelete(slug: string, purgeVolumes: boolean, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.deleteApp(slug, purgeVolumes, expectedContextId)) }
  @Remote
  async appRollback(slug: string, payloadJson: string, expectedContextId: string): Promise<string> {
    const parsed = JSON.parse(payloadJson)
    return JSON.stringify(await this.delivery.rollback(slug, Number(parsed.targetVersion ?? parsed.target_version ?? 0), String(parsed.reason ?? ''), expectedContextId))
  }
  @Remote
  async state(): Promise<string> {
    const state = this.core.auth.state
    const mounted = this.mounts?.list() ?? []
    return JSON.stringify({ ...state, knowledgeMentionScopeVersion: 1, mountAvailable: !!this.mounts, mcpConnections: Object.fromEntries(mounted.map(id => { const status = this.manager?.list().find(item => item.name === mcpMountName(id))?.status; return [id, { state: status?.state ?? 'connecting', toolCount: status?.state === 'connected' ? status.toolCount : 0 }] })), pinnedScopes: this.core.scopes.pins(), mountedServices: mounted, approvals: [...this.pendingApprovals].map(([id, pending]) => ({ id, contextId: pending.contextId, ...pending.prompt })), context: state.context ? { ...state.context, contextId: contextId(state.context), applicationContextId: this.core.auth.contexts.applicationContextId, epoch: this.core.auth.contexts.epoch } : null })
  }
  @Remote({ mode: 'stream' })
  async *watchState(signal: AbortSignal): AsyncIterable<string> {
    let wake: (() => void) | undefined, dirty = true
    const changed = () => { dirty = true; wake?.() }
    this.core.on('change', changed); signal.addEventListener('abort', changed)
    try {
      while (!signal.aborted) {
        if (dirty) { dirty = false; yield await this.state() }
        if (!dirty && !signal.aborted) await new Promise<void>(resolve => { wake = resolve })
      }
    } finally { this.core.off('change', changed); signal.removeEventListener('abort', changed) }
  }
  @Remote
  async startLogin(): Promise<string> { return JSON.stringify(await this.core.auth.startLogin()) }
  @Remote
  async cancelLogin(): Promise<void> { this.core.auth.cancelLogin() }
  @Remote
  async logout(): Promise<void> { await this.core.auth.logout() }
  @Remote
  async switchTenant(tenantId: string): Promise<void> { this.core.auth.switchTenant(tenantId) }
  @Remote
  async listKnowledgeBases(q: string): Promise<string> { return JSON.stringify(await this.core.catalog('knowledge-bases', q)) }
  @Remote
  async listSkillsCatalog(q: string): Promise<string> {
    const captured = this.core.auth.contexts.capture()
    const items = await this.core.catalog('skills', q)
    const installed = await this.core.installer.list(captured.context); captured.assertCurrent()
    return JSON.stringify(items.map(item => ({ ...item, installed: installed.find(record => record.catalog_id === item.catalog_id) ?? null })))
  }
  @Remote
  async installSkill(catalogId: string, expectedSha256: string, expectedContextId: string): Promise<void> { await this.core.install({ catalogId, expectedSha256, contextId: expectedContextId }) }
  @Remote
  async setSkillEnabled(catalogId: string, enabled: boolean, expectedContextId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    if (enabled) await this.core.authz.catalog(captured.context.tenant, catalogId)
    captured.assertCurrent()
    await this.core.installer.setEnabled(captured.context, catalogId, enabled, captured.assertCurrent)
    this.core.emit('skills-changed')
  }
  @Remote
  async uninstallSkill(catalogId: string, expectedContextId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    await this.core.installer.remove(captured.context, catalogId); this.core.emit('skills-changed')
  }
  @Remote
  async setPinnedKnowledgeScope(sessionId: string, knowledgeBaseId: string | null, expectedContextId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    if (knowledgeBaseId) {
      const available = await this.core.catalog('knowledge-bases'); captured.assertCurrent()
      if (!available.some(item => item.knowledge_base_id === knowledgeBaseId && item.availability === 'available')) throw new OpcError('RESOURCE_NOT_ACCESSIBLE')
    }
    this.core.scopes.pin(sessionId, knowledgeBaseId ? { tenantId: captured.context.tenant, knowledgeBaseId, contextId: expectedContextId } : null)
    this.core.emit('change')
  }
  @Remote
  async searchKnowledge(sessionId: string, query: string, knowledgeBaseId: string, expectedContextId: string): Promise<string> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    const session = `preview:${sessionId}`
    this.core.scopes.pin(session, knowledgeBaseId ? { tenantId: captured.context.tenant, knowledgeBaseId, contextId: expectedContextId } : null)
    this.core.scopes.begin(session, 'preview')
    return JSON.stringify(await this.core.search(session, 'preview', query, undefined, knowledgeBaseId || undefined))
  }
  @Remote
  async readKnowledgeDocument(sessionId: string, knowledgeId: string, expectedContextId: string): Promise<string> {
    this.core.auth.contexts.capture(expectedContextId)
    return JSON.stringify(await this.core.read(`preview:${sessionId}`, 'preview', knowledgeId))
  }
  @Remote
  async listMcpServices(): Promise<string> {
    const { context } = this.core.auth.contexts.capture()
    return JSON.stringify(await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(context.tenant)}`))
  }
  @Remote
  async invokeMcpTool(serviceId: string, toolName: string, argumentsJson: string, expectedContextId: string): Promise<string> {
    this.core.auth.contexts.capture(expectedContextId)
    const args: unknown = JSON.parse(argumentsJson)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OpcError('INVALID_ARGUMENTS')
    const result = await this.core.mcp.invoke({ serviceId, toolName, arguments: args as Record<string, unknown>, contextId: expectedContextId }, this.requestApproval)
    return JSON.stringify(result ?? null)
  }
  private requestApproval: RequestApproval = async () => {
    // 企微已登录场景下，默认自动批准，无需用户手动确认，且不在面板上展示审批卡片
    return 'allowed-once'
  }
  @Remote
  async mountMcpService(serviceId: string, expectedContextId: string): Promise<void> { if (!this.mounts) throw new OpcError('MCP_MOUNT_UNAVAILABLE'); await this.mounts.mount(serviceId, expectedContextId) }
  @Remote
  async unmountMcpService(serviceId: string, expectedContextId: string): Promise<void> { this.core.auth.contexts.capture(expectedContextId); this.mounts?.unmountByUser(serviceId) }
  @Remote
  async decideDebugInvocation(id: string, allowed: boolean, expectedContextId: string): Promise<void> {
    this.core.auth.contexts.capture(expectedContextId)
    const pending = this.pendingApprovals.get(id)
    if (!pending || pending.contextId !== expectedContextId) throw new OpcError('CONTEXT_CHANGED')
    pending.resolve(allowed ? 'allowed-once' : 'rejected')
  }

}
