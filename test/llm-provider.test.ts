import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BENLAI_PROVIDER_ID, BenlaiLlmAdapter } from '../src/host/llm-provider.ts'

test('BenlaiLlmAdapter discovers models and streams text, reasoning, tool calls, and usage via platform-opc', async () => {
  let lastAuth = ''
  let lastChatBody: Record<string, any> = {}

  const server = createServer(async (req, res) => {
    lastAuth = String(req.headers.authorization ?? '')
    if (req.method === 'GET' && req.url === '/integration/v1/llm/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        configured: true,
        provider_name: '本来 AI',
        models: [
          { id: 'kimi-3.1', name: 'kimi-3.1', context_window: 131072, max_tokens: 8192, supports_reasoning: true },
          { id: 'minimax 3.1', name: 'minimax 3.1', supports_vision: true },
        ],
      }))
      return
    }
    if (req.method === 'POST' && req.url === '/integration/v1/llm/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      lastChatBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const events = [
        { choices: [{ index: 0, delta: { reasoning_content: '思考中' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: '你好，' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: '世界' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"abc"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } },
      ]
      for (const evt of events) {
        res.write(`data: ${JSON.stringify(evt)}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    const adapter = new BenlaiLlmAdapter({
      baseUrl: () => baseUrl,
      token: async () => 'platform-access-token',
    })

    const count = await adapter.refreshModels()
    assert.equal(count, 2)
    assert.deepEqual(adapter.providerInfo(BENLAI_PROVIDER_ID), { id: BENLAI_PROVIDER_ID, name: '本来 AI' })
    assert.equal(lastAuth, 'Bearer platform-access-token')

    const models = await adapter.listModels(BENLAI_PROVIDER_ID)
    assert.equal(models.length, 2)
    assert.equal(models[0].id, 'kimi-3.1')
    assert.deepEqual(models[0].inputModalities, ['text'])
    assert.equal(models[1].id, 'minimax 3.1')
    assert.deepEqual(models[1].inputModalities, ['text', 'image'])

    const resolved = await adapter.resolveModel(BENLAI_PROVIDER_ID, 'kimi-3.1')
    assert.equal(resolved.context?.contextWindow, 131072)

    const options = {
      provider: BENLAI_PROVIDER_ID,
      model: 'kimi-3.1',
      system: 'Be helpful.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '查一下商品' }] },
      ],
      tools: [
        { name: 'lookup', description: 'Lookup item', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
      ],
    } as unknown as GenerateOptions

    const streamed: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) {
      streamed.push(chunk)
    }

    assert.equal(lastChatBody.model, 'kimi-3.1')
    assert.equal(lastChatBody.stream, true)
    assert.equal(lastChatBody.messages[0].role, 'system')
    assert.equal(lastChatBody.messages[1].role, 'user')
    assert.equal(lastChatBody.tools[0].function.name, 'lookup')

    const reasoningEnd = streamed.find(c => c.type === 'block-end' && c.block.type === 'reasoning')
    assert.ok(reasoningEnd && reasoningEnd.type === 'block-end' && reasoningEnd.block.type === 'reasoning')
    assert.equal(reasoningEnd.block.text, '思考中')

    const textEnd = streamed.find(c => c.type === 'block-end' && c.block.type === 'text')
    assert.ok(textEnd && textEnd.type === 'block-end' && textEnd.block.type === 'text')
    assert.equal(textEnd.block.text, '你好，世界')

    const toolEnd = streamed.find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    assert.ok(toolEnd && toolEnd.type === 'block-end' && toolEnd.block.type === 'tool-call')
    assert.equal(toolEnd.block.name, 'lookup')
    assert.equal(toolEnd.block.arguments, '{"q":"abc"}')

    const usage = streamed.find(c => c.type === 'usage')
    assert.ok(usage && usage.type === 'usage')
    assert.equal(usage.usage.inputTokens, 12)
    assert.equal(usage.usage.outputTokens, 8)

    const finish = streamed.at(-1)
    assert.ok(finish && finish.type === 'finish')
    assert.equal(finish.reason.kind, 'tool-calls')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
