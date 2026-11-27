import type { RequestApproval } from './mcp.ts'
import { ManagedMcpMounts, mcpMountName } from './mcp-mount.ts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { OpcCore } from './core.ts'
import { contextId, OpcError } from './context.ts'
import { AppDelivery } from './app-delivery.ts'
import { OpcConfigStore } from './opc-config.ts'

const GUIDE_IMAGE_ALLOWLIST = new Set([
  '11-knowledge-search.jpg',
  '12-knowledge-catalog.jpg',
  '14-skills.jpg',
  '15-mcp.jpg',
  '16-app-source.jpg',
  '19-app-analysis.jpg',
  '22-app-deploy-review.jpg',
  '25-app-login-page.jpg',
])

const NPM_UPDATE_REGISTRIES = [
  'https://registry.npmmirror.com/dsh-plugin-opc/latest',
  'https://registry.npmjs.org/dsh-plugin-opc/latest',
] as const

export function isNewerSemver(latest: string, current: string): boolean {
  const parse = (raw: string) => {
    const cleaned = raw.trim().replace(/^v/i, '')
    const [core, pre = ''] = cleaned.split('-', 2)
    const parts = core.split('.').map(part => Number.parseInt(part, 10))
    if (parts.length < 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null
    return { major: parts[0], minor: parts[1], patch: parts[2], pre }
  }
  const next = parse(latest)
  const curr = parse(current)
  if (!next || !curr) return false
  if (next.major !== curr.major) return next.major > curr.major
  if (next.minor !== curr.minor) return next.minor > curr.minor
  if (next.patch !== curr.patch) return next.patch > curr.patch
  if (!next.pre && curr.pre) return true
  if (next.pre && !curr.pre) return false
  return next.pre > curr.pre
}

export async function checkNpmPackageUpdate(
  currentVersion: string,
  fetchFn: typeof fetch = fetch,
  registries: readonly string[] = NPM_UPDATE_REGISTRIES,
): Promise<{ currentVersion: string; latestVersion: string; hasUpdate: boolean }> {
  const results = await Promise.allSettled(
    registries.map(async (url) => {
      const response = await fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      })
      if (!response.ok) return ''
      const data = await response.json() as { version?: unknown }
      return typeof data?.version === 'string' ? data.version.trim() : ''
    }),
  )
  let latestVersion = ''
  for (const item of results) {
    if (item.status !== 'fulfilled' || !item.value) continue
    if (!latestVersion || isNewerSemver(item.value, latestVersion)) {
      latestVersion = item.value
    }
  }
  if (!latestVersion) {
    return { currentVersion, latestVersion: '', hasUpdate: false }
  }
  return {
    currentVersion,
    latestVersion,
    hasUpdate: isNewerSemver(latestVersion, currentVersion),
  }
}

const execFileAsync = promisify(execFile)

export type PickSourceFolderResult = { path?: string; cancelled?: boolean; unsupported?: boolean }
export type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide?: boolean },
) => Promise<{ stdout: string }>

const WIN32_FOLDER_PICKER_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = '选择应用源码目录'",
  '$dialog.ShowNewFolderButton = $false',
  'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
  '$owner.Dispose()',
  '$dialog.Dispose()',
].join('; ')

/** Prompts for a local source folder using the host OS native dialog. */
export async function pickSourceFolder(
  platform: NodeJS.Platform = process.platform,
  exec: ExecFileFn = execFileAsync,
): Promise<PickSourceFolderResult> {
  if (platform === 'darwin') {
    try {
      const { stdout } = await exec(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "选择应用源码目录")'],
        { timeout: 120_000 },
      )
      const path = stdout.trim().replace(/\/+$/, '') || '/'
      return { path }
    } catch {
      return { cancelled: true }
    }
  }
  if (platform === 'win32') {
    try {
      const { stdout } = await exec(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', WIN32_FOLDER_PICKER_SCRIPT],
        { timeout: 120_000, windowsHide: true },
      )
      const path = stdout.trim()
      return path ? { path } : { cancelled: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { cancelled: true, unsupported: true }
      return { cancelled: true }
    }
  }
  return { cancelled: true, unsupported: true }
}

declare module '@deepseek-ai/cordis' { interface Context { opc: OpcRemoteService } }

/** Business documents are JSON strings on the wire; credentials never enter this service. */
export class OpcRemoteService extends TypertRemoteService {
  private pendingApprovals = new Map<string, { contextId: string; prompt: { serviceId: string; toolName: string; arguments: Record<string, unknown> }; resolve: (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void }>()
  private mounts?: ManagedMcpMounts
  private manager?: Context['mcpManager']
  private readonly core: OpcCore
  private readonly delivery: AppDelivery
  private readonly configStore: OpcConfigStore
  private readonly host: Context
  constructor(ctx: Context, options: { core: OpcCore; delivery: AppDelivery; configStore?: OpcConfigStore }) {
    super(ctx, 'opc')
    const { core, delivery, configStore } = options
    this.host = ctx
    this.core = core
    this.delivery = delivery
    this.configStore = configStore ?? new OpcConfigStore(delivery.home, {
      platformBaseUrl: core.auth.http.base.href,
      ...delivery.getOptions(),
    })
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
  async appJobByAnalysisSession(sessionId: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.getJobByAnalysisSession(sessionId, expectedContextId))
  }
  @Remote
  async appCheckSlug(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.checkSlug(slug, expectedContextId)) }
  @Remote
  async appOpcConfig(expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.opcConfig(expectedContextId)) }
  @Remote
  async appPickSourceFolder(expectedContextId: string): Promise<string> {
    this.core.auth.contexts.captureApplication(expectedContextId)
    return JSON.stringify(await pickSourceFolder())
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
  async appPrepareWithOptions(id: string, proposalHash: string, optionsJson: string, expectedContextId: string): Promise<string> {
    const options = optionsJson ? JSON.parse(optionsJson) : undefined
    return JSON.stringify(await this.delivery.prepare(id, proposalHash, expectedContextId, options))
  }
  @Remote
  async appUndoSourceSync(id: string, optionsJson: string, expectedContextId: string): Promise<string> {
    const options = optionsJson ? JSON.parse(optionsJson) : undefined
    return JSON.stringify(await this.delivery.undoSourceSync(id, expectedContextId, options))
  }
  @Remote
  async appReopenReview(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.reopenReview(id, expectedContextId)) }
  @Remote
  async appReopenDeployment(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.reopenDeployment(id, expectedContextId)) }
  @Remote
  async appCancelDeployment(id: string, requestId: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.cancelDeployment(id, requestId, expectedContextId))
  }
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
  async appDeploymentLogs(id: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.deploymentLogs(id, expectedContextId)) }
  @Remote
  async appStorage(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.storage(slug, expectedContextId)) }
  @Remote
  async appMetrics(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.metrics(slug, expectedContextId)) }
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
  async appSyncSkill(slug: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.syncSkill(slug, expectedContextId)) }
  @Remote
  async appRuntimeStatus(slug: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.runtimeManagement(slug, expectedContextId))
  }
  @Remote
  async appRuntimeChange(slug: string, commandJson: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.runtimeManagement(slug, expectedContextId, JSON.parse(commandJson)))
  }
  @Remote
  async appUpdateConfig(slug: string, bodyJson: string, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.updateConfig(slug, JSON.parse(bodyJson), expectedContextId)) }
  @Remote
  async appDelete(slug: string, purgeVolumes: boolean, expectedContextId: string): Promise<string> { return JSON.stringify(await this.delivery.deleteApp(slug, purgeVolumes, expectedContextId)) }
  @Remote
  async appDeleteWithOptions(slug: string, optionsJson: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.deleteApp(slug, JSON.parse(optionsJson), expectedContextId))
  }
  @Remote
  async appCreateVolumeBackup(slug: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.createVolumeBackup(slug, expectedContextId))
  }
  @Remote
  async appVolumeBackupsList(expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.listVolumeBackups(expectedContextId))
  }
  @Remote
  async appSaveVolumeBackupDownload(id: string, filename: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.saveVolumeBackupDownload(id, filename, expectedContextId))
  }
  @Remote
  async appDeleteVolumeBackup(id: string, expectedContextId: string): Promise<string> {
    return JSON.stringify(await this.delivery.deleteVolumeBackup(id, expectedContextId))
  }
  @Remote
  async appRollback(slug: string, payloadJson: string, expectedContextId: string): Promise<string> {
    const parsed = JSON.parse(payloadJson)
    return JSON.stringify(await this.delivery.rollback(slug, Number(parsed.targetVersion ?? parsed.target_version ?? 0), String(parsed.reason ?? ''), expectedContextId))
  }
  private async applyConfigChange(result: { config: ReturnType<OpcConfigStore['getPayload']>; platform_base_changed: boolean }): Promise<string> {
    const { config, platform_base_changed } = result
    await this.core.auth.setPlatformBase(config.platform_base)
    this.delivery.updateOptions({
      appDomainRoot: config.app_domain_root,
      appDefaultPort: config.app_default_port,
    })
    if (platform_base_changed) this.core.emit('skills-changed')
    this.core.emit('change')
    return JSON.stringify({ ...config, platform_base_changed })
  }
  @Remote
  async opcConfigGet(): Promise<string> {
    return JSON.stringify(this.configStore.getPayload(this.core.auth.http.base.href))
  }
  @Remote
  async opcConfigUpdate(payloadJson: string): Promise<string> {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>
    return this.applyConfigChange(await this.configStore.update({
      platform_base: parsed.platform_base,
      app_domain_root: parsed.app_domain_root,
      app_default_port: parsed.app_default_port,
      workbench_name: parsed.workbench_name,
    }))
  }
  @Remote
  async opcConfigReset(): Promise<string> {
    return this.applyConfigChange(await this.configStore.reset())
  }
  @Remote
  async opcConfigTest(url: string): Promise<string> {
    return JSON.stringify(await this.configStore.testConnection(url))
  }
  @Remote
  async getGuideImage(imageName: string): Promise<string> {
    if (!GUIDE_IMAGE_ALLOWLIST.has(imageName)) return ''
    const fromSrc = fileURLToPath(new URL(`../../docs/images/workbench/${imageName}`, import.meta.url))
    const fromLib = fileURLToPath(new URL(`../docs/images/workbench/${imageName}`, import.meta.url))
    const target = import.meta.url.endsWith('/lib/index.js') ? fromLib : fromSrc
    try {
      const data = await readFile(target)
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } catch {
      return ''
    }
  }
  @Remote
  async checkPluginUpdate(): Promise<string> {
    const fromSrc = fileURLToPath(new URL('../../package.json', import.meta.url))
    const fromLib = fileURLToPath(new URL('../package.json', import.meta.url))
    const candidates = import.meta.url.includes('/lib/') ? [fromLib, fromSrc] : [fromSrc, fromLib]
    let currentVersion = ''
    for (const target of candidates) {
      try {
        const pkg = JSON.parse(await readFile(target, 'utf8')) as { version?: string }
        currentVersion = typeof pkg.version === 'string' ? pkg.version.trim() : ''
        if (currentVersion) break
      } catch {
      }
    }
    if (!currentVersion) return JSON.stringify({ currentVersion: '', latestVersion: '', hasUpdate: false })
    return JSON.stringify(await checkNpmPackageUpdate(currentVersion))
  }
  @Remote
  async state(): Promise<string> {
    const state = this.core.auth.state
    const mounted = this.mounts?.list() ?? []
    const cfg = this.configStore.getPayload(this.core.auth.http.base.href)
    return JSON.stringify({ ...state, knowledgeMentionScopeVersion: 1, mountAvailable: !!this.mounts, mcpConnections: Object.fromEntries(mounted.map(id => { const status = this.manager?.list().find(item => item.name === mcpMountName(id))?.status; return [id, { state: status?.state ?? 'connecting', toolCount: status?.state === 'connected' ? status.toolCount : 0 }] })), pinnedScopes: this.core.scopes.pins(), pinnedScopeDetails: this.core.scopes.pinDetails(), mountedServices: mounted, approvals: [...this.pendingApprovals].map(([id, pending]) => ({ id, contextId: pending.contextId, ...pending.prompt })), opcConfig: { platformBaseUrl: cfg.platform_base, appDomainRoot: cfg.effective_app_domain_root, rawAppDomainRoot: cfg.app_domain_root, defaultPort: cfg.app_default_port, workbenchName: cfg.workbench_name }, context: state.context ? { ...state.context, contextId: contextId(state.context), applicationContextId: this.core.auth.contexts.applicationContextId, epoch: this.core.auth.contexts.epoch } : null })
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
  async syncSession(): Promise<void> { await this.core.auth.syncSession() }
  @Remote
  async switchTenant(tenantId: string): Promise<void> { this.core.auth.switchTenant(tenantId) }
  @Remote
  async listKnowledgeBases(q: string): Promise<string> { return JSON.stringify(await this.core.knowledgeDirectory(q)) }
  @Remote
  async listSkillsCatalog(q: string): Promise<string> {
    const captured = this.core.auth.contexts.capture()
    const items = await this.core.catalog('skills', q)
    const installed = await this.core.installer.listAll(captured.context); captured.assertCurrent()
    return JSON.stringify(items.map(item => ({ ...item, installed: installed.find(record => record.catalog_id === item.catalog_id && record.tenant_id === item.tenant_id) ?? null })))
  }
  @Remote
  async installSkill(catalogId: string, expectedSha256: string, expectedContextId: string, tenantId: string): Promise<void> {
    await this.core.install({ catalogId, expectedSha256, contextId: expectedContextId, tenantId: tenantId || undefined })
  }
  @Remote
  async setSkillEnabled(catalogId: string, enabled: boolean, expectedContextId: string, tenantId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    const tenant = tenantId || captured.context.tenant
    if (!captured.context.spaces.includes(tenant)) throw new OpcError('SPACE_FORBIDDEN')
    if (enabled) await this.core.authz.catalog(tenant, catalogId)
    captured.assertCurrent()
    await this.core.installer.setEnabled(captured.context, catalogId, enabled, captured.assertCurrent, tenant)
    this.core.emit('skills-changed')
  }
  @Remote
  async uninstallSkill(catalogId: string, expectedContextId: string, tenantId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    const tenant = tenantId || captured.context.tenant
    if (!captured.context.spaces.includes(tenant)) throw new OpcError('SPACE_FORBIDDEN')
    await this.core.installer.remove(captured.context, catalogId, tenant); this.core.emit('skills-changed')
  }
  @Remote
  async setPinnedKnowledgeScope(sessionId: string, knowledgeBaseId: string | null, expectedContextId: string, tenantId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    const tenant = tenantId || captured.context.tenant
    if (knowledgeBaseId) {
      if (!captured.context.spaces.includes(tenant)) throw new OpcError('SPACE_FORBIDDEN')
      const available = await this.core.catalog('knowledge-bases'); captured.assertCurrent()
      if (!available.some(item => item.knowledge_base_id === knowledgeBaseId && item.tenant_id === tenant && item.availability === 'available')) throw new OpcError('RESOURCE_NOT_ACCESSIBLE')
    }
    this.core.scopes.pin(sessionId, knowledgeBaseId ? { tenantId: tenant, knowledgeBaseId, contextId: expectedContextId } : null)
    this.core.emit('change')
  }
  @Remote
  async searchKnowledge(sessionId: string, query: string, knowledgeBaseId: string, expectedContextId: string, tenantId: string): Promise<string> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    const session = `preview:${sessionId}`
    const tenant = tenantId || captured.context.tenant
    this.core.scopes.pin(session, knowledgeBaseId ? { tenantId: tenant, knowledgeBaseId, contextId: expectedContextId } : null)
    this.core.scopes.begin(session, 'preview')
    return JSON.stringify(await this.core.search(session, 'preview', query, knowledgeBaseId ? tenant : undefined, knowledgeBaseId || undefined))
  }
  @Remote
  async readKnowledgeDocument(sessionId: string, knowledgeId: string, expectedContextId: string, tenantId: string): Promise<string> {
    this.core.auth.contexts.capture(expectedContextId)
    return JSON.stringify(await this.core.read(`preview:${sessionId}`, 'preview', knowledgeId, tenantId || undefined))
  }
  @Remote
  async listMcpServices(): Promise<string> {
    return JSON.stringify(await this.core.listMcpServices())
  }
  @Remote
  async invokeMcpTool(serviceId: string, toolName: string, argumentsJson: string, expectedContextId: string, tenantId: string): Promise<string> {
    this.core.auth.contexts.capture(expectedContextId)
    const args: unknown = JSON.parse(argumentsJson)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OpcError('INVALID_ARGUMENTS')
    const result = await this.core.mcp.invoke({ serviceId, toolName, arguments: args as Record<string, unknown>, contextId: expectedContextId, tenantId: tenantId || undefined }, this.requestApproval)
    return JSON.stringify(result ?? null)
  }
  private requestApproval: RequestApproval = async () => {
    return 'allowed-once'
  }
  @Remote
  async mountMcpService(serviceId: string, expectedContextId: string, tenantId: string): Promise<void> { if (!this.mounts) throw new OpcError('MCP_MOUNT_UNAVAILABLE'); await this.mounts.mount(serviceId, expectedContextId, tenantId || undefined) }
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
