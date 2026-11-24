import React, { useState } from 'react'
import type { AppDeliveryJob } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { useI18n } from './i18n.tsx'

function displayText(text: string) {
  return text.replace(/(?:\\r)?\\n(?=\\[rn]|[\s\u3000-\u9fff#*–-]|$)/g, '\n').trim()
}

function ReportRoutes({ label, icon, count, items, children }: {
  label: string
  icon: AppIconName
  count: number
  items: { path: string; purpose: string; method?: string }[]
  children?: React.ReactNode
}) {
  const { tr } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const previewSize = 3
  const canExpand = items.length > previewSize || Boolean(children)
  return (
    <section className="oa-report-routes" aria-label={label}>
      <h4><AppIcon name={icon} size={14} /> {label}<span className="oa-pill">{tr('{n} 个', '{n}', { n: count })}</span></h4>
      {items.length ? (
        <ul className="oa-report-route-list">
          {(expanded ? items : items.slice(0, previewSize)).map((item, index) => (
            <li key={`${item.method ?? ''}-${item.path}-${index}`}>
              {item.method && <code className="oa-code oa-report-method">{item.method}</code>}
              <div>
                <code className="oa-mono">{item.path}</code>
                {item.purpose && <div className={`oa-hint ${canExpand && !expanded ? 'oa-report-route-preview' : ''}`}>{item.purpose}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="oa-hint">{tr('暂无{label}清单', 'No {label}', { label })}</p>}
      {expanded && children}
      {canExpand && (
        <button type="button" className="oa-report-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? tr('收起{label}', 'Collapse {label}', { label }) : tr('查看完整{label}{suffix}', 'View all {label}{suffix}', { label, suffix: items.length > previewSize ? tr('（{n} 项）', ' ({n})', { n: items.length }) : '' })}
        </button>
      )}
    </section>
  )
}

export function AppDiscoveryReport({ job }: { job: AppDeliveryJob }) {
  const { tr } = useI18n()
  const [purposeExpanded, setPurposeExpanded] = useState(false)
  const plan = job.proposal
  const discovery = plan?.discovery_report ?? job.discoveryReport
  const contract = plan?.contract
  const stack = discovery?.tech_stack
  const storage = discovery?.storage_and_database
  const auth = discovery?.auth_and_credentials
  const dockerfile = discovery?.foundation_and_container?.dockerfile_action
  const adaptations = discovery?.planned_adaptations
  const mounts = storage?.storage_mounts ?? contract?.storage_mounts ?? []
  const dataPlan = storage?.storage_migration_plan ?? contract?.data_plan?.summary
  const pages = discovery?.pages_overview?.items ?? contract?.pages ?? []
  const apis = discovery?.apis_overview?.items ?? contract?.apis ?? []
  const apiOverview = discovery?.apis_overview
  const apiModules = Object.entries(apiOverview?.modules ?? {})
  const purpose = displayText(discovery?.project_purpose || contract?.description || plan?.summary || '')
  const longPurpose = purpose.length > 100 || purpose.split('\n').length > 2
  const runtime = [stack?.language || contract?.runtime?.language, stack?.runtime_version || contract?.runtime?.version].filter(Boolean).join(' ')
  const port = stack?.container_port ?? contract?.runtime?.port ?? job.port
  const hasFacts = Boolean(runtime || port || storage?.storage_type || stack?.frameworks?.length)
  const hasDeployment = Boolean(auth?.page_auth || auth?.api_auth || dataPlan || storage?.sqlite_databases?.length || mounts.length || dockerfile || stack?.syntax_requirements?.length || adaptations?.length)
  return (
    <section className="oa-bubble oa-discovery-report" aria-label={tr('应用分析报告', 'App Analysis Report')}>
      <header className="oa-report-header">
        <div><AppIcon name="sparkle" size={15} /><h3>{tr('应用分析报告', 'App Analysis Report')}</h3></div>
        <span>{job.name || job.slug}</span>
      </header>
      {hasFacts && (
        <dl className="oa-report-facts">
          {runtime && <div><dt>{tr('运行时', 'Runtime')}</dt><dd className="oa-mono">{runtime}</dd></div>}
          {!!port && <div><dt>{tr('容器端口', 'Port')}</dt><dd className="oa-mono">{port}</dd></div>}
          {storage?.storage_type && <div><dt>{tr('存储', 'Storage')}</dt><dd>{storage.storage_type}</dd></div>}
          {!!stack?.frameworks?.length && <div><dt>{tr('核心框架', 'Frameworks')}</dt><dd>{stack.frameworks.join(' · ')}</dd></div>}
        </dl>
      )}
      {purpose && (
        <div className="oa-report-purpose">
          <h4>{tr('应用概况', 'Overview')}</h4>
          <p className={longPurpose && !purposeExpanded ? 'oa-report-purpose-preview' : ''}>{purpose}</p>
          {longPurpose && (
            <button type="button" className="oa-report-toggle" aria-expanded={purposeExpanded} onClick={() => setPurposeExpanded(!purposeExpanded)}>
              {purposeExpanded ? tr('收起应用概况', 'Collapse Overview') : tr('查看完整应用概况', 'Expand Overview')}
            </button>
          )}
        </div>
      )}
      <div className="oa-report-inventory">
        <ReportRoutes label={tr('业务页面', 'Pages')} icon="table" count={discovery?.pages_overview?.total ?? pages.length} items={pages} />
        <ReportRoutes label={tr('API 接口', 'APIs')} icon="plug" count={apiOverview?.total ?? apis.length} items={apis}>
          {apiOverview && (
            <div className="oa-report-api-meta oa-hint">
              <span>{tr('只读 {r} · 写入 {w}', 'Read {r} · Write {w}', { r: apiOverview.read_count ?? 0, w: apiOverview.write_count ?? 0 })}</span>
              {!!apiModules.length && <div>{apiModules.map(([module, count]) => <code key={module} className="oa-code">{module} · {String(count)}</code>)}</div>}
            </div>
          )}
        </ReportRoutes>
      </div>
      {hasDeployment && (
        <details className="oa-report-deployment">
          <summary>{tr('部署相关信息', 'Deployment Info')}</summary>
          <dl>
            {!!stack?.syntax_requirements?.length && <div><dt>{tr('版本要求', 'Version Reqs')}</dt><dd>{stack.syntax_requirements.join('、')}</dd></div>}
            {dockerfile && <div><dt>Dockerfile</dt><dd>{dockerfile}</dd></div>}
            {auth?.page_auth && <div><dt>{tr('页面鉴权', 'Page Auth')}</dt><dd>{auth.page_auth}</dd></div>}
            {auth?.api_auth && <div><dt>{tr('接口鉴权', 'API Auth')}</dt><dd>{auth.api_auth}</dd></div>}
            {dataPlan && <div><dt>{tr('数据计划', 'Data Plan')}</dt><dd>{dataPlan}</dd></div>}
            {!!mounts.length && (
              <div><dt>{tr('挂载', 'Mounts')}</dt><dd><ul>{mounts.map((mount: { container_path: string; volume_name?: string; name?: string }) => (
                <li key={mount.container_path}><code className="oa-mono">{mount.container_path}</code>{(mount.volume_name || mount.name) && ` → ${mount.volume_name || mount.name}`}</li>
              ))}</ul></dd></div>
            )}
            {!!storage?.sqlite_databases?.length && (
              <div><dt>SQLite</dt><dd><ul>{storage.sqlite_databases.map((db: { path: string; size_mb: number; table_count: number; total_rows: number }) => (
                <li key={db.path}><code className="oa-mono">{db.path}</code>{tr('（{mb} MB · {tables} 张表 · {rows} 条记录）', ' ({mb} MB · {tables} tables · {rows} rows)', { mb: db.size_mb, tables: db.table_count, rows: db.total_rows })}</li>
              ))}</ul></dd></div>
            )}
            {!!adaptations?.length && <div><dt>{tr('改造项', 'Adaptations')}</dt><dd><ul>{adaptations.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul></dd></div>}
          </dl>
        </details>
      )}
    </section>
  )
}
