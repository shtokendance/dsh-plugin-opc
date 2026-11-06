import { ContextStore, OpcError } from './context.ts'

interface Scope { tenantId: string; knowledgeBaseId: string; epoch: number }
interface Turn extends Scope { hits: Set<string> }

/** Session pins and turn hit sets are isolated; neither is a global UI selection. */
export class KnowledgeScopes {
  #pins = new Map<string, Scope>()
  #turns = new Map<string, Map<string, Turn>>()
  constructor(private readonly contexts: ContextStore) {}
  pin(session: string, scope: { tenantId: string; knowledgeBaseId: string; contextId: string } | null): void {
    if (!scope) { this.#pins.delete(session); return }
    const snapshot = this.contexts.capture(scope.contextId)
    if (scope.tenantId !== snapshot.context.tenant) throw new OpcError('SCOPE_MISMATCH')
    this.#pins.set(session, { ...scope, epoch: snapshot.epoch })
  }
  pins(): Record<string, string> { return Object.fromEntries([...this.#pins].filter(([, scope]) => scope.epoch === this.contexts.epoch).map(([session, scope]) => [session, scope.knowledgeBaseId])) }
  begin(session: string, turn: string, prompt = ''): void {
    let scope = this.#pins.get(session)
    const refs = new Set(Array.from(prompt.matchAll(/\[OPC 知识库\]\(opc-kb:([^)]+)\)/g), match => match[1]))
    if (refs.size > 1) throw new OpcError('MULTIPLE_KNOWLEDGE_BASES', '每轮提问请选择一个知识库')
    for (const ref of refs) {
      const match = /^([a-f0-9]{32})\/([^/]+)$/.exec(ref)
      if (!match) throw new OpcError('INVALID_KNOWLEDGE_REFERENCE')
      const snapshot = this.contexts.capture(match[1])
      scope = { tenantId: snapshot.context.tenant, knowledgeBaseId: decodeURIComponent(match[2]), epoch: snapshot.epoch }
    }
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
    return { tenant_id: scope?.tenantId ?? space ?? this.contexts.capture().context.tenant, knowledge_base_id: scope?.knowledgeBaseId ?? knowledgeBaseId }
  }
  recordHits(session: string, turn: string, ids: string[]): void {
    const scope = this.scope(session, turn)
    for (const id of ids) scope?.hits.add(id)
  }
  assertReadable(session: string, turn: string, id: string): void {
    const scope = this.scope(session, turn)
    if (scope && !scope.hits.has(id)) throw new OpcError('SCOPE_MISMATCH')
  }
  verifyDocument(session: string, turn: string, tenant: string, knowledgeBaseId: string): void {
    const scope = this.scope(session, turn)
    if (scope && (scope.tenantId !== tenant || scope.knowledgeBaseId !== knowledgeBaseId)) throw new OpcError('SCOPE_MISMATCH')
  }
  end(session: string, turn: string): void { this.#turns.get(session)?.delete(turn) }
  clear(): void { this.#pins.clear(); this.#turns.clear() }
}
