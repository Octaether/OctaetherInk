// The module's CSS, loaded with its code the first time one of its blocks shows (installStyle).

export const plotStyle = `
.oi-plot { position: relative; }
.oi-plot-frame { position: relative; border: 1px solid var(--oi-color-border); border-radius: 10px; overflow: hidden; background: var(--oi-color-background); touch-action: none; }
.oi-plot-fixed .oi-plot-frame { touch-action: auto; }
.oi-plot-focused .oi-plot-frame { border-color: var(--oi-color-accent); box-shadow: 0 0 0 2px var(--oi-color-accent-soft); }
.oi-plot-stage { position: absolute; inset: 0; cursor: grab; user-select: none; -webkit-user-select: none; }
.oi-plot-stage:active { cursor: grabbing; }
.oi-plot-fixed .oi-plot-stage { cursor: inherit; }
.oi-plot-svg-host, .oi-plot-svg { position: absolute; inset: 0; display: block; }
.oi-plot-svg { overflow: hidden; font-family: var(--oi-font-body); }
.oi-plot-grid { stroke: var(--oi-color-border); stroke-width: 1; opacity: 0.7; fill: none; }
.oi-plot-axis { stroke: var(--oi-color-text-muted); stroke-width: 1.3; fill: none; }
.oi-plot-label text { font-size: 11px; fill: var(--oi-color-text-muted); paint-order: stroke; stroke: var(--oi-color-background); stroke-width: 3px; stroke-linejoin: round; font-variant-numeric: tabular-nums; }
.oi-plot-label .oi-plot-axis-name { font-style: italic; fill: var(--oi-color-text); }
.oi-plot-point-label { font-size: 12px; font-weight: 600; paint-order: stroke; stroke: var(--oi-color-background); stroke-width: 3px; }
.oi-plot-hover { position: absolute; pointer-events: none; z-index: 2; }
.oi-plot-hover-dot { position: absolute; left: -5px; top: -5px; width: 10px; height: 10px; border-radius: 50%; background: var(--oi-plot-hover-color); box-shadow: 0 0 0 2px var(--oi-color-background); }
.oi-plot-hover-label { position: absolute; left: 10px; top: -28px; white-space: nowrap; font-size: 12px; padding: 2px 7px; border-radius: 6px; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); font-variant-numeric: tabular-nums; }
.oi-plot-tool { position: absolute; top: 6px; right: 6px; z-index: 3; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.oi-plot-frame:hover .oi-plot-tool, .oi-plot-focused .oi-plot-tool, .oi-plot-tool:focus-within, .oi-plot-tool:has(.oi-plot-keep) { opacity: 1; }
@media (hover: none) { .oi-plot-tool { opacity: 1; } }
.oi-plot-button { display: inline-flex; align-items: center; gap: 5px; height: 26px; min-width: 26px; justify-content: center; padding: 0 6px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: color-mix(in srgb, var(--oi-color-background) 88%, transparent); color: var(--oi-color-text); font: inherit; font-size: 12px; cursor: pointer; }
.oi-plot-button:hover { background: var(--oi-color-surface2); }
.oi-plot-keep { border-color: var(--oi-color-accent); color: var(--oi-color-accent); }
.oi-plot-slider-value { min-width: 3.5em; font-variant-numeric: tabular-nums; }
.oi-plot-slider-bound { color: var(--oi-color-text-muted); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.oi-plot-play { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--oi-color-border); border-radius: 50%; background: none; color: var(--oi-color-text-muted); cursor: pointer; padding: 0; }
.oi-plot-play:hover { color: var(--oi-color-text); background: var(--oi-color-surface2); }
.oi-plot-list { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; font-size: 0.85em; }
.oi-plot-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; padding: 1px 4px; border-radius: 5px; cursor: text; }
.oi-read-only .oi-plot-row { cursor: auto; }
.oi-plot-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--oi-plot-dot); align-self: center; border: 0; padding: 0; }
button.oi-plot-dot { cursor: pointer; box-shadow: 0 0 0 1px var(--oi-color-background), 0 0 0 2px transparent; }
button.oi-plot-dot:hover { box-shadow: 0 0 0 2px var(--oi-color-background), 0 0 0 3.5px var(--oi-plot-dot); }
.oi-plot-dot[data-empty] { background: none; border: 1px solid var(--oi-color-border); }
.oi-plot-expression { overflow-wrap: anywhere; }
.oi-plot-row-problem .oi-plot-expression { font-family: var(--oi-font-code); white-space: pre-wrap; }
.oi-plot-name { font-weight: 600; margin-right: 6px; }
.oi-plot-empty { color: var(--oi-color-text-muted); font-family: inherit; }
.oi-plot-value { font-family: var(--oi-font-code); color: var(--oi-color-accent); }
.oi-plot-note { color: var(--oi-color-text-muted); }
.oi-plot-problem { color: var(--oi-color-danger); }
.oi-plot-row-editing { background: var(--oi-color-surface1); }
.oi-plot-line { flex: 1; min-width: 10em; font: inherit; font-family: var(--oi-font-code); font-size: 1em; padding: 3px 6px; border: 1px solid var(--oi-color-accent); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); outline: none; }
.oi-plot-add { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; border: 0; background: none; color: var(--oi-color-text-muted); font: inherit; padding: 3px 4px; cursor: pointer; border-radius: 5px; }
.oi-plot-add:hover { color: var(--oi-color-text); background: var(--oi-color-surface1); }
.oi-plot-list[data-oi-interactive] .oi-plot-row:not(.oi-plot-row-editing):hover { background: var(--oi-color-surface1); cursor: text; }
button.oi-plot-slider-value, button.oi-plot-slider-bound { border: 0; background: none; font: inherit; color: inherit; padding: 1px 4px; border-radius: 5px; cursor: text; }
button.oi-plot-slider-value:hover:not([disabled]), button.oi-plot-slider-bound:hover:not([disabled]) { background: var(--oi-color-surface2); }
button.oi-plot-slider-bound { color: var(--oi-color-text-muted); font-size: 0.85em; }
.oi-plot-number { width: 5.5em; font: inherit; padding: 2px 5px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); font-variant-numeric: tabular-nums; }
.oi-plot-range { flex-wrap: wrap; gap: 6px; }
.oi-plot-step { display: inline-flex; align-items: center; gap: 4px; color: var(--oi-color-text-muted); }
.oi-plot-handle { cursor: move; }
.oi-plot-row-slider { align-items: center; flex-wrap: nowrap; }
.oi-plot-slider-name { white-space: nowrap; }
.oi-plot-slider-track { display: inline-flex; align-items: center; gap: 2px; flex: 0 1 220px; min-width: 110px; }
.oi-plot-slider-track input[type="range"] { flex: 1; min-width: 50px; width: 100%; margin: 0; accent-color: var(--oi-color-accent); }
.oi-plot-range-name { font-family: var(--oi-font-math); font-style: italic; white-space: nowrap; }
.oi-plot-more { display: inline-grid; place-items: center; width: 24px; height: 20px; margin-left: auto; flex: none; align-self: center; border: 0; border-radius: 5px; background: none; color: var(--oi-color-text-muted); padding: 0; cursor: pointer; opacity: 0; }
.oi-plot-row:hover .oi-plot-more, .oi-plot-more:focus-visible { opacity: 1; }
.oi-plot-more:hover { color: var(--oi-color-text); background: var(--oi-color-surface2); }
@media (hover: none) { .oi-plot-more { opacity: 1; } }
.oi-plot-row-hidden .oi-plot-expression { opacity: 0.5; }
.oi-plot-dot[data-hidden] { background: none; border: 1.5px solid var(--oi-plot-dot); }
.oi-plot-hover[data-tag] .oi-plot-hover-label { left: 0; top: 0; transform: translate(-50%, calc(-100% - 6px)); border-color: var(--oi-plot-hover-color); }
.oi-plot-hover[data-tag="Below"] .oi-plot-hover-label { transform: translate(-50%, 6px); }
.oi-plot-stage[data-pie] { cursor: default; }
.oi-plot-stage[data-pie] [data-slice] { cursor: pointer; }
.oi-plot-slice, .oi-plot-pie-row, .oi-plot-svg [data-bar] { transition: opacity 0.12s, transform 0.12s; }
.oi-plot-slice[data-on] { transform: translate(var(--oi-dx), var(--oi-dy)); }
.oi-plot-svg[data-active] [data-slice]:not([data-on]), .oi-plot-svg[data-active] [data-bar]:not([data-on]) { opacity: 0.35; }
.oi-plot-pie-hit { fill: transparent; }
.oi-plot-pie-row[data-on] .oi-plot-pie-hit { fill: var(--oi-color-surface2); }
.oi-plot-pie-share { pointer-events: none; }
.oi-plot-pie-percent { font-size: 12px; font-weight: 600; fill: var(--oi-color-text); font-variant-numeric: tabular-nums; }
.oi-plot-stage-3d { cursor: grab; }
.oi-plot-pie text { font-family: var(--oi-font-body); }
.oi-plot-pie-share { font-size: 11px; font-weight: 600; fill: var(--oi-color-background); }
.oi-plot-pie-name, .oi-plot-pie-value { font-size: 12px; fill: var(--oi-color-text); font-variant-numeric: tabular-nums; }
.oi-plot-pie-value { fill: var(--oi-color-text-muted); }
.oi-plot-pie-total { font-size: 15px; font-weight: 600; fill: var(--oi-color-text); }
.oi-plot-pie-empty { fill: var(--oi-color-text-muted); font-size: 13px; }
.oi-plot-canvas, .oi-plot-still { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.oi-plot-3d-label { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.oi-plot-3d-tick { position: absolute; transform: translate(-50%, -50%); font-size: 10.5px; color: var(--oi-color-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.oi-plot-3d-axis { font-family: var(--oi-font-math); font-style: italic; font-size: 13px; color: var(--oi-color-text); }
.oi-plot-3d-problem { position: absolute; inset: 0; display: grid; place-items: center; padding: 1em; text-align: center; color: var(--oi-color-danger); }
`;
