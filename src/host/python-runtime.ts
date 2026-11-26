import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface PythonCommand {
  command: string
  prefixArgs: string[]
}

export interface PythonProbeResult {
  ok: boolean
  version?: [number, number]
  executable?: string
}

export interface PythonDiscoveryOptions {
  platform?: NodeJS.Platform
  execPath?: string
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  exists?: (path: string) => boolean
  readDir?: (path: string) => string[]
  queryRegistry?: () => Promise<string[]>
  probe?: (candidate: PythonCommand, env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<PythonProbeResult>
  signal?: AbortSignal
  useCache?: boolean
}

const PROBE_SCRIPT = 'import json, sys; print(json.dumps({"v": list(sys.version_info[:2]), "exe": sys.executable}))'
const MIN_PYTHON_MAJOR = 3
const MIN_PYTHON_MINOR = 9
const WINDOWS_APPS_SEGMENT = /[\\/]Microsoft[\\/]WindowsApps(?:[\\/]|$)/i

const WINDOWS_SAFE_ENV_KEYS = new Set([
  'systemroot',
  'windir',
  'systemdrive',
  'userprofile',
  'homedrive',
  'homepath',
  'localappdata',
  'appdata',
  'programdata',
  'temp',
  'tmp',
  'comspec',
  'pathext',
])

/** Build a minimal subprocess environment that keeps OS runtime paths without leaking credentials. */
export function workerEnv(
  platform: NodeJS.Platform = process.platform,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LANG: 'en_US.UTF-8' }
  const pathValue = sourceEnv.PATH ?? sourceEnv.Path
  if (pathValue !== undefined) env.PATH = pathValue
  if (sourceEnv.HOME !== undefined) env.HOME = sourceEnv.HOME
  if (platform === 'win32') {
    const seen = new Set(['lang', 'path', 'home'])
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (value === undefined) continue
      const lower = key.toLowerCase()
      if (!WINDOWS_SAFE_ENV_KEYS.has(lower) || seen.has(lower)) continue
      seen.add(lower)
      env[key] = value
    }
  }
  return env
}

function isSupportedVersion(version: unknown): version is [number, number] {
  return Array.isArray(version) &&
    version.length >= 2 &&
    typeof version[0] === 'number' &&
    typeof version[1] === 'number' &&
    (version[0] > MIN_PYTHON_MAJOR || (version[0] === MIN_PYTHON_MAJOR && version[1] >= MIN_PYTHON_MINOR))
}

function safeReadDir(readDir: (path: string) => string[], dir: string): string[] {
  try {
    return readDir(dir)
  } catch {
    return []
  }
}

function versionSortKey(name: string): number {
  const dotted = name.match(/(\d+)\.(\d+)/)
  if (dotted) {
    const base = Number.parseInt(dotted[1], 10) * 1000 + Number.parseInt(dotted[2], 10)
    return base * 2 + (/-32$/i.test(name) ? 0 : 1)
  }
  const compact = name.match(/python(\d)(\d+)/i)
  if (compact) {
    const base = Number.parseInt(compact[1], 10) * 1000 + Number.parseInt(compact[2], 10)
    return base * 2 + (/-32$/i.test(name) ? 0 : 1)
  }
  return 0
}

function isWindowsAppsPath(pathValue: string): boolean {
  return WINDOWS_APPS_SEGMENT.test(pathValue)
}

function candidateKey(candidate: PythonCommand, platform: NodeJS.Platform): string {
  const pathApi = platform === 'win32' ? win32 : posix
  const normalizedCmd = pathApi.isAbsolute(candidate.command) ? pathApi.normalize(candidate.command) : candidate.command
  const cmdKey = platform === 'win32' ? normalizedCmd.toLowerCase() : normalizedCmd
  return `${cmdKey}\0${candidate.prefixArgs.join('\0')}`
}

/** Collect bundled DSH Python paths (platform-specific) before falling back to system installs. */
export function bundledPythonCandidates(options: {
  platform?: NodeJS.Platform
  execPath?: string
  resourcesPath?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  exists?: (path: string) => boolean
} = {}): PythonCommand[] {
  const platform = options.platform ?? process.platform
  const pathApi = platform === 'win32' ? win32 : posix
  const execPath = options.execPath ?? process.execPath
  const resourcesPath = options.resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  const exists = options.exists ?? existsSync
  const executable = pathApi.dirname(execPath)
  const workopcHome = env.DSH_HOME?.trim() || pathApi.join(homeDir, '.workopc')
  const legacyDshHome = pathApi.join(homeDir, '.dsh')

  const runtimeDirs = [
    env.DSH_PRIMARY_RUNTIME_DIR?.trim(),
    env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR?.trim(),
  ].filter((value): value is string => Boolean(value))

  const relExecutables = platform === 'win32'
    ? ['dependencies/python/python.exe']
    : ['dependencies/python/bin/python3', 'dependencies/python/bin/python']

  const paths: string[] = []
  for (const dir of runtimeDirs) {
    for (const rel of relExecutables) paths.push(pathApi.join(dir, rel))
  }
  if (resourcesPath) {
    for (const rel of relExecutables) paths.push(pathApi.join(resourcesPath, 'runtime/primary-runtime', rel))
  }
  if (platform === 'win32') {
    paths.push(
      pathApi.join(executable, 'resources/runtime/primary-runtime/dependencies/python/python.exe'),
      pathApi.join(executable, '../resources/runtime/primary-runtime/dependencies/python/python.exe'),
      pathApi.join(executable, '../../python/python.exe'),
      pathApi.join(workopcHome, 'dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe'),
      pathApi.join(legacyDshHome, 'dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe'),
    )
  } else {
    paths.push(
      pathApi.join(executable, '../Resources/runtime/primary-runtime/dependencies/python/bin/python3'),
      pathApi.join(executable, '../resources/runtime/primary-runtime/dependencies/python/bin/python3'),
      pathApi.join(executable, '../../python/bin/python3'),
      pathApi.join(workopcHome, 'dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'),
      pathApi.join(legacyDshHome, 'dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'),
    )
  }

  const seen = new Set<string>()
  const result: PythonCommand[] = []
  for (const candidatePath of paths) {
    const key = platform === 'win32' ? pathApi.normalize(candidatePath).toLowerCase() : pathApi.normalize(candidatePath)
    if (seen.has(key)) continue
    seen.add(key)
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: [] })
    }
  }
  return result
}

/** Parse PEP 514 `reg.exe query ... /s` output into candidate python.exe paths. */
export function parseWindowsRegistryPythonPaths(output: string): string[] {
  const results: string[] = []
  let inInstallPath = false
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^HKEY_/i.test(line)) {
      inInstallPath = /\\InstallPath$/i.test(line)
      continue
    }
    if (!inInstallPath) continue
    const execMatch = line.match(/^ExecutablePath\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
    if (execMatch?.[1]) {
      results.push(execMatch[1].trim())
      continue
    }
    const defaultMatch = line.match(/^\([^)]+\)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
    if (defaultMatch?.[1]) {
      const base = defaultMatch[1].trim()
      if (base) results.push(/\.exe$/i.test(base) ? base : win32.join(base, 'python.exe'))
    }
  }
  return results
}

async function defaultQueryWindowsRegistry(): Promise<string[]> {
  const roots = [
    'HKCU\\SOFTWARE\\Python',
    'HKLM\\SOFTWARE\\Python',
    'HKLM\\SOFTWARE\\WOW6432Node\\Python',
  ]
  const found: string[] = []
  for (const root of roots) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', root, '/s'], {
        timeout: 3000,
        windowsHide: true,
      })
      found.push(...parseWindowsRegistryPythonPaths(stdout))
    } catch {
      /* registry hive may not exist */
    }
  }
  return found
}

/** Collect standard Windows Python directories outside PATH (official installer, uv, scoop, conda, pyenv). */
export function windowsInstallDirCandidates(options: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  exists?: (path: string) => boolean
  readDir?: (path: string) => string[]
} = {}): PythonCommand[] {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  const exists = options.exists ?? existsSync
  const readDir = options.readDir ?? (dir => readdirSync(dir))
  const userProfile = env.USERPROFILE?.trim() || homeDir
  const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, 'AppData', 'Local')
  const appData = env.APPDATA?.trim() || win32.join(userProfile, 'AppData', 'Roaming')
  const programFiles = env.ProgramFiles?.trim() || 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)']?.trim() || 'C:\\Program Files (x86)'
  const programData = env.ProgramData?.trim() || 'C:\\ProgramData'
  const systemDrive = env.SystemDrive?.trim() || 'C:'
  const rootDrive = systemDrive.endsWith('\\') ? systemDrive : `${systemDrive}\\`

  const candidatePaths: string[] = []

  const versionedParents = [
    win32.join(localAppData, 'Programs', 'Python'),
    programFiles,
    programFilesX86,
    rootDrive,
  ]
  for (const parent of versionedParents) {
    const dirs = safeReadDir(readDir, parent)
      .filter(name => /^Python3\d*(?:-[A-Za-z0-9_]+)?$/i.test(name))
      .sort((a, b) => versionSortKey(b) - versionSortKey(a))
    for (const dir of dirs) {
      candidatePaths.push(win32.join(parent, dir, 'python.exe'), win32.join(parent, dir, 'python3.exe'))
    }
  }

  for (const uvRoot of [win32.join(localAppData, 'uv', 'python'), win32.join(appData, 'uv', 'python')]) {
    const dirs = safeReadDir(readDir, uvRoot)
      .filter(name => /^cpython-3\./i.test(name))
      .sort((a, b) => versionSortKey(b) - versionSortKey(a))
    for (const dir of dirs) {
      candidatePaths.push(win32.join(uvRoot, dir, 'python.exe'))
    }
  }

  const pyenvVersionsDir = win32.join(userProfile, '.pyenv', 'pyenv-win', 'versions')
  for (const dir of safeReadDir(readDir, pyenvVersionsDir)
    .filter(name => /^3\./.test(name))
    .sort((a, b) => versionSortKey(b) - versionSortKey(a))) {
    candidatePaths.push(win32.join(pyenvVersionsDir, dir, 'python.exe'))
  }

  const scoopApps = win32.join(userProfile, 'scoop', 'apps')
  for (const dir of safeReadDir(readDir, scoopApps)
    .filter(name => /^python/i.test(name))
    .sort((a, b) => versionSortKey(b) - versionSortKey(a))) {
    candidatePaths.push(win32.join(scoopApps, dir, 'current', 'python.exe'))
  }
  candidatePaths.push(win32.join(userProfile, 'scoop', 'shims', 'python.exe'))

  const chocoBase = env.ChocolateyInstall?.trim() || win32.join(programData, 'chocolatey')
  candidatePaths.push(win32.join(chocoBase, 'bin', 'python.exe'), win32.join(chocoBase, 'bin', 'python3.exe'))

  for (const condaRoot of [
    win32.join(userProfile, 'miniconda3'),
    win32.join(userProfile, 'anaconda3'),
    win32.join(userProfile, 'miniforge3'),
    win32.join(userProfile, 'mambaforge'),
    win32.join(localAppData, 'miniconda3'),
    win32.join(localAppData, 'anaconda3'),
    win32.join(localAppData, 'miniforge3'),
    win32.join(programData, 'miniconda3'),
    win32.join(programData, 'anaconda3'),
    win32.join(programData, 'miniforge3'),
  ]) {
    candidatePaths.push(win32.join(condaRoot, 'python.exe'))
  }

  const seen = new Set<string>()
  const result: PythonCommand[] = []
  for (const candidatePath of candidatePaths) {
    const key = win32.normalize(candidatePath).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: [] })
    }
  }
  return result
}

function pathCandidates(options: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exists: (path: string) => boolean
}): { regular: PythonCommand[]; windowsApps: PythonCommand[] } {
  const { platform, env, exists } = options
  const pathApi = platform === 'win32' ? win32 : posix
  const rawPath = env.PATH ?? env.Path ?? ''
  const pathSep = platform === 'win32' ? ';' : ':'
  const entries = rawPath.split(pathSep).map(entry => entry.trim().replace(/^"+|"+$/g, '')).filter(Boolean)
  const names = platform === 'win32' ? ['python3.exe', 'python.exe'] : ['python3', 'python']
  const regular: PythonCommand[] = []
  const windowsApps: PythonCommand[] = []

  for (const dir of entries) {
    const targetList = platform === 'win32' && isWindowsAppsPath(dir) ? windowsApps : regular
    for (const name of names) {
      const fullPath = pathApi.join(dir, name)
      if (exists(fullPath)) {
        targetList.push({ command: fullPath, prefixArgs: [] })
      }
    }
  }

  if (platform !== 'win32') {
    regular.push({ command: 'python3', prefixArgs: [] }, { command: 'python', prefixArgs: [] })
  }
  return { regular, windowsApps }
}

function windowsLauncherCandidates(options: {
  env: NodeJS.ProcessEnv
  homeDir: string
  exists: (path: string) => boolean
}): PythonCommand[] {
  const { env, homeDir, exists } = options
  const systemRoot = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || env.WINDIR?.trim() || 'C:\\Windows'
  const userProfile = env.USERPROFILE?.trim() || homeDir
  const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, 'AppData', 'Local')
  const paths = [
    win32.join(systemRoot, 'py.exe'),
    win32.join(localAppData, 'Programs', 'Python', 'Launcher', 'py.exe'),
  ]
  const rawPath = env.PATH ?? env.Path ?? ''
  for (const dir of rawPath.split(';').map(entry => entry.trim().replace(/^"+|"+$/g, '')).filter(Boolean)) {
    paths.push(win32.join(dir, 'py.exe'))
  }
  const seen = new Set<string>()
  const result: PythonCommand[] = []
  for (const candidatePath of paths) {
    const key = win32.normalize(candidatePath).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: ['-3'] })
    }
  }
  return result
}

async function defaultProbePython(
  candidate: PythonCommand,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<PythonProbeResult> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: PythonProbeResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    let child
    try {
      child = spawn(candidate.command, [...candidate.prefixArgs, '-I', '-B', '-X', 'utf8', '-c', PROBE_SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
        signal,
        timeout: 5_000,
        windowsHide: true,
      })
    } catch {
      finish({ ok: false })
      return
    }
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (stdout.length < 4096) stdout += chunk
    })
    child.on('error', () => finish({ ok: false }))
    child.on('close', code => {
      if (code !== 0) {
        finish({ ok: false })
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as { v?: unknown; exe?: unknown }
        if (!isSupportedVersion(parsed.v)) {
          finish({ ok: false })
          return
        }
        finish({
          ok: true,
          version: [parsed.v[0], parsed.v[1]],
          executable: typeof parsed.exe === 'string' && parsed.exe ? parsed.exe : undefined,
        })
      } catch {
        finish({ ok: false })
      }
    })
  })
}

let cachedResolution: Promise<PythonCommand> | undefined

export function resetPythonResolutionCache(): void {
  cachedResolution = undefined
}

async function discoverPython(options: PythonDiscoveryOptions = {}): Promise<PythonCommand> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  const exists = options.exists ?? existsSync
  const readDir = options.readDir ?? (dir => readdirSync(dir))
  const queryRegistry = options.queryRegistry ?? defaultQueryWindowsRegistry
  const probe = options.probe ?? defaultProbePython
  const childEnv = workerEnv(platform, env)
  const tried = new Set<string>()

  const tryCandidates = async (candidates: PythonCommand[]): Promise<PythonCommand | undefined> => {
    for (const candidate of candidates) {
      options.signal?.throwIfAborted()
      const key = candidateKey(candidate, platform)
      if (tried.has(key)) continue
      tried.add(key)

      const result = await probe(candidate, childEnv, options.signal)
      options.signal?.throwIfAborted()
      if (!result.ok) continue

      if (candidate.prefixArgs.length > 0 && result.executable && exists(result.executable)) {
        const direct: PythonCommand = { command: result.executable, prefixArgs: [] }
        const directProbe = await probe(direct, childEnv, options.signal)
        options.signal?.throwIfAborted()
        if (directProbe.ok) return direct
      }
      return candidate
    }
    return undefined
  }

  // 1. Prefer DSH's own bundled Python runtime when available.
  const bundledMatch = await tryCandidates(bundledPythonCandidates({
    platform,
    execPath: options.execPath,
    resourcesPath: options.resourcesPath,
    env,
    homeDir,
    exists,
  }))
  if (bundledMatch) return bundledMatch

  // 2. Try Python installations on PATH, deferring Microsoft Store WindowsApps aliases.
  const fromPath = pathCandidates({ platform, env, exists })
  const pathMatch = await tryCandidates(fromPath.regular)
  if (pathMatch) return pathMatch

  if (platform === 'win32') {
    // 3a. Python Launcher for Windows (`py -3`) finds registered interpreters even off PATH.
    const launcherMatch = await tryCandidates(windowsLauncherCandidates({ env, homeDir, exists }))
    if (launcherMatch) return launcherMatch

    // 3b. Common Windows installer directories (python.org, uv, pyenv-win, scoop, conda, chocolatey).
    const dirMatch = await tryCandidates(windowsInstallDirCandidates({ env, homeDir, exists, readDir }))
    if (dirMatch) return dirMatch

    // 3c. Windows PEP 514 registry entries for custom install drives/locations.
    const registryPaths = await queryRegistry()
    const registryCandidates = registryPaths
      .filter(p => exists(p))
      .map(p => ({ command: p, prefixArgs: [] as string[] }))
    const registryMatch = await tryCandidates(registryCandidates)
    if (registryMatch) return registryMatch

    // 4. Last resort: WindowsApps (works if real Store Python is installed; alias stub fails probe).
    const userProfile = env.USERPROFILE?.trim() || homeDir
    const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, 'AppData', 'Local')
    const storeCandidates = [...fromPath.windowsApps]
    for (const name of ['python3.exe', 'python.exe']) {
      const storePath = win32.join(localAppData, 'Microsoft', 'WindowsApps', name)
      if (exists(storePath)) storeCandidates.push({ command: storePath, prefixArgs: [] })
    }
    const storeMatch = await tryCandidates(storeCandidates)
    if (storeMatch) return storeMatch
  }

  throw new Error('需要 Python 3.9 或以上版本：请安装后重新打开 DSH。原项目未改动。')
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/**
 * Resolve a working Python >= 3.9 interpreter across DSH bundles, PATH, Windows launchers,
 * standard installation paths, and the PEP 514 Windows registry.
 */
export async function resolvePythonInterpreter(options: PythonDiscoveryOptions = {}): Promise<PythonCommand> {
  options.signal?.throwIfAborted()
  if (options.useCache === false) {
    return discoverPython(options)
  }
  if (!cachedResolution) {
    const { signal: _signal, ...sharedOptions } = options
    const pending = discoverPython(sharedOptions).catch(error => {
      if (cachedResolution === pending) cachedResolution = undefined
      throw error
    })
    cachedResolution = pending
  }
  return awaitWithAbort(cachedResolution, options.signal)
}
