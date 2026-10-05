// chemfig-compatible molecule parser + layout, written from zero.
//   bonds   - = ~  > <  >: <:  >| <|         options [angle, length, from, to, style]
//   style   dashed / dotted (partial bonds), a color name or theme color: -[,,,,dashed]
//   angle   [2] (×45°)  [:30] (absolute)  [::30] (relative to the previous bond)
//   branch  (…)   ring *6(…)  aromatic **6(…)   name @{name}   ring closure ?[a]
// Geometry is in bond units with y pointing up; every atom and bond keeps its source span.

import { characterWidth } from './formula';

export interface Span {
	start: number;
	end: number;
}

export interface Problem {
	start: number;
	end: number;
	message: string;
}

export interface LabelPiece {
	text: string;
	kind: 'Normal' | 'Sub' | 'Sup';
}

/** Electrons drawn around an atom (chemfig's \lewis): a lone pair, a single electron (radical), or a bar. */
export interface ElectronGroup {
	/** Direction in degrees (0 = right, 90 = up), a multiple of 45 as in chemfig. */
	angle: number;
	kind: 'Pair' | 'Single' | 'Bar';
}

export interface Atom {
	index: number;
	/** Raw label text (`H_3C`, `\lewis{0:,O}H`); '' for a skeleton vertex. */
	label: string;
	pieceList: LabelPiece[];
	/** Lone pairs and single electrons (from `\lewis{…,X}`). */
	electronList: ElectronGroup[];
	x: number;
	y: number;
	span: Span;
	name?: string;
	/** Horizontal offset (em) from the label's left edge to the centre of its main atom. */
	anchor: number;
	/** Label width in em. */
	width: number;
}

export type BondKind = 'Single' | 'Double' | 'Triple' | 'WedgeFront' | 'WedgeBack' | 'DashFront' | 'DashBack' | 'HollowFront' | 'HollowBack';

export interface Bond {
	from: number;
	to: number;
	kind: BondKind;
	span: Span;
	name?: string;
	/** Ring centre, so a ring's double bond draws its second line inside the ring. */
	ringCenter?: { x: number; y: number };
	/** Partial bond (transition states); a double bond dashes only its second line. */
	dash?: 'Dashed' | 'Dotted';
	/** `draw=none`: keeps two fragments where they are without drawing a bond. */
	hidden?: boolean;
	/** A CSS color name or a theme color (Accent, Danger, …). */
	color?: string;
}

export interface Ring {
	x: number;
	y: number;
	radius: number;
	aromatic: boolean;
	span: Span;
}

export interface Molecule {
	atomList: Atom[];
	bondList: Bond[];
	ringList: Ring[];
	problemList: Problem[];
}

const symbolMap: Readonly<Record<string, string>> = { oplus: '⊕', ominus: '⊖', bullet: '•', cdot: '·', delta: 'δ', Delta: 'Δ', ddagger: '‡', circ: '°', pm: '±' };

const lewisPattern = /\\[Ll]ewis\{([^,{}]*),([^{}]*)\}/g;

/**
 * chemfig's `\lewis{0:2.4|,O}`: each digit is a direction (× 45°) followed by `:` (a lone pair, the
 * default), `.` (one electron), or `|` (a bar). Returns the label without the wrapper, and the electrons.
 */
export function splitLewis(label: string): { label: string; electronList: ElectronGroup[] } {
	const electronList: ElectronGroup[] = [];
	const clean = label.replace(lewisPattern, (_, spec: string, atom: string) => {
		for (const match of spec.matchAll(/(\d)([:.|]?)/g)) {
			electronList.push({ angle: (Number(match[1]) % 8) * 45, kind: match[2] === '.' ? 'Single' : match[2] === '|' ? 'Bar' : 'Pair' });
		}
		return atom;
	});
	return { label: clean, electronList };
}

/** How far from an atom's centre (em, along the unit vector ux, uy) its label ends; small for a bare vertex. */
export function edgeDistance(atom: Atom, ux: number, uy: number): number {
	if (atom.label === '' || atom.pieceList.length === 0) return 0.1;
	let distance = Infinity;
	if (ux > 1e-6) distance = Math.min(distance, (atom.width - atom.anchor) / ux);
	if (ux < -1e-6) distance = Math.min(distance, -atom.anchor / ux);
	if (uy > 1e-6) distance = Math.min(distance, 0.42 / uy);
	if (uy < -1e-6) distance = Math.min(distance, -0.42 / uy);
	return Number.isFinite(distance) ? distance : 0.42;
}

/** `H_3C`, `CO_2H`, `O^{-}`, `\oplus` → display pieces. */
export function labelPieceList(label: string): LabelPiece[] {
	const pieceList: LabelPiece[] = [];
	const push = (text: string, kind: LabelPiece['kind']): void => {
		const last = pieceList[pieceList.length - 1];
		if (last && last.kind === kind) last.text += text;
		else pieceList.push({ text, kind });
	};
	let index = 0;
	const readGroup = (): string => {
		if (label[index] === '{') {
			let depth = 1;
			const start = ++index;
			while (index < label.length && depth > 0) {
				if (label[index] === '{') depth++;
				else if (label[index] === '}') depth--;
				index++;
			}
			return label.slice(start, index - 1);
		}
		return label[index++] ?? '';
	};
	while (index < label.length) {
		const character = label[index]!;
		if (character === '_' || character === '^') {
			index++;
			const group = readGroup().replace(/\\(\w+)/g, (_, name: string) => symbolMap[name] ?? '').replace(/-/g, '−');
			push(group, character === '_' ? 'Sub' : 'Sup');
			continue;
		}
		if (character === '\\') {
			const name = /^\\([A-Za-z]+)/.exec(label.slice(index));
			index += name ? name[0].length : 1;
			if (name && symbolMap[name[1]!]) push(symbolMap[name[1]!]!, 'Sup');
			// \charge{…}{X} and similar: keep the last group as the text
			while (label[index] === '{') {
				const group = readGroup();
				if (label[index] !== '{') push(group, 'Normal');
			}
			continue;
		}
		if (character === '{' || character === '}') {
			index++;
			continue;
		}
		push(character, 'Normal');
		index++;
	}
	return pieceList;
}

/** Width of a label and the centre of its main atom (first non-hydrogen element). */
export function measureLabel(pieceList: readonly LabelPiece[]): { width: number; anchor: number } {
	let width = 0;
	let anchor: number | undefined;
	let firstCenter: number | undefined;
	for (const piece of pieceList) {
		const scale = piece.kind === 'Normal' ? 1 : 0.7;
		if (piece.kind !== 'Normal') {
			for (const character of piece.text) width += characterWidth(character) * scale;
			continue;
		}
		const text = piece.text;
		for (let index = 0; index < text.length; index++) {
			const character = text[index]!;
			if (/[A-Z]/.test(character)) {
				const symbol = /^[A-Z][a-z]?/.exec(text.slice(index))![0];
				let symbolWidth = 0;
				for (const letter of symbol) symbolWidth += characterWidth(letter);
				const center = width + symbolWidth / 2;
				firstCenter ??= center;
				if (anchor === undefined && symbol !== 'H') anchor = center;
				width += symbolWidth;
				index += symbol.length - 1;
				continue;
			}
			width += characterWidth(character);
		}
	}
	return { width, anchor: anchor ?? firstCenter ?? width / 2 };
}

interface Options {
	angle: string | undefined;
	length: number;
	style: Pick<Bond, 'dash' | 'color' | 'hidden'>;
}

/** The TikZ part of bond options: `dashed`, `dotted`, `dash pattern=…`, `red`, `Accent`. */
function bondStyle(text: string): Pick<Bond, 'dash' | 'color' | 'hidden'> {
	const style: Pick<Bond, 'dash' | 'color' | 'hidden'> = {};
	for (const raw of text.split(',')) {
		const word = raw.trim();
		if (/^draw\s*=\s*none$/.test(word)) style.hidden = true;
		else if (/^(?:dashed|densely dashed|loosely dashed|dash pattern\s*=.*|Dashed)$/.test(word)) style.dash = 'Dashed';
		else if (/^(?:dotted|densely dotted|loosely dotted|Dotted)$/.test(word)) style.dash = 'Dotted';
		else if (/^(?:color\s*=\s*)?([A-Za-z]+)$/.test(word)) style.color = /([A-Za-z]+)$/.exec(word)![1];
	}
	return style;
}

const bondPattern = /^(?:>:|<:|>\||<\||-|=|~|>|<)/;
const bondKindMap: Readonly<Record<string, BondKind>> = {
	'-': 'Single', '=': 'Double', '~': 'Triple', '>': 'WedgeFront', '<': 'WedgeBack', '>:': 'DashFront', '<:': 'DashBack', '>|': 'HollowFront', '<|': 'HollowBack',
};

function radian(degree: number): number {
	return (degree * Math.PI) / 180;
}

class MoleculeParser {
	position = 0;
	readonly atomList: Atom[] = [];
	readonly bondList: Bond[] = [];
	readonly ringList: Ring[] = [];
	readonly problemList: Problem[] = [];
	private readonly hookMap = new Map<string, number>();
	private pendingName: string | undefined;
	private baseAngle = 0;

	constructor(
		readonly text: string,
		readonly offset: number,
	) {}

	parse(): Molecule {
		this.skipSpace();
		if (this.peek() === '[') {
			const option = this.readOptions();
			if (option.angle !== undefined) this.baseAngle = this.resolveAngle(option.angle, 0, 0);
		}
		this.chain(undefined, this.baseAngle, this.baseAngle);
		if (this.position < this.text.length) this.report(this.position, this.text.length, `unexpected "${this.text[this.position]}"`);
		return { atomList: this.atomList, bondList: this.bondList, ringList: this.ringList, problemList: this.problemList };
	}

	private peek(ahead = 0): string {
		return this.text[this.position + ahead] ?? '';
	}

	private skipSpace(): void {
		while (/\s/.test(this.peek())) this.position++;
	}

	private report(start: number, end: number, message: string): void {
		this.problemList.push({ start: this.offset + start, end: this.offset + end, message });
	}

	private span(start: number, end: number): Span {
		return { start: this.offset + start, end: this.offset + end };
	}

	private readOptions(): Options {
		const start = this.position;
		let depth = 0;
		while (this.position < this.text.length) {
			const character = this.text[this.position]!;
			if (character === '[' || character === '{') depth++;
			if (character === ']' || character === '}') depth--;
			this.position++;
			if (depth === 0) break;
		}
		const inner = this.text.slice(start + 1, this.position - 1);
		const [angle, length, , , ...rest] = inner.split(',');
		const lengthValue = Number(length);
		return {
			angle: angle?.trim() === '' ? undefined : angle?.trim(),
			length: length && Number.isFinite(lengthValue) && lengthValue > 0 ? lengthValue : 1,
			style: bondStyle(rest.join(',')),
		};
	}

	private resolveAngle(text: string, previousAngle: number, fallback: number): number {
		if (text.startsWith('::')) return previousAngle + (Number(text.slice(2)) || 0);
		if (text.startsWith(':')) return Number(text.slice(1)) || 0;
		const step = Number(text);
		return Number.isFinite(step) ? step * 45 : fallback;
	}

	private addAtom(x: number, y: number, label: string, start: number, end: number): number {
		const lewis = splitLewis(label);
		const pieceList = labelPieceList(lewis.label);
		const { width, anchor } = measureLabel(pieceList);
		const atom: Atom = { index: this.atomList.length, label, pieceList, electronList: lewis.electronList, x, y, span: this.span(start, end), anchor, width };
		if (this.pendingName !== undefined) {
			atom.name = this.pendingName;
			this.pendingName = undefined;
		}
		this.atomList.push(atom);
		return atom.index;
	}

	private setLabel(index: number, label: string, start: number, end: number): void {
		const atom = this.atomList[index]!;
		const lewis = splitLewis(label);
		const pieceList = labelPieceList(lewis.label);
		const { width, anchor } = measureLabel(pieceList);
		Object.assign(atom, { label, pieceList, electronList: lewis.electronList, width, anchor, span: this.span(start, end) });
		if (this.pendingName !== undefined) {
			atom.name = this.pendingName;
			this.pendingName = undefined;
		}
	}

	private readLabel(): { label: string; start: number; end: number } | undefined {
		const start = this.position;
		let depth = 0;
		while (this.position < this.text.length) {
			const character = this.text[this.position]!;
			if (character === '{') depth++;
			else if (character === '}') {
				if (depth === 0) break;
				depth--;
			} else if (depth === 0 && (/[-=~<>()*@?[\]\s]/.test(character) || (character === '\\' && /^\\(?:chemfig|arrow)/.test(this.text.slice(this.position))))) break;
			if (character === '\\') {
				const name = /^\\[A-Za-z]+/.exec(this.text.slice(this.position));
				this.position += name ? name[0].length : 2;
				continue;
			}
			this.position++;
		}
		if (this.position === start) return undefined;
		return { label: this.text.slice(start, this.position), start, end: this.position };
	}

	private readName(): void {
		// @{name} or @{name,0.5}
		const start = this.position;
		this.position += 2;
		const close = this.text.indexOf('}', this.position);
		if (close < 0) {
			this.report(start, this.text.length, 'missing "}" after @{');
			this.position = this.text.length;
			return;
		}
		this.pendingName = this.text.slice(this.position, close).split(',')[0]!.trim();
		this.position = close + 1;
	}

	/** Parses a chain starting at atom `current`; returns the last atom. */
	private chain(current: number | undefined, previousAngle: number, defaultAngle: number, ring?: { centerX: number; centerY: number }): number | undefined {
		let angle = previousAngle;
		let justBonded = false;
		for (;;) {
			this.skipSpace();
			const character = this.peek();
			if (character === '' || character === ')') return current;
			if (character === '(') {
				const start = this.position++;
				if (current === undefined) current = this.addAtom(0, 0, '', start, start);
				const atom = this.atomList[current]!;
				// branches off a ring vertex point outward by default
				const outward = ring ? (Math.atan2(atom.y - ring.centerY, atom.x - ring.centerX) * 180) / Math.PI : defaultAngle;
				this.chain(current, angle, outward);
				if (this.peek() === ')') this.position++;
				else this.report(start, this.position, 'missing ")"');
				justBonded = false;
				continue;
			}
			if (character === '*') {
				const start = this.position;
				const aromatic = this.peek(1) === '*';
				this.position += aromatic ? 2 : 1;
				const size = /^\d+/.exec(this.text.slice(this.position));
				if (!size || this.text[this.position + size[0].length] !== '(') {
					this.report(start, this.position, 'a ring is written *6(…)');
					continue;
				}
				this.position += size[0].length + 1;
				if (current === undefined) current = this.addAtom(0, 0, '', start, start);
				this.ring(current, angle, Number(size[0]), aromatic, start, justBonded);
				if (this.peek() === ')') this.position++;
				else this.report(start, this.position, 'missing ")" after the ring');
				justBonded = false;
				continue;
			}
			if (character === '@' && this.peek(1) === '{') {
				this.readName();
				continue;
			}
			if (character === '?') {
				// ring closure: ?[a] … ?[a] joins the two atoms; ?[a,{=}] makes the closing bond a double bond
				const start = this.position++;
				let hook = 'a';
				let kind: BondKind = 'Single';
				if (this.peek() === '[') {
					const close = this.text.indexOf(']', this.position);
					const inner = this.text.slice(this.position + 1, close < 0 ? this.text.length : close);
					this.position = close < 0 ? this.text.length : close + 1;
					const [name, bond] = inner.split(',');
					if (name?.trim()) hook = name.trim();
					const symbol = bond?.trim().replace(/^\{|\}$/g, '');
					if (symbol && bondKindMap[symbol]) kind = bondKindMap[symbol]!;
				}
				if (current === undefined) current = this.addAtom(0, 0, '', start, start);
				const other = this.hookMap.get(hook);
				if (other === undefined) this.hookMap.set(hook, current);
				else {
					this.bondList.push({ from: other, to: current, kind, span: this.span(start, this.position) });
					this.hookMap.delete(hook);
				}
				continue;
			}
			const bondMatch = bondPattern.exec(this.text.slice(this.position));
			if (bondMatch) {
				const start = this.position;
				this.position += bondMatch[0].length;
				const option: Options = this.peek() === '[' ? this.readOptions() : { angle: undefined, length: 1, style: {} };
				const bondName = this.pendingName;
				this.pendingName = undefined;
				if (current === undefined) current = this.addAtom(0, 0, '', start, start);
				const from = this.atomList[current]!;
				angle = option.angle !== undefined ? this.resolveAngle(option.angle, angle, defaultAngle) : defaultAngle;
				const x = from.x + Math.cos(radian(angle)) * option.length;
				const y = from.y + Math.sin(radian(angle)) * option.length;
				const next = this.addAtom(x, y, '', this.position, this.position);
				this.bondList.push({ from: current, to: next, kind: bondKindMap[bondMatch[0]]!, span: this.span(start, this.position), ...option.style, ...(bondName ? { name: bondName } : {}) });
				current = next;
				justBonded = true;
				continue;
			}
			const label = this.readLabel();
			if (!label) {
				this.report(this.position, this.position + 1, `unexpected "${character}"`);
				this.position++;
				continue;
			}
			// `{}` is an empty atom (chemfig's trick to name a bare vertex: -@{x}{}-)
			if (label.label.replace(/[{}\s]/g, '') === '') {
				if (current === undefined) current = this.addAtom(0, 0, '', label.start, label.end);
				else if (this.pendingName !== undefined) {
					this.atomList[current]!.name = this.pendingName;
					this.pendingName = undefined;
				}
				justBonded = false;
				continue;
			}
			if (current === undefined) current = this.addAtom(0, 0, label.label, label.start, label.end);
			else if (justBonded && this.atomList[current]!.label === '') this.setLabel(current, label.label, label.start, label.end);
			else this.setLabel(current, this.atomList[current]!.label + label.label, this.atomList[current]!.span.start - this.offset, label.end);
			justBonded = false;
		}
	}

	private ring(start: number, incomingAngle: number, size: number, aromatic: boolean, sourceStart: number, attached: boolean): void {
		const startAtom = this.atomList[start]!;
		// the ring sits symmetric to the incoming bond; a ring at the very start points up
		const toward = attached ? incomingAngle : this.baseAngle + 180 / size;
		const firstAngle = toward - (90 - 180 / size);
		const circumradius = 1 / (2 * Math.sin(Math.PI / size));
		const centerX = startAtom.x + Math.cos(radian(toward)) * circumradius;
		const centerY = startAtom.y + Math.sin(radian(toward)) * circumradius;
		const vertexList: number[] = [start];
		let edge = 0;
		let current = start;
		let justBonded = false;
		for (;;) {
			this.skipSpace();
			const character = this.peek();
			if (character === '' || character === ')') break;
			if (character === '(') {
				const branchStart = this.position++;
				const atom = this.atomList[current]!;
				const outward = (Math.atan2(atom.y - centerY, atom.x - centerX) * 180) / Math.PI;
				this.chain(current, outward, outward, { centerX, centerY });
				if (this.peek() === ')') this.position++;
				else this.report(branchStart, this.position, 'missing ")"');
				justBonded = false;
				continue;
			}
			if (character === '@' && this.peek(1) === '{') {
				this.readName();
				continue;
			}
			const bondMatch = bondPattern.exec(this.text.slice(this.position));
			if (bondMatch) {
				const bondStart = this.position;
				this.position += bondMatch[0].length;
				const style = this.peek() === '[' ? this.readOptions().style : {};
				const bondName = this.pendingName;
				this.pendingName = undefined;
				if (edge >= size) {
					this.report(bondStart, this.position, `a ${size}-ring has only ${size} bonds`);
					continue;
				}
				const angle = firstAngle + (edge * 360) / size;
				let next: number;
				if (edge === size - 1) next = start;
				else {
					const from = this.atomList[current]!;
					next = this.addAtom(from.x + Math.cos(radian(angle)), from.y + Math.sin(radian(angle)), '', this.position, this.position);
					vertexList.push(next);
				}
				this.bondList.push({ from: current, to: next, kind: bondKindMap[bondMatch[0]]!, span: this.span(bondStart, this.position), ringCenter: { x: centerX, y: centerY }, ...style, ...(bondName ? { name: bondName } : {}) });
				current = next;
				edge++;
				justBonded = true;
				continue;
			}
			const label = this.readLabel();
			if (!label) {
				this.report(this.position, this.position + 1, `unexpected "${character}" in the ring`);
				this.position++;
				continue;
			}
			if (justBonded && this.atomList[current]!.label === '') this.setLabel(current, label.label, label.start, label.end);
			justBonded = false;
		}
		const inradius = circumradius * Math.cos(Math.PI / size);
		this.ringList.push({ x: centerX, y: centerY, radius: aromatic ? inradius * 0.62 : inradius, aromatic, span: this.span(sourceStart, this.position) });
	}
}

/** Parses the text inside `\chemfig{…}`; `offset` = where it starts in the block source. */
export function parseMolecule(text: string, offset = 0): Molecule {
	return new MoleculeParser(text, offset).parse();
}
