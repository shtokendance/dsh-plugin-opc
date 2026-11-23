import { EventEmitter } from 'node:events'
import { AuthManager } from './auth.ts'
import { dedupeResources, resourceAccessRank, ResourceAuthorization, resourceItem, type ResourceItem } from './authz-cache.ts'
import { SkillInstaller } from './installer.ts'
import { KnowledgeScopes } from './knowledge-scope.ts'
import { McpBridge } from './mcp.ts'
import { OpcError } from './context.ts'

export class OpcCore extends EventEmitter {
  readonly installer: SkillInstaller
  readonly authz: ResourceAuthorization
  readonly scopes: KnowledgeScopes
  readonly mcp: McpBridge
  #mcpServiceTenants = new Map<string, string>()
  constructor(readonly auth: AuthManager, home: string) {
    super()
    this.installer = new SkillInstaller(home)
    this.authz = new ResourceAuthorization(auth, async (tenant, catalog) => {
      const { context } = auth.contexts.capture()
      if (!context.spaces.includes(tenant)) throw new OpcError('CONTEXT_CHANGED')
      await this.installer.remove(context, catalog, tenant); this.emit('skills-changed')
    })
    this.scopes = new KnowledgeScopes(auth.contexts)
    this.mcp = new McpBridge(auth)
    let epoch = auth.contexts.epoch
    auth.on('change', () => {
      if (epoch !== auth.contexts.epoch) { epoch = auth.contexts.epoch; this.scopes.clear(); this.#mcpServiceTenants.clear(); this.emit('skills-changed') }
      this.emit('change')
    })
  }
  resolveMcpServiceTenant(serviceId: string): string | undefined {
    return this.#mcpServiceTenants.get(serviceId)
  }
  async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const captured = this.auth.contexts.capture()
    const token = await this.auth.token(); captured.assertCurrent()
    const response = await this.auth.http.request(path, { body, token, signal: captured.signal })
    captured.assertCurrent()
    if (response.status >= 400) {
      const error = response.body.error as { code?: string } | undefined
      throw new OpcError(error?.code ?? 'PLATFORM_REQUEST_FAILED')
    }
    return response.body
  }
  async catalog(kind: 'skills' | 'knowledge-bases', q = ''): Promise<ResourceItem[]> {
    return (await this.resourceDirectory(kind, q)).items
  }
  async knowledgeDirectory(q = '') {
    return this.resourceDirectory('knowledge-bases', q)
  }
  async listMcpServices(): Promise<Record<string, unknown>> {
    const captured = this.auth.contexts.capture()
    const spaceNames = new Map((captured.context.spacesDetail ?? []).map(item => [item.id, item.name]))
    const body = await this.request('/integration/v1/mcp/services?include_schema=true&all_spaces=true')
    captured.assertCurrent()
    const data = body.data as { services?: Record<string, unknown>[] } | undefined
    const rawServices = Array.isArray(data?.services) ? data.services : Array.isArray(body.services) ? (body.services as Record<string, unknown>[]) : []
    const hasTenantInfo = rawServices.length > 0 && rawServices.every(item => typeof item.tenant_id === 'string' && item.tenant_id !== '')
    let merged: Record<string, unknown>[] = rawServices
    if (!hasTenantInfo && captured.context.spaces.length > 1) {
      const collected: Record<string, unknown>[] = []
      for (const tenant of captured.context.spaces) {
        try {
          const perTenant = await this.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(tenant)}`)
          captured.assertCurrent()
          const perData = perTenant.data as { services?: Record<string, unknown>[] } | undefined
          const list = Array.isArray(perData?.services) ? perData.services : []
          for (const svc of list) {
            collected.push({
              ...svc,
              tenant_id: typeof svc.tenant_id === 'string' && svc.tenant_id ? svc.tenant_id : tenant,
              tenant_name: typeof svc.tenant_name === 'string' && svc.tenant_name ? svc.tenant_name : (spaceNames.get(tenant) ?? tenant),
            })
          }
        } catch {
          continue
        }
      }
      merged = collected
    } else {
      merged = rawServices.map(svc => {
        const tid = typeof svc.tenant_id === 'string' && svc.tenant_id ? svc.tenant_id : captured.context.tenant
        const tname = typeof svc.tenant_name === 'string' && svc.tenant_name ? svc.tenant_name : (spaceNames.get(tid) ?? tid)
        return { ...svc, tenant_id: tid, tenant_name: tname }
      })
    }
    const bestIdx = new Map<string, number>()
    const deduped: Record<string, unknown>[] = []
    for (const svc of merged) {
      const id = String(svc.service_id ?? '')
      if (!id) continue
      const tid = String(svc.tenant_id ?? captured.context.tenant)
      const sourceTid = typeof svc.source_tenant_id === 'string' && svc.source_tenant_id ? svc.source_tenant_id : undefined
      const perm = typeof svc.permission === 'string' ? svc.permission : undefined
      const owner = sourceTid ?? tid
      const key = `${owner}\0${id}`
      const idx = bestIdx.get(key)
      if (idx !== undefined) {
        const cur = deduped[idx]
        const curTid = String(cur.tenant_id ?? '')
        const curSource = typeof cur.source_tenant_id === 'string' ? cur.source_tenant_id : undefined
        const curPerm = typeof cur.permission === 'string' ? cur.permission : undefined
        const curRank = resourceAccessRank(curTid, curSource, curPerm)
        const newRank = resourceAccessRank(tid, sourceTid, perm)
        if (newRank > curRank || (newRank === curRank && tid < curTid)) {
          deduped[idx] = svc
        }
        continue
      }
      bestIdx.set(key, deduped.length)
      deduped.push(svc)
    }
    this.#mcpServiceTenants.clear()
    for (const svc of deduped) {
      const id = String(svc.service_id ?? '')
      const tid = String(svc.tenant_id ?? captured.context.tenant)
      if (id && !this.#mcpServiceTenants.has(id)) this.#mcpServiceTenants.set(id, tid)
    }
    return { ...body, data: { services: deduped } }
  }
  private async resourceDirectory(kind: 'skills' | 'knowledge-bases', q: string) {
    const captured = this.auth.contexts.capture()
    const spaceNames = new Map((captured.context.spacesDetail ?? []).map(item => [item.id, item.name]))
    const items: ResourceItem[] = []
    const sharedQuery = kind === 'knowledge-bases' ? '&include_shared=true' : ''
    let offset = 0, complete = true, includesShared = kind === 'knowledge-bases'
    for (;;) {
      const page = await this.request(`/integration/v1/resources/${kind}?q=${encodeURIComponent(q)}&offset=${offset}&limit=100${sharedQuery}`)
      captured.assertCurrent()
      if (!Array.isArray(page.items) || typeof page.total !== 'number') throw new OpcError('INVALID_PLATFORM_RESPONSE')
      complete &&= page.complete === true && (!Array.isArray(page.failures) || page.failures.length === 0)
      includesShared &&= page.includes_shared === true
      const current = page.items.map(raw => {
        const parsed = resourceItem(raw)
        if (!parsed.tenant_name) parsed.tenant_name = spaceNames.get(parsed.tenant_id) ?? parsed.tenant_id
        return parsed
      })
      if (current.some(item => !captured.context.spaces.includes(item.tenant_id))) throw new OpcError('SCOPE_MISMATCH')
      items.push(...current)
      offset += current.length
      if (offset >= page.total || current.length === 0) {
        const deduped = dedupeResources(items)
        if (kind === 'skills' && !q && complete && offset >= page.total) {
          for (const record of await this.installer.listAll(captured.context)) {
            captured.assertCurrent()
            if (!deduped.some(item => item.catalog_id === record.catalog_id && item.tenant_id === record.tenant_id)) {
              await this.installer.remove(captured.context, record.catalog_id, record.tenant_id)
            }
          }
          this.emit('skills-changed')
        }
        if (kind === 'knowledge-bases' && !complete) throw new OpcError('RESOURCE_DIRECTORY_INCOMPLETE', '知识库目录加载不完整，请刷新重试。')
        return { items: deduped, includesShared }
      }
    }
  }
  async install(input: { catalogId: string; expectedSha256: string; contextId: string; tenantId?: string }): Promise<void> {
    const captured = this.auth.contexts.capture(input.contextId)
    const tenant = input.tenantId || captured.context.tenant
    if (!captured.context.spaces.includes(tenant)) throw new OpcError('SPACE_FORBIDDEN')
    const item = await this.authz.catalog(tenant, input.catalogId)
    captured.assertCurrent()
    if (item.bundle_sha256 !== input.expectedSha256) throw new OpcError('SKILL_VERSION_CHANGED')
    const token = await this.auth.token(); captured.assertCurrent()
    const archive = await this.auth.http.archive(`/integration/v1/resources/skills/${encodeURIComponent(input.catalogId)}/archive?tenant_id=${encodeURIComponent(tenant)}&expected_sha256=${encodeURIComponent(input.expectedSha256)}`, token, captured.signal)
    captured.assertCurrent()
    await this.installer.install(captured.context, { ...input, tenantId: tenant, name: item.name, version: item.version ?? '', headerSha256: archive.sha256, bytes: archive.bytes }, captured.assertCurrent)
    this.emit('skills-changed')
  }
  async search(session: string, turn: string, query: string, space?: string, knowledgeBaseId?: string) {
    const captured = this.auth.contexts.capture()
    const scope = this.scopes.searchParams(session, turn, space, knowledgeBaseId)
    if ('all_spaces' in scope) {
      const result = await this.request('/integration/v1/knowledge/search', { query, all_spaces: true, include_shared: true })
      captured.assertCurrent()
      if (!Array.isArray(result.results)) throw new OpcError('INVALID_PLATFORM_RESPONSE')
      const hits = result.results.map(hit => {
        if (!hit || typeof hit !== 'object' || typeof hit.knowledge_id !== 'string') throw new OpcError('INVALID_PLATFORM_RESPONSE')
        const hitTenant = String(hit.tenant_id ?? hit.source_tenant ?? '')
        if (!hitTenant || !captured.context.spaces.includes(hitTenant)) throw new OpcError('SCOPE_MISMATCH')
        return { id: hit.knowledge_id as string, tenantId: hitTenant }
      })
      this.scopes.recordHits(session, turn, hits)
      return result
    }
    if (!captured.context.spaces.includes(scope.tenant_id)) throw new OpcError('SPACE_FORBIDDEN')
    const scopedItem = scope.knowledge_base_id
      ? await this.authz.knowledge(scope.tenant_id, scope.knowledge_base_id, () => this.catalog('knowledge-bases'))
      : undefined
    captured.assertCurrent()
    const result = await this.request('/integration/v1/knowledge/search', { query, ...scope, include_shared: true })
    captured.assertCurrent()
    if (!Array.isArray(result.results)) throw new OpcError('INVALID_PLATFORM_RESPONSE')
    const hits = result.results.map(hit => {
      if (!hit || typeof hit !== 'object' || typeof hit.knowledge_id !== 'string') throw new OpcError('INVALID_PLATFORM_RESPONSE')
      if ((hit.tenant_id ?? hit.source_tenant) !== scope.tenant_id ||
        (scopedItem && (hit.knowledge_base_id !== scopedItem.knowledge_base_id || (hit.source_tenant ?? hit.tenant_id) !== (scopedItem.source_tenant_id ?? scopedItem.tenant_id)))) throw new OpcError('SCOPE_MISMATCH')
      return { id: hit.knowledge_id as string, tenantId: scope.tenant_id }
    })
    this.scopes.recordHits(session, turn, hits)
    return result
  }
  async read(session: string, turn: string, knowledgeId: string, explicitTenantId?: string) {
    const captured = this.auth.contexts.capture()
    this.scopes.assertReadable(session, turn, knowledgeId)
    const scope = this.scopes.scope(session, turn)
    const targetTenant = scope?.tenantId ?? explicitTenantId ?? this.scopes.hitTenant(session, turn, knowledgeId) ?? captured.context.tenant
    if (!captured.context.spaces.includes(targetTenant)) throw new OpcError('SPACE_FORBIDDEN')
    await this.authz.session(); captured.assertCurrent()
    const scopedItem = scope ? await this.authz.knowledge(scope.tenantId, scope.knowledgeBaseId, () => this.catalog('knowledge-bases')) : undefined
    captured.assertCurrent()
    const result = await this.request(`/integration/v1/knowledge/${encodeURIComponent(knowledgeId)}?include_content=true&include_shared=true&tenant=${encodeURIComponent(targetTenant)}${scope ? `&knowledge_base_id=${encodeURIComponent(scope.knowledgeBaseId)}` : ''}`)
    captured.assertCurrent()
    const data = result.data as { knowledge_base_id?: string; content?: string } | undefined
    const tenant = result.tenant_id ?? result.source_tenant
    if (tenant !== targetTenant || !data?.knowledge_base_id) throw new OpcError('SCOPE_MISMATCH')
    this.scopes.verifyDocument(session, turn, tenant, data.knowledge_base_id)
    const item = scopedItem ?? await this.authz.knowledge(tenant, data.knowledge_base_id, () => this.catalog('knowledge-bases'))
    if (result.source_tenant !== (item.source_tenant_id ?? item.tenant_id)) throw new OpcError('SCOPE_MISMATCH')
    captured.assertCurrent()
    if (typeof data?.content !== 'string') throw new OpcError('KNOWLEDGE_CONTENT_UNAVAILABLE', '平台未返回文档正文，需要启用正文读取接口。')
    return result
  }
}
