import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('the deployment log fills the panel and a startup check identifies the live version', async () => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'

      const failed = {
        id: 'job', slug: 'fixture-app', name: '测试部署', requestId: 'fixture-attempt',
        archivedRevision: 'archive', failureStage: 'deployment', status: 'failed', published: true,
        url: 'http://fixture.example.test', error: '应用启动失败', events: [],
      }
      const status = { target_running: false, active_version_running: true, active_version: 1, domain_reachable: true }
      const api = {
        appJobByAnalysisSession: async () => JSON.stringify(failed),
        appCatalog: async () => '{"apps":[]}',
        appList: async () => '[]',
        appResources: async () => '{"resources":[]}',
        appModels: async () => '[]',
        appDeploymentLogs: async () => JSON.stringify({ build_log: 'Build step\\n'.repeat(150) }),
        appVerifyWithOptions: async (id, config, context) => {
          window.checked = [id, JSON.parse(config), context]
          await new Promise(resolve => { window.finishCheck = resolve })
          return JSON.stringify({ ...failed, startupCheck: status })
        },
      }
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--disable-breakpad', `--disk-cache-dir=${join(tmpdir(), 'opc-browser-cache')}`],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 920, height: 900 } })
    await page.setContent('<style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column;padding:16px;box-sizing:border-box}</style><main id="app"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const logs = page.locator('.oa-deploy-logs .oa-log-terminal')
    await logs.waitFor()
    await page.getByRole('button', { name: '复制日志' }).waitFor()
    const desktopLog = await logs.boundingBox()
    const footer = await page.getByRole('button', { name: '返回应用列表' }).boundingBox()
    assert.ok(desktopLog.height > 400, 'the terminal should grow beyond its old fixed height')
    assert.ok(footer.y - desktopLog.y - desktopLog.height < 60, 'the terminal should reach the footer')
    assert.equal(await logs.evaluate(el => el.scrollHeight > el.clientHeight), true)

    const recheck = page.getByRole('button', { name: '重新检查应用是否已启动' })
    const repair = page.getByRole('button', { name: '让 AI 分析修复问题' })
    assert.ok((await recheck.boundingBox()).y < desktopLog.y)
    await repair.waitFor()
    await recheck.click()
    assert.deepEqual(await page.evaluate(() => window.checked), ['job', { checkStartup: true }, 'context'])
    assert.ok(await page.getByRole('button', { name: '正在检查…' }).isDisabled())
    await page.evaluate(() => window.finishCheck())
    await page.getByText(/运行的是版本 v1/).waitFor()
    assert.equal(await page.getByText('部署成功', { exact: true }).count(), 0)
    assert.ok(await recheck.isEnabled())

    await page.setViewportSize({ width: 410, height: 620 })
    const narrowLog = await logs.boundingBox()
    assert.ok(narrowLog.height >= 120 && narrowLog.width < desktopLog.width)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.getByRole('button', { name: '本次部署日志' }).click()
    assert.equal(await logs.count(), 0)
    await page.getByRole('button', { name: '本次部署日志' }).click()
    await logs.waitFor()
  } finally {
    await browser.close()
  }
})
