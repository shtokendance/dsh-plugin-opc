import { registerMentions } from './mentions.ts'
import { getModuleLabel, OpcIcon } from './branding.tsx'
import React, { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { contribution } from '../remote-contract.ts'
import { Panel } from './Panel.tsx'
import type { OpcApi } from './api.ts'
import { registerAnalysisNavigation } from './app-analysis-navigation.tsx'
import { bindDshLocaleRuntime, getActiveClientLocale, LocaleProvider, translate, type DshLocaleRuntime } from './i18n.tsx'
import { modules, readWorkbenchPage, workbenchKind, type ModuleKind } from './Workbench.tsx'

type WorkbenchBodyProps = Pick<React.ComponentProps<typeof Panel>, 'api' | 'sessionId' | 'prepareAnalysisNavigation' | 'onOpenPluginDetail'> &
  PropsRuntime<'sidebar.right.pane.tab'>

function WorkbenchBody({ useTabInfo, ...props }: WorkbenchBodyProps) {
  const { tab } = useTabInfo()
  return (
    <LocaleProvider>
      <Panel {...props} requestedPage={readWorkbenchPage(tab.navigation.params)} navigationRevision={tab.navigation.revision} visible={tab.visible} />
    </LocaleProvider>
  )
}

function LegacyModule({ useTabInfo, legacyPage }: PropsRuntime<'sidebar.right.pane.tab'> & { legacyPage: ModuleKind }) {
  const { tab } = useTabInfo()
  useEffect(() => {
    if (!tab.visible) return
    tab.actions.openTab(workbenchKind, { replaceTab: true, params: { opcPage: legacyPage } })
    tab.actions.close()
  }, [tab.actions, tab.visible, legacyPage])
  return <p role="status">{translate(getActiveClientLocale(), "workbench.openingOpcWorkbench")}</p>
}

type WireApi = { [K in keyof OpcApi]: NonNullable<OpcApi[K]> extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<RemoteResult<R>> : OpcApi[K] }
declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertRemoteNamespaceMap { opc: WireApi } }
export const inject = ['remote']
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(contribution)
  ctx.effect(() => dispose)
  ctx.plugin({ name: 'opc-enterprise-panels', inject: ['remote.opc', 'slots', 'sidebarRightTabs'], apply: registerPanels })
}
function registerPanels(ctx: Context): void {
  const localeRuntime = (ctx as unknown as { locale?: DshLocaleRuntime }).locale
  if (localeRuntime) bindDshLocaleRuntime(localeRuntime)
  ctx.inject(['locale'] as never, (child: unknown) => {
    const loc = (child as { locale?: DshLocaleRuntime }).locale
    if (loc) bindDshLocaleRuntime(loc)
  })
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
    appJobByAnalysisSession: (...args) => unwrap(wire.appJobByAnalysisSession!(...args)),
    appCheckSlug: (...args) => unwrap(wire.appCheckSlug!(...args)),
    opcConfigGet: () => unwrap(wire.opcConfigGet!()),
    opcConfigUpdate: (payloadJson: string) => unwrap(wire.opcConfigUpdate!(payloadJson)),
    opcConfigReset: () => unwrap(wire.opcConfigReset!()),
    opcConfigTest: (url: string) => unwrap(wire.opcConfigTest!(url)),
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
    appWatchConfigChat: (...args) => wire.appWatchConfigChat!(...args),
    appReplyConfigChat: (...args) => unwrap(wire.appReplyConfigChat!(...args)),
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
    appCancelDeployment: (...args) => unwrap(wire.appCancelDeployment!(...args)),
    appVerifyWithOptions: (...args) => unwrap(wire.appVerifyWithOptions!(...args)),
    appSetSkillEnabled: (...args) => unwrap(wire.appSetSkillEnabled!(...args)),
    appVersions: (...args) => unwrap(wire.appVersions!(...args)),
    appLogs: (...args) => unwrap(wire.appLogs!(...args)),
    appDeploymentLogs: (...args) => unwrap(wire.appDeploymentLogs!(...args)),
    appStorage: (...args) => unwrap(wire.appStorage!(...args)),
    appRecheck: (...args) => unwrap(wire.appRecheck!(...args)),
    appRuntimeStatus: (...args) => unwrap(wire.appRuntimeStatus!(...args)),
    appRuntimeChange: (...args) => unwrap(wire.appRuntimeChange!(...args)),
    appUpdateConfig: (...args) => unwrap(wire.appUpdateConfig!(...args)),
    appRollback: (...args) => unwrap(wire.appRollback!(...args)),
    appDeleteWithOptions: (...args) => unwrap(wire.appDeleteWithOptions!(...args)),
    appCreateVolumeBackup: (...args) => unwrap(wire.appCreateVolumeBackup!(...args)),
    appVolumeBackupsList: (...args) => unwrap(wire.appVolumeBackupsList!(...args)),
    appSaveVolumeBackupDownload: (...args) => unwrap(wire.appSaveVolumeBackupDownload!(...args)),
    appDeleteVolumeBackup: (...args) => unwrap(wire.appDeleteVolumeBackup!(...args)),
    appDownload: (...args) => unwrap(wire.appDownload!(...args)),
    appSaveDownload: (...args) => unwrap(wire.appSaveDownload(...args)),
    state: () => unwrap(wire.state()),
    watchState: signal => wire.watchState(signal),
    startLogin: () => unwrap(wire.startLogin()),
    cancelLogin: () => unwrap(wire.cancelLogin()),
    logout: () => unwrap(wire.logout()),
    syncSession: () => unwrap(wire.syncSession()),
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
    getGuideImage: (...args) => unwrap(wire.getGuideImage!(...args)),
    checkPluginUpdate: () => unwrap(wire.checkPluginUpdate!()),
  }
  ctx.inject(['inputTriggers'], child => registerMentions(child, api))
  let openPluginDetail: (() => void) | undefined
  ctx.inject(['pluginNavigation'], child => {
    openPluginDetail = () => child.pluginNavigation.openBundle('dsh-plugin-opc')
    return () => { openPluginDetail = undefined }
  })
  const onOpenPluginDetail = () => {
    if (!openPluginDetail) return false
    openPluginDetail()
    return true
  }
  const prepareAnalysisNavigation = registerAnalysisNavigation(ctx, api)
  const id = 'dsh-plugin-opc/workbench'
  const getTitle = () => translate(getActiveClientLocale(), "workbench.opcWorkbench")
  const getDesc = () => translate(getActiveClientLocale(), "workbench.knowledgeBasesSkillsMcpAndApps")
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind: workbenchKind, priority: 'extension', title: getTitle,
    guide: [{ id: workbenchKind, order: 10, icon: OpcIcon, title: getTitle, description: getDesc }],
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: id }, () => <><OpcIcon /> {getTitle()}</>,
  )))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id,
    inject: sessionId => ({ api, sessionId: String(sessionId), prepareAnalysisNavigation, onOpenPluginDetail }),
  }, WorkbenchBody)))
  for (const { kind } of modules) {
    const legacyId = `dsh-plugin-opc/${kind}`
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: legacyId, kind: `opc-${kind}`, priority: 'extension', title: () => getModuleLabel(kind, getActiveClientLocale()),
    }))
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: legacyId, inject: () => ({ legacyPage: kind }),
    }, LegacyModule)))
  }
}
