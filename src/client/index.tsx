import { registerMentions } from './mentions.ts'
import { labels, OpcIcon } from './branding.tsx'
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { contribution } from '../remote-contract.ts'
import { Panel, type PanelKind } from './Panel.tsx'
import type { OpcApi } from './api.ts'

type WireApi = { [K in keyof OpcApi]: NonNullable<OpcApi[K]> extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : OpcApi[K] }
declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertRemoteNamespaceMap { opc: WireApi } }
export const inject = ['remote']
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(contribution)
  ctx.effect(() => dispose)
  ctx.plugin({ name: 'opc-enterprise-panels', inject: ['remote.opc', 'slots', 'sidebarRightTabs'], apply: registerPanels })
}
function registerPanels(ctx: Context): void {
  const wire = ctx.remote.opc
  const unwrap = async <T,>(result: Promise<RemoteResult<T>>): Promise<T> => {
    const value = await result
    if (!value.ok) throw value.error
    return value.value
  }
  const api: OpcApi = {
    appCatalog: (...args) => unwrap(wire.appCatalog(...args)),
    appList: (...args) => unwrap(wire.appList(...args)),
    appJob: (...args) => unwrap(wire.appJob!(...args)),
    appCheckSlug: (...args) => unwrap(wire.appCheckSlug!(...args)),
    appOpcConfig: (...args) => unwrap(wire.appOpcConfig!(...args)),
    appPickSourceFolder: (...args) => unwrap(wire.appPickSourceFolder!(...args)),
    appModels: (...args) => unwrap(wire.appModels(...args)),
    appCreate: (...args) => unwrap(wire.appCreate(...args)),
    appAnalyze: (...args) => unwrap(wire.appAnalyze(...args)),
    appAnalyzeWithMode: (...args) => unwrap(wire.appAnalyzeWithMode!(...args)),
    appPrepare: (...args) => unwrap(wire.appPrepare(...args)),
    appCancelAnalysis: (...args) => unwrap(wire.appCancelAnalysis!(...args)),
    appConfigDraft: (...args) => unwrap(wire.appConfigDraft!(...args)),
    appSaveConfigDraft: (...args) => unwrap(wire.appSaveConfigDraft!(...args)),
    appLocalArtifact: (...args) => unwrap(wire.appLocalArtifact!(...args)),
    appSaveLocalArtifact: (...args) => unwrap(wire.appSaveLocalArtifact!(...args)),
    appHandoff: (...args) => unwrap(wire.appHandoff!(...args)),
    appSkillPreview: (...args) => unwrap(wire.appSkillPreview(...args)),
    appConfirmDeployment: (...args) => unwrap(wire.appConfirmDeployment(...args)),
    appPublish: (...args) => unwrap(wire.appPublish(...args)),
    appVerify: (...args) => unwrap(wire.appVerify(...args)),
    appResources: (...args) => unwrap(wire.appResources(...args)),
    appDetails: (...args) => unwrap(wire.appDetails(...args)),
    appReopenReview: (...args) => unwrap(wire.appReopenReview!(...args)),
    appReopenDeployment: (...args) => unwrap(wire.appReopenDeployment(...args)),
    appVerifyWithOptions: (...args) => unwrap(wire.appVerifyWithOptions!(...args)),
    appSetSkillEnabled: (...args) => unwrap(wire.appSetSkillEnabled!(...args)),
    appVersions: (...args) => unwrap(wire.appVersions!(...args)),
    appLogs: (...args) => unwrap(wire.appLogs!(...args)),
    appStorage: (...args) => unwrap(wire.appStorage!(...args)),
    appRecheck: (...args) => unwrap(wire.appRecheck!(...args)),
    appUpdateConfig: (...args) => unwrap(wire.appUpdateConfig!(...args)),
    appDelete: (...args) => unwrap(wire.appDelete!(...args)),
    appRollback: (...args) => unwrap(wire.appRollback!(...args)),
    appDownload: (...args) => unwrap(wire.appDownload!(...args)),
    appSaveDownload: (...args) => unwrap(wire.appSaveDownload(...args)),
    state: () => unwrap(wire.state()),
    watchState: signal => wire.watchState(signal),
    startLogin: () => unwrap(wire.startLogin()),
    cancelLogin: () => unwrap(wire.cancelLogin()),
    logout: () => unwrap(wire.logout()),
    switchTenant: tenant => unwrap(wire.switchTenant(tenant)),
    listKnowledgeBases: q => unwrap(wire.listKnowledgeBases(q)),
    listSkillsCatalog: q => unwrap(wire.listSkillsCatalog(q)),
    installSkill: (...args) => unwrap(wire.installSkill(...args)),
    setSkillEnabled: (...args) => unwrap(wire.setSkillEnabled(...args)),
    uninstallSkill: (...args) => unwrap(wire.uninstallSkill(...args)),
    setPinnedKnowledgeScope: (...args) => unwrap(wire.setPinnedKnowledgeScope(...args)),
    searchKnowledge: (...args) => unwrap(wire.searchKnowledge(...args)),
    readKnowledgeDocument: (...args) => unwrap(wire.readKnowledgeDocument(...args)),
    mountMcpService: (...args) => unwrap(wire.mountMcpService(...args)),
    unmountMcpService: (...args) => unwrap(wire.unmountMcpService(...args)),
    listMcpServices: () => unwrap(wire.listMcpServices()),
    invokeMcpTool: (...args) => unwrap(wire.invokeMcpTool(...args)),
    decideDebugInvocation: (...args) => unwrap(wire.decideDebugInvocation(...args)),
  }
  ctx.inject(['inputTriggers'], child => registerMentions(child, api))
  for (const [index, kind] of (['knowledge', 'skills', 'mcp', 'apps'] as const).entries()) {
    const id = `dsh-plugin-opc/${kind}`
    ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind: `opc-${kind}`, priority: 'extension', title: () => labels[kind], guide: [{ id: `opc-${kind}`, order: 10 + index, icon: OpcIcon, title: () => labels[kind], description: () => 'OPC 工作空间' }] }))
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, () => <><OpcIcon /> {labels[kind]}</>)))
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id, inject: sessionId => ({ api, sessionId: String(sessionId), kind }) }, Panel)))
  }
}
