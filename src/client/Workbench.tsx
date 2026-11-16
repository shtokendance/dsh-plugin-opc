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
  { kind: 'knowledge', label: '知识库', icon: 'book', description: '查找企业文档与知识' },
  { kind: 'skills', label: '技能', icon: 'sparkle', description: '发现、安装和管理可用技能' },
  { kind: 'mcp', label: 'MCP', icon: 'plug', description: '查看已连接的服务和可用工具' },
  { kind: 'apps', label: '应用', icon: 'list', description: '查看已部署应用，或新建部署' },
] as const satisfies readonly { kind: ModuleKind; label: string; icon: AppIconName; description: string }[]

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

export function WorkbenchHome({ onSelect }: { onSelect: (kind: ModuleKind) => void }) {
  const heading = useId()
  return (
    <section className="opc-workbench-home" aria-labelledby={heading}>
      <h2 id={heading}>工作台首页</h2>
      <div className="opc-workbench-grid">
        {modules.map(module => (
          <button type="button" className="opc-workbench-card" key={module.kind} onClick={() => onSelect(module.kind)}>
            <span className={`opc-workbench-card-icon opc-workbench-card-${module.kind}`}><AppIcon name={module.icon} size={23} /></span>
            <span className="opc-workbench-card-copy">
              <strong>{module.label}</strong>
              <span>{module.description}</span>
            </span>
            <AppIcon name="chevronRight" size={15} />
          </button>
        ))}
      </div>
    </section>
  )
}
