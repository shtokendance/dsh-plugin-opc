export interface ConfigChatRow {
  key: string
  value: string
  description?: string
  source?: string
  blocked?: string
}

export type ConfigChatChanges = { key: string; value: string }[]

export type ConfigChatAction =
  | { type: 'read' }
  | { type: 'edit'; changes: ConfigChatChanges; expected: ConfigChatRow[] }

export type ConfigChatFrame =
  | { type: 'ready' }
  | { type: 'request'; id: string; action: ConfigChatAction }

export type ConfigChatResult =
  | { rows: ConfigChatRow[] }
  | { changed: string[] }
  | { error: string }
