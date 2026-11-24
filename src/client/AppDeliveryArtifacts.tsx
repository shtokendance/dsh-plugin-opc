import React, { useEffect, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { translate, useI18n, type ClientLocale } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'

interface ArtifactMeta {
  title: string
  badge: string
  pillClass: string
  icon: AppIconName
  description: string
}

function getArtifactMeta(name: string, locale: ClientLocale): ArtifactMeta {
  if (name.endsWith('.tar') || name.includes('app.tar')) {
    return {
      title: translate(locale, "apps.artifacts.appContainerBundle"),
      badge: translate(locale, "apps.artifacts.dockerSource"),
      pillClass: 'oa-pill-teal',
      icon: 'archive',
      description: translate(locale, "apps.artifacts.containsSourceCodeDependenciesDockerfileAn"),
    }
  }
  if (name.endsWith('.zip') || name.includes('skill')) {
    return {
      title: translate(locale, "apps.artifacts.agentSkillPackage"),
      badge: translate(locale, "apps.artifacts.aiSkillContract"),
      pillClass: 'oa-pill-accent',
      icon: 'sparkle',
      description: translate(locale, "apps.artifacts.containsSkillMdViewSpecsAnd"),
    }
  }
  if (name.includes('manifest')) {
    return {
      title: translate(locale, "apps.artifacts.appContractMetadata"),
      badge: translate(locale, "apps.artifacts.manifest"),
      pillClass: '',
      icon: 'fileCode',
      description: translate(locale, "apps.artifacts.definesPortsEnvTemplatesVolumeMounts"),
    }
  }
  if (name.includes('summary')) {
    return {
      title: translate(locale, "apps.artifacts.analysisAndAdaptationSummary"),
      badge: translate(locale, "apps.artifacts.buildReport"),
      pillClass: 'oa-pill-warn',
      icon: 'file',
      description: translate(locale, "apps.artifacts.structuredReportOfAiAnalysisArchitecture"),
    }
  }
  return {
    title: name,
    badge: translate(locale, "apps.artifacts.artifact"),
    pillClass: '',
    icon: 'diamond',
    description: translate(locale, "apps.artifacts.platformAppDeliveryArtifactAndRuntime"),
  }
}

export function AppDeliveryArtifacts({
  api,
  contextId,
  slug,
  version,
  onOpenVerification,
}: {
  api: OpcApi
  contextId: string
  slug: string
  version?: number
  onOpenVerification: (job: AppDeliveryJob) => void
}) {
  const { locale, t } = useI18n()
  const [job, setJob] = useState<AppDeliveryJob | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    api
      .appList(contextId)
      .then(raw => {
        if (!alive) return
        const jobs = JSON.parse(raw) as AppDeliveryJob[]
        const matched = jobs.find(j => j.slug === slug && j.published && j.version === version && j.artifactHash) ?? null
        setJob(matched)
        if (!matched) setMessage(t("apps.artifacts.noLocalDeliveryPackageRecordFor"))
      })
      .catch(e => {
        if (alive) setMessage(String(e))
      })
    return () => {
      alive = false
    }
  }, [api, contextId, slug, version, t])

  const artifacts = Object.entries(job?.artifacts || {})

  const handleExport = async (name: string) => {
    if (!job) return
    try {
      if (api.appSaveLocalArtifact) {
        const res = JSON.parse(await api.appSaveLocalArtifact(job.id, name, contextId))
        setMessage(t("apps.artifacts.exportedTo", { path: res.path || res.filename || name }))
        return
      }
      if (api.appLocalArtifact) {
        const file = JSON.parse(await api.appLocalArtifact(job.id, name, contextId)) as { filename: string; base64: string }
        const bytes = Uint8Array.from(atob(file.base64), ch => ch.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
        const a = document.createElement('a')
        a.href = url
        a.download = file.filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setMessage(t("apps.artifacts.exported", { file: file.filename }))
      }
    } catch (e) {
      setMessage(String(e))
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="oa-pill oa-pill-accent">
                <AppIcon name="archive" size={12} />
                {t("apps.artifacts.deliveryArtifacts")}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t("apps.artifacts.coreDeliveryAssets")}</span>
            </div>
            <p className="oa-hint" style={{ margin: '4px 0 0' }}>
              {t("apps.artifacts.standardDeliveryBundleGeneratedByAi")}
            </p>
          </div>
          {job && (
            <button
              type="button"
              className="oa-btn oa-btn-sm oa-btn-primary"
              onClick={() => onOpenVerification(job)}
            >
              <AppIcon name="sparkle" size={13} />
              <span>{t("apps.artifacts.verificationAndSkillSettings")}</span>
            </button>
          )}
        </div>

        {job?.artifactHash && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--oa-line)', fontSize: 12 }}>
            <span className="oa-hint">{t("apps.artifacts.artifactSha256")}</span>
            <button
              type="button"
              title={t("apps.artifacts.clickToCopyFullHash")}
              className="oa-btn oa-btn-xs oa-mono"
              onClick={() => {
                void navigator.clipboard?.writeText(job.artifactHash || '')
                setMessage(t("apps.artifacts.copiedFullArtifactHash"))
              }}
            >
              <AppIcon name="shield" size={11} />
              <span>{job.artifactHash.slice(0, 24)}…</span>
              <AppIcon name="copy" size={11} />
            </button>
          </div>
        )}
      </div>

      <NoticeModal
        open={Boolean(message)}
        variant="info"
        message={message}
        onClose={() => setMessage('')}
      />

      {artifacts.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {artifacts.map(([name, filePath]) => {
            const meta = getArtifactMeta(name, locale)
            return (
              <div key={name} className="oa-subcard">
                <div className="oa-subcard-head" style={{ flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`oa-pill ${meta.pillClass}`}>
                      <AppIcon name={meta.icon} size={11} />
                      {meta.badge}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{meta.title}</span>
                    <span className="oa-mono oa-hint">({name})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="oa-btn oa-btn-xs"
                      onClick={() => {
                        void navigator.clipboard?.writeText(filePath)
                        setMessage(t("apps.artifacts.copiedFilePathFor", { name }))
                      }}
                    >
                      <AppIcon name="copy" size={11} /> {t("apps.artifacts.copyPath")}
                    </button>
                    <button type="button" className="oa-btn oa-btn-xs oa-btn-accent-soft" onClick={() => void handleExport(name)}>
                      <AppIcon name="archive" size={11} /> {t("apps.artifacts.export")}
                    </button>
                  </div>
                </div>
                <div className="oa-hint">{meta.description}</div>
                <div
                  className="oa-mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 9px',
                    borderRadius: 7,
                    background: 'var(--oa-paper)',
                    border: '1px solid var(--oa-line)',
                    fontSize: 11,
                    color: 'var(--oa-muted)',
                    wordBreak: 'break-all',
                  }}
                >
                  <AppIcon name="folder" size={12} />
                  <span>{filePath}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ border: '1px dashed var(--oa-line-strong)', borderRadius: 12, padding: 28, textAlign: 'center', color: 'var(--oa-muted)' }}>
          {t("apps.artifacts.noArtifactSnapshots")}
        </div>
      )}
    </section>
  )
}
