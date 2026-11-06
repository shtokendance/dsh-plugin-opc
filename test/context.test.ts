import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore, contextId } from '../src/host/context.ts'
import { KnowledgeScopes } from '../src/host/knowledge-scope.ts'
import { PlatformHttp, TokenRefresh } from '../src/host/http.ts'

const context = { issuer: 'https://platform.example', subject: 'alice', tenant: 'A', spaces: ['A', 'B'], generation: 1 }
test('old work stays invalid after switching A -> B -> A', () => {
  const store = new ContextStore()
  store.replace(context)
  const pending = store.capture()
  store.switchTenant('B')
  store.switchTenant('A')
  assert.equal(pending.signal.aborted, true)
  assert.throws(pending.assertCurrent, { code: 'CONTEXT_CHANGED' })
  assert.throws(() => store.switchTenant('C'), { code: 'SPACE_FORBIDDEN' })
})
test('pins and search hits cannot cross sessions or turns', () => {
  const store = new ContextStore(); store.replace(context)
  const scopes = new KnowledgeScopes(store)
  scopes.pin('s1', { tenantId: 'A', knowledgeBaseId: 'kb1', contextId: contextId(context) })
  scopes.begin('s1', 't1'); scopes.begin('s1', 't2')
  scopes.recordHits('s1', 't1', ['doc1'])
  assert.throws(() => scopes.searchParams('s1', 't1', 'B'), { code: 'SCOPE_MISMATCH' })
  assert.throws(() => scopes.assertReadable('s1', 't2', 'doc1'), { code: 'SCOPE_MISMATCH' })
  assert.equal(scopes.scope('s2', 't1'), undefined)
  scopes.assertReadable('s1', 't1', 'doc1')
  assert.throws(() => scopes.verifyDocument('s1', 't1', 'A', 'kb2'), { code: 'SCOPE_MISMATCH' })
})
test('unauthenticated access fails before platform calls', () => {
  assert.throws(() => new ContextStore().capture(), { code: 'ENTERPRISE_NOT_AUTHENTICATED' })
})
test('five concurrent refreshes consume one refresh token', async () => {
  let calls = 0
  const refresh = new TokenRefresh(async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return 'access' })
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => refresh.run())), Array(5).fill('access'))
  assert.equal(calls, 1)
})
test('platform client rejects insecure origins and arbitrary paths', async () => {
  assert.throws(() => new PlatformHttp('http://remote.example'), { code: 'INSECURE_PLATFORM_URL' })
  await assert.rejects(new PlatformHttp('https://platform.example').request('//attacker.example'), { code: 'INVALID_PLATFORM_PATH' })
})

test('changing a pin cannot erase the scope or hit guard of an active turn', () => {
  const store = new ContextStore(); store.replace(context)
  const scopes = new KnowledgeScopes(store)
  scopes.pin('s', { tenantId: 'A', knowledgeBaseId: 'kb1', contextId: contextId(context) })
  scopes.begin('s', 't1'); scopes.recordHits('s', 't1', ['doc'])
  scopes.pin('s', null)
  assert.throws(() => scopes.searchParams('s', 't1', 'A', 'kb2'), { code: 'SCOPE_MISMATCH' })
  assert.throws(() => scopes.assertReadable('s', 't1', 'other'), { code: 'SCOPE_MISMATCH' })
  scopes.begin('s', 't2')
  assert.equal(scopes.scope('s', 't2'), undefined)
})
