// A TikZ subset, parsed from zero. Units: cm, y up.
//   \draw[->, thick, red] (0,0) -- (2,1) node[above] {$f(x)$};   \fill  \filldraw  \path
//   \node[draw, circle] (a) at (1,1) {A};   \coordinate (o) at (0,0);
//   paths: -- -| |- .. controls (c) and (d) .. , rectangle, circle (r), ellipse (a and b),
//          arc (start:end:radius), grid, to[out=90,in=180], cycle, plot[domain=a:b] (\x,{sin(\x r)})
//   coordinates: (x,y) (angle:radius) (name) (name.north) +(dx,dy) ++(dx,dy), math allowed
//   \foreach \x in {0,...,4} { … }     \begin{tikzpicture}[scale=2] … \end{tikzpicture}

import { evaluate } from './expression';

export interface Point {
	x: number;
	y: number;
}

export interface Problem {
	start: number;
	end: number;
	message: string;
}

export type PathCommand =
	| { kind: 'M' | 'L'; x: number; y: number }
	| { kind: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	| { kind: 'A'; rx: number; ry: number; large: boolean; counterclockwise: boolean; x: number; y: number }
	| { kind: 'Z' };

export interface Style {
	stroke: string | undefined;
	fill: string | undefined;
	/** Line width in pt. */
	width: number;
	dash: 'Dashed' | 'Dotted' | undefined;
	opacity: number | undefined;
	arrowStart: boolean;
	arrowEnd: boolean;
	textColor: string | undefined;
}

export interface DiagramPath {
	commandList: PathCommand[];
	style: Style;
	span: { start: number; end: number };
}

export type Placement = 'Center' | 'Above' | 'Below' | 'Left' | 'Right' | 'AboveLeft' | 'AboveRight' | 'BelowLeft' | 'BelowRight';

export interface DiagramNode {
	x: number;
	y: number;
	text: string;
	/** Source offset of the node text, so a click edits exactly there. */
	textOffset: number;
	placement: Placement;
	shape: 'None' | 'Circle' | 'Rectangle';
	style: Style;
	/** Estimated half size in cm (for connecting lines and bounds). */
	halfWidth: number;
	halfHeight: number;
	span: { start: number; end: number };
}

export interface Diagram {
	pathList: DiagramPath[];
	nodeList: DiagramNode[];
	problemList: Problem[];
	box: { minX: number; minY: number; maxX: number; maxY: number };
}

const colorMap: Readonly<Record<string, string>> = {
	red: '#d6333a', green: '#2f9e44', blue: '#1c6fd1', cyan: '#1098ad', magenta: '#c2255c', yellow: '#e8b500', black: 'currentColor',
	gray: '#868e96', darkgray: '#495057', lightgray: '#ced4da', brown: '#8d5524', lime: '#74b816', olive: '#6b7a1d', orange: '#e8590c',
	pink: '#e64980', purple: '#7048e8', teal: '#0c8599', violet: '#9c36b5', white: 'var(--oi-color-background)',
};

const widthMap: Readonly<Record<string, number>> = { 'ultra thin': 0.1, 'very thin': 0.2, thin: 0.4, semithick: 0.6, thick: 0.8, 'very thick': 1.2, 'ultra thick': 1.6 };

/** `red`, `red!40`, `red!40!blue`, a theme token (`Accent`), or a hex color. */
export function tikzColor(text: string): string | undefined {
	const trimmed = text.trim();
	if (/^[A-Z][A-Za-z0-9.]*$/.test(trimmed) || /^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
	const [base, percent, other] = trimmed.split('!');
	const first = colorMap[base ?? ''];
	if (!first) return undefined;
	if (percent === undefined) return first;
	const second = other ? colorMap[other] : 'var(--oi-color-background)';
	const share = Math.min(100, Math.max(0, Number(percent) || 0));
	return second ? `color-mix(in srgb, ${first} ${share}%, ${second})` : first;
}

function splitTop(text: string, separator: string): string[] {
	const partList: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!;
		if ('([{'.includes(character)) depth++;
		else if (')]}'.includes(character)) depth--;
		else if (depth === 0 && text.startsWith(separator, index)) {
			partList.push(text.slice(start, index));
			start = index + separator.length;
			index += separator.length - 1;
		}
	}
	partList.push(text.slice(start));
	return partList;
}

function matching(text: string, open: number): number {
	const pair: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
	const close = pair[text[open]!]!;
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === text[open]) depth++;
		else if (text[index] === close && --depth === 0) return index;
	}
	return -1;
}

const unitMap: Readonly<Record<string, number>> = { cm: 1, mm: 0.1, pt: 1 / 28.45, in: 2.54, em: 0.42 };

interface OptionSet {
	flagSet: Set<string>;
	value: Map<string, string>;
}

function readOption(text: string): OptionSet {
	const flagSet = new Set<string>();
	const value = new Map<string, string>();
	for (const raw of splitTop(text, ',')) {
		const part = raw.trim();
		if (part === '') continue;
		const equal = part.indexOf('=');
		if (equal > 0) value.set(part.slice(0, equal).trim(), part.slice(equal + 1).trim());
		else flagSet.add(part);
	}
	return { flagSet, value };
}

function baseStyle(): Style {
	return { stroke: undefined, fill: undefined, width: 0.4, dash: undefined, opacity: undefined, arrowStart: false, arrowEnd: false, textColor: undefined };
}

function applyOption(style: Style, option: OptionSet): Style {
	const next = { ...style };
	for (const flag of option.flagSet) {
		if (flag in widthMap) next.width = widthMap[flag]!;
		else if (flag === 'dashed' || flag === 'densely dashed' || flag === 'loosely dashed') next.dash = 'Dashed';
		else if (flag === 'dotted' || flag === 'densely dotted' || flag === 'loosely dotted') next.dash = 'Dotted';
		else if (/^<?-+>?$|^-?(?:stealth|latex|>)-?$|^(?:stealth|latex)-$/.test(flag)) {
			next.arrowStart = flag.startsWith('<') || /^(?:stealth|latex)-/.test(flag);
			next.arrowEnd = flag.endsWith('>') || /-(?:stealth|latex)$/.test(flag);
		} else {
			const color = tikzColor(flag);
			if (color) {
				next.stroke = color;
				next.textColor = color;
			}
		}
	}
	for (const [key, text] of option.value) {
		if (key === 'color') {
			const color = tikzColor(text);
			next.stroke = color;
			next.textColor = color;
		} else if (key === 'draw') next.stroke = tikzColor(text);
		else if (key === 'fill') next.fill = tikzColor(text);
		else if (key === 'text') next.textColor = tikzColor(text);
		else if (key === 'line width') next.width = length(text) * 28.45;
		else if (key === 'opacity') next.opacity = Number(text);
	}
	return next;
}

function length(text: string): number {
	const match = /^\s*(-?[\d.]+)\s*(cm|mm|pt|in|em)?\s*$/.exec(text);
	if (!match) return evaluate(text);
	return Number(match[1]) * unitMap[match[2] ?? 'cm']!;
}

const placementMap: Readonly<Record<string, Placement>> = {
	above: 'Above', below: 'Below', left: 'Left', right: 'Right', 'above left': 'AboveLeft', 'above right': 'AboveRight', 'below left': 'BelowLeft', 'below right': 'BelowRight',
};

const anchorMap: Readonly<Record<string, Placement>> = {
	south: 'Above', north: 'Below', east: 'Left', west: 'Right', 'south east': 'AboveLeft', 'south west': 'AboveRight', 'north east': 'BelowLeft', 'north west': 'BelowRight', center: 'Center',
};

interface NamedPoint {
	point: Point;
	halfWidth: number;
	halfHeight: number;
}

class TikzParser {
	readonly pathList: DiagramPath[] = [];
	readonly nodeList: DiagramNode[] = [];
	readonly problemList: Problem[] = [];
	readonly nameMap = new Map<string, NamedPoint>();
	scale = 1;

	report(start: number, end: number, message: string): void {
		this.problemList.push({ start, end, message });
	}

	/** Runs every statement in `text` (source offset `offset`); `span` overrides spans (inside \foreach). */
	run(text: string, offset: number, span?: { start: number; end: number }): void {
		let index = 0;
		while (index < text.length) {
			const rest = text.slice(index);
			const space = /^(?:\s+|%[^\n]*)/.exec(rest);
			if (space) {
				index += space[0].length;
				continue;
			}
			const begin = /^\\begin\{tikzpicture\}(\[[^\]]*\])?/.exec(rest);
			if (begin) {
				const scale = begin[1] ? readOption(begin[1].slice(1, -1)).value.get('scale') : undefined;
				if (scale) this.scale = Number(scale) || 1;
				index += begin[0].length;
				continue;
			}
			if (rest.startsWith('\\end{tikzpicture}')) {
				index += '\\end{tikzpicture}'.length;
				continue;
			}
			if (rest.startsWith('\\foreach')) {
				index = this.foreach(text, index, offset, span);
				continue;
			}
			const end = this.statementEnd(text, index);
			const statement = text.slice(index, end);
			const statementSpan = span ?? { start: offset + index, end: offset + end + 1 };
			try {
				this.statement(statement, offset + index, statementSpan);
			} catch (error) {
				this.report(statementSpan.start, statementSpan.end, error instanceof Error ? error.message : String(error));
			}
			index = end + 1;
		}
	}

	private statementEnd(text: string, start: number): number {
		let depth = 0;
		for (let index = start; index < text.length; index++) {
			const character = text[index]!;
			if ('([{'.includes(character)) depth++;
			else if (')]}'.includes(character)) depth--;
			else if (character === ';' && depth <= 0) return index;
		}
		return text.length;
	}

	private foreach(text: string, start: number, offset: number, span: { start: number; end: number } | undefined): number {
		const head = /^\\foreach\s+((?:\\[A-Za-z]+\s*\/?\s*)+)\s*in\s*\{/.exec(text.slice(start));
		if (!head) {
			const end = this.statementEnd(text, start);
			this.report(offset + start, offset + end, 'write \\foreach \\x in {1,2,3} {…}');
			return end + 1;
		}
		const listOpen = start + head[0].length - 1;
		const listClose = matching(text, listOpen);
		let bodyStart = listClose + 1;
		while (/\s/.test(text[bodyStart] ?? '')) bodyStart++;
		const bodyEnd = text[bodyStart] === '{' ? matching(text, bodyStart) : this.statementEnd(text, bodyStart);
		const body = text[bodyStart] === '{' ? text.slice(bodyStart + 1, bodyEnd) : `${text.slice(bodyStart, bodyEnd)};`;
		const nameList = head[1]!.split('/').map((name) => name.trim().replace(/^\\/, ''));
		const statementSpan = span ?? { start: offset + start, end: offset + bodyEnd + 1 };
		for (const item of this.expandList(text.slice(listOpen + 1, listClose))) {
			const valueList = item.split('/');
			let expanded = body;
			nameList.forEach((name, index) => {
				expanded = expanded.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), (valueList[index] ?? '').trim());
			});
			this.run(expanded, offset + bodyStart, statementSpan);
		}
		return bodyEnd + 1;
	}

	/** `0,...,5` and `0,0.5,...,2` ranges. */
	private expandList(text: string): string[] {
		const partList = splitTop(text, ',').map((part) => part.trim());
		const dot = partList.indexOf('...');
		if (dot < 1 || dot === partList.length - 1) return partList;
		const first = Number(partList[dot - 1]);
		const second = dot >= 2 ? Number(partList[dot - 1]) : first;
		const step = dot >= 2 ? second - Number(partList[dot - 2]) : 1;
		const last = Number(partList[dot + 1]);
		const result = partList.slice(0, dot);
		if (!Number.isFinite(first) || !Number.isFinite(last) || step === 0) return partList;
		for (let value = second + step; step > 0 ? value <= last + 1e-9 : value >= last - 1e-9; value += step) result.push(String(Math.round(value * 1e6) / 1e6));
		return [...result, ...partList.slice(dot + 2)];
	}

	private statement(text: string, offset: number, span: { start: number; end: number }): void {
		const command = /^\\(draw|fill|filldraw|path|node|coordinate|clip|tikzset|useasboundingbox)\b/.exec(text);
		if (!command) throw new Error(`unknown command "${text.split(/\s/)[0]}"`);
		let index = command[0].length;
		let option: OptionSet = { flagSet: new Set(), value: new Map() };
		while (/\s/.test(text[index] ?? '')) index++;
		if (text[index] === '[') {
			const close = matching(text, index);
			option = readOption(text.slice(index + 1, close));
			index = close + 1;
		}
		const name = command[1]!;
		if (name === 'clip' || name === 'tikzset' || name === 'useasboundingbox') return;
		let style = applyOption(baseStyle(), option);
		if (name === 'draw' || name === 'filldraw') style.stroke ??= 'currentColor';
		if (name === 'fill' || name === 'filldraw') style.fill ??= style.stroke ?? 'currentColor';
		if (name === 'fill') style = { ...style, stroke: undefined };
		if (name === 'node' || name === 'coordinate') {
			this.nodeStatement(name, text.slice(index), offset + index, option, style, span);
			return;
		}
		this.path(text.slice(index), offset + index, style, option, span);
	}

	private nodeStatement(name: string, text: string, offset: number, option: OptionSet, style: Style, span: { start: number; end: number }): void {
		let index = 0;
		let nodeName: string | undefined;
		let at: Point = { x: 0, y: 0 };
		const skip = (): void => {
			while (/\s/.test(text[index] ?? '')) index++;
		};
		skip();
		if (text[index] === '(') {
			const close = matching(text, index);
			nodeName = text.slice(index + 1, close).trim();
			index = close + 1;
			skip();
		}
		if (text.startsWith('at', index)) {
			index += 2;
			skip();
			const close = matching(text, index);
			at = this.coordinate(text.slice(index + 1, close), { x: 0, y: 0 });
			index = close + 1;
			skip();
		}
		if (name === 'coordinate') {
			if (nodeName) this.nameMap.set(nodeName, { point: at, halfWidth: 0, halfHeight: 0 });
			return;
		}
		if (text[index] !== '{') throw new Error('a node needs {text}');
		const close = matching(text, index);
		this.addNode(at, text.slice(index + 1, close), offset + index + 1, option, style, nodeName, span);
	}

	private addNode(at: Point, text: string, textOffset: number, option: OptionSet, style: Style, name: string | undefined, span: { start: number; end: number }): void {
		let placement: Placement = 'Center';
		for (const flag of option.flagSet) if (placementMap[flag]) placement = placementMap[flag]!;
		const anchor = option.value.get('anchor');
		if (anchor && anchorMap[anchor]) placement = anchorMap[anchor]!;
		const shape = option.flagSet.has('circle') ? 'Circle' : option.flagSet.has('rectangle') || option.flagSet.has('draw') ? 'Rectangle' : 'None';
		const plain = text.replace(/\$|\\[A-Za-z]+|[{}^_]/g, '');
		const halfWidth = Math.max(0.12, plain.length * 0.105) + (shape === 'None' ? 0.05 : 0.12);
		const halfHeight = 0.2 + (shape === 'None' ? 0 : 0.08);
		const nodeStyle: Style = { ...style, stroke: option.flagSet.has('draw') || option.value.has('draw') ? (style.stroke ?? 'currentColor') : undefined, fill: option.value.has('fill') ? style.fill : undefined };
		this.nodeList.push({ x: at.x, y: at.y, text, textOffset, placement, shape, style: nodeStyle, halfWidth, halfHeight, span });
		if (name) this.nameMap.set(name, { point: at, halfWidth: shape === 'None' ? halfWidth * 0.8 : halfWidth, halfHeight });
	}

	/** Evaluates `(x,y)`, `(angle:radius)`, `(name)`, `(name.anchor)` (without the outer parentheses). */
	coordinate(text: string, current: Point, variable: Readonly<Record<string, number>> = {}): Point {
		const inner = text.trim();
		const named = this.nameMap.get(inner.split('.')[0]!);
		if (named && !inner.includes(',') && !inner.includes(':')) {
			const anchor = inner.split('.')[1];
			if (!anchor) return named.point;
			const angleMap: Readonly<Record<string, number>> = { east: 0, 'north east': 45, north: 90, 'north west': 135, west: 180, 'south west': 225, south: 270, 'south east': 315 };
			const angle = ((angleMap[anchor] ?? Number(anchor)) * Math.PI) / 180;
			return { x: named.point.x + Math.cos(angle) * named.halfWidth, y: named.point.y + Math.sin(angle) * named.halfHeight };
		}
		const polar = splitTop(inner, ':');
		if (polar.length === 2) {
			const angle = (this.number(polar[0]!, variable) * Math.PI) / 180;
			const radius = this.number(polar[1]!, variable) * this.scale;
			return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
		}
		const partList = splitTop(inner, ',');
		if (partList.length !== 2) throw new Error(`"(${inner})" is not a coordinate${named === undefined && /^[A-Za-z]/.test(inner) ? ' (unknown name)' : ''}`);
		return { x: this.number(partList[0]!, variable) * this.scale, y: this.number(partList[1]!, variable) * this.scale };
	}

	private number(text: string, variable: Readonly<Record<string, number>>): number {
		const trimmed = text.trim().replace(/^\{([\s\S]*)\}$/, '$1');
		const unit = /^(-?[\d.]+)\s*(cm|mm|pt|in|em)$/.exec(trimmed);
		if (unit) return Number(unit[1]) * unitMap[unit[2]!]!;
		return evaluate(trimmed, variable);
	}

	private path(text: string, offset: number, style: Style, option: OptionSet, span: { start: number; end: number }): void {
		const commandList: PathCommand[] = [];
		let current: Point | undefined;
		let start: Point | undefined;
		let pending: string = 'Move';
		let control: Point[] = [];
		let toOption: OptionSet | undefined;
		let lastNamed: NamedPoint | undefined;
		let index = 0;
		const moveTo = (target: Point, connect: boolean, named?: NamedPoint): void => {
			let point = target;
			// lines between drawn nodes run edge to edge, not centre to centre
			if (connect && current && lastNamed && lastNamed.halfWidth > 0) {
				const departure = this.edge(lastNamed, point);
				const last = commandList[commandList.length - 1];
				if (last && last.kind === 'M' && last.x === lastNamed.point.x && last.y === lastNamed.point.y) {
					last.x = departure.x;
					last.y = departure.y;
				} else commandList.push({ kind: 'M', ...departure });
				current = departure;
			}
			if (connect && current && named && named.halfWidth > 0) point = this.edge(named, current);
			if (!current || !connect) commandList.push({ kind: 'M', ...point });
			else if (pending === '-|') commandList.push({ kind: 'L', x: point.x, y: current.y }, { kind: 'L', ...point });
			else if (pending === '|-') commandList.push({ kind: 'L', x: current.x, y: point.y }, { kind: 'L', ...point });
			else if (pending === 'Controls' && control.length > 0) {
				const [first, second = first] = control;
				commandList.push({ kind: 'C', x1: first!.x, y1: first!.y, x2: second!.x, y2: second!.y, x: point.x, y: point.y });
			} else if (pending === 'Rectangle') {
				commandList.push({ kind: 'L', x: point.x, y: current.y }, { kind: 'L', ...point }, { kind: 'L', x: current.x, y: point.y }, { kind: 'Z' }, { kind: 'M', ...point });
			} else if (pending === 'Grid') {
				const step = length(option.value.get('step') ?? '1') * this.scale;
				const [x0, x1] = [Math.min(current.x, point.x), Math.max(current.x, point.x)];
				const [y0, y1] = [Math.min(current.y, point.y), Math.max(current.y, point.y)];
				for (let x = Math.ceil(x0 / step - 1e-9) * step; x <= x1 + 1e-9; x += step) commandList.push({ kind: 'M', x, y: y0 }, { kind: 'L', x, y: y1 });
				for (let y = Math.ceil(y0 / step - 1e-9) * step; y <= y1 + 1e-9; y += step) commandList.push({ kind: 'M', x: x0, y }, { kind: 'L', x: x1, y });
				commandList.push({ kind: 'M', ...point });
			} else if (pending === 'To' && toOption && (toOption.value.has('out') || toOption.value.has('in') || toOption.flagSet.has('bend left') || toOption.flagSet.has('bend right'))) {
				const distance = Math.hypot(point.x - current.x, point.y - current.y) * 0.3915 * Number(toOption.value.get('looseness') ?? 1);
				const chord = (Math.atan2(point.y - current.y, point.x - current.x) * 180) / Math.PI;
				const bend = toOption.flagSet.has('bend left') ? 30 : toOption.flagSet.has('bend right') ? -30 : 0;
				const out = (Number(toOption.value.get('out') ?? chord + bend) * Math.PI) / 180;
				const into = (Number(toOption.value.get('in') ?? chord + 180 - bend) * Math.PI) / 180;
				commandList.push({ kind: 'C', x1: current.x + Math.cos(out) * distance, y1: current.y + Math.sin(out) * distance, x2: point.x + Math.cos(into) * distance, y2: point.y + Math.sin(into) * distance, x: point.x, y: point.y });
			} else commandList.push({ kind: 'L', ...point });
			current = named && named.halfWidth > 0 ? named.point : point;
			start ??= point;
			lastNamed = named;
			pending = 'Move';
			control = [];
			toOption = undefined;
		};
		while (index < text.length) {
			const rest = text.slice(index);
			const space = /^\s+/.exec(rest);
			if (space) {
				index += space[0].length;
				continue;
			}
			const operator = /^(--|-\||\|-)/.exec(rest);
			if (operator) {
				pending = operator[1]!;
				index += operator[0].length;
				continue;
			}
			const relative = /^(\+\+?)\(/.exec(rest);
			if (rest[0] === '(' || relative) {
				const open = index + (relative ? relative[1]!.length : 0);
				const close = matching(text, open);
				if (close < 0) throw new Error('missing ")"');
				const inner = text.slice(open + 1, close);
				let point = this.coordinate(inner, current ?? { x: 0, y: 0 });
				if (relative && current) point = { x: current.x + point.x, y: current.y + point.y };
				if (pending === 'Controls' && rest.slice(close + 1 - index).trimStart().startsWith('and')) {
					control.push(point);
					index = close + 1;
					index += text.slice(index).indexOf('and') + 3;
					continue;
				}
				if (pending === 'Controls' && /^\s*\.\./.test(text.slice(close + 1)) && control.length < 2 && !this.isFinal(text, close)) {
					control.push(point);
					index = close + 1;
					continue;
				}
				moveTo(point, pending !== 'Move', relative ? undefined : this.nameMap.get(inner.trim()));
				index = close + 1;
				continue;
			}
			if (rest.startsWith('..')) {
				const match = /^\.\.\s*controls\s*/.exec(rest);
				if (match) {
					pending = 'Controls';
					control = [];
					index += match[0].length;
				} else index += 2;
				continue;
			}
			if (rest.startsWith('rectangle')) {
				pending = 'Rectangle';
				index += 'rectangle'.length;
				continue;
			}
			if (rest.startsWith('grid')) {
				pending = 'Grid';
				index += 'grid'.length;
				const step = /^\s*\[([^\]]*)\]/.exec(text.slice(index));
				if (step) {
					const gridOption = readOption(step[1]!);
					for (const [key, value] of gridOption.value) option.value.set(key, value);
					index += step[0].length;
				}
				continue;
			}
			if (rest.startsWith('to')) {
				pending = 'To';
				index += 2;
				const toMatch = /^\s*\[([^\]]*)\]/.exec(text.slice(index));
				if (toMatch) {
					toOption = readOption(toMatch[1]!);
					index += toMatch[0].length;
				}
				continue;
			}
			if (rest.startsWith('cycle')) {
				if (start) {
					if (pending === 'Controls' || pending === 'To') moveTo(start, true);
					commandList.push({ kind: 'Z' });
					current = start;
				}
				pending = 'Move';
				index += 'cycle'.length;
				continue;
			}
			const circle = /^(circle|ellipse)\s*(?:\(([^)]*)\)|\[([^\]]*)\])/.exec(rest);
			if (circle) {
				const center = current ?? { x: 0, y: 0 };
				let rx: number;
				let ry: number;
				if (circle[2] !== undefined) {
					const partList = circle[2].split(/\s+and\s+/);
					rx = length(partList[0]!) * this.scale;
					ry = partList[1] ? length(partList[1]) * this.scale : rx;
				} else {
					const circleOption = readOption(circle[3]!);
					rx = length(circleOption.value.get('x radius') ?? circleOption.value.get('radius') ?? '1') * this.scale;
					ry = length(circleOption.value.get('y radius') ?? circleOption.value.get('radius') ?? '1') * this.scale;
				}
				commandList.push(
					{ kind: 'M', x: center.x + rx, y: center.y },
					{ kind: 'A', rx, ry, large: true, counterclockwise: true, x: center.x - rx, y: center.y },
					{ kind: 'A', rx, ry, large: true, counterclockwise: true, x: center.x + rx, y: center.y },
					{ kind: 'Z' },
					{ kind: 'M', ...center },
				);
				index += circle[0].length;
				continue;
			}
			const arc = /^arc\s*(?:\(([^)]*)\)|\[([^\]]*)\])/.exec(rest);
			if (arc) {
				if (!current) throw new Error('arc needs a starting point');
				let startAngle: number;
				let endAngle: number;
				let radius: number;
				if (arc[1] !== undefined) {
					const [a, b, r] = arc[1].split(':');
					startAngle = evaluate(a ?? '0');
					endAngle = evaluate(b ?? '0');
					radius = length(r ?? '1') * this.scale;
				} else {
					const arcOption = readOption(arc[2]!);
					startAngle = evaluate(arcOption.value.get('start angle') ?? '0');
					endAngle = evaluate(arcOption.value.get('end angle') ?? '90');
					radius = length(arcOption.value.get('radius') ?? '1') * this.scale;
				}
				const radian = Math.PI / 180;
				const center = { x: current.x - Math.cos(startAngle * radian) * radius, y: current.y - Math.sin(startAngle * radian) * radius };
				const end = { x: center.x + Math.cos(endAngle * radian) * radius, y: center.y + Math.sin(endAngle * radian) * radius };
				commandList.push({ kind: 'A', rx: radius, ry: radius, large: Math.abs(endAngle - startAngle) > 180, counterclockwise: endAngle > startAngle, x: end.x, y: end.y });
				current = end;
				index += arc[0].length;
				continue;
			}
			const plot = /^plot\s*(?:\[([^\]]*)\])?\s*(?=\(|\{)/.exec(rest);
			if (plot) {
				index += plot[0].length;
				const open = index;
				const close = matching(text, open);
				const plotOption = readOption(plot[1] ?? '');
				for (const [key, value] of option.value) if (!plotOption.value.has(key)) plotOption.value.set(key, value);
				const pointList = this.plot(text.slice(open + 1, close), plotOption);
				pointList.forEach((point, pointIndex) => moveTo(point, pointIndex > 0 || pending !== 'Move'));
				index = close + 1;
				continue;
			}
			const node = /^node\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?\s*\{/.exec(rest);
			if (node) {
				const open = index + node[0].length - 1;
				const close = matching(text, open);
				const nodeOption = readOption(node[1] ?? '');
				let at = current ?? { x: 0, y: 0 };
				if (nodeOption.flagSet.has('midway') && commandList.length >= 2) {
					const last = commandList[commandList.length - 1]!;
					const before = [...commandList].reverse().find((command, reverseIndex) => reverseIndex > 0 && command.kind !== 'Z') as { x: number; y: number } | undefined;
					if (last.kind !== 'Z' && before) at = { x: (last.x + before.x) / 2, y: (last.y + before.y) / 2 };
				}
				this.addNode(at, text.slice(open + 1, close), offset + open + 1, nodeOption, applyOption(style, nodeOption), node[2]?.trim() || undefined, span);
				index = close + 1;
				continue;
			}
			const coordinate = /^coordinate\s*\(([^)]*)\)/.exec(rest);
			if (coordinate) {
				if (current) this.nameMap.set(coordinate[1]!.trim(), { point: current, halfWidth: 0, halfHeight: 0 });
				index += coordinate[0].length;
				continue;
			}
			throw new Error(`unexpected "${rest.slice(0, 12)}"`);
		}
		if (commandList.length > 0) this.pathList.push({ commandList, style, span });
	}

	private isFinal(text: string, close: number): boolean {
		// in ".. controls (a) and (b) .. (c)", (c) is the end point: it is not followed by "and" or ".."
		const after = text.slice(close + 1).trimStart();
		return !after.startsWith('..') && !after.startsWith('and');
	}

	private edge(named: NamedPoint, from: Point): Point {
		const dx = from.x - named.point.x;
		const dy = from.y - named.point.y;
		const length = Math.hypot(dx, dy) || 1;
		const scale = Math.min(named.halfWidth / (Math.abs(dx / length) || 1e-9), named.halfHeight / (Math.abs(dy / length) || 1e-9));
		return { x: named.point.x + (dx / length) * Math.min(scale, length), y: named.point.y + (dy / length) * Math.min(scale, length) };
	}

	private plot(template: string, option: OptionSet): Point[] {
		const [fromText = '-5', toText = '5'] = (option.value.get('domain') ?? '-5:5').split(':');
		const from = evaluate(fromText);
		const to = evaluate(toText);
		const samples = Math.min(Math.max(Number(option.value.get('samples') ?? 25) || 25, 2), 2000);
		const variable = (option.value.get('variable') ?? '\\x').replace(/^\\/, '');
		const inner = template.trim();
		const pointList: Point[] = [];
		for (let index = 0; index < samples; index++) {
			const value = from + ((to - from) * index) / (samples - 1);
			try {
				const point = this.coordinate(inner, { x: 0, y: 0 }, { [variable]: value });
				if (Number.isFinite(point.x) && Number.isFinite(point.y)) pointList.push(point);
			} catch (error) {
				throw new Error(`plot: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return pointList;
	}
}

export function parseTikz(source: string): Diagram {
	const parser = new TikzParser();
	parser.run(source, 0);
	const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = (x: number, y: number): void => {
		box.minX = Math.min(box.minX, x);
		box.minY = Math.min(box.minY, y);
		box.maxX = Math.max(box.maxX, x);
		box.maxY = Math.max(box.maxY, y);
	};
	for (const path of parser.pathList) {
		let last: Point = { x: 0, y: 0 };
		for (const command of path.commandList) {
			if (command.kind === 'Z') continue;
			if (command.kind === 'C') {
				grow(command.x1, command.y1);
				grow(command.x2, command.y2);
			}
			if (command.kind === 'A') {
				// a full circle is drawn as two half arcs: cover the whole circle
				const cx = (last.x + command.x) / 2;
				const cy = (last.y + command.y) / 2;
				grow(cx - command.rx, cy - command.ry);
				grow(cx + command.rx, cy + command.ry);
			}
			grow(command.x, command.y);
			last = command;
		}
	}
	for (const node of parser.nodeList) {
		const shift = { Center: [0, 0], Above: [0, 1], Below: [0, -1], Left: [-1, 0], Right: [1, 0], AboveLeft: [-1, 1], AboveRight: [1, 1], BelowLeft: [-1, -1], BelowRight: [1, -1] }[node.placement];
		const cx = node.x + shift[0]! * (node.halfWidth + 0.1);
		const cy = node.y + shift[1]! * (node.halfHeight + 0.1);
		grow(cx - node.halfWidth, cy - node.halfHeight);
		grow(cx + node.halfWidth, cy + node.halfHeight);
	}
	if (box.minX === Infinity) Object.assign(box, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
	const pad = 0.25;
	return { pathList: parser.pathList, nodeList: parser.nodeList, problemList: parser.problemList, box: { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad } };
}
