import React from 'react'
import type { AppConfigItem, ResourceSummary } from './api.ts'

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
  PORT: '应用运行端口',
  NODE_ENV: '运行环境模式',
  ALLOW_PUBLIC_REGISTRATION: '开放公开注册开关',
}

export const configName = (item: AppConfigItem) =>
  names[item.key] || item.description?.split(/[。；\n]/)[0] || item.key || '新增配置'

const CONTAINER_DEFAULT_KEYS = new Set(['PORT', 'HOST', 'BIND_HOST', 'LISTEN_HOST', 'NODE_ENV'])

export function isContainerDefaultConfig(item: AppConfigItem) {
  return CONTAINER_DEFAULT_KEYS.has((item.key || '').toUpperCase()) && !needsConnectionDecision(item)
}

export function needsConnectionDecision(item: AppConfigItem) {
  return (
    !['HOST', 'PORT', 'BIND_HOST', 'LISTEN_HOST'].includes(item.key.toUpperCase()) &&
    /URL|URI|DSN|HOST|ENDPOINT|CONNECTION|SERVER/i.test(item.key) &&
    /(?:^|:\/\/|@|tcp\(|(?:host|server)\s*=)(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/,;)]|$)/i.test(item.value.trim()) &&
    !item.local_connection_confirmed
  )
}

function matches(item: AppConfigItem, resource: ResourceSummary) {
  if (!resource.env_keys?.includes(item.key)) return false
  if (/DATABASE|DB_DSN|CONNECTION_STRING/i.test(item.key)) {
    const type =
      `${item.value} ${item.description || ''}`.match(/mysql|postgres(?:ql)?|sqlserver|mongodb/i)?.[0]?.toLowerCase() ||
      (/@tcp\(/.test(item.value) ? 'mysql' : '')
    if (type && resource.type.toLowerCase().replace('postgresql', 'postgres') !== type.replace('postgresql', 'postgres')) {
      return false
    }
  }
  return true
}

function resourceMigrationNote(resource: ResourceSummary) {
  const type = (resource.type || '').toLowerCase()
  if (/postgres|mysql|mariadb|sqlserver|mssql|mongo/.test(type)) {
    return '💡 迁移提醒：切换后将连接所选数据库，本机存量数据不会自动迁移；需核对目标表结构；初始化和迁移数据需要另外确认。'
  }
  if (/redis|memcache/.test(type)) {
    return '请先确认用途：可重建缓存通常无需迁移；登录会话和业务状态需要另行处理，不能直接丢弃。'
  }
  if (/s3|minio|oss|cos|storage/.test(type)) {
    return '💡 迁移提醒：切换后新上传文件将持久保存在服务器存储桶中。'
  }
  return ''
}

export function AppDeliveryConfig({
  configs,
  originals,
  resources,
  onChange,
  compact = false,
}: {
  configs: AppConfigItem[]
  originals: AppConfigItem[]
  resources: ResourceSummary[]
  compact?: boolean
  onChange: (items: AppConfigItem[]) => void
}) {
  const update = (index: number, value: AppConfigItem) => onChange(configs.map((item, i) => (i === index ? value : item)))
  const replacements = configs.filter(
    item => item.resource_id || (item.value_source === 'manual' && item.value !== originals.find(o => o.key === item.key)?.value),
  )

  const renderConfigCard = (item: AppConfigItem, index: number) => {
    const original = originals.find(o => o.key === item.key)
    const candidates = resources.filter(r => matches(original || item, r))
    const selected = resources.find(r => r.id === item.resource_id)
    const changed = !!item.resource_id || (!!original && item.value !== original.value)
    const hasOriginalFileSource = original?.value_source === 'original' || original?.has_original_value
    const statusLabel = selected
      ? `将改用：${selected.name}`
      : changed
        ? '将使用你填写的新值'
        : hasOriginalFileSource
          ? '保留原配置值'
          : item.value
            ? '采用 AI 建议值'
            : original
              ? '保持原样'
              : '请填写或选择'

    return (
      <article key={`${item.key}-${index}`} className="oa-subcard" aria-label={configName(item)}>
        <header className="oa-subcard-head" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              {configName(item)}
              {item.required && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--oa-muted)', marginLeft: 4 }}>· 必填</span>}
            </h4>
            <code className="oa-code">{item.key || '未命名'}</code>
          </div>
          <span className={`oa-pill ${changed ? 'oa-pill-accent' : ''}`}>{statusLabel}</span>
        </header>

        {!original && (
          <input
            aria-label="新增配置名称"
            value={item.key}
            placeholder="例如 SERVICE_URL"
            className="oa-input oa-mono"
            style={{ fontSize: 12 }}
            onChange={e => update(index, { ...item, key: e.target.value, resource_id: undefined, value_source: 'manual' })}
          />
        )}

        <div className="oa-grid-2" style={{ fontSize: 12 }}>
          <label className="oa-field">
            <span className="oa-hint">{hasOriginalFileSource ? '原应用的值（默认保留）' : 'AI 建议的初始值'}</span>
            <textarea
              aria-label={`${item.key} 原始值`}
              readOnly
              rows={1}
              value={hasOriginalFileSource && !original?.value ? '(已加密托管原始配置)' : original?.value || ''}
              placeholder="此项尚无值"
              className="oa-textarea oa-mono"
              style={{ minHeight: 38, background: 'var(--oa-paper)', color: 'var(--oa-muted)', resize: 'none', fontSize: 12 }}
            />
          </label>
          <div className="oa-field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500, fontSize: 12 }}>部署时使用</span>
              {changed && original && (
                <button
                  type="button"
                  className="oa-btn-link"
                  onClick={() => update(index, { ...original, resource_id: undefined, value_source: original.value_source || 'manual' })}
                >
                  恢复原值
                </button>
              )}
            </div>
            <input
              aria-label={`${item.key} 配置值`}
              type={item.secret && !item.value ? 'password' : 'text'}
              value={item.value}
              placeholder={
                selected
                  ? `由「${selected.name}」提供`
                  : hasOriginalFileSource
                    ? '留空将注入原应用敏感配置，或输入新值覆盖'
                    : '保留原值，或填写你确认的新值'
              }
              className="oa-input oa-mono"
              style={{ minHeight: 38, fontSize: 12 }}
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
            {selected && <span style={{ fontSize: 11, color: 'var(--oa-accent)' }}>已选择服务器资源，真实值由服务器注入。</span>}
          </div>
        </div>

        {!!candidates.length && (
          <div style={{ borderTop: '1px solid var(--oa-line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div className="oa-hint">可一键切换为以下在线服务器资源：</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.map(resource => (
                <button
                  key={resource.id}
                  type="button"
                  aria-label={`使用${resource.name}替换 ${item.key}`}
                  disabled={item.resource_id === resource.id}
                  className={`oa-btn oa-btn-sm ${item.resource_id === resource.id ? 'oa-btn-accent-soft' : ''}`}
                  onClick={() => update(index, { ...item, value: '', value_source: 'resource', resource_id: resource.id })}
                >
                  {item.resource_id === resource.id ? '✓ ' : '改用 '}
                  {resource.name}
                </button>
              ))}
            </div>
            {selected && (
              <div style={{ background: 'var(--oa-paper)', borderRadius: 8, padding: 8, fontSize: 11.5, color: 'var(--oa-muted)' }}>
                <div>
                  {selected.env_preview?.[item.key] && selected.env_preview[item.key] !== '[REDACTED]'
                    ? selected.env_preview[item.key]
                    : '连接凭据由服务器安全提供'}
                </div>
                {resourceMigrationNote(selected) && <div style={{ marginTop: 4 }}>{resourceMigrationNote(selected)}</div>}
              </div>
            )}
          </div>
        )}

        {item.description && (
          <details style={{ fontSize: 12, color: 'var(--oa-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>用途与来源说明</summary>
            <p style={{ margin: '6px 0 0' }}>{item.description}</p>
            {original?.source_label && <p style={{ margin: '4px 0 0' }}>{original.source_label}</p>}
          </details>
        )}

        {(needsConnectionDecision(item) || item.local_connection_confirmed) && (
          <div role="note" className="oa-alert oa-alert-warn" style={{ fontSize: 12 }}>
            <div>这个连接指向容器自己，部署后不能连接你电脑上的服务。请选择上面的服务器资源，或填写服务器能访问的地址。</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!item.local_connection_confirmed}
                onChange={e => update(index, { ...item, local_connection_confirmed: e.target.checked })}
              />
              <span>只有该服务确实和应用放在同一个容器内时，才勾选保留此连接</span>
            </label>
          </div>
        )}
      </article>
    )
  }

  const indexedConfigs = configs.map((item, index) => ({ item, index }))
  const primaryConfigs = compact ? indexedConfigs : indexedConfigs.filter(({ item }) => !isContainerDefaultConfig(item))
  const containerDefaultConfigs = compact ? [] : indexedConfigs.filter(({ item }) => isContainerDefaultConfig(item))

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="应用配置对照">
      {!compact && (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--oa-line)',
            background: 'var(--oa-panel)',
            padding: '12px 14px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>核对最终部署配置与服务器资源</h3>
            <p className="oa-hint" style={{ margin: '3px 0 0' }}>
              左侧为原值/建议值，右侧为最终部署生效值；支持一键绑定匹配的服务器资源。密码与密钥仅在本机核对，不会发给 AI。
            </p>
          </div>
          <button
            type="button"
            className="oa-btn oa-btn-sm"
            style={{ color: 'var(--oa-accent)' }}
            onClick={() => onChange([...configs, { key: '', value: '', description: '', value_source: 'manual' }])}
          >
            ＋ 添加环境变量
          </button>
        </div>
      )}

      {configs.length === 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 20, textAlign: 'center', color: 'var(--oa-muted)' }}>
          这个应用暂时没有需要填写的配置，可以直接继续部署。
        </div>
      )}

      {configs.length > 0 && primaryConfigs.length === 0 && (
        <div className="oa-alert oa-alert-ok">
          ✓ 当前应用无需额外配置外部数据库或密钥；容器运行端口与监听地址已自动适配，可直接部署。
        </div>
      )}

      {primaryConfigs.map(({ item, index }) => renderConfigCard(item, index))}

      {containerDefaultConfigs.length > 0 && (
        <details style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 12, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--oa-muted)' }}>
            容器基础参数（已自动适配，通常无需修改 · {containerDefaultConfigs.length} 项：
            {containerDefaultConfigs.map(({ item }) => `${item.key}=${item.value}`).join('、')}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--oa-line)' }}>
            {containerDefaultConfigs.map(({ item, index }) => renderConfigCard(item, index))}
          </div>
        </details>
      )}

      {!compact && configs.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: '10px 14px', fontSize: 12 }} aria-label="配置更改汇总">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>部署前配置汇总</span>
            <span className="oa-hint">{replacements.length ? `已调整 ${replacements.length} 项配置或服务器资源` : '全部采用推荐默认值或应用原值'}</span>
          </div>
          {replacements.map((item, idx) => (
            <div key={`${item.key}-${idx}`} style={{ marginTop: 6, fontWeight: 500 }}>
              • {configName(item)} ({item.key}) → {resources.find(r => r.id === item.resource_id)?.name || `自定义值 (${item.value})`}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
