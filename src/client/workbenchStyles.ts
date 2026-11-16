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
.opc-workbench-home { container-type: inline-size; }
.opc-workbench-home h2 {
  margin: 0 0 16px;
  color: var(--opc-ink);
  font-size: 16px;
  font-weight: 700;
}
.opc-workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@container (min-width: 520px) {
  .opc-workbench-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.opc-panel .opc-workbench-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 15px;
  align-items: center;
  gap: 12px;
  min-height: 82px;
  padding: 14px;
  border: 1px solid var(--opc-line);
  border-radius: var(--opc-card-radius);
  background: #fff;
  text-align: start;
  box-shadow: var(--opc-shadow);
  transition: border-color var(--opc-motion), box-shadow var(--opc-motion), background var(--opc-motion);
}
.opc-panel .opc-workbench-card:hover { border-color: #bfdbfe; background: #fbfdff; box-shadow: 0 2px 8px rgb(37 99 235 / 8%); }
.opc-workbench-card-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--opc-blue-soft);
  color: var(--opc-blue);
}
.opc-workbench-card-skills { background: #f5f3ff; color: #6d28d9; }
.opc-workbench-card-mcp { background: #ecfdf5; color: #047857; }
.opc-workbench-card-apps { background: #fffbeb; color: #92400e; }
.opc-workbench-card-copy { display: grid; gap: 2px; }
.opc-workbench-card-copy strong { color: var(--opc-ink); font-size: 14px; font-weight: 700; }
.opc-workbench-card-copy > span { color: var(--opc-muted); font-size: 12px; }
.opc-workbench-card > .oa-icon { color: var(--opc-muted); }
@media (prefers-reduced-motion: reduce) {
  .opc-panel { --opc-motion: 0ms; }
  .opc-panel *, .opc-panel *::before, .opc-panel *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`
