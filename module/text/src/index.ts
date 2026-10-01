import { walkNode } from '@octaether/core-format';
import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, type StatusContext, loadAssetImage } from '@octaether/core-sdk';
import { countWord, headingLevel, listShape, markdownPlainText, renderInline, renderMarkdown, toggleCalloutFold, toggleTask } from './markdown';

export { escapeHtml } from '@octaether/core-sdk';
export {
	countWord,
	headingLevel,
	inlineStyle,
	listShape,
	markdownPlainText,
	readInlineBlock,
	renderInline,
	renderMarkdown,
	safeUrl,
	toggleCalloutFold,
	toggleTask,
	type ListShape,
	type MarkdownOption,
} from './markdown';

const textStyle = `
.oi-text > :first-child { margin-top: 0; }
.oi-text > :last-child { margin-bottom: 0; }
.oi-text p { margin: 0; min-height: 1.6em; }
.oi-text h1, .oi-text h2, .oi-text h3, .oi-text h4, .oi-text h5, .oi-text h6 { line-height: 1.3; margin: 0; font-weight: 650; }
.oi-text h1 { font-size: 1.8em; }
.oi-text h2 { font-size: 1.45em; }
.oi-text h3 { font-size: 1.2em; }
.oi-text h4, .oi-text h5, .oi-text h6 { font-size: 1em; }
.oi-frame.oi-heading:not(:first-child) { margin-top: 0.6em; }
.oi-text a { color: var(--oi-color-accent); text-decoration: underline; text-underline-offset: 2px; }
.oi-text code { font-family: var(--oi-font-code); font-size: 0.88em; background: var(--oi-color-surface2); padding: 0.1em 0.35em; border-radius: 4px; }
.oi-text mark { background: var(--oi-color-highlight); color: inherit; border-radius: 3px; padding: 0 0.15em; }
.oi-text blockquote { margin: 0; padding-inline-start: 0.9em; border-inline-start: 3px solid var(--oi-color-border); color: var(--oi-color-text-muted); }
.oi-text .oi-callout-body { margin-top: 0.3em; }
.oi-text ul, .oi-text ol { margin: 0; padding-inline-start: 1.5em; }
.oi-text li.oi-task { list-style: none; margin-inline-start: -1.35em; }
.oi-text li.oi-task input { margin: 0 0.35em 0 0; vertical-align: -0.1em; cursor: pointer; }
.oi-task-done > .oi-content .oi-text li.oi-task > span { color: var(--oi-color-text-muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, currentColor 50%, transparent); }
.oi-text table { border-collapse: collapse; }
.oi-text th, .oi-text td { border: 1px solid var(--oi-color-border); padding: 0.3em 0.6em; }
.oi-text th { background: var(--oi-color-surface1); }
.oi-text hr { border: none; border-top: 1px solid var(--oi-color-border); margin: 0.5em 0; }
.oi-text .oi-empty-line::before { content: attr(data-placeholder); color: var(--oi-color-text-muted); opacity: 0.6; }
.oi-tag { color: var(--oi-color-accent); background: var(--oi-color-accent-soft); border-radius: 999px; padding: 0.05em 0.5em; font-size: 0.9em; white-space: nowrap; cursor: pointer; }
.oi-tag-plain .oi-tag { background: none; padding: 0; border-radius: 0; font-size: 1em; }
.oi-wikilink { color: var(--oi-color-accent); cursor: pointer; text-decoration: none; }
.oi-wikilink:hover { text-decoration: underline; text-underline-offset: 2px; }
.oi-wikilink.oi-unresolved { opacity: 0.65; }
.oi-text-empty { color: var(--oi-color-text-muted); opacity: 0.6; }
.oi-read-only .oi-text-empty { display: none; }
.oi-text-image { max-width: 100%; height: auto; border-radius: 4px; vertical-align: bottom; }
.oi-text-image[data-oi-problem] { min-width: 2em; min-height: 1.4em; outline: 1px dashed var(--oi-color-warning); }
`;

function draw(frame: HTMLElement, body: string, context: RenderContext): void {
	frame.classList.add('oi-text');
	frame.classList.toggle('oi-tag-plain', context.setting('Text.TagPill') === false);
	if (body.trim() === '') {
		frame.innerHTML = '<p class="oi-text-empty" data-oi-s="0">Type something, or press / for a block</p>';
		return;
	}
	frame.innerHTML = renderMarkdown(body, { resolveColor: context.resolveColor, renderInline: context.renderInline });
	// pictures (![](photo.png), ![[photo.png]]) come from the vault once it answers
	loadAssetImage(frame, context);
}

/** A note's prose: Text blocks without Markdown marks (for word counts). */
function notePlainText(context: StatusContext): string {
	const partList: string[] = [];
	walkNode(context.note.document.itemList, (node) => {
		if (node.type === 'Text') partList.push(markdownPlainText(node.body));
	});
	return partList.join('\n');
}

const textBlockType: BlockTypeDefinition = {
	name: 'Text',
	content: 'Item',
	render: {
		mount(frame, block, context) {
			let current = { body: block.body, context };
			draw(frame, block.body, context);
			// ticking a task box or folding a callout changes the source: `- [ ]` ↔ `- [x]`, `[!tip]-` ↔ `[!tip]+`
			const onClick = (event: Event): void => {
				const target = event.target as HTMLElement;
				if (target instanceof HTMLInputElement && target.hasAttribute('data-oi-task')) {
					if (current.context.setting('Text.TaskToggle') === false) {
						event.preventDefault();
						return;
					}
					current.context.setBody(toggleTask(current.body));
				}
				if (target.closest('[data-oi-callout-fold]')) current.context.setBody(toggleCalloutFold(current.body));
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
	edit: { kind: 'InlineText' },
	inline: {
		render(content, property, context, offset) {
			return renderInline(content, { resolveColor: context.resolveColor, renderInline: context.renderInline }, offset);
		},
	},
	frameClassList(block) {
		const list = listShape(block.body);
		if (list) return ['oi-list-item', ...(list.task ? ['oi-task-item'] : []), ...(list.task === 'Done' ? ['oi-task-done'] : [])];
		const level = headingLevel(block.body);
		return level > 0 ? ['oi-heading', `oi-heading-${level}`] : [];
	},
	templateList: [
		{ title: 'Text', icon: '¶', source: '', keywordList: ['paragraph', 'plain'], explain: 'Plain writing' },
		{ title: 'Heading 1', icon: 'H1', source: '# ', keywordList: ['title'] },
		{ title: 'Heading 2', icon: 'H2', source: '## ', keywordList: ['subtitle'] },
		{ title: 'Heading 3', icon: 'H3', source: '### ' },
		{ title: 'Bulleted list', icon: '•', source: '- ', keywordList: ['bullet', 'unordered'] },
		{ title: 'Numbered list', icon: '1.', source: '1. ', keywordList: ['ordered'] },
		{ title: 'To-do', icon: '☐', source: '- [ ] ', keywordList: ['task', 'checkbox'] },
		{ title: 'Quote', icon: '❝', source: '> ' },
		{ title: 'Table', icon: '▦', source: '| Column | Column |\n| --- | --- |\n| | |' },
	],
	style: textStyle,
	plainText: (block) => markdownPlainText(block.body),
};

export const textModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Text',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Text',
	explain:
		'Paragraphs, headings, lists, to-dos, quotes, Obsidian callouts (> [!tip]), and tables written in Markdown, with tags (#Tag, #[Tag With Space]), [[links]], pictures (![](photo.png), ![[photo.png]]), styled words [text]{Color: Accent}, and any block inline as {Type: …}, such as {Math: x^2}. Text blocks can hold other blocks. Always on.',
	core: true,
	settingList: [
		{ id: 'Text.TaskToggle', title: 'Tick to-dos by clicking', type: 'Toggle', default: true, explain: 'Clicking a to-do’s box ticks it (in every view). Off: boxes only change when you edit the text.' },
		{ id: 'Text.TagPill', title: 'Tags as pills', type: 'Toggle', default: true, explain: 'Shows #tags as small rounded labels. Off: tags are coloured words.' },
		{ id: 'Text.SpellCheck', title: 'Spell check', type: 'Toggle', default: true, explain: 'Underlines misspelled words while you type in a text block.' },
	],
	statusItemList: [
		{
			id: 'Text.WordCount',
			title: 'Word count',
			order: 20,
			text(context) {
				if (context.selection.trim() !== '') return `${countWord(context.selection).toLocaleString()} of ${countWord(notePlainText(context)).toLocaleString()} words`;
				const count = countWord(notePlainText(context));
				return `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
			},
		},
		{
			id: 'Text.CharacterCount',
			title: 'Character count',
			order: 21,
			text(context) {
				const count = [...(context.selection.trim() !== '' ? context.selection : notePlainText(context)).replace(/\s+/g, ' ').trim()].length;
				return `${count.toLocaleString()} ${count === 1 ? 'character' : 'characters'}`;
			},
		},
	],
	blockTypeList: [textBlockType],
};
