import type { zh } from './zh/index.ts'

/** Canonical message key union derived from the base (zh) dictionary. */
export type MessageKey = keyof typeof zh

/** Interpolation variables passed to `t(key, vars)` / `translate(locale, key, vars)`. */
export type MessageVars = Record<string, string | number>

/** Full locale dictionary matching every canonical message key. */
export type LocaleDictionary = Record<MessageKey, string>

/** Metadata describing a registered client locale. */
export interface LocaleDefinition<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly intlTag: string
  readonly fallback?: Id
}
