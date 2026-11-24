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
  const { t } = useI18n()
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
      setExportError(t("apps.delete.currentPluginVersionDoesNotSupport"))
      setStage('export_error')
      return
    }
    setExportError('')
    setStage('exporting')
    try {
      const raw = await api.appCreateVolumeBackup(app.slug, contextId)
      const parsed = parseJson<{ backup?: AppVolumeBackupItem }>(raw, {})
      if (!parsed.backup?.id) {
        throw new Error(t("apps.delete.platformDidNotReturnAValid"))
      }
      setBackup(parsed.backup)
      setDownloadedPath('')
      setDownloadError('')
      setStage('download_gate')
    } catch (err) {
      setExportError(readErrorMessage(err, t("apps.delete.volumeExportFailed")))
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
      ? t("apps.delete.step13")
      : stage === 'exporting' || stage === 'export_error'
        ? t("apps.delete.step23")
        : stage === 'download_gate'
          ? t("apps.delete.step33")
          : t("apps.delete.deleting")

  return (
    <div className="oa-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("apps.delete.confirmAppDeletion")}>
      <div className="oa-modal-card">
        <div className="oa-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AppIcon name="warning" size={16} className="oa-text-danger" />
            <strong style={{ fontSize: 14, color: '#0f172a' }}>
              {stage === 'export_error'
                ? t("apps.delete.exportFailedDeletionBlocked")
                : stage === 'exporting'
                  ? t("apps.delete.exportingVolumes")
                  : stage === 'deleting'
                    ? t("apps.delete.deletingApp")
                    : t("apps.delete.confirmAppDeletion")}
            </strong>
            <span className="oa-pill">{stepLabel}</span>
          </div>
          {stage !== 'exporting' && stage !== 'deleting' && (
            <button type="button" className="oa-btn oa-btn-xs" onClick={onClose} aria-label={t("common.close")}>
              {t("common.close")}
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
                <span style={{ color: '#dc2626', fontSize: 12, fontWeight: 500 }}>{t("apps.delete.stopRemoveDomainUninstallSkill")}</span>
              </div>

              {hasMounts ? (
                <>
                  <div className="oa-table-box">
                    <div className="oa-table-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{t("apps.delete.volumes", { n: mounts.length, files: storageOverview ? t("apps.delete.files", { c: storageOverview.total_files }) : '' })}</span>
                      <span className="oa-mono">{storageOverview?.total_human || ''}</span>
                    </div>
                    {mounts.map(m => (
                      <div key={m.container_path} className="oa-table-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="oa-mono" style={{ fontWeight: 500 }}>{m.container_path}</span>
                        <span className="oa-hint">
                          {'file_count' in m && typeof m.file_count === 'number' ? t("apps.delete.files_2", { c: m.file_count }) : ''}
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
                          <strong style={{ color: '#0f172a' }}>{t("apps.delete.exportAndBackupVolumesBeforeDelete")}</strong>
                          <span className="oa-pill oa-pill-accent">{t("common.recommended")}</span>
                        </div>
                        <div className="oa-hint" style={{ marginTop: 2 }}>
                          {t("apps.delete.archiveToCloud30DaysAnd")}
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
                        <strong style={{ color: '#dc2626' }}>{t("apps.delete.deleteWithoutExporting")}</strong>
                        <div className="oa-hint" style={{ marginTop: 2 }}>
                          {t("apps.delete.permanentlyPurgeAllFilesInServer")}
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              ) : (
                <div className="oa-alert oa-alert-info">
                  <AppIcon name="warning" size={16} />
                  <div>{t("apps.delete.thisAppHasNoPersistentVolumes")}</div>
                </div>
              )}
            </>
          )}

          {stage === 'exporting' && (
            <div className="oa-subcard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px' }}>
              <AppIcon name="refresh" size={18} className="oa-spin" />
              <div>
                <strong style={{ color: '#0f172a' }}>{t("apps.delete.archivingServerVolumeFilesToCloud")}</strong>
                <div className="oa-hint" style={{ marginTop: 4 }}>{t("apps.delete.doNotCloseThisDialogThe")}</div>
              </div>
            </div>
          )}

          {stage === 'export_error' && (
            <div className="oa-alert oa-alert-danger">
              <AppIcon name="warning" size={16} />
              <div style={{ flex: 1 }}>
                <strong>{t("apps.delete.volumeExportFailedDeletionBlocked")}</strong>
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
                        {t("apps.delete.filesArchivedInCloudD", { size: backup.size_human, files: backup.file_count, days: backup.remain_days })}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`oa-btn oa-btn-sm ${downloadedPath ? '' : 'oa-btn-primary'}`}
                      disabled={downloading}
                      onClick={() => void handleDownloadLocal()}
                    >
                      <AppIcon name={downloading ? 'refresh' : 'download'} size={13} className={downloading ? 'oa-spin' : ''} />
                      <span>{downloading ? t("apps.delete.downloading") : downloadedPath ? t("apps.delete.downloadAgain") : t("apps.delete.downloadLocally")}</span>
                    </button>
                  </div>
                  {downloadedPath && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#059669', fontWeight: 500 }}>
                      {t("apps.delete.savedTo")}<span className="oa-mono">{downloadedPath}</span>
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
                  <div>{t("apps.delete.skippingExportAllFilesInServer")}</div>
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
                  {t("apps.delete.typeAppSlug")} <span className="oa-code">{app.slug}</span> {t("apps.delete.toConfirm")}
                  {!unlocked && <span style={{ color: '#d97706', marginLeft: 8, fontWeight: 400 }}>{t("apps.delete.downloadLocallyToUnlock")}</span>}
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
                <strong style={{ color: '#0f172a' }}>{t("apps.delete.stoppingServicePurgingVolumesAndRemoving")}</strong>
                <div className="oa-hint" style={{ marginTop: 4 }}>{t("apps.delete.pleaseWait")}</div>
              </div>
            </div>
          )}
        </div>

        <div className="oa-modal-foot">
          <span className="oa-hint">
            {stage === 'confirm' && hasMounts ? t("apps.delete.includesVolumeFilesOnlyExcludesExternal") : ''}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {stage === 'confirm' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{t("apps.delete.cancel")}</button>
                <button
                  type="button"
                  className={`oa-btn oa-btn-sm ${exportMode === 'export_and_delete' ? 'oa-btn-primary' : 'oa-btn-danger'}`}
                  onClick={handleConfirmNext}
                >
                  {exportMode === 'export_and_delete' ? t("apps.delete.exportAndBackup") : t("apps.delete.nextConfirm")}
                </button>
              </>
            )}
            {stage === 'export_error' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => setStage('confirm')}>{t("apps.delete.back")}</button>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{t("apps.delete.cancel")}</button>
                <button type="button" className="oa-btn oa-btn-sm oa-btn-primary" onClick={() => void runExport()}>
                  {t("apps.delete.retryExport")}
                </button>
              </>
            )}
            {stage === 'download_gate' && (
              <>
                <button type="button" className="oa-btn oa-btn-sm" onClick={() => setStage('confirm')}>{t("apps.delete.back")}</button>
                <button type="button" className="oa-btn oa-btn-sm" onClick={onClose}>{t("apps.delete.cancel")}</button>
                <button
                  type="button"
                  className="oa-btn oa-btn-sm oa-btn-danger"
                  disabled={!canDelete}
                  onClick={() => void handleExecuteDelete()}
                >
                  {t("apps.delete.deletePermanently")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
