import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import open from 'open'
import { AuthManager, type StoredGrant } from './host/auth.ts'
import { PlatformHttp } from './host/http.ts'
import { OpcCore } from './host/core.ts'
import { EnterpriseSkillProvider } from './host/skill-provider.ts'
import { OpcRemoteService } from './host/remote-service.ts'
import { registerTools } from './host/tools.ts'

export const name = 'dsh-plugin-opc'
export const inject = ['credentials', 'authorization', 'skills', 'tools', 'agents', 'approval', 'typert']
export interface Config { platformBaseUrl: string; clientId: string; dataHome: string }
export const Config = z.object({ platformBaseUrl: z.string().default('https://shtokendance.benlai.com'), clientId: z.string().default('work-desktop'), dataHome: z.string().default('') })
export function apply(ctx: Context, config: Config): void {
  const key = credentialKey(name, 'enterprise')
  const auth = new AuthManager(new PlatformHttp(config.platformBaseUrl), {
    async read() {
      const record = await ctx.credentials.readRecord(key)
      if (record?.kind !== 'grant') return undefined
      const payload = record.payload as Partial<StoredGrant> | null
      if (!payload || typeof payload.refreshToken !== 'string' || typeof payload.platformBaseUrl !== 'string' || !payload.lastContext) return undefined
      return payload as StoredGrant
    },
    async write(payload) { await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload })) },
    async delete() { await ctx.credentials.deleteRecord(key) },
  }, async url => { await open(url) }, config.clientId)
  const core = new OpcCore(auth, config.dataHome || resolveDshHome())
  ctx.plugin(OpcRemoteService, core)
  // Native slash UI caches catalogs and observes the public composition event,
  // not the Host-only skills/change event. Bridge this plugin's inventory changes
  // through that public notification; do not patch native caches or UI sources.
  ctx.effect(() => {
    const changed = () => { ctx.emit('plugin-manager/changed', { reason: 'plugin' }) }
    core.on('skills-changed', changed)
    return () => { core.off('skills-changed', changed) }
  })
  ctx.effect(() => ctx.skills.registerProvider(control => new EnterpriseSkillProvider(core, control)))
  registerTools(ctx, core)
  ctx.effect(() => ctx.authorization.registerFlow({
    key, label: 'OPC 企业平台', methods: [{ id: 'oauth', label: '企业微信 / SSO 登录' }],
    async run(session) {
      const login = await auth.startLogin()
      session.notify({ message: '请在浏览器完成企业授权', url: login.authorizeUrl })
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { auth.off('change', changed); session.signal.removeEventListener('abort', cancelled) }
        const changed = () => {
          if (auth.state.loginInProgress) return
          cleanup()
          if (auth.state.signedIn) resolve(); else reject(new Error(auth.state.loginError?.code ?? 'LOGIN_CANCELLED'))
        }
        const cancelled = () => { auth.cancelLogin(); cleanup(); reject(new Error('LOGIN_CANCELLED')) }
        auth.on('change', changed); session.signal.addEventListener('abort', cancelled, { once: true })
        if (session.signal.aborted) cancelled(); else changed()
      })
    },
  }))
  ctx.effect(() => { void auth.restore().catch(() => core.emit('change')); return () => auth.dispose() })
}

export { TYPERT } from './remote-contract.ts'
