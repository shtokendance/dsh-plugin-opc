import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthManager, type StoredGrant } from '../src/host/auth.ts'
import { PlatformHttp } from '../src/host/http.ts'
import { OpcCore } from '../src/host/core.ts'
import { contextId } from '../src/host/context.ts'
import { ManagedMcpMounts } from '../src/host/mcp-mount.ts'

test('mounted transport gates callers, forwards through policy, and disappears on space switch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-mount-'))
  const grant: StoredGrant = { refreshToken: 'refresh', platformBaseUrl: 'https://platform.example/', lastContext: { issuer: 'https://platform.example', subject: 'a', tenant: 'a', spaces: ['a', 'b'], generation: 1 } }
  let invocations = 0, approvals = 0, disposals = 0
  const auth = new AuthManager(new PlatformHttp('https://platform.example', 1000, async url => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/refresh')) return Response.json({ access_token: 'enterprise-secret', refresh_token: 'new', expires_in: 900, subject: 'a', spaces: ['a', 'b'], tenant: 'a' })
    if (path.endsWith('/services')) return Response.json({ data: { services: [{ service_id: 'long-enterprise-service-identifier-for-native-manager', tools: [{ name: 'echo', input_schema: { type: 'object' } }] }] } })
    if (path.endsWith('/invoke')) { invocations++; return Response.json({ code: 'MCP_APPROVAL_REQUIRED', data: { invocation_id: 'inv', args_digest: 'digest', policy_version: '1' } }, { status: 202 }) }
    return Response.json({ data: { invocation_id: 'inv', status: 'succeeded', result: { answer: 42 } } })
  }), { read: async () => grant, write: async () => {}, delete: async () => {} }, async () => {})
  await auth.restore()
  let registration: { url: string; headers: Record<string, string> } | undefined
  const mounts = new ManagedMcpMounts(new OpcCore(auth, home), (name, entry) => { assert.match(name, /^[A-Za-z0-9_-]{1,32}$/); registration = entry; return () => { disposals++ } }, async () => { approvals++; return 'allowed-once' })
  try {
    const ctx = contextId(auth.contexts.capture().context)
    await mounts.mount('long-enterprise-service-identifier-for-native-manager', ctx)
    await mounts.mount('long-enterprise-service-identifier-for-native-manager', ctx)
    assert.deepEqual(mounts.list(), ['long-enterprise-service-identifier-for-native-manager'])
    assert.ok(registration)
    assert.equal(JSON.stringify(registration).includes('enterprise-secret'), false)
    const rpc = async (method: string, params = {}) => {
      const response = await fetch(registration!.url, { method: 'POST', headers: { ...registration!.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      return response.json() as Promise<any>
    }
    assert.equal((await fetch(registration.url, { method: 'POST' })).status, 401)
    assert.equal((await fetch(registration.url, { method: 'POST', headers: { ...registration.headers, Origin: 'https://untrusted.example' } })).status, 401)
    assert.equal((await rpc('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion, '2025-03-26')
    assert.equal((await rpc('tools/list')).result.tools[0].name, 'echo')
    assert.deepEqual(JSON.parse((await rpc('tools/call', { name: 'echo', arguments: {} })).result.content[0].text), { answer: 42 })
    assert.equal(invocations, 1); assert.equal(approvals, 1)
    auth.switchTenant('b')
    assert.deepEqual(mounts.list(), []); assert.equal(disposals, 1)
    await assert.rejects(fetch(registration.url))
  } finally { mounts.dispose(); await auth.dispose(); await rm(home, { recursive: true, force: true }) }
})
