import type { Context } from '@deepseek-ai/cordis'
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type AdapterRegistrationHandle,
  type FinishReason,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ModelModality,
  type RequestMessage,
  type StreamChunk,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { AuthManager } from './auth.ts'
import type { OpcCore } from './core.ts'

export const BENLAI_PROVIDER_ID = 'opc-benlai-ai'
export const DEFAULT_BENLAI_PROVIDER_NAME = '本来 AI'

export interface PlatformLlmModelDescriptor {
  id: string
  name?: string
  context_window?: number
  max_tokens?: number
  supports_vision?: boolean
  supports_reasoning?: boolean
}

export interface BenlaiLlmClient {
  baseUrl(): string
  token(): Promise<string>
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '')
}

function extractText(blocks: readonly RequestMessage['content'][number][]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

function serializeMessages(options: GenerateOptions): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  if (typeof options.system === 'string' && options.system.length > 0) {
    out.push({ role: 'system', content: options.system })
  }
  for (const msg of options.messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const content = extractText(msg.content)
      if (content.length > 0) out.push({ role: 'system', content })
      continue
    }
    if (msg.role === 'user') {
      out.push({ role: 'user', content: extractText(msg.content) })
      continue
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: extractText(msg.content),
      })
      continue
    }
    if (msg.role === 'assistant') {
      const text = extractText(msg.content)
      const toolCalls: NonNullable<OpenAIMessage['tool_calls']> = []
      for (const block of msg.content) {
        if (block.type === 'tool-call') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: block.arguments },
          })
        }
      }
      const entry: OpenAIMessage = {
        role: 'assistant',
        content: text.length > 0 ? text : toolCalls.length > 0 ? null : '',
      }
      if (toolCalls.length > 0) entry.tool_calls = toolCalls
      out.push(entry)
    }
  }
  return out
}

function mapHttpError(status: number, body: string): LlmError {
  const detail = body.trim().slice(0, 300) || `HTTP ${status}`
  if (status === 401 || status === 403) {
    return new LlmError(`本来 AI 鉴权失败：${detail}`, 'AUTH', { status })
  }
  if (status === 429) {
    return new LlmError(`本来 AI 请求频率受限：${detail}`, 'RATE_LIMIT', { status })
  }
  if (status === 400 || status === 422) {
    return new LlmError(`本来 AI 请求参数错误：${detail}`, 'INVALID_REQUEST', { status })
  }
  return new LlmError(`本来 AI 服务异常：${detail}`, `HTTP_${status}`, { status })
}

export class BenlaiLlmAdapter extends LlmAdapter {
  private providerName = DEFAULT_BENLAI_PROVIDER_NAME
  private catalog: PlatformLlmModelDescriptor[] = []

  constructor(private readonly client: BenlaiLlmClient) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providerName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.catalog.map(entry => ({
      provider,
      id: entry.id,
      name: entry.name || entry.id,
      inputModalities: (entry.supports_vision ? ['text', 'image'] : ['text']) as readonly ModelModality[],
    }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const entry = this.catalog.find(item => item.id === model)
    return {
      provider,
      id: model,
      name: entry?.name || model,
      ...(entry?.context_window && entry.context_window > 0 ? { context: { contextWindow: entry.context_window } } : {}),
      inputModalities: (entry?.supports_vision ? ['text', 'image'] : ['text']) as readonly ModelModality[],
    }
  }

  clearModels(): void {
    this.catalog = []
    this.providerName = DEFAULT_BENLAI_PROVIDER_NAME
  }

  async refreshModels(signal?: AbortSignal): Promise<number> {
    const token = await this.client.token()
    const base = normalizeBaseUrl(this.client.baseUrl())
    const response = await fetch(`${base}/integration/v1/llm/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...attributionHeaders(),
      },
      signal,
    })
    if (!response.ok) {
      throw mapHttpError(response.status, await response.text().catch(() => ''))
    }
    const payload = await response.json() as {
      configured?: boolean
      provider_name?: string
      models?: PlatformLlmModelDescriptor[]
    }
    this.providerName = typeof payload.provider_name === 'string' && payload.provider_name.trim()
      ? payload.provider_name.trim()
      : DEFAULT_BENLAI_PROVIDER_NAME
    this.catalog = payload.configured === false || !Array.isArray(payload.models)
      ? []
      : payload.models.filter((item): item is PlatformLlmModelDescriptor => Boolean(item && typeof item.id === 'string' && item.id.trim()))
    return this.catalog.length
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const token = await this.client.token()
    const base = normalizeBaseUrl(this.client.baseUrl())
    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages: serializeMessages(options),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    }
    if (typeof options.temperature === 'number') requestBody.temperature = options.temperature
    if (typeof options.maxTokens === 'number') requestBody.max_tokens = options.maxTokens
    if (options.stop && options.stop.length > 0) requestBody.stop = options.stop

    const response = await fetch(`${base}/integration/v1/llm/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...attributionHeaders(),
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    })
    if (!response.ok) {
      throw mapHttpError(response.status, await response.text().catch(() => ''))
    }
    if (!response.body) {
      throw new LlmError('本来 AI 未返回流式响应体', `HTTP_${response.status}`, { status: response.status })
    }

    let nextBlockIndex = 0
    let reasoningBlock: { index: number; text: string } | undefined
    let textBlock: { index: number; text: string } | undefined
    const toolBlocks = new Map<number, { index: number; id: ToolCallId; name: string; arguments: string }>()
    let finishKind: FinishReason['kind'] = 'stop'

    const closeReasoning = function* (): Generator<StreamChunk> {
      if (!reasoningBlock) return
      yield { type: 'block-end', index: reasoningBlock.index, block: { type: 'reasoning', text: reasoningBlock.text } }
      reasoningBlock = undefined
    }
    const closeText = function* (): Generator<StreamChunk> {
      if (!textBlock) return
      yield { type: 'block-end', index: textBlock.index, block: { type: 'text', text: textBlock.text } }
      textBlock = undefined
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let emittedUsage: {
      inputTokens: number
      outputTokens: number
      totalTokens?: number
      cacheReadTokens?: number
      reasoningTokens?: number
    } | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIdx = buffer.indexOf('\n')
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          newlineIdx = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string | null
                reasoning_content?: string | null
                reasoning?: string | null
                tool_calls?: Array<{
                  index?: number
                  id?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }>
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
              total_tokens?: number
              prompt_tokens_details?: { cached_tokens?: number }
              completion_tokens_details?: { reasoning_tokens?: number }
            }
          }
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }

          if (parsed.usage) {
            const cached = parsed.usage.prompt_tokens_details?.cached_tokens ?? 0
            const rawInput = parsed.usage.prompt_tokens ?? 0
            emittedUsage = {
              inputTokens: Math.max(0, rawInput - cached),
              outputTokens: parsed.usage.completion_tokens ?? 0,
              ...(typeof parsed.usage.total_tokens === 'number' ? { totalTokens: parsed.usage.total_tokens } : {}),
              ...(cached > 0 ? { cacheReadTokens: cached } : {}),
              ...(typeof parsed.usage.completion_tokens_details?.reasoning_tokens === 'number'
                ? { reasoningTokens: parsed.usage.completion_tokens_details.reasoning_tokens }
                : {}),
            }
          }

          const choice = parsed.choices?.[0]
          if (!choice) continue
          const delta = choice.delta
          if (delta) {
            const reasoningChunk = typeof delta.reasoning_content === 'string'
              ? delta.reasoning_content
              : typeof delta.reasoning === 'string'
              ? delta.reasoning
              : ''
            if (reasoningChunk) {
              yield* closeText()
              if (!reasoningBlock) {
                reasoningBlock = { index: nextBlockIndex++, text: '' }
                yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
              }
              reasoningBlock.text += reasoningChunk
              yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoningChunk }
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              yield* closeReasoning()
              if (!textBlock) {
                textBlock = { index: nextBlockIndex++, text: '' }
                yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
              }
              textBlock.text += delta.content
              yield { type: 'text-delta', index: textBlock.index, text: delta.content }
            }

            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
              yield* closeReasoning()
              yield* closeText()
              for (const tc of delta.tool_calls) {
                const slot = tc.index ?? 0
                let entry = toolBlocks.get(slot)
                if (!entry) {
                  const id = (tc.id || `call_${slot}`) as ToolCallId
                  entry = {
                    index: nextBlockIndex++,
                    id,
                    name: tc.function?.name ?? '',
                    arguments: '',
                  }
                  toolBlocks.set(slot, entry)
                  yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
                } else {
                  if (tc.id) entry.id = tc.id as ToolCallId
                  if (tc.function?.name) entry.name += tc.function.name
                }
                const argDelta = tc.function?.arguments ?? ''
                if (argDelta || tc.function?.name) {
                  entry.arguments += argDelta
                  yield {
                    type: 'tool-call-delta',
                    index: entry.index,
                    id: entry.id,
                    ...(tc.function?.name ? { name: entry.name } : {}),
                    argumentsDelta: argDelta,
                  }
                }
              }
            }
          }

          if (choice.finish_reason === 'tool_calls') finishKind = 'tool-calls'
          else if (choice.finish_reason === 'length') finishKind = 'max-tokens'
          else if (choice.finish_reason === 'stop') finishKind = 'stop'
        }
      }
    } finally {
      reader.releaseLock()
    }

    yield* closeReasoning()
    yield* closeText()
    for (const entry of toolBlocks.values()) {
      yield {
        type: 'block-end',
        index: entry.index,
        block: { type: 'tool-call', id: entry.id, name: entry.name, arguments: entry.arguments },
      }
    }
    if (emittedUsage) {
      yield { type: 'usage', usage: emittedUsage }
    }
    if (toolBlocks.size > 0 && finishKind === 'stop') {
      finishKind = 'tool-calls'
    }
    const reason: FinishReason = finishKind === 'tool-calls'
      ? { kind: 'tool-calls' }
      : finishKind === 'max-tokens'
      ? { kind: 'max-tokens' }
      : { kind: 'stop' }
    yield { type: 'finish', reason }
  }
}

export function mountBenlaiLlmProvider(ctx: Context, auth: AuthManager, core: OpcCore): () => void {
  const adapter = new BenlaiLlmAdapter({
    baseUrl: () => auth.http.base.origin,
    token: () => auth.token(),
  })
  let registration: AdapterRegistrationHandle | undefined
  let active = false
  let disposed = false
  let generation = 0

  const setActive = (next: boolean): void => {
    if (disposed) return
    if (next) {
      if (!registration) {
        registration = ctx.llm.registerAdapter([BENLAI_PROVIDER_ID], adapter)
      } else if (!active) {
        registration.replace([BENLAI_PROVIDER_ID])
      }
      active = true
      ctx.emit('llm/models-updated', BENLAI_PROVIDER_ID)
    } else {
      if (registration && active) {
        registration.replace([])
      }
      active = false
    }
  }

  const sync = (): void => {
    const rev = ++generation
    if (!auth.state.signedIn) {
      adapter.clearModels()
      setActive(false)
      return
    }
    void adapter.refreshModels().then(count => {
      if (disposed || rev !== generation) return
      setActive(count > 0)
    }).catch(() => {
      if (disposed || rev !== generation) return
      adapter.clearModels()
      setActive(false)
    })
  }

  auth.on('change', sync)
  core.on('change', sync)
  sync()

  return () => {
    disposed = true
    auth.off('change', sync)
    core.off('change', sync)
    if (registration) {
      registration()
      registration = undefined
    }
    active = false
  }
}
