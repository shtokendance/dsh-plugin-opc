import type { AppConfigItem, AppDeliveryJob } from './api.ts'

export interface ConfigDraftRow {
  key: string
  value?: string
  resource_id?: string
  local_connection_confirmed?: boolean
  value_source?: string
  secret?: boolean
}

export interface SourceConfigurationFile {
  path: string
  fields: { key: string; value: string }[]
  is_example?: boolean
}

export interface SourceConfiguration {
  files: SourceConfigurationFile[]
  references: string[]
}

export interface ConfigDraftSnapshot {
  artifactHash?: string
  rows?: ConfigDraftRow[]
  originalValues?: Record<string, string>
  versionNote?: string
  storageBindings?: Record<string, string>
  sourceConfiguration?: SourceConfiguration
}

export const CONTAINER_DEFAULT_KEYS = new Set(['PORT', 'HOST', 'BIND_HOST', 'LISTEN_HOST', 'NODE_ENV'])

const BIND_HOST_KEYS = new Set(['HOST', 'BIND_HOST', 'LISTEN_HOST'])

export function isContainerDefaultConfig(item: AppConfigItem): boolean {
  return CONTAINER_DEFAULT_KEYS.has((item.key || '').toUpperCase()) && !needsConnectionDecision(item)
}

export function needsConnectionDecision(item: AppConfigItem): boolean {
  if (item.resource_id) return false
  const upper = (item.key || '').toUpperCase()
  if (['HOST', 'PORT', 'BIND_HOST', 'LISTEN_HOST'].includes(upper)) return false
  if (!/URL|URI|DSN|HOST|ENDPOINT|CONNECTION|SERVER/i.test(item.key || '')) return false
  return (
    /(?:^|:\/\/|@|tcp\(|(?:host|server)\s*=)(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/,;)]|$)/i.test(
      (item.value || '').trim(),
    ) && !item.local_connection_confirmed
  )
}

export function needsContainerBindWarning(item: AppConfigItem, original?: AppConfigItem): boolean {
  if (item.resource_id) return false
  if (!BIND_HOST_KEYS.has((item.key || '').toUpperCase())) return false
  const candidate =
    item.value ||
    (item.value_source !== 'manual' ? original?.original_value || '' : '') ||
    (!item.value ? original?.app_default || item.app_default || '' : '')
  return /^(?:127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/i.test(candidate.trim())
}

function configSortRank(item: AppConfigItem): number {
  const missingRequired =
    Boolean(item.required) &&
    item.key !== 'PORT' &&
    !item.resource_id &&
    !item.value &&
    !item.has_value &&
    !item.has_original_value
  if (missingRequired || needsConnectionDecision(item) || needsContainerBindWarning(item, item)) return 0
  if (item.required) return 1
  return isContainerDefaultConfig(item) ? 3 : 2
}

/**
 * Build initial/edited Step 3 runtime config items from a delivery job and persisted draft.
 * Base entries are sorted once so items never reorder while typing.
 */
export function mergeJobConfigs(
  job: AppDeliveryJob,
  draft?: ConfigDraftSnapshot | null,
  fallbackPort = 8080,
): { configs: AppConfigItem[]; originals: AppConfigItem[] } {
  const effectivePort = job.port ?? job.proposal?.contract?.runtime?.port ?? fallbackPort
  const originalValues = draft?.originalValues ?? {}
  const contractConfigs = new Map((job.proposal?.contract?.configs ?? []).map(c => [c.key, c]))

  const rawList: AppConfigItem[] = Array.isArray(job.runtime_configs)
    ? job.runtime_configs.map(c => ({ ...c }))
    : (job.proposal?.contract?.configs ?? []).map(c => ({
        key: c.key,
        value: c.secret ? '' : c.default ?? '',
        app_default: c.secret ? '' : c.app_default ?? '',
        description: c.description ?? '',
        required: Boolean(c.required),
        secret: Boolean(c.secret),
        has_value: Boolean(c.has_original_value || c.default),
        has_original_value: Boolean(c.has_original_value),
        value_source: c.has_original_value ? 'original' : 'manual',
        source_label: c.source?.path ? `来自原项目 ${c.source.path}` : undefined,
      }))

  const baseList: AppConfigItem[] = rawList.map(c => {
    const contractItem = contractConfigs.get(c.key)
    const origVal = originalValues[c.key]
    const appDefault = c.secret ? '' : c.app_default ?? contractItem?.app_default ?? ''
    const hasOrig = Boolean(c.has_original_value || c.value_source === 'original' || (origVal !== undefined && origVal !== ''))

    if (c.key === 'PORT') {
      return {
        ...c,
        value: String(effectivePort),
        original_value: origVal ?? (appDefault || String(effectivePort)),
        app_default: appDefault,
        secret: false,
        has_value: true,
        has_original_value: Boolean(origVal),
        value_source: 'manual',
      }
    }

    if (c.secret) {
      return {
        ...c,
        value: '',
        original_value: '',
        app_default: '',
        has_value: Boolean(c.has_value || hasOrig),
        has_original_value: hasOrig,
        value_source: hasOrig ? 'original' : 'manual',
      }
    }

    if (origVal !== undefined && origVal !== '') {
      return {
        ...c,
        value: origVal,
        original_value: origVal,
        app_default: appDefault,
        has_value: true,
        has_original_value: true,
        value_source: 'original',
      }
    }

    const fallbackVal = c.value ?? ''
    return {
      ...c,
      value: fallbackVal,
      original_value: '',
      app_default: appDefault,
      has_value: Boolean(fallbackVal || c.has_value),
      has_original_value: Boolean(c.has_original_value),
      value_source: c.value_source === 'original' && c.has_original_value ? 'original' : 'manual',
    }
  })

  const sortedBase = baseList
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => configSortRank(a.item) - configSortRank(b.item) || a.idx - b.idx)
    .map(({ item }) => item)

  const originals = sortedBase.map(item => ({ ...item }))
  if (!draft || !Array.isArray(draft.rows) || draft.rows.length === 0) {
    return { configs: sortedBase, originals }
  }

  const rowMap = new Map(draft.rows.map(row => [row.key, row]))
  const merged = sortedBase.map(item => {
    if (item.key === 'PORT') {
      rowMap.delete('PORT')
      return {
        ...item,
        value: String(effectivePort),
        resource_id: undefined,
        value_source: 'manual',
        has_value: true,
      }
    }
    const saved = rowMap.get(item.key)
    if (!saved) return item
    rowMap.delete(item.key)

    if (saved.resource_id) {
      return {
        ...item,
        value: '',
        resource_id: saved.resource_id,
        value_source: 'resource',
        local_connection_confirmed: saved.local_connection_confirmed === true,
      }
    }

    if (saved.value_source === 'manual') {
      const nextVal = saved.value ?? ''
      return {
        ...item,
        value: nextVal,
        resource_id: undefined,
        value_source: 'manual',
        local_connection_confirmed: saved.local_connection_confirmed === true,
      }
    }

    if (saved.value) {
      return {
        ...item,
        value: saved.value,
        resource_id: undefined,
        value_source: saved.value === item.original_value && item.has_original_value ? 'original' : 'manual',
        local_connection_confirmed: saved.local_connection_confirmed === true,
      }
    }

    return {
      ...item,
      local_connection_confirmed: saved.local_connection_confirmed === true,
    }
  })

  for (const extra of rowMap.values()) {
    if (!extra.key) continue
    merged.push({
      key: extra.key,
      value: extra.resource_id ? '' : extra.value ?? '',
      resource_id: extra.resource_id || undefined,
      secret: extra.secret === true,
      is_custom: true,
      value_source: extra.resource_id ? 'resource' : 'manual',
      local_connection_confirmed: extra.local_connection_confirmed === true,
      description: '',
    })
  }

  return { configs: merged, originals }
}

export function sanitizeConfigRowsForApi(
  configs: AppConfigItem[],
  options?: { forPublish?: boolean; lockedPort?: number },
): Array<{
  key: string
  value: string
  resource_id?: string
  has_value?: boolean
  value_source?: string
  secret?: boolean
  local_connection_confirmed?: boolean
}> {
  const rows: Array<{
    key: string
    value: string
    resource_id?: string
    has_value?: boolean
    value_source?: string
    secret?: boolean
    local_connection_confirmed?: boolean
  }> = []

  for (const c of configs) {
    const key = (c.key || '').trim()
    if (!key) continue

    const isPort = key === 'PORT' && options?.lockedPort !== undefined
    const value = isPort ? String(options!.lockedPort) : c.resource_id ? '' : c.value ?? ''

    if (options?.forPublish) {
      const keepBlankSecret =
        !c.resource_id &&
        !value &&
        ((c.has_value === true && c.value_source !== 'manual') || (c.has_original_value === true && c.value_source === 'original'))
      if (!c.required && !c.resource_id && !value && !keepBlankSecret) {
        continue
      }
    }

    const valueSource = c.resource_id
      ? 'resource'
      : !value && c.value_source && c.value_source !== 'manual'
        ? c.value_source
        : 'manual'

    rows.push({
      key,
      value,
      resource_id: isPort ? undefined : c.resource_id || undefined,
      has_value: !c.resource_id && !value && c.has_value === true && c.value_source !== 'manual' ? true : undefined,
      value_source: valueSource,
      ...(options?.forPublish || !c.secret ? {} : { secret: true }),
      local_connection_confirmed: c.local_connection_confirmed === true ? true : undefined,
    })
  }

  return rows
}

export function validateConfigsForPublish(configs: AppConfigItem[], expectedPort?: number): string | null {
  const seen = new Set<string>()
  for (const item of configs) {
    const key = (item.key || '').trim()
    if (!key) return '存在未填写变量名的配置项，请填写或删除空白行'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `配置变量名格式无效：${key}`
    if (seen.has(key)) return `存在重复的配置变量名：${key}`
    seen.add(key)

    if (key === 'PORT' && (item.resource_id || (item.value && expectedPort && item.value !== String(expectedPort)))) {
      return `PORT 必须与已确认的容器端口（${expectedPort}）一致，如需修改请返回上一步调整`
    }
    if (!item.resource_id && needsConnectionDecision(item)) {
      return `配置项 ${key} 当前指向本地回环地址（localhost / 127.0.0.1），请选用平台托管资源、填写可达主机地址，或明确勾选确认同容器运行`
    }
    const preservesOriginal =
      item.value_source === 'original' && Boolean(item.has_original_value || item.has_value)
    const preservesOnline = item.value_source !== 'manual' && Boolean(item.has_value)
    if (item.required && key !== 'PORT' && !item.resource_id && !item.value && !preservesOriginal && !preservesOnline) {
      return `请填写必填配置项：${key}，或选择匹配的平台托管资源`
    }
  }
  return null
}
