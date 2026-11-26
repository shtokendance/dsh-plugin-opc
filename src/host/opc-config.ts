import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePlatformBaseUrl } from './http.ts'

export const DEFAULT_PLATFORM_BASE = 'https://aiwork.benlai.com'
export const DEFAULT_APP_DOMAIN_ROOT = 'ai.benlai.com'
export const DEFAULT_APP_DEFAULT_PORT = 8080
export const DEFAULT_WORKBENCH_NAME = '本来工作台'

export interface StoredOpcConfig {
  platform_base: string
  app_domain_root: string
  app_default_port: number
  workbench_name: string
}

export interface OpcPlatformConfigPayload extends StoredOpcConfig {
  default_platform_base: string
  default_app_domain_root: string
  default_app_default_port: number
  default_workbench_name: string
  effective_app_domain_root: string
}

export interface OpcConnectionTestResult {
  ok: boolean
  status_code?: number
  latency_ms?: number
  error?: string
}

export function normalizePlatformBaseUrl(raw: unknown): string {
  const input = typeof raw === 'string' ? raw.trim() : ''
  if (!input) throw new Error('平台网关地址不能为空')
  return parsePlatformBaseUrl(input).href.replace(/\/+$/, '')
}

export function sanitizeDomainRoot(raw: unknown): string {
  const trimmed = String(raw ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim()
  if (trimmed && /[\s/?#]/.test(trimmed)) {
    throw new Error('应用内网根域名后缀格式无效，请填写如 ai.benlai.com')
  }
  return trimmed
}

export function validateAppDefaultPort(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw new Error('应用默认容器端口必须为 1 至 65535 的整数')
  }
  return num
}

export function sanitizeWorkbenchName(raw: unknown, fallback = DEFAULT_WORKBENCH_NAME): string {
  const normalized = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  if (!normalized) return fallback
  if (normalized.length > 64) {
    throw new Error('工作台名称不能超过 64 个字符')
  }
  return normalized
}

export class OpcConfigStore {
  readonly filePath: string
  readonly #fallback: StoredOpcConfig
  #current: StoredOpcConfig

  constructor(
    readonly home: string,
    initial: { platformBaseUrl?: string; appDomainRoot?: string; appDefaultPort?: number; workbenchName?: string } = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.filePath = join(this.home, 'opc', 'platform-config.json')
    let platformBase = DEFAULT_PLATFORM_BASE
    try {
      if (initial.platformBaseUrl?.trim()) platformBase = normalizePlatformBaseUrl(initial.platformBaseUrl)
    } catch {
      platformBase = DEFAULT_PLATFORM_BASE
    }
    let domainRoot = ''
    try {
      if (initial.appDomainRoot?.trim()) domainRoot = sanitizeDomainRoot(initial.appDomainRoot)
    } catch {
      domainRoot = ''
    }
    let defaultPort = DEFAULT_APP_DEFAULT_PORT
    try {
      if (initial.appDefaultPort !== undefined) defaultPort = validateAppDefaultPort(initial.appDefaultPort)
    } catch {
      defaultPort = DEFAULT_APP_DEFAULT_PORT
    }
    let workbenchName = DEFAULT_WORKBENCH_NAME
    try {
      if (initial.workbenchName?.trim()) workbenchName = sanitizeWorkbenchName(initial.workbenchName, DEFAULT_WORKBENCH_NAME)
    } catch {
      workbenchName = DEFAULT_WORKBENCH_NAME
    }
    this.#fallback = {
      platform_base: platformBase,
      app_domain_root: domainRoot,
      app_default_port: defaultPort,
      workbench_name: workbenchName,
    }
    this.#current = { ...this.#fallback }
  }

  loadSync(): StoredOpcConfig {
    if (!existsSync(this.filePath)) {
      this.#current = { ...this.#fallback }
      return this.current
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredOpcConfig>
      let platform_base = this.#fallback.platform_base
      try {
        if (typeof parsed.platform_base === 'string' && parsed.platform_base.trim()) {
          platform_base = normalizePlatformBaseUrl(parsed.platform_base)
        }
      } catch {
      }
      let app_domain_root = this.#fallback.app_domain_root
      try {
        if (typeof parsed.app_domain_root === 'string') {
          app_domain_root = sanitizeDomainRoot(parsed.app_domain_root)
        }
      } catch {
      }
      let app_default_port = this.#fallback.app_default_port
      try {
        if (parsed.app_default_port !== undefined) {
          app_default_port = validateAppDefaultPort(parsed.app_default_port)
        }
      } catch {
      }
      let workbench_name = this.#fallback.workbench_name
      try {
        if (typeof parsed.workbench_name === 'string') {
          workbench_name = sanitizeWorkbenchName(parsed.workbench_name, this.#fallback.workbench_name)
        }
      } catch {
      }
      this.#current = { platform_base, app_domain_root, app_default_port, workbench_name }
    } catch {
      this.#current = { ...this.#fallback }
    }
    return this.current
  }

  get current(): StoredOpcConfig {
    return { ...this.#current }
  }

  getPayload(livePlatformBase?: string): OpcPlatformConfigPayload {
    const platform_base = livePlatformBase?.trim() ? livePlatformBase.replace(/\/+$/, '') : this.#current.platform_base
    return {
      platform_base,
      app_domain_root: this.#current.app_domain_root,
      app_default_port: this.#current.app_default_port,
      workbench_name: this.#current.workbench_name,
      default_platform_base: DEFAULT_PLATFORM_BASE,
      default_app_domain_root: DEFAULT_APP_DOMAIN_ROOT,
      default_app_default_port: DEFAULT_APP_DEFAULT_PORT,
      default_workbench_name: this.#fallback.workbench_name,
      effective_app_domain_root: this.#current.app_domain_root || DEFAULT_APP_DOMAIN_ROOT,
    }
  }

  private async persist(value: StoredOpcConfig): Promise<void> {
    const dir = join(this.home, 'opc')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const temp = join(dir, `platform-config-${randomUUID()}.tmp`)
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.filePath)
  }

  async update(patch: {
    platform_base?: unknown
    app_domain_root?: unknown
    app_default_port?: unknown
    workbench_name?: unknown
  }): Promise<{ config: OpcPlatformConfigPayload; platform_base_changed: boolean }> {
    const prevBase = this.#current.platform_base
    const nextBase = patch.platform_base !== undefined
      ? normalizePlatformBaseUrl(patch.platform_base)
      : this.#current.platform_base
    const nextDomainRoot = patch.app_domain_root !== undefined
      ? sanitizeDomainRoot(patch.app_domain_root)
      : this.#current.app_domain_root
    const nextDefaultPort = patch.app_default_port !== undefined
      ? validateAppDefaultPort(patch.app_default_port)
      : this.#current.app_default_port
    const nextWorkbenchName = patch.workbench_name !== undefined
      ? sanitizeWorkbenchName(patch.workbench_name, this.#fallback.workbench_name)
      : this.#current.workbench_name
    const next: StoredOpcConfig = {
      platform_base: nextBase,
      app_domain_root: nextDomainRoot,
      app_default_port: nextDefaultPort,
      workbench_name: nextWorkbenchName,
    }
    await this.persist(next)
    this.#current = next
    return {
      config: this.getPayload(),
      platform_base_changed: nextBase !== prevBase,
    }
  }

  async reset(): Promise<{ config: OpcPlatformConfigPayload; platform_base_changed: boolean }> {
    return this.update({
      platform_base: DEFAULT_PLATFORM_BASE,
      app_domain_root: '',
      app_default_port: DEFAULT_APP_DEFAULT_PORT,
      workbench_name: this.#fallback.workbench_name,
    })
  }

  async testConnection(rawUrl: string): Promise<OpcConnectionTestResult> {
    let url: URL
    try {
      url = parsePlatformBaseUrl(String(rawUrl ?? ''))
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '服务地址无效',
      }
    }
    const started = performance.now()
    try {
      const response = await this.fetcher(url.href, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
        redirect: 'manual',
      })
      const latency_ms = Math.max(0, Math.round(performance.now() - started))
      if (response.status < 500) {
        return { ok: true, status_code: response.status, latency_ms }
      }
      return {
        ok: false,
        status_code: response.status,
        latency_ms,
        error: `HTTP ${response.status}`,
      }
    } catch (error) {
      const latency_ms = Math.max(0, Math.round(performance.now() - started))
      return {
        ok: false,
        latency_ms,
        error: error instanceof Error ? error.message : '无法连接到服务器',
      }
    }
  }
}
