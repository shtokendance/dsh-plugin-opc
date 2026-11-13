export const appsCss = `
.opc-apps-root {
  --oa-canvas: #f8fafc;
  --oa-panel: #ffffff;
  --oa-paper: #f8fafc;
  --oa-ink: #0f172a;
  --oa-muted: #64748b;
  --oa-line: #e2e8f0;
  --oa-line-strong: #cbd5e1;
  --oa-accent: #245c9f;
  --oa-accent-soft: #edf4fc;
  --oa-accent-line: #bfdbfe;
  --oa-ok: #059669;
  --oa-ok-soft: #ecfdf5;
  --oa-ok-line: #a7f3d0;
  --oa-warn: #d97706;
  --oa-warn-soft: #fffbeb;
  --oa-warn-line: #fde68a;
  --oa-danger: #dc2626;
  --oa-danger-soft: #fef2f2;
  --oa-danger-line: #fecaca;
  --oa-teal: #0f766e;
  --oa-teal-soft: #f0fdfa;
  --oa-teal-line: #99f6e4;

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  color: var(--oa-ink);
  font-size: 13px;
  line-height: 1.5;
}
.opc-apps-root * { box-sizing: border-box; }
.opc-apps-root input[type="checkbox"],
.opc-apps-root input[type="radio"] {
  flex: none !important;
  width: auto !important;
  padding: 0 !important;
  margin: 0;
  cursor: pointer;
}
.opc-apps-root .oa-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
@keyframes oa-spin {
  to { transform: rotate(360deg); }
}
@keyframes oa-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.oa-spin { animation: oa-spin 1s linear infinite; }
.oa-pulse { animation: oa-pulse 1.4s ease-in-out infinite; }

/* Buttons */
.opc-apps-root .oa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 1px solid var(--oa-line-strong);
  background: var(--oa-panel);
  color: var(--oa-ink);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
}
.opc-apps-root .oa-btn:hover:not(:disabled) {
  background: var(--oa-paper);
  border-color: #94a3b8;
}
.opc-apps-root .oa-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.opc-apps-root .oa-btn-sm { padding: 5px 10px; border-radius: 8px; font-size: 12px; }
.opc-apps-root .oa-btn-xs { padding: 3px 8px; border-radius: 6px; font-size: 11px; }
.opc-apps-root .oa-btn-primary {
  background: var(--oa-accent);
  color: #ffffff;
  border-color: var(--oa-accent);
}
.opc-apps-root .oa-btn-primary:hover:not(:disabled) {
  background: #1d4b82;
  border-color: #1d4b82;
}
.opc-apps-root .oa-btn-danger {
  color: var(--oa-danger);
  border-color: var(--oa-danger-line);
  background: var(--oa-danger-soft);
}
.opc-apps-root .oa-btn-danger:hover:not(:disabled) {
  background: #fee2e2;
  border-color: #fca5a5;
}
.opc-apps-root .oa-btn-accent-soft {
  background: var(--oa-accent-soft);
  color: var(--oa-accent);
  border-color: var(--oa-accent-line);
}
.opc-apps-root .oa-btn-accent-soft:hover:not(:disabled) {
  background: #dbeafe;
}
.opc-apps-root .oa-btn-link {
  border: none !important;
  background: transparent !important;
  padding: 2px 4px !important;
  color: var(--oa-accent);
  font-size: 12px;
}
.opc-apps-root .oa-btn-link:hover:not(:disabled) { text-decoration: underline; }

/* Badges & Pills */
.opc-apps-root .oa-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--oa-line);
  background: var(--oa-paper);
  color: var(--oa-muted);
  white-space: nowrap;
}
.opc-apps-root .oa-pill-accent { background: var(--oa-accent-soft); color: var(--oa-accent); border-color: var(--oa-accent-line); }
.opc-apps-root .oa-pill-ok { background: var(--oa-ok-soft); color: var(--oa-ok); border-color: var(--oa-ok-line); }
.opc-apps-root .oa-pill-warn { background: var(--oa-warn-soft); color: var(--oa-warn); border-color: var(--oa-warn-line); }
.opc-apps-root .oa-pill-danger { background: var(--oa-danger-soft); color: var(--oa-danger); border-color: var(--oa-danger-line); }
.opc-apps-root .oa-pill-teal { background: var(--oa-teal-soft); color: var(--oa-teal); border-color: var(--oa-teal-line); }

.opc-apps-root .oa-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.opc-apps-root .oa-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--oa-paper);
  border: 1px solid var(--oa-line);
  color: var(--oa-ink);
}

/* Header & Cards */
.oa-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 14px;
  border-bottom: 1px solid var(--oa-line);
  margin-bottom: 14px;
}
.oa-title { font-size: 17px; font-weight: 650; margin: 0; color: var(--oa-ink); }
.oa-subtitle { font-size: 12px; color: var(--oa-muted); margin: 2px 0 0; }

.oa-draft-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 14px;
  margin-bottom: 14px;
  border-radius: 12px;
  border: 1px solid var(--oa-accent-line);
  background: var(--oa-accent-soft);
}
.oa-apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}
.oa-app-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid var(--oa-line);
  background: var(--oa-panel);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.oa-app-card:hover {
  border-color: var(--oa-line-strong);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}
.oa-app-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.oa-app-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--oa-accent-line);
  background: var(--oa-accent-soft);
  color: var(--oa-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.oa-app-card-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--oa-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
}
.oa-app-card-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--oa-line);
  font-size: 12px;
}
.oa-app-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--oa-line);
}

/* Full Panel Views (Wizard & App Detail) */
.oa-overlay-view {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 150px);
  border: 1px solid var(--oa-line);
  border-radius: 14px;
  background: var(--oa-panel);
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
}
.oa-overlay-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--oa-line);
  background: var(--oa-panel);
  flex-shrink: 0;
}
.oa-overlay-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  background: var(--oa-canvas);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.oa-overlay-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--oa-line);
  background: var(--oa-panel);
  flex-shrink: 0;
}

/* Stepper */
.oa-stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--oa-line);
  background: var(--oa-paper);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.oa-step-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--oa-muted);
}
.oa-step-item.active { color: var(--oa-accent); font-weight: 600; }
.oa-step-item.done { color: var(--oa-ok); }
.oa-step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--oa-panel);
  border: 1px solid var(--oa-line-strong);
  color: var(--oa-muted);
}
.oa-step-item.active .oa-step-num {
  background: var(--oa-accent);
  border-color: var(--oa-accent);
  color: #ffffff;
}
.oa-step-item.done .oa-step-num {
  background: var(--oa-ok-soft);
  border-color: var(--oa-ok-line);
  color: var(--oa-ok);
}
.oa-step-sep {
  width: 24px;
  height: 1px;
  background: var(--oa-line-strong);
}

/* Form Elements */
.oa-form-card {
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
  background: var(--oa-panel);
  border: 1px solid var(--oa-line);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.oa-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.oa-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--oa-ink);
}
.oa-hint {
  font-size: 11.5px;
  color: var(--oa-muted);
}
.oa-input, .oa-select, .oa-textarea {
  width: 100%;
  border: 1px solid var(--oa-line-strong);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 13px;
  background: var(--oa-panel);
  color: var(--oa-ink);
  transition: border-color 0.15s;
}
.oa-input:focus, .oa-select:focus, .oa-textarea:focus {
  outline: none;
  border-color: var(--oa-accent);
}
.oa-input[readonly] {
  background: var(--oa-paper);
  color: var(--oa-muted);
}
.oa-compound-url {
  display: flex;
  align-items: center;
  border: 1px solid var(--oa-line-strong);
  border-radius: 9px;
  overflow: hidden;
  background: var(--oa-panel);
}
.oa-compound-url:focus-within { border-color: var(--oa-accent); }
.oa-compound-addon {
  padding: 8px 10px;
  background: var(--oa-paper);
  color: var(--oa-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
.oa-compound-addon.prefix { border-right: 1px solid var(--oa-line); }
.oa-compound-addon.suffix { border-left: 1px solid var(--oa-line); }
.oa-compound-input {
  border: none !important;
  border-radius: 0 !important;
  outline: none;
  padding: 8px 10px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  min-width: 100px;
  flex: 1;
  background: transparent !important;
}

.oa-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.oa-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 720px) {
  .oa-grid-2, .oa-grid-3 { grid-template-columns: 1fr; }
}

.oa-dropzone {
  border: 2px dashed var(--oa-line-strong);
  border-radius: 12px;
  padding: 18px;
  background: var(--oa-paper);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transition: border-color 0.15s, background 0.15s;
}
.oa-dropzone.dragging {
  border-color: var(--oa-accent);
  background: var(--oa-accent-soft);
}

/* Segmented Tabs */
.oa-segmented {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--oa-line);
  background: var(--oa-paper);
  flex-wrap: wrap;
}
.oa-segmented-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid transparent !important;
  background: transparent !important;
  color: var(--oa-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.oa-segmented-btn:hover { color: var(--oa-ink); }
.oa-segmented-btn.active {
  background: var(--oa-panel) !important;
  color: var(--oa-accent);
  border-color: var(--oa-line) !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
  font-weight: 600;
}

/* Alerts & Banners */
.oa-alert {
  padding: 12px 14px;
  border-radius: 11px;
  border: 1px solid var(--oa-line);
  background: var(--oa-panel);
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.oa-alert-info { background: var(--oa-accent-soft); border-color: var(--oa-accent-line); }
.oa-alert-warn { background: var(--oa-warn-soft); border-color: var(--oa-warn-line); color: #92400e; }
.oa-alert-danger { background: var(--oa-danger-soft); border-color: var(--oa-danger-line); color: #991b1b; }
.oa-alert-ok { background: var(--oa-ok-soft); border-color: var(--oa-ok-line); color: #065f46; }

/* Review Chat & Discovery Cards */
.oa-review-shell {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 460px;
  border: 1px solid var(--oa-line);
  border-radius: 14px;
  background: var(--oa-panel);
  overflow: hidden;
}
.oa-review-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--oa-line);
  background: var(--oa-panel);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.oa-review-stream {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--oa-paper);
}
.oa-review-dock {
  padding: 12px 16px;
  border-top: 1px solid var(--oa-line);
  background: var(--oa-panel);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.oa-msg-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.oa-msg-row.user {
  flex-direction: column;
  align-items: flex-end;
}
.oa-avatar-badge {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--oa-accent-line);
  background: var(--oa-accent-soft);
  color: var(--oa-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.oa-avatar-badge.warn { background: var(--oa-warn-soft); border-color: var(--oa-warn-line); color: var(--oa-warn); }
.oa-avatar-badge.danger { background: var(--oa-danger-soft); border-color: var(--oa-danger-line); color: var(--oa-danger); }
.oa-avatar-badge.ok { background: var(--oa-ok-soft); border-color: var(--oa-ok-line); color: var(--oa-ok); }

.oa-bubble {
  flex: 1;
  min-width: 0;
  border-radius: 12px;
  border: 1px solid var(--oa-line);
  background: var(--oa-panel);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.oa-bubble-user {
  max-width: 85%;
  border-radius: 12px;
  border: 1px solid var(--oa-accent-line);
  background: var(--oa-accent-soft);
  padding: 10px 14px;
  white-space: pre-wrap;
}
.oa-subcard {
  border: 1px solid var(--oa-line);
  border-radius: 10px;
  background: var(--oa-panel);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.oa-subcard.wide { grid-column: 1 / -1; }
.oa-subcard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--oa-line);
}

.oa-timeline-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 220px;
  overflow-y: auto;
}
.oa-timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--oa-paper);
  color: var(--oa-muted);
  font-size: 12px;
}
.oa-timeline-item.latest {
  background: var(--oa-accent-soft);
  border: 1px solid var(--oa-accent-line);
  color: var(--oa-accent);
  font-weight: 500;
}

/* Terminal Log Viewer */
.oa-log-terminal {
  background: #0a0f18;
  color: #34d399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 14px;
  border-radius: 11px;
  overflow: auto;
  max-height: 360px;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid #1e293b;
}
.oa-scroll-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.oa-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
`
