// Turning functions into lines on screen: curves sampled more where they bend (and broken where
// they jump, as tan does), implicit curves by marching squares, and regions for inequalities.
// Everything is in screen pixels, so the detail follows the zoom.

export interface Viewport {
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
	/** Pixels. */
	width: number;
	height: number;
}

/** A polyline as x, y pairs in pixels; a curve is a list of them (broken where it jumps). */
export type Polyline = number[];

export const toPixelX = (view: Viewport, x: number): number => ((x - view.xMin) / (view.xMax - view.xMin)) * view.width;
export const toPixelY = (view: Viewport, y: number): number => view.height - ((y - view.yMin) / (view.yMax - view.yMin)) * view.height;
export const fromPixelX = (view: Viewport, px: number): number => view.xMin + (px / view.width) * (view.xMax - view.xMin);
export const fromPixelY = (view: Viewport, py: number): number => view.yMin + ((view.height - py) / view.height) * (view.yMax - view.yMin);

/** Far outside the view, values are clamped so the SVG stays small (the clipped part isn't seen). */
function clampPixel(value: number, size: number): number {
	return Math.max(-size * 4, Math.min(size * 5, value));
}

/**
 * A function of one variable across the view: `y = f(x)` (along x) or `x = g(y)` (along y).
 * Starts with a sample every pixel, adds more where the curve bends, and breaks where it is
 * undefined or jumps across the view without passing between (an asymptote).
 */
export function sampleFunction(work: (value: number) => number, view: Viewport, along: 'x' | 'y', range?: [number, number]): Polyline[] {
	const horizontal = along === 'x';
	const pixelSize = horizontal ? view.width : view.height;
	const crossSize = horizontal ? view.height : view.width;
	const toAlong = (value: number): number => (horizontal ? toPixelX(view, value) : toPixelY(view, value));
	const toCross = (value: number): number => (horizontal ? toPixelY(view, value) : toPixelX(view, value));
	const fromAlong = (pixel: number): number => (horizontal ? fromPixelX(view, pixel) : fromPixelY(view, pixel));
	let start = 0;
	let end = pixelSize;
	if (range) {
		const a = toAlong(range[0]);
		const b = toAlong(range[1]);
		start = Math.max(0, Math.min(a, b));
		end = Math.min(pixelSize, Math.max(a, b));
		if (end <= start) return [];
	}
	const lineList: Polyline[] = [];
	let line: Polyline = [];
	const evaluate = (pixel: number): number => {
		try {
			const value = work(fromAlong(pixel));
			return Number.isFinite(value) ? toCross(value) : Number.NaN;
		} catch {
			return Number.NaN;
		}
	};
	const push = (pixel: number, cross: number): void => {
		const clamped = clampPixel(cross, crossSize);
		if (horizontal) line.push(pixel, clamped);
		else line.push(clamped, pixel);
	};
	const flush = (): void => {
		if (line.length >= 4) lineList.push(line);
		else if (line.length === 2) lineList.push([...line, ...line]);
		line = [];
	};
	/** Between two finite samples: more points where it bends, a break where it jumps. */
	const refine = (p0: number, c0: number, p1: number, c1: number, depth: number): void => {
		const pm = (p0 + p1) / 2;
		const cm = evaluate(pm);
		if (Number.isNaN(cm)) {
			// undefined in between (√ of a negative): break there
			flush();
			push(p1, c1);
			return;
		}
		const jump = Math.abs(c1 - c0);
		const between = (cm - c0) * (cm - c1) <= 0;
		if (jump > crossSize && !between && depth === 0) {
			// an asymptote: the curve leaves one way and comes back from the other
			flush();
			push(p1, c1);
			return;
		}
		const straight = Math.abs(cm - (c0 + c1) / 2) < 0.35;
		if (depth > 0 && (!straight || jump > crossSize * 0.5)) {
			refine(p0, c0, pm, cm, depth - 1);
			refine(pm, cm, p1, c1, depth - 1);
			return;
		}
		push(pm, cm);
		push(p1, c1);
	};
	const stepCount = Math.max(2, Math.ceil(end - start));
	let previous = evaluate(start);
	if (!Number.isNaN(previous)) push(start, previous);
	for (let index = 1; index <= stepCount; index++) {
		const p0 = start + ((index - 1) * (end - start)) / stepCount;
		const p1 = start + (index * (end - start)) / stepCount;
		const c1 = evaluate(p1);
		if (Number.isNaN(previous) || Number.isNaN(c1)) {
			if (Number.isNaN(previous) && !Number.isNaN(c1)) {
				flush();
				push(p1, c1);
			} else flush();
		} else refine(p0, previous, p1, c1, 5);
		previous = c1;
	}
	flush();
	return lineList;
}

/** A curve given by a parameter (parametric or polar): more points where it moves fast or bends. */
export function sampleCurve(work: (t: number) => [number, number], from: number, to: number, view: Viewport, count = 600): Polyline[] {
	const lineList: Polyline[] = [];
	let line: Polyline = [];
	const diagonal = Math.hypot(view.width, view.height);
	const evaluate = (t: number): [number, number] | undefined => {
		try {
			const [x, y] = work(t);
			if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
			return [clampPixel(toPixelX(view, x), view.width), clampPixel(toPixelY(view, y), view.height)];
		} catch {
			return undefined;
		}
	};
	const flush = (): void => {
		if (line.length >= 4) lineList.push(line);
		line = [];
	};
	const refine = (t0: number, a: [number, number], t1: number, b: [number, number], depth: number): void => {
		const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
		if (distance > 3 && depth > 0) {
			const tm = (t0 + t1) / 2;
			const middle = evaluate(tm);
			if (!middle) {
				flush();
				return;
			}
			if (distance > diagonal && depth === 1) {
				flush();
				line.push(...b);
				return;
			}
			refine(t0, a, tm, middle, depth - 1);
			refine(tm, middle, t1, b, depth - 1);
			return;
		}
		if (distance > diagonal) {
			flush();
			line.push(...b);
			return;
		}
		line.push(...b);
	};
	let previous = evaluate(from);
	if (previous) line.push(...previous);
	for (let index = 1; index <= count; index++) {
		const t0 = from + ((index - 1) * (to - from)) / count;
		const t1 = from + (index * (to - from)) / count;
		const next = evaluate(t1);
		if (!previous || !next) {
			flush();
			if (next) line.push(...next);
		} else refine(t0, previous, t1, next, 6);
		previous = next;
	}
	flush();
	return lineList;
}

/**
 * Where F(x, y) = 0, by marching squares over a grid of `cell` pixels: line pieces (x0, y0, x1, y1
 * in pixels). A sign change across a jump (1/x) isn't a crossing: the middle must be small too.
 */
export function marchSquare(work: (x: number, y: number) => number, view: Viewport, cell = 5): number[] {
	const columnCount = Math.max(2, Math.ceil(view.width / cell));
	const rowCount = Math.max(2, Math.ceil(view.height / cell));
	const stepX = view.width / columnCount;
	const stepY = view.height / rowCount;
	const value = new Float64Array((columnCount + 1) * (rowCount + 1));
	const at = (column: number, row: number): number => value[row * (columnCount + 1) + column]!;
	for (let row = 0; row <= rowCount; row++) {
		const y = fromPixelY(view, row * stepY);
		for (let column = 0; column <= columnCount; column++) {
			let result: number;
			try {
				result = work(fromPixelX(view, column * stepX), y);
			} catch {
				result = Number.NaN;
			}
			value[row * (columnCount + 1) + column] = result;
		}
	}
	const segmentList: number[] = [];
	const crossing = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): [number, number] => {
		// the same edge gives the same point from either cell (so joinSegment can join them)
		if (x0 > x1 || (x0 === x1 && y0 > y1)) return crossing(x1, y1, v1, x0, y0, v0);
		const t = v0 / (v0 - v1);
		return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
	};
	for (let row = 0; row < rowCount; row++) {
		for (let column = 0; column < columnCount; column++) {
			const a = at(column, row);
			const b = at(column + 1, row);
			const c = at(column + 1, row + 1);
			const d = at(column, row + 1);
			if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) continue;
			const x0 = column * stepX;
			const y0 = row * stepY;
			const x1 = (column + 1) * stepX;
			const y1 = (row + 1) * stepY;
			const pointList: [number, number][] = [];
			if (a > 0 !== b > 0) pointList.push(crossing(x0, y0, a, x1, y0, b));
			if (b > 0 !== c > 0) pointList.push(crossing(x1, y0, b, x1, y1, c));
			if (c > 0 !== d > 0) pointList.push(crossing(x1, y1, c, x0, y1, d));
			if (d > 0 !== a > 0) pointList.push(crossing(x0, y1, d, x0, y0, a));
			if (pointList.length < 2) continue;
			// a jump, not a crossing: the value at the middle is as large as at the corners
			let middle: number;
			try {
				middle = work(fromPixelX(view, x0 + stepX / 2), fromPixelY(view, y0 + stepY / 2));
			} catch {
				middle = Number.NaN;
			}
			const largest = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
			if (!Number.isFinite(middle) || Math.abs(middle) > largest * 2) continue;
			if (pointList.length === 2) segmentList.push(...pointList[0]!, ...pointList[1]!);
			else {
				// a saddle: the middle tells which corners join
				const [p, q, r, s] = pointList as [[number, number], [number, number], [number, number], [number, number]];
				if (middle > 0 === a > 0) segmentList.push(...p, ...s, ...q, ...r);
				else segmentList.push(...p, ...q, ...r, ...s);
			}
		}
	}
	return segmentList;
}

/** The cells (as rectangles: x, y, width, height in pixels) where a condition holds, row by row. */
export function shadeRegion(test: (x: number, y: number) => boolean, view: Viewport, cell = 4): number[] {
	const rectList: number[] = [];
	const columnCount = Math.ceil(view.width / cell);
	const rowCount = Math.ceil(view.height / cell);
	for (let row = 0; row < rowCount; row++) {
		const y = fromPixelY(view, (row + 0.5) * cell);
		let runStart = -1;
		for (let column = 0; column <= columnCount; column++) {
			let inside = false;
			if (column < columnCount) {
				try {
					inside = test(fromPixelX(view, (column + 0.5) * cell), y);
				} catch {
					inside = false;
				}
			}
			if (inside && runStart < 0) runStart = column;
			else if (!inside && runStart >= 0) {
				rectList.push(runStart * cell, row * cell, (column - runStart) * cell, cell);
				runStart = -1;
			}
		}
	}
	return rectList;
}

/** A polyline as SVG path data (rounded to 0.1 px). */
export function pathOf(lineList: readonly Polyline[]): string {
	let data = '';
	for (const line of lineList) {
		for (let index = 0; index < line.length; index += 2) data += `${index === 0 ? 'M' : 'L'}${round(line[index]!)} ${round(line[index + 1]!)}`;
	}
	return data;
}

/**
 * Line pieces (x0, y0, x1, y1, …) joined end to end into polylines, so a dashed curve dashes along
 * its length (each piece on its own would start its dash again).
 */
export function joinSegment(segmentList: readonly number[]): Polyline[] {
	const count = Math.floor(segmentList.length / 4);
	const key = (x: number, y: number): string => `${Math.round(x * 100)},${Math.round(y * 100)}`;
	const endMap = new Map<string, number[]>();
	for (let index = 0; index < count; index++) {
		for (const end of [0, 2]) {
			const name = key(segmentList[index * 4 + end]!, segmentList[index * 4 + end + 1]!);
			const list = endMap.get(name);
			if (list) list.push(index);
			else endMap.set(name, [index]);
		}
	}
	const used = new Uint8Array(count);
	// a piece with both ends at one spot (a grid corner right on the curve) joins nothing
	for (let index = 0; index < count; index++) if (key(segmentList[index * 4]!, segmentList[index * 4 + 1]!) === key(segmentList[index * 4 + 2]!, segmentList[index * 4 + 3]!)) used[index] = 1;
	// from (x, y), along unused pieces that meet there: the points passed
	const follow = (x: number, y: number): number[] => {
		const pointList: number[] = [];
		for (;;) {
			const here = key(x, y);
			const next = endMap.get(here)?.find((index) => !used[index]);
			if (next === undefined) return pointList;
			used[next] = 1;
			const at = next * 4;
			const fromStart = key(segmentList[at]!, segmentList[at + 1]!) === here;
			x = fromStart ? segmentList[at + 2]! : segmentList[at]!;
			y = fromStart ? segmentList[at + 3]! : segmentList[at + 1]!;
			pointList.push(x, y);
		}
	};
	const lineList: Polyline[] = [];
	for (let index = 0; index < count; index++) {
		if (used[index]) continue;
		used[index] = 1;
		const at = index * 4;
		const forward = follow(segmentList[at + 2]!, segmentList[at + 3]!);
		const backward = follow(segmentList[at]!, segmentList[at + 1]!);
		const line: number[] = [];
		for (let point = backward.length - 2; point >= 0; point -= 2) line.push(backward[point]!, backward[point + 1]!);
		line.push(segmentList[at]!, segmentList[at + 1]!, segmentList[at + 2]!, segmentList[at + 3]!, ...forward);
		lineList.push(line);
	}
	return lineList;
}

/** Line pieces (x0, y0, x1, y1, …) as SVG path data. */
export function segmentPathOf(segmentList: readonly number[]): string {
	let data = '';
	for (let index = 0; index < segmentList.length; index += 4) data += `M${round(segmentList[index]!)} ${round(segmentList[index + 1]!)}L${round(segmentList[index + 2]!)} ${round(segmentList[index + 3]!)}`;
	return data;
}

const round = (value: number): number => Math.round(value * 10) / 10;
