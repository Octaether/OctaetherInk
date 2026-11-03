// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { type HostService, Registry, RenderHost, ThemeRegistry, readLayout, themeContext } from '@octaether/core-render';
import { chemModule } from '@octaether/module-chem';
import { textModule } from '@octaether/module-text';
import { describe, expect, it } from 'vitest';
import { layoutModule } from '@octaether/module-layout';
import { arrowCurve, arrowLabelPlace, arrowMarkup, autoCurve, bezierPoint, boardModule, curveForOffset, nearestOnArrow, readAt, readKind, toPx } from '../src';

function mount(text: string): { host: RenderHost; model: NoteModel; root: HTMLElement } {
	const registry = new Registry();
	const themeRegistry = new ThemeRegistry();
	for (const module of [textModule, layoutModule, boardModule, chemModule]) registry.add(module);
	const service: HostService = {
		registerCommand: () => () => {},
		registerTheme: (theme) => themeRegistry.register(theme),
		setting: () => undefined,
		theme: () => themeContext(themeRegistry.current()),
		applyTheme: (name) => void themeRegistry.apply(name),
		themeList: () => themeRegistry.list(),
	};
	registry.attach(service);
	const root = document.createElement('div');
	document.body.append(root);
	const host = new RenderHost(root, registry, themeRegistry);
	const model = NoteModel.fromText(text, registry.formatOption());
	host.mount(model);
	return { host, model, root };
}

describe('arrow geometry', () => {
	it('draws straight between two points, and a curve that bows left for a positive Curve', () => {
		const straight = arrowCurve({ x: 0, y: 0 }, { x: 90, y: 0 }, 0, 16);
		expect(bezierPoint(straight, 0.5)).toEqual({ x: 45, y: 0 });
		const left = arrowCurve({ x: 0, y: 0 }, { x: 90, y: 0 }, 45, 16);
		// going right, left is up on screen (y down)
		expect(bezierPoint(left, 0.5).y).toBeLessThan(-10);
		expect(bezierPoint(arrowCurve({ x: 0, y: 0 }, { x: 90, y: 0 }, -45, 16), 0.5).y).toBeGreaterThan(10);
	});

	it('turns a handle dragged off the middle back into the Curve that puts the middle there', () => {
		for (const curve of [-60, -20, 15, 50]) {
			const shape = arrowCurve({ x: 10, y: 20 }, { x: 130, y: 60 }, curve, 16);
			const middle = bezierPoint(shape, 0.5);
			const chordMiddle = { x: 70, y: 40 };
			const length = Math.hypot(120, 40);
			const offset = (middle.x - chordMiddle.x) * (40 / length) + (middle.y - chordMiddle.y) * (-120 / length);
			expect(Math.abs(curveForOffset({ x: 10, y: 20 }, { x: 130, y: 60 }, offset, 16) - curve)).toBeLessThanOrEqual(1);
		}
	});

	it('bows away from what is around it', () => {
		// a crowd below the line: the arrow bows up (left of going right)
		expect(autoCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: 50, y: 40 }], 16)).toBe(45);
		expect(autoCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: 50, y: -40 }], 16)).toBe(-45);
	});

	it('draws each kind, and puts text above and below the middle', () => {
		const shape = arrowCurve({ x: 0, y: 0 }, { x: 80, y: 0 }, 0, 16);
		const count = (markup: string, tag: string): number => markup.split(`<${tag}`).length - 1;
		expect(count(arrowMarkup(shape, { kind: 'Single', head: 'End', size: 16 }), 'polygon')).toBe(1);
		expect(count(arrowMarkup(shape, { kind: 'Single', head: 'Both', size: 16 }), 'polygon')).toBe(2);
		expect(count(arrowMarkup(shape, { kind: 'Equilibrium', head: 'End', size: 16 }), 'line')).toBe(2);
		expect(count(arrowMarkup(shape, { kind: 'Line', head: 'End', size: 16 }), 'polygon')).toBe(0);
		expect(arrowMarkup(shape, { kind: 'NoReaction', head: 'End', size: 16 })).toContain('<line');
		expect(arrowMarkup(shape, { kind: 'Single', head: 'End', size: 16, dash: 'Dashed' })).toContain('stroke-dasharray');
		expect(readKind('Fishhook')).toBe('Fishhook');
		expect(readKind('Nonsense')).toBe('Single');
		const above = arrowLabelPlace(shape, 'Above', 16);
		const below = arrowLabelPlace(shape, 'Below', 16);
		expect(above.point.y).toBeLessThan(0);
		expect(above.translate).toBe('translate(-50%, -100%)');
		expect(below.point.y).toBeGreaterThan(0);
		expect(below.translate).toBe('translate(-50%, 0)');
	});

	it('reads lengths as px', () => {
		expect(toPx(12, 16)).toBe(12);
		expect(toPx('2em', 16)).toBe(32);
		expect(toPx('10px', 16)).toBe(10);
		expect(toPx('wide', 16)).toBeUndefined();
	});
});

describe('Board', () => {
	it('places its blocks by X and Y, from its own top left, and draws its arrows', () => {
		// a blank line between text blocks, or they are one paragraph
		const { root } = mount('Board:\n\tFirst {X: 40, Y: 30}\n\n\tSecond {X: -20, Y: 100}\n\tArrow {X: 0, Y: 0, Length: 60}:\n\t\tslow {Side: Below}\n');
		const area = root.querySelector<HTMLElement>('.oi-board-area')!;
		expect(area).not.toBeNull();
		const [first, second, arrow] = [...area.children] as HTMLElement[];
		// everything moves so the leftmost thing is at 0: the second block was at x -20
		expect(second!.style.left).toBe('0px');
		expect(first!.style.left).toBe('60px');
		expect(first!.style.top).toBe(`${30 - Number.parseFloat(area.dataset.oiShiftY!)}px`);
		expect(arrow!.querySelector('svg.oi-arrow-svg .oi-arrow-shape')).not.toBeNull();
		const label = arrow!.querySelector<HTMLElement>(':scope > .oi-child > .oi-frame')!;
		expect(label.dataset.oiSide).toBe('Below');
		expect(label.style.transform).toBe('translate(-50%, 0)');
	});

	it('holds Boards, says when an arrow can not be drawn, and offers its editor', () => {
		const { root } = mount('Board:\n\tBoard {X: 10, Y: 10}:\n\t\tInside {X: 5, Y: 5}\n\tArrow {From: nowhere, To: neither}:\n');
		expect(root.querySelectorAll('.oi-board-area')).toHaveLength(2);
		const arrow = root.querySelector<HTMLElement>('.oi-frame[data-oi-type="Arrow"]')!;
		expect(arrow.dataset.oiProblem).toContain('From and To');
		// the Chem module gives the Board its editor
		expect(root.querySelector('.oi-board-edit')?.textContent).toBe('Edit board');
	});

	it('redraws when text inside one of its arrows changes', () => {
		const { root, model } = mount('Board:\n\tArrow {X: 0, Y: 0, Length: 60}:\n\t\tslow {Side: Above}\n');
		const arrow = model.document.itemList[0]!.childList[0]!;
		const label = arrow.childList[0]!;
		model.setProperty(label.key, 'Side', 'Below');
		const frame = root.querySelector<HTMLElement>('.oi-frame[data-oi-type="Arrow"] > .oi-child > .oi-frame')!;
		expect(frame.dataset.oiSide).toBe('Below');
		expect(frame.style.transform).toBe('translate(-50%, 0)');
	});

	it('can be a whole note: Layout takes a block header', () => {
		expect(readLayout('Board {Arrange: Free}')).toEqual({ type: 'Board', property: new Map([['Arrange', 'Free']]) });
		expect(readLayout('Flow')).toEqual({ type: 'Flow', property: new Map() });
		expect(readLayout(undefined).type).toBe('Flow');
		const { root } = mount('---\nLayout: Board {Arrange: Free}\n---\n\nHello {X: 30, Y: 40}\n');
		expect(root.classList.contains('oi-board-area')).toBe(true);
	});
});

describe('arrow text along the arrow', () => {
	it('puts text at its At, finds the nearest point and side, and reads At safely', () => {
		const shape = arrowCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 16);
		expect(arrowLabelPlace(shape, 'Above', 16, 0.25).point.x).toBeCloseTo(25);
		// stacked: further out on the same side
		expect(arrowLabelPlace(shape, 'Above', 16, 0.5, 20).point.y).toBeLessThan(arrowLabelPlace(shape, 'Above', 16, 0.5).point.y);
		const near = nearestOnArrow(shape, { x: 80, y: 12 }, 16);
		expect(near.at).toBeCloseTo(0.8, 1);
		expect(near.distance).toBeCloseTo(12, 0);
		expect(near.side).toBe('Below');
		expect(nearestOnArrow(shape, { x: 30, y: -5 }, 16).side).toBe('Above');
		expect(readAt(2)).toBe(1);
		expect(readAt('x')).toBe(0.5);
	});

	it('marks each block in an arrow with its At', () => {
		const { root } = mount('Board:\n\tArrow {X: 0, Y: 0, Length: 60}:\n\t\tText {At: 0.2}: fast\n\n\t\tslow\n');
		const [fast, slow] = [...root.querySelectorAll<HTMLElement>('.oi-frame[data-oi-type="Arrow"] > .oi-child > .oi-frame')];
		expect(fast!.dataset.oiAt).toBe('0.2');
		expect(slow!.dataset.oiAt).toBe('0.5');
	});
});

describe('Masonry', () => {
	/** happy-dom lays nothing out: each card's height comes from its text's length. */
	function stubHeight(): () => void {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
		Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
			configurable: true,
			get(this: HTMLElement) {
				return this.classList.contains('oi-frame') ? (this.textContent?.length ?? 0) * 10 : 0;
			},
		});
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 500 });
		return () => {
			Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor);
			delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
		};
	}

	it('puts each card in the shortest column, in order, and grows to the tallest', () => {
		const restore = stubHeight();
		try {
			// 500px wide, columns of 150px with 10px gaps: three columns of 160px
			const { root } = mount('Board {Arrange: Masonry, ColumnWidth: 150, Gap: 10}:\n\taaaaaaaaaa\n\n\tbb\n\n\tccccc\n\n\td\n\n\te\n');
			const area = root.querySelector<HTMLElement>('.oi-masonry')!;
			expect(area).not.toBeNull();
			expect(area.classList.contains('oi-board-area')).toBe(false);
			const cardList = [...area.children] as HTMLElement[];
			expect(cardList.map((card) => card.dataset.oiColumn)).toEqual(['0', '1', '2', '1', '1']);
			expect(cardList[0]!.style.width).toBe(`${(500 - 20) / 3}px`);
			// d goes under bb (20 + 10 gap), e under d
			expect(cardList[3]!.style.top).toBe('30px');
			expect(cardList[4]!.style.top).toBe('50px');
			expect(area.style.height).toBe('100px');
		} finally {
			restore();
		}
	});

	it('is a page too, and a page switched back to Flow starts clean', () => {
		const restore = stubHeight();
		try {
			const { root, model } = mount('---\nLayout: Board {Arrange: Masonry}\n---\n\nOne\n\nTwo\n');
			expect(root.classList.contains('oi-masonry')).toBe(true);
			expect(root.style.height).not.toBe('');
			model.setNoteProperty('Layout', undefined);
			expect(root.classList.contains('oi-masonry')).toBe(false);
			expect(root.style.height).toBe('');
			const frame = root.querySelector<HTMLElement>(':scope > .oi-frame')!;
			expect(frame.style.left).toBe('');
			expect(frame.style.width).toBe('');
		} finally {
			restore();
		}
	});
});
