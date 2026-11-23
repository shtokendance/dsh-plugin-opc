import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('chat reads, edits and undoes the visible Step 3 draft before the user confirms publishing', async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppsPanel } from './src/client/AppsPanel.tsx'

      const draft = {
        id: 'job', slug: 'fixture-app', name: '人力资源系统', status: 'ready', analysisSessionId: 'chat',
        artifactHash: 'artifact', url: 'https://fixture.example.test', events: [],
        runtime_configs: [
          { key: 'TOKEN_TTL', value: '12', description: '登录有效期' },
          { key: 'CONTACT', value: 'Alice', description: '负责人' },
          { key: 'DB_HOST', value: '', resource_id: 'db-main', description: '数据库地址' },
        ],
      }
      const api = {
        appJobByAnalysisSession: async () => JSON.stringify(draft),
        appJob: async () => JSON.stringify(draft),
        appCatalog: async () => '{"apps":[]}',
        appList: async () => '[]',
        appResources: async () => '{"resources":[]}',
        appModels: async () => '[]',
        appConfigDraft: async () => '{"artifactHash":"artifact"}',
        appSaveConfigDraft: async (_, body) => { window.saved = JSON.parse(body) },
        async *appWatchConfigChat(id, artifact, session, context, signal) {
          window.connected = [id, artifact, session, context]
          yield '{"type":"ready"}'
          while (!signal.aborted) {
            const frame = await new Promise(resolve => {
              window.sendFrame = resolve
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
            if (frame) yield JSON.stringify(frame)
          }
        },
        appReplyConfigChat: async (id, request, body) => {
          window.reply = { id, request, ...JSON.parse(body) }
        },
        appConfirmDeployment: async (id, json) => {
          window.confirmed = [id, JSON.parse(json)]
          return '{"confirmationToken":"token","artifactHash":"artifact"}'
        },
        appPublish: async () => { window.published = true; return JSON.stringify({ ...draft, status: 'verified' }) },
      }
      createRoot(document.getElementById('app')).render(<AppsPanel api={api} sessionId="chat" contextId="context" />)
    ` },
    bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-breakpad'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 920, height: 1000 } })
  await page.setContent('<main id="app"></main>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => window.sendFrame, undefined, { timeout: 3500 })
  assert.deepEqual(await page.evaluate(() => window.connected), ['job', 'artifact', 'chat', 'context'])
  const ttl = page.getByRole('textbox', { name: 'TOKEN_TTL 配置值' })
  const contact = page.getByRole('textbox', { name: 'CONTACT 配置值' })
  const request = async (id, action) => {
    await page.evaluate(({ id, action }) => window.sendFrame({ type: 'request', id, action }), { id, action })
    await page.waitForFunction(id => window.reply?.request === id, id)
    return page.evaluate(() => window.reply)
  }
  const { rows } = await request('read', { type: 'read' })
  assert.equal(rows.find(row => row.key === 'TOKEN_TTL').value, '12')
  assert.ok(rows.find(row => row.key === 'DB_HOST').blocked)
  await contact.fill('Bob')
  const patch = { type: 'edit', changes: [{ key: 'TOKEN_TTL', value: '24' }], expected: [rows.find(row => row.key === 'TOKEN_TTL')] }
  assert.deepEqual((await request('edit', patch)).changed, ['TOKEN_TTL'])
  assert.equal(await ttl.inputValue(), '24')
  assert.equal(await contact.inputValue(), 'Bob')
  assert.equal(await page.evaluate(() => window.published), undefined)
  const conflict = await request('stale', patch)
  assert.match(conflict.error, /重新读取/)
  await page.getByRole('button', { name: '撤销 AI 修改' }).click()
  assert.equal(await ttl.inputValue(), '12')
  assert.deepEqual((await request('edit-again', patch)).changed, ['TOKEN_TTL'])
  await page.getByRole('button', { name: '确认配置并发布上线' }).click()
  await page.waitForFunction(() => window.published)
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(window.confirmed[1].config.map(row => [row.key, row.value]))),
    { TOKEN_TTL: '24', CONTACT: 'Bob', DB_HOST: '' })
})
