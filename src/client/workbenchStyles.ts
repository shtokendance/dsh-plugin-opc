import inter400 from './fonts/inter-400.woff2'
import inter500 from './fonts/inter-500.woff2'
import inter600 from './fonts/inter-600.woff2'
import inter700 from './fonts/inter-700.woff2'

const faces = [[400, inter400], [500, inter500], [600, inter600], [700, inter700]]
  .map(([weight, url]) => `@font-face{font-family:"OPC Inter";src:url("${url}") format("woff2");font-style:normal;font-weight:${weight};font-display:swap}`)
  .join('\n')

export const workbenchStyles = faces + `
.opc-panel {
  --opc-blue: #2563eb;
  --opc-blue-hover: #1d4ed8;
  --opc-blue-soft: #eff6ff;
  --opc-ink: #0f172a;
  --opc-muted: #64748b;
  --opc-line: #e2e8f0;
  --opc-paper: #f8fafc;
  --opc-motion: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --opc-control-radius: 8px;
  --opc-card-radius: 12px;
  --opc-shadow: 0 1px 2px rgb(15 23 42 / 6%);
  font: 13px/1.6 "OPC Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: #1e293b;
  background: var(--opc-paper);
  -webkit-font-smoothing: antialiased;
}
.opc-panel button:focus-visible,
.opc-panel input:focus-visible,
.opc-panel select:focus-visible,
.opc-panel textarea:focus-visible,
.opc-panel a:focus-visible {
  outline: 2px solid var(--opc-blue);
  outline-offset: 2px;
}
.opc-panel ::-webkit-scrollbar { width: 6px; height: 6px; }
.opc-panel ::-webkit-scrollbar-track { background: #f1f5f9; }
.opc-panel ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
.opc-panel ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
.opc-panel-main { scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }

.opc-panel .opc-header-bar { position: relative; z-index: 3; background: #fff; box-shadow: var(--opc-shadow); }
.opc-header-bar .user-pill { background: #f1f5f9; border-color: transparent; border-radius: var(--opc-control-radius); }
.opc-panel .header-actions :is(.btn-header, .space-select) {
  border-radius: var(--opc-control-radius);
  border-color: var(--opc-line);
  font-size: 12px;
  font-weight: 500;
  box-shadow: var(--opc-shadow);
}
.opc-panel .header-actions .btn-logout { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
.opc-panel .header-actions .btn-logout:hover:not(:disabled) { background: #ffe4e6; }
.opc-panel :is(.resource-card, .kb-results-card) { border-radius: var(--opc-card-radius); box-shadow: var(--opc-shadow); }
.opc-panel :is(.resource-card, .s2-pill, .s2-kb-tab, .oa-btn, .oa-segmented-btn) {
  transition: background var(--opc-motion), color var(--opc-motion), border-color var(--opc-motion), box-shadow var(--opc-motion);
}
.opc-panel .s2-kb-tab {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  padding: 0 0 10px;
  color: var(--opc-muted);
  font-size: 12px;
}
.opc-panel .s2-kb-tab:hover { color: var(--opc-ink); }
.opc-panel .s2-kb-tab.active { color: var(--opc-blue); border-bottom-color: var(--opc-blue); font-weight: 700; }
.opc-panel .s2-kb-tab-catalog.active { color: #b45309; border-bottom-color: #d97706; font-weight: 600; }
.opc-panel .s2-input-catalog { border-color: #fde68a; border-radius: var(--opc-card-radius); }
.opc-panel .s2-pill {
  border-radius: 999px;
  background: #f1f5f9;
  border-color: transparent;
  color: #475569;
  padding: 4px 12px;
  font-size: 11px;
}
.opc-panel .s2-pill:hover:not(.active) { background: #e2e8f0; }
.opc-panel .s2-pill.active { background: var(--opc-blue); color: #fff; }
.opc-panel .s2-command-input {
  border-radius: var(--opc-card-radius);
  border-color: var(--opc-line);
  background: var(--opc-paper);
  padding: 9px 115px 9px 36px;
  font-size: 12px;
}
.opc-panel .s2-command-icon { color: var(--opc-muted); }
.opc-panel .s2-command-clear { background: transparent; border: 0; padding: 2px 5px; }
.opc-panel :is(.s2-command-btn, .s2-btn-blue) {
  background: var(--opc-blue);
  color: #fff;
  border-color: var(--opc-blue);
  border-radius: var(--opc-control-radius);
  font-weight: 600;
}
.opc-panel :is(.s2-command-btn, .s2-btn-blue):hover:not(:disabled) { background: var(--opc-blue-hover); }
.opc-panel .s2-btn-amber { background: #b45309; border-color: #b45309; color: #fff; font-size: 12px; font-weight: 600; }
.opc-panel .s2-btn-amber:hover:not(:disabled) { background: #92400e; }

.opc-workbench-apps { display: contents; }
.opc-workbench-apps[hidden],
.opc-workbench-menu[hidden] { display: none; }
.opc-workbench-nav { position: relative; min-width: 0; }
.opc-panel .opc-workbench-trigger {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
  padding: 3px 7px 3px 3px;
  border: 1px solid transparent;
  border-radius: var(--opc-control-radius);
  background: transparent;
  text-align: left;
}
.opc-panel .opc-workbench-trigger:hover,
.opc-panel .opc-workbench-trigger[aria-expanded="true"] {
  background: var(--opc-paper);
  border-color: var(--opc-line);
}
.opc-workbench-trigger > .oa-icon { flex: 0 0 auto; color: var(--opc-muted); }
.opc-workbench-menu {
  position: absolute;
  inset-inline-start: 0;
  top: calc(100% + 6px);
  display: grid;
  gap: 2px;
  min-width: 190px;
  padding: 5px;
  border: 1px solid var(--opc-line);
  border-radius: var(--opc-card-radius);
  background: #fff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 14%);
}
.opc-panel .opc-workbench-menu button {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  gap: 9px;
  align-items: center;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--opc-control-radius);
  background: transparent;
  text-align: start;
}
.opc-panel .opc-workbench-menu button:hover { background: #f1f5f9; }
.opc-panel .opc-workbench-menu button[aria-current] { background: var(--opc-blue-soft); color: var(--opc-blue-hover); font-weight: 600; }
.opc-workbench-home { container-type: inline-size; display: grid; gap: 16px; }
.opc-home-intro {
  background: linear-gradient(135deg, #ffffff 0%, #f0f6ff 100%);
  border: 1px solid #dbeafe;
  border-radius: var(--opc-card-radius);
  padding: 13px 16px;
  display: grid;
}
.opc-home-intro-copy { display: grid; gap: 3px; }
.opc-home-intro-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.opc-home-intro-copy h2 {
  margin: 0;
  color: var(--opc-ink);
  font-size: 16px;
  font-weight: 700;
}
.opc-home-version {
  font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 8px;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
}
.opc-home-intro-copy p {
  margin: 0;
  color: var(--opc-muted);
  font-size: 12px;
  line-height: 1.5;
}
.opc-home-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  margin-bottom: 10px;
}
.opc-home-section-label { display: inline-flex; align-items: center; gap: 7px; }
.opc-home-section-dot {
  width: 6px;
  height: 14px;
  border-radius: 3px;
  background: var(--opc-blue);
}
.opc-home-section-head h3 { margin: 0; color: var(--opc-ink); font-size: 13.5px; font-weight: 700; }
.opc-home-section-head > span { color: var(--opc-muted); font-size: 11.5px; }
.opc-workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@container (min-width: 520px) {
  .opc-workbench-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.opc-panel .opc-workbench-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--opc-line);
  border-radius: 14px;
  background: #fff;
  box-shadow: var(--opc-shadow);
  transition: border-color var(--opc-motion), box-shadow var(--opc-motion), transform var(--opc-motion);
}
.opc-panel .opc-workbench-card:hover {
  box-shadow: 0 8px 20px -6px rgb(15 23 42 / 10%), 0 2px 6px -2px rgb(15 23 42 / 5%);
  transform: translateY(-2px);
}
.opc-panel .opc-workbench-card[data-kind="knowledge"]:hover { border-color: #60a5fa; }
.opc-panel .opc-workbench-card[data-kind="skills"]:hover { border-color: #a78bfa; }
.opc-panel .opc-workbench-card[data-kind="mcp"]:hover { border-color: #34d399; }
.opc-panel .opc-workbench-card[data-kind="apps"]:hover { border-color: #fbbf24; }
.opc-workbench-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.opc-panel .opc-workbench-card-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 11px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: start;
  cursor: pointer;
  flex: 1 1 auto;
  min-width: 0;
}
.opc-workbench-card-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
  flex: 0 0 auto;
}
.opc-workbench-card-skills { background: #f5f3ff; color: #6d28d9; }
.opc-workbench-card-mcp { background: #ecfdf5; color: #047857; }
.opc-workbench-card-apps { background: #fffbeb; color: #b45309; }
.opc-workbench-card-copy { display: grid; gap: 5px; min-width: 0; }
.opc-workbench-card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.opc-workbench-card-title-row strong { color: var(--opc-ink); font-size: 14.5px; font-weight: 700; }
.opc-workbench-card-tag {
  font: 500 10.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1px 6px;
  border-radius: 5px;
  background: #f1f5f9;
  color: var(--opc-muted);
}
.opc-workbench-card-copy > span:last-child { color: var(--opc-muted); font-size: 12px; line-height: 1.5; }
.opc-panel .opc-workbench-card-help {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--opc-line);
  background: #fff;
  color: var(--opc-muted);
  font-size: 11.5px;
  font-weight: 600;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
  padding: 0;
  transition: background var(--opc-motion), color var(--opc-motion), border-color var(--opc-motion);
}
.opc-panel .opc-workbench-card-help:hover {
  background: #f1f5f9;
  color: var(--opc-ink);
  border-color: #cbd5e1;
}
.opc-panel .opc-workbench-card-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 11px;
  border-radius: 9px;
  border: 0;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--opc-motion), color var(--opc-motion);
}
.opc-panel .opc-cta-knowledge { background: #eff6ff; color: #1d4ed8; }
.opc-panel .opc-workbench-card:hover .opc-cta-knowledge { background: #2563eb; color: #fff; }
.opc-panel .opc-cta-skills { background: #f5f3ff; color: #6d28d9; }
.opc-panel .opc-workbench-card:hover .opc-cta-skills { background: #7c3aed; color: #fff; }
.opc-panel .opc-cta-mcp { background: #ecfdf5; color: #047857; }
.opc-panel .opc-workbench-card:hover .opc-cta-mcp { background: #059669; color: #fff; }
.opc-panel .opc-cta-apps { background: #fffbeb; color: #b45309; }
.opc-panel .opc-workbench-card:hover .opc-cta-apps { background: #d97706; color: #fff; }

.opc-home-ref {
  background: #f1f5f9;
  border: 1px dashed #cbd5e1;
  border-radius: 14px;
  padding: 13px 15px;
  display: grid;
  gap: 10px;
}
.opc-home-ref-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.opc-home-ref-title { display: inline-flex; align-items: center; gap: 7px; }
.opc-home-ref-title h3 { margin: 0; font-size: 12.5px; font-weight: 650; color: #475569; }
.opc-home-ref-badge {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  color: #475569;
  font-weight: 500;
}
.opc-panel .opc-home-ref-toggle {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  font-size: 11.5px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.opc-panel .opc-home-ref-toggle:hover { background: #f8fafc; color: var(--opc-ink); }
.opc-home-quick-strip { display: flex; flex-wrap: wrap; gap: 7px; }
.opc-panel .opc-home-quick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgb(255 255 255 / 80%);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 4px 9px;
  font-size: 11.5px;
  color: #475569;
  cursor: pointer;
}
.opc-panel .opc-home-quick-chip:hover { background: #fff; border-color: #94a3b8; color: var(--opc-ink); }
.opc-home-quick-chip code {
  font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--opc-ink);
}
.opc-home-ref-details {
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
  display: grid;
  gap: 12px;
}
.opc-home-guide-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}
.opc-panel .opc-home-guide-tab {
  border: 1px solid transparent;
  background: transparent;
  padding: 5px 10px;
  border-radius: 7px;
  color: var(--opc-muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.opc-panel .opc-home-guide-tab:hover { color: var(--opc-ink); }
.opc-panel .opc-home-guide-tab.is-active {
  background: #fff;
  color: var(--opc-ink);
  border-color: #dbe2ea;
  font-weight: 600;
  box-shadow: var(--opc-shadow);
}
.opc-home-guide-body { font-size: 12px; line-height: 1.6; }
.opc-guide-pane { display: grid; gap: 12px; }
.opc-guide-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.opc-guide-pane-head strong { color: var(--opc-ink); font-size: 13px; }
.opc-panel .opc-guide-link-btn {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--opc-blue);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.opc-guide-illustrated-list { display: grid; gap: 10px; }
.opc-guide-step-row {
  background: #fff;
  border: 1px solid var(--opc-line);
  border-radius: 11px;
  padding: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
@container (min-width: 520px) {
  .opc-guide-step-row { grid-template-columns: minmax(0, 1fr) 200px; }
}
.opc-guide-step-copy { display: grid; gap: 4px; }
.opc-guide-step-copy h4 { margin: 0; font-size: 13px; font-weight: 700; color: var(--opc-ink); }
.opc-guide-step-copy p { margin: 0; font-size: 12px; color: var(--opc-muted); line-height: 1.55; }
.opc-guide-badge {
  display: inline-block;
  width: fit-content;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--opc-blue-soft);
  color: #1d4ed8;
}
.opc-badge-skills { background: #f5f3ff; color: #6d28d9; }
.opc-badge-mcp { background: #ecfdf5; color: #047857; }
.opc-badge-apps { background: #fffbeb; color: #b45309; }
.opc-panel .opc-guide-shot-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
  background: #f8fafc;
  cursor: zoom-in;
  text-align: left;
}
.opc-guide-shot-btn img {
  display: block;
  width: 100%;
  height: 118px;
  object-fit: cover;
  object-position: top left;
}
.opc-guide-shot-cap {
  display: block;
  padding: 4px 8px;
  font-size: 10.5px;
  color: var(--opc-muted);
  background: #f8fafc;
  border-top: 1px solid var(--opc-line);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opc-guide-shot-placeholder {
  height: 118px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  display: grid;
  place-items: center;
  padding: 8px;
  color: var(--opc-muted);
  font-size: 11px;
  text-align: center;
}
.opc-panel .opc-guide-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--opc-line);
  background: #fff;
  color: #334155;
  font-size: 11px;
  cursor: pointer;
}
.opc-panel .opc-guide-copy-btn:hover { background: #f1f5f9; }
.opc-guide-cmd-syntax {
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--opc-ink);
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 5px 8px;
  word-break: break-all;
}
.opc-guide-extras {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
@container (min-width: 520px) {
  .opc-guide-extras { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
}
.opc-guide-example-box,
.opc-guide-tip-box {
  padding: 11px 12px;
  border-radius: 10px;
  border: 1px solid var(--opc-line);
  background: #fff;
  display: grid;
  gap: 6px;
}
.opc-guide-tip-box { background: #f8fafc; }
.opc-guide-example-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.opc-guide-example-head strong,
.opc-guide-tip-box strong { color: var(--opc-ink); font-size: 12px; font-weight: 600; }
.opc-guide-tip-box p { margin: 0; color: var(--opc-muted); font-size: 11.5px; line-height: 1.5; }
.opc-guide-faq-list {
  display: grid;
  border: 1px solid var(--opc-line);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.opc-guide-faq-item {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--opc-line);
}
.opc-guide-faq-item:last-child { border-bottom: 0; }
.opc-guide-faq-item strong { color: var(--opc-ink); font-size: 12px; }
.opc-guide-faq-item span { color: var(--opc-muted); font-size: 11.5px; }
.opc-guide-modal-backdrop,
.opc-guide-lightbox {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 42%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 60;
}
.opc-guide-lightbox { background: rgb(15 23 42 / 78%); z-index: 80; }
.opc-guide-modal {
  background: #f8fafc;
  border: 1px solid var(--opc-line);
  border-radius: 14px;
  max-width: 560px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 16px 18px;
  box-shadow: 0 24px 48px rgb(15 23 42 / 22%);
  display: grid;
  gap: 12px;
}
.opc-guide-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.opc-guide-modal-head strong { font-size: 14.5px; color: var(--opc-ink); }
.opc-panel .opc-guide-modal-close {
  border: 0;
  background: #e2e8f0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  color: var(--opc-ink);
  font-size: 12px;
}
.opc-guide-lightbox-inner {
  max-width: 920px;
  width: 100%;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 25px 60px rgb(0 0 0 / 40%);
}
.opc-guide-lightbox-inner img {
  display: block;
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  background: #0f172a;
}
.opc-guide-lightbox-bar {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--opc-ink);
}
.opc-panel .opc-guide-lightbox-bar button {
  border: 1px solid var(--opc-line);
  background: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .opc-panel { --opc-motion: 0ms; }
  .opc-panel *, .opc-panel *::before, .opc-panel *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`
