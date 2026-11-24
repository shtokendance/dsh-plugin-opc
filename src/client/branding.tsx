import React from 'react'
import icon from './opc-icon.png'
import { translate, type ClientLocale, type MessageKey } from './i18n.tsx'

export const MODULE_LABEL_KEYS = {
  knowledge: 'common.module.knowledge',
  skills: 'common.module.skills',
  mcp: 'common.module.mcp',
  apps: 'common.module.apps',
} as const satisfies Record<string, MessageKey>

export type BrandModuleKind = keyof typeof MODULE_LABEL_KEYS

export function getModuleLabel(kind: BrandModuleKind, locale: ClientLocale): string {
  return translate(locale, MODULE_LABEL_KEYS[kind])
}

export function OpcIcon({ size = 16 }: { size?: number | string }) {
  return <img src={icon} alt="" width={size} height={size} style={{ verticalAlign: 'middle', objectFit: 'contain' }} />
}
