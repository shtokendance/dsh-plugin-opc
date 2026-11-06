import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { SkillInstaller } from '../src/host/installer.ts'
const context = { issuer: 'https://example.com', subject: 'alice', tenant: 'a', spaces: ['a'], generation: 1 }
const markdown = '---\nname: demo\ndescription: Demo skill\n---\nUse this skill.'
function bundle(files: Record<string, Uint8Array>) {
  const bytes = Buffer.from(zipSync(files))
  const sha = createHash('sha256').update(bytes).digest('hex')
  return { catalogId: 'cat', name: 'demo', version: '1', expectedSha256: sha, headerSha256: sha, bytes }
}
test('atomic update rejects corrupt archives and keeps previous active skill', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-skill-'))
  const installer = new SkillInstaller(home)
  try {
    const first = await installer.install(context, bundle({ 'SKILL.md': strToU8(markdown) }), () => {})
    await assert.rejects(installer.install(context, { ...bundle({ 'SKILL.md': strToU8(markdown) }), headerSha256: null }, () => {}), { code: 'SKILL_HASH_MISMATCH' })
    await assert.rejects(installer.install(context, bundle({ '../SKILL.md': strToU8(markdown) }), () => {}), { code: 'SKILL_PACKAGE_UNSAFE' })
    await assert.rejects(installer.install(context, bundle({ 'SKILL.md': strToU8(markdown), 'nested/SKILL.md': strToU8(markdown) }), () => {}), { code: 'SKILL_PACKAGE_UNSAFE' })
    assert.deepEqual(await installer.list(context), [first])
    assert.equal(await readFile(installer.skillPath(context, first), 'utf8'), markdown)
    await installer.setEnabled(context, 'cat', false, () => {})
    assert.equal((await installer.list(context))[0].enabled, false)
    await installer.remove(context, 'cat')
    assert.deepEqual(await installer.list(context), [])
  } finally { await rm(home, { recursive: true, force: true }) }
})
test('single wrapper directory installs; stale context cannot activate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-skill-'))
  const installer = new SkillInstaller(home)
  try {
    const input = bundle({ 'demo/SKILL.md': strToU8(markdown) })
    await assert.rejects(installer.install(context, input, () => { throw new Error('stale') }), /stale/)
    assert.deepEqual(await installer.list(context), [])
    const result = await installer.install(context, input, () => {})
    assert.equal((await installer.parseSkill(installer.skillPath(context, result))).name, 'demo')
  } finally { await rm(home, { recursive: true, force: true }) }
})
