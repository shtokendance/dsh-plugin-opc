import React, { useEffect, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'
import { useI18n, type ClientLocale } from './i18n.tsx'
import { NoticeModal } from './NoticeModal.tsx'

interface ArtifactMeta {
  title: string
  badge: string
  pillClass: string
  icon: AppIconName
  description: string
}

function getArtifactMeta(name: string, locale: ClientLocale): ArtifactMeta {
  const en = locale === 'en'
  if (name.endsWith('.tar') || name.includes('app.tar')) {
    return {
      title: en ? 'App Container Bundle' : '应用容器部署包',
      badge: en ? 'Docker Source' : 'Docker 源码镜像',
      pillClass: 'oa-pill-teal',
      icon: 'archive',
      description: en ? 'Contains source code, dependencies, Dockerfile, and CapRover definitions.' : '包含应用全部源码、运行时依赖、Dockerfile 与 CapRover 启动定义，用于服务器自动化构建与容器部署。',
    }
  }
  if (name.endsWith('.zip') || name.includes('skill')) {
    return {
      title: en ? 'Agent Skill Package' : '智能体业务技能包',
      badge: en ? 'AI Skill Contract' : 'AI 技能契约',
      pillClass: 'oa-pill-accent',
      icon: 'sparkle',
      description: en ? 'Contains SKILL.md, view specs, and read/write API contracts.' : '包含 SKILL.md、业务视图、只读与写入 API 契约定义，用于本地工作流智能体直接发现与免密安全调用。',
    }
  }
  if (name.includes('manifest')) {
    return {
      title: en ? 'App Contract Metadata' : '应用契约元数据',
      badge: en ? 'Manifest' : '部署清单',
      pillClass: '',
      icon: 'fileCode',
      description: en ? 'Defines ports, env templates, volume mounts, and resource dependencies.' : '记录应用端口、环境变量模板、数据库卷映射与基础服务依赖的标准清单，保障多环境一致交付。',
    }
  }
  if (name.includes('summary')) {
    return {
      title: en ? 'Analysis & Adaptation Summary' : '分析与改造摘要',
      badge: en ? 'Build Report' : '构建报告',
      pillClass: 'oa-pill-warn',
      icon: 'file',
      description: en ? 'Structured report of AI analysis, architecture detection, and artifact hashes.' : '记录 AI 全景摸底结果、代码架构识别、依赖库替换与交付物哈希快照的结构化摘要报告。',
    }
  }
  return {
    title: name,
    badge: en ? 'Artifact' : '交付产物',
    pillClass: '',
    icon: 'diamond',
    description: en ? 'Platform app delivery artifact and runtime support file.' : '平台应用交付产物与运行时支撑资源文件。',
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
  const { locale, tr } = useI18n()
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
        if (!matched) setMessage(tr('本机尚无该应用的交付包记录', 'No local delivery package record for this app'))
      })
      .catch(e => {
        if (alive) setMessage(String(e))
      })
    return () => {
      alive = false
    }
  }, [api, contextId, slug, version, tr])

  const artifacts = Object.entries(job?.artifacts || {})

  const handleExport = async (name: string) => {
    if (!job) return
    try {
      if (api.appSaveLocalArtifact) {
        const res = JSON.parse(await api.appSaveLocalArtifact(job.id, name, contextId))
        setMessage(tr('已导出至下载目录：{path}', 'Exported to: {path}', { path: res.path || res.filename || name }))
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
        setMessage(tr('已导出文件：{file}', 'Exported: {file}', { file: file.filename }))
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
                {tr('实际交付文件', 'Delivery Artifacts')}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{tr('应用核心交付资产', 'Core Delivery Assets')}</span>
            </div>
            <p className="oa-hint" style={{ margin: '4px 0 0' }}>
              {tr('由 AI 自动构建与改造生成的标准平台交付包，包含容器镜像源码包、OpenAPI 业务技能契约与部署元数据。', 'Standard delivery bundle generated by AI, including source archive, skill contract, and metadata.')}
            </p>
          </div>
          {job && (
            <button
              type="button"
              className="oa-btn oa-btn-sm oa-btn-primary"
              onClick={() => onOpenVerification(job)}
            >
              <AppIcon name="sparkle" size={13} />
              <span>{tr('业务验证与技能设置', 'Verification & Skill Settings')}</span>
            </button>
          )}
        </div>

        {job?.artifactHash && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--oa-line)', fontSize: 12 }}>
            <span className="oa-hint">{tr('交付摘要哈希：', 'Artifact SHA-256: ')}</span>
            <button
              type="button"
              title={tr('点击复制完整哈希', 'Click to copy full hash')}
              className="oa-btn oa-btn-xs oa-mono"
              onClick={() => {
                void navigator.clipboard?.writeText(job.artifactHash || '')
                setMessage(tr('已复制完整交付摘要哈希', 'Copied full artifact hash'))
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
                        setMessage(tr('已复制 {name} 的实际文件路径', 'Copied file path for {name}', { name }))
                      }}
                    >
                      <AppIcon name="copy" size={11} /> {tr('复制路径', 'Copy Path')}
                    </button>
                    <button type="button" className="oa-btn oa-btn-xs oa-btn-accent-soft" onClick={() => void handleExport(name)}>
                      <AppIcon name="archive" size={11} /> {tr('导出文件', 'Export')}
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
          {tr('暂无交付文件快照', 'No artifact snapshots')}
        </div>
      )}
    </section>
  )
}
