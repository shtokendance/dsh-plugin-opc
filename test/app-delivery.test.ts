import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AppDelivery, AppRequestError, fingerprint, worker } from '../src/host/app-delivery.ts'
import { AppSkillProvider } from '../src/host/app-skills.ts'
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

test('host rejects changes to the confirmed container port', async () => {
  const delivery = new AppDelivery({} as OpcCore, tmpdir(), { async read() { return {} }, async write() {} })
  const url = 'http://127.0.0.1:8080'
  await assert.rejects(delivery.submit({ id: 'port', name: 'App', slug: 'test-app', url, session: '', port: 9000,
    status: 'analyzing', events: [] }, tmpdir(), proposal(url), new AbortController().signal), /容器端口/)
})

test('worker retains nested YAML configuration references and existing executable permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-app-inputs-'))
  try {
    const source = join(root, 'source')
    const job = join(root, 'job')
    await mkdir(source)
    await mkdir(job)
    await writeFile(join(source, 'main.py'), 'print("fixture")\n')
    await writeFile(join(source, 'start.sh'), '#!/bin/sh\nexec python main.py\n')
    await chmod(join(source, 'start.sh'), 0o755)
    await writeFile(join(source, 'config.yaml'), 'databases:\n  app:\n    dsn: postgres://db.example.invalid/app\n')
    await writeFile(join(source, 'settings.toml'), '[service]\nendpoint = "https://test.invalid"\n')
    const url = 'http://127.0.0.1:8080'
    await worker({ root: job, action: 'prepare', source, slug: 'test-app', url })
    const config = await worker({ root: job, action: 'read', path: 'config.yaml' })
    assert.match(config.text, /Original configuration references/)
    assert.doesNotMatch(config.text, /db\.example\.invalid/)
    const plan = proposal(url)
    plan.contract.build_context.push('start.sh')
    plan.changes.push({ path: 'start.sh', reason: '适配入口', content: '#!/bin/sh\nexec python /app/main.py\n' })
    Object.assign(plan.contract, { configs: [
      { key: 'DATABASE_DSN', required: true, secret: true, default: '', source: { path: 'config.yaml', keys: ['databases', 'app', 'dsn'] } },
      { key: 'SERVICE_ENDPOINT', required: true, secret: false, default: '', source: { path: 'settings.toml', keys: ['service', 'endpoint'] } },
    ] })
    const result = await worker({ root: job, action: 'bundle', revision: 'audit', proposal: plan })
    assert.equal(result.original_config_values.DATABASE_DSN, 'postgres://db.example.invalid/app')
    assert.equal(result.original_config_values.SERVICE_ENDPOINT, 'https://test.invalid')
    assert.ok((await stat(join(job, 'audit/approved/source/start.sh'))).mode & 0o111)
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function publishConfirmed(delivery: AppDelivery, id: string, input: Record<string, unknown>, context: string) {
  const confirmation = await delivery.confirmDeployment(id, input, context)
  return delivery.publish(id, { ...input, ...confirmation }, context)
}

test('whole-application backups stream past 64 MiB and discard a partial or mismatched file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-app-stream-'))
  const contexts = new ContextStore()
  contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
  const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
  const delivery = new AppDelivery(core, root, { async read() { return {} }, async write() {} })
  const chunk = new Uint8Array(1024 * 1024)
  const digest = createHash('sha256')
  for (let i = 0; i < 65; i++) digest.update(chunk)
  const sha = digest.digest('hex')
  let valid = true
  delivery.platform = async (path, _expected, options) => {
    assert.equal(path, '/test-app/storage/backup')
    assert.equal(options?.query, undefined)
    assert.equal(options?.stream, true)
    let sent = 0
    return new Response(new ReadableStream({ pull(controller) {
      if (sent++ < 65) controller.enqueue(chunk)
      else controller.close()
    } }), { headers: { 'x-artifact-sha256': valid ? sha : 'bad' } })
  }
  try {
    const file = await delivery.saveDownload('test-app', { storage: true }, contexts.applicationContextId!, root)
    assert.equal((await stat(file.path)).size, 65 * chunk.length)
    valid = false
    await assert.rejects(delivery.saveDownload('test-app', { storage: true }, contexts.applicationContextId!, root), /摘要不匹配/)
    assert.deepEqual(await readdir(root), ['test-app-storage-backup.tar'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

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
    const stored: Record<string, Record<string, string>> = {}
    const delivery = new AppDelivery(core, join(home, 'data'), { async read(id) { return stored[id] ?? {} }, async write(id, values) { stored[id] = values } }), expected = contexts.applicationContextId!
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
    assert.match((await delivery.skillPreview(created.id, expected)).markdown, /lookup/)
    assert.match(await readFile(join(source, 'main.py'), 'utf8'), /secret-value/)
    assert.equal(await readFile(join(root, 'review/source/Dockerfile')).then(() => true, () => false), false)
    await assert.rejects(delivery.publish(created.id, { artifactHash: 'bad', config: [] }, expected), /交付包/)
    assert.equal(published, 0)
    const confirmation = await delivery.confirmDeployment(created.id, { artifactHash: ready.artifactHash, config: [] }, expected)
    await assert.rejects(delivery.publish(created.id, { ...confirmation, artifactHash: ready.artifactHash,
      config: [{ key: 'OPTIONAL', value: 'modified-after-confirmation' }] }, expected), /最终确认/)
    assert.equal(published, 0)
    await publishConfirmed(delivery, created.id, { artifactHash: ready.artifactHash, config: [] }, expected)
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
    let receiptAvailable = false
    let publishCalls = 0
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
        publishCalls++
        lastRequestId = String(options?.form?.get('request_id') ?? '')
        assert.ok(lastRequestId.length > 0)
        if (publishDropOnce) {
          publishDropOnce = false
          throw new Error('network timeout after upload')
        }
        return { app_url: url, version: 1, status: 'building' }
      }
      if (path.startsWith('/page-app/requests/')) {
        if (!receiptAvailable) throw new AppRequestError(404, 'receipt unavailable')
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
      purePageProp.contract.pages = [{ path: '/', purpose: '看板首页', evidence: ['main.py:1'], actions: ['查看看板'], auth: { type: 'none' } }]
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

    // 3. A missing receipt cannot trigger another upload. Recover when the receipt arrives.
    const pub = await publishConfirmed(delivery, created.id, { artifactHash: readyAgain.artifactHash, config: [] }, expected)
    assert.equal(pub.status, 'unknown')
    await assert.rejects(delivery.verify(created.id, expected), /receipt unavailable/)
    assert.equal((await delivery.list(expected))[0].status, 'unknown')
    await assert.rejects(delivery.publish(created.id, { artifactHash: readyAgain.artifactHash, config: [] }, expected), /待确认/)
    assert.equal(publishCalls, 1)
    receiptAvailable = true
    const reconciled = (await delivery.list(expected))[0]
    assert.equal(reconciled.status, 'building')
    assert.equal(reconciled.published, true)
    assert.equal(reconciled.version, 1)

    // 4. Pure-page verify enters awaiting_page_verification (not failed!), and updates credentials without rebuild
    deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${readyAgain.hashes[name]}\n`).join('') + `[Artifact-Build] build_app.tar:deadbeef\n`
    const awaitingPage = await delivery.verify(created.id, expected, { credentials: { APP_USER: 'admin', APP_PASS: 'pass123' } })
    assert.equal(awaitingPage.status, 'awaiting_page_verification')
    assert.equal(storedCreds[created.id]?.APP_USER, undefined)

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

test('proposal evidence, staged files and rollback historical skill.zip sync', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-align-'))
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain')
    res.end(JSON.stringify(req.url === '/healthz' ? { service: 'align-app' } : { ok: true, items: ['a'] }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}`
  try {
    const source = join(home, 'source')
    await mkdir(source)
    await writeFile(join(source, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/items")\ndef list_items():\n    return {"ok": True}\n')
    const contexts = new ContextStore(), context = { issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 }
    contexts.replace(context)
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const stored: Record<string, Record<string, string>> = {}
    const delivery = new AppDelivery(core, join(home, 'data'), { async read(id) { return stored[id] ?? {} }, async write(id, values) { stored[id] = values } })
    const expected = contexts.applicationContextId!

    let v1SkillZipBytes: Buffer | undefined
    let v1Hashes: Record<string, string> = {}
    let deployed: Record<string, any> = {}

    delivery.platform = async (path, _expected, options) => {
      contexts.captureApplication(_expected)
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/publish') return { app_url: url, version: 1, status: 'building' }
      if (path === '/align-app/rollback' && options?.method === 'POST') {
        deployed.current_version = 1
        deployed.config_fingerprint = 'fp-v1'
        deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${v1Hashes[name]}\n`).join('')
        return {
          slug: 'align-app',
          previous_version: 2,
          current_version: 1,
          config_fingerprint: 'fp-v1',
          skill_zip_sha256: v1Hashes['skill.zip'],
          version: {
            version: 1,
            app_tar_sha256: v1Hashes['app.tar'],
            skill_zip_sha256: v1Hashes['skill.zip'],
          },
        }
      }
      if (path === '/align-app/versions/1/artifacts/skill.zip') {
        return { bytes: v1SkillZipBytes, sha256: v1Hashes['skill.zip'] }
      }
      return deployed
    }

    const created = await delivery.create({ name: '对齐应用', slug: 'align-app', source }, 'session', expected)
    let jobDir = ''
    delivery.analyze = async (job, directory, _feedback, signal) => {
      jobDir = directory
      const scanned = await worker({ root: directory, action: 'scan_routes_and_pages' })
      assert.ok(Array.isArray(scanned.apis))
      const storageInfo = await worker({ root: directory, action: 'inspect_local_storage' })
      assert.ok(storageInfo)
      const excerpt = await worker({ root: directory, action: 'read', path: 'main.py', start: 3300 })
      assert.equal(excerpt.total_lines, 5)
      assert.match(excerpt.text, /共 5 行/)
      await assert.rejects(worker({ root: directory, action: 'inspect_credentials' }), /Unknown worker action/)

      const staged = await worker({
        root: directory,
        action: 'propose_file',
        id: 'df-1',
        path: 'Dockerfile',
        reason: '容器化启动',
        content: 'FROM python:3.11-alpine\nCOPY main.py /app.py\nCMD ["python", "/app.py"]\n',
      })
      assert.equal(staged.staged, 'df-1')

      const p = proposal(url)
      p.contract.slug = 'align-app'
      p.contract.health.json_contains = { service: 'align-app' }
      p.contract.apis = [{ id: 'items', method: 'GET', path: '/items', purpose: '列表', evidence: ['main.py:3'], parameters: [], request_body: null, responses: { '200': { description: 'ok' } }, auth: { type: 'none' }, effect: 'read', confirmation_required: false }]
      p.contract.verification = { cases: [{ operation: 'items', json_contains: { ok: true } }] }
      // Reference staged file by id without repeating content!
      p.changes = [{ id: 'df-1', path: 'Dockerfile', reason: '容器化启动' } as any]
      Object.assign(p.contract, { auth_rules: [
        { target: 'api', path: '/items', auth: { type: 'none' }, evidence: ['main.py:3300'] },
      ] })
      await assert.rejects(delivery.submit(job, directory, p, signal), /共 5 行/)
      ;(p.contract as any).auth_rules[0].evidence = ['main.py:3']
      Object.assign(p.contract, { auth_profile: { default_password: 'fixture' } })
      await assert.rejects(delivery.submit(job, directory, p, signal), /embedded credentials/)
      delete (p.contract as any).auth_profile
      await delivery.submit(job, directory, p, signal)
    }

    await delivery.startAnalysis(created.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = (await delivery.list(expected))[0]
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const reviewed = (await delivery.list(expected))[0]
    assert.equal(reviewed.status, 'review', reviewed.error)
    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready', ready.error)
    v1Hashes = ready.hashes
    v1SkillZipBytes = await readFile(join(jobDir, ready.revision, 'bundle/skill.zip'))

    await publishConfirmed(delivery, created.id, { artifactHash: ready.artifactHash, config: [] }, expected)
    deployed = {
      status: 'running',
      app_url: url,
      current_version: 2,
      config_fingerprint: 'fp-v2',
      build_log: '[Artifact] app.tar:other\n[Artifact] skill.zip:other\n',
    }
    // Simulate local job had different hashes before rollback to v1
    const rb = await delivery.rollback('align-app', 1, '恢复 v1', expected)
    assert.equal(rb.local_skill_synced, true)
    assert.equal(rb.local_skill_verified, true)
    const afterRb = (await delivery.list(expected))[0]
    assert.equal(afterRb.status, 'verified')
    assert.equal(afterRb.version, 1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
    await rm(home, { recursive: true, force: true })
  }
})

test('work-opc full parity: original secret preservation, loopback guard, unconditional storage mounts, single active skill with SKILL.md, local version archive fallback, build failure context, and transient 502 probe retry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-parity-'))
  let lookupAttempts = 0
  let expectedCredential = 'orig-secret-123'
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthz') {
      res.end(JSON.stringify({ service: 'parity-app' }))
      return
    }
    if (req.headers.authorization !== `Bearer ${expectedCredential}`) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'wrong version credential' }))
      return
    }
    lookupAttempts++
    if (lookupAttempts === 1) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'bad gateway transient' }))
      return
    }
    res.end(JSON.stringify({ ok: true, items: ['parity'] }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}`
  try {
    const source = join(home, 'source')
    await mkdir(join(source, 'data'), { recursive: true })
    await writeFile(join(source, 'data', 'seed.db'), 'sqlite-seed')
    await writeFile(join(source, 'config.json'), JSON.stringify({ API_SECRET: 'orig-secret-123' }))
    await writeFile(
      join(source, 'main.py'),
      'import os, sqlite3\nDB_PATH = "data/seed.db"\n'
    )
    const contexts = new ContextStore(), context = { issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 }
    contexts.replace(context)
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const storedCreds: Record<string, Record<string, string>> = {}
    const delivery = new AppDelivery(core, join(home, 'data'), {
      async read(id) { return storedCreds[id] ?? {} },
      async write(id, values) { storedCreds[id] = values },
    })
    const expected = contexts.applicationContextId!

    let publishedDockerfile = ''
    let publishedAppConfig: { key: string; value: string }[] = []
    let publishVersion = 0
    let deployed: Record<string, any> = {}

    delivery.platform = async (path, _expected, options) => {
      contexts.captureApplication(_expected)
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/publish') {
        publishVersion++
        publishedDockerfile = String(options?.form?.get('dockerfile_content') ?? '')
        publishedAppConfig = JSON.parse(String(options?.form?.get('app_config') ?? '[]'))
        return { app_url: url, version: publishVersion, status: 'building' }
      }
      if (path === '/parity-app/rollback' && options?.method === 'POST') {
        deployed.current_version = options.body && (options.body as { target_version: number }).target_version
        deployed.status = 'running'
        return { slug: 'parity-app', previous_version: 3, current_version: deployed.current_version }
      }
      if (path.includes('/artifacts/skill.zip')) {
        throw new AppRequestError(404, 'artifact not on remote')
      }
      return deployed
    }

    const created = await delivery.create({ name: '对齐测试', slug: 'parity-app', source }, 'session', expected)
    delivery.analyze = async (job, directory, _feedback, signal) => {
      // Do NOT call scan_routes_and_pages first — verify unconditional enrichment still detects storage_mounts & reports!
      const p = proposal(url)
      p.contract.slug = 'parity-app'
      p.contract.build_context = ['Dockerfile', 'main.py', 'config.json', 'data/seed.db']
      p.contract.health.json_contains = { service: 'parity-app' }
      Object.assign(p.contract.apis[0], { auth: { type: 'bearer', env: 'API_SECRET' } })
      p.changes = [
        { path: 'Dockerfile', reason: '容器化', content: 'FROM python:3.11-alpine\nCOPY main.py /app.py\nCMD ["python", "/app.py"]\n' },
        { path: 'config.json', reason: '移除硬编码密钥并改由环境变量注入', content: JSON.stringify({ API_SECRET: '' }) },
        { path: 'main.py', reason: '环境变量读取配置', content: 'import os, sqlite3\nAPI_SECRET = os.getenv("API_SECRET", "")\nDB_PATH = os.getenv("APP_DATA_DIR", "data") + "/seed.db"\n' },
      ]
      // First attempt without configs[].source for modified secret file must be rejected by secret preservation gate
      p.contract.configs = [
        { key: 'API_SECRET', default: '', secret: true, required: true, description: '密钥' } as any,
        { key: 'DATABASE_URL', default: 'postgres://localhost:5432/app', secret: false, required: false, description: '数据库连接' } as any,
      ]
      await assert.rejects(delivery.submit(job, directory, p, signal), /原有敏感配置必须保留并通过 source 引用注入/)

      // Now include source locator for API_SECRET
      p.contract.configs[0] = { key: 'API_SECRET', source: { path: 'config.json', keys: ['API_SECRET'] }, default: '', secret: true, required: true, description: '密钥' } as any
      await delivery.submit(job, directory, p, signal)
    }

    await delivery.startAnalysis(created.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = (await delivery.list(expected))[0]
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const reviewed = (await delivery.list(expected))[0]
    assert.equal(reviewed.status, 'review', reviewed.error)
    assert.ok(reviewed.discoveryReport, 'discoveryReport should be unconditionally populated')
    assert.ok(reviewed.transformationReport, 'transformationReport should be unconditionally populated')
    assert.ok(Array.isArray(reviewed.proposal.contract.storage_mounts) && reviewed.proposal.contract.storage_mounts.length > 0, 'storage_mounts should be auto-detected from data/seed.db')
    assert.ok(reviewed.proposal.changes.some((c: any) => c.diff?.includes('--- main.py (原始)')), 'unified diff should be computed for modified files')

    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready', ready.error)
    const secretCfg = ready.proposal.contract.configs.find((c: any) => c.key === 'API_SECRET')
    assert.equal(secretCfg.has_original_value, true, 'secret config should mark has_original_value=true without exposing secret')
    assert.equal(secretCfg.default, '', 'secret value must not be exposed in public contract')

    // Loopback guard rejects localhost DATABASE_URL unless local_connection_confirmed is true
    await assert.rejects(
      delivery.publish(created.id, {
        artifactHash: ready.artifactHash,
        config: [
          { key: 'API_SECRET', value: '' },
          { key: 'DATABASE_URL', value: 'postgres://localhost:5432/app' },
        ],
      }, expected),
      /指向应用容器自己/
    )

    // Confirming local connection and leaving API_SECRET blank auto-fills original secret from source
    await publishConfirmed(delivery, created.id, {
      artifactHash: ready.artifactHash,
      version_note: 'v1 初始发布',
      config: [
        { key: 'API_SECRET', value: '' },
        { key: 'DATABASE_URL', value: 'postgres://localhost:5432/app', local_connection_confirmed: true },
      ],
    }, expected)
    assert.ok(publishedDockerfile.includes('FROM python:3.11-alpine'), 'dockerfile_content should be uploaded on publish')
    assert.equal(publishedAppConfig.find(c => c.key === 'API_SECRET')?.value, 'orig-secret-123', 'original secret value should be auto-filled on publish')

    // Simulate container build failure first -> verify records failedRevision and failureContext
    deployed = { status: 'failed', app_url: url, current_version: 1, error_message: 'pip install failed', build_log: 'ERROR: No matching distribution' }
    const failedBuild = await delivery.verify(created.id, expected)
    assert.equal(failedBuild.status, 'failed')
    assert.match(String(failedBuild.error), /pip install failed/)
    deployed.can_manage = true
    const failedRequest = failedBuild.requestId
    await delivery.reopenDeployment(created.id, expected)
    const draft = await delivery.configDraft(created.id, expected)
    assert.equal(draft?.rows.find(row => row.key === 'API_SECRET')?.value, 'orig-secret-123')
    assert.equal(draft?.rows.find(row => row.key === 'DATABASE_URL')?.local_connection_confirmed, true)
    const redeployed = await publishConfirmed(delivery, created.id, { artifactHash: ready.artifactHash, config: draft!.rows }, expected)
    assert.notEqual(redeployed.requestId, failedRequest)
    assert.equal(redeployed.version, 2)

    // Now container succeeds and transient 502 on first /lookup probe is automatically retried
    deployed = {
      status: 'running',
      app_url: url,
      current_version: 2,
      build_log: ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${ready.hashes[name]}\n`).join(''),
    }
    const verifiedV1 = await delivery.verify(created.id, expected)
    assert.equal(verifiedV1.status, 'verified')
    assert.ok(lookupAttempts >= 2, 'probe should have retried after first 502 response')
    await delivery.setSkillEnabled(created.id, false, expected)
    await assert.rejects(delivery.invoke(created.id, 'lookup', {}, undefined, expected, async () => true), /已停用/)

    // Deploy a second job (v2) for the same slug -> v1 is demoted so only one active skill per slug exists
    deployed.can_manage = true
    const createdV2 = await delivery.create({ name: '对齐测试 v2', slug: 'parity-app', source, upgrade: true }, 'session', expected)
    await delivery.startAnalysis(createdV2.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = (await delivery.list(expected)).find((j: any) => j.id === createdV2.id)
      if (state?.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const reviewedV2 = (await delivery.list(expected)).find((j: any) => j.id === createdV2.id)
    const readyV2 = await delivery.prepare(createdV2.id, reviewedV2.proposalHash, expected)
    await publishConfirmed(delivery, createdV2.id, {
      artifactHash: readyV2.artifactHash,
      config: [{ key: 'API_SECRET', value: 'third-version-secret' }],
    }, expected)
    deployed = {
      status: 'running',
      app_url: url,
      current_version: 3,
      build_log: ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${readyV2.hashes[name]}\n`).join(''),
    }
    expectedCredential = 'third-version-secret'
    await delivery.verify(createdV2.id, expected)

    const allJobs = await delivery.list(expected)
    const verifiedJobs = allJobs.filter((j: any) => j.status === 'verified')
    assert.equal(verifiedJobs.length, 1, 'only one job per slug should remain verified')
    assert.equal(verifiedJobs[0].id, createdV2.id)
    assert.equal(verifiedJobs[0].userDisabled, true)

    const abortController = new AbortController()
    const provider = new AppSkillProvider(delivery, { invalidate() {}, signal: abortController.signal })
    assert.deepEqual(await provider.list({ signal: abortController.signal } as any), [])
    await delivery.setSkillEnabled(createdV2.id, true, expected)
    const candidates = await provider.list({ signal: abortController.signal } as any)
    assert.equal(candidates.length, 1)
    const skillDoc = await provider.get(candidates[0], { signal: abortController.signal } as any)
    assert.ok(skillDoc?.content.includes('## DSH 调用方式'), 'AppSkillProvider should include SKILL.md and DSH invocation guide')
    await delivery.setSkillEnabled(createdV2.id, false, expected)

    // A missing remote skill.zip uses the target version's local archive and task.
    expectedCredential = 'orig-secret-123'
    deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${ready.hashes[name]}\n`).join('')
    const rb = await delivery.rollback('parity-app', 2, '回退到 v2', expected)
    assert.equal(rb.local_skill_synced, true)
    assert.equal(rb.local_skill_verified, true)
    assert.equal(rb.job_id, created.id)
    assert.deepEqual(await provider.list({ signal: abortController.signal } as any), [])
    abortController.abort()
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
    await rm(home, { recursive: true, force: true })
  }
})
