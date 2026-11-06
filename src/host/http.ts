import { OpcError } from './context.ts'

export interface PlatformResponse { status: number; body: Record<string, unknown>; headers: Headers }

/** Redirects are rejected so bearer credentials never follow a platform redirect. */
export class PlatformHttp {
  readonly base: URL
  constructor(base: string, private readonly timeoutMs = 15_000, private readonly fetcher: typeof fetch = fetch) {
    this.base = new URL(base)
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new OpcError('INVALID_PLATFORM_URL')
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(this.base.hostname))) throw new OpcError('INSECURE_PLATFORM_URL')
  }
  async archive(path: string, token: string, signal: AbortSignal): Promise<{ bytes: Buffer; sha256: string | null }> {
    if (!path.startsWith('/integration/v1/resources/skills/')) throw new OpcError('INVALID_PLATFORM_PATH')
    const response = await this.fetcher(new URL(path, this.base), { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), headers: { Authorization: `Bearer ${token}`, Accept: 'application/zip' } })
    if (response.status !== 200 || !response.body) throw new OpcError(response.status === 409 ? 'SKILL_VERSION_CHANGED' : 'ARCHIVE_DOWNLOAD_FAILED')
    const chunks: Buffer[] = []; let size = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 256 * 1024 * 1024) throw new OpcError('SKILL_PACKAGE_UNSAFE')
        chunks.push(Buffer.from(part.value))
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    return { bytes: Buffer.concat(chunks), sha256: response.headers.get('X-SHA256') }
  }
  async request(path: string, options: { body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<PlatformResponse> {
    if (!path.startsWith('/integration/v1/')) throw new OpcError('INVALID_PLATFORM_PATH')
    const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(options.signal ? [options.signal] : [])])
    const response = await this.fetcher(new URL(path, this.base), {
      method: options.body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const raw: unknown = await response.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OpcError('INVALID_PLATFORM_RESPONSE')
    return { status: response.status, body: raw as Record<string, unknown>, headers: response.headers }
  }
}

/** Refresh is shared but side-effecting business requests are never automatically replayed. */
export class TokenRefresh {
  #pending: Promise<string> | undefined
  constructor(private readonly refresh: () => Promise<string>) {}
  run(): Promise<string> {
    if (!this.#pending) this.#pending = this.refresh().finally(() => { this.#pending = undefined })
    return this.#pending
  }
}
