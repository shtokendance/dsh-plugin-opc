import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
const log = await readFile('/tmp/opc-dsh-runtime.log', 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/)?.[0]
if (!url) throw new Error('Host URL unavailable')
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const panel = process.env.OPC_PANEL ?? '企业知识库'
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' || message.text().includes('OPC')) errors.push(message.text()) })
await page.goto(url)
await page.waitForTimeout(2500)
const proceed = page.getByRole('button', { name: '继续', exact: true })
if (await proceed.count()) await proceed.click()
await page.getByRole('button', { name: '选择工作区', exact: true }).click()
await page.getByRole('menuitem', { name: '添加工作区…', exact: true }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: '编辑路径', exact: true }).click()
await page.getByRole('textbox', { name: '编辑路径', exact: true }).fill('/Users/sheep.yang/Documents/OPC-2.0/dsh-plugin-opc/.runtime/acceptance')
await page.getByRole('textbox', { name: '编辑路径', exact: true }).press('Enter')
await page.waitForTimeout(500)
await page.getByRole('button', { name: '打开', exact: true }).click()
await page.waitForTimeout(800)
console.log(await page.locator('body').innerText())
await browser.close()
