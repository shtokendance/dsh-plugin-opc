import { AuthManager } from './auth.ts'
import { OpcError } from './context.ts'

export interface ResourceItem {
  tenant_id: string; availability: string; catalog_id?: string; knowledge_base_id?: string
  name: string; version?: string; bundle_sha256?: string; description?: string
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpcError('INVALID_PLATFORM_RESPONSE')
  return value as Record<string, unknown>
}
export function resourceItem(value: unknown): ResourceItem {
  const item = object(value)
  if (typeof item.tenant_id !== 'string' || typeof item.name !== 'string' || typeof item.availability !== 'string') throw new OpcError('INVALID_PLATFORM_RESPONSE')
  return {
    tenant_id: item.tenant_id, name: item.name, availability: item.availability,
    catalog_id: typeof item.catalog_id === 'string' ? item.catalog_id : undefined,
    knowledge_base_id: typeof item.knowledge_base_id === 'string' ? item.knowledge_base_id : undefined,
    version: typeof item.version === 'string' ? item.version : undefined,
    bundle_sha256: typeof item.bundle_sha256 === 'string' ? item.bundle_sha256 : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
  }
}

/** Cache keys include the captured epoch; late authorization never crosses identities. */
export class ResourceAuthorization {
  #entries = new Map<string, { expires: number; item: ResourceItem }>()
  #sessionExpires = 0
  #epoch = -1
  constructor(private readonly auth: AuthManager, private readonly onRevoked: (tenant: string, catalog: string) => Promise<void>) {}
  private sync(): void {
    if (this.#epoch === this.auth.contexts.epoch) return
    this.#entries.clear(); this.#sessionExpires = 0; this.#epoch = this.auth.contexts.epoch
  }
  async session(): Promise<void> {
    this.sync()
    const captured = this.auth.contexts.capture()
    if (this.#sessionExpires > Date.now()) return
    const token = await this.auth.token(); captured.assertCurrent()
    const response = await this.auth.http.request('/integration/v1/session', { token, signal: captured.signal })
    captured.assertCurrent()
    if (response.status !== 200) {
      const code = (response.body.error as { code?: string } | undefined)?.code
      if (response.status === 401 || code === 'SESSION_REVOKED') await this.auth.invalidateSession()
      throw new OpcError(code ?? 'SESSION_NOT_AUTHORIZED')
    }
    if (!Array.isArray(response.body.spaces) || !response.body.spaces.includes(captured.context.tenant)) throw new OpcError('SPACE_FORBIDDEN')
    this.#sessionExpires = Date.now() + 60_000
  }
  async knowledge(tenant: string, id: string, list: () => Promise<ResourceItem[]>): Promise<void> {
    this.sync()
    const captured = this.auth.contexts.capture()
    if (tenant !== captured.context.tenant) throw new OpcError('SPACE_FORBIDDEN')
    await this.session(); captured.assertCurrent()
    const key = JSON.stringify(['knowledge', tenant, id])
    const cached = this.#entries.get(key)
    if (cached && cached.expires > Date.now()) return
    // Platform exposes the authorized KB directory, not a single-KB resource route.
    const items = await list(); captured.assertCurrent()
    const item = items.find(item => item.tenant_id === tenant && item.knowledge_base_id === id && item.availability === 'available')
    if (!item) { this.#entries.delete(key); throw new OpcError('RESOURCE_NOT_ACCESSIBLE') }
    this.#entries.set(key, { item, expires: Date.now() + 30_000 })
  }
  async catalog(tenant: string, catalog: string): Promise<ResourceItem> {
    this.sync()
    const captured = this.auth.contexts.capture()
    if (tenant !== captured.context.tenant) throw new OpcError('SPACE_FORBIDDEN')
    try { await this.session() } catch (error) {
      if (error instanceof OpcError && error.code === 'SPACE_FORBIDDEN') await this.onRevoked(tenant, catalog)
      throw error
    }
    captured.assertCurrent()
    const key = JSON.stringify([tenant, catalog])
    const cached = this.#entries.get(key)
    if (cached && cached.expires > Date.now()) return cached.item
    const token = await this.auth.token(); captured.assertCurrent()
    const response = await this.auth.http.request(`/integration/v1/resources/skills/${encodeURIComponent(catalog)}?tenant_id=${encodeURIComponent(tenant)}`, { token, signal: captured.signal })
    captured.assertCurrent()
    if ([403, 404].includes(response.status)) { await this.onRevoked(tenant, catalog); throw new OpcError('RESOURCE_NOT_ACCESSIBLE') }
    if (response.status !== 200) throw new OpcError('RESOURCE_AUTHORIZATION_FAILED')
    const item = resourceItem(response.body.item)
    if (item.tenant_id !== tenant || item.catalog_id !== catalog || item.availability !== 'available') throw new OpcError('RESOURCE_NOT_ACCESSIBLE')
    this.#entries.set(key, { item, expires: Date.now() + 30_000 })
    return item
  }
}
