import React, { createContext, useContext, useSyncExternalStore } from 'react'

export type ClientLocale = 'zh' | 'en'

export interface DshLocaleRuntime {
  getSnapshot?: () => { active?: string }
  subscribe?: (fn: () => void) => () => void
}

export function resolveClientLocale(raw?: string | null): ClientLocale {
  if (typeof raw !== 'string') return 'en'
  const trimmed = raw.trim()
  return /^zh(?:[-_]|$)/i.test(trimmed) ? 'zh' : 'en'
}

export function translatePair(
  locale: ClientLocale,
  zh: string,
  en: string,
  vars?: Record<string, string | number>
): string {
  let text = locale === 'zh' ? zh : en
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
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

interface I18nContextValue {
  locale: ClientLocale
  isEn: boolean
  tr: (zh: string, en: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  isEn: false,
  tr: (zh, _en, vars) => translatePair('zh', zh, _en, vars),
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
    isEn: locale === 'en',
    tr: (zh, en, vars) => translatePair(locale, zh, en, vars),
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
