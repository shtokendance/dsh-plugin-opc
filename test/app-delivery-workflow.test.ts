import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppDelivery, type AppDocument, type DeliveryJob } from '../src/host/app-delivery.ts'
import { ContextStore } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

function deliveryFixture(base = 'https://platform.example.test', rows: AppDocument[] = []) {
  const contexts = new ContextStore()
  contexts.replace({ issuer: base, subject: 'owner', tenant: 'test', spaces: ['test'], generation: 1 })
  const core = Object.assign(new EventEmitter(), {
    auth: { contexts, http: { base }, token: async () => 'platform-fixture-token' },
  }) as unknown as OpcCore
  const delivery = new AppDelivery(core, tmpdir(), {
    read: async key => key === 'publish-config-request1' ? { rows: JSON.stringify(rows) } : {} as Record<string, string>,
    write: async () => {},
  })
  return { delivery, expected: contexts.applicationContextId! }
}

const candidateJob: DeliveryJob = {
  id: 'ade2b0fa-7def-4be5-b6db-bc6a44d791ae', name: '示例应用', slug: 'example-app',
  url: 'https://app.example.test', session: 'fixture', status: 'verifying', requestId: 'request1', events: [],
}

test('candidate login and business requests use the authorized proxy and selected credential resource', async () => {
  const seen: AppDocument[] = []
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const probe = JSON.parse(Buffer.concat(chunks).toString())
      assert.equal(req.url, '/integration/v1/apps/example-app/requests/request1/probe')
      assert.equal(req.headers.authorization, 'Bearer platform-fixture-token')
      seen.push(probe)
      res.setHeader('Content-Type', 'application/json')
      if (probe.path === '/signin') {
        assert.equal(probe.target, undefined)
        assert.deepEqual(JSON.parse(probe.body), { username: 'test-owner', password: 'fixture-password' })
        res.end(JSON.stringify({ status: 200, headers: { 'Set-Cookie': ['first=one; HttpOnly', 'second=two; Path=/'] }, body: '{"token":"legacy-only"}' }))
      } else {
        assert.equal(probe.path, '/records?size=4')
        assert.equal(probe.target, 'sample-records')
        assert.equal(probe.headers.Cookie, 'first=one; second=two')
        res.end(JSON.stringify({ status: 200, headers: { 'Content-Type': ['application/json'] }, body: '{"records":[1]}', proof: 'sample-proof' }))
      }
    } catch (error) {
      res.statusCode = 500
      res.end(String(error))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const root = await mkdtemp(join(tmpdir(), 'opc-candidate-invoke-'))
  try {
    const address = server.address() as { port: number }
    const { delivery, expected } = deliveryFixture(`http://127.0.0.1:${address.port}`, [
      { key: 'LOGIN_USER', value: 'test-owner' },
      { key: 'LOGIN_PASSWORD', value: '', resource_id: 'app-login', resource_key: 'CUSTOM_PASSWORD' },
    ])
    delivery.platform = async (path, _expected, options) => {
      if (path.endsWith('/config-values')) {
        assert.deepEqual(options?.body, { bindings: [{ key: 'LOGIN_PASSWORD', resource_id: 'app-login', resource_key: 'CUSTOM_PASSWORD' }] })
        return { values: { LOGIN_PASSWORD: 'fixture-password' } }
      }
      assert.equal(path, '/example-app/requests/request1')
      return { request_id: 'request1', status: 'runtime_ready', version: 1 }
    }
    const job = { ...candidateJob, proposal: { delivery_format: 1, contract: {
      base_url: candidateJob.url,
      verification: { targets: [{ id: 'sample-records', kind: 'operation', operation: 'records' }] },
      auth_profiles: { session: { login_url: '/signin', username_env: 'LOGIN_USER', password_env: 'LOGIN_PASSWORD' } },
      apis: [{ id: 'records', effect: 'read', method: 'GET', path: '/records', parameters: [{ name: 'size', in: 'query', type: 'integer' }],
        auth: { type: 'header', header: 'Cookie', profile: 'session' } }],
    } } }
    const signal = new AbortController().signal
    await assert.rejects(delivery.observeDeployment(job, root, { kind: 'operation', target: 'other' }, expected, signal), /只读业务验收目标/)
    const observation = { kind: 'operation', target: 'sample-records', operation: 'ignored', params: { size: 4 } }
    const result = await delivery.observeDeployment(job, root, observation, expected, signal)
    assert.deepEqual(result, { operation: 'records', status: 200, content_type: 'application/json', content: '{"records":[1]}', proof: 'sample-proof' })
    assert.deepEqual(seen.map(probe => probe.method), ['POST', 'GET'])

    const profile: AppDocument = job.proposal.contract.auth_profiles.session
    profile.login_body_template = { username: 'env:MISSING_USER', password: '${password}' }
    await assert.rejects(delivery.observeDeployment(job, root, observation, expected, signal), /没有配置值的键：MISSING_USER/)
    assert.equal(seen.length, 2)
    delete profile.login_body_template
    job.proposal.contract.apis[0].auth.type = 'bearer'
    await assert.rejects(delivery.observeDeployment(job, root, observation, expected, signal), /须声明.*token_json_path/)
    profile.token_json_path = 'session.token'
    await assert.rejects(delivery.observeDeployment(job, root, observation, expected, signal), /缺少方案声明的 Token 路径：session.token/)
    assert.deepEqual(seen.map(probe => probe.method), ['POST', 'GET', 'POST', 'POST'])
  } finally {
    await rm(root, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('candidate HTTP reads use the declared path and carry the original probe proof', async () => {
  const { delivery, expected } = deliveryFixture()
  const root = await mkdtemp(join(tmpdir(), 'opc-candidate-http-'))
  try {
    delivery.platform = async (path, _expected, options) => {
      if (path.endsWith('/probe')) {
        assert.deepEqual(options?.body, { method: 'GET', path: '/preview', target: 'preview' })
        return { status: 200, headers: { 'Content-Type': ['text/html'] }, body: '<title>Fixture</title>', proof: 'signed-proof' }
      }
      return { status: 'runtime_ready', version: 1 }
    }
    const job = { ...candidateJob, proposal: { delivery_format: 1, contract: {
      verification: { targets: [{ id: 'preview', kind: 'http', path: '/preview', method: 'GET' }] },
    } } }
    const observed = await delivery.observeDeployment(job, root, { kind: 'http', target: 'preview', path: '/ignored' }, expected, new AbortController().signal)
    assert.equal(observed.content, '<title>Fixture</title>')
    assert.equal(observed.proof, 'signed-proof')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an inherited value must exist on the active version and an app default is used with an empty placeholder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-delivery-preview-'))
  try {
    const { delivery, expected } = deliveryFixture()
    delivery.platform = async () => ({ app_config: [{ key: 'EXISTING_OPT', value: '' }] })
    const job = { ...candidateJob, upgrade: true, proposal: { contract: { configs: [
      { key: 'EXISTING_OPT', value_plan: { kind: 'inherit' }, default: 'must-not-replace-empty' },
      { key: 'NEW_DEFAULT', value_plan: { kind: 'default' }, default: '', app_default: 'startup-default' },
    ] } } }
    const signal = new AbortController().signal
    const values = await delivery.previewDeliveryConfig(job, root, expected, signal)
    assert.deepEqual(values.map((row: AppDocument) => [row.key, row.value]), [['EXISTING_OPT', ''], ['NEW_DEFAULT', 'startup-default']])
    job.proposal.contract.configs[0].key = 'UNKNOWN_OPT'
    await assert.rejects(delivery.previewDeliveryConfig(job, root, expected, signal), /UNKNOWN_OPT.*无法沿用/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('editing a modern app cannot invoke the legacy configuration mutation', async () => {
  const { delivery, expected } = deliveryFixture()
  delivery.platform = async path => {
    assert.equal(path, '/example-app')
    return { build_log: `[Artifact] delivery.json:${'a'.repeat(64)}\n` }
  }
  await assert.rejects(delivery.updateConfig('example-app', { app_config: [] }, expected), /AI 分析配置变更/)
})
