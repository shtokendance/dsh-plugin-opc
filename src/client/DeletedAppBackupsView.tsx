import React, { useMemo, useState } from 'react'
import { AppIcon } from './AppIcon.tsx'
import type { AppVolumeBackupItem, OpcApi } from './api.ts'
import { useI18n, type ClientLocale } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!error) return fallback
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error:\s*/i, '').trim() || fallback
}

function formatDateTime(raw?: string | null, locale: ClientLocale = 'zh'): string {
  if (!raw) return '-'
  const ts = Date.parse(raw)
  if (Number.isNaN(ts)) return raw
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ts)
  } catch {
    return raw
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
}

export function DeletedAppBackupsView({
  api,
  contextId,
  backups,
  loading,
  onBack,
  onRefresh,
}: {
  api: OpcApi
  contextId: string
  backups: AppVolumeBackupItem[]
  loading: boolean
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const { locale, tr } = useI18n()
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return backups
    return backups.filter(
      b =>
        b.app_name.toLowerCase().includes(q) ||
        b.app_slug.toLowerCase().includes(q) ||
        b.mounts.some(m => m.container_path.toLowerCase().includes(q))
    )
  }, [backups, query])

  const totalBytes = useMemo(() => backups.reduce((sum, b) => sum + (b.size_bytes || 0), 0), [backups])

  const handleDownload = async (bk: AppVolumeBackupItem) => {
    if (!api.appSaveVolumeBackupDownload) return
    setDownloadingId(bk.id)
    setErrorMsg(null)
    try {
      const raw = await api.appSaveVolumeBackupDownload(bk.id, bk.filename, contextId)
      const parsed = parseJson<{ path?: string }>(raw, {})
      setSavedPaths(prev => ({ ...prev, [bk.id]: parsed.path || bk.filename }))
    } catch (err) {
      setErrorMsg(readErrorMessage(err, tr('下载备份失败', 'Failed to download backup')))
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!api.appDeleteVolumeBackup) return
    setDeletingId(id)
    setErrorMsg(null)
    try {
      await api.appDeleteVolumeBackup(id, contextId)
      setConfirmDeleteId(null)
      await onRefresh()
    } catch (err) {
      setErrorMsg(readErrorMessage(err, tr('删除备份失败', 'Failed to delete backup')))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="oa-overlay-view">
      <div className="oa-overlay-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="oa-btn oa-btn-sm" onClick={onBack}>
            <AppIcon name="arrowLeft" size={13} />
            <span>{tr('返回应用中心', 'Back to Apps')}</span>
          </button>
          <strong style={{ fontSize: 15, color: '#0f172a' }}>{tr('已删除应用备份', 'Deleted App Backups')}</strong>
          <span className="oa-pill">{tr('{n} 份 · {size}', '{n} backups · {size}', { n: backups.length, size: formatBytes(totalBytes) })}</span>
          <span className="oa-pill">{tr('云端保留 30 天', 'Retained 30 days')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            className="oa-input"
            style={{ width: 210, padding: '5px 10px', fontSize: 12 }}
            placeholder={tr('搜索应用名、slug 或路径', 'Search app, slug, or path')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button type="button" className="oa-btn oa-btn-sm" disabled={loading} onClick={() => void onRefresh()}>
            <AppIcon name="refresh" size={13} className={loading ? 'oa-spin' : ''} />
            <span>{tr('刷新', 'Refresh')}</span>
          </button>
        </div>
      </div>

      <div className="oa-overlay-body">
        <NoticeModal
          open={Boolean(errorMsg)}
          variant="error"
          message={errorMsg || ''}
          onClose={() => setErrorMsg(null)}
        />

        {filtered.length === 0 ? (
          <div className="oa-form-card" style={{ textAlign: 'center', padding: '44px 20px', color: '#64748b' }}>
            {backups.length === 0 ? tr('暂无已删除应用的挂载卷备份', 'No deleted app volume backups') : tr('没有匹配的备份记录', 'No matching backups')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(bk => {
              const expanded = expandedId === bk.id
              const confirming = confirmDeleteId === bk.id
              const isDl = downloadingId === bk.id
              const isDel = deletingId === bk.id
              const savedPath = savedPaths[bk.id]

              return (
                <div key={bk.id} className="oa-form-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : bk.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flex: 1,
                        minWidth: 240,
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'inherit',
                      }}
                    >
                      <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{bk.app_name}</strong>
                          <span className="oa-code">{bk.app_slug}</span>
                          {bk.app_version > 0 && <span className="oa-hint">v{bk.app_version}</span>}
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{bk.size_human}</span>
                          <span className="oa-hint">{tr('({n} 文件)', '({n} files)', { n: bk.file_count })}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {bk.mounts.map(m => (
                            <span key={m.container_path} className="oa-code">{m.container_path}</span>
                          ))}
                          <span className="oa-hint">{tr('归档于 {time}', 'Archived {time}', { time: formatDateTime(bk.created_at, locale) })}</span>
                          <span className="oa-hint" style={bk.remain_days <= 10 ? { color: '#d97706', fontWeight: 500 } : undefined}>
                            {tr('· 剩余 {days} 天', '· {days}d left', { days: bk.remain_days })}
                          </span>
                        </div>
                      </div>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {confirming ? (
                        <>
                          <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 500 }}>{tr('永久删除云端归档？', 'Delete cloud archive?')}</span>
                          <button
                            type="button"
                            className="oa-btn oa-btn-xs oa-btn-danger"
                            disabled={isDel}
                            onClick={() => void handleDelete(bk.id)}
                          >
                            {isDel ? tr('删除中…', 'Deleting…') : tr('确认删除', 'Confirm')}
                          </button>
                          <button type="button" className="oa-btn oa-btn-xs" onClick={() => setConfirmDeleteId(null)}>
                            {tr('取消', 'Cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="oa-btn oa-btn-sm oa-btn-primary"
                            disabled={isDl}
                            onClick={() => void handleDownload(bk)}
                          >
                            <AppIcon name={isDl ? 'refresh' : 'download'} size={13} className={isDl ? 'oa-spin' : ''} />
                            <span>{isDl ? tr('下载中…', 'Downloading…') : tr('下载备份', 'Download')}</span>
                          </button>
                          <button
                            type="button"
                            className="oa-btn oa-btn-sm oa-btn-danger"
                            onClick={() => setConfirmDeleteId(bk.id)}
                          >
                            {tr('删除', 'Delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {savedPath && (
                    <div style={{ padding: '8px 16px', borderTop: '1px solid #e2e8f0', background: '#ecfdf5', color: '#059669', fontSize: 12 }}>
                      {tr('已保存到本地：', 'Saved to: ')}<span className="oa-mono">{savedPath}</span>
                    </div>
                  )}

                  {expanded && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="oa-table-box">
                        <div className="oa-storage-table-head">
                          <span>{tr('原容器挂载路径', 'Container Path')}</span>
                          <span>{tr('压缩包内目录', 'Archive Directory')}</span>
                          <span style={{ textAlign: 'right' }}>{tr('文件数', 'Files')}</span>
                          <span style={{ textAlign: 'right' }}>{tr('占用大小', 'Size')}</span>
                        </div>
                        {bk.mounts.map(m => (
                          <div key={m.container_path} className="oa-storage-table-row">
                            <span className="oa-mono" style={{ fontWeight: 500 }}>{m.container_path}</span>
                            <span className="oa-mono oa-hint">{m.archive_path}</span>
                            <span style={{ textAlign: 'right' }}>{m.file_count}</span>
                            <span style={{ textAlign: 'right', fontWeight: 500 }}>{m.size_human}</span>
                          </div>
                        ))}
                      </div>
                      <div className="oa-hint" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <span>{tr('归档文件：', 'Archive: ')}<span className="oa-code">{bk.filename}</span></span>
                        {bk.sha256 && <span>SHA-256：<span className="oa-code">{bk.sha256.slice(0, 16)}…</span></span>}
                        <span>{tr('到期：{time}', 'Expires: {time}', { time: formatDateTime(bk.expires_at, locale) })}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
