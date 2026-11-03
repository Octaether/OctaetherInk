import { describe, expect, it } from 'vitest';
import { type DrawGraph, addAtom, addBond, addRing, buildScene, emptyGraph, fromChemfig, isStructureText, parseStructure, sceneAnchor, structureMolecule, writeStructure } from '../src';

/** A rounded number without a minus sign on zero. */
const fixed = (value: number, digit: number): string => (Math.round(value * 10 ** digit) / 10 ** digit || 0).toFixed(digit);

/** Atom positions relative to the leftmost atom, rounded, sorted: the shape of a drawing. */
function shape(graph: DrawGraph): string[] {
	const origin = [...graph.atomList].sort((left, right) => Math.round(left.x * 1e4) - Math.round(right.x * 1e4) || Math.round(right.y * 1e4) - Math.round(left.y * 1e4))[0]!;
	return graph.atomList.map((atom) => `${fixed(atom.x - origin.x, 2)},${fixed(atom.y - origin.y, 2)}`).sort();
}

/** Each drawn bond as its two ends' positions (so wedge directions count), with order and style. Invisible bonds
 * are left out: writing separate fragments adds them. */
function bondSummary(graph: DrawGraph): string[] {
	const origin = [...graph.atomList].sort((left, right) => Math.round(left.x * 1e4) - Math.round(right.x * 1e4) || Math.round(right.y * 1e4) - Math.round(left.y * 1e4))[0]!;
	const at = (id: number): string => {
		const atom = graph.atomList.find((item) => item.id === id)!;
		return `${fixed(atom.x - origin.x, 1)},${fixed(atom.y - origin.y, 1)}`;
	};
	return graph.bondList.filter((bond) => !bond.hidden).map((bond) => {
		const ends = bond.stereo === 'None' ? [at(bond.from), at(bond.to)].sort().join('|') : `${at(bond.from)}>${at(bond.to)}`;
		return `${ends} ${bond.order}${bond.stereo}${bond.hidden ? 'Hidden' : ''}${bond.dash ?? ''}${bond.name ?? ''}`;
	}).sort();
}

function atomSummary(graph: DrawGraph): string[] {
	return graph.atomList.map((atom) => `${atom.element}|${atom.label ?? ''}|${atom.name ?? ''}|${atom.charge}|${atom.lonePair}|${atom.radical}`).sort();
}

function roundTrip(graph: DrawGraph): DrawGraph {
	const text = writeStructure(graph);
	const parsed = parseStructure(text);
	expect(parsed.problemList, text).toEqual([]);
	expect(shape(parsed.graph), text).toEqual(shape(graph));
	expect(bondSummary(parsed.graph), text).toEqual(bondSummary(graph));
	expect(atomSummary(parsed.graph), text).toEqual(atomSummary(graph));
	expect(writeStructure(parsed.graph), 'writing again gives the same text').toBe(text);
	return parsed.graph;
}

describe('Chem structure syntax', () => {
	it('reads the SN2 carbon: names, wedges, hashes, labels', () => {
		const { graph, problemList } = parseStructure('C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br');
		expect(problemList).toEqual([]);
		expect(graph.atomList).toHaveLength(5);
		const carbon = graph.atomList.find((atom) => atom.name === 'c')!;
		expect(carbon).toMatchObject({ element: 'C', showLabel: true, x: 0, y: 0 });
		expect(graph.atomList.find((atom) => atom.name === 'br')).toMatchObject({ element: 'Br', x: 1 });
		// wedge and hash are narrow at the carbon
		expect(graph.bondList.filter((bond) => bond.stereo !== 'None').every((bond) => bond.from === carbon.id)).toBe(true);
		expect(graph.bondList.find((bond) => bond.name === 'cb')?.order).toBe(1);
		roundTrip(graph);
	});

	it('reads charges, lone pairs, radicals, and free labels', () => {
		const { graph, problemList } = parseStructure('O@o^-:3 -0 C. -0 {t-Bu} -60 N^{2+} -0 CO_2H');
		expect(problemList).toEqual([]);
		expect(graph.atomList[0]).toMatchObject({ element: 'O', name: 'o', charge: -1, lonePair: 3 });
		expect(graph.atomList[1]).toMatchObject({ element: 'C', radical: 1 });
		expect(graph.atomList[2]).toMatchObject({ element: '', label: 't-Bu' });
		expect(graph.atomList[3]).toMatchObject({ element: 'N', charge: 2 });
		expect(graph.atomList[4]).toMatchObject({ element: '', label: 'CO_2H' });
		roundTrip(graph);
	});

	it('joins bonds with bare vertices and closes rings with &n', () => {
		const { graph, problemList } = parseStructure('&1 =30 -330 =270 -210 =150 -&1');
		expect(problemList).toEqual([]);
		expect(graph.atomList).toHaveLength(6);
		expect(graph.bondList).toHaveLength(6);
		expect(graph.bondList.filter((bond) => bond.order === 2)).toHaveLength(3);
		expect(graph.atomList.every((atom) => atom.element === 'C' && !atom.showLabel)).toBe(true);
		roundTrip(graph);
		// a double bond in a ring draws its second line inside the ring
		expect(structureMolecule(graph).bondList.filter((bond) => bond.kind === 'Double').every((bond) => bond.ringCenter)).toBe(true);
	});

	it('round-trips drawn graphs: fused rings, fragments, decimal angles and lengths, styles', () => {
		const rings = emptyGraph();
		addRing(rings, 6, true, { kind: 'Point', point: { x: 0, y: 0 } });
		addRing(rings, 5, false, { kind: 'Bond', id: rings.bondList.find((bond) => bond.order === 1)!.id });
		roundTrip(rings);

		const loose = emptyGraph();
		const a = addAtom(loose, 0, 0, 'Na', { showLabel: true, charge: 1 });
		const b = addAtom(loose, 3.2, 0.4, 'O', { charge: -1, lonePair: 3 });
		const c = addAtom(loose, 3.2 + 1.5 * Math.cos((33.3 * Math.PI) / 180), 0.4 + 1.5 * Math.sin((33.3 * Math.PI) / 180));
		addBond(loose, b.id, c.id, 1, { dash: 'Dashed', color: 'Accent', name: 'ts' });
		const d = addAtom(loose, c.x, c.y - 1);
		addBond(loose, d.id, c.id, 1, { stereo: 'Hash' });
		const text = writeStructure(loose);
		expect(text).toContain('-33.3*1.5@ts[Dashed, Accent]');
		expect(text).toMatch(/\.\d/);
		expect(a.charge).toBe(1);
		roundTrip(loose);
	});

	it('round-trips every structure of the chemistry guide', () => {
		for (const chemfig of [
			'@{o}\\lewis{0:2:6:,HO}^{-}',
			'@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{br}Br',
			'HO-[,,,,dashed]@{ts}C(-[2]H)(>[:235]H)(>:[:305]H)-[,,,,dashed]Br',
			'HO-C(-[:80]H)(>[:-35]H)(>:[:-70]H)',
			'*6(=-=-=-)',
			'*6(=-=(-Br)-=-)',
		]) {
			roundTrip(fromChemfig(chemfig));
		}
	});

	it('explains mistakes with their place', () => {
		const problem = (text: string): string[] => parseStructure(text).problemList.map((item) => `${item.start}-${item.end} ${item.message}`);
		expect(problem('C O')).toEqual(['2-3 two atoms need a bond between them']);
		expect(problem('C - O')).toEqual(['2-3 a bond needs its angle, like -30', '4-5 two atoms need a bond between them']);
		expect(problem('C&1 -30 O')[0]).toContain('&1 is never closed');
		expect(problem('C -0 O -&2')[0]).toContain('no atom is marked &2');
		expect(problem('C (-30 O')).toEqual(['8-8 missing ")"']);
		expect(problem('C -30 O)')).toEqual(['7-8 this ")" closes no branch']);
		expect(problem('C -30 O+')).toEqual(['6-8 "O+" is not an atom or a bond']);
	});

	it('tells structures from formulas and chemfig', () => {
		expect(isStructureText('H_2O')).toBe(true);
		expect(isStructureText('C -0 O')).toBe(true);
		expect(isStructureText('2H_2 + O_2 -> 2H_2O')).toBe(false);
		expect(isStructureText('\\chemfig{O}')).toBe(false);
		expect(isStructureText('C -0 O\nArrow a -> b')).toBe(false);
		expect(isStructureText('  ')).toBe(false);
	});

	it('draws a structure block with click-to-edit places and hydrogens', () => {
		const text = 'O@o^-:3';
		const scene = buildScene(text);
		expect(scene.moleculeList).toHaveLength(1);
		const atom = scene.moleculeList[0]!.molecule.atomList[0]!;
		expect(atom.pieceList.map((piece) => piece.text).join('')).toBe('OH−');
		expect(atom.electronList).toHaveLength(3);
		expect(atom.span).toEqual({ start: 0, end: text.length });
		const benzene = buildScene('&1 =30 -330 =270 -210 =150 -&1');
		expect(benzene.moleculeList[0]!.molecule.bondList[1]!.span).toEqual({ start: 7, end: 11 });
		expect(benzene.problemList).toEqual([]);
	});

	it('names points of a drawing for arrows: atoms, lone pairs, bonds, edges, and points between', () => {
		const scene = buildScene('O@o^-:3 -0@ob C@c');
		const oxygen = sceneAnchor(scene, 'o')!;
		const carbon = sceneAnchor(scene, 'c')!;
		expect(carbon.x).toBeGreaterThan(oxygen.x);
		// toward the carbon, the oxygen's point moves to the edge of its label
		expect(sceneAnchor(scene, 'o', carbon)!.x).toBeGreaterThan(oxygen.x + 0.2);
		// the lone pair facing up, or the one at 2 × 45° = 90°
		const pair = sceneAnchor(scene, 'o.lp', { x: oxygen.x, y: oxygen.y + 5 })!;
		expect(pair.y).toBeGreaterThan(oxygen.y + 0.3);
		expect(sceneAnchor(scene, 'o.lp2')!.y).toBeGreaterThan(oxygen.y + 0.3);
		expect(sceneAnchor(scene, 'ob')!.x).toBeCloseTo((oxygen.x + carbon.x) / 2);
		expect(sceneAnchor(scene, 'o!0.5!c')!.x).toBeCloseTo((oxygen.x + carbon.x) / 2);
		expect(sceneAnchor(scene, 'c.north')!.y).toBeGreaterThan(carbon.y);
		expect(sceneAnchor(scene, 'nowhere')).toBeUndefined();
	});
});

describe('hydrogens on an atom on its own', () => {
	it('go first on halides and on water, as chemists write them, and after on hydroxide and ammonia', () => {
		const label = (text: string): string => buildScene(text).moleculeList[0]!.molecule.atomList[0]!.pieceList.map((piece) => piece.text).join('');
		expect(label('Br')).toBe('HBr');
		expect(label('Cl')).toBe('HCl');
		expect(label('O')).toBe('H2O');
		expect(label('O^-')).toBe('OH−');
		expect(label('N')).toBe('NH3');
	});

	it('keeps hex colors on atoms and bonds', () => {
		const { graph } = parseStructure('C[#C0392B] -30[#2f5fd0] O');
		expect(graph.atomList[0]!.color).toBe('#C0392B');
		expect(graph.bondList[0]!.color).toBe('#2f5fd0');
		expect(writeStructure(graph)).toBe('C[#C0392B] -30[#2f5fd0] O');
	});
});
