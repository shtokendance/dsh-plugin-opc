import assert from 'node:assert/strict'
import { test } from 'node:test'
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
