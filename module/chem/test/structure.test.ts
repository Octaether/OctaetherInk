import { describe, expect, it } from 'vitest';
import {
	type DrawGraph,
	addAtom,
	addBond,
	addRing,
	atomLabelText,
	emptyGraph,
	fromChemfig,
	hydrogenCount,
	neighborList,
	parseMolecule,
	readAtomLabel,
	toChemfig,
} from '../src';

/** Atom positions relative to the leftmost atom, rounded, sorted: the shape of a drawing. */
function shape(graph: DrawGraph): string[] {
	const origin = [...graph.atomList].sort((left, right) => left.x - right.x || right.y - left.y)[0]!;
	return graph.atomList.map((atom) => `${(atom.x - origin.x).toFixed(2)},${(atom.y - origin.y).toFixed(2)}`).sort();
}

function bondSummary(graph: DrawGraph): string[] {
	return graph.bondList.map((bond) => `${bond.order}${bond.stereo}${bond.hidden ? 'Hidden' : ''}`).sort();
}

describe('structure ↔ chemfig', () => {
	it('round-trips a molecule with wedges, hashes, names, and labels', () => {
		const source = '@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{lg}Br';
		const graph = fromChemfig(source);
		const text = toChemfig(graph);
		const again = fromChemfig(text);
		expect(shape(again)).toEqual(shape(graph));
		expect(bondSummary(again)).toEqual(bondSummary(graph));
		expect(again.atomList.find((atom) => atom.name === 'c')?.element).toBe('C');
		expect(again.atomList.find((atom) => atom.name === 'lg')?.element).toBe('Br');
		expect(again.bondList.some((bond) => bond.name === 'cb')).toBe(true);
		// the wedges still point the same way: narrow at the carbon
		const carbon = again.atomList.find((atom) => atom.name === 'c')!;
		expect(again.bondList.filter((bond) => bond.stereo !== 'None').every((bond) => bond.from === carbon.id)).toBe(true);
	});

	it('writes hydrogens on the free side, charges, and lone pairs', () => {
		const graph = emptyGraph();
		const c1 = addAtom(graph, 0, 0);
		const c2 = addAtom(graph, 0.87, 0.5);
		const oxygen = addAtom(graph, 1.73, 0, 'O');
		addBond(graph, c1.id, c2.id);
		addBond(graph, c2.id, oxygen.id);
		expect(hydrogenCount(graph, oxygen)).toBe(1);
		expect(atomLabelText(graph, oxygen)).toBe('OH');
		expect(atomLabelText(graph, c1)).toBe('');
		const nitrogen = addAtom(graph, -0.87, 0.5, 'N');
		addBond(graph, nitrogen.id, c1.id);
		expect(atomLabelText(graph, nitrogen)).toBe('H_2N');
		oxygen.charge = -1;
		oxygen.lonePair = 3;
		const label = atomLabelText(graph, oxygen);
		expect(label).toMatch(/^\\lewis\{\d:\d:\d:,O\}\^\{-\}$/);
		expect(readAtomLabel(label)).toMatchObject({ element: 'O', charge: -1, lonePair: 3 });
		// the lone pairs keep away from the bond
		const molecule = parseMolecule(toChemfig(graph));
		const drawn = molecule.atomList.find((atom) => atom.electronList.length === 3)!;
		expect(drawn.electronList.map((group) => group.angle)).not.toContain(150);
	});

	it('builds benzene and a fused second ring with alternating double bonds that fit', () => {
		const graph = emptyGraph();
		addRing(graph, 6, true, { kind: 'Point', point: { x: 0, y: 0 } });
		expect(graph.atomList).toHaveLength(6);
		expect(graph.bondList.filter((bond) => bond.order === 2)).toHaveLength(3);
		const shared = graph.bondList.find((bond) => bond.order === 1)!;
		addRing(graph, 6, true, { kind: 'Bond', id: shared.id });
		expect(graph.atomList).toHaveLength(10);
		expect(graph.bondList).toHaveLength(11);
		for (const atom of graph.atomList) expect(neighborList(graph, atom.id).filter(({ bond }) => bond.order === 2).length).toBeLessThanOrEqual(1);
		// naphthalene survives the trip through chemfig (ring closures become ?[a] hooks)
		const again = fromChemfig(toChemfig(graph));
		expect(shape(again)).toEqual(shape(graph));
		expect(bondSummary(again)).toEqual(bondSummary(graph));
	});

	it('keeps separate fragments where they were drawn with invisible bonds', () => {
		const graph = emptyGraph();
		const a = addAtom(graph, 0, 0, 'O', { charge: -1, lonePair: 3 });
		const b = addAtom(graph, 3, 0.5, 'C');
		const c = addAtom(graph, 4, 0.5, 'Br');
		addBond(graph, b.id, c.id);
		const text = toChemfig(graph);
		expect(text).toContain('draw=none');
		const again = fromChemfig(text);
		expect(shape(again)).toEqual(shape(graph));
		expect(again.bondList.filter((bond) => !bond.hidden)).toHaveLength(1);
		expect(a.id).not.toBe(b.id);
	});

	it('keeps free-form labels as they are', () => {
		expect(readAtomLabel('CO_2H')).toMatchObject({ element: '', label: 'CO_2H' });
		expect(readAtomLabel('H_3C')).toMatchObject({ element: 'C', showLabel: true });
		expect(readAtomLabel('N\\oplus')).toMatchObject({ element: 'N', charge: 1 });
		const graph = fromChemfig('CO_2H-[:0]{}');
		expect(toChemfig(graph)).toContain('CO_2H');
	});
});
