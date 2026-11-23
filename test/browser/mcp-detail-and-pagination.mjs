import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('MCP page navigates to dedicated tools & debug view and all 4 list pages support pagination', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'jsx',
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { Panel } from './src/client/Panel.tsx'

        window.invokeCalls = []
        const statePayload = {
          signedIn: true,
          loginInProgress: false,
          mountAvailable: true,
          mountedServices: ['svc-1'],
          mcpConnections: { 'svc-1': { state: 'connected', toolCount: 2 } },
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

        const knowledgeBases = Array.from({ length: 9 }, (_, i) => ({
          tenant_id: i < 7 ? '1001' : '1002',
          tenant_name: i < 7 ? '研发空间' : '产品空间',
          source_tenant_id: i < 7 ? '1001' : '1003',
          source_tenant_name: i < 7 ? '研发空间' : '财务空间',
          permission: i < 7 ? 'owner' : 'viewer',
          knowledge_base_id: 'kb-' + (i + 1),
          name: '知识库-' + (i + 1),
          description: '知识库描述 ' + (i + 1),
          availability: 'available',
        }))

        const skills = Array.from({ length: 8 }, (_, i) => ({
          tenant_id: '1001',
          tenant_name: '研发空间',
          catalog_id: 'skill-' + (i + 1),
          name: 'skill-' + (i + 1),
          version: '1.0.' + i,
          bundle_sha256: 'sha-' + (i + 1),
          description: '技能描述 ' + (i + 1),
          availability: 'available',
          installed: i < 2 ? { enabled: true, active_sha256: 'sha-' + (i + 1) } : null,
        }))

        const services = Array.from({ length: 8 }, (_, i) => ({
          service_id: 'svc-' + (i + 1),
          tenant_id: '1001',
          tenant_name: '研发空间',
          name: 'MCP服务-' + (i + 1),
          description: i === 0 ? '' : '服务描述 ' + (i + 1),
          tools: i === 0
            ? [
                {
                  name: 'query_order',
                  description: '按订单号查询采购单详情',
                  risk: 'read',
                  input_schema: {
                    type: 'object',
                    properties: {
                      order_id: { type: 'string', description: '订单编号' },
                    },
                    required: ['order_id'],
                  },
                },
                {
                  name: 'approve_order',
                  description: '审批通过指定采购单',
                  risk: 'write',
                  require_approval: true,
                  input_schema: {
                    type: 'object',
                    properties: {
                      order_id: { type: 'string', description: '订单编号' },
                      comment: { type: 'string', description: '审批意见' },
                    },
                    required: ['order_id'],
                  },
                },
              ]
            : [{ name: 'tool_' + (i + 1), description: '工具 ' + (i + 1), risk: 'read' }],
        }))

        const apps = Array.from({ length: 8 }, (_, i) => ({
          slug: 'demo-app-' + (i + 1),
          name: '企业应用-' + (i + 1),
          description: '应用描述 ' + (i + 1),
          app_url: 'https://demo-app-' + (i + 1) + '.ai.benlai.com',
          status: 'running',
          current_version: 1,
          can_manage: true,
        }))

        const api = {
          async *watchState() {
            yield JSON.stringify(statePayload)
            await new Promise(() => {})
          },
          listKnowledgeBases: async () => JSON.stringify({ includesShared: true, items: knowledgeBases }),
          listSkillsCatalog: async () => JSON.stringify(skills),
          listMcpServices: async () => JSON.stringify({ data: { services } }),
          invokeMcpTool: async (...args) => {
            window.invokeCalls.push(args)
            return JSON.stringify({ ok: true, echoed: JSON.parse(args[2]), tool: args[1] })
          },
          mountMcpService: async () => {},
          unmountMcpService: async () => {},
          setPinnedKnowledgeScope: async () => {},
          installSkill: async () => {},
          setSkillEnabled: async () => {},
          uninstallSkill: async () => {},
          appCatalog: async () => JSON.stringify({ apps }),
          appList: async () => JSON.stringify([]),
          appResources: async () => JSON.stringify({ resources: [] }),
          appOpcConfig: async () => JSON.stringify({ appDomainRoot: 'ai.benlai.com', defaultPort: 8080, platformBaseUrl: 'https://aiwork.benlai.com' }),
          appModels: async () => JSON.stringify([]),
          syncSession: async () => {},
          logout: async () => {},
        }

        createRoot(document.getElementById('app')).render(
          <Panel api={api} sessionId="s1" requestedPage="knowledge" navigationRevision={1} />
        )
      `,
    },
    bundle: true,
    write: false,
    loader: { '.png': 'dataurl', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--disable-breakpad', `--disk-cache-dir=${join(tmpdir(), 'opc-browser-cache')}`],
  })

  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } })
    await page.setContent('<style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column}</style><main id="app"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })

    await page.getByRole('heading', { name: '知识库-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '知识库-6' }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: '知识库-7' }).count(), 0)
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('heading', { name: '知识库-7' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '知识库-9' }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: '知识库-1' }).count(), 0)
    await page.getByLabel('每页显示条数').selectOption('12')
    await page.getByRole('heading', { name: '知识库-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '知识库-9' }).count(), 1)

    await page.getByRole('button', { name: /切换 OPC 页面/ }).click()
    await page.getByRole('button', { name: '技能' }).click()
    await page.getByRole('heading', { name: '/skill-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '/skill-6' }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: '/skill-7' }).count(), 0)
    await page.getByRole('button', { name: '第 2 页' }).click()
    await page.getByRole('heading', { name: '/skill-7' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '/skill-8' }).count(), 1)
    await page.getByRole('button', { name: /已安装/ }).click()
    await page.getByRole('heading', { name: '/skill-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '/skill-7' }).count(), 0)

    await page.getByRole('button', { name: /切换 OPC 页面/ }).click()
    await page.getByRole('button', { name: 'MCP 服务' }).click()
    await page.getByRole('heading', { name: 'MCP服务-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'MCP服务-6' }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: 'MCP服务-7' }).count(), 0)
    assert.equal(await page.locator('.cards-grid details').count(), 0)

    const firstCardBox = await page.locator('.mcp-card').first().boundingBox()
    assert.ok(firstCardBox && firstCardBox.height < 190, `Expected compact MCP card height < 190px, got ${firstCardBox?.height}`)

    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('heading', { name: 'MCP服务-7' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'MCP服务-8' }).count(), 1)
    await page.getByRole('button', { name: '上一页' }).click()
    await page.getByRole('heading', { name: 'MCP服务-1' }).waitFor()

    await page.locator('.mcp-card').first().getByRole('button', { name: /工具与调试/ }).click()
    await page.getByRole('button', { name: /返回 MCP 列表/ }).waitFor()
    await page.getByRole('heading', { name: 'MCP服务-1' }).waitFor()
    await page.getByRole('heading', { name: '可用工具' }).waitFor()
    await page.getByRole('heading', { name: '工具调试' }).waitFor()
    await page.getByText('按订单号查询采购单详情').first().waitFor()

    await page.getByRole('button', { name: /approve_order/ }).click()
    await page.getByText('审批通过指定采购单').first().waitFor()
    const argsInput = page.getByLabel('approve_order JSON 参数')
    await argsInput.fill('{"order_id":"PO-100","comment":"ok"}')
    await page.getByRole('button', { name: '调用工具' }).click()
    await page.locator('.mcp-debug-output').getByText('"PO-100"').waitFor()
    assert.deepEqual(await page.evaluate(() => window.invokeCalls[0]), [
      'svc-1',
      'approve_order',
      '{"order_id":"PO-100","comment":"ok"}',
      'ctx-1',
      '1001',
    ])

    await page.getByRole('button', { name: /返回 MCP 列表/ }).click()
    await page.getByRole('heading', { name: 'MCP服务-1' }).waitFor()

    await page.getByRole('button', { name: /切换 OPC 页面/ }).click()
    await page.getByRole('button', { name: '应用交付中心' }).click()
    await page.getByRole('heading', { name: '企业应用-1' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '企业应用-6' }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: '企业应用-7' }).count(), 0)
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByRole('heading', { name: '企业应用-7' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '企业应用-8' }).count(), 1)
  } finally {
    await browser.close()
  }
})
