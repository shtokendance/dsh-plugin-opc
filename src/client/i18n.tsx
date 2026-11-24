import React, { createContext, useContext, useSyncExternalStore } from 'react'
import {
  FALLBACK_LOCALE,
  getIntlLocale,
  LOCALE_DEFINITIONS,
  LOCALE_MESSAGES,
  resolveClientLocale,
  SUPPORTED_LOCALES,
  translate,
  type ClientLocale,
  type LocaleDefinition,
  type LocaleDictionary,
  type MessageKey,
  type MessageVars,
} from './locales/index.ts'

export {
  FALLBACK_LOCALE,
  getIntlLocale,
  LOCALE_DEFINITIONS,
  LOCALE_MESSAGES,
  resolveClientLocale,
  SUPPORTED_LOCALES,
  translate,
  type ClientLocale,
  type LocaleDefinition,
  type LocaleDictionary,
  type MessageKey,
  type MessageVars,
}

export interface DshLocaleRuntime {
  getSnapshot?: () => { active?: string }
  subscribe?: (fn: () => void) => () => void
}

function readBrowserLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement?.lang) {
    return document.documentElement.lang
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return 'zh'
}

let activeRuntime: DshLocaleRuntime | undefined

export function bindDshLocaleRuntime(runtime?: DshLocaleRuntime): void {
  activeRuntime = runtime
}

export function getActiveClientLocale(): ClientLocale {
  const fromRuntime = activeRuntime?.getSnapshot?.()?.active
  return resolveClientLocale(fromRuntime ?? readBrowserLocale())
}

function subscribeLocale(listener: () => void): () => void {
  const unsubRuntime = activeRuntime?.subscribe?.(listener)
  if (typeof window === 'undefined') {
    return () => { unsubRuntime?.() }
  }
  const onLang = () => listener()
  window.addEventListener('languagechange', onLang)
  return () => {
    unsubRuntime?.()
    window.removeEventListener('languagechange', onLang)
  }
}

export interface I18nContextValue {
  locale: ClientLocale
  t: (key: MessageKey, vars?: MessageVars) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  t: (key, vars) => translate('zh', key, vars),
})

export function LocaleProvider({
  runtime,
  children,
}: {
  runtime?: DshLocaleRuntime
  children: React.ReactNode
}) {
  if (runtime) activeRuntime = runtime
  const locale = useSyncExternalStore(
    subscribeLocale,
    getActiveClientLocale,
    () => 'zh' as ClientLocale
  )
  const value: I18nContextValue = {
    locale,
    t: (key, vars) => translate(locale, key, vars),
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
