import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { attachAppAgent } from '../src/host/app-agent.ts'
import { AppDelivery, fingerprint } from '../src/host/app-delivery.ts'
import { ContextStore, identityHash } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

test('the chosen agent resumes the existing review conversation and uses only its open draft', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-config-chat-'))
  const controller = new AbortController()
  let stream: AsyncIterator<string> | undefined
  try {
    const contexts = new ContextStore()
    contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
    const context = contexts.applicationContextId!
    const core = Object.assign(new EventEmitter(), { auth: { contexts } }) as unknown as OpcCore
    const delivery = new AppDelivery(core, home, { read: async () => ({}), write: async () => {} })
    const id = 'd8f86cd1-1f7d-4771-a96b-37e1b62c8827'
    const session = '58f5cbf4-db2a-4e02-970d-21bf73b3baec'
    const hashes = { 'app.tar': 'app-fixture' }
    const artifact = fingerprint(hashes)
    const root = join(home, 'opc', 'apps', identityHash(contexts.current!), id)
    const job = { id, name: '测试应用', slug: 'test-app', status: 'ready', analysisSessionId: session, hashes,
      modelSelection: { provider: 'fixture', model: 'chosen-model' } }
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'job.json'), JSON.stringify(job))

    const tools = new Map<string, { execute: (params: any, state: any) => Promise<string>; when: () => boolean }>()
    let onStep: (event: any, next: any) => Promise<unknown> = async () => { throw new Error('Review handler missing') }
    const child = {
      tools: { restrict() {}, register(definition, options) { tools.set(definition.name, { execute: definition.execute, when: options.when }) } },
      systemPrompt: { section() {} },
      on(event, listener) { assert.equal(event, 'agent/pre-step'); onStep = listener },
    }
    const fakeContext = {
      agents: { get: () => undefined, async resume({ resumeSessionId, agentOptions, setup }) {
        assert.equal(resumeSessionId, session)
        assert.equal(agentOptions.model, 'chosen-model')
        setup(child)
        return { agent: { session: { id: session } }, dispose: async () => {} }
      } },
      effect() {},
    }
    attachAppAgent(fakeContext as any, delivery)
    await assert.rejects(() => delivery.watchConfigChat(id, artifact, 'unrelated', context, controller.signal).next(), /当前部署会话/)
    await assert.rejects(() => delivery.watchConfigChat(id, 'stale-artifact', session, context, controller.signal).next(), /交付版本/)
    stream = delivery.watchConfigChat(id, artifact, session, context, controller.signal)
    assert.deepEqual(JSON.parse((await stream.next()).value), { type: 'ready' })

    const message = { source: { kind: 'user', rpcId: 'fixture' }, content: [{ type: 'text', text: '把登录有效期改为 24 小时' }] }
    const decision = { kind: 'enter', messages: [message] }
    const signal = controller.signal
    assert.equal(await onStep({ signal }, async () => decision), decision)
    const read = tools.get('opc_config_read')!
    const edit = tools.get('opc_config_edit')!
    assert.equal(read.when(), true)
    await assert.rejects(() => edit.execute({ changes: [{ key: 'TOKEN_TTL', value: '24' }] }, { signal }), /先读取/)
    const reading = read.execute({}, { signal })
    const readRequest = JSON.parse((await stream.next()).value)
    assert.equal(readRequest.action.type, 'read')
    const rows = [{ key: 'TOKEN_TTL', value: '12', description: '登录有效期' }]
    await assert.rejects(() => delivery.replyConfigChat(id, 'wrong-request', JSON.stringify({ rows }), context), /请求/)
    await delivery.replyConfigChat(id, readRequest.id, JSON.stringify({ rows }), context)
    assert.deepEqual(JSON.parse(await reading), { rows })

    const editing = edit.execute({ changes: [{ key: 'TOKEN_TTL', value: '24' }] }, { signal })
    const editRequest = JSON.parse((await stream.next()).value)
    assert.deepEqual(editRequest.action.expected, rows)
    await delivery.replyConfigChat(id, editRequest.id, JSON.stringify({ changed: ['TOKEN_TTL'] }), context)
    assert.deepEqual(JSON.parse(await editing), { changed: ['TOKEN_TTL'] })
    await writeFile(join(root, 'job.json'), JSON.stringify({ ...job, status: 'publishing' }))
    await assert.rejects(() => read.execute({}, { signal }), /交付版本/)
    controller.abort()
    assert.equal((await stream.next()).done, true)
    assert.equal(read.when(), false)
  } finally {
    controller.abort()
    await stream?.return?.()
    await rm(home, { recursive: true, force: true })
  }
})
