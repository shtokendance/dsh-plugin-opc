import { randomUUID } from 'node:crypto'
import type { ConfigChatAction, ConfigChatChanges, ConfigChatFrame, ConfigChatResult, ConfigChatRow } from '../config-chat.ts'

type PendingRequest = {
  frame: Extract<ConfigChatFrame, { type: 'request' }>
  sent: boolean
  resolve: (result: ConfigChatResult) => void
}

type ReviewConnection = {
  controller: AbortController
  verify: () => Promise<void>
  pending: Map<string, PendingRequest>
  observed?: ConfigChatRow[]
  wake?: () => void
}

export class ConfigChat {
  private readonly connections = new Map<string, ReviewConnection>()

  has(job: string, context: string) {
    return this.connections.get(context + ':' + job)?.controller.signal.aborted === false
  }

  async *connect(job: string, context: string, verify: () => Promise<void>, attach: () => Promise<void>, signal: AbortSignal): AsyncIterable<ConfigChatFrame> {
    const key = context + ':' + job
    const controller = new AbortController()
    const connection: ReviewConnection = { controller, verify, pending: new Map() }
    const stop = () => {
      controller.abort(new Error('部署核对页面已关闭，请重新打开第三步'))
      connection.wake?.()
    }
    signal.throwIfAborted()
    signal.addEventListener('abort', stop, { once: true })
    this.connections.get(key)?.controller.abort(new Error('已切换到新的部署核对页面'))
    this.connections.get(key)?.wake?.()
    this.connections.set(key, connection)
    try {
      await attach()
      if (controller.signal.aborted) return
      yield { type: 'ready' }
      while (!controller.signal.aborted) {
        const request = [...connection.pending.values()].find(item => !item.sent)
        if (!request) {
          await new Promise<void>(resolve => { connection.wake = resolve })
          connection.wake = undefined
          continue
        }
        request.sent = true
        yield request.frame
      }
    } finally {
      stop()
      signal.removeEventListener('abort', stop)
      if (this.connections.get(key) === connection) this.connections.delete(key)
    }
  }

  private connection(job: string, context: string) {
    const connection = this.connections.get(context + ':' + job)
    if (!connection || connection.controller.signal.aborted) throw new Error('请打开当前部署的第三步核对页面')
    return connection
  }

  async read(job: string, context: string, signal: AbortSignal) {
    const connection = this.connection(job, context)
    const result = await this.request(connection, { type: 'read' }, signal)
    if (!('rows' in result) || !Array.isArray(result.rows)) throw new Error('未收到配置草稿')
    connection.observed = result.rows
    return result
  }

  async edit(job: string, context: string, changes: ConfigChatChanges, signal: AbortSignal) {
    const connection = this.connection(job, context)
    const expected = connection.observed
    if (!expected) throw new Error('请先读取当前部署配置草稿')
    if (!Array.isArray(changes) || !changes.length || changes.length > 256 ||
        changes.some(row => !row || typeof row.key !== 'string' || typeof row.value !== 'string' || row.value.length > 16384 || row.value.includes('\0')) ||
        new Set(changes.map(row => row.key)).size !== changes.length) throw new Error('请提供不同配置项的有效新值')
    const keys = new Set(changes.map(row => row.key))
    const previous = expected.filter(row => keys.has(row.key))
    if (previous.length !== changes.length) throw new Error('请只修改当前草稿已有的配置项')
    const blocked = previous.find(row => row.blocked)
    if (blocked) throw new Error(`${blocked.key}：${blocked.blocked}`)
    connection.observed = undefined
    const result = await this.request(connection, { type: 'edit', changes, expected: previous }, signal)
    if (!('changed' in result) || !Array.isArray(result.changed)) throw new Error('未收到草稿保存结果')
    return result
  }

  async reply(job: string, context: string, id: string, result: ConfigChatResult) {
    const connection = this.connection(job, context)
    const pending = connection.pending.get(id)
    if (!pending?.sent) throw new Error('配置草稿请求已结束')
    pending.resolve(result)
  }

  private async request(connection: ReviewConnection, action: ConfigChatAction, signal: AbortSignal) {
    await connection.verify()
    const scope = AbortSignal.any([signal, connection.controller.signal, AbortSignal.timeout(15_000)])
    scope.throwIfAborted()
    const id = randomUUID()
    let abort: (() => void) | undefined
    try {
      const result = await new Promise<ConfigChatResult>((resolve, reject) => {
        abort = () => reject(scope.reason)
        scope.addEventListener('abort', abort, { once: true })
        connection.pending.set(id, { frame: { type: 'request', id, action }, sent: false, resolve })
        connection.wake?.()
      })
      if ('error' in result) throw new Error(result.error)
      return result
    } finally {
      connection.pending.delete(id)
      if (abort) scope.removeEventListener('abort', abort)
    }
  }
}
