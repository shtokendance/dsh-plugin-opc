import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('app detail shows skeleton while loading and renders resource dashboard tab for running apps', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'
      const runningApp = {
        slug: 'hrs-app',
        name: '人力资源系统',
        status: 'running',
        current_version: 16,
        can_manage: false,
        container_port: 8080,
        app_url: 'http://hrs.ai.benlai.com',
        app_config: [],
      }
      const undeployedApp = {
        slug: 'draft-app',
        name: '未部署应用',
        status: 'failed',
        current_version: 0,
        can_manage: true,
        container_port: 8080,
        app_url: '',
        app_config: [],
      }
      window.__resolveDetail = null
      let metricsCalls = 0
      const api = {
        appCatalog: async () => JSON.stringify({ apps: [runningApp, undeployedApp] }),
        appDetails: slug => new Promise(resolve => {
          const payload = JSON.stringify(slug === runningApp.slug ? runningApp : undeployedApp)
          if (window.__delayDetail) {
            window.__resolveDetail = () => resolve(payload)
          } else {
            resolve(payload)
          }
        }),
        appVersions: async () => JSON.stringify({ versions: [] }),
        appStorage: async () => JSON.stringify({
          app_slug: 'hrs-app',
          app_name: '人力资源系统',
          app_status: 'running',
          mounts_count: 1,
          total_bytes: 52428800,
          total_human: '50.00 MB',
          total_files: 12,
          mounts: [],
        }),
        appLogs: async () => '{}',
        appList: async () => '[]',
        appResources: async () => JSON.stringify({ resources: [] }),
        appModels: async () => '[]',
        appMetrics: async slug => {
          metricsCalls += 1
          return JSON.stringify({
            app_slug: slug,
            app_name: '人力资源系统',
            app_status: 'running',
            available: true,
            replicas_running: 1,
            replicas_desired: 1,
            cpu_percent: 23.4,
            online_cpus: 4,
            cpu_limit_cores: 2,
            memory_usage_bytes: 536870912,
            memory_limit_bytes: 2147483648,
            host_memory_bytes: 17179869184,
            memory_percent: 25,
            container_rw_bytes: 15728640,
            container_rootfs_bytes: 471859200,
            persistent_bytes: 52428800,
            persistent_mounts: 1,
            persistent_files: 12,
            server_total_bytes: 107374182400,
            server_used_bytes: 42949672960,
            server_available_bytes: 64424509440,
            network_rx_bytes: 1048576,
            network_tx_bytes: 2097152,
            block_read_bytes: 4194304,
            block_write_bytes: 8388608,
            pids: 32,
            restart_count: 0,
            started_at: '2026-11-27T08:00:00Z',
            node_hostname: 'swarm-worker-1',
            collected_at: '2026-11-27T10:00:00Z',
          })
        },
      }
      window.__getMetricsCalls = () => metricsCalls
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })

  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-breakpad'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.setContent('<main id="app"></main>')
  await page.evaluate(() => { window.__delayDetail = true })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  await page.getByRole('button', { name: '详情', exact: true }).first().click()
  const skeletonStatus = page.getByRole('status', { name: '正在加载应用详情…' })
  await skeletonStatus.waitFor({ timeout: 4000 })
  assert.ok((await page.locator('.oa-skeleton').count()) >= 8)

  await page.evaluate(() => { window.__resolveDetail?.(); window.__delayDetail = false })
  await page.getByRole('tab', { name: '资源大盘' }).waitFor({ timeout: 4000 })
  await page.getByRole('tab', { name: '资源大盘' }).click()

  await page.getByText('23.4%').waitFor({ timeout: 4000 })
  await page.getByText('512.00 MB').waitFor()
  await page.getByText('swarm-worker-1').waitFor()
  await page.getByText('运行副本: 1/1').waitFor()
  await page.getByText('32').waitFor()
  assert.equal(await page.evaluate(() => window.__getMetricsCalls()), 1)

  await page.getByRole('button', { name: '刷新指标', exact: true }).click()
  await page.waitForFunction(() => window.__getMetricsCalls() === 2)

  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await page.getByRole('button', { name: '失败日志', exact: true }).first().click()
  await page.getByRole('tab', { name: '运行配置' }).waitFor({ timeout: 4000 })
  assert.equal(await page.getByRole('tab', { name: '资源大盘' }).count(), 0)
})
