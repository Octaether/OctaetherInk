// A whole Markdown document kept as one block: a README, a page copied from elsewhere, notes
// you want to keep exactly as Markdown. Pasting it as ordinary text would split it into blocks.
//
//   Markdown:
//   	# Lab report
//   	- [x] Weigh the sample
//   	- [ ] Titrate
//
// The Text module draws its pieces, so it looks like the rest of the note.

import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, loadAssetImage } from '@octaether/core-sdk';
import { highlight } from '@octaether/module-code';
import { markdownPlainText } from '@octaether/module-text';
import { renderDocument, toggleTaskAt } from './document';

export { renderDocument, shiftOffset, toggleTaskAt, type DocumentOption } from './document';

const markdownStyle = `
.oi-markdown { line-height: 1.6; }
.oi-markdown > * { margin: 0 0 0.6em; }
.oi-markdown > :last-child { margin-bottom: 0; }
.oi-markdown h1, .oi-markdown h2, .oi-markdown h3, .oi-markdown h4, .oi-markdown h5, .oi-markdown h6 { line-height: 1.3; font-weight: 650; margin-top: 0.9em; }
.oi-markdown > :first-child { margin-top: 0; }
.oi-markdown h1 { font-size: 1.8em; }
.oi-markdown h2 { font-size: 1.45em; }
.oi-markdown h3 { font-size: 1.2em; }
.oi-markdown h4, .oi-markdown h5, .oi-markdown h6 { font-size: 1em; }
.oi-markdown p { margin: 0 0 0.6em; }
.oi-markdown a { color: var(--oi-color-accent); text-decoration: underline; text-underline-offset: 2px; }
.oi-markdown code { font-family: var(--oi-font-code); font-size: 0.88em; background: var(--oi-color-surface2); padding: 0.1em 0.35em; border-radius: 4px; }
.oi-markdown pre.oi-markdown-code { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--oi-color-border); background: var(--oi-code-background, var(--oi-color-surface1)); overflow-x: auto; }
.oi-markdown pre.oi-markdown-code code { padding: 0; background: none; line-height: 1.5; }
.oi-markdown mark { background: var(--oi-color-highlight); color: inherit; border-radius: 3px; padding: 0 0.15em; }
.oi-markdown blockquote { margin: 0 0 0.6em; padding-inline-start: 0.9em; border-inline-start: 3px solid var(--oi-color-border); color: var(--oi-color-text-muted); }
.oi-markdown ul, .oi-markdown ol { padding-inline-start: 1.5em; }
.oi-markdown li > ul, .oi-markdown li > ol { margin: 0; }
.oi-markdown li.oi-task { list-style: none; margin-inline-start: -1.35em; }
.oi-markdown li.oi-task > input { margin: 0 0.35em 0 0; vertical-align: -0.1em; cursor: pointer; }
.oi-markdown table { border-collapse: collapse; }
.oi-markdown th, .oi-markdown td { border: 1px solid var(--oi-color-border); padding: 0.3em 0.6em; }
.oi-markdown th { background: var(--oi-color-surface1); }
.oi-markdown hr { border: none; border-top: 1px solid var(--oi-color-border); margin: 0.8em 0; }
.oi-markdown img { max-width: 100%; height: auto; border-radius: 4px; }
.oi-markdown-empty { color: var(--oi-color-text-muted); opacity: 0.7; }
.oi-read-only .oi-markdown-empty { display: none; }
`;

function draw(frame: HTMLElement, body: string, context: RenderContext): void {
	if (body.trim() === '') {
		frame.innerHTML = '<div class="oi-markdown oi-markdown-empty" data-oi-s="0">Write or paste Markdown on the lines below “Markdown:”.</div>';
		return;
	}
	const colour = context.setting('Code.Highlight') !== false;
	frame.innerHTML = `<div class="oi-markdown">${renderDocument(body, {
		resolveColor: context.resolveColor,
		renderInline: context.renderInline,
		highlight: (code, language, offset) => highlight(code, colour ? language : undefined, offset),
	})}</div>`;
	loadAssetImage(frame, context);
}

const markdownBlockType: BlockTypeDefinition = {
	name: 'Markdown',
	content: 'Raw',
	render: {
		mount(frame, block, context) {
			let current = { body: block.body, context };
			draw(frame, block.body, context);
			// a to-do's box ticks in the body: `- [ ]` ↔ `- [x]`
			const onClick = (event: Event): void => {
				const target = event.target as HTMLElement;
				if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-oi-markdown-task')) return;
				if (current.context.setting('Text.TaskToggle') === false) {
					event.preventDefault();
					return;
				}
				current.context.setBody(toggleTaskAt(current.body, Number(target.dataset.oiMarkdownTask)));
			};
			frame.addEventListener('click', onClick);
			return {
				update(next, nextContext) {
					current = { body: next.body, context: nextContext };
					draw(frame, next.body, nextContext);
					return 'Done';
				},
				destroy() {
					frame.removeEventListener('click', onClick);
				},
			};
		},
	},
	edit: { kind: 'SourcePreview' },
	templateList: [
		{ title: 'Markdown', icon: 'M↓', source: 'Markdown:', keywordList: ['md', 'readme', 'paste', 'document'], explain: 'A whole Markdown document kept as one block' },
	],
	style: markdownStyle,
	plainText: (block) => markdownPlainText(block.body),
};

export const markdownModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Markdown',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Markdown',
	explain:
		'A whole Markdown document kept as one block ("Markdown:" with the Markdown on the lines below): headings, nested lists and to-dos, quotes, tables, pictures, and fenced code, drawn like the rest of the note. For a README or a page from elsewhere that should stay exactly as it is.',
	blockTypeList: [markdownBlockType],
};
