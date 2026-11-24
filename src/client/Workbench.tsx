import React, { useEffect, useId, useRef, useState } from 'react'
import type { OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { labels, OpcIcon } from './branding.tsx'

export const workbenchKind = 'opc-workbench'
export const workbenchTitle = 'OPC 工作台'
export type ModuleKind = keyof typeof labels
export type PanelKind = 'home' | ModuleKind

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'opc-workbench': { opcPage: PanelKind }
  }
}

export const modules = [
  {
    kind: 'knowledge',
    label: '知识库',
    icon: 'book',
    tag: '@库名',
    description: '全文检索企业文档正文、按目录筛选，并在对话中引用指定库做精准问答。',
    actionLabel: '进入知识库',
  },
  {
    kind: 'skills',
    label: '技能',
    icon: 'sparkle',
    tag: '/技能名',
    description: '搜索并一键安装启用企业开放技能，在对话中输入斜杠即可调用执行。',
    actionLabel: '管理技能',
  },
  {
    kind: 'mcp',
    label: 'MCP 服务',
    icon: 'plug',
    tag: '在线调试',
    description: '查看已连接的业务服务与工具定义，支持在线 JSON 调试调用与对话执行。',
    actionLabel: '查看服务',
  },
  {
    kind: 'apps',
    label: '应用交付中心',
    icon: 'list',
    tag: '/app-标识',
    description: '导入本地源码或 ZIP，AI 自动改造、打包部署上线并生成可调用技能。',
    actionLabel: '管理应用',
  },
] as const satisfies readonly {
  kind: ModuleKind
  label: string
  icon: AppIconName
  tag: string
  description: string
  actionLabel: string
}[]

const pages = [{ kind: 'home', label: '首页', icon: 'home' }, ...modules] as const

export function readWorkbenchPage(params: unknown): PanelKind | undefined {
  if (!params || typeof params !== 'object' || !('opcPage' in params)) return undefined
  return pages.find(page => page.kind === params.opcPage)?.kind
}

export function WorkbenchNavigation({ kind, onSelect }: { kind: PanelKind; onSelect: (kind: PanelKind) => void }) {
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

  return (
    <div className="opc-workbench-nav" ref={container} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button type="button" className="opc-workbench-trigger" ref={trigger}
        aria-label={`切换 OPC 页面，当前${pages.find(page => page.kind === kind)?.label}`}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="brand-icon-wrap"><OpcIcon size={18} /></span>
        <span className="brand-text">
          <span className="brand-title">{kind === 'home' ? workbenchTitle : labels[kind]}</span>
          {kind !== 'home' && <span className="brand-sub">OPC 工作台</span>}
        </span>
        <AppIcon name="chevronDown" size={13} />
      </button>
      <nav id={id} className="opc-workbench-menu" hidden={!open} aria-label="切换 OPC 模块">
        {pages.map(page => (
          <button type="button" key={page.kind} aria-current={page.kind === kind ? 'page' : undefined}
            onClick={() => { onSelect(page.kind); setOpen(false); trigger.current?.focus() }}>
            <AppIcon name={page.icon} size={16} />
            <span>{page.label}</span>
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

const GUIDE_TABS: readonly { id: HomeGuideTab; label: string }[] = [
  { id: 'apps', label: '应用交付 4 步走' },
  { id: 'knowledge', label: '知识库用法' },
  { id: 'skills', label: '技能用法' },
  { id: 'mcp', label: 'MCP 用法' },
  { id: 'faq', label: '常见问题' },
]

const QUICK_COMMANDS = [
  {
    id: 'kb',
    label: '知识库',
    shortCode: '@<库名> 提问',
    example: '@企业制度库 差旅报销需要准备哪些材料？请列出依据文档的名称',
  },
  {
    id: 'skill',
    label: '技能',
    shortCode: '/<技能名> 执行',
    example: '/excel-compare 对比这两份报价单的差异',
  },
  {
    id: 'mcp',
    label: 'MCP',
    shortCode: '直接对话调用',
    example: '用订单查询 MCP 服务查一下昨天的异常采购单',
  },
  {
    id: 'app',
    label: '应用',
    shortCode: '/app-<标识>',
    example: '/app-supplier-audit 查询最近提交的审厂记录',
  },
] as const

interface GuideStep {
  badge: string
  title: string
  desc: string
  imgName: string
  imgCap: string
}

const MODULE_GUIDES: Record<ModuleKind, {
  heading: string
  actionLabel: string
  steps: readonly GuideStep[]
  exampleTitle: string
  exampleCmd: string
  tipTitle: string
  tipText: string
}> = {
  apps: {
    heading: '应用交付 4 步走（本地应用一键 AI 改造上线）',
    actionLabel: '前往应用交付中心 →',
    steps: [
      {
        badge: '第 1 步 · 选择源码',
        title: '导入本地源码文件夹或 ZIP 压缩包',
        desc: '进入「应用交付中心」点击「新建并部署应用」，可直接选择本机源码目录或上传项目 ZIP。系统会自动过滤构建产物与敏感文件。',
        imgName: '16-app-source.jpg',
        imgCap: '源码文件夹与 ZIP 导入入口',
      },
      {
        badge: '第 2 步 · AI 自动分析与确认',
        title: '自动分析环境并处理待确认项',
        desc: '点击开始分析后，右侧展示分析进度，同时在左侧生成专属对话会话。若发现登录方式或端口等需确认事项，系统会暂停并提示确认。',
        imgName: '19-app-analysis.jpg',
        imgCap: 'AI 正在分析项目源码与运行配置',
      },
      {
        badge: '第 3 步 · 核对配置并提交发布',
        title: '确认端口、环境变量与持久化卷',
        desc: '打包检查完成后，在部署确认页核对应用名称、容器端口、环境变量及持久化存储卷配置，确认无误后点击「确认配置并发布上线」。',
        imgName: '22-app-deploy-review.jpg',
        imgCap: '发布前核对运行配置与持久化卷',
      },
      {
        badge: '第 4 步 · 构建上线与技能就绪',
        title: '查看实时构建日志，通过域名直接访问',
        desc: '提交后可实时跟踪镜像构建与容器启动日志。应用上线并分配企业域名后，即可在浏览器直接访问，同时自动生成 /app-<标识> 技能。',
        imgName: '25-app-login-page.jpg',
        imgCap: '部署上线后通过企业域名访问应用',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleCmd: '/app-supplier-audit 查询最近提交的供应商审厂记录',
    tipTitle: '运维保障',
    tipText: '版本升级与回滚均会保留挂载卷中的业务数据；支持单卷与整应用数据快照备份下载。',
  },
  knowledge: {
    heading: '企业知识库使用方式',
    actionLabel: '打开知识库 →',
    steps: [
      {
        badge: '方式 A · 全文检索',
        title: '关键词检索企业文档正文',
        desc: '切换到「文档全文检索」模式输入关键词即可检索正文内容；在左侧对话输入 @ 选择「OPC 知识库」即可引用指定文档问答。',
        imgName: '11-knowledge-search.jpg',
        imgCap: '知识库全文检索与范围切换',
      },
      {
        badge: '方式 B · 目录定位与限定',
        title: '按目录筛选并持续限定会话范围',
        desc: '切换到「知识库目录」可按名称或描述快速定位库，点击「限定问答范围」可将该知识库持续绑定到当前对话，用完点「取消限定」。',
        imgName: '12-knowledge-catalog.jpg',
        imgCap: '按名称或描述筛选知识库目录',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleCmd: '@企业制度库 差旅报销需要准备哪些材料？请列出依据文档的名称',
    tipTitle: '排查提示',
    tipText: '若全部库检索报错 INVALID_REQUEST，请确认列表中有可见知识库，先选中具体某一个库再检索。',
  },
  skills: {
    heading: '企业技能安装与调用',
    actionLabel: '管理技能 →',
    steps: [
      {
        badge: '下载与调用',
        title: '一键安装启用并在对话中 / 调用',
        desc: '在技能页搜索企业开放技能（如财务报销审查、Excel 比对等），点击「下载安装」并确认启用后，在左侧对话输入 /技能名 任务描述 即可执行。',
        imgName: '14-skills.jpg',
        imgCap: 'OPC 技能搜索与安装状态筛选',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleCmd: '/excel-compare 请对比这两份报价单，按物料编码列输出差异明细',
    tipTitle: '使用说明',
    tipText: '技能安装后立即在本地生效；搭配文件上传（如 Excel、合同文档）可发挥最佳自动化处理效果。',
  },
  mcp: {
    heading: 'MCP 服务查看与调试',
    actionLabel: '查看与调试服务 →',
    steps: [
      {
        badge: '查看与调试',
        title: '在线调试 JSON 入参或直接在对话调用',
        desc: '在 MCP 服务页查看已连接服务与工具 Schema，支持填写 JSON 参数在线测试；在左侧对话直接下达业务指令时，写操作会触发安全审批确认。',
        imgName: '15-mcp.jpg',
        imgCap: 'MCP 服务列表与连接状态筛选',
      },
    ],
    exampleTitle: '显式调用示例',
    exampleCmd: '使用 supply-chain-erp 的 query_supplier_status 查询供应商 SUP-2026-008 状态',
    tipTitle: '调试贴士',
    tipText: '建议优先选择只读工具做首次联调；写操作或敏感动作会在对话中弹出审批卡片。',
  },
} as const

const FAQ_ITEMS = [
  { q: '登录后列表为空，或输入 @ 找不到库', a: '点击右上角「刷新」同步最新授权目录。如仍无资源，请联系管理员确认当前账号的空间与资源授权。' },
  { q: '知识库检索显示 INVALID_REQUEST', a: '确认列表中有可见知识库，选择具体某一个库再发起检索；选库后仍报错请记录操作时间与错误码反馈。' },
  { q: '企业授权页不小心关闭了', a: '在登录页点击「重新打开授权页」，或取消后重新发起企微 / SSO 登录。' },
  { q: '右侧边栏找不到 OPC 工作台入口', a: '在「插件 → 已安装插件」确认开关已打开，进入新会话再打开右侧栏；仍找不到可完整退出重启 DSH。' },
] as const

type UpdateInfo = { currentVersion: string; latestVersion: string; hasUpdate: boolean }

let dismissedUpdateVersion = ''

export function WorkbenchHome({ onSelect, api, visible = true, onOpenPluginDetail }: {
  onSelect: (kind: ModuleKind) => void
  api?: OpcApi
  visible?: boolean
  onOpenPluginDetail?: () => boolean
}) {
  const heading = useId()
  const guideHeading = useId()
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideTab, setGuideTab] = useState<HomeGuideTab>('apps')
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
    return (
      <div className="opc-guide-pane">
        <div className="opc-guide-pane-head">
          <strong>{detail.heading}</strong>
          <button type="button" className="opc-guide-link-btn" onClick={() => { setModalModule(null); onSelect(kind) }}>
            {detail.actionLabel}
          </button>
        </div>
        <div className="opc-guide-illustrated-list">
          {detail.steps.map(step => {
            const src = images[step.imgName]
            return (
              <div key={step.title} className="opc-guide-step-row">
                <div className="opc-guide-step-copy">
                  <span className={`opc-guide-badge opc-badge-${kind}`}>{step.badge}</span>
                  <h4>{step.title}</h4>
                  <p>{step.desc}</p>
                </div>
                {src ? (
                  <button
                    type="button"
                    className="opc-guide-shot-btn"
                    onClick={() => setLightbox({ src, cap: step.imgCap })}
                    title="点击放大查看截图"
                  >
                    <img src={src} alt={step.imgCap} />
                    <span className="opc-guide-shot-cap">{step.imgCap}</span>
                  </button>
                ) : (
                  <div className="opc-guide-shot-placeholder">
                    <span>{step.imgCap}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="opc-guide-extras">
          <div className="opc-guide-example-box">
            <div className="opc-guide-example-head">
              <strong>{detail.exampleTitle}</strong>
              <button
                type="button"
                className="opc-guide-copy-btn"
                onClick={() => void copyCommand(`${copyKeyPrefix}-${kind}`, detail.exampleCmd)}
              >
                <AppIcon name={copiedId === `${copyKeyPrefix}-${kind}` ? 'check' : 'copy'} size={12} />
                <span>{copiedId === `${copyKeyPrefix}-${kind}` ? '已复制' : '复制示例'}</span>
              </button>
            </div>
            <code className="opc-guide-cmd-syntax">{detail.exampleCmd}</code>
          </div>
          <div className="opc-guide-tip-box">
            <strong>{detail.tipTitle}</strong>
            <p>{detail.tipText}</p>
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
            <h2 id={heading}>企业能力工作台</h2>
            {PLUGIN_VERSION && <span className="opc-home-version">v{PLUGIN_VERSION}</span>}
          </div>
          <p>选择下方功能模块进入管理，或在左侧对话中直接调用企业能力。</p>
        </div>
      </div>

      <div>
        <div className="opc-home-section-head">
          <div className="opc-home-section-label">
            <span className="opc-home-section-dot" aria-hidden="true" />
            <h3>功能模块入口</h3>
          </div>
          <span>点击卡片进入模块 · 点击 ? 查看图文指南</span>
        </div>

        <div className="opc-workbench-grid">
          {modules.map(module => (
            <article className="opc-workbench-card" data-kind={module.kind} key={module.kind}>
              <div className="opc-workbench-card-top">
                <button type="button" className="opc-workbench-card-main" onClick={() => onSelect(module.kind)}>
                  <span className={`opc-workbench-card-icon opc-workbench-card-${module.kind}`}>
                    <AppIcon name={module.icon} size={20} />
                  </span>
                  <span className="opc-workbench-card-copy">
                    <span className="opc-workbench-card-title-row">
                      <strong>{module.label}</strong>
                      <code className={`opc-workbench-card-tag opc-tag-${module.kind}`}>{module.tag}</code>
                    </span>
                    <span>{module.description}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="opc-workbench-card-help"
                  title={`查看${module.label}图文指南`}
                  aria-label={`查看${module.label}图文指南`}
                  onClick={() => setModalModule(module.kind)}
                >
                  ?
                </button>
              </div>
              <button type="button" className={`opc-workbench-card-cta opc-cta-${module.kind}`} onClick={() => onSelect(module.kind)}>
                <span>{module.actionLabel}</span>
                <AppIcon name="chevronRight" size={14} />
              </button>
            </article>
          ))}
        </div>
      </div>

      <section className="opc-home-ref" aria-labelledby={guideHeading}>
        <div className="opc-home-ref-head">
          <div className="opc-home-ref-title">
            <h3 id={guideHeading}>使用指南与指令速查</h3>
            <span className="opc-home-ref-badge">说明文档</span>
          </div>
          <button
            type="button"
            className="opc-home-ref-toggle"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen(open => !open)}
          >
            {guideOpen ? '收起图文指南 ▴' : '展开图文指南（含应用 4 步走） ▾'}
          </button>
        </div>

        <div className="opc-home-quick-strip">
          {QUICK_COMMANDS.map(cmd => (
            <button
              key={cmd.id}
              type="button"
              className="opc-home-quick-chip"
              title={`点击复制示例：${cmd.example}`}
              onClick={() => void copyCommand(`chip-${cmd.id}`, cmd.example)}
            >
              <span>{cmd.label}</span>
              <code>{copiedId === `chip-${cmd.id}` ? '已复制示例' : cmd.shortCode}</code>
            </button>
          ))}
        </div>

        {guideOpen && (
          <div className="opc-home-ref-details">
            <div className="opc-home-guide-tabs" role="tablist" aria-label="功能使用指南">
              {GUIDE_TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={guideTab === tab.id}
                  className={`opc-home-guide-tab ${guideTab === tab.id ? 'is-active' : ''}`}
                  onClick={() => setGuideTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="opc-home-guide-body" role="tabpanel">
              {guideTab !== 'faq' ? renderModuleGuideBody(guideTab, 'tab') : (
                <div className="opc-guide-pane">
                  <div className="opc-guide-pane-head">
                    <strong>高频问题排查</strong>
                  </div>
                  <div className="opc-guide-faq-list">
                    {FAQ_ITEMS.map(item => (
                      <div key={item.q} className="opc-guide-faq-item">
                        <strong>{item.q}</strong>
                        <span>{item.a}</span>
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
              <strong>{MODULE_GUIDES[modalModule].heading}</strong>
              <button type="button" className="opc-guide-modal-close" aria-label="关闭" onClick={() => setModalModule(null)}>✕</button>
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
              <button type="button" onClick={() => setLightbox(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="opc-guide-modal-backdrop" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) dismissUpdateModal() }}>
          <div className="opc-update-modal">
            <div className="opc-guide-modal-head">
              <strong>发现 OPC 插件新版本</strong>
              <button type="button" className="opc-guide-modal-close" aria-label="关闭" onClick={dismissUpdateModal}>✕</button>
            </div>
            <div className="opc-update-versions">
              {updateInfo.currentVersion && <span className="opc-update-ver-curr">当前 v{updateInfo.currentVersion}</span>}
              <span aria-hidden="true">→</span>
              <span className="opc-update-ver-next">最新 v{updateInfo.latestVersion}</span>
            </div>
            <p className="opc-update-desc">
              新版本已发布到 npm，建议前往插件详情页更新，以获取最新功能与问题修复。
            </p>
            {updateFallback && (
              <p className="opc-update-fallback" role="status">
                请在左侧「插件」列表中找到 <code>dsh-plugin-opc</code> 进入详情页更新。
              </p>
            )}
            <div className="opc-update-actions">
              <button type="button" className="opc-update-btn-secondary" onClick={dismissUpdateModal}>稍后再说</button>
              <button type="button" className="opc-update-btn-primary" onClick={goToPluginUpdate}>去更新</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
