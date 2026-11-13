/** JSON business payloads use the same public methods as the Host Remote service. */
export interface AppModelGroup {
  id: string
  name: string
  models: readonly { id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[] } }[]
}
export interface AppConfigItem {
  key: string
  value: string
  description?: string
  required?: boolean
  secret?: boolean
  has_value?: boolean
  has_original_value?: boolean
  local_connection_confirmed?: boolean
  value_source?: string
  source_label?: string
  resource_id?: string
}

export interface ResourceSummary {
  id: string
  name: string
  type: string
  description: string
  env_keys: string[]
  env_preview?: Record<string, string>
}

export interface AppStorageMountDetail {
  name: string
  container_path: string
  relative_path?: string
  purpose?: string
  kind?: string
  volume_name?: string
  host_path?: string
  storage_backend?: string
  seed_files_count?: number
  size_bytes?: number
  size_human?: string
  file_count?: number
  sample_files?: string[]
  status?: string
  seed_protected?: boolean
}

export interface AppStorageOverview {
  app_slug: string
  app_name: string
  app_status: string
  mounts_count: number
  total_bytes: number
  total_human: string
  total_files: number
  mounts: AppStorageMountDetail[]
}

export interface AppVersionItem {
  id: string
  app_id: string
  slug: string
  version: number
  version_note?: string
  source_job_id?: string
  artifact_hash?: string
  caprover_version?: number
  caprover_image_name?: string
  container_port: number
  app_config?: AppConfigItem[]
  resource_ids?: string[]
  apis_summary?: { id: string; method: string; path: string; purpose?: string; effect?: string }[]
  pages_summary?: { path: string; purpose?: string }[]
  catalog_skill_id?: string
  artifact_bucket?: string
  artifact_prefix?: string
  app_tar_key?: string
  app_tar_size?: number
  skill_zip_key?: string
  skill_zip_size?: number
  dockerfile_key?: string
  manifest_key?: string
  status: string
  is_active: boolean
  deployed_by?: string
  created_at: string
}

export interface DeployedApp {
  can_manage?: boolean
  id?: string
  name: string
  slug: string
  description?: string
  language?: string
  runtime_version?: string
  dockerfile_content?: string
  app_url: string
  container_port?: number
  status: 'building' | 'running' | 'failed' | 'unhealthy' | string
  current_version?: number
  app_config?: AppConfigItem[]
  resource_ids?: string[]
  storage_mounts?: AppStorageMountDetail[]
  config_fingerprint?: string
  skill_name?: string
  catalog_skill_id?: string
  skill_synced?: boolean
  build_log?: string
  error_message?: string
  created_by?: string
  created_at?: string
  updated_at?: string
}

export interface AppDeliveryJob {
  id: string
  slug: string
  name: string
  description?: string
  port?: number
  status: string
  url: string
  events: string[]
  error?: string
  upgrade?: boolean
  versionNote?: string
  model?: string
  reasoning_effort?: string
  revision_count?: number
  revisionCount?: number
  analysis_mode?: 'analysis' | 'repair' | string
  analysisMode?: 'analysis' | 'repair'
  analysis_failure?: string
  failedRevision?: string
  conversation?: { role: string; text: string; revision?: number }[]
  proposalHash?: string
  artifactHash?: string
  version?: number
  published?: boolean
  pagesVerified?: boolean
  pages_verified?: boolean
  userDisabled?: boolean
  resources?: ResourceSummary[]
  artifacts?: Record<string, string>
  runtime_configs?: AppConfigItem[]
  preparationChecks?: { label: string; status: string; detail: string }[]
  configuration_problems?: { key: string; reason: string }[]
  discoveryReport?: NonNullable<AppDeliveryJob['proposal']>['discovery_report']
  transformationReport?: NonNullable<AppDeliveryJob['proposal']>['transformation_report']
  verification?: { status: string; checks: { operation: string; status?: number; passed: boolean }[]; pages_verified: boolean; detail?: string; skill_enabled?: boolean }
  proposal?: {
    summary: string
    issues?: { id?: string; evidence?: unknown; impact?: string; recommendation?: string; severity?: string; title?: string; detail?: string; resolution?: string }[]
    unresolved?: unknown[]
    decisions?: { id: string; question: string; impact?: string; options: (string | { id: string; label: string; recommended?: boolean })[]; default?: string }[]
    changes?: { id?: string; path: string; reason: string; group?: string; diff?: string }[]
    discovery_report?: Record<string, any>
    transformation_report?: Record<string, any>
    four_step_report?: Record<string, any>
    contract?: {
      description?: string
      runtime?: { language?: string; version?: string; port?: number }
      health?: { path?: string; status?: number; json_contains?: Record<string, unknown> }
      configs?: { key: string; default?: string; description?: string; secret?: boolean; required?: boolean; has_original_value?: boolean; source?: { path: string; keys: (string | number)[] } }[]
      resources?: { id?: string; type?: string; purpose?: string; env?: string[]; current_hint?: string }[]
      storage_mounts?: AppStorageMountDetail[]
      verification_credential_fields?: { key: string; kind: 'username' | 'password' | 'session' }[]
      verification?: { cases?: { operation: string; status?: number; params?: Record<string, unknown>; body?: unknown; json_contains?: unknown }[] }
      apis?: { id: string; purpose: string; method: string; path: string; effect?: string; auth?: { type?: string; env?: string; header?: string } }[]
      pages?: { path: string; purpose: string; actions?: string[] }[]
    }
  }
}

export interface OpcApi {
  appCatalog(context: string): Promise<string>
  appList(context: string): Promise<string>
  appJob?(id: string, context: string): Promise<string>
  appCheckSlug?(slug: string, context: string): Promise<string>
  appOpcConfig?(context: string): Promise<string>
  appPickSourceFolder?(context: string): Promise<string>
  appModels(context: string): Promise<string>
  appCreate(input: string, session: string, context: string): Promise<string>
  appAnalyze(id: string, feedback: string, session: string, context: string): Promise<string>
  appAnalyzeWithMode?(id: string, feedback: string, session: string, mode: string, context: string): Promise<string>
  appPrepare(id: string, hash: string, context: string): Promise<string>
  appReopenReview?(id: string, context: string): Promise<string>
  appReopenDeployment(id: string, context: string): Promise<string>
  appCancelAnalysis?(id: string, context: string): Promise<void>
  appConfigDraft?(id: string, context: string): Promise<string>
  appSaveConfigDraft?(id: string, body: string, context: string): Promise<void>
  appLocalArtifact?(id: string, filename: string, context: string): Promise<string>
  appSaveLocalArtifact?(id: string, filename: string, context: string): Promise<string>
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
