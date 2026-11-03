// The drawing tool: draw molecules as in ALEKS or ChemDraw and get chemfig back. It opens on the
// whole Chem block (every structure editable, arrows, text, and labels shown as the block draws
// them) or on one structure (the rest of the block faded), with the block's text below to edit.
//
//   tools   select and move, erase, single / double / triple bond, wedge, hash, rings (3–6 and
//           benzene), charge + and −, lone pair, radical, and any element
//   mouse   click an atom to grow a bond where there is room, drag for any direction (30° steps),
//           click a bond to change it, click empty space to start; wheel zooms, Shift+wheel pans;
//           two fingers zoom and pan
//   keys    hover an atom and press C N O S P F H I, L (Cl), B (Br), + or −; 1 2 3 on a bond;
//           Ctrl+Z / Ctrl+Y, Delete, Esc; Enter (Ctrl+Enter in the text) or Done writes the block

import { type BlockDrawing, finishDrawing, loadDrawing, syncDrawing } from './drawing';
import { characterWidth } from './formula';
import { type Scene, type SceneOption, defaultBondLength } from './scene';
import {
	type BondStereo,
	type DrawAtom,
	type DrawBond,
	type Point,
	addAtom,
	addBond,
	addRing,
	atomById,
	atomPieceList,
	bondBetween,
	electronAngleList,
	freeAngle,
	isLabelVisible,
	nearestAtom,
	nearestBond,
	neighborList,
	removeAtom,
	removeBond,
	snapDegree,
} from './structure';
import { type RenderOption, renderScene } from './svg';

type Tool =
	| { kind: 'Select' }
	| { kind: 'Erase' }
	| { kind: 'Bond'; order: 1 | 2 | 3; stereo: BondStereo }
	| { kind: 'Atom'; element: string }
	| { kind: 'Ring'; size: number; aromatic: boolean }
	| { kind: 'Charge'; sign: 1 | -1 }
	| { kind: 'LonePair' }
	| { kind: 'Radical' };

export interface StructureEditorOption {
	/** The Chem block's text. */
	body: string;
	/** Edit only this `\chemfig` (its index in the block); undefined edits every structure. */
	focus?: number;
	/** How the block is laid out (bond length, labels), so the tool shows it as the note does. */
	scene?: SceneOption;
	/** How labels and colors are drawn. */
	render?: RenderOption;
	/** Called with the block's new text. */
	onDone(body: string): void;
	onClose?(): void;
}

const svgIcon = (inner: string): string => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const polygonPath = (size: number): string => {
	const pointList = Array.from({ length: size }, (_, index) => {
		const angle = ((-90 + (index * 360) / size) * Math.PI) / 180;
		return `${(12 + 8.5 * Math.cos(angle)).toFixed(1)},${(12 + 8.5 * Math.sin(angle)).toFixed(1)}`;
	});
	return `<polygon points="${pointList.join(' ')}"/>`;
};

interface ToolButton {
	id: string;
	title: string;
	icon: string;
	tool: Tool;
}

const toolButtonList: readonly (ToolButton | 'Separator')[] = [
	{ id: 'Select', title: 'Select and move (drag a box to select several)', icon: svgIcon('<path d="m4 4 7 16 2.5-6.5L20 11Z"/>'), tool: { kind: 'Select' } },
	{ id: 'Erase', title: 'Erase an atom or bond', icon: svgIcon('<path d="m7 21-4-4a2 2 0 0 1 0-3L13 4a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9Z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'), tool: { kind: 'Erase' } },
	'Separator',
	{ id: 'Single', title: 'Single bond (click a bond again to cycle single, double, triple)', icon: svgIcon('<path d="M5 19 19 5"/>'), tool: { kind: 'Bond', order: 1, stereo: 'None' } },
	{ id: 'Double', title: 'Double bond', icon: svgIcon('<path d="M3.5 16.5 16.5 3.5"/><path d="M7.5 20.5 20.5 7.5"/>'), tool: { kind: 'Bond', order: 2, stereo: 'None' } },
	{ id: 'Triple', title: 'Triple bond', icon: svgIcon('<path d="M2.5 14.5 14.5 2.5"/><path d="M5.5 18.5 18.5 5.5"/><path d="M9.5 21.5 21.5 9.5"/>'), tool: { kind: 'Bond', order: 3, stereo: 'None' } },
	{ id: 'Wedge', title: 'Wedge: toward you (click again to flip)', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><polygon points="4,20 17,4.5 20.5,8" fill="currentColor"/></svg>', tool: { kind: 'Bond', order: 1, stereo: 'Wedge' } },
	{ id: 'Hash', title: 'Hashed wedge: away from you (click again to flip)', icon: svgIcon('<path d="M5 18.6 5.8 19.4"/><path d="M8 15.2 10 17.2"/><path d="M11 11.8 14.2 15"/><path d="M14 8.4 18.4 12.8"/><path d="M17 5 22.6 10.6"/>'), tool: { kind: 'Bond', order: 1, stereo: 'Hash' } },
	'Separator',
	{ id: 'Ring3', title: 'Cyclopropane', icon: svgIcon(polygonPath(3)), tool: { kind: 'Ring', size: 3, aromatic: false } },
	{ id: 'Ring4', title: 'Cyclobutane', icon: svgIcon(polygonPath(4)), tool: { kind: 'Ring', size: 4, aromatic: false } },
	{ id: 'Ring5', title: 'Cyclopentane', icon: svgIcon(polygonPath(5)), tool: { kind: 'Ring', size: 5, aromatic: false } },
	{ id: 'Ring6', title: 'Cyclohexane', icon: svgIcon(polygonPath(6)), tool: { kind: 'Ring', size: 6, aromatic: false } },
	{ id: 'Benzene', title: 'Benzene (click a bond to fuse rings)', icon: svgIcon(`${polygonPath(6)}<path d="M8.2 9.8 12 7.6"/><path d="M15.8 9.8v4.4"/><path d="M12 16.4 8.2 14.2"/>`), tool: { kind: 'Ring', size: 6, aromatic: true } },
	'Separator',
	{ id: 'Plus', title: 'Positive charge', icon: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M8 12h8"/>'), tool: { kind: 'Charge', sign: 1 } },
	{ id: 'Minus', title: 'Negative charge', icon: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'), tool: { kind: 'Charge', sign: -1 } },
	{ id: 'LonePair', title: 'Lone pair (click again for more)', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="8" cy="12" r="2.6" fill="currentColor"/><circle cx="16" cy="12" r="2.6" fill="currentColor"/></svg>', tool: { kind: 'LonePair' } },
	{ id: 'Radical', title: 'Radical (single electron)', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>', tool: { kind: 'Radical' } },
];

const elementButtonList = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const hotkeyElement: Readonly<Record<string, string>> = { c: 'C', h: 'H', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', i: 'I', l: 'Cl', b: 'Br' };


export const structureEditorStyle = `
.oi-draw-backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 12px; background: rgba(0, 0, 0, 0.4); }
.oi-draw { width: min(1000px, 100%); height: min(680px, 100%); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; background: var(--oi-color-background); color: var(--oi-color-text); border: 1px solid var(--oi-color-border); border-radius: 10px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3); overflow: hidden; font-family: var(--oi-font-body); font-size: 14px; }
.oi-draw-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--oi-color-border); }
.oi-draw-title { font-weight: 600; margin-inline-end: 4px; }
.oi-draw-element { display: flex; gap: 2px; flex-wrap: wrap; }
.oi-draw-space { flex: 1; }
.oi-draw button { font: inherit; color: inherit; cursor: pointer; }
.oi-draw-element button, .oi-draw-tool button, .oi-draw-small { min-width: 32px; height: 32px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; }
.oi-draw-element button:hover, .oi-draw-tool button:hover, .oi-draw-small:hover { background: var(--oi-color-surface2); }
.oi-draw button.active { background: color-mix(in srgb, var(--oi-color-accent) 16%, transparent); border-color: color-mix(in srgb, var(--oi-color-accent) 55%, transparent); color: var(--oi-color-accent); }
.oi-draw-primary { height: 32px; padding: 0 14px; border: none; border-radius: 6px; background: var(--oi-color-accent); color: var(--oi-color-background) !important; font-weight: 600; }
.oi-draw-secondary { height: 32px; padding: 0 12px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: transparent; }
.oi-draw-main { display: flex; min-height: 0; }
.oi-draw-tool { display: flex; flex-direction: column; gap: 2px; padding: 8px 6px; border-inline-end: 1px solid var(--oi-color-border); overflow-y: auto; }
.oi-draw-tool hr { width: 70%; border: none; border-top: 1px solid var(--oi-color-border); margin: 4px auto; }
.oi-draw-stage { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background-image: radial-gradient(color-mix(in srgb, var(--oi-color-text) 12%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.oi-draw-context { position: absolute; inset: 0; overflow: hidden; pointer-events: none; color: var(--oi-color-text-muted); }
.oi-draw-context-scene { position: absolute; }
.oi-draw-context .oi-chem-scene { margin: 0; }
.oi-draw-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; outline: none; }
.oi-draw-canvas text { font-family: var(--oi-font-body); fill: currentColor; stroke: none; }
.oi-draw-bottom { min-width: 0; border-top: 1px solid var(--oi-color-border); }
.oi-draw-hint { display: flex; align-items: center; gap: 8px; padding: 2px 6px 2px 12px; color: var(--oi-color-text-muted); font-size: 12.5px; }
.oi-draw-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.oi-draw-text.oi-draw-problem { color: var(--oi-color-danger); }
.oi-draw-source { display: block; box-sizing: border-box; width: 100%; height: 6.6em; min-height: 3em; max-height: 40vh; margin: 0; padding: 6px 12px; border: none; border-top: 1px solid var(--oi-color-border); border-radius: 0; resize: vertical; outline: none; background: var(--oi-color-surface1); color: inherit; font: 12.5px/1.45 var(--oi-font-code); white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.oi-draw-source[hidden] { display: none; }
@media (max-width: 640px) {
	.oi-draw { height: 100%; }
	.oi-draw-main { flex-direction: column-reverse; }
	.oi-draw-tool { flex-direction: row; overflow-x: auto; border-inline-end: none; border-top: 1px solid var(--oi-color-border); }
	.oi-draw-tool hr { width: auto; height: 70%; border-top: none; border-inline-start: 1px solid var(--oi-color-border); margin: auto 4px; }
	.oi-draw-source { height: 4.4em; }
}
`;

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function number(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

/** Opens the editor over the page; returns a function that closes it without saving. */
export function openStructureEditor(option: StructureEditorOption): () => void {
	const sceneOption = option.scene ?? {};
	/** Bond length in em: the block's em → the tool's bond lengths. */
	const unit = sceneOption.bondLength ?? defaultBondLength;
	const renderOption: RenderOption = option.render ?? { resolveColor: () => undefined, renderLabel: (content) => escapeXml(content) };
	let focus = option.focus;
	let { body, scene, graph, baseline }: BlockDrawing = loadDrawing(option.body, sceneOption, focus);
	// undo and redo hold the block's text; the graph is read again from it
	const undoList: string[] = [];
	const redoList: string[] = [];
	let tool: Tool = { kind: 'Bond', order: 1, stereo: 'None' };
	let toolId = 'Single';
	let selection = new Set<number>();
	let hover: { atom?: DrawAtom; bond?: DrawBond } = {};
	let scale = 38;
	let pan = { x: 0, y: 0 };
	let press: { screen: Point; world: Point; atom?: DrawAtom; bond?: DrawBond; moved: boolean; pointerId: number; origin?: Map<number, Point> } | undefined;
	let preview: { from: Point; to: Point } | undefined;
	let band: { from: Point; to: Point } | undefined;
	let closed = false;
	/** An edit happened; the block's text is written once the pointer is up. */
	let dirty = false;
	/** One run of typing in the text below is one undo step. */
	let typing = false;
	/** Where the pointer last was. The atom nearest to it stays put when the block is laid out again. */
	let pointer: Point | undefined;
	/** Shown in the hint until the next edit. */
	let notice = '';
	/** The scene the faded layer was drawn from. */
	let contextScene: Scene | undefined;
	/** Pointers that are down (screen), and two fingers zooming and panning. */
	const fingerMap = new Map<number, Point>();
	let pinch: { distance: number; scale: number; world: Point } | undefined;

	const backdrop = document.createElement('div');
	backdrop.className = 'oi-draw-backdrop';
	backdrop.dataset.oiKeepEditor = '';
	backdrop.innerHTML =
		'<div class="oi-draw" role="dialog" aria-modal="true" aria-label="Drawing tool">' +
		'<div class="oi-draw-top"><span class="oi-draw-title"></span>' +
		`<div class="oi-draw-element" role="toolbar" aria-label="Elements">${elementButtonList.map((element) => `<button type="button" data-element="${element}" title="${element} (hover an atom and press ${element === 'Cl' ? 'L' : element === 'Br' ? 'B' : element})">${element}</button>`).join('')}<button type="button" data-element="Other" title="Another element or a label (CO₂H, Ph…)">Other</button></div>` +
		'<span class="oi-draw-space"></span>' +
		'<button type="button" class="oi-draw-secondary" data-action="Whole" title="Edit every structure of the block together" hidden>Edit whole block</button>' +
		'<button type="button" class="oi-draw-small" data-action="Undo" title="Undo (Ctrl+Z)">↶</button><button type="button" class="oi-draw-small" data-action="Redo" title="Redo (Ctrl+Y)">↷</button>' +
		'<button type="button" class="oi-draw-small" data-action="Clear">Clear</button>' +
		'<button type="button" class="oi-draw-secondary" data-action="Cancel">Cancel</button><button type="button" class="oi-draw-primary" data-action="Done">Done</button></div>' +
		`<div class="oi-draw-main"><div class="oi-draw-tool" role="toolbar" aria-label="Tools">${toolButtonList.map((item) => (item === 'Separator' ? '<hr>' : `<button type="button" data-tool="${item.id}" title="${escapeXml(item.title)}" aria-label="${escapeXml(item.title)}">${item.icon}</button>`)).join('')}</div>` +
		'<div class="oi-draw-stage"><div class="oi-draw-context" aria-hidden="true"></div><svg class="oi-draw-canvas" tabindex="0" aria-label="Drawing area"></svg></div></div>' +
		'<div class="oi-draw-bottom"><div class="oi-draw-hint"><span class="oi-draw-text"></span>' +
		'<button type="button" class="oi-draw-small active" data-action="Source" aria-pressed="true" title="Show or hide the block\'s text">Source</button></div>' +
		'<textarea class="oi-draw-source" spellcheck="false" autocomplete="off" aria-label="The block\'s text"></textarea></div></div>';
	document.body.append(backdrop);
	const dialog = backdrop.querySelector<HTMLElement>('.oi-draw')!;
	const svg = backdrop.querySelector<SVGSVGElement>('.oi-draw-canvas')!;
	const context = backdrop.querySelector<HTMLElement>('.oi-draw-context')!;
	const hint = backdrop.querySelector<HTMLElement>('.oi-draw-text')!;
	const source = backdrop.querySelector<HTMLTextAreaElement>('.oi-draw-source')!;
	source.value = body;

	// ------------------------------------------------------------ view

	const size = (): { width: number; height: number } => {
		const rect = svg.getBoundingClientRect();
		return { width: Math.max(rect.width, 200), height: Math.max(rect.height, 200) };
	};
	const toScreen = (point: Point): Point => {
		const { width, height } = size();
		return { x: width / 2 + pan.x + point.x * scale, y: height / 2 + pan.y - point.y * scale };
	};
	const toWorld = (clientX: number, clientY: number): Point => {
		const rect = svg.getBoundingClientRect();
		const { width, height } = size();
		return { x: (clientX - rect.left - width / 2 - pan.x) / scale, y: -(clientY - rect.top - height / 2 - pan.y) / scale };
	};
	/** The structure being edited alone, or the whole block. */
	const fit = (): void => {
		let box: { minX: number; maxX: number; minY: number; maxY: number } | undefined;
		if (focus !== undefined || body.trim() === '') {
			if (graph.atomList.length > 0) {
				const xs = graph.atomList.map((atom) => atom.x);
				const ys = graph.atomList.map((atom) => atom.y);
				box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
			}
		} else box = { minX: scene.box.minX / unit, maxX: scene.box.maxX / unit, minY: scene.box.minY / unit, maxY: scene.box.maxY / unit };
		if (!box) {
			pan = { x: 0, y: 0 };
			return;
		}
		const { width, height } = size();
		scale = Math.max(12, Math.min(38, (width - 120) / Math.max(box.maxX - box.minX, 1), (height - 120) / Math.max(box.maxY - box.minY, 1)));
		pan = { x: -((box.minX + box.maxX) / 2) * scale, y: ((box.minY + box.maxY) / 2) * scale };
	};

	// ------------------------------------------------------------ drawing

	const labelMetric = (atom: DrawAtom): { pieceList: ReturnType<typeof atomPieceList>; width: number; anchor: number } => {
		const pieceList = atomPieceList(graph, atom);
		let width = 0;
		let anchor = 0;
		let found = false;
		for (const piece of pieceList) {
			const factor = piece.kind === 'Normal' ? 1 : 0.7;
			const pieceWidth = [...piece.text].reduce((sum, character) => sum + characterWidth(character) * factor, 0);
			if (!found && piece.kind === 'Normal' && piece.text !== 'H' && (piece.text === atom.element || atom.element === '')) {
				anchor = width + pieceWidth / 2;
				found = true;
			}
			width += pieceWidth;
		}
		if (!found) anchor = width / 2;
		return { pieceList, width, anchor };
	};

	/** Labels, gaps, and dots grow and shrink with the zoom, as the block's text does (1 at the starting zoom). */
	const zoom = (): number => scale / 38;

	/** How far a bond end stays from an atom's centre (px), so it stops at the label. */
	const trimOf = (atom: DrawAtom, towardX: number, towardY: number): number => {
		if (!isLabelVisible(graph, atom)) return 0;
		const font = 15 * zoom();
		const { width, anchor } = labelMetric(atom);
		const length = Math.hypot(towardX, towardY) || 1;
		const ux = towardX / length;
		const uy = towardY / length;
		const horizontal = ux > 0 ? (width - anchor) * font : anchor * font;
		return Math.min(Math.abs(ux) * horizontal + Math.abs(uy) * 9 * zoom(), 26 * zoom()) + 3 * zoom();
	};

	const bondMarkup = (bond: DrawBond): string => {
		const a = atomById(graph, bond.from);
		const b = atomById(graph, bond.to);
		if (!a || !b || bond.hidden) return '';
		const pa = toScreen(a);
		const pb = toScreen(b);
		const dx = pb.x - pa.x;
		const dy = pb.y - pa.y;
		const length = Math.hypot(dx, dy) || 1;
		const ux = dx / length;
		const uy = dy / length;
		const trimA = trimOf(a, dx, dy);
		const trimB = trimOf(b, -dx, -dy);
		const start = { x: pa.x + ux * trimA, y: pa.y + uy * trimA };
		const end = { x: pb.x - ux * trimB, y: pb.y - uy * trimB };
		const nx = -uy * zoom();
		const ny = ux * zoom();
		const line = (from: Point, to: Point, extra = ''): string => `<line x1="${number(from.x)}" y1="${number(from.y)}" x2="${number(to.x)}" y2="${number(to.y)}"${extra}/>`;
		const shift = (point: Point, distance: number): Point => ({ x: point.x + nx * distance, y: point.y + ny * distance });
		const dash = bond.dash === 'Dashed' ? ' stroke-dasharray="5 4"' : bond.dash === 'Dotted' ? ' stroke-dasharray="1 4"' : '';
		const color = bond.color ? ` style="color: ${escapeXml(bond.color)}"` : '';
		let inner = '';
		if (bond.stereo === 'Wedge') {
			const [narrow, wide] = bond.from === a.id ? [start, end] : [end, start];
			inner = `<polygon points="${number(narrow.x)},${number(narrow.y)} ${number(shift(wide, 4.5).x)},${number(shift(wide, 4.5).y)} ${number(shift(wide, -4.5).x)},${number(shift(wide, -4.5).y)}" fill="currentColor" stroke="none"/>`;
		} else if (bond.stereo === 'Hash') {
			const [narrow, wide] = bond.from === a.id ? [start, end] : [end, start];
			const count = Math.max(4, Math.round(length / (6 * zoom())));
			for (let index = 1; index <= count; index++) {
				const share = index / count;
				const point = { x: narrow.x + (wide.x - narrow.x) * share, y: narrow.y + (wide.y - narrow.y) * share };
				inner += line(shift(point, 4.5 * share), shift(point, -4.5 * share));
			}
		} else if (bond.order === 1) inner = line(start, end, dash);
		else if (bond.order === 3) inner = line(start, end) + line(shift(start, 4), shift(end, 4)) + line(shift(start, -4), shift(end, -4));
		else {
			// the second line goes inside the ring or toward the side with more neighbours
			let side = 0;
			for (const [atom, other] of [[a, b], [b, a]] as const) {
				for (const { atom: next } of neighborList(graph, atom.id)) {
					if (next.id === other.id) continue;
					const cross = (b.x - a.x) * (next.y - a.y) - (b.y - a.y) * (next.x - a.x);
					side += cross > 0 ? 1 : cross < 0 ? -1 : 0;
				}
			}
			if (side === 0) inner = line(shift(start, 2.6), shift(end, 2.6)) + line(shift(start, -2.6), shift(end, -2.6), dash);
			else {
				// screen y points down, so the world's left side is the screen's right side
				const offset = side > 0 ? -5.5 : 5.5;
				const inset = (point: Point, toward: Point): Point => ({ x: point.x + (toward.x - point.x) * 0.14, y: point.y + (toward.y - point.y) * 0.14 });
				inner = line(start, end) + line(shift(inset(start, end), offset), shift(inset(end, start), offset), dash);
			}
		}
		return `<g data-bond="${bond.id}"${color}>${inner}</g>`;
	};

	const atomMarkup = (atom: DrawAtom): string => {
		const at = toScreen(atom);
		let out = '';
		const font = 15 * zoom();
		if (isLabelVisible(graph, atom)) {
			const { pieceList, anchor } = labelMetric(atom);
			let shiftY = 0;
			const spanList = pieceList
				.map((piece) => {
					const target = (piece.kind === 'Sub' ? 4 : piece.kind === 'Sup' ? -6 : 0) * zoom();
					const dy = target - shiftY;
					shiftY = target;
					return `<tspan${dy !== 0 ? ` dy="${number(dy)}"` : ''}${piece.kind !== 'Normal' ? ` font-size="${number(font * 0.7)}"` : ''}>${escapeXml(piece.text)}</tspan>`;
				})
				.join('');
			out += `<text x="${number(at.x - anchor * font)}" y="${number(at.y + 5.3 * zoom())}" font-size="${number(font)}">${spanList}</text>`;
		}
		for (const group of electronAngleList(graph, atom)) {
			const radian = (group.angle * Math.PI) / 180;
			const ux = Math.cos(radian);
			const uy = -Math.sin(radian);
			const reach = isLabelVisible(graph, atom) ? Math.min(Math.abs(ux) * (labelMetric(atom).width * font) / 2 + Math.abs(uy) * 9 * zoom(), 20 * zoom()) + 6 * zoom() : 7 * zoom();
			const center = { x: at.x + ux * reach, y: at.y + uy * reach };
			const across = { x: -uy, y: ux };
			const dot = (offset: number): string => `<circle cx="${number(center.x + across.x * offset)}" cy="${number(center.y + across.y * offset)}" r="${number(1.9 * zoom())}" fill="currentColor" stroke="none"/>`;
			out += group.kind === 'Pair' ? dot(3.4 * zoom()) + dot(-3.4 * zoom()) : dot(0);
		}
		return out;
	};

	/** The rest of the block, faded: arrows, text, and labels (and the other structures, when one is edited alone). */
	const drawContext = (): void => {
		if (contextScene !== scene) {
			contextScene = scene;
			const shown: Scene = { ...scene, moleculeList: scene.moleculeList.filter((_, index) => focus !== undefined && index !== focus) };
			context.innerHTML = `<div class="oi-draw-context-scene">${renderScene(shown, renderOption)}</div>`;
		}
		const corner = toScreen({ x: scene.box.minX / unit, y: scene.box.maxY / unit });
		(context.firstElementChild as HTMLElement).style.cssText = `left: ${number(corner.x)}px; top: ${number(corner.y)}px; font-size: ${number(scale / unit)}px`;
	};

	const render = (): void => {
		if (dirty && !press) sync();
		const { width, height } = size();
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		const accent = 'var(--oi-color-accent)';
		let under = '';
		for (const id of selection) {
			const atom = atomById(graph, id);
			if (atom) {
				const at = toScreen(atom);
				under += `<circle cx="${number(at.x)}" cy="${number(at.y)}" r="11" fill="${accent}" opacity="0.25" stroke="none"/>`;
			}
		}
		if (hover.bond && !hover.atom) {
			const a = atomById(graph, hover.bond.from);
			const b = atomById(graph, hover.bond.to);
			if (a && b) {
				const pa = toScreen(a);
				const pb = toScreen(b);
				under += `<line x1="${number(pa.x)}" y1="${number(pa.y)}" x2="${number(pb.x)}" y2="${number(pb.y)}" stroke="${accent}" stroke-width="11" opacity="0.22"/>`;
			}
		}
		if (hover.atom) {
			const at = toScreen(hover.atom);
			under += `<circle cx="${number(at.x)}" cy="${number(at.y)}" r="11" fill="${accent}" opacity="0.2" stroke="none"/>`;
		}
		let over = '';
		if (preview) {
			const from = toScreen(preview.from);
			const to = toScreen(preview.to);
			over += `<line x1="${number(from.x)}" y1="${number(from.y)}" x2="${number(to.x)}" y2="${number(to.y)}" stroke="${accent}" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${number(to.x)}" cy="${number(to.y)}" r="4" fill="${accent}" stroke="none"/>`;
		}
		if (band) {
			const x = Math.min(band.from.x, band.to.x);
			const y = Math.min(band.from.y, band.to.y);
			over += `<rect x="${number(x)}" y="${number(y)}" width="${number(Math.abs(band.to.x - band.from.x))}" height="${number(Math.abs(band.to.y - band.from.y))}" fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-dasharray="4 3"/>`;
		}
		const emptyText = focus === undefined ? 'Click anywhere to start: a bond, or pick a ring on the left.' : 'Erased. Draw it again, or Done takes it out of the block.';
		const empty = graph.atomList.length === 0 ? `<text x="${width / 2}" y="${body.trim() === '' ? height / 2 : 28}" text-anchor="middle" font-size="14" opacity="0.55">${emptyText}</text>` : '';
		svg.innerHTML = `<g>${under}</g><g stroke="currentColor" stroke-width="${number(1.7 * Math.min(1, Math.max(zoom(), 0.5)))}" stroke-linecap="round">${graph.bondList.map(bondMarkup).join('')}</g><g>${graph.atomList.map(atomMarkup).join('')}</g><g>${over}</g>${empty}`;
		drawContext();
		if (source.value !== body && document.activeElement !== source) source.value = body;
		const problem = scene.problemList[0];
		hint.textContent =
			notice ||
			(problem
				? `Problem: ${problem.message}`
				: focus !== undefined
					? 'Only this structure changes; the rest of the block is faded. Enter or Done puts it into the note.'
					: 'A structure drawn apart from the others becomes a \\chemfig of its own. Arrows, text, and labels are edited in the source.');
		hint.title = hint.textContent;
		hint.classList.toggle('oi-draw-problem', notice === '' && problem !== undefined);
		dialog.querySelector('.oi-draw-title')!.textContent = focus === undefined ? 'Drawing' : 'One structure';
		dialog.querySelector<HTMLButtonElement>('[data-action="Whole"]')!.hidden = focus === undefined;
		dialog.querySelector<HTMLButtonElement>('[data-action="Clear"]')!.title = focus === undefined ? 'Erase every structure' : 'Erase this structure';
		for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('active', button.dataset.tool === toolId);
		for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-element]')) button.classList.toggle('active', tool.kind === 'Atom' && button.dataset.element === tool.element);
		dialog.querySelector<HTMLButtonElement>('[data-action="Undo"]')!.disabled = undoList.length === 0;
		dialog.querySelector<HTMLButtonElement>('[data-action="Redo"]')!.disabled = redoList.length === 0;
	};

	// ------------------------------------------------------------ editing

	/** Marks the drawing as changed; call it before changing the graph. */
	const edit = (): void => {
		dirty = true;
		typing = false;
		notice = '';
	};

	const remember = (text: string): void => {
		undoList.push(text);
		if (undoList.length > 200) undoList.shift();
		redoList.length = 0;
	};

	/** Writes the block's text after an edit and lays the block out again. */
	const sync = (): void => {
		dirty = false;
		const before = body;
		const beforeGraph = graph;
		const anchor = pointer ? nearestAtom(graph, pointer, Infinity) : undefined;
		const anchorAt = anchor ? { x: anchor.x, y: anchor.y } : undefined;
		({ body, scene, graph, baseline } = syncDrawing({ body, scene, graph, baseline }, sceneOption, focus));
		if (body !== before) remember(before);
		if (graph !== beforeGraph) {
			selection = new Set();
			hover = {};
			return;
		}
		selection = new Set([...selection].filter((id) => atomById(graph, id)));
		// the structure under the pointer stays in place; the rest of the block moves around it
		if (anchor && anchorAt) pan = { x: pan.x - (anchor.x - anchorAt.x) * scale, y: pan.y + (anchor.y - anchorAt.y) * scale };
	};

	/** Reads the graph again from the block's text. */
	const read = (text: string): void => {
		({ body, scene, graph, baseline } = loadDrawing(text, sceneOption, focus));
		selection = new Set();
		hover = {};
		dirty = false;
		typing = false;
		notice = '';
	};

	const step = (from: Point, degree: number, length = 1): Point => ({ x: from.x + Math.cos((degree * Math.PI) / 180) * length, y: from.y + Math.sin((degree * Math.PI) / 180) * length });

	/** Adds a bond from an atom to a new atom (or to an atom already at that spot). */
	const grow = (from: DrawAtom, to: Point, element = 'C'): void => {
		const existing = nearestAtom(graph, to, 0.3, from.id);
		const target = existing ?? addAtom(graph, to.x, to.y, element, element === 'C' ? {} : { showLabel: true });
		if (existing && bondBetween(graph, from.id, existing.id)) return;
		const order = tool.kind === 'Bond' ? tool.order : 1;
		const stereo = tool.kind === 'Bond' ? tool.stereo : 'None';
		addBond(graph, from.id, target.id, order, { stereo });
	};

	const changeBond = (bond: DrawBond): void => {
		if (tool.kind !== 'Bond') return;
		if (tool.stereo !== 'None') {
			if (bond.stereo === tool.stereo) [bond.from, bond.to] = [bond.to, bond.from];
			else {
				bond.stereo = tool.stereo;
				bond.order = 1;
			}
			return;
		}
		bond.stereo = 'None';
		if (tool.order === 1) bond.order = bond.order === 3 ? 1 : ((bond.order + 1) as 2 | 3);
		else bond.order = bond.order === tool.order ? 1 : tool.order;
	};

	const setElement = (atom: DrawAtom, element: string): void => {
		atom.element = element;
		delete atom.label;
		atom.showLabel = element !== 'C';
	};

	const clickAt = (world: Point, atom: DrawAtom | undefined, bond: DrawBond | undefined): void => {
		switch (tool.kind) {
			case 'Select':
				selection = atom ? new Set([atom.id]) : new Set();
				return;
			case 'Erase':
				if (atom) {
					edit();
					removeAtom(graph, atom.id);
				} else if (bond) {
					edit();
					removeBond(graph, bond.id);
				}
				return;
			case 'Bond':
				edit();
				if (atom) grow(atom, step(atom, freeAngle(graph, atom)));
				else if (bond) changeBond(bond);
				else {
					const first = addAtom(graph, world.x, world.y);
					grow(first, step(first, 30));
				}
				return;
			case 'Atom':
				edit();
				if (atom) setElement(atom, tool.element);
				else if (!bond) addAtom(graph, world.x, world.y, tool.element, { showLabel: tool.element !== 'C' });
				return;
			case 'Ring':
				edit();
				addRing(graph, tool.size, tool.aromatic, atom ? { kind: 'Atom', id: atom.id } : bond ? { kind: 'Bond', id: bond.id } : { kind: 'Point', point: world });
				return;
			case 'Charge':
				if (!atom) return;
				edit();
				atom.charge = Math.max(-3, Math.min(3, atom.charge + tool.sign));
				return;
			case 'LonePair':
				if (!atom) return;
				edit();
				atom.lonePair = (atom.lonePair + 1) % 4;
				return;
			case 'Radical':
				if (!atom) return;
				edit();
				atom.radical = !atom.radical;
				return;
		}
	};

	const removeSelection = (): boolean => {
		if (selection.size === 0) return false;
		edit();
		for (const id of selection) removeAtom(graph, id);
		selection = new Set();
		return true;
	};

	const history = (kind: 'Undo' | 'Redo'): void => {
		const from = kind === 'Undo' ? undoList : redoList;
		const to = kind === 'Undo' ? redoList : undoList;
		const previous = from.pop();
		if (previous === undefined) return;
		to.push(body);
		read(previous);
		render();
	};

	// ------------------------------------------------------------ pointer

	const hitTest = (world: Point): { atom?: DrawAtom; bond?: DrawBond } => {
		const atom = nearestAtom(graph, world, 12 / scale);
		if (atom) return { atom };
		const bond = nearestBond(graph, world, 8 / scale);
		return bond ? { bond } : {};
	};

	/** The two fingers' distance and middle (screen). */
	const fingerPair = (): { distance: number; center: Point } => {
		const [a, b] = [...fingerMap.values()] as [Point, Point];
		return { distance: Math.hypot(b.x - a.x, b.y - a.y) || 1, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
	};

	svg.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) return;
		svg.focus({ preventScroll: true });
		fingerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
		svg.setPointerCapture(event.pointerId);
		event.preventDefault();
		if (fingerMap.size === 2) {
			// a second finger: zoom and pan instead of drawing
			const { distance, center } = fingerPair();
			pinch = { distance, scale, world: toWorld(center.x, center.y) };
			press = undefined;
			preview = undefined;
			band = undefined;
			render();
		}
		if (pinch) return;
		const world = toWorld(event.clientX, event.clientY);
		pointer = world;
		const hit = hitTest(world);
		press = { screen: { x: event.clientX, y: event.clientY }, world, ...hit, moved: false, pointerId: event.pointerId };
		if (tool.kind === 'Select' && hit.atom) {
			if (!selection.has(hit.atom.id)) selection = event.shiftKey ? new Set([...selection, hit.atom.id]) : new Set([hit.atom.id]);
			press.origin = new Map([...selection].map((id) => [id, { x: atomById(graph, id)!.x, y: atomById(graph, id)!.y }]));
		}
	});

	svg.addEventListener('pointermove', (event) => {
		if (fingerMap.has(event.pointerId)) fingerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pinch) {
			if (fingerMap.size < 2) return;
			// the point first between the fingers stays between them
			const { distance, center } = fingerPair();
			const rect = svg.getBoundingClientRect();
			const { width, height } = size();
			scale = Math.max(12, Math.min(90, (pinch.scale * distance) / pinch.distance));
			pan = { x: center.x - rect.left - width / 2 - pinch.world.x * scale, y: center.y - rect.top - height / 2 + pinch.world.y * scale };
			render();
			return;
		}
		const world = toWorld(event.clientX, event.clientY);
		pointer = world;
		if (!press) {
			const hit = hitTest(world);
			if (hit.atom !== hover.atom || hit.bond !== hover.bond) {
				hover = hit;
				render();
			}
			return;
		}
		if (!press.moved && Math.hypot(event.clientX - press.screen.x, event.clientY - press.screen.y) < 6) return;
		if (!press.moved) {
			press.moved = true;
			if (tool.kind === 'Select' && press.origin) edit();
		}
		if (tool.kind === 'Select') {
			if (press.origin) {
				for (const [id, origin] of press.origin) {
					const atom = atomById(graph, id);
					if (atom) {
						atom.x = origin.x + world.x - press.world.x;
						atom.y = origin.y + world.y - press.world.y;
					}
				}
			} else band = { from: toScreen(press.world), to: toScreen(world) };
			render();
			return;
		}
		if (tool.kind === 'Bond' || tool.kind === 'Atom') {
			// a bond from the pressed atom (or from where the drag began), in 30° steps
			const from: Point = press.atom ?? press.world;
			const target = nearestAtom(graph, world, 12 / scale, press.atom?.id);
			const degree = snapDegree((Math.atan2(world.y - from.y, world.x - from.x) * 180) / Math.PI);
			preview = { from, to: target ?? step(from, degree) };
			hover = target ? { atom: target } : {};
			render();
		}
	});

	const finish = (event: PointerEvent): void => {
		fingerMap.delete(event.pointerId);
		if (pinch) {
			// drawing waits until every finger is up
			if (fingerMap.size === 0) pinch = undefined;
			return;
		}
		if (!press) return;
		const current = press;
		press = undefined;
		svg.releasePointerCapture?.(current.pointerId);
		if (event.type === 'pointercancel') {
			preview = undefined;
			band = undefined;
			render();
			return;
		}
		if (!current.moved) clickAt(current.world, current.atom, current.bond);
		else if (tool.kind === 'Select' && band) {
			const from = { x: Math.min(band.from.x, band.to.x), y: Math.min(band.from.y, band.to.y) };
			const to = { x: Math.max(band.from.x, band.to.x), y: Math.max(band.from.y, band.to.y) };
			selection = new Set(
				graph.atomList
					.filter((atom) => {
						const at = toScreen(atom);
						return at.x >= from.x && at.x <= to.x && at.y >= from.y && at.y <= to.y;
					})
					.map((atom) => atom.id),
			);
		} else if (tool.kind === 'Select' && current.origin) {
			// a whole structure goes back: the block's rows place it
			const movedSet = new Set(current.origin.keys());
			const partSet = new Set([...movedSet].map((id) => atomById(graph, id)?.part));
			if ([...partSet].some((part) => graph.atomList.every((atom) => atom.part !== part || movedSet.has(atom.id)))) {
				pointer = undefined;
				notice = 'A structure sits where the block’s text puts it, so it went back. Drag some of its atoms to reshape it, or move its \\chemfig in the source.';
			}
		} else if ((tool.kind === 'Bond' || tool.kind === 'Atom') && preview) {
			edit();
			const element = tool.kind === 'Atom' ? tool.element : 'C';
			const start = current.atom ?? nearestAtom(graph, current.world, 12 / scale) ?? addAtom(graph, current.world.x, current.world.y);
			grow(start, preview.to, element);
		}
		preview = undefined;
		band = undefined;
		render();
	};
	svg.addEventListener('pointerup', finish);
	svg.addEventListener('pointercancel', finish);
	svg.addEventListener('pointerleave', () => {
		if (!press && (hover.atom || hover.bond)) {
			hover = {};
			render();
		}
	});
	svg.addEventListener('dblclick', (event) => {
		const world = toWorld(event.clientX, event.clientY);
		const atom = nearestAtom(graph, world, 12 / scale);
		if (!atom) return;
		const text = window.prompt('Atom label: an element (N, Cl…) or any text (CO_2H, Ph, R)', atom.label ?? atom.element);
		if (text === null || text.trim() === '') return;
		edit();
		const clean = text.trim();
		if (/^[A-Z][a-z]?$/.test(clean)) setElement(atom, clean);
		else {
			atom.element = '';
			atom.label = clean;
			atom.showLabel = true;
		}
		render();
	});
	svg.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				pan = { x: pan.x - (event.shiftKey ? event.deltaY : event.deltaX), y: pan.y - (event.shiftKey ? 0 : event.deltaY) };
			} else {
				const before = toWorld(event.clientX, event.clientY);
				scale = Math.max(12, Math.min(90, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
				const after = toWorld(event.clientX, event.clientY);
				pan = { x: pan.x + (after.x - before.x) * scale, y: pan.y - (after.y - before.y) * scale };
			}
			render();
		},
		{ passive: false },
	);

	// ------------------------------------------------------------ the block's text

	source.addEventListener('input', () => {
		if (!typing) remember(body);
		// the text can add, remove, and reorder structures, so typing edits the whole block
		if (focus !== undefined) {
			focus = undefined;
			contextScene = undefined;
		}
		read(source.value);
		typing = true;
		render();
	});
	source.addEventListener('blur', () => {
		typing = false;
	});

	// ------------------------------------------------------------ toolbar and keys

	const choose = (id: string, next: Tool): void => {
		toolId = id;
		tool = next;
		if (next.kind !== 'Select') selection = new Set();
		render();
	};
	for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
		button.addEventListener('click', () => {
			const item = toolButtonList.find((entry) => entry !== 'Separator' && entry.id === button.dataset.tool) as ToolButton | undefined;
			if (item) choose(item.id, item.tool);
		});
	}
	for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-element]')) {
		button.addEventListener('click', () => {
			let element = button.dataset.element!;
			if (element === 'Other') {
				const text = window.prompt('Element symbol (e.g. Si, Mg, Na)', '');
				if (!text || !/^[A-Z][a-z]?$/.test(text.trim())) return;
				element = text.trim();
			}
			choose(`Element:${element}`, { kind: 'Atom', element });
		});
	}

	const close = (save: boolean): void => {
		if (closed) return;
		if (save && dirty) sync();
		closed = true;
		document.removeEventListener('keydown', onKey, true);
		resizeObserver?.disconnect();
		backdrop.remove();
		if (save) option.onDone(finishDrawing({ body, scene, graph, baseline }, focus));
		option.onClose?.();
	};

	dialog.querySelector('[data-action="Undo"]')!.addEventListener('click', () => history('Undo'));
	dialog.querySelector('[data-action="Redo"]')!.addEventListener('click', () => history('Redo'));
	dialog.querySelector('[data-action="Clear"]')!.addEventListener('click', () => {
		if (graph.atomList.length === 0) return;
		edit();
		pointer = undefined;
		graph.atomList = [];
		graph.bondList = [];
		selection = new Set();
		render();
	});
	dialog.querySelector('[data-action="Whole"]')!.addEventListener('click', () => {
		if (dirty) sync();
		const text = finishDrawing({ body, scene, graph, baseline }, focus);
		if (text !== body) remember(body);
		focus = undefined;
		contextScene = undefined;
		read(text);
		render();
	});
	const sourceButton = dialog.querySelector<HTMLButtonElement>('[data-action="Source"]')!;
	sourceButton.addEventListener('click', () => {
		source.hidden = !source.hidden;
		sourceButton.classList.toggle('active', !source.hidden);
		sourceButton.setAttribute('aria-pressed', String(!source.hidden));
	});
	dialog.querySelector('[data-action="Cancel"]')!.addEventListener('click', () => close(false));
	dialog.querySelector('[data-action="Done"]')!.addEventListener('click', () => close(true));
	backdrop.addEventListener('pointerdown', (event) => {
		if (event.target === backdrop && !dirty && body === option.body) close(false);
	});

	const onKey = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement;
		const primary = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? event.metaKey : event.ctrlKey;
		if (target === source) {
			// typing stays in the text; Esc goes back to the drawing, Ctrl+Enter is Done
			if (event.key === 'Escape') svg.focus({ preventScroll: true });
			else if (event.key === 'Enter' && primary) close(true);
			else return;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
		let used = true;
		if (event.key === 'Escape') close(false);
		else if (event.key === 'Enter') close(true);
		else if (primary && event.code === 'KeyZ') history(event.shiftKey ? 'Redo' : 'Undo');
		else if (primary && event.code === 'KeyY') history('Redo');
		else if (event.key === 'Delete' || event.key === 'Backspace') {
			if (!removeSelection()) {
				if (hover.atom) {
					edit();
					removeAtom(graph, hover.atom.id);
				} else if (hover.bond) {
					edit();
					removeBond(graph, hover.bond.id);
				} else used = false;
				hover = {};
			}
		} else if (!primary && !event.altKey && hover.atom && hotkeyElement[event.key.toLowerCase()]) {
			edit();
			setElement(hover.atom, hotkeyElement[event.key.toLowerCase()]!);
		} else if (!primary && hover.atom && (event.key === '+' || event.key === '-')) {
			edit();
			hover.atom.charge = Math.max(-3, Math.min(3, hover.atom.charge + (event.key === '+' ? 1 : -1)));
		} else if (!primary && hover.bond && /^[123]$/.test(event.key)) {
			edit();
			hover.bond.order = Number(event.key) as 1 | 2 | 3;
			hover.bond.stereo = 'None';
		} else used = false;
		if (used) {
			event.preventDefault();
			event.stopPropagation();
			if (!closed) render();
		}
	};
	document.addEventListener('keydown', onKey, true);

	const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => render()) : undefined;
	resizeObserver?.observe(svg);
	fit();
	render();
	svg.focus({ preventScroll: true });
	return () => close(false);
}
