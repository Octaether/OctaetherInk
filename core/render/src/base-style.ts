// Host CSS. Everything uses theme tokens, so it follows Light, Dark, and custom themes.

export const baseStyle = `
.oi-note {
	color: var(--oi-color-text);
	background: var(--oi-color-background);
	font-family: var(--oi-font-body);
	font-size: var(--oi-size-body, 16px);
	line-height: 1.6;
	overflow-wrap: anywhere;
}
.oi-note ::selection { background: var(--oi-color-selection); }
.oi-frame { position: relative; box-sizing: border-box; min-width: 0; }
.oi-content { min-width: 0; }
.oi-flow, .oi-child { display: flex; flex-direction: column; gap: 0.75em; min-width: 0; }
.oi-child { margin-top: 0.75em; }
.oi-frame[data-oi-type="Text"] > .oi-child { margin-top: 0.3em; padding-inline-start: 1.5em; }
.oi-frame.oi-list-item + .oi-frame.oi-list-item { margin-top: -0.5em; }
/* a block that can't render as intended: a dashed outline in a warning colour, its text still shown */
.oi-frame.oi-broken { outline: 1.5px dashed var(--oi-color-warning); outline-offset: 3px; border-radius: 6px; }
.oi-frame.oi-broken[data-oi-broken="Error"] { outline-color: var(--oi-color-danger); }
.oi-frame.oi-has-problem { outline: 1.5px dashed color-mix(in srgb, var(--oi-color-danger) 65%, transparent); outline-offset: 3px; border-radius: 6px; }
.oi-placeholder, .oi-error { border-radius: 6px; padding: 8px 12px; background: color-mix(in srgb, var(--oi-color-warning) 7%, transparent); }
.oi-error { background: color-mix(in srgb, var(--oi-color-danger) 6%, transparent); }
.oi-placeholder-label, .oi-error-label { font-size: 0.8em; font-weight: 600; margin-bottom: 4px; color: var(--oi-color-warning); }
.oi-error-label { color: var(--oi-color-danger); }
.oi-placeholder pre, .oi-error pre { margin: 0; font-family: var(--oi-font-code); font-size: 0.85em; white-space: pre-wrap; tab-size: 4; }
.oi-inline-unknown { font-family: var(--oi-font-code); font-size: 0.88em; color: var(--oi-color-text-muted); outline: 1px dashed var(--oi-color-warning); outline-offset: 1px; border-radius: 3px; }
`;

export function installBaseStyle(target: Document = document): void {
	if (target.querySelector('style[data-oi-base]')) return;
	const element = target.createElement('style');
	element.dataset.oiBase = '';
	element.textContent = baseStyle;
	target.head.prepend(element);
}
