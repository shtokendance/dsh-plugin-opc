import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('WorkOPC updates the account menu after login and follows the active theme', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'jsx',
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { OpcAccountLauncher } from './src/client/OpcAccountLauncher.tsx'

        let publish
        const login = new Promise(resolve => { publish = resolve })
        const api = {
          state: async () => JSON.stringify({ signedIn: false, loginInProgress: false, context: null }),
          async *watchState() {
            yield JSON.stringify(await login)
          },
        }
        window.completeLogin = () => publish({
          signedIn: true, loginInProgress: false,
          context: { subject: 'fixture-user', displayName: 'Fixture User' },
        })
        createRoot(document.querySelector('#root')).render(
          <OpcAccountLauncher api={api} wide openSettings={() => {}} />
        )
      `,
    },
    bundle: true,
    write: false,
  })
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--disable-breakpad', '--disable-crash-reporter'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root" style="position:absolute;bottom:0;left:0;width:270px"></div>')
    await page.addStyleTag({ content: `
      body { --dsw-alias-bg-base: rgb(255, 255, 255); --dsw-alias-label-primary: rgb(20, 20, 20); }
      body[data-ds-dark-theme] { --dsw-alias-bg-base: rgb(20, 20, 20); --dsw-alias-label-primary: rgb(250, 250, 250); }
    ` })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.getByRole('button', { name: /More|更多/ }).click()
    const menu = page.getByRole('menu')
    const signIn = menu.getByText(/^(Sign in|登录)$/)
    await signIn.waitFor({ state: 'visible' })
    const colors = async () => [
      await menu.evaluate(element => getComputedStyle(element).backgroundColor),
      await signIn.evaluate(element => getComputedStyle(element).color),
    ]
    assert.deepEqual(await colors(), ['rgb(255, 255, 255)', 'rgb(20, 20, 20)'])
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    assert.deepEqual(await colors(), ['rgb(20, 20, 20)', 'rgb(250, 250, 250)'])
    await page.evaluate(() => window.completeLogin())
    await page.getByRole('button', { name: 'Fixture User' }).waitFor({ state: 'visible' })
    await menu.getByText('Fixture User', { exact: true }).waitFor({ state: 'visible' })
    await menu.getByText(/Sign out|退出登录/).waitFor({ state: 'visible' })
    assert.equal(await signIn.count(), 0)
  } finally {
    await browser.close()
  }
})

test('WorkOPC account launcher recovers when watchState fails and syncs on reconnect, focus, and logout', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'jsx',
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { OpcAccountLauncher } from './src/client/OpcAccountLauncher.tsx'

        let currentState = { signedIn: false, loginInProgress: false, context: null }
        let watchCalls = 0
        let pushSecondStream
        const secondStreamFrame = new Promise(resolve => { pushSecondStream = resolve })
        const api = {
          state: async () => JSON.stringify(currentState),
          async *watchState() {
            watchCalls += 1
            if (watchCalls === 1) {
              throw new Error('stream disconnected')
            }
            yield JSON.stringify(currentState)
            yield JSON.stringify(await secondStreamFrame)
          },
        }
        window.signInExternally = () => {
          currentState = {
            signedIn: true,
            loginInProgress: false,
            context: { subject: 'wecom-user', displayName: '杨杨' },
          }
          window.dispatchEvent(new Event('focus'))
        }
        window.signOutExternally = () => {
          currentState = { signedIn: false, loginInProgress: false, context: null }
          pushSecondStream(currentState)
        }
        createRoot(document.querySelector('#root')).render(
          <OpcAccountLauncher api={api} wide openSettings={() => {}} />
        )
      `,
    },
    bundle: true,
    write: false,
  })
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--disable-breakpad', '--disable-crash-reporter'],
  })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root" style="position:absolute;bottom:0;left:0;width:270px"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.getByRole('button', { name: /More|更多/ }).waitFor({ state: 'visible' })
    await page.evaluate(() => window.signInExternally())
    await page.getByRole('button', { name: '杨杨' }).waitFor({ state: 'visible', timeout: 3000 })
    await page.evaluate(() => window.signOutExternally())
    await page.getByRole('button', { name: /More|更多/ }).waitFor({ state: 'visible', timeout: 3000 })
  } finally {
    await browser.close()
  }
})
