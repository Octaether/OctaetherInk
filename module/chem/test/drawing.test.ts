import type { PropertyMap } from '@octaether/core-format';
import type { BoardItem } from '@octaether/core-sdk';
import { describe, expect, it } from 'vitest';
import {
	type BoardDrawing,
	addAtom,
	addBond,
	boardScale,
	buildScene,
	chemfigToBoard,
	defaultBondLength,
	isStructureText,
	loadBoard,
	loadStructure,
	parseStructure,
	readBoardText,
	removeAtom,
	structureScene,
	syncBoard,
	syncStructure,
	writeBoard,
} from '../src';

const metric = { emPx: 16, option: {} };
const scale = boardScale(metric);
const unit = defaultBondLength;

function item(type: string, property: Record<string, unknown>, body = '', childList: BoardItem[] = []): BoardItem {
	return { type, property: new Map(Object.entries(property)) as PropertyMap, body, childList };
}

/** Where a Chem block at (X, Y) draws its atoms, in Board px, sorted. */
function drawnAtomList(body: string, x: number, y: number): string[] {
	const scene = structureScene(body);
	const placed = scene.moleculeList[0]!;
	return placed.molecule.atomList
		.map((atom) => `${(x + (atom.x * unit + placed.dx - scene.box.minX) * metric.emPx).toFixed(1)},${(y + (scene.box.maxY - (atom.y * unit + placed.dy)) * metric.emPx).toFixed(1)}`)
		.sort();
}

/** Where the tool has a structure's atoms, in Board px, sorted. */
function graphAtomList(drawing: BoardDrawing, part: number): string[] {
	return drawing.graph.atomList
		.filter((atom) => atom.part === part)
		.map((atom) => `${(atom.x * scale).toFixed(1)},${(-atom.y * scale || 0).toFixed(1)}`)
		.sort();
}

describe('drawing tool on one structure', () => {
	it('writes a new block in our structure syntax', () => {
		const drawing = loadStructure('');
		const a = addAtom(drawing.graph, 3, 3);
		addBond(drawing.graph, a.id, addAtom(drawing.graph, 4, 3).id);
		const next = syncStructure(drawing);
		expect(next.body).toBe('-0');
		expect(isStructureText(next.body)).toBe(true);
	});

	it('keeps a structure in our syntax, and joins fragments drawn apart to it', () => {
		const drawing = loadStructure('O@o^-:3 -0 C');
		expect(syncStructure(drawing).body).toBe('O@o^-:3 -0 C');
		const carbon = drawing.graph.atomList.find((atom) => atom.element === 'C')!;
		addBond(drawing.graph, carbon.id, addAtom(drawing.graph, carbon.x + 0.5, carbon.y + Math.sqrt(3) / 2).id, 2);
		const next = syncStructure(drawing);
		expect(next.body).toBe('O@o^-:3 -0 C =60');
		addAtom(next.graph, 30, 0, 'N', { showLabel: true });
		expect(syncStructure(next).body).toMatch(/^O@o\^-:3 \(\.[\d.]+\*[\d.]+ N\) -0 C =60$/);
	});

	it('opens a block that is one \\chemfig, and writes our syntax once it changes', () => {
		const chemfig = '\\chemfig{HO-C(=[1]O)}';
		const drawing = loadStructure(chemfig);
		expect(drawing.graph.atomList).toHaveLength(3);
		expect(syncStructure(drawing).body).toBe(chemfig);
		const doubleO = drawing.graph.atomList.find((atom) => drawing.graph.bondList.some((bond) => bond.order === 2 && bond.to === atom.id))!;
		removeAtom(drawing.graph, doubleO.id);
		const next = syncStructure(drawing);
		expect(next.body).toBe('O -0 C');
		expect(parseStructure(next.body).problemList).toEqual([]);
	});
});

describe('drawing tool on a Board', () => {
	const itemList = (): BoardItem[] => [
		item('Chem', { X: 10, Y: 20 }, 'O@o^-:3'),
		item('Chem', { X: 120, Y: 0 }, 'C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br'),
		item('Arrow', { From: 'o.lp', To: 'c' }),
		item('Text', { X: 0, Y: 90 }, 'backside attack'),
		item('Arrow', { X: 0, Y: 150, Length: 60 }, '', [item('Text', { Side: 'Below' }, 'slow')]),
	];

	it('reads every structure where the Board draws it, and keeps everything else as blocks', () => {
		const drawing = loadBoard(new Map(), itemList(), metric);
		expect(drawing.blockList.map((block) => block.type)).toEqual(['Chem', 'Chem', 'Arrow', 'Text', 'Arrow']);
		expect(drawing.blockList[4]!.childList[0]!.body).toBe('slow');
		const [hydroxide, carbon] = drawing.blockList;
		expect(graphAtomList(drawing, hydroxide!.id)).toEqual(drawnAtomList('O@o^-:3', 10, 20));
		expect(graphAtomList(drawing, carbon!.id)).toEqual(drawnAtomList('C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br', 120, 0));
	});

	it('writes the Board back exactly when nothing changed, and reads its text again', () => {
		const drawing = loadBoard(new Map(), itemList(), metric);
		const text = writeBoard(syncBoard(drawing, metric));
		expect(text).toBe(writeBoard(drawing));
		expect(text.split('\n')[0]).toBe('Board:');
		expect(text).toContain('\tChem {X: 120, Y: 0}: C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br');
		expect(text).toContain('\tArrow {X: 0, Y: 150, Length: 60}:\n\t\tslow {Side: Below}');
		expect(writeBoard(readBoardText(text, metric)!)).toBe(text);
	});

	it('moves a structure by its atoms: its X and Y follow, its text stays', () => {
		const drawing = loadBoard(new Map(), itemList(), metric);
		const carbon = drawing.blockList[1]!;
		for (const atom of drawing.graph.atomList) if (atom.part === carbon.id) atom.x -= 40 / scale;
		const next = syncBoard(drawing, metric);
		const moved = next.blockList[1]!;
		expect(moved.body).toBe('C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br');
		expect(moved.property.get('X')).toBeCloseTo(80, 0);
		expect(moved.property.get('Y')).toBeCloseTo(0, 0);
	});

	it('rewrites a changed structure and keeps its atoms where they are', () => {
		const drawing = loadBoard(new Map(), itemList(), metric);
		const carbon = drawing.blockList[1]!;
		const bromine = drawing.graph.atomList.find((atom) => atom.name === 'br')!;
		const before = graphAtomList(drawing, carbon.id);
		addBond(drawing.graph, bromine.id, addAtom(drawing.graph, bromine.x + 1, bromine.y, 'C', { part: carbon.id }).id);
		const next = syncBoard(drawing, metric);
		const changed = next.blockList[1]!;
		expect(changed.body).not.toBe(carbon.body);
		expect(changed.body).toContain('@br');
		// read again from its text and X/Y, every atom is where it was drawn (to a few tenths of a px)
		const again = loadBoard(new Map(), [item('Chem', Object.fromEntries(changed.property), changed.body)], metric);
		const after = graphAtomList(again, again.blockList[0]!.id);
		expect(after).toHaveLength(before.length + 1);
		for (const point of before) {
			const [x, y] = point.split(',').map(Number);
			expect(after.some((other) => Math.hypot(Number(other.split(',')[0]) - x!, Number(other.split(',')[1]) - y!) < 0.3)).toBe(true);
		}
	});

	it('joins two structures a bond connects, makes a fragment drawn on its own a new Chem block, and drops an erased one', () => {
		const drawing = loadBoard(new Map(), itemList(), metric);
		const oxygen = drawing.graph.atomList.find((atom) => atom.name === 'o')!;
		const carbon = drawing.graph.atomList.find((atom) => atom.name === 'c')!;
		addBond(drawing.graph, oxygen.id, carbon.id);
		const joined = syncBoard(drawing, metric);
		expect(joined.blockList.filter((block) => block.type === 'Chem')).toHaveLength(1);
		expect(joined.blockList[0]!.body).toContain('@o');
		expect(joined.blockList[0]!.body).toContain('@c');

		const apart = loadBoard(new Map(), itemList(), metric);
		const first = addAtom(apart.graph, 30, -30);
		addBond(apart.graph, first.id, addAtom(apart.graph, 31, -30).id);
		const grown = syncBoard(apart, metric);
		const added = grown.blockList.at(-1)!;
		expect(added.type).toBe('Chem');
		expect(added.body).toBe('-0');
		expect(Number(added.property.get('X'))).toBeGreaterThan(30 * scale - 20);

		const erased = loadBoard(new Map(), itemList(), metric);
		for (const atom of [...erased.graph.atomList]) if (atom.name === 'o') removeAtom(erased.graph, atom.id);
		expect(syncBoard(erased, metric).blockList.map((block) => block.type)).toEqual(['Chem', 'Arrow', 'Text', 'Arrow']);
	});

	it('keeps a Chem block it can not draw (a chemfig scheme) as a block', () => {
		const drawing = loadBoard(new Map(), [item('Chem', { X: 0, Y: 0 }, '\\chemfig{A} \\+ \\chemfig{B}'), item('Chem', { X: 0, Y: 50 }, '')], metric);
		expect(drawing.graph.atomList).toHaveLength(0);
		expect(syncBoard(drawing, metric).blockList).toHaveLength(2);
	});
});

describe('chemfig → Board', () => {
	const mechanism = [
		'\\chemfig{@{o}\\lewis{0:2:6:,HO}^{-}} \\qquad \\chemfig{@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{br}Br}',
		'Arrow o.lp -> c',
		'Arrow cb -> br {Curve: 70, Kind: Fishhook}',
		'Label c {Side: Below}: backside attack',
		'\\schemestart \\arrow{<=>[][slow]} \\chemfig{HO-C} \\+ Br^{-} \\schemestop',
	].join('\n');

	it('makes a block of each structure, arrow, label, and piece of text', () => {
		const itemList = chemfigToBoard(mechanism, {}, 16);
		// a single species (Br^-) is a Chem block, so it takes lone pairs; a plus sign is text
		expect(itemList.map((block) => block.type)).toEqual(['Chem', 'Chem', 'Chem', 'Text', 'Chem', 'Arrow', 'Arrow', 'Arrow', 'Text']);
		const [hydroxide, carbon] = itemList;
		expect(hydroxide!.body).toBe('O@o^-:3');
		expect(carbon!.body).toContain('C@c');
		expect(itemList[3]!.body).toBe('{Chem: +}');
		expect(itemList[4]!.body).toBe('Br^-');
		const equilibrium = itemList[5]!;
		expect(Object.fromEntries(equilibrium.property)).toMatchObject({ Kind: 'Equilibrium' });
		expect(equilibrium.childList.map((child) => [child.body, child.property.get('Side')])).toEqual([['slow', 'Below']]);
		// arrows between names keep them, and keep what their line said
		expect(Object.fromEntries(itemList[6]!.property)).toEqual({ From: 'o.lp', To: 'c' });
		expect(Object.fromEntries(itemList[7]!.property)).toEqual({ From: 'cb', To: 'br', Curve: 70, Kind: 'Fishhook' });
		expect(itemList[8]!.body).toBe('backside attack');
	});

	it('pins each structure where the chemfig block draws it', () => {
		const scene = buildScene(mechanism);
		const board = loadBoard(new Map(), chemfigToBoard(mechanism, {}, 16), metric);
		scene.moleculeList.forEach((placed, index) => {
			const expected = placed.molecule.atomList.map((atom) => ({ x: (atom.x * unit + placed.dx - scene.box.minX) * 16, y: (scene.box.maxY - (atom.y * unit + placed.dy)) * 16 }));
			const block = board.blockList[index]!;
			const actual = board.graph.atomList.filter((atom) => atom.part === block.id).map((atom) => ({ x: atom.x * scale, y: -atom.y * scale }));
			// the same atoms in some order: compare each one's nearest
			for (const point of expected) expect(Math.min(...actual.map((other) => Math.hypot(other.x - point.x, other.y - point.y)))).toBeLessThan(0.15);
		});
	});
});
