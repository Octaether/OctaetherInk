// Arrow geometry and drawing, shared by the Board (in the note) and the Board editor, on a plane in
// CSS px with y pointing down. `size` is 1em in px, so heads and gaps scale with the text.
//
//   Kind  Single (a full head)  Fishhook (half a head: one electron)  Equilibrium (two harpoons, ⇌)
//         Retro (a hollow double arrow, ⇒)  NoReaction (crossed through)  Line (no head)
//   Curve degrees the arrow bows to the left of where it goes (negative: to the right)

export interface Point {
	x: number;
	y: number;
}

export const arrowKindList = ['Single', 'Fishhook', 'Equilibrium', 'Retro', 'NoReaction', 'Line'] as const;
export type ArrowKind = (typeof arrowKindList)[number];
export type ArrowHead = 'End' | 'Start' | 'Both';

/** A cubic Bézier from `from` to `to`; a straight arrow has its controls on the line. */
export interface ArrowCurve {
	from: Point;
	control1: Point;
	control2: Point;
	to: Point;
}

export interface ArrowStyle {
	kind: ArrowKind;
	head: ArrowHead;
	/** 1em in px. */
	size: number;
	dash?: 'Dashed' | 'Dotted';
	/** A safe CSS color (already resolved), or undefined for the text color. */
	color?: string;
}

export function readKind(value: unknown): ArrowKind {
	return arrowKindList.find((kind) => kind === value) ?? 'Single';
}

export function readHead(value: unknown): ArrowHead {
	return value === 'Start' || value === 'Both' ? value : 'End';
}

/** Rotates a vector by `degree` to the left as seen on screen (y down). */
function turnLeft(vector: Point, degree: number): Point {
	const radian = (degree * Math.PI) / 180;
	return { x: vector.x * Math.cos(radian) + vector.y * Math.sin(radian), y: -vector.x * Math.sin(radian) + vector.y * Math.cos(radian) };
}

/** How far the controls reach along the chord: short hops still get a visible arc. */
function armOf(length: number, size: number): number {
	return Math.max(0.42, (1.4 * size) / Math.max(length, 1e-6));
}

/** The curve between two points; `curve` = 0 is straight. */
export function arrowCurve(from: Point, to: Point, curve: number, size: number): ArrowCurve {
	const chord = { x: to.x - from.x, y: to.y - from.y };
	const length = Math.hypot(chord.x, chord.y);
	if (Math.abs(curve) < 0.01 || length < 1e-6) {
		return { from, control1: { x: from.x + chord.x / 3, y: from.y + chord.y / 3 }, control2: { x: from.x + (chord.x * 2) / 3, y: from.y + (chord.y * 2) / 3 }, to };
	}
	const arm = armOf(length, size);
	const first = turnLeft(chord, curve);
	const second = turnLeft({ x: -chord.x, y: -chord.y }, -curve);
	return { from, control1: { x: from.x + first.x * arm, y: from.y + first.y * arm }, control2: { x: to.x + second.x * arm, y: to.y + second.y * arm }, to };
}

/** The curve (degrees) whose middle sits `offset` px to the left of the chord's middle (for a handle). */
export function curveForOffset(from: Point, to: Point, offset: number, size: number): number {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length < 1e-6) return 0;
	// the middle of the Bézier is 0.75 × arm × length × sin(curve) from the chord
	const sine = offset / (0.75 * armOf(length, size) * length);
	return Math.round((Math.asin(Math.max(-0.99, Math.min(0.99, sine))) * 180) / Math.PI);
}

export function bezierPoint(curve: ArrowCurve, t: number): Point {
	const s = 1 - t;
	return {
		x: s * s * s * curve.from.x + 3 * s * s * t * curve.control1.x + 3 * s * t * t * curve.control2.x + t * t * t * curve.to.x,
		y: s * s * s * curve.from.y + 3 * s * s * t * curve.control1.y + 3 * s * t * t * curve.control2.y + t * t * t * curve.to.y,
	};
}

/** Points along the curve, for hit tests and boxes. */
export function sampleCurve(curve: ArrowCurve, count = 16): Point[] {
	return Array.from({ length: count + 1 }, (_, index) => bezierPoint(curve, index / count));
}

/**
 * Which way an arrow between two points should bow when no Curve is given: away from the
 * crowd (the centres of what's around), up when it's even.
 */
export function autoCurve(from: Point, to: Point, crowdList: readonly Point[], size: number): number {
	const crowd = (curve: number): number => {
		const apex = bezierPoint(arrowCurve(from, to, curve, size), 0.5);
		return crowdList.reduce((sum, point) => sum + 1 / Math.max((point.x - apex.x) ** 2 + (point.y - apex.y) ** 2, 1), 0);
	};
	const left = crowd(45);
	const right = crowd(-45);
	if (Math.abs(left - right) > 1e-9) return left < right ? 45 : -45;
	// even: bow upward on screen
	return bezierPoint(arrowCurve(from, to, 45, size), 0.5).y <= (from.y + to.y) / 2 ? 45 : -45;
}

function number(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

function headShape(tip: Point, back: Point, kind: 'Pair' | 'Half' | 'Open', size: number, side = 1): string {
	const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
	const ux = (tip.x - back.x) / length;
	const uy = (tip.y - back.y) / length;
	const headLength = 0.32 * size;
	const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
	const left = { x: base.x + uy * headLength * 0.45, y: base.y - ux * headLength * 0.45 };
	const right = { x: base.x - uy * headLength * 0.45, y: base.y + ux * headLength * 0.45 };
	if (kind === 'Open') {
		const wide = 0.9;
		const openLeft = { x: base.x + uy * headLength * wide, y: base.y - ux * headLength * wide };
		const openRight = { x: base.x - uy * headLength * wide, y: base.y + ux * headLength * wide };
		return `<path d="M ${number(openLeft.x)} ${number(openLeft.y)} L ${number(tip.x)} ${number(tip.y)} L ${number(openRight.x)} ${number(openRight.y)}" fill="none"/>`;
	}
	const pointList = kind === 'Pair' ? [tip, left, right] : [tip, side > 0 ? left : right, base];
	return `<polygon points="${pointList.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="currentColor" stroke="none"/>`;
}

function line(from: Point, to: Point): string {
	return `<line x1="${number(from.x)}" y1="${number(from.y)}" x2="${number(to.x)}" y2="${number(to.y)}"/>`;
}

/** SVG markup for an arrow (a <g> in the plane's own px; strokes in currentColor). */
export function arrowMarkup(curve: ArrowCurve, style: ArrowStyle, extra = ''): string {
	const { size } = style;
	const { from, to } = curve;
	const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const normal = { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
	const shift = (point: Point, distance: number): Point => ({ x: point.x + normal.x * distance, y: point.y + normal.y * distance });
	const dash = style.dash === 'Dashed' ? ` stroke-dasharray="${number(0.16 * size)} ${number(0.12 * size)}"` : style.dash === 'Dotted' ? ` stroke-dasharray="0.01 ${number(0.14 * size)}"` : '';
	const color = style.color ? ` style="color: ${style.color.replace(/["<>]/g, '')}"` : '';
	const partList: string[] = [];
	if (style.kind === 'Equilibrium') {
		// two harpoons, the top one going forward
		const top = [shift(from, 0.09 * size), shift(to, 0.09 * size)] as const;
		const bottom = [shift(to, -0.09 * size), shift(from, -0.09 * size)] as const;
		partList.push(line(top[0], top[1]), headShape(top[1], top[0], 'Half', size, 1), line(bottom[0], bottom[1]), headShape(bottom[1], bottom[0], 'Half', size, 1));
	} else if (style.kind === 'Retro') {
		const ux = (to.x - from.x) / length;
		const uy = (to.y - from.y) / length;
		const stop = { x: to.x - ux * 0.2 * size, y: to.y - uy * 0.2 * size };
		partList.push(line(shift(from, 0.08 * size), shift(stop, 0.08 * size)), line(shift(from, -0.08 * size), shift(stop, -0.08 * size)), headShape(to, from, 'Open', size));
	} else {
		const { control1, control2 } = curve;
		partList.push(`<path d="M ${number(from.x)} ${number(from.y)} C ${number(control1.x)} ${number(control1.y)} ${number(control2.x)} ${number(control2.y)} ${number(to.x)} ${number(to.y)}" fill="none"${dash}/>`);
		if (style.kind !== 'Line') {
			const head = style.kind === 'Fishhook' ? 'Half' : 'Pair';
			if (style.head !== 'Start') partList.push(headShape(to, control2, head, size));
			if (style.head !== 'End') partList.push(headShape(from, control1, head, size));
		}
		if (style.kind === 'NoReaction') {
			const middle = bezierPoint(curve, 0.5);
			const ux = (to.x - from.x) / length;
			const uy = (to.y - from.y) / length;
			const across = { x: (normal.x + ux * 0.6) * 0.26 * size, y: (normal.y + uy * 0.6) * 0.26 * size };
			partList.push(line({ x: middle.x - across.x, y: middle.y - across.y }, { x: middle.x + across.x, y: middle.y + across.y }));
		}
	}
	return `<g class="oi-arrow-shape" stroke="currentColor" stroke-width="${number(0.058 * size)}" stroke-linecap="round"${color}${extra}>${partList.join('')}</g>`;
}

/** The way an arrow's Above points: the left of where it goes; a curved arrow's Above is the outside of its bow. */
function aboveNormal(curve: ArrowCurve, size: number): Point {
	const { from, to } = curve;
	const middle = bezierPoint(curve, 0.5);
	const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const normal = { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
	const bow = { x: middle.x - (from.x + to.x) / 2, y: middle.y - (from.y + to.y) / 2 };
	return Math.hypot(bow.x, bow.y) > 0.05 * size && bow.x * normal.x + bow.y * normal.y < 0 ? { x: -normal.x, y: -normal.y } : normal;
}

/** A block's place along an arrow: `At` (0 the start, 1 the end; 0.5 when missing or not a number). */
export function readAt(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

/**
 * Where a block attached to the arrow (`Side: Above` or `Below`, `At` along it) goes: a point next to
 * the arrow, and the CSS translate that puts the block's near edge on it. Above is the left of where the
 * arrow goes (up for an arrow going right); a curved arrow's Above is the outside of its bow. `out` px
 * more keeps blocks on the same side and spot from covering each other.
 */
export function arrowLabelPlace(curve: ArrowCurve, side: 'Above' | 'Below', size: number, at = 0.5, out = 0): { point: Point; translate: string } {
	const on = bezierPoint(curve, at);
	let normal = aboveNormal(curve, size);
	if (side === 'Below') normal = { x: -normal.x, y: -normal.y };
	const gap = 0.14 * size + out;
	const point = { x: on.x + normal.x * gap, y: on.y + normal.y * gap };
	const translate =
		Math.abs(normal.y) >= Math.abs(normal.x) ? (normal.y < 0 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)') : normal.x < 0 ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
	return { point, translate };
}

/** The point of an arrow nearest to `point`: how far along (0–1), how far away (px), and on which side. */
export function nearestOnArrow(curve: ArrowCurve, point: Point, size: number): { at: number; distance: number; side: 'Above' | 'Below' } {
	let best = { t: 0.5, distance: Infinity };
	const count = 64;
	for (let index = 0; index <= count; index++) {
		const on = bezierPoint(curve, index / count);
		const distance = Math.hypot(on.x - point.x, on.y - point.y);
		if (distance < best.distance) best = { t: index / count, distance };
	}
	const on = bezierPoint(curve, best.t);
	const normal = aboveNormal(curve, size);
	return { at: best.t, distance: best.distance, side: (point.x - on.x) * normal.x + (point.y - on.y) * normal.y >= 0 ? 'Above' : 'Below' };
}
