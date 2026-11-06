import { createServer, type Server } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { OpcCore } from './core.ts'
import { OpcError } from './context.ts'
import type { RequestApproval } from './mcp.ts'

export function mcpMountName(id: string): string { return `opc-${createHash('sha256').update(id).digest('hex').slice(0, 16)}` }
interface Registration { toolCallTimeoutMs: number; transport: 'streamable-http'; url: string; headers: Record<string, string> }
interface Mounted { epoch: number; server: Server; dispose: () => void }
/** Local MCP transport forwards every tool through platform policy, never leaking enterprise tokens. */
export class ManagedMcpMounts {
  #mounts = new Map<string, Mounted>()
  constructor(private readonly core: OpcCore, private readonly register: (name: string, entry: Registration) => () => void, private readonly approve: RequestApproval) {
    core.auth.on('change', this.changed)
  }
  private changed = () => {
    for (const [id, mount] of this.#mounts) if (mount.epoch !== this.core.auth.contexts.epoch) this.unmount(id)
  }
  list(): string[] { return [...this.#mounts.keys()] }
  unmount(id: string): void {
    const mount = this.#mounts.get(id)
    if (!mount) return
    this.#mounts.delete(id); mount.dispose(); mount.server.closeAllConnections(); mount.server.close()
    this.core.emit('change')
  }
  async mount(serviceId: string, expectedContextId: string): Promise<void> {
    const captured = this.core.auth.contexts.capture(expectedContextId)
    if (this.#mounts.has(serviceId)) return
    const body = await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(captured.context.tenant)}`)
    captured.assertCurrent()
    const data = body.data as { services?: Record<string, unknown>[] } | undefined
    const service = data?.services?.find(item => item.service_id === serviceId)
    if (!service || !Array.isArray(service.tools)) throw new OpcError('RESOURCE_NOT_ACCESSIBLE')
    const tools = service.tools.map((item: unknown) => {
      if (typeof item === 'string') return { name: item, inputSchema: { type: 'object', additionalProperties: true } }
      if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string') throw new OpcError('INVALID_TOOL_CATALOG')
      const tool = item as Record<string, unknown>
      return { name: item.name, description: typeof tool.description === 'string' ? tool.description : '', inputSchema: tool.input_schema ?? tool.inputSchema ?? { type: 'object', additionalProperties: true } }
    })
    const secret = randomBytes(32).toString('hex')
    const expected = Buffer.from(`Bearer ${secret}`)
    const server = createServer((request, response) => {
      const auth = Buffer.from(request.headers.authorization ?? '')
      if (request.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) { response.writeHead(401).end(); return }
      if (request.method !== 'POST' || request.url !== '/mcp') { response.writeHead(405, { Allow: 'POST' }).end(); return }
      const controller = new AbortController()
      response.on('close', () => { if (!response.writableFinished) controller.abort() })
      void (async () => {
        let rpc: Record<string, unknown> = {}
        try {
          captured.assertCurrent()
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new OpcError('REQUEST_TOO_LARGE'); chunks.push(Buffer.from(chunk)) }
          rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw new OpcError('INVALID_REQUEST')
          if (rpc.id === undefined) { response.writeHead(202).end(); return }
          let result: unknown
          const params = rpc.params as Record<string, unknown> | undefined
          switch (rpc.method) {
            case 'initialize': result = { protocolVersion: params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: `opc-${serviceId}`, version: '0.1.0' } }; break
            case 'ping': result = {}; break
            case 'tools/list': result = { tools }; break
            case 'tools/call': {
              if (!params || typeof params.name !== 'string' || !tools.some(tool => tool.name === params.name)) throw new OpcError('UNKNOWN_TOOL')
              const args = params.arguments ?? {}
              if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OpcError('INVALID_ARGUMENTS')
              const output = await this.core.mcp.invoke({ serviceId, toolName: params.name, arguments: args as Record<string, unknown>, contextId: expectedContextId }, this.approve, controller.signal)
              result = output && typeof output === 'object' && 'content' in output && Array.isArray(output.content) ? output : { content: [{ type: 'text', text: JSON.stringify(output ?? null) }] }
              break
            }
            default: throw new OpcError('METHOD_NOT_FOUND')
          }
          captured.assertCurrent()
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
        } catch (error) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: error instanceof OpcError ? error.code : 'MCP_REQUEST_FAILED' } }))
        }
      })()
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    try {
      captured.assertCurrent()
      const address = server.address()
      if (!address || typeof address === 'string') throw new OpcError('MCP_LISTEN_FAILED')
      if (this.#mounts.has(serviceId)) { server.close(); return }
      const dispose = this.register(mcpMountName(serviceId), { toolCallTimeoutMs: 125_000, transport: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: `Bearer ${secret}` } })
      this.#mounts.set(serviceId, { server, dispose, epoch: captured.epoch }); this.core.emit('change')
    } catch (error) { server.close(); throw error }
  }
  dispose(): void { this.core.auth.off('change', this.changed); for (const id of this.list()) this.unmount(id) }
}
