import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AppDelivery } from '../src/host/app-delivery.ts'
import { ContextStore } from '../src/host/context.ts'
import type { OpcCore } from '../src/host/core.ts'

test('AppDelivery volume backup creation, download, listing, deletion, and app delete gate', async () => {
  const home = await mkdtemp(join(tmpdir(), 'opc-del-bk-'))
  const downloads = join(home, 'downloads')
  const contexts = new ContextStore()
  contexts.replace({ issuer: 'https://example.test', subject: 'alice', tenant: 'one', spaces: ['one'], generation: 1 })
  const expected = contexts.applicationContextId!
  const calls: string[] = []
  let blockDelete = true

  const server = createServer((req, res) => {
    const url = req.url || ''
    calls.push(`${req.method} ${url}`)
    if (req.method === 'POST' && url === '/integration/v1/apps/audit-app/storage/backups') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        backup: {
          id: 'bk-1',
          app_slug: 'audit-app',
          app_name: 'Audit App',
          filename: 'audit-app-volumes-20261124.tar.gz',
          size_bytes: 11,
          size_human: '11 B',
          file_count: 2,
          downloaded: false,
          remain_days: 30,
          mounts: [{ container_path: '/app/data', archive_path: 'volumes/app/data/', file_count: 2, size_bytes: 11, size_human: '11 B' }],
        },
      }))
      return
    }
    if (req.method === 'GET' && url === '/integration/v1/apps/backups') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ backups: [{ id: 'bk-1', app_slug: 'audit-app', app_name: 'Audit App' }] }))
      return
    }
    if (req.method === 'GET' && url === '/integration/v1/apps/backups/bk-1/download') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' })
      res.end(Buffer.from('tar-gz-data'))
      return
    }
    if (req.method === 'DELETE' && url === '/integration/v1/apps/backups/bk-1') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ deleted: true }))
      return
    }
    if (req.method === 'DELETE' && url.startsWith('/integration/v1/apps/audit-app')) {
      if (blockDelete) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 'BACKUP_NOT_DOWNLOADED', message: '请先下载备份' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 0, slug: 'audit-app' }))
      return
    }
    res.writeHead(404).end('{}')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const baseUrl = `http://127.0.0.1:${address.port}`

  const core = Object.assign(new EventEmitter(), {
    auth: {
      contexts,
      http: { base: new URL(baseUrl) },
      async token() { return 'test-token' },
      async request(path: string, init?: RequestInit) {
        return fetch(baseUrl + path, init)
      },
      async requestJson(path: string, init?: RequestInit) {
        const resp = await fetch(baseUrl + path, init)
        const text = await resp.text()
        const data = text ? JSON.parse(text) : {}
        if (!resp.ok) {
          throw new Error(data?.error?.message || `HTTP ${resp.status}`)
        }
        return data
      },
    },
  }) as unknown as OpcCore

  const delivery = new AppDelivery(core, home, { async read() { return {} }, async write() {} })

  try {
    await assert.rejects(() => delivery.createVolumeBackup('Invalid_Slug', expected), /无效应用标识/)

    const created = await delivery.createVolumeBackup('audit-app', expected)
    assert.equal(created.backup.id, 'bk-1')

    await assert.rejects(
      () => delivery.deleteApp('audit-app', { purgeVolumes: true, exportMode: 'export_and_delete', backupId: 'bk-1' }, expected),
      /请先下载备份/
    )

    const saved = await delivery.saveVolumeBackupDownload('bk-1', 'audit-app-volumes-20261124.tar.gz', expected, downloads)
    assert.equal(await readFile(saved.path, 'utf8'), 'tar-gz-data')

    blockDelete = false
    const deleted = await delivery.deleteApp('audit-app', { purgeVolumes: true, exportMode: 'export_and_delete', backupId: 'bk-1' }, expected)
    assert.equal(deleted.slug, 'audit-app')

    const list = await delivery.listVolumeBackups(expected)
    assert.equal(list.backups.length, 1)

    const delBk = await delivery.deleteVolumeBackup('bk-1', expected)
    assert.equal(delBk.deleted, true)
    assert.ok(calls.includes('DELETE /integration/v1/apps/audit-app?purge_volumes=true&export_mode=export_and_delete&backup_id=bk-1'))
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(home, { recursive: true, force: true })
  }
})
