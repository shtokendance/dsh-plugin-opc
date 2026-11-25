import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { attachAppAgent } from '../src/host/app-agent.ts'
import { AppDelivery } from '../src/host/app-delivery.ts'
import { ContextStore, identityHash } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

test('step 3 ready deployment answers config questions in pure Q&A mode without restarting analysis', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-config-qa-'))
  try {
    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const context = contexts.applicationContextId!
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const delivery = new AppDelivery(core, home, { read: async () => ({}), write: async () => {} })
    const id = 'd8f86cd1-1f7d-4771-a96b-37e1b62c8827'
    const session = '58f5cbf4-db2a-4e02-970d-21bf73b3baec'
    const root = join(home, 'opc', 'apps', identityHash(contexts.current!), id)
    const job = {
      id,
      name: '测试应用',
      slug: 'test-app',
      status: 'ready',
      deliveryMode: 'update',
      port: 8080,
      analysisSessionId: session,
      events: [],
      modelSelection: { provider: 'fixture', model: 'chosen-model' },
      proposal: {
        contract: {
          configs: [
            { key: 'TOKEN_TTL', description: '登录有效期（小时）', required: true, secret: false, default_value: '12' },
            { key: 'API_SECRET', description: '接口密钥', required: true, secret: true, default_value: 'super-secret' },
          ],
          storage_mounts: [
            { container_path: '/app/data', description: '业务数据目录' },
          ],
        },
      },
    }
    await mkdir(root, { recursive: true })
    const jobPath = join(root, 'job.json')
    await writeFile(jobPath, JSON.stringify(job))

    const review = await delivery.getConfigReviewContext(id, context)
    assert.deepEqual(review, {
      name: '测试应用',
      slug: 'test-app',
      mode: 'update',
      port: 8080,
      configs: [
        { key: 'TOKEN_TTL', description: '登录有效期（小时）', required: true, secret: false, resource_key: undefined, default_value: '12' },
        { key: 'API_SECRET', description: '接口密钥', required: true, secret: true, resource_key: undefined, default_value: undefined },
      ],
      storage_mounts: [
        { container_path: '/app/data', description: '业务数据目录' },
      ],
    })

    let promptProvider: (() => string) | undefined
    let onStep: ((event: any, next: any) => Promise<unknown>) | undefined
    let startAnalysisCalled = false
    const fakeAgent = {
      session: { id: session, requestHeader: () => ({ config: { provider: 'fixture', model: 'chosen-model' } }) },
      model: { current: () => ({ provider: 'fixture', model: 'chosen-model' }), select() {} },
      inject() {},
      followup() {},
      send() {},
      whenIdle: async () => {},
      ctx: {
        tools: { restrict() {}, register() { return () => {} } },
        systemPrompt: { section(spec: { text: () => string }) { promptProvider = spec.text; return () => {} } },
        on(event: string, listener: (event: any, next: any) => Promise<unknown>) {
          if (event === 'agent/pre-step') onStep = listener
          return () => {}
        },
      },
    }
    const fakeContext = {
      agents: {
        get: (target: string) => (target === session ? fakeAgent : undefined),
        resume: async () => ({ agent: fakeAgent, dispose: async () => {} }),
        create: async () => ({ agent: fakeAgent, dispose: async () => {} }),
      },
      on: () => () => {},
      get: () => undefined,
      effect() {},
    }
    attachAppAgent(fakeContext as any, delivery)
    delivery.startAnalysis = async () => {
      startAnalysisCalled = true
      throw new Error('should not restart analysis in step 3 config Q&A')
    }

    // Trigger setupSession via an analysis round that exits immediately
    await assert.rejects(() => delivery.analyze!(job as any, root, '', new AbortController().signal, async () => {}), /尚未提交/)
    assert.ok(onStep)
    assert.ok(promptProvider)

    const message = { source: { kind: 'user', rpcId: 'step3-qa' }, content: [{ type: 'text', text: 'TOKEN_TTL 是干嘛的，怎么改？' }] }
    const decision = { kind: 'enter', messages: [message] }
    const result = await onStep!({ signal: new AbortController().signal }, async () => decision)
    assert.equal(result, decision)
    assert.equal(startAnalysisCalled, false)
    const prompt = promptProvider!()
    assert.match(prompt, /第 3 步部署配置/)
    assert.match(prompt, /TOKEN_TTL/)
    assert.match(prompt, /返回核对方案/)
    assert.doesNotMatch(prompt, /super-secret/)
    assert.equal(JSON.parse(await readFile(jobPath, 'utf8')).status, 'ready')

    // Superseded published job should not be treated as Step 3 config review
    await writeFile(jobPath, JSON.stringify({ ...job, superseded: true, published: true }))
    assert.equal(await delivery.getConfigReviewContext(id, context), undefined)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
