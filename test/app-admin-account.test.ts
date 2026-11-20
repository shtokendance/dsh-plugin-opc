import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'
import { AppDelivery, readAdminReply, worker, type AppDocument } from '../src/host/app-delivery.ts'
import { ContextStore } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

const run = promisify(execFile)
const username = 'test-admin'
const password = 'fixture-admin-password'

function makeProposal(url: string, account: AppDocument, filenames: string[]) {
  return {
    summary: '适配测试应用', unresolved: [],
    changes: [{ path: 'Dockerfile', reason: '准备运行镜像', content: 'FROM python:3.11-alpine\nWORKDIR /app\nCOPY . .\nCMD ["python", "main.py"]\n' }],
    contract: {
      schema_version: 1, slug: 'test-admin-app', name: '登录样例', description: '测试用', base_url: url,
      runtime: { language: 'python', version: '3.11', port: 8080 }, build_context: ['Dockerfile', 'main.py', ...filenames],
      health: { path: '/healthz', status: 200, json_contains: { service: 'test-admin-app' } },
      auth_profiles: { admin: { login_url: '/login', login_method: 'POST application/json', username_env: 'APP_ADMIN_USER', password_env: 'APP_ADMIN_PASSWORD' } },
      admin_account: { profile: 'admin', evidence: ['main.py:1'], ...account }, configs: [], resources: [], pages: [],
      apis: [{ id: 'lookup', method: 'GET', path: '/lookup', purpose: '查记录', evidence: ['main.py:1'], parameters: [], request_body: null,
        responses: { '200': { description: 'ok' } }, auth: { type: 'header', profile: 'admin', header: 'X-Admin-Token' }, effect: 'read' }],
      verification: { cases: [{ operation: 'lookup', json_contains: { ok: true } }] },
    },
  }
}

test('chat credentials populate the delivery SQLite and power the generated Markdown skill', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-admin-md-'))
  const source = join(home, 'source'), extracted = join(home, 'extracted')
  const contexts = new ContextStore()
  contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
  const expected = contexts.applicationContextId!
  const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
  const store = new Map<string, Record<string, string>>()
  const delivery = new AppDelivery(core, home, {
    async read(id) { return store.get(id) ?? {} },
    async write(id, values) { store.set(id, values) },
  })
  let logins = 0
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/healthz') { res.end('{"service":"test-admin-app"}'); return }
    if (req.url === '/login' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const { stdout } = await run('python3', ['-c', 'import json, sqlite3; print(json.dumps(sqlite3.connect("data/app.db").execute("select username, salt, digest from admins").fetchone()))'], { cwd: extracted })
      const [user, salt, digest] = JSON.parse(stdout)
      const { scryptSync } = await import('node:crypto')
      if (body.email !== user || scryptSync(body.secret, Buffer.from(salt, 'hex'), 32).toString('hex') !== digest) { res.writeHead(401).end('{}'); return }
      logins++
      res.end('{"token":"fixture-session"}'); return
    }
    if (req.headers['x-admin-token'] !== 'fixture-session') { res.writeHead(401).end('{}'); return }
    res.end('{"ok":true}')
  })
  try {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await mkdir(join(source, 'data'), { recursive: true }); await mkdir(extracted)
    await writeFile(join(source, 'main.py'), 'print("fixture")\n')
    await run('python3', ['-c', 'import sqlite3; sqlite3.connect("data/app.db").execute("create table admins(username text primary key, salt text, digest text)")'], { cwd: source })
    const original = await readFile(join(source, 'data/app.db'))
    const plan = makeProposal(url, { mode: 'create', storage: { kind: 'sqlite', path: 'data/app.db', table: 'admins',
      row: { username: '$username', salt: '$salt', digest: '$hash' }, password: { kind: 'scrypt', n: 16384, r: 8, p: 1, dklen: 32, salt_bytes: 16 } } }, ['data'])
    Object.assign(plan.contract.auth_profiles.admin, {
      login_body_template: { email: '${username}', secret: '${password}' },
    })
    let ready: AppDocument
    delivery.platform = async path => {
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/publish') return { app_url: url, version: 1, status: 'building' }
      return { app_url: url, current_version: 1, status: 'running', config_fingerprint: 'fixture',
        build_log: Object.entries(ready.hashes).map(([key, value]) => `[Artifact] ${key}:${value}\n`).join('') }
    }
    const task = await delivery.create({ name: '登录样例', slug: 'test-admin-app', source }, 'origin', expected)
    const reply = Promise.withResolvers<void>()
    delivery.analyze = async (job, root, _, signal, session) => {
      await session('aadc3eaa-feeb-4e52-993d-8c172a95d019')
      await delivery.submit(job, root, plan, signal)
      await reply.promise
      const feedback = await delivery.recordAnalysisReply(job, root, `账号：${username}\n密码：${password}`, signal)
      assert.equal(feedback, '')
      assert.equal(job.proposal?.adminAccountPending, false)
    }
    const waitFor = async (done: (job: AppDocument) => boolean) => {
      for (let index = 0; index < 260; index++) {
        const job = await delivery.getJob(task.id, expected)
        if (job.status === 'failed' || done(job)) return job
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('分析等待超时')
    }
    await delivery.startAnalysis(task.id, '', expected)
    try {
      const waiting = await waitFor(job => job.status === 'review')
      assert.match(waiting.proposal?.unresolved?.join('\n') ?? '', /账号.*密码/)
    } finally { reply.resolve() }
    ready = await waitFor(job => job.status === 'ready' && !job.analysisChatActive)
    assert.equal(ready.status, 'ready', ready.error)
    assert.deepEqual(await readFile(join(source, 'data/app.db')), original)
    await run('tar', ['-xf', ready.artifacts['app.tar'], '-C', extracted])
    const members = unzipSync(await readFile(ready.artifacts['skill.zip']))
    assert.match(Buffer.from(members['SKILL.md']).toString(), new RegExp(password))
    assert.ok(!Buffer.from(members['references/operations.json']).includes(password))
    const payload = { artifactHash: ready.artifactHash, config: [] }
    const { confirmationToken } = await delivery.confirmDeployment(ready.id, payload, expected)
    await delivery.publish(ready.id, { ...payload, confirmationToken }, expected)
    const verified = await delivery.verify(ready.id, expected)
    assert.equal(verified.status, 'verified', verified.error)
    assert.equal((await delivery.invoke(ready.id, 'lookup', {}, undefined, expected, async () => false)).status, 200)
    const installedSkill = join(home, 'installed-skill')
    for (const [name, bytes] of Object.entries(members)) {
      const target = join(installedSkill, name)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, bytes)
    }
    const result = await run('python3', [join(installedSkill, 'scripts/invoke_api.py'), '--operation', 'lookup'])
    assert.equal(JSON.parse(result.stdout).ok, true)
    assert.equal(logins, 3)
    assert.equal(createHash('sha256').update(await readFile(ready.artifacts['skill.zip'])).digest('hex'), ready.hashes['skill.zip'])
  } finally {
    server.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('existing account is reused without a reply and a new account can be written to JSON', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-admin-config-'))
  const url = 'http://127.0.0.1:8080'
  try {
    for (const mode of ['existing', 'create'] as const) {
      const source = join(home, `${mode}-source`), root = join(home, `${mode}-job`)
      await mkdir(source); await mkdir(root)
      await writeFile(join(source, 'main.py'), 'print("fixture")\n')
      const account = mode === 'existing' ? { username, password } : {}
      const content = JSON.stringify({ admin: account, other: true })
      await writeFile(join(source, 'account.json'), content)
      await worker({ action: 'prepare', root, source, url, slug: 'test-admin-app' })
      const plan = makeProposal(url, mode === 'existing' ? { mode, source: {
        username: { path: 'account.json', keys: ['admin', 'username'] },
        password: { path: 'account.json', keys: ['admin', 'password'] },
      } } : { mode, storage: {
        kind: 'file', path: 'account.json', username_keys: ['admin', 'username'], password_keys: ['admin', 'password'],
      } }, ['account.json'])
      const rev = 'revision'
      const result = await worker({ action: 'bundle', root, revision: rev, proposal: plan,
        ...(mode === 'create' ? { admin_reply: { profile: 'admin', mode, username, password } } : {}) })
      assert.match(result.skill_markdown, new RegExp(password))
      const { stdout } = await run('tar', ['-xOf', join(root, rev, 'bundle/app.tar'), 'account.json'])
      assert.deepEqual(JSON.parse(stdout), { admin: { username, password }, other: true })
      assert.equal(await readFile(join(source, 'account.json'), 'utf8'), content)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('the prepared SQLite can start from the application schema and cannot overwrite a populated admin table', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-admin-db-'))
  const url = 'http://127.0.0.1:8080'
  const schema = 'CREATE TABLE admins (username TEXT PRIMARY KEY, password TEXT NOT NULL)'
  const storage = { kind: 'sqlite', path: 'data/app.db', table: 'admins', create_table: schema,
    row: { username: '$username', password: '$password' } }
  const creds = { profile: 'admin', mode: 'create', username, password }
  try {
    const source = join(home, 'source'), root = join(home, 'job')
    await mkdir(source); await mkdir(root)
    await writeFile(join(source, 'main.py'), 'DB_PATH = "data/app.db"\nSCHEMA = "' + schema + '"\n')
    await worker({ action: 'prepare', root, source, url, slug: 'test-admin-app' })
    const plan = makeProposal(url, { mode: 'create', storage, evidence: ['main.py:1-2'] }, ['data'])
    const fabricatedStorage = makeProposal(url, { mode: 'create', storage: { ...storage, path: 'data/fabricated.db' },
      evidence: ['main.py:1-2'] }, ['data'])
    await assert.rejects(worker({ action: 'bundle', root, revision: 'fabricated', proposal: fabricatedStorage, admin_reply: creds }), /数据库路径必须有原应用源码证据/)
    await worker({ action: 'bundle', root, revision: 'fresh', proposal: plan, admin_reply: creds })
    const prepared = join(root, 'fresh/approved/source/data/app.db')
    await mkdir(join(source, 'data'))
    await writeFile(join(source, 'data/app.db'), await readFile(prepared))
    const other = join(home, 'other')
    await mkdir(other)
    await worker({ action: 'prepare', root: other, source, url, slug: 'test-admin-app' })
    await assert.rejects(worker({ action: 'bundle', root: other, revision: 'blocked', proposal: plan, admin_reply: creds }), /已有管理员/)
    const reused = makeProposal(url, { mode: 'existing', source: {
      username: { path: 'data/app.db', table: 'admins', column: 'username' },
      password: { path: 'data/app.db', table: 'admins', column: 'password' },
    } }, ['data'])
    const result = await worker({ action: 'bundle', root: other, revision: 'reused', proposal: reused })
    assert.match(result.skill_markdown, new RegExp(password))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('readAdminReply parses two-line, single-line, and reversed credential messages', () => {
  const plan = { profile: 'admin', mode: 'existing' }
  assert.deepEqual(readAdminReply(plan, '账号：admin\n密码：pass with spaces'), {
    profile: 'admin', mode: 'existing', username: 'admin', password: 'pass with spaces',
  })
  assert.deepEqual(readAdminReply(plan, '账号：admin 密码：ChangeMe123!'), {
    profile: 'admin', mode: 'existing', username: 'admin', password: 'ChangeMe123!',
  })
  assert.deepEqual(readAdminReply(plan, '账号: admin，密码: ChangeMe123!'), {
    profile: 'admin', mode: 'existing', username: 'admin', password: 'ChangeMe123!',
  })
  assert.deepEqual(readAdminReply(plan, '密码：ChangeMe123!; 账号：admin\n请继续'), {
    profile: 'admin', mode: 'existing', username: 'admin', password: 'ChangeMe123!',
  })
  assert.equal(readAdminReply(plan, '请继续部署，没有密码'), undefined)
})

test('existing account source extracts literals from object properties, fallback defaults, and hash wrappers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-admin-source-'))
  const url = 'http://127.0.0.1:8080'
  try {
    const source = join(home, 'source'), root = join(home, 'job')
    await mkdir(source); await mkdir(root)
    await writeFile(join(source, 'main.py'), 'print("fixture")\n')
    await writeFile(join(source, 'server.mjs'), [
      'const SEED_ADMIN = {',
      "  username: 'admin',",
      "  passwordHash: hashPassword('ChangeMe123!'),",
      '};',
      "const ADMIN_PASS = process.env.ADMIN_PASS || 'FallbackPass#1';",
      'const DYNAMIC_PASS = loadSecret();',
      '',
    ].join('\n'))
    await worker({ action: 'prepare', root, source, url, slug: 'test-admin-app' })

    const propPlan = makeProposal(url, {
      mode: 'existing',
      source: {
        username: { path: 'server.mjs', line: 2, name: 'username' },
        password: { path: 'server.mjs', line: 3, name: 'passwordHash' },
      },
    }, ['server.mjs'])
    const propResult = await worker({ action: 'bundle', root, revision: 'prop', proposal: propPlan })
    assert.match(propResult.skill_markdown, /admin/)
    assert.match(propResult.skill_markdown, /ChangeMe123!/)

    const fallbackPlan = makeProposal(url, {
      mode: 'existing',
      source: {
        username: { path: 'server.mjs', line: 2, name: 'username' },
        password: { path: 'server.mjs', line: 5, name: 'ADMIN_PASS' },
      },
    }, ['server.mjs'])
    const fallbackResult = await worker({ action: 'bundle', root, revision: 'fallback', proposal: fallbackPlan })
    assert.match(fallbackResult.skill_markdown, /FallbackPass#1/)

    const dynamicPlan = makeProposal(url, {
      mode: 'existing',
      source: {
        username: { path: 'server.mjs', line: 2, name: 'username' },
        password: { path: 'server.mjs', line: 6, name: 'DYNAMIC_PASS' },
      },
    }, ['server.mjs'])
    await assert.rejects(
      worker({ action: 'bundle', root, revision: 'dynamic', proposal: dynamicPlan }),
      /原始账号引用必须指向一个明确的字符串常量/,
    )
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('a shared auth rule preserves the route login and only one protected read is needed to package', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-admin-shared-auth-'))
  const url = 'http://127.0.0.1:8080'
  try {
    const source = join(home, 'source'), root = join(home, 'job')
    await mkdir(source); await mkdir(root)
    await writeFile(join(source, 'main.py'), 'print("fixture")\n')
    await writeFile(join(source, 'account.json'), JSON.stringify({ username, password }))
    await worker({ action: 'prepare', root, source, url, slug: 'test-admin-app' })
    const plan = makeProposal(url, { mode: 'existing', source: {
      username: { path: 'account.json', keys: ['username'] },
      password: { path: 'account.json', keys: ['password'] },
    } }, ['account.json'])
    const lookup = plan.contract.apis[0]
    const adminLookup = { ...lookup, path: '/api/lookup', auth: { ...lookup.auth, roles: ['admin'] } }
    const auditorReport = { ...lookup, id: 'report', path: '/api/report', auth: { ...lookup.auth, roles: ['auditor'] } }
    plan.contract.apis = [
      adminLookup,
      auditorReport,
      { ...lookup, id: 'health', path: '/healthz', auth: { type: 'none', profile: '', header: '' } },
    ]
    Object.assign(plan.contract, { auth_rules: [{
      target: 'api', prefix: '/api/', evidence: ['main.py:1'],
      auth: { type: 'header', header: 'X-Admin-Token' },
    }] })
    const result = await worker({ action: 'bundle', root, revision: 'ready', proposal: plan })
    assert.deepEqual(result.proposal.contract.apis.slice(0, 2).map((api: AppDocument) => api.auth.profile), ['admin', 'admin'])
    assert.deepEqual(result.proposal.contract.apis[1].auth.roles, ['auditor'])
    assert.ok(result.summary.files['skill.zip'])

    plan.contract.verification.cases = [{ operation: 'health', json_contains: { ok: true } }]
    await assert.rejects(worker({ action: 'validate', root, proposal: plan }), /verification\.cases.*lookup.*GET \/api\/lookup/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
