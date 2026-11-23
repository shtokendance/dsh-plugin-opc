import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('the fourth step follows the original attempt through delay, uncertainty, cancellation and retry', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'
      const first = {
        id: 'job', slug: 'expense', name: '自动报销系统', status: 'building', published: true, upgrade: true,
        archivedRevision: 'archive', requestId: 'same-attempt', url: 'https://expense.example.test', events: [],
        deploymentProgress: { phase: 'starting', stalled: true, can_cancel: true, phase_started_at: Date.now() - 3600000, active_version: 2 },
      }
      window.current = first
      const api = {
        appJobByAnalysisSession: async () => JSON.stringify(first),
        appCatalog: async () => '{"apps":[]}',
        appList: async () => '[]',
        appResources: async () => '{"resources":[]}',
        appModels: async () => '[]',
        appDeploymentLogs: async () => '{"build_log":"构建完成"}',
        appVerifyWithOptions: async () => JSON.stringify(window.current),
        appCancelDeployment: async (id, requestId) => {
          window.cancelled = [id, requestId]
          window.current = { ...first, deploymentProgress: { phase: 'cancelling' } }
          return JSON.stringify(window.current)
        },
        appReopenDeployment: async id => {
          window.retried = id
          return JSON.stringify({ ...first, status: 'ready', artifactHash: 'archive' })
        },
        appDetails: async () => '{"slug":"expense","storage_mounts":[]}',
      }
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-breakpad'] })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.on('dialog', dialog => dialog.accept())
  await page.setContent('<style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column;padding:16px;box-sizing:border-box}</style><main id="app"></main>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByText('新版本启动比预期久', { exact: true }).waitFor()
  const cancel = page.getByRole('button', { name: '取消本次部署', exact: true })
  const retry = page.getByRole('button', { name: '重试部署', exact: true })
  await cancel.waitFor()
  await page.evaluate(() => { window.current = { ...window.current, deploymentProgress: { phase: 'unknown' } } })
  await page.getByText('暂时无法确认部署进度', { exact: true }).waitFor()
  assert.equal(await cancel.count(), 0)
  assert.equal(await retry.count(), 0)
  await page.evaluate(() => { window.current = { ...window.current, deploymentProgress: { phase: 'building', can_cancel: true } } })
  await cancel.click()
  await page.getByText('正在取消并清理', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.cancelled), ['job', 'same-attempt'])
  assert.equal(await retry.count(), 0)
  await page.evaluate(() => {
    window.current = { ...window.current, status: 'cancelled', deploymentProgress: { phase: 'cancelled', retry_safe: true } }
  })
  await retry.click()
  await page.getByText('核对部署内容', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.retried), 'job')
})
