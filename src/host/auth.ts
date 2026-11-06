import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { hostname, platform, arch } from 'node:os'
import { EventEmitter } from 'node:events'
import { ContextStore, OpcError, type EnterpriseContext } from './context.ts'
import { PlatformHttp, TokenRefresh, type PlatformResponse } from './http.ts'

export interface StoredGrant { refreshToken: string; platformBaseUrl: string; lastContext: EnterpriseContext }
/** Implemented by the host's namespaced credentials service; never local plaintext files. */
export interface GrantStore { read(): Promise<StoredGrant | undefined>; write(value: StoredGrant): Promise<void>; delete(): Promise<void> }
export interface PublicAuthState {
  signedIn: boolean; loginInProgress: boolean; loginAuthorizeUrl?: string
  loginError?: { code: string; message: string }
  context: EnterpriseContext | null
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function check(response: PlatformResponse): Record<string, unknown> {
  if (response.status >= 400) {
    const error = response.body.error as { code?: string } | undefined
    throw new OpcError(error?.code ?? 'PLATFORM_REQUEST_FAILED')
  }
  return response.body
}

export class AuthManager extends EventEmitter {
  readonly contexts = new ContextStore()
  #access = ''
  #refresh = ''
  #expiresAt = 0
  #revision = 0
  #writes: Promise<void> = Promise.resolve()
  #login: { server: Server; controller: AbortController; timer: ReturnType<typeof setTimeout>; url?: string } | undefined
  #error: PublicAuthState['loginError']
  #refreshFlight: TokenRefresh
  readonly device = createHash('sha256').update(`${hostname()}:${platform()}:${arch()}`).digest('hex').slice(0, 32)
  constructor(readonly http: PlatformHttp, private readonly grants: GrantStore, private readonly openBrowser: (url: string) => Promise<void>, readonly clientId = 'work-desktop') {
    super()
    this.#refreshFlight = new TokenRefresh(() => this.refresh())
  }
  get state(): PublicAuthState {
    return { signedIn: this.contexts.current !== null, loginInProgress: !!this.#login, loginAuthorizeUrl: this.#login?.url, loginError: this.#error, context: this.contexts.current }
  }
  private changed(): void { this.emit('change', this.state) }
  private persist(action: () => Promise<void>): Promise<void> {
    const next = this.#writes.then(action)
    this.#writes = next.catch(() => {}) // caller owns failure; retain queue usability
    return next
  }
  private async accept(body: Record<string, unknown>, revision: number, newLogin = false): Promise<string> {
    if (revision !== this.#revision) throw new OpcError('CONTEXT_CHANGED')
    const access = text(body.access_token), refresh = text(body.refresh_token)
    if (!access || !refresh || typeof body.expires_in !== 'number' || body.expires_in <= 0) throw new OpcError('INVALID_TOKEN_RESPONSE')
    let view = body
    if (!text(view.subject) || !Array.isArray(view.spaces)) view = { ...body, ...check(await this.http.request('/integration/v1/session', { token: access })) }
    if (revision !== this.#revision) throw new OpcError('CONTEXT_CHANGED')
    const subject = text(view.subject)
    if (!subject || !Array.isArray(view.spaces) || !view.spaces.every(s => typeof s === 'string')) throw new OpcError('INVALID_SESSION_RESPONSE')
    const old = this.contexts.current
    const spaces = view.spaces as string[]
    const tenant = old?.subject === subject && spaces.includes(old.tenant) ? old.tenant : spaces.includes(text(view.tenant)) ? text(view.tenant) : spaces[0] ?? ''
    const context: EnterpriseContext = { issuer: this.http.base.origin, subject, tenant, spaces, generation: newLogin || !old ? this.contexts.epoch + 1 : old.generation,
      displayName: text(view.name) || old?.displayName || '', email: text(view.email) || old?.email || '',
      spacesDetail: spaces.map(id => {
        const details = Array.isArray(view.spaces_detail) ? view.spaces_detail : []
        const detail = details.find(item => item && typeof item === 'object' && item.id === id)
        return { id, name: detail && typeof detail.name === 'string' ? detail.name : id }
      }),
    }
    try {
      await this.persist(async () => {
        if (revision !== this.#revision) throw new OpcError('CONTEXT_CHANGED')
        await this.grants.write({ refreshToken: refresh, platformBaseUrl: this.http.base.href, lastContext: context })
      })
    } catch (error) {
      // A rotated token must never leave the old durable refresh token reusable.
      if (revision === this.#revision) await this.clear().catch(() => {})
      throw error
    }
    if (revision !== this.#revision) {
      // Cancellation may arrive while the credential backend is writing. Remove
      // only this abandoned grant, never a later login's serialized replacement.
      await this.persist(async () => {
        if ((await this.grants.read())?.refreshToken === refresh) await this.grants.delete()
      })
      throw new OpcError('CONTEXT_CHANGED')
    }
    this.#access = access; this.#refresh = refresh; this.#expiresAt = Date.now() + body.expires_in * 1000
    if (!old || JSON.stringify(old) !== JSON.stringify(context)) this.contexts.replace(context)
    this.changed()
    return access
  }
  async restore(): Promise<void> {
    const revision = this.#revision
    const stored = await this.grants.read()
    if (revision !== this.#revision || !stored || stored.platformBaseUrl !== this.http.base.href) return
    this.#refresh = stored.refreshToken
    await this.#refreshFlight.run()
  }
  async token(): Promise<string> {
    this.contexts.capture()
    if (Date.now() >= this.#expiresAt - 120_000) return this.#refreshFlight.run()
    return this.#access
  }
  private async refresh(): Promise<string> {
    const revision = this.#revision
    if (!this.#refresh) throw new OpcError('ENTERPRISE_NOT_AUTHENTICATED')
    try {
      return await this.accept(check(await this.http.request('/integration/v1/auth/refresh', { body: { refresh_token: this.#refresh, client_id: this.clientId, device: this.device } })), revision)
    } catch (error) {
      if (revision === this.#revision && error instanceof OpcError && ['REFRESH_REUSE_DETECTED', 'SESSION_REVOKED'].includes(error.code)) await this.clear()
      throw error
    }
  }
  private async clear(): Promise<void> {
    this.#revision++
    this.cancelLogin()
    this.#access = ''; this.#refresh = ''; this.#expiresAt = 0
    this.contexts.replace(null); this.changed()
    await this.persist(() => this.grants.delete())
  }
  async invalidateSession(): Promise<void> { await this.clear() }
  async logout(): Promise<void> {
    const refresh = this.#refresh, access = this.#access
    await this.clear()
    if (refresh) {
      try { await this.http.request('/integration/v1/auth/logout', { token: access, body: { refresh_token: refresh, client_id: this.clientId } }) }
      catch (error) { this.emit('logout-remote-failed', error instanceof OpcError ? error.code : 'NETWORK_ERROR') }
    }
  }
  switchTenant(tenant: string): void { this.contexts.switchTenant(tenant); this.changed() }
  cancelLogin(): void {
    const login = this.#login
    if (!login) return
    this.#revision++; this.#login = undefined; clearTimeout(login.timer); login.controller.abort(); login.server.close(); this.changed()
  }
  async startLogin(): Promise<{ authorizeUrl: string }> {
    this.cancelLogin(); this.#revision++; this.#error = undefined
    const revision = this.#revision
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url')
    const controller = new AbortController()
    let consumed = false
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state || consumed) { response.writeHead(400).end('Invalid callback'); return }
      consumed = true
      const code = url.searchParams.get('code')
      void (async () => {
        try {
          if (!code) throw new OpcError('AUTHORIZATION_DENIED')
          const result = check(await this.http.request('/integration/v1/auth/token', { signal: controller.signal, body: { grant_type: 'authorization_code', client_id: this.clientId, code, code_verifier: verifier, device: this.device, audience: 'work' } }))
          if (controller.signal.aborted) throw new OpcError('LOGIN_CANCELLED')
          await this.accept(result, revision, true)
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('登录成功，请返回 DSH。')
        } catch (error) {
          if (revision === this.#revision) this.#error = { code: error instanceof OpcError ? error.code : 'LOGIN_FAILED', message: '企业登录未完成，请重试。' }
          response.writeHead(400).end('Login failed')
        } finally { if (this.#login?.server === server) this.cancelLogin() }
      })()
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') { server.close(); throw new OpcError('CALLBACK_LISTEN_FAILED') }
    const timer = setTimeout(() => { if (this.#login?.server === server) { this.#error = { code: 'LOGIN_TIMEOUT', message: '登录等待超时，请重试。' }; this.cancelLogin() } }, 300_000)
    timer.unref()
    this.#login = { server, controller, timer }; this.changed()
    try {
      const result = check(await this.http.request('/integration/v1/auth/authorize', { signal: controller.signal, body: { client_id: this.clientId, redirect_uri: `http://127.0.0.1:${address.port}/callback`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', device: this.device } }))
      const url = new URL(text(result.authorize_url), this.http.base)
      if (url.origin !== this.http.base.origin || url.username || url.password) throw new OpcError('INVALID_AUTHORIZATION_URL')
      if (this.#login?.server !== server || revision !== this.#revision) throw new OpcError('LOGIN_CANCELLED')
      this.#login.url = url.href; this.changed(); await this.openBrowser(url.href)
      return { authorizeUrl: url.href }
    } catch (error) { if (this.#login?.server === server) this.cancelLogin(); throw error }
  }
  async dispose(): Promise<void> { this.#revision++; this.cancelLogin(); this.contexts.replace(null); this.removeAllListeners() }
}
