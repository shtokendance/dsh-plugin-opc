import { OpcIcon } from './branding.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { AuthState, OpcApi, Resource } from './api.ts'

export function registerMentions(ctx: Context, api: OpcApi) {
  const source: InputTriggerSource = {
    name: 'OPC 知识库', trigger: '@',
    async candidates(_session, { query, signal, quoted }) {
      if (quoted || signal.aborted) return []
      const state: AuthState = JSON.parse(await api.state())
      if (!state.context || state.knowledgeMentionScopeVersion !== 1) return []
      const term = query.replace(/^opc\s*/i, '')
      const parsed = JSON.parse(await api.listKnowledgeBases(term)) as Resource[] | { items?: Resource[] }
      const rows: Resource[] = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
      const after: AuthState = JSON.parse(await api.state())
      if (signal.aborted || after.knowledgeMentionScopeVersion !== 1 || after.context?.contextId !== state.context.contextId) return []
      const multiSpace = state.context.spaces.length > 1
      const spaceNames = new Map((state.context.spacesDetail ?? []).map(space => [space.id, space.name]))
      return rows.filter(row => row.knowledge_base_id && state.context!.spaces.includes(row.tenant_id)).map(row => {
        const isShared = Boolean(row.source_tenant_id && row.source_tenant_id !== row.tenant_id)
        const ownerSpace = isShared
          ? (row.source_tenant_name || spaceNames.get(row.source_tenant_id!) || row.source_tenant_id!)
          : (row.tenant_name || spaceNames.get(row.tenant_id) || row.tenant_id)
        const displayLabel = multiSpace || isShared ? `${row.name}（${ownerSpace}）` : row.name
        return {
          name: `opc ${row.name} ${ownerSpace}`,
          label: displayLabel,
          section: 'OPC 知识库',
          icon: OpcIcon,
          value: `opc-kb:${state.context!.contextId}/${encodeURIComponent(row.tenant_id)}/${encodeURIComponent(row.knowledge_base_id!)}`,
        }
      })
    },
    onPick({ candidate }) {
      if (!candidate.value) return
      return { insert: { source: source.name, label: candidate.label ?? candidate.name, ref: candidate.value, clipboardText: candidate.value } }
    },
    codec: { clipboardText: ref => ref, serialize: async ref => '[OPC 知识库](' + ref + ')' },
  }
  const triggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => triggers.registerSource(source))
}
