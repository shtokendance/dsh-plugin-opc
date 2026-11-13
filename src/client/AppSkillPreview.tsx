import React, { useEffect, useState } from 'react'
import type { AppDeliveryJob, OpcApi } from './api.ts'
import { AppIcon } from './AppIcon.tsx'

type Capability = { id?: string; purpose: string; method?: string; path: string; effect?: string }

export function AppSkillPreview({
  api,
  contextId,
  job,
}: {
  api: OpcApi
  contextId: string
  job: AppDeliveryJob
}) {
  const [packageData, setPackageData] = useState<{
    markdown: string
    contract?: { apis?: Capability[]; pages?: Capability[]; workflows?: unknown[] }
    sha256?: string
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setPackageData(null)
    setError('')
    if (job.status === 'ready' && job.artifactHash) {
      api
        .appSkillPreview(job.id, contextId)
        .then(raw => {
          const data = JSON.parse(raw)
          if (alive && data?.markdown) setPackageData(data)
        })
        .catch(e => {
          if (alive) setError(String(e))
        })
    }
    return () => {
      alive = false
    }
  }, [api, contextId, job.id, job.status, job.artifactHash])

  const contract = packageData?.contract || job.proposal?.contract
  const apis = contract?.apis || []
  const pages = contract?.pages || []
  const healthPath = job.proposal?.contract?.health?.path || '/healthz'
  const purposes = [...new Set([...apis.filter(a => a.path !== healthPath), ...pages].map(c => c.purpose).filter(Boolean))]

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="应用业务技能预览">
      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--oa-line)',
          background: 'var(--oa-panel)',
          padding: 14,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>部署后，AI 能帮你做什么</span>
            <code className="oa-code" style={{ background: 'var(--oa-accent-soft)', color: 'var(--oa-accent)', borderColor: 'var(--oa-accent-line)' }}>
              app-{job.slug}
            </code>
          </div>
          <p className="oa-hint" style={{ margin: '4px 0 0' }}>
            {packageData
              ? '已生成业务技能包。部署并完成业务验证后，可在任意对话中直接调用。'
              : error
                ? '实际技能包暂时无法读取，不能以分析计划代替最终技能。'
                : '正在读取实际技能包…'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="oa-pill">{apis.length} 项接口操作</span>
          <span className="oa-pill">{pages.length} 个业务页面</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="oa-alert oa-alert-danger">
          {error}
        </div>
      )}

      {!error && purposes.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="oa-hint" style={{ fontWeight: 600 }}>核心业务能力概览</div>
          <div className="oa-grid-2">
            {purposes.map(purpose => (
              <div
                key={purpose}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  borderRadius: 9,
                  border: '1px solid var(--oa-line)',
                  background: 'var(--oa-paper)',
                  padding: '8px 10px',
                  fontSize: 12,
                }}
              >
                <span style={{ color: 'var(--oa-accent)', marginTop: 2 }}>
                  <AppIcon name="sparkle" size={13} />
                </span>
                <span>{purpose}</span>
              </div>
            ))}
          </div>
          {!!apis.length && (
            <p className="oa-hint" style={{ margin: 0 }}>
              💡 调用方式：在对话中直接说「使用 <code className="oa-code">app-{job.slug}</code> 帮我……」。原有登录要求保留；涉及修改或外部写操作时 AI 会先向你确认。
            </p>
          )}
        </div>
      )}

      <details style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 14, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--oa-accent)' }}>
          查看全部业务能力与使用条件（{apis.length} 项接口操作，{pages.length} 个页面）
        </summary>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--oa-line)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apis.map((item, idx) => (
            <article key={item.id || `${item.path}-${idx}`} style={{ paddingBottom: 10, borderBottom: '1px solid var(--oa-line)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{item.purpose}</div>
                <span className={`oa-pill ${item.effect === 'read' ? 'oa-pill-ok' : 'oa-pill-warn'}`}>
                  {item.effect === 'read'
                    ? job.verification?.checks?.some(c => c.operation === item.id && c.passed)
                      ? '只读查询 · 已验证'
                      : '只读查询 · 待业务验证'
                    : '写操作 · 执行前需确认'}
                </span>
              </div>
              <div className="oa-mono" style={{ color: 'var(--oa-muted)', fontSize: 11.5, marginTop: 4, wordBreak: 'break-all' }}>
                {item.method || 'GET'} {job.url}
                {item.path}
              </div>
              <details style={{ marginTop: 6, color: 'var(--oa-muted)' }}>
                <summary style={{ cursor: 'pointer' }}>技术信息：参数、返回结果与认证</summary>
                <pre className="oa-mono" style={{ background: 'var(--oa-paper)', padding: 10, borderRadius: 8, overflow: 'auto', maxHeight: 220, marginTop: 6 }}>
                  {JSON.stringify(item, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {pages.map((page, i) => (
            <article key={`${page.path}-${i}`} style={{ paddingBottom: 10, borderBottom: '1px solid var(--oa-line)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{page.purpose}</div>
                <span className="oa-pill">页面交互 · 路径 {page.path}</span>
              </div>
              <div className="oa-hint" style={{ marginTop: 4 }}>需要浏览器能力；如应用要求登录，保留原登录方式。</div>
            </article>
          ))}
        </div>
      </details>

      {packageData && (
        <details style={{ borderRadius: 12, border: '1px solid var(--oa-line)', background: 'var(--oa-panel)', padding: 14, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--oa-muted)' }}>查看完整技能文件 (SKILL.md)</summary>
          <pre className="oa-mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--oa-paper)', padding: 12, borderRadius: 8, marginTop: 10, maxHeight: 280, overflow: 'auto' }}>
            {packageData.markdown}
          </pre>
          {packageData.sha256 && <div className="oa-hint oa-mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>文件校验：{packageData.sha256}</div>}
        </details>
      )}
    </section>
  )
}
