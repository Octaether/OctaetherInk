// Our own HTML cleaner. Only a list of harmless tags and attributes survives: no scripts, no
// event handlers, no forms or frames, no class or id (so a note can't dress up as the app), and
// in `style` only properties that can't lift the block out of its place (no position, no url()).
// Links open in a new tab; pictures from the vault are loaded by the app (data-oi-asset).

import { safeUrl } from '@octaether/module-text';

const keepTagSet: ReadonlySet<string> = new Set([
	'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div',
	'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
	'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr',
	'u', 'ul', 'var', 'wbr',
]);

/** Dropped with everything inside them; any other unknown tag is dropped but its text kept. */
const dropTagSet: ReadonlySet<string> = new Set([
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'noscript', 'svg', 'math', 'title', 'head', 'link',
	'meta', 'base', 'form', 'input', 'button', 'select', 'option', 'textarea', 'audio', 'video', 'source', 'track', 'canvas', 'dialog', 'portal',
]);

const numberAttribute = /^\d{1,4}%?$/;
const globalAttributeSet: ReadonlySet<string> = new Set(['title', 'lang', 'dir', 'align']);
const tagAttributeMap: Readonly<Record<string, ReadonlySet<string>>> = {
	a: new Set(['href']),
	img: new Set(['src', 'alt', 'width', 'height']),
	td: new Set(['colspan', 'rowspan', 'width']),
	th: new Set(['colspan', 'rowspan', 'width', 'scope']),
	col: new Set(['span', 'width']),
	colgroup: new Set(['span']),
	ol: new Set(['start', 'type', 'reversed']),
	details: new Set(['open']),
	time: new Set(['datetime']),
	table: new Set(['width']),
};

const stylePropertySet: ReadonlySet<string> = new Set([
	'color', 'background-color', 'background', 'font-weight', 'font-style', 'font-size', 'font-family', 'font-variant', 'text-align', 'text-decoration',
	'text-decoration-color', 'text-transform', 'text-indent', 'letter-spacing', 'word-spacing', 'line-height', 'white-space', 'vertical-align',
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
	'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse',
	'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'display', 'gap', 'flex', 'flex-direction', 'flex-wrap', 'justify-content',
	'align-items', 'grid-template-columns', 'opacity', 'list-style-type', 'float', 'clear', 'overflow', 'box-shadow', 'outline',
]);

/** A style value that loads nothing and runs nothing (theme variables are fine). */
function safeStyleValue(value: string): boolean {
	return !/url\s*\(|expression\s*\(|javascript:|@import|\\|<|behaviou?r|-moz-binding/i.test(value) && !/var\(\s*--(?!oi-)/i.test(value);
}

export function cleanStyle(style: string): string {
	return style
		.split(';')
		.map((declaration) => {
			const at = declaration.indexOf(':');
			if (at < 0) return '';
			const property = declaration.slice(0, at).trim().toLowerCase();
			const value = declaration.slice(at + 1).trim();
			// display stays in the flow: no fixed or absolute boxes over the app
			if (!stylePropertySet.has(property) || value === '' || !safeStyleValue(value)) return '';
			return `${property}: ${value}`;
		})
		.filter(Boolean)
		.join('; ');
}

export interface CleanOption {
	/** Keep `style` attributes (colours, sizes, spacing). */
	keepStyle?: boolean;
}

function cleanNode(node: Node, into: Node, document: Document, option: CleanOption): void {
	for (const child of [...node.childNodes]) {
		if (child.nodeType === 3) {
			into.appendChild(document.createTextNode(child.textContent ?? ''));
			continue;
		}
		if (child.nodeType !== 1) continue;
		const element = child as Element;
		const tag = element.tagName.toLowerCase();
		if (dropTagSet.has(tag)) continue;
		if (!keepTagSet.has(tag)) {
			// an unknown wrapper: keep what it holds
			cleanNode(element, into, document, option);
			continue;
		}
		const copy = document.createElement(tag === 'center' ? 'div' : tag);
		if (tag === 'center') copy.setAttribute('style', 'text-align: center');
		const allowed = tagAttributeMap[tag];
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value;
			if (name === 'style') {
				if (option.keepStyle === false) continue;
				const style = cleanStyle(value);
				if (style) copy.setAttribute('style', [copy.getAttribute('style'), style].filter(Boolean).join('; '));
			} else if (globalAttributeSet.has(name) || allowed?.has(name)) {
				if (name === 'href') {
					const url = safeUrl(value);
					if (url && !/^(?:javascript|vbscript|data|file):/i.test(url)) copy.setAttribute('href', url);
				} else if (name === 'src') {
					// a web picture loads as it is; a file in the vault is loaded by the app
					if (/^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|avif);)/i.test(value.trim())) copy.setAttribute('data-oi-asset', value.trim());
					else if (!/^[a-z][a-z0-9+.-]*:/i.test(value.trim())) copy.setAttribute('data-oi-asset', value.trim());
				} else if (['width', 'height', 'colspan', 'rowspan', 'span', 'start'].includes(name)) {
					if (numberAttribute.test(value.trim())) copy.setAttribute(name, value.trim());
				} else {
					copy.setAttribute(name, value);
				}
			}
		}
		if (tag === 'a' && copy.hasAttribute('href')) {
			copy.setAttribute('target', '_blank');
			copy.setAttribute('rel', 'noopener noreferrer');
		}
		if (tag === 'img') copy.setAttribute('loading', 'lazy');
		cleanNode(element, copy, document, option);
		into.appendChild(copy);
	}
}

/**
 * Clean HTML as nodes, to append as they are: they are never turned back into text and read
 * again, so nothing can change shape on the way (mutation XSS).
 */
export function sanitizeHtmlFragment(html: string, option: CleanOption = {}): DocumentFragment {
	// a template's content is inert: nothing in it loads or runs while it is read
	const template = document.createElement('template');
	template.innerHTML = html;
	const target = document.createDocumentFragment();
	cleanNode(template.content, target, document, option);
	return target;
}

/** Clean HTML as text, for where only text will do (a block inside a line of text). */
export function sanitizeHtml(html: string, option: CleanOption = {}): string {
	const holder = document.createElement('div');
	holder.append(sanitizeHtmlFragment(html, option));
	return holder.innerHTML;
}
