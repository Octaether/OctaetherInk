import type { PropertyMap } from '@octaether/core-format';
import { type BlockTypeDefinition, type BoardEditor, type BoardItem, type ColorPicker, type HotkeyLookup, type ModuleDefinition, type RenderContext, type ResolvedBlock, boardEditorExtension, colorPickerExtension, escapeHtml, hotkeyExtension } from '@octaether/core-sdk';
import { chemfigToBoard } from './convert';
import { isOneStructure, loadBoard, writeBoard } from './drawing';
import { chooseDrawingTool, drawingCommandList, openStructureEditor, structureEditorStyle } from './editor';
import { formulaHtml } from './formula';
import { type Scene, type SceneOption, buildScene, defaultBondLength, sceneAnchor } from './scene';
import { type RenderOption, renderScene } from './svg';

export { chemfigToBoard } from './convert';
export {
	type BoardBlock,
	type BoardDrawing,
	type BoardMetric,
	type StructureDrawing,
	boardItemOf,
	boardScale,
	cloneBoard,
	isDrawnChem,
	isOneStructure,
	loadBoard,
	loadStructure,
	partGraph,
	readBoardText,
	syncBoard,
	syncStructure,
	writeBoard,
} from './drawing';
export { openStructureEditor, type StructureEditorOption } from './editor';
export { isStructureText, parseStructure, structureMolecule, writeStructure, type ParsedStructure } from './path';
export { characterWidth, formulaHtml, formulaWidth, parseFormula, type FormulaPiece } from './formula';
export { edgeDistance, labelPieceList, measureLabel, parseMolecule, splitLewis, type Atom, type Bond, type ElectronGroup, type Molecule, type Ring } from './molecule';
export * from './structure';
export { buildScene, defaultBondLength, sceneAnchor, structureScene, type Scene, type SceneLabel, type SceneOption } from './scene';
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
.oi-chem-edit, .oi-chem-draw-new { font: 500 12px/1 var(--oi-font-body); color: var(--oi-color-text-muted); background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 6px; cursor: pointer; }
.oi-chem-edit { position: absolute; top: 2px; inset-inline-end: 2px; height: 24px; padding: 0 8px; opacity: 0; transition: opacity 0.12s; }
.oi-frame:hover > .oi-content .oi-chem-edit { opacity: 1; }
.oi-chem-edit:hover, .oi-chem-draw-new:hover { color: var(--oi-color-accent); border-color: var(--oi-color-accent); }
.oi-frame[data-oi-editing] .oi-chem-edit, .oi-read-only .oi-chem-edit, .oi-board-area .oi-chem-edit { display: none; }
.oi-chem-empty { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--oi-color-text-muted); }
.oi-chem-empty p { margin: 0; }
.oi-chem-draw-new { height: 30px; padding: 0 12px; color: var(--oi-color-accent); }
@media (hover: none) { .oi-chem-edit { pointer-events: none; } .oi-frame:is([data-oi-editing], [data-oi-selected]) > .oi-content .oi-chem-edit { opacity: 1; pointer-events: auto; } }
${structureEditorStyle}
`;

const bondLengthMap: Readonly<Record<string, number>> = { Short: 1.9, Normal: defaultBondLength, Long: 2.9 };

/** How a Chem block is laid out: the bond length (the setting, times the block's Scale) and labels. */
function sceneOptionOf(context: Pick<RenderContext, 'setting'>, property: PropertyMap | undefined): SceneOption {
	const scale = property?.get('Scale');
	const lengthChoice = context.setting('Chem.BondLength');
	const base = bondLengthMap[typeof lengthChoice === 'string' ? lengthChoice : 'Normal'] ?? defaultBondLength;
	return { bondLength: base * (typeof scale === 'number' && scale > 0 && scale < 10 ? scale : 1), avoid: context.setting('Chem.LabelAvoid') !== false };
}

/** A block on a Board, drawn in the editor as the note draws it. */
function renderBlockOf(context: RenderContext): (type: string, body: string, property: PropertyMap) => string | undefined {
	return (type, body, property) => context.renderInline(type, body, property, 0);
}

/** 1em in px where a block is drawn. */
function emPxOf(element: Element): number {
	return Number.parseFloat(getComputedStyle(element).fontSize) || 16;
}

/** Whether a Board holds chemistry (a Chem block at any depth). */
function holdsChem(itemList: readonly BoardItem[]): boolean {
	return itemList.some((item) => item.type === 'Chem' || holdsChem(item.childList));
}

/** The Palette plugin's color picker, when it is on, and your keys for the tools. */
function colorPickerOf(context: RenderContext): { colorPicker?: ColorPicker; hotkey?: HotkeyLookup } {
	const picker = context.extension<ColorPicker>(colorPickerExtension);
	const hotkey = context.extension<HotkeyLookup>(hotkeyExtension);
	return { ...(picker ? { colorPicker: picker } : {}), ...(hotkey ? { hotkey } : {}) };
}

/**
 * Opens the drawing tool on a Chem block: one structure is edited as it is. A chemfig block with more
 * in it (schemes, arrows, labels) turns into a Board, every item pinned where it is; Undo returns it.
 */
function openDrawing(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const scene = sceneOptionOf(context, block.property);
	if (isOneStructure(block.body, scene)) {
		openStructureEditor({
			body: block.body,
			scene,
			resolveColor: context.resolveColor,
			...colorPickerOf(context),
			onDone(body) {
				if (body !== block.body) context.setBody(body);
			},
		});
		return;
	}
	const emPx = emPxOf(frame);
	openStructureEditor({
		board: {
			property: new Map(),
			itemList: chemfigToBoard(block.body, scene, emPx),
			notice: 'This chemfig block is now a Board: each structure, arrow, and label is a block you can move. Cancel leaves it as it was.',
			changed: true,
		},
		emPx,
		scene: sceneOptionOf(context, undefined),
		renderBlock: renderBlockOf(context),
		resolveColor: context.resolveColor,
		...colorPickerOf(context),
		onDone: (source) => context.replaceWith(source),
	});
}

/** Draws the block; returns its scene (for named points) or undefined when it is empty. */
function draw(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): Scene | undefined {
	const editable = !context.readOnly();
	const sceneOption = sceneOptionOf(context, block.property);
	const renderOption: RenderOption = {
		resolveColor: context.resolveColor,
		renderLabel: (content, offset) => context.renderInline('Text', content, new Map(), offset) ?? escapeHtml(content),
	};
	if (block.body.trim() === '') {
		frame.innerHTML =
			'<div class="oi-chem oi-chem-empty"><p data-oi-s="0">Empty chemistry block: write a structure, a formula, or chemfig' +
			`${editable ? ', or draw it.</p><button type="button" class="oi-chem-draw-new" data-oi-interactive>Draw a structure</button>' : '.</p>'}</div>`;
		frame.querySelector('.oi-chem-draw-new')?.addEventListener('click', () => openDrawing(frame, block, context));
		return undefined;
	}
	const scene = buildScene(block.body, sceneOption);
	const html = renderScene(scene, renderOption);
	const showProblem = context.setting('Chem.ShowProblem') !== false;
	const problem = scene.problemList.length
		? showProblem
			? `<div class="oi-chem-problem" data-oi-problem>${escapeHtml(scene.problemList.map((item) => item.message).join(' · '))}</div>`
			: '<span data-oi-problem hidden></span>'
		: '';
	frame.innerHTML = `<div class="oi-chem">${html}</div>${problem}`;
	// a chemfig scheme opens as a Board, which needs the Board feature (and the Board module)
	if (!editable || (!isOneStructure(block.body, sceneOption) && !context.feature(boardFeature))) return scene;
	const edit = document.createElement('button');
	edit.type = 'button';
	edit.className = 'oi-chem-edit';
	edit.dataset.oiInteractive = '';
	edit.title = isOneStructure(block.body, sceneOption) ? 'Edit this structure in the drawing tool' : 'Turn this drawing into a Board, where every structure, arrow, and label can be moved';
	edit.textContent = 'Edit drawing';
	edit.addEventListener('click', () => openDrawing(frame, block, context));
	frame.querySelector('.oi-chem')?.append(edit);
	return scene;
}

/** A named point of the drawn block on screen (RenderHandle.anchor), for arrows on a Board. */
function anchorOf(frame: HTMLElement, scene: Scene | undefined, name: string, toward: { x: number; y: number } | undefined): { x: number; y: number } | undefined {
	const element = frame.querySelector<HTMLElement>('.oi-chem-scene');
	if (!scene || !element) return undefined;
	const rect = element.getBoundingClientRect();
	const width = scene.box.maxX - scene.box.minX;
	const em = rect.width > 0 && width > 0 ? rect.width / width : emPxOf(element);
	const toScene = (point: { x: number; y: number }): { x: number; y: number } => ({ x: (point.x - rect.left) / em + scene.box.minX, y: scene.box.maxY - (point.y - rect.top) / em });
	const point = sceneAnchor(scene, name, toward ? toScene(toward) : undefined);
	return point ? { x: rect.left + (point.x - scene.box.minX) * em, y: rect.top + (scene.box.maxY - point.y) * em } : undefined;
}

/** Chem's drawing on Boards: the Board editor and chemfig schemes as Boards. It needs the Board module. */
const boardFeature = 'Chem.Board';

/** A chemfig drawing as the Board it becomes (for the templates). */
function boardSource(chemfig: string): string {
	const metric = { emPx: 16, option: {} };
	return writeBoard(loadBoard(new Map(), chemfigToBoard(chemfig, metric.option, metric.emPx), metric));
}

const chemBlockType: BlockTypeDefinition = {
	name: 'Chem',
	content: 'Raw',
	render: {
		mount(frame, block, context) {
			let scene = draw(frame, block, context);
			return {
				update(next, nextContext) {
					scene = draw(frame, next, nextContext);
					return 'Done';
				},
				anchor: (name, toward) => anchorOf(frame, scene, name, toward),
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
		{ title: 'Chemical structure', icon: '⌬', source: 'Chem: &1 =30 -330 =270 -210 =150 -&1', keywordList: ['molecule', 'benzene', 'structure', 'ring'], explain: 'Benzene; draw on it or edit its text' },
		{
			title: 'Reaction scheme',
			icon: '⇌',
			get source() {
				return boardSource('\\schemestart \\chemfig{*6(=-=-=-)} \\+ Br_2 \\arrow{->[FeBr_3][heat]} \\chemfig{*6(=-=(-Br)-=-)} \\+ HBr \\schemestop');
			},
			keywordList: ['reaction', 'scheme', 'arrow', 'board'],
			explain: 'A Board: reactants, an arrow with conditions, products; move anything',
			feature: boardFeature,
		},
		{
			title: 'Mechanism',
			icon: '↷',
			get source() {
				return boardSource('\\chemfig{@{nu}\\lewis{0:2:6:,HO}^{-}} \\qquad \\chemfig{@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{lg}Br}\nArrow nu.lp -> c\nArrow cb -> lg\nLabel c {Side: Below}: backside attack');
			},
			keywordList: ['mechanism', 'curved arrow', 'electron', 'pushing', 'sn2', 'lone pair', 'board'],
			explain: 'A Board: electron-pushing arrows from lone pairs and bonds',
			feature: boardFeature,
		},
		{
			title: 'Chemfig',
			icon: '∮',
			source: 'Chem:\n\t\\chemfig{*6(=-=-=-)}',
			keywordList: ['chemfig', 'latex', 'paste'],
			explain: 'chemfig as in LaTeX, for pasting; Edit drawing turns a scheme into a Board',
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
		'Structures in our own short syntax (bonds, angles, branches, rings, wedges, charges, lone pairs) drawn with a drawing tool like ChemDraw, and chemfig as well: reaction schemes, electron-pushing arrows from lone pairs and bonds, and text labels anywhere in the drawing. Our own parser and renderer; inline formulas as {Chem: 2H_2 + O_2 -> 2H_2O}.',
	settingList: [
		{ id: 'Chem.BondLength', title: 'Bond length', type: 'Choice', choiceList: ['Short', 'Normal', 'Long'], default: 'Normal', explain: 'How long bonds are drawn. Short fits big mechanisms on a phone; Long is easier to read in lectures.' },
		{ id: 'Chem.LabelAvoid', title: 'Keep labels clear', type: 'Toggle', default: true, explain: 'Labels step away from atoms, bonds, and arrows. Off: labels sit exactly at their target (a label’s own Avoid wins).' },
		{ id: 'Chem.ShowProblem', title: 'Show mistakes', type: 'Toggle', default: true, explain: 'Explains unknown names and syntax mistakes under the drawing (the block is outlined either way).' },
	],
	blockTypeList: [chemBlockType],
	featureList: [
		{
			id: boardFeature,
			title: 'Drawing on Boards',
			explain:
				'Mechanisms and reaction schemes as Boards: the drawing tool edits a whole Board (structures, arrows, text), and Edit drawing turns a chemfig scheme into one. Off: structures, formulas, and chemfig still draw, and Boards still show.',
			default: true,
			use: ['Board'],
		},
	],
	provide: ['Anchor', 'Board.Editor'],
	// the Palette plugin's picker for colors of your own, when it is on
	use: ['ColorPicker'],
	activate(host) {
		// a key per tool of the drawing tool, yours to change in Setting → Hotkey (they act only in the tool)
		const commandCleanupList = drawingCommandList.map((command) =>
			host.registerCommand({ id: `Drawing.${command.tool}`, title: `Drawing tool: ${command.title}`, key: command.key, when: 'Drawing', run: () => chooseDrawingTool(command.tool) }),
		);
		// the Board's editor: the drawing tool with the chemistry tools, on every block of the Board
		const removeEditor = host.registerExtension<BoardEditor>(boardEditorExtension, {
			open({ property, itemList, emPx, context, onDone }) {
				// the chemistry tools only where there is chemistry: a plain Board edits its arrows and text
				openStructureEditor({ board: { property, itemList }, chemistry: holdsChem(itemList), emPx, scene: sceneOptionOf(context, undefined), renderBlock: renderBlockOf(context), resolveColor: context.resolveColor, ...colorPickerOf(context), onDone });
			},
		}, boardFeature);
		return () => {
			removeEditor();
			for (const cleanup of commandCleanupList) cleanup();
		};
	},
};
