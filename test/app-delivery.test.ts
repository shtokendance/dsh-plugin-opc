import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from 'fflate'
import { AppDelivery, AppRequestError, fingerprint, worker, type AppDocument } from '../src/host/app-delivery.ts'
import { attachAppAgent } from '../src/host/app-agent.ts'
import { AppSkillProvider } from '../src/host/app-skills.ts'
import { ContextStore, identityHash } from '../src/host/context.ts'
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

test('analysis replies preserve the bound task and only a complete proposal is bundled automatically', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-chat-'))
  const contexts = new ContextStore()
  contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
  const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
  const delivery = new AppDelivery(core, home, { async read() { return {} }, async write() {} })
  const expected = contexts.applicationContextId!
  const url = 'http://127.0.0.1:8080'
  const analysisSessionId = 'aadc3eaa-feeb-4e52-993d-8c172a95d019'
  const allowReply = Promise.withResolvers<void>()
  const question = '保留现在使用的数据源吗？'
  let id: string | undefined
  const waitFor = async (condition: (job: Record<string, any>) => boolean) => {
    const deadline = Date.now() + 5_000
    for (;;) {
      const job = await delivery.getJob(id!, expected)
      if (condition(job) || job.status === 'failed') return job
      if (Date.now() >= deadline) throw new Error(`未等到期望状态，当前状态 ${job.status}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    delivery.platform = async path => {
      assert.equal(path, '/check-slug')
      return { available: true, app_url: url }
    }
    const source = join(home, 'source')
    await mkdir(source)
    await writeFile(join(source, 'main.py'), 'print("fixture")\n')
    const created = await delivery.create({ name: '测试会话', slug: 'test-app', source }, 'origin', expected)
    id = created.id
    delivery.analyze = async (job, root, _feedback, signal, onSessionReady) => {
      await onSessionReady(analysisSessionId)
      const blocked = proposal(url)
      await delivery.submit(job, root, { ...blocked, contract: { ...blocked.contract, unresolved: [question] } }, signal)
      await allowReply.promise
      await delivery.recordAnalysisReply(job, root, '保留现在使用的数据源。\nPASSWORD="chat-test-secret"', signal)
      await delivery.submit(job, root, proposal(url), signal)
    }
    await delivery.startAnalysis(created.id, '', expected)
    const waiting = await waitFor(job => job.status === 'review')
    assert.equal(waiting.analysisChatActive, true)
    assert.deepEqual(waiting.proposal.unresolved, [question])
    assert.equal(waiting.artifactHash, undefined)
    assert.equal((await delivery.getJobByAnalysisSession(analysisSessionId, expected))?.id, created.id)

    allowReply.resolve()
    const ready = await waitFor(job => job.status === 'ready' && !job.analysisChatActive)
    assert.equal(ready.status, 'ready', ready.error)
    assert.equal(ready.analysisSessionId, analysisSessionId)
    assert.equal(ready.revisionCount, 2)
    assert.match(ready.feedbackHistory, /保留现在使用的数据源/)
    assert.doesNotMatch(ready.feedbackHistory, /chat-test-secret/)
    assert.ok(ready.artifactHash)
    assert.equal(ready.deploymentReviewPending, true)
    await delivery.saveConfigDraft(created.id, { artifactHash: ready.artifactHash, rows: [] }, expected)
    assert.equal((await delivery.getJob(created.id, expected)).deploymentReviewPending, false)
  } finally {
    allowReply.resolve()
    if (id) await delivery.cancelAnalysis(id, expected).catch(() => {})
    await rm(home, { recursive: true, force: true })
  }
})

test('imports UTF-8 ZIP paths even when both headers omit the UTF-8 flag', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-zip-'))
  try {
    const path = '私池与AI后端/bff/src/main.ts'
    const content = 'console.log("ready")\n'
    const archive = Buffer.from(zipSync({ [`project/${path}`]: strToU8(content) }))
    const central = archive.readUInt32LE(archive.length - 22 + 16)
    const local = archive.readUInt32LE(central + 42)
    archive.writeUInt16LE(archive.readUInt16LE(central + 8) & ~0x800, central + 8)
    archive.writeUInt16LE(archive.readUInt16LE(local + 6) & ~0x800, local + 6)
    const source = join(home, 'source.zip')
    const root = join(home, 'job')
    await writeFile(source, archive)
    await worker({ root, action: 'prepare', source, slug: 'test-app', url: 'http://127.0.0.1:8080' })
    assert.equal(await readFile(join(root, 'review/source', path), 'utf8'), content)
    const original = await worker({ root, action: 'read', path, proposed: true })
    assert.equal(original.path, path)
    assert.equal(original.view, 'original')
    assert.match(original.text, /暂无暂存修改/)
    await assert.rejects(
      worker({ root, action: 'read', path: 'bff/src/main.ts' }),
      error => error instanceof Error && error.message.includes(path),
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('route scan keeps runtime endpoints and excludes test and demo service routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-app-route-scan-'))
  const source = join(root, 'review/source')
  try {
    const files = {
      'src/routes/test/server.cjs': "app.get('/live', handler)\n",
      'tests/gateway-rbac-permission.test.ts': "const mock = { path: '/p' }\n",
      '.claude/worktrees/local-copy/server.cjs': "app.get('/archived-working-copy', handler)\n",
      'handoff/run-correction-demo.cjs': "if (!process.argv.includes('--fixture')) throw Error('This script is demo-only')\napp.get('/', handler)\n",
      'tools/correction_server.py': '"""仅供演示。"""\nparser.add_argument("--demo")\nif not args.demo: parser.error("demo required")\nif self.path == "/action":\n    pass\n',
      'services/main.cjs': "// The extra options in --demo mode are demo-only.\nconst demo = process.argv.includes('--demo')\napp.get('/business', handler)\n",
      'nest/src/main.ts': "import { NestFactory } from '@nestjs/core'\napp.setGlobalPrefix('api')\n",
      'nest/src/health.controller.ts': '@Controller()\nexport class HealthController {\n  @Get("health")\n  health() {}\n}\n',
      'swagger.json': JSON.stringify({
        swagger: '2.0',
        paths: { '/search': { post: { parameters: [
          { in: 'query', name: 'limit', type: 'integer', description: '最大条数' },
          { in: 'body', name: 'filter', required: true, schema: { type: 'object' } },
        ] } } },
      }),
    }
    for (const [path, content] of Object.entries(files)) {
      const file = join(source, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    const scanned = await worker({ root, action: 'scan_routes_and_pages' })
    assert.deepEqual(scanned.apis.map((api: { path: string }) => api.path), ['/api/health', '/business', '/live', '/search'])
    assert.deepEqual(scanned.apis[0].evidence, ['nest/src/health.controller.ts:3'])
    assert.equal(scanned.apis[3].request_body.required, true)
    assert.deepEqual(scanned.apis[3].parameters.map((p: { in: string }) => p.in), ['query'])
    assert.ok(scanned.apis.every((api: { auth: { type: string } }) => api.auth.type === 'unknown'))
    assert.deepEqual(scanned.pages, [])

    const plan = proposal('http://127.0.0.1:8080')
    plan.changes = []
    plan.contract.apis = []
    plan.contract.build_context = ['src/routes/test']
    plan.contract.verification = { cases: [] }
    Object.assign(plan.contract, {
      auth_rules: [{ target: 'api', path: '/live', auth: { type: 'none' }, evidence: ['src/routes/test/server.cjs:1'] }],
    })
    const validated = await worker({ root, action: 'validate', allow_unresolved: true, proposal: plan })
    assert.deepEqual(validated.proposal.contract.apis.map((api: { path: string }) => api.path), ['/live'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('direct API and page auth evidence is checked against the proposed source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-app-auth-evidence-'))
  const source = join(root, 'review/source')
  const path = 'services/安全/guard.go'
  try {
    const file = join(source, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'package guards\n')

    const plan = proposal('http://127.0.0.1:8080')
    plan.changes = [{
      path: `./${path}`,
      reason: '保留服务的认证处理',
      content: 'package guards\n\nfunc checkSession(session string) bool {\n    return session != ""\n}\n',
    }]
    const api = plan.contract.apis[0]
    api.evidence = [`${path}:1`]
    const apiAuth = { type: 'bearer', env: 'SERVICE_TOKEN', evidence: [`${path}:3-5`] }
    api.auth = apiAuth
    const pageAuth = { type: 'header', header: 'Cookie', env: 'WEB_SESSION', evidence: [`${path}:3`] }
    Object.assign(plan.contract, {
      pages: [{ path: '/dashboard', purpose: '看板', actions: ['查看看板'], evidence: [`${path}:1`], auth: pageAuth }],
    })
    const validate = () => worker({ root, action: 'validate', allow_unresolved: true, proposal: plan })
    assert.equal((await validate()).valid, true)

    pageAuth.evidence = [`${path}:6`]
    await assert.rejects(validate(), /拟提交文件 .*共 5 行/)
    pageAuth.evidence = [`${path}:3`]
    apiAuth.evidence = ['services/错误目录/guard.go:3']
    await assert.rejects(validate(), error => error instanceof Error && error.message.includes(path))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('worker retains nested YAML configuration references and existing executable permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-app-inputs-'))
  try {
    const source = join(root, 'source')
    const job = join(root, 'job')
    await mkdir(source)
    await mkdir(job)
    await writeFile(join(source, 'main.py'), 'import os\nprint(os.getenv("DATABASE_DSN"), os.getenv("SERVICE_ENDPOINT"))\n')
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

test('volume initialization targets the final image and the declared mount path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-volume-mapping-'))
  try {
    await mkdir(join(root, 'review/source'), { recursive: true })
    await writeFile(join(root, 'review/source/main.py'), 'print("hello")\n')
    const plan = proposal('http://127.0.0.1:8080')
    const dockerfile = 'FROM python:3.11-alpine AS build\nWORKDIR /compile\nEXPOSE 9000\n'
      + 'FROM python:3.11-alpine\nWORKDIR /srv/runtime\nCOPY main.py .\nCMD ["python", "main.py"]\n'
    plan.changes[0].content = dockerfile
    Object.assign(plan.contract, {
      storage_mounts: [{ name: 'records', relative_path: 'initial-records', container_path: '/var/lib/app-records' }],
    })
    const validate = () => worker({ root, action: 'validate', allow_unresolved: true, proposal: plan })
    const patched = (await validate()).proposal.changes[0].content
    assert.match(patched, /EXPOSE 9000\nFROM python:3\.11-alpine\nWORKDIR \/srv\/runtime/)
    assert.match(patched, /for d in "\/var\/lib\/app-records"; do/)
    assert.match(patched, /ENTRYPOINT \["\/srv\/runtime\/\.opc-seed\/opc-storage-init\.sh"\]/)
    const custom = dockerfile.replace('CMD', 'ENTRYPOINT ["python"]\nCMD')
    plan.changes[0].content = custom
    assert.equal((await validate()).proposal.changes[0].content, custom)
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function publishConfirmed(delivery: AppDelivery, id: string, input: Record<string, unknown>, context: string) {
  const confirmation = await delivery.confirmDeployment(id, input, context)
  return delivery.publish(id, { ...input, ...confirmation }, context)
}

test('a backup response streams past 64 MiB and a mismatched file is discarded', async () => {
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
      ;(p.contract as any).auth_rules[0].evidence = ['missing/main.py:3']
      await assert.rejects(delivery.submit(job, directory, p, signal), /同名文件：main\.py/)
      ;(p.contract as any).auth_rules[0].evidence = ['main.py:3']
      Object.assign(p.contract, { auth_profile: { default_password: 'fixture' } })
      await assert.rejects(delivery.submit(job, directory, p, signal), /embedded credentials/)
      delete (p.contract as any).auth_profile
      await delivery.submit(job, directory, p, signal)
    }

    await delivery.startAnalysis(created.id, '', expected)
    const analysisDeadline = Date.now() + 8_000
    while (Date.now() < analysisDeadline) {
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

    const bundle = JSON.parse(await readFile(join(jobDir, 'job.json'), 'utf8'))
    const { unzipSync, zipSync } = await import('fflate')
    const archive = unzipSync(new Uint8Array(v1SkillZipBytes!))
    const operationFile = Object.keys(archive).find(name => name.endsWith('references/operations.json'))!
    const historicalContract = JSON.parse(Buffer.from(archive[operationFile]).toString())
    historicalContract.verification.cases.push({ operation: 'missing-operation', json_contains: { ok: true } })
    archive[operationFile] = Buffer.from(JSON.stringify(historicalContract))
    v1SkillZipBytes = Buffer.from(zipSync(archive))
    v1Hashes = { ...bundle.hashes, 'skill.zip': createHash('sha256').update(v1SkillZipBytes).digest('hex') }
    const invalid = await delivery.rollback('align-app', 1, '版本包含无效验证用例', expected)
    assert.equal(invalid.local_skill_verified, false)
    assert.equal(invalid.verification?.status, 'probe-warning')
    assert.match(invalid.verification?.detail, /有效的只读业务接口/)
    assert.equal((await delivery.getJob(invalid.job_id!, expected)).failureStage, 'verification')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
    await rm(home, { recursive: true, force: true })
  }
})

test('work-opc full parity: original secret preservation, loopback guard, unconditional storage mounts, single active skill with SKILL.md, local version archive fallback, build failure context, and transient 502 probe retry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-parity-'))
  let lookupAttempts = 0
  let healthRequests = 0
  let expectedCredential = 'orig-secret-123'
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthz') {
      healthRequests++
      res.statusCode = 404
      res.end('{}')
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
    await writeFile(join(source, 'config.json'), JSON.stringify({ API_SECRET: 'orig-secret-123', DATABASE_URL: 'postgres://localhost:5432/app' }))
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
    let publishedMounts: { container_path: string; resource_id?: string }[] = []
    let publishedAppConfig: { key: string; value: string }[] = []
    let publishVersion = 0
    let deployed: Record<string, any> = {}

    delivery.platform = async (path, _expected, options) => {
      contexts.captureApplication(_expected)
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/resources') return { resources: [{ id: 'swarm-local', type: 'docker-volume' }, { id: 'swarm-other', type: 'docker-volume' }] }
      if (path === '/publish') {
        publishVersion++
        publishedDockerfile = String(options?.form?.get('dockerfile_content') ?? '')
        publishedMounts = JSON.parse(String(options?.form?.get('storage_mounts') ?? '[]'))
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
      Object.assign(p.contract.apis[0], { auth: { type: 'bearer', env: 'API_SECRET' } })
      p.changes = [
        { path: 'Dockerfile', reason: '容器化', content: 'FROM python:3.11-alpine\nCOPY main.py /app.py\nCMD ["python", "/app.py"]\n' },
        { path: 'config.json', reason: '测试模型试图改写原配置的拦截', content: JSON.stringify({ API_SECRET: '' }) },
        { path: 'main.py', reason: '保留原配置与持久化目录', content: 'import os, sqlite3\nDB_PATH = "data/seed.db"\n# Container entry reads the original application files.\n' },
      ]
      p.contract.configs = [
        { key: 'API_SECRET', source: { path: 'config.json', keys: ['API_SECRET'] }, default: '', secret: true, required: true, description: '密钥' },
        { key: 'DATABASE_URL', source: { path: 'config.json', keys: ['DATABASE_URL'] }, default: '', secret: false, required: false, description: '数据库连接' },
      ]
      const { health: _health, ...contract } = p.contract
      await assert.rejects(delivery.submit(job, directory, { ...p, contract }, signal), /原应用配置/)
      p.changes = p.changes.filter(change => change.path !== 'config.json')
      await delivery.submit(job, directory, { ...p, contract }, signal)
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
    const dockerfileChange = reviewed.proposal.changes.find((file: { path: string }) => file.path === 'Dockerfile')
    assert.match(dockerfileChange.diff, /ENTRYPOINT \["\/app\/\.opc-seed\/opc-storage-init\.sh"\]/)
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

    // The exact volume selection is bound to the confirmation and travels with the multipart declaration.
    const path = ready.proposal.contract.storage_mounts[0].container_path
    const payload = {
      artifactHash: ready.artifactHash,
      version_note: 'v1 初始发布',
      storageBindings: { [path]: 'swarm-local' },
      config: [
        { key: 'API_SECRET', value: '' },
        { key: 'DATABASE_URL', value: 'postgres://localhost:5432/app', local_connection_confirmed: true },
      ],
    }
    const confirmation = await delivery.confirmDeployment(created.id, payload, expected)
    await assert.rejects(delivery.publish(created.id, {
      ...payload, confirmationToken: confirmation.confirmationToken, storageBindings: { [path]: 'swarm-other' },
    }, expected), /最终确认不一致/)
    await assert.rejects(delivery.confirmDeployment(created.id, {
      ...payload, storageBindings: { [path]: 'missing-pool' },
    }, expected), /存储资源不可用/)
    await delivery.publish(created.id, { ...payload, confirmationToken: confirmation.confirmationToken }, expected)
    assert.equal(publishedMounts.find(mount => mount.container_path === path)?.resource_id, 'swarm-local')
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
    assert.equal(healthRequests, 0)
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

test('parity additions: opcConfig, checkSlug, getJob, skillPreview contract/sha256, proposed read, resume mode, and saveLocalArtifact', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-app-parity-new-'))
  try {
    const source = join(home, 'source')
    const downloads = join(home, 'downloads')
    await mkdir(source, { recursive: true })
    await mkdir(downloads, { recursive: true })
    await writeFile(join(source, 'main.py'), 'print("hello")\n')

    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const expected = contexts.applicationContextId!
    const core = Object.assign(new EventEmitter(), {
      auth: { contexts, http: { base: new URL('https://platform.test') } },
      llm: {},
      emit() { return true },
    }) as unknown as OpcCore

    const calls: string[] = []
    let draftCountInAnalyze = -1
    const delivery = new AppDelivery(
      core,
      join(home, 'delivery'),
      { async read() { return {} }, async write() {} },
      { appDomainRoot: 'apps.corp.internal', appDefaultPort: 9090 },
    )
    delivery.platform = async (path, _ctx, opts) => {
      calls.push(path)
      if (path === '/check-slug') {
        const slug = String((opts?.body as Record<string, unknown> | undefined)?.slug || '')
        return { available: slug !== 'taken-app', slug, app_url: `http://${slug}.apps.corp.internal` }
      }
      if (path === '/resources') return { resources: [] }
      if (path.startsWith('/taken-app')) return { slug: 'taken-app' }
      return {}
    }

    const cfg = await delivery.opcConfig(expected)
    assert.deepEqual(cfg, { appDomainRoot: 'apps.corp.internal', defaultPort: 9090, platformBaseUrl: 'https://platform.test' })

    const avail = await delivery.checkSlug('fresh-app', expected)
    assert.equal(avail.available, true)
    assert.equal(avail.app_url, 'http://fresh-app.apps.corp.internal')
    const taken = await delivery.checkSlug('taken-app', expected)
    assert.equal(taken.available, false)

    // Create without explicit container_port -> defaults to appDefaultPort (9090)
    const created = await delivery.create(
      {
        name: '新功能测试',
        slug: 'fresh-app',
        source,
        modelSelection: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' },
      },
      'sess-1',
      expected,
    )
    assert.equal(created.port, 9090)
    assert.equal(created.url, 'http://fresh-app.apps.corp.internal')
    assert.equal(created.model, 'gpt-5')
    assert.equal(created.reasoning_effort, 'high')

    const fetched = await delivery.getJob(created.id, expected)
    assert.equal(fetched.id, created.id)
    assert.equal(fetched.port, 9090)

    const spaceDirs = await readdir(join(home, 'delivery', 'opc', 'apps'))
    const jobRoot = join(home, 'delivery', 'opc', 'apps', spaceDirs[0], created.id)
    await worker(
      {
        action: 'propose_file',
        root: jobRoot,
        id: 'staged-1',
        path: 'Dockerfile',
        reason: '测试暂存修改',
        content: 'FROM python:3.11-alpine\n# draft-content-from-previous-turn\n',
      },
      new AbortController().signal,
    )

    // Worker read with proposed=true returns staged draft content
    const proposedRead = await worker(
      { action: 'read', root: jobRoot, path: 'Dockerfile', proposed: true },
      new AbortController().signal,
    )
    assert.match(String(proposedRead.text), /拟交付文件 Dockerfile/)
    assert.match(String(proposedRead.text), /draft-content-from-previous-turn/)

    // Simulate an interrupted analysis run -> status=failed -> resume mode preserves draft_files.json
    delivery.analyze = async () => {
      throw new Error('模拟分析超时')
    }
    await delivery.startAnalysis(created.id, '', expected, 'sess-1')
    for (let i = 0; i < 100; i++) {
      const state = await delivery.getJob(created.id, expected)
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    const paused = await delivery.getJob(created.id, expected)
    assert.equal(paused.status, 'failed')
    assert.equal(paused.failureStage, 'analysis')
    assert.match(String(paused.analysis_failure), /模拟分析超时/)

    await worker(
      {
        action: 'propose_file',
        root: jobRoot,
        id: 'staged-2',
        path: 'main.py',
        reason: '断点恢复暂存',
        content: 'resumed-draft-content',
      },
      new AbortController().signal,
    )

    delivery.analyze = async (job, directory, _feedback, signal) => {
      const preserved = await readFile(join(directory, 'draft_files.json'), 'utf8')
      draftCountInAnalyze = Object.keys(JSON.parse(preserved)).length
      const p = proposal('http://fresh-app.apps.corp.internal')
      p.contract.slug = 'fresh-app'
      p.contract.runtime.port = 9090
      p.contract.health.json_contains = { service: 'fresh-app' }
      await delivery.submit(job, directory, p, signal)
    }

    await delivery.startAnalysis(created.id, '', expected, 'sess-1', { mode: 'resume' })
    for (let i = 0; i < 100; i++) {
      const state = await delivery.getJob(created.id, expected)
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }
    assert.equal(draftCountInAnalyze, 1, 'resume mode should preserve existing draft_files.json')

    const reviewed = await delivery.getJob(created.id, expected)
    assert.equal(reviewed.status, 'review', reviewed.error)

    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready')
    assert.ok(ready.artifacts && ready.artifacts['app-manifest.json'])

    const preview = await delivery.skillPreview(created.id, expected)
    assert.ok(preview.markdown.includes('fresh-app'))
    assert.equal(preview.contract.slug, 'fresh-app')
    assert.match(preview.sha256, /^[a-f0-9]{64}$/)

    const saved = await delivery.saveLocalArtifact(created.id, 'app-manifest.json', expected, downloads)
    assert.ok(saved.path.startsWith(downloads))
    const savedContent = JSON.parse(await readFile(saved.path, 'utf8'))
    assert.equal(savedContent.slug, 'fresh-app')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a healthy old version does not end polling for a newer build', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-pending-upgrade-'))
  try {
    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const expected = contexts.applicationContextId!
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const delivery = new AppDelivery(core, home, { async read() { return {} }, async write() {} })
    const id = '2e9fda92-f3b7-4d23-9ae9-9fd1d7d2aa07', url = 'http://127.0.0.1:1'
    const root = join(home, 'opc', 'apps', identityHash(contexts.captureApplication(expected).context), id)
    await mkdir(root, { recursive: true })
    const hashes = { 'app.tar': 'new-app', 'skill.zip': 'new-skill' }
    await writeFile(join(root, 'job.json'), JSON.stringify({ id, name: 'App', slug: 'test-app', url,
      status: 'building', published: true, version: 2, events: [], proposal: proposal(url), hashes }))
    let status = 'building'
    delivery.platform = async path => path.endsWith('/versions')
      ? { versions: [{ version: 2, status, app_tar_sha256: hashes['app.tar'], skill_zip_sha256: hashes['skill.zip'], error_message: 'build failed' }] }
      : { status: 'running', current_version: 1, app_url: url }
    assert.equal((await delivery.verify(id, expected)).status, 'building')
    status = 'failed'
    const failed = await delivery.verify(id, expected)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.failureStage, 'deployment')
    assert.equal(failed.error, 'build failed')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('python runtime keeps sqlite on persistent volumes, refreshes .opc-seed cleanly, and scans proposal changes', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'opc-py-upgrade-'))
  try {
    const runtimeDir = fileURLToPath(new URL('../runtime', import.meta.url))
    const srcDir = join(workDir, 'src')
    await mkdir(join(srcDir, 'data'), { recursive: true })
    await mkdir(join(srcDir, 'uploads'), { recursive: true })
    await writeFile(join(srcDir, 'uploads', 'welcome.txt'), 'seed')
    await writeFile(
      join(srcDir, 'main.py'),
      [
        'import sqlite3',
        'import psycopg2',
        'from flask import Flask, jsonify',
        'app = Flask(__name__)',
        'conn = sqlite3.connect("data/app.db")',
        '@app.get("/healthz")',
        'def health(): return jsonify({"service": "demo-app"})',
        '@app.get("/items")',
        'def items(): return jsonify({"items": []})',
      ].join('\n'),
    )
    const oldDf = [
      'FROM python:3.11-slim',
      'WORKDIR /app',
      'COPY requirements.txt ./',
      'COPY . .',
      '# OPC-PERSISTENT-STORAGE-START',
      'RUN mkdir -p /app/.opc-seed/data && cp -r /app/data/. /app/.opc-seed/data/ 2>/dev/null || true',
      '# OPC-PERSISTENT-STORAGE-END',
      'COPY extra/config.json /app/extra/config.json',
      'CMD ["python", "main.py"]',
    ].join('\n')
    await writeFile(join(srcDir, 'Dockerfile'), oldDf)

    const pyScript = `
import json, sqlite3, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(runtimeDir)})
import app_delivery_migration as m

src = Path(${JSON.stringify(srcDir)})
with sqlite3.connect(src / "data" / "app.db") as conn:
    conn.execute("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO items (name) VALUES ('seed-item')")
    conn.commit()

updated_main = (src / "main.py").read_text() + "\\n@app.get('/v2/ping')\\ndef v2_ping(): return jsonify({'pong': True})\\n"
proposal = {
    "summary": "upgrade to v2",
    "issues": [],
    "unresolved": [],
    "decisions": [],
    "changes": [
        {"path": "main.py", "reason": "add v2 ping route", "content": updated_main},
    ],
    "contract": {
        "schema_version": 1,
        "slug": "demo-app",
        "name": "Demo",
        "description": "Demo",
        "base_url": "http://demo-app.example.test",
        "runtime": {"language": "python", "version": "3.11", "port": 8080},
        "build_context": ["Dockerfile", "main.py", "data/app.db", "uploads/welcome.txt"],
        "health": {"path": "/healthz", "status": 200, "json_contains": {"service": "demo-app"}},
        "configs": [],
        "resources": [],
        "pages": [],
        "apis": [],
        "storage_mounts": [
            {"name": "uploads", "relative_path": "uploads", "container_path": "/app/uploads", "kind": "uploads", "purpose": "uploads"}
        ],
        "verification": {"cases": []},
        "unresolved": [],
    },
}
report = m.enrich_contract_and_discovery_report(src, {"slug": "demo-app"}, proposal)
print(json.dumps({"report": report, "proposal": proposal}, ensure_ascii=False))
`
    const { stdout } = await promisify(execFile)('python3', ['-c', pyScript])
    const parsed = JSON.parse(stdout)
    const storageDiscovery = parsed.report?.discovery_report?.storage_and_database ?? {}
    assert.equal('can_migrate_to_platform_pg' in storageDiscovery, false)
    assert.equal('platform_pg_resource' in storageDiscovery, false)

    const mounts = parsed.proposal.contract.storage_mounts as Array<Record<string, any>>
    assert.ok(mounts.some(m => m.container_path === '/app/data' && m.kind === 'sqlite'))
    assert.ok(mounts.some(m => m.container_path === '/app/uploads'))

    const apis = parsed.proposal.contract.apis as Array<Record<string, any>>
    assert.ok(apis.some(a => a.path === '/v2/ping'), 'route scan should inspect proposal.changes overlay')

    const dfChange = (parsed.proposal.changes as Array<Record<string, any>>).find(c => c.path === 'Dockerfile')
    assert.ok(dfChange && typeof dfChange.content === 'string')
    assert.equal((dfChange.content.match(/# \[OPC Persistent Storage\]/g) ?? []).length, 1)
    assert.equal(dfChange.content.includes('# OPC-PERSISTENT-STORAGE-START'), false)
    assert.ok(dfChange.content.includes('/app/uploads') && dfChange.content.includes('/app/data'))
    assert.ok(dfChange.content.includes('.build-id'))
    assert.ok(dfChange.content.includes('sync_sqlite.py'))
    const initMatch = dfChange.content.match(/printf '%s' '([A-Za-z0-9+/=]+)' \| \(base64 -d[^)]+\) > "\/app\/\.opc-seed\/opc-storage-init\.sh"/)
    assert.ok(initMatch, 'Dockerfile should embed base64 opc-storage-init.sh')
    const initScript = Buffer.from(initMatch[1], 'base64').toString('utf8')
    assert.ok(initScript.includes('.opc-backups'))
    assert.ok(initScript.includes('sync_sqlite.py'))
    assert.ok(initScript.includes('_opc_copy_seed_dir'))
    const lastCopy = dfChange.content.lastIndexOf('COPY extra/config.json')
    const seedStart = dfChange.content.indexOf('# [OPC Persistent Storage]')
    assert.ok(seedStart > lastCopy, 'seed protection block must be placed after final COPY')
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

test('upgrade list failure detection, previousJobId inheritance, updateConfig credentials, and AppSkillProvider safety', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-upgrade-host-'))
  try {
    const server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"service":"up-app"}')
        return
      }
      if (req.url === '/lookup') {
        const hdr = req.headers['x-api-key']
        res.writeHead(hdr === 'new-secret' ? 200 : 401, { 'content-type': 'application/json' })
          .end(hdr === 'new-secret' ? '{"ok":true}' : '{"ok":false}')
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    try {
      const addr = server.address() as { port: number }
      const url = `http://127.0.0.1:${addr.port}`
      const contexts = new ContextStore()
      contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
      const expected = contexts.applicationContextId!
      const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
      const storeMap = new Map<string, Record<string, string>>()
      const credentials = {
        async read(id: string) { return { ...(storeMap.get(id) ?? {}) } },
        async write(id: string, values: Record<string, string>) { storeMap.set(id, { ...values }) },
      }
      const delivery = new AppDelivery(core, home, credentials)
      const scopeDir = join(home, 'opc', 'apps', identityHash(contexts.captureApplication(expected).context))

      // 1. Seed verified v1 job and building v2 job where platform auto-rolled back to v1
      const v1Id = '11111111-1111-4111-8111-111111111111'
      const v2Id = '22222222-2222-4222-8222-222222222222'
      const v3Id = '33333333-3333-4333-8333-333333333333'
      const baseProposal = proposal(url)
      baseProposal.contract.slug = 'up-app'
      baseProposal.contract.health.json_contains = { service: 'up-app' }
      baseProposal.contract.auth_profile = { type: 'header', header: 'X-Api-Key', token_env: 'APP_SECRET', evidence: ['main.py:1'] }
      baseProposal.contract.configs = [{ key: 'APP_SECRET', secret: true, required: true }]
      baseProposal.contract.apis = [{
        id: 'lookup', method: 'GET', path: '/lookup', purpose: 'lookup',
        evidence: ['main.py:1'], parameters: [], request_body: null,
        responses: { '200': { description: 'ok' } }, auth: { type: 'header', header: 'X-Api-Key', env: 'APP_SECRET' }, effect: 'read', confirmation_required: false,
      }]

      const hashesV1 = { 'app.tar': 'a'.repeat(64), 'skill.zip': 'b'.repeat(64) }
      const hashesV2 = { 'app.tar': 'c'.repeat(64), 'skill.zip': 'd'.repeat(64) }
      await mkdir(join(scopeDir, v1Id), { recursive: true })
      await mkdir(join(scopeDir, v2Id), { recursive: true })
      await mkdir(join(scopeDir, v3Id), { recursive: true })
      await writeFile(join(scopeDir, v1Id, 'job.json'), JSON.stringify({
        id: v1Id, name: 'Up App', slug: 'up-app', url, session: 's1', status: 'verified', published: true,
        version: 1, requestId: 'reqv1', configFingerprint: 'fp-old', createdAt: 1000,
        checks: [{ operation: 'lookup', status: 200 }], events: [], proposal: baseProposal, hashes: hashesV1,
      }))
      await credentials.write('publish-config-reqv1', {
        rows: JSON.stringify([{ key: 'APP_SECRET', value: 'old-secret' }]),
      })
      await writeFile(join(scopeDir, v2Id, 'job.json'), JSON.stringify({
        id: v2Id, name: 'Up App', slug: 'up-app', url, session: 's1', status: 'building', published: true,
        upgrade: true, version: 2, requestId: 'reqv2', createdAt: 2000, events: [], proposal: baseProposal, hashes: hashesV2,
      }))
      await writeFile(join(scopeDir, v3Id, 'job.json'), JSON.stringify({
        id: v3Id, name: 'Up App', slug: 'up-app', url, session: 's1', status: 'verified', published: true,
        version: 3, requestId: 'reqv3', configFingerprint: 'fp-v3', createdAt: 3000,
        checks: [{ operation: 'lookup', status: 200 }], events: [], proposal: baseProposal, hashes: hashesV1,
      }))

      let remoteFp = 'fp-old'
      let remoteVersion = 1
      let checkSlugCalled = false
      delivery.platform = async (path, _ctx, opts) => {
        if (path === '/check-slug') { checkSlugCalled = true; return { available: false } }
        if (path === '/up-app/config' && opts?.method === 'PUT') {
          remoteFp = 'fp-new'
          return { current_version: 1, config_fingerprint: remoteFp }
        }
        if (path === '/up-app/versions') {
          return { versions: [{ version: 2, status: 'failed', app_tar_sha256: hashesV2['app.tar'], skill_zip_sha256: hashesV2['skill.zip'], error_message: 'v2 auto-rolled back' }] }
        }
        if (path === '/up-app') {
          return {
            status: 'running',
            current_version: remoteVersion,
            app_url: url,
            can_manage: true,
            config_fingerprint: remoteFp,
            build_log: `[Artifact] app.tar:${hashesV1['app.tar']}\n[Artifact] skill.zip:${hashesV1['skill.zip']}\n`,
          }
        }
        return {}
      }

      // A. list() detects failed auto-rolled-back v2 build and sorts newest first
      const listed = await delivery.list(expected)
      assert.deepEqual(listed.map(j => j.id), [v3Id, v2Id, v1Id])
      assert.equal(listed[1].status, 'failed')
      assert.equal(listed[1].error, 'v2 auto-rolled back')

      // B. AppSkillProvider.get() returns undefined cleanly if remote version doesn't match locator
      const provider = new AppSkillProvider(delivery, { invalidate() {}, signal: new AbortController().signal })
      const skillRes = await provider.get(
        { name: 'app-up-app', description: '', source: 'opc-apps', provider: 'opc-apps', rank: 350,
          invocation: { modelInvocable: true, userInvocable: true }, locator: { id: v3Id, context: expected, version: 3 } },
        { signal: new AbortController().signal } as any,
      )
      assert.equal(skillRes, undefined)

      // C. Remove v3, updateConfig updates publish-config-reqv1 credentials and verify succeeds with new secret
      await rm(join(scopeDir, v3Id), { recursive: true, force: true })
      await delivery.updateConfig('up-app', {
        container_port: 8080,
        app_config: [{ key: 'APP_SECRET', value: 'new-secret' }],
        resource_ids: [],
      }, expected)
      const verifiedV1 = await delivery.verify(v1Id, expected)
      assert.equal(verifiedV1.status, 'verified')

      // D. create({ previousJobId }) inherits upgrade: true when previous had published/upgrade without calling /check-slug
      const srcFolder = join(home, 'dummy-src')
      await mkdir(srcFolder, { recursive: true })
      await writeFile(join(srcFolder, 'main.py'), 'print("ok")')
      const cloned = await delivery.create(
        { name: 'Up App', slug: 'up-app', previousJobId: v2Id, source: srcFolder },
        's1',
        expected,
      )
      assert.equal(checkSlugCalled, false)
      assert.equal(cloned.upgrade, true)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('default volume resolution, preserved upgrade secret has_value, stale-hash draft recovery, and python volume grouping', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'opc-defvol-'))
  try {
    // 1. Python runtime: local-directory and aliyun-oss-volume share a single application-volume default group,
    // and _ADDITIVE_SQLITE_SYNC_PY tolerates expression defaults on single columns without losing other changes.
    const runtimeDir = fileURLToPath(new URL('../runtime', import.meta.url))
    const pyCheck = `
import json, sqlite3, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(runtimeDir)})
import app_delivery_migration as m

filtered = m.select_and_filter_platform_resources([
    {"id": "oss-1", "type": "aliyun-oss-volume", "is_default": False},
    {"id": "disk-default", "type": "local-directory", "is_default": True},
], "my-app", default_only=True)
assert [r["id"] for r in filtered] == ["disk-default"], f"unexpected volume default grouping: {filtered}"

tmp = Path(${JSON.stringify(workDir)})
seed_dir, dst_dir = tmp / "seed", tmp / "dst"
seed_dir.mkdir(); dst_dir.mkdir()
with sqlite3.connect(dst_dir / "app.db") as dc:
    dc.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
    dc.execute("INSERT INTO items VALUES (1, 'prod')")
with sqlite3.connect(seed_dir / "app.db") as sc:
    sc.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, ts TEXT NOT NULL DEFAULT (datetime('now')), note TEXT DEFAULT 'v2')")
    sc.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT)")
    sc.execute("INSERT INTO logs VALUES (1, 'ok')")
ns = {}
exec(m._ADDITIVE_SQLITE_SYNC_PY, {"__builtins__": __builtins__})
`
    const pyCheck2 = pyCheck.replace(
      'exec(m._ADDITIVE_SQLITE_SYNC_PY, {"__builtins__": __builtins__})',
      'sys.argv = ["sync", str(seed_dir), str(dst_dir)]\nexec(m._ADDITIVE_SQLITE_SYNC_PY, {"__builtins__": __builtins__})\nwith sqlite3.connect(dst_dir / "app.db") as vc:\n  rows = vc.execute("SELECT id, name, ts, note FROM items").fetchall()\n  logs = vc.execute("SELECT msg FROM logs").fetchall()\n  print(json.dumps({"rows": rows, "logs": logs}))',
    )
    const { stdout } = await promisify(execFile)('python3', ['-c', pyCheck2])
    const pyResult = JSON.parse(stdout)
    assert.deepEqual(pyResult.rows, [[1, 'prod', '', 'v2']])
    assert.deepEqual(pyResult.logs, [['ok']])

    // 2. Host: upgrade auto-binds is_default volume when storageBindings omitted, accepts required has_value secret,
    // reopenDeployment preserves upgrade: true, and configDraft survives revision hash updates.
    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const expected = contexts.applicationContextId!
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const storeMap = new Map<string, Record<string, string>>()
    const delivery = new AppDelivery(core, workDir, {
      async read(id: string) { return { ...(storeMap.get(id) ?? {}) } },
      async write(id: string, values: Record<string, string>) { storeMap.set(id, { ...values }) },
    })

    const jobId = '44444444-4444-4444-8444-444444444444'
    const scopeDir = join(workDir, 'opc', 'apps', identityHash(contexts.captureApplication(expected).context))
    const jobRoot = join(scopeDir, jobId)
    const rev = 'rev1'
    await mkdir(join(jobRoot, rev, 'bundle'), { recursive: true })
    const tarBytes = Buffer.from('tar-bytes')
    const zipBytes = Buffer.from('zip-bytes')
    await writeFile(join(jobRoot, rev, 'bundle', 'app.tar'), tarBytes)
    await writeFile(join(jobRoot, rev, 'bundle', 'skill.zip'), zipBytes)
    const hashes = {
      'app.tar': createHash('sha256').update(tarBytes).digest('hex'),
      'skill.zip': createHash('sha256').update(zipBytes).digest('hex'),
    }
    const baseProp = proposal('http://def-app.example.test')
    baseProp.contract.slug = 'def-app'
    baseProp.contract.storage_mounts = [
      { name: 'data', container_path: '/app/data', kind: 'sqlite', purpose: 'db' },
    ]
    baseProp.contract.configs = [{ key: 'API_SECRET', secret: true, required: true }]

    await writeFile(join(jobRoot, 'job.json'), JSON.stringify({
      id: jobId, name: 'Def App', slug: 'def-app', url: 'http://def-app.example.test',
      session: 's1', status: 'ready', upgrade: true, revision: rev, port: 8080,
      events: [], proposal: baseProp, hashes,
      dockerfileContent: 'FROM python:3.11-alpine\n',
      configDraft: { artifactHash: 'older-hash-after-repair', rows: [{ key: 'API_SECRET' }], versionNote: 'keep-note', storageBindings: { '/app/data': 'vol-default' } },
    }))
    await storeMap.set(`draft-${jobId}`, { API_SECRET: 'draft-secret' })

    let publishedMounts: any[] = []
    let publishedConfigs: any[] = []
    delivery.platform = async (path, _ctx, opts) => {
      if (path === '/def-app') return { app_url: 'http://def-app.example.test', can_manage: true, storage_mounts: [] }
      if (path === '/resources') {
        return {
          resources: [
            { id: 'oss-nondefault', type: 'aliyun-oss-volume', is_default: true },
            { id: 'vol-other', type: 'local-directory', is_default: false },
            { id: 'vol-default', type: 'local-directory', is_default: true },
          ],
        }
      }
      if (path === '/publish' && opts?.form) {
        publishedMounts = JSON.parse(String(opts.form.get('storage_mounts')))
        publishedConfigs = JSON.parse(String(opts.form.get('app_config')))
        return { app_url: 'http://def-app.example.test', version: 2, status: 'building' }
      }
      return {}
    }

    const draft = await delivery.configDraft(jobId, expected)
    assert.equal(draft?.versionNote, 'keep-note')
    assert.equal(draft?.rows[0]?.value, 'draft-secret')

    const artifactHash = fingerprint(hashes)
    const confirmInput = {
      artifactHash,
      storageBindings: {},
      config: [{ key: 'API_SECRET', value: '', has_value: true }],
    }
    const { confirmationToken } = await delivery.confirmDeployment(jobId, confirmInput, expected)
    await delivery.publish(jobId, { ...confirmInput, confirmationToken }, expected)
    assert.equal(publishedMounts[0]?.resource_id, 'vol-default')
    assert.equal(publishedConfigs.find(c => c.key === 'API_SECRET')?.has_value, true)

    // Fail the deployment, reopenDeployment -> upgrade must remain true
    const afterFail = JSON.parse(await readFile(join(jobRoot, 'job.json'), 'utf8'))
    afterFail.status = 'failed'
    afterFail.published = true
    afterFail.upgrade = false
    await writeFile(join(jobRoot, 'job.json'), JSON.stringify(afterFail))
    const reopened = await delivery.reopenDeployment(jobId, expected)
    assert.equal(reopened.upgrade, true)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

test('attachAppAgent creates fresh live session instead of resuming disposed session and auth errors pinpoint target and unresolved question', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'opc-agent-auth-'))
  try {
    // 1. Python auth validation diagnostics and trimmed auth_blockers match
    const { stdout: authResult } = await promisify(execFile)('python3', [
      '-c',
      [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime'))})`,
        'from app_delivery_auth import resolve_authentication, validate_auth_questions',
        'out = {}',
        'try:',
        '  validate_auth_questions({"unresolved": ["是否启用 REIMBURSE_ADMIN_TOKEN 应急令牌？"], "contract": {"unresolved": [], "auth_blockers": []}})',
        'except ValueError as e:',
        '  out["missing_blocker"] = str(e)',
        'validate_auth_questions({"unresolved": [" 是否启用 REIMBURSE_ADMIN_TOKEN 应急令牌？ "], "contract": {"unresolved": [], "auth_blockers": [{"question": "是否启用 REIMBURSE_ADMIN_TOKEN 应急令牌？", "evidence": ["server/app/admin_auth.py:12"], "affected": ["/api/admin/*"], "action": "配置令牌或创建脚本", "reason": "external_authorization"}]}})',
        'out["trimmed_ok"] = True',
        'try:',
        '  resolve_authentication({"apis": [{"method": "GET", "path": "/", "evidence": ["main.py:72"], "auth": {"type": "unknown"}}], "pages": [], "auth_rules": [{"target": "page", "path": "/", "auth": {"type": "none"}, "evidence": ["main.py:72"]}]})',
        'except ValueError as e:',
        '  out["unmatched_root_api"] = str(e)',
        'print(json.dumps(out, ensure_ascii=False))',
      ].join('\n'),
    ])
    const parsed = JSON.parse(authResult)
    assert.equal(parsed.trimmed_ok, true)
    assert.match(parsed.missing_blocker, /unresolved 条目「是否启用 REIMBURSE_ADMIN_TOKEN 应急令牌？」/)
    assert.match(parsed.unmatched_root_api, /apis 项，需匹配 target='api'.*target='api' 且 path='\/'/)

    // 2. attachAppAgent never calls agents.resume on a disposed sessionId and injects pending questions on waitingForReply
    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const delivery = new AppDelivery(core, workDir, { read: async () => ({}), write: async () => {} })
    delivery.platform = async () => ({ resources: [{
      id: 'redis-main', name: '平台 Redis', type: 'redis', is_default: true,
      env_keys: ['REDIS_URL'], env_preview: { REDIS_URL: 'fixture-preview' },
    }] })

    const createdSessions: string[] = []
    const injectedNotices: string[] = []
    let deliveryInstructions = ''
    let deliveryContext: AppDocument | undefined
    let resumeCalled = false
    const fakeCtx = {
      agents: {
        get: () => undefined,
        resume: async () => {
          resumeCalled = true
          throw new Error('must not resume disposed session')
        },
        create: async ({ sessionId, setup }: { sessionId: string; setup: (agent: unknown) => void }) => {
          createdSessions.push(sessionId)
          const agent = {
            session: { id: sessionId },
            tools: { restrict: () => {}, register: () => {} },
            systemPrompt: { section: ({ text }: { text: string }) => { deliveryInstructions = text } },
            on: () => {},
            cancel: () => {},
            inject: (msg: { source?: { summary?: string }; content: { text: string }[] }) => {
              const summary = msg.source?.summary
              if (summary) injectedNotices.push(summary)
              if (summary === 'OPC 应用改造任务已载入') deliveryContext = JSON.parse(msg.content[0].text)
            },
            followup: () => {},
            whenIdle: async () => {},
          }
          setup(agent)
          return { agent, dispose: async () => {} }
        },
      },
      on: () => () => {},
      effect: () => {},
    }
    attachAppAgent(fakeCtx as any, delivery)

    const ac = new AbortController()
    const fakeJob: any = {
      id: 'job-1',
      name: '报销系统',
      slug: 'baoxiao',
      url: 'http://baoxiao.apps.example.test',
      port: 8080,
      status: 'review',
      analysisSessions: ['disposed-session-1'],
      proposal: { unresolved: ['管理员账号如何创建？'], contract: { unresolved: [] } },
      events: [],
    }
    await assert.rejects(
      () => delivery.analyze!(fakeJob, workDir, '', ac.signal, async () => {
        setTimeout(() => ac.abort(), 10)
      }),
      /AbortError|aborted/i,
    )

    assert.equal(resumeCalled, false)
    assert.equal(createdSessions.length, 1)
    assert.notEqual(createdSessions[0], 'disposed-session-1')
    assert.ok(injectedNotices.some(s => s.includes('等待确认的问题：管理员账号如何创建？')))
    assert.match(deliveryInstructions, /## 1\. 读懂应用[\s\S]*## 2\. 决定并实施改造[\s\S]*## 3\. 生成应用技能/)
    assert.match(deliveryInstructions, /运维.*迁移/)
    assert.doesNotMatch(deliveryInstructions, /python3 scripts\/delivery\.py smoke/)
    assert.deepEqual(deliveryContext?.available_resource_metadata, [{
      id: 'redis-main', name: '平台 Redis', type: 'redis', is_default: true, env_keys: ['REDIS_URL'],
    }])
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

test('source configuration inventory reads imported files and masks credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-source-config-'))
  try {
    const source = join(root, 'review', 'source')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, '.env'), 'APP_MODE=demo\nAPP_PASSWORD=private-value\n')
    await writeFile(join(source, 'settings.json'), '{"ui":{"title":"Demo"}}')
    await writeFile(join(source, 'main.js'), 'console.log(process.env.APP_MODE, process.env.APP_REGION)')
    const result = await worker({ action: 'source_configuration', root })
    assert.deepEqual(result.files.map((file: AppDocument) => file.path), ['.env', 'settings.json'])
    assert.deepEqual(result.files[0].fields, [
      { key: 'APP_MODE', value: 'demo' },
      { key: 'APP_PASSWORD', value: '[REDACTED]' },
    ])
    assert.deepEqual(result.files[1].fields, [{ key: 'ui.title', value: 'Demo' }])
    assert.deepEqual(result.references, ['APP_MODE', 'APP_REGION'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source configuration excludes verified historical AI additions in an uploaded upgrade', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'opc-source-history-'))
  try {
    const previous = join(workspace, '11111111-1111-4111-8111-111111111111')
    const current = join(workspace, '22222222-2222-4222-8222-222222222222')
    const original = join(previous, 'review', 'source')
    const imported = join(current, 'review', 'source')
    await mkdir(original, { recursive: true })
    await mkdir(imported, { recursive: true })
    const originalApp = 'console.log(process.env.OPC_REGION)\n'
    const generatedEntrypoint = 'console.log(process.env.OPC_SERVICE_SLUG, process.env.OPC_ADMIN_PASSWORD)\n'
    const generatedConfig = 'APP_MODE=demo\nOPC_ADMIN_PASSWORD=generated\n'
    await writeFile(join(original, 'main.js'), originalApp)
    await writeFile(join(original, '.env'), 'APP_MODE=demo\n')
    await writeFile(join(imported, 'main.js'), originalApp)
    await writeFile(join(imported, '.env'), generatedConfig)
    await writeFile(join(imported, 'health.mjs'), generatedEntrypoint)
    await writeFile(join(imported, 'settings.json'), '{"local":true}')
    const changes = [
      { path: 'health.mjs', content: generatedEntrypoint },
      { path: '.env', content: generatedConfig },
    ]
    await writeFile(join(previous, 'job.json'), JSON.stringify({
      slug: 'test-app', createdAt: 1, revision: 'prepared',
      proposal: { changes, contract: { configs: [{ key: 'OPC_ADMIN_PASSWORD' }] } },
    }))
    await writeFile(join(current, 'job.json'), JSON.stringify({
      slug: 'test-app', createdAt: 2,
      proposal: { contract: { configs: [{ key: 'AI_ONLY', default: 'invented' }] } },
    }))

    const result = await worker({ action: 'source_configuration', root: current })
    assert.deepEqual(result, {
      files: [
        { path: '.env', fields: [{ key: 'APP_MODE', value: 'demo' }] },
        { path: 'settings.json', fields: [{ key: 'local', value: 'true' }] },
      ],
      references: ['OPC_REGION'],
    })

    // A matching filename with user-edited content is not sufficient evidence of AI provenance.
    await writeFile(join(imported, 'health.mjs'), 'console.log(process.env.OPC_SERVICE_SLUG)\n')
    const edited = await worker({ action: 'source_configuration', root: current })
    assert.deepEqual(edited.references, ['OPC_REGION', 'OPC_SERVICE_SLUG'])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('delivery rejects invented files, environment settings and config defaults before packaging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-delivery-scope-'))
  try {
    const source = join(root, 'review/source')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, '.env'), 'OPC_REGION=source\n')
    await writeFile(join(source, 'main.py'), 'import os\nregion = os.getenv("OPC_REGION")\n')
    const validate = (plan: AppDocument) => worker({ action: 'validate', root, allow_unresolved: true, proposal: plan })
    const makePlan = () => proposal('http://127.0.0.1:8080') as AppDocument
    const wrapper = { path: 'scripts/bootstrap-admin.mjs', content: 'console.log("extra")\n', reason: '初始化' }
    await assert.rejects(worker({ action: 'propose_file', root, ...wrapper }), /新增文件/)
    const withWrapper = makePlan()
    withWrapper.changes.push(wrapper)
    await assert.rejects(validate(withWrapper), /新增文件/)
    const withEnv = makePlan()
    withEnv.changes[0].content += 'ENV OPC_SERVICE_SLUG=test-app\n'
    await assert.rejects(validate(withEnv), /环境变量/)
    const withHealth = makePlan()
    withHealth.changes.push({
      path: 'main.py', reason: '额外部署探针',
      content: 'import os\nregion = os.getenv("OPC_REGION")\n@app.get("/healthz")\ndef health(): return "ready"\n',
    })
    await assert.rejects(validate(withHealth), /不能新增健康检查接口/)
    const withSourceEnv = makePlan()
    withSourceEnv.changes.push({
      path: 'main.py', reason: '增加健康探针',
      content: 'import os\nregion = os.getenv("OPC_REGION")\nslug = os.getenv("OPC_SERVICE_SLUG", "test-app")\n',
    })
    await assert.rejects(validate(withSourceEnv), /环境变量/)
    const withConfigFile = makePlan()
    withConfigFile.changes.push({ path: '.env', content: 'OPC_REGION=changed\n', reason: '绑定资源' })
    await assert.rejects(validate(withConfigFile), /原应用配置/)
    const withConfig = makePlan()
    withConfig.contract.configs = [{ key: 'OPC_SERVICE_SLUG', default: '', required: false, secret: false }]
    await assert.rejects(validate(withConfig), /原应用.*OPC_SERVICE_SLUG/)
    withConfig.contract.configs = [{ key: 'OPC_REGION', default: 'invented', required: true, secret: false,
      source: { path: '.env', keys: ['OPC_REGION'] } }]
    await assert.rejects(validate(withConfig), /默认值/)
    withConfig.contract.configs[0].default = ''
    assert.equal((await validate(withConfig)).valid, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
