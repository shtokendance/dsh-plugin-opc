import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthManager, type GrantStore, type StoredGrant } from '../src/host/auth.ts'
import { AppDelivery } from '../src/host/app-delivery.ts'
import { contextId } from '../src/host/context.ts'
import { OpcCore } from '../src/host/core.ts'
import { PlatformHttp } from '../src/host/http.ts'
import { checkNpmPackageUpdate, isNewerSemver } from '../src/host/remote-service.ts'
import {
  DEFAULT_APP_DEFAULT_PORT,
  DEFAULT_APP_DOMAIN_ROOT,
  DEFAULT_PLATFORM_BASE,
  OpcConfigStore,
} from '../src/host/opc-config.ts'

class MemoryGrants implements GrantStore {
  value: StoredGrant | undefined
  async read() { return this.value }
  async write(value: StoredGrant) { this.value = structuredClone(value) }
  async delete() { this.value = undefined }
}

test('OpcConfigStore loads defaults, validates, persists, and resets config cleanly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-cfg-store-'))
  try {
    const store = new OpcConfigStore(home)
    assert.deepEqual(store.loadSync(), {
      platform_base: DEFAULT_PLATFORM_BASE,
      app_domain_root: '',
      app_default_port: DEFAULT_APP_DEFAULT_PORT,
    })
    assert.equal(store.getPayload().effective_app_domain_root, DEFAULT_APP_DOMAIN_ROOT)

    const updated = await store.update({
      platform_base: 'https://pre.opc.example.com/',
      app_domain_root: 'https://10.101.102.200.nip.io:8080/',
      app_default_port: 3000,
    })
    assert.equal(updated.platform_base_changed, true)
    assert.equal(updated.config.platform_base, 'https://pre.opc.example.com')
    assert.equal(updated.config.app_domain_root, '10.101.102.200.nip.io:8080')
    assert.equal(updated.config.app_default_port, 3000)
    assert.equal(updated.config.effective_app_domain_root, '10.101.102.200.nip.io:8080')

    // Re-loading from disk preserves persisted overrides
    const reloaded = new OpcConfigStore(home)
    assert.deepEqual(reloaded.loadSync(), {
      platform_base: 'https://pre.opc.example.com',
      app_domain_root: '10.101.102.200.nip.io:8080',
      app_default_port: 3000,
    })

    // Validation guards
    await assert.rejects(store.update({ platform_base: 'http://remote.example' }), { code: 'INSECURE_PLATFORM_URL' })
    await assert.rejects(store.update({ platform_base: 'https://user:pass@opc.example' }), { code: 'INVALID_PLATFORM_URL' })
    await assert.rejects(store.update({ app_domain_root: 'bad domain/path' }), /根域名后缀格式无效/)
    await assert.rejects(store.update({ app_default_port: 70000 }), /1 至 65535/)

    const reset = await store.reset()
    assert.equal(reset.platform_base_changed, true)
    assert.equal(reset.config.platform_base, DEFAULT_PLATFORM_BASE)
    assert.equal(reset.config.app_domain_root, '')
    assert.equal(reset.config.app_default_port, DEFAULT_APP_DEFAULT_PORT)
    assert.equal(reset.config.effective_app_domain_root, DEFAULT_APP_DOMAIN_ROOT)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('OpcConfigStore.testConnection probes gateway and reports status/errors', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-cfg-test-'))
  try {
    let seenUrl = ''
    const store = new OpcConfigStore(home, {}, async url => {
      seenUrl = String(url)
      if (seenUrl.startsWith('https://ok.example/')) return new Response('ok', { status: 200 })
      if (seenUrl.startsWith('https://err500.example/')) return new Response('err', { status: 502 })
      throw new Error('ECONNREFUSED')
    })

    const ok = await store.testConnection('https://ok.example')
    assert.equal(ok.ok, true)
    assert.equal(ok.status_code, 200)
    assert.equal(typeof ok.latency_ms, 'number')

    const badStatus = await store.testConnection('https://err500.example')
    assert.equal(badStatus.ok, false)
    assert.equal(badStatus.status_code, 502)
    assert.equal(badStatus.error, 'HTTP 502')

    const netErr = await store.testConnection('https://down.example')
    assert.equal(netErr.ok, false)
    assert.match(netErr.error ?? '', /ECONNREFUSED/)

    const insecure = await store.testConnection('http://remote.example')
    assert.equal(insecure.ok, false)
    assert.match(insecure.error ?? '', /https:\/\//)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Updating OPC config hot-reloads unified platform gateway, auth session, and app delivery defaults', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-cfg-hot-'))
  const sourceDir = join(home, 'sample-src')
  const requestedHits: { gateway: string; path: string }[] = []

  const startMockGateway = async (tag: string) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      requestedHits.push({ gateway: tag, path: url.pathname })
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        if (url.pathname.endsWith('/auth/refresh')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            access_token: `tok-${tag}`,
            refresh_token: `ref-${tag}`,
            expires_in: 900,
            subject: 'alice',
            tenant: 'team-1',
            spaces: ['team-1'],
          }))
          return
        }
        if (url.pathname.endsWith('/resources/knowledge-bases')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            items: [{ name: `kb-from-${tag}`, tenant_id: 'team-1', knowledge_base_id: 'kb-1', availability: 'available' }],
            total: 1,
            complete: true,
          }))
          return
        }
        if (url.pathname.endsWith('/mcp/services')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ services: [{ service_id: `svc-${tag}`, name: `MCP-${tag}` }] }))
          return
        }
        if (url.pathname.endsWith('/apps/check-slug')) {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ available: true, slug: body.slug, app_url: `http://${body.slug}.${tag}.internal` }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
    const addr = srv.address() as { port: number }
    return { server: srv, baseUrl: `http://127.0.0.1:${addr.port}` }
  }

  const gwA = await startMockGateway('gw-a')
  const gwB = await startMockGateway('gw-b')

  try {
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'index.js'), 'console.log("hi")\n')

    const http = new PlatformHttp(gwA.baseUrl, 2000)
    const grants = new MemoryGrants()
    const auth = new AuthManager(http, grants, async () => {})
    const core = new OpcCore(auth, home)
    const delivery = new AppDelivery(core, home, { async read() { return {} }, async write() {} }, {
      appDomainRoot: 'old-apps.nip.io:8080',
      appDefaultPort: 8080,
    })

    grants.value = {
      refreshToken: 'seed-refresh-a',
      platformBaseUrl: `${gwA.baseUrl}/`,
      lastContext: { issuer: gwA.baseUrl, subject: 'alice', tenant: 'team-1', spaces: ['team-1'], generation: 1 },
    }
    await auth.restore()
    assert.equal(auth.state.signedIn, true)

    // Knowledge base, MCP, and AppDelivery initially route to gw-a
    const kbA = await core.catalog('knowledge-bases')
    assert.equal(kbA[0].name, 'kb-from-gw-a')
    const mcpA = await core.request('/integration/v1/mcp/services?include_schema=true&tenant=team-1')
    assert.equal((mcpA.services as { name: string }[])[0].name, 'MCP-gw-a')
    const appCtxA = auth.contexts.applicationContextId!
    const cfgBefore = await delivery.opcConfig(appCtxA)
    assert.equal(cfgBefore.appDomainRoot, 'old-apps.nip.io:8080')
    assert.equal(cfgBefore.defaultPort, 8080)
    assert.equal(cfgBefore.platformBaseUrl, gwA.baseUrl)

    // Switch gateway + app settings -> invalidates active session and routes future requests to gw-b
    const changed = await auth.setPlatformBase(gwB.baseUrl)
    assert.equal(changed, true)
    assert.equal(auth.state.signedIn, false)
    assert.equal(auth.state.context, null)
    assert.equal(grants.value, undefined)
    delivery.updateOptions({ appDomainRoot: 'new-apps.nip.io:9090', appDefaultPort: 9001 })

    // Sign in against gw-b
    grants.value = {
      refreshToken: 'seed-refresh-b',
      platformBaseUrl: `${gwB.baseUrl}/`,
      lastContext: { issuer: gwB.baseUrl, subject: 'alice', tenant: 'team-1', spaces: ['team-1'], generation: 2 },
    }
    await auth.restore()
    assert.equal(auth.state.signedIn, true)

    const kbB = await core.catalog('knowledge-bases')
    assert.equal(kbB[0].name, 'kb-from-gw-b')
    const mcpB = await core.request('/integration/v1/mcp/services?include_schema=true&tenant=team-1')
    assert.equal((mcpB.services as { name: string }[])[0].name, 'MCP-gw-b')
    assert.ok(requestedHits.some(hit => hit.gateway === 'gw-b' && hit.path.endsWith('/resources/knowledge-bases')))

    const appCtxB = auth.contexts.applicationContextId!
    const cfgAfter = await delivery.opcConfig(appCtxB)
    assert.equal(cfgAfter.appDomainRoot, 'new-apps.nip.io:9090')
    assert.equal(cfgAfter.defaultPort, 9001)
    assert.equal(cfgAfter.platformBaseUrl, gwB.baseUrl)

    const slugRes = await delivery.checkSlug('demo-app', appCtxB)
    assert.equal(slugRes.app_url, 'http://demo-app.new-apps.nip.io:9090')

    const job = await delivery.create({ name: 'Demo', slug: 'demo-app', source: sourceDir }, 'sess-1', appCtxB)
    assert.equal(job.port, 9001)
    assert.equal(job.url, 'http://demo-app.new-apps.nip.io:9090')

    await auth.dispose()
  } finally {
    gwA.server.closeAllConnections?.()
    gwB.server.closeAllConnections?.()
    gwA.server.close()
    gwB.server.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('isNewerSemver and checkNpmPackageUpdate detect updates with registry fallback', async () => {
  assert.equal(isNewerSemver('0.1.58', '0.1.57'), true)
  assert.equal(isNewerSemver('0.2.0', '0.1.99'), true)
  assert.equal(isNewerSemver('1.0.0', '0.99.99'), true)
  assert.equal(isNewerSemver('0.1.57', '0.1.57'), false)
  assert.equal(isNewerSemver('0.1.56', '0.1.57'), false)
  assert.equal(isNewerSemver('0.1.58', '0.1.58-rc.1'), true)
  assert.equal(isNewerSemver('0.1.58-rc.1', '0.1.58'), false)

  const hits: string[] = []
  const update = await checkNpmPackageUpdate('0.1.57', async url => {
    const key = String(url)
    hits.push(key)
    if (key.includes('mirror')) return new Response('error', { status: 502 })
    return new Response(JSON.stringify({ version: '0.1.58' }), { status: 200 })
  }, ['https://mirror.invalid/latest', 'https://official.invalid/latest'])

  assert.deepEqual(hits, ['https://mirror.invalid/latest', 'https://official.invalid/latest'])
  assert.deepEqual(update, { currentVersion: '0.1.57', latestVersion: '0.1.58', hasUpdate: true })

  const offline = await checkNpmPackageUpdate('0.1.57', async () => {
    throw new Error('offline')
  }, ['https://mirror.invalid/latest'])
  assert.deepEqual(offline, { currentVersion: '0.1.57', latestVersion: '', hasUpdate: false })
})
