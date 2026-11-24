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
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const previewSize = 3
  const canExpand = items.length > previewSize || Boolean(children)
  return (
    <section className="oa-report-routes" aria-label={label}>
      <h4><AppIcon name={icon} size={14} /> {label}<span className="oa-pill">{t("apps.discovery.text", { n: count })}</span></h4>
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
      ) : <p className="oa-hint">{t("apps.discovery.no", { label })}</p>}
      {expanded && children}
      {canExpand && (
        <button type="button" className="oa-report-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t("apps.discovery.collapse", { label }) : t("apps.discovery.viewAll", { label, suffix: items.length > previewSize ? t("apps.discovery.text_2", { n: items.length }) : '' })}
        </button>
      )}
    </section>
  )
}

export function AppDiscoveryReport({ job }: { job: AppDeliveryJob }) {
  const { t } = useI18n()
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
    <section className="oa-bubble oa-discovery-report" aria-label={t("apps.discovery.appAnalysisReport")}>
      <header className="oa-report-header">
        <div><AppIcon name="sparkle" size={15} /><h3>{t("apps.discovery.appAnalysisReport")}</h3></div>
        <span>{job.name || job.slug}</span>
      </header>
      {hasFacts && (
        <dl className="oa-report-facts">
          {runtime && <div><dt>{t("apps.discovery.runtime")}</dt><dd className="oa-mono">{runtime}</dd></div>}
          {!!port && <div><dt>{t("apps.discovery.port")}</dt><dd className="oa-mono">{port}</dd></div>}
          {storage?.storage_type && <div><dt>{t("apps.discovery.storage")}</dt><dd>{storage.storage_type}</dd></div>}
          {!!stack?.frameworks?.length && <div><dt>{t("apps.discovery.frameworks")}</dt><dd>{stack.frameworks.join(' · ')}</dd></div>}
        </dl>
      )}
      {purpose && (
        <div className="oa-report-purpose">
          <h4>{t("apps.discovery.overview")}</h4>
          <p className={longPurpose && !purposeExpanded ? 'oa-report-purpose-preview' : ''}>{purpose}</p>
          {longPurpose && (
            <button type="button" className="oa-report-toggle" aria-expanded={purposeExpanded} onClick={() => setPurposeExpanded(!purposeExpanded)}>
              {purposeExpanded ? t("apps.discovery.collapseOverview") : t("apps.discovery.expandOverview")}
            </button>
          )}
        </div>
      )}
      <div className="oa-report-inventory">
        <ReportRoutes label={t("apps.discovery.pages")} icon="table" count={discovery?.pages_overview?.total ?? pages.length} items={pages} />
        <ReportRoutes label={t("apps.discovery.apis")} icon="plug" count={apiOverview?.total ?? apis.length} items={apis}>
          {apiOverview && (
            <div className="oa-report-api-meta oa-hint">
              <span>{t("apps.discovery.readWrite", { r: apiOverview.read_count ?? 0, w: apiOverview.write_count ?? 0 })}</span>
              {!!apiModules.length && <div>{apiModules.map(([module, count]) => <code key={module} className="oa-code">{module} · {String(count)}</code>)}</div>}
            </div>
          )}
        </ReportRoutes>
      </div>
      {hasDeployment && (
        <details className="oa-report-deployment">
          <summary>{t("apps.discovery.deploymentInfo")}</summary>
          <dl>
            {!!stack?.syntax_requirements?.length && <div><dt>{t("apps.discovery.versionReqs")}</dt><dd>{stack.syntax_requirements.join('、')}</dd></div>}
            {dockerfile && <div><dt>Dockerfile</dt><dd>{dockerfile}</dd></div>}
            {auth?.page_auth && <div><dt>{t("apps.discovery.pageAuth")}</dt><dd>{auth.page_auth}</dd></div>}
            {auth?.api_auth && <div><dt>{t("apps.discovery.apiAuth")}</dt><dd>{auth.api_auth}</dd></div>}
            {dataPlan && <div><dt>{t("apps.discovery.dataPlan")}</dt><dd>{dataPlan}</dd></div>}
            {!!mounts.length && (
              <div><dt>{t("apps.discovery.mounts")}</dt><dd><ul>{mounts.map((mount: { container_path: string; volume_name?: string; name?: string }) => (
                <li key={mount.container_path}><code className="oa-mono">{mount.container_path}</code>{(mount.volume_name || mount.name) && ` → ${mount.volume_name || mount.name}`}</li>
              ))}</ul></dd></div>
            )}
            {!!storage?.sqlite_databases?.length && (
              <div><dt>SQLite</dt><dd><ul>{storage.sqlite_databases.map((db: { path: string; size_mb: number; table_count: number; total_rows: number }) => (
                <li key={db.path}><code className="oa-mono">{db.path}</code>{t("apps.discovery.mbTablesRows", { mb: db.size_mb, tables: db.table_count, rows: db.total_rows })}</li>
              ))}</ul></dd></div>
            )}
            {!!adaptations?.length && <div><dt>{t("apps.discovery.adaptations")}</dt><dd><ul>{adaptations.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul></dd></div>}
          </dl>
        </details>
      )}
    </section>
  )
}
