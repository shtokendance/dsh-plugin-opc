import React, { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { AuthState, OpcApi, Resource } from './api.ts'
import { AppsPanel } from './AppsPanel.tsx'
export type PanelKind = 'knowledge' | 'skills' | 'mcp' | 'apps'
import { labels as titles, OpcIcon } from './branding.tsx'

const css = `
.opc-panel {
  font: 13px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--text-primary, #1e293b);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--background-primary, #ffffff);
}
.opc-panel * { box-sizing: border-box; }

/* Top Title & Control Bar */
.opc-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--background-secondary, #f8fafc);
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.brand-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #edf4fc;
  border-radius: 6px;
  border: 1px solid #d0e2f9;
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-title {
  font-size: 14px;
  font-weight: 650;
  margin: 0;
  color: #0f172a;
  line-height: 1.2;
}
.brand-sub {
  font-size: 11px;
  color: #64748b;
  line-height: 1.2;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
}
.user-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  font-size: 12px;
  color: #334155;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #245c9f;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.space-select {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  max-width: 140px;
}
.btn-header {
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}
.btn-header:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
}
.btn-header.btn-logout {
  color: #991b1b;
  border-color: #fecaca;
  background: #fff5f5;
}
.btn-header.btn-logout:hover:not(:disabled) {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #7f1d1d;
}
.btn-header:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Main Content Area */
.opc-panel-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Common UI Elements */
.opc-panel button, .opc-panel input, .opc-panel select, .opc-panel textarea {
  font: inherit;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px 10px;
  color: inherit;
  background: #ffffff;
}
.opc-panel button { cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.opc-panel button:disabled { opacity: 0.5; cursor: not-allowed; }
.opc-panel button.primary { background: #245c9f; color: #ffffff; border-color: #245c9f; font-weight: 500; }
.opc-panel button.primary:hover:not(:disabled) { background: #1d4b82; border-color: #1d4b82; }
.opc-panel .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
.opc-panel input { min-width: 0; flex: 1; }
.opc-panel .notice { background: #edf4fc; border-left: 3px solid #245c9f; padding: 10px 12px; margin: 10px 0; border-radius: 0 6px 6px 0; font-size: 12px; }
.opc-panel .error { background: #fef2f2; border-left: 3px solid #dc2626; padding: 10px 12px; margin: 10px 0; border-radius: 0 6px 6px 0; color: #991b1b; font-size: 12px; overflow-wrap: anywhere; }
.opc-panel .badge { font-size: 11px; color: #245c9f; background: #edf4fc; border: 1px solid #d0e2f9; padding: 2px 7px; border-radius: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
.opc-panel .badge-ok { color: #059669; background: #ecfdf5; border-color: #a7f3d0; }
.opc-panel .badge-warn { color: #d97706; background: #fffbeb; border-color: #fde68a; }
.opc-panel .badge-danger { color: #dc2626; background: #fef2f2; border-color: #fecaca; }
.opc-panel .gate { padding: 40px 24px; text-align: center; max-width: 420px; margin: 0 auto; }
.opc-panel .gate h3 { font-size: 18px; margin: 0 0 8px; font-weight: 650; }
.opc-panel .gate p { color: #64748b; font-size: 13px; margin-bottom: 20px; }

/* Cards Grid Layout (Matching work-opc) */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.resource-card {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.resource-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.card-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #edf4fc;
  border: 1px solid #d0e2f9;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #245c9f;
  font-size: 14px;
  flex-shrink: 0;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: #0f172a;
  word-break: break-word;
}
.card-desc {
  font-size: 12px;
  color: #64748b;
  margin: 6px 0 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
}
.card-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
  flex-wrap: wrap;
}
.card-actions button {
  font-size: 12px;
  padding: 5px 10px;
}
.doc-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  margin-top: 14px;
  overflow-wrap: anywhere;
}
.doc-box img { max-width: 100%; }

/* ========================================================
   方案二：通用微交互与组件体系 (基于 opc-knowledge & opc-plugin 设计)
   ======================================================== */

/* 知识库方案二：双Tab独立微型栏 */
.s2-kb-tabs {
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 14px;
  padding-bottom: 0;
}
.s2-kb-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.s2-kb-tab:hover:not(.active) {
  color: #0f172a;
}
.s2-kb-tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 650;
}
.s2-badge-rec {
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 9999px;
  font-weight: 600;
}
.s2-panel-full {
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.s2-scope-select {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 12px;
  padding: 7px 10px;
  color: #334155;
  font-weight: 500;
  max-width: 180px;
  min-width: 140px;
  cursor: pointer;
}
.s2-input-full {
  flex: 1 1 180px;
  min-width: 150px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 12px;
  padding: 7px 12px;
  color: #0f172a;
}
.s2-input-full:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.s2-btn-blue {
  background: #2563eb;
  color: #ffffff;
  border: 1px solid #2563eb;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 16px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.2);
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.s2-btn-blue:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #1d4ed8;
}
.s2-panel-catalog {
  background: rgba(254, 243, 199, 0.35);
  border: 1px solid rgba(253, 230, 138, 0.7);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.s2-input-catalog {
  flex: 1 1 200px;
  min-width: 160px;
  background: #ffffff;
  border: 1px solid #fde68a;
  border-radius: 10px;
  font-size: 12px;
  padding: 7px 12px;
  color: #1e293b;
}
.s2-input-catalog:focus {
  outline: none;
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
}
.s2-btn-amber {
  background: #d97706;
  color: #ffffff;
  border: 1px solid #d97706;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 16px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(217, 119, 6, 0.2);
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.s2-btn-amber:hover:not(:disabled) {
  background: #b45309;
  border-color: #b45309;
}

/* 技能与 MCP 方案二：独立指令栏与分类 Pills */
.s2-command-bar {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 12px;
}
.s2-command-icon {
  position: absolute;
  left: 12px;
  font-size: 13px;
  color: #2563eb;
  pointer-events: none;
  display: flex;
  align-items: center;
}
.s2-command-input {
  width: 100%;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 8px 105px 8px 36px;
  font-size: 12px;
  color: #0f172a;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.s2-command-input:focus {
  background: #ffffff;
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.s2-command-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: #0f172a;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.s2-command-btn:hover:not(:disabled) {
  background: #2563eb;
}
.s2-command-clear {
  position: absolute;
  right: 76px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.s2-command-clear:hover {
  color: #0f172a;
}
.s2-pills-row {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 14px;
}
.s2-pills-label {
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.s2-pill {
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-weight: 500;
  border: 1px solid transparent;
  background: #f1f5f9;
  color: #475569;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.s2-pill:hover:not(.active) {
  background: #e2e8f0;
  color: #0f172a;
}
.s2-pill.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
}

/* 结果卡片与小按钮 */
.kb-results-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 14px;
  margin: 10px 0 14px;
}
.kb-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.kb-results-title {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 6px;
}
.kb-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 14px 0 8px;
  padding-bottom: 4px;
}
.kb-section-title {
  font-size: 13px;
  font-weight: 650;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn-sm {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover:not(:disabled) {
  background: #f1f5f9;
  color: #0f172a;
}

/* Apps Panel Styles aligned with work-opc */
.opc-apps .apps-intro {
  color: #64748b;
  font-size: 13px;
  margin: 0 0 16px;
  line-height: 1.5;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.dot-ok {
  background: #10b981;
}
.dot-danger {
  background: #ef4444;
}
.dot-warn {
  background: #f59e0b;
}
.app-meta-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.app-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.btn-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: #245c9f;
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  transition: all 0.15s ease;
}
.btn-link:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.app-drawer {
  margin-top: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
}

/* Stepper & Wizard UI */
.wizard-header {
  margin-bottom: 16px;
}
.btn-back {
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  color: #334155;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}
.btn-back:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.stepper-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 12px 0 16px;
}
.stepper-step {
  padding: 7px 8px;
  border-radius: 8px;
  font-size: 11px;
  text-align: center;
  font-weight: 500;
  border: 1px solid #e2e8f0;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stepper-step.active {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #93c5fd;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(37,99,235,0.08);
}
.stepper-step.completed {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.stepper-step.pending {
  background: #f8fafc;
  color: #94a3b8;
  border-color: #e2e8f0;
}

/* AI Execution Progress Card (matching work-opc) */
.ai-progress-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px;
  margin: 14px 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.03);
}
.ai-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 10px;
  margin-bottom: 10px;
}
.ai-progress-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.ai-progress-counter {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}
.pulse-indicator {
  position: relative;
  display: inline-flex;
  width: 8px;
  height: 8px;
  flex-shrink: 0;
}
.pulse-dot-ping {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #2563eb;
  opacity: 0.75;
  animation: opc-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.pulse-dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
}
@keyframes opc-ping {
  0% { transform: scale(1); opacity: 0.8; }
  75%, 100% { transform: scale(2.2); opacity: 0; }
}
.events-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
  scroll-behavior: smooth;
}
.event-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  transition: all 0.15s ease;
}
.event-item.done {
  background: #f8fafc;
  color: #475569;
  border: 1px solid #f1f5f9;
}
.event-item.current {
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(37,99,235,0.06);
}
.event-item.failed {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  font-weight: 500;
}
.event-step-badge {
  font-size: 11px;
  line-height: 1.5;
  flex-shrink: 0;
}
.event-text {
  flex: 1;
  word-break: break-all;
}

/* Card-style Sections inside Wizard */
.wizard-section-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
  margin: 14px 0;
}
.wizard-section-title {
  font-size: 14px;
  font-weight: 650;
  color: #0f172a;
  margin: 0 0 10px;
}
`

export function Panel({ api, sessionId, kind }: { api: OpcApi; sessionId: string; kind: PanelKind }) {
  const [state, setState] = useState<AuthState>({ signedIn: false, loginInProgress: false, context: null })
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [q, setQ] = useState('')
  const [items, setItems] = useState<Resource[]>([]), [hits, setHits] = useState<Record<string, unknown>[]>([])
  const [kb, setKb] = useState(''), [doc, setDoc] = useState(''), [filter, setFilter] = useState('all')
  const [services, setServices] = useState<Record<string, unknown>[]>([])
  const [appsRefreshTrigger, setAppsRefreshTrigger] = useState(0)
  const [kbSearchMode, setKbSearchMode] = useState<'doc' | 'kb'>('doc')
  const [docQuery, setDocQuery] = useState('')
  const [hasSearchedDoc, setHasSearchedDoc] = useState(false)
  const [mcpSearch, setMcpSearch] = useState('')
  const [mcpFilter, setMcpFilter] = useState<'all' | 'connected' | 'unmounted'>('all')
  const docInputRef = useRef<HTMLInputElement>(null)
  const topSearchCardRef = useRef<HTMLDivElement>(null)
  const pin = state.pinnedScopes?.[sessionId] ?? ''
  const epoch = useRef(0)

  const run = useCallback(async (action: () => Promise<void>) => {
    const version = epoch.current
    setBusy(true); setError('')
    try { await action() } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : '操作失败，请重试。') }
    finally { if (version === epoch.current) setBusy(false) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try { for await (const frame of api.watchState(controller.signal)) { if (!controller.signal.aborted) setState(JSON.parse(frame)) } }
      catch (e) { if (!controller.signal.aborted) setError(`状态连接中断：${e instanceof Error ? e.message : '请重新打开面板'}`) }
    })()
    return () => controller.abort()
  }, [api])

  const load = useCallback(async () => {
    const version = epoch.current
    if (kind === 'apps') {
      setAppsRefreshTrigger(prev => prev + 1)
      return
    }
    if (kind === 'mcp') {
      const body = JSON.parse(await api.listMcpServices())
      if (version === epoch.current) setServices(body.data?.services ?? body.services ?? [])
    } else {
      const rows = JSON.parse(await (kind === 'skills' ? api.listSkillsCatalog(q) : api.listKnowledgeBases(q)))
      if (version === epoch.current) setItems(rows)
    }
  }, [api, kind, q])

  useEffect(() => {
    epoch.current++; setItems([]); setHits([]); setDoc(''); setServices([]); setKb(''); setDocQuery(''); setHasSearchedDoc(false); setMcpSearch(''); setMcpFilter('all'); setBusy(false); setError('')
    if (state.signedIn) void run(load)
  }, [state.context?.contextId, sessionId, kind])

  const context = state.context
  const action = (fn: () => Promise<void>) => () => void run(fn)

  return <section className="opc-panel">
    <style>{css}</style>
    {/* Title Bar with Integrated Auth, Space Switcher, Refresh, and Logout */}
    <header className="opc-header-bar">
      <div className="header-brand">
        <div className="brand-icon-wrap">
          <OpcIcon size={18} />
        </div>
        <div className="brand-text">
          <h2 className="brand-title">{titles[kind]}</h2>
          <span className="brand-sub">OPC 工作空间</span>
        </div>
      </div>
      {state.signedIn && context && <div className="header-actions">
        <div className="user-pill" title={context.email ? `${context.displayName || context.subject} (${context.email})` : (context.displayName || context.subject)}>
          <span className="user-avatar">{((context.displayName || context.subject)[0] || 'U').toUpperCase()}</span>
          <span className="user-name">{context.displayName || context.subject}</span>
        </div>
        {<select
          aria-label="企业空间"
          className="space-select"
          value={context.tenant}
          disabled={busy}
          onChange={e => void run(() => api.switchTenant(e.target.value))}
        >
          {(context.spacesDetail ?? context.spaces.map(id => ({ id, name: id }))).map(space => (
            <option key={space.id} value={space.id}>{space.name}</option>
          ))}
        </select>}
        <button
          className="btn-header"
          disabled={busy}
          onClick={action(load)}
          title="刷新"
        >
          刷新
        </button>
        <button
          className="btn-header btn-logout"
          disabled={busy}
          onClick={action(() => api.logout())}
          title="退出登录"
        >
          退出
        </button>
      </div>}
    </header>

    {!state.signedIn || !context ? <div className="gate">
      <h3>连接 OPC 工作空间</h3>
      <p>登录后使用 OPC 知识库、技能与企业应用。企业身份与 DSH 个人账号独立。</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" style={{ padding: '8px 18px', fontSize: 13 }} disabled={busy || state.loginInProgress} onClick={action(async () => { await api.startLogin() })}>
          企业微信 / SSO 登录
        </button>
      </div>
      {state.loginInProgress && <div className="notice" style={{ textAlign: 'left', marginTop: 16 }}>
        请在浏览器完成授权。
        {state.loginAuthorizeUrl && <p style={{ margin: '4px 0' }}><a href={state.loginAuthorizeUrl} target="_blank" rel="noreferrer">重新打开授权页</a></p>}
        <button onClick={action(() => api.cancelLogin())} style={{ marginTop: 6 }}>取消登录</button>
      </div>}
      {state.loginError && <p role="alert" className="error">{state.loginError.message}</p>}
    </div> : <main className="opc-panel-main">
      {/* Apps View */}
      {kind === 'apps' && context.applicationContextId && (
        <AppsPanel
          key={context.applicationContextId + sessionId}
          api={api}
          sessionId={sessionId}
          contextId={context.applicationContextId}
          refreshSignal={appsRefreshTrigger}
        />
      )}

      {/* Knowledge Base View - 方案二：双Tab独立微型栏 */}
      {kind === 'knowledge' && <>
        {/* Tab Header */}
        <div className="s2-kb-tabs">
          <button
            type="button"
            className={`s2-kb-tab ${kbSearchMode === 'doc' ? 'active' : ''}`}
            onClick={() => {
              setKbSearchMode('doc')
              setTimeout(() => docInputRef.current?.focus(), 50)
            }}
          >
            <span>📄 文档全文检索模式</span>
            <span className="s2-badge-rec">推荐</span>
            {hits.length > 0 && <span className="badge badge-ok" style={{ fontSize: 10, padding: '1px 5px' }}>{hits.length}</span>}
          </button>
          <button
            type="button"
            className={`s2-kb-tab ${kbSearchMode === 'kb' ? 'active' : ''}`}
            onClick={() => setKbSearchMode('kb')}
          >
            <span>📂 知识库目录筛选模式</span>
            {q && <span className="badge badge-warn" style={{ fontSize: 10, padding: '1px 5px' }}>已筛选</span>}
          </button>
        </div>

        {/* Tab 1: 文档全文检索模式 */}
        {kbSearchMode === 'doc' && (
          <form
            className="s2-panel-full"
            onSubmit={e => {
              e.preventDefault()
              if (!docQuery.trim()) return
              const version = epoch.current
              void run(async () => {
                const result = JSON.parse(await api.searchKnowledge(sessionId, docQuery.trim(), kb, context.contextId))
                if (version === epoch.current) {
                  setHits(result.results ?? [])
                  setHasSearchedDoc(true)
                }
              })
            }}
          >
            <select
              aria-label="检索知识库范围"
              className="s2-scope-select"
              value={kb}
              onChange={e => setKb(e.target.value)}
            >
              <option value="">当前空间全部知识库</option>
              {items.map(item => <option key={item.knowledge_base_id} value={item.knowledge_base_id}>{item.name}</option>)}
            </select>
            <input
              ref={docInputRef}
              required
              className="s2-input-full"
              aria-label="文档检索词"
              placeholder="输入全文关键词或代码片段进行向量检索..."
              value={docQuery}
              onChange={e => setDocQuery(e.target.value)}
            />
            <button className="s2-btn-blue" disabled={busy}>开始检索</button>
            {(docQuery || hits.length > 0 || hasSearchedDoc) && (
              <button
                type="button"
                className="btn-sm"
                onClick={() => {
                  setDocQuery('')
                  setHits([])
                  setDoc('')
                  setHasSearchedDoc(false)
                }}
              >
                清空
              </button>
            )}
          </form>
        )}

        {/* Tab 2: 知识库目录筛选模式 */}
        {kbSearchMode === 'kb' && (
          <form
            className="s2-panel-catalog"
            onSubmit={e => { e.preventDefault(); void run(load) }}
          >
            <input
              aria-label="筛选知识库"
              className="s2-input-catalog"
              placeholder="输入知识库名称或描述进行快速过滤..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <button className="s2-btn-amber" disabled={busy}>应用筛选</button>
            {q && (
              <button
                type="button"
                className="btn-sm"
                onClick={() => { setQ(''); void run(load) }}
              >
                清除
              </button>
            )}
          </form>
        )}

        {/* Empty Doc Search Feedback */}
        {hasSearchedDoc && hits.length === 0 && !busy && (
          <div className="notice" style={{ background: '#f8fafc', borderColor: '#94a3b8', color: '#64748b', fontSize: 12, margin: '8px 0' }}>
            未找到与“{docQuery}”相关的文档片段。可尝试更换检索词，或在上方选择「当前空间全部知识库」。
          </div>
        )}

        {/* Document Search Hits */}
        {hits.length > 0 && (
          <div className="kb-results-card">
            <div className="kb-results-header">
              <div className="kb-results-title">
                <span>📄 文档检索结果</span>
                <span className="badge badge-ok">{hits.length} 条相关片段</span>
              </div>
              <button
                type="button"
                className="btn-sm"
                onClick={() => { setHits([]); setDoc(''); setHasSearchedDoc(false) }}
              >
                收起结果
              </button>
            </div>
            {hits.map((hit, i) => (
              <div key={String(hit.knowledge_id) + i} className="resource-card" style={{ marginBottom: 8, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button
                    style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}
                    onClick={action(async () => {
                      const version = epoch.current
                      const result = JSON.parse(await api.readKnowledgeDocument(sessionId, String(hit.knowledge_id), context.contextId))
                      if (version === epoch.current) setDoc(result.data?.content ?? '')
                    })}
                  >
                    📖 {String(hit.title ?? hit.knowledge_id)}
                  </button>
                  {typeof hit.score === 'number' && <span className="badge">相关度: {hit.score.toFixed(2)}</span>}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                  {String(hit.snippet ?? hit.content ?? '')}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Document Full-text Reader */}
        {doc && (
          <div className="doc-box" style={{ marginTop: 0, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong>📄 文档详情正文</strong>
              <button onClick={() => setDoc('')}>关闭正文</button>
            </div>
            <Markdown>{doc}</Markdown>
          </div>
        )}

        {/* Pinned Knowledge Scope Banner */}
        {pin && (
          <div className="notice">
            <strong>当前对话问答已限定范围：</strong>{items.find(item => item.knowledge_base_id === pin)?.name ?? pin}
            <button style={{ marginLeft: 8 }} onClick={action(async () => { await api.setPinnedKnowledgeScope(sessionId, null, context.contextId) })}>取消限定</button>
          </div>
        )}

        {/* Knowledge Base Catalog Section Header */}
        <div className="kb-section-header">
          <div className="kb-section-title">
            <span>📚 知识库列表</span>
            <span className="badge">{items.length}</span>
          </div>
          {q ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-warn">已按“{q}”过滤</span>
              <button className="btn-sm" onClick={() => { setQ(''); void run(load) }}>清除过滤</button>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>点击卡片「检索此库」可直接定位搜索</span>
          )}
        </div>

        {/* Knowledge Base Cards Grid */}
        <div className="cards-grid">
          {items.map(item => (
            <div key={item.knowledge_base_id} className="resource-card">
              <div>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div className="card-icon" style={{ background: '#f8fafc', color: '#334155' }}>📖</div>
                    <h3 className="card-title">{item.name}</h3>
                  </div>
                  <span className={`badge ${item.availability === 'available' ? 'badge-ok' : ''}`}>
                    {item.availability === 'available' ? '已就绪' : '未就绪'}
                  </span>
                </div>
                <p className="card-desc">{item.description || '暂无知识库描述'}</p>
              </div>
              <div className="card-actions">
                <button
                  className="primary"
                  disabled={busy || item.availability !== 'available'}
                  onClick={action(async () => { await api.setPinnedKnowledgeScope(sessionId, item.knowledge_base_id!, context.contextId) })}
                >
                  限定问答范围
                </button>
                <button
                  style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0' }}
                  onClick={() => {
                    setKb(item.knowledge_base_id!)
                    setKbSearchMode('doc')
                    setTimeout(() => {
                      docInputRef.current?.focus()
                      docInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 50)
                  }}
                >
                  检索此库
                </button>
              </div>
            </div>
          ))}
        </div>
      </>}

      {/* Skills View - 方案二：独立指令栏与分类Pills */}
      {kind === 'skills' && (() => {
        const installedCount = items.filter(it => !!it.installed).length
        const uninstalledCount = items.length - installedCount
        const filteredItems = items.filter(item => {
          if (filter === 'installed') return !!item.installed
          if (filter === 'new') return !item.installed
          return true
        })

        return <>
          {/* 指令栏 */}
          <form
            className="s2-command-bar"
            onSubmit={e => { e.preventDefault(); void run(load) }}
          >
            <span className="s2-command-icon">⚡</span>
            <input
              aria-label="搜索技能"
              className="s2-command-input"
              placeholder="输入关键词查找技能组件、描述或指令..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            {q && (
              <button
                type="button"
                className="s2-command-clear"
                onClick={() => { setQ(''); void run(load) }}
                title="清除"
              >
                ✕
              </button>
            )}
            <button className="s2-command-btn" disabled={busy}>立即检索</button>
          </form>

          {/* 快捷分类 Pills */}
          <div className="s2-pills-row">
            <span className="s2-pills-label">🏷️ 快捷标签：</span>
            <button
              type="button"
              className={`s2-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              全部 ({items.length})
            </button>
            <button
              type="button"
              className={`s2-pill ${filter === 'installed' ? 'active' : ''}`}
              onClick={() => setFilter('installed')}
            >
              已安装 ({installedCount})
            </button>
            <button
              type="button"
              className={`s2-pill ${filter === 'new' ? 'active' : ''}`}
              onClick={() => setFilter('new')}
            >
              未安装 ({uninstalledCount})
            </button>
          </div>

          <div className="cards-grid">
            {filteredItems.map(item => (
              <div key={item.catalog_id} className="resource-card">
                <div>
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div className="card-icon" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#16a34a' }}>⚡</div>
                      <div>
                        <h3 className="card-title">/{item.name}</h3>
                        <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>v{item.version}</span>
                      </div>
                    </div>
                    <span className={`badge ${item.installed ? (item.installed.enabled ? 'badge-ok' : '') : ''}`}>
                      {item.installed ? (item.installed.enabled ? '已启用' : '已停用') : '未安装'}
                    </span>
                  </div>
                  <p className="card-desc">{item.description || '暂无技能说明'}</p>
                </div>
                <div className="card-actions">
                  {(!item.installed || item.installed.active_sha256 !== item.bundle_sha256) && (
                    <button
                      className="primary"
                      disabled={busy || item.availability !== 'available'}
                      onClick={action(async () => { await api.installSkill(item.catalog_id!, item.bundle_sha256!, context.contextId); await load() })}
                    >
                      {item.installed ? '更新版本' : '下载安装'}
                    </button>
                  )}
                  {item.installed && <>
                    <button
                      disabled={busy}
                      onClick={action(async () => { await api.setSkillEnabled(item.catalog_id!, !item.installed!.enabled, context.contextId); await load() })}
                    >
                      {item.installed.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      disabled={busy}
                      style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                      onClick={action(async () => { await api.uninstallSkill(item.catalog_id!, context.contextId); await load() })}
                    >
                      卸载
                    </button>
                  </>}
                </div>
              </div>
            ))}
          </div>
        </>
      })()}

      {/* Approvals */}
      {state.approvals?.map(pending => (
        <div className="notice" key={pending.id} style={{ background: '#fffbeb', borderColor: '#f59e0b' }}>
          <strong>待审批企业操作：{pending.toolName}</strong>
          <pre style={{ margin: '8px 0', fontSize: 12 }}>{JSON.stringify(pending.arguments, null, 2)}</pre>
          <div className="row">
            <button className="primary" onClick={() => void api.decideDebugInvocation(pending.id, true, pending.contextId).catch(e => setError(String(e)))}>
              允许一次
            </button>
            <button onClick={() => void api.decideDebugInvocation(pending.id, false, pending.contextId).catch(e => setError(String(e)))}>
              拒绝
            </button>
          </div>
        </div>
      ))}

      {/* MCP Services View - 方案二：独立指令栏与分类Pills */}
      {kind === 'mcp' && (() => {
        const connectedCount = services.filter(s => state.mountedServices?.includes(String(s.service_id))).length
        const unmountedCount = services.length - connectedCount
        const filteredServices = services.filter(service => {
          const isMounted = state.mountedServices?.includes(String(service.service_id))
          if (mcpFilter === 'connected') return isMounted
          if (mcpFilter === 'unmounted') return !isMounted
          return true
        }).filter(service => {
          if (!mcpSearch.trim()) return true
          const term = mcpSearch.trim().toLowerCase()
          const name = String(service.name ?? service.service_id).toLowerCase()
          const desc = String(service.description ?? '').toLowerCase()
          const toolMatches = (Array.isArray(service.tools) ? service.tools : []).some(t => {
            const tName = (typeof t === 'string' ? t : t.name).toLowerCase()
            return tName.includes(term)
          })
          return name.includes(term) || desc.includes(term) || toolMatches
        })

        return <>
          <p className="notice">
            AI 可按权限调用以下企业服务（已为您自动挂载并保持连接）。需要审批的高危操作会请求确认；{state.mountAvailable ? '挂载服务的审批会直接显示在 OPC 面板。' : '当前客户端可在下方在线调试工具。'}
          </p>

          {/* 指令栏 */}
          <div className="s2-command-bar">
            <span className="s2-command-icon">🔌</span>
            <input
              aria-label="搜索 MCP 服务"
              className="s2-command-input"
              placeholder="输入关键词查找企业 MCP 服务或工具名称..."
              value={mcpSearch}
              onChange={e => setMcpSearch(e.target.value)}
            />
            {mcpSearch && (
              <button
                type="button"
                className="s2-command-clear"
                onClick={() => setMcpSearch('')}
                title="清除"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className="s2-command-btn"
              onClick={() => {}}
            >
              立即检索
            </button>
          </div>

          {/* 快捷分类 Pills */}
          <div className="s2-pills-row">
            <span className="s2-pills-label">🏷️ 快捷标签：</span>
            <button
              type="button"
              className={`s2-pill ${mcpFilter === 'all' ? 'active' : ''}`}
              onClick={() => setMcpFilter('all')}
            >
              全部 ({services.length})
            </button>
            <button
              type="button"
              className={`s2-pill ${mcpFilter === 'connected' ? 'active' : ''}`}
              onClick={() => setMcpFilter('connected')}
            >
              已连接 ({connectedCount})
            </button>
            <button
              type="button"
              className={`s2-pill ${mcpFilter === 'unmounted' ? 'active' : ''}`}
              onClick={() => setMcpFilter('unmounted')}
            >
              未挂载 ({unmountedCount})
            </button>
          </div>

          <div className="cards-grid">
            {filteredServices.map(service => <div key={String(service.service_id)} className="resource-card">
              <div>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="card-icon" style={{ background: '#faf5ff', borderColor: '#e9d5ff', color: '#9333ea' }}>🔌</div>
                    <h3 className="card-title">{String(service.name ?? service.service_id)}</h3>
                  </div>
                  {state.mcpConnections?.[String(service.service_id)] && (
                    <span className={`badge ${state.mcpConnections[String(service.service_id)].state === 'connected' ? 'badge-ok' : ''}`}>
                      {state.mcpConnections[String(service.service_id)].state === 'connected' ? `已连接 (${state.mcpConnections[String(service.service_id)].toolCount})` : state.mcpConnections[String(service.service_id)].state}
                    </span>
                  )}
                </div>
                <p className="card-desc">{String(service.description ?? '')}</p>
              </div>
              <div className="card-actions">
                {state.mountAvailable && (
                  <button
                    disabled={busy}
                    style={state.mountedServices?.includes(String(service.service_id)) ? {} : { background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' }}
                    onClick={action(() => state.mountedServices?.includes(String(service.service_id))
                      ? api.unmountMcpService(String(service.service_id), context.contextId)
                      : api.mountMcpService(String(service.service_id), context.contextId)
                    )}
                  >
                    {state.mountedServices?.includes(String(service.service_id)) ? '取消挂载' : '挂载到 DSH'}
                  </button>
                )}
              </div>
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer' }}>查看可用工具与调试 ({(Array.isArray(service.tools) ? service.tools : []).length})</summary>
                <div style={{ marginTop: 8 }}>
                  {(Array.isArray(service.tools) ? service.tools : []).map((tool, i) => (
                    <div key={i} style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 8 }}>
                      <strong>{typeof tool === 'string' ? tool : tool.name}</strong>
                      {typeof tool !== 'string' && <>
                        <p style={{ margin: '2px 0 6px', fontSize: 12, color: '#64748b' }}>{tool.description}</p>
                        {tool.risk && <span className="badge" style={{ marginBottom: 6 }}>{tool.risk === 'read' ? '只读' : tool.risk}{tool.require_approval ? ' · 需审批' : ''}</span>}
                      </>}
                      <McpDebug api={api} serviceId={String(service.service_id)} toolName={typeof tool === 'string' ? tool : tool.name} contextId={context.contextId}/>
                    </div>
                  ))}
                </div>
              </details>
            </div>)}
          </div>
        </>
      })()}

      {kind !== 'apps' && !busy && (kind === 'mcp' ? services.length === 0 : items.length === 0) && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
          <p style={{ fontSize: 14, margin: '0 0 6px' }}>当前没有可见资源</p>
          <p style={{ fontSize: 12 }}>可切换企业空间或点击右上角刷新目录</p>
        </div>
      )}
    </main>}

    {busy && <div style={{ padding: '6px 16px', background: '#eff6ff', fontSize: 12, color: '#1d4ed8', borderTop: '1px solid #dbeafe' }}>正在同步最新状态…</div>}
    {error && <div role="alert" className="error" style={{ margin: 0, borderRadius: 0 }}>{error}</div>}
  </section>
}

function McpDebug({ api, serviceId, toolName, contextId }: { api: OpcApi; serviceId: string; toolName: string; contextId: string }) {
  const [args, setArgs] = useState('{}'), [result, setResult] = useState(''), [pending, setPending] = useState(false)
  const generation = useRef(0)
  useEffect(() => { generation.current++; setResult(''); setPending(false); return () => { generation.current++ } }, [contextId])
  return <details style={{ marginTop: 6 }}><summary style={{ fontSize: 12, color: '#245c9f', cursor: 'pointer' }}>在线调试调用</summary><textarea style={{ width: '100%', minHeight: 60, marginTop: 6, fontSize: 12 }} aria-label={`${toolName} JSON 参数`} value={args} onChange={e => setArgs(e.target.value)}/><button style={{ marginTop: 6 }} disabled={pending} onClick={() => {
    const current = generation.current; setPending(true); setResult('')
    void api.invokeMcpTool(serviceId, toolName, args, contextId).then(value => { if (current === generation.current) setResult(value) }, error => { if (current === generation.current) setResult(String(error)) }).finally(() => { if (current === generation.current) setPending(false) })
  }}>{pending ? '等待执行或审批…' : '调用'}</button>{result && <pre style={{ marginTop: 6, fontSize: 11, background: '#f1f5f9', padding: 8, borderRadius: 4, overflowX: 'auto' }}>{result}</pre>}</details>
}
