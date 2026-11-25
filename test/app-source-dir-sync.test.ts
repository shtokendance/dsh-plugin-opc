import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { AppDelivery, worker, type AppDocument } from '../src/host/app-delivery.ts'
import { ContextStore, identityHash } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

function createTestDelivery(home: string, appUrl: string) {
  const contexts = new ContextStore()
  contexts.replace({
    issuer: 'https://example.test',
    subject: 'user-1',
    tenant: 'tenant-1',
    spaces: ['space-1'],
    generation: 1,
  })
  const expected = contexts.applicationContextId!
  const emitter = new EventEmitter()
  const core = Object.assign(emitter, {
    auth: {
      contexts,
      http: {
        base: new URL('http://platform.opc.test'),
        async fetch() {
          throw new Error('unexpected http.fetch')
        },
      },
    },
  }) as unknown as OpcCore
  const creds = new Map<string, Record<string, string>>()
  const delivery = new AppDelivery(core, home, {
    async read(id) { return { ...(creds.get(id) ?? {}) } },
    async write(id, values) { creds.set(id, { ...values }) },
  })
  ;(delivery as any).platform = async (path: string) => {
    if (path.includes('check-slug')) return { available: true, app_url: appUrl }
    return {}
  }
  return { delivery, expected, scopeDir: join(home, 'opc', 'apps', identityHash(contexts.captureApplication(expected).context)) }
}

function makeProposal(url: string, serverContent: string, dockerfileContent: string): AppDocument {
  return {
    summary: '适配容器监听地址并补齐 Dockerfile',
    changes: [
      { id: 'server', path: 'server.js', reason: '监听 0.0.0.0', content: serverContent },
      { id: 'docker', path: 'Dockerfile', reason: '新增容器构建文件', content: dockerfileContent },
    ],
    unresolved: [],
    contract: {
      schema_version: 1,
      slug: 'sync-app',
      name: '同步测试应用',
      description: '测试本地源码无感同步与隔离快照打包',
      base_url: url,
      runtime: { language: 'node', version: '20', port: 8080 },
      build_context: ['Dockerfile', 'server.js'],
      health: { path: '/healthz', status: 200, json_contains: { ok: true } },
      configs: [],
      resources: [],
      storage_mounts: [],
      pages: [],
      apis: [
        {
          id: 'ping',
          method: 'GET',
          path: '/api/ping',
          purpose: '探测服务',
          evidence: ['server.js:1'],
          parameters: [],
          request_body: null,
          responses: { '200': { description: 'ok' } },
          auth: { type: 'none' },
          effect: 'read',
          confirmation_required: false,
        },
      ],
      verification: { cases: [{ operation: 'ping', json_contains: { ok: true } }] },
      unresolved: [],
    },
  }
}

test('rejects ZIP upload and ZIP file path in AppDelivery.create', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-no-zip-'))
  try {
    const appUrl = 'http://sync-app.apps.opc.test'
    const { delivery, expected } = createTestDelivery(home, appUrl)
    const createdZip = await delivery.create({ name: 'ZIP 应用', slug: 'sync-app', zip: Buffer.from('PK').toString('base64') }, 's1', expected)
    assert.equal(createdZip.status, 'failed')
    assert.match(String(createdZip.error), /不再支持 ZIP/)

    const fakeZipPath = join(home, 'demo.zip')
    await writeFile(fakeZipPath, 'PK')
    const createdZipPath = await delivery.create({ name: 'ZIP 路径', slug: 'sync-app', source: fakeZipPath }, 's1', expected)
    assert.equal(createdZipPath.status, 'failed')
    assert.match(String(createdZipPath.error), /不再支持 ZIP/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('live directory: zero-copy scan, clean Step 2 preview, Step 3 atomic sync + immutable snapshot + undo', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-live-sync-'))
  try {
    const userSource = join(home, 'my-app')
    await mkdir(join(userSource, '.git'), { recursive: true })
    await mkdir(join(userSource, 'node_modules', 'dep'), { recursive: true })
    const originalServer = 'const host = "127.0.0.1"; console.log(host);\n'
    const adaptedServer = 'const host = "0.0.0.0"; console.log(host);\n'
    const dockerfile = 'FROM node:20-alpine\nCOPY server.js /app/server.js\nCMD ["node", "/app/server.js"]\n'
    await writeFile(join(userSource, 'server.js'), originalServer, 'utf8')
    await writeFile(join(userSource, '.git', 'config'), '[core]\n', 'utf8')
    await writeFile(join(userSource, 'node_modules', 'dep', 'index.js'), 'module.exports = 1\n', 'utf8')

    const appUrl = 'http://sync-app.apps.opc.test'
    const { delivery, expected, scopeDir } = createTestDelivery(home, appUrl)

    // Step 1: create links directly to user's source directory without copying review/source
    const created = await delivery.create({ name: '同步测试应用', slug: 'sync-app', source: userSource }, 's1', expected)
    assert.equal(created.status, 'draft')
    assert.equal(created.sourcePath, resolve(userSource))
    const jobRoot = join(scopeDir, created.id)
    assert.equal(existsSync(join(jobRoot, 'review', 'source')), false)

    // Worker reads directly from userSource and skips .git / node_modules
    const inv = await worker({ root: jobRoot, action: 'inventory' })
    assert.deepEqual(inv.files.map((f: any) => f.path), ['server.js'])
    const readRes = await worker({ root: jobRoot, action: 'read', path: 'server.js' })
    assert.match(readRes.text, /127\.0\.0\.1/)

    // Step 2: submit proposal validates without touching userSource
    let resolveAnalyze!: (err?: unknown) => void
    const analyzeFinished = new Promise<void>((resolveOk, rejectErr) => {
      resolveAnalyze = err => (err ? rejectErr(err) : resolveOk())
    })
    delivery.analyze = async (job, root, _feedback, signal) => {
      try {
        await delivery.submit(job, root, makeProposal(appUrl, adaptedServer, dockerfile), signal)
        resolveAnalyze()
      } catch (err) {
        resolveAnalyze(err)
        throw err
      }
    }
    await delivery.startAnalysis(created.id, '', expected, 's1')
    await analyzeFinished
    await new Promise(r => setTimeout(r, 20))
    const reviewed = await delivery.getJob(created.id, expected)
    assert.equal(reviewed.status, 'review')
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), originalServer)
    assert.equal(existsSync(join(userSource, 'Dockerfile')), false)

    // Step 3: prepare syncs changes atomically to userSource AND snapshots to revision/approved/source
    const ready = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready')
    assert.ok(ready.sourceSync)
    assert.deepEqual(ready.sourceSync.files, ['server.js', 'Dockerfile'])
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), adaptedServer)
    assert.equal(await readFile(join(userSource, 'Dockerfile'), 'utf8'), dockerfile)

    // Platform metadata must never pollute userSource
    for (const meta of ['captain-definition', 'app-contract.json', 'review.json', 'analysis.md', 'delivery.json']) {
      assert.equal(existsSync(join(userSource, meta)), false, `unexpected platform file in userSource: ${meta}`)
    }

    // Snapshot in DSH revision/approved/source is immutable and excludes .git / node_modules
    const snapSource = join(jobRoot, ready.revision, 'approved', 'source')
    assert.equal(await readFile(join(snapSource, 'server.js'), 'utf8'), adaptedServer)
    assert.equal(await readFile(join(snapSource, 'Dockerfile'), 'utf8'), dockerfile)
    assert.equal(existsSync(join(snapSource, '.git')), false)
    assert.equal(existsSync(join(snapSource, 'node_modules')), false)

    // Undo restores original server.js and deletes newly created Dockerfile
    const undone = await delivery.undoSourceSync(created.id, expected)
    assert.equal(undone.sourceSync.undone, true)
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), originalServer)
    assert.equal(existsSync(join(userSource, 'Dockerfile')), false)
    // Immutable snapshot in DSH remains intact even after undo
    assert.equal(await readFile(join(snapSource, 'server.js'), 'utf8'), adaptedServer)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('live directory: detects external IDE edits before sync and allows explicit forceOverwrite', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-live-conflict-'))
  try {
    const userSource = join(home, 'my-app')
    await mkdir(userSource, { recursive: true })
    const originalServer = 'const host = "127.0.0.1";\n'
    const userEditedServer = 'const host = "127.0.0.1"; // edited in IDE\n'
    const adaptedServer = 'const host = "0.0.0.0";\n'
    const dockerfile = 'FROM node:20-alpine\nCOPY server.js /app/server.js\nCMD ["node", "/app/server.js"]\n'
    await writeFile(join(userSource, 'server.js'), originalServer, 'utf8')

    const appUrl = 'http://sync-app.apps.opc.test'
    const { delivery, expected } = createTestDelivery(home, appUrl)
    const created = await delivery.create({ name: '冲突测试', slug: 'sync-app', source: userSource }, 's1', expected)
    let resolveAnalyze!: (err?: unknown) => void
    const analyzeFinished = new Promise<void>((resolveOk, rejectErr) => {
      resolveAnalyze = err => (err ? rejectErr(err) : resolveOk())
    })
    delivery.analyze = async (job, root, _feedback, signal) => {
      try {
        await delivery.submit(job, root, makeProposal(appUrl, adaptedServer, dockerfile), signal)
        resolveAnalyze()
      } catch (err) {
        resolveAnalyze(err)
        throw err
      }
    }
    await delivery.startAnalysis(created.id, '', expected, 's1')
    await analyzeFinished
    await new Promise(r => setTimeout(r, 20))
    const reviewed = await delivery.getJob(created.id, expected)
    assert.equal(reviewed.status, 'review')

    // User edits server.js in IDE before confirming Step 3
    await writeFile(join(userSource, 'server.js'), userEditedServer, 'utf8')

    // Default prepare blocks overwrite and reports sourceSyncConflicts
    const blocked = await delivery.prepare(created.id, reviewed.proposalHash, expected)
    assert.equal(blocked.status, 'failed')
    assert.equal(blocked.failureStage, 'preparation')
    assert.deepEqual(blocked.sourceSyncConflicts, ['server.js'])
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), userEditedServer)
    assert.equal(existsSync(join(userSource, 'Dockerfile')), false)

    // Explicit forceOverwrite proceeds, writes adapted files, and backs up userEditedServer
    const forced = await delivery.prepare(created.id, reviewed.proposalHash, expected, { forceOverwrite: true })
    assert.equal(forced.status, 'ready')
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), adaptedServer)
    assert.equal(await readFile(join(userSource, 'Dockerfile'), 'utf8'), dockerfile)

    // Undoing restores userEditedServer (what was on disk right before forced sync)
    await delivery.undoSourceSync(created.id, expected)
    assert.equal(await readFile(join(userSource, 'server.js'), 'utf8'), userEditedServer)
    assert.equal(existsSync(join(userSource, 'Dockerfile')), false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
