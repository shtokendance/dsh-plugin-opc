export const appsCss = `
.opc-apps-root {
  --oa-canvas: #f8fafc;
  --oa-panel: #ffffff;
  --oa-paper: #f8fafc;
  --oa-ink: #0f172a;
  --oa-muted: #64748b;
  --oa-line: #e2e8f0;
  --oa-line-strong: #cbd5e1;
  --oa-accent: var(--opc-blue, #2563eb);
  --oa-accent-soft: var(--opc-blue-soft, #eff6ff);
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
  border-radius: var(--opc-control-radius, 8px);
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
  background: #1d4ed8;
  border-color: #1d4ed8;
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
.oa-app-list {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.oa-app-list-toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
.oa-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0 14px;
  border-bottom: 1px solid var(--oa-line);
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
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
@container (min-width: 536px) {
  .oa-apps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (min-width: 812px) {
  .oa-apps-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.oa-app-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 18px;
  border-radius: var(--opc-card-radius, 12px);
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
  gap: 6px;
}
.oa-app-card-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.oa-app-card-heading { min-width: 0; }
.oa-app-card-name { display: flex; align-items: center; gap: 6px; }
.oa-app-card-name h3,
.oa-app-card-slug {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oa-app-card-name h3 { margin: 0; color: var(--oa-ink); font-size: 13px; font-weight: 650; }
.oa-app-card-slug { color: var(--oa-muted); font-size: 11px; }
.oa-app-version {
  flex-shrink: 0;
  border: 1px solid var(--oa-accent-line);
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 650;
  color: var(--oa-accent);
  background: var(--oa-accent-soft);
}
.oa-app-card-status .oa-dot { background: currentColor; }
.oa-app-card-status { flex-shrink: 0; }
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
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--oa-line);
  font-size: 12px;
}
.oa-app-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--oa-line);
  border-radius: 8px;
  background: var(--oa-paper);
  font-size: 11.5px;
}
.oa-app-card-row > span:first-child {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--oa-muted);
}
.oa-app-card-row > a,
.oa-app-card-row > code,
.oa-app-card-error > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oa-app-card-row > a { color: var(--oa-accent); text-decoration: none; }
.oa-app-card-row > a:hover, .oa-app-card-row > a:focus-visible { text-decoration: underline; }
.oa-app-card-row > code { background: var(--oa-panel); padding-block: 1px; }
.oa-app-card-error { padding: 7px 9px; font-size: 11.5px; }
.oa-app-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--oa-line);
}
.oa-app-card-detail { margin-inline-start: auto; }

/* Full Panel Views (Wizard & App Detail) */
.oa-overlay-view {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 150px);
  border: 1px solid var(--oa-line);
  border-radius: var(--opc-card-radius, 12px);
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

/* Deployment wizard header */
.oa-wizard-header {
  container-type: inline-size;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  padding-block: 14px;
  background: var(--oa-paper);
}
.oa-wizard-heading,
.oa-wizard-identity,
.oa-wizard-title-line {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 9px;
}
.oa-wizard-heading { justify-content: space-between; align-items: flex-start; }
.oa-wizard-identity { align-items: flex-start; flex: 1; }
.oa-wizard-title { min-width: 0; }
.oa-wizard-title-line { flex-wrap: wrap; gap: 4px 8px; }
.oa-wizard-title-line .oa-code { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-wizard-title h2 { margin: 0; font-size: 14px; font-weight: 700; color: var(--oa-ink); }
.oa-wizard-title p { margin: 2px 0 0; font-size: 11.5px; color: var(--oa-muted); }
.oa-wizard-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--opc-control-radius, 8px);
  flex-shrink: 0;
  background: var(--oa-accent-soft);
  color: var(--oa-accent);
}
.oa-wizard-return { flex-shrink: 0; }
.oa-stepper {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
@container (max-width: 400px) {
  .oa-stepper { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.oa-step-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px;
  border: 1px solid var(--oa-line);
  border-radius: var(--opc-control-radius, 8px);
  background: #f1f5f9;
  text-align: center;
  color: var(--oa-muted);
  font-size: 11.5px;
  font-weight: 500;
}
.oa-step-item.active {
  background: var(--oa-accent-soft);
  border-color: #93b5fd;
  color: var(--oa-accent);
  font-weight: 600;
}
.oa-step-item.done {
  background: var(--oa-ok-soft);
  border-color: var(--oa-ok-line);
  color: var(--oa-ok);
}
.oa-step-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Form Elements */
.oa-form-card {
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
  background: var(--oa-panel);
  border: 1px solid var(--oa-line);
  border-radius: var(--opc-card-radius, 12px);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.oa-detail-tab-panel {
  width: 100%;
  min-width: 0;
}
.oa-detail-tab-panel > .oa-form-card {
  max-width: none;
  margin: 0;
}
.oa-detail-tab-list {
  margin-bottom: -14px;
  padding-bottom: 0;
  border-radius: 10px 10px 0 0;
}
.oa-detail-tab-list .oa-segmented-btn.active {
  position: relative;
  z-index: 1;
  border-bottom-color: var(--oa-panel) !important;
  border-radius: 7px 7px 0 0;
  box-shadow: none;
}
.oa-detail-tab-panel {
  background: var(--oa-panel);
  border-radius: 0 0 12px 12px;
}
.oa-runtime-toolbar, .oa-runtime-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.oa-runtime-toolbar { justify-content: space-between; }
.oa-runtime-history {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--oa-line);
  padding-top: 12px;
}
.oa-runtime-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgb(15 23 42 / 28%);
  padding: 16px;
}
.oa-runtime-panel { max-width: 460px; }
.oa-source-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.oa-source-form > .oa-form-card { max-width: none; margin: 0; }
.oa-deploy-review {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}
.oa-deploy-review .oa-form-card {
  max-width: none;
  margin: 0;
}
.oa-deploy-loading {
  align-items: center;
  justify-content: center;
  min-height: 148px;
  gap: 8px;
  text-align: center;
}
.oa-deploy-loading-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 50%;
  color: var(--oa-accent);
  background: var(--oa-accent-soft);
}
@media (prefers-reduced-motion: reduce) {
  .oa-deploy-loading .oa-spin { animation: none; }
}
.oa-source-label { margin: 0; font-size: 13px; font-weight: 600; }
.oa-source-label > span { color: var(--oa-danger); }
.oa-source-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  background: var(--oa-panel);
  border: 1px solid var(--oa-line);
  border-radius: var(--opc-card-radius, 12px);
  color: var(--oa-muted);
}
.oa-source-actions,
.oa-source-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.oa-source-actions { justify-content: center; margin-top: 6px; }
.oa-source-choice {
  padding: 8px 10px;
  border: 1px solid var(--oa-ok-line);
  border-radius: 8px;
  background: var(--oa-ok-soft);
  color: #065f46;
  font-size: 12px;
}
.oa-source-choice > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.oa-source-form .oa-dropzone { padding: 22px 14px; gap: 8px; }
.oa-source-form .oa-dropzone > .oa-hint { max-width: 460px; }
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
  align-items: stretch;
  width: 100%;
  border: 1px solid var(--oa-line-strong);
  border-radius: 9px;
  overflow: hidden;
  background: var(--oa-panel);
  transition: border-color .15s, box-shadow .15s;
}
.oa-compound-url:focus-within {
  border-color: var(--oa-accent);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}
.oa-compound-addon {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--oa-paper);
  color: var(--oa-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.oa-compound-addon.prefix { border-right: 1px solid var(--oa-line); }
.oa-compound-addon.suffix {
  display: block;
  line-height: 1.5;
  border-left: 1px solid var(--oa-line);
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}
.opc-apps-root .oa-compound-input {
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: none;
  padding: 8px 12px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  width: 0;
  min-width: 120px;
  flex: 1 1 0%;
  background: transparent !important;
  color: var(--oa-ink);
}
.oa-url-preview-bar {
  margin-top: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--oa-paper);
  border: 1px solid var(--oa-line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
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
  border-radius: 12px;
  border: 1px solid var(--oa-line);
  background: #f1f5f9;
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

.oa-config-tab-warning { background: var(--oa-warn); }
.oa-delivery-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.oa-dockerfile-panel { min-width: 0; }
.oa-dockerfile-panel p { margin: 0; }
.oa-dockerfile-source {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--oa-line);
  border-radius: 8px;
  background: var(--oa-paper);
  color: var(--oa-ink);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 4;
}
.oa-dockerfile-source:focus-visible { outline: 2px solid var(--oa-accent); outline-offset: 2px; }

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
  border-radius: var(--opc-card-radius, 12px);
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
.oa-deploy-progress {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
}
.oa-deploy-progress > :not(.oa-deploy-logs) { flex-shrink: 0; }
.oa-deploy-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--oa-line);
  border-radius: 12px;
  background: var(--oa-paper);
}
.oa-deploy-status .oa-dot { background: currentColor; }
.oa-health-result { align-items: center; flex-wrap: wrap; }
.oa-health-result > div { flex: 1; }
.oa-deploy-actions,
.oa-deploy-log-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.oa-deploy-message {
  min-width: 0;
  max-height: 8em;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.oa-deploy-recheck-error { color: var(--oa-danger); }
.oa-deploy-logs,
.oa-deploy-log-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 8px;
}
.oa-deploy-logs.is-open { flex: 1 1 0; min-height: 170px; }
.oa-deploy-log-toolbar { flex-shrink: 0; justify-content: space-between; }
.opc-apps-root .oa-deploy-log-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--oa-ink);
  font-size: 12px;
  font-weight: 600;
}
.oa-deploy-log-content { flex: 1 1 0; min-height: 0; }
.oa-deploy-logs .oa-log-terminal { flex: 1 1 0; min-height: 120px; max-height: none; margin: 0; }
.opc-apps-root.oa-apps-log-view,
.oa-apps-log-view > .oa-overlay-view {
  flex: 1 1 0;
  min-height: 0;
}
.oa-apps-log-view .oa-overlay-body { min-height: 0; }
.oa-apps-log-view .oa-overlay-body > :not(.oa-detail-log-panel, .oa-deploy-progress) { flex-shrink: 0; }
.oa-detail-log-panel {
  display: flex;
  flex: 1 0 240px;
  flex-direction: column;
  min-width: 0;
}
.oa-detail-log-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 10px;
}
.oa-detail-log-toolbar,
.oa-detail-log-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.oa-detail-log-toolbar {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--oa-line);
}
.oa-detail-log-meta { color: var(--oa-muted); font-size: 11.5px; }
.oa-detail-log-card .oa-log-terminal {
  flex: 1 1 0;
  min-height: 150px;
  max-height: none;
  margin: 0;
}
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
.oa-discovery-report {
  container-type: inline-size;
  gap: 14px;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.oa-report-header,
.oa-report-header > div,
.oa-report-routes h4 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.oa-report-header { justify-content: space-between; color: var(--oa-muted); }
.oa-report-header svg, .oa-report-routes h4 svg { color: var(--oa-accent); flex: none; }
.oa-discovery-report h3, .oa-discovery-report h4, .oa-discovery-report p { margin: 0; }
.oa-discovery-report h3 { color: var(--oa-ink); font-size: 14px; }
.oa-discovery-report h4 { font-size: 12px; }
.oa-report-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 0;
  padding: 8px 12px;
  background: var(--oa-paper);
  border-radius: 8px;
}
.oa-report-facts > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
.oa-discovery-report dt { color: var(--oa-muted); }
.oa-discovery-report dd { margin: 0; }
.oa-report-purpose p { margin-top: 4px; white-space: pre-line; }
.oa-report-purpose-preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.oa-report-inventory {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}
@container (min-width: 540px) {
  .oa-report-inventory { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.oa-report-routes {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--oa-line);
  border-radius: 8px;
}
.oa-report-routes h4 .oa-pill { margin-inline-start: auto; }
.oa-report-routes > p { margin-top: 6px; }
.oa-report-route-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}
.oa-report-route-list li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; }
.oa-report-route-list li + li { border-top: 1px solid var(--oa-line); }
.oa-report-route-list li > div { min-width: 0; }
.oa-report-method { flex: none; }
.oa-report-route-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-report-api-meta { display: grid; gap: 4px; margin-top: 4px; }
.oa-report-api-meta > div { display: flex; flex-wrap: wrap; gap: 4px; }
.oa-report-toggle, .oa-report-deployment summary {
  color: var(--oa-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.oa-report-toggle { padding: 4px 0 0; text-align: start; background: none; border: 0; }
.oa-report-toggle:hover, .oa-report-deployment summary:hover { text-decoration: underline; }
.oa-report-toggle:focus-visible, .oa-report-deployment summary:focus-visible {
  outline: 2px solid var(--oa-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
.oa-report-deployment { border-top: 1px solid var(--oa-line); padding-top: 8px; }
.oa-report-deployment dl { margin: 4px 0 0; }
.oa-report-deployment dl > div { display: grid; grid-template-columns: 5.5em minmax(0, 1fr); gap: 8px; padding: 4px 0; }
.oa-report-deployment ul { margin: 0; padding-inline-start: 16px; }
.oa-report-deployment dd { white-space: pre-line; }
.oa-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Runtime Config Editor */
.oa-cfg-toolbar {
  border-radius: 10px;
  border: 1px solid var(--oa-line);
  background: var(--oa-panel);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.oa-cfg-card {
  border: 1px solid var(--oa-line);
  border-radius: 10px;
  background: var(--oa-panel);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.oa-cfg-card-warn {
  border-color: var(--oa-warn-line);
  background: #fffdf7;
}
.oa-cfg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f1f5f9;
}
.oa-cfg-title-group,
.oa-cfg-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.oa-cfg-friendly {
  font-size: 12px;
  font-weight: 600;
  color: var(--oa-ink);
}
.oa-cfg-key-input {
  width: 190px;
  max-width: 100%;
  padding: 4px 8px;
  font-size: 12px;
}
.oa-cfg-col-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11.5px;
  color: var(--oa-muted);
}
.oa-cfg-secret-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--oa-muted);
  cursor: pointer;
}
.oa-cfg-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.oa-cfg-input-wrap > input {
  flex: 1;
  min-width: 0;
}
.oa-cfg-readonly {
  min-height: 34px;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--oa-paper);
  color: var(--oa-muted);
}
.oa-config-field-warning {
  margin: 0;
  color: #92400e;
  font-size: 11.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.oa-config-key-warning {
  width: 100%;
}
.oa-input[aria-invalid='true'], select[aria-invalid='true'] {
  border-color: var(--oa-warn);
}
.oa-cfg-resources {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid #f1f5f9;
}
.oa-cfg-ref-details {
  font-size: 12px;
}
.oa-cfg-ref-details > summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--oa-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.oa-cfg-ref-toggle {
  display: inline-flex;
  align-items: center;
  transition: transform var(--oa-motion);
}
.oa-cfg-ref-details[open] > summary .oa-cfg-ref-toggle {
  transform: rotate(180deg);
}
.oa-cfg-ref-file {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--oa-line);
  background: var(--oa-paper);
}
.oa-cfg-ref-file > summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.oa-cfg-ref-dl {
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
  gap: 4px 12px;
  font-size: 11.5px;
}
.oa-cfg-ref-dl dt {
  color: var(--oa-ink);
}
.oa-cfg-ref-dl dd {
  margin: 0;
  color: var(--oa-muted);
  word-break: break-all;
}
.oa-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.oa-modal-card {
  width: 100%;
  max-width: 560px;
  background: var(--oa-panel);
  border: 1px solid var(--oa-line);
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.oa-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--oa-line);
  background: var(--oa-paper);
}
.oa-modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 70vh;
  overflow-y: auto;
}
.oa-modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--oa-line);
  background: var(--oa-paper);
}
.oa-table-box {
  border: 1px solid var(--oa-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--oa-panel);
}
.oa-table-head {
  padding: 8px 12px;
  background: var(--oa-paper);
  border-bottom: 1px solid var(--oa-line);
  font-size: 12px;
  font-weight: 600;
  color: var(--oa-muted);
}
.oa-table-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--oa-line);
  font-size: 12px;
}
.oa-table-row:last-child {
  border-bottom: none;
}
.oa-storage-table-head,
.oa-storage-table-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.4fr) minmax(140px, 1.5fr) 76px 68px 80px 84px;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  font-size: 12px;
}
.oa-storage-table-head {
  background: var(--oa-paper);
  border-bottom: 1px solid var(--oa-line);
  font-weight: 600;
  color: var(--oa-muted);
}
.oa-storage-table-row {
  border-bottom: 1px solid var(--oa-line);
}
.oa-storage-table-row:last-child {
  border-bottom: none;
}
.oa-radio-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  border: 1px solid var(--oa-line);
  background: var(--oa-paper);
  cursor: pointer;
}
.oa-radio-card.selected {
  border-color: var(--oa-accent);
  background: var(--oa-accent-soft);
}
.oa-radio-card.danger.selected {
  border-color: var(--oa-danger);
  background: var(--oa-danger-soft);
}
.oa-text-danger {
  color: var(--oa-danger);
}
`
