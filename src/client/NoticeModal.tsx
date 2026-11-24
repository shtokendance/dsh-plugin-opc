import React, { useEffect } from 'react'
import { AppIcon } from './AppIcon.tsx'
import { useI18n } from './i18n.tsx'

export function NoticeModal({
  open,
  variant = 'error',
  title,
  message,
  onClose,
  actions,
}: {
  open: boolean
  variant?: 'error' | 'warning' | 'info'
  title?: string
  message: string
  onClose: () => void
  actions?: React.ReactNode
}) {
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !message) return null

  const defaultTitle =
    variant === 'warning'
      ? t("common.notice.warning")
      : variant === 'info'
        ? t("common.notice.notice")
        : t("common.notice.error")

  const accentColor =
    variant === 'warning' ? '#d97706' : variant === 'info' ? '#2563eb' : '#dc2626'

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
      aria-label={title || defaultTitle}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '13px 16px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: accentColor, display: 'inline-flex' }}>
              <AppIcon name="warning" size={16} />
            </span>
            <strong style={{ fontSize: 14, color: '#0f172a' }}>{title || defaultTitle}</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t("common.close")}
          </button>
        </div>

        <div
          style={{
            padding: '16px',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#334155',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '55vh',
            overflowY: 'auto',
          }}
        >
          {message}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '11px 16px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          {actions}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #2563eb',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  )
}
