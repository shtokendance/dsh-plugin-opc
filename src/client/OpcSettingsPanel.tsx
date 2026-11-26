import React, { useCallback, useEffect, useId, useState } from 'react'
import type { OpcApi, OpcConnectionTestResult, OpcPlatformConfig } from './api.ts'
import { useI18n } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'
import { DEFAULT_WORKBENCH_NAME, setWorkbenchName as syncWorkbenchName } from './workbench-name.ts'

const settingsCss = `
.opc-settings-wrap {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.opc-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.opc-settings-title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.3;
}
.opc-settings-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}
.opc-settings-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.opc-settings-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.opc-settings-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: #0f172a;
}
.opc-settings-pill {
  font-size: 11px;
  font-weight: 500;
  color: #2563eb;
  background: #eff6ff;
  border: 1px solid #dbeafe;
  padding: 2px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.opc-settings-desc {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}
.opc-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.opc-settings-label {
  font-size: 12.5px;
  font-weight: 500;
  color: #334155;
}
.opc-settings-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opc-panel .opc-settings-input {
  width: 100%;
  min-width: 0;
  height: 36px;
  min-height: 36px;
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #0f172a;
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s;
}
.opc-panel .opc-settings-input-row .opc-settings-input {
  flex: 1 1 0%;
}
.opc-panel .opc-settings-input:focus {
  outline: none;
  border-color: #2563eb;
  background: #ffffff;
}
.opc-panel .opc-settings-port-input {
  width: 120px;
  max-width: 120px;
  height: 36px;
  min-height: 36px;
  flex: 0 0 auto;
}
.opc-settings-test-btn {
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #1e293b;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.opc-settings-test-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.opc-settings-help {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.opc-settings-test-ok {
  font-size: 12px;
  color: #059669;
  font-weight: 500;
}
.opc-settings-test-fail {
  font-size: 12px;
  color: #dc2626;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.opc-settings-banner-ok {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.5;
}
.opc-settings-banner-info {
  background: #eff6ff;
  border: 1px solid #dbeafe;
  color: #1e40af;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.5;
}
.opc-settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
  flex-wrap: wrap;
}
.opc-settings-btn-reset {
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13px;
  font-weight: 500;
}
.opc-settings-btn-save {
  height: 36px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 550;
}
.opc-settings-note {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}
`

export function OpcSettingsPanel({
  api,
  onClose,
  onSaved,
}: {
  api: OpcApi
  onClose: () => void
  onSaved?: (config: OpcPlatformConfig) => void
}) {
  const { t } = useI18n()
  const formId = useId()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [platformBase, setPlatformBase] = useState('https://aiwork.benlai.com')
  const [workbenchName, setWorkbenchName] = useState(DEFAULT_WORKBENCH_NAME)
  const [appDomainRoot, setAppDomainRoot] = useState('')
  const [appDefaultPort, setAppDefaultPort] = useState('8080')
  const [defaultPlatformBase, setDefaultPlatformBase] = useState('https://aiwork.benlai.com')
  const [defaultWorkbenchName, setDefaultWorkbenchName] = useState(DEFAULT_WORKBENCH_NAME)
  const [defaultAppDomainRoot, setDefaultAppDomainRoot] = useState('ai.benlai.com')
  const [testResult, setTestResult] = useState<OpcConnectionTestResult | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null)

  const loadConfig = useCallback(async () => {
    if (!api.opcConfigGet) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const cfg = JSON.parse(await api.opcConfigGet()) as OpcPlatformConfig
      const fallbackName = cfg.default_workbench_name || DEFAULT_WORKBENCH_NAME
      setDefaultPlatformBase(cfg.default_platform_base || 'https://aiwork.benlai.com')
      setDefaultWorkbenchName(fallbackName)
      setDefaultAppDomainRoot(cfg.default_app_domain_root || 'ai.benlai.com')
      setPlatformBase(cfg.platform_base || cfg.default_platform_base || 'https://aiwork.benlai.com')
      setWorkbenchName(cfg.workbench_name || fallbackName)
      setAppDomainRoot(cfg.app_domain_root ?? '')
      setAppDefaultPort(String(cfg.app_default_port ?? 8080))
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.failedToLoadOpcSettings"))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const handleTest = async () => {
    if (!api.opcConfigTest || !platformBase.trim()) return
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const result = JSON.parse(await api.opcConfigTest(platformBase.trim())) as OpcConnectionTestResult
      setTestResult(result)
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : t("settings.connectionTestFailed"),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleReset = () => {
    setPlatformBase(defaultPlatformBase)
    setWorkbenchName(defaultWorkbenchName)
    setAppDomainRoot('')
    setAppDefaultPort('8080')
    setTestResult(null)
    setError('')
    setNotice({ kind: 'info', text: t("settings.restoredDefaultsClickSaveAndApply") })
  }

  const handleSave = async () => {
    if (!api.opcConfigUpdate) return
    const trimmedBase = platformBase.trim()
    if (!trimmedBase) {
      setError(t("settings.platformBaseUrlCannotBeEmpty"))
      return
    }
    const parsedPort = Number(appDefaultPort.trim())
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setError(t("settings.defaultContainerPortMustBeAn"))
      return
    }
    setSaving(true)
    setError('')
    setNotice(null)
    try {
      const updated = JSON.parse(
        await api.opcConfigUpdate(
          JSON.stringify({
            platform_base: trimmedBase,
            workbench_name: workbenchName.trim(),
            app_domain_root: appDomainRoot.trim(),
            app_default_port: parsedPort,
          }),
        ),
      ) as OpcPlatformConfig
      setPlatformBase(updated.platform_base)
      setWorkbenchName(updated.workbench_name || defaultWorkbenchName)
      syncWorkbenchName(updated.workbench_name)
      setAppDomainRoot(updated.app_domain_root)
      setAppDefaultPort(String(updated.app_default_port))
      setNotice({
        kind: 'ok',
        text: updated.platform_base_changed
          ? t("settings.settingsSavedSinceThePlatformGateway")
          : t("settings.settingsSavedAndApplied"),
      })
      onSaved?.(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.failedToSaveOpcSettings"))
    } finally {
      setSaving(false)
    }
  }

  const effectivePreviewRoot = appDomainRoot.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || defaultAppDomainRoot

  return (
    <div className="opc-settings-wrap">
      <style>{settingsCss}</style>

      <div className="opc-settings-head">
        <div>
          <h3 className="opc-settings-title">{t("settings.opcPlatformSettings")}</h3>
          <p className="opc-settings-sub">{t("settings.configureTheUnifiedOpcServerGateway")}</p>
        </div>
        <button type="button" className="btn-header" onClick={onClose}>
          {t("settings.back")}
        </button>
      </div>

      <NoticeModal
        open={Boolean(error)}
        variant="error"
        message={error}
        onClose={() => setError('')}
      />
      <NoticeModal
        open={Boolean(notice)}
        variant={notice?.kind === 'ok' ? 'success' : 'info'}
        message={notice?.text || ''}
        onClose={() => setNotice(null)}
      />

      <section className="opc-settings-card">
        <div className="opc-settings-card-head">
          <h4 className="opc-settings-card-title">{t("settings.unifiedPlatformGateway")}</h4>
          <span className="opc-settings-pill">{t("settings.primaryEntry")}</span>
        </div>
        <p className="opc-settings-desc">
          {t("settings.usedForWecomSsoLoginEnterprise")}
        </p>
        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-platform-base`}>
            {t("settings.platformBaseUrl")}
          </label>
          <div className="opc-settings-input-row">
            <input
              id={`${formId}-platform-base`}
              type="url"
              className="opc-settings-input"
              placeholder="https://..."
              value={platformBase}
              disabled={loading || saving}
              onChange={e => {
                setPlatformBase(e.target.value)
                setTestResult(null)
              }}
            />
            <button
              type="button"
              className="opc-settings-test-btn"
              disabled={loading || saving || testing || !platformBase.trim()}
              onClick={() => void handleTest()}
            >
              {testing ? t("settings.testing") : t("settings.testConnection")}
            </button>
          </div>
          {testResult && (
            <div className={testResult.ok ? 'opc-settings-test-ok' : 'opc-settings-test-fail'}>
              {testResult.ok
                ? t("settings.connectedMsHttp", { ms: testResult.latency_ms ?? 0, code: testResult.status_code ?? 200 })
                : t("settings.connectionFailed", { err: testResult.error || t("settings.unreachable") })}
            </div>
          )}
        </div>
        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-workbench-name`}>
            {t("settings.workbenchName")}
          </label>
          <input
            id={`${formId}-workbench-name`}
            type="text"
            maxLength={64}
            className="opc-settings-input"
            placeholder={defaultWorkbenchName}
            value={workbenchName}
            disabled={loading || saving}
            onChange={e => setWorkbenchName(e.target.value)}
          />
        </div>
      </section>

      <section className="opc-settings-card">
        <div className="opc-settings-card-head">
          <h4 className="opc-settings-card-title">{t("settings.appDeploymentAndAccess")}</h4>
          <span className="opc-settings-pill">{t("settings.appDelivery")}</span>
        </div>
        <p className="opc-settings-desc">
          {t("settings.configureDefaultDomainSuffixAndContainer")}
        </p>

        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-domain-root`}>
            {t("settings.appDomainRoot")}
          </label>
          <input
            id={`${formId}-domain-root`}
            type="text"
            className="opc-settings-input"
            placeholder={t("settings.default", { root: defaultAppDomainRoot })}
            value={appDomainRoot}
            disabled={loading || saving}
            onChange={e => setAppDomainRoot(e.target.value)}
          />
          <p className="opc-settings-help">
            {t("settings.appendedToAppSlugToForm", { subdomain: t("settings.subdomainExample"), root: effectivePreviewRoot })}
          </p>
        </div>

        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-default-port`}>
            {t("settings.defaultContainerPort")}
          </label>
          <input
            id={`${formId}-default-port`}
            type="number"
            min={1}
            max={65535}
            className="opc-settings-input opc-settings-port-input"
            value={appDefaultPort}
            disabled={loading || saving}
            onChange={e => setAppDefaultPort(e.target.value)}
          />
          <p className="opc-settings-help">
            {t("settings.defaultContainerListeningPortForNew")}
          </p>
        </div>
      </section>

      <div className="opc-settings-footer">
        <button
          type="button"
          className="opc-settings-btn-reset"
          disabled={loading || saving}
          onClick={handleReset}
        >
          {t("settings.resetDefaults")}
        </button>
        <button
          type="button"
          className="primary opc-settings-btn-save"
          disabled={loading || saving || !platformBase.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? t("settings.saving") : t("settings.saveAndApply")}
        </button>
      </div>

      <p className="opc-settings-note">
        {t("settings.noteIfYouChangeThePlatform")}
      </p>
    </div>
  )
}
