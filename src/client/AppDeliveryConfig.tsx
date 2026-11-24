import React, { useEffect, useId, useRef, useState } from 'react'
import type { AppConfigItem, ResourceSummary } from './api.ts'
import {
  isContainerDefaultConfig,
  needsConnectionDecision,
  needsContainerBindWarning,
  type ConfigPublishIssue,
} from './app-config-helpers.ts'
import { translate, useI18n, type ClientLocale, type MessageKey } from './i18n.tsx'

export { isContainerDefaultConfig, needsConnectionDecision, needsContainerBindWarning }

const ENV_NAME_KEYS: Record<string, MessageKey> = {
  DB_DSN: 'apps.config.env.DB_DSN',
  DATABASE_URL: 'apps.config.env.DATABASE_URL',
  CONNECTION_STRING: 'apps.config.env.CONNECTION_STRING',
  PGHOST: 'apps.config.env.PGHOST',
  PGPORT: 'apps.config.env.PGPORT',
  PGUSER: 'apps.config.env.PGUSER',
  PGPASSWORD: 'apps.config.env.PGPASSWORD',
  PGDATABASE: 'apps.config.env.PGDATABASE',
  REDIS_URL: 'apps.config.env.REDIS_URL',
  REDIS_HOST: 'apps.config.env.REDIS_HOST',
  REDIS_PORT: 'apps.config.env.REDIS_PORT',
  MONGODB_URI: 'apps.config.env.MONGODB_URI',
  MONGODB_URL: 'apps.config.env.MONGODB_URL',
  S3_ENDPOINT: 'apps.config.env.S3_ENDPOINT',
  S3_BUCKET: 'apps.config.env.S3_BUCKET',
  S3_ACCESS_KEY: 'apps.config.env.S3_ACCESS_KEY',
  S3_SECRET_KEY: 'apps.config.env.S3_SECRET_KEY',
  ALY_ACCESS_KEY_ID: 'apps.config.env.ALY_ACCESS_KEY_ID',
  ALY_ACCESS_KEY_SECRET: 'apps.config.env.ALY_ACCESS_KEY_SECRET',
  ALY_ORG_ID: 'apps.config.env.ALY_ORG_ID',
  ALY_REGION_ID: 'apps.config.env.ALY_REGION_ID',
  ALY_ENDPOINT: 'apps.config.env.ALY_ENDPOINT',
  HOST: 'apps.config.env.HOST',
  BIND_HOST: 'apps.config.env.BIND_HOST',
  LISTEN_HOST: 'apps.config.env.LISTEN_HOST',
  PORT: 'apps.config.env.PORT',
  NODE_ENV: 'apps.config.env.NODE_ENV',
  PUBLIC_ORIGIN: 'apps.config.env.PUBLIC_ORIGIN',
  ALLOW_PUBLIC_REGISTRATION: 'apps.config.env.ALLOW_PUBLIC_REGISTRATION',
}

export const configName = (item: AppConfigItem, locale: ClientLocale = 'zh') =>
  (ENV_NAME_KEYS[item.key] ? translate(locale, ENV_NAME_KEYS[item.key]) : undefined) ||
  item.description?.split(/[。；\n]/)[0] ||
  item.key ||
  translate(locale, "apps.config.newConfig")

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
    return translate(locale, "apps.config.migrationNoteSwitchingConnectsToThe")
  }
  if (/redis|memcache/.test(type)) {
    return translate(locale, "apps.config.confirmUsageFirstRebuildableCachesUsually")
  }
  if (/s3|minio|oss|cos|storage/.test(type)) {
    return translate(locale, "apps.config.migrationNoteNewlyUploadedFilesWill")
  }
  return ''
}

function defaultDisplayValue(item: AppConfigItem, original: AppConfigItem | undefined, lockedPort: number | undefined, locale: ClientLocale): string {
  if (lockedPort !== undefined && item.key === 'PORT') {
    if (original?.original_value) return original.original_value
    if (original?.app_default) return translate(locale, "apps.config.sourceDefault", { value: original.app_default })
    return translate(locale, "apps.config.matchesContainerPort", { port: lockedPort })
  }
  if (!original) return translate(locale, "apps.config.customNoAppDefault")
  if (original.resource_id) return translate(locale, "apps.config.providedBySelectedResource")
  if (original.value_source === 'generated') return translate(locale, "apps.config.generatedBySystem")
  const origText = original.original_value ?? original.value ?? ''
  if (origText) return origText
  if (original.app_default) return translate(locale, "apps.config.sourceDefault", { value: original.app_default })
  if (original.value_source === 'configured' && original.has_value) return translate(locale, "apps.config.keepCurrentVersion")
  return translate(locale, "apps.config.noDefault")
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
  const { locale, t } = useI18n()
  const configId = useId()
  const onlineRuntime = runtimeEditableKeys !== undefined

  const update = (index: number, value: AppConfigItem) =>
    onChange(configs.map((item, i) => (i === index ? value : item)))

  const removeCustom = (index: number) =>
    onChange(configs.filter((_, i) => i !== index))

  const getStatus = (item: AppConfigItem, original?: AppConfigItem, selected?: ResourceSummary) => {
    const isPortLocked = lockedPort !== undefined && item.key === 'PORT'
    if (isPortLocked) {
      return { label: t("apps.config.aligned"), tone: 'oa-pill-ok', changed: false }
    }
    if (onlineRuntime && item.resource_id) {
      return {
        label: t("apps.config.platformResource", { name: selected?.name || item.source_label || item.resource_id }),
        tone: 'oa-pill-accent',
        changed: false,
      }
    }
    if (onlineRuntime && original) {
      const changed = item.value !== original.value
      if (!item.value && item.required && (changed || !original.has_value)) {
        return { label: t("apps.config.required"), tone: 'oa-pill-warn', changed }
      }
      if (changed) return { label: item.value ? t("apps.config.modified") : t("apps.config.cleared"), tone: 'oa-pill-accent', changed }
      if (item.value || original.has_value) return { label: t("apps.config.keepOriginal"), tone: 'oa-pill-ok', changed }
      return { label: t("apps.config.unset"), tone: '', changed }
    }
    if (selected) {
      return { label: t("apps.config.platformResource", { name: selected.name }), tone: 'oa-pill-accent', changed: true }
    }
    if (!original) {
      return item.value
        ? { label: t("apps.config.custom"), tone: 'oa-pill-accent', changed: true }
        : { label: t("apps.config.required"), tone: 'oa-pill-warn', changed: true }
    }
    if (item.secret) {
      if (item.value_source === 'generated' && item.has_value) return { label: t("apps.config.generated"), tone: 'oa-pill-ok', changed: false }
      if (item.value_source === 'configured' && item.has_value) return { label: t("apps.config.keepCurrent"), tone: 'oa-pill-ok', changed: false }
      const preserved =
        !item.value &&
        ((item.value_source === 'original' && Boolean(original.has_original_value || original.has_value)) ||
          (item.value_source !== 'manual' && Boolean(original.has_value)))
      if (item.value) return { label: t("apps.config.modified"), tone: 'oa-pill-accent', changed: true }
      if (preserved) return { label: t("apps.config.keepOriginal"), tone: 'oa-pill-ok', changed: false }
      if (item.required) return { label: t("apps.config.required"), tone: 'oa-pill-warn', changed: false }
      return { label: t("apps.config.unset"), tone: '', changed: false }
    }
    const baseline = original.original_value ?? original.value ?? ''
    if (baseline) {
      if (item.value === baseline) {
        return {
          label: original.is_example_source ? t("apps.config.keepExample") : t("apps.config.keepOriginal"),
          tone: 'oa-pill-ok',
          changed: false,
        }
      }
      if (!item.value && item.required) {
        return { label: t("apps.config.required"), tone: 'oa-pill-warn', changed: true }
      }
      return { label: item.value ? t("apps.config.modified") : t("apps.config.cleared"), tone: 'oa-pill-accent', changed: true }
    }
    if (item.value) return { label: t("apps.config.overridden"), tone: 'oa-pill-accent', changed: true }
    if (original.app_default) return { label: t("apps.config.sourceDefault_2"), tone: 'oa-pill-ok', changed: false }
    if (item.required) return { label: t("apps.config.required"), tone: 'oa-pill-warn', changed: false }
    return { label: t("apps.config.omitWhenEmpty"), tone: '', changed: false }
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
                aria-label={t("apps.config.newConfigKey")}
                aria-invalid={keyIssue ? true : undefined}
                aria-describedby={keyIssue ? issueId : undefined}
                value={item.key}
                disabled={readOnly}
                placeholder={t("apps.config.envVarNameEGWebhook")}
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
            {item.required && <span className="oa-pill oa-pill-warn">{t("common.required")}</span>}
            {isPortLocked && <span className="oa-pill oa-pill-accent">{t("apps.config.syncedWithContainerPort")}</span>}
            {original?.is_example_source && <span className="oa-pill">{t("apps.config.example")}</span>}
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
                {t("apps.config.reset")}
              </button>
            )}
            {!original && !readOnly && (
              <button
                type="button"
                className="oa-btn oa-btn-xs oa-btn-danger"
                onClick={() => removeCustom(index)}
              >
                {t("apps.config.delete")}
              </button>
            )}
          </div>
          {keyIssue && <p id={issueId} className="oa-config-field-warning oa-config-key-warning">{keyIssue.message}</p>}
        </header>

        <div className="oa-grid-2" style={{ gap: 10, fontSize: 12 }}>
          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span>{t("apps.config.appDefault")}</span>
              {original?.source_label && <span className="oa-hint">{original.source_label}</span>}
            </div>
            <input
              aria-label={t("apps.config.originalValue", { key: item.key || t("apps.config.newItem") })}
              readOnly
              value={leftValue}
              title={leftValue}
              className="oa-input oa-mono oa-cfg-readonly"
            />
          </div>

          <div className="oa-field">
            <div className="oa-cfg-col-label">
              <span style={{ fontWeight: 600, color: 'var(--oa-ink)' }}>{t("apps.config.effectiveValue")}</span>
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
                  {group.length > 1 ? t("apps.config.manualInputForGroup") : t("apps.config.manualInput")}
                </button>
              )}
            </div>

            {isPortLocked ? (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={t("apps.config.value", { key: item.key })}
                  {...valueIssueProps}
                  readOnly
                  value={portValue}
                  className="oa-input oa-mono oa-cfg-readonly"
                />
              </div>
            ) : selected || (onlineRuntime && item.resource_id) ? (
              <input
                aria-label={t("apps.config.value", { key: item.key })}
                {...valueIssueProps}
                readOnly
                value={boundValue(item)}
                placeholder={t("apps.config.injectedBy", { name: selected?.name || item.source_label || item.resource_id || '', key: item.resource_key || item.key })}
                className="oa-input oa-cfg-readonly"
                style={{ color: 'var(--oa-accent)' }}
              />
            ) : (
              <div className="oa-cfg-input-wrap">
                <input
                  aria-label={t("apps.config.value", { key: item.key || t("apps.config.newItem") })}
                  {...valueIssueProps}
                  type="text"
                  disabled={!onlineRuntime && readOnly}
                  readOnly={onlineRuntime && !canEditRuntimeValue}
                  value={item.value}
                  placeholder={
                    onlineRuntime
                      ? item.required ? t("apps.config.enterValue") : t("apps.config.optional")
                      : item.value_source === 'generated'
                      ? t("apps.config.generatedEnterNewValueToReplace")
                      : hasOriginalSecret
                      ? t("apps.config.leaveEmptyToKeepOriginalEnter")
                      : original?.app_default
                        ? t("apps.config.leaveEmptyForDefaultOrEnter", { val: original.app_default })
                        : item.required
                          ? t("apps.config.enterValue")
                          : t("apps.config.optionalLeaveEmptyToOmit")
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
                  ? t("apps.config.orSelectAnAvailableResourceBelow", { msg: valueIssue.message })
                  : valueIssue.message}
              </p>
            )}
          </div>
        </div>

        {bindWarning && (
          <div role="note" className="oa-config-field-warning">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>
                {t("apps.config.listeningOn127001")}
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
                  {t("apps.config.setTo0000")}
                </button>
              )}
            </div>
          </div>
        )}

        {!skillDriven && (loopbackWarning || item.local_connection_confirmed) && (
          <div role="note" className="oa-config-field-warning">
            {valueIssue?.kind !== 'loopback' && (
              <div>
                {t("apps.config.thisConnectionPointsToLocalhostInside")}
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
                {t("apps.config.onlyCheckThisIfTheService")}
              </span>
            </label>
          </div>
        )}

        {!!candidates.length && !readOnly && (
          <div className="oa-cfg-resources">
            <span className="oa-hint">{t("apps.config.availableResources")}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.map(resource => (
                <button
                  key={resource.id}
                  type="button"
                  aria-label={t("apps.config.useFor", { name: resource.name, key: item.key })}
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
                  {item.resource_id === resource.id ? '✓ ' : group.length > 1 ? t("apps.config.useForGroup") : t("apps.config.use")}
                  {resource.name}
                </button>
              ))}
            </div>
            {selected && (
              <div style={{ background: 'var(--oa-paper)', borderRadius: 6, padding: '6px 8px', fontSize: 11.5, color: 'var(--oa-muted)', width: '100%' }}>
                <div>{t("apps.config.resource")} <code className="oa-mono">{selected.id}</code></div>
                <div>
                  {selected.env_preview?.[item.resource_key || item.key] &&
                    selected.env_preview[item.resource_key || item.key] !== '[REDACTED]'
                    ? selected.env_preview[item.resource_key || item.key]
                    : t("apps.config.providedByServer")}
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
            <summary style={{ cursor: 'pointer' }}>{t("apps.config.description")}</summary>
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t("apps.config.appConfiguration")}>
      {!compact && (
        <div className="oa-cfg-toolbar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 650 }}>{t("apps.config.runtimeEnvironmentVariables")}</h3>
              <span className="oa-pill">{t("apps.config.total", { count: configs.length })}</span>
              {requiredCount > 0 && <span className="oa-pill oa-pill-warn">{t("apps.config.required_2", { count: requiredCount })}</span>}
              {modifiedItems.length > 0 && (
                <span className="oa-pill oa-pill-accent">{t("apps.config.modified_2", { count: modifiedItems.length })}</span>
              )}
            </div>
            {!onlineRuntime && (
              <p className="oa-hint" style={{ margin: '3px 0 0' }}>
                {t("apps.config.emptyOrUnchangedItemsUseApp")}
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
              {t("apps.config.addEnvVar")}
            </button>
          )}
        </div>
      )}

      {configs.length === 0 && (
        <div className="oa-subcard" style={{ textAlign: 'center', padding: 18, color: 'var(--oa-muted)' }}>
          {t("apps.config.noRuntimeEnvironmentVariablesInThis")}
        </div>
      )}

      {configs.length > 0 && primaryConfigs.length === 0 && !hasContainerIssue && (
        <div className="oa-alert oa-alert-ok">
          {t("apps.config.noExternalDatabaseOrSecretConfiguration")}
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
            {t("apps.config.containerDefaults", { count: containerDefaultConfigs.length })}
            {containerDefaultConfigs.map(({ item }) => formatContainerSummary(item)).join(' · ')}
            {hasContainerIssue ? t("apps.config.actionNeeded") : ''}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--oa-line)' }}>
            {containerDefaultConfigs.map(({ item, index }) => renderConfigCard(item, index))}
          </div>
        </details>
      )}

      {!compact && configs.length > 0 && (
        <div className="oa-subcard" style={{ padding: '9px 12px', fontSize: 12 }} aria-label={t("apps.config.configurationChangesSummary")}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{t("apps.config.configurationChangeSummary")}</span>
            <span className="oa-hint">
              {onlineRuntime
                ? modifiedItems.length ? t("apps.config.pendingSave", { count: modifiedItems.length }) : t("apps.config.noChanges")
                : modifiedItems.length
                  ? t("apps.config.itemsModifiedDraftAutoSaved", { count: modifiedItems.length })
                  : t("apps.config.allUsingDefaultsOrOriginalValues")}
            </span>
          </div>
          {modifiedItems.map((item, idx) => {
            const target = item.resource_id
              ? t("apps.config.resource_2", { name: resources.find(r => r.id === item.resource_id)?.name || item.resource_id })
              : item.value || t("apps.config.cleared_2")
            return (
              <div key={`${item.key}-${idx}`} style={{ marginTop: 4, fontWeight: 500 }}>
                • {configName(item, locale)} (<code>{item.key || t("apps.config.unnamed")}</code>) → {target}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
