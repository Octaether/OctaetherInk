import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import { openStructureEditor, structureEditorStyle } from './editor';
import { formulaHtml } from './formula';
import { type Scene, buildScene, defaultBondLength } from './scene';
import { renderScene } from './svg';

export { openStructureEditor, type StructureEditorOption } from './editor';
export { characterWidth, formulaHtml, formulaWidth, parseFormula, type FormulaPiece } from './formula';
export { edgeDistance, labelPieceList, measureLabel, parseMolecule, splitLewis, type Atom, type Bond, type ElectronGroup, type Molecule, type Ring } from './molecule';
export * from './structure';
export { buildScene, defaultBondLength, type Scene, type SceneLabel } from './scene';
export { renderScene } from './svg';

const chemStyle = `
.oi-chem { position: relative; overflow-x: auto; overflow-y: hidden; padding: 0.2em 0; }
.oi-chem-scene { position: relative; margin: 0 auto; }
.oi-chem-svg { position: absolute; inset: 0; overflow: visible; }
.oi-chem-svg text { stroke: none; fill: currentColor; font-family: var(--oi-font-body); }
.oi-chem-condition { font-size: 0.72px; }
.oi-chem-plus { font-size: 1px; }
.oi-chem-label { position: absolute; width: max-content; max-width: 14em; text-align: center; white-space: normal; }
.oi-chem-label-text { font-size: 0.85em; line-height: 1.35; }
.oi-chem-problem { font-size: 0.8em; color: var(--oi-color-danger); margin-top: 2px; }
.oi-chem-formula sub, .oi-chem-formula sup { font-size: 0.7em; line-height: 0; }
.oi-chem-inline { display: inline-block; vertical-align: middle; font-size: 0.8em; }
.oi-frame:not([data-oi-editing]) .oi-chem-svg [data-oi-s]:hover { filter: drop-shadow(0 0 2.5px var(--oi-hover, color-mix(in srgb, var(--oi-color-accent) 45%, transparent))) drop-shadow(0 0 1px var(--oi-hover, transparent)); cursor: text; }
.oi-read-only .oi-chem-svg [data-oi-s]:hover { filter: none; cursor: auto; }
.oi-chem-pencil, .oi-chem-add, .oi-chem-draw-new { font: 500 12px/1 var(--oi-font-body); color: var(--oi-color-text-muted); background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 6px; cursor: pointer; }
.oi-chem-pencil { position: absolute; width: 24px; height: 24px; padding: 0; transform: translate(-50%, -50%); opacity: 0; transition: opacity 0.12s; }
.oi-chem-add { position: absolute; top: 2px; inset-inline-end: 2px; height: 24px; padding: 0 8px; opacity: 0; transition: opacity 0.12s; }
.oi-frame:hover > .oi-content .oi-chem-pencil, .oi-frame:hover > .oi-content .oi-chem-add { opacity: 1; }
.oi-chem-pencil:hover, .oi-chem-add:hover, .oi-chem-draw-new:hover { color: var(--oi-color-accent); border-color: var(--oi-color-accent); }
.oi-frame[data-oi-editing] .oi-chem-pencil, .oi-frame[data-oi-editing] .oi-chem-add, .oi-read-only .oi-chem-pencil, .oi-read-only .oi-chem-add { display: none; }
.oi-chem-empty { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--oi-color-text-muted); }
.oi-chem-empty p { margin: 0; }
.oi-chem-draw-new { height: 30px; padding: 0 12px; color: var(--oi-color-accent); }
@media (hover: none) { .oi-chem-pencil, .oi-chem-add { pointer-events: none; } .oi-frame:is([data-oi-editing], [data-oi-selected]) > .oi-content :is(.oi-chem-pencil, .oi-chem-add) { opacity: 1; pointer-events: auto; } }
.oi-read-only .oi-chem-pencil, .oi-read-only .oi-chem-add { display: none; }
${structureEditorStyle}
`;

const bondLengthMap: Readonly<Record<string, number>> = { Short: 1.9, Normal: defaultBondLength, Long: 2.9 };

/** Each molecule's top-right corner in the scene's em box (for its pencil button). */
function moleculeCornerList(scene: Scene): { left: number; top: number }[] {
	return scene.moleculeList.map(({ molecule, unit, dx, dy }) => {
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const atom of molecule.atomList) {
			const labelRight = atom.label === '' ? 0 : atom.width - atom.anchor;
			maxX = Math.max(maxX, atom.x * unit + dx + labelRight);
			maxY = Math.max(maxY, atom.y * unit + dy + (atom.label === '' ? 0 : 0.5));
		}
		return { left: Math.min(maxX + 0.3, scene.box.maxX) - scene.box.minX, top: Math.max(scene.box.maxY - maxY - 0.1, 0.4) };
	});
}

/** Opens the drawing tool on the n-th \chemfig of the body (or a new one), and writes the result back. */
function drawStructure(block: ResolvedBlock, context: RenderContext, scene: Scene | undefined, index: number | undefined): void {
	const body = block.body;
	const span = index === undefined ? undefined : scene?.moleculeList[index]?.span;
	const inner = span ? body.slice(span.start + '\\chemfig{'.length, span.end - 1) : '';
	openStructureEditor({
		chemfig: inner,
		onDone(text) {
			if (span) {
				const before = body.slice(0, span.start);
				const after = body.slice(span.end);
				context.setBody(text === '' ? `${before.replace(/[ \t]+$/, '')}${after.replace(/^[ \t]+/, before.endsWith('\n') || before === '' ? '' : ' ')}` : `${before}\\chemfig{${text}}${after}`);
			} else if (text !== '') {
				context.setBody(body.trim() === '' ? `\\chemfig{${text}}` : `${body.replace(/\s+$/, '')}\n\\chemfig{${text}}`);
			}
		},
	});
}

function draw(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const scale = block.property.get('Scale');
	const lengthChoice = context.setting('Chem.BondLength');
	const base = bondLengthMap[typeof lengthChoice === 'string' ? lengthChoice : 'Normal'] ?? defaultBondLength;
	const bondLength = base * (typeof scale === 'number' && scale > 0 && scale < 10 ? scale : 1);
	const editable = !context.readOnly();
	if (block.body.trim() === '') {
		frame.innerHTML =
			'<div class="oi-chem oi-chem-empty"><p data-oi-s="0">Empty chemistry block: write \\chemfig{…}, a scheme, Arrow and Label lines' +
			`${editable ? ', or draw it.</p><button type="button" class="oi-chem-draw-new" data-oi-interactive>Draw a structure</button>' : '.</p>'}</div>`;
		frame.querySelector('.oi-chem-draw-new')?.addEventListener('click', () => drawStructure(block, context, undefined, undefined));
		return;
	}
	const scene = buildScene(block.body, { bondLength, avoid: context.setting('Chem.LabelAvoid') !== false });
	const html = renderScene(scene, {
		resolveColor: context.resolveColor,
		renderLabel: (content, offset) => context.renderInline('Text', content, new Map(), offset) ?? escapeHtml(content),
	});
	const showProblem = context.setting('Chem.ShowProblem') !== false;
	const problem = scene.problemList.length
		? showProblem
			? `<div class="oi-chem-problem" data-oi-problem>${escapeHtml(scene.problemList.map((item) => item.message).join(' · '))}</div>`
			: '<span data-oi-problem hidden></span>'
		: '';
	frame.innerHTML = `<div class="oi-chem">${html}</div>${problem}`;
	if (!editable) return;
	// drawing tool: a pencil over each molecule, and "+ Structure" for a new one
	const sceneElement = frame.querySelector<HTMLElement>('.oi-chem-scene');
	moleculeCornerList(scene).forEach((corner, index) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'oi-chem-pencil';
		button.dataset.oiInteractive = '';
		button.title = 'Edit this structure in the drawing tool';
		button.setAttribute('aria-label', 'Edit this structure in the drawing tool');
		button.textContent = '✎';
		button.style.left = `${corner.left}em`;
		button.style.top = `${corner.top}em`;
		button.addEventListener('click', () => drawStructure(block, context, scene, index));
		sceneElement?.append(button);
	});
	const add = document.createElement('button');
	add.type = 'button';
	add.className = 'oi-chem-add';
	add.dataset.oiInteractive = '';
	add.title = 'Draw a new structure into this block';
	add.textContent = '+ Structure';
	add.addEventListener('click', () => drawStructure(block, context, scene, undefined));
	frame.querySelector('.oi-chem')?.append(add);
}

const chemBlockType: BlockTypeDefinition = {
	name: 'Chem',
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
	inline: {
		render(content, _property, context, offset) {
			if (!content.includes('\\chemfig')) return formulaHtml(content, offset);
			const scene = buildScene(content, { bondLength: 1.4 });
			const shifted = renderScene(scene, { resolveColor: context.resolveColor, renderLabel: (text) => escapeHtml(text) }).replace(
				/data-oi-([se])="(\d+)"/g,
				(_, letter: string, value: string) => `data-oi-${letter}="${Number(value) + offset}"`,
			);
			return `<span class="oi-chem-inline">${shifted}</span>`;
		},
	},
	templateList: [
		{ title: 'Draw a structure', icon: '✎', source: 'Chem:', keywordList: ['draw', 'molecule', 'structure', 'chemdraw', 'aleks', 'chemistry'], explain: 'Opens an empty chemistry block with the drawing tool' },
		{ title: 'Chemical structure', icon: '⌬', source: 'Chem:\n\t\\chemfig{*6(=-=-=-)}', keywordList: ['chemfig', 'molecule', 'benzene', 'structure'], explain: 'Benzene in chemfig; edit the text or draw' },
		{
			title: 'Reaction scheme',
			icon: '⇌',
			source: 'Chem:\n\t\\schemestart A \\+ B \\arrow{->[catalyst][heat]} C \\schemestop',
			keywordList: ['reaction', 'scheme', 'arrow'],
			explain: 'Reactants, arrows with conditions, products',
		},
		{
			title: 'Mechanism',
			icon: '↷',
			source: 'Chem:\n\t\\chemfig{@{nu}\\lewis{0:2:6:,HO}^{-}} \\qquad \\chemfig{@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{lg}Br}\n\tArrow nu.lp -> c\n\tArrow cb -> lg\n\tLabel c {Side: Below}: backside attack',
			keywordList: ['mechanism', 'curved arrow', 'electron', 'pushing', 'sn2', 'lone pair'],
			explain: 'Electron-pushing arrows from lone pairs and bonds',
		},
	],
	style: chemStyle,
	plainText: (block) => block.body,
};

export const chemModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Chem',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Chemistry',
	explain:
		'Molecules in chemfig syntax (bonds, angles, branches, rings, wedges, lone pairs), a drawing tool for structures, reaction schemes, electron-pushing arrows from lone pairs and bonds, and text labels anywhere in the drawing. Our own parser and renderer; inline formulas as {Chem: 2H_2 + O_2 -> 2H_2O}.',
	settingList: [
		{ id: 'Chem.BondLength', title: 'Bond length', type: 'Choice', choiceList: ['Short', 'Normal', 'Long'], default: 'Normal', explain: 'How long bonds are drawn. Short fits big mechanisms on a phone; Long is easier to read in lectures.' },
		{ id: 'Chem.LabelAvoid', title: 'Keep labels clear', type: 'Toggle', default: true, explain: 'Labels step away from atoms, bonds, and arrows. Off: labels sit exactly at their target (a label’s own Avoid wins).' },
		{ id: 'Chem.ShowProblem', title: 'Show mistakes', type: 'Toggle', default: true, explain: 'Explains unknown names and syntax mistakes under the drawing (the block is outlined either way).' },
	],
	blockTypeList: [chemBlockType],
};
