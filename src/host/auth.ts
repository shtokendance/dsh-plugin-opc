import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { hostname, platform, arch } from 'node:os'
import { EventEmitter } from 'node:events'
import { ContextStore, OpcError, type EnterpriseContext } from './context.ts'
import { parsePlatformBaseUrl, PlatformHttp, TokenRefresh, type PlatformResponse } from './http.ts'

export interface StoredGrant { refreshToken: string; platformBaseUrl: string; lastContext: EnterpriseContext }
/** Implemented by the host's namespaced credentials service; never local plaintext files. */
export interface GrantStore { read(): Promise<StoredGrant | undefined>; write(value: StoredGrant): Promise<void>; delete(): Promise<void> }
export interface PublicAuthState {
  signedIn: boolean; loginInProgress: boolean; loginAuthorizeUrl?: string
  loginError?: { code: string; message: string }
  context: EnterpriseContext | null
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  SUBJECT_NOT_PROVISIONED: '当前账号未同步到 OPC 平台或已被禁用，请联系管理员在统一账户中心启用账号并执行全量同步后重试。',
  SUBJECT_CONFLICT: '当前账号存在身份绑定冲突，请联系管理员在统一账户中心核对账号信息。',
  WECOM_EXCHANGE_FAILED: '企业微信身份校验失败，请重试；如持续失败请联系管理员检查企业微信应用配置。',
  ACCOUNT_CENTER_UNAVAILABLE: '统一账户中心暂不可用，请稍后重试；如持续失败请联系管理员。',
  AUTH_STATE_MISMATCH: '登录会话已失效或状态不匹配，请返回 DSH 重新发起企业登录。',
  AUTH_CODE_REPLAYED: '授权码已失效或已被使用，请返回 DSH 重新发起企业登录。',
  INTERNAL_ERROR: 'OPC 平台认证服务异常，请稍后重试或联系管理员。',
  AUTHORIZATION_DENIED: '企业授权未完成或未返回授权码，请重试。',
  access_denied: '企业授权已取消或未通过，请重试。',
  INVALID_TOKEN_RESPONSE: '平台返回的登录令牌格式无效，请重试或联系管理员。',
  INVALID_SESSION_RESPONSE: '平台返回的会话信息无效，请重试或联系管理员。',
  PLATFORM_REQUEST_FAILED: '平台登录请求失败，请检查平台网关配置后重试。',
}

function normalizeCallbackErrorCode(rawError: string | null): string {
  const trimmed = rawError?.trim() ?? ''
  return /^[A-Za-z0-9_.-]{1,64}$/.test(trimmed) ? trimmed : 'AUTHORIZATION_DENIED'
}

function describeLoginError(code: string): string {
  return LOGIN_ERROR_MESSAGES[code]
    ?? LOGIN_ERROR_MESSAGES[code.toUpperCase()]
    ?? (code === 'LOGIN_FAILED' ? '企业登录未完成，请重试。' : `企业登录未完成（${code}），请重试。`)
}

function check(response: PlatformResponse): Record<string, unknown> {
  if (response.status >= 400) {
    const error = response.body.error as { code?: string } | undefined
    throw new OpcError(error?.code ?? 'PLATFORM_REQUEST_FAILED')
  }
  return response.body
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderCallbackHtml(options: { ok: boolean; title: string; subtitle: string; code?: string }): string {
  const icon = options.ok
    ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  const statusClass = options.ok ? 'success' : 'error'
  const codeHtml = options.code ? `<span class="error-code">${escapeHtml(options.code)}</span>` : ''
  const footerHtml = options.ok
    ? '<a class="btn-primary" href="dsh://open">返回 DeepSeek Harness</a><p class="subtle-note">若浏览器未自动跳转，可点击上方按钮或关闭此标签页切回客户端</p>'
    : '<a class="btn-secondary" href="dsh://open">返回 DeepSeek Harness</a>'
  const autoOpenScript = options.ok
    ? "<script>setTimeout(function(){window.location.href='dsh://open'},180)</script>"
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(options.title)} - OPC 工作台</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;background:radial-gradient(circle at 50% 0%,#eff6ff 0%,#f4f6fa 65%);color:#0f172a}
.card{width:100%;max-width:392px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 12px 32px -8px rgba(15,23,42,.08),0 2px 6px rgba(15,23,42,.03);overflow:hidden}
.body{padding:28px 24px 22px;text-align:center}
.circle{width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center}
.circle.success{background:#ecfdf5;color:#10b981;box-shadow:0 0 0 6px rgba(16,185,129,.1)}
.circle.error{background:#fef2f2;color:#ef4444;box-shadow:0 0 0 6px rgba(239,68,68,.1)}
h1{margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a}
p{margin:0;font-size:13px;color:#64748b;line-height:1.55}
.error-code{display:inline-block;margin-top:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:2px 8px;border-radius:6px}
.footer{padding:16px 24px 20px;background:#f8fafc;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:10px}
.btn-primary{width:100%;height:42px;border:0;border-radius:10px;background:linear-gradient(180deg,#2563eb 0%,#1d4ed8 100%);color:#fff;font-size:13.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;box-shadow:0 4px 12px rgba(37,99,235,.25)}
.btn-primary:hover{background:linear-gradient(180deg,#1d4ed8 0%,#1e40af 100%)}
.btn-secondary{width:100%;height:38px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;color:#475569;font-size:13px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.btn-secondary:hover{background:#f1f5f9;color:#0f172a}
.subtle-note{font-size:11.5px;color:#64748b;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="body">
    <div class="circle ${statusClass}">${icon}</div>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.subtitle)}</p>
    ${codeHtml}
  </div>
  <div class="footer">${footerHtml}</div>
</div>
${autoOpenScript}
</body>
</html>`
}

export class AuthManager extends EventEmitter {
  readonly contexts = new ContextStore()
  #access = ''
  #refresh = ''
  #expiresAt = 0
  #revision = 0
  #sessionRequest = 0
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
  private sessionContext(view: Record<string, unknown>, old: EnterpriseContext | null, newLogin = false): EnterpriseContext {
    const subject = text(view.subject)
    if (!subject || !Array.isArray(view.spaces) || !view.spaces.every(s => typeof s === 'string')) throw new OpcError('INVALID_SESSION_RESPONSE')
    const spaces = view.spaces as string[]
    const tenant = old?.subject === subject && spaces.includes(old.tenant) ? old.tenant : spaces.includes(text(view.tenant)) ? text(view.tenant) : spaces[0] ?? ''
    return { issuer: this.http.base.origin, subject, tenant, spaces, generation: newLogin || !old ? this.contexts.epoch + 1 : old.generation + Number(old.tenant !== tenant),
      displayName: text(view.name) || old?.displayName || '', email: text(view.email) || old?.email || '',
      spacesDetail: spaces.map(id => {
        const details = Array.isArray(view.spaces_detail) ? view.spaces_detail : []
        const detail = details.find(item => item && typeof item === 'object' && item.id === id)
        return { id, name: detail && typeof detail.name === 'string' ? detail.name : id }
      }),
    }
  }
  async syncSession(): Promise<void> {
    const revision = this.#revision
    const request = ++this.#sessionRequest
    const token = await this.token()
    const isCurrent = () => revision === this.#revision && request === this.#sessionRequest && token === this.#access
    if (!isCurrent()) throw new OpcError('CONTEXT_CHANGED')
    const response = await this.http.request('/integration/v1/session', { token })
    if (!isCurrent()) throw new OpcError('CONTEXT_CHANGED')
    if (response.status === 401 || ['SESSION_REVOKED', 'SUBJECT_NOT_PROVISIONED'].includes(text((response.body.error as { code?: unknown } | undefined)?.code))) {
      await this.invalidateSession()
    }
    const view = check(response)
    const current = this.contexts.current
    if (!current || view.subject !== current.subject) throw new OpcError('INVALID_SESSION_RESPONSE')
    const updated = this.sessionContext(view, current)
    if (JSON.stringify(current) !== JSON.stringify(updated)) {
      this.contexts.replace(updated)
      this.changed()
    }
  }
  private async accept(body: Record<string, unknown>, revision: number, newLogin = false): Promise<string> {
    if (revision !== this.#revision) throw new OpcError('CONTEXT_CHANGED')
    const access = text(body.access_token), refresh = text(body.refresh_token)
    if (!access || !refresh || typeof body.expires_in !== 'number' || body.expires_in <= 0) throw new OpcError('INVALID_TOKEN_RESPONSE')
    let view = body
    if (!text(view.subject) || !Array.isArray(view.spaces)) view = { ...body, ...check(await this.http.request('/integration/v1/session', { token: access })) }
    if (revision !== this.#revision) throw new OpcError('CONTEXT_CHANGED')
    const old = this.contexts.current
    const context = this.sessionContext(view, old, newLogin)
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
      if (revision === this.#revision && error instanceof OpcError && ['REFRESH_REUSE_DETECTED', 'SESSION_REVOKED', 'SUBJECT_NOT_PROVISIONED'].includes(error.code)) await this.clear()
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
  async setPlatformBase(baseUrl: string): Promise<boolean> {
    const next = parsePlatformBaseUrl(baseUrl)
    if (next.href === this.http.base.href) return false
    await this.invalidateSession()
    this.http.setBase(next.href)
    this.changed()
    return true
  }
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
      const code = url.searchParams.get('code')?.trim()
      const callbackError = url.searchParams.get('error')
      void (async () => {
        try {
          if (callbackError !== null && callbackError.trim() !== '') {
            const errorCode = normalizeCallbackErrorCode(callbackError)
            throw new OpcError(errorCode, describeLoginError(errorCode))
          }
          if (!code) throw new OpcError('AUTHORIZATION_DENIED', describeLoginError('AUTHORIZATION_DENIED'))
          const result = check(await this.http.request('/integration/v1/auth/token', { signal: controller.signal, body: { grant_type: 'authorization_code', client_id: this.clientId, code, code_verifier: verifier, device: this.device, audience: 'work' } }))
          if (controller.signal.aborted) throw new OpcError('LOGIN_CANCELLED')
          await this.accept(result, revision, true)
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderCallbackHtml({
            ok: true,
            title: '登录成功',
            subtitle: '已成功连接 OPC 企业工作空间，正在为您唤起 DeepSeek Harness 客户端…',
          }))
        } catch (error) {
          const errorCode = error instanceof OpcError ? error.code : 'LOGIN_FAILED'
          const message = describeLoginError(errorCode)
          if (revision === this.#revision) this.#error = { code: errorCode, message }
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(renderCallbackHtml({
            ok: false,
            title: '授权未完成',
            subtitle: message,
            code: errorCode,
          }))
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
