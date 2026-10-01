// A structure as an editable graph (for the drawing tool), read from and written to chemfig.
// Positions are in bond lengths with y pointing up, as in the scene. Hydrogens on labelled
// atoms, charges, and lone pairs are worked out here, so the drawing stays chemically sensible.

import { type Molecule, parseMolecule, splitLewis } from './molecule';

export interface Point {
	x: number;
	y: number;
}

export type BondStereo = 'None' | 'Wedge' | 'Hash';

export interface DrawAtom {
	id: number;
	x: number;
	y: number;
	/** Element symbol; '' when the atom has a free-form label (CO_2H, Ph, R). */
	element: string;
	charge: number;
	/** Lone pairs drawn around the atom (0–4). */
	lonePair: number;
	radical: boolean;
	/** Carbon is a bare vertex unless it's charged, has lone pairs or no bonds, or this is set. */
	showLabel: boolean;
	/** A free-form label kept as written. */
	label?: string;
	/** `@{name}`, used by Arrow and Label lines. */
	name?: string;
}

export interface DrawBond {
	id: number;
	from: number;
	to: number;
	order: 1 | 2 | 3;
	/** A wedge or hashed wedge is narrow at `from`. */
	stereo: BondStereo;
	dash?: 'Dashed' | 'Dotted';
	color?: string;
	name?: string;
	/** Keeps separate fragments in place without drawing a line (draw=none). */
	hidden?: boolean;
}

export interface DrawGraph {
	atomList: DrawAtom[];
	bondList: DrawBond[];
	nextId: number;
}

export function emptyGraph(): DrawGraph {
	return { atomList: [], bondList: [], nextId: 1 };
}

export function cloneGraph(graph: DrawGraph): DrawGraph {
	return { atomList: graph.atomList.map((atom) => ({ ...atom })), bondList: graph.bondList.map((bond) => ({ ...bond })), nextId: graph.nextId };
}

export function atomById(graph: DrawGraph, id: number): DrawAtom | undefined {
	return graph.atomList.find((atom) => atom.id === id);
}

export function bondBetween(graph: DrawGraph, a: number, b: number): DrawBond | undefined {
	return graph.bondList.find((bond) => (bond.from === a && bond.to === b) || (bond.from === b && bond.to === a));
}

export function addAtom(graph: DrawGraph, x: number, y: number, element = 'C', extra: Partial<DrawAtom> = {}): DrawAtom {
	const atom: DrawAtom = { id: graph.nextId++, x, y, element, charge: 0, lonePair: 0, radical: false, showLabel: false, ...extra };
	graph.atomList.push(atom);
	return atom;
}

export function addBond(graph: DrawGraph, from: number, to: number, order: 1 | 2 | 3 = 1, extra: Partial<DrawBond> = {}): DrawBond | undefined {
	if (from === to || bondBetween(graph, from, to)) return undefined;
	const bond: DrawBond = { id: graph.nextId++, from, to, order, stereo: 'None', ...extra };
	graph.bondList.push(bond);
	return bond;
}

export function removeAtom(graph: DrawGraph, id: number): void {
	graph.atomList = graph.atomList.filter((atom) => atom.id !== id);
	graph.bondList = graph.bondList.filter((bond) => bond.from !== id && bond.to !== id);
}

export function removeBond(graph: DrawGraph, id: number): void {
	graph.bondList = graph.bondList.filter((bond) => bond.id !== id);
}

export function neighborList(graph: DrawGraph, id: number, includeHidden = false): { atom: DrawAtom; bond: DrawBond }[] {
	const list: { atom: DrawAtom; bond: DrawBond }[] = [];
	for (const bond of graph.bondList) {
		if (bond.hidden && !includeHidden) continue;
		const other = bond.from === id ? bond.to : bond.to === id ? bond.from : undefined;
		const atom = other === undefined ? undefined : atomById(graph, other);
		if (atom) list.push({ atom, bond });
	}
	return list;
}

function degreeOf(from: Point, to: Point): number {
	return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function normalizeDegree(degree: number): number {
	let value = ((degree % 360) + 360) % 360;
	if (value > 180) value -= 360;
	return value;
}

// ---------------------------------------------------------------- chemistry

const valenceMap: Readonly<Record<string, number>> = { H: 1, B: 3, C: 4, Si: 4, N: 3, P: 3, O: 2, S: 2, Se: 2, F: 1, Cl: 1, Br: 1, I: 1 };

/** How many bonds (to H or anything) an element makes with this charge; undefined for elements we don't count. */
export function valence(element: string, charge: number): number | undefined {
	const base = valenceMap[element];
	if (base === undefined) return undefined;
	if (element === 'C' || element === 'Si') return base - Math.abs(charge);
	if (element === 'N' || element === 'P' || element === 'O' || element === 'S' || element === 'Se' || element === 'B') return Math.max(0, base + charge);
	return charge === 0 ? base : 0;
}

export function bondOrderSum(graph: DrawGraph, id: number): number {
	return neighborList(graph, id).reduce((sum, item) => sum + item.bond.order, 0);
}

/** Implicit hydrogens on a labelled atom (OH, NH_2, CH_3…). */
export function hydrogenCount(graph: DrawGraph, atom: DrawAtom): number {
	if (atom.element === '' || atom.element === 'H') return 0;
	const count = valence(atom.element, atom.charge);
	return count === undefined ? 0 : Math.max(0, count - bondOrderSum(graph, atom.id));
}

export function isLabelVisible(graph: DrawGraph, atom: DrawAtom): boolean {
	if (atom.element !== 'C') return true;
	return atom.showLabel || atom.charge !== 0 || atom.lonePair > 0 || atom.radical || neighborList(graph, atom.id).length === 0;
}

/** Hydrogens go on the side away from the bonds: HO– when the bond leaves to the right. */
export function hydrogenSide(graph: DrawGraph, atom: DrawAtom): 'Left' | 'Right' {
	let sum = 0;
	for (const { atom: other } of neighborList(graph, atom.id)) {
		const length = Math.hypot(other.x - atom.x, other.y - atom.y) || 1;
		sum += (other.x - atom.x) / length;
	}
	return sum > 0.1 ? 'Left' : 'Right';
}

export interface AtomPiece {
	text: string;
	kind: 'Normal' | 'Sub' | 'Sup';
}

/** What the drawing shows for an atom: element, hydrogens, charge (empty for a bare carbon). */
export function atomPieceList(graph: DrawGraph, atom: DrawAtom): AtomPiece[] {
	if (atom.element === '' && atom.label !== undefined) return [{ text: atom.label.replace(/[_^{}\\]/g, ''), kind: 'Normal' }];
	if (!isLabelVisible(graph, atom)) return [];
	const count = hydrogenCount(graph, atom);
	const hydrogen: AtomPiece[] = count === 0 ? [] : count === 1 ? [{ text: 'H', kind: 'Normal' }] : [{ text: 'H', kind: 'Normal' }, { text: String(count), kind: 'Sub' }];
	const element: AtomPiece = { text: atom.element, kind: 'Normal' };
	const pieceList = hydrogenSide(graph, atom) === 'Left' ? [...hydrogen, element] : [element, ...hydrogen];
	if (atom.charge !== 0) pieceList.push({ text: `${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ''}${atom.charge > 0 ? '+' : '−'}`, kind: 'Sup' });
	return pieceList;
}

/** Directions (multiples of 45°) for the lone pairs, then the single electron, away from bonds and hydrogens. */
export function electronAngleList(graph: DrawGraph, atom: DrawAtom): { angle: number; kind: 'Pair' | 'Single' }[] {
	const taken = neighborList(graph, atom.id).map(({ atom: other }) => degreeOf(atom, other));
	if (hydrogenCount(graph, atom) > 0 && isLabelVisible(graph, atom)) taken.push(hydrogenSide(graph, atom) === 'Left' ? 180 : 0);
	const result: { angle: number; kind: 'Pair' | 'Single' }[] = [];
	const wantList: ('Pair' | 'Single')[] = [...Array.from({ length: Math.min(atom.lonePair, 8) }, () => 'Pair' as const), ...(atom.radical ? ['Single' as const] : [])];
	for (const kind of wantList) {
		let best = 90;
		let bestScore = -Infinity;
		for (let step = 0; step < 8; step++) {
			const angle = step * 45;
			if (result.some((item) => item.angle === angle)) continue;
			const distance = Math.min(360, ...taken.map((other) => Math.abs(normalizeDegree(angle - other))));
			// prefer the four straight directions, as chemists draw them
			const score = distance + (angle % 90 === 0 ? 10 : 0);
			if (score > bestScore) {
				bestScore = score;
				best = angle;
			}
		}
		result.push({ angle: best, kind });
		taken.push(best);
	}
	return result;
}

// ---------------------------------------------------------------- geometry

/** The direction (degrees) with the most room around an atom, for a new bond or a ring. */
export function freeAngle(graph: DrawGraph, atom: DrawAtom): number {
	const angleList = neighborList(graph, atom.id, true)
		.map(({ atom: other }) => degreeOf(atom, other))
		.sort((left, right) => left - right);
	if (angleList.length === 0) return 30;
	if (angleList.length === 1) {
		// a zigzag: 120° from the one bond, on the side with fewer atoms
		const base = angleList[0]!;
		const candidateList = [base - 120, base + 120];
		const crowd = (degree: number): number => {
			const point = { x: atom.x + Math.cos((degree * Math.PI) / 180), y: atom.y + Math.sin((degree * Math.PI) / 180) };
			return graph.atomList.reduce((sum, other) => sum + 1 / Math.max((other.x - point.x) ** 2 + (other.y - point.y) ** 2, 0.05), 0);
		};
		return normalizeDegree(crowd(candidateList[0]!) <= crowd(candidateList[1]!) ? candidateList[0]! : candidateList[1]!);
	}
	let bestGap = -1;
	let bestAngle = 0;
	for (let index = 0; index < angleList.length; index++) {
		const current = angleList[index]!;
		const next = index + 1 < angleList.length ? angleList[index + 1]! : angleList[0]! + 360;
		if (next - current > bestGap) {
			bestGap = next - current;
			bestAngle = current + (next - current) / 2;
		}
	}
	return normalizeDegree(bestAngle);
}

export function snapDegree(degree: number, step = 30): number {
	return normalizeDegree(Math.round(degree / step) * step);
}

export function nearestAtom(graph: DrawGraph, point: Point, within: number, except?: number): DrawAtom | undefined {
	let best: DrawAtom | undefined;
	let bestDistance = within;
	for (const atom of graph.atomList) {
		if (atom.id === except) continue;
		const distance = Math.hypot(atom.x - point.x, atom.y - point.y);
		if (distance <= bestDistance) {
			best = atom;
			bestDistance = distance;
		}
	}
	return best;
}

export function nearestBond(graph: DrawGraph, point: Point, within: number): DrawBond | undefined {
	let best: DrawBond | undefined;
	let bestDistance = within;
	for (const bond of graph.bondList) {
		if (bond.hidden) continue;
		const a = atomById(graph, bond.from);
		const b = atomById(graph, bond.to);
		if (!a || !b) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy || 1;
		const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
		const distance = Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y);
		if (distance <= bestDistance) {
			best = bond;
			bestDistance = distance;
		}
	}
	return best;
}

export type RingPlace = { kind: 'Point'; point: Point } | { kind: 'Atom'; id: number } | { kind: 'Bond'; id: number };

/**
 * Adds a regular ring (bond length 1): on empty space, sharing an atom (spiro), or sharing a bond
 * (fused, on the side with more room). Aromatic rings get alternating double bonds that fit their
 * neighbours. Existing atoms at the same spot are reused. Returns the ring's atom IDs.
 */
export function addRing(graph: DrawGraph, size: number, aromatic: boolean, place: RingPlace): number[] {
	const step = 360 / size;
	const rotateAround = (point: Point, center: Point, degree: number): Point => {
		const radian = (degree * Math.PI) / 180;
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		return { x: center.x + dx * Math.cos(radian) - dy * Math.sin(radian), y: center.y + dx * Math.sin(radian) + dy * Math.cos(radian) };
	};
	const radius = 1 / (2 * Math.sin(Math.PI / size));
	let pointList: Point[];
	let shared: DrawBond | undefined;
	if (place.kind === 'Point') {
		// a corner on top, as chemists usually draw rings
		pointList = Array.from({ length: size }, (_, index) => {
			const radian = ((90 + index * step) * Math.PI) / 180;
			return { x: place.point.x + radius * Math.cos(radian), y: place.point.y + radius * Math.sin(radian) };
		});
	} else if (place.kind === 'Atom') {
		const atom = atomById(graph, place.id)!;
		const direction = (freeAngle(graph, atom) * Math.PI) / 180;
		const center = { x: atom.x + radius * Math.cos(direction), y: atom.y + radius * Math.sin(direction) };
		pointList = Array.from({ length: size }, (_, index) => rotateAround(atom, center, index * step));
	} else {
		shared = graph.bondList.find((bond) => bond.id === place.id);
		const a = shared ? atomById(graph, shared.from) : undefined;
		const b = shared ? atomById(graph, shared.to) : undefined;
		if (!a || !b) return [];
		const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
		const apothem = 1 / (2 * Math.tan(Math.PI / size));
		const crowd = (sign: number): number => {
			const center = { x: middle.x + normal.x * apothem * sign, y: middle.y + normal.y * apothem * sign };
			return graph.atomList.reduce((sum, atom) => sum + 1 / Math.max((atom.x - center.x) ** 2 + (atom.y - center.y) ** 2, 0.05), 0);
		};
		const sign = crowd(1) <= crowd(-1) ? 1 : -1;
		const center = { x: middle.x + normal.x * apothem * sign, y: middle.y + normal.y * apothem * sign };
		// walk from a to b and on around the ring
		const turn = Math.hypot(rotateAround(a, center, step).x - b.x, rotateAround(a, center, step).y - b.y) < 1e-6 ? step : -step;
		pointList = Array.from({ length: size }, (_, index) => rotateAround(a, center, index * turn));
	}
	const idList = pointList.map((point) => (nearestAtom(graph, point, 0.25) ?? addAtom(graph, point.x, point.y)).id);
	const ringBondList: DrawBond[] = [];
	for (let index = 0; index < size; index++) {
		const a = idList[index]!;
		const b = idList[(index + 1) % size]!;
		ringBondList.push(bondBetween(graph, a, b) ?? addBond(graph, a, b)!);
	}
	if (aromatic && size % 2 === 0) {
		// alternate double bonds; pick the pattern that leaves no atom with two double bonds
		const newBondSet = new Set(ringBondList.filter((bond) => bond !== shared).map((bond) => bond.id));
		const conflict = (parity: number): number => {
			let count = 0;
			for (const id of idList) {
				const doubleCount = neighborList(graph, id).filter(({ bond }) => {
					const index = ringBondList.indexOf(bond);
					if (index >= 0 && newBondSet.has(bond.id)) return index % 2 === parity;
					return bond.order === 2;
				}).length;
				if (doubleCount > 1) count++;
			}
			return count;
		};
		const parity = conflict(0) <= conflict(1) ? 0 : 1;
		ringBondList.forEach((bond, index) => {
			if (newBondSet.has(bond.id)) bond.order = index % 2 === parity ? 2 : 1;
		});
	}
	return idList;
}

// ---------------------------------------------------------------- chemfig → graph

/** Reads an atom label: element (+ hydrogens), charge, and \lewis electrons; anything else is kept as free text. */
export function readAtomLabel(raw: string): Pick<DrawAtom, 'element' | 'charge' | 'lonePair' | 'radical' | 'showLabel' | 'label'> {
	if (raw.replace(/[{}\s]/g, '') === '') return { element: 'C', charge: 0, lonePair: 0, radical: false, showLabel: false };
	const lewis = splitLewis(raw);
	const lonePair = lewis.electronList.filter((group) => group.kind !== 'Single').length;
	const radical = lewis.electronList.some((group) => group.kind === 'Single');
	let text = lewis.label.trim();
	let charge = 0;
	const chargeMatch = /\^\{?(\d?)([+-])\}?$|\^\{?\\(oplus|ominus)\}?$|\\(oplus|ominus)$/.exec(text);
	if (chargeMatch) {
		if (chargeMatch[2]) charge = (chargeMatch[2] === '+' ? 1 : -1) * (Number(chargeMatch[1]) || 1);
		else charge = (chargeMatch[3] ?? chargeMatch[4]) === 'oplus' ? 1 : -1;
		text = text.slice(0, chargeMatch.index);
	}
	const core = /^(H(?:_?\{?\d\}?)?)?([A-Z][a-z]?)(H(?:_?\{?\d\}?)?)?$/.exec(text);
	if (core && !(core[1] && core[3]) && valenceMap[core[2]!] !== undefined) return { element: core[2]!, charge, lonePair, radical, showLabel: true };
	return { element: '', charge: 0, lonePair, radical, showLabel: true, label: lewis.label.trim() };
}

export function fromMolecule(molecule: Molecule): DrawGraph {
	const graph = emptyGraph();
	const idList = molecule.atomList.map((atom) => addAtom(graph, atom.x, atom.y, 'C', { ...readAtomLabel(atom.label), ...(atom.name ? { name: atom.name } : {}) }).id);
	for (const bond of molecule.bondList) {
		const reversed = bond.kind === 'WedgeBack' || bond.kind === 'DashBack' || bond.kind === 'HollowBack';
		const from = idList[reversed ? bond.to : bond.from]!;
		const to = idList[reversed ? bond.from : bond.to]!;
		const order = bond.kind === 'Double' ? 2 : bond.kind === 'Triple' ? 3 : 1;
		const stereo: BondStereo = bond.kind.startsWith('Dash') ? 'Hash' : bond.kind.startsWith('Wedge') || bond.kind.startsWith('Hollow') ? 'Wedge' : 'None';
		addBond(graph, from, to, order, {
			stereo,
			...(bond.dash ? { dash: bond.dash } : {}),
			...(bond.color ? { color: bond.color } : {}),
			...(bond.name ? { name: bond.name } : {}),
			...(bond.hidden ? { hidden: true } : {}),
		});
	}
	return graph;
}

/** The text inside `\chemfig{…}` → a graph. */
export function fromChemfig(text: string): DrawGraph {
	return fromMolecule(parseMolecule(text));
}

// ---------------------------------------------------------------- graph → chemfig

function round(value: number, digit = 2): number {
	const factor = 10 ** digit;
	return Math.round(value * factor) / factor;
}

/** The chemfig label of an atom: `OH`, `H_2N`, `\lewis{0:4:,O}^{-}`, or '' for a bare carbon. */
export function atomLabelText(graph: DrawGraph, atom: DrawAtom): string {
	let core: string;
	let charge = '';
	if (atom.element === '' && atom.label !== undefined) core = atom.label;
	else if (!isLabelVisible(graph, atom)) core = '';
	else {
		const count = hydrogenCount(graph, atom);
		const hydrogen = count === 0 ? '' : count === 1 ? 'H' : `H_${count}`;
		core = hydrogenSide(graph, atom) === 'Left' ? `${hydrogen}${atom.element}` : `${atom.element}${hydrogen}`;
		if (atom.charge !== 0) charge = `^{${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ''}${atom.charge > 0 ? '+' : '-'}}`;
	}
	const electronList = electronAngleList(graph, atom);
	if (electronList.length > 0 && core !== '') {
		const spec = electronList.map((item) => `${item.angle / 45}${item.kind === 'Single' ? '.' : ':'}`).join('');
		return `\\lewis{${spec},${core}}${charge}`;
	}
	return core + charge;
}

function bondSymbol(bond: DrawBond, fromId: number): string {
	if (bond.order === 2) return '=';
	if (bond.order === 3) return '~';
	if (bond.stereo === 'Wedge') return bond.from === fromId ? '>' : '<';
	if (bond.stereo === 'Hash') return bond.from === fromId ? '>:' : '<:';
	return '-';
}

function bondText(bond: DrawBond, from: DrawAtom, to: DrawAtom): string {
	// whole degrees for drawn angles; a tenth where that matters (long invisible bonds)
	const exact = normalizeDegree(degreeOf(from, to));
	const angle = Math.abs(exact - Math.round(exact)) < 0.05 ? Math.round(exact) : round(exact, 1);
	const length = round(Math.hypot(to.x - from.x, to.y - from.y));
	const styleList = [...(bond.hidden ? ['draw=none'] : []), ...(bond.dash ? [bond.dash === 'Dashed' ? 'dashed' : 'dotted'] : []), ...(bond.color ? [bond.color] : [])];
	const lengthText = Math.abs(length - 1) > 0.01 ? String(length) : '';
	const option = styleList.length > 0 ? `[:${angle},${lengthText},,,${styleList.join(',')}]` : `[:${angle}${lengthText ? `,${lengthText}` : ''}]`;
	return `${bond.name ? `@{${bond.name}}` : ''}${bondSymbol(bond, from.id)}${option}`;
}

/**
 * The text inside `\chemfig{…}`. A tree walk from the leftmost atom: side chains become branches
 * `(…)`, rings close with hooks `?[a]` … `?[a]`, and separate fragments are joined by invisible
 * bonds so everything stays exactly where it was drawn.
 */
export function toChemfig(graph: DrawGraph): string {
	if (graph.atomList.length === 0) return '';
	const atomMap = new Map(graph.atomList.map((atom) => [atom.id, atom]));
	const adjacency = new Map<number, { bond: DrawBond; other: number }[]>(graph.atomList.map((atom) => [atom.id, []]));
	for (const bond of graph.bondList) {
		adjacency.get(bond.from)?.push({ bond, other: bond.to });
		adjacency.get(bond.to)?.push({ bond, other: bond.from });
	}
	const visited = new Set<number>();
	const usedBond = new Set<number>();
	const childMap = new Map<number, { bond: DrawBond; other: number }[]>();
	const closureList: DrawBond[] = [];
	const visit = (id: number): number => {
		visited.add(id);
		const childList: { bond: DrawBond; other: number }[] = [];
		let size = 1;
		for (const edge of adjacency.get(id) ?? []) {
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
	const sizeMap = new Map<number, number>();
	const rootList: number[] = [];
	for (const atom of [...graph.atomList].sort((left, right) => left.x - right.x || right.y - left.y)) {
		if (visited.has(atom.id)) continue;
		rootList.push(atom.id);
		visit(atom.id);
	}
	// the biggest subtree continues the chain; the others become branches
	const orderedChildren = (id: number): { bond: DrawBond; other: number }[] => [...(childMap.get(id) ?? [])].sort((left, right) => (sizeMap.get(left.other) ?? 0) - (sizeMap.get(right.other) ?? 0));
	// emission order decides which end of a ring closure comes first
	const emitIndex = new Map<number, number>();
	const number = (id: number): void => {
		emitIndex.set(id, emitIndex.size);
		for (const child of orderedChildren(id)) number(child.other);
	};
	for (const root of rootList) number(root);
	const hookName = new Map<number, string>();
	closureList.forEach((bond, index) => hookName.set(bond.id, String.fromCharCode(97 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : '')));
	const emit = (id: number, extraBranch = ''): string => {
		const atom = atomMap.get(id)!;
		const label = atomLabelText(graph, atom);
		const hookList = closureList.filter((bond) => bond.from === id || bond.to === id);
		let out = `${atom.name ? `@{${atom.name}}` : ''}${label === '' && (atom.name || hookList.length > 0) ? '{}' : label}`;
		for (const bond of hookList) {
			const other = bond.from === id ? bond.to : bond.from;
			const first = (emitIndex.get(id) ?? 0) < (emitIndex.get(other) ?? 0);
			const symbol = bondSymbol(bond, other);
			out += first ? `?[${hookName.get(bond.id)}]` : `?[${hookName.get(bond.id)}${symbol === '-' ? '' : `,{${symbol}}`}]`;
		}
		out += extraBranch;
		const childList = orderedChildren(id);
		childList.forEach((child, index) => {
			const part = bondText(child.bond, atom, atomMap.get(child.other)!) + emit(child.other);
			out += index < childList.length - 1 ? `(${part})` : part;
		});
		return out;
	};
	// other fragments hang off the first atom on invisible bonds, so they stay where they were drawn
	const first = atomMap.get(rootList[0]!)!;
	const extraBranch = rootList
		.slice(1)
		.map((root) => `(${bondText({ id: -1, from: first.id, to: root, order: 1, stereo: 'None', hidden: true }, first, atomMap.get(root)!)}${emit(root)})`)
		.join('');
	return emit(first.id, extraBranch);
}
