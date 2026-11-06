import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { AuthManager, type StoredGrant } from '../src/host/auth.ts'
import { PlatformHttp } from '../src/host/http.ts'
import { OpcCore } from '../src/host/core.ts'
import { EnterpriseSkillProvider } from '../src/host/skill-provider.ts'
import { contextId } from '../src/host/context.ts'

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'opc-authz-'))
  const grant: StoredGrant = { refreshToken: 'r', platformBaseUrl: 'https://platform.example/', lastContext: { issuer: 'https://platform.example', subject: 'alice', tenant: 'A', spaces: ['A','B'], generation: 1 } }
  const state = { revoked: false, documentKb: 'kb', reads: 0, checks: 0 }
  const auth = new AuthManager(new PlatformHttp('https://platform.example', 1000, async url => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/refresh')) return Response.json({ access_token: 'a', refresh_token: 'r2', expires_in: 900, subject: 'alice', spaces: ['A','B'], tenant: 'A' })
    if (path.endsWith('/session')) return Response.json({ spaces: ['A','B'] })
    if (path.endsWith('/skills/cat')) {
      state.checks++
      return state.revoked ? Response.json({ error: { code: 'RESOURCE_NOT_ACCESSIBLE' } }, { status: 404 }) : Response.json({ item: { tenant_id: 'A', catalog_id: 'cat', name: 'demo', availability: 'available' } })
    }
    if (path.endsWith('/knowledge-bases')) return Response.json({ items: [{ tenant_id: 'A', knowledge_base_id: 'kb', name: 'KB', availability: 'available' }], total: 1, complete: true })
    if (path.endsWith('/search')) return Response.json({ results: [{ knowledge_id: 'doc', source_tenant: 'A', knowledge_base_id: 'kb' }] })
    if (path.endsWith('/knowledge/doc')) { state.reads++; return Response.json({ source_tenant: 'A', data: { content: 'private', knowledge_base_id: state.documentKb } }) }
    throw new Error(`Unexpected path ${path}`)
  }), { read: async () => grant, write: async () => {}, delete: async () => {} }, async () => {})
  await auth.restore()
  const core = new OpcCore(auth, home)
  return { auth, core, state, async close() { await auth.dispose(); await rm(home, { recursive: true, force: true }) } }
}
test('native provider lists installed skill, denies after revocation TTL, and removes local install', async () => {
  const fixture = await setup(), now = Date.now
  const controller = new AbortController()
  let invalidations = 0
  try {
    const { core, auth, state } = fixture
    const bytes = Buffer.from(zipSync({ 'SKILL.md': strToU8('---\nname: demo\ndescription: Demo\n---\nDo a demo.') })), sha = createHash('sha256').update(bytes).digest('hex')
    await core.installer.install(auth.contexts.capture().context, { bytes, catalogId: 'cat', name: 'demo', version: '1', expectedSha256: sha, headerSha256: sha }, () => {})
    const provider = new EnterpriseSkillProvider(core, { signal: controller.signal, invalidate: () => { invalidations++ } })
    const [candidate] = await provider.list({})
    assert.equal(candidate.name, 'demo'); assert.equal(candidate.invocation.userInvocable, true)
    assert.equal((await provider.get(candidate, {}))?.content, 'Do a demo.')
    state.revoked = true
    assert.ok(await provider.get(candidate, {})); assert.equal(state.checks, 1)
    Date.now = () => now() + 31_000
    await assert.rejects(provider.get(candidate, {}), { code: 'RESOURCE_NOT_ACCESSIBLE' })
    assert.deepEqual(await core.installer.list(auth.contexts.capture().context), [])
    assert.ok(invalidations > 0)
  } finally { Date.now = now; controller.abort(); await fixture.close() }
})
test('pinned knowledge blocks unhit reads before network and rejects moved documents', async () => {
  const fixture = await setup()
  try {
    const { core, auth, state } = fixture
    core.scopes.pin('s', { tenantId: 'A', knowledgeBaseId: 'kb', contextId: contextId(auth.contexts.capture().context) }); core.scopes.begin('s','t')
    await assert.rejects(core.read('s','t','doc'), { code: 'SCOPE_MISMATCH' }); assert.equal(state.reads, 0)
    await core.search('s','t','query')
    assert.equal((await core.read('s','t','doc')).source_tenant, 'A')
    state.documentKb = 'other'
    await assert.rejects(core.read('s','t','doc'))
  } finally { await fixture.close() }
})
