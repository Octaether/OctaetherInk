// Edit-layer CSS. Editing a paragraph looks like typing on the page: no box to resize, no jump.
// Any other block shows its source (header included) in a code font on a soft panel. The block
// being edited gets a soft outline (and its type) so you always see where you are. Theme tokens only.

export const editStyle = `
.oi-frame[data-oi-selected] { background: color-mix(in srgb, var(--oi-color-accent) 10%, transparent); border-radius: 4px; outline: 1px solid color-mix(in srgb, var(--oi-color-accent) 35%, transparent); outline-offset: 3px; }
.oi-frame[data-oi-editing] { outline: 1.5px solid color-mix(in srgb, var(--oi-color-accent) 55%, transparent); outline-offset: 5px; border-radius: 4px; }
.oi-frame[data-oi-editing-parent] { outline: 1px dashed color-mix(in srgb, var(--oi-color-accent) 40%, transparent); outline-offset: 9px; border-radius: 6px; }
.oi-frame[data-oi-editing]:not([data-oi-type="Text"])::after {
	content: attr(data-oi-type);
	position: absolute;
	top: -15px;
	inset-inline-end: 2px;
	padding: 0 6px;
	border-radius: 4px;
	background: var(--oi-color-background);
	color: var(--oi-color-accent);
	font: 600 10.5px/15px var(--oi-font-body);
	pointer-events: none;
}
.oi-source {
	display: block;
	box-sizing: border-box;
	width: 100%;
	margin: 0;
	padding: 0;
	border: none;
	outline: none;
	resize: none;
	overflow: hidden;
	background: transparent;
	color: inherit;
	font: inherit;
	line-height: inherit;
	tab-size: 4;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.oi-source-source-preview,
.oi-source-full {
	font-family: var(--oi-font-code);
	font-size: 0.88em;
	line-height: 1.55;
	padding: 6px 10px;
	margin-bottom: 6px;
	border-radius: 6px;
	background: var(--oi-color-surface1);
}
.oi-source::placeholder { color: var(--oi-color-text-muted); }
`;

export function installEditStyle(target: Document = document): void {
	if (target.querySelector('style[data-oi-edit]')) return;
	const element = target.createElement('style');
	element.dataset.oiEdit = '';
	element.textContent = editStyle;
	target.head.append(element);
}
