import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  FALLBACK_LOCALE,
  getIntlLocale,
  LOCALE_MESSAGES,
  resolveClientLocale,
  SUPPORTED_LOCALES,
  translate,
  type MessageKey,
} from '../src/client/i18n.tsx'

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{[a-zA-Z0-9_]+\}/g) ?? []
  return [...new Set(matches)].sort()
}

test('resolveClientLocale maps registered language variants and falls back to en', () => {
  assert.equal(resolveClientLocale('zh'), 'zh')
  assert.equal(resolveClientLocale('zh-CN'), 'zh')
  assert.equal(resolveClientLocale('zh-TW'), 'zh')
  assert.equal(resolveClientLocale('ZH-Hant'), 'zh')
  assert.equal(resolveClientLocale('zh_CN'), 'zh')
  assert.equal(resolveClientLocale('en'), 'en')
  assert.equal(resolveClientLocale('en-US'), 'en')
  assert.equal(resolveClientLocale('ja'), FALLBACK_LOCALE)
  assert.equal(resolveClientLocale('fr-FR'), FALLBACK_LOCALE)
  assert.equal(resolveClientLocale('de'), FALLBACK_LOCALE)
  assert.equal(resolveClientLocale(''), FALLBACK_LOCALE)
  assert.equal(resolveClientLocale(undefined), FALLBACK_LOCALE)
})

test('getIntlLocale returns BCP-47 tags for registered locales', () => {
  assert.equal(getIntlLocale('zh'), 'zh-CN')
  assert.equal(getIntlLocale('en'), 'en-US')
})

test('translate resolves dictionary entries by locale and formats placeholders', () => {
  assert.equal(translate('zh', 'workbench.opcWorkbench'), '本来工作台')
  assert.equal(translate('en', 'workbench.opcWorkbench'), 'Benlai Workbench')
  assert.equal(
    translate('zh', 'workbench.viewGuide', { name: '知识库' }),
    '查看知识库图文指南',
  )
  assert.equal(
    translate('en', 'workbench.viewGuide', { name: 'Knowledge Bases' }),
    'View Knowledge Bases guide',
  )
})

test('all registered locale dictionaries share identical key sets and non-empty values', () => {
  const baseKeys = Object.keys(LOCALE_MESSAGES.zh).sort()
  assert.ok(baseKeys.length > 0, 'base zh dictionary should not be empty')

  for (const locale of SUPPORTED_LOCALES) {
    const dict = LOCALE_MESSAGES[locale]
    const keys = Object.keys(dict).sort()
    assert.deepEqual(keys, baseKeys, `locale "${locale}" key set must match zh`)

    for (const key of baseKeys as MessageKey[]) {
      assert.equal(typeof dict[key], 'string', `${locale}.${key} must be a string`)
      assert.ok(dict[key].length > 0, `${locale}.${key} must not be empty`)
    }
  }
})

test('all registered locale dictionaries preserve identical placeholder variables per key', () => {
  const LITERAL_BRACE_KEYS = new Set<MessageKey>(['settings.subdomainExample'])
  const base = LOCALE_MESSAGES.zh
  const keys = Object.keys(base) as MessageKey[]

  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'zh') continue
    const dict = LOCALE_MESSAGES[locale]
    for (const key of keys) {
      if (LITERAL_BRACE_KEYS.has(key)) continue
      const expected = extractPlaceholders(base[key])
      const actual = extractPlaceholders(dict[key])
      assert.deepEqual(
        actual,
        expected,
        `placeholder mismatch for ${locale}["${key}"]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
    }
  }
})

test('client apply registers sidebarRightTabs workbench entry under real Cordis Context without throwing on locale', async (t) => {
  let ContextCtor: (new () => {
    provide: (name: string, value: never) => void
    on: (event: string, listener: (err: unknown) => void) => void
    plugin: (plugin: { inject: string[]; apply: (ctx: unknown) => Promise<void> }) => Promise<unknown>
  }) | undefined
  try {
    const mod = await import('@deepseek-ai/cordis')
    ContextCtor = mod.Context as typeof ContextCtor
  } catch {
    t.skip('@deepseek-ai/cordis peer dependency is not installed in standalone checkout')
    return
  }
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let exported: { apply: (ctx: unknown) => Promise<void> } | null = null
  const loader = {
    load(spec: { factory: (req: (name: string) => unknown) => { apply: (ctx: unknown) => Promise<void> } }) {
      exported = spec.factory((name: string) => {
        if (name === 'react') {
          return {
            default: {},
            createElement: () => ({}),
            createContext: () => ({ Provider: () => null }),
            useContext: () => ({}),
            useState: () => [null, () => {}],
            useEffect: () => {},
            useRef: () => ({ current: null }),
            useId: () => 'id',
            useMemo: (fn: () => unknown) => fn(),
            useCallback: (fn: unknown) => fn,
            useSyncExternalStore: (_sub: unknown, get: () => unknown) => get(),
            Fragment: 'Fragment',
          }
        }
        if (name === 'react-dom') return {}
        if (name === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' }
        throw new Error(`Unexpected require: ${name}`)
      })
    },
  }
  const doc = {
    documentElement: { lang: 'zh-CN' },
    head: { appendChild() {} },
    createElement: () => ({ rel: '', type: '', textContent: '', innerHTML: '' }),
    getElementById: () => null,
  }
  const runner = new Function('window', 'document', 'navigator', code)
  runner({ __ModuleLoader__: loader }, doc, { language: 'zh-CN' })
  assert.ok(exported)

  const root = new ContextCtor!()
  const registered: Array<{ id: string; kind: string }> = []
  root.provide('remote', {
    $mount: async () => () => {},
    opc: new Proxy({}, { get: () => async () => ({ ok: true, value: '{}' }) }),
  } as never)
  root.provide('remote.opc', new Proxy({}, { get: () => async () => ({ ok: true, value: '{}' }) }) as never)
  root.provide('slots', {
    inject: () => () => {},
    register: () => () => {},
  } as never)
  root.provide('sidebarRightTabs', {
    register: (def: { id: string; kind: string }) => {
      registered.push({ id: def.id, kind: def.kind })
      return () => {}
    },
  } as never)

  let uncaught: unknown = null
  root.on('internal/error', (err) => {
    uncaught = err
  })

  await root.plugin({ inject: ['remote'], apply: exported.apply })
  await new Promise(resolve => setTimeout(resolve, 20))

  assert.equal(uncaught, null)
  assert.ok(registered.some(item => item.id === 'dsh-plugin-opc/workbench' && item.kind === 'opc-workbench'))
})
