// Our own structure syntax for a Chem block: one dense line that walks from atom to atom.
//
//   O@o^-:3                                   hydroxide: named o, charge −1, three lone pairs
//   C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br
//   &1 =30 -330 =270 -210 =150 -&1            benzene: bare vertices, a ring closed with &1
//
//   atom   label [@name] [^charge] [:lonePair] [.…] [[color]] [&ring]
//          C  O  NH_2  {t-Bu}  C@c  O^-  N^{2+}  O:3  C. (a radical; C.. two)  O[Danger]  C&1
//          a bond right after a bond (or a branch) is joined by a bare vertex, written as nothing;
//          `*` is a bare vertex where one has to be written
//   bond   kind angle [*length] [@name] [[style]] [&ring]     -30  =0*1.5  <215  -0@cb  -0[Dashed, Accent]  -&1
//          kind  - single  = double  # triple  < wedge  <: hash (narrow at the atom before; > >: the other way)
//                . invisible (keeps separate fragments where they are)
//          angle absolute degrees, 0 = right, counter-clockwise; length in bond lengths; &n closes a ring
//   ( … )  a branch from the atom before it
//
// Hydrogens, which side they go on, and where lone pairs sit are worked out by structure.ts, so a
// label is only the element. Positions are in bond lengths with y up; the first atom is at (0, 0).

import { type Atom, type Bond, type BondKind, type Molecule, type Problem, type Span, labelPieceList, measureLabel } from './molecule';
import { type DrawAtom, type DrawBond, type DrawGraph, addAtom, addBond, atomPieceList, electronAngleList, emptyGraph, isLabelVisible, readAtomLabel } from './structure';

export interface ParsedStructure {
	graph: DrawGraph;
	problemList: Problem[];
	/** Where each atom and bond was written (an implicit vertex gets the end of its bond). */
	spanMap: Map<number, Span>;
}

interface BondSpec {
	order: 1 | 2 | 3;
	stereo: DrawBond['stereo'];
	/** The wedge or hash is narrow at the far end (`>`, `>:`). */
	reverse: boolean;
	hidden: boolean;
	angle: number | undefined;
	length: number;
	name: string | undefined;
	dash: DrawBond['dash'];
	color: string | undefined;
	ring: string | undefined;
	span: Span;
}

const bondPattern = /^(<:|>:|-|=|#|<|>|\.)(-?\d+(?:\.\d+)?)?(?:\*(\d+(?:\.\d+)?))?(?:@([A-Za-z0-9_]+))?(?:\[([^\]]*)\])?(?:&(\d+))?/;
const labelPattern = /^(?:\{[^{}]*\}|\*|[A-Za-z][A-Za-z0-9_']*)/;
const suffixPattern = /^(?:@([A-Za-z0-9_]+)|\^(\{[^{}]*\}|\d*[+-])|:(\d)|&(\d+)|\[([^\]]*)\]|\.(?![\d-]))/;

/** Every element symbol, so `Na` is sodium while `Ph` and `Me` stay labels. */
const elementSet = new Set(
	'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '),
);

/** A label → element or free text: `O`, `NH_2` (hydrogens are worked out again), `Na`, or `CO_2H` as written. */
function readLabel(text: string): Pick<DrawAtom, 'element' | 'charge' | 'lonePair' | 'radical' | 'showLabel' | 'label'> {
	if (text.startsWith('{')) return { element: '', charge: 0, lonePair: 0, radical: 0, showLabel: true, label: text.slice(1, -1) };
	const read = readAtomLabel(text);
	if (read.element === '' && elementSet.has(text)) return { element: text, charge: 0, lonePair: 0, radical: 0, showLabel: true };
	return read;
}

function readCharge(text: string): number {
	const match = /^\{?(\d*)([+-])\}?$/.exec(text);
	if (!match) return 0;
	return (match[2] === '+' ? 1 : -1) * (Number(match[1]) || 1);
}

/** The text of a Chem block → a graph. */
export function parseStructure(text: string, offset = 0): ParsedStructure {
	const graph = emptyGraph();
	const problemList: Problem[] = [];
	const spanMap = new Map<number, Span>();
	const ringMap = new Map<string, number>();
	const report = (start: number, end: number, message: string): void => {
		problemList.push({ start: start + offset, end: end + offset, message });
	};
	let current: number | undefined;
	let pending: BondSpec | undefined;
	const branchList: (number | undefined)[] = [];

	const atomAt = (id: number): DrawAtom => graph.atomList.find((atom) => atom.id === id)!;
	/** Ends the pending bond at a new atom (bare unless `extra` says otherwise). */
	const finishBond = (extra: Partial<DrawAtom>, span: Span): number => {
		const bond = pending!;
		pending = undefined;
		const from = atomAt(current!);
		const radian = ((bond.angle ?? 0) * Math.PI) / 180;
		const atom = addAtom(graph, from.x + Math.cos(radian) * bond.length, from.y + Math.sin(radian) * bond.length, 'C', extra);
		spanMap.set(atom.id, span);
		const [a, b] = bond.reverse ? [atom.id, from.id] : [from.id, atom.id];
		const made = addBond(graph, a, b, bond.order, {
			stereo: bond.stereo,
			...(bond.hidden ? { hidden: true } : {}),
			...(bond.name ? { name: bond.name } : {}),
			...(bond.dash ? { dash: bond.dash } : {}),
			...(bond.color ? { color: bond.color } : {}),
		});
		if (made) spanMap.set(made.id, { start: bond.span.start + offset, end: bond.span.end + offset });
		return atom.id;
	};
	const bareEnd = (at: number): void => {
		if (pending) current = finishBond({}, { start: at + offset, end: at + offset });
	};

	let index = 0;
	while (index < text.length) {
		const character = text[index]!;
		if (/\s/.test(character)) {
			index++;
			continue;
		}
		if (character === '(') {
			bareEnd(index);
			if (current === undefined) report(index, index + 1, 'a branch needs an atom before it');
			branchList.push(current);
			index++;
			continue;
		}
		if (character === ')') {
			bareEnd(index);
			if (branchList.length === 0) report(index, index + 1, 'this ")" closes no branch');
			else current = branchList.pop();
			index++;
			continue;
		}
		const rest = text.slice(index);
		const bond = bondPattern.exec(rest);
		if (bond) {
			const [whole, kind, angle, length, name, style, ring] = bond;
			const span = { start: index, end: index + whole.length };
			index += whole.length;
			if (angle === undefined && ring === undefined) {
				report(span.start, span.end, 'a bond needs its angle, like -30');
				continue;
			}
			bareEnd(span.start);
			if (current === undefined) {
				// a structure may start with a bond: its first atom is a bare vertex
				const first = addAtom(graph, 0, 0);
				spanMap.set(first.id, { start: span.start + offset, end: span.start + offset });
				current = first.id;
			}
			const styleList = (style ?? '').split(',').map((word) => word.trim()).filter(Boolean);
			const spec: BondSpec = {
				order: kind === '=' ? 2 : kind === '#' ? 3 : 1,
				stereo: kind === '<' || kind === '>' ? 'Wedge' : kind === '<:' || kind === '>:' ? 'Hash' : 'None',
				reverse: kind === '>' || kind === '>:',
				hidden: kind === '.',
				angle: angle === undefined ? undefined : ((Number(angle) % 360) + 360) % 360,
				length: length === undefined ? 1 : Number(length),
				name,
				dash: styleList.includes('Dashed') ? 'Dashed' : styleList.includes('Dotted') ? 'Dotted' : undefined,
				color: styleList.find((word) => word !== 'Dashed' && word !== 'Dotted'),
				ring,
				span,
			};
			if (ring !== undefined) {
				// a ring closure: back to the atom marked &n, and the walk goes on from here
				const target = ringMap.get(ring);
				if (target === undefined) report(span.start, span.end, `no atom is marked &${ring}`);
				else {
					ringMap.delete(ring);
					const [a, b] = spec.reverse ? [target, current] : [current, target];
					const made = addBond(graph, a, b, spec.order, { stereo: spec.stereo, ...(spec.name ? { name: spec.name } : {}), ...(spec.dash ? { dash: spec.dash } : {}), ...(spec.color ? { color: spec.color } : {}) });
					if (made) spanMap.set(made.id, { start: span.start + offset, end: span.end + offset });
				}
				continue;
			}
			pending = spec;
			continue;
		}
		const label = labelPattern.exec(rest);
		const start = index;
		let labelText = label ? label[0] : '';
		index += labelText.length;
		const extra: Partial<DrawAtom> = {};
		const markList: string[] = [];
		for (let suffix = suffixPattern.exec(text.slice(index)); suffix; suffix = suffixPattern.exec(text.slice(index))) {
			if (suffix[1] !== undefined) extra.name = suffix[1];
			else if (suffix[2] !== undefined) extra.charge = readCharge(suffix[2]);
			else if (suffix[3] !== undefined) extra.lonePair = Number(suffix[3]);
			else if (suffix[4] !== undefined) markList.push(suffix[4]);
			else if (suffix[5] !== undefined) extra.color = suffix[5].trim();
			else extra.radical = (extra.radical ?? 0) + 1;
			index += suffix[0].length;
		}
		if (index === start) {
			const end = /^\S+/.exec(rest)![0].length + start;
			report(start, end, `"${text.slice(start, end)}" is not an atom or a bond`);
			index = end;
			continue;
		}
		if (index < text.length && !/[\s()]/.test(text[index]!) && !bondPattern.test(text.slice(index))) {
			const end = (/^\S+/.exec(text.slice(index))?.[0].length ?? 0) + index;
			report(start, end, `"${text.slice(start, end)}" is not an atom or a bond`);
			index = end;
			continue;
		}
		if (labelText === '*') labelText = '';
		const read = readLabel(labelText);
		const atomExtra: Partial<DrawAtom> = { ...read, ...extra };
		if (read.label === undefined) delete atomExtra.label;
		const span = { start: start + offset, end: index + offset };
		let id: number;
		if (pending) id = finishBond(atomExtra, span);
		else if (current === undefined && graph.atomList.length === 0) {
			const atom = addAtom(graph, 0, 0, 'C', atomExtra);
			spanMap.set(atom.id, span);
			id = atom.id;
		} else {
			report(start, index, 'two atoms need a bond between them');
			continue;
		}
		current = id;
		for (const mark of markList) {
			if (ringMap.has(mark)) report(start, index, `&${mark} is already open; close it with a bond like -&${mark}`);
			else ringMap.set(mark, id);
		}
	}
	bareEnd(text.length);
	if (branchList.length > 0) report(text.length, text.length, 'missing ")"');
	for (const [mark, id] of ringMap) {
		const span = spanMap.get(id);
		report((span?.start ?? offset) - offset, (span?.end ?? offset) - offset, `&${mark} is never closed (add a bond like -&${mark})`);
	}
	return { graph, problemList, spanMap };
}

// ---------------------------------------------------------------- graph → text

function round(value: number, digit: number): number {
	const factor = 10 ** digit;
	return Math.round(value * factor) / factor;
}

/** Whole degrees where the drawing has them, else a tenth (a hundredth for long invisible bonds). */
function angleText(from: DrawAtom, to: DrawAtom, digit = 1): string {
	const degree = ((((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI) % 360) + 360) % 360;
	const whole = Math.round(degree);
	const value = Math.abs(degree - whole) < 0.5 / 10 ** digit ? whole : round(degree, digit);
	return String(value === 360 ? 0 : value);
}

function bondSymbol(bond: DrawBond, fromId: number): string {
	if (bond.hidden) return '.';
	if (bond.order === 2) return '=';
	if (bond.order === 3) return '#';
	if (bond.stereo === 'Wedge') return bond.from === fromId ? '<' : '>';
	if (bond.stereo === 'Hash') return bond.from === fromId ? '<:' : '>:';
	return '-';
}

function bondTail(bond: DrawBond): string {
	const styleList = [...(bond.dash ? [bond.dash] : []), ...(bond.color ? [bond.color] : [])];
	return `${bond.name ? `@${bond.name}` : ''}${styleList.length > 0 ? `[${styleList.join(', ')}]` : ''}`;
}

function bondText(bond: DrawBond, from: DrawAtom, to: DrawAtom): string {
	// an invisible bond places a whole fragment, often far away, so it keeps more digits
	const digit = bond.hidden ? 2 : 1;
	const length = round(Math.hypot(to.x - from.x, to.y - from.y), digit + 1);
	return `${bondSymbol(bond, from.id)}${angleText(from, to, digit)}${Math.abs(length - 1) > 0.01 ? `*${length}` : ''}${bondTail(bond)}`;
}

function chargeText(charge: number): string {
	if (charge === 0) return '';
	return `^${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '-'}`;
}

/** An atom's own text: the label (nothing for a bare vertex) and its suffixes. */
function atomText(graph: DrawGraph, atom: DrawAtom, markList: readonly string[]): string {
	let label = '';
	if (atom.element === '' && atom.label !== undefined) label = /^[A-Za-z][A-Za-z0-9_']*$/.test(atom.label) && readLabel(atom.label).element === '' ? atom.label : `{${atom.label}}`;
	else if (isLabelVisible(graph, atom)) label = atom.element;
	return `${label}${atom.name ? `@${atom.name}` : ''}${chargeText(atom.charge)}${atom.lonePair > 0 ? `:${atom.lonePair}` : ''}${'.'.repeat(atom.radical)}${atom.color ? `[${atom.color}]` : ''}${markList.map((mark) => `&${mark}`).join('')}`;
}

/**
 * A graph → the text of a Chem block. A walk from the leftmost atom: the biggest side goes on as
 * the chain and the others become branches, rings close with &n, and separate fragments hang off
 * the first atom on invisible bonds, so everything stays where it was drawn.
 */
export function writeStructure(graph: DrawGraph): string {
	if (graph.atomList.length === 0) return '';
	const atomMap = new Map(graph.atomList.map((atom) => [atom.id, atom]));
	const adjacency = new Map<number, { bond: DrawBond; other: number }[]>(graph.atomList.map((atom) => [atom.id, []]));
	const link = (bond: DrawBond): void => {
		adjacency.get(bond.from)!.push({ bond, other: bond.to });
		adjacency.get(bond.to)!.push({ bond, other: bond.from });
	};
	for (const bond of graph.bondList) if (atomMap.has(bond.from) && atomMap.has(bond.to)) link(bond);
	// separate fragments hang off the first atom on invisible bonds, added before the walk so that
	// writing the text read back from this one gives the same text
	const leftFirst = [...graph.atomList].sort((left, right) => round(left.x, 4) - round(right.x, 4) || round(right.y, 4) - round(left.y, 4));
	const root = leftFirst[0]!;
	const reached = new Set<number>();
	const reach = (start: number): void => {
		const stack = [start];
		while (stack.length > 0) {
			const id = stack.pop()!;
			if (reached.has(id)) continue;
			reached.add(id);
			for (const edge of adjacency.get(id)!) stack.push(edge.other);
		}
	};
	reach(root.id);
	for (const atom of leftFirst) {
		if (reached.has(atom.id)) continue;
		link({ id: -atom.id, from: root.id, to: atom.id, order: 1, stereo: 'None', hidden: true });
		reach(atom.id);
	}
	// neighbours in the order of their direction, so the text depends on the drawing, not on how it was made
	for (const [id, edgeList] of adjacency) {
		const atom = atomMap.get(id)!;
		edgeList.sort((left, right) => Number(angleText(atom, atomMap.get(left.other)!)) - Number(angleText(atom, atomMap.get(right.other)!)));
	}
	const visited = new Set<number>();
	const usedBond = new Set<number>();
	const childMap = new Map<number, { bond: DrawBond; other: number }[]>();
	const sizeMap = new Map<number, number>();
	const closureList: DrawBond[] = [];
	const visit = (id: number): number => {
		visited.add(id);
		const childList: { bond: DrawBond; other: number }[] = [];
		let size = 1;
		for (const edge of adjacency.get(id)!) {
			if (usedBond.has(edge.bond.id)) continue;
			usedBond.add(edge.bond.id);
			if (visited.has(edge.other)) {
				closureList.push(edge.bond);
				continue;
			}
			childList.push(edge);
			size += visit(edge.other);
		}
		childMap.set(id, childList);
		sizeMap.set(id, size);
		return size;
	};
	visit(root.id);
	const orderedChildren = (id: number): { bond: DrawBond; other: number }[] => [...childMap.get(id)!].sort((left, right) => sizeMap.get(left.other)! - sizeMap.get(right.other)!);
	// the end of a ring closure that is written first carries the mark; the other end writes the bond
	const emitIndex = new Map<number, number>();
	const number = (id: number): void => {
		emitIndex.set(id, emitIndex.size);
		for (const child of orderedChildren(id)) number(child.other);
	};
	number(root.id);
	const markMap = new Map<number, string[]>();
	const closeMap = new Map<number, { bond: DrawBond; mark: string }[]>();
	const endOf = (bond: DrawBond): [number, number] => (emitIndex.get(bond.from)! < emitIndex.get(bond.to)! ? [bond.from, bond.to] : [bond.to, bond.from]);
	// marks are numbered in the order they are written
	closureList.sort((left, right) => emitIndex.get(endOf(left)[0])! - emitIndex.get(endOf(right)[0])! || emitIndex.get(endOf(left)[1])! - emitIndex.get(endOf(right)[1])!);
	closureList.forEach((bond, index) => {
		const mark = String(index + 1);
		const [first, second] = endOf(bond);
		markMap.set(first, [...(markMap.get(first) ?? []), mark]);
		closeMap.set(second, [...(closeMap.get(second) ?? []), { bond, mark }]);
	});
	const emit = (id: number): string => {
		const atom = atomMap.get(id)!;
		const partList: string[] = [];
		for (const { bond, mark } of closeMap.get(id) ?? []) partList.push(`${bondSymbol(bond, id)}${bondTail(bond)}&${mark}`);
		const childList = orderedChildren(id);
		childList.forEach((child, index) => {
			const part = `${bondText(child.bond, atom, atomMap.get(child.other)!)}${spaced(emit(child.other))}`;
			partList.push(index < childList.length - 1 ? `(${part})` : part);
		});
		let own = atomText(graph, atom, markMap.get(id) ?? []);
		// a bare vertex can stay unwritten, except before a branch where nothing else would make it
		if (own === '' && partList[0]?.startsWith('(')) own = '*';
		return [own, ...partList].filter(Boolean).join(' ');
	};
	return emit(root.id);
}

const spaced = (text: string): string => (text === '' ? '' : ` ${text}`);

// ---------------------------------------------------------------- graph → drawing

/** The middle of the smallest ring through a bond (up to 8 atoms), so a double bond's second line goes inside. */
function ringCenterOf(graph: DrawGraph, bond: DrawBond): { x: number; y: number } | undefined {
	const previous = new Map<number, number>([[bond.from, -1]]);
	let frontier = [bond.from];
	for (let depth = 0; depth < 7 && frontier.length > 0; depth++) {
		const next: number[] = [];
		for (const id of frontier) {
			for (const other of graph.bondList) {
				if (other.id === bond.id || other.hidden) continue;
				const neighbor = other.from === id ? other.to : other.to === id ? other.from : undefined;
				if (neighbor === undefined || previous.has(neighbor)) continue;
				previous.set(neighbor, id);
				if (neighbor === bond.to) {
					const pathList: DrawAtom[] = [];
					for (let at: number = neighbor; at !== -1; at = previous.get(at)!) pathList.push(graph.atomList.find((atom) => atom.id === at)!);
					return { x: pathList.reduce((sum, atom) => sum + atom.x, 0) / pathList.length, y: pathList.reduce((sum, atom) => sum + atom.y, 0) / pathList.length };
				}
				next.push(neighbor);
			}
		}
		frontier = next;
	}
	return undefined;
}

/** A graph → the molecule the scene draws (labels measured, hydrogens and lone pairs placed). */
export function structureMolecule(graph: DrawGraph, spanMap: ReadonlyMap<number, Span> = new Map()): Molecule {
	const indexMap = new Map(graph.atomList.map((atom, index) => [atom.id, index]));
	const atomList: Atom[] = graph.atomList.map((atom, index) => {
		let pieceList = atomPieceList(graph, atom);
		if (atom.element === '' && atom.label !== undefined) {
			pieceList = labelPieceList(atom.label);
			if (atom.charge !== 0) pieceList.push({ text: `${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ''}${atom.charge > 0 ? '+' : '−'}`, kind: 'Sup' });
		}
		const { width, anchor } = measureLabel(pieceList);
		const visible = pieceList.length > 0;
		return {
			index,
			label: visible ? pieceList.map((piece) => piece.text).join('') : '',
			pieceList,
			electronList: electronAngleList(graph, atom),
			x: atom.x,
			y: atom.y,
			span: spanMap.get(atom.id) ?? { start: 0, end: 0 },
			...(atom.name ? { name: atom.name } : {}),
			...(atom.color ? { color: atom.color } : {}),
			anchor: visible ? anchor : 0,
			width: visible ? width : 0,
		};
	});
	const bondList: Bond[] = graph.bondList.flatMap((bond) => {
		const from = indexMap.get(bond.from);
		const to = indexMap.get(bond.to);
		if (from === undefined || to === undefined) return [];
		const kind: BondKind = bond.stereo === 'Wedge' ? 'WedgeFront' : bond.stereo === 'Hash' ? 'DashFront' : bond.order === 2 ? 'Double' : bond.order === 3 ? 'Triple' : 'Single';
		const ringCenter = bond.order === 2 ? ringCenterOf(graph, bond) : undefined;
		return [
			{
				from,
				to,
				kind,
				span: spanMap.get(bond.id) ?? { start: 0, end: 0 },
				...(bond.name ? { name: bond.name } : {}),
				...(ringCenter ? { ringCenter } : {}),
				...(bond.dash ? { dash: bond.dash } : {}),
				...(bond.hidden ? { hidden: true } : {}),
				...(bond.color ? { color: bond.color } : {}),
			},
		];
	});
	return { atomList, bondList, ringList: [], problemList: [] };
}

/** True when a Chem block's text is written in our structure syntax (not chemfig, not a formula). */
export function isStructureText(text: string): boolean {
	if (text.trim() === '' || /\\[A-Za-z+]/.test(text) || /^\s*(?:Arrow|Label)\b/m.test(text)) return false;
	return parseStructure(text).problemList.length === 0;
}
