import React, { useEffect, useId, useRef, useState } from 'react'
import type { OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { getModuleLabel, OpcIcon, type BrandModuleKind } from './branding.tsx'
import { useI18n, type MessageKey } from './i18n.tsx'
import { DEFAULT_WORKBENCH_NAME, useWorkbenchName } from './workbench-name.ts'

export const workbenchKind = 'opc-workbench'
export const workbenchTitle = DEFAULT_WORKBENCH_NAME
export type ModuleKind = BrandModuleKind
export type PanelKind = 'home' | ModuleKind

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'opc-workbench': { opcPage: PanelKind }
  }
}

export const modules = [
  {
    kind: 'knowledge',
    labelKey: 'workbench.module.knowledge.label',
    icon: 'book',
    tagKey: 'workbench.module.knowledge.tag',
    descriptionKey: 'workbench.module.knowledge.description',
    actionLabelKey: 'workbench.module.knowledge.action',
  },
  {
    kind: 'skills',
    labelKey: 'workbench.module.skills.label',
    icon: 'sparkle',
    tagKey: 'workbench.module.skills.tag',
    descriptionKey: 'workbench.module.skills.description',
    actionLabelKey: 'workbench.module.skills.action',
  },
  {
    kind: 'mcp',
    labelKey: 'workbench.module.mcp.label',
    icon: 'plug',
    tagKey: 'workbench.module.mcp.tag',
    descriptionKey: 'workbench.module.mcp.description',
    actionLabelKey: 'workbench.module.mcp.action',
  },
  {
    kind: 'apps',
    labelKey: 'workbench.module.apps.label',
    icon: 'list',
    tagKey: 'workbench.module.apps.tag',
    descriptionKey: 'workbench.module.apps.description',
    actionLabelKey: 'workbench.module.apps.action',
  },
] as const satisfies readonly {
  kind: ModuleKind
  labelKey: MessageKey
  icon: AppIconName
  tagKey: MessageKey
  descriptionKey: MessageKey
  actionLabelKey: MessageKey
}[]

const pages = [{ kind: 'home', labelKey: 'workbench.page.home', icon: 'home' } as const, ...modules] as const

export function readWorkbenchPage(params: unknown): PanelKind | undefined {
  if (!params || typeof params !== 'object' || !('opcPage' in params)) return undefined
  return pages.find(page => page.kind === params.opcPage)?.kind
}

export function WorkbenchNavigation({ kind, onSelect }: { kind: PanelKind; onSelect: (kind: PanelKind) => void }) {
  const { locale, t } = useI18n()
  const workbenchName = useWorkbenchName()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    container.current?.addEventListener('keydown', escape)
    const element = container.current
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      element?.removeEventListener('keydown', escape)
    }
  }, [open])

  const currentPage = pages.find(page => page.kind === kind)
  const currentLabel = currentPage ? t(currentPage.labelKey) : ''

  return (
    <div className="opc-workbench-nav" ref={container} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button type="button" className="opc-workbench-trigger" ref={trigger}
        aria-label={t("workbench.switchOpcPageCurrent", { name: currentLabel })}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="brand-icon-wrap"><OpcIcon size={18} /></span>
        <span className="brand-text">
          <span className="brand-title">{kind === 'home' ? workbenchName : getModuleLabel(kind, locale)}</span>
          {kind !== 'home' && <span className="brand-sub">{workbenchName}</span>}
        </span>
        <AppIcon name="chevronDown" size={13} />
      </button>
      <nav id={id} className="opc-workbench-menu" hidden={!open} aria-label={t("workbench.switchOpcModule")}>
        {pages.map(page => (
          <button type="button" key={page.kind} aria-current={page.kind === kind ? 'page' : undefined}
            onClick={() => { onSelect(page.kind); setOpen(false); trigger.current?.focus() }}>
            <AppIcon name={page.icon} size={16} />
            <span>{t(page.labelKey)}</span>
            {page.kind === kind && <AppIcon name="check" size={14} />}
          </button>
        ))}
      </nav>
    </div>
  )
}

type HomeGuideTab = ModuleKind | 'faq'

declare const __OPC_PLUGIN_VERSION__: string | undefined

const PLUGIN_VERSION = typeof __OPC_PLUGIN_VERSION__ !== 'undefined' ? __OPC_PLUGIN_VERSION__ : ''

export const GUIDE_TABS: readonly { id: HomeGuideTab; labelKey: MessageKey }[] = [
  { id: 'knowledge', labelKey: 'workbench.guideTab.knowledge' },
  { id: 'skills', labelKey: 'workbench.guideTab.skills' },
  { id: 'mcp', labelKey: 'workbench.guideTab.mcp' },
  { id: 'apps', labelKey: 'workbench.guideTab.apps' },
  { id: 'faq', labelKey: 'workbench.guideTab.faq' },
]

const QUICK_COMMANDS: readonly {
  id: string
  labelKey: MessageKey
  shortCodeKey: MessageKey
  exampleKey: MessageKey
}[] = [
  {
    id: 'kb',
    labelKey: 'workbench.quickCmd.kb.label',
    shortCodeKey: 'workbench.quickCmd.kb.shortCode',
    exampleKey: 'workbench.quickCmd.kb.example',
  },
  {
    id: 'skill',
    labelKey: 'workbench.quickCmd.skill.label',
    shortCodeKey: 'workbench.quickCmd.skill.shortCode',
    exampleKey: 'workbench.quickCmd.skill.example',
  },
  {
    id: 'mcp',
    labelKey: 'workbench.quickCmd.mcp.label',
    shortCodeKey: 'workbench.quickCmd.mcp.shortCode',
    exampleKey: 'workbench.quickCmd.mcp.example',
  },
  {
    id: 'app',
    labelKey: 'workbench.quickCmd.app.label',
    shortCodeKey: 'workbench.quickCmd.app.shortCode',
    exampleKey: 'workbench.quickCmd.app.example',
  },
]

interface GuideStep {
  badgeKey: MessageKey
  titleKey: MessageKey
  descKey: MessageKey
  imgName: string
  imgCapKey: MessageKey
}

const MODULE_GUIDES: Record<ModuleKind, {
  headingKey: MessageKey
  actionLabelKey: MessageKey
  steps: readonly GuideStep[]
  exampleTitleKey: MessageKey
  exampleCmdKey: MessageKey
  tipTitleKey: MessageKey
  tipTextKey: MessageKey
}> = {
  apps: {
    headingKey: 'workbench.guide.apps.heading',
    actionLabelKey: 'workbench.guide.apps.action',
    steps: [
      {
        badgeKey: 'workbench.guide.apps.step1.badge',
        titleKey: 'workbench.guide.apps.step1.title',
        descKey: 'workbench.guide.apps.step1.desc',
        imgName: '16-app-source.jpg',
        imgCapKey: 'workbench.guide.apps.step1.imgCap',
      },
      {
        badgeKey: 'workbench.guide.apps.step2.badge',
        titleKey: 'workbench.guide.apps.step2.title',
        descKey: 'workbench.guide.apps.step2.desc',
        imgName: '19-app-analysis.jpg',
        imgCapKey: 'workbench.guide.apps.step2.imgCap',
      },
      {
        badgeKey: 'workbench.guide.apps.step3.badge',
        titleKey: 'workbench.guide.apps.step3.title',
        descKey: 'workbench.guide.apps.step3.desc',
        imgName: '22-app-deploy-review.jpg',
        imgCapKey: 'workbench.guide.apps.step3.imgCap',
      },
      {
        badgeKey: 'workbench.guide.apps.step4.badge',
        titleKey: 'workbench.guide.apps.step4.title',
        descKey: 'workbench.guide.apps.step4.desc',
        imgName: '25-app-login-page.jpg',
        imgCapKey: 'workbench.guide.apps.step4.imgCap',
      },
    ],
    exampleTitleKey: 'workbench.guide.apps.exampleTitle',
    exampleCmdKey: 'workbench.guide.apps.exampleCmd',
    tipTitleKey: 'workbench.guide.apps.tipTitle',
    tipTextKey: 'workbench.guide.apps.tipText',
  },
  knowledge: {
    headingKey: 'workbench.guide.knowledge.heading',
    actionLabelKey: 'workbench.guide.knowledge.action',
    steps: [
      {
        badgeKey: 'workbench.guide.knowledge.step1.badge',
        titleKey: 'workbench.guide.knowledge.step1.title',
        descKey: 'workbench.guide.knowledge.step1.desc',
        imgName: '11-knowledge-search.jpg',
        imgCapKey: 'workbench.guide.knowledge.step1.imgCap',
      },
      {
        badgeKey: 'workbench.guide.knowledge.step2.badge',
        titleKey: 'workbench.guide.knowledge.step2.title',
        descKey: 'workbench.guide.knowledge.step2.desc',
        imgName: '12-knowledge-catalog.jpg',
        imgCapKey: 'workbench.guide.knowledge.step2.imgCap',
      },
    ],
    exampleTitleKey: 'workbench.guide.knowledge.exampleTitle',
    exampleCmdKey: 'workbench.guide.knowledge.exampleCmd',
    tipTitleKey: 'workbench.guide.knowledge.tipTitle',
    tipTextKey: 'workbench.guide.knowledge.tipText',
  },
  skills: {
    headingKey: 'workbench.guide.skills.heading',
    actionLabelKey: 'workbench.guide.skills.action',
    steps: [
      {
        badgeKey: 'workbench.guide.skills.step1.badge',
        titleKey: 'workbench.guide.skills.step1.title',
        descKey: 'workbench.guide.skills.step1.desc',
        imgName: '14-skills.jpg',
        imgCapKey: 'workbench.guide.skills.step1.imgCap',
      },
    ],
    exampleTitleKey: 'workbench.guide.skills.exampleTitle',
    exampleCmdKey: 'workbench.guide.skills.exampleCmd',
    tipTitleKey: 'workbench.guide.skills.tipTitle',
    tipTextKey: 'workbench.guide.skills.tipText',
  },
  mcp: {
    headingKey: 'workbench.guide.mcp.heading',
    actionLabelKey: 'workbench.guide.mcp.action',
    steps: [
      {
        badgeKey: 'workbench.guide.mcp.step1.badge',
        titleKey: 'workbench.guide.mcp.step1.title',
        descKey: 'workbench.guide.mcp.step1.desc',
        imgName: '15-mcp.jpg',
        imgCapKey: 'workbench.guide.mcp.step1.imgCap',
      },
    ],
    exampleTitleKey: 'workbench.guide.mcp.exampleTitle',
    exampleCmdKey: 'workbench.guide.mcp.exampleCmd',
    tipTitleKey: 'workbench.guide.mcp.tipTitle',
    tipTextKey: 'workbench.guide.mcp.tipText',
  },
}

const FAQ_ITEMS: readonly { qKey: MessageKey; aKey: MessageKey }[] = [
  { qKey: 'workbench.faq.q1', aKey: 'workbench.faq.a1' },
  { qKey: 'workbench.faq.q2', aKey: 'workbench.faq.a2' },
  { qKey: 'workbench.faq.q3', aKey: 'workbench.faq.a3' },
  { qKey: 'workbench.faq.q4', aKey: 'workbench.faq.a4' },
]

type UpdateInfo = { currentVersion: string; latestVersion: string; hasUpdate: boolean }

let dismissedUpdateVersion = ''

export function WorkbenchHome({ onSelect, api, visible = true, onOpenPluginDetail }: {
  onSelect: (kind: ModuleKind) => void
  api?: OpcApi
  visible?: boolean
  onOpenPluginDetail?: () => boolean
}) {
  const { t } = useI18n()
  const workbenchName = useWorkbenchName()
  const heading = useId()
  const guideHeading = useId()
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideTab, setGuideTab] = useState<HomeGuideTab>('knowledge')
  const [modalModule, setModalModule] = useState<ModuleKind | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; cap: string } | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateFallback, setUpdateFallback] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const loadingImages = useRef(new Set<string>())
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  useEffect(() => {
    if (!visible || !api?.checkPluginUpdate) return
    let cancelled = false
    void api.checkPluginUpdate().then(raw => {
      if (cancelled) return
      const parsed = JSON.parse(raw) as Partial<UpdateInfo>
      if (parsed.hasUpdate && parsed.latestVersion && parsed.latestVersion !== dismissedUpdateVersion) {
        setUpdateFallback(false)
        setUpdateInfo({
          currentVersion: parsed.currentVersion || PLUGIN_VERSION,
          latestVersion: parsed.latestVersion,
          hasUpdate: true,
        })
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [api, visible])

  useEffect(() => {
    if (!api?.getGuideImage) return
    const targetTabs: ModuleKind[] = []
    if (guideOpen && guideTab !== 'faq') targetTabs.push(guideTab)
    if (modalModule) targetTabs.push(modalModule)
    const needed = targetTabs.flatMap(kind => MODULE_GUIDES[kind].steps.map(step => step.imgName))
    for (const name of needed) {
      if (images[name] !== undefined || loadingImages.current.has(name)) continue
      loadingImages.current.add(name)
      void api.getGuideImage(name).then(src => {
        if (src) setImages(prev => ({ ...prev, [name]: src }))
      }).catch(() => {}).finally(() => {
        loadingImages.current.delete(name)
      })
    }
  }, [api, guideOpen, guideTab, modalModule, images])

  useEffect(() => {
    if (!modalModule && !lightbox && !updateInfo) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (lightbox) setLightbox(null)
      else if (modalModule) setModalModule(null)
      else if (updateInfo) {
        dismissedUpdateVersion = updateInfo.latestVersion
        setUpdateInfo(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalModule, lightbox, updateInfo])

  const dismissUpdateModal = () => {
    if (updateInfo) dismissedUpdateVersion = updateInfo.latestVersion
    setUpdateInfo(null)
  }

  const goToPluginUpdate = () => {
    if (onOpenPluginDetail?.()) {
      setUpdateInfo(null)
      return
    }
    setUpdateFallback(true)
  }

  const copyCommand = async (id: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {
    }
    setCopiedId(id)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(current => (current === id ? null : current)), 1800)
  }

  const renderModuleGuideBody = (kind: ModuleKind, copyKeyPrefix: string) => {
    const detail = MODULE_GUIDES[kind]
    const cmdText = t(detail.exampleCmdKey)
    return (
      <div className="opc-guide-pane">
        <div className="opc-guide-pane-head">
          <strong>{t(detail.headingKey)}</strong>
          <button type="button" className="opc-guide-link-btn" onClick={() => { setModalModule(null); onSelect(kind) }}>
            {t(detail.actionLabelKey)}
          </button>
        </div>
        <div className="opc-guide-illustrated-list">
          {detail.steps.map(step => {
            const src = images[step.imgName]
            const cap = t(step.imgCapKey)
            return (
              <div key={step.titleKey} className="opc-guide-step-row">
                <div className="opc-guide-step-copy">
                  <span className={`opc-guide-badge opc-badge-${kind}`}>{t(step.badgeKey)}</span>
                  <h4>{t(step.titleKey)}</h4>
                  <p>{t(step.descKey)}</p>
                </div>
                {src ? (
                  <button
                    type="button"
                    className="opc-guide-shot-btn"
                    onClick={() => setLightbox({ src, cap })}
                    title={t("workbench.clickToEnlarge")}
                  >
                    <img src={src} alt={cap} />
                    <span className="opc-guide-shot-cap">{cap}</span>
                  </button>
                ) : (
                  <div className="opc-guide-shot-placeholder">
                    <span>{cap}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="opc-guide-extras">
          <div className="opc-guide-example-box">
            <div className="opc-guide-example-head">
              <strong>{t(detail.exampleTitleKey)}</strong>
              <button
                type="button"
                className="opc-guide-copy-btn"
                onClick={() => void copyCommand(`${copyKeyPrefix}-${kind}`, cmdText)}
              >
                <AppIcon name={copiedId === `${copyKeyPrefix}-${kind}` ? 'check' : 'copy'} size={12} />
                <span>{copiedId === `${copyKeyPrefix}-${kind}` ? t("common.copied") : t("workbench.copy")}</span>
              </button>
            </div>
            <code className="opc-guide-cmd-syntax">{cmdText}</code>
          </div>
          <div className="opc-guide-tip-box">
            <strong>{t(detail.tipTitleKey)}</strong>
            <p>{t(detail.tipTextKey)}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="opc-workbench-home" aria-labelledby={heading}>
      <div className="opc-home-intro">
        <div className="opc-home-intro-copy">
          <div className="opc-home-intro-title-row">
            <h2 id={heading}>{workbenchName}</h2>
            {PLUGIN_VERSION && <span className="opc-home-version">v{PLUGIN_VERSION}</span>}
          </div>
          <p>{t("workbench.chooseAModuleBelowToManage")}</p>
        </div>
      </div>

      <div>
        <div className="opc-home-section-head">
          <div className="opc-home-section-label">
            <span className="opc-home-section-dot" aria-hidden="true" />
            <h3>{t("workbench.modules")}</h3>
          </div>
          <span>{t("workbench.clickCardToOpenClickFor")}</span>
        </div>

        <div className="opc-workbench-grid">
          {modules.map(module => {
            const label = t(module.labelKey)
            return (
              <article className="opc-workbench-card" data-kind={module.kind} key={module.kind}>
                <div className="opc-workbench-card-top">
                  <button type="button" className="opc-workbench-card-main" onClick={() => onSelect(module.kind)}>
                    <span className={`opc-workbench-card-icon opc-workbench-card-${module.kind}`}>
                      <AppIcon name={module.icon} size={20} />
                    </span>
                    <span className="opc-workbench-card-copy">
                      <span className="opc-workbench-card-title-row">
                        <strong>{label}</strong>
                        <code className={`opc-workbench-card-tag opc-tag-${module.kind}`}>{t(module.tagKey)}</code>
                      </span>
                      <span>{t(module.descriptionKey)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="opc-workbench-card-help"
                    title={t("workbench.viewGuide", { name: label })}
                    aria-label={t("workbench.viewGuide", { name: label })}
                    onClick={() => setModalModule(module.kind)}
                  >
                    ?
                  </button>
                </div>
                <button type="button" className={`opc-workbench-card-cta opc-cta-${module.kind}`} onClick={() => onSelect(module.kind)}>
                  <span>{t(module.actionLabelKey)}</span>
                  <AppIcon name="chevronRight" size={14} />
                </button>
              </article>
            )
          })}
        </div>
      </div>

      <section className="opc-home-ref" aria-labelledby={guideHeading}>
        <div className="opc-home-ref-head">
          <div className="opc-home-ref-title">
            <h3 id={guideHeading}>{t("workbench.quickGuideAndCommands")}</h3>
            <span className="opc-home-ref-badge">{t("workbench.docs")}</span>
          </div>
          <button
            type="button"
            className="opc-home-ref-toggle"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen(open => !open)}
          >
            {guideOpen ? t("workbench.hideGuide") : t("workbench.showGuide4StepDelivery")}
          </button>
        </div>

        <div className="opc-home-quick-strip">
          {QUICK_COMMANDS.map(cmd => {
            const example = t(cmd.exampleKey)
            return (
              <button
                key={cmd.id}
                type="button"
                className="opc-home-quick-chip"
                title={t("workbench.clickToCopy", { ex: example })}
                onClick={() => void copyCommand(`chip-${cmd.id}`, example)}
              >
                <span>{t(cmd.labelKey)}</span>
                <code>{copiedId === `chip-${cmd.id}` ? t("workbench.copied") : t(cmd.shortCodeKey)}</code>
              </button>
            )
          })}
        </div>

        {guideOpen && (
          <div className="opc-home-ref-details">
            <div className="opc-home-guide-tabs" role="tablist" aria-label={t("workbench.featureGuides")}>
              {GUIDE_TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={guideTab === tab.id}
                  className={`opc-home-guide-tab ${guideTab === tab.id ? 'is-active' : ''}`}
                  onClick={() => setGuideTab(tab.id)}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>

            <div className="opc-home-guide-body" role="tabpanel">
              {guideTab !== 'faq' ? renderModuleGuideBody(guideTab, 'tab') : (
                <div className="opc-guide-pane">
                  <div className="opc-guide-pane-head">
                    <strong>{t("workbench.frequentlyAskedQuestions")}</strong>
                  </div>
                  <div className="opc-guide-faq-list">
                    {FAQ_ITEMS.map(item => (
                      <div key={item.qKey} className="opc-guide-faq-item">
                        <strong>{t(item.qKey)}</strong>
                        <span>{t(item.aKey)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {modalModule && (
        <div className="opc-guide-modal-backdrop" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setModalModule(null) }}>
          <div className="opc-guide-modal">
            <div className="opc-guide-modal-head">
              <strong>{t(MODULE_GUIDES[modalModule].headingKey)}</strong>
              <button type="button" className="opc-guide-modal-close" aria-label={t("common.close")} onClick={() => setModalModule(null)}>✕</button>
            </div>
            {renderModuleGuideBody(modalModule, 'modal')}
          </div>
        </div>
      )}

      {lightbox && (
        <div className="opc-guide-lightbox" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}>
          <div className="opc-guide-lightbox-inner">
            <img src={lightbox.src} alt={lightbox.cap} />
            <div className="opc-guide-lightbox-bar">
              <span>{lightbox.cap}</span>
              <button type="button" onClick={() => setLightbox(null)}>{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="opc-guide-modal-backdrop" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) dismissUpdateModal() }}>
          <div className="opc-update-modal">
            <div className="opc-guide-modal-head">
              <strong>{t("workbench.opcPluginUpdateAvailable")}</strong>
              <button type="button" className="opc-guide-modal-close" aria-label={t("common.close")} onClick={dismissUpdateModal}>✕</button>
            </div>
            <div className="opc-update-versions">
              {updateInfo.currentVersion && <span className="opc-update-ver-curr">{t("workbench.currentV", { ver: updateInfo.currentVersion })}</span>}
              <span aria-hidden="true">→</span>
              <span className="opc-update-ver-next">{t("workbench.latestV", { ver: updateInfo.latestVersion })}</span>
            </div>
            <p className="opc-update-desc">
              {t("workbench.aNewVersionIsPublishedOn")}
            </p>
            {updateFallback && (
              <p className="opc-update-fallback" role="status">
                {t("workbench.openPluginsDshPluginOpcOn")}
              </p>
            )}
            <div className="opc-update-actions">
              <button type="button" className="opc-update-btn-secondary" onClick={dismissUpdateModal}>{t("workbench.later")}</button>
              <button type="button" className="opc-update-btn-primary" onClick={goToPluginUpdate}>{t("workbench.update")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
