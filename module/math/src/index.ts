import type { BlockTypeDefinition, ModuleDefinition, RenderContext, ResolvedBlock } from '@octaether/core-sdk';
import { type MacroScope, type MathProblem, defineMacro, expandMacro, tokenize } from './parse';
import { Parser } from './parser';
import { toMathML } from './mathml';

export * from './parse';
export { Parser } from './parser';
export { toMathML } from './mathml';

/** Built-in conveniences; a block or note can redefine them. */
export const builtInMacroScope: MacroScope = new Map();
defineMacro(builtInMacroScope, String.raw`\newcommand{\R}{\mathbb{R}}\newcommand{\N}{\mathbb{N}}\newcommand{\Z}{\mathbb{Z}}\newcommand{\Q}{\mathbb{Q}}\newcommand{\C}{\mathbb{C}}`);

export interface RenderMathOption {
	display: boolean;
	/** Added to every source span (inline math inside a paragraph). */
	offset?: number;
	macroScope?: MacroScope;
	resolveColor(value: string): string | undefined;
}

export interface RenderMathResult {
	mathml: string;
	problemList: MathProblem[];
}

/** TeX → MathML. Block-level \newcommand stays local to this call. */
export function renderMath(source: string, option: RenderMathOption): RenderMathResult {
	const problemList: MathProblem[] = [];
	const scope: MacroScope = new Map(option.macroScope ?? builtInMacroScope);
	const tokenList = expandMacro(tokenize(source, option.offset ?? 0), scope, problemList);
	const root = new Parser(tokenList, problemList).parseDocument();
	return { mathml: toMathML(root, { display: option.display, resolveColor: option.resolveColor }), problemList };
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

const mathStyle = `
.oi-note { counter-reset: oi-equation; }
.oi-math { font-family: var(--oi-font-math); }
/* the wrapper scrolls a wide equation: WebKit sizes <math display="block"> to its content */
.oi-math-display { overflow-x: auto; overflow-y: hidden; padding: 0.1em 0; }
.oi-math-display > math { margin: 0.2em 0; }
.oi-math :is(mi, mn, mo, mtext)[data-oi-s] { border-radius: 2px; }
.oi-frame:not([data-oi-editing]) .oi-math :is(mi, mn, mo, mtext)[data-oi-s]:hover { background: var(--oi-hover, color-mix(in srgb, var(--oi-color-accent) 30%, transparent)); border-radius: 2px; cursor: text; }
.oi-read-only .oi-frame .oi-math :is(mi, mn, mo, mtext)[data-oi-s]:hover { background: none; cursor: auto; }
.oi-math-error { color: var(--oi-color-danger); }
.oi-math-problem { font-size: 0.8em; color: var(--oi-color-danger); margin-top: 2px; }
.oi-math-numbered { counter-increment: oi-equation; display: flex; align-items: center; gap: 1em; }
.oi-math-numbered > .oi-math-display { flex: 1; min-width: 0; }
.oi-math-numbered::after { content: "(" counter(oi-equation) ")"; color: var(--oi-color-text-muted); }
`;

const fontMap: Readonly<Record<string, string>> = {
	'STIX Two Math': "'STIX Two Math', math",
	'Latin Modern Math': "'Latin Modern Math', math",
	'Cambria Math': "'Cambria Math', math",
	'Noto Sans Math': "'Noto Sans Math', math",
};

function draw(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const { mathml, problemList } = renderMath(block.body, { display: true, resolveColor: context.resolveColor });
	const showError = context.setting('Math.ShowError') !== false;
	const problemText =
		problemList.length && showError
			? `<div class="oi-math-problem" data-oi-problem>${escapeHtml(problemList.map((problem) => problem.message).join(' · '))}</div>`
			: problemList.length
				? '<span data-oi-problem hidden></span>'
				: '';
	frame.innerHTML = `<div class="oi-math-display">${mathml}</div>${problemText}`;
	const numbering = context.setting('Math.Numbering') ?? 'Numbered';
	frame.classList.toggle('oi-math-numbered', numbering === 'All' || (numbering === 'Numbered' && block.property.get('Numbered') === true));
	const font = context.setting('Math.Font');
	if (typeof font === 'string' && fontMap[font]) frame.style.setProperty('--oi-font-math', fontMap[font]);
	else frame.style.removeProperty('--oi-font-math');
}

const mathBlockType: BlockTypeDefinition = {
	name: 'Math',
	content: 'Raw',
	// $$x^2$$ on one line, or $$ … $$ around several, as in Obsidian
	aliasList: [{ marker: '$$', opening: 'Body' }],
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
		render(content, _property, context, offset) {
			return renderMath(content, { display: false, offset, resolveColor: context.resolveColor }).mathml;
		},
	},
	templateList: [{ title: 'Math', icon: '∑', source: 'Math:', keywordList: ['equation', 'latex', 'tex', 'formula'], explain: 'Display math in TeX; in a sentence write {Math: …}' }],
	style: mathStyle,
	plainText: (block) => block.body,
};

export const mathModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Math',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Math',
	explain:
		'Math blocks ("Math:", or $$ … $$ as in Obsidian) and inline math ({Math: …}), written in TeX. Our own parser and macro engine turn it into MathML that the browser lays out, so colors, fonts, and themes follow the rest of the note, and clicking any rendered piece jumps to that exact spot in the source.',
	settingList: [
		{
			id: 'Math.Font',
			title: 'Math font',
			type: 'Choice',
			choiceList: ['Default', 'STIX Two Math', 'Latin Modern Math', 'Cambria Math', 'Noto Sans Math'],
			default: 'Default',
			explain: 'The font for equations. Default picks the best math font your device has (STIX Two on Apple devices, Cambria on Windows, Noto on Android).',
		},
		{
			id: 'Math.Numbering',
			title: 'Equation numbers',
			type: 'Choice',
			choiceList: ['Numbered', 'All', 'None'],
			default: 'Numbered',
			explain: 'Numbered: only blocks with {Numbered: True} get a number. All: every math block is numbered. None: no numbers.',
		},
		{ id: 'Math.ShowError', title: 'Show mistakes', type: 'Toggle', default: true, explain: 'Explains what’s wrong under an equation that has a mistake (the block is outlined either way).' },
	],
	blockTypeList: [mathBlockType],
};
