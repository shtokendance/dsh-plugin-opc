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
import { ManagedMcpMounts } from '../src/host/mcp-mount.ts'
import { contextId } from '../src/host/context.ts'

async function setupMultiSpace() {
  const home = await mkdtemp(join(tmpdir(), 'opc-unified-'))
  const grant: StoredGrant = {
    refreshToken: 'r',
    platformBaseUrl: 'https://platform.example/',
    lastContext: {
      issuer: 'https://platform.example',
      subject: 'alice',
      tenant: '1001',
      spaces: ['1001', '1002'],
      spacesDetail: [
        { id: '1001', name: '研发空间' },
        { id: '1002', name: '产品空间' },
      ],
      generation: 1,
    },
  }
  const skillBytesA = Buffer.from(zipSync({ 'SKILL.md': strToU8('---\nname: alpha-skill\ndescription: Alpha skill\n---\nRun alpha.') }))
  const skillShaA = createHash('sha256').update(skillBytesA).digest('hex')
  const skillBytesB = Buffer.from(zipSync({ 'SKILL.md': strToU8('---\nname: beta-skill\ndescription: Beta skill\n---\nRun beta.') }))
  const skillShaB = createHash('sha256').update(skillBytesB).digest('hex')
  const calls: { url: string; body?: unknown }[] = []

  const auth = new AuthManager(new PlatformHttp('https://platform.example', 1000, async (url, init) => {
    const endpoint = new URL(String(url))
    const path = endpoint.pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: String(url), body })
    if (path.endsWith('/refresh')) {
      return Response.json({
        access_token: 'a',
        refresh_token: 'r2',
        expires_in: 900,
        subject: 'alice',
        spaces: ['1001', '1002'],
        spaces_detail: [
          { id: '1001', name: '研发空间' },
          { id: '1002', name: '产品空间' },
        ],
        tenant: '1001',
      })
    }
    if (path.endsWith('/session')) {
      return Response.json({
        subject: 'alice',
        spaces: ['1001', '1002'],
        spaces_detail: [
          { id: '1001', name: '研发空间' },
          { id: '1002', name: '产品空间' },
        ],
      })
    }
    if (path.endsWith('/resources/knowledge-bases')) {
      return Response.json({
        includes_shared: true,
        complete: true,
        total: 4,
        items: [
          { tenant_id: '1001', tenant_name: '研发空间', source_tenant_id: '1001', knowledge_base_id: 'kb-own', name: '研发规范库', availability: 'available' },
          { tenant_id: '1002', tenant_name: '产品空间', source_tenant_id: '1001', source_tenant_name: '研发空间', permission: 'viewer', knowledge_base_id: 'kb-own', name: '研发规范库', availability: 'available' },
          { tenant_id: '1001', tenant_name: '研发空间', source_tenant_id: '1003', source_tenant_name: '财务空间', permission: 'viewer', knowledge_base_id: 'kb-ext', name: '财务共享库', availability: 'available' },
          { tenant_id: '1002', tenant_name: '产品空间', source_tenant_id: '1003', source_tenant_name: '财务空间', permission: 'editor', knowledge_base_id: 'kb-ext', name: '财务共享库', availability: 'available' },
        ],
      })
    }
    if (path.endsWith('/resources/skills')) {
      return Response.json({
        complete: true,
        total: 2,
        items: [
          { tenant_id: '1001', tenant_name: '研发空间', catalog_id: 'cat-a', name: 'alpha-skill', version: '1.0', bundle_sha256: skillShaA, availability: 'available' },
          { tenant_id: '1002', tenant_name: '产品空间', catalog_id: 'cat-b', name: 'beta-skill', version: '2.0', bundle_sha256: skillShaB, availability: 'available' },
        ],
      })
    }
    if (path.endsWith('/resources/skills/cat-a')) {
      return Response.json({ item: { tenant_id: '1001', catalog_id: 'cat-a', name: 'alpha-skill', version: '1.0', bundle_sha256: skillShaA, availability: 'available' } })
    }
    if (path.endsWith('/resources/skills/cat-b')) {
      return Response.json({ item: { tenant_id: '1002', catalog_id: 'cat-b', name: 'beta-skill', version: '2.0', bundle_sha256: skillShaB, availability: 'available' } })
    }
    if (path.endsWith('/resources/skills/cat-a/archive')) {
      return new Response(skillBytesA, { status: 200, headers: { 'X-SHA256': skillShaA } })
    }
    if (path.endsWith('/resources/skills/cat-b/archive')) {
      return new Response(skillBytesB, { status: 200, headers: { 'X-SHA256': skillShaB } })
    }
    if (path.endsWith('/knowledge/search')) {
      if (body?.all_spaces) {
        return Response.json({
          all_spaces: true,
          complete: true,
          results: [
            { knowledge_id: 'doc-own', tenant_id: '1001', source_tenant: '1001', knowledge_base_id: 'kb-own', title: '研发文档' },
            { knowledge_id: 'doc-ext', tenant_id: '1002', source_tenant: '1003', knowledge_base_id: 'kb-ext', title: '财务文档' },
          ],
        })
      }
      return Response.json({
        results: [{ knowledge_id: 'doc-ext', tenant_id: body?.tenant_id, source_tenant: '1003', knowledge_base_id: body?.knowledge_base_id }],
      })
    }
    if (path.endsWith('/knowledge/doc-ext')) {
      return Response.json({
        tenant_id: endpoint.searchParams.get('tenant'),
        source_tenant: '1003',
        data: { content: '财务制度正文', knowledge_base_id: 'kb-ext' },
      })
    }
    if (path.endsWith('/mcp/services')) {
      return Response.json({
        success: true,
        complete: true,
        data: {
          services: [
            { service_id: 'svc-a', tenant_id: '1001', tenant_name: '研发空间', name: '研发服务', tools: [{ name: 'ping_a', input_schema: { type: 'object' } }] },
            { service_id: 'svc-b', tenant_id: '1002', tenant_name: '产品空间', name: '产品服务', tools: [{ name: 'ping_b', input_schema: { type: 'object' } }] },
          ],
        },
      })
    }
    if (path.endsWith('/mcp/invoke')) {
      return Response.json({
        success: true,
        data: { invocation_id: 'inv-1', status: 'succeeded', result: { echoedTenant: body?.tenant_id, service: body?.service_id } },
      })
    }
    throw new Error(`Unexpected path ${path}`)
  }), { read: async () => grant, write: async () => {}, delete: async () => {} }, async () => {})

  await auth.restore()
  const core = new OpcCore(auth, home)
  return { auth, core, calls, skillShaA, skillShaB, async close() { await auth.dispose(); await rm(home, { recursive: true, force: true }) } }
}

test('unified KB directory dedupes owned and multi-shared entries and supports all-spaces search & read', async () => {
  const fixture = await setupMultiSpace()
  try {
    const { core, auth } = fixture
    const dir = await core.knowledgeDirectory()
    assert.equal(dir.items.length, 2)
    const own = dir.items.find(i => i.knowledge_base_id === 'kb-own')
    const ext = dir.items.find(i => i.knowledge_base_id === 'kb-ext')
    assert.equal(own?.tenant_id, '1001')
    assert.equal(ext?.tenant_id, '1002')
    assert.equal(ext?.source_tenant_id, '1003')
    assert.equal(ext?.permission, 'editor')

    core.scopes.begin('s1', 't1')
    const searchResult = await core.search('s1', 't1', '财务')
    assert.equal((searchResult.results as unknown[]).length, 2)
    const doc = await core.read('s1', 't1', 'doc-ext')
    assert.equal((doc.data as { content?: string }).content, '财务制度正文')

    const ctxId = contextId(auth.contexts.capture().context)
    core.scopes.begin('s2', 't1', `[OPC 知识库](opc-kb:${ctxId}/1002/kb-ext)`)
    const scopedSearch = await core.search('s2', 't1', '制度')
    assert.equal((scopedSearch.results as unknown[]).length, 1)
    const scopedDoc = await core.read('s2', 't1', 'doc-ext')
    assert.equal(scopedDoc.source_tenant, '1003')
  } finally {
    await fixture.close()
  }
})

test('unified skills install and load across multiple spaces without switching tenant', async () => {
  const fixture = await setupMultiSpace()
  const controller = new AbortController()
  try {
    const { core, auth, skillShaA, skillShaB } = fixture
    const ctxId = contextId(auth.contexts.capture().context)
    await core.install({ catalogId: 'cat-a', expectedSha256: skillShaA, contextId: ctxId, tenantId: '1001' })
    await core.install({ catalogId: 'cat-b', expectedSha256: skillShaB, contextId: ctxId, tenantId: '1002' })

    const provider = new EnterpriseSkillProvider(core, { signal: controller.signal, invalidate: () => {} })
    const list = await provider.list({})
    assert.equal(list.length, 2)
    const beta = list.find(s => s.name === 'beta-skill')
    assert.ok(beta)
    assert.match(beta.description, /产品空间/)
    const loaded = await provider.get(beta, {})
    assert.equal(loaded?.content, 'Run beta.')
  } finally {
    controller.abort()
    await fixture.close()
  }
})

test('unified MCP auto-mounts services from all spaces and routes invoke to each service tenant', async () => {
  const fixture = await setupMultiSpace()
  const registrations = new Map<string, { url: string; headers: Record<string, string> }>()
  const mounts = new ManagedMcpMounts(
    fixture.core,
    (name, entry) => { registrations.set(name, entry); return () => { registrations.delete(name) } },
    async () => 'allowed-once',
    { autoMount: true },
  )
  try {
    await new Promise(r => setTimeout(r, 100))
    assert.deepEqual(mounts.list().sort(), ['svc-a', 'svc-b'])
    const regB = [...registrations.values()][1]
    assert.ok(regB)
    const res = await fetch(regB.url, {
      method: 'POST',
      headers: { ...regB.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ping_b', arguments: {} } }),
    })
    const payload = await res.json() as any
    assert.deepEqual(JSON.parse(payload.result.content[0].text), { echoedTenant: '1002', service: 'svc-b' })
  } finally {
    mounts.dispose()
    await fixture.close()
  }
})
