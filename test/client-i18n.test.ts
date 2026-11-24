import assert from 'node:assert/strict'
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
  assert.equal(translate('zh', 'workbench.opcWorkbench'), 'OPC 工作台')
  assert.equal(translate('en', 'workbench.opcWorkbench'), 'OPC Workbench')
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
