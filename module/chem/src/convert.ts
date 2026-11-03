// A chemfig Chem block → the blocks of a Board, each pinned where the block draws it now:
//
//   \chemfig{…}             → Chem {X, Y}: our structure syntax
//   \arrow{->[above][below]} → Arrow {X, Y, Length, Angle}: with Text {Side: Above/Below} inside
//   Arrow a -> b, \chemmove  → Arrow {From: a, To: b, Curve, Kind}: still between the same names
//   Label, formula text, \+  → Text {X, Y}
//
// Positions are px from the drawing's top left (the Board moves everything so its top left is 0, 0).

import { type PropertyMap, type PropertyValue, parseFlowMapText } from '@octaether/core-format';
import type { BoardItem } from '@octaether/core-sdk';
import { isStructureText, parseStructure, writeStructure } from './path';
import { type Point, type SceneOption, buildScene, defaultBondLength, structureScene } from './scene';
import { fromMolecule } from './structure';

const symbolMap: Readonly<Record<string, string>> = { Delta: 'Δ', delta: 'δ', Deg: '°', pm: '±', rightarrow: '→', to: '→', nu: 'ν', lambda: 'λ', alpha: 'α', beta: 'β', ominus: '⊖', oplus: '⊕' };

/** Scheme text (`Br_2`, `$\Delta$`, `heat`) → the text of a Text block (formulas as `{Chem: …}`). */
function textOf(raw: string): string {
	const simple = raw
		.replace(/\$/g, '')
		.replace(/\\([A-Za-z]+)/g, (_, name: string) => symbolMap[name] ?? name)
		.trim();
	return /[_^]/.test(simple) ? `{Chem: ${simple}}` : simple;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Formula text that is one species (`Br^{-}`, `HBr`, `H_2O`) in our structure syntax, or undefined. */
function speciesOf(raw: string): string | undefined {
	if (raw === '' || /\s/.test(raw) || !isStructureText(raw)) return undefined;
	const parsed = parseStructure(raw);
	return parsed.graph.atomList.length === 1 ? writeStructure(parsed.graph) : undefined;
}

function item(type: string, property: [string, PropertyValue][], body = '', childList: BoardItem[] = []): BoardItem {
	return { type, property: new Map(property) as PropertyMap, body, childList };
}

/**
 * The blocks of a Board for a chemfig body. `emPx` is 1em in px where the block is drawn, and
 * `scale` the block's own Scale (kept on each structure, so they stay the same size).
 */
export function chemfigToBoard(body: string, option: SceneOption, emPx: number, scale?: number): BoardItem[] {
	const unit = option.bondLength ?? defaultBondLength;
	const scene = buildScene(body, option);
	const { box } = scene;
	const px = (point: Point): { x: number; y: number } => ({ x: round((point.x - box.minX) * emPx), y: round((box.maxY - point.y) * emPx) });
	const itemList: BoardItem[] = [];
	const scaleProperty: [string, PropertyValue][] = typeof scale === 'number' && scale !== 1 ? [['Scale', scale]] : [];
	// structures: where the block draws each atom is where it stays
	for (const placed of scene.moleculeList) {
		const text = writeStructure(fromMolecule(placed.molecule));
		const child = structureScene(text, option);
		const childPlaced = child.moleculeList[0];
		if (!childPlaced || placed.molecule.atomList.length === 0) continue;
		const average = (atomList: { x: number; y: number }[], at: (atom: { x: number; y: number }) => Point): Point => {
			const pointList = atomList.map(at);
			return { x: pointList.reduce((sum, point) => sum + point.x, 0) / pointList.length, y: pointList.reduce((sum, point) => sum + point.y, 0) / pointList.length };
		};
		const here = average(placed.molecule.atomList, (atom) => ({ x: atom.x * unit + placed.dx, y: atom.y * unit + placed.dy }));
		const there = average(childPlaced.molecule.atomList, (atom) => ({ x: atom.x * unit + childPlaced.dx, y: atom.y * unit + childPlaced.dy }));
		// the Chem block's top left is its own drawing's top left
		const x = round((here.x - box.minX - (there.x - child.box.minX)) * emPx);
		const y = round((box.maxY - here.y - (child.box.maxY - there.y)) * emPx);
		itemList.push(item('Chem', [['X', x], ['Y', y], ...scaleProperty], text));
	}
	// formula text and plus signs: a line of text, its baseline where the block draws it; a single
	// species (Br^-, HBr, H_2O) is a Chem block instead, so it takes lone pairs, charges, and colors
	for (const text of scene.textList) {
		const raw = body.slice(text.span.start, text.span.end).trim();
		const species = text.plus ? undefined : speciesOf(raw);
		if (species) {
			const child = structureScene(species, option);
			// the middle of its drawing where the middle of the text was
			const middle = { x: text.x + text.width / 2, y: text.y + 0.27 };
			const x = round((middle.x - box.minX) * emPx - ((child.box.maxX - child.box.minX) / 2) * emPx);
			const y = round((box.maxY - middle.y) * emPx - ((child.box.maxY - child.box.minY) / 2) * emPx);
			itemList.push(item('Chem', [['X', x], ['Y', y], ...scaleProperty], species));
			continue;
		}
		const at = px({ x: text.x, y: text.y });
		// a plus sign as a formula: a line that is only + would read as a Markdown list
		const content = text.plus ? '{Chem: +}' : textOf(body.slice(text.span.start, text.span.end));
		itemList.push(item('Text', [['X', at.x], ['Y', round(at.y - 1.1 * emPx)]], content));
	}
	// reaction arrows, with their conditions inside
	for (const arrow of scene.arrowList) {
		const at = px(arrow.from);
		const end = px(arrow.to);
		const length = round(Math.hypot(end.x - at.x, end.y - at.y));
		const angle = Math.round((Math.atan2(-(end.y - at.y), end.x - at.x) * 180) / Math.PI);
		const kindMap: Record<string, [string, PropertyValue][]> = {
			'->': [],
			'<-': [['Head', 'Start']],
			'<->': [['Head', 'Both']],
			'<=>': [['Kind', 'Equilibrium']],
			'-/>': [['Kind', 'NoReaction']],
			'--': [['Kind', 'Line']],
		};
		const childList: BoardItem[] = [];
		for (const [side, label] of [['Above', arrow.above], ['Below', arrow.below]] as const) {
			if (label) childList.push(item('Text', [['Side', side]], textOf(body.slice(label.span.start, label.span.end))));
		}
		itemList.push(item('Arrow', [['X', at.x], ['Y', at.y], ['Length', length], ...(angle !== 0 ? ([['Angle', angle]] as [string, PropertyValue][]) : []), ...kindMap[arrow.type]!], '', childList));
	}
	// electron-pushing arrows: between the same names, so they follow the structures when moved
	for (const curve of scene.curveList) {
		const source = body.slice(curve.span.start, curve.span.end);
		const statement = /^Arrow\s+(\S+)\s*->\s*([^\s{]+)\s*(\{.*\})?/.exec(source);
		const nameList = statement ? [statement[1]!, statement[2]!] : [...source.matchAll(/(?<!\+)\(\s*([A-Za-z][\w.]*)\s*\)/g)].map((match) => match[1]!);
		const end = (name: string | undefined, point: Point): PropertyValue => {
			if (name && !name.startsWith('(') && !name.includes('$')) return name;
			const at = px(point);
			return [at.x, at.y];
		};
		const from = end(nameList[0], curve.from);
		const to = end(nameList.length > 1 ? nameList[nameList.length - 1] : undefined, curve.to);
		const property: [string, PropertyValue][] = [['From', from], ['To', to]];
		if (statement) {
			// an Arrow line keeps what it said (without a Curve, the Board bows it away from the drawing too)
			const written = statement[3] ? parseFlowMapText(statement[3]).value : new Map<string, PropertyValue>();
			if (typeof written.get('Curve') === 'number') property.push(['Curve', written.get('Curve')!]);
		} else {
			// \chemmove: the bow, as the angle between the chord and the first control (left of travel is positive)
			const chord = { x: curve.to.x - curve.from.x, y: curve.to.y - curve.from.y };
			const lead = { x: curve.control1.x - curve.from.x, y: curve.control1.y - curve.from.y };
			property.push(['Curve', Math.round((Math.atan2(chord.x * lead.y - chord.y * lead.x, chord.x * lead.x + chord.y * lead.y) * 180) / Math.PI)]);
		}
		if (curve.kind === 'Fishhook') property.push(['Kind', 'Fishhook']);
		if (curve.head !== 'End') property.push(['Head', curve.head]);
		if (curve.color) property.push(['Color', curve.color]);
		itemList.push(item('Arrow', property));
	}
	// labels: pinned where they were placed clear of the drawing
	for (const label of scene.labelList) {
		const at = px({ x: label.box.minX, y: label.box.maxY });
		const width = (label.box.maxX - label.box.minX) * emPx;
		const property: [string, PropertyValue][] = [['X', at.x], ['Y', at.y], ['Size', '0.85em'], ['TextAlign', 'Center']];
		if (width > 11 * emPx) property.push(['Width', round(width)]);
		const color = label.property.get('Color');
		if (typeof color === 'string') property.push(['Color', color]);
		itemList.push(item('Text', property, label.content));
	}
	return itemList;
}
