import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { normalizeLocalSourcePath, worker } from '../src/host/app-delivery.ts'

test('normalizeLocalSourcePath trims whitespace and strips matching quotes from Windows Copy as path', () => {
  assert.equal(normalizeLocalSourcePath('  "D:\\OPC-2.0\\my-app"  '), 'D:\\OPC-2.0\\my-app')
  assert.equal(normalizeLocalSourcePath("'C:\\Users\\demo\\app.zip'"), 'C:\\Users\\demo\\app.zip')
  assert.equal(normalizeLocalSourcePath('D:\\OPC-2.0\\my-app'), 'D:\\OPC-2.0\\my-app')
  assert.equal(normalizeLocalSourcePath(''), '')
  assert.equal(normalizeLocalSourcePath(undefined), '')
})

test('worker prepare extracts Windows ZIP archives with backslash entry names and normalizes relative paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opc-win-zip-'))
  try {
    const zipPath = join(dir, 'win-app.zip')
    const archive = zipSync({
      'my-app\\': new Uint8Array(0),
      'my-app\\Dockerfile': strToU8('FROM python:3.12-slim\nCMD ["python3", "src/app.py"]\n'),
      'my-app\\src\\app.py': strToU8('print("hello windows")\n'),
    })
    await writeFile(zipPath, archive)

    const root = join(dir, 'job')
    await worker({
      action: 'prepare',
      root,
      source: zipPath,
      slug: 'win-demo',
      url: 'https://win-demo.ai.benlai.com',
    })

    const inv = await worker({ action: 'inventory', root })
    const paths = (inv.files as { path: string }[]).map(f => f.path).sort()
    assert.deepEqual(paths, ['Dockerfile', 'src/app.py'])

    // Reading with Windows backslashes or leading .\ succeeds and returns canonical POSIX path
    const readBackslash = await worker({ action: 'read', root, path: 'src\\app.py' })
    assert.equal(readBackslash.path, 'src/app.py')
    assert.match(readBackslash.text, /hello windows/)

    const readDotBackslash = await worker({ action: 'read', root, path: '.\\Dockerfile' })
    assert.equal(readDotBackslash.path, 'Dockerfile')
    assert.match(readDotBackslash.text, /FROM python:3\.12-slim/)

    // Proposing a file with Windows backslash path stores canonical POSIX path and matches proposed reads
    const staged = await worker({
      action: 'propose_file',
      root,
      id: 'update-app',
      path: 'src\\app.py',
      reason: 'update app for container',
      content: 'print("updated")\n',
      skill_delivery: true,
    })
    assert.equal(staged.path, 'src/app.py')

    const readProposed = await worker({ action: 'read', root, path: 'src/app.py', proposed: true })
    assert.equal(readProposed.view, 'proposed')
    assert.match(readProposed.text, /updated/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('worker prepare and read still reject unsafe Windows traversal and drive-letter paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opc-win-unsafe-'))
  try {
    const evilZip = join(dir, 'evil.zip')
    await writeFile(evilZip, zipSync({
      '..\\evil.txt': strToU8('nope'),
    }))
    await assert.rejects(
      () => worker({
        action: 'prepare',
        root: join(dir, 'job-evil'),
        source: evilZip,
        slug: 'win-evil',
        url: 'https://win-evil.ai.benlai.com',
      }),
      /unsafe relative path/,
    )

    const driveZip = join(dir, 'drive.zip')
    await writeFile(driveZip, zipSync({
      'C:\\Windows\\win.ini': strToU8('nope'),
    }))
    await assert.rejects(
      () => worker({
        action: 'prepare',
        root: join(dir, 'job-drive'),
        source: driveZip,
        slug: 'win-drive',
        url: 'https://win-drive.ai.benlai.com',
      }),
      /unsafe relative path/,
    )

    const okZip = join(dir, 'ok.zip')
    await writeFile(okZip, zipSync({ 'Dockerfile': strToU8('FROM scratch\n') }))
    const root = join(dir, 'job-ok')
    await worker({
      action: 'prepare',
      root,
      source: okZip,
      slug: 'win-ok',
      url: 'https://win-ok.ai.benlai.com',
    })

    for (const badPath of ['..\\secret.txt', 'C:\\Windows\\win.ini', '\\etc\\passwd', './../secret.txt']) {
      await assert.rejects(
        () => worker({ action: 'read', root, path: badPath }),
        /unsafe relative path/,
      )
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
