import React, { useEffect, useId, useRef, useState } from 'react'
import type { AppConfigItem, ResourceSummary } from './api.ts'
import {
  isContainerDefaultConfig,
  needsConnectionDecision,
  needsContainerBindWarning,
  type ConfigPublishIssue,
} from './app-config-helpers.ts'
import { translatePair, useI18n, type ClientLocale } from './i18n.tsx'

export { isContainerDefaultConfig, needsConnectionDecision, needsContainerBindWarning }

const namesZh: Record<string, string> = {
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

const namesEn: Record<string, string> = {
  DB_DSN: 'Database Connection',
  DATABASE_URL: 'Database Connection',
  CONNECTION_STRING: 'Database Connection',
  PGHOST: 'PostgreSQL Host',
  PGPORT: 'PostgreSQL Port',
  PGUSER: 'PostgreSQL User',
  PGPASSWORD: 'PostgreSQL Password',
  PGDATABASE: 'PostgreSQL Database',
  REDIS_URL: 'Redis Connection',
  REDIS_HOST: 'Redis Host',
  REDIS_PORT: 'Redis Port',
  MONGODB_URI: 'MongoDB Connection',
  MONGODB_URL: 'MongoDB Connection',
  S3_ENDPOINT: 'Object Storage Endpoint',
  S3_BUCKET: 'Object Storage Bucket',
  S3_ACCESS_KEY: 'Object Storage Access Key',
  S3_SECRET_KEY: 'Object Storage Secret Key',
  ALY_ACCESS_KEY_ID: 'Alibaba Cloud AccessKey ID',
  ALY_ACCESS_KEY_SECRET: 'Alibaba Cloud AccessKey Secret',
  ALY_ORG_ID: 'Alibaba Cloud Organization',
  ALY_REGION_ID: 'Alibaba Cloud Region',
  ALY_ENDPOINT: 'Alibaba Cloud Endpoint',
  HOST: 'Listen Host',
  BIND_HOST: 'Bind Host',
  LISTEN_HOST: 'Listen Host',
  PORT: 'Application Port',
  NODE_ENV: 'Runtime Mode',
  PUBLIC_ORIGIN: 'Public Origin',
  ALLOW_PUBLIC_REGISTRATION: 'Public Registration Switch',
}

export const configName = (item: AppConfigItem, locale: ClientLocale = 'zh') =>
  (locale === 'en' ? namesEn[item.key] : namesZh[item.key]) ||
  item.description?.split(/[。；\n]/)[0] ||
  item.key ||
  translatePair(locale, '新增配置', 'New Config')

function resourceField(item: AppConfigItem, resource: ResourceSummary) {
  if (item.resource_key && resource.env_keys?.includes(item.resource_key)) return item.resource_key
  return resource.env_keys?.includes(item.key) ? item.key : undefined
}

function connectionType(resource?: ResourceSummary) {
  return (resource?.type || '').toLowerCase().replace('postgresql', 'postgres')
}

function groupedConnection(resource?: ResourceSummary) {
  return /^(?:postgres(?:ql)?|mysql|mariadb|sqlserver|redis)$/i.test(resource?.type || '')
}

function matches(item: AppConfigItem, resource: ResourceSummary) {
  if (!resourceField(item, resource)) return false
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

function resourceMigrationNote(resource: ResourceSummary, locale: ClientLocale) {
  const type = (resource.type || '').toLowerCase()
  if (/postgres|mysql|mariadb|sqlserver|mssql|mongo/.test(type)) {
    return translatePair(
      locale,
      '💡 迁移提醒：切换后将连接所选数据库，本机存量数据不会自动迁移；需核对目标表结构，初始化或迁移数据需另行确认。',
      'Migration note: switching connects to the selected database without automatically migrating local data; verify target schemas and handle initialization separately.',
    )
  }
  if (/redis|memcache/.test(type)) {
    return translatePair(
      locale,
      '请先确认用途：可重建缓存通常无需迁移；登录会话与业务状态需另行处理，不能直接丢弃。',
      'Confirm usage first: rebuildable caches usually do not need migration, while login sessions and business state must be handled separately.',
    )
  }
  if (/s3|minio|oss|cos|storage/.test(type)) {
    return translatePair(
      locale,
      '💡 迁移提醒：切换后新上传文件将持久保存在服务器存储桶中。',
      'Migration note: newly uploaded files will be persisted in the server storage bucket after switching.',
    )
  }
  return ''
}

function defaultDisplayValue(item: AppConfigItem, original: AppConfigItem | undefined, lockedPort: number | undefined, locale: ClientLocale): string {
  if (lockedPort !== undefined && item.key === 'PORT') {
    if (original?.original_value) return original.original_value
    if (original?.app_default) return translatePair(locale, `源码默认：${original.app_default}`, `Source default: ${original.app_default}`)
    return translatePair(locale, `与容器端口 ${lockedPort} 一致`, `Matches container port ${lockedPort}`)
  }
  if (!original) return translatePair(locale, '用户新增（无原应用默认值）', 'Custom (no app default)')
  if (original.resource_id) return translatePair(locale, '由所选资源提供', 'Provided by selected resource')
  if (original.value_source === 'generated') return translatePair(locale, '由系统生成', 'Generated by system')
  const origText = original.original_value ?? original.value ?? ''
  if (origText) return origText
  if (original.app_default) return translatePair(locale, `源码默认：${original.app_default}`, `Source default: ${original.app_default}`)
  if (original.value_source === 'configured' && original.has_value) return translatePair(locale, '（沿用当前版本）', '(Keep current version)')
  return translatePair(locale, '无默认值', 'No default')
}

export function AppDeliveryConfig({
  configs,
  allowNew = true,
  originals,
  resources,
  onChange,
  compact = false,
  lockedPort,
  readOnly = false,
  publishIssues,
  skillDriven = false,
  runtimeEditableKeys,
}: {
  configs: AppConfigItem[]
  allowNew?: boolean
  originals: AppConfigItem[]
  resources: ResourceSummary[]
  compact?: boolean
  lockedPort?: number
  readOnly?: boolean
  publishIssues?: ReadonlyMap<number, ConfigPublishIssue>
  skillDriven?: boolean
  runtimeEditableKeys?: ReadonlySet<string>
  onChange: (items: AppConfigItem[]) => void
}) {
  const { locale, tr } = useI18n()
  const configId = useId()
  const onlineRuntime = runtimeEditableKeys !== undefined

  const update = (index: number, value: AppConfigItem) =>
    onChange(configs.map((item, i) => (i === index ? value : item)))

  const removeCustom = (index: number) =>
    onChange(configs.filter((_, i) => i !== index))

  const getStatus = (item: AppConfigItem, original?: AppConfigItem, selected?: ResourceSummary) => {
    const isPortLocked = lockedPort !== undefined && item.key === 'PORT'
    if (isPortLocked) {
      return { label: tr('已对齐', 'Aligned'), tone: 'oa-pill-ok', changed: false }
    }
    if (onlineRuntime && item.resource_id) {
      return {
        label: tr('平台资源：{name}', 'Platform Resource: {name}', { name: selected?.name || item.source_label || item.resource_id }),
        tone: 'oa-pill-accent',
        changed: false,
      }
    }
    if (onlineRuntime && original) {
      const changed = item.value !== original.value
      if (!item.value && item.required && (changed || !original.has_value)) {
        return { label: tr('待填写', 'Required'), tone: 'oa-pill-warn', changed }
      }
      if (changed) return { label: item.value ? tr('已修改', 'Modified') : tr('已清空', 'Cleared'), tone: 'oa-pill-accent', changed }
      if (item.value || original.has_value) return { label: tr('沿用原值', 'Keep Original'), tone: 'oa-pill-ok', changed }
      return { label: tr('未设置', 'Unset'), tone: '', changed }
    }
    if (selected) {
      return { label: tr('平台资源：{name}', 'Platform Resource: {name}', { name: selected.name }), tone: 'oa-pill-accent', changed: true }
    }
    if (!original) {
      return item.value
        ? { label: tr('新增自定义', 'Custom'), tone: 'oa-pill-accent', changed: true }
        : { label: tr('待填写', 'Required'), tone: 'oa-pill-warn', changed: true }
    }
    if (item.secret) {
      if (item.value_source === 'generated' && item.has_value) return { label: tr('已生成', 'Generated'), tone: 'oa-pill-ok', changed: false }
      if (item.value_source === 'configured' && item.has_value) return { label: tr('沿用当前版本', 'Keep Current'), tone: 'oa-pill-ok', changed: false }
      const preserved =
        !item.value &&
        ((item.value_source === 'original' && Boolean(original.has_original_value || original.has_value)) ||
          (item.value_source !== 'manual' && Boolean(original.has_value)))
      if (item.value) return { label: tr('已修改', 'Modified'), tone: 'oa-pill-accent', changed: true }
      if (preserved) return { label: tr('沿用原值', 'Keep Original'), tone: 'oa-pill-ok', changed: false }
      if (item.required) return { label: tr('待填写', 'Required'), tone: 'oa-pill-warn', changed: false }
      return { label: tr('未设置', 'Unset'), tone: '', changed: false }
    }
    const baseline = original.original_value ?? original.value ?? ''
    if (baseline) {
      if (item.value === baseline) {
        return {
          label: original.is_example_source ? tr('沿用示例值', 'Keep Example') : tr('沿用原值', 'Keep Original'),
          tone: 'oa-pill-ok',
          changed: false,
        }
      }
      if (!item.value && item.required) {
        return { label: tr('待填写', 'Required'), tone: 'oa-pill-warn', changed: true }
      }
      return { label: item.value ? tr('已修改', 'Modified') : tr('已清空', 'Cleared'), tone: 'oa-pill-accent', changed: true }
    }
    if (item.value) return { label: tr('已覆盖', 'Overridden'), tone: 'oa-pill-accent', changed: true }
    if (original.app_default) return { label: tr('沿用源码默认', 'Source Default'), tone: 'oa-pill-ok', changed: false }
    if (item.required) return { label: tr('待填写', 'Required'), tone: 'oa-pill-warn', changed: false }
    return { label: tr('留空不注入', 'Omit When Empty'), tone: '', changed: false }
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
    const selected = resources.find(r => r.id === item.resource_id)
    const originalResource = resources.find(r => r.id === original?.resource_id)
    const connection = selected ?? originalResource
    const group = groupedConnection(connection)
      ? configs.filter(config => config.resource_id === connection?.id ||
          originals.some(row => row.key === config.key && row.resource_id === originalResource?.id && row.resource_id))
      : [item]
    const candidates = isPortLocked
      ? []
      : resources.filter(
          r =>
            (!groupedConnection(connection) || connectionType(connection) === connectionType(r)) &&
            matches(original || item, r) &&
            group.every(config => resourceField(config, r)) &&
            (r.type !== 'minio-app-storage' || configs.some(config => config.resource_id === r.id)),
        )
    const status = getStatus(item, original, selected)
    const bindWarning = !skillDriven && needsContainerBindWarning(item, original)
    const loopbackWarning = !skillDriven && needsConnectionDecision(item)
    const issue = publishIssues?.get(index)
    const keyIssue = issue?.kind === 'key' ? issue : undefined
    const valueIssue = issue?.kind === 'key' ? undefined : issue
    const issueId = `${configId}-issue-${index}`
    const valueIssueProps = valueIssue ? { 'aria-invalid': true, 'aria-describedby': issueId } : {}
    const showWarning = issue || bindWarning || loopbackWarning || status.tone === 'oa-pill-warn'
    const friendly = configName(item, locale)
    const leftValue = defaultDisplayValue(item, original, lockedPort, locale)
    const hasOriginalSecret = Boolean(item.secret && (
      (item.value_source === 'configured' && item.has_value) ||
      (item.value_source === 'original' && original?.has_original_value)
    ))
    const portValue = isPortLocked ? String(lockedPort) : item.value
    const canEditRuntimeValue = runtimeEditableKeys?.has(item.key)
    const boundValue = (config: AppConfigItem) => {
      if (onlineRuntime && config.effective_value !== undefined) return config.effective_value
      const resource = resources.find(r => r.id === config.resource_id)
      const preview = resource?.env_preview?.[config.resource_key || config.key]
      return preview && preview !== '[REDACTED]' ? preview : config.effective_value ?? ''
    }

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
                aria-label={tr('新增配置名称', 'New config key')}
                aria-invalid={keyIssue ? true : undefined}
                aria-describedby={keyIssue ? issueId : undefined}
                value={item.key}
                disabled={readOnly}
                placeholder={tr('环境变量名，如 WEBHOOK_URL', 'Env var name, e.g. WEBHOOK_URL')}
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
            {item.required && <span className="oa-pill oa-pill-warn">{tr('必填', 'Required')}</span>}
            {isPortLocked && <span className="oa-pill oa-pill-accent">{tr('与容器端口联动', 'Synced with container port')}</span>}
            {original?.is_example_source && <span className="oa-pill">{tr('示例模板', 'Example')}</span>}
          </div>

          <div className="oa-cfg-actions">
            <span className={`oa-pill ${status.tone}`}>{status.label}</span>
            {status.changed && original && !isPortLocked && !readOnly && (
              <button
                type="button"
                className="oa-btn-link"
                onClick={() => onChange(configs.map(config => {
                  const prior = group.includes(config) && originals.find(row => row.key === config.key)
                  return prior ? { ...prior, local_connection_confirmed: false } : config
                }))}
              >
                {tr('恢复默认', 'Reset')}
              </button>
            )}
            {!original && !readOnly && (
              <button
                type="button"
                className="oa-btn oa-btn-xs oa-btn-danger"
                onClick={() => removeCustom(index)}
              >
                {tr('删除', 'Delete')}
              </button>
            )}
          </div>
          {keyIssue && <p id={issueId} className="oa-config-field-warning oa-config-key-warning">{keyIssue.message}</p>}
        </header>

        <div className="oa-grid-2" style={{ gap: 10, fontSize: 12 }}>
          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span>{tr('应用内部默认值', 'App Default')}</span>
              {original?.source_label && <span className="oa-hint">{original.source_label}</span>}
            </div>
            <input
              aria-label={tr('{key} 原始值', '{key} original value', { key: item.key || tr('新增项', 'New item') })}
              readOnly
              value={leftValue}
              title={leftValue}
              className="oa-input oa-mono oa-cfg-readonly"
            />
          </div>

          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span style={{ fontWeight: 600, color: 'var(--oa-ink)' }}>{tr('部署生效值', 'Effective Value')}</span>
              {selected && !readOnly && (
                <button
                  type="button"
                  className="oa-btn-link"
                  onClick={() =>
                    onChange(configs.map(config => group.includes(config) ? {
                      ...config, value: boundValue(config), resource_id: undefined, resource_key: undefined, effective_value: undefined,
                      value_source: 'manual',
                    } : config))
                  }
                >
                  {group.length > 1 ? tr('整组改为手填', 'Manual input for group') : tr('改为手填', 'Manual input')}
                </button>
              )}
            </div>

            {isPortLocked ? (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={tr('{key} 配置值', '{key} value', { key: item.key })}
                  {...valueIssueProps}
                  readOnly
                  value={portValue}
                  className="oa-input oa-mono oa-cfg-readonly"
                />
              </div>
            ) : selected || (onlineRuntime && item.resource_id) ? (
              <input
                aria-label={tr('{key} 配置值', '{key} value', { key: item.key })}
                {...valueIssueProps}
                readOnly
                value={boundValue(item)}
                placeholder={tr(
                  '由「{name}」注入 · {key}',
                  'Injected by "{name}" · {key}',
                  { name: selected?.name || item.source_label || item.resource_id || '', key: item.resource_key || item.key },
                )}
                className="oa-input oa-cfg-readonly"
                style={{ color: 'var(--oa-accent)' }}
              />
            ) : (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={tr('{key} 配置值', '{key} value', { key: item.key || tr('新增项', 'New item') })}
                  {...valueIssueProps}
                  type="text"
                  disabled={!onlineRuntime && readOnly}
                  readOnly={onlineRuntime && !canEditRuntimeValue}
                  value={item.value}
                  placeholder={
                    onlineRuntime
                      ? item.required ? tr('请输入配置值', 'Enter value') : tr('可留空', 'Optional')
                      : item.value_source === 'generated'
                      ? tr('已生成，输入新值可替换', 'Generated; enter new value to replace')
                      : hasOriginalSecret
                      ? tr('留空沿用原值，输入新值则覆盖', 'Leave empty to keep original; enter to override')
                      : original?.app_default
                        ? tr('留空沿用源码默认 ({val})，或输入覆盖', 'Leave empty for default ({val}), or enter to override', { val: original.app_default })
                        : item.required
                          ? tr('请输入配置值', 'Enter value')
                          : tr('选填，留空则不注入该环境变量', 'Optional; leave empty to omit')
                  }
                  className={`oa-input oa-mono${onlineRuntime && !canEditRuntimeValue ? ' oa-cfg-readonly' : ''}`}
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
              </div>
            )}
            {valueIssue && (
              <p id={issueId} className="oa-config-field-warning">
                {valueIssue.kind === 'required' && candidates.length > 0
                  ? tr('{msg}，或选择下方可用的资源。', '{msg}, or select an available resource below.', { msg: valueIssue.message })
                  : valueIssue.message}
              </p>
            )}
          </div>
        </div>

        {bindWarning && (
          <div role="note" className="oa-config-field-warning">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>
                {tr(
                  '容器内监听 127.0.0.1 / localhost 将导致外部访问与健康检查失败，建议改为 0.0.0.0。',
                  'Listening on 127.0.0.1 / localhost inside the container will break external access and health checks. Use 0.0.0.0 instead.',
                )}
              </span>
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
                  {tr('一键改为 0.0.0.0', 'Set to 0.0.0.0')}
                </button>
              )}
            </div>
          </div>
        )}

        {!skillDriven && (loopbackWarning || item.local_connection_confirmed) && (
          <div role="note" className="oa-config-field-warning">
            {valueIssue?.kind !== 'loopback' && (
              <div>
                {tr(
                  '这个连接指向容器自己，部署后不能连接你电脑上的服务。请选择下方平台资源，或填写服务器可访问地址。',
                  'This connection points to localhost inside the container. Select a platform resource below or enter a server-reachable address.',
                )}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                disabled={readOnly}
                checked={!!item.local_connection_confirmed}
                onChange={e => update(index, { ...item, local_connection_confirmed: e.target.checked })}
              />
              <span>
                {tr(
                  '只有该服务确实和应用运行在同一容器内时，才勾选保留此连接',
                  'Only check this if the service actually runs inside the same container',
                )}
              </span>
            </label>
          </div>
        )}

        {!!candidates.length && !readOnly && (
          <div className="oa-cfg-resources">
            <span className="oa-hint">{tr('可绑平台资源：', 'Available resources:')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.map(resource => (
                <button
                  key={resource.id}
                  type="button"
                  aria-label={tr('使用{name}替换 {key}', 'Use {name} for {key}', { name: resource.name, key: item.key })}
                  disabled={item.resource_id === resource.id}
                  className={`oa-btn oa-btn-xs ${item.resource_id === resource.id ? 'oa-btn-accent-soft' : ''}`}
                  onClick={() => {
                    if (resource.type === 'minio-app-storage') {
                      onChange(
                        configs.map(config =>
                          resource.env_keys.includes(config.key)
                            ? { ...config, value: '', value_source: 'resource', resource_id: resource.id, resource_key: undefined }
                            : config,
                        ),
                      )
                      return
                    }
                    onChange(configs.map(config => group.includes(config) ? {
                      ...config, value: '', effective_value: undefined, value_source: 'resource', resource_id: resource.id,
                      resource_key: resourceField(config, resource),
                    } : config))
                  }}
                >
                  {item.resource_id === resource.id ? '✓ ' : group.length > 1 ? tr('整组改用 ', 'Use for group: ') : tr('改用 ', 'Use ')}
                  {resource.name}
                </button>
              ))}
            </div>
            {selected && (
              <div style={{ background: 'var(--oa-paper)', borderRadius: 6, padding: '6px 8px', fontSize: 11.5, color: 'var(--oa-muted)', width: '100%' }}>
                <div>{tr('资源', 'Resource')} <code className="oa-mono">{selected.id}</code></div>
                <div>
                  {selected.env_preview?.[item.resource_key || item.key] &&
                    selected.env_preview[item.resource_key || item.key] !== '[REDACTED]'
                    ? selected.env_preview[item.resource_key || item.key]
                    : tr('由服务器提供配置值', 'Provided by server')}
                </div>
                {resourceMigrationNote(selected, locale) && <div style={{ marginTop: 3 }}>{resourceMigrationNote(selected, locale)}</div>}
              </div>
            )}
          </div>
        )}

        {item.description && friendly === item.key && (
          <div className="oa-hint">{item.description}</div>
        )}
        {item.description && friendly !== item.key && item.description !== friendly && (
          <details style={{ fontSize: 11.5, color: 'var(--oa-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>{tr('用途说明', 'Description')}</summary>
            <p style={{ margin: '4px 0 0' }}>{item.description}</p>
          </details>
        )}
      </article>
    )
  }

  const indexedConfigs = configs.map((item, index) => ({ item, index }))
  const primaryConfigs = compact ? indexedConfigs : indexedConfigs.filter(({ item }) => !isContainerDefaultConfig(item))
  const containerDefaultConfigs = compact ? [] : indexedConfigs.filter(({ item }) => isContainerDefaultConfig(item))

  const hasContainerIssue = containerDefaultConfigs.some(({ item, index }) => {
    const orig = originals.find(o => o.key === item.key)
    if (publishIssues) return publishIssues.has(index) || (!skillDriven && needsContainerBindWarning(item, orig))
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={tr('应用配置对照', 'App Configuration')}>
      {!compact && (
        <div className="oa-cfg-toolbar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 650 }}>{tr('运行时环境变量', 'Runtime Environment Variables')}</h3>
              <span className="oa-pill">{tr('共 {count} 项', '{count} total', { count: configs.length })}</span>
              {requiredCount > 0 && <span className="oa-pill oa-pill-warn">{tr('必填 {count} 项', '{count} required', { count: requiredCount })}</span>}
              {modifiedItems.length > 0 && (
                <span className="oa-pill oa-pill-accent">{tr('已修改 {count} 项', '{count} modified', { count: modifiedItems.length })}</span>
              )}
            </div>
            {!onlineRuntime && (
              <p className="oa-hint" style={{ margin: '3px 0 0' }}>
                {tr(
                  '留空或保持不变将沿用应用默认值；修改仅在本次容器运行时生效，不改本地源码。应用配置值可在部署会话中核对。',
                  'Empty or unchanged items use app defaults. Changes apply only to the deployed container runtime.',
                )}
              </p>
            )}
          </div>
          {!readOnly && allowNew && (
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
              {tr('＋ 新增环境变量', '+ Add Env Var')}
            </button>
          )}
        </div>
      )}

      {configs.length === 0 && (
        <div className="oa-subcard" style={{ textAlign: 'center', padding: 18, color: 'var(--oa-muted)' }}>
          {tr('当前交付清单没有运行时环境变量。', 'No runtime environment variables in this delivery manifest.')}
        </div>
      )}

      {configs.length > 0 && primaryConfigs.length === 0 && !hasContainerIssue && (
        <div className="oa-alert oa-alert-ok">
          {tr('✓ 当前应用无需额外配置外部数据库或密钥；容器基础参数已就绪。', '✓ No external database or secret configuration required; container defaults are ready.')}
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
            {tr('容器基础参数（{count} 项：', 'Container defaults ({count}: ', { count: containerDefaultConfigs.length })}
            {containerDefaultConfigs.map(({ item }) => formatContainerSummary(item)).join(' · ')}
            {hasContainerIssue ? tr(' · 有配置待处理', ' · Action needed') : ''}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--oa-line)' }}>
            {containerDefaultConfigs.map(({ item, index }) => renderConfigCard(item, index))}
          </div>
        </details>
      )}

      {!compact && configs.length > 0 && (
        <div className="oa-subcard" style={{ padding: '9px 12px', fontSize: 12 }} aria-label={tr('配置更改汇总', 'Configuration Changes Summary')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{tr('配置变更摘要', 'Configuration Change Summary')}</span>
            <span className="oa-hint">
              {onlineRuntime
                ? modifiedItems.length ? tr('{count} 项待保存', '{count} pending save', { count: modifiedItems.length }) : tr('暂无修改', 'No changes')
                : modifiedItems.length
                  ? tr('已调整 {count} 项配置或平台资源 · 草稿自动保存', '{count} items modified · Draft auto-saved', { count: modifiedItems.length })
                  : tr('全部沿用应用默认值或原配置 · 草稿自动保存', 'All using defaults or original values · Draft auto-saved')}
            </span>
          </div>
          {modifiedItems.map((item, idx) => {
            const target = item.resource_id
              ? tr('平台资源「{name}」', 'Resource "{name}"', { name: resources.find(r => r.id === item.resource_id)?.name || item.resource_id })
              : item.value || tr('（已清空）', '(Cleared)')
            return (
              <div key={`${item.key}-${idx}`} style={{ marginTop: 4, fontWeight: 500 }}>
                • {configName(item, locale)} (<code>{item.key || tr('未命名', 'Unnamed')}</code>) → {target}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
