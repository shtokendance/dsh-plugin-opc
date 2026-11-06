import { EventEmitter } from 'node:events'
import { AuthManager } from './auth.ts'
import { ResourceAuthorization, resourceItem, type ResourceItem } from './authz-cache.ts'
import { SkillInstaller } from './installer.ts'
import { KnowledgeScopes } from './knowledge-scope.ts'
import { McpBridge } from './mcp.ts'
import { OpcError } from './context.ts'

export class OpcCore extends EventEmitter {
  readonly installer: SkillInstaller
  readonly authz: ResourceAuthorization
  readonly scopes: KnowledgeScopes
  readonly mcp: McpBridge
  constructor(readonly auth: AuthManager, home: string) {
    super()
    this.installer = new SkillInstaller(home)
    this.authz = new ResourceAuthorization(auth, async (tenant, catalog) => {
      const { context } = auth.contexts.capture()
      if (context.tenant !== tenant) throw new OpcError('CONTEXT_CHANGED')
      await this.installer.remove(context, catalog); this.emit('skills-changed')
    })
    this.scopes = new KnowledgeScopes(auth.contexts)
    this.mcp = new McpBridge(auth)
    let epoch = auth.contexts.epoch
    auth.on('change', () => {
      if (epoch !== auth.contexts.epoch) { epoch = auth.contexts.epoch; this.scopes.clear(); this.emit('skills-changed') }
      this.emit('change')
    })
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
    const captured = this.auth.contexts.capture()
    const items: ResourceItem[] = []
    let offset = 0, complete = true
    for (;;) {
      const page = await this.request(`/integration/v1/resources/${kind}?tenant_id=${encodeURIComponent(captured.context.tenant)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=100`)
      captured.assertCurrent()
      if (!Array.isArray(page.items) || typeof page.total !== 'number') throw new OpcError('INVALID_PLATFORM_RESPONSE')
      complete &&= page.complete === true && (!Array.isArray(page.failures) || page.failures.length === 0)
      const current = page.items.map(resourceItem)
      if (current.some(item => item.tenant_id !== captured.context.tenant)) throw new OpcError('SCOPE_MISMATCH')
      items.push(...current)
      offset += current.length
      if (offset >= page.total || current.length === 0) {
        if (kind === 'skills' && !q && complete && offset >= page.total) {
          for (const record of await this.installer.list(captured.context)) {
            captured.assertCurrent()
            if (!items.some(item => item.catalog_id === record.catalog_id)) await this.installer.remove(captured.context, record.catalog_id)
          }
          this.emit('skills-changed')
        }
        return items
      }
    }
  }
  async install(input: { catalogId: string; expectedSha256: string; contextId: string }): Promise<void> {
    const captured = this.auth.contexts.capture(input.contextId)
    const item = await this.authz.catalog(captured.context.tenant, input.catalogId)
    captured.assertCurrent()
    if (item.bundle_sha256 !== input.expectedSha256) throw new OpcError('SKILL_VERSION_CHANGED')
    const token = await this.auth.token(); captured.assertCurrent()
    const archive = await this.auth.http.archive(`/integration/v1/resources/skills/${encodeURIComponent(input.catalogId)}/archive?tenant_id=${encodeURIComponent(captured.context.tenant)}&expected_sha256=${encodeURIComponent(input.expectedSha256)}`, token, captured.signal)
    captured.assertCurrent()
    await this.installer.install(captured.context, { ...input, name: item.name, version: item.version ?? '', headerSha256: archive.sha256, bytes: archive.bytes }, captured.assertCurrent)
    this.emit('skills-changed')
  }
  async search(session: string, turn: string, query: string, space?: string, knowledgeBaseId?: string) {
    const captured = this.auth.contexts.capture()
    const scope = this.scopes.searchParams(session, turn, space, knowledgeBaseId)
    if (scope.tenant_id !== captured.context.tenant) throw new OpcError('SPACE_FORBIDDEN')
    if (scope.knowledge_base_id) {
      await this.authz.knowledge(captured.context.tenant, scope.knowledge_base_id, () => this.catalog('knowledge-bases'))
    }
    captured.assertCurrent()
    const result = await this.request('/integration/v1/knowledge/search', { query, ...scope })
    captured.assertCurrent()
    if (!Array.isArray(result.results)) throw new OpcError('INVALID_PLATFORM_RESPONSE')
    const ids = result.results.map(hit => {
      if (!hit || typeof hit !== 'object' || typeof hit.knowledge_id !== 'string') throw new OpcError('INVALID_PLATFORM_RESPONSE')
      if (scope.knowledge_base_id && ((hit.source_tenant ?? hit.tenant_id) !== scope.tenant_id || hit.knowledge_base_id !== scope.knowledge_base_id)) throw new OpcError('SCOPE_MISMATCH')
      return hit.knowledge_id as string
    })
    this.scopes.recordHits(session, turn, ids)
    return result
  }
  async read(session: string, turn: string, knowledgeId: string) {
    const captured = this.auth.contexts.capture()
    this.scopes.assertReadable(session, turn, knowledgeId)
    const scope = this.scopes.scope(session, turn)
    await this.authz.session(); captured.assertCurrent()
    if (scope) await this.authz.knowledge(captured.context.tenant, scope.knowledgeBaseId, () => this.catalog('knowledge-bases'))
    captured.assertCurrent()
    const result = await this.request(`/integration/v1/knowledge/${encodeURIComponent(knowledgeId)}?include_content=true&tenant=${encodeURIComponent(captured.context.tenant)}${scope ? `&knowledge_base_id=${encodeURIComponent(scope.knowledgeBaseId)}` : ''}`)
    captured.assertCurrent()
    const data = result.data as { knowledge_base_id?: string; content?: string } | undefined
    this.scopes.verifyDocument(session, turn, String(result.source_tenant ?? ''), data?.knowledge_base_id ?? '')
    if (result.source_tenant !== captured.context.tenant || !data?.knowledge_base_id) throw new OpcError('SCOPE_MISMATCH')
    await this.authz.knowledge(captured.context.tenant, data.knowledge_base_id, () => this.catalog('knowledge-bases'))
    captured.assertCurrent()
    if (typeof data?.content !== 'string') throw new OpcError('KNOWLEDGE_CONTENT_UNAVAILABLE', '平台未返回文档正文，需要启用正文读取接口。')
    return result
  }
}
