import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
const log = await readFile('/tmp/opc-dsh-runtime.log', 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/)?.[0]
if (!url) throw new Error('Host URL unavailable')
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const panel = process.env.OPC_PANEL ?? 'OPC 知识库'
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' || message.text().includes('OPC')) errors.push(message.text()) })
await page.goto(url)
await page.waitForTimeout(2500)
const proceed = page.getByRole('button', { name: '继续', exact: true })
if (await proceed.count()) await proceed.click()
await page.getByRole('button', { name: '选择工作区', exact: true }).click()
await page.getByRole('menuitem', { name: 'acceptance', exact: true }).click()
await page.waitForTimeout(2500)
await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: panel, exact: true }).click()
await page.waitForTimeout(800)
await page.getByRole('status').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden', timeout: 30_000 })
if (process.env.OPC_SPACE) {
  await page.getByRole('combobox', { name: '企业空间' }).selectOption({ label: process.env.OPC_SPACE })
  await page.waitForTimeout(500)
  await page.getByRole('status').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden', timeout: 30_000 })
}
if (process.env.OPC_INSPECT_MCP) {
  for (const summary of await page.locator('.opc-panel main > details > summary').all()) await summary.click()
}
if (process.env.OPC_MOUNT) {
  const service = page.locator('.opc-panel main > details').filter({ has: page.locator('summary').filter({ hasText: /^搜索服务$/ }) })
  if ((await service.getAttribute('open')) === null) await service.locator(':scope > summary').click()
  await service.getByRole('button', { name: '挂载到 DSH', exact: true }).click()
  await service.getByRole('status').filter({ hasText: '已连接' }).waitFor({ timeout: 20_000 }).catch(async error => { console.log('Mount panel:', await page.locator('.opc-panel').innerText()); throw error })
  console.log('Native MCP manager:', await service.getByRole('status').innerText())
}
if (process.env.OPC_ISOLATION) {
  const editor = page.locator('[contenteditable="true"]').first()
  const switchSpace = async label => {
    await page.getByRole('combobox', { name: '企业空间' }).selectOption({ label })
    await page.waitForTimeout(700)
    await page.getByRole('status').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden', timeout: 30_000 })
  }
  await editor.fill('/excel-compare'); await page.waitForTimeout(1000)
  if (await page.getByText('excel-compare', { exact: true }).count()) throw new Error('Skill leaked into second space')
  await editor.fill('')
  await switchSpace('本来生活')
  await editor.fill('/excel-compare')
  await page.getByText('excel-compare', { exact: true }).waitFor()
  await editor.fill('')
  await switchSpace('技术交付中心')
  const service = page.locator('.opc-panel main > details').filter({ has: page.locator('summary').filter({ hasText: /^搜索服务$/ }) })
  await service.locator(':scope > summary').click()
  await service.getByRole('button', { name: '挂载到 DSH', exact: true }).waitFor()
  if (await service.getByRole('status').count()) throw new Error('Old MCP connection survived space switch')
  await page.screenshot({ path: '.runtime/evidence/space-isolation.png', fullPage: true })
  await switchSpace('本来生活')
  console.log('Space isolation passed: skill hidden in second space and restored in original; MCP mount cleared after switch.')
}
if (process.env.OPC_MCP_SEARCH) {
  const service = page.locator('.opc-panel main > details').filter({ has: page.locator('summary').filter({ hasText: /^搜索服务$/ }) })
  if ((await service.getAttribute('open')) === null) await service.locator(':scope > summary').click()
  const tool = service.locator('article').filter({ hasText: 'post_LifeProduct_Search' })
  const schema = JSON.parse(await tool.locator(':scope > pre').innerText())
  const defaults = property => property.type === 'array' ? [] : property.type === 'object' ? {} : property.type === 'boolean' ? false : ['integer', 'number'].includes(property.type) ? 0 : ''
  const args = Object.fromEntries((schema.required ?? []).map(key => [key, defaults(schema.properties[key])]))
  Object.assign(args, { Key: '苹果', PageIndex: 1, PageSize: 1 })
  await tool.getByText('在线调试调用', { exact: true }).click()
  await tool.getByRole('textbox').fill(JSON.stringify(args))
  await tool.getByRole('button', { name: '调用', exact: true }).click()
  await tool.getByRole('button', { name: '调用', exact: true }).waitFor({ timeout: 120_000 })
  console.log('MCP search result:', await tool.locator('details pre').innerText())
}
if (process.env.OPC_SEARCH) {
  await page.getByRole('textbox', { name: '文档检索词' }).fill(process.env.OPC_SEARCH)
  await page.getByRole('button', { name: '检索', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '正在处理' }).waitFor({ state: 'hidden', timeout: 30_000 })
  await page.waitForTimeout(500)
  if (process.env.OPC_READ) {
    await page.locator('.opc-panel article').filter({ has: page.getByRole('button', { name: /02-费用报销单审核规则/ }) }).first().getByRole('button').click()
    await page.getByRole('button', { name: '关闭正文', exact: true }).waitFor({ timeout: 30_000 })
    console.log('Document text length:', (await page.locator('.opc-panel .doc').innerText()).length)
  }
}
if (process.env.OPC_INSTALL) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: `/${process.env.OPC_INSTALL}`, exact: true }) })
  const install = card.getByRole('button', { name: '下载安装', exact: true })
  if (await install.count()) await install.click()
  await Promise.race([card.getByRole('button', { name: '停用', exact: true }).waitFor({ timeout: 45_000 }), page.locator('.opc-panel [role=alert]').waitFor().then(async () => { throw new Error(await page.locator('.opc-panel [role=alert]').innerText()) })]).catch(async error => { await page.screenshot({ path: '.runtime/evidence/install-error.png' }); console.log('Install error:', error.message); throw error })
  await page.locator('[contenteditable="true"]').first().fill(`/${process.env.OPC_INSTALL}`)
  await page.waitForTimeout(1200)
}
if (process.env.OPC_SKILL_LIFECYCLE) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '/excel-compare', exact: true }) })
  const editor = page.locator('[contenteditable="true"]').first()
  if (await card.getByRole('button', { name: '启用', exact: true }).count()) { await card.getByRole('button', { name: '启用', exact: true }).click(); await card.getByRole('button', { name: '停用', exact: true }).waitFor() }
  await card.getByRole('button', { name: '停用', exact: true }).click()
  await card.getByRole('button', { name: '启用', exact: true }).waitFor()
  await editor.fill('/excel-compare'); await page.waitForTimeout(1000)
  if (await page.getByText('excel-compare', { exact: true }).count()) throw new Error('Disabled skill still in slash candidates')
  await editor.fill('')
  await card.getByRole('button', { name: '启用', exact: true }).click()
  await card.getByRole('button', { name: '停用', exact: true }).waitFor()
  await editor.fill('/excel-compare')
  await page.getByText('excel-compare', { exact: true }).waitFor()
  await editor.fill('')
  await card.getByRole('button', { name: '卸载', exact: true }).click()
  await card.getByRole('button', { name: '下载安装', exact: true }).waitFor()
  await editor.fill('/excel-compare'); await page.waitForTimeout(1000)
  if (await page.getByText('excel-compare', { exact: true }).count()) throw new Error('Uninstalled skill still in slash candidates')
  await editor.fill('')
  await card.getByRole('button', { name: '下载安装', exact: true }).click()
  await card.getByRole('button', { name: '停用', exact: true }).waitFor({ timeout: 45_000 })
  console.log('Skill lifecycle passed: disable, enable, uninstall, reinstall; slash visibility verified.')
}
if (process.env.OPC_AGENT_TEST) {
  await page.getByRole('button', { name: '限定问答范围', exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.locator('[contenteditable="true"]').first().fill('本轮仅做 OPC 插件只读验收。先使用 skill 工具加载 excel-compare，仅确认加载成功，不运行脚本、不读写文件；然后调用 opc_knowledge_search 检索当前企业空间的费用报销规则，再调用 opc_knowledge_read 读取一条命中文档。简短报告三步结果与工具错误，不执行任何审批、财务操作或其他写操作。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.waitForTimeout(45_000)
  await page.screenshot({ path: '.runtime/evidence/agent.png', fullPage: true })
  await writeFile('.runtime/evidence/agent.txt', await page.locator('body').innerText())
}
if (process.env.OPC_START_LOGIN === '1') {
  await page.getByRole('button', { name: '企业微信 / SSO 登录', exact: true }).click()
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `.runtime/evidence/${panel}.png`, fullPage: true })
await writeFile(`.runtime/evidence/${panel}.txt`, await page.locator('body').innerText())
await writeFile('.runtime/evidence/browser-errors.json', JSON.stringify(errors, null, 2))
console.log((await page.locator('body').innerText()).slice(0, 6000))
console.log('Browser errors:', errors.slice(0, 6))
if ((await page.locator('body').innerText()).includes('状态连接中断')) throw new Error('OPC state stream failed')
await browser.close()
