import { ContextStore, OpcError } from './context.ts'

interface Scope { tenantId: string; knowledgeBaseId: string; epoch: number }
interface Turn extends Scope { hits: Set<string> }

export class KnowledgeScopes {
  #pins = new Map<string, Scope>()
  #turns = new Map<string, Map<string, Turn>>()
  #hitTenants = new Map<string, Map<string, Map<string, string>>>()
  constructor(private readonly contexts: ContextStore) {}
  pin(session: string, scope: { tenantId: string; knowledgeBaseId: string; contextId: string } | null): void {
    if (!scope) { this.#pins.delete(session); return }
    const snapshot = this.contexts.capture(scope.contextId)
    if (!snapshot.context.spaces.includes(scope.tenantId)) throw new OpcError('SCOPE_MISMATCH')
    this.#pins.set(session, { ...scope, epoch: snapshot.epoch })
  }
  pins(): Record<string, string> { return Object.fromEntries([...this.#pins].filter(([, scope]) => scope.epoch === this.contexts.epoch).map(([session, scope]) => [session, scope.knowledgeBaseId])) }
  pinDetails(): Record<string, { tenantId: string; knowledgeBaseId: string }> {
    return Object.fromEntries([...this.#pins].filter(([, scope]) => scope.epoch === this.contexts.epoch).map(([session, scope]) => [session, { tenantId: scope.tenantId, knowledgeBaseId: scope.knowledgeBaseId }]))
  }
  begin(session: string, turn: string, prompt = ''): void {
    let scope = this.#pins.get(session)
    const refs = new Set(Array.from(prompt.matchAll(/\[OPC 知识库\]\(opc-kb:([^)]+)\)/g), match => match[1]))
    if (refs.size > 1) throw new OpcError('MULTIPLE_KNOWLEDGE_BASES', '每轮提问请选择一个知识库')
    for (const ref of refs) {
      const triple = /^([a-f0-9]{32})\/([^/]+)\/([^/]+)$/.exec(ref)
      const pair = !triple ? /^([a-f0-9]{32})\/([^/]+)$/.exec(ref) : null
      if (!triple && !pair) throw new OpcError('INVALID_KNOWLEDGE_REFERENCE')
      const refContextId = triple ? triple[1] : pair![1]
      const snapshot = this.contexts.capture(refContextId)
      const tenantId = triple ? decodeURIComponent(triple[2]) : snapshot.context.tenant
      const knowledgeBaseId = decodeURIComponent(triple ? triple[3] : pair![2])
      if (!snapshot.context.spaces.includes(tenantId)) throw new OpcError('SPACE_FORBIDDEN')
      scope = { tenantId, knowledgeBaseId, epoch: snapshot.epoch }
    }
    this.#hitTenants.get(session)?.delete(turn)
    if (!scope || scope.epoch !== this.contexts.epoch) { this.#turns.get(session)?.delete(turn); return }
    const turns = this.#turns.get(session) ?? new Map<string, Turn>()
    turns.set(turn, { ...scope, hits: new Set() })
    this.#turns.set(session, turns)
  }
  scope(session: string, turn: string): Turn | undefined {
    this.contexts.capture()
    const scope = this.#turns.get(session)?.get(turn)
    if (scope && scope.epoch !== this.contexts.epoch) throw new OpcError('CONTEXT_CHANGED')
    return scope
  }
  searchParams(session: string, turn: string, space?: string, knowledgeBaseId?: string) {
    const scope = this.scope(session, turn)
    if (scope && ((space && space !== scope.tenantId) || (knowledgeBaseId && knowledgeBaseId !== scope.knowledgeBaseId))) throw new OpcError('SCOPE_MISMATCH')
    if (scope) return { tenant_id: scope.tenantId, knowledge_base_id: scope.knowledgeBaseId }
    if (space || knowledgeBaseId) {
      return { tenant_id: space ?? this.contexts.capture().context.tenant, knowledge_base_id: knowledgeBaseId }
    }
    return { all_spaces: true as const }
  }
  recordHits(session: string, turn: string, hits: (string | { id: string; tenantId?: string })[]): void {
    const scope = this.scope(session, turn)
    let sessionMap = this.#hitTenants.get(session)
    if (!sessionMap) {
      sessionMap = new Map()
      this.#hitTenants.set(session, sessionMap)
    }
    let turnMap = sessionMap.get(turn)
    if (!turnMap) {
      turnMap = new Map()
      sessionMap.set(turn, turnMap)
    }
    for (const hit of hits) {
      const id = typeof hit === 'string' ? hit : hit.id
      scope?.hits.add(id)
      if (typeof hit !== 'string' && hit.tenantId) turnMap.set(id, hit.tenantId)
    }
  }
  hitTenant(session: string, turn: string, id: string): string | undefined {
    return this.#hitTenants.get(session)?.get(turn)?.get(id)
  }
  assertReadable(session: string, turn: string, id: string): void {
    const scope = this.scope(session, turn)
    if (scope && !scope.hits.has(id)) throw new OpcError('SCOPE_MISMATCH')
  }
  verifyDocument(session: string, turn: string, tenant: string, knowledgeBaseId: string): void {
    const scope = this.scope(session, turn)
    if (scope && (scope.tenantId !== tenant || scope.knowledgeBaseId !== knowledgeBaseId)) throw new OpcError('SCOPE_MISMATCH')
  }
  end(session: string, turn: string): void {
    this.#turns.get(session)?.delete(turn)
    this.#hitTenants.get(session)?.delete(turn)
  }
  clear(): void {
    this.#pins.clear()
    this.#turns.clear()
    this.#hitTenants.clear()
  }
}
