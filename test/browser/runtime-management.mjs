import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('owners can restart from the list and apply runtime values from the default detail tab', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'
      const managed = { slug: 'test-app', name: '测试应用', status: 'running', current_version: 5, can_manage: true, container_port: 8080, app_url: 'https://test-app.example.test', app_config: [
        { key: 'PUBLIC_ORIGIN', value: 'https://app.example.test', original_value: 'http://localhost:8080', description: '应用公开访问的网址。用于生成回调地址。', required: true },
        { key: 'PGHOST', value: '', resource_id: 'database', effective_value: 'bound-db.example.test', required: true },
        { key: 'PORT', value: '8080' },
      ] }
      const shared = { ...managed, slug: 'shared-app', name: '共享测试应用', can_manage: false, app_config: [] }
      let receipt = null
      const api = {
        appCatalog: async () => JSON.stringify({ apps: [managed, shared] }),
        appDetails: async slug => JSON.stringify(slug === managed.slug ? managed : shared),
        appVersions: async () => JSON.stringify({ versions: [{is_active:true, version:5, status:'running', config_revision:'baseline'}] }),
        appList: async () => '[]',
        appResources: async () => JSON.stringify({ resources: [{ id: 'database', name: '共享数据库', type: 'postgres', env_keys: ['PGHOST'], env_preview: { PGHOST: 'preview-db.example.test' } }] }),
        appModels: async () => '[]',
        appRuntimeStatus: async () => {
          if (window.runtimeReadError) throw new Error('平台暂时无法读取运行配置')
          return JSON.stringify({ operation: receipt, revisions: [], editable_keys: ['PUBLIC_ORIGIN'], config_revision: 'baseline', config_number: 1 })
        },
        appRuntimeChange: async (_slug, raw) => {
          const command = JSON.parse(raw)
          window.command = command
          receipt = { id: 'receipt', kind: command.kind, state:'succeeded', message:'应用已恢复访问' }
          return JSON.stringify(receipt)
        },
      }
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-breakpad'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.setContent('<main id="app"></main>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: '重启应用', exact: true }).click()
  await page.getByRole('button', { name: '确认重启', exact: true }).click()
  await page.getByText('应用已恢复访问').waitFor()
  await page.getByRole('button', { name: '关闭状态', exact: true }).click()
  await page.reload()
  await page.setContent('<main id="app"></main>')
  await page.evaluate(() => { window.runtimeReadError = true })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: '详情', exact: true }).first().click()
  await page.getByRole('tab', { name: '运行配置', selected: true }).waitFor()
  const tabs = await page.getByRole('tab').allTextContents()
  assert.ok(tabs.includes('能力与技能'))
  assert.equal(tabs.at(-1), '资源大盘')
  await page.getByRole('alert').getByText('平台暂时无法读取运行配置').waitFor({ timeout: 4000 })
  assert.equal(await page.getByRole('button', { name: '保存并重启', exact: true }).count(), 0)
  await page.evaluate(() => { window.runtimeReadError = false })
  await page.getByRole('button', { name: '重新加载配置', exact: true }).click()
  const comparison = page.getByRole('region', { name: '应用配置对照' })
  await comparison.waitFor({ timeout: 4000 })
  await comparison.getByRole('heading', { name: '运行时环境变量' }).waitFor()
  const save = page.getByRole('button', { name: '保存并重启', exact: true })
  assert.ok(await save.isDisabled())
  const original = comparison.getByLabel('PUBLIC_ORIGIN 原始值')
  const effective = comparison.getByLabel('PUBLIC_ORIGIN 配置值')
  assert.equal(await original.inputValue(), 'http://localhost:8080')
  assert.equal(await original.isEditable(), false)
  assert.equal(await effective.inputValue(), 'https://app.example.test')
  assert.ok(await effective.isEditable())
  assert.equal(await comparison.getByLabel('PGHOST 配置值').inputValue(), 'bound-db.example.test')
  assert.equal(await comparison.getByLabel('PGHOST 配置值').isEditable(), false)
  assert.equal(await comparison.getByRole('button', { name: /新增环境变量|改为手填|改用/ }).count(), 0)
  await comparison.getByText(/容器基础参数/).click()
  assert.equal(await comparison.getByLabel('PORT 配置值').isEditable(), false)
  await effective.fill('https://next.example.test')
  await comparison.getByText('已修改 1 项').waitFor()
  assert.equal(await original.inputValue(), 'http://localhost:8080')
  await effective.fill('https://app.example.test')
  assert.ok(await save.isDisabled())
  await effective.fill('https://next.example.test')
  await save.click()
  await page.waitForFunction(() => window.command?.kind === 'config')
  assert.deepEqual(await page.evaluate(() => window.command), {
    kind: 'config', base_version: 5, base_config_revision: 'baseline',
    changes: { PUBLIC_ORIGIN: 'https://next.example.test' },
  })
})
