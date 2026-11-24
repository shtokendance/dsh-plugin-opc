import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { OpcApi } from './api.ts'
import { AppIcon } from './AppIcon.tsx'

export interface NormalizedMcpTool {
  name: string
  description: string
  risk?: string
  requireApproval: boolean
  inputSchema?: Record<string, unknown>
}

interface SchemaProperty {
  name: string
  type: string
  description: string
  required: boolean
}

export function normalizeMcpTools(rawTools: unknown): NormalizedMcpTool[] {
  if (!Array.isArray(rawTools)) return []
  return rawTools
    .map(tool => {
      if (typeof tool === 'string') {
        return { name: tool, description: '', requireApproval: false }
      }
      if (!tool || typeof tool !== 'object') return null
      const record = tool as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name : ''
      if (!name) return null
      const schemaCandidate = record.input_schema ?? record.inputSchema
      const inputSchema = schemaCandidate && typeof schemaCandidate === 'object' && !Array.isArray(schemaCandidate)
        ? schemaCandidate as Record<string, unknown>
        : undefined
      return {
        name,
        description: typeof record.description === 'string' ? record.description : '',
        risk: typeof record.risk === 'string' && record.risk ? record.risk : undefined,
        requireApproval: Boolean(record.require_approval),
        inputSchema,
      }
    })
    .filter((tool): tool is NormalizedMcpTool => tool !== null)
}

function readSchemaProperties(schema?: Record<string, unknown>): SchemaProperty[] {
  if (!schema || typeof schema.properties !== 'object' || !schema.properties || Array.isArray(schema.properties)) {
    return []
  }
  const requiredSet = new Set(Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === 'string') : [])
  return Object.entries(schema.properties as Record<string, unknown>).map(([name, rawSpec]) => {
    const spec = rawSpec && typeof rawSpec === 'object' && !Array.isArray(rawSpec) ? rawSpec as Record<string, unknown> : {}
    const type = Array.isArray(spec.type)
      ? spec.type.join(' | ')
      : typeof spec.type === 'string'
        ? spec.type
        : 'any'
    return {
      name,
      type,
      description: typeof spec.description === 'string' ? spec.description : '',
      required: requiredSet.has(name),
    }
  })
}

function buildSchemaObject(schema?: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const properties = readSchemaProperties(schema)
  if (properties.length === 0) return {}
  const template: Record<string, unknown> = {}
  const rawProperties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
  for (const prop of properties) {
    const spec = rawProperties[prop.name] ?? {}
    if (spec.default !== undefined) {
      template[prop.name] = spec.default
    } else if (Array.isArray(spec.examples) && spec.examples.length > 0) {
      template[prop.name] = spec.examples[0]
    } else if (spec.example !== undefined) {
      template[prop.name] = spec.example
    } else if (Array.isArray(spec.enum) && spec.enum.length > 0) {
      template[prop.name] = spec.enum[0]
    } else if (prop.type.includes('number') || prop.type.includes('integer')) {
      template[prop.name] = 0
    } else if (prop.type.includes('boolean')) {
      template[prop.name] = false
    } else if (prop.type.includes('array')) {
      template[prop.name] = []
    } else if (prop.type.includes('object')) {
      template[prop.name] = depth < 3 && spec.properties && typeof spec.properties === 'object' && !Array.isArray(spec.properties)
        ? buildSchemaObject(spec, depth + 1)
        : {}
    } else {
      template[prop.name] = ''
    }
  }
  return template
}

export function buildSchemaTemplate(schema?: Record<string, unknown>): string {
  const template = buildSchemaObject(schema)
  if (Object.keys(template).length === 0) return '{}'
  return JSON.stringify(template, null, 2)
}

function formatDebugResult(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

export const mcpDetailStyles = `
.mcp-detail-page {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mcp-detail-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.mcp-detail-top-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.mcp-detail-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mcp-detail-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  color: #0f172a;
}
.mcp-detail-desc {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}
.mcp-detail-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.mcp-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
@container (min-width: 680px) {
  .mcp-detail-grid {
    grid-template-columns: minmax(220px, 270px) minmax(0, 1fr);
  }
}
.mcp-detail-pane {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.mcp-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mcp-pane-title {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
}
.mcp-tool-filter {
  width: 100%;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
}
.mcp-tool-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 520px;
  overflow-y: auto;
}
.mcp-tool-item {
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.mcp-tool-item:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}
.mcp-tool-item.is-selected {
  background: #eff6ff;
  border-color: #93c5fd;
}
.mcp-tool-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mcp-tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  word-break: break-word;
}
.mcp-tool-item-desc {
  margin: 0;
  font-size: 11.5px;
  color: #64748b;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mcp-debug-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mcp-debug-tool-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 2px 8px;
  border-radius: 6px;
}
.mcp-schema-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-schema-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-schema-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
}
.mcp-schema-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
  color: #0f172a;
}
.mcp-schema-type {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #2563eb;
}
.mcp-schema-req {
  font-size: 10.5px;
  color: #dc2626;
  font-weight: 600;
}
.mcp-schema-desc {
  color: #64748b;
  font-size: 11.5px;
}
.mcp-debug-textarea {
  width: 100%;
  min-height: 116px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  background: #ffffff;
}
.mcp-debug-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mcp-debug-result {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  overflow: hidden;
}
.mcp-debug-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
}
.mcp-debug-output {
  margin: 0;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 320px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #0f172a;
}
`

export function McpServiceDetail({
  api,
  service,
  contextId,
  tenantId,
  spaceLabel,
  connection,
  mountAvailable,
  mounted,
  busy,
  onToggleMount,
  onBack,
}: {
  api: OpcApi
  service: Record<string, unknown>
  contextId: string
  tenantId: string
  spaceLabel: string
  connection?: { state: string; toolCount: number }
  mountAvailable: boolean
  mounted: boolean
  busy: boolean
  onToggleMount: () => void
  onBack: () => void
}) {
  const serviceId = String(service.service_id)
  const serviceName = String(service.name ?? service.service_id)
  const serviceDescription = String(service.description ?? '').trim()
  const tools = useMemo(() => normalizeMcpTools(service.tools), [service.tools])
  const [toolFilter, setToolFilter] = useState('')
  const [selectedToolName, setSelectedToolName] = useState<string>(() => tools[0]?.name ?? '')
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>({})
  const [resultState, setResultState] = useState<{ ok: boolean; text: string } | null>(null)
  const [validationError, setValidationError] = useState('')
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)

  const filteredTools = useMemo(() => {
    const term = toolFilter.trim().toLowerCase()
    if (!term) return tools
    return tools.filter(tool =>
      tool.name.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term),
    )
  }, [tools, toolFilter])

  const selectedTool = useMemo(
    () => tools.find(tool => tool.name === selectedToolName) ?? tools[0] ?? null,
    [tools, selectedToolName],
  )

  useEffect(() => {
    generation.current++
    setPending(false)
    setResultState(null)
    setValidationError('')
    setCopied(false)
    setToolFilter('')
    setArgsByTool({})
    setSelectedToolName(tools[0]?.name ?? '')
    return () => { generation.current++ }
  }, [contextId, serviceId, tenantId])

  useEffect(() => {
    if (selectedTool && selectedTool.name !== selectedToolName) {
      setSelectedToolName(selectedTool.name)
    }
  }, [selectedTool, selectedToolName])

  const defaultArgs = useMemo(
    () => buildSchemaTemplate(selectedTool?.inputSchema),
    [selectedTool?.inputSchema],
  )
  const currentArgs = selectedTool ? (argsByTool[selectedTool.name] ?? defaultArgs) : '{}'
  const schemaProperties = useMemo(
    () => readSchemaProperties(selectedTool?.inputSchema),
    [selectedTool?.inputSchema],
  )

  const updateCurrentArgs = (value: string) => {
    if (!selectedTool) return
    setValidationError('')
    setArgsByTool(prev => ({ ...prev, [selectedTool.name]: value }))
  }

  const formatCurrentJson = () => {
    if (!selectedTool) return
    try {
      const parsed = JSON.parse(currentArgs)
      updateCurrentArgs(JSON.stringify(parsed, null, 2))
    } catch (error) {
      setValidationError(`JSON 格式无效：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const invokeSelectedTool = () => {
    if (!selectedTool) return
    try {
      const parsed = JSON.parse(currentArgs)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setValidationError('参数必须是 JSON 对象，例如 {}')
        return
      }
    } catch (error) {
      setValidationError(`JSON 格式无效：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const current = ++generation.current
    setPending(true)
    setValidationError('')
    setResultState(null)
    void api.invokeMcpTool(serviceId, selectedTool.name, currentArgs, contextId, tenantId)
      .then(
        value => {
          if (current === generation.current) {
            setResultState({ ok: true, text: formatDebugResult(value) || 'null' })
          }
        },
        error => {
          if (current === generation.current) {
            setResultState({ ok: false, text: error instanceof Error ? error.message : String(error) })
          }
        },
      )
      .finally(() => {
        if (current === generation.current) setPending(false)
      })
  }

  const copyResult = async () => {
    if (!resultState?.text) return
    try {
      await navigator.clipboard?.writeText(resultState.text)
    } catch {
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="mcp-detail-page">
      <div className="mcp-detail-top">
        <div className="mcp-detail-top-left">
          <div>
            <button type="button" className="btn-back" onClick={onBack}>
              ← 返回 MCP 列表
            </button>
          </div>
          <div className="mcp-detail-title-row">
            <div className="card-icon" style={{ background: '#faf5ff', borderColor: '#e9d5ff', color: '#9333ea' }}>🔌</div>
            <h2 className="mcp-detail-title">{serviceName}</h2>
            {spaceLabel && <span className="badge">{spaceLabel}</span>}
            {connection && (
              <span className={`badge ${connection.state === 'connected' ? 'badge-ok' : ''}`}>
                {connection.state === 'connected' ? `已连接 (${connection.toolCount})` : connection.state}
              </span>
            )}
          </div>
          {serviceDescription && <p className="mcp-detail-desc">{serviceDescription}</p>}
        </div>
        {mountAvailable && (
          <div className="mcp-detail-top-actions">
            <button
              type="button"
              disabled={busy}
              style={mounted ? {} : { background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' }}
              onClick={onToggleMount}
            >
              {mounted ? '取消挂载' : '挂载到 DSH'}
            </button>
          </div>
        )}
      </div>

      {tools.length === 0 ? (
        <div className="mcp-detail-pane" style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
          该 MCP 服务暂无可用工具
        </div>
      ) : (
        <div className="mcp-detail-grid">
          <section className="mcp-detail-pane" aria-label="可用工具">
            <div className="mcp-pane-head">
              <h3 className="mcp-pane-title">可用工具</h3>
              <span className="badge">{tools.length}</span>
            </div>
            {tools.length > 5 && (
              <input
                type="search"
                className="mcp-tool-filter"
                aria-label="筛选工具"
                placeholder="筛选工具名称或说明..."
                value={toolFilter}
                onChange={event => setToolFilter(event.target.value)}
              />
            )}
            <div className="mcp-tool-list">
              {filteredTools.map(tool => {
                const isSelected = selectedTool?.name === tool.name
                return (
                  <button
                    key={tool.name}
                    type="button"
                    className={`mcp-tool-item ${isSelected ? 'is-selected' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => {
                      generation.current++
                      setSelectedToolName(tool.name)
                      setPending(false)
                      setResultState(null)
                      setValidationError('')
                    }}
                  >
                    <div className="mcp-tool-item-head">
                      <span className="mcp-tool-name">{tool.name}</span>
                      {tool.risk && (
                        <span className={`badge ${tool.risk === 'read' ? 'badge-ok' : 'badge-warn'}`}>
                          {tool.risk === 'read' ? '只读' : tool.risk}{tool.requireApproval ? ' · 需审批' : ''}
                        </span>
                      )}
                    </div>
                    {tool.description && <p className="mcp-tool-item-desc">{tool.description}</p>}
                  </button>
                )
              })}
              {filteredTools.length === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 8px', fontSize: 12, color: '#94a3b8' }}>
                  未找到匹配的工具
                </div>
              )}
            </div>
          </section>

          <section className="mcp-detail-pane" aria-label="工具调试">
            <div className="mcp-pane-head">
              <h3 className="mcp-pane-title">工具调试</h3>
              {selectedTool && (
                <div className="mcp-debug-tool-head">
                  <code className="mcp-debug-tool-code">{selectedTool.name}</code>
                  {selectedTool.risk && (
                    <span className={`badge ${selectedTool.risk === 'read' ? 'badge-ok' : 'badge-warn'}`}>
                      {selectedTool.risk === 'read' ? '只读' : selectedTool.risk}{selectedTool.requireApproval ? ' · 需审批' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>

            {selectedTool && <>
              {selectedTool.description && (
                <p className="mcp-detail-desc">{selectedTool.description}</p>
              )}

              {schemaProperties.length > 0 && (
                <div className="mcp-schema-box">
                  <div className="mcp-pane-head">
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>参数定义</span>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => updateCurrentArgs(buildSchemaTemplate(selectedTool.inputSchema))}
                    >
                      恢复默认参数
                    </button>
                  </div>
                  <div className="mcp-schema-list">
                    {schemaProperties.map(prop => (
                      <div key={prop.name} className="mcp-schema-row">
                        <span className="mcp-schema-key">{prop.name}</span>
                        <span className="mcp-schema-type">{prop.type}</span>
                        {prop.required && <span className="mcp-schema-req">必填</span>}
                        {prop.description && <span className="mcp-schema-desc">{prop.description}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                className="mcp-debug-textarea"
                aria-label={`${selectedTool.name} JSON 参数`}
                value={currentArgs}
                onChange={event => updateCurrentArgs(event.target.value)}
              />

              {validationError && <div role="alert" className="error" style={{ margin: 0 }}>{validationError}</div>}

              <div className="mcp-debug-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={pending}
                  onClick={invokeSelectedTool}
                >
                  {pending ? '执行中…' : '调用工具'}
                </button>
                <button type="button" className="btn-sm" disabled={pending} onClick={formatCurrentJson}>
                  格式化 JSON
                </button>
                {resultState && (
                  <button type="button" className="btn-sm" disabled={pending} onClick={() => setResultState(null)}>
                    清空结果
                  </button>
                )}
              </div>

              {resultState && (
                <div className="mcp-debug-result">
                  <div className="mcp-debug-result-head">
                    <span className={`badge ${resultState.ok ? 'badge-ok' : 'badge-danger'}`}>
                      {resultState.ok ? '调用成功' : '调用失败'}
                    </span>
                    <button type="button" className="btn-sm" onClick={() => void copyResult()}>
                      <AppIcon name={copied ? 'check' : 'copy'} size={12} /> {copied ? '已复制' : '复制结果'}
                    </button>
                  </div>
                  <pre className="mcp-debug-output">{resultState.text}</pre>
                </div>
              )}
            </>}
          </section>
        </div>
      )}
    </div>
  )
}
