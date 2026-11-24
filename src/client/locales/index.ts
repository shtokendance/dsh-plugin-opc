import { en } from './en/index.ts'
import { zh } from './zh/index.ts'
import type { LocaleDefinition, LocaleDictionary, MessageKey, MessageVars } from './types.ts'

export type { LocaleDefinition, LocaleDictionary, MessageKey, MessageVars } from './types.ts'

/**
 * Registered locale dictionaries.
 * To add a new language (e.g. `ja`, `zh-TW`), add its folder under `locales/<id>/`
 * and register it in `LOCALE_MESSAGES` and `LOCALE_DEFINITIONS` below.
 */
export const LOCALE_MESSAGES = {
  zh,
  en,
} as const satisfies Record<string, LocaleDictionary>

export type ClientLocale = keyof typeof LOCALE_MESSAGES

export const FALLBACK_LOCALE: ClientLocale = 'en'

export const LOCALE_DEFINITIONS: Record<ClientLocale, LocaleDefinition<ClientLocale>> = {
  zh: { id: 'zh', label: '中文', intlTag: 'zh-CN', fallback: 'en' },
  en: { id: 'en', label: 'English', intlTag: 'en-US' },
}

export const SUPPORTED_LOCALES = Object.keys(LOCALE_MESSAGES) as ClientLocale[]

export function resolveClientLocale(raw?: string | null): ClientLocale {
  if (typeof raw !== 'string') return FALLBACK_LOCALE
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized) return FALLBACK_LOCALE

  // 1. Exact match against registered locale ids
  for (const id of SUPPORTED_LOCALES) {
    if (id.toLowerCase() === normalized) return id
  }

  // 2. Primary language subtag match (e.g. zh-CN / zh-TW / zh-Hant -> zh, en-US -> en)
  const primary = normalized.split('-')[0]
  for (const id of SUPPORTED_LOCALES) {
    if (id.toLowerCase() === primary) return id
  }

  return FALLBACK_LOCALE
}

export function getIntlLocale(locale: ClientLocale): string {
  return LOCALE_DEFINITIONS[locale]?.intlTag ?? LOCALE_DEFINITIONS[FALLBACK_LOCALE].intlTag
}

export function lookupMessage(locale: ClientLocale, key: MessageKey): string {
  const visited = new Set<ClientLocale>()
  let current: ClientLocale | undefined = locale
  while (current && !visited.has(current)) {
    visited.add(current)
    const dict = LOCALE_MESSAGES[current]
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) {
      const value = dict[key]
      if (value !== undefined) return value
    }
    current = LOCALE_DEFINITIONS[current]?.fallback
  }
  return LOCALE_MESSAGES[FALLBACK_LOCALE][key] ?? key
}

export function formatMessage(template: string, vars?: MessageVars): string {
  if (!vars) return template
  let text = template
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}

export function translate(locale: ClientLocale, key: MessageKey, vars?: MessageVars): string {
  return formatMessage(lookupMessage(locale, key), vars)
}
