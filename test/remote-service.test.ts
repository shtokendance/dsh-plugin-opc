import assert from 'node:assert/strict'
import test from 'node:test'
import { checkNpmPackageUpdate, pickSourceFolder, type ExecFileFn } from '../src/host/remote-service.ts'

test('pickSourceFolder uses PowerShell STA FolderBrowserDialog on win32', async () => {
  const calls: Array<{ file: string; args: string[]; options: { timeout: number; windowsHide?: boolean } }> = []
  const exec: ExecFileFn = async (file, args, options) => {
    calls.push({ file, args, options })
    return { stdout: 'C:\\Users\\demo\\项目源码\r\n' }
  }

  const result = await pickSourceFolder('win32', exec)

  assert.deepEqual(result, { path: 'C:\\Users\\demo\\项目源码' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'powershell.exe')
  assert.ok(calls[0].args.includes('-STA'))
  assert.equal(calls[0].options.windowsHide, true)
  const script = calls[0].args[calls[0].args.length - 1]
  assert.match(script, /OutputEncoding = \[System\.Text\.Encoding\]::UTF8/)
  assert.match(script, /FolderBrowserDialog/)
})

test('pickSourceFolder returns cancelled on win32 empty output and unsupported on missing powershell', async () => {
  const emptyExec: ExecFileFn = async () => ({ stdout: '   \r\n' })
  assert.deepEqual(await pickSourceFolder('win32', emptyExec), { cancelled: true })

  const missingExec: ExecFileFn = async () => {
    const err = new Error('spawn powershell.exe ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  }
  assert.deepEqual(await pickSourceFolder('win32', missingExec), { cancelled: true, unsupported: true })
})

test('pickSourceFolder strips trailing slashes on darwin and marks linux unsupported', async () => {
  const darwinExec: ExecFileFn = async () => ({ stdout: '/Users/demo/my-app/\n' })
  assert.deepEqual(await pickSourceFolder('darwin', darwinExec), { path: '/Users/demo/my-app' })

  const canceledExec: ExecFileFn = async () => { throw new Error('User canceled.') }
  assert.deepEqual(await pickSourceFolder('darwin', canceledExec), { cancelled: true })

  assert.deepEqual(await pickSourceFolder('linux', darwinExec), { cancelled: true, unsupported: true })
})

test('checkNpmPackageUpdate picks highest version across registries even when first mirror is stale', async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('npmmirror')) {
      return new Response(JSON.stringify({ version: '0.1.58' }), { status: 200 })
    }
    return new Response(JSON.stringify({ version: '0.1.59' }), { status: 200 })
  }

  const result = await checkNpmPackageUpdate('0.1.58', fetchMock, [
    'https://registry.npmmirror.com/dsh-plugin-opc/latest',
    'https://registry.npmjs.org/dsh-plugin-opc/latest',
  ])

  assert.deepEqual(result, {
    currentVersion: '0.1.58',
    latestVersion: '0.1.59',
    hasUpdate: true,
  })
})

test('checkNpmPackageUpdate still succeeds when one registry fails', async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('npmjs.org')) {
      throw new Error('timeout')
    }
    return new Response(JSON.stringify({ version: '0.1.59' }), { status: 200 })
  }

  const result = await checkNpmPackageUpdate('0.1.58', fetchMock, [
    'https://registry.npmmirror.com/dsh-plugin-opc/latest',
    'https://registry.npmjs.org/dsh-plugin-opc/latest',
  ])

  assert.deepEqual(result, {
    currentVersion: '0.1.58',
    latestVersion: '0.1.59',
    hasUpdate: true,
  })
})
