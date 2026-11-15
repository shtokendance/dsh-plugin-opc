import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePlatformBaseUrl } from './http.ts'

export const DEFAULT_PLATFORM_BASE = 'https://shtokendance.benlai.com'
export const DEFAULT_APP_DOMAIN_ROOT = '10.101.102.116.nip.io:8080'
export const DEFAULT_APP_DEFAULT_PORT = 8080

export interface StoredOpcConfig {
  platform_base: string
  app_domain_root: string
  app_default_port: number
}

export interface OpcPlatformConfigPayload extends StoredOpcConfig {
  default_platform_base: string
  default_app_domain_root: string
  default_app_default_port: number
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
    throw new Error('应用内网根域名后缀格式无效，请填写如 10.101.102.116.nip.io:8080')
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

export class OpcConfigStore {
  readonly filePath: string
  readonly #fallback: StoredOpcConfig
  #current: StoredOpcConfig

  constructor(
    readonly home: string,
    initial: { platformBaseUrl?: string; appDomainRoot?: string; appDefaultPort?: number } = {},
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
    this.#fallback = {
      platform_base: platformBase,
      app_domain_root: domainRoot,
      app_default_port: defaultPort,
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
        /* keep fallback */
      }
      let app_domain_root = this.#fallback.app_domain_root
      try {
        if (typeof parsed.app_domain_root === 'string') {
          app_domain_root = sanitizeDomainRoot(parsed.app_domain_root)
        }
      } catch {
        /* keep fallback */
      }
      let app_default_port = this.#fallback.app_default_port
      try {
        if (parsed.app_default_port !== undefined) {
          app_default_port = validateAppDefaultPort(parsed.app_default_port)
        }
      } catch {
        /* keep fallback */
      }
      this.#current = { platform_base, app_domain_root, app_default_port }
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
      default_platform_base: DEFAULT_PLATFORM_BASE,
      default_app_domain_root: DEFAULT_APP_DOMAIN_ROOT,
      default_app_default_port: DEFAULT_APP_DEFAULT_PORT,
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
    const next: StoredOpcConfig = {
      platform_base: nextBase,
      app_domain_root: nextDomainRoot,
      app_default_port: nextDefaultPort,
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
