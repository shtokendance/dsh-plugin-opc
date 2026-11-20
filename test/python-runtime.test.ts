import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import test from 'node:test'
import { worker } from '../src/host/app-delivery.ts'
import {
  bundledPythonCandidates,
  parseWindowsRegistryPythonPaths,
  resolvePythonInterpreter,
  windowsInstallDirCandidates,
  workerEnv,
  type PythonCommand,
} from '../src/host/python-runtime.ts'

test('workerEnv preserves essential Windows OS vars without case duplicates and strips secrets/proxies', () => {
  const env = workerEnv('win32', {
    Path: 'C:\\Windows\\System32;D:\\Python312',
    SystemRoot: 'C:\\Windows',
    SYSTEMROOT: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\alice',
    LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
    TEMP: 'C:\\Users\\alice\\AppData\\Local\\Temp',
    PATHEXT: '.COM;.EXE;.BAT',
    DEEPSEEK_API_KEY: 'sk-secret',
    HTTP_PROXY: 'http://127.0.0.1:7890',
    PYTHONPATH: 'C:\\untrusted',
  })

  assert.equal(env.PATH, 'C:\\Windows\\System32;D:\\Python312')
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.SYSTEMROOT, undefined)
  assert.equal(env.USERPROFILE, 'C:\\Users\\alice')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\alice\\AppData\\Local')
  assert.equal(env.TEMP, 'C:\\Users\\alice\\AppData\\Local\\Temp')
  assert.equal(env.PATHEXT, '.COM;.EXE;.BAT')
  assert.equal(env.LANG, 'en_US.UTF-8')
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.equal(env.HTTP_PROXY, undefined)
  assert.equal(env.PYTHONPATH, undefined)

  const liveKeys = Object.keys(workerEnv()).map(k => k.toLowerCase())
  assert.equal(new Set(liveKeys).size, liveKeys.length)
})

test('bundledPythonCandidates resolves Windows and macOS DSH runtime paths', () => {
  const winExec = 'C:\\Users\\alice\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
  const winBundled = 'C:\\Users\\alice\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe'
  const winResults = bundledPythonCandidates({
    platform: 'win32',
    execPath: winExec,
    env: {},
    homeDir: 'C:\\Users\\alice',
    exists: p => p.toLowerCase() === winBundled.toLowerCase(),
  })
  assert.equal(winResults.length, 1)
  assert.equal(winResults[0].command.toLowerCase(), winBundled.toLowerCase())

  const macExec = '/Applications/DSH.app/Contents/MacOS/DSH'
  const macBundled = '/Applications/DSH.app/Contents/Resources/runtime/primary-runtime/dependencies/python/bin/python3'
  const macResults = bundledPythonCandidates({
    platform: 'darwin',
    execPath: macExec,
    env: {},
    homeDir: '/Users/alice',
    exists: p => p === macBundled,
  })
  assert.deepEqual(macResults, [{ command: macBundled, prefixArgs: [] }])
})

test('resolvePythonInterpreter skips WindowsApps stub and Python <3.9 to find valid python.exe on PATH', async () => {
  const storeAlias = 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe'
  const oldPython = 'C:\\Python38\\python.exe'
  const validPython = 'C:\\Program Files\\Python312\\python.exe'
  const existing = new Set([storeAlias, oldPython, validPython].map(p => p.toLowerCase()))
  const probed: string[] = []

  const resolved = await resolvePythonInterpreter({
    useCache: false,
    platform: 'win32',
    execPath: 'C:\\DSH\\DSH.exe',
    homeDir: 'C:\\Users\\alice',
    env: {
      PATH: [
        'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps',
        'C:\\Python38',
        'C:\\Program Files\\Python312',
      ].join(';'),
    },
    exists: p => existing.has(p.toLowerCase()),
    readDir: () => [],
    queryRegistry: async () => [],
    probe: async (candidate: PythonCommand) => {
      probed.push(candidate.command)
      if (candidate.command.toLowerCase() === oldPython.toLowerCase()) return { ok: false }
      if (candidate.command.toLowerCase() === validPython.toLowerCase()) {
        return { ok: true, version: [3, 12], executable: validPython }
      }
      return { ok: false }
    },
  })

  assert.equal(resolved.command, validPython)
  assert.deepEqual(resolved.prefixArgs, [])
  // WindowsApps stub must NOT be probed before non-WindowsApps PATH installs
  assert.deepEqual(probed, [oldPython, validPython])
})

test('resolvePythonInterpreter discovers Python via py.exe launcher, install dirs, and PEP 514 registry off PATH', async () => {
  const pyLauncher = 'C:\\Windows\\py.exe'
  const customExe = 'D:\\CustomTools\\Python311\\python.exe'

  // Case 1: py.exe resolves customExe when PATH has no python
  const viaLauncher = await resolvePythonInterpreter({
    useCache: false,
    platform: 'win32',
    execPath: 'C:\\DSH\\DSH.exe',
    homeDir: 'C:\\Users\\alice',
    env: { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' },
    exists: p => [pyLauncher.toLowerCase(), customExe.toLowerCase()].includes(p.toLowerCase()),
    readDir: () => [],
    queryRegistry: async () => [],
    probe: async candidate => {
      if (candidate.command.toLowerCase() === pyLauncher.toLowerCase() && candidate.prefixArgs[0] === '-3') {
        return { ok: true, version: [3, 11], executable: customExe }
      }
      if (candidate.command.toLowerCase() === customExe.toLowerCase()) {
        return { ok: true, version: [3, 11], executable: customExe }
      }
      return { ok: false }
    },
  })
  assert.deepEqual(viaLauncher, { command: customExe, prefixArgs: [] })

  // Case 2: Standard install dir (prefers Python312 > Python310 > Python39 > Python39-32)
  const dir39_32 = 'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39-32\\python.exe'
  const dir39 = 'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39\\python.exe'
  const dir310 = 'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python310\\python.exe'
  const dir312 = 'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
  const dirCandidates = windowsInstallDirCandidates({
    env: { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local', USERPROFILE: 'C:\\Users\\alice' },
    homeDir: 'C:\\Users\\alice',
    readDir: dir => (dir.toLowerCase().endsWith('\\programs\\python') ? ['Python39-32', 'Python39', 'Python310', 'Python312'] : []),
    exists: p => [dir39_32, dir39, dir310, dir312].map(v => v.toLowerCase()).includes(p.toLowerCase()),
  })
  assert.deepEqual(dirCandidates.map(c => c.command), [dir312, dir310, dir39, dir39_32])

  // Case 3: PEP 514 Registry fallback (custom drive, no PATH, no py.exe)
  const viaRegistry = await resolvePythonInterpreter({
    useCache: false,
    platform: 'win32',
    execPath: 'C:\\DSH\\DSH.exe',
    homeDir: 'C:\\Users\\alice',
    env: { PATH: '' },
    exists: p => p.toLowerCase() === customExe.toLowerCase(),
    readDir: () => [],
    queryRegistry: async () => [customExe],
    probe: async candidate => candidate.command.toLowerCase() === customExe.toLowerCase()
      ? { ok: true, version: [3, 11], executable: customExe }
      : { ok: false },
  })
  assert.deepEqual(viaRegistry, { command: customExe, prefixArgs: [] })
})

test('parseWindowsRegistryPythonPaths parses ExecutablePath and localized Default InstallPath entries', () => {
  const sample = [
    'HKEY_CURRENT_USER\\SOFTWARE\\Python\\PythonCore\\3.9\\InstallPath',
    '    (默认)    REG_SZ    C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39\\',
    '    ExecutablePath    REG_SZ    C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39\\python.exe',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Python\\ContinuumAnalytics\\Anaconda311-64\\InstallPath',
    '    (Default)    REG_SZ    D:\\Anaconda3',
    '',
    'HKEY_CURRENT_USER\\SOFTWARE\\Python\\PythonCore\\3.9\\PythonPath',
    '    (Default)    REG_SZ    C:\\ignored',
  ].join('\r\n')

  const parsed = parseWindowsRegistryPythonPaths(sample)
  assert.deepEqual(parsed, [
    win32.join('C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39\\', 'python.exe'),
    'C:\\Users\\alice\\AppData\\Local\\Programs\\Python\\Python39\\python.exe',
    win32.join('D:\\Anaconda3', 'python.exe'),
  ])
})

test('resolvePythonInterpreter uses Store Python as last resort and throws clear error when absent', async () => {
  const storePython = 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe'
  const foundStore = await resolvePythonInterpreter({
    useCache: false,
    platform: 'win32',
    execPath: 'C:\\DSH\\DSH.exe',
    homeDir: 'C:\\Users\\alice',
    env: { PATH: 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps' },
    exists: p => p.toLowerCase() === storePython.toLowerCase(),
    readDir: () => [],
    queryRegistry: async () => [],
    probe: async candidate => candidate.command.toLowerCase() === storePython.toLowerCase()
      ? { ok: true, version: [3, 12], executable: storePython }
      : { ok: false },
  })
  assert.equal(foundStore.command, storePython)

  await assert.rejects(
    resolvePythonInterpreter({
      useCache: false,
      platform: 'win32',
      execPath: 'C:\\DSH\\DSH.exe',
      homeDir: 'C:\\Users\\alice',
      env: { PATH: 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps' },
      exists: p => p.toLowerCase() === storePython.toLowerCase(),
      readDir: () => [],
      queryRegistry: async () => [],
      probe: async () => ({ ok: false }),
    }),
    /需要 Python 3\.9 或以上版本/,
  )
})

test('worker executes worker.py with clean UTF-8 Chinese responses on the current OS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-py-utf8-'))
  try {
    await assert.rejects(
      worker({ action: 'read', root, path: 'missing.txt' }),
      error => error instanceof Error && error.message.includes('找不到源码或该路径的暂存稿：missing.txt'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent propose_file calls with Chinese comments avoid WinError 32, surrogates, and lost updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opc-py-concurrent-'))
  const sourceDir = join(root, 'review', 'source')
  try {
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'server.mjs'), 'console.log("ok")\n', 'utf8')
    await writeFile(join(sourceDir, 'app.mjs'), 'console.log("app")\n', 'utf8')

    await Promise.all([
      worker({
        action: 'propose_file',
        root,
        id: 'dockerfile',
        path: 'Dockerfile',
        reason: '容器化配置（含中文说明）',
        content: '# 使用 Node 20 运行应用\nFROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.mjs"]\n',
      }),
      worker({
        action: 'propose_file',
        root,
        id: 'server-edit',
        path: 'server.mjs',
        reason: '补充中文日志注释',
        content: '// 启动服务（中文注释测试：供应商审核系统）\nconsole.log("ready")\n',
      }),
      worker({
        action: 'propose_file',
        root,
        id: 'app-edit',
        path: 'app.mjs',
        reason: '更新入口文件',
        content: '// 入口文件：支持健康检查\nconsole.log("app ready")\n',
      }),
    ])

    const drafts = JSON.parse(await readFile(join(root, 'draft_files.json'), 'utf8')) as Record<string, { path: string }>
    assert.deepEqual(Object.keys(drafts).sort(), ['app-edit', 'dockerfile', 'server-edit'])

    await assert.rejects(
      worker({
        action: 'propose_file',
        root,
        id: 'bad-env',
        path: 'Dockerfile',
        reason: '测试环境变量校验',
        content: 'FROM node:20-alpine\nENV PORT=8080\n',
      }),
      error => error instanceof Error && error.message.includes('AI 不可新增或改写应用环境变量的读取、赋值或默认值：Dockerfile'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
