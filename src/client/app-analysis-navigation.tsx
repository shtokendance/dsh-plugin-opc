import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { workbenchKind } from './Workbench.tsx'

export type PrepareAnalysisNavigation = (
  origin: string,
  contextId: string,
  isActive: () => boolean,
) => (job: AppDeliveryJob) => void

function OpenAnalysisSidebar({ open }: { open: () => void }) {
  useEffect(() => { open() }, [open])
  return null
}

export function registerAnalysisNavigation(ctx: Context, api: OpcApi): PrepareAnalysisNavigation {
  let attempt = 0
  let pending: string | undefined
  const sidebar = ctx.get('sidebarRight')
  const currentSession = () => sidebar?.mounted?.getSnapshot()

  if (sidebar?.mounted) {
    ctx.effect(() => sidebar.mounted.subscribe(() => {
      attempt++
      if (pending && currentSession() !== pending) pending = undefined
    }))
  }
  ctx.effect(() => () => { attempt++; pending = undefined })
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'opc-app-analysis-sidebar',
    inject: sessionId => ({
      open: () => {
        if (pending !== sessionId || currentSession() !== sessionId) return
        pending = undefined
        try { sidebar?.openTab(workbenchKind, { params: { opcPage: 'apps' } }) }
        catch { /* The task can still be opened manually in this session. */ }
      },
    }),
  }, OpenAnalysisSidebar)))

  return (origin, contextId, isActive) => {
    const started = ++attempt
    const canNavigate = () => attempt === started && isActive() && currentSession() === origin
    return (job) => {
      const workspace = ctx.get('uiWorkspace')
      if (!workspace || !sidebar || !canNavigate()) return
      void (async () => {
        let current = job
        while (canNavigate()) {
          const target = current.analysisSessionId
          if (target) {
            if (target !== origin) {
              pending = target
              try { workspace.openSession(target as Parameters<typeof workspace.openSession>[0]) }
              catch { pending = undefined }
            }
            return
          }
          if ((current.status !== 'analyzing' && !current.analysisChatStarting) || !api.appJob) return
          await new Promise(resolve => setTimeout(resolve, 500))
          if (!canNavigate()) return
          current = JSON.parse(await api.appJob(job.id, contextId)) as AppDeliveryJob
        }
      })().catch(() => {
        // The task remains accessible from the applications list if navigation fails.
      })
    }
  }
}
