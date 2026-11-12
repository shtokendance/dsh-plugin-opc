import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { AppDelivery, fingerprint, worker } from '../src/host/app-delivery.ts'
import { ContextStore } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

function proposal(url: string) {
  return { summary: '补齐容器启动配置，保留原有查询业务', changes: [{ path: 'Dockerfile', reason: '容器化', content: 'FROM python:3.11-alpine\nCOPY main.py /app.py\nCMD ["python", "/app.py"]\n' }], unresolved: [],
    contract: { schema_version: 1, slug: 'test-app', name: '测试查询', description: '查询测试记录', base_url: url,
      runtime: { language: 'python', version: '3.11', port: 8080 }, build_context: ['Dockerfile', 'main.py'],
      health: { path: '/healthz', status: 200, json_contains: { service: 'test-app' } }, configs: [], resources: [], pages: [],
      apis: [{ id: 'lookup', method: 'GET', path: '/lookup', purpose: '读取记录', evidence: ['main.py:1'], parameters: [], request_body: null, responses: { '200': { description: '查询结果' } }, auth: { type: 'none' }, effect: 'read', confirmation_required: false }],
      verification: { cases: [{ operation: 'lookup', json_contains: { ok: true } }] }, unresolved: [] } }
}

test('real worker preserves source, rejects traversal and stale proposal, builds and verifies exact artifacts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-test-'))
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/healthz' ? { service: 'test-app' } : { ok: true, records: [1] })) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}`
  try {
    const source = join(home, 'source'); await mkdir(source); await writeFile(join(source, 'main.py'), 'print("source must never execute")\nPASSWORD="secret-value"\n')
    const contexts = new ContextStore(), context = { issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one', 'two'], generation: 1 }
    contexts.replace(context)
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const delivery = new AppDelivery(core, join(home, 'data'), { async read() { return {} }, async write() {} }), expected = contexts.applicationContextId!
    let deployed: Record<string, any> = {}, published = 0
    delivery.platform = async (path, _expected, options) => {
      contexts.captureApplication(_expected)
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/publish') {
        published++
        assert.ok(options?.form?.get('app_tar') instanceof Blob)
        return { app_url: url, version: 1 }
      }
      return deployed
    }
    const created = await delivery.create({ name: '测试', slug: 'test-app', source }, 'session', expected)
    assert.equal(created.status, 'draft', created.error)
    let root = '', submitted: any
    delivery.analyze = async (job, directory, _feedback, signal) => {
      root = directory; submitted = job
      const read = await worker({ root, action: 'read', path: 'main.py' })
      assert.ok(!read.text.includes('secret-value'))
      await assert.rejects(worker({ root, action: 'read', path: '../../outside' }), /unsafe|escapes/)
      await delivery.submit(job, root, proposal(url), signal)
    }
    await delivery.startAnalysis(created.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = (await delivery.list(expected))[0]
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const reviewed = (await delivery.list(expected))[0]
    assert.equal(reviewed.status, 'review', JSON.stringify(reviewed))
    await assert.rejects(delivery.prepare(created.id, 'old', expected), /方案已变化/)
    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready', JSON.stringify(ready))
    assert.match(await readFile(join(source, 'main.py'), 'utf8'), /secret-value/)
    assert.equal(await readFile(join(root, 'review/source/Dockerfile')).then(() => true, () => false), false)
    await assert.rejects(delivery.publish(created.id, { artifactHash: 'bad', config: [] }, expected), /交付包/)
    assert.equal(published, 0)
    await delivery.publish(created.id, { artifactHash: ready.artifactHash, config: [] }, expected)
    deployed = { status: 'running', app_url: url, current_version: 1, build_log: 'wrong receipts' }
    await assert.rejects(delivery.verify(created.id, expected), /回执/)
    deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${ready.hashes[name]}\n`).join('')
    const verified = await delivery.verify(created.id, expected)
    assert.equal(verified.status, 'verified', JSON.stringify(verified))
    const invoked = await delivery.invoke(created.id, 'lookup', {}, undefined, expected, async () => { throw new Error('read should not approve') })
    assert.equal(invoked.status, 200)
    deployed.current_version = 2
    await assert.rejects(delivery.invoke(created.id, 'lookup', {}, undefined, expected, async () => true), /版本/)
    const applicationSignal = contexts.captureApplication(expected).signal
    contexts.switchTenant('two')
    assert.equal(contexts.applicationContextId, expected)
    assert.equal(applicationSignal.aborted, false)
    assert.equal((await delivery.list(contexts.applicationContextId!))[0]?.id, created.id)
    contexts.replace({ ...context, subject: 'other-user' })
    assert.equal(applicationSignal.aborted, true)
    await assert.rejects(delivery.list(expected), /CONTEXT_CHANGED/)
    assert.deepEqual(await delivery.list(contexts.applicationContextId!), [])
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(home, { recursive: true, force: true }) }
})

test('worker rejects unapproved write effects', async () => {
  const contract = proposal('http://127.0.0.1:1').contract
  contract.apis[0].effect = 'write'
  await assert.rejects(worker({ action: 'probe', root: tmpdir(), contract, operation: 'lookup', params: {} }), /approval|confirm/i)
})

test('idempotent publish reconciliation, pure-page verification, reopenReview, upgrade, updateConfig invalidation, and rollback notice', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-p05-p10-'))
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url === '/healthz' ? { service: 'page-app' } : { ok: true }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}`
  try {
    const source = join(home, 'source'); await mkdir(source); await writeFile(join(source, 'main.py'), 'print("page app")\n')
    const contexts = new ContextStore(), context = { issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 }
    contexts.replace(context)
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const storedCreds: Record<string, Record<string, string>> = {}
    const delivery = new AppDelivery(core, join(home, 'data'), {
      async read(id) { return storedCreds[id] ?? {} },
      async write(id, values) { storedCreds[id] = values },
    })
    const expected = contexts.applicationContextId!

    let publishDropOnce = true
    let lastRequestId = ''
    let deployed: Record<string, any> = {
      slug: 'page-app',
      name: '纯页面应用',
      app_url: url,
      can_manage: true,
      status: 'running',
      current_version: 1,
      config_fingerprint: 'fp-v1',
      build_log: '',
    }

    delivery.platform = async (path, _expected, options) => {
      contexts.captureApplication(_expected)
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/publish') {
        lastRequestId = String(options?.form?.get('request_id') ?? '')
        assert.ok(lastRequestId.length > 0)
        if (publishDropOnce) {
          publishDropOnce = false
          throw new Error('network timeout after upload')
        }
        return { app_url: url, version: 1, status: 'building' }
      }
      if (path.startsWith('/page-app/requests/')) {
        return { slug: 'page-app', request_id: lastRequestId, status: 'building', version: 1, app_url: url }
      }
      if (path === '/page-app/config' && options?.method === 'PUT') {
        deployed.config_fingerprint = 'fp-v2'
        return { status: 'updated', config_fingerprint: 'fp-v2' }
      }
      if (path === '/page-app/rollback' && options?.method === 'POST') {
        deployed.current_version = 1
        deployed.config_fingerprint = 'fp-v1'
        return { slug: 'page-app', previous_version: 2, current_version: 1, config_fingerprint: 'fp-v1', message: 'rolled back' }
      }
      return deployed
    }

    // 1. Upgrade mode checks can_manage and reuses existing app_url
    const created = await delivery.create({ name: '纯页面应用', slug: 'page-app', source, upgrade: true }, 'session', expected)
    assert.equal(created.status, 'draft')
    assert.equal(created.url, url)

    delivery.analyze = async (job, directory, _feedback, signal) => {
      const purePageProp = proposal(url)
      purePageProp.contract.slug = 'page-app'
      purePageProp.contract.health.json_contains = { service: 'page-app' }
      purePageProp.contract.apis = []
      purePageProp.contract.pages = [{ path: '/', purpose: '看板首页', evidence: ['main.py:1'], actions: ['查看看板'] }]
      purePageProp.contract.verification = {
        cases: [],
        browser_cases: [{ page: '/', steps: ['打开首页'], expected: '正常显示' }],
      } as any
      purePageProp.contract.auth_profile = { username_env: 'APP_USER', password_env: 'APP_PASS' }
      await delivery.submit(job, directory, purePageProp, signal)
    }

    await delivery.startAnalysis(created.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = (await delivery.list(expected))[0]
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const reviewed = (await delivery.list(expected))[0]
    assert.equal(reviewed.status, 'review')

    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready')

    // 2. reopenReview returns from ready to review
    const reopened = await delivery.reopenReview(created.id, expected)
    assert.equal(reopened.status, 'review')
    const readyAgain = await delivery.prepare(created.id, reopened.proposalHash, expected)
    assert.equal(readyAgain.status, 'ready')

    // 3. Publish drops network connection, but reconciles via GET /page-app/requests/:requestId
    const pub = await delivery.publish(created.id, { artifactHash: readyAgain.artifactHash, config: [] }, expected)
    assert.equal(pub.status, 'building')
    assert.equal(pub.published, true)
    assert.equal(pub.version, 1)

    // 4. Pure-page verify enters awaiting_page_verification (not failed!), and updates credentials without rebuild
    deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${readyAgain.hashes[name]}\n`).join('') + `[Artifact-Build] build_app.tar:deadbeef\n`
    const awaitingPage = await delivery.verify(created.id, expected, { credentials: { APP_USER: 'admin', APP_PASS: 'pass123' } })
    assert.equal(awaitingPage.status, 'awaiting_page_verification')
    assert.equal(storedCreds[created.id]?.APP_USER, 'admin')

    // 5. Confirming page verification transitions to verified
    const pageVerified = await delivery.verify(created.id, expected, { confirmPageVerification: true })
    assert.equal(pageVerified.status, 'verified')
    assert.equal(pageVerified.pagesVerified, true)

    // 6. Updating runtime config invalidates verified status -> building
    await delivery.updateConfig('page-app', { app_config: [], resource_ids: [] }, expected)
    const afterConfig = (await delivery.list(expected))[0]
    assert.equal(afterConfig.status, 'building')

    // 7. Rollback returns unified rollback_notice
    const rb = await delivery.rollback('page-app', 1, '回退测试', expected)
    assert.match(rb.rollback_notice, /不自动回退数据库\/卷中的业务数据/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
    await rm(home, { recursive: true, force: true })
  }
})
