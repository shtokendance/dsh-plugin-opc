/** JSON business payloads use the same public methods as the Host Remote service. */
export interface OpcApi {
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
  context: null | { subject: string; tenant: string; spaces: string[]; contextId: string; displayName?: string; email?: string; spacesDetail?: { id: string; name: string }[] }
}
export interface Resource { name: string; description?: string; tenant_id: string; knowledge_base_id?: string; catalog_id?: string; version?: string; bundle_sha256?: string; availability: string; installed?: { enabled: boolean; active_sha256: string } }
