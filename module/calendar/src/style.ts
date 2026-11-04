// The module's CSS, loaded with its code the first time one of its blocks shows (installStyle).

export const calendarStyle = `
.oi-calendar { position: relative; font-size: 0.9em; outline: none; user-select: none; -webkit-user-select: none; --oi-calendar-line: color-mix(in srgb, var(--oi-color-border) 75%, transparent); }
.oi-calendar-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.oi-calendar-title { font-weight: 600; font-size: 1.12em; margin-left: 4px; }
.oi-calendar-space { flex: 1; }
.oi-calendar-button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 0.95em; padding: 4px 11px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: var(--oi-color-surface1); color: var(--oi-color-text); cursor: pointer; }
.oi-calendar-button:hover { background: var(--oi-color-surface2); }
.oi-calendar-button.primary { background: var(--oi-color-accent); border-color: var(--oi-color-accent); color: var(--oi-color-background); }
.oi-calendar-icon { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 7px; background: none; color: var(--oi-color-text); cursor: pointer; }
.oi-calendar-icon:hover { background: var(--oi-color-surface2); }
.oi-calendar-segment-row { display: inline-flex; border: 1px solid var(--oi-color-border); border-radius: 7px; overflow: hidden; }
.oi-calendar-segment { border: 0; background: none; color: var(--oi-color-text-muted); font: inherit; font-size: 0.92em; padding: 4px 10px; cursor: pointer; }
.oi-calendar-segment + .oi-calendar-segment { border-left: 1px solid var(--oi-color-border); }
.oi-calendar-segment.active { background: var(--oi-color-accent-soft); color: var(--oi-color-text); }
.oi-calendar-event { position: relative; box-sizing: border-box; overflow: hidden; border-radius: 6px; padding: 2px 6px; font-size: 0.88em; line-height: 1.3; cursor: pointer; color: var(--oi-color-text); background: color-mix(in srgb, var(--oi-calendar-color) 20%, var(--oi-color-background)); border-left: 3px solid var(--oi-calendar-color); }
.oi-calendar-event:hover { background: color-mix(in srgb, var(--oi-calendar-color) 30%, var(--oi-color-background)); }
.oi-calendar-selected { box-shadow: 0 0 0 2px var(--oi-calendar-color); }
.oi-calendar-preview { opacity: 0.75; box-shadow: 0 4px 14px color-mix(in srgb, #000 22%, transparent); z-index: 3; }
.oi-calendar-allday-event { background: color-mix(in srgb, var(--oi-calendar-color) 32%, var(--oi-color-background)); }
.oi-calendar-event-title { display: flex; align-items: baseline; gap: 4px; white-space: nowrap; overflow: hidden; }
.oi-calendar-name { overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.oi-calendar-time { color: var(--oi-color-text-muted); font-variant-numeric: tabular-nums; flex: none; }
.oi-calendar-mark { display: inline-grid; align-self: center; color: var(--oi-color-text-muted); flex: none; }
.oi-calendar-sub { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.92em; }
.oi-calendar-place { color: var(--oi-color-text-muted); }
.oi-calendar-sub .oi-calendar-time + .oi-calendar-place::before { content: ' · '; }
.oi-calendar-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; }
.oi-read-only .oi-calendar-resize { display: none; }
.oi-calendar-week { border: 1px solid var(--oi-color-border); border-radius: 10px; overflow: hidden; }
.oi-calendar-week-head, .oi-calendar-allday { display: grid; grid-template-columns: 52px repeat(var(--oi-calendar-days), 1fr); }
.oi-calendar-week-head { border-bottom: 1px solid var(--oi-color-border); background: var(--oi-color-surface1); }
.oi-calendar-day-head { display: flex; flex-direction: column; align-items: center; padding: 5px 0; cursor: pointer; }
.oi-calendar-day-head:hover .oi-calendar-date { background: var(--oi-color-surface2); }
.oi-calendar-weekday { font-size: 0.8em; color: var(--oi-color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.oi-calendar-date { display: inline-grid; place-items: center; min-width: 28px; height: 28px; border-radius: 50%; font-size: 1.1em; font-weight: 600; font-variant-numeric: tabular-nums; }
.oi-calendar-today .oi-calendar-date, .oi-calendar-cell.oi-calendar-today .oi-calendar-cell-date { background: var(--oi-color-accent); color: var(--oi-color-background); }
.oi-calendar-allday { border-bottom: 1px solid var(--oi-color-border); min-height: 28px; }
.oi-calendar-allday-label { font-size: 0.75em; color: var(--oi-color-text-muted); display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; }
.oi-calendar-allday-lane { grid-column: 2 / -1; display: grid; grid-template-columns: repeat(var(--oi-calendar-days), 1fr); grid-auto-rows: minmax(24px, auto); gap: 2px 0; padding: 2px 0; position: relative; }
.oi-calendar-allday-cell { border-left: 1px solid var(--oi-calendar-line); cursor: cell; }
.oi-calendar-allday-lane .oi-calendar-event { margin: 0 2px; z-index: 1; }
.page.wide .oi-calendar-scroll { max-height: calc(100vh - 230px); }
.page.wide .oi-calendar-cell { min-height: 120px; }
.oi-calendar-scroll { max-height: min(68vh, 560px); overflow-y: auto; overscroll-behavior: contain; }
.oi-calendar-grid { position: relative; display: grid; grid-template-columns: 52px 1fr; }
.oi-calendar-hour-list { position: relative; }
.oi-calendar-hour { position: absolute; right: 6px; transform: translateY(-50%); font-size: 0.75em; color: var(--oi-color-text-muted); font-variant-numeric: tabular-nums; }
.oi-calendar-column-list { display: grid; grid-template-columns: repeat(var(--oi-calendar-days), 1fr); background-image: linear-gradient(to bottom, var(--oi-calendar-line) 1px, transparent 1px); background-size: 100% var(--oi-calendar-hour); }
.oi-calendar-column { position: relative; border-left: 1px solid var(--oi-calendar-line); cursor: cell; }
.oi-calendar-column.oi-calendar-today { background: color-mix(in srgb, var(--oi-color-accent) 5%, transparent); }
.oi-read-only .oi-calendar-column, .oi-read-only .oi-calendar-allday-cell { cursor: default; }
.oi-calendar-column .oi-calendar-event { position: absolute; }
.oi-calendar-now { position: absolute; left: 0; right: 0; height: 2px; background: var(--oi-color-danger); z-index: 2; pointer-events: none; }
.oi-calendar-now::before { content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--oi-color-danger); }
.oi-calendar-month { border: 1px solid var(--oi-color-border); border-radius: 10px; overflow: hidden; }
.oi-calendar-month-head, .oi-calendar-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.oi-calendar-month-head { background: var(--oi-color-surface1); border-bottom: 1px solid var(--oi-color-border); }
.oi-calendar-month-weekday { padding: 5px 8px; font-size: 0.8em; color: var(--oi-color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.oi-calendar-cell { min-height: 96px; padding: 3px 3px 5px; border-right: 1px solid var(--oi-calendar-line); border-bottom: 1px solid var(--oi-calendar-line); display: flex; flex-direction: column; gap: 2px; cursor: cell; min-width: 0; }
.oi-calendar-cell:nth-child(7n) { border-right: 0; }
.oi-calendar-other { background: color-mix(in srgb, var(--oi-color-surface1) 60%, transparent); }
.oi-calendar-other .oi-calendar-cell-date { color: var(--oi-color-text-muted); }
.oi-calendar-cell-date { align-self: flex-start; border: 0; background: none; font: inherit; font-size: 0.9em; font-weight: 600; color: var(--oi-color-text); min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; cursor: pointer; font-variant-numeric: tabular-nums; }
.oi-calendar-cell-date:hover { background: var(--oi-color-surface2); }
.oi-calendar-more { align-self: flex-start; border: 0; background: none; font: inherit; font-size: 0.8em; color: var(--oi-color-text-muted); cursor: pointer; padding: 1px 6px; border-radius: 5px; }
.oi-calendar-more:hover { background: var(--oi-color-surface2); color: var(--oi-color-text); }
.oi-calendar-agenda { display: flex; flex-direction: column; border: 1px solid var(--oi-color-border); border-radius: 10px; overflow: hidden; }
.oi-calendar-agenda-day { display: grid; grid-template-columns: 7em 1fr; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--oi-calendar-line); }
.oi-calendar-agenda-day:last-child { border-bottom: 0; }
.oi-calendar-agenda-date { display: flex; align-items: baseline; gap: 6px; border: 0; background: none; font: inherit; color: var(--oi-color-text); cursor: pointer; text-align: left; padding: 0; }
.oi-calendar-agenda-date b { font-size: 1.4em; font-variant-numeric: tabular-nums; }
.oi-calendar-agenda-date span { color: var(--oi-color-text-muted); font-size: 0.85em; }
.oi-calendar-agenda-day.oi-calendar-today .oi-calendar-agenda-date b { color: var(--oi-color-accent); }
.oi-calendar-agenda-list { display: flex; flex-direction: column; gap: 4px; }
.oi-calendar-agenda .oi-calendar-event { font-size: 0.95em; padding: 4px 8px; }
.oi-calendar-empty { margin: 0; padding: 18px; color: var(--oi-color-text-muted); text-align: center; }
.oi-calendar-message { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px; background: var(--oi-color-text); color: var(--oi-color-background); font-size: 0.9em; z-index: 4; pointer-events: none; }
.oi-calendar-popover { position: fixed; z-index: 60; width: min(23em, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box; padding: 12px; border: 1px solid var(--oi-color-border); border-radius: 12px; background: var(--oi-color-background); color: var(--oi-color-text); box-shadow: 0 14px 40px color-mix(in srgb, #000 22%, transparent); font-family: var(--oi-font-body); font-size: 14px; }
.oi-calendar-form { display: flex; flex-direction: column; gap: 8px; }
.oi-calendar-form input:not([type="checkbox"]), .oi-calendar-form select, .oi-calendar-form textarea { font: inherit; padding: 4px 7px; border: 1px solid var(--oi-color-border); border-radius: 7px; background: var(--oi-color-background); color: var(--oi-color-text); min-width: 0; }
.oi-calendar-form textarea { resize: vertical; font-family: var(--oi-font-body); }
.oi-calendar-form input:focus, .oi-calendar-form select:focus, .oi-calendar-form textarea:focus { outline: 2px solid var(--oi-color-accent-soft); border-color: var(--oi-color-accent); }
.oi-calendar-name-input { font-size: 1.15em !important; font-weight: 600; border: 0 !important; border-bottom: 1px solid var(--oi-color-border) !important; border-radius: 0 !important; padding: 4px 2px !important; }
.oi-calendar-form-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.oi-calendar-form-row[hidden], .oi-calendar-end-field[hidden], .oi-calendar-form [hidden] { display: none !important; }
.oi-calendar-end-field { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.oi-calendar-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.oi-calendar-check input, .oi-calendar-weekday-toggle input { accent-color: var(--oi-color-accent); }
.oi-calendar-custom input[type="number"] { width: 4em; }
.oi-calendar-weekday-row { display: inline-flex; gap: 2px; }
.oi-calendar-weekday-toggle { display: inline-flex; align-items: center; gap: 2px; font-size: 0.85em; padding: 2px 4px; border-radius: 6px; background: var(--oi-color-surface1); cursor: pointer; }
.oi-calendar-label { color: var(--oi-color-text-muted); font-size: 0.9em; }
.oi-calendar-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px 1px 8px; border-radius: 999px; background: var(--oi-color-surface2); font-size: 0.85em; }
.oi-calendar-chip button { display: grid; place-items: center; width: 18px; height: 18px; border: 0; border-radius: 50%; background: none; color: var(--oi-color-text-muted); cursor: pointer; }
.oi-calendar-chip button:hover { background: var(--oi-color-surface3); color: var(--oi-color-text); }
.oi-calendar-chip-button { font: inherit; font-size: 0.85em; padding: 2px 8px; border: 1px solid var(--oi-color-border); border-radius: 999px; background: var(--oi-color-surface1); color: var(--oi-color-text); cursor: pointer; }
.oi-calendar-chip-button:hover { background: var(--oi-color-surface2); }
.oi-calendar-swatch { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--oi-color-border); background: var(--oi-calendar-color); cursor: pointer; padding: 0; }
.oi-calendar-swatch[data-color=""] { background: linear-gradient(135deg, transparent 45%, var(--oi-color-text-muted) 45%, var(--oi-color-text-muted) 55%, transparent 55%); }
.oi-calendar-swatch.active { box-shadow: 0 0 0 2px var(--oi-color-background), 0 0 0 4px var(--oi-color-accent); }
.oi-calendar-note { margin: 0; font-size: 0.85em; color: var(--oi-color-text-muted); }
.oi-calendar-form-action { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
`;
