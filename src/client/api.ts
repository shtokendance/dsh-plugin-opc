/** JSON business payloads use the same public methods as the Host Remote service. */
export interface AppModelGroup {
  id: string
  name: string
  models: readonly { id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[] } }[]
}
export interface OpcApi {
  appCatalog(context: string): Promise<string>
  appList(context: string): Promise<string>
  appModels(context: string): Promise<string>
  appCreate(input: string, session: string, context: string): Promise<string>
  appAnalyze(id: string, feedback: string, session: string, context: string): Promise<string>
  appPrepare(id: string, hash: string, context: string): Promise<string>
  appReopenReview?(id: string, context: string): Promise<string>
  appReopenDeployment(id: string, context: string): Promise<string>
  appCancelAnalysis?(id: string, context: string): Promise<void>
  appConfigDraft?(id: string, context: string): Promise<string>
  appSaveConfigDraft?(id: string, body: string, context: string): Promise<void>
  appLocalArtifact?(id: string, filename: string, context: string): Promise<string>
  appHandoff?(id: string, context: string): Promise<string>
  appSkillPreview(id: string, context: string): Promise<string>
  appConfirmDeployment(id: string, input: string, context: string): Promise<string>
  appPublish(id: string, confirmation: string, context: string): Promise<string>
  appVerify(id: string, context: string): Promise<string>
  appVerifyWithOptions?(id: string, optionsJson: string, context: string): Promise<string>
  appSetSkillEnabled?(id: string, enabled: boolean, context: string): Promise<void>
  appResources(context: string): Promise<string>
  appDetails(slug: string, context: string): Promise<string>
  appVersions?(slug: string, context: string): Promise<string>
  appLogs?(slug: string, context: string): Promise<string>
  appDownload?(slug: string, selection: string, context: string): Promise<string>
  appSaveDownload(slug: string, selection: string, context: string): Promise<string>
  appStorage?(slug: string, context: string): Promise<string>
  appRecheck?(slug: string, context: string): Promise<string>
  appUpdateConfig?(slug: string, bodyJson: string, context: string): Promise<string>
  appDelete?(slug: string, purgeVolumes: boolean, context: string): Promise<string>
  appRollback?(slug: string, payloadJson: string, context: string): Promise<string>
  state(): Promise<string>
  watchState(signal: AbortSignal): AsyncIterable<string>
  startLogin(): Promise<string>
  cancelLogin(): Promise<void>
  logout(): Promise<void>
  switchTenant(tenant: string): Promise<void>
  listKnowledgeBases(q: string): Promise<string>
  listSkillsCatalog(q: string): Promise<string>
  installSkill(id: string, sha: string, contextId: string): Promise<void>
  setSkillEnabled(id: string, enabled: boolean, contextId: string): Promise<void>
  uninstallSkill(id: string, contextId: string): Promise<void>
  setPinnedKnowledgeScope(session: string, kb: string | null, context: string): Promise<void>
  searchKnowledge(session: string, query: string, kb: string, context: string): Promise<string>
  readKnowledgeDocument(session: string, id: string, context: string): Promise<string>
  invokeMcpTool(service: string, tool: string, argumentsJson: string, contextId: string): Promise<string>
  decideDebugInvocation(id: string, allowed: boolean, contextId: string): Promise<void>
  mountMcpService(service: string, context: string): Promise<void>
  unmountMcpService(service: string, context: string): Promise<void>
  listMcpServices(): Promise<string>
}
export interface AuthState {
  pinnedScopes?: Record<string, string>
  mcpConnections?: Record<string, { state: string; toolCount: number }>
  knowledgeMentionScopeVersion?: number
  mountAvailable?: boolean
  mountedServices?: string[]
  approvals?: { id: string; contextId: string; serviceId: string; toolName: string; arguments: Record<string, unknown> }[]
  signedIn: boolean; loginInProgress: boolean; loginAuthorizeUrl?: string; loginError?: { code: string; message: string }
  context: null | { subject: string; tenant: string; spaces: string[]; contextId: string; applicationContextId?: string; displayName?: string; email?: string; spacesDetail?: { id: string; name: string }[] }
}
export interface Resource { name: string; description?: string; tenant_id: string; knowledge_base_id?: string; catalog_id?: string; version?: string; bundle_sha256?: string; availability: string; installed?: { enabled: boolean; active_sha256: string } }
