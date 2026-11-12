import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SkillProvider, SkillProviderControl, SkillCandidate, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { AppDelivery } from './app-delivery.ts'

export class AppSkillProvider implements SkillProvider {
  readonly name = 'opc-apps'
  constructor(private delivery: AppDelivery, control: SkillProviderControl) {
    const invalidate = () => control.invalidate()
    delivery.core.on('skills-changed', invalidate)
    control.signal.addEventListener('abort', () => delivery.core.off('skills-changed', invalidate), { once: true })
  }
  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    const expected = this.delivery.core.auth.contexts.applicationContextId
    if (!expected) return []
    const jobs = await this.delivery.list(expected)
    options.signal?.throwIfAborted()
    const seenSlugs = new Set<string>()
    const activeVerified = jobs.filter(job => {
      if (job.status !== 'verified') return false
      if (seenSlugs.has(job.slug)) return false
      seenSlugs.add(job.slug)
      return true
    })
    return activeVerified.map(job => ({ name: `app-${job.slug}`, description: `[OPC 应用] ${job.name}：${job.proposal?.contract?.description ?? ''}`,
      source: 'opc-apps', provider: this.name, rank: 350,
      invocation: { modelInvocable: true, userInvocable: true }, locator: { id: job.id, context: expected, version: job.version } }))
  }
  async get(candidate: SkillCandidate, options: SkillLookupOptions) {
    const locator = candidate.locator as { id: string; context: string; version: number }
    const { job } = await this.delivery.verifiedJob(locator.id, locator.context)
    if (job.version !== locator.version) return undefined
    options.signal?.throwIfAborted()
    const contract = job.proposal!.contract
    const invokeGuide = `使用 opc_app_invoke，job_id=${job.id}。参数 JSON 传 params，正文 JSON 传 body；不要直接读取凭据或使用 shell 调用。非只读操作会请求用户批准，失败时不得重复执行结果未知的写操作。`
    const body = job.skillMarkdown?.trim()
      ? `${job.skillMarkdown.trim()}\n\n## DSH 调用方式\n- ${invokeGuide}\n- 应用地址：${job.url}\n`
      : `# ${job.name}\n${contract.description}\n应用地址：${job.url}\n只读业务 API 已验证；页面未验证。\n${invokeGuide}\n接口与页面：\n${JSON.stringify({ apis: contract.apis, pages: contract.pages, workflows: contract.workflows }, null, 2)}`
    return { ...candidate, content: body }
  }
}

export function registerAppTools(ctx: Context, delivery: AppDelivery) {
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'opc_app_invoke', description: '调用已部署且业务验证通过的 OPC 应用。先加载 app-* 技能获得 job_id 与 operation。写入操作需要用户批准，结果未知时不要重试。',
    parameters: { job_id: { type: 'string', required: true }, operation: { type: 'string', required: true }, params: { type: 'string', required: true }, body: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_: unknown, value: string) => [{ type: 'text' as const, text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('需要对话身份')
      const expected = delivery.core.auth.contexts.applicationContextId
      if (!expected) throw new Error('请先登录企业微信')
      return JSON.stringify(await delivery.invoke(args.job_id, args.operation, JSON.parse(args.params), args.body ? JSON.parse(args.body) : undefined, expected,
        async reason => (await ctx.approval.request({ agent: exec.agent!, callId: exec.callId, toolName: 'opc_app_invoke', reason, signal: exec.signal })) === 'allowed-once', exec.signal))
    } })))
}
