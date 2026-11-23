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
      const managed = { slug: 'test-app', name: '测试应用', status: 'running', current_version: 5, can_manage: true, container_port: 8080, app_url: 'https://test-app.example.test', app_config: [{key:'FEATURE_FLAG', value:'false'}] }
      const shared = { ...managed, slug: 'shared-app', name: '共享测试应用', can_manage: false, app_config: [] }
      let receipt = null
      const api = {
        appCatalog: async () => JSON.stringify({ apps: [managed, shared] }),
        appDetails: async slug => JSON.stringify(slug === managed.slug ? managed : shared),
        appVersions: async () => JSON.stringify({ versions: [{is_active:true, version:5, status:'running', config_revision:'baseline'}] }),
        appList: async () => '[]',
        appResources: async () => '{"resources":[]}',
        appModels: async () => '[]',
        appRuntimeStatus: async () => {
          if (window.runtimeReadError) throw new Error('平台暂时无法读取运行配置')
          return JSON.stringify({ operation: receipt, revisions: [], editable_keys: ['FEATURE_FLAG'], config_revision: 'baseline', config_number: 1 })
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
  assert.equal(tabs.at(-1), '能力与技能')
  await page.getByRole('alert').getByText('平台暂时无法读取运行配置').waitFor({ timeout: 4000 })
  assert.equal(await page.getByRole('button', { name: '保存并重启', exact: true }).count(), 0)
  await page.evaluate(() => { window.runtimeReadError = false })
  await page.getByRole('button', { name: '重新加载配置', exact: true }).click()
  await page.getByLabel('FEATURE_FLAG 配置值').fill('true')
  await page.getByRole('button', { name: '保存并重启', exact: true }).click()
  await page.waitForFunction(() => window.command?.kind === 'config')
  assert.deepEqual(await page.evaluate(() => window.command.changes), { FEATURE_FLAG: 'true' })
})
