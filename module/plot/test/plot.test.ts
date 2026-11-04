// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import { type MenuEntry, type TableSnapshot, colorPickerExtension, menuExtension } from '@octaether/core-sdk';
import { tableModule } from '@octaether/module-table';
import { textModule } from '@octaether/module-text';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plotModule } from '../src';
import { dateTickList, numberTickList } from '../src/axis';
import { fitTrend, trendText } from '../src/fit';
import { implicitMesh, multiply, orbitMatrix, perspective, project, surfaceMesh } from '../src/mesh';
import { parsePlot, splitStyle } from '../src/parse';
import { evaluateProgram, pointListOf, seriesOf } from '../src/program';
import { joinSegment, marchSquare, sampleFunction } from '../src/sample';
import { insertLine, removeLine, replaceSpan, setLine, setLineStyle, setSliderRange } from '../src/source';
import { toTex } from '../src/tex';

const view = { xMin: -10, xMax: 10, yMin: -5, yMax: 5, width: 400, height: 200 };

describe('reading a plot', () => {
	it('tells each line apart, as Desmos does', () => {
		const program = parsePlot(['y = a sin(x)', 'a = 1 {Slider: [0, 5, 0.5]}', 'f(x) = x^2', 'x^2 + y^2 = 4', 'y < f(x)', 'r = 1 + cos(θ)', '(cos t, sin t)', '(1, 2)', '(Date, Weight)', 'z = x y', '# a comment', 'mean([1, 2, 3])'].join('\n'));
		expect(program.problemList).toEqual([]);
		expect(program.itemList.map((item) => item.kind)).toEqual(['Explicit', 'Define', 'Function', 'Implicit', 'Implicit', 'Polar', 'Parametric', 'Point', 'Data', 'Explicit', 'Value']);
		expect(program.itemList[1]!.slider).toEqual({ min: 0, max: 5, step: 0.5 });
		expect(program.space).toBe(true);
	});

	it('gives plain numbers a slider and keeps where the number is', () => {
		const body = 'y = k x\nk = 2';
		const item = parsePlot(body).itemList[1]!;
		expect(item.slider).toBeDefined();
		expect(body.slice(item.valueSpan!.start, item.valueSpan!.end)).toBe('2');
	});

	it('reads a style at the end of a line, but not a piecewise', () => {
		expect(splitStyle('y = x {Color: Accent, Style: Dashed}').style.get('Style')).toBe('Dashed');
		expect(splitStyle('y = {x < 0: -x, x}').style.size).toBe(0);
	});

	it('names a point, whose name is its label, and reads functions in it', () => {
		const program = parsePlot('f(x) = x^2\nP = (2, f(2))');
		const point = program.itemList[1]!;
		expect(point.kind).toBe('Point');
		expect(point.name).toBe('P');
		expect(pointListOf(point, evaluateProgram(program, new Map(), new Map()))).toEqual([[2, 4]]);
		expect(parsePlot('C = (cos t, sin t)').itemList[0]!.kind).toBe('Parametric');
	});

	it('says where a mistake is', () => {
		const program = parsePlot('y = x\ny = 2 *');
		expect(program.problemList[0]!.line).toBe(1);
		expect(parsePlot('y = q x').problemList).toEqual([]);
	});
});

describe('sampling', () => {
	it('breaks tan at its asymptotes', () => {
		const lineList = sampleFunction(Math.tan, view, 'x');
		// tan crosses −10…10 in seven pieces
		expect(lineList.length).toBeGreaterThanOrEqual(6);
		expect(lineList.length).toBeLessThanOrEqual(8);
	});

	it('joins the pieces of a curve, so a dashed one dashes along it', () => {
		const square = { xMin: -3, xMax: 3, yMin: -3, yMax: 3, width: 300, height: 300 };
		const segmentList = marchSquare((x, y) => x * x + y * y - 4, square, 5);
		const lineList = joinSegment(segmentList);
		expect(lineList).toHaveLength(1);
		// a closed loop: back where it started
		const line = lineList[0]!;
		expect(line.length).toBeGreaterThan(200);
		expect(Math.hypot(line[0]! - line.at(-2)!, line[1]! - line.at(-1)!)).toBeLessThan(0.01);
	});

	it('finds a circle with marching squares', () => {
		const square = { xMin: -3, xMax: 3, yMin: -3, yMax: 3, width: 300, height: 300 };
		const segmentList = marchSquare((x, y) => x * x + y * y - 4, square, 5);
		expect(segmentList.length).toBeGreaterThan(40);
		for (let index = 0; index < segmentList.length; index += 2) {
			const x = (segmentList[index]! / 300) * 6 - 3;
			const y = 3 - (segmentList[index + 1]! / 300) * 6;
			expect(Math.hypot(x, y)).toBeCloseTo(2, 1);
		}
	});

	it('does not draw 1/x across its jump', () => {
		const segmentList = marchSquare((x, y) => y - 1 / x, view, 5);
		for (let index = 0; index < segmentList.length; index += 4) expect(Math.abs(segmentList[index + 1]! - segmentList[index + 3]!)).toBeLessThan(40);
	});
});

describe('axes', () => {
	it('puts ticks at nice numbers', () => {
		expect(numberTickList(-10, 10, 400).map((tick) => tick.label)).toEqual(['−10', '−5', '0', '5', '10']);
		expect(numberTickList(0, 1, 400).map((tick) => tick.value)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
	});

	it('puts date ticks at months', () => {
		const start = Date.UTC(2026, 0, 15) / 86_400_000;
		const end = Date.UTC(2026, 6, 15) / 86_400_000;
		expect(dateTickList(start, end, 600).map((tick) => tick.label)).toEqual(['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']);
	});
});

describe('trend lines', () => {
	it('fits a line and says how well', () => {
		const trend = fitTrend('Linear', [1, 2, 3, 4], [3, 5, 7, 9])!;
		expect(trend.coefficientList[0]).toBeCloseTo(2);
		expect(trend.coefficientList[1]).toBeCloseTo(1);
		expect(trend.r2).toBeCloseTo(1);
		expect(trendText(trend, false)).toBe('y = 2x + 1, R² = 1.00');
	});

	it('fits a quadratic and an exponential, even on dates', () => {
		const quadratic = fitTrend('Quadratic', [20000, 20001, 20002, 20003], [1, 2, 5, 10])!;
		expect(quadratic.at(20004)).toBeCloseTo(17);
		const exponential = fitTrend('Exponential', [0, 1, 2], [1, Math.E, Math.E ** 2])!;
		expect(exponential.coefficientList[0]).toBeCloseTo(1);
		expect(exponential.coefficientList[1]).toBeCloseTo(1);
	});
});

describe('working a plot out', () => {
	it('reads sliders (or what is being dragged) and functions of your own', () => {
		const program = parsePlot('f(x) = a x^2\na = 3\n(2, f(2))');
		expect(pointListOf(program.itemList[2]!, evaluateProgram(program, new Map(), new Map()))).toEqual([[2, 12]]);
		expect(pointListOf(program.itemList[2]!, evaluateProgram(program, new Map([['a', 1]]), new Map()))).toEqual([[2, 4]]);
	});

	it('turns table columns into a series, totals by month', () => {
		const day = (text: string): number => Date.parse(`${text}T00:00:00Z`) / 86_400_000;
		const snapshot: TableSnapshot = {
			rowCount: 3,
			columnList: [
				{ name: 'Date', type: 'Date', valueList: [day('2026-10-03'), day('2026-10-20'), day('2026-11-02')] },
				{ name: 'Amount', type: 'Number', valueList: [10, 5, 7] },
				{ name: 'Category', type: 'Choice', valueList: ['Food', 'Bus', 'Food'] },
			],
		};
		const program = parsePlot('(Date, Amount) {Kind: Bar, Group: Month, Combine: Sum}\n(Category, Amount)');
		const evaluated = evaluateProgram(program, new Map(), new Map([['Spending', snapshot]]), ['Spending']);
		const month = seriesOf(program.itemList[0]!, evaluated);
		expect(month.dateAxis).toBe(true);
		expect(month.yList).toEqual([15, 7]);
		const category = seriesOf(program.itemList[1]!, evaluated);
		expect(category.categoryList).toEqual(['Food', 'Bus']);
		expect(category.yList).toEqual([17, 5]);
	});
});

describe('3D geometry', () => {
	const box = { x: [-2, 2] as [number, number], y: [-2, 2] as [number, number], z: [-2, 2] as [number, number] };

	it('makes a surface of a function, leaving gaps out', () => {
		const mesh = surfaceMesh((x, y) => (x * y) / 4, box, 10);
		expect(mesh.vertexCount).toBe(10 * 10 * 6);
		const holed = surfaceMesh((x, y) => (x * x + y * y < 0.5 ? Number.NaN : 0), box, 10);
		expect(holed.vertexCount).toBeLessThan(600);
	});

	it('finds a sphere with marching tetrahedra', () => {
		const mesh = implicitMesh((x, y, z) => x * x + y * y + z * z - 1, box, 16);
		expect(mesh.vertexCount).toBeGreaterThan(300);
		for (let index = 0; index < mesh.vertexCount * 3; index += 3) {
			// box space is half the size: the unit sphere has radius 0.5 there
			expect(Math.hypot(mesh.position[index]!, mesh.position[index + 1]!, mesh.position[index + 2]!)).toBeCloseTo(0.5, 1);
		}
	});

	it('projects the middle of the box to the middle of the picture', () => {
		const matrix = multiply(perspective(0.6, 2, 0.1, 50), orbitMatrix(35, 25, 4));
		const spot = project(matrix, [0, 0, 0], 400, 200)!;
		expect(spot.x).toBeCloseTo(200);
		expect(spot.y).toBeCloseTo(100);
	});
});

describe('the Plot block', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mount(text: string) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		registry.add(plotModule, true);
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 50 && !document.querySelector('.oi-plot svg'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, root: document.querySelector<HTMLElement>('.oi-plot')! };
	}

	it('draws curves and lists the lines with their colors', async () => {
		const { root } = await mount('Plot:\n\ty = x^2\n\tmean([1, 2, 3])\n');
		expect(root.querySelectorAll('svg path[stroke]').length).toBeGreaterThan(0);
		const rowList = [...root.querySelectorAll('.oi-plot-row')].map((row) => row.textContent);
		expect(rowList).toEqual(['y = x^2', 'mean([1, 2, 3])= 2']);
	});

	it('writes a slider into the text when you let go', async () => {
		const { model, root } = await mount('Plot:\n\ty = a x\n\ta = 1 {Slider: [0, 4]}\n');
		const input = root.querySelector<HTMLInputElement>('.oi-plot-row-slider input[type="range"]')!;
		input.value = '2.5';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(model.document.itemList[0]!.body).toContain('a = 1 ');
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(model.document.itemList[0]!.body).toBe('y = a x\na = 2.5 {Slider: [0, 4]}');
	});

	it('draws a table’s column, and again when the table changes', async () => {
		const { model, root } = await mount('Table {Title: Gym log}:\n\tDate,Weight\n\t2026-11-01,72\n\t2026-11-02,71\n\nPlot {Data: Gym log}:\n\t(Date, Weight) {Kind: Scatter}\n');
		for (let tries = 0; tries < 50 && root.querySelectorAll('.oi-plot-svg circle').length < 2; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.oi-plot-svg circle').length).toBe(2);
		const table = model.document.itemList[0]!;
		model.setBody(table.key, 'Date,Weight\n2026-11-01,72\n2026-11-02,71\n2026-11-03,70.5');
		for (let tries = 0; tries < 50 && root.querySelectorAll('.oi-plot-svg circle').length < 3; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.oi-plot-svg circle').length).toBe(3);
	});

	it('marks a fixed plot as not interactive, and an interactive one as interactive', async () => {
		const { root } = await mount('Plot {Interactive: False}:\n\ty = x\n');
		expect(root.querySelector('.oi-plot-frame')!.hasAttribute('data-oi-interactive')).toBe(false);
		expect(root.querySelector('.oi-plot-tool')!.innerHTML).toBe('');
		document.body.innerHTML = '';
		const other = await mount('Plot:\n\ty = x\n');
		expect(other.root.querySelector('.oi-plot-frame')!.hasAttribute('data-oi-interactive')).toBe(true);
	});
});

describe('the list under a plot', () => {
	it('writes lines as TeX', () => {
		const tex = (text: string): string => toTex(parsePlot(text).itemList[0]!.node);
		expect(tex('y = a sin(b x)')).toBe('y = a\\,\\sin\\left(b\\,x\\right)');
		expect(tex('y = x^2 / 4 - 2')).toBe('y = \\frac{x^{2}}{4} - 2');
		expect(tex('r = 1 + cos(θ)')).toBe('r = 1 + \\cos \\theta');
		expect(tex('y = sqrt(x) + |x|')).toBe('y = \\sqrt{x} + \\left|x\\right|');
	});
});

describe('plots of tables, pies, colors, and sliders', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mountWith(text: string, picked?: string) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		registry.add(plotModule, true);
		registry.registerExtension(colorPickerExtension, { open: ({ onPick }: { onPick(color: string | undefined): void }) => onPick(picked), close: () => undefined });
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 60 && !document.querySelector('.oi-plot svg'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, root: document.querySelector<HTMLElement>('.oi-plot')! };
	}

	const table = 'Table {Title: Spending}:\n\tDate,Category,Amount\n\t2026-10-03,Food,10\n\t2026-10-20,Bus,5\n\t2026-11-02,Food,7\n\n';

	it('names the axes after the columns and says how they are combined; the list reads as words', async () => {
		const { root } = await mountWith(`${table}Plot {Data: Spending}:\n\t(Date, Amount) {Kind: Bar, Group: Month}\n`);
		for (let tries = 0; tries < 60 && root.querySelectorAll('svg rect[rx]').length < 2; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		const axis = [...root.querySelectorAll('.oi-plot-axis-name')].map((element) => element.textContent);
		expect(axis).toEqual(['Date', 'Amount (sum by month)']);
		expect(root.querySelector('.oi-plot-row')!.textContent).toBe('Amount by Datebar, sum by month');
		expect(root.querySelector('.oi-plot-row')!.textContent).not.toContain('(Date');
	});

	it('draws a pie by category, with shares', async () => {
		const { root } = await mountWith(`${table}Plot {Data: Spending}:\n\t(Category, Amount) {Kind: Pie}\n`);
		for (let tries = 0; tries < 60 && !root.querySelector('.oi-plot-pie path'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect(root.querySelectorAll('.oi-plot-pie path')).toHaveLength(2);
		expect([...root.querySelectorAll('.oi-plot-pie-share')].map((element) => element.textContent)).toEqual(['77%', '23%']);
	});

	it('gives a pie a legend with shares, lights a slice on a click, and has no zoom', async () => {
		const { root } = await mountWith(`${table}Plot {Data: Spending}:\n\t(Category, Amount) {Kind: Pie}\n`);
		for (let tries = 0; tries < 60 && !root.querySelector('.oi-plot-pie path'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect([...root.querySelectorAll('.oi-plot-pie-percent')].map((element) => element.textContent)).toEqual(['77%', '23%']);
		expect(root.querySelector('[data-action="ZoomIn"]')).toBeNull();
		const slice = root.querySelector('.oi-plot-slice[data-slice="1"] path')!;
		slice.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
		expect(root.querySelector('.oi-plot-pie')!.hasAttribute('data-active')).toBe(true);
		expect(root.querySelector('.oi-plot-slice[data-slice="1"]')!.hasAttribute('data-on')).toBe(true);
		expect(root.querySelector('.oi-plot-hover-label')!.textContent).toBe('Bus · 5 · 23%');
		// a click elsewhere lets it go
		root.querySelector('.oi-plot-pie')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
		expect(root.querySelector('.oi-plot-pie')!.hasAttribute('data-active')).toBe(false);
	});

	it('lights a bar under the pointer, with its value', async () => {
		const { root } = await mountWith(`${table}Plot {Data: Spending}:\n\t(Category, Amount) {Kind: Bar}\n`);
		for (let tries = 0; tries < 60 && root.querySelectorAll('rect[data-bar]').length < 2; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		const bar = root.querySelector<SVGRectElement>('rect[data-bar="0"]')!;
		const x = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
		root.querySelector('.oi-plot-stage')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: 5 }));
		expect(bar.hasAttribute('data-on')).toBe(true);
		expect(root.querySelector('.oi-plot-hover-label')!.textContent).toBe('Food · 17');
		expect(root.querySelector('.oi-plot-hover-dot')).toBeNull();
	});

	it('sets a line’s color from its dot', async () => {
		const { model, root } = await mountWith('Plot:\n\ty = x {Width: 3}\n\ty = 2x\n', '#c0643c');
		(root.querySelector('button.oi-plot-dot[data-dot="0"]') as HTMLElement).click();
		expect(model.document.itemList[0]!.body).toBe('y = x {Width: 3, Color: #c0643c}\ny = 2x');
		// and it reads back as that color
		expect(parsePlot(model.document.itemList[0]!.body).itemList[0]!.style.get('Color')).toBe('#c0643c');
	});

	it('plays a slider: it moves however small each frame’s step', async () => {
		const original = globalThis.requestAnimationFrame;
		let time = 0;
		const queue: FrameRequestCallback[] = [];
		globalThis.requestAnimationFrame = (callback) => queue.push(callback);
		vi.spyOn(performance, 'now').mockImplementation(() => time);
		try {
			const { root } = await mountWith('Plot:\n\ty = a x\n\ta = 0 {Slider: [0, 10, 1]}\n');
			(root.querySelector('[data-action="Play"]') as HTMLElement).click();
			for (let frame = 0; frame < 120; frame++) {
				time += 16;
				queue.splice(0).forEach((callback) => callback(time));
			}
			expect(Number(root.querySelector('.oi-plot-slider-value')!.textContent)).toBeGreaterThan(3);
		} finally {
			globalThis.requestAnimationFrame = original;
			vi.restoreAllMocks();
		}
	});
});

describe('the data layer: edits of the text', () => {
	it('sets, inserts, and removes lines, and a line’s style', () => {
		expect(setLine('a\nb', 1, 'c')).toBe('a\nc');
		expect(insertLine('a\nb', 0, 'x')).toBe('a\nx\nb');
		expect(insertLine('', -1, 'x')).toBe('x');
		expect(removeLine('a\nb\nc', 1)).toBe('a\nc');
		expect(setLineStyle('y = x {Width: 3}', 0, 'Width', undefined)).toBe('y = x');
		expect(setSliderRange('a = 1', 0, 5, 0, 0.5)).toBe('a = 1 {Slider: [0, 5, 0.5]}');
		expect(setSliderRange('a = 1 {Slider: [0, 5, 0.5]}', 0, -2, 2, undefined)).toBe('a = 1 {Slider: [-2, 2]}');
		expect(replaceSpan('(1, 2)', [{ start: 1, end: 2, text: '3.5' }, { start: 4, end: 5, text: '-1' }])).toBe('(3.5, -1)');
	});
});

describe('the editing layer', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mountPlot(text: string, menu?: unknown) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		registry.add(plotModule, true);
		if (menu) registry.registerExtension(menuExtension, menu);
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 60 && !document.querySelector('.oi-plot svg'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, root: document.querySelector<HTMLElement>('.oi-plot')! };
	}
	const key = (element: Element, value: string): void => {
		element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
	};

	it('edits a line in place; Enter writes it and starts a new line below', async () => {
		const { model, root } = await mountPlot('Plot:\n\ty = x\n');
		(root.querySelector('.oi-plot-row[data-line="0"]') as HTMLElement).click();
		const input = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		expect(input.value).toBe('y = x');
		input.value = 'y = x^2';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		// drawn already, written only on Enter
		expect(model.document.itemList[0]!.body).toBe('y = x');
		key(input, 'Enter');
		expect(model.document.itemList[0]!.body).toBe('y = x^2');
		const next = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		expect(next.dataset.line).toBe('1');
		next.value = 'a = 2';
		key(next, 'Enter');
		expect(model.document.itemList[0]!.body).toBe('y = x^2\na = 2');
		// an empty new line goes away on Escape
		key(root.querySelector('input[data-field="line"]')!, 'Escape');
		expect(root.querySelector('input[data-field="line"]')).toBeNull();
		expect(model.document.itemList[0]!.body).toBe('y = x^2\na = 2');
	});

	it('adds a line from the button, and an emptied line goes', async () => {
		const { model, root } = await mountPlot('Plot:\n\ty = x\n\ty = 2x\n');
		(root.querySelector('[data-action="AddMenu"]') as HTMLElement).click();
		const input = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		input.value = '(1, 2)';
		key(input, 'Escape');
		expect(model.document.itemList[0]!.body).toBe('y = x\ny = 2x');
		(root.querySelector('.oi-plot-row[data-line="1"]') as HTMLElement).click();
		const second = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		second.value = '';
		key(second, 'Backspace');
		expect(model.document.itemList[0]!.body).toBe('y = x');
	});

	it('types a slider’s value, and its range and step', async () => {
		const { model, root } = await mountPlot('Plot:\n\ty = a x\n\ta = 1 {Slider: [0, 4]}\n');
		(root.querySelector('[data-action="EditValue"]') as HTMLElement).click();
		const value = root.querySelector<HTMLInputElement>('input[data-field="value"]')!;
		value.value = '6';
		key(value, 'Enter');
		// beyond the range: the range grows to hold it
		expect(model.document.itemList[0]!.body).toBe('y = a x\na = 6 {Slider: [0, 6]}');
		(root.querySelector('[data-action="EditRange"]') as HTMLElement).click();
		const row = root.querySelector('.oi-plot-range')!;
		row.querySelector<HTMLInputElement>('[data-field="min"]')!.value = '-10';
		row.querySelector<HTMLInputElement>('[data-field="max"]')!.value = '10';
		row.querySelector<HTMLInputElement>('[data-field="step"]')!.value = '0.5';
		key(row.querySelector('[data-field="step"]')!, 'Enter');
		expect(model.document.itemList[0]!.body).toBe('y = a x\na = 6 {Slider: [-10, 10, 0.5]}');
	});

	it('offers a line’s options in its menu: dashed, hidden, deleted', async () => {
		const opened: MenuEntry[][] = [];
		const { model, root } = await mountPlot('Plot:\n\tx^2 + y^2 = 9\n\ty = x\n', { open: ({ itemList }: { itemList: MenuEntry[] }) => opened.push(itemList), close: () => undefined, prompt: async () => 'Circle' });
		const pick = (title: string, child?: string): void => {
			const entry = opened.at(-1)!.find((item) => item.title === title)!;
			(child ? entry.childList!.find((item) => item.title === child)! : entry).run!();
		};
		(root.querySelector('[data-more="0"]') as HTMLElement).click();
		pick('Line', 'Dashed');
		expect(model.document.itemList[0]!.body).toBe('x^2 + y^2 = 9 {Style: Dashed}\ny = x');
		(root.querySelector('[data-more="0"]') as HTMLElement).click();
		pick('Hide');
		expect(model.document.itemList[0]!.body).toBe('x^2 + y^2 = 9 {Style: Dashed, Hidden: True}\ny = x');
		(root.querySelector('[data-more="0"]') as HTMLElement).click();
		pick('Label');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(model.document.itemList[0]!.body).toContain('Label: Circle');
		(root.querySelector('[data-more="1"]') as HTMLElement).click();
		pick('Delete');
		expect(model.document.itemList[0]!.body).not.toContain('y = x');
	});

	it('adds from a menu of what can be added, also by typing /', async () => {
		const opened: MenuEntry[][] = [];
		const { model, root } = await mountPlot('Plot:\n\ty = x\n', { open: ({ itemList }: { itemList: MenuEntry[] }) => opened.push(itemList), close: () => undefined, prompt: async () => undefined });
		(root.querySelector('[data-action="AddMenu"]') as HTMLElement).click();
		const titleList = opened.at(-1)!.map((item) => item.title);
		expect(titleList).toEqual(expect.arrayContaining(['Function', 'Number with a slider', 'Point', 'Curve in x and y', 'Chart a table']));
		opened.at(-1)!.find((item) => item.title === 'Point')!.run!();
		const input = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		expect(input.value).toBe('P = (1, 2)');
		key(input, 'Enter');
		expect(model.document.itemList[0]!.body).toBe('y = x\nP = (1, 2)');
		// a lone / on the new line opens the same menu
		const next = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		next.value = '/';
		next.dispatchEvent(new Event('input', { bubbles: true }));
		opened.at(-1)!.find((item) => item.title === 'Number with a slider')!.run!();
		const typed = root.querySelector<HTMLInputElement>('input[data-field="line"]')!;
		expect(typed.value).toBe('a = 1');
		key(typed, 'Escape');
		expect(model.document.itemList[0]!.body).toBe('y = x\nP = (1, 2)');
	});

	it('marks the block broken only for a real mistake (not while a line is typed)', async () => {
		const { root } = await mountPlot('Plot:\n\ty = x\n');
		(root.querySelector('.oi-plot-row[data-line="0"]') as HTMLElement).click();
		expect(root.querySelector('[data-oi-problem]')).toBeNull();
	});

	it('reads a table by its title, by bare column names, with units on the axes', async () => {
		const { root } = await mountPlot('Table {Title: Gym log, Column: {Weight: {Unit: kg}}}:\n\tDate,Weight\n\t2026-11-01,72\n\t2026-11-02,71\n\nPlot {Data: Gym log}:\n\t(Date, Weight) {Kind: Line}\n');
		for (let tries = 0; tries < 60 && root.querySelectorAll('.oi-plot-axis-name').length < 2; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect([...root.querySelectorAll('.oi-plot-axis-name')].map((element) => element.textContent)).toEqual(['Date', 'Weight (kg)']);
		expect(root.querySelector('.oi-plot-row')!.textContent).toContain('Weight by Date');
	});
});
