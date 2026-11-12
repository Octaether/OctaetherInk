import { installStyle } from '@octaether/core-sdk';

// The AI panel's look, in theme colors only, so it follows every theme. Loaded with the panel.

export const panelStyle = `
.oi-ai { position: fixed; z-index: 55; left: 50%; bottom: 40px; transform: translateX(-50%); width: min(700px, calc(100vw - 24px)); max-height: min(76vh, 720px); box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--oi-color-background, #fff); color: var(--oi-color-text, #222); border: 1px solid var(--oi-color-border, #ccc); border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.24); font: 13.5px/1.4 var(--oi-font-body, system-ui, sans-serif); }
.oi-ai [hidden] { display: none !important; }
.oi-ai-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oi-ai-title { font-weight: 600; }
.oi-ai-space { flex: 1; }
.oi-ai-link { min-width: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; font: inherit; font-size: 12px; color: var(--oi-color-text-muted, #777); background: none; border: 1px solid transparent; border-radius: 6px; cursor: pointer; }
.oi-ai-link:hover { color: var(--oi-color-accent, #8a6a1c); border-color: var(--oi-color-border, #ccc); }
.oi-ai-close { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; font-size: 16px; line-height: 1; color: var(--oi-color-text-muted, #777); background: none; border: none; border-radius: 6px; cursor: pointer; }
.oi-ai-close:hover { color: var(--oi-color-text, #222); background: var(--oi-color-surface1, #f4f4f4); }
.oi-ai-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.oi-ai-scope { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--oi-color-text-muted, #777); }
:is(.oi-ai, .oi-ai-connection) :is(select, input, textarea) { box-sizing: border-box; font: inherit; color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 7px; outline: none; }
:is(.oi-ai, .oi-ai-connection) :is(select, input, textarea):focus { border-color: var(--oi-color-accent, #8a6a1c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--oi-color-accent, #8a6a1c) 20%, transparent); }
:is(.oi-ai, .oi-ai-connection) select { height: 26px; padding: 0 6px; font-size: 12px; }
:is(.oi-ai, .oi-ai-connection) input { height: 30px; padding: 0 9px; min-width: 0; }
.oi-ai-answer { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.oi-ai-tab { display: flex; gap: 2px; }
.oi-ai-tab button { padding: 2px 9px; font: inherit; font-size: 12px; color: var(--oi-color-text-muted, #777); background: none; border: none; border-radius: 6px; cursor: pointer; }
.oi-ai-tab button[aria-pressed="true"] { color: var(--oi-color-text, #222); background: var(--oi-color-surface2, #eee); }
.oi-ai-preview, .oi-ai-source { flex: 1 1 auto; min-height: 60px; max-height: 42vh; overflow: auto; padding: 8px 12px; border: 1px solid var(--oi-color-border, #ccc); border-radius: 8px; }
.oi-ai-preview { background: var(--oi-color-background, #fff); }
.oi-ai-preview > div { min-width: 0; }
.oi-ai textarea.oi-ai-source { width: 100%; height: 30vh; resize: vertical; white-space: pre; tab-size: 4; font: 12.5px/1.5 var(--oi-font-code, ui-monospace, monospace); }
.oi-ai-status { min-height: 1.4em; font-size: 12px; color: var(--oi-color-text-muted, #777); }
.oi-ai-status[data-kind="Problem"] { color: var(--oi-color-danger, #c00); }
.oi-ai-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.oi-ai-button { height: 30px; padding: 0 12px; font: inherit; color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 7px; cursor: pointer; white-space: nowrap; }
.oi-ai-button:hover { background: var(--oi-color-surface2, #eee); }
.oi-ai-button:disabled { opacity: 0.5; cursor: default; }
.oi-ai-button.oi-ai-primary { color: #fff; background: var(--oi-color-accent, #8a6a1c); border-color: var(--oi-color-accent, #8a6a1c); }
.oi-ai-button.oi-ai-primary:hover { filter: brightness(1.08); }
.oi-ai-button.oi-ai-danger { color: var(--oi-color-danger, #c00); }
.oi-ai-preset { display: flex; flex-wrap: wrap; gap: 6px; }
.oi-ai-chip { height: 26px; padding: 0 10px; font: inherit; font-size: 12.5px; color: inherit; background: none; border: 1px solid var(--oi-color-border, #ccc); border-radius: 13px; cursor: pointer; }
.oi-ai-chip:hover { border-color: var(--oi-color-accent, #8a6a1c); color: var(--oi-color-accent, #8a6a1c); }
.oi-ai-sent { font-size: 11.5px; color: var(--oi-color-text-muted, #777); }
.oi-ai-form { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 8px 12px; overflow: auto; }
.oi-ai-form > label { color: var(--oi-color-text-muted, #777); }
.oi-ai-field { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oi-ai-field > input, .oi-ai-field > select { flex: 1; height: 30px; font-size: inherit; }
.oi-ai-field a { color: var(--oi-color-accent, #8a6a1c); white-space: nowrap; font-size: 12.5px; }
.oi-ai-note { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--oi-color-text-muted, #777); }
@media (max-width: 640px) {
	.oi-ai { bottom: calc(64px + env(safe-area-inset-bottom, 0px)); max-height: 70vh; }
	.oi-ai-form { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
.oi-ai-connection { display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }
.oi-ai-pick { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; font: inherit; color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 7px; cursor: pointer; }
.oi-ai-pick:hover { border-color: var(--oi-color-accent, #8a6a1c); }
.oi-ai-tag { font-size: 11.5px; padding: 1px 7px; border-radius: 999px; color: var(--oi-color-accent, #8a6a1c); background: color-mix(in srgb, var(--oi-color-accent, #8a6a1c) 14%, transparent); }
.oi-ai-hint { font-size: 12px; color: var(--oi-color-text-muted, #777); }
.oi-ai-key-saved { color: var(--oi-color-text-muted, #777); }
.oi-ai-key-saved code { font-family: var(--oi-font-code, ui-monospace, monospace); color: var(--oi-color-text, #222); }
.oi-ai-head-icon { display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0; color: var(--oi-color-text-muted, #777); background: none; border: 0; border-radius: 6px; cursor: pointer; }
.oi-ai-head-icon:hover:not(:disabled) { color: var(--oi-color-text, #222); background: var(--oi-color-surface1, #f4f4f4); }
.oi-ai-head-icon:disabled { opacity: 0.4; cursor: default; }
@media print { .oi-ai { display: none; } }
`;

/** Installs the panel's look (the connection form on the setting page uses it too). */
export function installPanelStyle(): void {
	installStyle('AI', panelStyle);
	installStyle('AI.Composer', composerStyle);
}

/**
 * The message field, as in Claude Code: a rounded box with what is attached, the text, and one row
 * of buttons under it (attach, chats, new, memory, the mode, the model, a square send).
 */
export const composerStyle = `
.oi-composer { display: flex; flex-direction: column; gap: 4px; padding: 6px 6px 5px; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 12px; box-sizing: border-box; }
.oi-composer:focus-within { border-color: color-mix(in srgb, var(--oi-chat-mode, var(--oi-color-accent, #8a6a1c)) 70%, var(--oi-color-border, #ccc)); }
.oi-composer.oi-composer-drop { border-style: dashed; border-color: var(--oi-chat-mode, var(--oi-color-accent, #8a6a1c)); }
.oi-composer textarea { width: 100%; min-height: 26px; max-height: 220px; box-sizing: border-box; padding: 4px 6px; resize: none; font: inherit; line-height: 1.45; color: inherit; background: transparent !important; border: 0 !important; box-shadow: none !important; outline: none; }
.oi-composer-context { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 2px; }
.oi-composer-context:empty { display: none; }
.oi-composer-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 3px 1px 7px; font: inherit; font-size: 12px; color: var(--oi-color-text, #222); background: var(--oi-color-background, #fff); border: 1px solid var(--oi-color-border, #ccc); border-radius: 999px; }
.oi-composer-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-composer-chip svg { flex: none; color: var(--oi-color-text-muted, #777); }
.oi-composer-chip.off { opacity: 0.55; }
.oi-composer-chip.off > span { text-decoration: line-through; }
.oi-composer-chip button { display: inline-grid; place-items: center; width: 18px; height: 18px; padding: 0; color: var(--oi-color-text-muted, #777); background: none; border: 0; border-radius: 50%; cursor: pointer; }
.oi-composer-chip button:hover { color: var(--oi-color-text, #222); background: var(--oi-color-surface2, #eee); }
.oi-composer-bar { display: flex; align-items: center; gap: 2px; min-width: 0; }
.oi-composer-icon { flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; color: var(--oi-color-text-muted, #777); background: none; border: 0; border-radius: 7px; cursor: pointer; }
.oi-composer-icon:hover:not(:disabled) { color: var(--oi-color-text, #222); background: var(--oi-color-surface2, #eee); }
.oi-composer-icon[aria-pressed="true"] { color: var(--oi-color-text, #222); background: var(--oi-color-surface2, #eee); }
.oi-composer-icon:disabled { opacity: 0.4; cursor: default; }
.oi-composer-separator { flex: none; width: 1px; height: 18px; margin: 0 4px; background: var(--oi-color-border, #ccc); }
.oi-composer-mode { flex: none; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1px solid var(--oi-color-border, #ccc); border-radius: 8px; overflow: hidden; }
.oi-composer-mode button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 74px; height: 26px; padding: 0 8px; font: inherit; font-size: 12px; color: var(--oi-color-text-muted, #777); background: none; border: 0; cursor: pointer; }
.oi-composer-mode button + button { border-inline-start: 1px solid var(--oi-color-border, #ccc); }
.oi-composer-mode button[aria-checked="true"] { color: #fff; background: var(--oi-chat-mode, var(--oi-color-accent, #8a6a1c)); }
.oi-composer-mode button:disabled { cursor: default; }
.oi-composer-space { flex: 1; min-width: 4px; }
.oi-composer-model { display: inline-flex; align-items: center; gap: 3px; min-width: 0; height: 28px; padding: 0 6px 0 8px; font: inherit; font-size: 12.5px; color: var(--oi-color-text-muted, #777); background: none; border: 0; border-radius: 7px; cursor: pointer; }
.oi-composer-model > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-composer-model svg { flex: none; }
.oi-composer-model:hover { color: var(--oi-color-text, #222); background: var(--oi-color-surface2, #eee); }
.oi-composer-send { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px; margin-inline-start: 4px; padding: 0; color: #fff; background: var(--oi-chat-mode, var(--oi-color-accent, #8a6a1c)); border: 0; border-radius: 8px; cursor: pointer; }
.oi-composer-send:hover:not(:disabled) { filter: brightness(1.08); }
.oi-composer-send:disabled { opacity: 0.4; cursor: default; }
.oi-composer-note { padding: 0 4px; font-size: 11.5px; color: var(--oi-color-text-muted, #777); }
.oi-composer-note button { padding: 0; font: inherit; color: var(--oi-color-accent, #8a6a1c); background: none; border: 0; cursor: pointer; text-decoration: underline; }
/* the model picker: the models, the effort as a slider, the connection */
.oi-model-menu { position: fixed; z-index: 66; width: min(340px, calc(100vw - 16px)); max-height: min(70vh, 520px); box-sizing: border-box; display: flex; flex-direction: column; padding: 6px; background: var(--oi-color-background, #fff); color: var(--oi-color-text, #222); border: 1px solid var(--oi-color-border, #ccc); border-radius: 12px; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22); font: 13.5px/1.35 var(--oi-font-body, system-ui, sans-serif); outline: none; }
.oi-model-head { padding: 4px 8px 6px; font-size: 12px; color: var(--oi-color-text-muted, #777); }
.oi-model-search { margin: 0 2px 6px; height: 28px; padding: 0 8px; font: inherit; color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 7px; outline: none; }
.oi-model-search:focus { border-color: var(--oi-color-accent, #8a6a1c); }
.oi-model-list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
.oi-model-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font: inherit; color: inherit; text-align: start; background: none; border: 0; border-radius: 7px; cursor: pointer; }
.oi-model-row:hover, .oi-model-row.active { background: var(--oi-color-surface1, #f4f4f4); }
.oi-model-row:focus-visible { outline: 2px solid var(--oi-color-accent, #8a6a1c); outline-offset: -2px; }
.oi-model-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.oi-model-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-model-id { font-size: 11.5px; color: var(--oi-color-text-muted, #777); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-model-check { flex: none; color: var(--oi-color-accent, #8a6a1c); }
.oi-model-none { padding: 8px; color: var(--oi-color-text-muted, #777); }
.oi-model-effort { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 6px; padding: 8px; border-top: 1px solid var(--oi-color-border, #ccc); }
.oi-model-effort-name { white-space: nowrap; }
.oi-model-effort-name span { color: var(--oi-color-text-muted, #777); }
.oi-model-effort.off .oi-effort { opacity: 0.4; pointer-events: none; }
/* six stops on a rounded track; the part up to the effort chosen is filled */
.oi-effort { --oi-effort: 0; position: relative; flex: none; display: flex; align-items: center; justify-content: space-between; width: 148px; height: 22px; padding: 0 6px; box-sizing: border-box; background: var(--oi-color-surface2, #eee); border-radius: 999px; outline: none; }
.oi-effort:focus-visible { box-shadow: 0 0 0 2px var(--oi-color-accent, #8a6a1c); }
.oi-effort-fill { position: absolute; inset: 0; background: linear-gradient(to right, var(--oi-color-success, #3d8a7a), var(--oi-color-accent, #b8860b) 55%, var(--oi-color-danger, #c0392b)); border-radius: 999px; clip-path: inset(0 calc((100% - 22px) * (1 - var(--oi-effort))) 0 0 round 999px); pointer-events: none; }
.oi-effort-stop { position: relative; z-index: 1; width: 6px; height: 6px; padding: 0; background: var(--oi-color-text-muted, #777); border: 0; border-radius: 50%; opacity: 0.55; cursor: pointer; }
.oi-effort-stop::before { content: ''; position: absolute; inset: -8px; }
.oi-effort-stop.on { background: #fff; opacity: 0.85; }
.oi-effort-stop.now { width: 16px; height: 16px; margin: 0 -5px; background: #fff; opacity: 1; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
.oi-model-foot { display: flex; flex-wrap: wrap; gap: 2px; padding-top: 4px; border-top: 1px solid var(--oi-color-border, #ccc); }
.oi-model-foot button { flex: 1; padding: 6px 8px; font: inherit; font-size: 12.5px; color: var(--oi-color-text-muted, #777); background: none; border: 0; border-radius: 7px; cursor: pointer; white-space: nowrap; }
.oi-model-foot button:hover { color: var(--oi-color-text, #222); background: var(--oi-color-surface1, #f4f4f4); }
@container oi-chat (max-width: 560px) {
	.oi-composer-mode button span { display: none; }
	.oi-composer-mode button { min-width: 32px; padding: 0 6px; }
}
@container oi-chat (max-width: 380px) {
	.oi-composer-bar [data-action="Memory"], .oi-composer-bar .oi-composer-separator { display: none; }
}
`;

/** The chat in its tab: the conversation filling it, and the message field at the bottom (nothing on top). */
export const chatStyle = `
.oi-chat { --oi-chat-mode: var(--oi-color-accent); container: oi-chat / inline-size; height: 100%; display: flex; flex-direction: column; min-height: 0; font: 14px/1.5 var(--oi-font-body, system-ui, sans-serif); color: var(--oi-color-text); box-sizing: border-box; }
/* each mode its own color, as in Claude Code: Plan only looks (teal), Auto changes without asking (amber, a warning) */
.oi-chat[data-chat-mode="Plan"] { --oi-chat-mode: #17998a; }
.oi-chat[data-chat-mode="Auto"] { --oi-chat-mode: var(--oi-color-warning, #d97706); }
.oi-chat [hidden] { display: none !important; }
.oi-chat-list > *, .oi-chat-foot > *, .oi-chat-history > * { width: min(760px, 100%); margin-inline: auto; box-sizing: border-box; }
.oi-chat-list { flex: 1; min-height: 0; overflow: auto; padding: 16px 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.oi-chat-list > * { padding-inline: 0; }
.oi-chat-empty { margin-top: 12vh; display: flex; flex-direction: column; gap: 6px; color: var(--oi-color-text-muted); }
.oi-chat-empty b { color: var(--oi-color-text); font-size: 18px; }
.oi-chat-user { align-self: flex-end; width: auto !important; max-width: min(620px, 85%); margin-inline: auto 0 !important; padding: 8px 12px; white-space: pre-wrap; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 10px; }
.oi-chat-user-file { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-top: 6px; white-space: normal; }
.oi-chat-user-file span { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; font-size: 12px; color: var(--oi-color-text-muted); background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 999px; }
.oi-chat-answer { min-width: 0; }
.oi-chat-answer .oi-frame:first-child { margin-top: 0; }
.oi-chat-tool { border-inline-start: 2px solid var(--oi-color-border); padding: 2px 0 2px 10px; font-size: 13px; color: var(--oi-color-text-muted); }
.oi-chat-tool[data-kind="Change"] { border-inline-start-color: var(--oi-color-accent); color: var(--oi-color-text); }
.oi-chat-tool[data-state="Failed"], .oi-chat-tool[data-state="Declined"] { border-inline-start-color: var(--oi-color-danger); }
.oi-chat-tool-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oi-chat-tool-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-chat-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; opacity: 0.5; }
.oi-chat-tool[data-state="Running"] .oi-chat-dot, .oi-chat-tool[data-state="Waiting"] .oi-chat-dot { background: var(--oi-color-accent); opacity: 1; animation: oi-chat-pulse 1s ease-in-out infinite alternate; }
@keyframes oi-chat-pulse { to { opacity: 0.3; } }
.oi-chat-tag { flex: none; font-size: 11.5px; color: var(--oi-color-text-muted); }
.oi-chat-tool[data-state="Failed"] .oi-chat-tag, .oi-chat-tool[data-state="Declined"] .oi-chat-tag { color: var(--oi-color-danger); }
.oi-chat-small { flex: none; padding: 0 8px; font: inherit; font-size: 12px; color: var(--oi-color-accent); background: none; border: 1px solid var(--oi-color-border); border-radius: 4px; cursor: pointer; }
.oi-chat-detail summary, .oi-chat-source summary { cursor: pointer; font-size: 12px; color: var(--oi-color-text-muted); }
.oi-chat-source ul { margin: 4px 0 0; padding-inline-start: 18px; font-size: 13px; }
.oi-chat-source a { color: var(--oi-color-accent); }
.oi-chat-fail { font-size: 12.5px; color: var(--oi-color-danger); white-space: pre-wrap; }
.oi-chat-diff { margin: 6px 0 0; max-height: 320px; overflow: auto; padding: 6px 0; font: 12px/1.45 var(--oi-font-code, ui-monospace, monospace); background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 4px; }
.oi-chat-diff span { display: block; padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.oi-chat-diff-add { background: color-mix(in srgb, var(--oi-color-success) 16%, transparent); }
.oi-chat-diff-remove { background: color-mix(in srgb, var(--oi-color-danger) 14%, transparent); }
.oi-chat-diff-gap { color: var(--oi-color-text-muted); }
.oi-chat-diff-none { font-size: 12.5px; color: var(--oi-color-text-muted); }
.oi-chat-approve, .oi-chat-plan { padding: 10px 12px; border: 1px solid var(--oi-chat-mode); border-radius: 8px; background: color-mix(in srgb, var(--oi-chat-mode) 6%, var(--oi-color-background)); }
.oi-chat-approve-title { font-weight: 600; }
.oi-chat-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.oi-chat-plan { display: flex; flex-direction: column; gap: 2px; }
.oi-chat-plan-text { display: flex; flex-direction: column; gap: 2px; }
.oi-chat-plan-text span { font-size: 12.5px; color: var(--oi-color-text-muted); }
.oi-chat-plan .oi-chat-row { margin-top: 8px; }
.oi-chat-button { display: inline-flex; align-items: center; gap: 6px; }
.oi-chat-row { margin-top: 10px; }
.oi-chat-button { height: 30px; padding: 0 12px; font: inherit; color: inherit; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 7px; cursor: pointer; }
.oi-chat-button.primary { color: var(--oi-color-background); background: var(--oi-color-accent); border-color: var(--oi-color-accent); }
.oi-chat-reason { flex: 1; min-width: 160px; height: 30px; padding: 0 8px; font: inherit; color: inherit; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 7px; }
.oi-chat-status { font-size: 12.5px; color: var(--oi-color-text-muted); }
.oi-chat-problem { font-size: 13px; color: var(--oi-color-danger); }
.oi-chat-foot { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 4px; }
/* the chats kept: in place of the conversation */
.oi-chat-history { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.oi-chat-history-head { display: flex; align-items: center; gap: 6px; }
.oi-chat-history-search { flex: 1; min-width: 0; height: 30px; padding: 0 10px; font: inherit; color: inherit; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 8px; outline: none; }
.oi-chat-history-search:focus { border-color: var(--oi-color-accent); }
.oi-chat-history-tab { flex: none; display: inline-flex; border: 1px solid var(--oi-color-border); border-radius: 8px; overflow: hidden; }
.oi-chat-history-tab button { height: 28px; padding: 0 10px; font: inherit; font-size: 12.5px; color: var(--oi-color-text-muted); background: none; border: 0; cursor: pointer; }
.oi-chat-history-tab button[aria-pressed="true"] { color: var(--oi-color-text); background: var(--oi-color-surface2); }
.oi-chat-history-list { display: flex; flex-direction: column; gap: 1px; }
.oi-chat-history-row { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 2px 4px 2px 10px; border-radius: 8px; cursor: pointer; }
.oi-chat-history-row:hover, .oi-chat-history-row:focus-visible { background: var(--oi-color-surface1); outline: none; }
.oi-chat-history-row[aria-current="true"] { background: color-mix(in srgb, var(--oi-color-accent) 10%, transparent); }
.oi-chat-history-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-chat-history-title input { width: 100%; height: 26px; padding: 0 6px; font: inherit; color: inherit; background: var(--oi-color-background); border: 1px solid var(--oi-color-accent); border-radius: 6px; outline: none; }
.oi-chat-history-kind { flex: none; font-size: 11px; padding: 0 6px; border-radius: 999px; color: var(--oi-color-text-muted); border: 1px solid var(--oi-color-border); }
.oi-chat-history-date { flex: none; font-size: 12px; color: var(--oi-color-text-muted); font-variant-numeric: tabular-nums; }
.oi-chat-history-action { flex: none; display: none; gap: 1px; }
.oi-chat-history-row:hover .oi-chat-history-action, .oi-chat-history-row:focus-within .oi-chat-history-action { display: inline-flex; }
.oi-chat-history-action button { display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0; color: var(--oi-color-text-muted); background: none; border: 0; border-radius: 6px; cursor: pointer; }
.oi-chat-history-action button:hover { color: var(--oi-color-text); background: var(--oi-color-surface2); }
.oi-chat-history-action button[data-history="Delete"]:hover { color: var(--oi-color-danger); }
.oi-chat-history-none { padding: 16px 4px; color: var(--oi-color-text-muted); }
@media (hover: none) { .oi-chat-history-action { display: inline-flex; } }
@media (max-width: 640px) { .oi-chat-list, .oi-chat-history { padding-inline: 12px; } }
`;

