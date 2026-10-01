// A Chem block body → a laid-out scene. Units are em with y pointing up.
//
//   \chemfig{…}  molecules      text like H_2O  formulas     \+  plus sign
//   \quad  \qquad  \hspace{2em}             extra space between items
//   \arrow{->[above][below]}[angle,length]   reaction arrow (the scheme turns with the angle)
//   \schemestart … \schemestop               a scheme may span several lines
//   \chemmove{\draw[->](a) .. controls +(90:1cm) and +(90:1cm) .. (b);}
//   Arrow a -> b {Curve: 60, Kind: Fishhook, Color: Danger}     curved electron-pushing arrow
//   Label a {Side: Below}: text with **Markdown** and {Math: x^2}  a text block placed in the drawing
// Each line outside a scheme is a row; rows stack downward. Labels start next to their target and
// step outward until they clear every atom, bond, and arrow (Avoid: False keeps them in place).

import { type PropertyMap, parseFlowMapText } from '@octaether/core-format';
import { type FormulaPiece, formulaWidth, parseFormula } from './formula';
import { type Atom, type Molecule, type Problem, type Span, edgeDistance, parseMolecule } from './molecule';

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PlacedMolecule {
	molecule: Molecule;
	/** Bond length in em and the molecule's translation (em). */
	unit: number;
	dx: number;
	dy: number;
	/** Where `\chemfig{…}` sits in the block source (the drawing tool replaces exactly this). */
	span: Span;
}

export interface PlacedText {
	pieceList: FormulaPiece[];
	/** Left edge and baseline centre (em). */
	x: number;
	y: number;
	width: number;
	span: Span;
	plus: boolean;
}

export type SchemeArrowType = '->' | '<-' | '<->' | '<=>' | '-/>' | '--';

export interface PlacedArrow {
	type: SchemeArrowType;
	from: Point;
	to: Point;
	above: PlacedText | undefined;
	below: PlacedText | undefined;
	span: Span;
}

export interface CurveArrow {
	from: Point;
	control1: Point;
	control2: Point;
	to: Point;
	kind: 'Pair' | 'Fishhook';
	head: 'End' | 'Start' | 'Both';
	color: string | undefined;
	span: Span;
}

export type LabelSide = 'Above' | 'Below' | 'Left' | 'Right' | 'Center';

export interface SceneLabel {
	/** The point of the label box that touches its target: top-centre for Below, bottom-centre for
	 * Above, right-middle for Left, left-middle for Right, the centre for Center. */
	at: Point;
	side: LabelSide;
	content: string;
	contentOffset: number;
	property: PropertyMap;
	span: Span;
	/** Estimated extent (em), used to keep labels clear of the drawing and of each other. */
	box: Box;
}

export interface Scene {
	moleculeList: PlacedMolecule[];
	textList: PlacedText[];
	arrowList: PlacedArrow[];
	curveList: CurveArrow[];
	labelList: SceneLabel[];
	problemList: Problem[];
	box: Box;
}

/** Bond length in em. */
export const defaultBondLength = 2.4;

export interface SceneOption {
	/** Bond length in em (default {@link defaultBondLength}). */
	bondLength?: number;
	/** Labels step clear of the drawing (default true; a label's own `Avoid` wins). */
	avoid?: boolean;
}

type RowItem =
	/** In a scheme, compounds line up on their centres; elsewhere on their first atom, like chemfig in text. */
	| { kind: 'Molecule'; molecule: Molecule; span: Span; inScheme: boolean }
	| { kind: 'Text'; pieceList: FormulaPiece[]; span: Span }
	| { kind: 'Plus'; span: Span }
	| { kind: 'Space'; width: number; span: Span }
	| { kind: 'Arrow'; type: SchemeArrowType; above: FormulaPiece[] | undefined; aboveSpan: Span; below: FormulaPiece[] | undefined; belowSpan: Span; angle: number | undefined; length: number; span: Span };

interface PendingCurve {
	from: string;
	to: string;
	control1: Point | undefined;
	control2: Point | undefined;
	curve: number;
	/** False: the arrow bows to whichever side has fewer atoms. */
	curveGiven: boolean;
	/** TikZ `to[out=α, in=β]`: absolute leaving and arriving angles. */
	outIn?: { out: number; in: number };
	kind: 'Pair' | 'Fishhook';
	head: 'End' | 'Start' | 'Both';
	color: string | undefined;
	span: Span;
}

interface PendingLabel {
	target: string;
	property: PropertyMap;
	content: string;
	contentOffset: number;
	span: Span;
}

function readBraced(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === '\\') {
			index++;
			continue;
		}
		if (text[index] === '{') depth++;
		else if (text[index] === '}' && --depth === 0) return index;
	}
	return -1;
}

const arrowTypeList: readonly SchemeArrowType[] = ['<=>', '<->', '-/>', '->', '<-', '--'];

const symbolMap: Readonly<Record<string, string>> = { Delta: 'Δ', delta: 'δ', Deg: '°', pm: '±', rightarrow: '→', to: '→', nu: 'ν', lambda: 'λ', alpha: 'α', beta: 'β', ominus: '⊖', oplus: '⊕' };

/** Scheme label text → formula pieces ($…$ and \Delta are simplified). */
function labelPiece(text: string): FormulaPiece[] {
	const simple = text.replace(/\$/g, '').replace(/\\([A-Za-z]+)/g, (_, name: string) => symbolMap[name] ?? name);
	return parseFormula(simple);
}

class SceneBuilder {
	readonly problemList: Problem[] = [];
	readonly rowList: RowItem[][] = [[]];
	readonly curveList: PendingCurve[] = [];
	readonly labelList: PendingLabel[] = [];

	constructor(readonly text: string) {}

	report(start: number, end: number, message: string): void {
		this.problemList.push({ start, end, message });
	}

	get row(): RowItem[] {
		return this.rowList[this.rowList.length - 1]!;
	}

	parse(): void {
		const text = this.text;
		let index = 0;
		let inScheme = false;
		let lineStart = true;
		while (index < text.length) {
			const character = text[index]!;
			if (character === '\n') {
				if (!inScheme && this.row.length > 0) this.rowList.push([]);
				index++;
				lineStart = true;
				continue;
			}
			if (character === ' ' || character === '\t') {
				index++;
				continue;
			}
			if (character === '%') {
				while (index < text.length && text[index] !== '\n') index++;
				continue;
			}
			if (lineStart && /^(?:Arrow|Label)\b/.test(text.slice(index))) {
				const end = text.indexOf('\n', index);
				const stop = end < 0 ? text.length : end;
				this.statement(index, stop);
				index = stop;
				continue;
			}
			lineStart = false;
			const rest = text.slice(index);
			if (rest.startsWith('\\chemfig{')) {
				const open = index + '\\chemfig'.length;
				const close = readBraced(text, open);
				if (close < 0) {
					this.report(index, text.length, 'missing "}" after \\chemfig{');
					break;
				}
				const molecule = parseMolecule(text.slice(open + 1, close), open + 1);
				this.problemList.push(...molecule.problemList);
				this.row.push({ kind: 'Molecule', molecule, span: { start: index, end: close + 1 }, inScheme });
				index = close + 1;
				continue;
			}
			if (rest.startsWith('\\schemestart')) {
				inScheme = true;
				index += '\\schemestart'.length;
				continue;
			}
			if (rest.startsWith('\\schemestop')) {
				inScheme = false;
				index += '\\schemestop'.length;
				continue;
			}
			const space = /^\\(?:qquad|quad|hspace\*?\{([^}]*)\})/.exec(rest);
			if (space) {
				const width = space[0] === '\\qquad' ? 2 : space[0] === '\\quad' ? 1 : lengthInEm(space[1]!);
				if (width === undefined) this.report(index, index + space[0].length, 'write a length like \\hspace{2em}');
				else this.row.push({ kind: 'Space', width, span: { start: index, end: index + space[0].length } });
				index += space[0].length;
				continue;
			}
			if (rest.startsWith('\\+')) {
				this.row.push({ kind: 'Plus', span: { start: index, end: index + 2 } });
				index += 2;
				continue;
			}
			if (rest.startsWith('\\arrow')) {
				index = this.arrow(index);
				continue;
			}
			if (rest.startsWith('\\chemmove')) {
				index = this.chemmove(index);
				continue;
			}
			// anything else up to the next space or command is formula text
			const run = /^(?:\\\\|[^\s\\])+/.exec(rest);
			const word = run ? run[0] : character;
			this.row.push({ kind: 'Text', pieceList: parseFormula(word), span: { start: index, end: index + word.length } });
			index += word.length;
		}
		if (this.row.length === 0 && this.rowList.length > 1) this.rowList.pop();
	}

	private arrow(start: number): number {
		const text = this.text;
		let index = start + '\\arrow'.length;
		let type: SchemeArrowType = '->';
		let above: FormulaPiece[] | undefined;
		let below: FormulaPiece[] | undefined;
		let aboveSpan: Span = { start, end: start };
		let belowSpan: Span = { start, end: start };
		if (text[index] === '{') {
			const close = readBraced(text, index);
			const inner = text.slice(index + 1, close < 0 ? text.length : close);
			type = arrowTypeList.find((candidate) => inner.trimStart().startsWith(candidate)) ?? '->';
			let cursor = inner.indexOf(type) + type.length;
			const labelList: { value: string; start: number }[] = [];
			while (inner[cursor] === '[' && labelList.length < 2) {
				let depth = 0;
				let end = cursor;
				for (; end < inner.length; end++) {
					if (inner[end] === '[' || inner[end] === '{') depth++;
					if ((inner[end] === ']' || inner[end] === '}') && --depth === 0) break;
				}
				labelList.push({ value: inner.slice(cursor + 1, end), start: index + 1 + cursor + 1 });
				cursor = end + 1;
			}
			if (labelList[0]?.value) {
				above = labelPiece(labelList[0].value);
				aboveSpan = { start: labelList[0].start, end: labelList[0].start + labelList[0].value.length };
			}
			if (labelList[1]?.value) {
				below = labelPiece(labelList[1].value);
				belowSpan = { start: labelList[1].start, end: labelList[1].start + labelList[1].value.length };
			}
			index = close < 0 ? text.length : close + 1;
		}
		let angle: number | undefined;
		let length = 1;
		if (text[index] === '[') {
			const close = text.indexOf(']', index);
			const [angleText, lengthText] = text.slice(index + 1, close < 0 ? text.length : close).split(',');
			if (angleText && angleText.trim() !== '') angle = Number(angleText.replace(/^:/, '')) || 0;
			if (lengthText && Number(lengthText) > 0) length = Number(lengthText);
			index = close < 0 ? text.length : close + 1;
		}
		this.row.push({ kind: 'Arrow', type, above, aboveSpan, below, belowSpan, angle, length, span: { start, end: index } });
		return index;
	}

	private chemmove(start: number): number {
		const text = this.text;
		let index = start + '\\chemmove'.length;
		if (text[index] === '[') index = text.indexOf(']', index) + 1;
		if (text[index] !== '{') {
			this.report(start, index, '\\chemmove needs {…}');
			return index;
		}
		const close = readBraced(text, index);
		const body = text.slice(index + 1, close < 0 ? text.length : close);
		// \draw[->](a) .. controls +(90:1cm) and +(90:1cm) .. (b);  or  (a) to[out=90,in=90] (b), (a) to[bend left] (b)
		// targets may be TikZ calc points: ($(a)!0.5!(b)$)
		const drawPattern = /\\draw\s*(\[[^\]]*\])?\s*\(/g;
		for (let match = drawPattern.exec(body); match; match = drawPattern.exec(body)) {
			const option = match[1] ?? '';
			const fromOpen = match.index + match[0].length - 1;
			const fromClose = matchParen(body, fromOpen);
			if (fromClose < 0) break;
			const rest = body.slice(fromClose + 1);
			const controls = /^\s*\.\.\s*controls\s*\+\(([^)]+)\)\s*and\s*\+\(([^)]+)\)\s*\.\.\s*\(/.exec(rest);
			const bend = /^\s*to\s*\[([^\]]*)\]\s*\(/.exec(rest);
			const connector = controls ?? bend;
			if (!connector) continue;
			const toOpen = fromClose + connector[0].length;
			const toClose = matchParen(body, toOpen);
			if (toClose < 0) break;
			const matchStart = index + 1 + match.index;
			let control1: Point | undefined;
			let control2: Point | undefined;
			let outIn: { out: number; in: number } | undefined;
			let curve = 0;
			if (controls) {
				control1 = polar(controls[1]!);
				control2 = polar(controls[2]!);
			} else {
				// to[bend left=30] becomes our chord-relative curve; to[out=…, in=…] is kept for placement
				const bendOption = bend![1]!;
				const bendMatch = /bend\s+(left|right)\s*(?:=\s*(-?[\d.]+))?/.exec(bendOption);
				const outMatch = /out\s*=\s*(-?[\d.]+)/.exec(bendOption);
				const inMatch = /in\s*=\s*(-?[\d.]+)/.exec(bendOption);
				if (outMatch && inMatch) outIn = { out: Number(outMatch[1]), in: Number(inMatch[1]) };
				curve = bendMatch ? (bendMatch[1] === 'left' ? 1 : -1) * (Number(bendMatch[2]) || 30) : 40;
			}
			this.curveList.push({
				from: body.slice(fromOpen + 1, fromClose).trim(),
				to: body.slice(toOpen + 1, toClose).trim(),
				control1,
				control2,
				...(outIn ? { outIn } : {}),
				curve,
				curveGiven: true,
				kind: /harpoon|left to|right to/.test(option) ? 'Fishhook' : 'Pair',
				head: option.includes('<->') ? 'Both' : option.includes('<-') ? 'Start' : 'End',
				color: /\b(red|blue|green|orange|purple)\b/.exec(option)?.[1],
				span: { start: matchStart, end: index + 1 + toClose + 1 },
			});
			drawPattern.lastIndex = toClose + 1;
		}
		return close < 0 ? text.length : close + 1;
	}

	private statement(start: number, end: number): void {
		const line = this.text.slice(start, end);
		const arrow = /^Arrow\s+(\S+)\s*->\s*([^\s{]+)\s*(\{.*\})?\s*$/.exec(line);
		if (arrow) {
			const property = arrow[3] ? parseFlowMapText(arrow[3]).value : new Map();
			const curve = property.get('Curve');
			const kind = property.get('Kind');
			const color = property.get('Color');
			this.curveList.push({
				from: arrow[1]!,
				to: arrow[2]!,
				control1: undefined,
				control2: undefined,
				curve: typeof curve === 'number' ? curve : 45,
				curveGiven: typeof curve === 'number',
				kind: kind === 'Fishhook' ? 'Fishhook' : 'Pair',
				head: 'End',
				color: typeof color === 'string' ? color : undefined,
				span: { start, end },
			});
			return;
		}
		const label = /^Label\s+(\([^)]*\)|[^\s{:]+)\s*(\{[^}]*\})?\s*:\s?/.exec(line);
		if (label) {
			const property = label[2] ? parseFlowMapText(label[2]).value : new Map();
			this.labelList.push({ target: label[1]!, property, content: line.slice(label[0].length), contentOffset: start + label[0].length, span: { start, end } });
			return;
		}
		this.report(start, end, 'expected "Arrow a -> b {…}" or "Label a {…}: text"');
	}
}

/** The `)` that closes the `(` at `open`, counting nested parentheses; -1 when there is none. */
function matchParen(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === '(') depth++;
		else if (text[index] === ')' && --depth === 0) return index;
	}
	return -1;
}

/** `2em`, `1cm`, `10pt` → em (1 cm ≈ 2.36 em at a 12 pt font). */
function lengthInEm(text: string): number | undefined {
	const match = /^\s*(-?[\d.]+)\s*(em|ex|cm|mm|pt)?\s*$/.exec(text);
	if (!match) return undefined;
	const factor = { em: 1, ex: 0.45, cm: 2.36, mm: 0.236, pt: 0.1 }[(match[2] ?? 'em') as 'em'];
	const value = Number(match[1]) * factor;
	return Number.isFinite(value) ? value : undefined;
}

/** `90:1cm` → a vector in bond units (1 cm ≈ 0.94 bonds, as in chemfig). */
function polar(text: string): Point | undefined {
	const match = /^\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)\s*(cm|mm|pt|em)?\s*$/.exec(text);
	if (!match) return undefined;
	const angle = (Number(match[1]) * Math.PI) / 180;
	const factor = { cm: 0.94, mm: 0.094, pt: 0.033, em: 0.33 }[(match[3] ?? 'cm') as 'cm'] ?? 0.94;
	const length = Number(match[2]) * factor;
	return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
}

// ---------------------------------------------------------------- layout

function emptyBox(): Box {
	return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function grow(box: Box, x: number, y: number): void {
	box.minX = Math.min(box.minX, x);
	box.minY = Math.min(box.minY, y);
	box.maxX = Math.max(box.maxX, x);
	box.maxY = Math.max(box.maxY, y);
}

export function atomBox(atom: Atom, unit: number, dx: number, dy: number): Box {
	const x = atom.x * unit + dx;
	const y = atom.y * unit + dy;
	if (atom.label === '') return { minX: x, minY: y, maxX: x, maxY: y };
	return { minX: x - atom.anchor, minY: y - 0.5, maxX: x - atom.anchor + atom.width, maxY: y + 0.5 };
}

function moleculeBox(molecule: Molecule, unit: number): Box {
	const box = emptyBox();
	for (const atom of molecule.atomList) {
		const atomExtent = atomBox(atom, unit, 0, 0);
		grow(box, atomExtent.minX, atomExtent.minY);
		grow(box, atomExtent.maxX, atomExtent.maxY);
	}
	for (const ring of molecule.ringList) {
		grow(box, (ring.x - ring.radius) * unit, (ring.y - ring.radius) * unit);
		grow(box, (ring.x + ring.radius) * unit, (ring.y + ring.radius) * unit);
	}
	if (box.minX === Infinity) return { minX: 0, minY: -0.5, maxX: 0.5, maxY: 0.5 };
	return box;
}

/** Glyph extent of a placed text line (y = baseline). */
function textBox(text: PlacedText, size: number): Box {
	return { minX: text.x, minY: text.y - 0.22 * size, maxX: text.x + text.width * size, maxY: text.y + 0.75 * size };
}

interface Placed {
	moleculeList: PlacedMolecule[];
	textList: PlacedText[];
	arrowList: PlacedArrow[];
	box: Box;
}

/** Space between neighbouring items in a row (em). */
const itemGap = 0.7;

function layoutRow(itemList: readonly RowItem[], unit: number): Placed {
	const placed: Placed = { moleculeList: [], textList: [], arrowList: [], box: emptyBox() };
	let cursor: Point = { x: 0, y: 0 };
	let direction = 0;
	// no gap before the first item
	let empty = true;
	const step = (distance: number): Point => {
		const radian = (direction * Math.PI) / 180;
		return { x: cursor.x + Math.cos(radian) * distance, y: cursor.y + Math.sin(radian) * distance };
	};
	const along = (width: number, height: number): number => {
		const radian = (direction * Math.PI) / 180;
		return Math.abs(Math.cos(radian)) * width + Math.abs(Math.sin(radian)) * height;
	};
	/** Returns the centre of an item of this size placed after the cursor. */
	const placeBox = (width: number, height: number): Point => {
		if (!empty) cursor = step(itemGap);
		empty = false;
		const extent = along(width, height);
		const center = step(extent / 2);
		cursor = step(extent);
		return center;
	};
	for (const item of itemList) {
		if (item.kind === 'Space') {
			cursor = step(item.width);
			continue;
		}
		if (item.kind === 'Arrow') {
			if (item.angle !== undefined) direction = item.angle;
			const labelWidth = Math.max(item.above ? formulaWidth(item.above) * 0.72 : 0, item.below ? formulaWidth(item.below) * 0.72 : 0);
			const length = Math.max(3.2 * item.length, labelWidth + 1.4);
			if (!empty) cursor = step(itemGap);
			empty = false;
			const from = cursor;
			const to = step(length);
			cursor = to;
			const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
			const radian = (direction * Math.PI) / 180;
			const normal = { x: -Math.sin(radian), y: Math.cos(radian) };
			const text = (pieceList: FormulaPiece[] | undefined, span: Span, side: number): PlacedText | undefined => {
				if (!pieceList) return undefined;
				const width = formulaWidth(pieceList) * 0.72;
				// distance from the arrow to the text's centre line, then down to its baseline
				const offset = side * 0.55;
				return { pieceList, x: middle.x + normal.x * offset - width / 2, y: middle.y + normal.y * offset - 0.22, width, span, plus: false };
			};
			const arrow: PlacedArrow = { type: item.type, from, to, above: text(item.above, item.aboveSpan, 1), below: text(item.below, item.belowSpan, -1), span: item.span };
			placed.arrowList.push(arrow);
			grow(placed.box, from.x, from.y);
			grow(placed.box, to.x, to.y);
			for (const label of [arrow.above, arrow.below]) {
				if (!label) continue;
				grow(placed.box, label.x, label.y - 0.2);
				grow(placed.box, label.x + label.width, label.y + 0.6);
			}
			continue;
		}
		if (item.kind === 'Plus' || item.kind === 'Text') {
			const pieceList = item.kind === 'Plus' ? [{ text: '+', kind: 'Normal' as const, start: 0, end: 2 }] : item.pieceList;
			const width = formulaWidth(pieceList);
			const center = placeBox(width, 1);
			const text: PlacedText = { pieceList, x: center.x - width / 2, y: center.y - 0.35, width, span: item.span, plus: item.kind === 'Plus' };
			placed.textList.push(text);
			grow(placed.box, text.x, center.y - 0.55);
			grow(placed.box, text.x + width, center.y + 0.55);
			continue;
		}
		const extent = moleculeBox(item.molecule, unit);
		const width = extent.maxX - extent.minX;
		const height = extent.maxY - extent.minY;
		const center = placeBox(width, height);
		const dx = center.x - (extent.minX + width / 2);
		// the first atom sits at the molecule's origin, so outside a scheme it lands on the row's line
		const dy = item.inScheme || direction !== 0 ? center.y - (extent.minY + height / 2) : center.y;
		placed.moleculeList.push({ molecule: item.molecule, unit, dx, dy, span: item.span });
		grow(placed.box, extent.minX + dx, extent.minY + dy);
		grow(placed.box, extent.maxX + dx, extent.maxY + dy);
	}
	return placed;
}

/** Something a name points at: an atom, the middle of a bond, or a plain point. */
/** Something a name points at: an atom, the middle of a bond, a lone pair, or a plain point. */
interface Target {
	point: Point;
	atom: Atom | undefined;
	kind: 'Atom' | 'Bond' | 'Point';
	/** `o.lp` (the lone pair facing the other end) or `o.lp2` (the one at 2 × 45°). */
	lonePair?: { angle: number | undefined };
}

/**
 * Resolves an arrow or label target:
 *   c            a named atom or bond            (1, 2)   a point (bond units)
 *   c.north      a point on the atom's edge      c.45     the same, at 45°
 *   o.lp         the lone pair facing the other end of the arrow; o.lp2 = the one at 2 × 45°
 *   a!0.5!b      halfway from a to b, where a new bond forms (TikZ calc: ($(a)!0.5!(b)$) works too)
 */
function resolveTarget(name: string, nameMap: ReadonlyMap<string, Target>, unit: number): Target | undefined {
	let text = name.replace(/\$/g, '').trim();
	const coordinate = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(text);
	if (coordinate) return { point: { x: Number(coordinate[1]) * unit, y: Number(coordinate[2]) * unit }, atom: undefined, kind: 'Point' };
	while (text.startsWith('(') && text.endsWith(')') && text.includes('!') && matchParen(text, 0) === text.length - 1) text = text.slice(1, -1).trim();
	const between = /^\(?\s*([^()!]+?)\s*\)?\s*!\s*(-?[\d.]+)\s*!\s*\(?\s*([^()!]+?)\s*\)?$/.exec(text);
	if (between) {
		const from = resolveTarget(between[1]!, nameMap, unit);
		const to = resolveTarget(between[3]!, nameMap, unit);
		const share = Number(between[2]);
		if (!from || !to || !Number.isFinite(share)) return undefined;
		return { point: { x: from.point.x + (to.point.x - from.point.x) * share, y: from.point.y + (to.point.y - from.point.y) * share }, atom: undefined, kind: 'Point' };
	}
	const [base, suffix] = text.replace(/^\(|\)$/g, '').split('.');
	const target = nameMap.get(base!);
	if (!target) return undefined;
	if (!suffix) return target;
	const lonePair = /^lp(\d)?$/.exec(suffix);
	if (lonePair) {
		if (!target.atom) return undefined;
		return { ...target, lonePair: { angle: lonePair[1] === undefined ? undefined : (Number(lonePair[1]) % 8) * 45 } };
	}
	// a.north, a.east, a.45: a point on the atom's edge
	const directionMap: Readonly<Record<string, number>> = { east: 0, north: 90, west: 180, south: 270 };
	const degree = directionMap[suffix] ?? Number(suffix);
	if (!Number.isFinite(degree)) return undefined;
	const radian = (degree * Math.PI) / 180;
	const distance = clearance(target, { x: target.point.x + Math.cos(radian), y: target.point.y + Math.sin(radian) }) - 0.1;
	return { point: { x: target.point.x + Math.cos(radian) * distance, y: target.point.y + Math.sin(radian) * distance }, atom: undefined, kind: 'Point' };
}

/** How far from the target's point a line toward `toward` should start so it clears the target. */
function clearance(target: Target, toward: Point): number {
	if (target.kind === 'Point') return 0;
	if (target.kind === 'Bond') return 0.12;
	const atom = target.atom!;
	if (atom.label === '') return 0.15;
	const dx = toward.x - target.point.x;
	const dy = toward.y - target.point.y;
	const length = Math.hypot(dx, dy) || 1;
	// the label box around the main atom's centre, then a little air
	return edgeDistance(atom, dx / length, dy / length) + 0.1;
}

/** Where an arrow starts from a lone pair: just beyond the two dots, on the side of the pair. */
function lonePairPoint(target: Target, other: Point): Point {
	const atom = target.atom!;
	const toward = Math.atan2(other.y - target.point.y, other.x - target.point.x);
	const wanted = target.lonePair?.angle;
	const pairList = atom.electronList.filter((group) => group.kind !== 'Bar');
	let angle: number;
	if (wanted !== undefined) angle = (wanted * Math.PI) / 180;
	else if (pairList.length > 0) {
		// the pair that faces the other end
		const best = [...pairList].sort((left, right) => Math.cos((right.angle * Math.PI) / 180 - toward) - Math.cos((left.angle * Math.PI) / 180 - toward))[0]!;
		angle = (best.angle * Math.PI) / 180;
	} else angle = toward;
	const ux = Math.cos(angle);
	const uy = Math.sin(angle);
	const distance = edgeDistance(atom, ux, uy) + 0.34;
	return { x: target.point.x + ux * distance, y: target.point.y + uy * distance };
}

// Labels move along one axis until they are clear. The side is turned into (u, v) coordinates
// where v grows away from the target, so one routine serves all four sides.

type Obstacle = { kind: 'Box'; box: Box } | { kind: 'Segment'; from: Point; to: Point };

const toSide: Readonly<Record<Exclude<LabelSide, 'Center'>, (point: Point) => { u: number; v: number }>> = {
	Below: (point) => ({ u: point.x, v: -point.y }),
	Above: (point) => ({ u: point.x, v: point.y }),
	Left: (point) => ({ u: point.y, v: -point.x }),
	Right: (point) => ({ u: point.y, v: point.x }),
};

const fromSide: Readonly<Record<Exclude<LabelSide, 'Center'>, (u: number, v: number) => Point>> = {
	Below: (u, v) => ({ x: u, y: -v }),
	Above: (u, v) => ({ x: u, y: v }),
	Left: (u, v) => ({ x: -v, y: u }),
	Right: (u, v) => ({ x: v, y: u }),
};

/** The v-range of an obstacle's part that lies within u ∈ [low, high], if any. */
function extentWithin(obstacle: Obstacle, side: Exclude<LabelSide, 'Center'>, low: number, high: number): [number, number] | undefined {
	const map = toSide[side];
	if (obstacle.kind === 'Box') {
		const a = map({ x: obstacle.box.minX, y: obstacle.box.minY });
		const b = map({ x: obstacle.box.maxX, y: obstacle.box.maxY });
		if (Math.max(a.u, b.u) < low || Math.min(a.u, b.u) > high) return undefined;
		return [Math.min(a.v, b.v), Math.max(a.v, b.v)];
	}
	const a = map(obstacle.from);
	const b = map(obstacle.to);
	let start = 0;
	let end = 1;
	const du = b.u - a.u;
	if (Math.abs(du) < 1e-9) {
		if (a.u < low || a.u > high) return undefined;
	} else {
		const first = (low - a.u) / du;
		const second = (high - a.u) / du;
		start = Math.max(start, Math.min(first, second));
		end = Math.min(end, Math.max(first, second));
		if (start > end) return undefined;
	}
	const v1 = a.v + (b.v - a.v) * start;
	const v2 = a.v + (b.v - a.v) * end;
	return [Math.min(v1, v2), Math.max(v1, v2)];
}

function sceneObstacleList(scene: Scene): Obstacle[] {
	const list: Obstacle[] = [];
	for (const { molecule, unit, dx, dy } of scene.moleculeList) {
		const at = (atom: Atom): Point => ({ x: atom.x * unit + dx, y: atom.y * unit + dy });
		for (const atom of molecule.atomList) if (atom.label !== '') list.push({ kind: 'Box', box: atomBox(atom, unit, dx, dy) });
		for (const bond of molecule.bondList) if (!bond.hidden) list.push({ kind: 'Segment', from: at(molecule.atomList[bond.from]!), to: at(molecule.atomList[bond.to]!) });
	}
	for (const text of scene.textList) list.push({ kind: 'Box', box: textBox(text, 1) });
	for (const arrow of scene.arrowList) {
		list.push({ kind: 'Segment', from: arrow.from, to: arrow.to });
		for (const text of [arrow.above, arrow.below]) if (text) list.push({ kind: 'Box', box: textBox(text, 0.72) });
	}
	for (const curve of scene.curveList) {
		let previous = curve.from;
		for (let index = 1; index <= 16; index++) {
			const t = index / 16;
			const s = 1 - t;
			const point = {
				x: s * s * s * curve.from.x + 3 * s * s * t * curve.control1.x + 3 * s * t * t * curve.control2.x + t * t * t * curve.to.x,
				y: s * s * s * curve.from.y + 3 * s * s * t * curve.control1.y + 3 * s * t * t * curve.control2.y + t * t * t * curve.to.y,
			};
			list.push({ kind: 'Segment', from: previous, to: point });
			previous = point;
		}
	}
	return list;
}

/** Rough size of a label's text (em): 0.85em type, wrapping at 14em (see .oi-chem-label). */
function estimateLabel(content: string): { width: number; height: number } {
	const plain = content.replace(/\{[A-Z][A-Za-z]*(?:\s*\{[^}]*\})?\s*:\s*/g, '').replace(/[*_=`$[\]{}\\]/g, '');
	const lineWidth = Math.max(plain.length, 1) * 0.47 * 0.85;
	const maxWidth = 14;
	const lineCount = Math.max(1, Math.ceil(lineWidth / maxWidth));
	return { width: Math.min(lineWidth, maxWidth) + 0.2, height: lineCount * 1.35 * 0.85 + 0.1 };
}

function placeLabel(label: PendingLabel, target: Target, obstacleList: Obstacle[], avoidByDefault = true): SceneLabel {
	const sideValue = label.property.get('Side');
	const side: LabelSide = sideValue === 'Above' || sideValue === 'Left' || sideValue === 'Right' || sideValue === 'Center' ? sideValue : 'Below';
	const gapValue = label.property.get('Gap');
	const gap = typeof gapValue === 'number' ? gapValue : 0.3;
	const { width, height } = estimateLabel(label.content);
	const base = { content: label.content, contentOffset: label.contentOffset, property: label.property, span: label.span };
	if (side === 'Center') {
		const at = target.point;
		return { ...base, at, side, box: { minX: at.x - width / 2, minY: at.y - height / 2, maxX: at.x + width / 2, maxY: at.y + height / 2 } };
	}
	const map = toSide[side];
	const across = side === 'Below' || side === 'Above' ? width : height;
	const depth = side === 'Below' || side === 'Above' ? height : width;
	const center = map(target.point).u;
	// start just past the target itself (its label box, when it has one)
	let near = map(target.point).v;
	if (target.atom && target.atom.label !== '') {
		const box = atomBox(target.atom, 1, target.point.x - target.atom.x, target.point.y - target.atom.y);
		near = Math.max(map({ x: box.minX, y: box.minY }).v, map({ x: box.maxX, y: box.maxY }).v) - 0.08;
	}
	near += gap;
	if (label.property.has('Avoid') ? label.property.get('Avoid') !== false : avoidByDefault) {
		const pad = 0.12;
		for (let round = 0; round < 200; round++) {
			let beyond = -Infinity;
			for (const obstacle of obstacleList) {
				const range = extentWithin(obstacle, side, center - across / 2 - pad, center + across / 2 + pad);
				if (range && range[1] > near - pad && range[0] < near + depth + pad) beyond = Math.max(beyond, range[1]);
			}
			if (beyond === -Infinity) break;
			near = beyond + gap;
		}
	}
	const back = fromSide[side];
	const at = back(center, near);
	const cornerA = back(center - across / 2, near);
	const cornerB = back(center + across / 2, near + depth);
	const box = { minX: Math.min(cornerA.x, cornerB.x), minY: Math.min(cornerA.y, cornerB.y), maxX: Math.max(cornerA.x, cornerB.x), maxY: Math.max(cornerA.y, cornerB.y) };
	return { ...base, at, side, box };
}

function rotate(vector: Point, degree: number): Point {
	const radian = (degree * Math.PI) / 180;
	return { x: vector.x * Math.cos(radian) - vector.y * Math.sin(radian), y: vector.x * Math.sin(radian) + vector.y * Math.cos(radian) };
}

function placeCurve(curve: PendingCurve, fromTarget: Target, toTarget: Target, unit: number, atomPointList: readonly Point[]): CurveArrow {
	// an arrow from a lone pair starts at the pair's dots
	let from = fromTarget;
	let to = toTarget;
	if (from.lonePair) from = { point: lonePairPoint(from, to.point), atom: undefined, kind: 'Point' };
	if (to.lonePair) to = { point: lonePairPoint(to, from.point), atom: undefined, kind: 'Point' };
	let control1: Point;
	let control2: Point;
	const chord = { x: to.point.x - from.point.x, y: to.point.y - from.point.y };
	const chordLength = Math.hypot(chord.x, chord.y) || 1;
	if (curve.control1 && curve.control2) {
		control1 = { x: from.point.x + curve.control1.x * unit, y: from.point.y + curve.control1.y * unit };
		control2 = { x: to.point.x + curve.control2.x * unit, y: to.point.y + curve.control2.y * unit };
	} else if (curve.outIn) {
		// TikZ's to[out, in]: control points 0.39 of the chord away, at the given angles
		const reach = chordLength * 0.3915;
		const outAngle = (curve.outIn.out * Math.PI) / 180;
		const inAngle = (curve.outIn.in * Math.PI) / 180;
		control1 = { x: from.point.x + Math.cos(outAngle) * reach, y: from.point.y + Math.sin(outAngle) * reach };
		control2 = { x: to.point.x + Math.cos(inAngle) * reach, y: to.point.y + Math.sin(inAngle) * reach };
	} else {
		// short hops (a bond to its own atom) still get a visible arc
		const arm = Math.max(0.42, 1.4 / chordLength);
		const controlFor = (degree: number): [Point, Point] => {
			const first = rotate(chord, degree);
			const second = rotate({ x: -chord.x, y: -chord.y }, -degree);
			return [
				{ x: from.point.x + first.x * arm, y: from.point.y + first.y * arm },
				{ x: to.point.x + second.x * arm, y: to.point.y + second.y * arm },
			];
		};
		let degree = curve.curve;
		if (!curve.curveGiven) {
			// no Curve given: bow to the side with fewer atoms, so the arrow never cuts through the molecule
			const crowd = (side: number): number => {
				const [a, b] = controlFor(side * 45);
				const apex = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
				return atomPointList.reduce((sum, point) => sum + 1 / Math.max((point.x - apex.x) ** 2 + (point.y - apex.y) ** 2, 0.05), 0);
			};
			degree = crowd(-1) < crowd(1) - 1e-9 ? -45 : 45;
		}
		[control1, control2] = controlFor(degree);
	}
	// start and end just outside the atoms so the arrow never covers them
	const away = (target: Target, toward: Point): Point => {
		const distance = clearance(target, toward);
		const length = Math.hypot(toward.x - target.point.x, toward.y - target.point.y) || 1;
		return { x: target.point.x + ((toward.x - target.point.x) / length) * distance, y: target.point.y + ((toward.y - target.point.y) / length) * distance };
	};
	return { from: away(from, control1), control1, control2, to: away(to, control2), kind: curve.kind, head: curve.head, color: curve.color, span: curve.span };
}

/** A plain `(x, y)` point: placed after every row, since it doesn't belong to one. */
const isCoordinate = (name: string): boolean => /^\(\s*-?[\d.]+\s*,/.test(name);

export function buildScene(text: string, option: SceneOption = {}): Scene {
	const unit = option.bondLength ?? defaultBondLength;
	const builder = new SceneBuilder(text);
	builder.parse();
	const scene: Scene = { moleculeList: [], textList: [], arrowList: [], curveList: [], labelList: [], problemList: builder.problemList, box: emptyBox() };
	const nameMap = new Map<string, Target>();
	const labelBoxList: Obstacle[] = [];
	const atomPointList = (): Point[] =>
		scene.moleculeList.flatMap(({ molecule, unit: scale, dx, dy }) => molecule.atomList.map((atom) => ({ x: atom.x * scale + dx, y: atom.y * scale + dy })));
	let pendingCurveList = [...builder.curveList];
	let pendingLabelList = [...builder.labelList];

	/** Places the curved arrows and labels whose names are known by now; returns their extent. */
	const placeReady = (final: boolean): Box => {
		const box = emptyBox();
		pendingCurveList = pendingCurveList.filter((curve) => {
			if (!final && (isCoordinate(curve.from) || isCoordinate(curve.to))) return true;
			const from = resolveTarget(curve.from, nameMap, unit);
			const to = resolveTarget(curve.to, nameMap, unit);
			if (!from || !to) {
				if (final) builder.report(curve.span.start, curve.span.end, `unknown name "${!from ? curve.from : curve.to}" (name atoms with @{name})`);
				return !final;
			}
			const arrow = placeCurve(curve, from, to, unit, atomPointList());
			scene.curveList.push(arrow);
			for (const point of [arrow.from, arrow.to, arrow.control1, arrow.control2]) grow(box, point.x, point.y);
			return false;
		});
		const obstacleList = [...sceneObstacleList(scene), ...labelBoxList];
		pendingLabelList = pendingLabelList.filter((label) => {
			if (!final && isCoordinate(label.target)) return true;
			const target = resolveTarget(label.target, nameMap, unit);
			if (!target) {
				if (final) builder.report(label.span.start, label.span.end, `unknown name "${label.target}" (name atoms with @{name}, or use (x, y))`);
				return !final;
			}
			const placed = placeLabel(label, target, obstacleList, option.avoid !== false);
			scene.labelList.push(placed);
			// later labels keep clear of this one too
			obstacleList.push({ kind: 'Box', box: placed.box });
			labelBoxList.push({ kind: 'Box', box: placed.box });
			grow(box, placed.box.minX, placed.box.minY);
			grow(box, placed.box.maxX, placed.box.maxY);
			return false;
		});
		return box;
	};

	// rows stack downward, left-aligned; each row's arrows and labels are placed before the next
	// row, so a caption under one step never runs into the step below it
	let top = 0;
	for (const row of builder.rowList) {
		if (row.length === 0) continue;
		const placed = layoutRow(row, unit);
		if (placed.box.minX === Infinity) continue;
		const dx = -placed.box.minX;
		const dy = top - placed.box.maxY;
		for (const molecule of placed.moleculeList) {
			const shifted = { ...molecule, dx: molecule.dx + dx, dy: molecule.dy + dy };
			scene.moleculeList.push(shifted);
			const { molecule: parsed, unit: scale } = shifted;
			for (const atom of parsed.atomList) if (atom.name) nameMap.set(atom.name, { point: { x: atom.x * scale + shifted.dx, y: atom.y * scale + shifted.dy }, atom, kind: 'Atom' });
			for (const bond of parsed.bondList) {
				if (!bond.name) continue;
				const from = parsed.atomList[bond.from]!;
				const to = parsed.atomList[bond.to]!;
				nameMap.set(bond.name, { point: { x: ((from.x + to.x) / 2) * scale + shifted.dx, y: ((from.y + to.y) / 2) * scale + shifted.dy }, atom: undefined, kind: 'Bond' });
			}
		}
		for (const item of placed.textList) scene.textList.push({ ...item, x: item.x + dx, y: item.y + dy });
		for (const arrow of placed.arrowList) {
			const shift = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
			const shiftText = (label: PlacedText | undefined): PlacedText | undefined => (label ? { ...label, x: label.x + dx, y: label.y + dy } : undefined);
			scene.arrowList.push({ ...arrow, from: shift(arrow.from), to: shift(arrow.to), above: shiftText(arrow.above), below: shiftText(arrow.below) });
		}
		const rowBox: Box = { minX: placed.box.minX + dx, minY: placed.box.minY + dy, maxX: placed.box.maxX + dx, maxY: placed.box.maxY + dy };
		const extra = placeReady(false);
		if (extra.minX !== Infinity) {
			grow(rowBox, extra.minX, extra.minY);
			grow(rowBox, extra.maxX, extra.maxY);
		}
		grow(scene.box, rowBox.minX, rowBox.minY);
		grow(scene.box, rowBox.maxX, rowBox.maxY);
		top = rowBox.minY - 1.4;
	}
	const rest = placeReady(true);
	if (rest.minX !== Infinity) {
		grow(scene.box, rest.minX, rest.minY);
		grow(scene.box, rest.maxX, rest.maxY);
	}
	if (scene.box.minX === Infinity) scene.box = { minX: 0, minY: -0.5, maxX: 1, maxY: 0.5 };
	const pad = 0.35;
	scene.box = { minX: scene.box.minX - pad, minY: scene.box.minY - pad, maxX: scene.box.maxX + pad, maxY: scene.box.maxY + pad };
	return scene;
}
