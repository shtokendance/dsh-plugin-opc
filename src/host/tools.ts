import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import { OpcCore } from './core.ts'
import { OpcError } from './context.ts'

export function registerTools(ctx: Context, core: OpcCore): void {
  const turns = new Map<string, { turn: string; epoch: number }>()
  const scope = (exec: ToolRunContext) => {
    if (!exec.agent) throw new OpcError('AGENT_REQUIRED')
    const session = String(exec.agent.session.id)
    const boundary = ctx.agents.turnBoundaryOf(exec.agent.session)
    if (boundary.openTurnStartSeq === null) throw new OpcError('TURN_REQUIRED')
    const turn = String(boundary.openTurnStartSeq)
    const old = turns.get(session)
    if (old?.turn !== turn || old.epoch !== core.auth.contexts.epoch) {
      if (old) core.scopes.end(session, old.turn)
      const messages = exec.agent.session.snapshotEvents().slice(boundary.openTurnStartSeq)
      const prompt = messages.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
        ? event.data.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('\n')
      core.scopes.begin(session, turn, prompt)
      turns.set(session, { turn, epoch: core.auth.contexts.epoch })
    }
    return { session, turn }
  }
  const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'opc_knowledge_search', description: '检索当前企业空间知识库；遇到 OPC 知识库引用时只传 query，宿主从本轮引用确定空间和知识库；再用 opc_knowledge_read 读取命中正文并注明文档名。',
    parameters: { query: { type: 'string', required: true }, space: { type: 'string' }, knowledge_base_id: { type: 'string' } },
    output,
    async execute(args, exec) { const s = scope(exec); return JSON.stringify(await core.search(s.session, s.turn, args.query, args.space, args.knowledge_base_id)) },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'opc_knowledge_read', description: '读取企业知识文档；限定模式下只能读取本轮检索命中的文档。',
    parameters: { knowledge_id: { type: 'string', required: true } }, output,
    async execute(args, exec) { const s = scope(exec); return JSON.stringify(await core.read(s.session, s.turn, args.knowledge_id)) },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'opc_mcp_invoke', description: '调用当前空间企业 MCP 工具。高敏操作需用户审批；UNKNOWN_OUTCOME 时禁止自动重试。',
    parameters: { service_id: { type: 'string', required: true }, tool_name: { type: 'string', required: true }, arguments: { type: 'object', additionalProperties: true } }, output,
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new OpcError('AGENT_REQUIRED')
      return JSON.stringify(await core.mcp.invoke({ serviceId: args.service_id, toolName: args.tool_name, arguments: args.arguments }, prompt => ctx.approval.request({ agent, callId: exec.callId, toolName: 'opc_mcp_invoke', reason: `企业操作 ${prompt.serviceId}/${prompt.toolName}\n${JSON.stringify(prompt.arguments)}`, signal: prompt.signal }), exec.signal))
    },
  })))
}
