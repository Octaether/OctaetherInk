// A Plot's lines, one thing each, as in Desmos. Style goes in `{…}` at the end of a line.
//
//   y = a sin(x)                    a curve (x = g(y) too)
//   a = 1 {Slider: [0, 5, 0.1]}     a number, with a slider (a plain number gets one anyway)
//   f(x) = x^2 / 4                  a function of your own (drawn when its variable is x)
//   x^2 + y^2 = 4                   an implicit curve;  y < f(x) shades a region
//   r = 1 + cos(θ)                  polar
//   (cos t, sin t) {T: [0, 2pi]}    parametric;  (1, 2) a point;  [(0,0), (1,1)] points
//   (Date, Weight)                  data: columns of the table the plot names (Plot {Data: Gym log});
//                                   Kind: Scatter, Line, Bar, Area, Pie, Donut
//   P = (2, f(2))                   a named point (its name is its label)
//   z = sin(x) cos(y)               3D: a surface;  x^2 + y^2 + z^2 = 4 an implicit surface;
//   (cos t, sin t, t/5)             a curve in space;  (A, B, C) points in space from three columns
//   # a comment

import { type ExpressionNode, ExpressionError, isBuiltinFunction, nameListOf, parseExpression } from '@octaether/core-expression';
import { type PropertyMap, type PropertyValue, findClosingBracket, parseFlowMapText } from '@octaether/core-format';

export type ItemKind = 'Define' | 'Function' | 'Explicit' | 'Polar' | 'Implicit' | 'Parametric' | 'Point' | 'Data' | 'Value';

export interface PlotItem {
	kind: ItemKind;
	/** The line it is on (0-based), and where its expression starts in the body. */
	line: number;
	offset: number;
	text: string;
	style: PropertyMap;
	node: ExpressionNode;
	/** Define and Function: the name; Explicit: the variable it gives (y, x, or z); a named point (`P = (1, 2)`): its name. */
	name?: string;
	parameterList?: string[];
	/** Implicit and inequalities: the relation and the two sides. */
	relation?: '=' | '<' | '<=' | '>' | '>=';
	left?: ExpressionNode;
	right?: ExpressionNode;
	/** Tuples: their parts (2 or 3). */
	partList?: ExpressionNode[];
	/** Define: a slider (min, max, step), and where the number is in the body (to write it back). */
	slider?: { min: number; max: number; step: number };
	valueSpan?: { start: number; end: number };
	/** True when it is drawn in space. */
	space: boolean;
}

export interface PlotProblem {
	line: number;
	start: number;
	end: number;
	message: string;
}

export interface PlotProgram {
	itemList: PlotItem[];
	problemList: PlotProblem[];
	/** Variables and functions defined by lines. */
	variableSet: Set<string>;
	functionSet: Set<string>;
	/** True when anything is in space (or `Dimension: 3`). */
	space: boolean;
}

const coordinateSet = new Set(['x', 'y', 'z', 'r', 'θ', 't', 'theta']);

/** A trailing `{Key: value}` map (keys start with a capital): the line's style. */
export function splitStyle(text: string): { expression: string; style: PropertyMap; styleProblem?: string } {
	const trimmed = text.replace(/\s+$/, '');
	if (!trimmed.endsWith('}')) return { expression: text, style: new Map() };
	// find the `{` that opens the last group
	for (let at = trimmed.lastIndexOf('{'); at >= 0; at = trimmed.lastIndexOf('{', at - 1)) {
		if (findClosingBracket(trimmed, at) !== trimmed.length - 1) continue;
		const inner = trimmed.slice(at + 1, -1).trim();
		if (!/^[A-Z][A-Za-z]*\s*:/.test(inner)) return { expression: text, style: new Map() };
		const { value, problem } = parseFlowMapText(trimmed.slice(at));
		return { expression: trimmed.slice(0, at), style: value, styleProblem: problem };
	}
	return { expression: text, style: new Map() };
}

const numberOf = (value: PropertyValue | undefined): number | undefined => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined);

/** Reads a Plot's body. `dimension` 3 makes everything that can be drawn in space. */
export function parsePlot(body: string, dimension?: number): PlotProgram {
	const lineList = body.split('\n');
	const problemList: PlotProblem[] = [];
	const itemList: PlotItem[] = [];
	// names first, so `a x` and `f(x)` read as meant wherever they are defined
	const variableSet = new Set<string>();
	const functionSet = new Set<string>();
	for (const line of lineList) {
		const definition = /^\s*([A-Za-zͰ-Ͽ][A-Za-z0-9Ͱ-Ͽ]*(?:_[A-Za-z0-9]+)?)\s*(\(([^)]*)\))?\s*=(?!=)/.exec(line);
		if (!definition) continue;
		const name = definition[1]!;
		if (definition[2] !== undefined) {
			if (!isBuiltinFunction(name)) functionSet.add(name);
		} else if (!coordinateSet.has(name)) variableSet.add(name);
	}
	const option = { split: true, knownName: (name: string) => variableSet.has(name) || coordinateSet.has(name), isFunction: (name: string) => functionSet.has(name) };
	let offset = 0;
	lineList.forEach((line, lineIndex) => {
		const lineStart = offset;
		offset += line.length + 1;
		if (line.trim() === '' || /^\s*(?:#|\/\/)/.test(line)) return;
		const { expression, style, styleProblem } = splitStyle(line);
		if (styleProblem) problemList.push({ line: lineIndex, start: lineStart + expression.length, end: lineStart + line.length, message: styleProblem });
		let node: ExpressionNode;
		try {
			node = parseExpression(expression, option);
		} catch (error) {
			if (error instanceof ExpressionError) problemList.push({ line: lineIndex, start: lineStart + error.start, end: lineStart + Math.max(error.end, error.start + 1), message: error.message });
			else problemList.push({ line: lineIndex, start: lineStart, end: lineStart + line.length, message: String(error) });
			return;
		}
		const item = classify(node, { line: lineIndex, offset: lineStart, text: expression.trim(), style }, variableSet, functionSet, dimension === 3);
		if (typeof item === 'string') problemList.push({ line: lineIndex, start: lineStart, end: lineStart + expression.length, message: item });
		else itemList.push(item);
	});
	const space = dimension === 3 || (dimension !== 2 && itemList.some((item) => item.space));
	if (space) for (const item of itemList) if (item.kind === 'Explicit' || item.kind === 'Implicit' || item.kind === 'Parametric' || item.kind === 'Point' || item.kind === 'Data') item.space = item.space || dimension === 3;
	return { itemList, problemList, variableSet, functionSet, space };
}

function classify(node: ExpressionNode, base: { line: number; offset: number; text: string; style: PropertyMap }, variableSet: Set<string>, functionSet: Set<string>, forceSpace: boolean): PlotItem | string {
	const make = (kind: ItemKind, extra: Partial<PlotItem> = {}): PlotItem => ({ kind, node, space: false, ...base, ...extra });
	const uses = (item: ExpressionNode, name: string): boolean => nameListOf(item).includes(name);
	// a capitalized name nobody defines is a column of the plot's tables (Weight, Date)
	const isColumn = (name: string): boolean => /^[A-Z]/.test(name) && !variableSet.has(name) && !functionSet.has(name);
	const hasData = (item: ExpressionNode): boolean => containsList(item) || nameListOf(item).some(isColumn);
	if (node.kind === 'Binary' && ['=', '<', '<=', '>', '>='].includes(node.operator)) {
		const relation = node.operator as PlotItem['relation'];
		const { left, right } = node;
		if (relation === '=') {
			// f(x) = …: a function of your own
			if (left.kind === 'Call' && functionSet.has(left.name) && left.argumentList.every((argument) => argument.kind === 'Name')) {
				const parameterList = left.argumentList.map((argument) => (argument as { name: string }).name);
				return make('Function', { name: left.name, parameterList, right, left });
			}
			if (left.kind === 'Name') {
				const name = left.name;
				if ((name === 'y' || name === 'x') && !uses(right, name) && !uses(right, 'z')) return make('Explicit', { name, right, left, relation });
				if (name === 'z' && !uses(right, 'z')) return make('Explicit', { name, right, left, relation, space: true });
				if (name === 'r' && !uses(right, 'r') && !uses(right, 'x') && !uses(right, 'y')) return make('Polar', { right, left, relation });
				// P = (2, f(2)): a point (or a curve, or data) with a name, which is its label
				if (!coordinateSet.has(name) && (right.kind === 'Tuple' || (right.kind === 'List' && right.itemList.length > 0 && right.itemList.every((part) => part.kind === 'Tuple')))) {
					const inner = classify(right, base, variableSet, functionSet, forceSpace);
					return typeof inner === 'string' ? inner : { ...inner, name, left };
				}
				if (!coordinateSet.has(name) && !uses(right, name)) {
					const valueSpan = right.kind === 'Number' || (right.kind === 'Unary' && right.operand.kind === 'Number') ? { start: base.offset + right.start, end: base.offset + right.end } : undefined;
					let slider: PlotItem['slider'];
					const sliderValue = base.style.get('Slider');
					if (Array.isArray(sliderValue)) {
						const [min, max, step] = sliderValue.map(numberOf);
						if (min !== undefined && max !== undefined && max > min) slider = { min, max, step: step ?? niceStep((max - min) / 100) };
					} else if (valueSpan && sliderValue !== false) {
						// a plain number gets a slider, as in Desmos
						const value = Number(base.text.slice(base.text.indexOf('=') + 1).replace(/\s/g, ''));
						const reach = Math.max(10, Math.abs(value) * 2);
						slider = { min: value >= 0 ? Math.min(0, value) : -reach, max: value >= 0 ? reach : Math.max(0, -value), step: niceStep(reach / 100) };
					}
					return make('Define', { name, right, left, slider, valueSpan });
				}
			}
		}
		const space = forceSpace || uses(node, 'z');
		return make('Implicit', { relation, left, right, space });
	}
	if (node.kind === 'Tuple') {
		if (node.itemList.length < 2 || node.itemList.length > 3) return 'a point has 2 or 3 parts: (x, y) or (x, y, z)';
		const space = node.itemList.length === 3;
		if (node.itemList.some(hasData)) return make('Data', { partList: node.itemList, space });
		if (node.itemList.some((item) => uses(item, 't'))) return make('Parametric', { partList: node.itemList, space });
		return make('Point', { partList: node.itemList, space });
	}
	if (node.kind === 'List' && node.itemList.length > 0 && node.itemList.every((item) => item.kind === 'Tuple')) {
		const size = (node.itemList[0] as { itemList: ExpressionNode[] }).itemList.length;
		return make('Point', { partList: [], space: size === 3 });
	}
	// a bare expression of x is a curve; anything else is worked out and shown
	const nameList = nameListOf(node).filter((name) => !variableSet.has(name) && !isColumn(name));
	if (nameList.length === 1 && nameList[0] === 'x') return make('Explicit', { name: 'y', right: node, relation: '=' });
	if (nameList.length === 0) return make('Value');
	return `${nameList.join(', ')} ${nameList.length === 1 ? 'is' : 'are'} not defined`;
}

function containsList(node: ExpressionNode): boolean {
	switch (node.kind) {
		case 'List':
			return true;
		case 'Call':
			return node.argumentList.some(containsList) && !['mean', 'median', 'sum', 'count', 'stdev', 'var', 'min', 'max', 'range', 'total', 'length', 'average', 'quantile'].includes(node.name);
		case 'Unary':
			return containsList(node.operand);
		case 'Binary':
			return containsList(node.left) || containsList(node.right);
		default:
			return false;
	}
}

/** 1, 2, or 5 times a power of ten, near `rough`. */
export function niceStep(rough: number): number {
	if (!(rough > 0) || !Number.isFinite(rough)) return 1;
	const power = 10 ** Math.floor(Math.log10(rough));
	const fraction = rough / power;
	return (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * power;
}
