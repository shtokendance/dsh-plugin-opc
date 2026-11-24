import type { MessageKey } from '../types.ts'
import { apps } from './apps.ts'
import { common } from './common.ts'
import { panel } from './panel.ts'
import { settings } from './settings.ts'
import { workbench } from './workbench.ts'

export const en = {
  ...common,
  ...workbench,
  ...panel,
  ...apps,
  ...settings,
} as const satisfies Record<MessageKey, string>
