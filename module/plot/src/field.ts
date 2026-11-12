// Vector fields: an arrow at each place of a grid, as long as the field is strong there (scaled so
// the longest fills its cell), colored by its length along a gradient of your own (`Gradient`).

import type { PropertyValue } from '@octaether/core-format';
import { type GradientStop, readGradient } from '@octaether/core-sdk';
import { type PlotItem, niceStep } from './parse';
import { type Evaluated, localScope, toNumber } from './program';

export interface Arrow {
	/** Where it starts, and the field there. */
	at: number[];
	vector: number[];
	/** Its length over the longest one's: 0…1. */
	strength: number;
}

const numberOf = (value: PropertyValue | undefined): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** How many arrows per row: `Density` (1 by default) times the usual. */
export function densityOf(item: PlotItem): number {
	return Math.max(0.25, Math.min(4, numberOf(item.style.get('Density')) ?? 1));
}

/** The field at each place given, with each arrow's strength among them. Places it can't work out are left out. */
export function arrowList(item: PlotItem, evaluated: Evaluated, placeList: readonly number[][]): Arrow[] {
	const runList = (item.partList ?? []).map((part) => evaluated.compiled(part));
	const { scope, variable } = localScope(evaluated.scope);
	const list: Arrow[] = [];
	let longest = 0;
	for (const at of placeList) {
		variable.x = at[0];
		variable.y = at[1];
		variable.z = at[2] ?? 0;
		let vector: number[];
		try {
			vector = runList.map((run) => toNumber(run(scope)));
		} catch {
			continue;
		}
		if (!vector.every(Number.isFinite)) continue;
		const length = Math.hypot(...vector);
		longest = Math.max(longest, length);
		list.push({ at, vector, strength: length });
	}
	for (const arrow of list) arrow.strength = longest > 0 ? arrow.strength / longest : 0;
	return list;
}

export interface FieldAxis {
	/** What is in view on this axis. */
	range: [number, number];
	/** About how many arrows across it. */
	count: number;
}

/**
 * The field on a grid tied to the plot's numbers, not to the screen: arrows sit at multiples of a
 * round step (1, 2, 5, 10…), so they move with the plot and grow as it is zoomed in, until the step
 * gets smaller and more fill in between (those already there stay). The longest arrow in view fills
 * a cell. `rest` is added to each place (the z of a 2D field drawn in space). Gives the arrows in
 * view and the step on each axis.
 */
export function gridArrowList(item: PlotItem, evaluated: Evaluated, axisList: readonly FieldAxis[], rest: readonly number[] = []): { arrowList: Arrow[]; stepList: number[] } {
	const stepList = axisList.map((axis) => niceStep(Math.max(1e-12, axis.range[1] - axis.range[0]) / Math.max(1, axis.count)));
	let placeList: number[][] = [[]];
	axisList.forEach((axis, index) => {
		const step = stepList[index]!;
		const first = Math.ceil(axis.range[0] / step - 1e-9);
		const last = Math.floor(axis.range[1] / step + 1e-9);
		const valueList = Array.from({ length: Math.max(0, Math.min(400, last - first + 1)) }, (_, at) => (first + at) * step);
		placeList = placeList.flatMap((place) => valueList.map((value) => [...place, value]));
	});
	return { arrowList: arrowList(item, evaluated, rest.length ? placeList.map((place) => [...place, ...rest]) : placeList), stepList };
}

/** A gradient's stops, colors made CSS by `resolve` (a theme color's name → what it is now). */
export function gradientStopOf(item: PlotItem, resolve: (color: string) => string): GradientStop[] | undefined {
	const list = gradientOf(item);
	return list ? readGradient(list).map((stop) => ({ color: resolve(stop.color), at: stop.at })) : undefined;
}

/** The colors of `Gradient: [Blue, "Teal 40%", Red]` as written (two or more), or undefined: the line's one color. */
export function gradientOf(item: PlotItem): string[] | undefined {
	const value = item.style.get('Gradient');
	const list = (Array.isArray(value) ? value : []).map(String).filter(Boolean);
	return list.length >= 2 ? list : undefined;
}

/** How many colors a gradient is drawn in: arrows are grouped by them. */
export const gradientStepCount = 8;

/** The two stops around a place (0…1) and how far along from the first: stops each at their own place. */
function segmentOf<T extends { at: number }>(stopList: readonly T[], at: number): { low: T; high: T; part: number } {
	const place = Math.max(0, Math.min(1, at));
	if (place <= stopList[0]!.at) return { low: stopList[0]!, high: stopList[0]!, part: 0 };
	for (let index = 1; index < stopList.length; index++) {
		const high = stopList[index]!;
		if (place > high.at) continue;
		const low = stopList[index - 1]!;
		return { low, high, part: high.at > low.at ? (place - low.at) / (high.at - low.at) : 1 };
	}
	const last = stopList.at(-1)!;
	return { low: last, high: last, part: 0 };
}

/** The CSS color at a place (0…1) of a gradient whose stops are CSS colors at their places: a mix of the two around it. */
export function gradientCss(stopList: readonly GradientStop[], at: number): string {
	const { low, high, part } = segmentOf(stopList, at);
	return low === high ? low.color : `color-mix(in oklab, ${low.color} ${((1 - part) * 100).toFixed(1)}%, ${high.color})`;
}

export type Rgb = [number, number, number];

/** The RGB color at a place (0…1) of a gradient of RGB stops (0…1 each), each at its place. */
export function gradientRgb(stopList: readonly { rgb: Rgb; at: number }[], at: number): Rgb {
	const { low, high, part } = segmentOf(stopList, at);
	const [a, b] = [low.rgb, high.rgb];
	return [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part, a[2] + (b[2] - a[2]) * part];
}
