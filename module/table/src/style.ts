// The module's CSS, loaded with its code the first time one of its blocks shows (installStyle).

const hueList = ['#b8860b', '#c0643c', '#7a8a35', '#3d8a7a', '#b5546a', '#a08a5a', '#5f8a5f', '#8a5a3c'];

export const tableStyle = `
.oi-table { position: relative; font-size: 0.92em; outline: none; }
.oi-table-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; min-height: 28px; }
.oi-table-title { border: 0; background: none; color: var(--oi-color-text); font: inherit; font-size: 1.1em; font-weight: 650; padding: 2px 6px 2px 2px; margin-right: 4px; border-radius: 6px; cursor: text; }
.oi-table-title:hover:not([disabled]) { background: var(--oi-color-surface2); }
.oi-table-title-empty { color: var(--oi-color-text-muted); font-weight: 400; font-size: 0.92em; }
.oi-table-title[disabled] { cursor: default; }
.oi-table-pill-own { background: color-mix(in srgb, var(--oi-pill) 22%, transparent); color: color-mix(in srgb, var(--oi-pill) 72%, var(--oi-color-text)); }
.oi-table-segment-row { display: inline-flex; border: 1px solid var(--oi-color-border); border-radius: 7px; overflow: hidden; }
.oi-table-segment { border: 0; background: none; color: var(--oi-color-text-muted); font: inherit; font-size: 0.88em; padding: 3px 9px; cursor: pointer; }
.oi-table-segment + .oi-table-segment { border-left: 1px solid var(--oi-color-border); }
.oi-table-segment.active { background: var(--oi-color-accent-soft); color: var(--oi-color-text); }
.oi-table-segment:hover:not(.active) { background: var(--oi-color-surface2); }
.oi-table-chip { display: inline-flex; align-items: center; border: 1px solid var(--oi-color-border); border-radius: 999px; background: var(--oi-color-surface1); font-size: 0.85em; max-width: 22em; }
.oi-table-chip-text { border: 0; background: none; color: inherit; font: inherit; padding: 2px 4px 2px 9px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-table-chip-source { padding: 2px 9px; color: var(--oi-color-text-muted); }
.oi-table-chip-remove { display: grid; place-items: center; width: 20px; height: 20px; border: 0; background: none; color: var(--oi-color-text-muted); border-radius: 50%; cursor: pointer; margin-right: 2px; }
.oi-table-chip-remove:hover { background: var(--oi-color-surface3); color: var(--oi-color-text); }
.oi-table-bar-space { flex: 1; }
.oi-table-search { width: 9em; font: inherit; font-size: 0.88em; padding: 3px 8px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: var(--oi-color-background); color: var(--oi-color-text); }
.oi-table-search:focus { width: 13em; outline: 2px solid var(--oi-color-accent-soft); }
.oi-table-button { font: inherit; font-size: 0.88em; padding: 3px 10px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: var(--oi-color-surface1); color: var(--oi-color-text); cursor: pointer; }
.oi-table-button:hover, .oi-table-button.active { background: var(--oi-color-surface2); }
.oi-table-button.primary { background: var(--oi-color-accent); border-color: var(--oi-color-accent); color: var(--oi-color-background); }
.oi-table-icon { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: var(--oi-color-text-muted); cursor: pointer; }
.oi-table-icon:hover { background: var(--oi-color-surface2); color: var(--oi-color-text); }
.oi-table-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 6px; padding: 6px 8px; border: 1px solid var(--oi-color-border); border-radius: 8px; background: var(--oi-color-surface1); }
.oi-table-ask label { color: var(--oi-color-text-muted); font-size: 0.88em; }
.oi-table-ask input { flex: 1; min-width: 10em; font: inherit; font-family: var(--oi-font-code); font-size: 0.88em; padding: 3px 7px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); }
.oi-table-scroll { overflow-x: auto; border: 1px solid var(--oi-color-border); border-radius: 8px; }
.oi-table-grid { border-collapse: separate; border-spacing: 0; width: 100%; min-width: max-content; }
.oi-table-grid th, .oi-table-grid td { border-bottom: 1px solid var(--oi-color-border); border-right: 1px solid color-mix(in srgb, var(--oi-color-border) 60%, transparent); padding: 0; text-align: left; vertical-align: middle; height: 30px; }
.oi-table-grid th { background: var(--oi-table-header-background); font-weight: 600; position: sticky; top: 0; z-index: 1; }
.oi-table-grid td { padding: 4px 9px; min-width: 5em; max-width: 26em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: cell; }
.oi-read-only .oi-table-grid td { cursor: default; }
.oi-table-grid td[data-type="Number"], .oi-table-grid td[data-type="Formula"] { text-align: right; font-variant-numeric: tabular-nums; }
.oi-table-grid th[data-type="Number"] .oi-table-head { justify-content: flex-end; }
.oi-table-grid tbody tr:last-child td { border-bottom: 0; }
.oi-table-grid tfoot td { border-top: 1px solid var(--oi-color-border); border-bottom: 0; }
.oi-table-head { display: flex; align-items: center; gap: 5px; width: 100%; border: 0; background: none; color: inherit; font: inherit; padding: 5px 9px; cursor: pointer; white-space: nowrap; }
.oi-table-head:hover { background: var(--oi-color-surface2); }
.oi-table-type { display: inline-grid; color: var(--oi-color-text-muted); }
.oi-table-sort { color: var(--oi-color-accent); }
.oi-table-handle { width: 22px; min-width: 22px !important; padding: 0 !important; border-right: 0 !important; text-align: center !important; }
.oi-table-row-handle { display: grid; place-items: center; width: 22px; height: 26px; border: 0; background: none; color: var(--oi-color-text-muted); opacity: 0; cursor: grab; }
tr:hover .oi-table-row-handle, .oi-table-row-handle:focus-visible { opacity: 0.8; }
@media (hover: none) { .oi-table-row-handle { opacity: 0.5; } }
.oi-table-add-column { width: 32px; min-width: 32px !important; text-align: center !important; padding: 0 !important; }
.oi-table-selected { background: color-mix(in srgb, var(--oi-color-accent) 12%, transparent); }
.oi-table-active { box-shadow: inset 0 0 0 2px var(--oi-color-accent); }
.oi-table-editing { padding: 0 !important; box-shadow: inset 0 0 0 2px var(--oi-color-accent); background: var(--oi-color-background); }
.oi-table-editing input { width: 100%; min-width: 7em; height: 30px; box-sizing: border-box; border: 0; outline: 0; padding: 4px 9px; font: inherit; background: transparent; color: inherit; }
.oi-table-check { width: 15px; height: 15px; margin: 0; accent-color: var(--oi-color-accent); cursor: pointer; }
.oi-table-pill { display: inline-block; padding: 1px 8px; margin: 1px 4px 1px 0; border-radius: 999px; font-size: 0.9em; background: var(--oi-color-surface2); }
${hueList.map((hue, index) => `.oi-table-pill[data-hue="${index}"] { background: color-mix(in srgb, ${hue} 20%, transparent); color: color-mix(in srgb, ${hue} 70%, var(--oi-color-text)); }`).join('\n')}
.oi-table-link { color: var(--oi-color-accent); text-decoration: none; cursor: pointer; }
.oi-table-link:hover { text-decoration: underline; }
.oi-table-file { border: 0; background: none; font: inherit; padding: 0 0 0 4px; }
.oi-table-sheet { font: inherit; font-size: 0.85em; padding: 2px 6px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: var(--oi-color-background); color: var(--oi-color-text); }
.oi-table-footer td { border-right-color: transparent !important; }
.oi-table-group td { background: var(--oi-color-surface1); font-weight: 600; cursor: default !important; }
.oi-table-group-count { margin-left: 8px; color: var(--oi-color-text-muted); font-weight: 400; font-size: 0.88em; }
.oi-table-subtotal td, .oi-table-footer td { color: var(--oi-color-text-muted); font-size: 0.9em; cursor: default !important; text-align: right; }
.oi-table-summary-button { width: 100%; border: 0; background: none; color: inherit; font: inherit; text-align: right; padding: 2px 0; cursor: pointer; border-radius: 4px; }
.oi-table-summary-button:hover { background: var(--oi-color-surface2); }
.oi-table-summary-hint { opacity: 0; }
.oi-table-summary-button:hover .oi-table-summary-hint, .oi-table-summary-button:focus-visible .oi-table-summary-hint { opacity: 1; }
.oi-table-summary-label { margin-right: 5px; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.75; }
.oi-table-new td, .oi-table-more td { padding: 0 !important; cursor: default !important; }
.oi-table-new-button { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: none; color: var(--oi-color-text-muted); font: inherit; padding: 5px 9px; cursor: pointer; text-align: left; border-radius: 6px; }
.oi-table-new-button:hover { background: var(--oi-color-surface1); color: var(--oi-color-text); }
.oi-table-more td { text-align: center !important; padding: 6px !important; }
.oi-table-drop-before td { box-shadow: inset 0 2px 0 var(--oi-color-accent); }
.oi-table-drop-after td { box-shadow: inset 0 -2px 0 var(--oi-color-accent); }
.oi-table-dragging, .oi-table-dragging * { cursor: grabbing !important; user-select: none; }
.oi-table-status { min-height: 1.2em; margin-top: 3px; font-size: 0.85em; color: var(--oi-color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
.oi-table-status:empty { min-height: 0; margin: 0; }
.oi-table-source { display: block; width: 100%; box-sizing: border-box; min-height: 8em; margin-top: 6px; font-family: var(--oi-font-code); font-size: 0.9em; line-height: 1.5; padding: 8px; border: 1px solid var(--oi-color-border); border-radius: 8px; background: var(--oi-color-surface1); color: var(--oi-color-text); resize: vertical; tab-size: 4; }
.oi-table-problem { margin-top: 4px; font-size: 0.85em; color: var(--oi-color-danger); }
.oi-table-empty { padding: 14px; border: 1px dashed var(--oi-color-border); border-radius: 8px; color: var(--oi-color-text-muted); }
.oi-table-empty p { margin: 0 0 8px; }
.oi-table-board { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; align-items: flex-start; }
.oi-table-lane { flex: 0 0 15em; background: var(--oi-color-surface1); border-radius: 10px; padding: 8px; border: 2px solid transparent; }
.oi-table-lane-target { border-color: var(--oi-color-accent); }
.oi-table-lane-head { display: flex; align-items: center; margin-bottom: 8px; }
.oi-table-lane-body { display: flex; flex-direction: column; gap: 7px; }
.oi-table-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(12em, 1fr)); gap: 10px; }
.oi-table-list { display: flex; flex-direction: column; border: 1px solid var(--oi-color-border); border-radius: 8px; }
.oi-table-list .oi-table-card { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; border: 0; border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--oi-color-border); }
.oi-table-list .oi-table-card:last-of-type { border-bottom: 0; }
.oi-table-list .oi-table-card-title { margin: 0; }
.oi-table-card { background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 10px; padding: 8px 10px; cursor: pointer; box-shadow: 0 1px 2px color-mix(in srgb, var(--oi-color-text) 8%, transparent); }
.oi-table-card:hover { border-color: color-mix(in srgb, var(--oi-color-accent) 50%, var(--oi-color-border)); }
.oi-table-card-lifted { opacity: 0.55; }
.oi-table-card-title { font-weight: 600; margin-bottom: 4px; overflow-wrap: anywhere; }
.oi-table-untitled { color: var(--oi-color-text-muted); font-weight: 400; }
.oi-table-field { display: flex; gap: 6px; font-size: 0.9em; line-height: 1.6; }
.oi-table-field-name { display: inline-flex; align-items: center; gap: 5px; color: var(--oi-color-text-muted); min-width: 0; }
.oi-table-list .oi-table-field-name { display: none; }
.oi-table-card-panel { position: absolute; z-index: 5; top: 36px; right: 0; width: min(22em, 100%); max-height: 70vh; overflow: auto; background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 10px; padding: 10px 12px; box-shadow: 0 10px 30px color-mix(in srgb, #000 18%, transparent); }
.oi-table-panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.oi-table-panel-head b { flex: 1; }
.oi-table-panel-note { color: var(--oi-color-text-muted); font-size: 0.85em; }
.oi-table-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.oi-table-stat { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9em; }
.oi-table-stat span { color: var(--oi-color-text-muted); }
.oi-table-stat b { font-variant-numeric: tabular-nums; font-weight: 600; }
.oi-table-histogram { display: block; width: 100%; height: 70px; margin-top: 10px; fill: var(--oi-color-accent); opacity: 0.85; }
.oi-table-histogram-axis { display: flex; justify-content: space-between; font-size: 0.8em; color: var(--oi-color-text-muted); }
.oi-table-form-row { display: grid; grid-template-columns: 8em 1fr; align-items: center; gap: 8px; margin: 5px 0; }
.oi-table-form-row .oi-table-field-name { font-size: 0.9em; }
.oi-table-form .oi-table-input { font: inherit; padding: 3px 7px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); min-width: 0; }
@media (max-width: 640px) {
	.oi-table-search { width: 6em; }
	.oi-table-card-panel { position: fixed; left: 12px; right: 12px; top: auto; bottom: 12px; width: auto; }
}
`;
