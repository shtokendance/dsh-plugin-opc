import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { worker, type AppDocument } from '../src/host/app-delivery.ts'

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
