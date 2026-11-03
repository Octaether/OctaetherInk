// The drawing tool edits a whole Chem block at once. Every \chemfig of the block becomes part of
// one graph, placed where the block draws it, and each edit goes back into the block's text:
//
//   - Each atom remembers its structure (`part`: the index of its \chemfig in the block).
//   - A structure that still gives the same chemfig keeps its text as written (`*6(…)` stays).
//   - A bond between two structures makes them one. A structure drawn apart from the others becomes
//     a new \chemfig after the last row (on a new line when it was drawn below the drawing).
//   - Arrows, text, and labels stay text. The block is laid out again after every edit, so the tool
//     always shows the block as it will look.
//
// With `focus`, only that \chemfig is in the graph; the rest of the block is left alone.

import type { Span } from './molecule';
import { type Scene, type SceneOption, buildScene, defaultBondLength } from './scene';
import { type DrawAtom, type DrawGraph, type Point, addAtom, addBond, emptyGraph, fromMolecule, toChemfig } from './structure';

export interface BlockDrawing {
	body: string;
	scene: Scene;
	/** The structures being edited, in bond lengths, where the block draws them. */
	graph: DrawGraph;
	/** Each structure's chemfig as the graph gave it when last read or written. */
	baseline: (string | undefined)[];
}

const unitOf = (option: SceneOption): number => option.bondLength ?? defaultBondLength;

/** The atoms and bonds of one structure (sharing the graph's objects). */
export function partGraph(graph: DrawGraph, part: number): DrawGraph {
	const atomList = graph.atomList.filter((atom) => atom.part === part);
	const idSet = new Set(atomList.map((atom) => atom.id));
	return { atomList, bondList: graph.bondList.filter((bond) => idSet.has(bond.from) && idSet.has(bond.to)), nextId: graph.nextId };
}

export function loadDrawing(body: string, option: SceneOption = {}, focus?: number): BlockDrawing {
	const unit = unitOf(option);
	const scene = buildScene(body, option);
	const graph = emptyGraph();
	const baseline: (string | undefined)[] = [];
	scene.moleculeList.forEach((placed, index) => {
		if (focus !== undefined && index !== focus) return;
		const part = fromMolecule(placed.molecule);
		const idMap = new Map<number, number>();
		for (const { id, x, y, ...rest } of part.atomList) idMap.set(id, addAtom(graph, x + placed.dx / unit, y + placed.dy / unit, rest.element, { ...rest, part: index }).id);
		for (const { id, from, to, order, ...rest } of part.bondList) addBond(graph, idMap.get(from)!, idMap.get(to)!, order, rest);
		baseline[index] = toChemfig(partGraph(graph, index));
	});
	return { body, scene, graph, baseline };
}

/** Atoms that bonds (drawn or invisible) hold together. */
function componentList(graph: DrawGraph): DrawAtom[][] {
	const parent = new Map(graph.atomList.map((atom) => [atom.id, atom.id]));
	const find = (id: number): number => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root)!;
		parent.set(id, root);
		return root;
	};
	for (const bond of graph.bondList) {
		if (!parent.has(bond.from) || !parent.has(bond.to)) continue;
		const a = find(bond.from);
		const b = find(bond.to);
		if (a !== b) parent.set(b, a);
	}
	const groupMap = new Map<number, DrawAtom[]>();
	for (const atom of graph.atomList) {
		const root = find(atom.id);
		groupMap.set(root, [...(groupMap.get(root) ?? []), atom]);
	}
	return [...groupMap.values()];
}

/** Takes a piece of text out of a line, with the space around it. */
export function removeSpan(body: string, span: Span): string {
	const before = body.slice(0, span.start).replace(/[ \t]+$/, '');
	const after = body.slice(span.end).replace(/^[ \t]+/, '');
	if (before === '' || before.endsWith('\n')) return before + (after.startsWith('\n') ? after.slice(1) : after);
	return after === '' || after.startsWith('\n') ? before + after : `${before} ${after}`;
}

/** The end of the last row of the block (before Arrow and Label lines and comments); -1 when there is none. */
export function rowEnd(body: string): number {
	const lineList = body.split('\n');
	let start = body.length;
	for (let index = lineList.length - 1; index >= 0; index--) {
		const line = lineList[index]!;
		start -= line.length;
		const code = line.replace(/(^|[^\\])%.*$/, '$1');
		const trimmed = code.trim();
		if (trimmed !== '' && !/^(?:Arrow|Label)\b/.test(trimmed)) return start + code.replace(/\s+$/, '').length;
		start -= 1;
	}
	return -1;
}

function centroid(pointList: readonly Point[]): Point {
	const x = pointList.reduce((sum, point) => sum + point.x, 0) / pointList.length;
	const y = pointList.reduce((sum, point) => sum + point.y, 0) / pointList.length;
	return { x, y };
}

/** Writes the graph into the block's text and lays the block out again. The graph is updated in place
 * (structures joined, numbered, and moved to where the block now draws them) unless the text can't be
 * matched to it, when it is read again from the text. */
export function syncDrawing(drawing: BlockDrawing, option: SceneOption = {}, focus?: number): BlockDrawing {
	const unit = unitOf(option);
	const { graph, scene } = drawing;
	const count = scene.moleculeList.length;
	// structures joined by a bond become one (the first); a fragment of its own is a new structure
	let fresh = count;
	for (const atomList of componentList(graph)) {
		const partList = atomList.flatMap((atom) => (atom.part === undefined ? [] : [atom.part]));
		const part = partList.length > 0 ? Math.min(...partList) : (focus ?? fresh++);
		for (const atom of atomList) atom.part = part;
	}
	// the structures that changed, last first so the earlier spans stay valid
	let body = drawing.body;
	const textMap = new Map<number, string>();
	const removedSet = new Set<number>();
	for (let index = count - 1; index >= 0; index--) {
		if (focus !== undefined && index !== focus) continue;
		const text = toChemfig(partGraph(graph, index));
		if (text === drawing.baseline[index]) continue;
		const span = scene.moleculeList[index]!.span;
		// a structure edited alone keeps its place while it is empty, so it can be drawn again
		if (text === '' && focus === undefined) {
			body = removeSpan(body, span);
			removedSet.add(index);
		} else body = `${body.slice(0, span.start)}\\chemfig{${text}}${body.slice(span.end)}`;
		textMap.set(index, text);
	}
	for (let part = count; part < fresh; part++) {
		const atomList = graph.atomList.filter((atom) => atom.part === part);
		const text = toChemfig(partGraph(graph, part));
		const piece = `\\chemfig{${text}}`;
		const end = rowEnd(body);
		if (end < 0) body = body.trim() === '' ? piece : `${piece}\n${body.replace(/^\s*\n/, '')}`;
		else {
			const below = Math.max(...atomList.map((atom) => atom.y)) * unit < scene.box.minY;
			body = `${body.slice(0, end)}${below ? '\n' : ' '}${piece}${body.slice(end)}`;
		}
		textMap.set(part, text);
	}
	// lay the block out again and move each structure to where it is drawn now
	const next = buildScene(body, option);
	const indexMap = new Map<number, number>();
	for (let part = 0; part < fresh; part++) if (!removedSet.has(part)) indexMap.set(part, indexMap.size);
	if (next.moleculeList.length !== indexMap.size) return loadDrawing(body, option, focus);
	for (const atom of graph.atomList) atom.part = indexMap.get(atom.part!);
	const baseline: (string | undefined)[] = [];
	for (const [part, index] of indexMap) {
		if (focus !== undefined && part !== focus) continue;
		baseline[index] = textMap.get(part) ?? drawing.baseline[part];
		const atomList = graph.atomList.filter((atom) => atom.part === index);
		const placed = next.moleculeList[index]!;
		if (atomList.length !== placed.molecule.atomList.length) return loadDrawing(body, option, focus);
		if (atomList.length === 0) continue;
		const target = centroid(placed.molecule.atomList.map((atom) => ({ x: atom.x + placed.dx / unit, y: atom.y + placed.dy / unit })));
		const current = centroid(atomList);
		for (const atom of atomList) {
			atom.x += target.x - current.x;
			atom.y += target.y - current.y;
		}
	}
	return { body, scene: next, graph, baseline };
}

/** The block's text when the tool closes: a structure that was edited alone and erased is taken out. */
export function finishDrawing(drawing: BlockDrawing, focus?: number): string {
	if (focus === undefined || drawing.graph.atomList.length > 0) return drawing.body;
	const placed = drawing.scene.moleculeList[focus];
	return placed ? removeSpan(drawing.body, placed.span) : drawing.body;
}
