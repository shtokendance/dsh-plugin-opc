import React from 'react'
import icon from './opc-icon.png'
import type { ClientLocale } from './i18n.tsx'

export const labels = { knowledge: 'OPC 知识库', skills: 'OPC 技能', mcp: 'OPC MCP', apps: 'OPC 应用' }
export const labelsEn = { knowledge: 'OPC Knowledge', skills: 'OPC Skills', mcp: 'OPC MCP', apps: 'OPC Apps' }
export function getModuleLabel(kind: keyof typeof labels, locale: ClientLocale): string {
  return locale === 'zh' ? labels[kind] : labelsEn[kind]
}
export function OpcIcon({ size = 16 }: { size?: number | string }) {
  return <img src={icon} alt="" width={size} height={size} style={{ verticalAlign: 'middle', objectFit: 'contain' }} />
}
