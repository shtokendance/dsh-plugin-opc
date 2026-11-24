import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { resolveClientLocale, translatePair } from '../src/client/i18n.tsx'

test('resolveClientLocale maps Chinese variants to zh and all other languages to en', () => {
  assert.equal(resolveClientLocale('zh'), 'zh')
  assert.equal(resolveClientLocale('zh-CN'), 'zh')
  assert.equal(resolveClientLocale('zh-TW'), 'zh')
  assert.equal(resolveClientLocale('ZH-Hant'), 'zh')
  assert.equal(resolveClientLocale('en'), 'en')
  assert.equal(resolveClientLocale('en-US'), 'en')
  assert.equal(resolveClientLocale('ja'), 'en')
  assert.equal(resolveClientLocale('fr-FR'), 'en')
  assert.equal(resolveClientLocale('de'), 'en')
  assert.equal(resolveClientLocale(''), 'en')
  assert.equal(resolveClientLocale(undefined), 'en')
})

test('translatePair selects text by resolved locale and formats placeholders', () => {
  assert.equal(translatePair('zh', '共有 {n} 个应用', '{n} apps total', { n: 5 }), '共有 5 个应用')
  assert.equal(translatePair('en', '共有 {n} 个应用', '{n} apps total', { n: 5 }), '5 apps total')
})

test('client apply registers sidebarRightTabs workbench entry under real Cordis Context without throwing on locale', async () => {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let exported: { apply: (ctx: Context) => Promise<void> } | null = null
  const loader = {
    load(spec: { factory: (req: (name: string) => unknown) => { apply: (ctx: Context) => Promise<void> } }) {
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

  const root = new Context()
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
