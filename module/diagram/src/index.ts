import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import { renderDiagram } from './render';
import { parseTikz } from './tikz';

export { evaluate } from './expression';
export { renderDiagram } from './render';
export { parseTikz, tikzColor, type Diagram, type DiagramNode, type DiagramPath } from './tikz';

const diagramStyle = `
.oi-diagram { overflow-x: auto; overflow-y: hidden; padding: 0.2em 0; }
.oi-diagram-scene { position: relative; margin: 0 auto; }
.oi-diagram-svg { position: absolute; inset: 0; overflow: visible; color: inherit; }
.oi-diagram-label { position: absolute; white-space: nowrap; }
.oi-diagram-label-text { font-size: 0.95em; line-height: 1.3; }
.oi-diagram-problem { font-size: 0.8em; color: var(--oi-color-danger); margin-top: 2px; }
.oi-frame:not([data-oi-editing]) .oi-diagram-svg [data-oi-s]:hover { filter: drop-shadow(0 0 2.5px var(--oi-hover, color-mix(in srgb, var(--oi-color-accent) 45%, transparent))); cursor: text; }
.oi-read-only .oi-diagram-svg [data-oi-s]:hover { filter: none; cursor: auto; }
`;

/**
 * A node label: TikZ writes math as `$x$`, so those parts go to the Math renderer and the rest is
 * text (Markdown and `{Type: …}` inline blocks), each keeping its source offset.
 */
function renderLabel(content: string, offset: number, context: RenderContext): string {
	let html = '';
	let at = 0;
	const text = (end: number): void => {
		if (end > at) html += context.renderInline('Text', content.slice(at, end), new Map(), offset + at) ?? escapeHtml(content.slice(at, end));
	};
	for (let index = 0; index < content.length; index++) {
		if (content[index] === '\\') {
			index++;
			continue;
		}
		if (content[index] !== '$') continue;
		const close = content.indexOf('$', index + 1);
		if (close < 0) break;
		text(index);
		const tex = content.slice(index + 1, close);
		html += context.renderInline('Math', tex, new Map(), offset + index + 1) ?? escapeHtml(`$${tex}$`);
		at = close + 1;
		index = close;
	}
	text(content.length);
	return html;
}

function draw(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	if (block.body.trim() === '') {
		frame.innerHTML = '<p data-oi-s="0" style="margin:0;color:var(--oi-color-text-muted)">Empty diagram: write TikZ, e.g. \\draw[->] (0,0) -- (2,1);</p>';
		return;
	}
	const diagram = parseTikz(block.body);
	const scale = Number.parseFloat(String(context.setting('Diagram.Scale') ?? '100%')) / 100;
	const html = renderDiagram(diagram, {
		scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
		resolveColor: context.resolveColor,
		renderLabel: (content, offset) => renderLabel(content, offset, context),
	});
	const showProblem = context.setting('Diagram.ShowProblem') !== false;
	const problem = diagram.problemList.length
		? showProblem
			? `<div class="oi-diagram-problem" data-oi-problem>${escapeHtml(diagram.problemList.map((item) => item.message).join(' · '))}</div>`
			: '<span data-oi-problem hidden></span>'
		: '';
	frame.innerHTML = `<div class="oi-diagram">${html}</div>${problem}`;
}

const diagramBlockType: BlockTypeDefinition = {
	name: 'Diagram',
	content: 'Raw',
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
	templateList: [
		{
			title: 'Graph of a function',
			icon: '∿',
			source: 'Diagram:\n\t\\draw[->] (-3.2,0) -- (3.4,0) node[right] {$x$};\n\t\\draw[->] (0,-1.4) -- (0,1.6) node[above] {$y$};\n\t\\draw[thick, Accent, domain=-3:3, samples=80] plot (\\x, {sin(\\x r)});\n\t\\node[Accent] at (2,1.2) {$\\sin x$};',
			keywordList: ['tikz', 'plot', 'function', 'graph', 'axis'],
		},
		{
			title: 'Diagram (TikZ)',
			icon: '◇',
			source: 'Diagram:\n\t\\node[draw, circle] (a) at (0,0) {A};\n\t\\node[draw, circle] (b) at (2.5,0) {B};\n\t\\draw[->, thick] (a) -- (b) node[midway, above] {$f$};',
			keywordList: ['tikz', 'graph', 'node', 'arrow', 'commutative'],
		},
		{
			title: 'Geometry',
			icon: '△',
			source: 'Diagram:\n\t\\draw[thick] (0,0) coordinate (A) -- (4,0) coordinate (B) -- (1,2.5) coordinate (C) -- cycle;\n\t\\node[below left] at (A) {$A$};\n\t\\node[below right] at (B) {$B$};\n\t\\node[above] at (C) {$C$};\n\t\\draw (0.6,0) arc (0:68:0.6);',
			keywordList: ['tikz', 'triangle', 'geometry', 'angle'],
		},
	],
	style: diagramStyle,
	plainText: (block) => block.body,
};

export const diagramModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Diagram',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Diagram (TikZ)',
	explain:
		'Diagrams in a TikZ subset: \\draw, \\fill, \\node, \\coordinate, \\foreach, plots of functions, arrows, arcs, circles, grids, and to[out,in] curves. Our own parser and renderer; labels can hold $math$.',
	settingList: [
		{ id: 'Diagram.Scale', title: 'Size', type: 'Choice', choiceList: ['75%', '100%', '125%', '150%'], default: '100%', explain: 'How big 1 cm of a drawing is on screen. Labels keep the text size.' },
		{ id: 'Diagram.ShowProblem', title: 'Show mistakes', type: 'Toggle', default: true, explain: 'Explains unknown commands under the drawing (the block is outlined either way).' },
	],
	blockTypeList: [diagramBlockType],
};
