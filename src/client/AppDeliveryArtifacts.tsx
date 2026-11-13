import React, { useEffect, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppIcon, type AppIconName } from './AppIcon.tsx'

interface ArtifactMeta {
  title: string
  badge: string
  pillClass: string
  icon: AppIconName
  description: string
}

function getArtifactMeta(name: string): ArtifactMeta {
  if (name.endsWith('.tar') || name.includes('app.tar')) {
    return {
      title: '应用容器部署包',
      badge: 'Docker 源码镜像',
      pillClass: 'oa-pill-teal',
      icon: 'archive',
      description: '包含应用全部源码、运行时依赖、Dockerfile 与 CapRover 启动定义，用于服务器自动化构建与容器部署。',
    }
  }
  if (name.endsWith('.zip') || name.includes('skill')) {
    return {
      title: '智能体业务技能包',
      badge: 'AI 技能契约',
      pillClass: 'oa-pill-accent',
      icon: 'sparkle',
      description: '包含 SKILL.md、业务视图、只读与写入 API 契约定义，用于本地工作流智能体直接发现与免密安全调用。',
    }
  }
  if (name.includes('manifest')) {
    return {
      title: '应用契约元数据',
      badge: '部署清单',
      pillClass: '',
      icon: 'fileCode',
      description: '记录应用端口、环境变量模板、数据库卷映射与基础服务依赖的标准清单，保障多环境一致交付。',
    }
  }
  if (name.includes('summary')) {
    return {
      title: '分析与改造摘要',
      badge: '构建报告',
      pillClass: 'oa-pill-warn',
      icon: 'file',
      description: '记录 AI 全景摸底结果、代码架构识别、依赖库替换与交付物哈希快照的结构化摘要报告。',
    }
  }
  return {
    title: name,
    badge: '交付产物',
    pillClass: '',
    icon: 'diamond',
    description: '平台应用交付产物与运行时支撑资源文件。',
  }
}

export function AppDeliveryArtifacts({
  api,
  contextId,
  slug,
  onVerified,
}: {
  api: OpcApi
  contextId: string
  slug: string
  onVerified?: () => void
}) {
  const [job, setJob] = useState<AppDeliveryJob | null>(null)
  const [message, setMessage] = useState('')
  const [enablingSkill, setEnablingSkill] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .appList(contextId)
      .then(raw => {
        if (!alive) return
        const jobs = JSON.parse(raw) as AppDeliveryJob[]
        const matched = jobs.find(j => j.slug === slug && j.artifactHash) || null
        setJob(matched)
        if (!matched) setMessage('本机尚无该应用的交付包记录')
      })
      .catch(e => {
        if (alive) setMessage(String(e))
      })
    return () => {
      alive = false
    }
  }, [api, contextId, slug])

  const artifacts = Object.entries(job?.artifacts || {})

  const handleExport = async (name: string) => {
    if (!job) return
    try {
      if (api.appSaveLocalArtifact) {
        const res = JSON.parse(await api.appSaveLocalArtifact(job.id, name, contextId))
        setMessage(`已导出至下载目录：${res.path || res.filename || name}`)
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
        setMessage(`已导出文件：${file.filename}`)
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
                实际交付文件
              </span>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>应用核心交付资产</span>
            </div>
            <p className="oa-hint" style={{ margin: '4px 0 0' }}>
              由 AI 自动构建与改造生成的标准平台交付包，包含容器镜像源码包、OpenAPI 业务技能契约与部署元数据。
            </p>
          </div>
          {job && (
            <button
              type="button"
              disabled={enablingSkill}
              className="oa-btn oa-btn-sm oa-btn-primary"
              onClick={async () => {
                setEnablingSkill(true)
                setMessage('正在校验实际部署及只读业务能力…')
                try {
                  await api.appVerify(job.id, contextId)
                  setMessage('业务验证通过，本地应用技能已成功启用')
                  onVerified?.()
                } catch (e) {
                  setMessage(String(e))
                } finally {
                  setEnablingSkill(false)
                }
              }}
            >
              <AppIcon name={enablingSkill ? 'refresh' : 'sparkle'} size={13} className={enablingSkill ? 'oa-spin' : ''} />
              <span>{enablingSkill ? '正在校验…' : '验证并启用本地技能'}</span>
            </button>
          )}
        </div>

        {job?.artifactHash && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--oa-line)', fontSize: 12 }}>
            <span className="oa-hint">交付摘要哈希：</span>
            <button
              type="button"
              title="点击复制完整哈希"
              className="oa-btn oa-btn-xs oa-mono"
              onClick={() => {
                void navigator.clipboard?.writeText(job.artifactHash || '')
                setMessage('已复制完整交付摘要哈希')
              }}
            >
              <AppIcon name="shield" size={11} />
              <span>{job.artifactHash.slice(0, 24)}…</span>
              <AppIcon name="copy" size={11} />
            </button>
          </div>
        )}
      </div>

      {message && (
        <div role="status" className="oa-alert oa-alert-info" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{message}</span>
          <button type="button" className="oa-btn-link" onClick={() => setMessage('')}>
            关闭
          </button>
        </div>
      )}

      {artifacts.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {artifacts.map(([name, filePath]) => {
            const meta = getArtifactMeta(name)
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
                        setMessage(`已复制 ${name} 的实际文件路径`)
                      }}
                    >
                      <AppIcon name="copy" size={11} /> 复制路径
                    </button>
                    <button type="button" className="oa-btn oa-btn-xs oa-btn-accent-soft" onClick={() => void handleExport(name)}>
                      <AppIcon name="archive" size={11} /> 导出文件
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
          暂无交付文件快照
        </div>
      )}
    </section>
  )
}
