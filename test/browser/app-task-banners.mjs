import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('application task reminders follow the deployed upgrade targets', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'

      const jobs = [
        { id: 'other', slug: 'other-app', name: '其他升级', upgrade: true, status: 'review' },
        { id: 'linked', slug: 'linked-app', name: '当前升级', upgrade: true, published: true, status: 'review' },
        { id: 'draft', slug: 'first-app', name: '首次部署草稿', status: 'draft' },
      ].map(job => ({ ...job, url: 'https://' + job.slug + '.example.test', events: [] }))
      const api = {
        appJobByAnalysisSession: async () => JSON.stringify(jobs[1]),
        appJob: async id => JSON.stringify(jobs.find(job => job.id === id)),
        appCatalog: async () => {
          if (window.catalog === null) throw new Error('应用目录暂时不可用')
          return JSON.stringify(window.catalog)
        },
        appList: async () => JSON.stringify(jobs),
        appResources: async () => '{"resources":[]}',
        appModels: async () => '[]',
      }
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-breakpad'] })
  t.after(() => browser.close())

  const openPanel = async catalog => {
    const page = await browser.newPage({ viewport: { width: 920, height: 900 } })
    await page.setContent('<main id="app"></main>')
    await page.evaluate(catalog => { window.catalog = catalog }, catalog)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    return page
  }
  const liveCatalog = { apps: ['linked-app', 'other-app'].map(slug => ({
    slug, name: slug, status: 'running', current_version: 1, can_manage: true,
    app_url: 'https://' + slug + '.example.test',
  })) }

  await t.test('refresh hides both deleted upgrade entries and offers the first deployment draft', async () => {
    const page = await openPanel(liveCatalog)
    try {
      await page.getByRole('heading', { name: '升级应用并部署新版本' }).waitFor()
      await page.getByRole('button', { name: '返回列表', exact: true }).click()
      const linked = page.getByRole('button', { name: '回到当前任务' })
      const other = page.getByText('未完成的应用交付任务：其他升级')
      await linked.waitFor()
      await other.waitFor()

      await page.evaluate(() => { window.catalog = null })
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '应用目录暂时不可用' }).waitFor()
      assert.ok(await linked.isVisible())
      assert.ok(await other.isVisible())

      await page.evaluate(() => { window.catalog = { apps: [] } })
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.getByText('暂无已部署的企业应用').waitFor()
      assert.equal(await linked.count(), 0)
      assert.equal(await other.count(), 0)
      await page.getByText('未完成的应用交付任务：首次部署草稿').waitFor()
      await page.getByRole('button', { name: '继续办理' }).click()
      await page.getByRole('heading', { name: '新建并部署应用' }).waitFor()
    } finally {
      await page.close()
    }
  })

  await t.test('opening the old chat stays in the catalog when its upgrade target was deleted', async () => {
    const page = await openPanel({ apps: [] })
    try {
      await page.getByRole('heading', { name: '应用中心' }).waitFor({ timeout: 3500 })
      await page.getByText('未完成的应用交付任务：首次部署草稿').waitFor()
      assert.equal(await page.getByRole('button', { name: '回到当前任务' }).count(), 0)
    } finally {
      await page.close()
    }
  })

  await t.test('an invalid catalog response cannot confirm the upgrade target is missing', async () => {
    const page = await openPanel({})
    try {
      await page.getByRole('heading', { name: '升级应用并部署新版本' }).waitFor()
      await page.getByRole('button', { name: '返回列表', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '未收到有效的企业应用目录' }).waitFor({ timeout: 3500 })
      await page.getByRole('button', { name: '回到当前任务' }).waitFor()
    } finally {
      await page.close()
    }
  })
})
