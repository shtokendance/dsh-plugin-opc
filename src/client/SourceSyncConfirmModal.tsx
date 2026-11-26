import React, { useEffect, useMemo, useState } from 'react'
import { AppIcon } from './AppIcon.tsx'

export interface SourceSyncChangeItem {
  id?: string
  path: string
  reason: string
  group?: string
  diff?: string
}

export interface SourceSyncConfirmModalProps {
  open: boolean
  sourcePath: string
  changes: SourceSyncChangeItem[]
  addedPaths: ReadonlySet<string>
  conflicts: string[]
  syncing: boolean
  error?: string
  onCancel: () => void
  onConfirm: (forceOverwrite: boolean) => void
}

function renderDiffLines(diff: string) {
  const lines = diff.split(/\r?\n/)
  return lines.map((line, idx) => {
    const isAdd = line.startsWith('+') && !line.startsWith('+++')
    const isDel = line.startsWith('-') && !line.startsWith('---')
    const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')
    const style: React.CSSProperties = isAdd
      ? { color: '#86efac', background: 'rgba(34, 197, 94, 0.16)', display: 'block', padding: '0 4px' }
      : isDel
        ? { color: '#fca5a5', background: 'rgba(239, 68, 68, 0.16)', display: 'block', padding: '0 4px' }
        : isHeader
          ? { color: '#93c5fd', display: 'block', padding: '0 4px' }
          : { color: '#cbd5e1', display: 'block', padding: '0 4px' }
    return (
      <span key={idx} style={{ ...style, whiteSpace: 'pre' }}>
        {line || ' '}
      </span>
    )
  })
}

export function SourceSyncConfirmModal({
  open,
  sourcePath,
  changes,
  addedPaths,
  conflicts,
  syncing,
  error,
  onCancel,
  onConfirm,
}: SourceSyncConfirmModalProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const conflictSet = useMemo(() => new Set(conflicts), [conflicts])
  const hasConflict = conflicts.length > 0

  useEffect(() => {
    if (!open) return
    const initial: Record<string, boolean> = {}
    if (conflicts.length > 0) {
      for (const path of conflicts) initial[path] = true
    } else if (changes.length === 1 && changes[0]) {
      initial[changes[0].path] = true
    }
    setExpanded(initial)
  }, [open, conflicts, changes])

  useEffect(() => {
    if (!open || syncing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, syncing, onCancel])

  if (!open) return null

  const addedCount = changes.filter(item => addedPaths.has(item.path)).length
  const modifiedCount = changes.length - addedCount

  const toggle = (path: string) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }))
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={hasConflict ? '本机源码存在外部修改冲突' : '确认同步改造至本机源码'}
      onClick={event => {
        if (!syncing && event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            padding: '16px 20px 14px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: hasConflict ? '#fef2f2' : '#eff6ff',
              color: hasConflict ? '#dc2626' : '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AppIcon name={hasConflict ? 'warning' : 'sparkle'} size={17} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
              {hasConflict
                ? '本机源码存在外部修改冲突，请确认处理方式'
                : 'AI 已改造以下应用文件，确认同步至本机源码？'}
            </h3>
            <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
              为避免线上部署与本地源码脱节，进入第 3 步前会将本次改造同步写回你的项目目录，再复制定版快照打包上传。
            </p>
          </div>
        </div>

        <div
          style={{
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <span style={{ color: '#64748b', flexShrink: 0 }}>目标本机目录：</span>
            <span className="oa-mono" style={{ color: '#0f172a', fontWeight: 500, wordBreak: 'break-all' }}>
              {sourcePath}
            </span>
          </div>

          {hasConflict && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                color: '#991b1b',
                fontSize: 12.5,
                lineHeight: 1.55,
              }}
            >
              <strong>检测到本机文件在分析期间被修改：</strong>
              <span className="oa-mono">{conflicts.join('、')}</span>。为避免误覆盖你的新改动，已暂停自动写入；请核对后选择覆盖继续，或返回重新分析。
            </div>
          )}

          {error && !hasConflict && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                color: '#991b1b',
                fontSize: 12.5,
                wordBreak: 'break-word',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12.5,
              fontWeight: 600,
              color: '#334155',
            }}
          >
            <span>本次 AI 改造清单（共 {changes.length} 个文件）</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {addedCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: '#dcfce7', color: '#166534' }}>
                  新增 {addedCount}
                </span>
              )}
              {modifiedCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8' }}>
                  修改 {modifiedCount}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {changes.map(item => {
              const isAdded = addedPaths.has(item.path)
              const isConflict = conflictSet.has(item.path)
              const isOpen = Boolean(expanded[item.path])
              const hasDiff = Boolean(item.diff && item.diff.trim())
              return (
                <div
                  key={item.id || item.path}
                  style={{
                    border: `1px solid ${isConflict ? '#fca5a5' : '#e2e8f0'}`,
                    borderRadius: 9,
                    overflow: 'hidden',
                    background: '#ffffff',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => hasDiff && toggle(item.path)}
                    onKeyDown={e => {
                      if (hasDiff && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        toggle(item.path)
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      cursor: hasDiff ? 'pointer' : 'default',
                      userSelect: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 999,
                          flexShrink: 0,
                          background: isAdded ? '#dcfce7' : '#dbeafe',
                          color: isAdded ? '#166534' : '#1d4ed8',
                        }}
                      >
                        {isAdded ? '新增' : '修改'}
                      </span>
                      {isConflict && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 999,
                            flexShrink: 0,
                            background: '#fee2e2',
                            color: '#b91c1c',
                          }}
                        >
                          冲突
                        </span>
                      )}
                      <span className="oa-mono" style={{ fontWeight: 600, fontSize: 12.5, color: '#0f172a', flexShrink: 0 }}>
                        {item.path}
                      </span>
                      {item.reason && (
                        <span
                          style={{
                            color: '#64748b',
                            fontSize: 12,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={item.reason}
                        >
                          · {item.reason}
                        </span>
                      )}
                    </div>
                    {hasDiff && (
                      <span style={{ fontSize: 11.5, color: '#2563eb', flexShrink: 0, fontWeight: 500 }}>
                        {isOpen ? '收起 Diff ▴' : '查看 Diff ▾'}
                      </span>
                    )}
                  </div>
                  {hasDiff && isOpen && (
                    <div
                      className="oa-mono"
                      style={{
                        borderTop: '1px solid #e2e8f0',
                        background: '#0f172a',
                        color: '#e2e8f0',
                        padding: '10px 12px',
                        fontSize: 11.5,
                        maxHeight: 220,
                        overflow: 'auto',
                        lineHeight: 1.55,
                      }}
                    >
                      {renderDiffLines(item.diff!)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '9px 12px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 8,
              fontSize: 12,
              color: '#166534',
              lineHeight: 1.5,
            }}
          >
            <AppIcon name="check" size={14} />
            <span>
              同步前会自动备份被修改的原文件，进入第 3 步后仍支持一键「撤销本次写入」；OPC 平台元数据（如{' '}
              <code className="oa-mono">delivery.json</code>）不会写入你的源码目录。
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button type="button" className="oa-btn" disabled={syncing} onClick={onCancel}>
            返回第 2 步继续调整
          </button>
          <button
            type="button"
            className={`oa-btn ${hasConflict ? 'oa-btn-danger' : 'oa-btn-primary'}`}
            disabled={syncing}
            onClick={() => onConfirm(hasConflict)}
          >
            {syncing
              ? '正在同步并打包…'
              : hasConflict
                ? '覆盖本地冲突文件并继续'
                : '确认同步并进入第 3 步'}
          </button>
        </div>
      </div>
    </div>
  )
}
