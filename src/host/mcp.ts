import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AuthManager } from './auth.ts'
import { OpcError } from './context.ts'
import type { PlatformResponse } from './http.ts'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export interface ApprovalPrompt { serviceId: string; toolName: string; arguments: Record<string, unknown>; invocationId: string; signal: AbortSignal }
export type RequestApproval = (prompt: ApprovalPrompt) => Promise<ApprovalOutcome>
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function checked(response: PlatformResponse): Record<string, unknown> {
  if (response.status >= 400) throw new OpcError(String(record(response.body.error).code ?? 'MCP_REQUEST_FAILED'))
  return response.body
}
function invocation(body: Record<string, unknown>): Record<string, unknown> {
  const data = record(body.data)
  return record(data.invocation).invocation_id ? record(data.invocation) : data.invocation_id ? data : record(body.approval).invocation_id ? record(body.approval) : body
}

/** One submission and one decision; an unknown write outcome is never retried. */
export class McpBridge {
  constructor(private readonly auth: AuthManager, private readonly options = { pollMs: 1000, timeoutMs: 120_000 }) {}
  async invoke(input: { serviceId: string; toolName: string; arguments?: Record<string, unknown>; contextId?: string }, approve: RequestApproval, signal?: AbortSignal): Promise<unknown> {
    const captured = this.auth.contexts.capture(input.contextId)
    const combined = AbortSignal.any([captured.signal, AbortSignal.timeout(this.options.timeoutMs), ...(signal ? [signal] : [])])
    const tenant = encodeURIComponent(captured.context.tenant)
    let submitted = false
    const request = async (path: string, body?: unknown) => {
      combined.throwIfAborted(); captured.assertCurrent()
      const token = await this.auth.token(); captured.assertCurrent(); combined.throwIfAborted()
      return this.auth.http.request(path, { body, token, signal: combined })
    }
    try {
      const args = structuredClone(input.arguments ?? {})
      submitted = true
      const response = await request('/integration/v1/mcp/invoke', { service_id: input.serviceId, tool_name: input.toolName, arguments: args, tenant_id: captured.context.tenant, idempotency_key: randomUUID() })
      captured.assertCurrent()
      const body = checked(response)
      let current = invocation(body)
      const id = current.invocation_id
      const approvalRequired = body.code === 'MCP_APPROVAL_REQUIRED' || record(body.error).code === 'MCP_APPROVAL_REQUIRED' || current.status === 'waiting_approval'
      if (approvalRequired) {
        if (typeof id !== 'string') throw new OpcError('INVALID_APPROVAL_RESPONSE')
        const path = `/integration/v1/mcp/invocations/${encodeURIComponent(id)}`
        if (!current.args_digest || !current.policy_version) current = invocation(checked(await request(`${path}?tenant=${tenant}`)))
        if (typeof current.args_digest !== 'string' || typeof current.policy_version !== 'string') throw new OpcError('INVALID_APPROVAL_RESPONSE')
        const outcome = await Promise.race([
          approve({ serviceId: input.serviceId, toolName: input.toolName, arguments: args, invocationId: id, signal: combined }),
          new Promise<never>((_, reject) => {
            if (combined.aborted) reject(combined.reason)
            else combined.addEventListener('abort', () => reject(combined.reason), { once: true })
          }),
        ])
        captured.assertCurrent(); combined.throwIfAborted()
        if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new OpcError('INVOCATION_UNKNOWN_OUTCOME')
        const decided = checked(await request(`${path}/decision?tenant=${tenant}`, { decision: outcome === 'allowed-once' ? 'approve' : 'deny', args_digest: current.args_digest, policy_version: current.policy_version }))
        captured.assertCurrent()
        if (outcome === 'rejected') throw new OpcError('MCP_INVOCATION_DENIED')
        current = invocation(decided)
      }
      if (typeof id !== 'string') {
        if (response.status !== 200) throw new OpcError('INVOCATION_UNKNOWN_OUTCOME')
        return body.result ?? body.data ?? body
      }
      for (;;) {
        captured.assertCurrent(); combined.throwIfAborted()
        switch (current.status) {
          case 'succeeded': return current.result
          case 'failed': throw new OpcError('MCP_INVOCATION_FAILED')
          case 'cancelled': throw new OpcError('MCP_INVOCATION_CANCELLED')
          case 'denied': throw new OpcError('MCP_INVOCATION_DENIED')
          case 'unknown_outcome': throw new OpcError('INVOCATION_UNKNOWN_OUTCOME')
          case 'waiting_oauth': throw new OpcError('MCP_OAUTH_REQUIRED')
        }
        await delay(this.options.pollMs, undefined, { signal: combined })
        current = invocation(checked(await request(`/integration/v1/mcp/invocations/${encodeURIComponent(id)}?tenant=${tenant}`)))
      }
    } catch (error) {
      if (submitted && (combined.aborted || !(error instanceof OpcError))) throw new OpcError('INVOCATION_UNKNOWN_OUTCOME')
      throw error
    }
  }
}
