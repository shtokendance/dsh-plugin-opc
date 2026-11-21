import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDelivery, worker, type AppDocument, type DeliveryJob } from '../src/host/app-delivery.ts'
import { ContextStore } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'
import { proposalParameters } from '../src/host/app-proposal-schema.ts'
import {
  isContainerDefaultConfig,
  mergeJobConfigs,
  needsContainerBindWarning,
  sanitizeConfigRowsForApi,
  validateConfigsForPublish,
} from '../src/client/app-config-helpers.ts'

function baseProposal(url: string, port = 4173): AppDocument {
  return {
    summary: '保持原有 Node 服务与业务配置',
    changes: [
      {
        path: 'Dockerfile',
        reason: '容器化打包',
        content: `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE ${port}\nCMD ["node", "server.mjs"]\n`,
      },
    ],
    unresolved: [],
    contract: {
      schema_version: 1,
      slug: 'audit-app',
      name: '审检系统',
      description: '供应商审检系统',
      base_url: url,
      runtime: { language: 'nodejs', version: '20', port },
      build_context: ['Dockerfile', 'server.mjs'],
      health: { path: '/healthz', status: 200, json_contains: { ok: true } },
      configs: [],
      resources: [],
      pages: [],
      apis: [
        {
          id: 'health',
          method: 'GET',
          path: '/healthz',
          purpose: '服务状态',
          evidence: ['server.mjs:1'],
          parameters: [],
          request_body: null,
          responses: { '200': { description: 'ok' } },
          auth: { type: 'none' },
          effect: 'read',
          confirmation_required: false,
        },
      ],
      verification: { cases: [{ operation: 'health', status: 200, json_contains: { ok: true } }] },
      unresolved: [],
    },
  }
}

test('worker detects example configs, validates app_default & PORT source alignment, and protects example values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-worker-port-cfg-'))
  try {
    const source = join(root, 'input')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, '.env'), 'PUBLIC_ORIGIN=https://real.example.invalid\nAPP_SECRET=real-secret\n')
    await writeFile(
      join(source, '.env.production.example'),
      'HOST=127.0.0.1\nPORT=4173\nPUBLIC_ORIGIN=https://api.benlaipinkong.cn\nNODE_ENV=production\nADMIN_PASSWORD=changeme\nJWT_SECRET=your-secret-here\n',
    )
    await writeFile(
      join(source, 'server.mjs'),
      'const host = process.env.HOST || "127.0.0.1"\nconst port = process.env.PORT || 4173\nconst pub = process.env.PUBLIC_ORIGIN\n',
    )
    await worker({
      action: 'prepare',
      root,
      source,
      slug: 'audit-app',
      url: 'http://audit-app.example.test',
    })

    const srcCfg = await worker({ action: 'source_configuration', root })
    const envEntry = srcCfg.files.find((f: AppDocument) => f.path === '.env')
    const exEntry = srcCfg.files.find((f: AppDocument) => f.path === '.env.production.example')
    assert.ok(envEntry)
    assert.equal('is_example' in envEntry, false)
    assert.equal(exEntry?.is_example, true)

    const inv = await worker({ action: 'inventory', root })
    const invEnv = inv.source_configuration.config_files.find((f: AppDocument) => f.path === '.env')
    const invEx = inv.source_configuration.config_files.find((f: AppDocument) => f.path === '.env.production.example')
    assert.equal('is_example' in invEnv, false)
    assert.equal(invEx?.is_example, true)

    const url = 'http://audit-app.example.test'
    // When expected_port is null (auto mode), worker accepts app default port 4173
    const p4173 = baseProposal(url, 4173)
    const valid4173 = await worker({ action: 'validate', root, expected_port: null, proposal: p4173 })
    assert.equal(valid4173.valid, true)

    // Out-of-range ports (0 / 70000) are rejected even when expected_port is null
    for (const badPort of [0, 70000]) {
      const pBad = baseProposal(url, badPort)
      await assert.rejects(
        worker({ action: 'validate', root, expected_port: null, proposal: pBad }),
        /1 至 65535/,
      )
    }

    // Locked expected_port still rejects port changes
    await assert.rejects(
      worker({ action: 'validate', root, expected_port: 8080, proposal: p4173 }),
      /容器端口/,
    )

    // Rejects conflicting PORT source value (4173 != 8080) during Step 2 validation
    const pMismatch = baseProposal(url, 8080)
    pMismatch.contract.configs = [
      {
        key: 'PORT',
        default: '',
        secret: false,
        required: true,
        source: { path: '.env.production.example', keys: ['PORT'] },
      },
    ]
    await assert.rejects(
      worker({ action: 'validate', root, expected_port: null, proposal: pMismatch }),
      /不一致/,
    )

    // app_default allowed on non-secret keys, rejected on secret/sensitive keys
    const pSecretDefault = baseProposal(url, 4173)
    pSecretDefault.contract.configs = [
      { key: 'APP_SECRET', default: '', app_default: 'leak-123', secret: true, required: true, source: { path: '.env', keys: ['APP_SECRET'] } },
    ]
    await assert.rejects(
      worker({ action: 'validate', root, expected_port: null, proposal: pSecretDefault }),
      /app_default/,
    )

    // Bundle skips PORT and placeholder secrets from *.example while retaining non-secret reference values
    const pBundle = baseProposal(url, 8080)
    pBundle.contract.configs = [
      { key: 'HOST', default: '', app_default: '127.0.0.1', secret: false, required: true, source: { path: '.env.production.example', keys: ['HOST'] } },
      { key: 'PORT', default: '', app_default: '4173', secret: false, required: true, source: { path: '.env.production.example', keys: ['PORT'] } },
      { key: 'PUBLIC_ORIGIN', default: '', secret: false, required: true, source: { path: '.env.production.example', keys: ['PUBLIC_ORIGIN'] } },
      { key: 'NODE_ENV', default: '', secret: false, required: false, source: { path: '.env.production.example', keys: ['NODE_ENV'] } },
      { key: 'ADMIN_PASSWORD', default: '', secret: true, required: true, source: { path: '.env.production.example', keys: ['ADMIN_PASSWORD'] } },
      { key: 'JWT_SECRET', default: '', secret: true, required: true, source: { path: '.env.production.example', keys: ['JWT_SECRET'] } },
      { key: 'APP_SECRET', default: '', secret: true, required: true, source: { path: '.env', keys: ['APP_SECRET'] } },
    ]
    // Change PORT source away from conflicting 4173 for bundling with 8080
    pBundle.contract.configs[1] = { key: 'PORT', default: '', app_default: '4173', secret: false, required: true }
    // And add a real env ref or drop PORT source check: PORT is referenced in server.mjs
    const bundled = await worker({ action: 'bundle', root, revision: 'rev1', expected_port: null, proposal: pBundle })
    assert.equal(bundled.original_config_values.HOST, '127.0.0.1')
    assert.equal(bundled.original_config_values.PUBLIC_ORIGIN, 'https://api.benlaipinkong.cn')
    assert.equal(bundled.original_config_values.NODE_ENV, 'production')
    assert.equal(bundled.original_config_values.APP_SECRET, 'real-secret')
    assert.equal('ADMIN_PASSWORD' in bundled.original_config_values, false)
    assert.equal('JWT_SECRET' in bundled.original_config_values, false)
    assert.equal('PORT' in bundled.original_config_values, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Host portAuto follows app default port, preserves explicit locked port, and handles draft/clear/publish semantics', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-host-port-cfg-'))
  const source = join(home, 'source')
  const creds: Record<string, Record<string, string>> = {}
  const contexts = new ContextStore()
  contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
  const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
  const expected = contexts.applicationContextId!
  const url = 'http://audit-app.example.test'

  try {
    await mkdir(source, { recursive: true })
    await writeFile(
      join(source, '.env'),
      'HOST=127.0.0.1\nPORT=4173\nPUBLIC_ORIGIN=https://old.example.test\nOPTIONAL_FLAG=yes\nAPI_SECRET=top-secret-val\n',
    )
    await writeFile(
      join(source, 'server.mjs'),
      'const port = process.env.PORT || 4173\nconst flag = process.env.OPTIONAL_FLAG\n',
    )

    let publishedPayload: Record<string, unknown> = {}
    const delivery = new AppDelivery(
      core,
      join(home, 'delivery'),
      {
        async read(id) { return creds[id] ?? {} },
        async write(id, values) { creds[id] = values },
      },
      { appDefaultPort: 8080 },
    )
    delivery.platform = async (path, _ctx, opts) => {
      if (path === '/check-slug') return { available: true, app_url: url }
      if (path === '/resources') return { resources: [] }
      if (path === '/publish' && opts?.form) {
        publishedPayload = {
          container_port: opts.form.get('container_port'),
          app_config: JSON.parse(String(opts.form.get('app_config'))),
        }
        return { app_url: url, version: 1, status: 'building' }
      }
      return {}
    }

    // 1. Auto port mode adopts app default port 4173
    const job = await delivery.create({ name: '审检系统', slug: 'audit-app', source }, 'sess-1', expected)
    assert.equal(job.portAuto, true)
    assert.equal(job.port, 8080)

    const schemaAuto = proposalParameters(8080, false)
    assert.match(schemaAuto.contract.properties.runtime.properties.port.description, /优先填写应用自身默认监听端口/)
    const schemaLocked = proposalParameters(9000, true)
    assert.match(schemaLocked.contract.properties.runtime.properties.port.description, /已锁定的数字 9000/)

    delivery.analyze = async (j, root, _fb, signal) => {
      const p = baseProposal(url, 4173)
      p.contract.configs = [
        { key: 'HOST', default: '', app_default: '127.0.0.1', secret: false, required: true, source: { path: '.env', keys: ['HOST'] } },
        { key: 'PORT', default: '', app_default: '4173', secret: false, required: true, source: { path: '.env', keys: ['PORT'] } },
        { key: 'PUBLIC_ORIGIN', default: '', secret: false, required: true, source: { path: '.env', keys: ['PUBLIC_ORIGIN'] } },
        { key: 'OPTIONAL_FLAG', default: '', secret: false, required: false, source: { path: '.env', keys: ['OPTIONAL_FLAG'] } },
        { key: 'API_SECRET', default: '', secret: true, required: true, source: { path: '.env', keys: ['API_SECRET'] } },
      ]
      await delivery.submit(j, root, p, signal)
    }

    await delivery.startAnalysis(job.id, '', expected)
    for (let i = 0; i < 100; i++) {
      const state = await delivery.getJob(job.id, expected)
      if (state.status !== 'analyzing') break
      await new Promise(r => setTimeout(r, 20))
    }

    const reviewed = await delivery.getJob(job.id, expected)
    assert.equal(reviewed.status, 'review', reviewed.error)
    assert.equal(reviewed.port, 4173)

    const ready = await delivery.prepare(job.id, reviewed.proposalHash, expected)
    assert.equal(ready.status, 'ready', ready.error)
    assert.equal(ready.port, 4173)
    assert.equal(ready.runtime_configs.find((c: AppDocument) => c.key === 'HOST')?.app_default, '127.0.0.1')

    // The operator can review all original configuration values in the draft.
    const initialDraft = await delivery.configDraft(job.id, expected)
    assert.equal(initialDraft?.originalValues?.HOST, '127.0.0.1')
    assert.equal(initialDraft?.originalValues?.PUBLIC_ORIGIN, 'https://old.example.test')
    assert.equal(initialDraft?.originalValues?.API_SECRET, 'top-secret-val')

    // Save edited draft: override HOST & PUBLIC_ORIGIN, clear OPTIONAL_FLAG, add custom key
    await delivery.saveConfigDraft(
      job.id,
      {
        artifactHash: ready.artifactHash,
        rows: [
          { key: 'HOST', value: '0.0.0.0', value_source: 'manual' },
          { key: 'PORT', value: '4173', value_source: 'manual' },
          { key: 'PUBLIC_ORIGIN', value: 'http://audit-app.example.test', value_source: 'manual' },
          { key: 'OPTIONAL_FLAG', value: '', value_source: 'manual' },
          { key: 'API_SECRET', value: '', value_source: 'original' },
          { key: 'CUSTOM_HOOK', value: 'https://hook.example.test', value_source: 'manual', secret: false },
        ],
        versionNote: 'v1',
        storageBindings: {},
      },
      expected,
    )

    const savedDraft = await delivery.configDraft(job.id, expected)
    assert.equal(savedDraft?.rows.find((r: AppDocument) => r.key === 'OPTIONAL_FLAG')?.value_source, 'manual')
    assert.equal(savedDraft?.rows.find((r: AppDocument) => r.key === 'OPTIONAL_FLAG')?.value, '')
    assert.equal(savedDraft?.rows.find((r: AppDocument) => r.key === 'CUSTOM_HOOK')?.value, 'https://hook.example.test')

    // Publish with manual overrides + explicit cleared OPTIONAL_FLAG + untouched original API_SECRET
    const publishRows = [
      { key: 'HOST', value: '0.0.0.0', value_source: 'manual' },
      { key: 'PORT', value: '4173', value_source: 'manual' },
      { key: 'PUBLIC_ORIGIN', value: 'http://audit-app.example.test', value_source: 'manual' },
      { key: 'OPTIONAL_FLAG', value: '', value_source: 'manual' },
      { key: 'API_SECRET', value: '', value_source: 'original' },
      { key: 'CUSTOM_HOOK', value: 'https://hook.example.test', value_source: 'manual' },
    ]
    const confirm = await delivery.confirmDeployment(
      job.id,
      { artifactHash: ready.artifactHash, config: publishRows, storageBindings: {}, versionNote: 'v1' },
      expected,
    )
    await delivery.publish(
      job.id,
      {
        artifactHash: ready.artifactHash,
        confirmationToken: confirm.confirmationToken,
        config: publishRows,
        storageBindings: {},
        versionNote: 'v1',
      },
      expected,
    )

    assert.equal(publishedPayload.container_port, '4173')
    const sent = publishedPayload.app_config as { key: string; value: string; value_source: string }[]
    assert.equal(sent.find(c => c.key === 'HOST')?.value, '0.0.0.0')
    assert.equal(sent.find(c => c.key === 'PUBLIC_ORIGIN')?.value, 'http://audit-app.example.test')
    // Explicit manual empty is NOT overwritten by origValues
    assert.equal(sent.find(c => c.key === 'OPTIONAL_FLAG')?.value, '')
    // Original secret is backfilled cleanly when untouched
    assert.equal(sent.find(c => c.key === 'API_SECRET')?.value, 'top-secret-val')
    assert.equal(sent.find(c => c.key === 'CUSTOM_HOOK')?.value, 'https://hook.example.test')

    // 2. Explicit container_port stays locked
    const lockedJob = await delivery.create(
      { name: '锁定端口', slug: 'audit-app', container_port: 9000, source },
      'sess-2',
      expected,
    )
    assert.equal(lockedJob.portAuto, false)
    assert.equal(lockedJob.port, 9000)
    await assert.rejects(
      delivery.submit(
        { ...(lockedJob as unknown as DeliveryJob), status: 'analyzing', events: [] },
        home,
        baseProposal(url, 4173),
        new AbortController().signal,
      ),
      /容器端口/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('client config helpers prefill original values, warn on loopback HOST, lock PORT, and sanitize publish rows', () => {
  const job = {
    id: 'job-1',
    slug: 'audit-app',
    name: '审检系统',
    port: 4173,
    status: 'ready',
    url: 'http://audit-app.example.test',
    events: [],
    runtime_configs: [
      { key: 'PORT', value: '', required: true, secret: false, has_value: true, has_original_value: false, value_source: 'manual', app_default: '4173' },
      { key: 'HOST', value: '', required: true, secret: false, has_value: true, has_original_value: true, is_example_source: true, value_source: 'original', source_label: '示例模板参考 .env.production.example' },
      { key: 'PUBLIC_ORIGIN', value: '', required: true, secret: false, has_value: true, has_original_value: true, is_example_source: true, value_source: 'original' },
      { key: 'WEBHOOK_URL', value: '', required: false, secret: false, has_value: false, has_original_value: false, value_source: 'manual' },
      { key: 'APP_SECRET', value: '', required: true, secret: true, has_value: true, has_original_value: true, value_source: 'original' },
      { key: 'DB_DSN', value: '', required: true, secret: false, has_value: false, has_original_value: false, value_source: 'manual' },
    ],
  }

  const { configs, originals } = mergeJobConfigs(job, {
    originalValues: {
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: 'https://api.benlaipinkong.cn',
    },
  })

  // Unfilled required DB_DSN sorts first among primary configs; loopback HOST sorts ahead of normal items
  const primary = configs.filter(c => !isContainerDefaultConfig(c))
  assert.equal(primary[0].key, 'DB_DSN')
  assert.ok(configs.findIndex(c => c.key === 'DB_DSN') < configs.findIndex(c => c.key === 'WEBHOOK_URL'))
  assert.ok(configs.findIndex(c => c.key === 'HOST') < configs.findIndex(c => c.key === 'WEBHOOK_URL'))
  assert.equal(configs.find(c => c.key === 'PORT')?.value, '4173')
  assert.equal(configs.find(c => c.key === 'PUBLIC_ORIGIN')?.value, 'https://api.benlaipinkong.cn')
  assert.equal(configs.find(c => c.key === 'APP_SECRET')?.value, '')

  const hostItem = configs.find(c => c.key === 'HOST')!
  const hostOrig = originals.find(c => c.key === 'HOST')!
  assert.equal(isContainerDefaultConfig(hostItem), true)
  assert.equal(needsContainerBindWarning(hostItem, hostOrig), true)
  assert.equal(needsContainerBindWarning({ ...hostItem, value: '0.0.0.0', value_source: 'manual' }, hostOrig), false)

  // Required DB_DSN missing fails publish validation
  assert.match(String(validateConfigsForPublish(configs, 4173)), /DB_DSN/)

  // Filling DB_DSN with localhost fails loopback guard until confirmed
  const withLocalDb = configs.map(c => c.key === 'DB_DSN' ? { ...c, value: 'postgres://localhost:5432/app', value_source: 'manual' } : c)
  assert.match(String(validateConfigsForPublish(withLocalDb, 4173)), /本地回环地址/)

  // Confirming DB_DSN passes even with untouched original APP_SECRET and empty optional WEBHOOK_URL
  const readyToPublish = withLocalDb.map(c => c.key === 'DB_DSN' ? { ...c, local_connection_confirmed: true } : c)
  assert.equal(validateConfigsForPublish(readyToPublish, 4173), null)

  // Clearing required PUBLIC_ORIGIN fails validation instead of silently keeping old value
  const clearedRequired = readyToPublish.map(c => c.key === 'PUBLIC_ORIGIN' ? { ...c, value: '', value_source: 'manual' } : c)
  assert.match(String(validateConfigsForPublish(clearedRequired, 4173)), /PUBLIC_ORIGIN/)

  // Publish sanitization omits untouched empty optional WEBHOOK_URL and keeps APP_SECRET for original backfill
  const forPublish = sanitizeConfigRowsForApi(readyToPublish, { forPublish: true, lockedPort: 4173 })
  assert.equal(forPublish.some(r => r.key === 'WEBHOOK_URL'), false)
  assert.deepEqual(forPublish.find(r => r.key === 'APP_SECRET'), {
    key: 'APP_SECRET',
    value: '',
    resource_id: undefined,
    has_value: true,
    value_source: 'original',
    local_connection_confirmed: undefined,
  })
  assert.equal(forPublish.find(r => r.key === 'PORT')?.value, '4173')
})
