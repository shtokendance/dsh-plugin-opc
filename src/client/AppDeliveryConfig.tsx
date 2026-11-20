import React, { useEffect, useRef, useState } from 'react'
import type { AppConfigItem, ResourceSummary } from './api.ts'
import {
  isContainerDefaultConfig,
  needsConnectionDecision,
  needsContainerBindWarning,
} from './app-config-helpers.ts'

export { isContainerDefaultConfig, needsConnectionDecision, needsContainerBindWarning }

const names: Record<string, string> = {
  DB_DSN: '业务数据库连接',
  DATABASE_URL: '业务数据库连接',
  CONNECTION_STRING: '数据库连接',
  PGHOST: 'PostgreSQL 数据库地址',
  PGPORT: 'PostgreSQL 端口',
  PGUSER: 'PostgreSQL 用户名',
  PGPASSWORD: 'PostgreSQL 密码',
  PGDATABASE: 'PostgreSQL 数据库名',
  REDIS_URL: 'Redis 缓存连接',
  REDIS_HOST: 'Redis 缓存地址',
  REDIS_PORT: 'Redis 缓存端口',
  MONGODB_URI: 'MongoDB 数据库连接',
  MONGODB_URL: 'MongoDB 数据库连接',
  S3_ENDPOINT: '对象存储服务地址',
  S3_BUCKET: '对象存储桶名称',
  S3_ACCESS_KEY: '对象存储访问账号',
  S3_SECRET_KEY: '对象存储访问密钥',
  ALY_ACCESS_KEY_ID: '阿里云访问账号',
  ALY_ACCESS_KEY_SECRET: '阿里云访问密钥',
  ALY_ORG_ID: '阿里云组织',
  ALY_REGION_ID: '阿里云区域',
  ALY_ENDPOINT: '阿里云服务地址',
  HOST: '服务监听地址',
  BIND_HOST: '服务绑定地址',
  LISTEN_HOST: '服务监听地址',
  PORT: '应用运行端口',
  NODE_ENV: '运行环境模式',
  PUBLIC_ORIGIN: '公网访问域名',
  ALLOW_PUBLIC_REGISTRATION: '开放公开注册开关',
}

export const configName = (item: AppConfigItem) =>
  names[item.key] || item.description?.split(/[。；\n]/)[0] || item.key || '新增配置'

function matches(item: AppConfigItem, resource: ResourceSummary) {
  if (!resource.env_keys?.includes(item.key)) return false
  if (/DATABASE|DB_DSN|CONNECTION_STRING/i.test(item.key)) {
    const type =
      `${item.value} ${item.original_value || ''} ${item.description || ''}`
        .match(/mysql|postgres(?:ql)?|sqlserver|mongodb/i)?.[0]
        ?.toLowerCase() || (/@tcp\(/.test(item.value || item.original_value || '') ? 'mysql' : '')
    if (
      type &&
      resource.type.toLowerCase().replace('postgresql', 'postgres') !== type.replace('postgresql', 'postgres')
    ) {
      return false
    }
  }
  return true
}

function resourceMigrationNote(resource: ResourceSummary) {
  const type = (resource.type || '').toLowerCase()
  if (/postgres|mysql|mariadb|sqlserver|mssql|mongo/.test(type)) {
    return '💡 迁移提醒：切换后将连接所选数据库，本机存量数据不会自动迁移；需核对目标表结构，初始化或迁移数据需另行确认。'
  }
  if (/redis|memcache/.test(type)) {
    return '请先确认用途：可重建缓存通常无需迁移；登录会话与业务状态需另行处理，不能直接丢弃。'
  }
  if (/s3|minio|oss|cos|storage/.test(type)) {
    return '💡 迁移提醒：切换后新上传文件将持久保存在服务器存储桶中。'
  }
  return ''
}

function defaultDisplayValue(item: AppConfigItem, original?: AppConfigItem, lockedPort?: number): string {
  if (lockedPort !== undefined && item.key === 'PORT') {
    if (original?.original_value) return original.original_value
    if (original?.app_default) return `源码默认：${original.app_default}`
    return `与容器端口 ${lockedPort} 一致`
  }
  if (!original) return '用户新增（无原应用默认值）'
  const hasOrigFile = Boolean(original.has_original_value || original.value_source === 'original')
  if (original.secret) {
    if (hasOrigFile) return '••••••••（原应用敏感值已隐藏）'
    if (original.is_example_source) return '示例模板占位值（不自动注入）'
    if (original.has_value) return '••••••••（沿用线上已配置值）'
    return '无默认值'
  }
  const origText = original.original_value ?? original.value ?? ''
  if (origText) return origText
  if (original.app_default) return `源码默认：${original.app_default}`
  if (original.has_value) return '（线上已配置值）'
  return '无默认值'
}

export function AppDeliveryConfig({
  configs,
  originals,
  resources,
  onChange,
  compact = false,
  lockedPort,
  onReturnToPortStep,
  readOnly = false,
}: {
  configs: AppConfigItem[]
  originals: AppConfigItem[]
  resources: ResourceSummary[]
  compact?: boolean
  lockedPort?: number
  onReturnToPortStep?: () => void
  readOnly?: boolean
  onChange: (items: AppConfigItem[]) => void
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const update = (index: number, value: AppConfigItem) =>
    onChange(configs.map((item, i) => (i === index ? value : item)))

  const removeCustom = (index: number) =>
    onChange(configs.filter((_, i) => i !== index))

  const getStatus = (item: AppConfigItem, original?: AppConfigItem, selected?: ResourceSummary) => {
    const isPortLocked = lockedPort !== undefined && item.key === 'PORT'
    if (isPortLocked) {
      return { label: '已对齐', tone: 'oa-pill-ok', changed: false }
    }
    if (selected) {
      return { label: `平台资源：${selected.name}`, tone: 'oa-pill-accent', changed: true }
    }
    if (!original) {
      return item.value
        ? { label: '新增自定义', tone: 'oa-pill-accent', changed: true }
        : { label: '待填写', tone: 'oa-pill-warn', changed: true }
    }
    if (item.secret) {
      const preserved =
        !item.value &&
        ((item.value_source === 'original' && Boolean(original.has_original_value || original.has_value)) ||
          (item.value_source !== 'manual' && Boolean(original.has_value)))
      if (item.value) return { label: '已修改', tone: 'oa-pill-accent', changed: true }
      if (preserved) return { label: '沿用原值', tone: 'oa-pill-ok', changed: false }
      if (item.required) return { label: '待填写', tone: 'oa-pill-warn', changed: false }
      return { label: '未设置', tone: '', changed: false }
    }
    const baseline = original.original_value ?? original.value ?? ''
    if (baseline) {
      if (item.value === baseline) {
        return {
          label: original.is_example_source ? '沿用示例值' : '沿用原值',
          tone: 'oa-pill-ok',
          changed: false,
        }
      }
      if (!item.value && item.required) {
        return { label: '待填写', tone: 'oa-pill-warn', changed: true }
      }
      return { label: item.value ? '已修改' : '已清空', tone: 'oa-pill-accent', changed: true }
    }
    if (item.value) return { label: '已覆盖', tone: 'oa-pill-accent', changed: true }
    if (original.app_default) return { label: '沿用源码默认', tone: 'oa-pill-ok', changed: false }
    if (item.required) return { label: '待填写', tone: 'oa-pill-warn', changed: false }
    return { label: '留空不注入', tone: '', changed: false }
  }

  const requiredCount = configs.filter(c => c.required).length
  const modifiedItems = configs.filter(item => {
    const original = originals.find(o => o.key === item.key)
    const selected = resources.find(r => r.id === item.resource_id)
    return getStatus(item, original, selected).changed
  })

  const renderConfigCard = (item: AppConfigItem, index: number) => {
    const original = item.is_custom ? undefined : originals.find(o => o.key === item.key)
    const isPortLocked = lockedPort !== undefined && item.key === 'PORT'
    const candidates = isPortLocked
      ? []
      : resources.filter(
          r =>
            matches(original || item, r) &&
            (r.type !== 'minio-app-storage' || configs.some(config => config.resource_id === r.id)),
        )
    const selected = resources.find(r => r.id === item.resource_id)
    const status = getStatus(item, original, selected)
    const bindWarning = needsContainerBindWarning(item, original)
    const loopbackWarning = needsConnectionDecision(item)
    const showWarning = bindWarning || loopbackWarning || status.tone === 'oa-pill-warn'
    const revealKey = item.key ? `key:${item.key}` : `idx:${index}`
    const isRevealed = Boolean(revealed[revealKey])
    const friendly = configName(item)
    const leftValue = defaultDisplayValue(item, original, lockedPort)
    const hasOriginalSecret = Boolean(
      original?.secret &&
        ((original.has_original_value || original.value_source === 'original') || original.has_value),
    )
    const portValue = isPortLocked ? String(lockedPort) : item.value

    return (
      <article
        key={`${original ? item.key : 'custom'}-${index}`}
        className={`oa-cfg-card${showWarning ? ' oa-cfg-card-warn' : ''}`}
        aria-label={friendly}
      >
        <header className="oa-cfg-head">
          <div className="oa-cfg-title-group">
            {original ? (
              <code className="oa-code">{item.key}</code>
            ) : (
              <input
                aria-label="新增配置名称"
                value={item.key}
                disabled={readOnly}
                placeholder="环境变量名，如 WEBHOOK_URL"
                className="oa-input oa-mono oa-cfg-key-input"
                onChange={e =>
                  update(index, {
                    ...item,
                    key: e.target.value,
                    resource_id: undefined,
                    value_source: 'manual',
                  })
                }
              />
            )}
            {friendly !== item.key && <span className="oa-cfg-friendly">{friendly}</span>}
            {item.required && <span className="oa-pill oa-pill-warn">必填</span>}
            {item.secret && <span className="oa-pill">敏感</span>}
            {isPortLocked && <span className="oa-pill oa-pill-accent">与容器端口联动</span>}
            {original?.is_example_source && <span className="oa-pill">示例模板</span>}
          </div>

          <div className="oa-cfg-actions">
            <span className={`oa-pill ${status.tone}`}>{status.label}</span>
            {status.changed && original && !isPortLocked && !readOnly && (
              <button
                type="button"
                className="oa-btn-link"
                onClick={() =>
                  update(index, {
                    ...original,
                    resource_id: undefined,
                    local_connection_confirmed: false,
                  })
                }
              >
                恢复默认
              </button>
            )}
            {!original && !readOnly && (
              <button
                type="button"
                className="oa-btn oa-btn-xs oa-btn-danger"
                onClick={() => removeCustom(index)}
              >
                删除
              </button>
            )}
          </div>
        </header>

        <div className="oa-grid-2" style={{ gap: 10, fontSize: 12 }}>
          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span>应用内部默认值</span>
              {original?.source_label && <span className="oa-hint">{original.source_label}</span>}
            </div>
            <input
              aria-label={`${item.key || '新增项'} 原始值`}
              readOnly
              value={leftValue}
              title={leftValue}
              className="oa-input oa-mono oa-cfg-readonly"
            />
          </div>

          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span style={{ fontWeight: 600, color: 'var(--oa-ink)' }}>部署生效值</span>
              {!original && !readOnly && (
                <label className="oa-cfg-secret-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(item.secret)}
                    onChange={e => update(index, { ...item, secret: e.target.checked })}
                  />
                  <span>敏感</span>
                </label>
              )}
              {selected && !readOnly && (
                <button
                  type="button"
                  className="oa-btn-link"
                  onClick={() =>
                    update(index, {
                      ...item,
                      value: '',
                      resource_id: undefined,
                      value_source: original?.has_original_value ? 'original' : 'manual',
                    })
                  }
                >
                  取消绑定
                </button>
              )}
            </div>

            {isPortLocked ? (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={`${item.key} 配置值`}
                  readOnly
                  value={portValue}
                  className="oa-input oa-mono oa-cfg-readonly"
                />
                {onReturnToPortStep && !readOnly && (
                  <button type="button" className="oa-btn oa-btn-xs" onClick={onReturnToPortStep}>
                    返回调整端口
                  </button>
                )}
              </div>
            ) : selected ? (
              <input
                aria-label={`${item.key} 配置值`}
                readOnly
                value={`由「${selected.name}」自动注入`}
                className="oa-input oa-cfg-readonly"
                style={{ color: 'var(--oa-accent)' }}
              />
            ) : (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={`${item.key || '新增项'} 配置值`}
                  type={item.secret && !isRevealed ? 'password' : 'text'}
                  disabled={readOnly}
                  value={item.value}
                  placeholder={
                    hasOriginalSecret
                      ? '留空沿用原值，输入新值则覆盖'
                      : original?.app_default
                        ? `留空沿用源码默认 (${original.app_default})，或输入覆盖`
                        : item.required
                          ? '请输入必填配置值，或选用下方平台资源'
                          : '选填，留空则不注入该环境变量'
                  }
                  className="oa-input oa-mono"
                  style={{ minHeight: 34, padding: '6px 10px', fontSize: 12 }}
                  onChange={e =>
                    update(index, {
                      ...item,
                      value: e.target.value,
                      resource_id: undefined,
                      local_connection_confirmed: false,
                      value_source: 'manual',
                    })
                  }
                />
                {item.secret && (
                  <button
                    type="button"
                    className="oa-btn oa-btn-xs"
                    onClick={() => setRevealed(prev => ({ ...prev, [revealKey]: !isRevealed }))}
                  >
                    {isRevealed ? '隐藏' : '显示'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {bindWarning && (
          <div role="note" className="oa-alert oa-alert-warn oa-cfg-inline-warn">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>容器内监听 <code>127.0.0.1 / localhost</code> 将导致外部访问与健康检查失败，建议改为 <code>0.0.0.0</code>。</span>
              {!readOnly && (
                <button
                  type="button"
                  className="oa-btn oa-btn-xs oa-btn-primary"
                  onClick={() =>
                    update(index, {
                      ...item,
                      value: '0.0.0.0',
                      resource_id: undefined,
                      local_connection_confirmed: false,
                      value_source: 'manual',
                    })
                  }
                >
                  一键改为 0.0.0.0
                </button>
              )}
            </div>
          </div>
        )}

        {(loopbackWarning || item.local_connection_confirmed) && (
          <div role="note" className="oa-alert oa-alert-warn oa-cfg-inline-warn">
            <div>这个连接指向容器自己，部署后不能连接你电脑上的服务。请选择下方平台资源，或填写服务器可访问地址。</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                disabled={readOnly}
                checked={!!item.local_connection_confirmed}
                onChange={e => update(index, { ...item, local_connection_confirmed: e.target.checked })}
              />
              <span>只有该服务确实和应用运行在同一容器内时，才勾选保留此连接</span>
            </label>
          </div>
        )}

        {!!candidates.length && !readOnly && (
          <div className="oa-cfg-resources">
            <span className="oa-hint">可绑平台资源：</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.map(resource => (
                <button
                  key={resource.id}
                  type="button"
                  aria-label={`使用${resource.name}替换 ${item.key}`}
                  disabled={item.resource_id === resource.id}
                  className={`oa-btn oa-btn-xs ${item.resource_id === resource.id ? 'oa-btn-accent-soft' : ''}`}
                  onClick={() => {
                    if (resource.type === 'minio-app-storage') {
                      onChange(
                        configs.map(config =>
                          resource.env_keys.includes(config.key)
                            ? { ...config, value: '', value_source: 'resource', resource_id: resource.id }
                            : config,
                        ),
                      )
                      return
                    }
                    update(index, { ...item, value: '', value_source: 'resource', resource_id: resource.id })
                  }}
                >
                  {item.resource_id === resource.id ? '✓ ' : '改用 '}
                  {resource.name}
                </button>
              ))}
            </div>
            {selected && (
              <div style={{ background: 'var(--oa-paper)', borderRadius: 6, padding: '6px 8px', fontSize: 11.5, color: 'var(--oa-muted)', width: '100%' }}>
                <div>
                  {selected.env_preview?.[item.key] && selected.env_preview[item.key] !== '[REDACTED]'
                    ? selected.env_preview[item.key]
                    : '连接凭据由服务器安全提供'}
                </div>
                {resourceMigrationNote(selected) && <div style={{ marginTop: 3 }}>{resourceMigrationNote(selected)}</div>}
              </div>
            )}
          </div>
        )}

        {item.description && friendly === item.key && (
          <div className="oa-hint">{item.description}</div>
        )}
        {item.description && friendly !== item.key && item.description !== friendly && (
          <details style={{ fontSize: 11.5, color: 'var(--oa-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>用途说明</summary>
            <p style={{ margin: '4px 0 0' }}>{item.description}</p>
          </details>
        )}
      </article>
    )
  }

  const indexedConfigs = configs.map((item, index) => ({ item, index }))
  const primaryConfigs = compact ? indexedConfigs : indexedConfigs.filter(({ item }) => !isContainerDefaultConfig(item))
  const containerDefaultConfigs = compact ? [] : indexedConfigs.filter(({ item }) => isContainerDefaultConfig(item))

  const hasContainerIssue = containerDefaultConfigs.some(({ item }) => {
    const orig = originals.find(o => o.key === item.key)
    const preserves =
      (item.value_source === 'original' && Boolean(orig?.has_original_value || orig?.has_value)) ||
      (item.value_source !== 'manual' && Boolean(orig?.has_value))
    return (
      needsContainerBindWarning(item, orig) ||
      needsConnectionDecision(item) ||
      (Boolean(item.required) && item.key !== 'PORT' && !item.value && !item.resource_id && !preserves)
    )
  })
  const [containerOpen, setContainerOpen] = useState(hasContainerIssue)
  const prevContainerIssue = useRef(hasContainerIssue)
  useEffect(() => {
    if (hasContainerIssue && !prevContainerIssue.current) {
      setContainerOpen(true)
    }
    prevContainerIssue.current = hasContainerIssue
  }, [hasContainerIssue])

  const formatContainerSummary = (item: AppConfigItem) => {
    if (lockedPort !== undefined && item.key === 'PORT') return `PORT=${lockedPort}`
    const orig = originals.find(o => o.key === item.key)
    const val = item.value || orig?.original_value || orig?.app_default || ''
    return val ? `${item.key}=${val}` : item.key
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="应用配置对照">
      {!compact && (
        <div className="oa-cfg-toolbar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 650 }}>运行时环境变量</h3>
              <span className="oa-pill">共 {configs.length} 项</span>
              {requiredCount > 0 && <span className="oa-pill oa-pill-warn">必填 {requiredCount} 项</span>}
              {modifiedItems.length > 0 && (
                <span className="oa-pill oa-pill-accent">已修改 {modifiedItems.length} 项</span>
              )}
            </div>
            <p className="oa-hint" style={{ margin: '3px 0 0' }}>
              留空或保持不变将沿用应用默认值；修改仅在本次容器运行时生效，不改本地源码。密码与密钥不会发送给 AI。
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="oa-btn oa-btn-sm"
              style={{ color: 'var(--oa-accent)' }}
              onClick={() =>
                onChange([
                  ...configs,
                  { key: '', value: '', description: '', value_source: 'manual', secret: false, is_custom: true },
                ])
              }
            >
              ＋ 新增环境变量
            </button>
          )}
        </div>
      )}

      {configs.length === 0 && (
        <div className="oa-subcard" style={{ textAlign: 'center', padding: 18, color: 'var(--oa-muted)' }}>
          当前未声明额外运行时环境变量，可直接确认发布；如有需要可点击右上角「＋ 新增环境变量」。
        </div>
      )}

      {configs.length > 0 && primaryConfigs.length === 0 && (
        <div className="oa-alert oa-alert-ok">
          ✓ 当前应用无需额外配置外部数据库或密钥；容器基础参数已就绪。
        </div>
      )}

      {primaryConfigs.map(({ item, index }) => renderConfigCard(item, index))}

      {containerDefaultConfigs.length > 0 && (
        <details
          open={containerOpen}
          onToggle={e => setContainerOpen(e.currentTarget.open)}
          className={`oa-subcard${hasContainerIssue ? ' oa-cfg-card-warn' : ''}`}
          style={{ fontSize: 12 }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: hasContainerIssue ? '#92400e' : 'var(--oa-ink)' }}>
            容器基础参数（{containerDefaultConfigs.length} 项：
            {containerDefaultConfigs.map(({ item }) => formatContainerSummary(item)).join(' · ')}
            {hasContainerIssue ? ' · 请注意检查监听地址' : ''}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--oa-line)' }}>
            {containerDefaultConfigs.map(({ item, index }) => renderConfigCard(item, index))}
          </div>
        </details>
      )}

      {!compact && configs.length > 0 && (
        <div className="oa-subcard" style={{ padding: '9px 12px', fontSize: 12 }} aria-label="配置更改汇总">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>配置变更摘要</span>
            <span className="oa-hint">
              {modifiedItems.length
                ? `已调整 ${modifiedItems.length} 项配置或平台资源 · 草稿自动保存`
                : '全部沿用应用默认值或原配置 · 草稿自动保存'}
            </span>
          </div>
          {modifiedItems.map((item, idx) => {
            const target = item.resource_id
              ? `平台资源「${resources.find(r => r.id === item.resource_id)?.name || item.resource_id}」`
              : item.secret
                ? '自定义敏感值（已隐藏）'
                : item.value || '（已清空）'
            return (
              <div key={`${item.key}-${idx}`} style={{ marginTop: 4, fontWeight: 500 }}>
                • {configName(item)} (<code>{item.key || '未命名'}</code>) → {target}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
