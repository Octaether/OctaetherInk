// The Plot block on the page: the plot (2D here; 3D loads its own code when a plot is in space),
// sliders for numbers, and the list of lines with their colors, values, and mistakes. Clicking the
// list edits the block. Loaded the first time a plot shows.
//
//   interactive  drag to move, the wheel zooms once you click the plot (pinch or Ctrl + wheel
//                always), double-click goes back; Keep this view writes X and Y into the block
//   fixed        Interactive: False shows exactly X and Y, and the pointer does nothing

import type { ExpressionNode, Value } from '@octaether/core-expression';
import { type PropertyMap, type PropertyValue, formatInline } from '@octaether/core-format';
import { type ColorPicker, type MenuEntry, type Point, type PopupMenu, type RenderContext, type RenderHandle, type Renderer, type ResolvedBlock, type TableData, type TableSnapshot, colorPickerExtension, escapeHtml, installStyle, menuExtension, tableDataExtension } from '@octaether/core-sdk';
import { dateLabel, dateTickList, numberLabel, numberTickList } from './axis';
import { type TrendKind, fitTrend, trendText } from './fit';
import { niceStep, type PlotItem, type PlotProgram } from './parse';
import { insertLine, numberText, removeLine, replaceSpan, setLine, setLineStyle, setSliderRange } from './source';
import { toTex } from './tex';
import { type Evaluated, type Series, evaluateProgram, localScope, pointListOf, programOf, seriesOf, toNumber } from './program';
import { type Viewport, fromPixelX, fromPixelY, joinSegment, marchSquare, pathOf, sampleCurve, sampleFunction, shadeRegion, toPixelX, toPixelY } from './sample';
import { plotStyle } from './style';

export const colorList = ['Accent', '#c0643c', '#3d8a7a', '#7a8a35', '#b5546a', '#8a5a3c', '#5f8a5f', '#a08a5a'];

/** What a stage (2D or 3D) does for the shell around it. */
export interface Stage {
	readonly element: HTMLElement;
	draw(program: PlotProgram, evaluated: Evaluated, colorOf: (item: PlotItem) => string, block: ResolvedBlock, context: RenderContext): void;
	/** The view was moved from the block's own. */
	moved(): boolean;
	/** The properties that keep the current view (X, Y, Z, Camera). */
	keptView(): Map<string, PropertyValue>;
	resetView(): void;
	zoom(factor: number): void;
	/** Things it learned while drawing (a trend's equation), by line. */
	noteMap: Map<PlotItem, string>;
	/** False when there is no view to zoom (a pie). */
	zoomable?(): boolean;
	anchor?(name: string, toward?: Point): Point | undefined;
	destroy(): void;
}

export interface StageHost {
	/** Redraws the buttons (Keep this view) after the view moved. */
	viewChanged(): void;
	/** A point that can be dragged (its numbers are written in the line, or sliders). */
	movable(item: PlotItem): boolean;
	/** A point dragged to (x, y); `done` when let go (then written). */
	dragPoint(item: PlotItem, x: number, y: number, done: boolean): void;
	interactive(): boolean;
	focused(): boolean;
	focus(): void;
}

const rangeOf = (value: PropertyValue | undefined): [number, number] | undefined => {
	if (!Array.isArray(value) || value.length < 2) return undefined;
	const [a, b] = value.map((item) => (typeof item === 'number' ? item : typeof item === 'string' ? (dayNumber(item) ?? Number(item)) : Number.NaN));
	return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : undefined;
};

function dayNumber(text: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
	return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : undefined;
}

/** A number to keep in the text: as few digits as the view needs. */
export function keepNumber(value: number, span: number): number {
	const step = niceStep(span / 1000);
	return Number((Math.round(value / step) * step).toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
}

const textOf = (value: PropertyValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
const valueText = (value: Value): string => (Array.isArray(value) ? `[${value.slice(0, 6).map(valueText).join(', ')}${value.length > 6 ? ', …' : ''}]` : typeof value === 'number' ? (Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)))) : value);

// ---------------------------------------------------------------- 2D

interface HoverTarget {
	kind: 'Curve' | 'Point';
	color: string;
	work?: (x: number) => number;
	along?: 'x' | 'y';
	pixelList?: number[];
	categoryList?: string[];
	dateAxis?: boolean;
}

class Stage2D implements Stage {
	readonly element: HTMLElement;
	readonly noteMap = new Map<PlotItem, string>();
	private readonly svgHost: HTMLElement;
	private readonly hover: HTMLElement;
	/** The view moved by you; undefined: the block's own. */
	private view: Viewport | undefined;
	private shown: Viewport | undefined;
	private dateAxis = false;
	private categoryList: string[] | undefined;
	private hoverList: HoverTarget[] = [];
	private redraw: (() => void) | undefined;
	private frame = 0;
	private readonly pointerMap = new Map<number, { x: number; y: number }>();
	private pan: { view: Viewport; x: number; y: number } | undefined;
	/** Points that can be dragged, where they are drawn; and the one being dragged. */
	private handleList: { item: PlotItem; px: number; py: number }[] = [];
	private pointDrag: { item: PlotItem; pointerId: number } | undefined;
	private pinch: { view: Viewport; distance: number; x: number; y: number } | undefined;
	private readonly resize: ResizeObserver | undefined;
	private lastWidth = 0;
	/** A pie chart has no view to move. */
	private pieMode = false;
	/** A pie's slices (for their labels), and the one a click keeps lit. */
	private sliceList: PieSlice[] = [];
	private pinned: number | undefined;
	/** Bars, by their column on screen, with what their label says. */
	private barList: { left: number; right: number; x: number; y: number; label: string; color: string }[] = [];

	constructor(private readonly host: StageHost) {
		this.element = document.createElement('div');
		this.element.className = 'oi-plot-stage';
		this.svgHost = document.createElement('div');
		this.svgHost.className = 'oi-plot-svg-host';
		this.hover = document.createElement('div');
		this.hover.className = 'oi-plot-hover';
		this.hover.hidden = true;
		this.element.append(this.svgHost, this.hover);
		this.bind();
		this.resize =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(() => {
						if (this.element.clientWidth !== this.lastWidth) this.schedule();
					});
		this.resize?.observe(this.element);
	}

	destroy(): void {
		this.resize?.disconnect();
		cancelAnimationFrame(this.frame);
	}

	private schedule(): void {
		cancelAnimationFrame(this.frame);
		this.frame = requestAnimationFrame(() => this.redraw?.());
	}

	moved(): boolean {
		return this.view !== undefined;
	}

	zoomable(): boolean {
		return !this.pieMode;
	}

	resetView(): void {
		this.view = undefined;
		this.redraw?.();
		this.host.viewChanged();
	}

	keptView(): Map<string, PropertyValue> {
		const view = this.shown;
		if (!view) return new Map();
		const keep = (value: number, span: number): PropertyValue => (this.dateAxis ? dateLabelIso(value) : keepNumber(value, span));
		const xSpan = view.xMax - view.xMin;
		const ySpan = view.yMax - view.yMin;
		return new Map<string, PropertyValue>([
			['X', [keep(view.xMin, xSpan), keep(view.xMax, xSpan)]],
			['Y', [keepNumber(view.yMin, ySpan), keepNumber(view.yMax, ySpan)]],
		]);
	}

	zoom(factor: number): void {
		const view = this.shown;
		if (!view) return;
		this.zoomAt(factor, view.width / 2, view.height / 2);
	}

	private zoomAt(factor: number, px: number, py: number): void {
		const view = this.shown;
		if (!view || this.pieMode) return;
		const x = fromPixelX(view, px);
		const y = fromPixelY(view, py);
		this.view = { ...view, xMin: x - (x - view.xMin) * factor, xMax: x + (view.xMax - x) * factor, yMin: y - (y - view.yMin) * factor, yMax: y + (view.yMax - y) * factor };
		this.schedule();
		this.host.viewChanged();
	}

	anchor(name: string): Point | undefined {
		const match = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(name.trim());
		const view = this.shown;
		if (!match || !view) return undefined;
		const rect = this.svgHost.getBoundingClientRect();
		return { x: rect.left + toPixelX(view, Number(match[1])), y: rect.top + toPixelY(view, Number(match[2])) };
	}

	draw(program: PlotProgram, evaluated: Evaluated, colorOf: (item: PlotItem) => string, block: ResolvedBlock, context: RenderContext): void {
		this.redraw = () => this.paint(program, evaluated, colorOf, block, context);
		this.redraw();
	}

	private initialView(program: PlotProgram, evaluated: Evaluated, block: ResolvedBlock, width: number, height: number, seriesList: { item: PlotItem; series: Series }[]): Viewport {
		const xRange = rangeOf(block.property.get('X'));
		const yRange = rangeOf(block.property.get('Y'));
		const dataX: number[] = [];
		const dataY: number[] = [];
		let bar = false;
		for (const { item, series } of seriesList) {
			series.xList.forEach((x, index) => {
				const y = series.yList[index]!;
				if (Number.isFinite(x) && Number.isFinite(y)) {
					dataX.push(x);
					dataY.push(y);
				}
			});
			if (textOf(item.style.get('Kind')) === 'Bar' || series.categoryList) bar = true;
		}
		for (const item of program.itemList) {
			if (item.kind !== 'Point') continue;
			try {
				for (const point of pointListOf(item, evaluated)) {
					if (Number.isFinite(point[0]!) && Number.isFinite(point[1]!)) {
						dataX.push(point[0]!);
						dataY.push(point[1]!);
					}
				}
			} catch {
				// reported with the line
			}
		}
		const hasSeries = seriesList.length > 0;
		const aspectText = textOf(block.property.get('Aspect'));
		const equal = aspectText ? aspectText === 'Equal' : !hasSeries;
		const fit = (list: number[], pad: number, zero: boolean): [number, number] | undefined => {
			if (list.length === 0) return undefined;
			let min = Math.min(...list);
			let max = Math.max(...list);
			if (zero) {
				min = Math.min(min, 0);
				max = Math.max(max, 0);
			}
			if (max === min) {
				min -= 1;
				max += 1;
			}
			const margin = (max - min) * pad;
			return [zero && min === 0 ? 0 : min - margin, max + margin];
		};
		let x = xRange ?? (hasSeries ? fit(dataX, bar ? 0.08 : 0.05, false) : undefined);
		if (x && bar && !xRange) {
			// room for half a bar on each side: a bar is as wide as the gap between its neighbours (a month for months)
			const distinct = [...new Set(dataX)].sort((a, b) => a - b);
			let gap = Number.POSITIVE_INFINITY;
			for (let index = 1; index < distinct.length; index++) gap = Math.min(gap, distinct[index]! - distinct[index - 1]!);
			const half = (Number.isFinite(gap) ? gap : 1) * 0.6;
			x = [Math.min(x[0], distinct[0]! - half), Math.max(x[1], distinct.at(-1)! + half)];
		}
		let y = yRange ?? (hasSeries ? fit(dataY, 0.1, bar) : undefined);
		const pixelRatio = height / width;
		if (!x && !y) x = [-10, 10];
		if (equal) {
			if (x && !y) {
				const span = (x[1] - x[0]) * pixelRatio;
				y = [-span / 2, span / 2];
			} else if (y && !x) {
				const span = (y[1] - y[0]) / pixelRatio;
				x = [-span / 2, span / 2];
			}
		}
		x ??= [-10, 10];
		y ??= [-10 * pixelRatio, 10 * pixelRatio];
		return { xMin: x[0], xMax: x[1], yMin: y[0], yMax: y[1], width, height };
	}

	private paint(program: PlotProgram, evaluated: Evaluated, colorOf: (item: PlotItem) => string, block: ResolvedBlock, context: RenderContext): void {
		const width = Math.max(120, this.element.clientWidth || 600);
		const height = Math.max(80, this.element.clientHeight || 300);
		this.lastWidth = this.element.clientWidth;
		this.noteMap.clear();
		const seriesList: { item: PlotItem; series: Series }[] = [];
		for (const item of program.itemList) {
			if (item.kind !== 'Data') continue;
			try {
				seriesList.push({ item, series: seriesOf(item, evaluated) });
			} catch (error) {
				this.noteMap.set(item, error instanceof Error ? error.message : String(error));
			}
		}
		this.dateAxis = seriesList.some(({ series }) => series.dateAxis);
		this.categoryList = seriesList.find(({ series }) => series.categoryList)?.series.categoryList;
		const pie = seriesList.find(({ item }) => textOf(item.style.get('Kind')) === 'Pie' || textOf(item.style.get('Kind')) === 'Donut');
		this.pieMode = pie !== undefined;
		this.element.toggleAttribute('data-pie', this.pieMode);
		this.barList = [];
		if (pie) {
			this.shown = { xMin: -1, xMax: 1, yMin: -1, yMax: 1, width, height };
			this.hoverList = [];
			const how = combineText(pie.item, Boolean(pie.series.categoryList));
			const unit = how?.startsWith('count') ? undefined : evaluated.columnInfo(pie.item.partList?.[1])?.unit;
			const drawn = pieSvg(pie.item, pie.series, width, height, (color) => context.resolveColor(color) ?? color, unit);
			this.svgHost.innerHTML = drawn.svg;
			this.sliceList = drawn.sliceList;
			if (this.pinned !== undefined && this.pinned >= this.sliceList.length) this.pinned = undefined;
			this.accent('slice', this.pinned);
			return;
		}
		this.sliceList = [];
		this.pinned = undefined;
		let view = this.view ? { ...this.view, width, height } : this.initialView(program, evaluated, block, width, height, seriesList);
		if (this.view && (this.view.width !== width || this.view.height !== height)) {
			// a new size keeps the scale: the view grows or shrinks around its middle
			const sx = ((view.xMax - view.xMin) / this.view.width) * width;
			const sy = ((view.yMax - view.yMin) / this.view.height) * height;
			const cx = (view.xMin + view.xMax) / 2;
			const cy = (view.yMin + view.yMax) / 2;
			view = { xMin: cx - sx / 2, xMax: cx + sx / 2, yMin: cy - sy / 2, yMax: cy + sy / 2, width, height };
			this.view = view;
		}
		this.shown = view;
		const resolve = (color: string): string => context.resolveColor(color) ?? color;
		const showGrid = block.property.get('Grid') !== false;
		const showAxis = block.property.get('Axis') !== false;
		let grid = '';
		let axis = '';
		let label = '';
		const xTickList = this.categoryList
			? this.categoryList.map((name, index) => ({ value: index, label: name })).filter((tick) => tick.value >= view.xMin && tick.value <= view.xMax)
			: this.dateAxis
				? dateTickList(view.xMin, view.xMax, width)
				: numberTickList(view.xMin, view.xMax, width);
		const yTickList = numberTickList(view.yMin, view.yMax, height, 60);
		const xAxisY = Math.min(height - 16, Math.max(2, toPixelY(view, 0)));
		const yAxisX = Math.min(width - 4, Math.max(28, toPixelX(view, 0)));
		const bottomLabel = this.dateAxis || this.categoryList || toPixelY(view, 0) > height - 16 || toPixelY(view, 0) < 0;
		const leftLabel = this.dateAxis || this.categoryList || toPixelX(view, 0) < 28 || toPixelX(view, 0) > width;
		for (const tick of xTickList) {
			const px = toPixelX(view, tick.value);
			if (showGrid && !this.categoryList) grid += `M${px.toFixed(1)} 0V${height}`;
			if (showAxis) {
				const y = bottomLabel ? height - 4 : xAxisY + 13;
				if (tick.value !== 0 || bottomLabel) label += `<text x="${px.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${escapeHtml(tick.label)}</text>`;
			}
		}
		for (const tick of yTickList) {
			const py = toPixelY(view, tick.value);
			if (showGrid) grid += `M0 ${py.toFixed(1)}H${width}`;
			if (showAxis && (tick.value !== 0 || leftLabel)) {
				const x = leftLabel ? 4 : yAxisX - 5;
				label += `<text x="${x.toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="${leftLabel ? 'start' : 'end'}">${escapeHtml(tick.label)}</text>`;
			}
		}
		if (showAxis) {
			const zeroY = toPixelY(view, 0);
			const zeroX = toPixelX(view, 0);
			if (zeroY >= 0 && zeroY <= height) axis += `M0 ${zeroY.toFixed(1)}H${width}`;
			if (zeroX >= 0 && zeroX <= width && !this.dateAxis && !this.categoryList) axis += `M${zeroX.toFixed(1)} 0V${height}`;
		}
		// the axes are named after the columns drawn (and how they are combined), unless XLabel and YLabel say
		const xName = textOf(block.property.get('XLabel')) ?? (seriesList.length ? seriesList.map(({ item }) => axisName(evaluated.columnInfo(item.partList?.[0]), undefined)).find(Boolean) : undefined);
		const yName =
			textOf(block.property.get('YLabel')) ??
			(seriesList.length
				? [...new Set(seriesList.map(({ item }) => {
						const how = combineText(item, Boolean(seriesList.find((entry) => entry.item === item)?.series.categoryList));
						return axisName(evaluated.columnInfo(item.partList?.[1]), how);
					}).filter(Boolean))].join(', ') || undefined
				: undefined);
		if (xName) label += `<text class="oi-plot-axis-name" x="${width - 6}" y="${(bottomLabel ? height - 18 : xAxisY - 6).toFixed(1)}" text-anchor="end">${escapeHtml(xName)}</text>`;
		if (yName) label += `<text class="oi-plot-axis-name" x="${(leftLabel ? 6 : yAxisX + 6).toFixed(1)}" y="14">${escapeHtml(yName)}</text>`;
		// what each line draws
		let region = '';
		let curve = '';
		let mark = '';
		this.hoverList = [];
		this.handleList = [];
		const strokeOf = (item: PlotItem, color: string, fallbackWidth = 2.2): string => {
			const lineWidth = typeof item.style.get('Width') === 'number' ? (item.style.get('Width') as number) : fallbackWidth;
			const dash = item.style.get('Style') === 'Dashed' ? ' stroke-dasharray="7 5"' : item.style.get('Style') === 'Dotted' ? ' stroke-dasharray="1.5 4" stroke-linecap="round"' : '';
			const opacity = typeof item.style.get('Opacity') === 'number' ? ` stroke-opacity="${item.style.get('Opacity')}"` : '';
			return `fill="none" stroke="${escapeHtml(color)}" stroke-width="${lineWidth}"${dash}${opacity} stroke-linejoin="round"`;
		};
		const fail = (item: PlotItem, error: unknown): void => {
			this.noteMap.set(item, error instanceof Error ? error.message : String(error));
		};
		for (const item of program.itemList) {
			const color = resolve(colorOf(item));
			if (item.style.get('Hidden') === true) continue;
			try {
				switch (item.kind) {
					case 'Explicit':
					case 'Function': {
						if (item.kind === 'Function' && (item.parameterList?.length !== 1 || item.parameterList[0] !== 'x')) break;
						const along = item.kind === 'Explicit' && item.name === 'x' ? 'y' : 'x';
						const run = evaluated.compiled(item.right!);
						const { scope, variable } = localScope(evaluated.scope);
						const work = (value: number): number => {
							variable[along] = value;
							return toNumber(run(scope));
						};
						const domain = rangeOf(item.style.get('Domain'));
						curve += `<path d="${pathOf(sampleFunction(work, view, along, domain))}" ${strokeOf(item, color)}/>`;
						this.hoverList.push({ kind: 'Curve', color, work, along });
						break;
					}
					case 'Polar': {
						const run = evaluated.compiled(item.right!);
						const { scope, variable } = localScope(evaluated.scope);
						const range = rangeOf(item.style.get('Theta')) ?? rangeOf(item.style.get('T')) ?? [0, 2 * Math.PI];
						const work = (theta: number): [number, number] => {
							variable['θ'] = theta;
							variable.t = theta;
							const r = toNumber(run(scope));
							return [r * Math.cos(theta), r * Math.sin(theta)];
						};
						curve += `<path d="${pathOf(sampleCurve(work, range[0], range[1], view, 720))}" ${strokeOf(item, color)}/>`;
						break;
					}
					case 'Parametric': {
						const [xNode, yNode] = item.partList!;
						const runX = evaluated.compiled(xNode!);
						const runY = evaluated.compiled(yNode!);
						const { scope, variable } = localScope(evaluated.scope);
						const range = rangeOf(item.style.get('T')) ?? [0, 2 * Math.PI];
						const work = (t: number): [number, number] => {
							variable.t = t;
							return [toNumber(runX(scope)), toNumber(runY(scope))];
						};
						curve += `<path d="${pathOf(sampleCurve(work, range[0], range[1], view))}" ${strokeOf(item, color)}/>`;
						break;
					}
					case 'Implicit': {
						const { left, right, relation } = item;
						const runLeft = evaluated.compiled(left!);
						const runRight = evaluated.compiled(right!);
						const { scope, variable } = localScope(evaluated.scope);
						const work = (x: number, y: number): number => {
							variable.x = x;
							variable.y = y;
							return toNumber(runLeft(scope)) - toNumber(runRight(scope));
						};
						if (relation !== '=') {
							const strict = relation === '<' || relation === '>';
							const below = relation === '<' || relation === '<=';
							const fill = `fill="${escapeHtml(color)}" fill-opacity="${typeof item.style.get('Opacity') === 'number' ? item.style.get('Opacity') : 0.2}"`;
							// y < f(x) (or f(x) > y): the area under or over the curve, exactly
							const yLeft = left!.kind === 'Name' && left!.name === 'y' && !nameUses(right!, 'y');
							const yRight = right!.kind === 'Name' && right!.name === 'y' && !nameUses(left!, 'y');
							if (yLeft || yRight) {
								const runCurve = yLeft ? runRight : runLeft;
								const curveWork = (x: number): number => {
									variable.x = x;
									return toNumber(runCurve(scope));
								};
								const under = yLeft ? below : !below;
								const lineList = sampleFunction(curveWork, view, 'x');
								for (const line of lineList) {
									const edge = under ? height + 10 : -10;
									region += `<path d="${pathOf([line])}L${line.at(-2)!.toFixed(1)} ${edge}L${line[0]!.toFixed(1)} ${edge}Z" ${fill}/>`;
								}
								curve += `<path d="${pathOf(lineList)}" ${strokeOf(item, color, 2)}${strict ? ' stroke-dasharray="7 5"' : ''}/>`;
							} else {
								const rectList = shadeRegion((x, y) => {
									const value = work(x, y);
									return below ? (strict ? value < 0 : value <= 0) : strict ? value > 0 : value >= 0;
								}, view);
								let data = '';
								for (let index = 0; index < rectList.length; index += 4) data += `M${rectList[index]} ${rectList[index + 1]}h${rectList[index + 2]}v${rectList[index + 3]}h${-rectList[index + 2]!}z`;
								region += `<path d="${data}" ${fill}/>`;
								curve += `<path d="${pathOf(joinSegment(marchSquare(work, view)))}" ${strokeOf(item, color, 2)}${strict ? ' stroke-dasharray="7 5"' : ''}/>`;
							}
						} else curve += `<path d="${pathOf(joinSegment(marchSquare(work, view)))}" ${strokeOf(item, color)}/>`;
						break;
					}
					case 'Point': {
						const pointList = pointListOf(item, evaluated);
						const pixelList: number[] = [];
						const name = textOf(item.style.get('Label')) ?? item.name;
						const movable = pointList.length === 1 && this.host.movable(item);
						for (const point of pointList) {
							const px = toPixelX(view, point[0]!);
							const py = toPixelY(view, point[1]!);
							if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
							pixelList.push(px, py);
							mark += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${escapeHtml(color)}"/>`;
							if (movable) {
								// a ring says it can be dragged
								mark += `<circle class="oi-plot-handle" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9" fill="${escapeHtml(color)}" fill-opacity="0.18" stroke="${escapeHtml(color)}" stroke-opacity="0.5"/>`;
								this.handleList.push({ item, px, py });
							}
							if (name) mark += `<text class="oi-plot-point-label" x="${(px + 8).toFixed(1)}" y="${(py - 8).toFixed(1)}" fill="${escapeHtml(color)}">${escapeHtml(name)}</text>`;
						}
						this.hoverList.push({ kind: 'Point', color, pixelList });
						break;
					}
					case 'Data': {
						const series = seriesList.find((entry) => entry.item === item)?.series;
						if (!series) break;
						const how = combineText(item, Boolean(series.categoryList));
						const unit = how?.startsWith('count') ? undefined : evaluated.columnInfo(item.partList?.[1])?.unit;
						const drawn = this.drawSeries(item, series, view, color, strokeOf, unit);
						region += drawn.region;
						curve += drawn.curve;
						mark += drawn.mark;
						// a bar lights up whole (see showHover); other kinds show the point nearest
						if (!drawn.bar) this.hoverList.push({ kind: 'Point', color, pixelList: drawn.pixelList, categoryList: series.categoryList, dateAxis: series.dateAxis });
						const trendKind = (['Linear', 'Quadratic', 'Exponential'] as TrendKind[]).find((kind) => kind === textOf(item.style.get('Trend')));
						if (trendKind) {
							const trend = fitTrend(trendKind, series.xList, series.yList);
							if (trend) {
								curve += `<path d="${pathOf(sampleFunction(trend.at, view, 'x'))}" fill="none" stroke="${escapeHtml(color)}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.85"/>`;
								this.noteMap.set(item, trendText(trend, series.dateAxis));
							} else this.noteMap.set(item, 'not enough points for a trend');
						}
						break;
					}
					default:
				}
			} catch (error) {
				fail(item, error);
			}
		}
		const clip = `oi-plot-clip-${Math.random().toString(36).slice(2, 8)}`;
		this.svgHost.innerHTML =
			`<svg class="oi-plot-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Plot">` +
			`<defs><clipPath id="${clip}"><rect width="${width}" height="${height}"/></clipPath></defs>` +
			`<g clip-path="url(#${clip})">` +
			(grid ? `<path class="oi-plot-grid" d="${grid}"/>` : '') +
			(axis ? `<path class="oi-plot-axis" d="${axis}"/>` : '') +
			region +
			curve +
			mark +
			`</g><g class="oi-plot-label">${label}</g></svg>`;
		this.hover.hidden = true;
	}

	private drawSeries(item: PlotItem, series: Series, view: Viewport, color: string, strokeOf: (item: PlotItem, color: string, width?: number) => string, unit?: string): { region: string; curve: string; mark: string; pixelList: number[]; bar: boolean } {
		const kind = textOf(item.style.get('Kind')) ?? (series.categoryList ? 'Bar' : 'Scatter');
		const pairList = series.xList.map((x, index) => [x, series.yList[index]!] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
		if (kind === 'Line' || kind === 'Area') pairList.sort((a, b) => a[0] - b[0]);
		const pixelList = pairList.flatMap(([x, y]) => [toPixelX(view, x), toPixelY(view, y)]);
		let region = '';
		let curve = '';
		let mark = '';
		const safe = escapeHtml(color);
		if (kind === 'Bar') {
			const sorted = [...new Set(pairList.map(([x]) => x))].sort((a, b) => a - b);
			let gap = series.categoryList ? 1 : Number.POSITIVE_INFINITY;
			for (let index = 1; index < sorted.length; index++) gap = Math.min(gap, sorted[index]! - sorted[index - 1]!);
			if (!Number.isFinite(gap)) gap = (view.xMax - view.xMin) / 20;
			const barWidth = Math.max(2, ((gap * view.width) / (view.xMax - view.xMin)) * 0.72);
			const zero = Math.min(view.height + 2, Math.max(-2, toPixelY(view, 0)));
			const group = textOf(item.style.get('Group'));
			for (let index = 0; index < pixelList.length; index += 2) {
				const px = pixelList[index]!;
				const py = pixelList[index + 1]!;
				const [x, y] = pairList[index / 2]!;
				this.barList.push({ left: px - barWidth / 2, right: px + barWidth / 2, x: px, y: Math.min(py, zero), label: `${seriesXName(x, series, group)} · ${withUnit(y, unit)}`, color });
				region += `<rect data-bar="${this.barList.length - 1}" x="${(px - barWidth / 2).toFixed(1)}" y="${Math.min(py, zero).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.abs(zero - py).toFixed(1)}" rx="2" fill="${safe}" fill-opacity="0.85"/>`;
			}
		} else if (kind === 'Line' || kind === 'Area') {
			if (pixelList.length >= 2) {
				if (kind === 'Area') {
					const zero = toPixelY(view, 0);
					region += `<path d="${pathOf([pixelList])}L${pixelList.at(-2)!.toFixed(1)} ${zero.toFixed(1)}L${pixelList[0]!.toFixed(1)} ${zero.toFixed(1)}Z" fill="${safe}" fill-opacity="0.18"/>`;
				}
				curve += `<path d="${pathOf([pixelList])}" ${strokeOf(item, color)}/>`;
				if (pixelList.length <= 120) for (let index = 0; index < pixelList.length; index += 2) mark += `<circle cx="${pixelList[index]!.toFixed(1)}" cy="${pixelList[index + 1]!.toFixed(1)}" r="2.6" fill="${safe}"/>`;
			}
		} else {
			for (let index = 0; index < pixelList.length; index += 2) mark += `<circle cx="${pixelList[index]!.toFixed(1)}" cy="${pixelList[index + 1]!.toFixed(1)}" r="3.6" fill="${safe}" fill-opacity="0.9"/>`;
		}
		return { region, curve, mark, pixelList, bar: kind === 'Bar' };
	}

	// ------------------------------------------------------------ pointer

	private bind(): void {
		const element = this.element;
		element.addEventListener('pointerdown', (event) => {
			if (this.pieMode) {
				const slice = (event.target as Element).closest<SVGElement>('[data-slice]');
				const index = slice ? Number(slice.dataset.slice) : undefined;
				this.pinned = index === undefined || index === this.pinned ? undefined : index;
				this.accent('slice', event.pointerType === 'mouse' ? (index ?? this.pinned) : this.pinned);
				return;
			}
			if (!this.host.interactive() || (event.target as Element).closest('button')) return;
			if (event.button !== 0 && event.pointerType === 'mouse') return;
			this.host.focus();
			// a point that can be dragged moves; elsewhere the view does
			const handle = this.handleAt(event);
			if (handle && this.pointerMap.size === 0) {
				element.setPointerCapture(event.pointerId);
				this.pointDrag = { item: handle.item, pointerId: event.pointerId };
				event.preventDefault();
				return;
			}
			element.setPointerCapture(event.pointerId);
			this.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
			this.startGesture();
			event.preventDefault();
		});
		element.addEventListener('pointermove', (event) => {
			if (this.pointDrag && event.pointerId === this.pointDrag.pointerId) {
				const spot = this.dataAt(event);
				if (spot) this.host.dragPoint(this.pointDrag.item, spot.x, spot.y, false);
				return;
			}
			const known = this.pointerMap.get(event.pointerId);
			if (!known) {
				if (event.pointerType === 'mouse') {
					this.showHover(event);
					element.style.cursor = this.host.interactive() && this.handleAt(event) ? 'move' : '';
				}
				return;
			}
			known.x = event.clientX;
			known.y = event.clientY;
			this.moveGesture();
		});
		const end = (event: PointerEvent): void => {
			if (this.pointDrag && event.pointerId === this.pointDrag.pointerId) {
				const spot = this.dataAt(event);
				const item = this.pointDrag.item;
				this.pointDrag = undefined;
				if (spot) this.host.dragPoint(item, spot.x, spot.y, true);
				return;
			}
			if (!this.pointerMap.delete(event.pointerId)) return;
			this.startGesture();
		};
		element.addEventListener('pointerup', end);
		element.addEventListener('pointercancel', end);
		element.addEventListener('pointerleave', () => {
			if (this.pieMode) this.accent('slice', this.pinned);
			else if (this.pointerMap.size === 0) {
				this.hover.hidden = true;
				if (this.barList.length) this.accent('bar', undefined);
			}
		});
		element.addEventListener(
			'wheel',
			(event) => {
				if (!this.host.interactive() || !(this.host.focused() || event.ctrlKey)) return;
				event.preventDefault();
				const rect = this.svgHost.getBoundingClientRect();
				const factor = Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015) * (event.deltaMode === 1 ? 16 : 1));
				this.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
			},
			{ passive: false },
		);
		element.addEventListener('dblclick', (event) => {
			if (!this.host.interactive() || (event.target as Element).closest('button')) return;
			event.preventDefault();
			this.resetView();
		});
	}

	/** The draggable point under the pointer (within 12 px). */
	private handleAt(event: PointerEvent): { item: PlotItem; px: number; py: number } | undefined {
		const rect = this.svgHost.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		return this.handleList.find((handle) => Math.hypot(handle.px - x, handle.py - y) <= 12);
	}

	/** The plot coordinates under the pointer, rounded to what the zoom shows. */
	private dataAt(event: PointerEvent): { x: number; y: number } | undefined {
		const view = this.shown;
		if (!view) return undefined;
		const rect = this.svgHost.getBoundingClientRect();
		const round = (value: number, span: number): number => {
			const step = niceStep(span / 200);
			return Number((Math.round(value / step) * step).toPrecision(12));
		};
		return { x: round(fromPixelX(view, event.clientX - rect.left), view.xMax - view.xMin), y: round(fromPixelY(view, event.clientY - rect.top), view.yMax - view.yMin) };
	}

	/** One finger (or the mouse) pans; two pinch. Starts again whenever a finger comes or goes. */
	private startGesture(): void {
		const view = this.shown;
		const list = [...this.pointerMap.values()];
		this.pan = undefined;
		this.pinch = undefined;
		if (!view || list.length === 0) return;
		if (list.length === 1) this.pan = { view, x: list[0]!.x, y: list[0]!.y };
		else {
			const [a, b] = list as [{ x: number; y: number }, { x: number; y: number }];
			this.pinch = { view, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		}
	}

	private moveGesture(): void {
		if (this.pieMode) return;
		const list = [...this.pointerMap.values()];
		this.hover.hidden = true;
		if (this.pan && list.length === 1) {
			const { view, x, y } = this.pan;
			const dx = ((list[0]!.x - x) / view.width) * (view.xMax - view.xMin);
			const dy = ((list[0]!.y - y) / view.height) * (view.yMax - view.yMin);
			this.view = { ...view, xMin: view.xMin - dx, xMax: view.xMax - dx, yMin: view.yMin + dy, yMax: view.yMax + dy };
		} else if (this.pinch && list.length >= 2) {
			const [a, b] = list as [{ x: number; y: number }, { x: number; y: number }];
			const { view, distance, x, y } = this.pinch;
			const factor = distance / (Math.hypot(a.x - b.x, a.y - b.y) || 1);
			const rect = this.svgHost.getBoundingClientRect();
			const cx = fromPixelX(view, x - rect.left);
			const cy = fromPixelY(view, y - rect.top);
			const mx = (a.x + b.x) / 2 - x;
			const my = (a.y + b.y) / 2 - y;
			const sx = (view.xMax - view.xMin) / view.width;
			const sy = (view.yMax - view.yMin) / view.height;
			this.view = {
				...view,
				xMin: cx - (cx - view.xMin) * factor - mx * sx * factor,
				xMax: cx + (view.xMax - cx) * factor - mx * sx * factor,
				yMin: cy - (cy - view.yMin) * factor + my * sy * factor,
				yMax: cy + (view.yMax - cy) * factor + my * sy * factor,
			};
		} else return;
		this.schedule();
		this.host.viewChanged();
	}

	/** The point on a curve (or the data point) nearest the pointer, with its coordinates. */
	private showHover(event: PointerEvent): void {
		const view = this.shown;
		if (!view) return;
		if (this.pieMode) {
			const slice = (event.target as Element).closest<SVGElement>('[data-slice]');
			this.accent('slice', slice ? Number(slice.dataset.slice) : this.pinned);
			return;
		}
		const rect = this.svgHost.getBoundingClientRect();
		const px = event.clientX - rect.left;
		const py = event.clientY - rect.top;
		// over a bar's column: that bar, lit, with its value
		if (this.barList.length) {
			const index = this.barList.findIndex((bar) => px >= bar.left && px <= bar.right);
			this.accent('bar', index >= 0 ? index : undefined);
			if (index >= 0) return;
		}
		let best: { x: number; y: number; distance: number; color: string; label: string } | undefined;
		const xText = (value: number, target?: HoverTarget): string => {
			if (target?.categoryList) return target.categoryList[Math.round(value)] ?? '';
			if (this.dateAxis) return dateLabel(value);
			return numberLabel(value, (view.xMax - view.xMin) / 1000);
		};
		const yText = (value: number): string => numberLabel(value, (view.yMax - view.yMin) / 1000);
		for (const target of this.hoverList) {
			if (target.kind === 'Curve' && target.work) {
				if (target.along === 'x') {
					const value = target.work(fromPixelX(view, px));
					const cy = toPixelY(view, value);
					const distance = Math.abs(cy - py);
					if (Number.isFinite(cy) && distance < 14 && (!best || distance < best.distance)) best = { x: px, y: cy, distance, color: target.color, label: `(${xText(fromPixelX(view, px))}, ${yText(value)})` };
				} else {
					const value = target.work(fromPixelY(view, py));
					const cx = toPixelX(view, value);
					const distance = Math.abs(cx - px);
					if (Number.isFinite(cx) && distance < 14 && (!best || distance < best.distance)) best = { x: cx, y: py, distance, color: target.color, label: `(${xText(value)}, ${yText(fromPixelY(view, py))})` };
				}
			} else if (target.pixelList) {
				for (let index = 0; index < target.pixelList.length; index += 2) {
					const distance = Math.hypot(target.pixelList[index]! - px, target.pixelList[index + 1]! - py);
					if (distance < 12 && (!best || distance < best.distance)) {
						const x = fromPixelX(view, target.pixelList[index]!);
						best = { x: target.pixelList[index]!, y: target.pixelList[index + 1]!, distance, color: target.color, label: `(${xText(x, target)}, ${yText(fromPixelY(view, target.pixelList[index + 1]!))})` };
					}
				}
			}
		}
		if (!best) {
			this.hover.hidden = true;
			return;
		}
		this.hover.hidden = false;
		delete this.hover.dataset.tag;
		this.hover.style.left = `${best.x}px`;
		this.hover.style.top = `${best.y}px`;
		this.hover.style.setProperty('--oi-plot-hover-color', best.color);
		this.hover.innerHTML = `<span class="oi-plot-hover-dot"></span><span class="oi-plot-hover-label">${escapeHtml(best.label)}</span>`;
	}

	/** Lights one slice (or bar) and dims the rest, with its name and value beside it; undefined: none. */
	private accent(kind: 'slice' | 'bar', index: number | undefined): void {
		const svg = this.svgHost.querySelector<SVGSVGElement>('svg');
		if (!svg) return;
		const on = index === undefined ? undefined : String(index);
		svg.toggleAttribute('data-active', on !== undefined);
		for (const element of svg.querySelectorAll<SVGElement>(`[data-${kind}]`)) element.toggleAttribute('data-on', element.dataset[kind] === on);
		const spot = index === undefined ? undefined : kind === 'slice' ? this.sliceList[index] : this.barList[index] && { ...this.barList[index]!, side: 'Above' as const };
		if (!spot) {
			this.hover.hidden = true;
			return;
		}
		this.hover.hidden = false;
		this.hover.dataset.tag = spot.side;
		this.hover.style.left = `${spot.x}px`;
		this.hover.style.top = `${spot.y}px`;
		this.hover.style.setProperty('--oi-plot-hover-color', spot.color);
		this.hover.innerHTML = `<span class="oi-plot-hover-label">${escapeHtml(spot.label)}</span>`;
	}
}

function nameUses(node: import('@octaether/core-expression').ExpressionNode, name: string): boolean {
	switch (node.kind) {
		case 'Name':
			return node.name === name;
		case 'Call':
			return node.argumentList.some((item) => nameUses(item, name));
		case 'Unary':
			return nameUses(node.operand, name);
		case 'Binary':
			return nameUses(node.left, name) || nameUses(node.right, name);
		case 'List':
		case 'Tuple':
			return node.itemList.some((item) => nameUses(item, name));
		case 'Piecewise':
			return node.caseList.some((item) => (item.condition ? nameUses(item.condition, name) : false) || nameUses(item.value, name));
		default:
			return false;
	}
}

const dateLabelIso = (day: number): string => {
	const date = new Date(Math.round(day) * 86_400_000);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- the block

const keepMark = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const resetMark = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.3"/><path d="M4 4v4h4"/></svg>';
const plusMark = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const minusMark = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const playMark = '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M4.5 3v10l8.5-5z"/></svg>';
const moreMark = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';
const pauseMark = '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>';

/** Lazy 3D: its code loads when a plot is first in space. */
let stage3dLoad: Promise<{ createStage3D(host: StageHost): Stage }> | undefined;

export class PlotView {
	readonly root: HTMLElement;
	private readonly stageHost: HTMLElement;
	private readonly toolElement: HTMLElement;
	private readonly listElement: HTMLElement;
	private stage: Stage | undefined;
	private space: boolean | undefined;
	private program!: PlotProgram;
	private evaluated!: Evaluated;
	/** Slider values while you drag (written to the text when you let go). */
	private readonly override = new Map<string, number>();
	/** What the slider rows were drawn for. */
	private sliderShape = '';
	private readonly snapshotMap = new Map<string, TableSnapshot | undefined>();
	private readonly watchMap = new Map<string, () => void>();
	private playing: { name: string; frame: number; direction: number } | undefined;
	private isFocused = false;
	private readonly onOutside = (event: PointerEvent): void => {
		if (this.isFocused && !this.root.contains(event.target as Node)) {
			this.isFocused = false;
			this.root.classList.remove('oi-plot-focused');
		}
	};

	constructor(
		readonly frame: HTMLElement,
		private block: ResolvedBlock,
		private context: RenderContext,
	) {
		this.root = document.createElement('div');
		this.root.className = 'oi-plot';
		this.stageHost = document.createElement('div');
		this.stageHost.className = 'oi-plot-frame';
		this.toolElement = document.createElement('div');
		this.toolElement.className = 'oi-plot-tool';
		this.listElement = document.createElement('div');
		this.listElement.className = 'oi-plot-list';
		this.stageHost.append(this.toolElement);
		this.root.append(this.stageHost, this.listElement);
		frame.append(this.root);
		document.addEventListener('pointerdown', this.onOutside, true);
		this.bindTool();
		this.bindSlider();
		this.bindList();
		this.render();
	}

	update(block: ResolvedBlock, context: RenderContext): void {
		this.block = block;
		this.context = context;
		// a number the text now holds wins over the one being dragged
		this.override.clear();
		this.render();
	}

	destroy(): void {
		document.removeEventListener('pointerdown', this.onOutside, true);
		this.stopPlay();
		for (const cleanup of this.watchMap.values()) cleanup();
		this.stage?.destroy();
		this.root.remove();
	}

	anchor(name: string, toward?: Point): Point | undefined {
		return this.stage?.anchor?.(name, toward);
	}

	/** The tables the plot reads by title (`Data: Gym log`, or a list of them). */
	private dataList(): string[] {
		const value = this.block.property.get('Data');
		return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(String).filter((item) => item.trim() !== '');
	}

	private interactive(): boolean {
		const own = this.block.property.get('Interactive');
		return own === undefined ? this.context.setting('Plot.Interactive') !== false : own !== false;
	}

	private stageHostApi(): StageHost {
		return {
			viewChanged: () => this.renderTool(),
			movable: (item) => this.movable(item),
			dragPoint: (item, x, y, done) => this.dragPoint(item, x, y, done),
			interactive: () => this.interactive(),
			focused: () => this.isFocused,
			focus: () => {
				this.isFocused = true;
				this.root.classList.add('oi-plot-focused');
			},
		};
	}

	private dimension(): number | undefined {
		const value = this.block.property.get('Dimension');
		return value === 3 || value === '3' || value === '3D' ? 3 : value === 2 || value === '2' || value === '2D' ? 2 : undefined;
	}

	private heightCss(): string {
		const value = this.block.property.get('Height');
		if (typeof value === 'number' && value > 0) return `${value}px`;
		if (typeof value === 'string' && /^\d+(\.\d+)?(px|em|rem|vh)$/.test(value.trim())) return value.trim();
		const setting = this.context.setting('Plot.Height');
		return typeof setting === 'string' && /^\d+(\.\d+)?(px|em)$/.test(setting) ? setting : '20em';
	}

	private render(): void {
		this.program = programOf(this.body(), this.dimension());
		this.loadTable();
		this.evaluated = evaluateProgram(this.program, this.override, this.snapshotMap, this.dataList());
		const interactive = this.interactive();
		this.root.classList.toggle('oi-plot-fixed', !interactive);
		this.stageHost.style.height = this.heightCss();
		if (interactive) this.stageHost.dataset.oiInteractive = '';
		else delete this.stageHost.dataset.oiInteractive;
		if (this.space !== this.program.space || !this.stage) {
			this.stage?.destroy();
			this.stage?.element.remove();
			this.stage = undefined;
			this.space = this.program.space;
			if (this.program.space) {
				const host = this.stageHostApi();
				stage3dLoad ??= import('./view3d');
				const space = this.space;
				void stage3dLoad.then((module) => {
					if (this.space !== space || this.stage) return;
					this.stage = module.createStage3D(host);
					this.stageHost.prepend(this.stage.element);
					this.drawStage();
					this.renderList();
				});
			} else {
				this.stage = new Stage2D(this.stageHostApi());
				this.stageHost.prepend(this.stage.element);
			}
		}
		this.drawStage();
		this.renderList();
		this.renderTool();
	}

	private colorOf = (item: PlotItem): string => {
		const own = textOf(item.style.get('Color'));
		if (own) return own;
		const drawn = this.program.itemList.filter((entry) => !['Define', 'Value'].includes(entry.kind) && !(entry.kind === 'Function' && entry.parameterList?.join() !== 'x'));
		const index = drawn.indexOf(item);
		return colorList[(index < 0 ? 0 : index) % colorList.length]!;
	};

	private drawStage(): void {
		if (!this.stage) return;
		try {
			this.stage.draw(this.program, this.evaluated, this.colorOf, this.block, this.context);
		} catch (error) {
			this.stage.noteMap.clear();
			this.listElement.dataset.problem = error instanceof Error ? error.message : String(error);
		}
	}

	/** Reads the tables the plot names, and draws again when they change. */
	private loadTable(): void {
		const data = this.context.extension<TableData>(tableDataExtension);
		const wanted = new Set(this.dataList());
		for (const [reference, cleanup] of this.watchMap) {
			if (wanted.has(reference)) continue;
			cleanup();
			this.watchMap.delete(reference);
			this.snapshotMap.delete(reference);
		}
		if (!data) return;
		for (const reference of wanted) {
			if (this.watchMap.has(reference)) continue;
			const read = (): void => {
				void data.read(this.context, reference).then((snapshot) => {
					this.snapshotMap.set(reference, snapshot);
					this.evaluated = evaluateProgram(this.program, this.override, this.snapshotMap, this.dataList());
					this.drawStage();
					this.renderList();
					this.renderTool();
				});
			};
			this.watchMap.set(reference, data.watch(this.context, reference, read));
			read();
		}
	}

	// ------------------------------------------------------------ sliders

	private sliderList(): PlotItem[] {
		return this.program.itemList.filter((item) => item.kind === 'Define' && item.slider);
	}

	/** The sliders moved (a drag, a play): their rows just follow; anything else draws the list again. */
	private renderSlider(): void {
		if (this.sliderShapeOf() !== this.sliderShape) {
			this.renderList();
			return;
		}
		for (const item of this.sliderList()) {
			const row = this.sliderRow(item.name!);
			const value = this.evaluated.scope.variable[item.name!];
			if (!row || typeof value !== 'number') continue;
			const shown = row.querySelector<HTMLElement>('.oi-plot-slider-value');
			if (shown && shown.tagName !== 'INPUT') shown.textContent = valueText(value);
			const input = row.querySelector<HTMLInputElement>('input[type="range"]');
			if (input && document.activeElement !== input && Number(input.value) !== value) input.value = String(value);
		}
	}

	private sliderRow(name: string): HTMLElement | null {
		return this.listElement.querySelector<HTMLElement>(`.oi-plot-row-slider[data-name="${cssEscape(name)}"]`);
	}

	/** The slider whose number, or whose range, is being typed. */
	private valueEdit: string | undefined;
	private rangeEdit: string | undefined;
	private rangeSide = 'min';

	/** A typed value: written into the line (the range grows to hold it). */
	private commitValue(name: string, value: number): void {
		this.valueEdit = undefined;
		const item = this.sliderList().find((entry) => entry.name === name);
		if (!item?.valueSpan || !Number.isFinite(value)) {
			this.renderSlider();
			return;
		}
		let body = replaceSpan(this.block.body, [{ ...item.valueSpan, text: numberText(value) }]);
		const slider = item.slider!;
		if (value < slider.min || value > slider.max) body = setSliderRange(body, item.line, Math.min(slider.min, value), Math.max(slider.max, value), Array.isArray(item.style.get('Slider')) && (item.style.get('Slider') as unknown[]).length > 2 ? slider.step : undefined);
		this.override.delete(name);
		if (body !== this.block.body) this.context.setBody(body);
		else this.renderSlider();
	}

	private commitRange(name: string): void {
		const row = this.sliderRow(name);
		const read = (field: string): number => Number(row?.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)?.value ?? Number.NaN);
		this.rangeEdit = undefined;
		const item = this.sliderList().find((entry) => entry.name === name);
		const min = read('min');
		const max = read('max');
		const stepText = row?.querySelector<HTMLInputElement>('input[data-field="step"]')?.value.trim() ?? '';
		if (!item || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
			this.renderSlider();
			return;
		}
		const next = setSliderRange(this.block.body, item.line, min, max, stepText === '' ? undefined : Number(stepText));
		if (next !== this.block.body) this.context.setBody(next);
		else this.renderSlider();
	}

	private setSlider(name: string, value: number, write: boolean): void {
		this.override.set(name, value);
		this.evaluated = evaluateProgram(this.program, this.override, this.snapshotMap, this.dataList());
		this.drawStage();
		this.renderSlider();
		if (write) this.writeSlider(name, value);
	}

	/** Puts a slider's number into the text, as one undo step (only the number changes). */
	private writeSlider(name: string, value: number): void {
		if (this.context.readOnly()) return;
		const item = this.sliderList().find((entry) => entry.name === name);
		if (!item?.valueSpan) return;
		const next = replaceSpan(this.block.body, [{ ...item.valueSpan, text: numberText(value) }]);
		if (next !== this.block.body) this.context.setBody(next);
	}

	/** The sliders' own handlers, on the list (each slider sits in its line's row). */
	private bindSlider(): void {
		const element = this.listElement;
		element.addEventListener('input', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.type !== 'range') return;
			const name = input.closest<HTMLElement>('[data-name]')?.dataset.name;
			if (name) this.setSlider(name, Number(input.value), false);
		});
		element.addEventListener('change', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.type !== 'range') return;
			const name = input.closest<HTMLElement>('[data-name]')?.dataset.name;
			if (name) this.writeSlider(name, Number(input.value));
		});
		element.addEventListener('click', (event) => {
			const button = (event.target as Element).closest<HTMLElement>('[data-action]');
			const name = button?.closest<HTMLElement>('[data-name]')?.dataset.name;
			if (!button || !name) return;
			switch (button.dataset.action) {
				case 'Play':
					if (this.playing?.name === name) this.stopPlay(true);
					else this.play(name);
					return;
				case 'EditValue':
					this.stopPlay(true);
					this.valueEdit = name;
					this.rangeEdit = undefined;
					this.renderSlider();
					return;
				case 'EditRange':
					this.rangeEdit = name;
					this.rangeSide = button.dataset.side ?? 'min';
					this.valueEdit = undefined;
					this.renderSlider();
					return;
				case 'RangeDone':
					this.commitRange(name);
			}
		});
		element.addEventListener('keydown', (event) => {
			const input = event.target as HTMLInputElement;
			const name = input.closest<HTMLElement>('[data-name]')?.dataset.name;
			if (!name || input.type !== 'number') return;
			event.stopPropagation();
			if (event.key === 'Enter') {
				event.preventDefault();
				if (input.dataset.field === 'value') this.commitValue(name, Number(input.value));
				else this.commitRange(name);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.valueEdit = undefined;
				this.rangeEdit = undefined;
				this.renderSlider();
			}
		});
		element.addEventListener('focusout', (event) => {
			const input = event.target as HTMLInputElement;
			const row = input.closest<HTMLElement>('[data-name]');
			const name = row?.dataset.name;
			if (!name || input.type !== 'number') return;
			const next = event.relatedTarget as Node | null;
			if (next && row.contains(next)) return;
			setTimeout(() => {
				if (row.contains(document.activeElement)) return;
				if (this.valueEdit === name) this.commitValue(name, Number(input.value));
				else if (this.rangeEdit === name) this.commitRange(name);
			}, 0);
		});
	}

	/** Moves a slider back and forth on its own, about 4 seconds end to end. */
	private play(name: string): void {
		this.stopPlay(true);
		const item = this.sliderList().find((entry) => entry.name === name);
		if (!item?.slider) return;
		const { min, max, step } = item.slider;
		this.playing = { name, frame: 0, direction: 1 };
		let last = performance.now();
		// where the slider is, unrounded: a frame moves it less than a step, so rounding each frame would stall it
		let position = toNumber(this.evaluated.scope.variable[name] ?? min);
		if (!Number.isFinite(position)) position = min;
		const tick = (now: number): void => {
			if (!this.playing || this.playing.name !== name) return;
			let next = position + this.playing.direction * ((max - min) * (now - last)) / 4000;
			last = now;
			if (next >= max) {
				next = max;
				this.playing.direction = -1;
			} else if (next <= min) {
				next = min;
				this.playing.direction = 1;
			}
			position = next;
			this.setSlider(name, Number((Math.round(next / step) * step).toPrecision(12)), false);
			const input = this.sliderRow(name)?.querySelector<HTMLInputElement>('input[type="range"]');
			if (input) input.value = String(next);
			this.playing.frame = requestAnimationFrame(tick);
		};
		this.playing.frame = requestAnimationFrame(tick);
		this.renderSlider();
	}

	private stopPlay(write = false): void {
		if (!this.playing) return;
		const { name, frame } = this.playing;
		cancelAnimationFrame(frame);
		this.playing = undefined;
		if (write) {
			const value = this.override.get(name);
			if (value !== undefined) this.writeSlider(name, value);
		}
		this.renderSlider();
	}

	// ------------------------------------------------------------ the list of lines

	/** A line as the list shows it: its label, a data line by its columns, anything else as typeset math. */
	private rowHtml(item: PlotItem): string {
		const label = textOf(item.style.get('Label')) ?? (item.kind === 'Data' ? item.name : undefined);
		if (item.kind === 'Data') {
			const [x, y, z] = (item.partList ?? []).map((part) => this.evaluated.columnInfo(part)?.name);
			const kind = textOf(item.style.get('Kind'))?.toLowerCase() ?? 'points';
			const how = combineText(item, false);
			const name = label ?? (x && y ? `${y}${z ? `, ${z}` : ''} by ${x}` : item.text);
			return `<span class="oi-plot-name">${escapeHtml(name)}</span><span class="oi-plot-note">${escapeHtml([kind, how].filter(Boolean).join(', '))}</span>`;
		}
		let math: string | undefined;
		try {
			// typeset, without source offsets: a click on it edits the line from its start
			const node: ExpressionNode = item.name && item.left && (item.kind === 'Point' || item.kind === 'Parametric') ? { kind: 'Binary', operator: '=', left: item.left, right: item.node, start: 0, end: 0 } : item.node;
			math = this.context.renderInline('Math', toTex(node), new Map(), 0)?.replace(/\sdata-oi-[se]="[^"]*"/g, '');
		} catch {
			math = undefined;
		}
		const body = math ?? escapeHtml(item.text);
		return label ? `<span class="oi-plot-name">${escapeHtml(label)}</span> ${body}` : body;
	}

	private renderList(): void {
		const readOnly = this.context.readOnly();
		const input = this.listElement.querySelector<HTMLInputElement>('input[data-field="line"]');
		if (this.editLine !== undefined && !this.focusLine && input && document.activeElement === input && input.dataset.line === String(this.editLine)) {
			// typing: the row keeps its input; only its mistake (or none) is shown again
			const problem = [...this.program.problemList, ...this.evaluated.problemList].find((entry) => entry.line === this.editLine);
			const live = this.listElement.querySelector<HTMLElement>('.oi-plot-live-problem');
			if (live) {
				live.textContent = problem?.message ?? '';
				// only a real mistake is marked (an empty mark would outline the block as broken)
				live.toggleAttribute('data-oi-problem', problem !== undefined);
			}
			return;
		}
		// Legend: False shows only the sliders, unless the block is being edited
		const full = this.block.property.get('Legend') !== false || this.frame.closest('[data-oi-editing]') !== null || this.editLine !== undefined;
		const problemMap = new Map<number, string>();
		for (const problem of [...this.program.problemList, ...this.evaluated.problemList]) if (!problemMap.has(problem.line)) problemMap.set(problem.line, problem.message);
		const lineList = this.body().split('\n');
		let offset = 0;
		const rowList: string[] = [];
		const itemByLine = new Map(this.program.itemList.map((item) => [item.line, item]));
		const picker = readOnly ? undefined : this.context.extension<ColorPicker>(colorPickerExtension);
		const more = (index: number): string => (readOnly ? '' : `<button type="button" class="oi-plot-more" data-more="${index}" title="Color, line, label, hide, delete…" aria-label="Options">${moreMark}</button>`);
		lineList.forEach((line, index) => {
			const start = offset;
			offset += line.length + 1;
			const editing = this.editLine === index;
			if (!editing && (line.trim() === '' || /^\s*(?:#|\/\/)/.test(line))) return;
			const item = itemByLine.get(index);
			const problem = problemMap.get(index);
			const hidden = item?.style.get('Hidden') === true;
			const drawn = item && !['Define', 'Value'].includes(item.kind) && !(item.kind === 'Function' && item.parameterList?.join() !== 'x');
			const color = drawn ? (this.context.resolveColor(this.colorOf(item)) ?? this.colorOf(item)) : undefined;
			const dot =
				drawn && picker
					? `<button type="button" class="oi-plot-dot" data-dot="${index}" style="--oi-plot-dot:${escapeHtml(color!)}"${hidden ? ' data-hidden' : ''} title="Color" aria-label="Color"></button>`
					: `<span class="oi-plot-dot"${color ? ` style="--oi-plot-dot:${escapeHtml(color)}"` : ' data-empty'}${hidden ? ' data-hidden' : ''}></span>`;
			if (editing) {
				rowList.push(
					`<div class="oi-plot-row oi-plot-row-editing" data-line="${index}">${dot}` +
						`<input class="oi-plot-line" data-field="line" data-line="${index}" value="${escapeHtml(line.trim())}" spellcheck="false" autocomplete="off" aria-label="Line ${index + 1}" placeholder="Type, or / for what you can add">` +
						`<span class="oi-plot-problem oi-plot-live-problem"${problem ? ' data-oi-problem' : ''}>${escapeHtml(problem ?? '')}</span></div>`,
				);
				return;
			}
			// a number with a slider: the slider on its own line
			if (item?.kind === 'Define' && item.slider && !problem) {
				rowList.push(this.sliderRowHtml(item, index));
				return;
			}
			if (!full && !problem) return;
			const note = item ? this.stage?.noteMap.get(item) : undefined;
			const value = item ? this.evaluated.valueMap.get(item) : undefined;
			rowList.push(
				`<div class="oi-plot-row${problem ? ' oi-plot-row-problem' : ''}${hidden ? ' oi-plot-row-hidden' : ''}" data-line="${index}" data-oi-s="${start + (line.length - line.trimStart().length)}"${readOnly ? '' : ' title="Click to edit"'}>` +
					dot +
					`<span class="oi-plot-expression">${item && !problem ? this.rowHtml(item) : escapeHtml(line.trim())}</span>` +
					(value !== undefined && item?.kind === 'Value' ? `<span class="oi-plot-value">= ${escapeHtml(valueText(value))}</span>` : '') +
					(note ? `<span class="oi-plot-note">${escapeHtml(note)}</span>` : '') +
					(problem ? `<span class="oi-plot-problem" data-oi-problem>${escapeHtml(problem)}</span>` : '') +
					more(index) +
					`</div>`,
			);
		});
		if (this.listElement.dataset.problem) {
			rowList.push(`<div class="oi-plot-row oi-plot-row-problem"><span class="oi-plot-problem" data-oi-problem>${escapeHtml(this.listElement.dataset.problem)}</span></div>`);
			delete this.listElement.dataset.problem;
		}
		if (this.body().trim() === '' && this.editLine === undefined) rowList.push(`<div class="oi-plot-row oi-plot-empty">An empty plot: add a function, a slider, a point, or a chart of a table.</div>`);
		if (!readOnly && full) rowList.push(`<button type="button" class="oi-plot-add" data-action="AddMenu">${plusMark}<span>Add</span></button>`);
		this.listElement.hidden = rowList.length === 0;
		this.listElement.innerHTML = rowList.join('');
		this.sliderShape = this.sliderShapeOf();
		// the editing layer takes its own clicks (the block's source is a view away)
		if (readOnly) delete this.listElement.dataset.oiInteractive;
		else this.listElement.dataset.oiInteractive = '';
		const fresh = this.listElement.querySelector<HTMLInputElement>('input[data-field="line"]');
		if (fresh && this.focusLine) {
			this.focusLine = false;
			fresh.focus({ preventScroll: true });
			fresh.setSelectionRange(fresh.value.length, fresh.value.length);
		}
		const numberInput = this.listElement.querySelector<HTMLInputElement>(this.valueEdit ? 'input[data-field="value"]' : this.rangeEdit ? `input[data-field="${this.rangeSide}"]` : 'none');
		if (numberInput && document.activeElement !== numberInput) {
			numberInput.focus({ preventScroll: true });
			numberInput.select();
		}
	}

	/** A number with its slider in one line: `a = [2.5]  0 ━━●━━ 5  ▶`. */
	private sliderRowHtml(item: PlotItem, index: number): string {
		const readOnly = this.context.readOnly();
		const slider = item.slider!;
		const name = escapeHtml(item.name!);
		const value = toNumber(this.evaluated.scope.variable[item.name!] ?? Number.NaN);
		const playing = this.playing?.name === item.name;
		const editable = !readOnly && item.valueSpan !== undefined;
		let nameHtml: string | undefined;
		try {
			nameHtml = this.context.renderInline('Math', `${toTex({ kind: 'Name', name: item.name!, start: 0, end: 0 })} =`, new Map(), 0)?.replace(/\sdata-oi-[se]="[^"]*"/g, '');
		} catch {
			nameHtml = undefined;
		}
		const head = `<span class="oi-plot-dot" data-empty></span><span class="oi-plot-expression oi-plot-slider-name">${nameHtml ?? `${name} =`}</span>`;
		const valueHtml =
			this.valueEdit === item.name
				? `<input class="oi-plot-slider-value oi-plot-number" data-field="value" type="number" step="any" value="${Number.isFinite(value) ? value : ''}" aria-label="${name}">`
				: `<button type="button" class="oi-plot-slider-value" data-action="EditValue"${editable ? '' : ' disabled'} title="Type a value">${escapeHtml(valueText(value))}</button>`;
		if (this.rangeEdit === item.name) {
			const own = item.style.get('Slider');
			const step = Array.isArray(own) && own.length > 2 ? slider.step : '';
			return (
				`<div class="oi-plot-row oi-plot-row-slider oi-plot-range" data-line="${index}" data-name="${name}">${head}` +
				`<input class="oi-plot-number" data-field="min" type="number" step="any" value="${slider.min}" aria-label="Lowest">` +
				`<span class="oi-plot-range-name">≤ ${name} ≤</span>` +
				`<input class="oi-plot-number" data-field="max" type="number" step="any" value="${slider.max}" aria-label="Highest">` +
				`<label class="oi-plot-step">Step <input class="oi-plot-number" data-field="step" type="number" step="any" min="0" value="${step}" placeholder="any" aria-label="Step"></label>` +
				`<button type="button" class="oi-plot-button" data-action="RangeDone">Done</button></div>`
			);
		}
		const bound = (bound: number, side: string): string =>
			editable ? `<button type="button" class="oi-plot-slider-bound" data-action="EditRange" data-side="${side}" title="Range and step">${escapeHtml(valueText(bound))}</button>` : `<span class="oi-plot-slider-bound">${escapeHtml(valueText(bound))}</span>`;
		return (
			`<div class="oi-plot-row oi-plot-row-slider" data-line="${index}" data-name="${name}"${readOnly ? '' : ' title="Click the name to edit the line"'}>${head}${valueHtml}` +
			`<span class="oi-plot-slider-track">${bound(slider.min, 'min')}<input type="range" min="${slider.min}" max="${slider.max}" step="${slider.step}" value="${Number.isFinite(value) ? value : slider.min}" aria-label="${name}"${readOnly && !this.interactive() ? ' disabled' : ''}>${bound(slider.max, 'max')}</span>` +
			`<button type="button" class="oi-plot-play" data-action="Play" aria-label="${playing ? 'Pause' : 'Play'} ${name}">${playing ? pauseMark : playMark}</button>` +
			(readOnly ? '' : `<button type="button" class="oi-plot-more" data-more="${index}" title="Range, delete…" aria-label="Options">${moreMark}</button>`) +
			`</div>`
		);
	}

	private sliderShapeOf(): string {
		return JSON.stringify([this.context.readOnly(), this.playing?.name, this.valueEdit, this.rangeEdit, this.sliderList().map((item) => [item.name, item.slider, item.line])]);
	}

	/** A name not used yet: `a`, `b`… for numbers, `P`, `Q`… for points. */
	private freeName(point: boolean): string {
		const taken = this.program.variableSet;
		return (point ? ['P', 'Q', 'R', 'S', 'U', 'V', 'W'] : ['a', 'b', 'c', 'd', 'k', 'm', 'n', 'p', 'q', 's', 'u', 'v', 'w']).find((name) => !taken.has(name)) ?? (point ? 'P_2' : 'a_2');
	}

	/** What can be added: kinds of lines, and charts of the plot's tables by their columns. */
	private addEntryList(pick: (text: string) => void): MenuEntry[] {
		const list: MenuEntry[] = [
			{ title: 'Function', hint: 'y = x^2', run: () => pick('y = x^2') },
			{ title: 'Number with a slider', hint: `${this.freeName(false)} = 1`, run: () => pick(`${this.freeName(false)} = 1`) },
			{ title: 'Point', hint: `${this.freeName(true)} = (1, 2)`, run: () => pick(`${this.freeName(true)} = (1, 2)`) },
			{ title: 'Curve in x and y', hint: 'x^2 + y^2 = 4', run: () => pick('x^2 + y^2 = 4') },
			{ title: 'Region', hint: 'y < x', run: () => pick('y < x') },
			{ title: 'Polar curve', hint: 'r = 1 + cos(θ)', run: () => pick('r = 1 + cos(θ)') },
			{ title: 'Parametric curve', hint: '(cos t, sin t)', run: () => pick('(cos t, sin t)') },
			{ title: 'Surface (3D)', hint: 'z = sin(x) cos(y)', run: () => pick('z = sin(x) cos(y)') },
			{ title: 'Note', hint: '# a note', run: () => pick('# ') },
		];
		// charts from the tables the plot reads
		const columnList = this.dataList().flatMap((reference) => this.snapshotMap.get(reference)?.columnList ?? []);
		const dateColumn = columnList.find((column) => column.type === 'Date' || column.type === 'DateTime');
		const nameColumn = columnList.find((column) => column.type === 'Choice' || column.type === 'Text');
		const numberColumnList = columnList.filter((column) => column.type === 'Number').slice(0, 3);
		const variable = (name: string): string => name.trim().replace(/[^A-Za-z0-9Ͱ-Ͽ_]+/g, '_');
		const chartList: MenuEntry[] = [];
		for (const column of numberColumnList) {
			if (dateColumn) chartList.push({ title: `${column.name} by ${dateColumn.name}`, hint: 'line', run: () => pick(`(${variable(dateColumn.name)}, ${variable(column.name)}) {Kind: Line}`) });
			if (dateColumn) chartList.push({ title: `${column.name} by month`, hint: 'bars', run: () => pick(`(${variable(dateColumn.name)}, ${variable(column.name)}) {Kind: Bar, Group: Month, Combine: Sum}`) });
			if (nameColumn) chartList.push({ title: `${column.name} by ${nameColumn.name}`, hint: 'pie', run: () => pick(`(${variable(nameColumn.name)}, ${variable(column.name)}) {Kind: Pie}`) });
		}
		if (chartList.length) list.push({ ...chartList[0]!, separatorBefore: true }, ...chartList.slice(1));
		else
			list.push({
				title: 'Chart a table',
				explain: 'Name a table by its title; its columns can then be added here',
				separatorBefore: true,
				run: () =>
					void this.context
						.extension<PopupMenu>(menuExtension)
						?.prompt('Title of the table to chart', '', 'Chart')
						.then((title) => {
							if (title?.trim()) this.context.setProperty('Data', title.trim());
						}),
			});
		return list;
	}

	/** A line's own menu: its color, line, thickness, label, kind of chart, visibility, removal. */
	private lineMenu(index: number, rect: DOMRect): void {
		const menu = this.context.extension<PopupMenu>(menuExtension);
		const item = this.program.itemList.find((entry) => entry.line === index);
		if (!menu) return;
		const set = (key: string, value: PropertyValue | undefined): void => {
			const next = setLineStyle(this.block.body, index, key, value);
			if (next !== this.block.body) this.context.setBody(next);
		};
		const style = (key: string): PropertyValue | undefined => item?.style.get(key);
		const choice = (key: string, valueList: readonly (string | undefined)[], titleOf: (value: string | undefined) => string, current = style(key)): MenuEntry[] =>
			valueList.map((value) => ({ title: titleOf(value), checked: (current ?? undefined) === value, run: () => set(key, value) }));
		const itemList: MenuEntry[] = [{ title: 'Edit', run: () => this.startEdit(index) }];
		if (item?.kind === 'Define' && item.slider) itemList.push({ title: 'Range and step', run: () => ((this.rangeEdit = item.name), (this.rangeSide = 'min'), this.renderList()) });
		const drawn = item && !['Define', 'Value'].includes(item.kind);
		if (drawn) {
			const picker = this.context.extension<ColorPicker>(colorPickerExtension);
			if (picker) itemList.push({ title: 'Color', separatorBefore: true, run: () => picker.open({ x: rect.left, y: rect.bottom + 4, current: textOf(style('Color')), title: 'Color', onPick: (color) => set('Color', color) }) });
			const kind = textOf(style('Kind'));
			const lineLike = item.kind !== 'Point' && !(item.kind === 'Data' && ['Scatter', 'Bar', 'Pie', 'Donut', undefined].includes(kind));
			if (lineLike) {
				itemList.push(
					{ title: 'Line', childList: choice('Style', [undefined, 'Dashed', 'Dotted'], (value) => value ?? 'Solid') },
					{ title: 'Thickness', childList: [1.2, undefined, 3.5].map((value) => ({ title: value === undefined ? 'Normal' : value < 2 ? 'Thin' : 'Thick', checked: style('Width') === value || (value === undefined && style('Width') === undefined), run: () => set('Width', value) })) },
				);
			}
			if (item.kind === 'Data') {
				itemList.push({ title: 'Kind', childList: choice('Kind', ['Scatter', 'Line', 'Bar', 'Area', 'Pie', 'Donut'], (value) => value!, kind ?? 'Scatter') });
				const date = this.evaluated.columnType(item.partList![0]!);
				if (date === 'Date' || date === 'DateTime') itemList.push({ title: 'Group by', childList: choice('Group', [undefined, 'Day', 'Week', 'Month', 'Year'], (value) => value ?? 'Nothing') });
				itemList.push(
					{ title: 'Combine', childList: choice('Combine', [undefined, 'Average', 'Count', 'Min', 'Max'], (value) => value ?? 'Sum') },
					{ title: 'Trend line', childList: choice('Trend', [undefined, 'Linear', 'Quadratic', 'Exponential'], (value) => value ?? 'None') },
				);
			}
			itemList.push({
				title: 'Label',
				hint: textOf(style('Label')) ?? '',
				run: () =>
					void menu.prompt('Label', textOf(style('Label')) ?? item.name ?? '', 'Set').then((label) => {
						if (label !== undefined) set('Label', label.trim() || undefined);
					}),
			});
			itemList.push({ title: style('Hidden') === true ? 'Show' : 'Hide', run: () => set('Hidden', style('Hidden') === true ? undefined : true) });
		}
		itemList.push({ title: 'Delete', danger: true, separatorBefore: true, run: () => this.context.setBody(removeLine(this.block.body, index)) });
		menu.open({ x: rect.left, y: rect.bottom + 2, itemList });
	}

	// ------------------------------------------------------------ the editing layer (lines, values, ranges, points)

	/** The line being edited in place, the text it started from, and whether its input should take the focus. */
	private editLine: number | undefined;
	private editBase = '';
	private focusLine = false;
	/** The text drawn while something is edited (a line typed, a point dragged); written when done. */
	private draftBody: string | undefined;

	/** The text drawn: the block's, or the one being edited. */
	private body(): string {
		return this.draftBody ?? this.block.body;
	}

	/** Draws the draft again (the plot, its sliders, the list) without writing anything. */
	private refreshDraft(): void {
		this.program = programOf(this.body(), this.dimension());
		this.loadTable();
		this.evaluated = evaluateProgram(this.program, this.override, this.snapshotMap, this.dataList());
		this.drawStage();
		this.renderList();
	}

	private startEdit(line: number, base = this.block.body): void {
		if (this.context.readOnly()) return;
		this.editLine = line;
		this.editBase = base;
		this.draftBody = base === this.block.body ? undefined : base;
		this.focusLine = true;
		this.refreshDraft();
	}

	/** Writes the line typed (an empty one goes); `then` edits the next line, a new one, or the one before. */
	private commitLine(then?: 'Next' | 'Previous' | 'New'): void {
		const line = this.editLine;
		const input = this.listElement.querySelector<HTMLInputElement>('input[data-field="line"]');
		if (line === undefined) return;
		const value = input ? input.value.trim() : (this.editBase.split('\n')[line] ?? '').trim();
		const empty = value === '';
		const written = empty ? removeLine(this.editBase, line) : setLine(this.editBase, line, value);
		const lineCount = written === '' ? 0 : written.split('\n').length;
		let next: { line: number; base: string } | undefined;
		if (then === 'New') next = { line: empty ? line : line + 1, base: insertLine(written, empty ? line - 1 : line, '') };
		else if (then === 'Next' && (empty ? line : line + 1) < lineCount) next = { line: empty ? line : line + 1, base: written };
		else if (then === 'Previous' && line > 0) next = { line: line - 1, base: written };
		// the editing state first: the write draws again at once
		this.editLine = next?.line;
		this.editBase = next?.base ?? '';
		this.draftBody = next && next.base !== written ? next.base : undefined;
		this.focusLine = next !== undefined;
		if (written !== this.block.body) this.context.setBody(written);
		else this.refreshDraft();
	}

	private cancelLine(): void {
		this.editLine = undefined;
		this.draftBody = undefined;
		this.refreshDraft();
	}

	/** Sets a line's Color in its style (undefined: its color from the list again). */
	private setLineColor(lineIndex: number, color: string | undefined): void {
		const next = setLineStyle(this.block.body, lineIndex, 'Color', color);
		if (next !== this.block.body) this.context.setBody(next);
	}

	/** A menu is open over the list: its focus leaving the line doesn't write the line. */
	private menuOpen = false;

	/** The Add menu at `rect`; `pick` gets the line chosen. */
	private openAddMenu(rect: DOMRect, pick: (text: string) => void): boolean {
		const menu = this.context.extension<PopupMenu>(menuExtension);
		if (!menu) return false;
		this.menuOpen = true;
		menu.open({
			x: rect.left,
			y: rect.bottom + 2,
			itemList: this.addEntryList(pick),
			search: true,
			onClose: () =>
				setTimeout(() => {
					this.menuOpen = false;
					const input = this.listElement.querySelector<HTMLInputElement>('input[data-field="line"]');
					if (input && document.activeElement !== input && this.editLine !== undefined) input.focus({ preventScroll: true });
				}, 0),
		});
		return true;
	}

	private bindList(): void {
		const list = this.listElement;
		list.addEventListener('click', (event) => {
			const target = event.target as Element;
			const dot = target.closest<HTMLElement>('button[data-dot]');
			if (dot) {
				const picker = this.context.extension<ColorPicker>(colorPickerExtension);
				if (!picker) return;
				event.stopPropagation();
				const lineIndex = Number(dot.dataset.dot);
				const item = this.program.itemList.find((entry) => entry.line === lineIndex);
				const rect = dot.getBoundingClientRect();
				picker.open({ x: rect.left, y: rect.bottom + 4, current: item ? textOf(item.style.get('Color')) : undefined, title: 'Color', onPick: (color) => this.setLineColor(lineIndex, color) });
				return;
			}
			const more = target.closest<HTMLElement>('button[data-more]');
			if (more) {
				event.stopPropagation();
				let index = Number(more.dataset.more);
				const editing = this.editLine;
				if (editing !== undefined) {
					// the line being typed is written first (an empty one goes, and the lines after it move up)
					const typed = list.querySelector<HTMLInputElement>('input[data-field="line"]')?.value.trim();
					this.commitLine();
					if (typed === '' && editing < index) index -= 1;
				}
				this.lineMenu(index, more.getBoundingClientRect());
				return;
			}
			const add = target.closest<HTMLElement>('[data-action="AddMenu"]');
			if (add) {
				if (this.editLine !== undefined) this.commitLine();
				const append = (text: string): void => {
					const body = this.block.body;
					const count = body === '' ? 0 : body.split('\n').length;
					this.startEdit(count, insertLine(body, count - 1, text));
				};
				if (!this.openAddMenu(add.getBoundingClientRect(), append)) append('');
				return;
			}
			// buttons and fields do their own thing; the rest of a row edits its line
			if (target.closest('button, input, label, .oi-plot-slider-track')) return;
			const row = target.closest<HTMLElement>('.oi-plot-row[data-line]');
			if (!row || this.context.readOnly()) return;
			const line = Number(row.dataset.line);
			if (this.editLine === line) return;
			if (this.editLine !== undefined) this.commitLine();
			this.startEdit(line);
		});
		list.addEventListener('input', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.dataset.field !== 'line' || this.editLine === undefined) return;
			const line = this.editLine;
			// a lone / lists what can be added
			if (input.value.trim() === '/') {
				this.openAddMenu(input.getBoundingClientRect(), (text) => {
					if (this.editLine !== line) return;
					this.draftBody = setLine(this.editBase, line, text);
					this.focusLine = true;
					this.refreshDraft();
				});
				return;
			}
			this.draftBody = setLine(this.editBase, line, input.value);
			this.refreshDraft();
		});
		list.addEventListener('keydown', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.dataset.field !== 'line') return;
			event.stopPropagation();
			if (event.key === 'Enter') {
				event.preventDefault();
				this.commitLine('New');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.cancelLine();
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.commitLine('Next');
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.commitLine('Previous');
			} else if (event.key === 'Backspace' && input.value === '') {
				event.preventDefault();
				this.commitLine('Previous');
			}
		});
		list.addEventListener('focusout', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.dataset.field !== 'line') return;
			const next = event.relatedTarget as Node | null;
			if (next && list.contains(next)) return;
			setTimeout(() => {
				if (this.editLine !== undefined && !this.menuOpen && !list.contains(document.activeElement)) this.commitLine();
			}, 0);
		});
	}

	/** A point can be dragged when each part is a number written there, or a number with a slider. */
	private movable(item: PlotItem): boolean {
		if (item.kind !== 'Point' || item.space || item.node.kind !== 'Tuple' || this.context.readOnly()) return false;
		return item.node.itemList.every((part) => literalOf(part) !== undefined || (part.kind === 'Name' && this.sliderList().some((slider) => slider.name === part.name && slider.valueSpan)));
	}

	/** A point dragged to (x, y): its numbers (or sliders) follow, drawn at once and written when let go. */
	private dragPoint(item: PlotItem, x: number, y: number, done: boolean): void {
		const base = programOf(this.block.body, this.dimension()).itemList.find((entry) => entry.line === item.line);
		if (!base || base.node.kind !== 'Tuple') return;
		const changeList: { start: number; end: number; text: string }[] = [];
		base.node.itemList.forEach((part, index) => {
			const value = [x, y][index];
			if (value === undefined) return;
			if (literalOf(part) !== undefined) changeList.push({ start: base.offset + part.start, end: base.offset + part.end, text: numberText(value) });
			else if (part.kind === 'Name') {
				const slider = this.sliderList().find((entry) => entry.name === part.name);
				if (!slider?.valueSpan || !slider.slider) return;
				const stepped = Number((Math.round(value / slider.slider.step) * slider.slider.step).toPrecision(12));
				this.override.set(part.name, stepped);
				if (done) changeList.push({ ...slider.valueSpan, text: numberText(stepped) });
			}
		});
		if (!done) {
			this.draftBody = replaceSpan(this.block.body, changeList.filter((change) => !this.sliderList().some((slider) => slider.valueSpan?.start === change.start)));
			this.refreshDraft();
			return;
		}
		this.draftBody = undefined;
		const next = replaceSpan(this.block.body, changeList);
		if (next !== this.block.body) this.context.setBody(next);
		else this.refreshDraft();
	}

	// ------------------------------------------------------------ buttons on the plot

	private renderTool(): void {
		if (!this.interactive()) {
			this.toolElement.innerHTML = '';
			return;
		}
		const moved = this.stage?.moved() ?? false;
		const readOnly = this.context.readOnly();
		if (this.stage?.zoomable?.() === false) {
			this.toolElement.innerHTML = '';
			return;
		}
		this.toolElement.innerHTML =
			(moved && !readOnly ? `<button type="button" class="oi-plot-button oi-plot-keep" data-action="Keep" title="Keep this view: write it into the block">${keepMark}<span>Keep this view</span></button>` : '') +
			(moved ? `<button type="button" class="oi-plot-button" data-action="Reset" title="Back to the block's view (double-click)" aria-label="Reset the view">${resetMark}</button>` : '') +
			`<button type="button" class="oi-plot-button" data-action="ZoomIn" title="Zoom in" aria-label="Zoom in">${plusMark}</button>` +
			`<button type="button" class="oi-plot-button" data-action="ZoomOut" title="Zoom out" aria-label="Zoom out">${minusMark}</button>`;
	}

	private bindTool(): void {
		this.toolElement.addEventListener('pointerdown', (event) => event.stopPropagation());
		this.toolElement.addEventListener('click', (event) => {
			const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
			if (!this.stage) return;
			if (action === 'Keep') {
				const kept = this.stage.keptView();
				this.context.note.transact(() => {
					for (const [name, value] of kept) this.context.setProperty(name, value);
				});
				this.stage.resetView();
			} else if (action === 'Reset') this.stage.resetView();
			else if (action === 'ZoomIn') this.stage.zoom(0.7);
			else if (action === 'ZoomOut') this.stage.zoom(1 / 0.7);
		});
	}
}

/** A part that is a number written there (`2`, `-1.5`): its value. */
function literalOf(node: import('@octaether/core-expression').ExpressionNode): number | undefined {
	if (node.kind === 'Number') return node.value;
	if (node.kind === 'Unary' && node.operator === '-' && node.operand.kind === 'Number') return -node.operand.value;
	return undefined;
}

/** An axis named after a column, with its unit and how it is combined: `Weight (kg)`, `Amount ($, sum by month)`. */
function axisName(info: { name: string; unit: string | undefined } | undefined, how: string | undefined): string | undefined {
	if (!info) return undefined;
	const unit = how?.startsWith('count') ? undefined : info.unit;
	const extra = [unit, how].filter(Boolean).join(', ');
	return extra ? `${info.name} (${extra})` : info.name;
}

/** How a data line is combined, in words: "sum by month", "average". */
function combineText(item: PlotItem, categorical: boolean): string | undefined {
	const group = textOf(item.style.get('Group'));
	const combine = textOf(item.style.get('Combine')) ?? (group || categorical ? 'Sum' : undefined);
	if (!combine) return undefined;
	return `${combine.toLowerCase()}${group ? ` by ${group.toLowerCase()}` : ''}`;
}

const shortMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A value with its unit, to about four figures: `$12.50`, `72.4 kg`, `1,250`. */
export function withUnit(value: number, unit?: string): string {
	const currency = unit !== undefined && /^[$€£¥₹₩]$/.test(unit);
	const digit = Number.isInteger(value) ? 0 : currency ? 2 : Math.max(0, Math.min(4, 3 - Math.floor(Math.log10(Math.abs(value) || 1))));
	const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: currency ? digit : 0, maximumFractionDigits: digit });
	const sign = value < 0 ? '−' : '';
	if (!unit) return sign + text;
	return currency ? `${sign}${unit}${text}` : `${sign}${text} ${unit}`;
}

/** Where a series' x is, in words: a category, a month (`Nov 2026`), a day, a number. */
function seriesXName(x: number, series: Series, group: string | undefined): string {
	if (series.categoryList) return series.categoryList[Math.round(x)] ?? '';
	if (!series.dateAxis) return numberLabel(x, 1e-9);
	const date = new Date(Math.round(x) * 86_400_000);
	if (group === 'Year') return String(date.getUTCFullYear());
	if (group === 'Month') return `${shortMonth[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
	if (group === 'Week') return `Week of ${dateLabel(x)}`;
	return dateLabel(x);
}

const shareText = (share: number): string => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

export interface PieSlice {
	/** Name, value, and share, as the label shows them. */
	label: string;
	/** Where the label goes (just outside the slice), and on which side of it. */
	x: number;
	y: number;
	side: 'Above' | 'Below';
	color: string;
}

/**
 * A pie (or a donut, `Hole: 0.5`): a slice per category or period, with a legend of names, values, and
 * shares (beside it, or under it when narrow). Slices and legend rows carry `data-slice` to light up.
 */
export function pieSvg(item: PlotItem, series: Series, width: number, height: number, resolve: (color: string) => string, unit?: string): { svg: string; sliceList: PieSlice[] } {
	const group = textOf(item.style.get('Group'));
	const entryList = series.xList
		.map((x, index) => ({ name: seriesXName(x, series, group), value: series.yList[index]! }))
		.filter((entry) => Number.isFinite(entry.value) && entry.value > 0);
	const total = entryList.reduce((sum, entry) => sum + entry.value, 0);
	if (total <= 0) return { svg: `<svg class="oi-plot-svg" width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="oi-plot-pie-empty">Nothing to show</text></svg>`, sliceList: [] };
	const rowHeight = 20;
	const side = width > 420;
	const legendWidth = side ? Math.min(300, width * 0.45) : width;
	// under the pie when narrow: as many rows as fit in about a third of the height
	const bottomRow = side ? 0 : Math.min(entryList.length, Math.max(2, Math.floor((height * 0.38) / rowHeight)));
	const pieHeight = height - bottomRow * rowHeight - (bottomRow ? 8 : 0);
	const radius = Math.max(20, Math.min((side ? width - legendWidth : width) / 2, pieHeight / 2) - 14);
	const cx = side ? (width - legendWidth) / 2 : width / 2;
	const cy = pieHeight / 2;
	const holeValue = item.style.get('Hole');
	const hole = typeof holeValue === 'number' ? Math.max(0, Math.min(0.9, holeValue)) : textOf(item.style.get('Kind')) === 'Donut' ? 0.55 : 0;
	const point = (angle: number, r: number): string => `${(cx + r * Math.sin(angle)).toFixed(2)} ${(cy - r * Math.cos(angle)).toFixed(2)}`;
	const amount = (value: number): string => withUnit(value, unit);
	let angle = 0;
	let slice = '';
	let legend = '';
	const sliceList: PieSlice[] = [];
	const shownRow = side ? Math.min(entryList.length, Math.max(1, Math.floor((height - 16) / rowHeight))) : bottomRow;
	const legendTop = side ? Math.max(8, cy - (Math.min(shownRow, entryList.length) * rowHeight) / 2) : pieHeight + 8;
	const legendLeft = side ? width - legendWidth + 10 : 12;
	const legendRight = width - 10;
	entryList.forEach((entry, index) => {
		const share = entry.value / total;
		const next = angle + share * Math.PI * 2;
		const middle = (angle + next) / 2;
		const color = escapeHtml(resolve(colorList[index % colorList.length]!));
		const large = next - angle > Math.PI ? 1 : 0;
		// a lit slice moves out a little, along its middle
		const shift = `--oi-dx:${(5 * Math.sin(middle)).toFixed(1)}px;--oi-dy:${(-5 * Math.cos(middle)).toFixed(1)}px`;
		let shape: string;
		if (entryList.length === 1) shape = hole > 0 ? `<path d="M${point(0, radius)}A${radius} ${radius} 0 1 1 ${point(Math.PI, radius)}A${radius} ${radius} 0 1 1 ${point(0, radius)}ZM${point(0, radius * hole)}A${radius * hole} ${radius * hole} 0 1 0 ${point(Math.PI, radius * hole)}A${radius * hole} ${radius * hole} 0 1 0 ${point(0, radius * hole)}Z" fill-rule="evenodd" fill="${color}"/>` : `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`;
		else if (hole > 0) shape = `<path d="M${point(angle, radius)}A${radius} ${radius} 0 ${large} 1 ${point(next, radius)}L${point(next, radius * hole)}A${radius * hole} ${radius * hole} 0 ${large} 0 ${point(angle, radius * hole)}Z" fill="${color}" stroke="var(--oi-color-background)" stroke-width="1.5"/>`;
		else shape = `<path d="M${cx} ${cy}L${point(angle, radius)}A${radius} ${radius} 0 ${large} 1 ${point(next, radius)}Z" fill="${color}" stroke="var(--oi-color-background)" stroke-width="1.5"/>`;
		// the share on the slice when it is big enough (the legend always has it)
		let shareMark = '';
		if (share >= 0.06) {
			const at = radius * (hole > 0 ? (1 + hole) / 2 : 0.66);
			shareMark = `<text class="oi-plot-pie-share" x="${(cx + at * Math.sin(middle)).toFixed(1)}" y="${(cy - at * Math.cos(middle) + 4).toFixed(1)}" text-anchor="middle">${Math.round(share * 100)}%</text>`;
		}
		slice += `<g class="oi-plot-slice" data-slice="${index}" style="${shift}">${shape}${shareMark}</g>`;
		if (index < shownRow) {
			const y = legendTop + index * rowHeight + 14;
			const more = index === shownRow - 1 && entryList.length > shownRow;
			legend += more
				? `<text class="oi-plot-pie-value" x="${legendLeft}" y="${y}">and ${entryList.length - index} more</text>`
				: `<g class="oi-plot-pie-row" data-slice="${index}"><rect class="oi-plot-pie-hit" x="${legendLeft - 4}" y="${y - 14}" width="${legendRight - legendLeft + 8}" height="${rowHeight}" rx="4"/>` +
					`<rect x="${legendLeft}" y="${y - 10}" width="11" height="11" rx="2" fill="${color}"/>` +
					`<text class="oi-plot-pie-name" x="${legendLeft + 18}" y="${y}">${escapeHtml(entry.name)}</text>` +
					`<text class="oi-plot-pie-value" x="${legendRight - 48}" y="${y}" text-anchor="end">${escapeHtml(amount(entry.value))}</text>` +
					`<text class="oi-plot-pie-percent" x="${legendRight}" y="${y}" text-anchor="end">${shareText(share)}</text></g>`;
		}
		const lower = Math.cos(middle) < 0;
		sliceList.push({ label: `${entry.name} · ${amount(entry.value)} · ${shareText(share)}`, x: cx + (radius + 6) * Math.sin(middle), y: cy - (radius + 6) * Math.cos(middle), side: lower ? 'Below' : 'Above', color: resolve(colorList[index % colorList.length]!) });
		angle = next;
	});
	if (hole > 0) slice += `<text class="oi-plot-pie-total" x="${cx}" y="${cy + 5}" text-anchor="middle">${escapeHtml(amount(total))}</text>`;
	return { svg: `<svg class="oi-plot-svg oi-plot-pie" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pie chart">${slice}${legend}</svg>`, sliceList };
}

function cssEscape(text: string): string {
	return text.replace(/["\\]/g, '\\$&');
}

/** The style map written back as text (for tests and the 3D view). */
export function styleText(style: PropertyMap): string {
	return style.size ? formatInline(style) : '';
}

export const plotRenderer: Renderer = {
	mount(frame, block, context): RenderHandle {
		installStyle('plot', plotStyle);
		const view = new PlotView(frame, block, context);
		return {
			update(next, nextContext) {
				view.update(next, nextContext);
				return 'Done';
			},
			anchor: (name, toward) => view.anchor(name, toward),
			destroy: () => view.destroy(),
		};
	},
};
