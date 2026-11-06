import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthManager, type StoredGrant } from '../src/host/auth.ts'
import { PlatformHttp } from '../src/host/http.ts'
import { McpBridge } from '../src/host/mcp.ts'

async function setup() {
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const grant: StoredGrant = { refreshToken: 'refresh', platformBaseUrl: 'https://platform.example/', lastContext: { issuer: 'https://platform.example', subject: 'a', tenant: 'a', spaces: ['a', 'b'], generation: 1 } }
  const http = new PlatformHttp('https://platform.example', 1000, async (url, init) => {
    const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ path, body })
    if (path.endsWith('/refresh')) return Response.json({ access_token: 'access', refresh_token: 'new', expires_in: 900, subject: 'a', spaces: ['a', 'b'], tenant: 'a' })
    if (path.endsWith('/invoke')) return Response.json({ success: true, code: 'MCP_APPROVAL_REQUIRED', data: { invocation_id: 'inv1', status: 'waiting_approval', args_digest: 'digest', policy_version: 'v1' } }, { status: 202 })
    if (path.endsWith('/decision')) return Response.json({ success: true, data: { invocation: { invocation_id: 'inv1', status: 'executing' } } })
    return Response.json({ success: true, data: { invocation_id: 'inv1', status: 'succeeded', result: { answer: 42 } } })
  })
  const auth = new AuthManager(http, { read: async () => grant, write: async () => {}, delete: async () => {} }, async () => {})
  await auth.restore()
  return { auth, calls, mcp: new McpBridge(auth, { pollMs: 1, timeoutMs: 1000 }) }
}
test('approval sends authoritative digest and policy then polls result', async () => {
  const { auth, calls, mcp } = await setup()
  assert.deepEqual(await mcp.invoke({ serviceId: 's', toolName: 'write' }, async () => 'allowed-once'), { answer: 42 })
  assert.deepEqual(calls.find(c => c.path.endsWith('/decision'))?.body, { decision: 'approve', args_digest: 'digest', policy_version: 'v1' })
  assert.equal(calls.filter(c => c.path.endsWith('/invoke')).length, 1)
  await auth.dispose()
})
test('space switch or unavailable approver never sends decision', async () => {
  for (const change of [true, false]) {
    const { auth, calls, mcp } = await setup()
    await assert.rejects(mcp.invoke({ serviceId: 's', toolName: 'write' }, async () => {
      if (change) auth.switchTenant('b')
      return change ? 'allowed-once' : 'unavailable'
    }), { code: 'INVOCATION_UNKNOWN_OUTCOME' })
    assert.equal(calls.some(c => c.path.endsWith('/decision')), false)
    await auth.dispose()
  }
})
test('rejected approval submits deny exactly once', async () => {
  const { auth, calls, mcp } = await setup()
  await assert.rejects(mcp.invoke({ serviceId: 's', toolName: 'write' }, async () => 'rejected'), { code: 'MCP_INVOCATION_DENIED' })
  assert.equal(calls.filter(c => c.path.endsWith('/decision')).length, 1)
  assert.equal(calls.find(c => c.path.endsWith('/decision'))?.body.decision, 'deny')
  await auth.dispose()
})
