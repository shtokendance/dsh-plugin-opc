import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { AppDelivery, fingerprint, worker } from '../src/host/app-delivery.ts'
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

test('propose_file staging, route/storage/credential inspection, and rollback historical skill.zip sync', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-align-'))
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
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
    const delivery = new AppDelivery(core, join(home, 'data'), { async read() { return {} }, async write() {} })
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
      const credInfo = await worker({ root: directory, action: 'inspect_credentials' })
      assert.ok(credInfo)

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

    await delivery.publish(created.id, { artifactHash: ready.artifactHash, config: [] }, expected)
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
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthz') {
      res.end(JSON.stringify({ service: 'parity-app' }))
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
        deployed.current_version = 1
        deployed.status = 'running'
        return { slug: 'parity-app', previous_version: 2, current_version: 1, message: 'rolled back to v1' }
      }
      if (path.includes('/artifacts/skill.zip')) {
        throw new Error('404 artifact not on remote')
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
    await delivery.publish(created.id, {
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

    // Now container succeeds and transient 502 on first /lookup probe is automatically retried
    deployed = {
      status: 'running',
      app_url: url,
      current_version: 1,
      build_log: ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${ready.hashes[name]}\n`).join(''),
    }
    const verifiedV1 = await delivery.verify(created.id, expected)
    assert.equal(verifiedV1.status, 'verified')
    assert.ok(lookupAttempts >= 2, 'probe should have retried after first 502 response')

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
    await delivery.publish(createdV2.id, {
      artifactHash: readyV2.artifactHash,
      config: [{ key: 'API_SECRET', value: '' }],
    }, expected)
    deployed = {
      status: 'running',
      app_url: url,
      current_version: 2,
      build_log: ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${readyV2.hashes[name]}\n`).join(''),
    }
    await delivery.verify(createdV2.id, expected)

    const allJobs = await delivery.list(expected)
    const verifiedJobs = allJobs.filter((j: any) => j.status === 'verified')
    assert.equal(verifiedJobs.length, 1, 'only one job per slug should remain verified')
    assert.equal(verifiedJobs[0].id, createdV2.id)

    const abortController = new AbortController()
    const provider = new AppSkillProvider(delivery, { invalidate() {}, signal: abortController.signal })
    const candidates = await provider.list({ signal: abortController.signal } as any)
    assert.equal(candidates.length, 1)
    const skillDoc = await provider.get(candidates[0], { signal: abortController.signal } as any)
    assert.ok(skillDoc?.content.includes('## DSH 调用方式'), 'AppSkillProvider should include SKILL.md and DSH invocation guide')

    // Rollback to v1 when remote skill.zip returns 404 falls back to local archived versions/parity-app/v1/skill.zip
    deployed.build_log = ['app.tar', 'skill.zip'].map(name => `[Artifact] ${name}:${ready.hashes[name]}\n`).join('')
    const rb = await delivery.rollback('parity-app', 1, '回退到 v1', expected)
    assert.equal(rb.local_skill_synced, true)
    assert.equal(rb.local_skill_verified, true)
    abortController.abort()
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
    await rm(home, { recursive: true, force: true })
  }
})
