// What the drawing tool edits, and how it goes back into the note.
//
//   Structure  one Chem block: our own syntax (path.ts), a new block, or a block that is one \chemfig
//              and nothing else (written in our syntax once it changes)
//   Board      the blocks of a Board, each at its X/Y in px: every Chem block's atoms are in one graph
//              (`part` = the block's number), so bonds can join them; arrows, text, and other blocks
//              are kept as blocks. Nothing is laid out again: things stay where they're drawn.
//
// The graph is in bond lengths with y up. On a Board, 1px is 1 / (bond length in em × emPx) of that, and
// a Chem block's top left is the top left of its drawing, so its X/Y follows from where its atoms are.

import { type BlockNode, type PropertyMap, createBlockNode, createTextNode, defaultItemTypeSet, parseNote, relevel, serializeNode } from '@octaether/core-format';
import type { BoardItem } from '@octaether/core-sdk';
import { isStructureText, writeStructure } from './path';
import { type Scene, type SceneOption, buildScene, defaultBondLength, structureScene } from './scene';
import { type DrawAtom, type DrawGraph, type Point, addAtom, addBond, cloneGraph, emptyGraph, fromMolecule } from './structure';

const unitOf = (option: SceneOption): number => option.bondLength ?? defaultBondLength;

function centroid(pointList: readonly Point[]): Point {
	const x = pointList.reduce((sum, point) => sum + point.x, 0) / pointList.length;
	const y = pointList.reduce((sum, point) => sum + point.y, 0) / pointList.length;
	return { x, y };
}

/** The atoms and bonds of one structure (sharing the graph's objects). */
export function partGraph(graph: DrawGraph, part: number): DrawGraph {
	const atomList = graph.atomList.filter((atom) => atom.part === part);
	const idSet = new Set(atomList.map((atom) => atom.id));
	return { atomList, bondList: graph.bondList.filter((bond) => idSet.has(bond.from) && idSet.has(bond.to)), nextId: graph.nextId };
}

/** Copies a structure's atoms and bonds into the graph as structure `part`, each atom placed by `at`. */
function addPart(graph: DrawGraph, part: DrawGraph, index: number, at: (atom: DrawAtom) => Point): void {
	const idMap = new Map<number, number>();
	for (const atom of part.atomList) {
		const { id, x, y, ...rest } = atom;
		const point = at(atom);
		idMap.set(id, addAtom(graph, point.x, point.y, rest.element, { ...rest, part: index }).id);
	}
	for (const { id, from, to, order, ...rest } of part.bondList) addBond(graph, idMap.get(from)!, idMap.get(to)!, order, rest);
}

/** True when a chemfig body is one \chemfig and nothing else. */
function isSingleChemfig(body: string, scene: Scene): boolean {
	const placed = scene.moleculeList[0];
	if (!placed || scene.moleculeList.length > 1 || scene.textList.length + scene.arrowList.length + scene.curveList.length + scene.labelList.length > 0) return false;
	return body.slice(0, placed.span.start).trim() === '' && body.slice(placed.span.end).trim() === '';
}

/** True when a Chem block is one structure the drawing tool can edit (a new block too). */
export function isOneStructure(body: string, option: SceneOption = {}): boolean {
	if (body.trim() === '' || isStructureText(body)) return true;
	return /\\[A-Za-z]/.test(body) && isSingleChemfig(body, buildScene(body, option));
}

/** A one-structure Chem block's scene and its graph (atom i of the graph is atom i of the scene's molecule). */
function readStructure(body: string, option: SceneOption): { scene: Scene; part: DrawGraph | undefined } {
	if (/\\[A-Za-z]/.test(body)) {
		const scene = buildScene(body, option);
		const placed = scene.moleculeList[0];
		return { scene, part: placed ? fromMolecule(placed.molecule) : undefined };
	}
	const scene = structureScene(body, option);
	return { scene, part: scene.graph };
}

// ---------------------------------------------------------------- one structure

export interface StructureDrawing {
	kind: 'Structure';
	body: string;
	scene: Scene;
	graph: DrawGraph;
	/** The graph's text when it was read or last written: a block whose drawing still gives it keeps its text. */
	baseline: string;
}

export function loadStructure(body: string, option: SceneOption = {}): StructureDrawing {
	const unit = unitOf(option);
	const graph = emptyGraph();
	const { scene, part } = readStructure(body, option);
	const placed = scene.moleculeList[0];
	if (placed && part) addPart(graph, part, 0, (atom) => ({ x: atom.x + placed.dx / unit, y: atom.y + placed.dy / unit }));
	return { kind: 'Structure', body, scene, graph, baseline: writeStructure(graph) };
}

/** Writes the structure: everything drawn belongs to it (fragments are joined by invisible bonds). */
export function syncStructure(drawing: StructureDrawing, option: SceneOption = {}): StructureDrawing {
	const { graph } = drawing;
	for (const atom of graph.atomList) atom.part = 0;
	const text = writeStructure(graph);
	// a block still in chemfig stays as it is until its drawing changes
	const body = text === drawing.baseline ? drawing.body : text;
	const scene = body === drawing.body ? drawing.scene : structureScene(body, option);
	return { kind: 'Structure', body, scene, graph, baseline: text };
}

// ---------------------------------------------------------------- Board

/** A block on the Board as the tool keeps it. */
export interface BoardBlock {
	/** The tool's own number for it (a Chem block's atoms have it as `part`). */
	id: number;
	type: string;
	property: PropertyMap;
	body: string;
	blockId?: string;
	childList: BoardBlock[];
	/** A Chem block drawn in the graph: its structure's text when read or last written. */
	baseline?: string;
}

export interface BoardDrawing {
	kind: 'Board';
	/** The Board's own properties. */
	property: PropertyMap;
	blockList: BoardBlock[];
	graph: DrawGraph;
	nextId: number;
}

/** How big things are where the Board is drawn: 1em in px, and the Chem bond length. */
export interface BoardMetric {
	emPx: number;
	option: SceneOption;
}

/** px on the Board per bond length of the graph. */
export function boardScale(metric: BoardMetric): number {
	return unitOf(metric.option) * metric.emPx;
}

export function numberOf(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A Chem block the graph holds (one structure); other Chem blocks (a whole chemfig scheme) stay blocks. */
export function isDrawnChem(block: { type: string; body: string }, option: SceneOption): boolean {
	return block.type === 'Chem' && isOneStructure(block.body, option);
}

export function loadBoard(property: PropertyMap, itemList: readonly BoardItem[], metric: BoardMetric): BoardDrawing {
	const graph = emptyGraph();
	const scale = boardScale(metric);
	const unit = unitOf(metric.option);
	let nextId = 1;
	const read = (item: BoardItem): BoardBlock => {
		const block: BoardBlock = { id: nextId++, type: item.type, property: new Map(item.property), body: item.body, ...(item.id ? { blockId: item.id } : {}), childList: item.childList.map(read) };
		if (isDrawnChem(item, metric.option)) {
			block.baseline = '';
			const { scene, part } = readStructure(item.body, metric.option);
			const placed = scene.moleculeList[0];
			if (item.body.trim() !== '' && placed && part) {
				const left = numberOf(block.property.get('X'));
				const top = numberOf(block.property.get('Y'));
				// atom i of the graph is atom i of the molecule the block draws
				const atomIndex = new Map(part.atomList.map((atom, index) => [atom.id, index]));
				addPart(graph, part, block.id, (atom) => {
					const drawn = placed.molecule.atomList[atomIndex.get(atom.id)!]!;
					const px = { x: left + (drawn.x * unit + placed.dx - scene.box.minX) * metric.emPx, y: top + (scene.box.maxY - (drawn.y * unit + placed.dy)) * metric.emPx };
					return { x: px.x / scale, y: -px.y / scale };
				});
				block.baseline = writeStructure(partGraph(graph, block.id));
			}
		}
		return block;
	};
	const blockList = itemList.map(read);
	return { kind: 'Board', property: new Map(property), blockList, graph, nextId };
}

export function cloneBoard(drawing: BoardDrawing): BoardDrawing {
	const copy = (block: BoardBlock): BoardBlock => ({ ...block, property: new Map(block.property), childList: block.childList.map(copy) });
	return { ...drawing, property: new Map(drawing.property), blockList: drawing.blockList.map(copy), graph: cloneGraph(drawing.graph) };
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

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * After an edit: structures a bond joined become one, a fragment drawn on its own becomes a new
 * Chem block, an erased one goes, and each Chem block's text and X/Y follow its atoms.
 */
export function syncBoard(drawing: BoardDrawing, metric: BoardMetric): BoardDrawing {
	const { graph } = drawing;
	const scale = boardScale(metric);
	const unit = unitOf(metric.option);
	const chemIdSet = new Set(drawing.blockList.filter((block) => block.baseline !== undefined).map((block) => block.id));
	let nextId = drawing.nextId;
	const newIdList: number[] = [];
	for (const atomList of componentList(graph)) {
		const partList = atomList.flatMap((atom) => (atom.part !== undefined && chemIdSet.has(atom.part) ? [atom.part] : []));
		let part: number;
		if (partList.length > 0) part = Math.min(...partList);
		else {
			part = nextId++;
			newIdList.push(part);
		}
		for (const atom of atomList) atom.part = part;
	}
	const place = (block: BoardBlock): BoardBlock | undefined => {
		const atomList = graph.atomList.filter((atom) => atom.part === block.id);
		// a Chem block that never had atoms (empty, or text that doesn't read) stays; one whose atoms were all erased goes
		if (atomList.length === 0) return block.baseline === '' ? block : undefined;
		const text = writeStructure(partGraph(graph, block.id));
		const body = text === block.baseline ? block.body : text;
		const { scene } = readStructure(body, metric.option);
		const placed = scene.moleculeList[0];
		const property = new Map(block.property);
		if (placed && placed.molecule.atomList.length === atomList.length) {
			// the block's top left, so that its drawing's atoms land where the graph has them
			const drawn = centroid(placed.molecule.atomList.map((atom) => ({ x: (atom.x * unit + placed.dx - scene.box.minX) * metric.emPx, y: (scene.box.maxY - (atom.y * unit + placed.dy)) * metric.emPx })));
			const here = centroid(atomList.map((atom) => ({ x: atom.x * scale, y: -atom.y * scale })));
			const x = round(here.x - drawn.x);
			const y = round(here.y - drawn.y);
			if (!property.has('X') || Math.abs(x - numberOf(property.get('X'))) > 0.05) property.set('X', x);
			if (!property.has('Y') || Math.abs(y - numberOf(property.get('Y'))) > 0.05) property.set('Y', y);
		}
		return { ...block, property, body, baseline: text };
	};
	const blockList = drawing.blockList.flatMap((block) => (block.baseline === undefined ? [block] : (place(block) ?? [])));
	for (const id of newIdList) {
		const block = place({ id, type: 'Chem', property: new Map(), body: '', childList: [], baseline: '\u0000' });
		if (block) blockList.push(block);
	}
	return { ...drawing, blockList, nextId };
}

function toNode(block: BoardBlock): BlockNode {
	const property = new Map(block.property);
	for (const key of ['X', 'Y', 'Length']) if (typeof property.get(key) === 'number') property.set(key, round(numberOf(property.get(key))));
	const childList = block.childList.map(toNode);
	const id = block.blockId;
	if (block.type === 'Text') return createTextNode(block.body, { property, childList, ...(id ? { id } : {}) });
	return createBlockNode(block.type, { property, body: block.body, childList, content: defaultItemTypeSet.has(block.type) ? 'Item' : 'Raw', ...(id ? { id } : {}) });
}

/** The Board as OI text. */
export function writeBoard(drawing: BoardDrawing): string {
	const node = createBlockNode('Board', { property: drawing.property, content: 'Item', childList: drawing.blockList.map(toNode) });
	// new nodes start at level 0; the Board's blocks are one level in
	relevel(node, 0);
	return serializeNode(node).join('\n');
}

/** The blocks of a Board as the SDK hands them over. */
export function boardItemOf(node: BlockNode): BoardItem {
	return { type: node.type, property: node.property, body: node.body, ...(node.id ? { id: node.id } : {}), childList: node.childList.map(boardItemOf) };
}

/** Reads a Board back from its OI text (typed in the tool); undefined when it isn't one Board. */
export function readBoardText(text: string, metric: BoardMetric): BoardDrawing | undefined {
	const note = parseNote(text);
	const board = note.itemList.find((node) => node.type === 'Board');
	if (!board) return undefined;
	return loadBoard(board.property, board.childList.map(boardItemOf), metric);
}
