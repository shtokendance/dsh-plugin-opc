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
  background: #fff;
  border: 1px solid var(--opc-line);
  border-radius: var(--opc-card-radius);
  padding: 16px;
  box-shadow: var(--opc-shadow);
  display: grid;
  gap: 14px;
}
.opc-home-intro-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.opc-home-intro-copy { display: grid; gap: 4px; flex: 1 1 280px; }
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
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
  border: 1px solid #bfdbfe;
}
.opc-home-intro-copy p {
  margin: 0;
  color: var(--opc-muted);
  font-size: 12px;
  line-height: 1.55;
}
.opc-panel .opc-home-intro-btn {
  padding: 7px 12px;
  border-radius: var(--opc-control-radius);
  border: 1px solid var(--opc-blue);
  background: var(--opc-blue);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.opc-panel .opc-home-intro-btn:hover { background: var(--opc-blue-hover); border-color: var(--opc-blue-hover); }
.opc-home-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 12px;
}
.opc-home-section-head h3 { margin: 0; color: var(--opc-ink); font-size: 14px; font-weight: 700; }
.opc-home-section-head span { color: var(--opc-muted); font-size: 11px; }
.opc-workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@container (min-width: 520px) {
  .opc-workbench-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.opc-panel .opc-workbench-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid var(--opc-line);
  border-radius: var(--opc-card-radius);
  background: #fff;
  box-shadow: var(--opc-shadow);
  transition: border-color var(--opc-motion), box-shadow var(--opc-motion), transform var(--opc-motion);
}
.opc-panel .opc-workbench-card:hover {
  border-color: #bfdbfe;
  box-shadow: 0 4px 12px rgb(15 23 42 / 6%);
  transform: translateY(-1px);
}
.opc-panel .opc-workbench-card-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 12px;
  border: 0;
  background: transparent;
  text-align: start;
  cursor: pointer;
  width: 100%;
}
.opc-workbench-card-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
  flex: 0 0 auto;
}
.opc-workbench-card-skills { background: #f5f3ff; color: #6d28d9; }
.opc-workbench-card-mcp { background: #ecfdf5; color: #047857; }
.opc-workbench-card-apps { background: #fffbeb; color: #b45309; }
.opc-workbench-card-copy { display: grid; gap: 4px; min-width: 0; }
.opc-workbench-card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.opc-workbench-card-title-row strong { color: var(--opc-ink); font-size: 14px; font-weight: 700; }
.opc-workbench-card-tag {
  font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
}
.opc-tag-skills { background: #f5f3ff; color: #6d28d9; }
.opc-tag-mcp { background: #ecfdf5; color: #047857; }
.opc-tag-apps { background: #fffbeb; color: #b45309; }
.opc-workbench-card-copy > span:last-child { color: var(--opc-muted); font-size: 12px; line-height: 1.5; }
.opc-workbench-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  border-top: 1px solid #f1f5f9;
  font-size: 12px;
}
.opc-panel .opc-workbench-card-help {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--opc-muted);
  font-size: 12px;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  cursor: pointer;
}
.opc-panel .opc-workbench-card-help:hover { color: var(--opc-ink); }
.opc-panel .opc-workbench-card-go {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--opc-blue);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.opc-panel .opc-go-skills { color: #6d28d9; }
.opc-panel .opc-go-mcp { color: #047857; }
.opc-panel .opc-go-apps { color: #b45309; }

.opc-home-guide {
  background: #fff;
  border: 1px solid var(--opc-line);
  border-radius: var(--opc-card-radius);
  box-shadow: var(--opc-shadow);
  overflow: hidden;
}
.opc-home-guide .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.opc-home-guide-tabs {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px 0;
  border-bottom: 1px solid var(--opc-line);
  background: #f8fafc;
  overflow-x: auto;
}
.opc-panel .opc-home-guide-tab {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  padding: 0 0 9px;
  color: var(--opc-muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.opc-panel .opc-home-guide-tab:hover { color: var(--opc-ink); }
.opc-panel .opc-home-guide-tab.is-active {
  color: var(--opc-blue);
  border-bottom-color: var(--opc-blue);
  font-weight: 600;
}
.opc-home-guide-body { padding: 16px; font-size: 12px; line-height: 1.6; }
.opc-guide-pane { display: grid; gap: 12px; }
.opc-guide-lead { margin: 0; color: var(--opc-muted); }
.opc-guide-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
.opc-guide-cmd-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
@container (min-width: 520px) {
  .opc-guide-cmd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.opc-guide-cmd-card {
  padding: 12px;
  border-radius: 10px;
  background: var(--opc-paper);
  border: 1px solid var(--opc-line);
  display: grid;
  gap: 6px;
}
.opc-guide-cmd-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.opc-cmd-title-knowledge { color: var(--opc-blue); }
.opc-cmd-title-skills { color: #6d28d9; }
.opc-cmd-title-mcp { color: #047857; }
.opc-cmd-title-apps { color: #b45309; }
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
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
}
.opc-guide-cmd-hint { margin: 0; color: var(--opc-muted); font-size: 11px; }
.opc-guide-steps-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
@container (min-width: 520px) {
  .opc-guide-steps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.opc-guide-step-card {
  padding: 12px;
  border-radius: 10px;
  background: var(--opc-paper);
  border: 1px solid var(--opc-line);
  display: grid;
  gap: 6px;
}
.opc-guide-step-top { display: flex; align-items: center; gap: 8px; }
.opc-guide-step-top strong { color: var(--opc-ink); font-size: 12px; font-weight: 700; }
.opc-guide-step-num {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 20px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
  font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.opc-step-tone-skills .opc-guide-step-num { background: #f5f3ff; color: #6d28d9; }
.opc-step-tone-mcp .opc-guide-step-num { background: #ecfdf5; color: #047857; }
.opc-step-tone-apps .opc-guide-step-num { background: #fffbeb; color: #b45309; }
.opc-guide-step-card p { margin: 0; color: var(--opc-muted); font-size: 11px; line-height: 1.55; }
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
.opc-guide-tip-box p { margin: 0; color: var(--opc-muted); font-size: 11px; line-height: 1.5; }
.opc-guide-faq-list {
  display: grid;
  border: 1px solid var(--opc-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--opc-paper);
}
.opc-guide-faq-item {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--opc-line);
}
.opc-guide-faq-item:last-child { border-bottom: 0; }
.opc-guide-faq-item strong { color: var(--opc-ink); font-size: 12px; }
.opc-guide-faq-item span { color: var(--opc-muted); font-size: 11px; }
@media (prefers-reduced-motion: reduce) {
  .opc-panel { --opc-motion: 0ms; }
  .opc-panel *, .opc-panel *::before, .opc-panel *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`
