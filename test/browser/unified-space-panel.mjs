import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Panel removes space switcher and displays space badges across knowledge, skills, and MCP', async () => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { Panel } from './src/client/Panel.tsx'

      window.calls = []
      const statePayload = {
        signedIn: true,
        loginInProgress: false,
        mountAvailable: true,
        mountedServices: ['svc-a'],
        mcpConnections: { 'svc-a': { state: 'connected', toolCount: 1 } },
        pinnedScopes: {},
        pinnedScopeDetails: {},
        context: {
          subject: 'alice',
          displayName: 'Alice',
          tenant: '1001',
          spaces: ['1001', '1002'],
          spacesDetail: [
            { id: '1001', name: '研发空间' },
            { id: '1002', name: '产品空间' },
          ],
          contextId: 'ctx-1',
          applicationContextId: 'app-ctx-1',
        },
      }
      const api = {
        async *watchState() {
          yield JSON.stringify(statePayload)
          await new Promise(() => {})
        },
        listKnowledgeBases: async () => JSON.stringify({
          includesShared: true,
          items: [
            { tenant_id: '1001', tenant_name: '研发空间', source_tenant_id: '1001', knowledge_base_id: 'kb-own', name: '研发规范库', availability: 'available' },
            { tenant_id: '1002', tenant_name: '产品空间', source_tenant_id: '1003', source_tenant_name: '财务空间', permission: 'viewer', knowledge_base_id: 'kb-ext', name: '财务共享库', availability: 'available' },
          ],
        }),
        listSkillsCatalog: async () => JSON.stringify([
          { tenant_id: '1001', tenant_name: '研发空间', catalog_id: 'cat-a', name: 'alpha-skill', version: '1.0', bundle_sha256: 'sha-a', availability: 'available', installed: null },
          { tenant_id: '1002', tenant_name: '产品空间', catalog_id: 'cat-b', name: 'beta-skill', version: '2.0', bundle_sha256: 'sha-b', availability: 'available', installed: null },
        ]),
        listMcpServices: async () => JSON.stringify({
          data: {
            services: [
              { service_id: 'svc-a', tenant_id: '1001', tenant_name: '研发空间', name: '研发服务', description: '研发工具', tools: [{ name: 't1' }] },
              { service_id: 'svc-b', tenant_id: '1002', tenant_name: '产品空间', name: '产品服务', description: '产品工具', tools: [{ name: 't2' }] },
            ],
          },
        }),
        setPinnedKnowledgeScope: async (...args) => { window.calls.push(['pin', ...args]) },
        installSkill: async (...args) => { window.calls.push(['install', ...args]) },
        mountMcpService: async (...args) => { window.calls.push(['mount', ...args]) },
        syncSession: async () => {},
        logout: async () => {},
      }
      createRoot(document.getElementById('app')).render(<Panel api={api} sessionId="s1" requestedPage="knowledge" navigationRevision={1} />)
    ` },
    bundle: true, write: false, loader: { '.png': 'dataurl', '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--disable-breakpad', `--disk-cache-dir=${join(tmpdir(), 'opc-browser-cache')}`],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 920, height: 900 } })
    await page.setContent('<style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column}</style><main id="app"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })

    await page.getByRole('heading', { name: '研发规范库' }).waitFor()
    await page.getByRole('heading', { name: '财务共享库' }).waitFor()
    assert.equal(await page.getByLabel('企业空间').count(), 0)
    await page.getByText('共享自 财务空间 · 只读').waitFor()

    const pinButtons = page.getByRole('button', { name: '限定问答范围' })
    await pinButtons.nth(1).click()
    assert.deepEqual(await page.evaluate(() => window.calls[0]), ['pin', 's1', 'kb-ext', 'ctx-1', '1002'])

    await page.getByRole('button', { name: /切换 OPC 页面/ }).click()
    await page.getByRole('button', { name: '技能' }).click()
    await page.getByText('/alpha-skill').waitFor()
    await page.getByText('/beta-skill').waitFor()
    assert.equal(await page.getByLabel('企业空间').count(), 0)
    const installButtons = page.getByRole('button', { name: '下载安装' })
    await installButtons.nth(1).click()
    assert.deepEqual(await page.evaluate(() => window.calls[1]), ['install', 'cat-b', 'sha-b', 'ctx-1', '1002'])

    await page.getByRole('button', { name: /切换 OPC 页面/ }).click()
    await page.getByRole('button', { name: 'MCP 服务' }).click()
    await page.getByText('研发服务').waitFor()
    await page.getByText('产品服务').waitFor()
    assert.equal(await page.getByLabel('企业空间').count(), 0)
    await page.getByRole('button', { name: '挂载到 DSH' }).click()
    assert.deepEqual(await page.evaluate(() => window.calls[2]), ['mount', 'svc-b', 'ctx-1', '1002'])
  } finally {
    await browser.close()
  }
})
