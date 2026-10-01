// A block of HTML, for what Markdown can't say: a coloured table, <kbd> keys, a <details> fold.
//
//   HTML:
//   	<details><summary>Answer</summary>The rate doubles.</details>
//
// It is cleaned first (see sanitize.ts), so nothing in it can run, and it stays inside its block.

import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, loadAssetImage } from '@octaether/core-sdk';
import { sanitizeHtml, sanitizeHtmlFragment } from './sanitize';

export { cleanStyle, sanitizeHtml, sanitizeHtmlFragment, type CleanOption } from './sanitize';

const htmlStyle = `
.oi-html { overflow-x: auto; contain: content; line-height: 1.6; }
.oi-html > :first-child { margin-top: 0; }
.oi-html > :last-child { margin-bottom: 0; }
.oi-html a { color: var(--oi-color-accent); }
.oi-html img { max-width: 100%; height: auto; }
.oi-html table { border-collapse: collapse; }
.oi-html th, .oi-html td { border: 1px solid var(--oi-color-border); padding: 0.3em 0.6em; }
.oi-html kbd { font-family: var(--oi-font-code); font-size: 0.85em; padding: 0 0.4em; border: 1px solid var(--oi-color-border); border-bottom-width: 2px; border-radius: 4px; background: var(--oi-color-surface1); }
.oi-html code, .oi-html pre { font-family: var(--oi-font-code); font-size: 0.88em; }
.oi-html pre { padding: 8px 12px; border-radius: 6px; background: var(--oi-color-surface1); overflow-x: auto; }
.oi-html summary { cursor: pointer; }
.oi-html-inline { display: inline-block; max-width: 100%; vertical-align: bottom; contain: content; }
.oi-html-empty { color: var(--oi-color-text-muted); opacity: 0.7; }
.oi-read-only .oi-html-empty { display: none; }
`;

function draw(frame: HTMLElement, body: string, context: RenderContext): void {
	if (body.trim() === '') {
		frame.innerHTML = '<div class="oi-html oi-html-empty" data-oi-s="0">Write HTML on the lines below “HTML:”.</div>';
		return;
	}
	const container = document.createElement('div');
	container.className = 'oi-html';
	container.dataset.oiS = '0';
	container.dataset.oiE = '0';
	container.append(sanitizeHtmlFragment(body, { keepStyle: context.setting('HTML.Style') !== false }));
	frame.replaceChildren(container);
	loadAssetImage(frame, context);
}

const htmlBlockType: BlockTypeDefinition = {
	name: 'HTML',
	content: 'Raw',
	render: {
		mount(frame, block, context) {
			draw(frame, block.body, context);
			return {
				update(next, nextContext) {
					draw(frame, next.body, nextContext);
					return 'Done';
				},
			};
		},
	},
	edit: { kind: 'SourcePreview' },
	inline: {
		render(content, _property, context) {
			return `<span class="oi-html-inline">${sanitizeHtml(content, { keepStyle: context.setting('HTML.Style') !== false })}</span>`;
		},
	},
	templateList: [{ title: 'HTML', icon: '<>', source: 'HTML:', keywordList: ['html', 'markup', 'details', 'kbd'], explain: 'HTML for what Markdown can’t say; nothing in it can run' }],
	style: htmlStyle,
	plainText: (block) => block.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
};

export const htmlModule: ModuleDefinition = {
	kind: 'Module',
	name: 'HTML',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'HTML',
	explain:
		'A block of HTML ("HTML:" with the HTML on the lines below), or inline as {HTML: <kbd>Ctrl</kbd>}. It is cleaned first: scripts, forms, frames, event handlers, and anything that could leave the block are removed, and links open in a new tab.',
	settingList: [
		{ id: 'HTML.Style', title: 'Keep style attributes', type: 'Toggle', default: true, explain: 'Keeps the colours, sizes, and spacing written in style="…" (never positions or pictures from style). Off: plain HTML only.' },
	],
	blockTypeList: [htmlBlockType],
};
