import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AuthManager, type StoredGrant, type GrantStore } from '../src/host/auth.ts'
import { PlatformHttp } from '../src/host/http.ts'

class MemoryGrants implements GrantStore {
  value: StoredGrant | undefined
  async read() { return this.value }
  async write(value: StoredGrant) { this.value = structuredClone(value) }
  async delete() { this.value = undefined }
}
const tokens = { access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 900, subject: 'alice', spaces: ['a', 'b'], tenant: 'a' }
function setup(handler: (path: string, body: Record<string, unknown>) => Promise<Response>) {
  const grants = new MemoryGrants()
  const auth = new AuthManager(new PlatformHttp('http://127.0.0.1:3002', 1000, async (url, init) => handler(new URL(String(url)).pathname, JSON.parse(String(init?.body ?? '{}')))), grants, async () => {})
  return { auth, grants }
}
test('PKCE loopback validates state, token verifier and secret-free persistence', async () => {
  let authorization: Record<string, unknown> = {}
  const { auth, grants } = setup(async (path, body) => {
    if (path.endsWith('/authorize')) { authorization = body; return Response.json({ authorize_url: 'http://127.0.0.1:3002/login' }) }
    assert.equal(createHash('sha256').update(String(body.code_verifier)).digest('base64url'), authorization.code_challenge)
    return Response.json(tokens)
  })
  try {
    await auth.startLogin()
    const callback = `${authorization.redirect_uri}?code=one&state=`
    assert.equal((await fetch(callback + 'wrong')).status, 400)
    assert.equal((await fetch(callback + authorization.state)).status, 200)
    assert.equal(auth.state.signedIn, true)
    assert.equal(await auth.token(), 'secret-access')
    assert.equal(JSON.stringify(grants.value).includes('secret-access'), false)
    assert.equal(JSON.stringify(auth.state).includes('secret'), false)
  } finally { await auth.dispose() }
})
test('late refresh after logout cannot restore credentials or identity', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let started: (() => void) | undefined
  const start = new Promise<void>(resolve => { started = resolve })
  const { auth, grants } = setup(async path => {
    if (path.endsWith('/refresh')) { started!(); await pending; return Response.json(tokens) }
    return Response.json({})
  })
  grants.value = { refreshToken: 'old', platformBaseUrl: 'http://127.0.0.1:3002/', lastContext: { issuer: 'http://127.0.0.1:3002', subject: 'alice', tenant: 'a', spaces: ['a'], generation: 1 } }
  const restore = auth.restore()
  await start
  await auth.logout()
  release!()
  await assert.rejects(restore, { code: 'CONTEXT_CHANGED' })
  assert.equal(auth.state.signedIn, false)
  assert.equal(grants.value, undefined)
})
test('refresh replay detection deletes persisted grant', async () => {
  const { auth, grants } = setup(async () => Response.json({ error: { code: 'REFRESH_REUSE_DETECTED' } }, { status: 401 }))
  grants.value = { refreshToken: 'old', platformBaseUrl: 'http://127.0.0.1:3002/', lastContext: { issuer: 'http://127.0.0.1:3002', subject: 'alice', tenant: 'a', spaces: ['a'], generation: 1 } }
  await assert.rejects(auth.restore(), { code: 'REFRESH_REUSE_DETECTED' })
  assert.equal(grants.value, undefined)
  assert.equal(auth.state.signedIn, false)
})

test('cancel during credential persistence cannot resurrect login on restart', async () => {
  let authorization: Record<string, unknown> = {}
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  const { auth, grants } = setup(async (path, body) => {
    if (path.endsWith('/authorize')) { authorization = body; return Response.json({ authorize_url: 'http://127.0.0.1:3002/login' }) }
    return Response.json(tokens)
  })
  grants.write = async value => { entered(); await pending; grants.value = structuredClone(value) }
  try {
    await auth.startLogin()
    const callback = fetch(`${authorization.redirect_uri}?code=one&state=${authorization.state}`)
    await started; auth.cancelLogin(); release()
    assert.equal((await callback).status, 400)
    assert.equal(grants.value, undefined); assert.equal(auth.state.signedIn, false)
  } finally { release(); await auth.dispose() }
})
test('credential write failure removes the consumed refresh grant', async () => {
  const { auth, grants } = setup(async () => Response.json(tokens))
  grants.value = { refreshToken: 'old', platformBaseUrl: 'http://127.0.0.1:3002/', lastContext: { issuer: 'http://127.0.0.1:3002', subject: 'alice', tenant: 'a', spaces: ['a'], generation: 1 } }
  grants.write = async () => { throw new Error('credential store failed') }
  await assert.rejects(auth.restore(), /credential store failed/)
  assert.equal(grants.value, undefined); assert.equal(auth.state.signedIn, false)
  await auth.dispose()
})
test('callback error query surfaces specific code and Chinese guidance', async () => {
  const cases = [
    { query: 'error=SUBJECT_NOT_PROVISIONED', code: 'SUBJECT_NOT_PROVISIONED', snippet: '统一账户中心启用账号并执行全量同步' },
    { query: 'error=SUBJECT_CONFLICT', code: 'SUBJECT_CONFLICT', snippet: '身份绑定冲突' },
    { query: 'error=CUSTOM_UPSTREAM_ERR', code: 'CUSTOM_UPSTREAM_ERR', snippet: 'CUSTOM_UPSTREAM_ERR' },
    { query: 'error=%3Cscript%3Ealert(1)%3C%2Fscript%3E', code: 'AUTHORIZATION_DENIED', snippet: '未返回授权码' },
    { query: '', code: 'AUTHORIZATION_DENIED', snippet: '未返回授权码' },
  ]
  for (const item of cases) {
    let authorization: Record<string, unknown> = {}
    const { auth } = setup(async (path, body) => {
      if (path.endsWith('/authorize')) { authorization = body; return Response.json({ authorize_url: 'http://127.0.0.1:3002/login' }) }
      throw new Error(`Unexpected token exchange for error callback ${item.query}`)
    })
    try {
      await auth.startLogin()
      const sep = item.query ? `${item.query}&` : ''
      const res = await fetch(`${authorization.redirect_uri}?${sep}state=${authorization.state}`)
      const body = await res.text()
      assert.equal(res.status, 400)
      assert.match(res.headers.get('content-type') ?? '', /text\/plain;\s*charset=utf-8/i)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(auth.state.signedIn, false)
      assert.equal(auth.state.loginInProgress, false)
      assert.equal(auth.state.loginError?.code, item.code)
      assert.match(auth.state.loginError?.message ?? '', new RegExp(item.snippet))
      assert.match(body, new RegExp(item.snippet))
      assert.match(body, new RegExp(item.code))
    } finally { await auth.dispose() }
  }
})
test('token exchange error surfaces specific code and Chinese guidance', async () => {
  let authorization: Record<string, unknown> = {}
  const { auth } = setup(async (path, body) => {
    if (path.endsWith('/authorize')) { authorization = body; return Response.json({ authorize_url: 'http://127.0.0.1:3002/login' }) }
    return Response.json({ error: { code: 'SUBJECT_NOT_PROVISIONED' } }, { status: 403 })
  })
  try {
    await auth.startLogin()
    const res = await fetch(`${authorization.redirect_uri}?code=one&state=${authorization.state}`)
    const body = await res.text()
    assert.equal(res.status, 400)
    assert.equal(auth.state.signedIn, false)
    assert.equal(auth.state.loginError?.code, 'SUBJECT_NOT_PROVISIONED')
    assert.match(auth.state.loginError?.message ?? '', /全量同步/)
    assert.match(body, /SUBJECT_NOT_PROVISIONED/)
  } finally { await auth.dispose() }
})

test('syncSession refreshes space names and preserves the selected space until removed', async () => {
  let spaces = ['a', 'b', 'c']
  const { auth, grants } = setup(async path => {
    if (path.endsWith('/refresh')) return Response.json(tokens)
    assert.equal(path, '/integration/v1/session')
    return Response.json({ subject: 'alice', spaces, spaces_detail: [{ id: 'c', name: '协作空间' }] })
  })
  grants.value = { refreshToken: 'old', platformBaseUrl: 'http://127.0.0.1:3002/', lastContext: { issuer: 'http://127.0.0.1:3002', subject: 'alice', tenant: 'a', spaces: ['a'], generation: 1 } }
  try {
    await auth.restore()
    auth.switchTenant('b')
    const generation = auth.state.context?.generation
    await auth.syncSession()
    assert.equal(auth.state.context?.tenant, 'b')
    assert.equal(auth.state.context?.generation, generation)
    assert.deepEqual(auth.state.context?.spacesDetail?.at(-1), { id: 'c', name: '协作空间' })
    spaces = ['c']
    await auth.syncSession()
    assert.equal(auth.state.context?.tenant, 'c')
    assert.equal(auth.state.context?.generation, Number(generation) + 1)
  } finally { await auth.dispose() }
})
