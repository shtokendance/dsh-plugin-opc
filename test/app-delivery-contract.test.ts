import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AppDeliveryJob } from '../src/client/api.ts'
import { mergeJobConfigs } from '../src/client/app-config-helpers.ts'
import { AppDelivery, worker, type AppDocument, type DeliveryJob } from '../src/host/app-delivery.ts'
import type { OpcCore } from '../src/host/core.ts'

test('selected AI declares acceptance for static apps and explicit route authentication takes precedence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'opc-delivery-contract-'))
  try {
    const source = join(workspace, 'source')
    const root = join(workspace, 'job')
    const url = 'https://fixture.example.test'
    await mkdir(source)
    await writeFile(join(source, 'Dockerfile'), 'FROM nginx:alpine\nARG SITE_TITLE\nCOPY index.html /usr/share/nginx/html/\n')
    await writeFile(join(source, 'index.html'), '<title>Delivery fixture</title>\n')
    await worker({ action: 'prepare', root, source, slug: 'fixture', url })

    const contract = {
      schema_version: 1, slug: 'fixture', base_url: url, name: 'Fixture', description: 'An application fixture',
      runtime: { language: 'html', version: '5', port: 80 }, build_context: ['Dockerfile', 'index.html'],
      configs: [], resources: [], storage_mounts: [], apis: [], pages: [],
      configuration_review: { summary: '沿用静态服务配置', evidence: ['Dockerfile:1-2'] },
      verification: { targets: [{ id: 'homepage', kind: 'http', path: '/', method: 'GET',
        expected: '返回交付页面标题', evidence: ['index.html:1'] }] },
    }
    const proposal = { summary: '按实际源码交付静态页面', delivery_format: 1, config_format: 1, verification_format: 1,
      changes: [], skill_markdown: '---\nname: app-fixture\ndescription: 打开样例页面\n---\n查阅页面。\n' }
    const validate = (version: AppDocument) => worker({ action: 'validate', root, proposal: { ...proposal, contract: version } })
    assert.equal((await validate(contract)).valid, true)

    await assert.rejects(validate({ ...contract, configuration_review: undefined, verification: { targets: [] } }),
      (error: unknown) => /configuration_review/.test(String(error)) && /verification\.targets/.test(String(error)))
    await assert.rejects(validate({ ...contract, configuration_review: { ...contract.configuration_review,
      evidence: ['Dockerfile:99'] } }), /configuration_review/)
    await assert.rejects(validate({ ...contract, storage_mounts: [{ name: 'Data', kind: 'state-data', container_path: '/data/.' }] }), /规范路径：\/data/)
    const buildInput = { arg: 'SITE_TITLE', key: 'DISPLAY_TITLE', evidence: ['Dockerfile:2'] }
    const publicConfig = { key: 'DISPLAY_TITLE', required: false, secret: false, default: 'Fixture' }
    assert.equal((await validate({ ...contract, configs: [publicConfig], build_inputs: [buildInput] })).valid, true)
    await assert.rejects(validate({ ...contract, configs: [{ ...publicConfig, secret: true }], build_inputs: [buildInput] }), /构建秘密注入能力/)
    await assert.rejects(validate({ ...contract, configs: [publicConfig], build_inputs: [buildInput, buildInput] }), /唯一的 Dockerfile ARG/)
    await assert.rejects(validate({ ...contract, configs: [publicConfig], build_inputs: [{ ...buildInput, evidence: ['index.html:1'] }] }), /根 Dockerfile/)

    const api = { id: 'public-info', path: '/info', method: 'GET', purpose: '查询公开信息', evidence: ['index.html:1'],
      request_body: null, parameters: [], responses: { '200': { description: '查询结果' } },
      effect: 'read', confirmation_required: false, auth: { type: 'none', evidence: ['index.html:1'] } }
    const withAuth = { ...contract, apis: [api, { ...api, id: 'protected-info', path: '/protected', auth: undefined }],
      configs: [{ key: 'FIXTURE_TOKEN', required: false, secret: true, default: '' }],
      auth_rules: [{ target: 'api', prefix: '/', auth: { type: 'bearer', env: 'FIXTURE_TOKEN' }, evidence: ['Dockerfile:1'] }],
      verification: { targets: [{ id: 'info', kind: 'operation', operation: 'public-info', expected: '返回公开信息' }] },
    }
    const parsed = await validate(withAuth)
    assert.deepEqual(parsed.proposal.contract.apis[0].auth, api.auth)
    assert.equal(parsed.proposal.contract.apis[1].auth.type, 'bearer')
    await assert.rejects(validate({ ...withAuth, apis: [{ ...api, effect: 'write', confirmation_required: true }] }), /effect: read/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('AI resource bindings are checked before Step 3 and carried into its configuration', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'opc-delivery-resources-'))
  try {
    const root = join(workspace, 'job')
    const source = join(workspace, 'source')
    const url = 'https://resources.example.test'
    await mkdir(source)
    await writeFile(join(source, 'Dockerfile'), 'FROM nginx:alpine\n')
    await worker({ action: 'prepare', root, source, slug: 'fixture', url })
    const delivery = new AppDelivery(new EventEmitter() as unknown as OpcCore, workspace, {
      async read() { return {} },
      async write() {},
    })
    let values = { APP_HOST: 'fixture-cache.internal', APP_PORT: '6379' }
    delivery.platform = async path => {
      if (path === '/resources') {
        return { resources: [
          { id: 'shared-cache', name: 'Cache', type: 'redis', is_default: true, env_keys: ['CACHE_HOST', 'CACHE_PORT'] },
          { id: 'site-volume', name: 'Volume', type: 'docker-volume', is_default: true, env_keys: [] },
          { id: 'site-oss', name: 'OSS', type: 'aliyun-oss-volume', env_keys: [] },
        ] }
      }
      if (path === '/fixture/config-values') return { values }
      throw new Error(`Unexpected test API path: ${path}`)
    }
    const newJob = (): DeliveryJob => ({
      id: 'resources', name: 'Fixture', slug: 'fixture', url, session: 'selected-ai', status: 'analyzing', events: [],
    })
    const proposal = {
      summary: '核对运行配置与挂载', config_format: 1, delivery_format: 1, changes: [], unresolved: [],
      skill_markdown: '---\nname: app-fixture\ndescription: 查询样例页面\n---\n查阅页面。\n',
      contract: {
        schema_version: 1, slug: 'fixture', base_url: url, name: 'Fixture', description: 'Runtime resource fixture',
        runtime: { language: 'html', version: '5', port: 8080 }, build_context: ['Dockerfile'],
        apis: [], pages: [], resources: [],
        configs: [
          { key: 'APP_HOST', default: 'localhost', required: true, secret: false,
            value_plan: { kind: 'resource' }, resource_id: 'shared-cache', resource_key: 'CACHE_HOST' },
          { key: 'APP_PORT', default: '', required: true, secret: false,
            value_plan: { kind: 'resource' }, resource_id: 'shared-cache', resource_key: 'CACHE_PORT' },
        ],
        storage_mounts: [{ name: 'app-data', container_path: '/app/data', kind: 'sqlite', resource_id: 'site-volume' }],
      },
    }
    const signal = new AbortController().signal
    const submit = (job: DeliveryJob, plan: AppDocument, existingMounts: AppDocument[] = []) => delivery.submit(job, root, plan, signal,
      { dockerfileOnly: true, resourceReview: { contextId: 'fixture', existingMounts } })
    const unchecked = structuredClone(proposal)
    unchecked.contract.configs[0].resource_id = 'cache'
    unchecked.contract.configs[1].resource_key = 'port'
    unchecked.contract.storage_mounts[0].resource_id = ''
    await assert.rejects(submit(newJob(), unchecked), error =>
      /APP_HOST/.test(String(error)) && /APP_PORT/.test(String(error)) && /\/app\/data/.test(String(error)))

    const wrongStorage = structuredClone(proposal)
    wrongStorage.contract.storage_mounts[0].resource_id = 'site-oss'
    await assert.rejects(submit(newJob(), wrongStorage), /\/app\/data.*本地磁盘/)

    values = { ...values, APP_PORT: '' }
    await assert.rejects(submit(newJob(), proposal), /平台资源未提供配置值：APP_PORT/)
    values = { ...values, APP_PORT: '6379' }

    const alreadyDeployed = structuredClone(proposal)
    alreadyDeployed.contract.storage_mounts[0].resource_id = ''
    await submit(newJob(), alreadyDeployed, [{ container_path: '/app/data', resource_id: 'original-volume' }])

    const job = newJob()
    job.proposal = unchecked
    job.configDraft = { artifactHash: 'old-draft', versionNote: 'keep', rows: [
      { key: 'APP_HOST', resource_id: 'cache', resource_key: 'host', value_source: 'resource' },
      { key: 'APP_PORT', value_source: 'manual' },
    ], storageBindings: { '/app/data': 'old-volume' } }
    await submit(job, proposal)
    assert.deepEqual(job.configDraft.rows, [])
    assert.deepEqual(job.configDraft.storageBindings, {})
    const rows = await delivery.previewDeliveryConfig(job, root, 'fixture', signal)
    assert.deepEqual(rows.map(row => [row.key, row.resource_id, row.resource_key, row.value]), [
      ['APP_HOST', 'shared-cache', 'CACHE_HOST', 'fixture-cache.internal'],
      ['APP_PORT', 'shared-cache', 'CACHE_PORT', '6379'],
    ])
    job.proposal!.effective_configs = rows
    const view = delivery.public(job) as AppDeliveryJob
    const step3 = mergeJobConfigs(view)
    assert.deepEqual(step3.configs.map(row => [row.key, row.resource_id, row.effective_value]), [
      ['APP_HOST', 'shared-cache', 'fixture-cache.internal'],
      ['APP_PORT', 'shared-cache', '6379'],
    ])
    assert.equal(view.proposal?.contract?.storage_mounts?.[0]?.resource_id, 'site-volume')
    const edited = mergeJobConfigs(view, { rows: [{ key: 'APP_HOST', value: 'my-cache.internal', value_source: 'manual' }] })
    assert.equal(edited.configs[0].value, 'my-cache.internal')
    assert.equal(edited.configs[0].resource_id, undefined)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
