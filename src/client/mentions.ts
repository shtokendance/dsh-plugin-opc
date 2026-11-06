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
      if (!state.context) return []
      const term = query.replace(/^opc\s*/i, '')
      const rows: Resource[] = JSON.parse(await api.listKnowledgeBases(term))
      const after: AuthState = JSON.parse(await api.state())
      if (signal.aborted || after.context?.contextId !== state.context.contextId) return []
      return rows.filter(row => row.knowledge_base_id && row.tenant_id === state.context!.tenant).map(row => ({
        name: 'opc ' + row.name, label: row.name, section: 'OPC 知识库', icon: OpcIcon,
        value: 'opc-kb:' + state.context!.contextId + '/' + encodeURIComponent(row.knowledge_base_id!),
      }))
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
