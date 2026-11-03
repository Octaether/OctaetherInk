import { describe, expect, it } from 'vitest';
import { type BlockDrawing, addAtom, addBond, defaultBondLength, finishDrawing, loadDrawing, removeAtom, removeSpan, rowEnd, syncDrawing } from '../src';

const unit = defaultBondLength;
const body = '\\chemfig{*6(=-=-=-)} \\+ \\chemfig{@{o}O}\nLabel o {Side: Below}: oxygen';

/** Where the block draws each atom of a structure, in bond lengths, rounded and sorted. */
function scenePointList(drawing: BlockDrawing, index: number): string[] {
	const placed = drawing.scene.moleculeList[index]!;
	return placed.molecule.atomList.map((atom) => `${(atom.x + placed.dx / unit).toFixed(2)},${(atom.y + placed.dy / unit).toFixed(2)}`).sort();
}

function graphPointList(drawing: BlockDrawing, index: number): string[] {
	return drawing.graph.atomList.filter((atom) => atom.part === index).map((atom) => `${atom.x.toFixed(2)},${atom.y.toFixed(2)}`).sort();
}

const oxygen = (drawing: BlockDrawing) => drawing.graph.atomList.find((atom) => atom.name === 'o')!;

describe('drawing tool on a whole block', () => {
	it('reads every structure, placed where the block draws it', () => {
		const drawing = loadDrawing(body);
		expect(drawing.graph.atomList.filter((atom) => atom.part === 0)).toHaveLength(6);
		expect(oxygen(drawing).part).toBe(1);
		expect(graphPointList(drawing, 0)).toEqual(scenePointList(drawing, 0));
		expect(graphPointList(drawing, 1)).toEqual(scenePointList(drawing, 1));
	});

	it('keeps the text of structures that did not change', () => {
		expect(syncDrawing(loadDrawing(body)).body).toBe(body);
	});

	it('rewrites only the structure that changed, and moves the others to their new place', () => {
		const drawing = loadDrawing(body);
		const ringAtom = [...drawing.graph.atomList].filter((atom) => atom.part === 0).sort((left, right) => left.x - right.x)[0]!;
		const methyl = addAtom(drawing.graph, ringAtom.x - 1, ringAtom.y);
		addBond(drawing.graph, ringAtom.id, methyl.id);
		const next = syncDrawing(drawing);
		const [first, rest] = next.body.split(' \\+ ');
		expect(first).not.toBe('\\chemfig{*6(=-=-=-)}');
		expect(rest).toBe('\\chemfig{@{o}O}\nLabel o {Side: Below}: oxygen');
		expect(next.graph).toBe(drawing.graph);
		expect(graphPointList(next, 0)).toEqual(scenePointList(next, 0));
		expect(graphPointList(next, 1)).toEqual(scenePointList(next, 1));
	});

	it('makes a structure drawn apart a new \\chemfig after the last row, on a new line when drawn below', () => {
		const beside = loadDrawing(body);
		const right = beside.scene.box.maxX / unit + 4;
		const a = addAtom(beside.graph, right, 0);
		addBond(beside.graph, a.id, addAtom(beside.graph, right + 1, 0).id);
		const besideBody = syncDrawing(beside).body.split('\n');
		expect(besideBody).toHaveLength(2);
		expect(besideBody[0]).toMatch(/^\\chemfig\{\*6\(=-=-=-\)\} \\\+ \\chemfig\{@\{o\}O\} \\chemfig\{[^}]+\}$/);
		expect(besideBody[1]).toBe('Label o {Side: Below}: oxygen');

		const below = loadDrawing(body);
		const low = below.scene.box.minY / unit - 4;
		const b = addAtom(below.graph, 0, low);
		addBond(below.graph, b.id, addAtom(below.graph, 1, low).id);
		const next = syncDrawing(below);
		const belowBody = next.body.split('\n');
		expect(belowBody).toHaveLength(3);
		expect(belowBody[1]).toMatch(/^\\chemfig\{[^}]+\}$/);
		expect(next.graph.atomList.filter((atom) => atom.part === 2)).toHaveLength(2);
		expect(graphPointList(next, 2)).toEqual(scenePointList(next, 2));
	});

	it('puts the first structure into an empty block', () => {
		const drawing = loadDrawing('');
		const a = addAtom(drawing.graph, 3, 3);
		addBond(drawing.graph, a.id, addAtom(drawing.graph, 4, 3).id);
		expect(syncDrawing(drawing).body).toMatch(/^\\chemfig\{[^}]+\}$/);
	});

	it('joins two structures that a new bond connects', () => {
		const drawing = loadDrawing('\\chemfig{O} \\qquad \\chemfig{N}');
		const [o, n] = drawing.graph.atomList;
		addBond(drawing.graph, o!.id, n!.id);
		const next = syncDrawing(drawing);
		expect(next.body.match(/\\chemfig/g)).toHaveLength(1);
		expect(next.body).toContain('\\qquad');
		expect(next.scene.moleculeList[0]!.molecule.atomList).toHaveLength(2);
	});

	it('takes an erased structure out of the block', () => {
		const drawing = loadDrawing(body);
		removeAtom(drawing.graph, oxygen(drawing).id);
		expect(syncDrawing(drawing).body).toBe('\\chemfig{*6(=-=-=-)} \\+\nLabel o {Side: Below}: oxygen');
	});
});

describe('drawing tool on one structure', () => {
	it('reads only that structure and leaves the rest of the block alone', () => {
		const drawing = loadDrawing(body, {}, 1);
		expect(drawing.graph.atomList).toHaveLength(1);
		oxygen(drawing).charge = 1;
		const next = syncDrawing(drawing, {}, 1);
		expect(next.body.startsWith('\\chemfig{*6(=-=-=-)} \\+ \\chemfig{@{o}')).toBe(true);
		expect(next.body).not.toContain('\\chemfig{@{o}O}');
	});

	it('keeps a fragment drawn apart in the same \\chemfig', () => {
		const drawing = loadDrawing(body, {}, 1);
		const far = addAtom(drawing.graph, 40, 0, 'N', { showLabel: true });
		expect(far.part).toBeUndefined();
		const next = syncDrawing(drawing, {}, 1);
		expect(next.body.match(/\\chemfig/g)).toHaveLength(2);
		expect(next.graph.atomList.every((atom) => atom.part === 1)).toBe(true);
	});

	it('keeps the place of an erased structure while the tool is open, and takes it out at the end', () => {
		const drawing = loadDrawing(body, {}, 1);
		removeAtom(drawing.graph, oxygen(drawing).id);
		const next = syncDrawing(drawing, {}, 1);
		expect(next.body).toContain('\\+ \\chemfig{}');
		expect(next.scene.moleculeList).toHaveLength(2);
		expect(finishDrawing(next, 1)).toBe('\\chemfig{*6(=-=-=-)} \\+\nLabel o {Side: Below}: oxygen');
	});
});

describe('block text helpers', () => {
	it('removes a piece with the space around it', () => {
		expect(removeSpan('A B C', { start: 2, end: 3 })).toBe('A C');
		expect(removeSpan('A B', { start: 2, end: 3 })).toBe('A');
		expect(removeSpan('A\nB\nC', { start: 2, end: 3 })).toBe('A\nC');
		expect(removeSpan('B\nC', { start: 0, end: 1 })).toBe('C');
	});

	it('finds the end of the last row, before Arrow and Label lines and comments', () => {
		const text = 'A B % note\nC\nArrow a -> b\n\nLabel a: x';
		expect(rowEnd(text)).toBe(text.indexOf('C') + 1);
		expect(rowEnd('A B % note')).toBe(3);
		expect(rowEnd('Label a: x')).toBe(-1);
		expect(rowEnd('')).toBe(-1);
	});
});
