// Code cells. The language is the header argument; settings go in braces, as for every block:
//
//   Code {Wrap: True}: Python               ```Python          ← the Markdown fence is an alias,
//   	print("hello")                        print("hello")        as in Obsidian (``` and ~~~)
//                                           ```
//
// The rendered block shows the language in its corner and a copy button (both can be turned off).

import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import { highlight, languageName, resolveLanguage } from './highlight';

export { highlight, languageMap, languageName, languageRule, resolveLanguage } from './highlight';

// Module tokens: Light and Dark defaults (theme protocol); any theme file may override them.
// Warm colors that sit with the gold accent: rust keywords, olive strings, amber numbers.
const codeToken = {
	'Code.Background': { Light: '#f7f5f0', Dark: '#1b1a18' },
	'Code.Keyword': { Light: '#a8412c', Dark: '#ec8e6f' },
	'Code.String': { Light: '#58701c', Dark: '#b8c77c' },
	'Code.Comment': { Light: '#8a847a', Dark: '#8f8a80' },
	'Code.Number': { Light: '#a0580f', Dark: '#e6a65d' },
	'Code.Function': { Light: '#7a5a12', Dark: '#e3c06b' },
} as const;

const codeStyle = `
.oi-code { position: relative; background: var(--oi-code-background); border: 1px solid var(--oi-color-border); border-radius: 8px; overflow: hidden; }
.oi-code-corner { position: absolute; top: 4px; inset-inline-end: 6px; display: flex; align-items: center; gap: 4px; font-size: 0.72em; color: var(--oi-color-text-muted); }
.oi-code-label { padding: 1px 4px; user-select: none; }
.oi-code-copy { display: none; padding: 1px 6px; border: 1px solid var(--oi-color-border); border-radius: 4px; background: var(--oi-color-background); color: var(--oi-color-text-muted); font: inherit; cursor: pointer; }
.oi-code:hover .oi-code-copy { display: inline-block; }
.oi-code-copy:hover { color: var(--oi-color-text); }
.oi-code-body { display: flex; }
.oi-code-gutter { flex: none; padding: 10px 0 10px 10px; text-align: end; color: var(--oi-color-text-muted); opacity: 0.6; user-select: none; font-family: var(--oi-font-code); font-size: 0.88em; line-height: 1.5; white-space: pre; }
.oi-code pre { flex: 1; min-width: 0; margin: 0; padding: 10px 12px; overflow-x: auto; font-family: var(--oi-font-code); font-size: 0.88em; line-height: 1.5; tab-size: var(--oi-code-tab, 4); }
.oi-code-wrap pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.oi-code-keyword { color: var(--oi-code-keyword); }
.oi-code-string { color: var(--oi-code-string); }
.oi-code-comment { color: var(--oi-code-comment); font-style: italic; }
.oi-code-number { color: var(--oi-code-number); }
.oi-code-function { color: var(--oi-code-function); }
.oi-code-output { border-top: 1px dashed var(--oi-color-border); color: var(--oi-color-text-muted); }
.oi-code-inline { font-family: var(--oi-font-code); font-size: 0.88em; background: var(--oi-code-background); padding: 0.1em 0.35em; border-radius: 4px; }
`;

function languageOf(block: ResolvedBlock): string | undefined {
	const value = block.property.get('Language');
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function draw(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const language = languageOf(block);
	const showLabel = context.setting('Code.LanguageLabel') !== false;
	const showCopy = context.setting('Code.CopyButton') !== false;
	// `Code {LineNumber: True}: Python` changes one block; the settings hold for the rest
	const own = (name: string, id: string): boolean => {
		const value = block.property.get(name);
		return typeof value === 'boolean' ? value : context.setting(id) === true;
	};
	const lineNumber = own('LineNumber', 'Code.LineNumber');
	const wrap = own('Wrap', 'Code.Wrap') && !lineNumber;
	const color = context.setting('Code.Highlight') !== false;
	const tabSize = Number(context.setting('Code.TabSize') ?? 4);
	const output = block.property.get('Output');
	// the language as its community writes it: python → Python, cpp → C++
	const label = languageName(language) ?? '';
	const code = color ? highlight(block.body, language) : highlight(block.body, undefined);
	const lineCount = block.body.split('\n').length;
	frame.innerHTML =
		`<div class="oi-code${wrap ? ' oi-code-wrap' : ''}"${Number.isFinite(tabSize) && tabSize > 0 && tabSize <= 16 ? ` style="--oi-code-tab: ${tabSize}"` : ''}>` +
		`<div class="oi-code-corner">${showLabel && label ? `<span class="oi-code-label" title="${resolveLanguage(language) ? 'Highlighted as' : 'Not highlighted'}: ${escapeHtml(label)}">${escapeHtml(label)}</span>` : ''}` +
		`${showCopy ? '<button type="button" class="oi-code-copy" data-oi-interactive>Copy</button>' : ''}</div>` +
		`<div class="oi-code-body">${lineNumber ? `<div class="oi-code-gutter" aria-hidden="true">${Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')}</div>` : ''}` +
		`<pre><code>${code || '<span data-oi-s="0"> </span>'}</code></pre></div>` +
		(typeof output === 'string' ? `<pre class="oi-code-output">${escapeHtml(output)}</pre>` : '') +
		'</div>';
	frame.querySelector<HTMLButtonElement>('.oi-code-copy')?.addEventListener('click', (event) => {
		const button = event.currentTarget as HTMLButtonElement;
		void navigator.clipboard?.writeText(block.body).then(
			() => {
				button.textContent = 'Copied';
				setTimeout(() => {
					button.textContent = 'Copy';
				}, 1200);
			},
			() => undefined,
		);
	});
}

const codeBlockType: BlockTypeDefinition = {
	name: 'Code',
	content: 'Raw',
	argument: 'Language',
	aliasList: [
		{ marker: '```', opening: 'Argument', repeat: true },
		{ marker: '~~~', opening: 'Argument', repeat: true },
	],
	render: {
		mount(frame, block, context) {
			draw(frame, block, context);
			return {
				update(next, nextContext) {
					draw(frame, next, nextContext);
					return 'Done';
				},
			};
		},
	},
	edit: { kind: 'SourcePreview' },
	inline: {
		render(content, property, _context, offset) {
			const language = property.get('Language');
			return `<code class="oi-code-inline">${highlight(content, typeof language === 'string' ? language : undefined, offset)}</code>`;
		},
	},
	templateList: [
		{ title: 'Code', icon: '</>', source: 'Code:', keywordList: ['program', 'snippet', 'fence'], explain: 'Type the language after "Code:" (Python, JavaScript, Rust…)' },
		{ title: 'Code (Python)', icon: 'Py', source: 'Code: Python', keywordList: ['python', 'py'] },
		{ title: 'Code (JavaScript)', icon: 'JS', source: 'Code: JavaScript', keywordList: ['javascript', 'js'] },
	],
	token: codeToken,
	style: codeStyle,
	plainText: (block) => block.body,
};

export const codeModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Code',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Code',
	explain:
		'Code blocks: "Code: Python" with the code on the indented lines below, or a Markdown fence (```Python … ```) as in Obsidian. Highlighting for JavaScript, TypeScript, Python, Rust, C/C++, Java, SQL, Shell, R, Julia, and LaTeX; inline code is `code` or {Code: …}. Running code comes later.',
	settingList: [
		{ id: 'Code.LanguageLabel', title: 'Show the language', type: 'Toggle', default: true, explain: 'The language (after "Code:" or ```) appears in the corner of the block.' },
		{ id: 'Code.CopyButton', title: 'Copy button', type: 'Toggle', default: true, explain: 'A Copy button appears when the pointer is over a code block.' },
		{ id: 'Code.LineNumber', title: 'Line numbers', type: 'Toggle', default: false, explain: 'Numbers every line. Long lines then scroll sideways instead of wrapping.' },
		{ id: 'Code.Wrap', title: 'Wrap long lines', type: 'Toggle', default: false, explain: 'Long lines continue on the next line instead of scrolling sideways.' },
		{ id: 'Code.Highlight', title: 'Syntax colors', type: 'Toggle', default: true, explain: 'Colors keywords, strings, numbers, comments, and function names.' },
		{ id: 'Code.TabSize', title: 'Tab width', type: 'Choice', choiceList: ['2', '4', '8'], default: '4', explain: 'How many spaces a tab takes in code blocks.' },
	],
	blockTypeList: [codeBlockType],
};
