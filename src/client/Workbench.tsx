import React, { useEffect, useId, useRef, useState } from 'react'
import type { OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { getModuleLabel, labels, OpcIcon } from './branding.tsx'
import { useI18n } from './i18n.tsx'

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
    labelEn: 'Knowledge Bases',
    icon: 'book',
    tag: '@库名',
    tagEn: '@kb-name',
    description: '全文检索企业文档正文、按目录筛选，并在对话中引用指定库做精准问答。',
    descriptionEn: 'Full-text search enterprise docs, browse catalogs, and cite specific KBs in chat.',
    actionLabel: '进入知识库',
    actionLabelEn: 'Open Knowledge',
  },
  {
    kind: 'skills',
    label: '技能',
    labelEn: 'Skills',
    icon: 'sparkle',
    tag: '/技能名',
    tagEn: '/skill-name',
    description: '搜索并一键安装启用企业开放技能，在对话中输入斜杠即可调用执行。',
    descriptionEn: 'Search and install enterprise skills with one click, then invoke with / in chat.',
    actionLabel: '管理技能',
    actionLabelEn: 'Manage Skills',
  },
  {
    kind: 'mcp',
    label: 'MCP 服务',
    labelEn: 'MCP Services',
    icon: 'plug',
    tag: '在线调试',
    tagEn: 'Live Debug',
    description: '查看已连接的业务服务与工具定义，支持在线 JSON 调试调用与对话执行。',
    descriptionEn: 'Inspect connected MCP services & tools, test with JSON payloads, or invoke in chat.',
    actionLabel: '查看服务',
    actionLabelEn: 'View Services',
  },
  {
    kind: 'apps',
    label: '应用交付中心',
    labelEn: 'App Delivery',
    icon: 'list',
    tag: '/app-标识',
    tagEn: '/app-slug',
    description: '导入本地源码或 ZIP，AI 自动改造、打包部署上线并生成可调用技能。',
    descriptionEn: 'Import source or ZIP, let AI adapt, deploy to production, and generate app skills.',
    actionLabel: '管理应用',
    actionLabelEn: 'Manage Apps',
  },
] as const satisfies readonly {
  kind: ModuleKind
  label: string
  labelEn: string
  icon: AppIconName
  tag: string
  tagEn: string
  description: string
  descriptionEn: string
  actionLabel: string
  actionLabelEn: string
}[]

const pages = [{ kind: 'home', label: '首页', labelEn: 'Home', icon: 'home' }, ...modules] as const

export function readWorkbenchPage(params: unknown): PanelKind | undefined {
  if (!params || typeof params !== 'object' || !('opcPage' in params)) return undefined
  return pages.find(page => page.kind === params.opcPage)?.kind
}

export function WorkbenchNavigation({ kind, onSelect }: { kind: PanelKind; onSelect: (kind: PanelKind) => void }) {
  const { locale, isEn, tr } = useI18n()
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
  const currentLabel = currentPage ? (isEn ? currentPage.labelEn : currentPage.label) : ''

  return (
    <div className="opc-workbench-nav" ref={container} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button type="button" className="opc-workbench-trigger" ref={trigger}
        aria-label={tr('切换 OPC 页面，当前{name}', 'Switch OPC page, current: {name}', { name: currentLabel })}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="brand-icon-wrap"><OpcIcon size={18} /></span>
        <span className="brand-text">
          <span className="brand-title">{kind === 'home' ? tr(workbenchTitle, 'OPC Workbench') : getModuleLabel(kind, locale)}</span>
          {kind !== 'home' && <span className="brand-sub">{tr('OPC 工作台', 'OPC Workbench')}</span>}
        </span>
        <AppIcon name="chevronDown" size={13} />
      </button>
      <nav id={id} className="opc-workbench-menu" hidden={!open} aria-label={tr('切换 OPC 模块', 'Switch OPC module')}>
        {pages.map(page => (
          <button type="button" key={page.kind} aria-current={page.kind === kind ? 'page' : undefined}
            onClick={() => { onSelect(page.kind); setOpen(false); trigger.current?.focus() }}>
            <AppIcon name={page.icon} size={16} />
            <span>{isEn ? page.labelEn : page.label}</span>
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

export const GUIDE_TABS: readonly { id: HomeGuideTab; label: string; labelEn: string }[] = [
  { id: 'knowledge', label: '知识库用法', labelEn: 'Knowledge Guide' },
  { id: 'skills', label: '技能用法', labelEn: 'Skills Guide' },
  { id: 'mcp', label: 'MCP 用法', labelEn: 'MCP Guide' },
  { id: 'apps', label: '应用交付 4 步走', labelEn: '4-Step App Delivery' },
  { id: 'faq', label: '常见问题', labelEn: 'FAQ' },
]

const QUICK_COMMANDS = [
  {
    id: 'kb',
    label: '知识库',
    labelEn: 'KB',
    shortCode: '@<库名> 提问',
    shortCodeEn: '@<kb> ask',
    example: '@企业制度库 差旅报销需要准备哪些材料？请列出依据文档的名称',
    exampleEn: '@PolicyKB What documents are required for travel reimbursement?',
  },
  {
    id: 'skill',
    label: '技能',
    labelEn: 'Skill',
    shortCode: '/<技能名> 执行',
    shortCodeEn: '/<skill> run',
    example: '/excel-compare 对比这两份报价单的差异',
    exampleEn: '/excel-compare Compare the differences between these two quotes',
  },
  {
    id: 'mcp',
    label: 'MCP',
    labelEn: 'MCP',
    shortCode: '直接对话调用',
    shortCodeEn: 'Invoke in chat',
    example: '用订单查询 MCP 服务查一下昨天的异常采购单',
    exampleEn: 'Use the order MCP service to query abnormal purchase orders from yesterday',
  },
  {
    id: 'app',
    label: '应用',
    labelEn: 'App',
    shortCode: '/app-<标识>',
    shortCodeEn: '/app-<slug>',
    example: '/app-supplier-audit 查询最近提交的审厂记录',
    exampleEn: '/app-supplier-audit List recently submitted supplier audit records',
  },
] as const

interface GuideStep {
  badge: string
  badgeEn: string
  title: string
  titleEn: string
  desc: string
  descEn: string
  imgName: string
  imgCap: string
  imgCapEn: string
}

const MODULE_GUIDES: Record<ModuleKind, {
  heading: string
  headingEn: string
  actionLabel: string
  actionLabelEn: string
  steps: readonly GuideStep[]
  exampleTitle: string
  exampleTitleEn: string
  exampleCmd: string
  exampleCmdEn: string
  tipTitle: string
  tipTitleEn: string
  tipText: string
  tipTextEn: string
}> = {
  apps: {
    heading: '应用交付 4 步走（本地应用一键 AI 改造上线）',
    headingEn: '4-Step App Delivery (AI Adaptation & Deployment)',
    actionLabel: '前往应用交付中心 →',
    actionLabelEn: 'Go to App Delivery →',
    steps: [
      {
        badge: '第 1 步 · 选择源码',
        badgeEn: 'Step 1 · Source',
        title: '导入本地源码文件夹或 ZIP 压缩包',
        titleEn: 'Import local source folder or ZIP archive',
        desc: '进入「应用交付中心」点击「新建并部署应用」，可直接选择本机源码目录或上传项目 ZIP。系统会自动过滤构建产物与敏感文件。',
        descEn: 'Open App Delivery and click New App. Pick a local source directory or upload a ZIP archive; build artifacts and secrets are filtered automatically.',
        imgName: '16-app-source.jpg',
        imgCap: '源码文件夹与 ZIP 导入入口',
        imgCapEn: 'Source folder & ZIP import entry',
      },
      {
        badge: '第 2 步 · AI 自动分析与确认',
        badgeEn: 'Step 2 · AI Analysis',
        title: '自动分析环境并处理待确认项',
        titleEn: 'Analyze runtime & resolve confirmations',
        desc: '点击开始分析后，右侧展示分析进度，同时在左侧生成专属对话会话。若发现登录方式或端口等需确认事项，系统会暂停并提示确认。',
        descEn: 'Track analysis progress on the right while a dedicated chat session opens on the left for any required clarifications.',
        imgName: '19-app-analysis.jpg',
        imgCap: 'AI 正在分析项目源码与运行配置',
        imgCapEn: 'AI analyzing source code and runtime configs',
      },
      {
        badge: '第 3 步 · 核对配置并提交发布',
        badgeEn: 'Step 3 · Review & Publish',
        title: '确认端口、环境变量与持久化卷',
        titleEn: 'Confirm port, env vars & persistent volumes',
        desc: '打包检查完成后，在部署确认页核对应用名称、容器端口、环境变量及持久化存储卷配置，确认无误后点击「确认配置并发布上线」。',
        descEn: 'Verify app name, container port, environment variables, and persistent volume mounts before publishing.',
        imgName: '22-app-deploy-review.jpg',
        imgCap: '发布前核对运行配置与持久化卷',
        imgCapEn: 'Review runtime configs and volumes before publish',
      },
      {
        badge: '第 4 步 · 构建上线与技能就绪',
        badgeEn: 'Step 4 · Live & Skill Ready',
        title: '查看实时构建日志，通过域名直接访问',
        titleEn: 'Watch build logs & access via domain',
        desc: '提交后可实时跟踪镜像构建与容器启动日志。应用上线并分配企业域名后，即可在浏览器直接访问，同时自动生成 /app-<标识> 技能。',
        descEn: 'Follow live build and startup logs. Once live, open the assigned URL and invoke the generated /app-<slug> skill.',
        imgName: '25-app-login-page.jpg',
        imgCap: '部署上线后通过企业域名访问应用',
        imgCapEn: 'Access deployed app via assigned domain',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleTitleEn: 'Chat Invocation Example',
    exampleCmd: '/app-supplier-audit 查询最近提交的供应商审厂记录',
    exampleCmdEn: '/app-supplier-audit Query recently submitted supplier audit records',
    tipTitle: '运维保障',
    tipTitleEn: 'Operations',
    tipText: '版本升级与回滚均会保留挂载卷中的业务数据；支持单卷与整应用数据快照备份下载。',
    tipTextEn: 'Upgrades and rollbacks preserve data in persistent volumes; single-volume and full-app backup downloads are supported.',
  },
  knowledge: {
    heading: '企业知识库使用方式',
    headingEn: 'How to Use Enterprise Knowledge Bases',
    actionLabel: '打开知识库 →',
    actionLabelEn: 'Open Knowledge →',
    steps: [
      {
        badge: '方式 A · 全文检索',
        badgeEn: 'Mode A · Full-Text Search',
        title: '关键词检索企业文档正文',
        titleEn: 'Search enterprise document contents by keyword',
        desc: '切换到「文档全文检索」模式输入关键词即可检索正文内容；在左侧对话输入 @ 选择「OPC 知识库」即可引用指定文档问答。',
        descEn: 'Switch to Full-Text Search to query document contents, or type @ in chat to cite a specific knowledge base.',
        imgName: '11-knowledge-search.jpg',
        imgCap: '知识库全文检索与范围切换',
        imgCapEn: 'Full-text search and scope switcher',
      },
      {
        badge: '方式 B · 目录定位与限定',
        badgeEn: 'Mode B · Catalog & Pinning',
        title: '按目录筛选并持续限定会话范围',
        titleEn: 'Filter catalog & pin scope to conversation',
        desc: '切换到「知识库目录」可按名称或描述快速定位库，点击「限定问答范围」可将该知识库持续绑定到当前对话，用完点「取消限定」。',
        descEn: 'Filter by name or description in the catalog and pin a KB to keep it scoped for the current conversation.',
        imgName: '12-knowledge-catalog.jpg',
        imgCap: '按名称或描述筛选知识库目录',
        imgCapEn: 'Filter KB catalog by name or description',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleTitleEn: 'Chat Invocation Example',
    exampleCmd: '@企业制度库 差旅报销需要准备哪些材料？请列出依据文档的名称',
    exampleCmdEn: '@PolicyKB What documents are needed for travel reimbursement?',
    tipTitle: '排查提示',
    tipTitleEn: 'Troubleshooting',
    tipText: '若全部库检索报错 INVALID_REQUEST，请确认列表中有可见知识库，先选中具体某一个库再检索。',
    tipTextEn: 'If searching all KBs returns INVALID_REQUEST, select a specific visible KB first.',
  },
  skills: {
    heading: '企业技能安装与调用',
    headingEn: 'Installing & Invoking Enterprise Skills',
    actionLabel: '管理技能 →',
    actionLabelEn: 'Manage Skills →',
    steps: [
      {
        badge: '下载与调用',
        badgeEn: 'Install & Invoke',
        title: '一键安装启用并在对话中 / 调用',
        titleEn: 'Install with one click & invoke with / in chat',
        desc: '在技能页搜索企业开放技能（如财务报销审查、Excel 比对等），点击「下载安装」并确认启用后，在左侧对话输入 /技能名 任务描述 即可执行。',
        descEn: 'Search enterprise skills, click Install, and invoke them in chat with /skill-name followed by your task.',
        imgName: '14-skills.jpg',
        imgCap: 'OPC 技能搜索与安装状态筛选',
        imgCapEn: 'OPC skills search and status filter',
      },
    ],
    exampleTitle: '对话调用示例',
    exampleTitleEn: 'Chat Invocation Example',
    exampleCmd: '/excel-compare 请对比这两份报价单，按物料编码列输出差异明细',
    exampleCmdEn: '/excel-compare Compare these two quotations by item code',
    tipTitle: '使用说明',
    tipTitleEn: 'Usage Note',
    tipText: '技能安装后立即在本地生效；搭配文件上传（如 Excel、合同文档）可发挥最佳自动化处理效果。',
    tipTextEn: 'Installed skills take effect locally right away and work great with uploaded files.',
  },
  mcp: {
    heading: 'MCP 服务查看与调试',
    headingEn: 'Inspecting & Debugging MCP Services',
    actionLabel: '查看与调试服务 →',
    actionLabelEn: 'View & Debug Services →',
    steps: [
      {
        badge: '查看与调试',
        badgeEn: 'Inspect & Debug',
        title: '在线调试 JSON 入参或直接在对话调用',
        titleEn: 'Test JSON inputs online or invoke in chat',
        desc: '在 MCP 服务页查看已连接服务与工具 Schema，支持填写 JSON 参数在线测试；在左侧对话直接下达业务指令时，写操作会触发安全审批确认。',
        descEn: 'Inspect connected MCP services and tool schemas, run JSON test calls, or invoke them directly in chat with approval guards.',
        imgName: '15-mcp.jpg',
        imgCap: 'MCP 服务列表与连接状态筛选',
        imgCapEn: 'MCP service list and connection filter',
      },
    ],
    exampleTitle: '显式调用示例',
    exampleTitleEn: 'Explicit Call Example',
    exampleCmd: '使用 supply-chain-erp 的 query_supplier_status 查询供应商 SUP-2026-008 状态',
    exampleCmdEn: 'Use query_supplier_status from supply-chain-erp to check supplier SUP-2026-008',
    tipTitle: '调试贴士',
    tipTitleEn: 'Debug Tip',
    tipText: '建议优先选择只读工具做首次联调；写操作或敏感动作会在对话中弹出审批卡片。',
    tipTextEn: 'Start with read-only tools for initial verification; write actions trigger an approval card in chat.',
  },
} as const

const FAQ_ITEMS = [
  {
    q: '登录后列表为空，或输入 @ 找不到库',
    qEn: 'List is empty after login, or @ shows no KBs',
    a: '点击右上角「刷新」同步最新授权目录。如仍无资源，请联系管理员确认当前账号的空间与资源授权。',
    aEn: 'Click Refresh at the top right to sync authorized catalogs, or contact an administrator to verify space permissions.',
  },
  {
    q: '知识库检索显示 INVALID_REQUEST',
    qEn: 'Knowledge search returns INVALID_REQUEST',
    a: '确认列表中有可见知识库，选择具体某一个库再发起检索；选库后仍报错请记录操作时间与错误码反馈。',
    aEn: 'Ensure at least one KB is visible and select a specific KB before searching.',
  },
  {
    q: '企业授权页不小心关闭了',
    qEn: 'Accidentally closed the authorization page',
    a: '在登录页点击「重新打开授权页」，或取消后重新发起企微 / SSO 登录。',
    aEn: 'Click Reopen Auth Page on the login screen, or cancel and start login again.',
  },
  {
    q: '右侧边栏找不到 OPC 工作台入口',
    qEn: 'Cannot find OPC Workbench in the right sidebar',
    a: '在「插件 → 已安装插件」确认开关已打开，进入新会话再打开右侧栏；仍找不到可完整退出重启 DSH。',
    aEn: 'Verify the plugin is enabled under Plugins -> Installed, open a new session, or restart DSH.',
  },
] as const

type UpdateInfo = { currentVersion: string; latestVersion: string; hasUpdate: boolean }

let dismissedUpdateVersion = ''

export function WorkbenchHome({ onSelect, api, visible = true, onOpenPluginDetail }: {
  onSelect: (kind: ModuleKind) => void
  api?: OpcApi
  visible?: boolean
  onOpenPluginDetail?: () => boolean
}) {
  const { isEn, tr } = useI18n()
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
    const cmdText = isEn ? detail.exampleCmdEn : detail.exampleCmd
    return (
      <div className="opc-guide-pane">
        <div className="opc-guide-pane-head">
          <strong>{isEn ? detail.headingEn : detail.heading}</strong>
          <button type="button" className="opc-guide-link-btn" onClick={() => { setModalModule(null); onSelect(kind) }}>
            {isEn ? detail.actionLabelEn : detail.actionLabel}
          </button>
        </div>
        <div className="opc-guide-illustrated-list">
          {detail.steps.map(step => {
            const src = images[step.imgName]
            const cap = isEn ? step.imgCapEn : step.imgCap
            return (
              <div key={step.title} className="opc-guide-step-row">
                <div className="opc-guide-step-copy">
                  <span className={`opc-guide-badge opc-badge-${kind}`}>{isEn ? step.badgeEn : step.badge}</span>
                  <h4>{isEn ? step.titleEn : step.title}</h4>
                  <p>{isEn ? step.descEn : step.desc}</p>
                </div>
                {src ? (
                  <button
                    type="button"
                    className="opc-guide-shot-btn"
                    onClick={() => setLightbox({ src, cap })}
                    title={tr('点击放大查看截图', 'Click to enlarge')}
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
              <strong>{isEn ? detail.exampleTitleEn : detail.exampleTitle}</strong>
              <button
                type="button"
                className="opc-guide-copy-btn"
                onClick={() => void copyCommand(`${copyKeyPrefix}-${kind}`, cmdText)}
              >
                <AppIcon name={copiedId === `${copyKeyPrefix}-${kind}` ? 'check' : 'copy'} size={12} />
                <span>{copiedId === `${copyKeyPrefix}-${kind}` ? tr('已复制', 'Copied') : tr('复制示例', 'Copy')}</span>
              </button>
            </div>
            <code className="opc-guide-cmd-syntax">{cmdText}</code>
          </div>
          <div className="opc-guide-tip-box">
            <strong>{isEn ? detail.tipTitleEn : detail.tipTitle}</strong>
            <p>{isEn ? detail.tipTextEn : detail.tipText}</p>
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
            <h2 id={heading}>{tr('企业能力工作台', 'Enterprise Workbench')}</h2>
            {PLUGIN_VERSION && <span className="opc-home-version">v{PLUGIN_VERSION}</span>}
          </div>
          <p>{tr('选择下方功能模块进入管理，或在左侧对话中直接调用企业能力。', 'Choose a module below to manage, or invoke enterprise capabilities directly in chat.')}</p>
        </div>
      </div>

      <div>
        <div className="opc-home-section-head">
          <div className="opc-home-section-label">
            <span className="opc-home-section-dot" aria-hidden="true" />
            <h3>{tr('功能模块入口', 'Modules')}</h3>
          </div>
          <span>{tr('点击卡片进入模块 · 点击 ? 查看图文指南', 'Click card to open · Click ? for guide')}</span>
        </div>

        <div className="opc-workbench-grid">
          {modules.map(module => {
            const label = isEn ? module.labelEn : module.label
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
                        <code className={`opc-workbench-card-tag opc-tag-${module.kind}`}>{isEn ? module.tagEn : module.tag}</code>
                      </span>
                      <span>{isEn ? module.descriptionEn : module.description}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="opc-workbench-card-help"
                    title={tr('查看{name}图文指南', 'View {name} guide', { name: label })}
                    aria-label={tr('查看{name}图文指南', 'View {name} guide', { name: label })}
                    onClick={() => setModalModule(module.kind)}
                  >
                    ?
                  </button>
                </div>
                <button type="button" className={`opc-workbench-card-cta opc-cta-${module.kind}`} onClick={() => onSelect(module.kind)}>
                  <span>{isEn ? module.actionLabelEn : module.actionLabel}</span>
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
            <h3 id={guideHeading}>{tr('使用指南与指令速查', 'Quick Guide & Commands')}</h3>
            <span className="opc-home-ref-badge">{tr('说明文档', 'Docs')}</span>
          </div>
          <button
            type="button"
            className="opc-home-ref-toggle"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen(open => !open)}
          >
            {guideOpen ? tr('收起图文指南 ▴', 'Hide Guide ▴') : tr('展开图文指南（含应用 4 步走） ▾', 'Show Guide (4-Step Delivery) ▾')}
          </button>
        </div>

        <div className="opc-home-quick-strip">
          {QUICK_COMMANDS.map(cmd => {
            const example = isEn ? cmd.exampleEn : cmd.example
            return (
              <button
                key={cmd.id}
                type="button"
                className="opc-home-quick-chip"
                title={tr('点击复制示例：{ex}', 'Click to copy: {ex}', { ex: example })}
                onClick={() => void copyCommand(`chip-${cmd.id}`, example)}
              >
                <span>{isEn ? cmd.labelEn : cmd.label}</span>
                <code>{copiedId === `chip-${cmd.id}` ? tr('已复制示例', 'Copied') : (isEn ? cmd.shortCodeEn : cmd.shortCode)}</code>
              </button>
            )
          })}
        </div>

        {guideOpen && (
          <div className="opc-home-ref-details">
            <div className="opc-home-guide-tabs" role="tablist" aria-label={tr('功能使用指南', 'Feature Guides')}>
              {GUIDE_TABS.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={guideTab === tab.id}
                  className={`opc-home-guide-tab ${guideTab === tab.id ? 'is-active' : ''}`}
                  onClick={() => setGuideTab(tab.id)}
                >
                  {isEn ? tab.labelEn : tab.label}
                </button>
              ))}
            </div>

            <div className="opc-home-guide-body" role="tabpanel">
              {guideTab !== 'faq' ? renderModuleGuideBody(guideTab, 'tab') : (
                <div className="opc-guide-pane">
                  <div className="opc-guide-pane-head">
                    <strong>{tr('高频问题排查', 'Frequently Asked Questions')}</strong>
                  </div>
                  <div className="opc-guide-faq-list">
                    {FAQ_ITEMS.map(item => (
                      <div key={item.q} className="opc-guide-faq-item">
                        <strong>{isEn ? item.qEn : item.q}</strong>
                        <span>{isEn ? item.aEn : item.a}</span>
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
              <strong>{isEn ? MODULE_GUIDES[modalModule].headingEn : MODULE_GUIDES[modalModule].heading}</strong>
              <button type="button" className="opc-guide-modal-close" aria-label={tr('关闭', 'Close')} onClick={() => setModalModule(null)}>✕</button>
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
              <button type="button" onClick={() => setLightbox(null)}>{tr('关闭', 'Close')}</button>
            </div>
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="opc-guide-modal-backdrop" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) dismissUpdateModal() }}>
          <div className="opc-update-modal">
            <div className="opc-guide-modal-head">
              <strong>{tr('发现 OPC 插件新版本', 'OPC Plugin Update Available')}</strong>
              <button type="button" className="opc-guide-modal-close" aria-label={tr('关闭', 'Close')} onClick={dismissUpdateModal}>✕</button>
            </div>
            <div className="opc-update-versions">
              {updateInfo.currentVersion && <span className="opc-update-ver-curr">{tr('当前 v{ver}', 'Current v{ver}', { ver: updateInfo.currentVersion })}</span>}
              <span aria-hidden="true">→</span>
              <span className="opc-update-ver-next">{tr('最新 v{ver}', 'Latest v{ver}', { ver: updateInfo.latestVersion })}</span>
            </div>
            <p className="opc-update-desc">
              {tr('新版本已发布到 npm，建议前往插件详情页更新，以获取最新功能与问题修复。', 'A new version is published on npm. Update from the plugin details page for the latest fixes and features.')}
            </p>
            {updateFallback && (
              <p className="opc-update-fallback" role="status">
                {tr('请在左侧「插件」列表中找到 dsh-plugin-opc 进入详情页更新。', 'Open Plugins -> dsh-plugin-opc on the left to update.')}
              </p>
            )}
            <div className="opc-update-actions">
              <button type="button" className="opc-update-btn-secondary" onClick={dismissUpdateModal}>{tr('稍后再说', 'Later')}</button>
              <button type="button" className="opc-update-btn-primary" onClick={goToPluginUpdate}>{tr('去更新', 'Update')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
