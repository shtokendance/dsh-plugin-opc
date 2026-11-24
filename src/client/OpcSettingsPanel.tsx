import React, { useCallback, useEffect, useId, useState } from 'react'
import type { OpcApi, OpcConnectionTestResult, OpcPlatformConfig } from './api.ts'
import { useI18n } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'

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
  const { tr } = useI18n()
  const formId = useId()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [platformBase, setPlatformBase] = useState('https://aiwork.benlai.com')
  const [appDomainRoot, setAppDomainRoot] = useState('')
  const [appDefaultPort, setAppDefaultPort] = useState('8080')
  const [defaultPlatformBase, setDefaultPlatformBase] = useState('https://aiwork.benlai.com')
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
      setDefaultPlatformBase(cfg.default_platform_base || 'https://aiwork.benlai.com')
      setDefaultAppDomainRoot(cfg.default_app_domain_root || 'ai.benlai.com')
      setPlatformBase(cfg.platform_base || cfg.default_platform_base || 'https://aiwork.benlai.com')
      setAppDomainRoot(cfg.app_domain_root ?? '')
      setAppDefaultPort(String(cfg.app_default_port ?? 8080))
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('加载 OPC 平台配置失败', 'Failed to load OPC settings'))
    } finally {
      setLoading(false)
    }
  }, [api, tr])

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
        error: e instanceof Error ? e.message : tr('测试连接失败', 'Connection test failed'),
      })
    } finally {
      setTesting(false)
    }
  }

  const handleReset = () => {
    setPlatformBase(defaultPlatformBase)
    setAppDomainRoot('')
    setAppDefaultPort('8080')
    setTestResult(null)
    setError('')
    setNotice({ kind: 'info', text: tr('已恢复默认值，点击「保存并立即生效」即可应用。', 'Restored defaults. Click Save & Apply to take effect.') })
  }

  const handleSave = async () => {
    if (!api.opcConfigUpdate) return
    const trimmedBase = platformBase.trim()
    if (!trimmedBase) {
      setError(tr('网关服务地址不能为空', 'Platform Base URL cannot be empty'))
      return
    }
    const parsedPort = Number(appDefaultPort.trim())
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setError(tr('应用默认容器端口必须为 1 至 65535 的整数', 'Default container port must be an integer between 1 and 65535'))
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
            app_domain_root: appDomainRoot.trim(),
            app_default_port: parsedPort,
          }),
        ),
      ) as OpcPlatformConfig
      setPlatformBase(updated.platform_base)
      setAppDomainRoot(updated.app_domain_root)
      setAppDefaultPort(String(updated.app_default_port))
      setNotice({
        kind: 'ok',
        text: updated.platform_base_changed
          ? tr('平台配置已保存并生效。由于切换了统一平台网关，请返回主界面重新登录企业微信 / SSO 账号。', 'Settings saved. Since the Platform Gateway changed, please sign in again.')
          : tr('平台配置已保存并立即生效。', 'Settings saved and applied.'),
      })
      onSaved?.(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('保存 OPC 平台配置失败', 'Failed to save OPC settings'))
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
          <h3 className="opc-settings-title">{tr('OPC 平台配置', 'OPC Platform Settings')}</h3>
          <p className="opc-settings-sub">{tr('配置 OPC 统一服务端网关与服务地址，支持切换企业正式、预发与私有化环境。', 'Configure the unified OPC server gateway and deployment defaults.')}</p>
        </div>
        <button type="button" className="btn-header" onClick={onClose}>
          {tr('← 返回', '← Back')}
        </button>
      </div>

      <NoticeModal
        open={Boolean(error)}
        variant="error"
        message={error}
        onClose={() => setError('')}
      />
      {notice && (
        <div className={notice.kind === 'ok' ? 'opc-settings-banner-ok' : 'opc-settings-banner-info'}>
          {notice.text}
        </div>
      )}

      <section className="opc-settings-card">
        <div className="opc-settings-card-head">
          <h4 className="opc-settings-card-title">{tr('统一平台网关', 'Unified Platform Gateway')}</h4>
          <span className="opc-settings-pill">{tr('主服务入口', 'Primary Entry')}</span>
        </div>
        <p className="opc-settings-desc">
          {tr('用于企业微信扫码授权登录、企业知识库检索、租户共享技能中心及 MCP 网关。', 'Used for WeCom/SSO login, enterprise KB search, skill catalog, and MCP gateway.')}
        </p>
        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-platform-base`}>
            {tr('网关服务地址 (Platform Base)', 'Platform Base URL')}
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
              {testing ? tr('测试中...', 'Testing...') : tr('测试连接', 'Test Connection')}
            </button>
          </div>
          {testResult && (
            <div className={testResult.ok ? 'opc-settings-test-ok' : 'opc-settings-test-fail'}>
              {testResult.ok
                ? tr('连接成功 ({ms}ms, HTTP {code})', 'Connected ({ms}ms, HTTP {code})', { ms: testResult.latency_ms ?? 0, code: testResult.status_code ?? 200 })
                : tr('连接失败: {err}', 'Connection failed: {err}', { err: testResult.error || tr('无法连接', 'Unreachable') })}
            </div>
          )}
        </div>
      </section>

      <section className="opc-settings-card">
        <div className="opc-settings-card-head">
          <h4 className="opc-settings-card-title">{tr('应用部署与访问配置', 'App Deployment & Access')}</h4>
          <span className="opc-settings-pill">{tr('应用治理与部署', 'App Delivery')}</span>
        </div>
        <p className="opc-settings-desc">
          {tr('配置新建应用的访问域名后缀与容器默认端口，普通用户新建应用时无需填写繁琐参数。', 'Configure default domain suffix and container port for newly deployed apps.')}
        </p>

        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-domain-root`}>
            {tr('应用内网根域名后缀 (App Domain Root)', 'App Domain Root')}
          </label>
          <input
            id={`${formId}-domain-root`}
            type="text"
            className="opc-settings-input"
            placeholder={tr('默认: {root}', 'Default: {root}', { root: defaultAppDomainRoot })}
            value={appDomainRoot}
            disabled={loading || saving}
            onChange={e => setAppDomainRoot(e.target.value)}
          />
          <p className="opc-settings-help">
            {tr('新建应用时为子域名前缀自动追加的访问地址后缀。生成的应用地址形如：http://{subdomain}.{root}', 'Appended to app slug to form URLs like: http://{subdomain}.{root}', { subdomain: tr('{子域名}', '{slug}'), root: effectivePreviewRoot })}
          </p>
        </div>

        <div className="opc-settings-field">
          <label className="opc-settings-label" htmlFor={`${formId}-default-port`}>
            {tr('应用默认容器端口 (Default Port)', 'Default Container Port')}
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
            {tr('新建应用时的默认容器内监听端口（默认 8080），普通用户无需手动填写端口，平台将自动统一适配。', 'Default container listening port for new apps (default 8080).')}
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
          {tr('恢复默认', 'Reset Defaults')}
        </button>
        <button
          type="button"
          className="primary opc-settings-btn-save"
          disabled={loading || saving || !platformBase.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? tr('保存中...', 'Saving...') : tr('保存并立即生效', 'Save & Apply')}
        </button>
      </div>

      <p className="opc-settings-note">
        {tr('* 提示：若修改了平台主网关，请前往主界面重新使用新平台的企微 / SSO 账号登录。', '* Note: If you change the Platform Gateway, please sign in again on the main screen.')}
      </p>
    </div>
  )
}
