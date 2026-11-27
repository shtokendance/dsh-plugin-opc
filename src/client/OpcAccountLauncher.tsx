import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AuthState, OpcApi } from './api.ts'
import { getActiveClientLocale, translate } from './i18n.tsx'

export interface OpcAccountLauncherProps {
  api: OpcApi
  wide: boolean
  settingsOpen?: boolean
  settingsShortcut?: { readonly keys: readonly string[]; readonly aria?: string | undefined }
  openSettings: (sectionId?: string) => void
}

const LAUNCHER_STYLES = `
.opc-launcher-root { position: relative; width: 100%; }
.opc-launcher-trigger {
  width: 100%; height: 36px; border: 0; border-radius: 10px; background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328); font-size: 13.5px; font-weight: 500;
  display: flex; align-items: center; gap: 10px; padding: 0 10px; cursor: pointer;
  transition: background-color 0.14s ease;
}
.opc-launcher-trigger:hover { background: var(--dsw-alias-state-hover, rgba(15, 23, 42, 0.06)); }
.opc-launcher-trigger[data-collapsed='true'] { width: 36px; padding: 0; justify-content: center; margin: 0 auto; }
.opc-launcher-avatar {
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #fff;
  font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
}
.opc-launcher-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.opc-launcher-menu {
  position: fixed; z-index: 9999; min-width: 196px; padding: 6px;
  border-radius: 12px; background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.1));
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
  display: flex; flex-direction: column; gap: 2px;
}
.opc-launcher-menu-header {
  padding: 6px 10px 8px; margin-bottom: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.08));
}
.opc-launcher-menu-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f172a); }
.opc-launcher-menu-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #64748b); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
.opc-launcher-item {
  width: 100%; border: 0; border-radius: 8px; background: transparent; padding: 8px 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 13px; color: var(--dsw-alias-label-primary, #1f2328); cursor: pointer; text-align: left;
}
.opc-launcher-item:hover:not(:disabled) { background: var(--dsw-alias-state-hover, rgba(15, 23, 42, 0.06)); }
.opc-launcher-item:disabled { opacity: 0.5; cursor: not-allowed; }
.opc-launcher-item-left { display: inline-flex; align-items: center; gap: 8px; }
.opc-launcher-item-danger { color: #dc2626; }
.opc-launcher-shortcut { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #94a3b8); }
.opc-launcher-modal-backdrop {
  position: fixed; inset: 0; z-index: 10000; background: rgba(15, 23, 42, 0.36);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.opc-launcher-modal {
  width: 100%; max-width: 380px; border-radius: 16px; padding: 22px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary, #0f172a);
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.1));
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.22);
}
.opc-launcher-modal h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.opc-launcher-modal p { margin: 0 0 16px; font-size: 13px; color: var(--dsw-alias-label-secondary, #64748b); line-height: 1.5; }
.opc-launcher-modal-error {
  margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px;
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
}
.opc-launcher-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.opc-launcher-btn {
  height: 34px; padding: 0 14px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, #d0d7de); background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.opc-launcher-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
`

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export function OpcAccountLauncher({ api, wide, settingsShortcut, openSettings }: OpcAccountLauncherProps) {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false, loginInProgress: false, context: null })
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const applyRaw = (raw: string) => {
      if (!active) return
      try {
        setAuth(JSON.parse(raw) as AuthState)
      } catch {
      }
    }
    const syncState = () => api.state().then(applyRaw).catch(() => {})
    const onFocus = () => { void syncState() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncState()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    void syncState()
    void (async () => {
      while (active && !controller.signal.aborted) {
        try {
          for await (const frame of api.watchState(controller.signal)) {
            if (!active || controller.signal.aborted) break
            applyRaw(frame)
          }
        } catch {
        }
        if (!active || controller.signal.aborted) break
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 500)
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        if (!active || controller.signal.aborted) break
        await syncState()
      }
    })()
    return () => {
      active = false
      controller.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [api])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const locale = getActiveClientLocale()
  const isZh = locale === 'zh'
  const signedIn = auth.signedIn && auth.context !== null
  const displayName = auth.context?.displayName || auth.context?.subject || (isZh ? '已登录' : 'Signed in')
  const avatarText = (displayName[0] || 'U').toUpperCase()
  const shortcutLabel = settingsShortcut?.keys.join('') ?? ''

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPos({ left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 6) })
    }
    setMenuOpen(true)
    void api.state().then((raw) => {
      try {
        setAuth(JSON.parse(raw) as AuthState)
      } catch {
      }
    }).catch(() => {})
  }

  const handleLogin = async () => {
    setMenuOpen(false)
    setLocalError(null)
    setCopied(false)
    setBusy(true)
    try {
      await api.startLogin()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleCancelLogin = async () => {
    setLocalError(null)
    try {
      await api.cancelLogin()
    } catch {
    }
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    setBusy(true)
    try {
      await api.logout()
    } finally {
      setBusy(false)
    }
  }

  const handleCopyUrl = async () => {
    if (!auth.loginAuthorizeUrl) return
    try {
      await navigator.clipboard.writeText(auth.loginAuthorizeUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
    }
  }

  const showModal = auth.loginInProgress || localError !== null

  return (
    <div className="opc-launcher-root">
      <style>{LAUNCHER_STYLES}</style>
      <button
        ref={triggerRef}
        type="button"
        className="opc-launcher-trigger"
        data-collapsed={!wide}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={signedIn ? displayName : (isZh ? '更多' : 'More')}
        onClick={toggleMenu}
      >
        {signedIn
          ? <span className="opc-launcher-avatar">{avatarText}</span>
          : <MoreIcon />}
        {wide && <span className="opc-launcher-label">{signedIn ? displayName : (isZh ? '更多' : 'More')}</span>}
      </button>

      {menuOpen && menuPos && createPortal(
        <div ref={menuRef} className="opc-launcher-menu" role="menu" style={{ left: menuPos.left, bottom: menuPos.bottom }}>
          {signedIn && auth.context && (
            <div className="opc-launcher-menu-header">
              <div className="opc-launcher-menu-name">{displayName}</div>
              {auth.context.email && <div className="opc-launcher-menu-sub">{auth.context.email}</div>}
            </div>
          )}
          <button
            type="button"
            className="opc-launcher-item"
            role="menuitem"
            onClick={() => { setMenuOpen(false); openSettings() }}
          >
            <span className="opc-launcher-item-left"><SettingsIcon /><span>{isZh ? '设置' : 'Settings'}</span></span>
            {shortcutLabel && <span className="opc-launcher-shortcut">{shortcutLabel}</span>}
          </button>
          {signedIn ? (
            <button
              type="button"
              className="opc-launcher-item opc-launcher-item-danger"
              role="menuitem"
              disabled={busy}
              onClick={() => { void handleLogout() }}
            >
              <span className="opc-launcher-item-left"><LogoutIcon /><span>{translate(locale, 'panel.signOut')}</span></span>
            </button>
          ) : (
            <button
              type="button"
              className="opc-launcher-item"
              role="menuitem"
              disabled={busy}
              onClick={() => { void handleLogin() }}
            >
              <span className="opc-launcher-item-left"><UserIcon /><span>{isZh ? '登录' : 'Sign in'}</span></span>
            </button>
          )}
        </div>,
        document.body,
      )}

      {showModal && createPortal(
        <div className="opc-launcher-modal-backdrop" role="dialog" aria-modal="true">
          <div className="opc-launcher-modal">
            <h3>{isZh ? '企业微信登录' : 'WeCom Sign In'}</h3>
            {localError && <div className="opc-launcher-modal-error">{localError}</div>}
            {!localError && auth.loginError && <div className="opc-launcher-modal-error">{auth.loginError.message}</div>}
            <p>
              {auth.loginInProgress
                ? (isZh ? '已在浏览器中打开企业微信授权页，完成登录后将自动返回 WorkOPC 并同步企业工作台。' : 'WeCom authorization has opened in your browser. Complete sign-in to return to WorkOPC.')
                : (isZh ? '登录未完成，请重试。' : 'Sign-in did not complete. Please try again.')}
            </p>
            <div className="opc-launcher-modal-actions">
              {auth.loginInProgress && auth.loginAuthorizeUrl && (
                <button type="button" className="opc-launcher-btn" onClick={() => { void handleCopyUrl() }}>
                  {copied ? (isZh ? '已复制' : 'Copied') : (isZh ? '复制登录链接' : 'Copy link')}
                </button>
              )}
              {auth.loginInProgress ? (
                <button type="button" className="opc-launcher-btn" onClick={() => { void handleCancelLogin() }}>
                  {isZh ? '取消' : 'Cancel'}
                </button>
              ) : (
                <>
                  <button type="button" className="opc-launcher-btn" onClick={() => setLocalError(null)}>
                    {isZh ? '关闭' : 'Close'}
                  </button>
                  <button type="button" className="opc-launcher-btn opc-launcher-btn-primary" onClick={() => { void handleLogin() }}>
                    {isZh ? '重试' : 'Retry'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
