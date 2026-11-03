// The drawing tool: draw molecules as in ALEKS or ChemDraw. It edits one Chem block (one structure),
// or a whole Board, where every block can be picked up and moved: structures, arrows, and text.
//
//   tools   select and move, erase, single / double / triple bond, wedge, hash, rings (3–6 and
//           benzene), charge + and −, lone pair, radical, and any element; on a Board also Arrow and Text
//   mouse   click an atom to grow a bond where there is room, drag for any direction (30° steps),
//           click a bond to change it, click empty space to start; wheel zooms, Shift+wheel pans;
//           two fingers zoom and pan
//   select  click an atom to move it, a bond to pick up its whole structure, an arrow or text to move it;
//           drag a box around a chunk; an arrow's ends and middle have handles; double-click text to edit;
//           an arrow's text slides along it or to its other side, and leaves it when dropped far away
//           (free text dropped on an arrow joins it)
//   keys    hover an atom and press C N O S P F H I, L (Cl), B (Br), + or −; 1 2 3 on a bond;
//           elsewhere a key picks a tool (V select, E erase, 1 2 3 bonds, W wedge, R benzene, D lone
//           pair, A curved arrow, T text, G color…; yours in Setting → Hotkey, the Drawing commands);
//           Ctrl+Z / Ctrl+Y, Delete, Esc; Enter (Ctrl+Enter in the text) or Done puts it into the note

import type { PropertyMap, PropertyValue } from '@octaether/core-format';
import { type BoardItem, type ColorPicker, type HotkeyLookup, normalizeHex } from '@octaether/core-sdk';
import { type ArrowCurve, type ArrowKind, arrowCurve, arrowLabelPlace, arrowMarkup, autoCurve, bezierPoint, curveForOffset, nearestOnArrow, readAt, readHead, readKind, sampleCurve } from '@octaether/module-board';
import { type BoardBlock, type BoardDrawing, type StructureDrawing, boardScale, cloneBoard, loadBoard, loadStructure, numberOf, readBoardText, syncBoard, syncStructure, writeBoard } from './drawing';
import { characterWidth } from './formula';
import { type SceneOption } from './scene';
import {
	type BondStereo,
	type DrawAtom,
	type DrawBond,
	type DrawGraph,
	type Point,
	addAtom,
	addBond,
	addRing,
	atomById,
	atomPieceList,
	bondBetween,
	electronAngleList,
	electronRoom,
	freeAngle,
	isLabelVisible,
	nearestAtom,
	nearestBond,
	neighborList,
	removeAtom,
	removeBond,
	snapDegree,
} from './structure';

type Tool =
	| { kind: 'Select' }
	| { kind: 'Erase' }
	| { kind: 'Bond'; order: 1 | 2 | 3; stereo: BondStereo }
	| { kind: 'Atom'; element: string }
	| { kind: 'Ring'; size: number; aromatic: boolean }
	| { kind: 'Charge'; sign: 1 | -1 }
	| { kind: 'LonePair' }
	| { kind: 'Radical' }
	/** Curved: from an atom, a lone pair, or a bond to another (it bends, and its middle bends it more); Straight: a reaction arrow. */
	| { kind: 'Arrow'; shape: 'Curved' | 'Straight'; arrowKind: ArrowKind }
	| { kind: 'Text' }
	/** A theme color or a hex code for atoms, bonds, arrows, and text; '' takes the color away. */
	| { kind: 'Color'; color: string };

export interface StructureEditorOption {
	/** A Chem block's text: the tool edits that one structure. */
	body?: string;
	/**
	 * A Board's blocks (and its own properties): the tool edits all of them. `notice` is shown first;
	 * `changed` says the Board is new (a chemfig block turned into one), so Done writes it even untouched.
	 */
	board?: { property: PropertyMap; itemList: BoardItem[]; notice?: string; changed?: boolean };
	/** 1em in px where the block is drawn, so a Board's blocks keep their size. */
	emPx?: number;
	/** How Chem blocks are laid out (bond length). */
	scene?: SceneOption;
	/** HTML for a block on the Board (Text, Math, a formula) as the note draws it; undefined shows its text. */
	renderBlock?(type: string, body: string, property: PropertyMap): string | undefined;
	/** Theme token or color → a safe CSS color (an arrow's Color). */
	resolveColor?(value: string): string | undefined;
	/** The Palette plugin's color picker, when it is on; without it there is no Color tool. */
	colorPicker?: ColorPicker;
	/** On a Board: the chemistry tools (true when the Board holds Chem blocks); a plain Board has arrows and text. */
	chemistry?: boolean;
	/** Your keys for the tools (the app's hotkeys, `Drawing` context); without it the default keys work. */
	hotkey?: HotkeyLookup;
	/** Called with the Chem block's new text, or the Board's new OI text. */
	onDone(text: string): void;
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
	/** The title on a Board without chemistry (no atoms or bonds to talk about). */
	plainTitle?: string;
	icon: string;
	tool: Tool;
	/** Only with the chemistry tools (fishhook, equilibrium, retrosynthesis arrows). */
	chemistry?: boolean;
}

/** Tools that share a place on the bar, like Photoshop's: the last one picked shows, the others open beside it. */
interface ToolGroup {
	id: string;
	title: string;
	memberList: readonly ToolButton[];
	/** Only on a Board. */
	board?: boolean;
	/** Only with the chemistry tools: a Board without Chem blocks has none. */
	chemistry?: boolean;
}

/**
 * The drawing tool's commands (`Drawing.<tool>`): a key picks a tool while the tool is open. They are
 * listed, and changed, in Setting → Hotkey; their context is `Drawing`, so they never act in the note.
 * Keys that act on what the pointer is over come first (an element letter on an atom, 1–3 on a bond).
 */
export const drawingCommandList: readonly { tool: string; title: string; key: readonly string[] }[] = [
	{ tool: 'Select', title: 'select and move', key: ['V'] },
	{ tool: 'Erase', title: 'erase', key: ['E'] },
	{ tool: 'Single', title: 'single bond', key: ['1'] },
	{ tool: 'Double', title: 'double bond', key: ['2'] },
	{ tool: 'Triple', title: 'triple bond', key: ['3'] },
	{ tool: 'Wedge', title: 'wedge bond', key: ['W'] },
	{ tool: 'Hash', title: 'hashed wedge bond', key: ['Shift+W'] },
	{ tool: 'Benzene', title: 'benzene ring', key: ['R'] },
	{ tool: 'Ring6', title: 'cyclohexane', key: ['6'] },
	{ tool: 'Ring5', title: 'cyclopentane', key: ['5'] },
	{ tool: 'Ring4', title: 'cyclobutane', key: ['4'] },
	{ tool: 'Ring3', title: 'cyclopropane', key: [] },
	{ tool: 'LonePair', title: 'lone pair', key: ['D'] },
	{ tool: 'Radical', title: 'radical', key: ['Shift+D'] },
	{ tool: 'Plus', title: 'positive charge', key: ['Plus', 'Shift+Plus'] },
	{ tool: 'Minus', title: 'negative charge', key: ['-'] },
	{ tool: 'Curved', title: 'curved arrow', key: ['A'] },
	{ tool: 'Fishhook', title: 'fishhook arrow', key: ['Shift+A'] },
	{ tool: 'Reaction', title: 'straight (reaction) arrow', key: ['Y'] },
	{ tool: 'Equilibrium', title: 'equilibrium arrow', key: ['Shift+Y'] },
	{ tool: 'Retro', title: 'retrosynthesis arrow', key: [] },
	{ tool: 'Text', title: 'text', key: ['T'] },
	{ tool: 'Color', title: 'color', key: ['G'] },
];

/** The open drawing tool picks a tool (a Drawing command run from a macro or the hotkey list). */
let activeChoose: ((tool: string) => void) | undefined;
export function chooseDrawingTool(tool: string): void {
	activeChoose?.(tool);
}

/** A keydown as a key name like the defaults above (`V`, `Shift+W`, `1`, `+`), when no app gives its own lookup. */
function defaultChord(event: KeyboardEvent): string {
	const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key.length === 1 ? event.key.toUpperCase() : event.key;
	return `${event.shiftKey && key !== '+' ? 'Shift+' : ''}${key}`;
}
const defaultKeyText = (key: string): string => key.replace(/\bPlus\b/, '+').replace(/^Shift\+\+$/, '+');

const elementButtonList = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];
const hotkeyElement: Readonly<Record<string, string>> = { c: 'C', h: 'H', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', i: 'I', l: 'Cl', b: 'Br' };

/** Color, before one is picked: a wheel of hues. */
const otherColorIcon =
	'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 4.5a7.5 7.5 0 0 1 6.5 3.75L12 12Z" fill="#e0311f"/><path d="M18.5 8.25a7.5 7.5 0 0 1 0 7.5L12 12Z" fill="#e8b400"/><path d="M18.5 15.75a7.5 7.5 0 0 1-6.5 3.75V12Z" fill="#2e9e44"/><path d="M12 19.5a7.5 7.5 0 0 1-6.5-3.75L12 12Z" fill="#00897b"/><path d="M5.5 15.75a7.5 7.5 0 0 1 0-7.5L12 12Z" fill="#2f5fd0"/><path d="M5.5 8.25A7.5 7.5 0 0 1 12 4.5V12Z" fill="#c2185b"/></svg>';

const swatch = (color: string): string => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="${color}" stroke="currentColor" stroke-opacity="0.25"/></svg>`;

const toolGroupList: readonly (ToolGroup | 'Separator')[] = [
	{ id: 'Select', title: 'Select', memberList: [{ id: 'Select', title: 'Select and move: click an atom, a bond (its whole structure), an arrow, or text; drag a box around a chunk; click empty space to let go', icon: svgIcon('<path d="m4 4 7 16 2.5-6.5L20 11Z"/>'), plainTitle: 'Select and move: click an arrow or text, drag a box around a chunk; click empty space to let go', tool: { kind: 'Select' } }] },
	{ id: 'Erase', title: 'Erase', memberList: [{ id: 'Erase', title: 'Erase an atom, a bond, an arrow, or text', plainTitle: 'Erase an arrow or text', icon: svgIcon('<path d="m7 21-4-4a2 2 0 0 1 0-3L13 4a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9Z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'), tool: { kind: 'Erase' } }] },
	'Separator',
	{
		id: 'Arrow',
		title: 'Arrows',
		board: true,
		memberList: [
			{ id: 'Curved', title: 'Curved arrow: drag from a lone pair, an atom, or a bond to another (drag its middle later to bend it)', plainTitle: 'Curved arrow: drag from one thing to another (drag its middle later to bend it)', icon: svgIcon('<path d="M4 18C7 8 14 6 19 9"/><path d="m19 9-4.6-1.6M19 9l-2.6 4"/>'), tool: { kind: 'Arrow', shape: 'Curved', arrowKind: 'Single' } },
			{ id: 'Fishhook', title: 'Fishhook arrow: one electron', chemistry: true, icon: svgIcon('<path d="M4 18C7 8 14 6 19 9"/><path d="m19 9-4.6-1.6"/>'), tool: { kind: 'Arrow', shape: 'Curved', arrowKind: 'Fishhook' } },
			{ id: 'Reaction', title: 'Reaction arrow: drag from where it starts to where it ends', plainTitle: 'Straight arrow: drag from where it starts to where it ends', icon: svgIcon('<path d="M3 12h17"/><path d="m15 7 5 5-5 5"/>'), tool: { kind: 'Arrow', shape: 'Straight', arrowKind: 'Single' } },
			{ id: 'Equilibrium', title: 'Equilibrium arrow', chemistry: true, icon: svgIcon('<path d="M3 9.5h17l-4-3.5"/><path d="M21 14.5H4l4 3.5"/>'), tool: { kind: 'Arrow', shape: 'Straight', arrowKind: 'Equilibrium' } },
			{ id: 'Retro', title: 'Retrosynthesis arrow', chemistry: true, icon: svgIcon('<path d="M3 10h14"/><path d="M3 14h14"/><path d="m15 6 6 6-6 6"/>'), tool: { kind: 'Arrow', shape: 'Straight', arrowKind: 'Retro' } },
		],
	},
	{ id: 'Text', title: 'Text', board: true, memberList: [{ id: 'Text', title: 'Text: click to write; double-click any text to change it', icon: svgIcon('<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>'), tool: { kind: 'Text' } }] },
	'Separator',
	{
		id: 'Bond',
		chemistry: true,
		title: 'Bonds',
		memberList: [
			{ id: 'Single', title: 'Single bond: click a bond to raise it (single, double, triple), right-click to lower it', icon: svgIcon('<path d="M5 19 19 5"/>'), tool: { kind: 'Bond', order: 1, stereo: 'None' } },
			{ id: 'Double', title: 'Double bond', icon: svgIcon('<path d="M3.5 16.5 16.5 3.5"/><path d="M7.5 20.5 20.5 7.5"/>'), tool: { kind: 'Bond', order: 2, stereo: 'None' } },
			{ id: 'Triple', title: 'Triple bond', icon: svgIcon('<path d="M2.5 14.5 14.5 2.5"/><path d="M5.5 18.5 18.5 5.5"/><path d="M9.5 21.5 21.5 9.5"/>'), tool: { kind: 'Bond', order: 3, stereo: 'None' } },
			{ id: 'Wedge', title: 'Wedge: toward you (click again to flip)', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><polygon points="4,20 17,4.5 20.5,8" fill="currentColor"/></svg>', tool: { kind: 'Bond', order: 1, stereo: 'Wedge' } },
			{ id: 'Hash', title: 'Hashed wedge: away from you (click again to flip)', icon: svgIcon('<path d="M5 18.6 5.8 19.4"/><path d="M8 15.2 10 17.2"/><path d="M11 11.8 14.2 15"/><path d="M14 8.4 18.4 12.8"/><path d="M17 5 22.6 10.6"/>'), tool: { kind: 'Bond', order: 1, stereo: 'Hash' } },
		],
	},
	{
		id: 'Ring',
		chemistry: true,
		title: 'Rings',
		memberList: [
			{ id: 'Benzene', title: 'Benzene (click a bond to fuse rings)', icon: svgIcon(`${polygonPath(6)}<path d="M8.2 9.8 12 7.6"/><path d="M15.8 9.8v4.4"/><path d="M12 16.4 8.2 14.2"/>`), tool: { kind: 'Ring', size: 6, aromatic: true } },
			{ id: 'Ring6', title: 'Cyclohexane', icon: svgIcon(polygonPath(6)), tool: { kind: 'Ring', size: 6, aromatic: false } },
			{ id: 'Ring5', title: 'Cyclopentane', icon: svgIcon(polygonPath(5)), tool: { kind: 'Ring', size: 5, aromatic: false } },
			{ id: 'Ring4', title: 'Cyclobutane', icon: svgIcon(polygonPath(4)), tool: { kind: 'Ring', size: 4, aromatic: false } },
			{ id: 'Ring3', title: 'Cyclopropane', icon: svgIcon(polygonPath(3)), tool: { kind: 'Ring', size: 3, aromatic: false } },
		],
	},
	{
		id: 'Electron',
		chemistry: true,
		title: 'Electrons and charges',
		memberList: [
			{ id: 'LonePair', title: 'Lone pair: click an atom to add one, right-click to take one away', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="8" cy="12" r="2.6" fill="currentColor"/><circle cx="16" cy="12" r="2.6" fill="currentColor"/></svg>', tool: { kind: 'LonePair' } },
			{ id: 'Radical', title: 'Radical (one electron): click to add, right-click to take away', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg>', tool: { kind: 'Radical' } },
			{ id: 'Plus', title: 'Positive charge: click to add +1, right-click for −1', icon: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/><path d="M8 12h8"/>'), tool: { kind: 'Charge', sign: 1 } },
			{ id: 'Minus', title: 'Negative charge: click to add −1, right-click for +1', icon: svgIcon('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'), tool: { kind: 'Charge', sign: -1 } },
		],
	},
	{
		// the elements of the top bar, as a group where the top bar has no room (phones)
		id: 'Element',
		chemistry: true,
		title: 'Elements',
		memberList: elementButtonList.map((element) => ({
			id: `Element:${element}`,
			title: `${element}: click an atom to make it ${element}, or empty space for a new one; right-click turns it back to carbon`,
			icon: `<span class="oi-draw-symbol" aria-hidden="true">${element}</span>`,
			tool: { kind: 'Atom', element },
		})),
	},
	{
		id: 'Color',
		title: 'Color',
		// one button: it opens the Palette plugin's menu, then the tool paints with what was picked
		memberList: [{ id: 'Color', title: 'Color: pick one, then click an atom, a bond, an arrow, or text; right-click takes the color away', icon: otherColorIcon, tool: { kind: 'Color', color: '' } }],
	},
];


export const structureEditorStyle = `
.oi-draw-backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 12px; background: rgba(0, 0, 0, 0.4); }
.oi-draw { width: min(1100px, 100%); height: min(720px, 100%); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; background: var(--oi-color-background); color: var(--oi-color-text); border: 1px solid var(--oi-color-border); border-radius: 10px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3); overflow: hidden; font-family: var(--oi-font-body); font-size: 14px; }
.oi-draw-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--oi-color-border); }
.oi-draw-title { font-weight: 600; margin-inline-end: 4px; }
.oi-draw-element { display: flex; gap: 2px; flex-wrap: wrap; }
.oi-draw-space { flex: 1; }
.oi-draw button, .oi-draw select { font: inherit; color: inherit; cursor: pointer; }
.oi-draw-element button, .oi-draw-tool button, .oi-draw-small { min-width: 32px; height: 32px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; }
.oi-draw-element button:hover, .oi-draw-tool button:hover, .oi-draw-small:hover { background: var(--oi-color-surface2); }
.oi-draw button.active { background: color-mix(in srgb, var(--oi-color-accent) 16%, transparent); border-color: color-mix(in srgb, var(--oi-color-accent) 55%, transparent); color: var(--oi-color-accent); }
.oi-draw-primary { height: 32px; padding: 0 14px; border: none; border-radius: 6px; background: var(--oi-color-accent); color: var(--oi-color-background) !important; font-weight: 600; }
.oi-draw-secondary { height: 32px; padding: 0 12px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: transparent; }
.oi-draw-main { position: relative; display: flex; min-height: 0; }
.oi-draw-group { position: relative; }
.oi-draw-symbol { display: inline-block; min-width: 20px; font: 600 15px/1 var(--oi-font-body); text-align: center; }
.oi-draw-group[data-group="Element"] { display: none; }
.oi-draw-element[hidden] { display: none !important; }
.oi-draw-group.has-more::after { content: ''; position: absolute; right: 3px; bottom: 3px; border: 3px solid transparent; border-right-color: currentColor; border-bottom-color: currentColor; opacity: 0.55; }
.oi-draw-flyout { position: absolute; z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 5px; background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.oi-draw-flyout[hidden], .oi-draw-menu[hidden] { display: none; }
.oi-draw-flyout button { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 0 10px 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: start; white-space: nowrap; }
.oi-draw-flyout button:hover { background: var(--oi-color-surface2); }
.oi-draw-flyout button span { font-size: 13px; }
.oi-draw-menu { position: absolute; z-index: 6; min-width: 180px; padding: 4px; background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); font-size: 13px; }
.oi-draw-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 0 10px 0 6px; border: none; border-radius: 5px; background: transparent; text-align: start; }
.oi-draw-menu button:hover { background: var(--oi-color-surface2); }
.oi-draw-menu .check { width: 14px; color: var(--oi-color-accent); }
.oi-draw-menu hr { border: none; border-top: 1px solid var(--oi-color-border); margin: 4px 2px; }
.oi-draw-menu .label { padding: 4px 10px 2px 28px; color: var(--oi-color-text-muted); font-size: 11.5px; }
.oi-draw-tool { display: flex; flex-direction: column; gap: 2px; padding: 8px 6px; border-inline-end: 1px solid var(--oi-color-border); overflow-y: auto; }
.oi-draw-tool hr { width: 70%; border: none; border-top: 1px solid var(--oi-color-border); margin: 4px auto; }
.oi-draw-stage { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background-image: radial-gradient(color-mix(in srgb, var(--oi-color-text) 12%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.oi-draw-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; outline: none; }
.oi-draw-canvas text { font-family: var(--oi-font-body); fill: currentColor; stroke: none; }
.oi-draw-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.oi-draw-block { position: absolute; width: max-content; max-width: 28em; line-height: 1.6; font-family: var(--oi-font-body); border-radius: 4px; }
.oi-draw-block p { margin: 0; }
.oi-draw-block.oi-draw-label { max-width: 16em; line-height: 1.3; text-align: center; }
.oi-draw-block.selected { outline: 2px solid color-mix(in srgb, var(--oi-color-accent) 60%, transparent); outline-offset: 2px; background: color-mix(in srgb, var(--oi-color-accent) 8%, transparent); }
.oi-draw-block.oi-draw-source-text { font-family: var(--oi-font-code); font-size: 0.8em; color: var(--oi-color-text-muted); white-space: pre; }
.oi-draw-inline { position: absolute; z-index: 3; box-sizing: content-box; min-width: 4em; margin: -3px 0 0 -5px; padding: 2px 4px; border: none; border-radius: 4px; outline: 1.5px dashed color-mix(in srgb, var(--oi-color-accent) 70%, transparent); outline-offset: 1px; background: color-mix(in srgb, var(--oi-color-background) 92%, transparent); color: inherit; font-family: var(--oi-font-body); line-height: 1.6; resize: none; overflow: hidden; white-space: pre; }
.oi-draw-block.editing { visibility: hidden; }
@media (pointer: coarse) {
	.oi-draw-element button, .oi-draw-tool button, .oi-draw-small { min-width: 40px; height: 40px; }
	.oi-draw-flyout button, .oi-draw-menu button { min-height: 42px; }
}
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
	.oi-draw-element { display: none; }
	.oi-draw-group[data-group="Element"] { display: block; }
	/* one row on a phone: Undo, Redo, Clear, Cancel, Done */
	.oi-draw-title { display: none; }
	.oi-draw-top { gap: 4px; flex-wrap: nowrap; padding: 6px 8px; }
	.oi-draw-secondary, .oi-draw-primary { padding: 0 10px; }
}
`;

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function number(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

/** An arrow end as written: a named point, or [x, y] in px. */
function readEnd(value: PropertyValue | undefined): { name: string } | { point: Point } | undefined {
	if (typeof value === 'string' && value.trim() !== '') return { name: value.trim() };
	if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return { point: { x: value[0], y: value[1] } };
	return undefined;
}

const sideDirection: Readonly<Record<string, Point>> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };

/** Opens the editor over the page; returns a function that closes it without saving. */
export function openStructureEditor(option: StructureEditorOption): () => void {
	const sceneOption = option.scene ?? {};
	const metric = { emPx: option.emPx ?? 16, option: sceneOption };
	const boardMode = option.board !== undefined;
	let structure: StructureDrawing | undefined = boardMode ? undefined : loadStructure(option.body ?? '', sceneOption);
	let board: BoardDrawing | undefined = option.board ? loadBoard(option.board.property, option.board.itemList, metric) : undefined;
	let graph: DrawGraph = board ? board.graph : structure!.graph;
	/** The text the note has now (a Board's OI text, or the Chem block's text). */
	const currentText = (): string => (board ? writeBoard(board) : structure!.body);
	const startText = currentText();
	type Snapshot = { body: string } | { board: BoardDrawing };
	const undoList: Snapshot[] = [];
	const redoList: Snapshot[] = [];
	const snapshot = (): Snapshot => (board ? { board: cloneBoard(board) } : { body: structure!.body });
	let tool: Tool = boardMode ? { kind: 'Select' } : { kind: 'Bond', order: 1, stereo: 'None' };
	let toolId = boardMode ? 'Select' : 'Single';
	let selection = new Set<number>();
	/** Blocks on the Board that are picked (arrows, text, and others), by the tool's number. */
	let blockSelection = new Set<number>();
	let hover: { atom?: DrawAtom; bond?: DrawBond } = {};
	let scale = 38;
	let pan = { x: 0, y: 0 };
	let press:
		| {
				screen: Point;
				world: Point;
				atom?: DrawAtom;
				bond?: DrawBond;
				block?: BoardBlock;
				handle?: { block: BoardBlock; which: 'From' | 'To' | 'Curve' };
				moved: boolean;
				pointerId: number;
				origin?: Map<number, Point>;
				blockOrigin?: Map<number, PropertyMap>;
				arrowStart?: PropertyValue;
		  }
		| undefined;
	let preview: { from: Point; to: Point } | undefined;
	/** An arrow being drawn with the Arrow tool (screen px). */
	let arrowPreview: { from: Point; to: Point } | undefined;
	let band: { from: Point; to: Point } | undefined;
	/** An arrow's text being dragged: it follows the pointer (screen px) until it lands. */
	let labelShift: { id: number; x: number; y: number } | undefined;
	let closed = false;
	/** An edit happened; the note's text is written once the pointer is up. */
	let dirty = false;
	let pending: Snapshot | undefined;
	/** One run of typing in the text below is one undo step. */
	let typing = false;
	/** Shown in the hint until the next edit. */
	let notice = option.board?.notice ?? '';
	/** Where each block on the Board is on screen, measured after drawing (relative to the canvas). */
	const blockRectMap = new Map<number, { left: number; top: number; right: number; bottom: number }>();
	/** Pointers that are down (screen), and two fingers zooming and panning. */
	const fingerMap = new Map<number, Point>();
	let pinch: { distance: number; scale: number; world: Point } | undefined;
	/** The text box open on a block, if any, and the block it covers. */
	let inlineEditor: HTMLTextAreaElement | undefined;
	let editingBlockId: number | undefined;
	/** A right or middle button held down: it pans, or (when it doesn't move) the right one acts. */
	let panPress: { screen: Point; pan: Point; moved: boolean; pointerId: number } | undefined;
	let panned = false;
	/** A finger held still: after a moment it acts as a right click. */
	let longPressTimer: number | undefined;
	let longPressed = false;
	/** Fingers get bigger targets than a mouse. */
	let touch = false;
	const reach = (mouse: number): number => (touch ? mouse * 1.7 : mouse);
	/** A touch screen: the hint speaks of holding, not right-clicking. */
	const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

	// the groups for this mode (Arrow and Text only on a Board), without a separator twice in a row
	/** A tool's key as shown in its title: yours, or the default. */
	const toolKeyText = (tool: string): string => {
		if (option.hotkey) return option.hotkey.keyText(`Drawing.${tool}`);
		return (drawingCommandList.find((command) => command.tool === tool)?.key ?? []).map(defaultKeyText).join(' · ');
	};
	/** The tool a keydown picks, by your keys (or the defaults). */
	const toolForKey = (event: KeyboardEvent): string | undefined => {
		if (option.hotkey) return option.hotkey.commandFor(event, 'Drawing')?.replace(/^Drawing\./, '');
		const chord = defaultChord(event);
		return drawingCommandList.find((command) => command.key.some((key) => defaultKeyText(key) === chord || key === chord))?.tool;
	};

	/** The chemistry tools: always on one structure, on a Board when it holds Chem blocks. */
	const chemistry = !boardMode || option.chemistry !== false;
	const groupList = toolGroupList
		.filter((item) => item === 'Separator' || ((!item.board || boardMode) && (!item.chemistry || chemistry) && (item.id !== 'Color' || option.colorPicker !== undefined)))
		.map((item) => (item === 'Separator' || chemistry ? item : { ...item, memberList: item.memberList.filter((member) => !member.chemistry).map((member) => ({ ...member, title: member.plainTitle ?? member.title })) }))
		.map((item): ToolGroup | 'Separator' => (item === 'Separator' ? item : { ...item, memberList: item.memberList.map((member) => ({ ...member, title: `${member.title}${toolKeyText(member.id) ? ` (${toolKeyText(member.id)})` : ''}` })) }))
		.filter((item, index, list) => item !== 'Separator' || (index > 0 && list[index - 1] !== 'Separator'));
	const groupOf = (id: string): ToolGroup | undefined => groupList.find((item): item is ToolGroup => item !== 'Separator' && item.memberList.some((member) => member.id === id));
	const backdrop = document.createElement('div');
	backdrop.className = 'oi-draw-backdrop';
	backdrop.dataset.oiKeepEditor = '';
	backdrop.innerHTML =
		'<div class="oi-draw" role="dialog" aria-modal="true" aria-label="Drawing tool">' +
		`<div class="oi-draw-top"><span class="oi-draw-title">${boardMode ? 'Board' : 'Structure'}</span>` +
		`<div class="oi-draw-element"${chemistry ? '' : ' hidden'} role="toolbar" aria-label="Elements">${elementButtonList.map((element) => `<button type="button" data-element="${element}" title="${element} (hover an atom and press ${element === 'Cl' ? 'L' : element === 'Br' ? 'B' : element})">${element}</button>`).join('')}<button type="button" data-element="Other" title="Another element or a label (CO₂H, Ph…)">Other</button></div>` +
		'<span class="oi-draw-space"></span>' +
		'<button type="button" class="oi-draw-small" data-action="Undo" title="Undo (Ctrl+Z)">↶</button><button type="button" class="oi-draw-small" data-action="Redo" title="Redo (Ctrl+Y)">↷</button>' +
		`<button type="button" class="oi-draw-small" data-action="Clear" title="${boardMode ? 'Erase everything on the board' : 'Erase the structure'}">Clear</button>` +
		'<button type="button" class="oi-draw-secondary" data-action="Cancel">Cancel</button><button type="button" class="oi-draw-primary" data-action="Done">Done</button></div>' +
		`<div class="oi-draw-main"><div class="oi-draw-tool" role="toolbar" aria-label="Tools">${groupList
			.map((item) => (item === 'Separator' ? '<hr>' : `<button type="button" class="oi-draw-group${item.memberList.length > 1 ? ' has-more' : ''}" data-group="${item.id}" title="${escapeXml(item.memberList[0]!.title)}" aria-label="${escapeXml(item.title)}">${item.memberList[0]!.icon}</button>`))
			.join('')}</div>` +
		'<div class="oi-draw-flyout" role="menu" hidden></div>' +
		'<div class="oi-draw-stage"><svg class="oi-draw-canvas" tabindex="0" aria-label="Drawing area"></svg><div class="oi-draw-layer"></div><div class="oi-draw-menu" role="menu" hidden></div></div></div>' +
		'<div class="oi-draw-bottom"><div class="oi-draw-hint"><span class="oi-draw-text"></span>' +
		'<button type="button" class="oi-draw-small active" data-action="Source" aria-pressed="true" title="Show or hide the text this becomes in the note">Source</button></div>' +
		'<textarea class="oi-draw-source" spellcheck="false" autocomplete="off" aria-label="The text in the note"></textarea></div></div>';
	document.body.append(backdrop);
	const dialog = backdrop.querySelector<HTMLElement>('.oi-draw')!;
	const svg = backdrop.querySelector<SVGSVGElement>('.oi-draw-canvas')!;
	const stage = backdrop.querySelector<HTMLElement>('.oi-draw-stage')!;
	const layer = backdrop.querySelector<HTMLElement>('.oi-draw-layer')!;
	const hint = backdrop.querySelector<HTMLElement>('.oi-draw-text')!;
	const source = backdrop.querySelector<HTMLTextAreaElement>('.oi-draw-source')!;
	const flyout = backdrop.querySelector<HTMLElement>('.oi-draw-flyout')!;
	const menu = backdrop.querySelector<HTMLElement>('.oi-draw-menu')!;
	source.value = startText;

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
	/** Board px ↔ the graph's bond lengths (y up). */
	const bondPx = boardScale(metric);
	const pxToWorld = (point: Point): Point => ({ x: point.x / bondPx, y: -point.y / bondPx });
	const worldToPx = (point: Point): Point => ({ x: point.x * bondPx, y: -point.y * bondPx });
	/** Screen px per Board px, so blocks and arrows grow with the zoom. */
	const boardZoom = (): number => scale / bondPx;
	const screenToPx = (point: Point): Point => {
		const { width, height } = size();
		return worldToPx({ x: (point.x - width / 2 - pan.x) / scale, y: -(point.y - height / 2 - pan.y) / scale });
	};
	const pxToScreen = (point: Point): Point => toScreen(pxToWorld(point));
	const fit = (): void => {
		const pointList: Point[] = graph.atomList.map((atom) => ({ x: atom.x, y: atom.y }));
		for (const block of board?.blockList ?? []) {
			if (block.baseline !== undefined) continue;
			for (const end of [block.property.get('From'), block.property.get('To')]) {
				const read = readEnd(end);
				if (read && 'point' in read) pointList.push(pxToWorld(read.point));
			}
			if (block.property.has('X') || block.property.has('Y')) {
				const at = { x: numberOf(block.property.get('X')), y: numberOf(block.property.get('Y')) };
				pointList.push(pxToWorld(at), pxToWorld({ x: at.x + (block.type === 'Arrow' ? numberOf(block.property.get('Length')) || 3 * metric.emPx : 8 * metric.emPx), y: at.y + 1.6 * metric.emPx }));
			}
		}
		if (pointList.length === 0) {
			pan = { x: 0, y: 0 };
			return;
		}
		const xs = pointList.map((point) => point.x);
		const ys = pointList.map((point) => point.y);
		const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
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
		const resolvedColor = bond.color ? (option.resolveColor?.(bond.color) ?? bond.color) : undefined;
		const color = resolvedColor ? ` style="color: ${escapeXml(resolvedColor)}"` : '';
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
		const color = atom.color ? (option.resolveColor?.(atom.color) ?? atom.color) : undefined;
		return color ? `<g style="color: ${escapeXml(color)}">${out}</g>` : out;
	};

	/** How far beyond an atom's centre its lone-pair dots sit (screen px), as atomMarkup draws them. */
	const pairReach = (atom: DrawAtom, ux: number, uy: number): number => {
		const font = 15 * zoom();
		return isLabelVisible(graph, atom) ? Math.min((Math.abs(ux) * (labelMetric(atom).width * font)) / 2 + Math.abs(uy) * 9 * zoom(), 20 * zoom()) + 6 * zoom() : 7 * zoom();
	};

	// ------------------------------------------------------------ the Board's blocks

	const blockList = (): BoardBlock[] => board?.blockList ?? [];
	/** Every block, arrows' text included, with the arrow it sits on. */
	const everyBlock = (): { block: BoardBlock; parent: BoardBlock | undefined }[] => blockList().flatMap((block) => [{ block, parent: undefined }, ...block.childList.map((child) => ({ block: child, parent: block }))]);
	const blockById = (id: number): BoardBlock | undefined => everyBlock().find((item) => item.block.id === id)?.block;
	/** Blocks drawn as blocks (not a Chem structure in the graph). */
	const isPlaced = (block: BoardBlock): boolean => block.baseline === undefined;
	const sizeFactor = (block: BoardBlock): number => {
		const value = block.property.get('Size');
		const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)em$/.exec(value) : null;
		return match ? Number(match[1]) : 1;
	};

	/** A named point on screen: an atom (`c`), a lone pair (`o.lp`, `o.lp2` = the one at 2 × 45°), a bond (`cb`), an edge point (`c.north`), `a!0.5!b`, or `^id.east` on a block's box. */
	const resolveName = (name: string, toward?: Point, depth = 0): Point | undefined => {
		if (depth > 4) return undefined;
		const between = /^\(?\s*(.+?)\s*\)?\s*!\s*(-?\d+(?:\.\d+)?)\s*!\s*\(?\s*(.+?)\s*\)?$/.exec(name);
		if (between) {
			const from = resolveName(between[1]!, undefined, depth + 1);
			const to = resolveName(between[3]!, undefined, depth + 1);
			const share = Number(between[2]);
			return from && to ? { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share } : undefined;
		}
		if (name.startsWith('^')) {
			const [id, side = 'center'] = name.slice(1).split('.');
			const block = everyBlock().find((item) => item.block.blockId === id)?.block;
			const rect = block ? boxOfBlock(block) : undefined;
			if (!rect) return undefined;
			const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
			if (side === 'center') return center;
			const degree = Number(side);
			const direction = sideDirection[side] ?? (Number.isFinite(degree) ? { x: Math.cos((degree * Math.PI) / 180), y: -Math.sin((degree * Math.PI) / 180) } : undefined);
			if (!direction) return undefined;
			const reach = Math.min(Math.abs(direction.x) > 1e-6 ? (rect.right - rect.left) / 2 / Math.abs(direction.x) : Infinity, Math.abs(direction.y) > 1e-6 ? (rect.bottom - rect.top) / 2 / Math.abs(direction.y) : Infinity);
			return { x: center.x + direction.x * reach, y: center.y + direction.y * reach };
		}
		const [base, suffix] = name.split('.');
		const atom = graph.atomList.find((item) => item.name === base);
		if (atom) {
			const at = toScreen(atom);
			const lonePair = suffix ? /^lp(\d)?$/.exec(suffix) : null;
			if (lonePair) {
				const pairList = electronAngleList(graph, atom).filter((group) => group.kind === 'Pair');
				let angle: number;
				if (lonePair[1] !== undefined) angle = (Number(lonePair[1]) % 8) * 45;
				else {
					const other = toward ?? { x: at.x + 1, y: at.y };
					const facing = Math.atan2(-(other.y - at.y), other.x - at.x);
					angle = [...pairList].sort((left, right) => Math.cos((right.angle * Math.PI) / 180 - facing) - Math.cos((left.angle * Math.PI) / 180 - facing))[0]?.angle ?? (facing * 180) / Math.PI;
				}
				const ux = Math.cos((angle * Math.PI) / 180);
				const uy = -Math.sin((angle * Math.PI) / 180);
				const reach = pairReach(atom, ux, uy) + 5 * zoom();
				return { x: at.x + ux * reach, y: at.y + uy * reach };
			}
			if (suffix) {
				const degree = Number(suffix);
				const direction = sideDirection[suffix] ?? (Number.isFinite(degree) ? { x: Math.cos((degree * Math.PI) / 180), y: -Math.sin((degree * Math.PI) / 180) } : undefined);
				if (!direction) return undefined;
				const reach = trimOf(atom, direction.x, direction.y) || 4 * zoom();
				return { x: at.x + direction.x * reach, y: at.y + direction.y * reach };
			}
			if (!toward) return at;
			const dx = toward.x - at.x;
			const dy = toward.y - at.y;
			const length = Math.hypot(dx, dy) || 1;
			const reach = trimOf(atom, dx, dy) || 4 * zoom();
			return { x: at.x + (dx / length) * reach, y: at.y + (dy / length) * reach };
		}
		const bond = graph.bondList.find((item) => item.name === base);
		const a = bond ? atomById(graph, bond.from) : undefined;
		const b = bond ? atomById(graph, bond.to) : undefined;
		if (a && b) {
			const pa = toScreen(a);
			const pb = toScreen(b);
			return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
		}
		return undefined;
	};

	/** A block's box on screen: measured for blocks drawn as blocks, from the atoms for a structure, from the curve for an arrow. */
	const boxOfBlock = (block: BoardBlock): { left: number; top: number; right: number; bottom: number } | undefined => {
		if (!isPlaced(block)) {
			const atomList = graph.atomList.filter((atom) => atom.part === block.id).map(toScreen);
			if (atomList.length === 0) return undefined;
			const pad = 10 * zoom();
			return { left: Math.min(...atomList.map((point) => point.x)) - pad, top: Math.min(...atomList.map((point) => point.y)) - pad, right: Math.max(...atomList.map((point) => point.x)) + pad, bottom: Math.max(...atomList.map((point) => point.y)) + pad };
		}
		if (block.type === 'Arrow') {
			const curve = arrowGeometry(block);
			if (!curve) return undefined;
			const pointList = sampleCurve(curve);
			return { left: Math.min(...pointList.map((point) => point.x)), top: Math.min(...pointList.map((point) => point.y)), right: Math.max(...pointList.map((point) => point.x)), bottom: Math.max(...pointList.map((point) => point.y)) };
		}
		return blockRectMap.get(block.id);
	};

	/** What arrows bow away from: the middle of each structure and block. */
	const crowdList = (): Point[] => {
		const list: Point[] = [];
		for (const block of blockList()) {
			if (block.type === 'Arrow') continue;
			const box = boxOfBlock(block);
			if (box) list.push({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
		}
		return list;
	};

	/** An arrow on screen, as the Board draws it; undefined when its ends don't resolve. */
	const arrowGeometry = (block: BoardBlock): ArrowCurve | undefined => {
		const property = block.property;
		const sizePx = metric.emPx * boardZoom();
		const fromEnd = readEnd(property.get('From'));
		const toEnd = readEnd(property.get('To'));
		const start = property.has('X') || property.has('Y') ? pxToScreen({ x: numberOf(property.get('X')), y: numberOf(property.get('Y')) }) : undefined;
		const centerOf = (end: ReturnType<typeof readEnd>): Point | undefined => (end ? ('point' in end ? pxToScreen(end.point) : resolveName(end.name)) : undefined);
		const from = centerOf(fromEnd) ?? start;
		let to = centerOf(toEnd);
		if (from && !to && !toEnd) {
			const length = (numberOf(property.get('Length')) || 3.2 * metric.emPx) * boardZoom();
			const angle = (numberOf(property.get('Angle')) * Math.PI) / 180;
			to = { x: from.x + Math.cos(angle) * length, y: from.y - Math.sin(angle) * length };
		}
		if (!from || !to) return undefined;
		const kind = readKind(property.get('Kind'));
		const given = property.get('Curve');
		const bothNamed = fromEnd !== undefined && 'name' in fromEnd && toEnd !== undefined && 'name' in toEnd;
		const degree = kind === 'Equilibrium' || kind === 'Retro' ? 0 : typeof given === 'number' ? given : bothNamed ? autoCurve(from, to, crowdList(), sizePx) : 0;
		const curve = arrowCurve(from, to, degree, sizePx);
		// named ends stop at the edge of what they name, facing the curve; a lone pair is the one facing the arrow's middle
		const middle = bezierPoint(curve, 0.5);
		const facing = (name: string, control: Point): Point => (/\.lp\d?$/.test(name) ? middle : control);
		const fromEdge = fromEnd && 'name' in fromEnd ? resolveName(fromEnd.name, facing(fromEnd.name, curve.control1)) : undefined;
		const toEdge = toEnd && 'name' in toEnd ? resolveName(toEnd.name, facing(toEnd.name, curve.control2)) : undefined;
		return { ...curve, from: fromEdge ?? curve.from, to: toEdge ?? curve.to };
	};

	const arrowStyle = (block: BoardBlock): Parameters<typeof arrowMarkup>[1] => {
		const color = block.property.get('Color');
		const dash = block.property.get('Dash');
		const resolved = typeof color === 'string' ? option.resolveColor?.(color) : undefined;
		return {
			kind: readKind(block.property.get('Kind')),
			head: readHead(block.property.get('Head')),
			size: metric.emPx * boardZoom(),
			...(dash === 'Dashed' || dash === 'Dotted' ? { dash } : {}),
			...(resolved ? { color: resolved } : {}),
		};
	};

	const selectedArrow = (): BoardBlock | undefined => {
		if (blockSelection.size !== 1 || selection.size > 0) return undefined;
		const block = blockById([...blockSelection][0]!);
		return block?.type === 'Arrow' ? block : undefined;
	};

	/** Where an arrow's blocks go (screen): along it at their At, on their side; ones at the same spot stack outward (by the size last drawn). */
	const labelPlaceList = (arrow: BoardBlock, curve: ArrowCurve): [BoardBlock, ReturnType<typeof arrowLabelPlace>][] => {
		const size = metric.emPx * boardZoom();
		const outMap = new Map<string, number>();
		return arrow.childList.map((child) => {
			const side = child.property.get('Side') === 'Below' ? 'Below' : 'Above';
			const at = readAt(child.property.get('At'));
			const spot = `${side}|${at.toFixed(2)}`;
			const out = outMap.get(spot) ?? 0;
			const place = arrowLabelPlace(curve, side, size, at, out);
			const rect = blockRectMap.get(child.id);
			const extent = rect ? (place.translate.startsWith('translate(-50%') ? rect.bottom - rect.top : rect.right - rect.left) : 1.2 * size;
			outMap.set(spot, out + extent + 2);
			return [child, place];
		});
	};

	const renderCache = new Map<string, string>();
	/** The blocks drawn as blocks (text, formulas, math…) and arrows' text, as HTML over the canvas. */
	const drawLayer = (): void => {
		const k = boardZoom();
		let html = '';
		const style = (block: BoardBlock, factor: number): string => {
			const width = block.property.get('Width');
			const align = block.property.get('TextAlign');
			const color = block.property.get('Color');
			const resolved = typeof color === 'string' ? option.resolveColor?.(color) : undefined;
			return `font-size: ${number(metric.emPx * k * factor * sizeFactor(block))}px;${typeof width === 'number' ? ` width: ${number(width * k)}px; max-width: none;` : ''}${align === 'Center' || align === 'End' ? ` text-align: ${align === 'Center' ? 'center' : 'end'};` : ''}${resolved ? ` color: ${resolved.replace(/["<>;]/g, '')};` : ''}`;
		};
		const content = (block: BoardBlock): string => {
			const key = `${block.type}\u0000${block.body}`;
			let cached = renderCache.get(key);
			if (cached === undefined) {
				cached = option.renderBlock?.(block.type, block.body, block.property) ?? `<span class="oi-draw-source-text">${escapeXml(block.type === 'Text' ? block.body : `${block.type}: ${block.body}`)}</span>`;
				renderCache.set(key, cached);
			}
			return cached;
		};
		for (const block of blockList()) {
			if (!isPlaced(block)) continue;
			if (block.type === 'Arrow') {
				const curve = arrowGeometry(block);
				if (!curve) continue;
				for (const [child, { point, translate }] of labelPlaceList(block, curve)) {
					const shift = labelShift?.id === child.id ? labelShift : { x: 0, y: 0 };
					html += `<div class="oi-draw-block oi-draw-label${blockSelection.has(child.id) ? ' selected' : ''}${editingBlockId === child.id ? ' editing' : ''}" data-block="${child.id}" style="left: ${number(point.x + shift.x)}px; top: ${number(point.y + shift.y)}px; transform: ${translate}; ${style(child, 0.85)}">${content(child)}</div>`;
				}
				continue;
			}
			const at = pxToScreen({ x: numberOf(block.property.get('X')), y: numberOf(block.property.get('Y')) });
			html += `<div class="oi-draw-block${blockSelection.has(block.id) ? ' selected' : ''}${editingBlockId === block.id ? ' editing' : ''}" data-block="${block.id}" style="left: ${number(at.x)}px; top: ${number(at.y)}px; ${style(block, 1)}">${content(block)}</div>`;
		}
		layer.innerHTML = html;
		blockRectMap.clear();
		const origin = svg.getBoundingClientRect();
		for (const element of layer.querySelectorAll<HTMLElement>('[data-block]')) {
			const rect = element.getBoundingClientRect();
			blockRectMap.set(Number(element.dataset.block), { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top });
		}
	};

	let problem = '';
	const render = (): void => {
		if (dirty && !press) sync();
		const { width, height } = size();
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		const accent = 'var(--oi-color-accent)';
		problem = structure ? (structure.scene.problemList[0]?.message ?? '') : '';
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
		let arrowLayer = '';
		for (const block of blockList()) {
			if (block.type !== 'Arrow') continue;
			const curve = arrowGeometry(block);
			if (!curve) {
				problem ||= `An arrow points at a name no atom or bond has (${String(block.property.get('From') ?? '')} → ${String(block.property.get('To') ?? '')})`;
				continue;
			}
			if (blockSelection.has(block.id)) under += `<polyline points="${sampleCurve(curve).map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" opacity="0.22"/>`;
			arrowLayer += arrowMarkup(curve, arrowStyle(block), ` data-block="${block.id}"`);
		}
		let over = '';
		const arrow = tool.kind === 'Select' ? selectedArrow() : undefined;
		const curve = arrow ? arrowGeometry(arrow) : undefined;
		if (curve) {
			for (const point of [curve.from, curve.to]) over += `<circle cx="${number(point.x)}" cy="${number(point.y)}" r="5.5" fill="var(--oi-color-background)" stroke="${accent}" stroke-width="2"/>`;
			if (readKind(arrow!.property.get('Kind')) !== 'Equilibrium' && readKind(arrow!.property.get('Kind')) !== 'Retro') {
				const middle = bezierPoint(curve, 0.5);
				over += `<rect x="${number(middle.x - 5)}" y="${number(middle.y - 5)}" width="10" height="10" rx="2" fill="${accent}" stroke="var(--oi-color-background)" stroke-width="1.5"/>`;
			}
		}
		if (preview) {
			const from = toScreen(preview.from);
			const to = toScreen(preview.to);
			over += `<line x1="${number(from.x)}" y1="${number(from.y)}" x2="${number(to.x)}" y2="${number(to.y)}" stroke="${accent}" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${number(to.x)}" cy="${number(to.y)}" r="4" fill="${accent}" stroke="none"/>`;
		}
		if (arrowPreview && tool.kind === 'Arrow') {
			const size = metric.emPx * boardZoom();
			over += `<g style="color: ${accent}">${arrowMarkup(arrowCurve(arrowPreview.from, arrowPreview.to, tool.shape === 'Curved' ? 45 : 0, size), { kind: tool.arrowKind, head: 'End', size })}</g>`;
		}
		if (band) {
			const x = Math.min(band.from.x, band.to.x);
			const y = Math.min(band.from.y, band.to.y);
			over += `<rect x="${number(x)}" y="${number(y)}" width="${number(Math.abs(band.to.x - band.from.x))}" height="${number(Math.abs(band.to.y - band.from.y))}" fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-dasharray="4 3"/>`;
		}
		const nothing = graph.atomList.length === 0 && blockList().length === 0;
		const emptyText = boardMode ? (chemistry ? 'Draw a structure, or pick Arrow or Text on the left.' : 'Pick Arrow or Text on the left.') : 'Click anywhere to start: a bond, or pick a ring on the left.';
		const empty = nothing ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="14" opacity="0.55">${emptyText}</text>` : '';
		svg.innerHTML = `<g>${under}</g><g stroke="currentColor" stroke-width="${number(1.7 * Math.min(1, Math.max(zoom(), 0.5)))}" stroke-linecap="round">${graph.bondList.map(bondMarkup).join('')}</g><g>${graph.atomList.map(atomMarkup).join('')}</g><g>${arrowLayer}</g><g>${over}</g>${empty}`;
		if (boardMode) drawLayer();
		if (source.value !== currentText() && document.activeElement !== source) source.value = currentText();
		hint.textContent =
			notice ||
			(problem
				? `Problem: ${problem}`
				: coarse
					? 'Hold a tool for more. Hold on something to undo the tool there, or for a menu. Two fingers move and zoom; double-tap text to change it.'
					: boardMode
						? `Select: ${chemistry ? 'a bond picks up its structure; ' : ''}drag a box around a chunk; double-click text. Right-click: the tool undone, or a menu. Right-drag or two fingers: move around.`
						: 'Draw with the tools on the left (hold one for more). Right-click undoes the tool on what it touches; right-drag moves around. Enter or Done puts it into the note.');
		hint.title = hint.textContent;
		hint.classList.toggle('oi-draw-problem', notice === '' && problem !== '');
		for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-group]')) button.classList.toggle('active', groupOf(toolId)?.id === button.dataset.group);
		for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-element]')) button.classList.toggle('active', tool.kind === 'Atom' && button.dataset.element === tool.element);
		dialog.querySelector<HTMLButtonElement>('[data-action="Undo"]')!.disabled = undoList.length === 0;
		dialog.querySelector<HTMLButtonElement>('[data-action="Redo"]')!.disabled = redoList.length === 0;
	};

	// ------------------------------------------------------------ editing

	/** Marks the drawing as changed; call it before changing anything (one undo step per gesture). */
	const edit = (): void => {
		if (!dirty) pending = snapshot();
		dirty = true;
		typing = false;
		notice = '';
	};

	const remember = (state: Snapshot): void => {
		undoList.push(state);
		if (undoList.length > 200) undoList.shift();
		redoList.length = 0;
	};

	const textOf = (state: Snapshot): string => ('body' in state ? state.body : writeBoard(state.board));

	/** Writes the note's text after an edit: structures joined, split, or new, each with its text and place. */
	const sync = (): void => {
		dirty = false;
		if (board) board = syncBoard(board, metric);
		else structure = syncStructure(structure!, sceneOption);
		const before = pending;
		pending = undefined;
		if (before && textOf(before) !== currentText()) remember(before);
		selection = new Set([...selection].filter((id) => atomById(graph, id)));
		blockSelection = new Set([...blockSelection].filter((id) => blockById(id)));
	};

	const restore = (state: Snapshot): void => {
		if ('body' in state) {
			structure = loadStructure(state.body, sceneOption);
			graph = structure.graph;
		} else {
			board = cloneBoard(state.board);
			graph = board.graph;
		}
		selection = new Set();
		blockSelection = new Set();
		hover = {};
		dirty = false;
		pending = undefined;
		typing = false;
		notice = '';
	};

	const history = (kind: 'Undo' | 'Redo'): void => {
		const from = kind === 'Undo' ? undoList : redoList;
		const to = kind === 'Undo' ? redoList : undoList;
		const previous = from.pop();
		if (previous === undefined) return;
		closeInline(false);
		to.push(snapshot());
		restore(previous);
		render();
	};

	const removeBlock = (id: number): void => {
		if (!board) return;
		// in place: the editor holds on to blocks (an arrow being changed, the text being written)
		const index = board.blockList.findIndex((block) => block.id === id);
		if (index >= 0) {
			board.blockList.splice(index, 1);
			return;
		}
		for (const block of board.blockList) {
			const at = block.childList.findIndex((child) => child.id === id);
			if (at >= 0) block.childList.splice(at, 1);
		}
	};

	/** A name for an atom or bond an arrow points at (a1, a2… b1, b2…), when it has none. */
	const nameOf = (item: DrawAtom | DrawBond, prefix: 'a' | 'b'): string => {
		if (item.name) return item.name;
		const taken = new Set([...graph.atomList.map((atom) => atom.name), ...graph.bondList.map((bond) => bond.name)]);
		let index = 1;
		while (taken.has(`${prefix}${index}`)) index++;
		item.name = `${prefix}${index}`;
		return item.name;
	};

	/** What an arrow end lands on: a lone pair's dots, an atom, a bond, or just a point. */
	const endAt = (world: Point): { atom?: DrawAtom; pair?: number; bond?: DrawBond; point: Point } => {
		const at = toScreen(world);
		for (const atom of graph.atomList) {
			if (atom.lonePair === 0) continue;
			const center = toScreen(atom);
			for (const group of electronAngleList(graph, atom)) {
				if (group.kind !== 'Pair') continue;
				const ux = Math.cos((group.angle * Math.PI) / 180);
				const uy = -Math.sin((group.angle * Math.PI) / 180);
				const distance = pairReach(atom, ux, uy);
				if (Math.hypot(center.x + ux * distance - at.x, center.y + uy * distance - at.y) < reach(9)) return { atom, pair: group.angle, point: worldToPx(world) };
			}
		}
		const atom = nearestAtom(graph, world, reach(12) / scale);
		if (atom) return { atom, point: worldToPx(atom) };
		const bond = nearestBond(graph, world, reach(8) / scale);
		if (bond) return { bond, point: worldToPx(world) };
		return { point: worldToPx(world) };
	};
	const roundPx = (value: number): number => Math.round(value * 10) / 10;
	const endValue = (end: ReturnType<typeof endAt>): PropertyValue => {
		if (end.atom) return `${nameOf(end.atom, 'a')}${end.pair !== undefined ? `.lp${end.pair / 45}` : ''}`;
		if (end.bond) return nameOf(end.bond, 'b');
		return [roundPx(end.point.x), roundPx(end.point.y)];
	};

	/** An arrow's property for two ends: From and To, or X/Y/Length/Angle for a straight arrow between two points. */
	const arrowProperty = (from: PropertyValue, to: PropertyValue, keep: PropertyMap = new Map()): PropertyMap => {
		const property = new Map(keep);
		for (const key of ['From', 'To', 'X', 'Y', 'Length', 'Angle']) property.delete(key);
		if (Array.isArray(from) && Array.isArray(to)) {
			const [x1, y1] = from as number[];
			const [x2, y2] = to as number[];
			property.set('X', x1!);
			property.set('Y', y1!);
			property.set('Length', roundPx(Math.hypot(x2! - x1!, y2! - y1!)));
			const angle = Math.round((Math.atan2(-(y2! - y1!), x2! - x1!) * 180) / Math.PI);
			if (angle !== 0) property.set('Angle', angle);
		} else {
			property.set('From', from);
			property.set('To', to);
		}
		return property;
	};

	/** An arrow's two ends as written values, whatever form it has. */
	const arrowEnds = (block: BoardBlock): [PropertyValue, PropertyValue] | undefined => {
		const curve = arrowGeometry(block);
		const property = block.property;
		const asPx = (point: Point): PropertyValue => {
			const at = screenToPx(point);
			return [roundPx(at.x), roundPx(at.y)];
		};
		if (!curve) return undefined;
		return [property.get('From') ?? asPx(curve.from), property.get('To') ?? asPx(curve.to)];
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

	/** Asks for an atom's label: an element (N, Cl…) or any text (CO_2H, Ph, R). */
	const relabel = (atom: DrawAtom): void => {
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
	};

	const clickAt = (world: Point, atom: DrawAtom | undefined, bond: DrawBond | undefined, block: BoardBlock | undefined): void => {
		switch (tool.kind) {
			case 'Select':
				// a click on nothing lets go of what was picked
				if (!atom && !bond && !block) {
					selection = new Set();
					blockSelection = new Set();
				}
				return;
			case 'Color':
				if (atom || bond || block) {
					edit();
					colorize(atom ?? bond ?? block!, tool.color);
				}
				return;
			case 'Erase':
				if (atom) {
					edit();
					removeAtom(graph, atom.id);
				} else if (bond) {
					edit();
					removeBond(graph, bond.id);
				} else if (block) {
					edit();
					removeBlock(block.id);
				}
				return;
			case 'Text':
				if (block && block.type !== 'Arrow') openInline(block);
				else if (board) {
					const at = worldToPx(world);
					openInline({ id: board.nextId++, type: 'Text', property: new Map([['X', roundPx(at.x)], ['Y', roundPx(at.y - 0.8 * metric.emPx)]]), body: '', childList: [] }, true);
				}
				return;
			case 'Arrow':
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
				atom.charge += tool.sign;
				return;
			case 'LonePair':
			case 'Radical':
				if (!atom) return;
				// pairs and single electrons share the 8 places around an atom, in a fixed order
				if (atom.lonePair + atom.radical >= electronRoom) {
					notice = 'There is no room for more electrons around this atom (8 places). Right-click takes one away.';
					return;
				}
				edit();
				if (tool.kind === 'LonePair') atom.lonePair++;
				else atom.radical++;
				return;
		}
	};

	/** A theme color on an atom, a bond, an arrow, or text ('' takes it away). */
	const colorize = (target: DrawAtom | DrawBond | BoardBlock, color: string): void => {
		if ('property' in target) {
			if (color) target.property.set('Color', color);
			else target.property.delete('Color');
		} else if (color) target.color = color;
		else delete target.color;
	};

	/** A right click (or a long press): the tool's action undone on what is under it, or a menu for it. */
	const contextAt = (world: Point, client: Point): void => {
		const hit = hitTest(world);
		const { atom, bond, block } = hit;
		const target = atom ?? bond;
		switch (tool.kind) {
			case 'LonePair':
			case 'Radical':
				if (!atom) break;
				if ((tool.kind === 'LonePair' ? atom.lonePair : atom.radical) === 0) return;
				edit();
				if (tool.kind === 'LonePair') atom.lonePair--;
				else atom.radical--;
				render();
				return;
			case 'Charge':
				if (!atom) break;
				edit();
				atom.charge -= tool.sign;
				render();
				return;
			case 'Bond':
				if (bond) {
					// a step down: a wedge back to a plain bond, a triple to a double…, a single bond goes
					edit();
					if (bond.stereo !== 'None') bond.stereo = 'None';
					else if (bond.order > 1) bond.order = (bond.order - 1) as 1 | 2;
					else removeBond(graph, bond.id);
					render();
					return;
				}
				if (atom) {
					edit();
					removeAtom(graph, atom.id);
					render();
					return;
				}
				break;
			case 'Atom':
				if (!atom) break;
				edit();
				setElement(atom, 'C');
				render();
				return;
			case 'Color':
				if (!target && !block) break;
				edit();
				colorize(target ?? block!, '');
				render();
				return;
		}
		openMenuFor(hit, client);
	};

	// ------------------------------------------------------------ the right-click menu

	type MenuEntry = { label: string; check?: boolean; run(): void } | { title: string } | 'Separator';

	const closeMenu = (): void => {
		menu.hidden = true;
		menu.replaceChildren();
	};

	const openMenu = (client: Point, givenList: readonly MenuEntry[]): void => {
		closeFlyout();
		menuPoint = client;
		// a part left out (Color without the Palette plugin) leaves no separator twice in a row, or at an end
		const entryList = givenList.filter((entry, index, list) => entry !== 'Separator' || (index > 0 && index < list.length - 1 && list[index - 1] !== 'Separator'));
		menu.innerHTML = entryList
			.map((entry, index) =>
				entry === 'Separator'
					? '<hr>'
					: 'title' in entry
						? `<div class="label">${escapeXml(entry.title)}</div>`
						: `<button type="button" role="menuitem" data-entry="${index}"><span class="check">${entry.check ? '✓' : ''}</span>${escapeXml(entry.label)}</button>`,
			)
			.join('');
		for (const button of menu.querySelectorAll<HTMLButtonElement>('[data-entry]')) {
			button.addEventListener('click', () => {
				const entry = entryList[Number(button.dataset.entry)];
				closeMenu();
				if (entry && entry !== 'Separator' && 'run' in entry) {
					entry.run();
					render();
				}
			});
		}
		menu.hidden = false;
		const area = stage.getBoundingClientRect();
		const left = Math.min(client.x - area.left, Math.max(0, area.width - menu.offsetWidth - 4));
		const top = Math.min(client.y - area.top, Math.max(0, area.height - menu.offsetHeight - 4));
		menu.style.left = `${number(Math.max(4, left))}px`;
		menu.style.top = `${number(Math.max(4, top))}px`;
	};

	/** A menu's Color entry: the Palette plugin's menu (nothing without the plugin). */
	const colorEntryList = (target: DrawAtom | DrawBond | BoardBlock): MenuEntry[] => {
		if (!option.colorPicker) return [];
		const current = 'property' in target ? target.property.get('Color') : target.color;
		return [
			{
				label: typeof current === 'string' && current !== '' ? `Color (${current})` : 'Color',
				run: () =>
					pickColor(menuPoint, typeof current === 'string' ? current : undefined, (color) => {
						edit();
						colorize(target, color ?? '');
						render();
					}),
			},
		];
	};

	/** Where the last menu opened (screen), so a picker opened from it appears there. */
	let menuPoint: Point = { x: 0, y: 0 };

	/** Asks the Palette plugin for a color. Hex comes back lowercase. */
	const pickColor = (client: Point, current: string | undefined, onPick: (color: string | undefined) => void): void => {
		option.colorPicker?.open({ x: client.x, y: client.y, title: 'Color', ...(current ? { current } : {}), onPick: (color) => onPick(color?.startsWith('#') ? (normalizeHex(color) ?? color) : color) });
	};

	/** A menu for what was right-clicked: an arrow's shape, kind, and head; text; an atom or a bond. */
	const openMenuFor = (hit: ReturnType<typeof hitTest>, client: Point): void => {
		const { atom, bond } = hit;
		const block = hit.block ?? hit.handle?.block;
		if (block && block.type === 'Arrow') {
			blockSelection = new Set([block.id]);
			selection = new Set();
			const kind = readKind(block.property.get('Kind'));
			const head = readHead(block.property.get('Head'));
			const curved = numberOf(block.property.get('Curve')) !== 0 || (!block.property.has('Curve') && typeof block.property.get('From') === 'string' && typeof block.property.get('To') === 'string');
			const set = (key: string, value: string | number | undefined): (() => void) => () => {
				edit();
				if (value === undefined) block.property.delete(key);
				else block.property.set(key, value);
			};
			const kindLabel: Record<ArrowKind, string> = { Single: 'Arrow', Fishhook: 'Fishhook (one electron)', Equilibrium: 'Equilibrium ⇌', Retro: 'Retrosynthesis ⇒', NoReaction: 'No reaction', Line: 'Line' };
			openMenu(client, [
				{ title: 'Shape' },
				{ label: 'Curved', check: curved, run: set('Curve', 45) },
				{ label: 'Straight', check: !curved, run: set('Curve', 0) },
				{ title: 'Kind' },
				...(Object.keys(kindLabel) as ArrowKind[]).filter((value) => chemistry || value === 'Single' || value === 'Line' || value === kind).map((value): MenuEntry => ({ label: kindLabel[value], check: kind === value, run: set('Kind', value === 'Single' ? undefined : value) })),
				{ title: 'Head' },
				...(['End', 'Start', 'Both'] as const).map((value): MenuEntry => ({ label: { End: 'At the end', Start: 'At the start', Both: 'At both ends' }[value], check: head === value, run: set('Head', value === 'End' ? undefined : value) })),
				{ label: 'Text along it', run: () => addArrowText(block) },
				'Separator',
				...colorEntryList(block),
				'Separator',
				{ label: 'Delete', run: () => { edit(); removeBlock(block.id); } },
			]);
		} else if (block) {
			blockSelection = new Set([block.id]);
			selection = new Set();
			openMenu(client, [{ label: 'Edit text', run: () => openInline(block) }, 'Separator', ...colorEntryList(block), 'Separator', { label: 'Delete', run: () => { edit(); removeBlock(block.id); } }]);
		} else if (atom) {
			openMenu(client, [
				{ label: 'Change the label', run: () => relabel(atom) },
				{ label: `Lone pairs: ${atom.lonePair} (add one)`, run: () => { if (atom.lonePair + atom.radical < electronRoom) { edit(); atom.lonePair++; } } },
				...(atom.lonePair > 0 ? [{ label: 'Take a lone pair away', run: () => { edit(); atom.lonePair--; } }] : []),
				'Separator',
				...colorEntryList(atom),
				'Separator',
				{ label: 'Delete the atom', run: () => { edit(); removeAtom(graph, atom.id); } },
			]);
		} else if (bond) {
			openMenu(client, [
				{ title: 'Bond' },
				...([1, 2, 3] as const).map((order): MenuEntry => ({ label: { 1: 'Single', 2: 'Double', 3: 'Triple' }[order], check: bond.order === order && bond.stereo === 'None', run: () => { edit(); bond.order = order; bond.stereo = 'None'; } })),
				'Separator',
				...colorEntryList(bond),
				'Separator',
				{ label: 'Delete the bond', run: () => { edit(); removeBond(graph, bond.id); } },
			]);
		}
	};

	/** A text block along an arrow (above it, or below when the top is taken), opened for writing. */
	const addArrowText = (arrow: BoardBlock): void => {
		if (!board) return;
		const side = arrow.childList.some((child) => child.property.get('Side') !== 'Below') ? 'Below' : 'Above';
		const child: BoardBlock = { id: board.nextId++, type: 'Text', property: new Map([['Side', side]]), body: '', childList: [] };
		editArrowText = { arrow, child };
		openInline(child, true);
	};
	/** The new text along an arrow, until it is written. */
	let editArrowText: { arrow: BoardBlock; child: BoardBlock } | undefined;

	const removeSelection = (): boolean => {
		if (selection.size === 0 && blockSelection.size === 0) return false;
		edit();
		for (const id of selection) removeAtom(graph, id);
		for (const id of blockSelection) removeBlock(id);
		selection = new Set();
		blockSelection = new Set();
		return true;
	};

	// ------------------------------------------------------------ text written on the Board

	const closeInline = (save: boolean): void => {
		const editor = inlineEditor;
		if (!editor) return;
		inlineEditor = undefined;
		if (!save) editor.dataset.cancel = '';
		editor.blur();
		editor.remove();
	};

	/** A text box over a block (or a new Text block): Enter keeps it, Shift+Enter is a new line, Esc leaves it. */
	const openInline = (block: BoardBlock, isNew = false): void => {
		closeInline(true);
		const box = isNew ? undefined : boxOfBlock(block);
		const at = box ? { x: box.left, y: box.top } : pxToScreen({ x: numberOf(block.property.get('X')), y: numberOf(block.property.get('Y')) });
		const editor = document.createElement('textarea');
		editor.className = 'oi-draw-inline';
		editor.value = block.body;
		editor.rows = 1;
		editor.spellcheck = false;
		const arrowText = editArrowText?.child === block ? editArrowText : undefined;
		let place = box ? { x: box.left, y: box.top } : at;
		if (arrowText) {
			const curve = arrowGeometry(arrowText.arrow);
			if (curve) {
				const { point } = arrowLabelPlace(curve, block.property.get('Side') === 'Below' ? 'Below' : 'Above', metric.emPx * boardZoom(), readAt(block.property.get('At')));
				place = { x: point.x - 30, y: block.property.get('Side') === 'Below' ? point.y : point.y - metric.emPx * boardZoom() * 1.4 };
			}
		}
		editor.style.left = `${number(place.x)}px`;
		editor.style.top = `${number(place.y)}px`;
		const label = arrowText !== undefined || everyBlock().some((item) => item.block.id === block.id && item.parent !== undefined);
		editor.style.fontSize = `${number(Math.max(11, metric.emPx * boardZoom() * sizeFactor(block) * (label ? 0.85 : 1)))}px`;
		editor.setAttribute('aria-label', 'Text on the board');
		/** The box follows the text as it is typed. */
		const fit = (): void => {
			editor.style.width = '0px';
			editor.style.width = `${editor.scrollWidth + 2}px`;
			editor.style.height = '0px';
			editor.style.height = `${editor.scrollHeight}px`;
		};
		editor.addEventListener('input', fit);
		stage.append(editor);
		inlineEditor = editor;
		editingBlockId = block.id;
		drawLayer();
		fit();
		const commit = (): void => {
			if (editor.dataset.done !== undefined) return;
			editor.dataset.done = '';
			if (inlineEditor === editor) inlineEditor = undefined;
			editor.remove();
			editingBlockId = undefined;
			const arrowText = editArrowText?.child === block ? editArrowText : undefined;
			editArrowText = undefined;
			if (editor.dataset.cancel !== undefined || closed) {
				render();
				return;
			}
			const text = editor.value.replace(/\s+$/, '');
			if (text === block.body && !isNew) {
				render();
				return;
			}
			if (isNew && text.trim() === '') {
				render();
				return;
			}
			edit();
			if (arrowText) blockById(arrowText.arrow.id)?.childList.push({ ...block, body: text });
			else if (isNew) board?.blockList.push({ ...block, body: text });
			else if (text.trim() === '') removeBlock(block.id);
			else {
				const target = blockById(block.id);
				if (target) target.body = text;
			}
			render();
		};
		editor.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				commit();
				svg.focus({ preventScroll: true });
			} else if (event.key === 'Escape') {
				event.preventDefault();
				editor.dataset.cancel = '';
				commit();
				svg.focus({ preventScroll: true });
			}
			event.stopPropagation();
		});
		editor.addEventListener('blur', commit);
		editor.focus();
		editor.setSelectionRange(editor.value.length, editor.value.length);
	};

	// ------------------------------------------------------------ pointer

	/** What is under the pointer: a handle of the picked arrow, an atom, a bond, an arrow, or a block. */
	const hitTest = (world: Point): { atom?: DrawAtom; bond?: DrawBond; block?: BoardBlock; handle?: { block: BoardBlock; which: 'From' | 'To' | 'Curve' } } => {
		const at = toScreen(world);
		const arrow = tool.kind === 'Select' ? selectedArrow() : undefined;
		const curve = arrow ? arrowGeometry(arrow) : undefined;
		if (arrow && curve) {
			const handleList: ['From' | 'To' | 'Curve', Point][] = [['From', curve.from], ['To', curve.to]];
			if (readKind(arrow.property.get('Kind')) !== 'Equilibrium' && readKind(arrow.property.get('Kind')) !== 'Retro') handleList.push(['Curve', bezierPoint(curve, 0.5)]);
			for (const [which, point] of handleList) if (Math.hypot(point.x - at.x, point.y - at.y) < reach(9)) return { handle: { block: arrow, which } };
		}
		const atom = nearestAtom(graph, world, reach(12) / scale);
		if (atom) return { atom };
		const bond = nearestBond(graph, world, reach(8) / scale);
		if (bond) return { bond };
		// text before arrows: an arrow's band is wide, and its own text sits right next to it
		for (const { block } of everyBlock()) {
			const rect = isPlaced(block) && block.type !== 'Arrow' ? blockRectMap.get(block.id) : undefined;
			if (rect && at.x >= rect.left - 3 && at.x <= rect.right + 3 && at.y >= rect.top - 3 && at.y <= rect.bottom + 3) return { block };
		}
		for (const block of blockList()) {
			if (block.type !== 'Arrow') continue;
			const curve = arrowGeometry(block);
			const pointList = curve ? sampleCurve(curve, 24) : [];
			for (let index = 1; index < pointList.length; index++) {
				const a = pointList[index - 1]!;
				const b = pointList[index]!;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
				if (Math.hypot(a.x + dx * t - at.x, a.y + dy * t - at.y) < reach(7)) return { block };
			}
		}
		return {};
	};

	/** The fingers' distance and middle (screen). */
	const fingerPair = (): { distance: number; center: Point } => {
		const [a, b] = [...fingerMap.values()] as [Point, Point];
		return { distance: Math.hypot(b.x - a.x, b.y - a.y) || 1, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
	};

	svg.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		// a right drag pans; only a right click that stayed put acts
		if (panned) {
			panned = false;
			return;
		}
		contextAt(toWorld(event.clientX, event.clientY), { x: event.clientX, y: event.clientY });
	});

	svg.addEventListener('pointerdown', (event) => {
		touch = event.pointerType === 'touch';
		closeMenu();
		closeFlyout();
		if (event.button === 1 || event.button === 2) {
			closeInline(true);
			panPress = { screen: { x: event.clientX, y: event.clientY }, pan: { ...pan }, moved: false, pointerId: event.pointerId };
			panned = false;
			svg.setPointerCapture?.(event.pointerId);
			if (event.button === 1) event.preventDefault();
			return;
		}
		if (event.button !== 0) return;
		closeInline(true);
		svg.focus({ preventScroll: true });
		window.clearTimeout(longPressTimer);
		longPressed = false;
		if (touch) {
			const client = { x: event.clientX, y: event.clientY };
			longPressTimer = window.setTimeout(() => {
				if (!press || press.moved || pinch) return;
				// a finger held still: a right click
				press = undefined;
				preview = undefined;
				arrowPreview = undefined;
				band = undefined;
				longPressed = true;
				contextAt(toWorld(client.x, client.y), client);
				render();
			}, 500);
		}
		fingerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
		svg.setPointerCapture?.(event.pointerId);
		event.preventDefault();
		if (fingerMap.size === 2) {
			// a second finger: zoom and pan instead of drawing
			const { distance, center } = fingerPair();
			pinch = { distance, scale, world: toWorld(center.x, center.y) };
			press = undefined;
			preview = undefined;
			arrowPreview = undefined;
			band = undefined;
			render();
		}
		if (pinch) return;
		const world = toWorld(event.clientX, event.clientY);
		const hit = hitTest(world);
		press = { screen: { x: event.clientX, y: event.clientY }, world, ...hit, moved: false, pointerId: event.pointerId };
		if (tool.kind === 'Arrow') press.arrowStart = 'pending';
		if (tool.kind !== 'Select' || hit.handle) return;
		if (hit.atom) {
			if (!selection.has(hit.atom.id)) {
				selection = event.shiftKey ? new Set([...selection, hit.atom.id]) : new Set([hit.atom.id]);
				if (!event.shiftKey) blockSelection = new Set();
			}
		} else if (hit.bond) {
			// a bond picks up its whole structure
			const part = atomById(graph, hit.bond.from)?.part;
			const idList = graph.atomList.filter((atom) => (boardMode ? atom.part === part : true)).map((atom) => atom.id);
			if (!idList.every((id) => selection.has(id))) {
				selection = new Set([...(event.shiftKey ? selection : []), ...idList]);
				if (!event.shiftKey) blockSelection = new Set();
			}
		} else if (hit.block) {
			if (!blockSelection.has(hit.block.id)) {
				blockSelection = event.shiftKey ? new Set([...blockSelection, hit.block.id]) : new Set([hit.block.id]);
				if (!event.shiftKey) selection = new Set();
			}
		} else return;
		press.origin = new Map([...selection].map((id) => [id, { x: atomById(graph, id)!.x, y: atomById(graph, id)!.y }]));
		press.blockOrigin = new Map([...blockSelection].flatMap((id) => {
			const block = blockById(id);
			return block ? [[id, new Map(block.property)] as [number, PropertyMap]] : [];
		}));
		render();
	});

	/** The one block a press picked up, when it is an arrow's text and nothing else moves with it. */
	const loneLabel = (current: NonNullable<typeof press>): BoardBlock | undefined => {
		if (!current.blockOrigin || current.blockOrigin.size !== 1 || (current.origin?.size ?? 0) > 0) return undefined;
		const id = [...current.blockOrigin.keys()][0]!;
		const item = everyBlock().find((entry) => entry.block.id === id);
		return item?.parent ? item.block : undefined;
	};

	/** The arrow nearest to a point (screen), within `reachEm` em of it: where along it, and on which side. */
	const arrowNear = (point: Point, reachEm: number): { arrow: BoardBlock; at: number; side: 'Above' | 'Below' } | undefined => {
		const size = metric.emPx * boardZoom();
		let best: { arrow: BoardBlock; at: number; side: 'Above' | 'Below'; distance: number } | undefined;
		for (const block of blockList()) {
			const curve = block.type === 'Arrow' ? arrowGeometry(block) : undefined;
			if (!curve) continue;
			const near = nearestOnArrow(curve, point, size);
			if (near.distance <= reachEm * size && (!best || near.distance < best.distance)) best = { arrow: block, ...near };
		}
		return best;
	};

	/** A block joins an arrow: at that spot along it, on that side (X and Y no longer apply). */
	const attachToArrow = (block: BoardBlock, arrow: BoardBlock, at: number, side: 'Above' | 'Below'): void => {
		const rounded = Math.round(at * 20) / 20;
		block.property.delete('X');
		block.property.delete('Y');
		block.property.set('Side', side);
		if (Math.abs(rounded - 0.5) < 1e-9) block.property.delete('At');
		else block.property.set('At', rounded);
		if (!arrow.childList.includes(block)) arrow.childList.push(block);
	};

	/**
	 * Where a dragged block lands: an arrow's text near an arrow stays on one (where it was let go), far
	 * away it becomes free text there; free text let go right on an arrow joins it.
	 */
	const land = (current: NonNullable<typeof press>): void => {
		const lone = loneLabel(current);
		if (lone) {
			const rect = blockRectMap.get(lone.id);
			const shift = labelShift ?? { x: 0, y: 0 };
			labelShift = undefined;
			if (!rect || Math.hypot(shift.x, shift.y) < 2) return;
			edit();
			// the rect was measured where it was last drawn, with the shift
			const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
			const near = arrowNear(center, 2.5);
			removeBlock(lone.id);
			if (near) attachToArrow(lone, near.arrow, near.at, near.side);
			else {
				const topLeft = screenToPx({ x: rect.left, y: rect.top });
				lone.property.delete('Side');
				lone.property.delete('At');
				lone.property.set('X', roundPx(topLeft.x));
				lone.property.set('Y', roundPx(topLeft.y));
				board?.blockList.push(lone);
			}
			return;
		}
		// one free block (not an arrow, a structure, or a block holding blocks) let go right on an arrow
		if (!current.blockOrigin || current.blockOrigin.size !== 1 || (current.origin?.size ?? 0) > 0) return;
		const block = blockById([...current.blockOrigin.keys()][0]!);
		if (!block || block.type === 'Arrow' || !isPlaced(block) || block.childList.length > 0) return;
		const rect = blockRectMap.get(block.id);
		if (!rect) return;
		const near = arrowNear({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }, 1);
		if (!near) return;
		removeBlock(block.id);
		attachToArrow(block, near.arrow, near.at, near.side);
	};

	/** Moves a block by (dx, dy) Board px from where it was: its X/Y, and the ends that are points. */
	const moveBlock = (block: BoardBlock, origin: PropertyMap, dx: number, dy: number): void => {
		for (const key of ['X', 'Y'] as const) if (origin.has(key)) block.property.set(key, roundPx(numberOf(origin.get(key)) + (key === 'X' ? dx : dy)));
		for (const key of ['From', 'To']) {
			const end = readEnd(origin.get(key));
			if (end && 'point' in end) block.property.set(key, [roundPx(end.point.x + dx), roundPx(end.point.y + dy)]);
		}
	};

	svg.addEventListener('pointermove', (event) => {
		if (panPress && event.pointerId === panPress.pointerId) {
			const dx = event.clientX - panPress.screen.x;
			const dy = event.clientY - panPress.screen.y;
			if (!panPress.moved && Math.hypot(dx, dy) < 5) return;
			panPress.moved = true;
			pan = { x: panPress.pan.x + dx, y: panPress.pan.y + dy };
			render();
			return;
		}
		if (press && Math.hypot(event.clientX - press.screen.x, event.clientY - press.screen.y) > 8) window.clearTimeout(longPressTimer);
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
		if (!press) {
			const hit = hitTest(world);
			if (hit.atom !== hover.atom || hit.bond !== hover.bond) {
				hover = { ...(hit.atom ? { atom: hit.atom } : {}), ...(hit.bond ? { bond: hit.bond } : {}) };
				render();
			}
			svg.style.cursor = tool.kind === 'Select' && (hit.handle || hit.block || hit.atom || hit.bond) ? 'move' : tool.kind === 'Text' ? 'text' : '';
			return;
		}
		if (!press.moved && Math.hypot(event.clientX - press.screen.x, event.clientY - press.screen.y) < 6) return;
		const first = !press.moved;
		press.moved = true;
		if (press.handle) {
			if (first) edit();
			const { block, which } = press.handle;
			const at = toScreen(world);
			if (which === 'Curve') {
				const curve = arrowGeometry(block);
				if (curve) {
					const length = Math.hypot(curve.to.x - curve.from.x, curve.to.y - curve.from.y) || 1;
					const normal = { x: (curve.to.y - curve.from.y) / length, y: -(curve.to.x - curve.from.x) / length };
					const middle = { x: (curve.from.x + curve.to.x) / 2, y: (curve.from.y + curve.to.y) / 2 };
					const degree = curveForOffset(curve.from, curve.to, (at.x - middle.x) * normal.x + (at.y - middle.y) * normal.y, metric.emPx * boardZoom());
					block.property.set('Curve', Math.abs(degree) < 3 ? 0 : degree);
				}
			} else {
				const ends = arrowEnds(block);
				if (ends) {
					const point = worldToPx(world);
					const here: PropertyValue = [roundPx(point.x), roundPx(point.y)];
					const [from, to] = ends;
					block.property = arrowProperty(which === 'From' ? here : from, which === 'To' ? here : to, block.property);
				}
			}
			render();
			return;
		}
		if (tool.kind === 'Arrow') {
			const start = endAt(press.world);
			arrowPreview = { from: start.atom || start.bond ? (resolveName(start.atom ? (start.atom.name ?? '') : '') ?? toScreen(press.world)) : toScreen(press.world), to: toScreen(world) };
			if (start.atom && !start.atom.name) arrowPreview.from = toScreen(start.atom);
			render();
			return;
		}
		if (tool.kind === 'Select') {
			const lone = loneLabel(press);
			if (lone) {
				const here = toScreen(world);
				const start = toScreen(press.world);
				labelShift = { id: lone.id, x: here.x - start.x, y: here.y - start.y };
				render();
				return;
			}
			if (press.origin && press.blockOrigin && (press.origin.size > 0 || press.blockOrigin.size > 0)) {
				if (first) edit();
				for (const [id, origin] of press.origin) {
					const atom = atomById(graph, id);
					if (atom) {
						atom.x = origin.x + world.x - press.world.x;
						atom.y = origin.y + world.y - press.world.y;
					}
				}
				const dx = (world.x - press.world.x) * bondPx;
				const dy = -(world.y - press.world.y) * bondPx;
				for (const [id, origin] of press.blockOrigin) {
					const block = blockById(id);
					if (block) moveBlock(block, origin, dx, dy);
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
		if (panPress && event.pointerId === panPress.pointerId) {
			panned = panPress.moved;
			panPress = undefined;
			svg.releasePointerCapture?.(event.pointerId);
			return;
		}
		window.clearTimeout(longPressTimer);
		fingerMap.delete(event.pointerId);
		if (longPressed) {
			longPressed = false;
			press = undefined;
			return;
		}
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
			arrowPreview = undefined;
			band = undefined;
			labelShift = undefined;
			render();
			return;
		}
		const world = toWorld(event.clientX, event.clientY);
		if (current.handle && current.moved && current.handle.which !== 'Curve') {
			// a dragged end lands on what is under it: a lone pair, an atom, a bond, or stays a point
			const { block, which } = current.handle;
			const end = endAt(world);
			const ends = arrowEnds(block);
			if (ends && (end.atom || end.bond)) {
				const value = endValue(end);
				block.property = arrowProperty(which === 'From' ? value : ends[0], which === 'To' ? value : ends[1], block.property);
			}
		} else if (tool.kind === 'Arrow' && board) {
			const start = endAt(current.world);
			const finishEnd = endAt(world);
			edit();
			const id = board.nextId++;
			const pointOf = (end: ReturnType<typeof endAt>): PropertyValue => [roundPx(end.point.x), roundPx(end.point.y)];
			const away: PropertyValue = [roundPx(start.point.x + 3.2 * metric.emPx), roundPx(start.point.y)];
			let property: PropertyMap;
			if (tool.shape === 'Straight') property = arrowProperty(pointOf(start), current.moved ? pointOf(finishEnd) : away);
			else {
				// a curved arrow ends on what it was drawn between, and bends; between two names it bows away from what's around
				const from = endValue(start);
				const to = current.moved ? endValue(finishEnd) : away;
				property = arrowProperty(from, to);
				if (typeof from !== 'string' || typeof to !== 'string') property.set('Curve', 45);
			}
			if (tool.arrowKind !== 'Single') property.set('Kind', tool.arrowKind);
			board.blockList.push({ id, type: 'Arrow', property, body: '', childList: [] });
			blockSelection = new Set([id]);
			selection = new Set();
			arrowPreview = undefined;
			choose('Select', { kind: 'Select' }, false);
		} else if (!current.moved) clickAt(current.world, current.atom, current.bond, current.block);
		else if (tool.kind === 'Select' && !band && current.blockOrigin) land(current);
		else if (tool.kind === 'Select' && band) {
			const from = { x: Math.min(band.from.x, band.to.x), y: Math.min(band.from.y, band.to.y) };
			const to = { x: Math.max(band.from.x, band.to.x), y: Math.max(band.from.y, band.to.y) };
			const inside = (point: Point): boolean => point.x >= from.x && point.x <= to.x && point.y >= from.y && point.y <= to.y;
			selection = new Set(graph.atomList.filter((atom) => inside(toScreen(atom))).map((atom) => atom.id));
			blockSelection = new Set(
				everyBlock()
					.filter(({ block }) => {
						if (!isPlaced(block)) return false;
						if (block.type === 'Arrow') {
							const curve = arrowGeometry(block);
							return curve ? inside(bezierPoint(curve, 0.5)) : false;
						}
						const rect = blockRectMap.get(block.id);
						return rect ? rect.left < to.x && rect.right > from.x && rect.top < to.y && rect.bottom > from.y : false;
					})
					.map(({ block }) => block.id),
			);
		} else if ((tool.kind === 'Bond' || tool.kind === 'Atom') && preview) {
			edit();
			const element = tool.kind === 'Atom' ? tool.element : 'C';
			const start = current.atom ?? nearestAtom(graph, current.world, 12 / scale) ?? addAtom(graph, current.world.x, current.world.y);
			grow(start, preview.to, element);
		}
		preview = undefined;
		arrowPreview = undefined;
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
		const hit = hitTest(world);
		if (hit.block && hit.block.type !== 'Arrow') {
			openInline(hit.block);
			return;
		}
		if (hit.atom) relabel(hit.atom);
	});
	svg.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			closeInline(true);
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

	// ------------------------------------------------------------ the text in the note

	source.addEventListener('input', () => {
		const before = snapshot();
		if (boardMode) {
			const read = readBoardText(source.value, metric);
			if (!read) {
				notice = 'The text has to be one Board: a line "Board:" with its blocks indented under it.';
				render();
				return;
			}
			if (!typing) remember(before);
			board = read;
			graph = board.graph;
		} else {
			if (!typing) remember(before);
			structure = loadStructure(source.value, sceneOption);
			graph = structure.graph;
		}
		selection = new Set();
		blockSelection = new Set();
		hover = {};
		notice = '';
		typing = true;
		render();
	});
	source.addEventListener('blur', () => {
		typing = false;
	});

	// ------------------------------------------------------------ toolbar and keys

	/** Which member each group shows (the last one picked). */
	const groupChoice = new Map<string, string>();
	let flyoutGroup: string | undefined;

	function closeFlyout(): void {
		flyout.hidden = true;
		flyoutGroup = undefined;
	}

	/** Shows a group's tools beside its button (above it when the bar runs along the bottom). */
	function openFlyout(group: ToolGroup): void {
		closeMenu();
		const button = dialog.querySelector<HTMLElement>(`[data-group="${group.id}"]`)!;
		flyout.innerHTML = group.memberList
			.map((member) => `<button type="button" role="menuitem" data-member="${member.id}" title="${escapeXml(member.title)}"${member.id === toolId ? ' class="active"' : ''}>${member.icon}<span>${escapeXml(member.title.split(/[:(]/)[0]!.trim())}</span></button>`)
			.join('');
		for (const item of flyout.querySelectorAll<HTMLButtonElement>('[data-member]')) {
			item.addEventListener('click', () => {
				const member = group.memberList.find((entry) => entry.id === item.dataset.member)!;
				closeFlyout();
				choose(member.id, member.tool);
			});
		}
		flyout.hidden = false;
		flyoutGroup = group.id;
		const main = flyout.parentElement!.getBoundingClientRect();
		const rect = button.getBoundingClientRect();
		const row = getComputedStyle(button.parentElement!).flexDirection === 'row';
		flyout.style.left = `${number(Math.max(4, Math.min((row ? rect.left : rect.right + 6) - main.left, main.width - flyout.offsetWidth - 4)))}px`;
		flyout.style.top = `${number(row ? Math.max(4, rect.top - main.top - flyout.offsetHeight - 6) : Math.max(4, Math.min(rect.top - main.top, main.height - flyout.offsetHeight - 4)))}px`;
	}

	for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-group]')) {
		const group = groupList.find((item): item is ToolGroup => item !== 'Separator' && item.id === button.dataset.group)!;
		let held: number | undefined;
		let opened = false;
		button.addEventListener('pointerdown', () => {
			opened = false;
			window.clearTimeout(held);
			// held down: the group opens, as in Photoshop
			if (group.memberList.length > 1) held = window.setTimeout(() => {
				opened = true;
				openFlyout(group);
			}, 420);
		});
		for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, () => window.clearTimeout(held));
		button.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			if (group.memberList.length > 1) openFlyout(group);
		});
		button.addEventListener('click', () => {
			if (opened) return;
			const member = group.memberList.find((entry) => entry.id === groupChoice.get(group.id)) ?? group.memberList[0]!;
			// a second click on the group in use opens it
			if (groupOf(toolId)?.id === group.id && group.memberList.length > 1) {
				if (flyoutGroup === group.id) closeFlyout();
				else openFlyout(group);
				return;
			}
			closeFlyout();
			choose(member.id, member.tool);
		});
	}

	function choose(id: string, next: Tool, draw = true): void {
		if (id === 'Color' && next.kind === 'Color' && next.color === '') {
			// first the color (each click on the button asks again), then the tool paints with it
			const button = dialog.querySelector<HTMLElement>('[data-group="Color"]');
			const rect = button?.getBoundingClientRect();
			pickColor({ x: rect ? rect.right + 6 : 80, y: rect ? rect.top : 80 }, tool.kind === 'Color' && tool.color.startsWith('#') ? tool.color : undefined, (color) => {
				if (!color) return;
				choose('Color', { kind: 'Color', color }, draw);
			});
			return;
		}
		toolId = id;
		tool = next;
		const group = groupOf(id);
		if (group) {
			groupChoice.set(group.id, id);
			const member = group.memberList.find((entry) => entry.id === id)!;
			const button = dialog.querySelector<HTMLElement>(`[data-group="${group.id}"]`);
			if (button) {
				// a color of your own shows as itself
				const own = next.kind === 'Color' && next.color !== '' ? (option.resolveColor?.(next.color) ?? normalizeHex(next.color)) : undefined;
				button.innerHTML = own ? swatch(own) : member.icon;
				button.title = own && next.kind === 'Color' ? `${next.color}: click an atom, a bond, an arrow, or text to color it; right-click takes the color away` : member.title;
			}
		}
		if (next.kind !== 'Select') {
			selection = new Set();
			blockSelection = new Set();
		}
		if (draw) render();
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
		closeInline(save);
		if (save && dirty) sync();
		closed = true;
		activeChoose = undefined;
		document.removeEventListener('keydown', onKey, true);
		resizeObserver?.disconnect();
		backdrop.remove();
		if (save) {
			const text = currentText();
			if (!boardMode || option.board!.changed || text !== startText) option.onDone(text);
		}
		option.onClose?.();
	};

	dialog.querySelector('[data-action="Undo"]')!.addEventListener('click', () => history('Undo'));
	dialog.querySelector('[data-action="Redo"]')!.addEventListener('click', () => history('Redo'));
	dialog.querySelector('[data-action="Clear"]')!.addEventListener('click', () => {
		if (graph.atomList.length === 0 && blockList().length === 0) return;
		edit();
		graph.atomList = [];
		graph.bondList = [];
		if (board) board.blockList = [];
		selection = new Set();
		blockSelection = new Set();
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
		if (event.target === backdrop && !dirty && currentText() === startText && !option.board?.changed) close(false);
	});

	/** Picks a tool of this mode by its id; false when there is no such tool here. */
	const pickTool = (tool: string | undefined): boolean => {
		const member = tool ? groupList.flatMap((item) => (item === 'Separator' ? [] : item.memberList)).find((entry) => entry.id === tool) : undefined;
		if (!member) return false;
		closeFlyout();
		closeMenu();
		choose(member.id, member.tool);
		return true;
	};
	activeChoose = (tool) => {
		if (pickTool(tool)) render();
	};

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
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
		let used = true;
		if (event.key === 'Escape') {
			// one step at a time: a menu, then what is picked, then the tool
			if (!menu.hidden) closeMenu();
			else if (!flyout.hidden) closeFlyout();
			else if (selection.size > 0 || blockSelection.size > 0) {
				selection = new Set();
				blockSelection = new Set();
			} else close(false);
		} else if (event.key === 'Enter') close(true);
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
		} else if (chemistry && !primary && !event.altKey && hover.atom && hotkeyElement[event.key.toLowerCase()]) {
			edit();
			setElement(hover.atom, hotkeyElement[event.key.toLowerCase()]!);
		} else if (!primary && hover.atom && (event.key === '+' || event.key === '-')) {
			edit();
			hover.atom.charge = Math.max(-3, Math.min(3, hover.atom.charge + (event.key === '+' ? 1 : -1)));
		} else if (!primary && hover.bond && /^[123]$/.test(event.key)) {
			edit();
			hover.bond.order = Number(event.key) as 1 | 2 | 3;
			hover.bond.stereo = 'None';
		} else if (!primary && !event.altKey && pickTool(toolForKey(event))) {
			// a key that picks a tool (nothing to do on what the pointer is over)
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
