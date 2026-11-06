import { createHash } from 'node:crypto'

export interface EnterpriseContext {
  issuer: string
  subject: string
  tenant: string
  generation: number
  spaces: string[]
  spacesDetail?: { id: string; name: string }[]
  displayName?: string
  email?: string
}

export class OpcError extends Error {
  constructor(public readonly code: string, message: string = code) {
    super(message)
    this.name = 'OpcError'
  }
}

export function contextId(context: EnterpriseContext): string {
  return createHash('sha256').update(`${context.issuer}|${context.subject}|${context.tenant}|${context.generation}`).digest('hex').slice(0, 32)
}

export function identityHash(context: Pick<EnterpriseContext, 'issuer' | 'subject'>): string {
  if (!context.issuer.trim() || !context.subject.trim()) throw new OpcError('INVALID_IDENTITY')
  return createHash('sha256').update(`${context.issuer.trim()}\n${context.subject.trim()}`.normalize('NFC')).digest('hex')
}

/** Epoch also changes on A -> B -> A, preventing stale work from reviving. */
export class ContextStore {
  #context: EnterpriseContext | null = null
  #epoch = 0
  #controller = new AbortController()
  get current(): EnterpriseContext | null { return this.#context && structuredClone(this.#context) }
  get epoch(): number { return this.#epoch }
  replace(context: EnterpriseContext | null): void {
    this.#controller.abort(new OpcError('CONTEXT_CHANGED'))
    this.#controller = new AbortController()
    this.#context = context && structuredClone(context)
    this.#epoch++
  }
  capture(expectedId?: string): { context: EnterpriseContext; epoch: number; signal: AbortSignal; assertCurrent: () => void } {
    const context = this.current
    if (!context) throw new OpcError('ENTERPRISE_NOT_AUTHENTICATED')
    if (expectedId && contextId(context) !== expectedId) throw new OpcError('CONTEXT_CHANGED')
    const epoch = this.#epoch
    return { context, epoch, signal: this.#controller.signal, assertCurrent: () => {
      if (epoch !== this.#epoch) throw new OpcError('CONTEXT_CHANGED')
    } }
  }
  switchTenant(tenant: string): void {
    const { context } = this.capture()
    if (!context.spaces.includes(tenant)) throw new OpcError('SPACE_FORBIDDEN')
    this.replace({ ...context, tenant, generation: context.generation + 1 })
  }
}
