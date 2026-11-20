import React, { useEffect, useId, useRef, useState } from 'react'
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

type HomeGuideTab = 'quickstart' | ModuleKind | 'faq'

const GUIDE_TABS: readonly { id: HomeGuideTab; label: string }[] = [
  { id: 'quickstart', label: '对话指令速查' },
  { id: 'knowledge', label: '知识库用法' },
  { id: 'skills', label: '技能用法' },
  { id: 'mcp', label: 'MCP 用法' },
  { id: 'apps', label: '应用部署 4 步流' },
  { id: 'faq', label: '常见问题' },
]

const ONBOARDING_STEPS = [
  { step: '1', title: '配置网关', detail: '测试连接 HTTP 200', done: true },
  { step: '2', title: '企业登录', detail: '企微 / SSO 授权', done: true },
  { step: '3', title: '选择空间', detail: '切换企业授权范围', done: true },
  { step: '4', title: '选用能力', detail: '装技能 / 查库 / 建应用', done: false },
  { step: '5', title: '对话调用', detail: '输入 @ 或 / 唤起', done: false },
] as const

const QUICK_COMMANDS = [
  {
    id: 'kb',
    tone: 'knowledge',
    title: '引用知识库问答',
    syntax: '@<库名> 你的问题',
    example: '@企业制度库 差旅报销需要准备哪些材料？请列出依据文档的名称',
    hint: '在对话中输入 @ 从「OPC 知识库」候选中选中目标库；也可在知识库卡片点击「限定问答范围」持续绑定当前会话。',
  },
  {
    id: 'skill',
    tone: 'skills',
    title: '调用已安装技能',
    syntax: '/<技能名> 任务描述',
    example: '/excel-compare 对比这两份报价单的差异',
    hint: '先在「技能」页点击下载安装并确认已启用，随后在左侧对话输入 / 选中对应技能即可执行。',
  },
  {
    id: 'mcp',
    tone: 'mcp',
    title: '查询 MCP 业务数据',
    syntax: '说明要用哪个 MCP 服务及条件',
    example: '用订单查询 MCP 服务查一下昨天的异常采购单',
    hint: '写操作或敏感操作会触发 DSH 审批确认，阅读参数无误后确认即可执行；也可在 MCP 页在线调试。',
  },
  {
    id: 'app',
    tone: 'apps',
    title: '调用已部署的应用',
    syntax: '/app-<应用标识> 请求内容',
    example: '/app-supplier-audit 查询最近提交的审厂记录',
    hint: '应用部署并业务验证通过后自动生成本地技能，在对话中即可直接调用其业务接口。',
  },
] as const

const APP_STEPS = [
  { step: '1. 选择应用与源码', desc: '填写应用名称与访问子域名，选择本地源码文件夹或 ZIP 压缩包，发起 AI 分析。' },
  { step: '2. 与 AI 改造应用', desc: '在独立源码副本上生成 Dockerfile、契约与技能；如有待确认项（如管理员账密），在左侧会话回复即可。' },
  { step: '3. 核对并发布上线', desc: '核对容器端口、持久化数据卷、运行配置和环境变量，点击「确认配置并发布上线」。' },
  { step: '4. 部署验证与运维', desc: '查看构建日志与健康检查，启用 /app-<标识> 技能；支持版本回滚、配置更新与卷备份下载。' },
] as const

const FAQ_ITEMS = [
  { q: '登录后列表为空，或输入 @ 找不到库', a: '核对右上角的「企业空间」并点击刷新。如仍无资源，请联系管理员确认当前账号的资源授权。' },
  { q: '知识库检索显示 INVALID_REQUEST', a: '确认列表中有可见知识库，选择具体某一个库再发起检索；选库后仍报错请记录操作时间与错误码反馈。' },
  { q: '企业授权页不小心关闭了', a: '在登录页点击「重新打开授权页」，或取消后重新发起企微 / SSO 登录。' },
  { q: '右侧边栏找不到 OPC 工作台入口', a: '在「插件 → 已安装插件」确认开关已打开，进入新会话再打开右侧栏；仍找不到可完整退出重启 DSH。' },
] as const

export function WorkbenchHome({ onSelect }: { onSelect: (kind: ModuleKind) => void }) {
  const heading = useId()
  const guideHeading = useId()
  const guideRef = useRef<HTMLElement>(null)
  const [guideTab, setGuideTab] = useState<HomeGuideTab>('quickstart')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const openGuide = (tab: HomeGuideTab) => {
    setGuideTab(tab)
    guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const copyCommand = async (id: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {
      // Clipboard may be unavailable in restricted contexts; visual confirmation still resets cleanly.
    }
    setCopiedId(id)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(current => (current === id ? null : current)), 1800)
  }

  return (
    <section className="opc-workbench-home" aria-labelledby={heading}>
      <div className="opc-home-intro">
        <div className="opc-home-intro-head">
          <div className="opc-home-intro-copy">
            <h2 id={heading}>欢迎使用 OPC 企业工作台</h2>
            <p>在 DeepSeek Harness 中无缝连接企业级能力：查文档、调技能、连业务工具，以及将本地应用源码一键 AI 改造并部署上线。</p>
          </div>
          <button type="button" className="opc-home-intro-btn" onClick={() => openGuide('quickstart')}>
            对话指令速查
          </button>
        </div>
        <ol className="opc-home-steps" aria-label="上手流程">
          {ONBOARDING_STEPS.map(item => (
            <li key={item.step} className="opc-home-step">
              <span className={`opc-home-step-badge ${item.done ? 'is-done' : ''}`}>
                {item.done ? <AppIcon name="check" size={11} /> : item.step}
              </span>
              <span className="opc-home-step-text">
                <strong>{item.step}. {item.title}</strong>
                <span>{item.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="opc-home-section-head">
        <h3>核心功能入口</h3>
        <span>点击卡片进入对应模块，或点击「怎么用？」查看操作指南</span>
      </div>

      <div className="opc-workbench-grid">
        {modules.map(module => (
          <article className="opc-workbench-card" key={module.kind}>
            <button type="button" className="opc-workbench-card-main" onClick={() => onSelect(module.kind)}>
              <span className={`opc-workbench-card-icon opc-workbench-card-${module.kind}`}>
                <AppIcon name={module.icon} size={21} />
              </span>
              <span className="opc-workbench-card-copy">
                <span className="opc-workbench-card-title-row">
                  <strong>{module.label}</strong>
                  <code className={`opc-workbench-card-tag opc-tag-${module.kind}`}>{module.tag}</code>
                </span>
                <span>{module.description}</span>
              </span>
            </button>
            <div className="opc-workbench-card-footer">
              <button type="button" className="opc-workbench-card-help" onClick={() => openGuide(module.kind)}>
                怎么用？
              </button>
              <button type="button" className={`opc-workbench-card-go opc-go-${module.kind}`} onClick={() => onSelect(module.kind)}>
                <span>{module.actionLabel}</span>
                <AppIcon name="chevronRight" size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <section className="opc-home-guide" ref={guideRef} aria-labelledby={guideHeading}>
        <h3 id={guideHeading} className="sr-only">使用指南与速查手册</h3>
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
          {guideTab === 'quickstart' && (
            <div className="opc-guide-pane">
              <p className="opc-guide-lead">在左侧 DSH 对话框中，可直接通过以下方式调用已授权的企业能力（点击可复制示例）：</p>
              <div className="opc-guide-cmd-grid">
                {QUICK_COMMANDS.map(cmd => (
                  <div key={cmd.id} className="opc-guide-cmd-card">
                    <div className="opc-guide-cmd-top">
                      <strong className={`opc-cmd-title-${cmd.tone}`}>{cmd.title}</strong>
                      <button type="button" className="opc-guide-copy-btn" onClick={() => void copyCommand(cmd.id, cmd.example)}>
                        <AppIcon name={copiedId === cmd.id ? 'check' : 'copy'} size={12} />
                        <span>{copiedId === cmd.id ? '已复制' : '复制示例'}</span>
                      </button>
                    </div>
                    <code className="opc-guide-cmd-syntax">{cmd.syntax}</code>
                    <p className="opc-guide-cmd-hint">{cmd.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {guideTab === 'knowledge' && (
            <div className="opc-guide-pane">
              <div className="opc-guide-pane-head">
                <strong>企业知识库使用方式</strong>
                <button type="button" className="opc-guide-link-btn" onClick={() => onSelect('knowledge')}>前往知识库 →</button>
              </div>
              <ol className="opc-guide-list">
                <li><strong>确认空间</strong>：进入知识库页后，在右上角选择正确的「企业空间」，若列表未更新可点击「刷新」。</li>
                <li><strong>找文档（全文检索模式）</strong>：选择检索范围（全部或指定库），输入关键词点击「开始检索」，点击结果标题可打开文档正文。</li>
                <li><strong>找库（目录筛选模式）</strong>：按库名或描述筛选，点击目标卡片的「检索此库」可切回全文检索并自动选定该库。</li>
                <li><strong>AI 问答</strong>：在对话中输入 <code>@库名</code> 选中目标库，或在卡片点击「限定问答范围」（用完可点击「取消限定」）。</li>
              </ol>
            </div>
          )}

          {guideTab === 'skills' && (
            <div className="opc-guide-pane">
              <div className="opc-guide-pane-head">
                <strong>企业技能安装与调用</strong>
                <button type="button" className="opc-guide-link-btn" onClick={() => onSelect('skills')}>前往技能页 →</button>
              </div>
              <ol className="opc-guide-list">
                <li><strong>检索技能</strong>：进入「技能」模块，输入名称或关键词点击「立即检索」，支持按「全部 / 已安装 / 未安装」筛选。</li>
                <li><strong>安装启用</strong>：在目标技能卡片点击「下载安装」，等待状态变为「已启用」。</li>
                <li><strong>对话执行</strong>：回到左侧对话输入 <code>/技能名</code> 从候选中选中，附带文件或说明需求即可运行（如 <code>/excel-compare</code>）。</li>
              </ol>
            </div>
          )}

          {guideTab === 'mcp' && (
            <div className="opc-guide-pane">
              <div className="opc-guide-pane-head">
                <strong>MCP 服务查看与调试</strong>
                <button type="button" className="opc-guide-link-btn" onClick={() => onSelect('mcp')}>前往 MCP 页 →</button>
              </div>
              <ol className="opc-guide-list">
                <li><strong>查看服务</strong>：进入「MCP」模块，按服务或工具名称搜索，支持按「全部 / 已连接 / 未挂载」筛选状态。</li>
                <li><strong>核对与在线调试</strong>：展开服务卡片的「查看可用工具与调试」，可查看工具用途与参数定义，并在「在线调试调用」中输入 JSON 直接调用测试。</li>
                <li><strong>在对话中使用</strong>：直接说明要用哪个服务、哪个工具及查询条件；显式调用 <code>opc_mcp_invoke</code> 时需提供准确的 <code>service_id</code>、<code>tool_name</code> 和 <code>arguments</code>。</li>
              </ol>
            </div>
          )}

          {guideTab === 'apps' && (
            <div className="opc-guide-pane">
              <div className="opc-guide-pane-head">
                <strong>本地应用一键 AI 改造与部署上线（4 步流程）</strong>
                <button type="button" className="opc-guide-link-btn" onClick={() => onSelect('apps')}>前往应用中心 →</button>
              </div>
              <div className="opc-guide-app-steps">
                {APP_STEPS.map(item => (
                  <div key={item.step} className="opc-guide-app-step">
                    <strong>{item.step}</strong>
                    <p>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {guideTab === 'faq' && (
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
      </section>
    </section>
  )
}
