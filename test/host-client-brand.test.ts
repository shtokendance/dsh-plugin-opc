import assert from 'node:assert/strict'
import test from 'node:test'
import { detectHostClientName, renderCallbackHtml } from '../src/host/auth.ts'
import { bundledPythonCandidates } from '../src/host/python-runtime.ts'

test('detectHostClientName returns WorkOPC in WorkOPC host and DeepSeek Harness in DSH host', () => {
  assert.equal(detectHostClientName({
    homeDir: '/Users/alice/.workopc',
    execPath: '/usr/local/bin/node',
    resourcesPath: '',
    env: {},
  }), 'WorkOPC')

  assert.equal(detectHostClientName({
    homeDir: 'C:\\Users\\alice\\.workopc',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    resourcesPath: '',
    env: {},
  }), 'WorkOPC')

  assert.equal(detectHostClientName({
    homeDir: '/tmp/custom-home',
    execPath: '/Applications/WorkOPC.app/Contents/MacOS/WorkOPC',
    resourcesPath: '',
    env: {},
  }), 'WorkOPC')

  assert.equal(detectHostClientName({
    homeDir: '/Users/alice/.dsh',
    execPath: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
    resourcesPath: '/Applications/DeepSeek Harness.app/Contents/Resources',
    env: {},
  }), 'DeepSeek Harness')

  assert.equal(detectHostClientName({
    homeDir: '/Users/alice/.dsh',
    execPath: '/usr/local/bin/node',
    resourcesPath: '',
    env: { WORKOPC_BRAND_NAME: 'WorkOPC' },
  }), 'WorkOPC')
})

test('renderCallbackHtml uses the detected host client name on return links', () => {
  const workopcHtml = renderCallbackHtml({
    ok: true,
    title: '登录成功',
    subtitle: '正在为您唤起 WorkOPC 客户端…',
    clientName: 'WorkOPC',
  })
  assert.match(workopcHtml, /返回 WorkOPC/)
  assert.doesNotMatch(workopcHtml, /DeepSeek Harness/)

  const dshHtml = renderCallbackHtml({
    ok: false,
    title: '授权未完成',
    subtitle: '登录已取消',
    clientName: 'DeepSeek Harness',
  })
  assert.match(dshHtml, /返回 DeepSeek Harness/)
  assert.doesNotMatch(dshHtml, /返回 WorkOPC/)
})

test('bundledPythonCandidates checks .workopc before .dsh fallback', () => {
  const workopcPy = '/Users/alice/.workopc/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'
  const dshPy = '/Users/alice/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'

  const both = bundledPythonCandidates({
    platform: 'darwin',
    execPath: '/usr/local/bin/node',
    env: {},
    homeDir: '/Users/alice',
    exists: p => p === workopcPy || p === dshPy,
  })
  assert.deepEqual(both.map(item => item.command), [workopcPy, dshPy])

  const dshOnly = bundledPythonCandidates({
    platform: 'darwin',
    execPath: '/usr/local/bin/node',
    env: {},
    homeDir: '/Users/alice',
    exists: p => p === dshPy,
  })
  assert.deepEqual(dshOnly.map(item => item.command), [dshPy])
})
