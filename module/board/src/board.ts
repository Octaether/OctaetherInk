// Board: a block that holds blocks and places each one where its X and Y say (px from the Board's top
// left; negative is fine, the Board grows to hold everything), or next to a named point:
//
//   Board:
//   	Chem {X: 0, Y: 0}: O@o^-:3
//   	Chem {X: 120, Y: -10}: C@c (-100 H) (<215 H) (<:250 H) -0@cb Br@br
//   	Arrow {From: o.lp, To: c}                          ← between named points of other blocks
//   	Text {Near: c, Side: Below, Gap: 6}: backside attack
//   	Arrow {X: 0, Y: 200, Length: 90}:                  ← or from a point, `Angle` degrees (0 = right)
//   		Text {Side: Below}: slow                         ← blocks inside an arrow sit along it
//
// Named points come from the blocks themselves (RenderHandle.anchor: Chem names atoms, lone pairs,
// and bonds); `^id.north` (east, south, west, center, or degrees) is a point on any block's box, and
// `a!0.5!b` a point between two names. A Board wider than its column shrinks to fit. Boards hold Boards.
//
// `Board {Arrange: Masonry}` is a Pinterest-style wall instead: its blocks are cards in columns about
// `ColumnWidth` wide (15em) with `Gap` between them (12px), each card going to the shortest column, in
// order. A whole note can be one: `Layout: Board {Arrange: Masonry}`.

import type { BlockNode, PropertyValue } from '@octaether/core-format';
import { type BlockTypeDefinition, type BoardEditor, type BoardItem, type ChildFrame, type LayoutContext, type RenderContext, type ResolvedBlock, boardEditorExtension } from '@octaether/core-sdk';
import { type ArrowCurve, type Point, arrowCurve, arrowLabelPlace, arrowMarkup, autoCurve, bezierPoint, readAt, readHead, readKind, sampleCurve } from './arrow';

export const boardStyle = `
.oi-board-area { position: relative; margin: 0.4em auto 0; gap: 0; display: block; }
.oi-board-area > .oi-frame { position: absolute; width: max-content; max-width: 28em; margin: 0; }
.oi-board-area > .oi-frame[data-oi-editing] { min-width: 18em; z-index: 5; }
.oi-board-area > .oi-frame .oi-chem { padding: 0; overflow: visible; }
.oi-board-area > .oi-frame[data-oi-type="Arrow"] { pointer-events: none; max-width: none; }
.oi-frame[data-oi-type="Arrow"] > .oi-child { display: block; margin: 0; position: static; }
.oi-frame[data-oi-type="Arrow"] > .oi-child > .oi-frame { position: absolute; width: max-content; max-width: 16em; pointer-events: auto; font-size: 0.85em; line-height: 1.3; text-align: center; }
.oi-arrow-svg { position: absolute; left: 0; top: 0; overflow: visible; }
.oi-arrow-svg .oi-arrow-shape > * { pointer-events: visibleStroke; }
.oi-arrow-alone { display: block; overflow: visible; }
.oi-board-head { min-height: 0; }
.oi-board-empty { color: var(--oi-color-text-muted); margin: 0; }
.oi-board-edit { position: absolute; top: 2px; inset-inline-end: 2px; z-index: 6; height: 24px; padding: 0 8px; font: 500 12px/1 var(--oi-font-body); color: var(--oi-color-text-muted); background: var(--oi-color-background); border: 1px solid var(--oi-color-border); border-radius: 6px; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
.oi-frame:hover > .oi-content > .oi-board-head > .oi-board-edit, .oi-board-empty + .oi-board-edit { opacity: 1; }
.oi-board-edit:hover { color: var(--oi-color-accent); border-color: var(--oi-color-accent); }
.oi-read-only .oi-board-edit, .oi-frame[data-oi-editing] > .oi-content .oi-board-edit { display: none; }
@media (hover: none) { .oi-board-edit { opacity: 1; } }
.oi-masonry { position: relative; display: block; margin-top: 0.4em; }
.oi-masonry > .oi-frame { position: absolute; box-sizing: border-box; margin: 0; padding: 0.6em 0.8em; background: var(--oi-color-surface1); border: 1px solid var(--oi-color-border); border-radius: 10px; overflow: hidden; }
.oi-masonry > .oi-frame > .oi-content > :first-child { margin-top: 0; }
.oi-masonry > .oi-frame > .oi-content > :last-child { margin-bottom: 0; }
.oi-masonry > .oi-frame img { max-width: 100%; border-radius: 6px; }
`;

/** A length → px: a number is px; em, px, mm, cm, and pt are read; anything else is 0. */
export function toPx(value: PropertyValue | undefined, emPx: number): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return undefined;
	const match = /^\s*(-?\d+(?:\.\d+)?)\s*(px|em|mm|cm|pt)?\s*$/.exec(value);
	if (!match) return undefined;
	const factor = { px: 1, em: emPx, mm: 96 / 25.4, cm: 96 / 2.54, pt: 96 / 72 }[(match[2] ?? 'px') as 'px'];
	return Number(match[1]) * factor;
}

/** An arrow end: a named point, or `[x, y]` in px. */
function readEnd(value: PropertyValue | undefined): { name: string } | { point: Point } | undefined {
	if (typeof value === 'string' && value.trim() !== '') return { name: value.trim() };
	if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return { point: { x: value[0], y: value[1] } };
	return undefined;
}

const sideDirection: Readonly<Record<string, Point>> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } };

interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function grow(box: Box, x: number, y: number): void {
	box.minX = Math.min(box.minX, x);
	box.minY = Math.min(box.minY, y);
	box.maxX = Math.max(box.maxX, x);
	box.maxY = Math.max(box.maxY, y);
}

/** Lays a Board out: blocks at X/Y or next to a name, then the arrows, then the size and the fit. */
function layoutBoard(area: HTMLElement, container: ResolvedBlock, childList: readonly ChildFrame[], context: LayoutContext, root: boolean): void {
	area.classList.add('oi-board-area');
	area.style.zoom = '';
	const emPx = Number.parseFloat(getComputedStyle(area).fontSize) || 16;
	const blockList = childList.filter((child) => child.type !== 'Arrow');
	const arrowList = childList.filter((child) => child.type === 'Arrow');
	// where each block was put (offsetLeft rounds to whole px, so the Board keeps its own numbers)
	const placeMap = new Map<HTMLElement, Point>();
	const place = (element: HTMLElement, x: number, y: number): void => {
		placeMap.set(element, { x, y });
		element.style.left = `${x}px`;
		element.style.top = `${y}px`;
	};
	// first every block at its X/Y (blocks placed next to a name wait for the names to be known)
	const nearList: ChildFrame[] = [];
	for (const child of blockList) {
		if (typeof child.property.get('Near') === 'string' && !child.property.has('X')) {
			nearList.push(child);
			place(child.element, 0, 0);
		} else place(child.element, toPx(child.property.get('X'), emPx) ?? 0, toPx(child.property.get('Y'), emPx) ?? 0);
	}
	const areaRect = area.getBoundingClientRect();
	const toArea = (point: Point): Point => ({ x: point.x - areaRect.left, y: point.y - areaRect.top });
	const toScreen = (point: Point): Point => ({ x: point.x + areaRect.left, y: point.y + areaRect.top });
	const boxOf = (element: HTMLElement): Box => {
		const at = placeMap.get(element) ?? { x: 0, y: 0 };
		return { minX: at.x, minY: at.y, maxX: at.x + element.offsetWidth, maxY: at.y + element.offsetHeight };
	};
	/** A named point in the Board's own px, moved to the edge facing `toward`. */
	const resolve = (name: string, toward?: Point, depth = 0): Point | undefined => {
		if (depth > 4) return undefined;
		const between = /^\(?\s*(.+?)\s*\)?\s*!\s*(-?\d+(?:\.\d+)?)\s*!\s*\(?\s*(.+?)\s*\)?$/.exec(name);
		if (between) {
			const from = resolve(between[1]!, undefined, depth + 1);
			const to = resolve(between[3]!, undefined, depth + 1);
			const share = Number(between[2]);
			return from && to ? { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share } : undefined;
		}
		if (name.startsWith('^')) {
			const [id, side = 'center'] = name.slice(1).split('.');
			const child = childList.find((item) => item.id === id);
			if (!child) return undefined;
			const box = boxOf(child.element);
			const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
			if (side === 'center') return center;
			const degree = Number(side);
			const direction = sideDirection[side] ?? (Number.isFinite(degree) ? { x: Math.cos((degree * Math.PI) / 180), y: -Math.sin((degree * Math.PI) / 180) } : undefined);
			if (!direction) return undefined;
			// where the ray from the centre leaves the box
			const reach = Math.min(Math.abs(direction.x) > 1e-6 ? (box.maxX - box.minX) / 2 / Math.abs(direction.x) : Infinity, Math.abs(direction.y) > 1e-6 ? (box.maxY - box.minY) / 2 / Math.abs(direction.y) : Infinity);
			return { x: center.x + direction.x * reach, y: center.y + direction.y * reach };
		}
		for (const child of blockList) {
			const point = child.anchor(name, toward ? toScreen(toward) : undefined);
			if (point) return toArea(point);
		}
		return undefined;
	};
	// blocks next to a name: their near edge at the name, on the chosen side
	for (const child of nearList) {
		const side = String(child.property.get('Side') ?? 'Below');
		const gap = toPx(child.property.get('Gap'), emPx) ?? 6;
		const center = resolve(String(child.property.get('Near')));
		if (!center) {
			child.element.dataset.oiProblem = `unknown name "${String(child.property.get('Near'))}"`;
			continue;
		}
		delete child.element.dataset.oiProblem;
		const direction = sideDirection[{ Above: 'north', Below: 'south', Left: 'west', Right: 'east' }[side] ?? ''] ?? { x: 0, y: 0 };
		const edge = side === 'Center' ? center : (resolve(String(child.property.get('Near')), { x: center.x + direction.x * 1000, y: center.y + direction.y * 1000 }) ?? center);
		const width = child.element.offsetWidth;
		const height = child.element.offsetHeight;
		const x = side === 'Left' ? edge.x - gap - width : side === 'Right' ? edge.x + gap : edge.x - width / 2;
		const y = side === 'Above' ? edge.y - gap - height : side === 'Below' ? edge.y + gap : edge.y - height / 2;
		place(child.element, x, y);
	}
	const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const child of blockList) {
		const childBox = boxOf(child.element);
		grow(box, childBox.minX, childBox.minY);
		grow(box, childBox.maxX, childBox.maxY);
	}
	// arrows: between named points (bowing away from the blocks around) or from a point
	const crowdList = blockList.map((child) => {
		const childBox = boxOf(child.element);
		return { x: (childBox.minX + childBox.maxX) / 2, y: (childBox.minY + childBox.maxY) / 2 };
	});
	const drawnList: { child: ChildFrame; curve: ArrowCurve; box: Box }[] = [];
	for (const child of arrowList) {
		const property = child.property;
		const fromEnd = readEnd(property.get('From'));
		const toEnd = readEnd(property.get('To'));
		const kind = readKind(property.get('Kind'));
		const startPoint = property.has('X') || property.has('Y') ? { x: toPx(property.get('X'), emPx) ?? 0, y: toPx(property.get('Y'), emPx) ?? 0 } : undefined;
		const centerOf = (end: ReturnType<typeof readEnd>): Point | undefined => (end ? ('point' in end ? end.point : resolve(end.name)) : undefined);
		const from = centerOf(fromEnd) ?? startPoint;
		let to = centerOf(toEnd);
		if (from && !to && !toEnd) {
			const length = toPx(property.get('Length'), emPx) ?? 3.2 * emPx;
			const angle = (Number(property.get('Angle') ?? 0) * Math.PI) / 180;
			to = { x: from.x + Math.cos(angle) * length, y: from.y - Math.sin(angle) * length };
		}
		if (!from || !to) {
			child.element.dataset.oiProblem = 'an arrow needs From and To (names or [x, y]), or X and Y';
			child.element.style.display = 'none';
			continue;
		}
		delete child.element.dataset.oiProblem;
		child.element.style.display = '';
		const given = property.get('Curve');
		const straight = kind === 'Equilibrium' || kind === 'Retro';
		const bothNamed = fromEnd !== undefined && 'name' in fromEnd && toEnd !== undefined && 'name' in toEnd;
		const curveDegree = straight ? 0 : typeof given === 'number' ? given : bothNamed ? autoCurve(from, to, crowdList, emPx) : 0;
		let curve = arrowCurve(from, to, curveDegree, emPx);
		// named ends stop at the edge of what they name, facing the curve; a lone pair is the one facing the arrow's
		// middle (the way it leaves), which also settles a pair above and one below an end level with it
		const middle = bezierPoint(curve, 0.5);
		const facing = (name: string, control: Point): Point => (/\.lp\d?$/.test(name) ? middle : control);
		const fromEdge = fromEnd && 'name' in fromEnd ? resolve(fromEnd.name, facing(fromEnd.name, curve.control1)) : undefined;
		const toEdge = toEnd && 'name' in toEnd ? resolve(toEnd.name, facing(toEnd.name, curve.control2)) : undefined;
		curve = { ...curve, from: fromEdge ?? curve.from, to: toEdge ?? curve.to };
		const arrowBox: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		for (const point of sampleCurve(curve)) grow(arrowBox, point.x, point.y);
		const pad = 0.4 * emPx;
		arrowBox.minX -= pad;
		arrowBox.minY -= pad;
		arrowBox.maxX += pad;
		arrowBox.maxY += pad;
		drawnList.push({ child, curve, box: arrowBox });
	}
	for (const { child, curve, box: arrowBox } of drawnList) {
		const local = (point: Point): Point => ({ x: point.x - arrowBox.minX, y: point.y - arrowBox.minY });
		const localCurve: ArrowCurve = { from: local(curve.from), control1: local(curve.control1), control2: local(curve.control2), to: local(curve.to) };
		const width = arrowBox.maxX - arrowBox.minX;
		const height = arrowBox.maxY - arrowBox.minY;
		place(child.element, arrowBox.minX, arrowBox.minY);
		child.element.style.width = `${width}px`;
		child.element.style.height = `${height}px`;
		const color = child.property.get('Color');
		const dash = child.property.get('Dash');
		const markup = arrowMarkup(localCurve, {
			kind: readKind(child.property.get('Kind')),
			head: readHead(child.property.get('Head')),
			size: emPx,
			...(dash === 'Dashed' || dash === 'Dotted' ? { dash } : {}),
			...(typeof color === 'string' && context.resolveColor(color) ? { color: context.resolveColor(color)! } : {}),
		});
		const content = child.element.querySelector<HTMLElement>(':scope > .oi-content');
		if (content) content.innerHTML = `<svg class="oi-arrow-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${markup}</svg>`;
		grow(box, arrowBox.minX, arrowBox.minY);
		grow(box, arrowBox.maxX, arrowBox.maxY);
		// blocks inside the arrow: along it (At), above or below; ones on the same side and spot stack outward
		const outMap = new Map<string, number>();
		for (const label of child.element.querySelectorAll<HTMLElement>(':scope > .oi-child > .oi-frame')) {
			const side = label.dataset.oiSide === 'Below' ? 'Below' : 'Above';
			const at = readAt(Number(label.dataset.oiAt ?? 0.5));
			const spot = `${side}|${at.toFixed(2)}`;
			const out = outMap.get(spot) ?? 0;
			const { point, translate } = arrowLabelPlace(localCurve, side, emPx, at, out);
			outMap.set(spot, out + (translate.startsWith('translate(-50%') ? label.offsetHeight : label.offsetWidth) + 2);
			label.style.left = `${point.x}px`;
			label.style.top = `${point.y}px`;
			label.style.transform = translate;
			const rect = label.getBoundingClientRect();
			grow(box, rect.left - areaRect.left, rect.top - areaRect.top);
			grow(box, rect.right - areaRect.left, rect.bottom - areaRect.top);
		}
	}
	if (box.minX === Infinity) {
		area.style.width = '';
		area.style.height = '';
		return;
	}
	// everything moves so the top left of what's drawn is the Board's top left
	for (const child of childList) {
		if (child.element.style.display === 'none') continue;
		const at = placeMap.get(child.element) ?? { x: 0, y: 0 };
		child.element.style.left = `${at.x - box.minX}px`;
		child.element.style.top = `${at.y - box.minY}px`;
	}
	const width = Math.ceil(box.maxX - box.minX);
	const height = Math.ceil(box.maxY - box.minY);
	area.style.width = `${width}px`;
	area.style.height = `${height}px`;
	area.dataset.oiShiftX = String(box.minX);
	area.dataset.oiShiftY = String(box.minY);
	if (root) return;
	// wider than its column: shrink to fit, like a picture
	const available = area.parentElement?.clientWidth ?? 0;
	if (available > 0 && width > available) area.style.zoom = String(Math.max(0.2, available / width));
	void container;
}

const watchMap = new WeakMap<HTMLElement, { observer: ResizeObserver; run: () => void; pending: boolean }>();

/** Lays the Board out again when its column or a block in it changes size (a picture loads, fonts arrive). */
function watch(area: HTMLElement, childList: readonly ChildFrame[], run: () => void): void {
	if (typeof ResizeObserver !== 'function') return;
	let watcher = watchMap.get(area);
	if (!watcher) {
		const state = {
			run,
			pending: false,
			observer: new ResizeObserver(() => {
				if (state.pending) return;
				state.pending = true;
				requestAnimationFrame(() => {
					state.pending = false;
					// the area is no longer a Board's (a page switched to another layout): stop watching
					if (area.dataset.oiArrange !== 'Board') {
						state.observer.disconnect();
						watchMap.delete(area);
						return;
					}
					if (area.isConnected) state.run();
				});
			}),
		};
		watcher = state;
		watchMap.set(area, state);
	}
	watcher.run = run;
	watcher.observer.disconnect();
	if (area.parentElement) watcher.observer.observe(area.parentElement);
	for (const child of childList) if (child.type !== 'Arrow') watcher.observer.observe(child.element);
}

/** Lays a Masonry Board out: cards in columns, each to the shortest column, in order. */
function layoutMasonry(area: HTMLElement, container: ResolvedBlock, childList: readonly ChildFrame[], context: LayoutContext): void {
	area.classList.add('oi-masonry');
	const emPx = Number.parseFloat(getComputedStyle(area).fontSize) || 16;
	const gap = toPx(container.property.get('Gap'), emPx) ?? 12;
	const wanted = Math.max(4 * emPx, toPx(container.property.get('ColumnWidth'), emPx) ?? 15 * emPx);
	const available = area.clientWidth || area.parentElement?.clientWidth || wanted;
	const count = Math.max(1, Math.floor((available + gap) / (wanted + gap)));
	const width = (available - gap * (count - 1)) / count;
	const heightList = Array.from({ length: count }, () => 0);
	// every card at its width first, so each height is read once
	for (const child of childList) child.element.style.width = `${width}px`;
	for (const child of childList) {
		const column = heightList.indexOf(Math.min(...heightList));
		child.element.style.left = `${column * (width + gap)}px`;
		child.element.style.top = `${heightList[column]!}px`;
		child.element.dataset.oiColumn = String(column);
		heightList[column] = heightList[column]! + child.element.offsetHeight + gap;
	}
	area.style.height = `${Math.max(0, Math.max(...heightList) - gap)}px`;
	void context;
}

/** Whether a Board is a Masonry wall (`Arrange: Masonry`) rather than free placement. */
export function isMasonry(property: ReadonlyMap<string, PropertyValue>): boolean {
	return property.get('Arrange') === 'Masonry';
}

export function arrangeBoard(area: HTMLElement, container: ResolvedBlock, childList: readonly ChildFrame[], context: LayoutContext): void {
	const root = area.classList.contains('oi-note');
	const masonry = isMasonry(container.property);
	area.dataset.oiArrange = 'Board';
	// a Board switched between Free and Masonry starts clean
	area.classList.toggle('oi-board-area', !masonry);
	area.classList.toggle('oi-masonry', masonry);
	area.style.width = '';
	area.style.zoom = '';
	for (const child of childList) {
		if (child.element.dataset.oiColumn === undefined) continue;
		// a card's width was the column's: back to its own
		delete child.element.dataset.oiColumn;
		child.element.style.width = '';
	}
	const run = (): void => (masonry ? layoutMasonry(area, container, childList, context) : layoutBoard(area, container, childList, context, root));
	run();
	watch(area, childList, run);
}

/** The Board editor reads a block tree. */
function toBoardItem(node: BlockNode): BoardItem {
	return { type: node.type, property: node.property, body: node.body, ...(node.id ? { id: node.id } : {}), childList: node.childList.map(toBoardItem) };
}

function drawBoardHead(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const editor = context.extension<BoardEditor>(boardEditorExtension);
	const empty = block.node.childList.length === 0;
	const masonry = isMasonry(block.property);
	const emptyText = masonry ? 'Empty wall: put blocks inside it, and each one becomes a card.' : 'Empty board: open it to draw arrows and text, or put blocks inside it with X and Y.';
	frame.innerHTML = `<div class="oi-board-head">${empty ? `<p class="oi-board-empty" data-oi-s="0">${emptyText}</p>` : ''}</div>`;
	// a Masonry wall has no editor: its cards are edited right in the note
	if (!editor || context.readOnly() || masonry) return;
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'oi-board-edit';
	button.dataset.oiInteractive = '';
	button.textContent = 'Edit board';
	button.title = 'Move, draw, and write on this board';
	button.addEventListener('click', () => {
		const node = context.note.get(block.key) ?? block.node;
		const emPx = Number.parseFloat(getComputedStyle(frame).fontSize) || 16;
		editor.open({ property: node.property, itemList: node.childList.map(toBoardItem), emPx, context, onDone: (source) => context.replaceWith(source) });
	});
	frame.querySelector('.oi-board-head')!.append(button);
}

export const boardType: BlockTypeDefinition = {
	name: 'Board',
	content: 'Item',
	style: boardStyle,
	render: {
		mount(frame, block, context) {
			drawBoardHead(frame, block, context);
			return {
				update(next, nextContext) {
					drawBoardHead(frame, next, nextContext);
					return 'Done';
				},
			};
		},
	},
	layout: { coordinate: 'Fixed', childPropertyList: ['X', 'Y', 'Width', 'Rotate', 'Layer', 'Near', 'Side', 'Gap'], arrange: arrangeBoard },
	templateList: [
		{
			title: 'Board',
			icon: '▧',
			source: 'Board:\n\tText {X: 0, Y: 0}: Anything placed where you want it\n\tText {X: 220, Y: 60}: Drag blocks around in **Edit board**\n\tArrow {X: 140, Y: 34, Length: 70, Angle: -20}',
			keywordList: ['board', 'whiteboard', 'free', 'canvas', 'position', 'diagram'],
			explain: 'Blocks placed freely by X and Y, with arrows between them',
		},
		{
			title: 'Mood board',
			icon: '▦',
			source: 'Board {Arrange: Masonry}:\n\tText: **Ideas** go on cards, and each card finds the shortest column\n\tText: A short one\n\tText: Drag a card (Alt + drag) to put it somewhere else in the order; a picture, math, or code is a card too\n\tText: Change `ColumnWidth` and `Gap` in the header for wider or tighter columns',
			keywordList: ['masonry', 'pinterest', 'mood', 'cards', 'wall', 'board', 'gallery'],
			explain: 'Cards in columns, Pinterest style',
		},
	],
	plainText: () => '',
};

/** An arrow alone (outside a Board): a straight arrow of its Length. */
function drawArrowAlone(frame: HTMLElement, block: ResolvedBlock): void {
	const emPx = 16;
	const length = toPx(block.property.get('Length'), emPx) ?? 3.2 * emPx;
	const curve = arrowCurve({ x: 4, y: 12 }, { x: 4 + length, y: 12 }, 0, emPx);
	frame.innerHTML = `<svg class="oi-arrow-alone" width="${length + 8}" height="24" aria-hidden="true">${arrowMarkup(curve, { kind: readKind(block.property.get('Kind')), head: readHead(block.property.get('Head')), size: emPx })}</svg>`;
}

export const arrowType: BlockTypeDefinition = {
	name: 'Arrow',
	content: 'Item',
	render: {
		mount(frame, block) {
			drawArrowAlone(frame, block);
			return {
				update(next) {
					drawArrowAlone(frame, next);
					return 'Done';
				},
			};
		},
	},
	// blocks inside an arrow (conditions) sit along it; the Board places them once the arrow is drawn
	layout: {
		coordinate: 'Fixed',
		childPropertyList: ['Side', 'At'],
		arrange(_area, _container, childList) {
			for (const child of childList) {
				child.element.dataset.oiSide = child.property.get('Side') === 'Below' ? 'Below' : 'Above';
				child.element.dataset.oiAt = String(readAt(child.property.get('At')));
			}
		},
	},
	plainText: () => '',
};
