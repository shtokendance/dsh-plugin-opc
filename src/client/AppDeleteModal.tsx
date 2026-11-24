import React, { useEffect, useState } from 'react'
import { AppIcon } from './AppIcon.tsx'
import { useI18n } from './i18n.tsx'
import type {
  AppStorageOverview,
  AppVolumeBackupItem,
  DeployedApp,
  OpcApi,
} from './api.ts'

type DeleteStage = 'confirm' | 'exporting' | 'export_error' | 'download_gate' | 'deleting'
type ExportMode = 'export_and_delete' | 'skip_export' | 'no_volumes'

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
  const cleaned = raw.replace(/^Error:\s*/i, '').trim()
  if (!cleaned) return fallback
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(cleaned.slice(jsonStart)) as {
        detail?: unknown
        error?: { message?: unknown } | unknown
        message?: unknown
      }
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail.trim()
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
      if (parsed.error && typeof parsed.error === 'object' && typeof (parsed.error as { message?: unknown }).message === 'string') {
        return String((parsed.error as { message: string }).message).trim()
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    } catch {
      return cleaned
    }
  }
  return cleaned
}

export function AppDeleteModal({
  api,
  contextId,
  app,
  storageOverview,
  onClose,
  onDeleted,
}: {
  api: OpcApi
  contextId: string
  app: DeployedApp
  storageOverview: AppStorageOverview | null
  onClose: () => void
  onDeleted: (info: { slug: string; name: string; backup?: AppVolumeBackupItem | null }) => void
}) {
  const { tr } = useI18n()
  const mounts = storageOverview?.mounts ?? app.storage_mounts ?? []
  const hasMounts = mounts.length > 0

  const [stage, setStage] = useState<DeleteStage>('confirm')
  const [exportMode, setExportMode] = useState<ExportMode>(hasMounts ? 'export_and_delete' : 'no_volumes')
  const [backup, setBackup] = useState<AppVolumeBackupItem | null>(null)
  const [exportError, setExportError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadedPath, setDownloadedPath] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [confirmSlug, setConfirmSlug] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    setExportMode(hasMounts ? 'export_and_delete' : 'no_volumes')
  }, [hasMounts])

  const runExport = async () => {
    if (!api.appCreateVolumeBackup) {
      setExportError(tr('当前插件版本不支持挂载卷云端导出，请更新插件', 'Current plugin version does not support volume export'))
      setStage('export_error')
      return
    }
    setExportError('')
    setStage('exporting')
    try {
      const raw = await api.appCreateVolumeBackup(app.slug, contextId)
      const parsed = parseJson<{ backup?: AppVolumeBackupItem }>(raw, {})
      if (!parsed.backup?.id) {
        throw new Error(tr('平台未返回有效的备份记录', 'Platform did not return a valid backup record'))
      }
      setBackup(parsed.backup)
      setDownloadedPath('')
      setDownloadError('')
      setStage('download_gate')
    } catch (err) {
      setExportError(readErrorMessage(err, tr('挂载卷导出失败', 'Volume export failed')))
      setStage('export_error')
    }
  }

  const handleConfirmNext = () => {
    if (!hasMounts) {
      setExportMode('no_volumes')
      setStage('download_gate')
      return
    }
    if (exportMode === 'export_and_delete') {
      void runExport()
    } else {
      setStage('download_gate')
    }
  }

  const handleDownloadLocal = async () => {
    if (!backup || !api.appSaveVolumeBackupDownload) return
    setDownloading(true)
    setDownloadError('')
    try {
      const raw = await api.appSaveVolumeBackupDownload(backup.id, backup.filename, contextId)
      const parsed = parseJson<{ path?: string }>(raw, {})
      setDownloadedPath(parsed.path || backup.filename)
      setBackup(prev => (prev ? { ...prev, downloaded: true } : prev))
    } catch (err) {
      setDownloadError(readErrorMessage(err, '下载备份到本地失败'))
    } finally {
      setDownloading(false)
    }
  }

  const handleExecuteDelete = async () => {
    setDeleteError('')
    setStage('deleting')
    try {
      if (api.appDeleteWithOptions) {
        await api.appDeleteWithOptions(
          app.slug,
          JSON.stringify({
            purgeVolumes: true,
            exportMode: hasMounts ? exportMode : 'no_volumes',
            backupId: exportMode === 'export_and_delete' ? backup?.id : undefined,
          }),
          contextId
        )
      } else {
        throw new Error('当前插件版本不支持应用删除接口')
      }
      onDeleted({
        slug: app.slug,
        name: app.name,
        backup: exportMode === 'export_and_delete' ? backup : null,
      })
    } catch (err) {
      setDeleteError(readErrorMessage(err, '删除应用失败'))
      setStage('download_gate')
    }
  }

  const unlocked = !hasMounts || exportMode === 'skip_export' || Boolean(downloadedPath || backup?.downloaded)
  const slugMatched = confirmSlug.trim() === app.slug
  const canDelete = unlocked && slugMatched && stage === 'download_gate'

  const stepLabel =
    stage === 'confirm'
      ? tr('步骤 1 / 3', 'Step 1 / 3')
      : stage === 'exporting' || stage === 'export_error'
        ? tr('步骤 2 / 3', 'Step 2 / 3')
        : stage === 'download_gate'
          ? tr('步骤 3 / 3', 'Step 3 / 3')
          : tr('执行中', 'Deleting')

  return (
    <div className="oa-modal-backdrop" role="dialog" aria-modal="true" aria-label={tr('删除应用确认', 'Confirm App Deletion')}>
      <div className="oa-modal-card">
        <div className="oa-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AppIcon name="warning" size={16} className="oa-text-danger" />
            <strong style={{ fontSize: 14, color: '#0f172a' }}>
              {stage === 'export_error'
                ? tr('导出失败 · 已阻断删除', 'Export Failed · Deletion Blocked')
                : stage === 'exporting'
                  ? tr('正在导出挂载卷', 'Exporting Volumes')
                  : stage === 'deleting'
                    ? tr('正在删除应用', 'Deleting App')
                    : tr('删除应用确认', 'Confirm App Deletion')}
            </strong>
            <span className="oa-pill">{stepLabel}</span>
          </div>
          {stage !== 'exporting' && stage !== 'deleting' && (
            <button type="button" className="oa-btn oa-btn-xs" onClick={onClose} aria-label={tr('关闭', 'Close')}>
              {tr('关闭', 'Close')}
            </button>
          )}
        </div>

        <div className="oa-modal-body">
          {stage === 'confirm' && (
            <>
              <div className="oa-subcard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#0f172a' }}>{app.name}</strong>
                  <span className="oa-code">{app.slug}</span>
                  {app.current_version ? <span className="oa-pill oa-pill-accent">v{app.current_version}</span> : null}
                </div>
                <span style={{ color: '#dc2626', fontSize: 12, fontWeight: 500 }}>{tr('停服 · 删域名 · 卸技能', 'Stop · Remove Domain · Uninstall Skill')}</span>
              </div>

              {hasMounts ? (
                <>
                  <div className="oa-table-box">
                    <div className="oa-table-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{tr('待处理挂载卷（{n} 个{files}）', 'Volumes ({n}{files})', { n: mounts.length, files: storageOverview ? tr(' · 共 {c} 个文件', ' · {c} files', { c: storageOverview.total_files }) : '' })}</span>
                      <span className="oa-mono">{storageOverview?.total_human || ''}</span>
                    </div>
                    {mounts.map(m => (
                      <div key={m.container_path} className="oa-table-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="oa-mono" style={{ fontWeight: 500 }}>{m.container_path}</span>
                        <span className="oa-hint">
                          {'file_count' in m && typeof m.file_count === 'number' ? tr('{c} 文件 · ', '{c} files · ', { c: m.file_count }) : ''}
                          {'size_human' in m && m.size_human ? m.size_human : ''}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label
                      className={`oa-radio-card ${exportMode === 'export_and_delete' ? 'selected' : ''}`}
                      onClick={() => setExportMode('export_and_delete')}
                    >
                      <input
                        type="radio"
                        name="oa-export-mode"
                        checked={exportMode === 'export_and_delete'}
                        onChange={() => setExportMode('export_and_delete')}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ color: '#0f172a' }}>{tr('导出全部挂载卷并备份后删除', 'Export & Backup Volumes Before Delete')}</strong>
                          <span className="oa-pill oa-pill-accent">{tr('推荐', 'Recommended')}</span>
                        </div>
                        <div className="oa-hint" style={{ marginTop: 2 }}>
                          {tr('按原路径打包归档至云端（保留 30 天）并下载到本地，下载完成后解锁删除', 'Archive to cloud (30 days) and download locally before unlocking deletion')}
                        </div>
                      </div>
                    </label>

                    <label
                      className={`oa-radio-card danger ${exportMode === 'skip_export' ? 'selected' : ''}`}
                      onClick={() => setExportMode('skip_export')}
                    >
                      <input
                        type="radio"
                        name="oa-export-mode"
                        checked={exportMode === 'skip_export'}
                        onChange={() => setExportMode('skip_export')}
                      />
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: '#dc2626' }}>{tr('不导出，直接彻底删除', 'Delete Without Exporting')}</strong>
                        <div className="oa-hint" style={{ marginTop: 2 }}>
                          {tr('同步清理服务器挂载卷内全部文件，删除后无法恢复', 'Permanently purge all files in server volumes; cannot be undone')}
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              ) : (
                <div className="oa-alert oa-alert-info">
                  <AppIcon name="warning" size={16} />
                  <div>{tr('该应用未配置持久化挂载卷，确认应用标识后即可直接删除。', 'This app has no persistent volumes. Confirm the slug to delete.')}</div>
                </div>
              )}
            </>
          )}

          {stage === 'exporting' && (
            <div className="oa-subcard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px' }}>
              <AppIcon name="refresh" size={18} className="oa-spin" />
              <div>
                <strong style={{ color: '#0f172a' }}>{tr('正在按路径打包服务器挂载卷并归档至云端对象存储…', 'Archiving server volume files to cloud storage…')}</strong>
                <div className="oa-hint" style={{ marginTop: 4 }}>{tr('请勿关闭窗口，导出完成前不会删除应用。', 'Do not close this dialog; the app will not be deleted until export completes.')}</div>
              </div>
            </div>
          )}

          {stage === 'export_error' && (
            <div className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>
                <strong>{tr('挂载卷导出失败，已阻断删除操作', 'Volume export failed; deletion blocked')}</strong>
                <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{exportError}</div>
              </div>
            </div>
          )}

          {stage === 'download_gate' && (
            <>
              {exportMode === 'export_and_delete' && backup && (
                <div className="oa-subcard" style={{ borderColor: downloadedPath ? '#a7f3d0' : '#bfdbfe', background: downloadedPath ? '#ecfdf5' : '#eff6ff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="oa-mono" style={{ fontWeight: 600, color: '#0f172a' }}>{backup.filename}</div>
                      <div className="oa-hint" style={{ marginTop: 2 }}>
                        {tr('{size} · {files} 个文件 · 已归档至云端（保留 {days} 天）', '{size} · {files} files · Archived in cloud ({days}d)', { size: backup.size_human, files: backup.file_count, days: backup.remain_days })}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`oa-btn oa-btn-sm ${downloadedPath ? '' : 'oa-btn-primary'}`}
                      disabled={downloading}
                      onClick={() => void handleDownloadLocal()}
                    >
                      <AppIcon name={downloading ? 'refresh' : 'download'} size={13} className={downloading ? 'oa-spin' : ''} />
                      <span>{downloading ? tr('下载中…', 'Downloading…') : downloadedPath ? tr('重新下载', 'Download Again') : tr('下载到本地', 'Download Locally')}</span>
                    </button>
                  </div>
                  {downloadedPath && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#059669', fontWeight: 500 }}>
                      {tr('已保存至：', 'Saved to: ')}<span className="oa-mono">{downloadedPath}</span>
                    </div>
                  )}
                  {downloadError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{downloadError}</div>
                  )}
                </div>
              )}

              {exportMode === 'skip_export' && (
                <div className="oa-alert oa-alert-danger">
                  <AppIcon name="warning" size={16} />
                  <div>{tr('已选择不导出挂载卷，删除后服务器挂载卷内全部文件将被永久清除。', 'Skipping export: all files in server volumes will be permanently deleted.')}</div>
                </div>
              )}

              {deleteError && (
                <div className="oa-alert oa-alert-danger">
                  <AppIcon name="warning" size={16} />
                  <div>{deleteError}</div>
                </div>
              )}

              <div style={{ opacity: unlocked ? 1 : 0.45 }}>
                <label htmlFor="oa-delete-slug-input" style={{ display: 'block', fontWeight: 500, marginBottom: 6, color: '#0f172a' }}>
                  {tr('输入应用标识', 'Type app slug')} <span className="oa-code">{app.slug}</span> {tr('确认删除', 'to confirm')}
                  {!unlocked && <span style={{ color: '#d97706', marginLeft: 8, fontWeight: 400 }}>{tr('（请先完成本地下载以解锁）', '(Download locally to unlock)')}</span>}
                </label>
                <input
                  id="oa-delete-slug-input"
                  type="text"
                  className="oa-input oa-mono"
                  placeholder={app.slug}
                  value={confirmSlug}
                  disabled={!unlocked}
                  onChange={e => setConfirmSlug(e.target.value)}
                />
              </div>
            </>
          )}

          {stage === 'deleting' && (
            <div className="oa-subcard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px' }}>
              <AppIcon name="refresh" size={18} className="oa-spin" />
              <div>
                <strong style={{ color: '#0f172a' }}>{tr('正在下线服务、清理服务器挂载目录与本地技能…', 'Stopping service, purging volumes, and removing local skill…')}</strong>
                <div className="oa-hint" style={{ marginTop: 4 }}>{tr('请稍候，完成后将返回应用列表。', 'Please wait...')}</div>
              </div>
            </div>
          )}
        </div>

        <div className="oa-modal-foot">
          <span className="oa-hint">
            {stage === 'confirm' && hasMounts ? tr('仅包含容器挂载卷文件，不含外部共享数据库', 'Includes volume files only; excludes external shared databases') : ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stage === 'confirm' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{tr('取消', 'Cancel')}</button>
                <button
                  type="button"
                  className={`oa-btn oa-btn-sm ${exportMode === 'export_and_delete' ? 'oa-btn-primary' : 'oa-btn-danger'}`}
                  onClick={handleConfirmNext}
                >
                  {exportMode === 'export_and_delete' ? tr('开始打包并备份', 'Export & Backup') : tr('下一步：输入确认', 'Next: Confirm')}
                </button>
              </>
            )}
            {stage === 'export_error' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => setStage('confirm')}>{tr('返回上一步', 'Back')}</button>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{tr('取消', 'Cancel')}</button>
                <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => void runExport()}>
                  {tr('重试导出', 'Retry Export')}
                </button>
              </>
            )}
            {stage === 'download_gate' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => setStage('confirm')}>{tr('返回上一步', 'Back')}</button>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{tr('取消', 'Cancel')}</button>
                <button
                  type="button"
                  className="oa-btn oa-btn-sm oa-btn-danger"
                  disabled={!canDelete}
                  onClick={() => void handleExecuteDelete()}
                >
                  {tr('确认彻底删除', 'Delete Permanently')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
