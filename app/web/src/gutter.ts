// Picking blocks up: drag and drop to reorder, nest, or put side by side, plus right-click and
// long-press menus. Pointer Events only, so mouse, touch, and pen all work.
//
//   which block      a box outlines the block under the pointer (kept inside the block around it, so
//                    boxes never run into the next column)
//   Alt + drag       hold Alt (Option on a Mac) and drag any block from anywhere on it; the box shows
//                    which one, with its type; Alt + the wheel goes out to the block around it (a column,
//                    a callout, a Board) and back in; Alt + click selects it
//   selected block   (Esc while typing selects the block, Esc again the one around it) drags from anywhere
//   touch            hold a block still for a moment, then drag it; let go without moving for its menu
//   ⋮⋮ and +         beside the block, when Setting → Editor → Show the block handle is on
//
//   side by side     drop on the left or right edge of a block: the two sit in columns (a new Grid); on the
//                    edge of a column, a new column beside it. A column left empty goes, and a grid of one
//                    column becomes its blocks again. Only where blocks flow: not on a Board or an arrow
//   on a Board       a block on a Board (or on a page that is a Board) moves where it is dropped (its X and
//                    Y), as it follows the pointer; text on an arrow dropped on its Board leaves the arrow
//   on a Masonry     cards go before or after the card nearest the pointer
//
//   where it drops   found from the pointer's height alone (the pointer can be anywhere left or
//                    right of the text); move right over a block to drop inside it
//   what you see     a copy of the block follows the pointer, the block you drag and the one you
//                    drop into get outlines, and a line shows the exact spot; the page scrolls
//                    near the top and bottom edges

import type { EditSession } from '@octaether/core-edit';
import type { BlockNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import { type RenderHost, readLayout } from '@octaether/core-render';

export interface GutterOption {
	host: RenderHost;
	session: EditSession;
	model(): NoteModel | undefined;
	readOnly(): boolean;
	/** ⋮⋮ and + beside blocks for a mouse (Editor.BlockHandle). */
	showHandle(): boolean;
	/** + was pressed: offer blocks to add below `key`. */
	onAdd(key: string, x: number, y: number): void;
	/** ⋮⋮ clicked, right-click, or long-press: the block menu. */
	onMenu(key: string, x: number, y: number): void;
}

type DropMode = 'Before' | 'After' | 'Into' | 'First' | 'Left' | 'Right' | 'Move';
/** `across`: before or after a card on a Masonry Board (the line stands beside it). */
type Drop = { mode: DropMode; key: string; across?: boolean };

/** Properties that place a block in a fixed container; a block moved where blocks flow loses them. */
const placeKeyList = ['X', 'Y', 'Near', 'Side', 'Gap', 'At', 'Rotate', 'Layer'];

export function setupGutter(option: GutterOption): { hide(): void; refresh(): void } {
	const { host } = option;
	const gutter = document.getElementById('gutter')!;
	const addButton = document.getElementById('gutterAdd')!;
	const handle = document.getElementById('gutterHandle')!;
	const dropLine = document.getElementById('dropLine')!;
	const view = document.getElementById('viewContent');
	const box = document.createElement('div');
	box.className = 'hover-box';
	box.hidden = true;
	box.setAttribute('aria-hidden', 'true');
	box.innerHTML = '<span class="hover-box-tag"></span>';
	document.getElementById('layer')!.append(box);
	const tag = box.querySelector<HTMLElement>('.hover-box-tag')!;
	let hoverKey: string | undefined;
	let hideTimer: number | undefined;
	/** Alt held: the block the box shows is this many steps out from the innermost one under the pointer. */
	let altLevel = 0;
	let altInner: string | undefined;
	let altKey: string | undefined;

	const firstLineRect = (frame: HTMLElement): DOMRect => {
		const content = frame.querySelector<HTMLElement>(':scope > .oi-content');
		const rect = content?.getBoundingClientRect();
		return rect && rect.height > 0 ? rect : frame.getBoundingClientRect();
	};

	/** A container type whose blocks don't flow (a Board, an arrow): no columns there. */
	const fixedType = (type: string): boolean => host.registry.blockType(type)?.layout?.coordinate === 'Fixed';
	const isMasonry = (node: BlockNode | undefined): boolean => node?.type === 'Board' && node.property.get('Arrange') === 'Masonry';
	/** The note's own layout: a page that is a Board (free or Masonry). */
	const rootLayout = (): { type: string; masonry: boolean } => {
		const layout = readLayout(option.model()?.noteProperty('Layout'));
		return { type: layout.type, masonry: layout.type === 'Board' && layout.property.get('Arrange') === 'Masonry' };
	};
	/** Whether a block sits where blocks flow (columns can form there). */
	const flowsAt = (key: string): boolean => {
		const parent = option.model()?.parentOf(key);
		return parent ? !fixedType(parent.type) : !fixedType(rootLayout().type);
	};

	/**
	 * The box around a block: the same place and shape as the outline of the block being edited (5px out,
	 * 1.5px wide), so the two never stand side by side; kept within the block around it.
	 */
	const showBox = (key: string | undefined, strong: boolean): void => {
		const frame = key ? host.frameOf(key) : undefined;
		if (!key || !frame || option.readOnly() || frame.hasAttribute('data-oi-editing') || document.body.classList.contains('dragging')) {
			box.hidden = true;
			return;
		}
		const rect = frame.getBoundingClientRect();
		const outer = (frame.parentElement ?? host.root).getBoundingClientRect();
		const pad = 6.5;
		// a Full width block is meant to be wider than the text: its box follows it
		const wide = frame.classList.contains('oi-wide');
		const left = wide ? rect.left - pad : Math.max(rect.left - pad, outer.left - pad);
		const right = wide ? rect.right + pad : Math.min(rect.right + pad, outer.right + pad);
		const top = rect.top - pad;
		const bottom = rect.bottom + pad;
		box.hidden = false;
		box.classList.toggle('hover-box-strong', strong);
		box.style.left = `${left}px`;
		box.style.top = `${top}px`;
		box.style.width = `${Math.max(0, right - left)}px`;
		box.style.height = `${Math.max(0, bottom - top)}px`;
		tag.textContent = strong ? (option.model()?.get(key)?.type ?? '') : '';
		tag.hidden = !strong;
	};

	const show = (key: string): void => {
		const frame = host.frameOf(key);
		if (!frame || option.readOnly()) return;
		hoverKey = key;
		showBox(key, false);
		if (!option.showHandle()) {
			gutter.hidden = true;
			return;
		}
		const rect = frame.getBoundingClientRect();
		const line = firstLineRect(frame);
		gutter.hidden = false;
		gutter.style.left = `${Math.max(2, rect.left - gutter.offsetWidth - 4)}px`;
		gutter.style.top = `${line.top + Math.min(Math.max((Math.min(line.height, 40) - 24) / 2, 0), 8)}px`;
	};
	const hide = (): void => {
		box.hidden = true;
		gutter.hidden = true;
		hoverKey = undefined;
		altKey = undefined;
	};
	gutter.addEventListener('pointerenter', () => showBox(hoverKey, true));
	gutter.addEventListener('pointerleave', () => {
		if (!dragKey) showBox(hoverKey, false);
	});

	/** The strip between the gutter and its block: the pointer may cross other blocks there. */
	const inCorridor = (x: number, y: number): boolean => {
		if (!hoverKey || gutter.hidden) return false;
		const frame = host.frameOf(hoverKey);
		if (!frame) return false;
		const gutterRect = gutter.getBoundingClientRect();
		const rect = frame.getBoundingClientRect();
		const top = Math.min(gutterRect.top, rect.top) - 6;
		const bottom = Math.max(gutterRect.bottom, Math.min(rect.bottom, gutterRect.bottom + 24)) + 6;
		return x >= gutterRect.left - 6 && x <= rect.left + 8 && y >= top && y <= bottom;
	};

	/** The block Alt + drag takes: `altLevel` steps out from the innermost one at the pointer. */
	const climb = (key: string, level: number): string => {
		const model = option.model();
		let current = key;
		for (let step = 0; step < level && model; step++) {
			const parent = model.parentOf(current);
			if (!parent) break;
			current = parent.key;
		}
		return current;
	};
	const depthOut = (key: string): number => {
		const model = option.model();
		let depth = 0;
		for (let parent = model?.parentOf(key); parent; parent = model?.parentOf(parent.key)) depth++;
		return depth;
	};
	const showAlt = (inner: string | undefined): void => {
		if (inner !== altInner) altLevel = 0;
		altInner = inner;
		altKey = inner ? climb(inner, altLevel) : undefined;
		showBox(altKey, true);
	};

	let pointer: { x: number; y: number } | undefined;
	let scrollTimer: number | undefined;
	const keyAtPoint = (x: number, y: number): string | undefined => {
		const target = document.elementFromPoint(x, y);
		return target && host.root.contains(target) ? host.keyAt(target) : undefined;
	};

	document.addEventListener('pointermove', (event) => {
		if (event.pointerType !== 'mouse') return;
		pointer = { x: event.clientX, y: event.clientY };
		if (dragKey || press || option.readOnly()) return;
		const target = event.target as Element | null;
		if (!target) return;
		if (gutter.contains(target) || inCorridor(event.clientX, event.clientY)) {
			window.clearTimeout(hideTimer);
			return;
		}
		const key = host.root.contains(target) ? host.keyAt(target) : undefined;
		if (event.altKey) {
			window.clearTimeout(hideTimer);
			showAlt(key);
			return;
		}
		if (key) {
			window.clearTimeout(hideTimer);
			// (a hidden box may be over the block being edited: shown again once it isn't)
			if (key !== hoverKey || box.hidden || box.classList.contains('hover-box-strong')) show(key);
			return;
		}
		window.clearTimeout(hideTimer);
		hideTimer = window.setTimeout(() => {
			if (!dragKey) hide();
		}, 300);
	});
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Alt' || event.repeat || !pointer || dragKey || option.readOnly()) return;
		showAlt(keyAtPoint(pointer.x, pointer.y));
	});
	document.addEventListener('keyup', (event) => {
		if (event.key !== 'Alt') return;
		// Alt used for picking a block: not the browser's menu bar
		if (altUsed) event.preventDefault();
		altUsed = false;
		// the next Alt starts at the innermost block again
		altKey = undefined;
		altInner = undefined;
		altLevel = 0;
		if (!dragKey && pointer) {
			const key = keyAtPoint(pointer.x, pointer.y);
			if (key) show(key);
			else hide();
		}
	});
	window.addEventListener('blur', () => {
		altKey = undefined;
		if (!dragKey) box.hidden = true;
	});
	let altUsed = false;
	// Alt + the wheel: out to the block around (wheel up), back in (down)
	host.root.addEventListener(
		'wheel',
		(event) => {
			if (!event.altKey || option.readOnly() || dragKey) return;
			event.preventDefault();
			altUsed = true;
			const inner = keyAtPoint(event.clientX, event.clientY);
			if (!inner) return;
			if (inner !== altInner) {
				altInner = inner;
				altLevel = 0;
			}
			altLevel = Math.max(0, Math.min(depthOut(inner), altLevel + (event.deltaY < 0 ? 1 : -1)));
			showAlt(inner);
		},
		{ passive: false },
	);
	view?.addEventListener(
		'scroll',
		() => {
			if (dragKey) return;
			hide();
			// when the page stops scrolling under a resting mouse, the box comes back for the block there
			window.clearTimeout(scrollTimer);
			scrollTimer = window.setTimeout(() => {
				if (!pointer || dragKey || option.readOnly()) return;
				const key = keyAtPoint(pointer.x, pointer.y);
				if (key) show(key);
			}, 140);
		},
		{ passive: true },
	);

	addButton.addEventListener('click', () => {
		if (!hoverKey) return;
		const rect = addButton.getBoundingClientRect();
		option.onAdd(hoverKey, rect.left, rect.bottom + 4);
	});

	// ---- drag and drop
	let dragKey: string | undefined;
	let dragging = false;
	let start = { x: 0, y: 0 };
	let last = { x: 0, y: 0 };
	let drop: Drop | undefined;
	let ghost: HTMLElement | undefined;
	let scrollFrame = 0;
	/** A press that may become a drag: what it picks up, and what a press that stays put does. */
	let press: { key: string; pointerId: number; touch: boolean; onClick: ((event: PointerEvent) => void) | undefined } | undefined;
	let swallowClick = false;

	const frameList = (): HTMLElement[] => {
		const dragFrame = dragKey ? host.frameOf(dragKey) : undefined;
		return [...host.root.querySelectorAll<HTMLElement>('.oi-frame')].filter((frame) => !dragFrame?.contains(frame));
	};

	/** The block at a height: the innermost one under the pointer, or the nearest one above or below. */
	const frameAt = (x: number, y: number): HTMLElement | undefined => {
		const rootRect = host.root.getBoundingClientRect();
		const probeX = Math.min(Math.max(x, rootRect.left + 6), rootRect.right - 6);
		const dragFrame = dragKey ? host.frameOf(dragKey) : undefined;
		for (const element of document.elementsFromPoint(probeX, y)) {
			if (!host.root.contains(element)) continue;
			const frame = element.closest<HTMLElement>('.oi-frame');
			if (!frame) break;
			if (dragFrame?.contains(frame)) return undefined;
			return frame;
		}
		let best: HTMLElement | undefined;
		let bestDistance = Infinity;
		for (const frame of frameList()) {
			const rect = frame.getBoundingClientRect();
			if (probeX < rect.left - 2 || probeX > rect.right + 2) continue;
			const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
			// later frames are deeper: on a tie the innermost wins
			if (distance <= bestDistance) {
				best = frame;
				bestDistance = distance;
			}
		}
		return best;
	};

	const inside = (rect: DOMRect | undefined, x: number, y: number): boolean => rect !== undefined && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

	/** The free Board a dragged block moves on (its X and Y): its own Board, the Board around its arrow, or the page. */
	const freeBoardOf = (key: string): { key: string; area: HTMLElement } | undefined => {
		const model = option.model()!;
		let parent = model.parentOf(key);
		if (parent?.type === 'Arrow') parent = model.parentOf(parent.key);
		if (parent) {
			if (parent.type !== 'Board' || isMasonry(parent)) return undefined;
			const area = host.frameOf(parent.key)?.querySelector<HTMLElement>(':scope > .oi-child');
			return area ? { key: parent.key, area } : undefined;
		}
		const layout = rootLayout();
		return layout.type === 'Board' && !layout.masonry ? { key: '', area: host.root } : undefined;
	};

	/** The Masonry wall under the pointer, if any: drops go between its cards. */
	const masonryAt = (x: number, y: number): Drop | undefined => {
		const model = option.model()!;
		const dragFrame = dragKey ? host.frameOf(dragKey) : undefined;
		const area = document
			.elementsFromPoint(x, y)
			.map((element) => element.closest<HTMLElement>('.oi-masonry'))
			.find((element): element is HTMLElement => element !== null && host.root.contains(element) && !dragFrame?.contains(element));
		if (!area) return undefined;
		let best: { frame: HTMLElement; distance: number } | undefined;
		for (const frame of area.querySelectorAll<HTMLElement>(':scope > .oi-frame')) {
			if (frame === dragFrame) continue;
			const rect = frame.getBoundingClientRect();
			const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
			const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
			const distance = Math.hypot(dx, dy);
			if (!best || distance < best.distance) best = { frame, distance };
		}
		if (!best) return undefined;
		const key = best.frame.dataset.oiKey!;
		if (!model.get(key) || model.get(dragKey!)?.type === 'Column') return undefined;
		const rect = best.frame.getBoundingClientRect();
		return { mode: x < (rect.left + rect.right) / 2 ? 'Before' : 'After', key, across: true };
	};

	const target = (x: number, y: number): Drop | undefined => {
		const model = option.model();
		if (!model || !dragKey) return undefined;
		// a block on a free Board moves on it (first: the block itself is under the pointer)
		const board = freeBoardOf(dragKey);
		if (board && inside(board.area.getBoundingClientRect(), x, y)) return { mode: 'Move', key: board.key };
		const masonry = masonryAt(x, y);
		if (masonry) return masonry;
		const frame = frameAt(x, y);
		if (!frame) return undefined;
		const key = frame.dataset.oiKey!;
		const node = model.get(key);
		const dragged = model.get(dragKey);
		if (!node || !dragged || key === dragKey) return undefined;
		const rect = frame.getBoundingClientRect();
		// the left or right edge of a block where blocks flow: side by side (beside a block in a column, a new column)
		if (dragged.type !== 'Column' && node.type !== 'Grid' && flowsAt(key)) {
			const column = node.type === 'Column' ? frame : model.parentOf(key)?.type === 'Column' ? host.frameOf(model.parentOf(key)!.key) : undefined;
			const side = (column ?? frame).getBoundingClientRect();
			// a finger rests wide: on touch the side zones are narrow, so a drag up or down stays one
			const edge = Math.min(press?.touch ? 20 : 48, side.width * (press?.touch ? 0.1 : 0.18));
			const sideKey = column ? column.dataset.oiKey! : key;
			if (sideKey !== dragKey && !host.frameOf(dragKey)?.contains(column ?? frame)) {
				if (x <= side.left + edge) return { mode: 'Left', key: sideKey };
				if (x >= side.right - edge) return { mode: 'Right', key: sideKey };
			}
		}
		const content = firstLineRect(frame);
		const holder = node.content === 'Item' && !frame.classList.contains('oi-heading') && node.type !== 'Arrow';
		// a grid only holds columns
		const fits = holder && (node.type !== 'Grid' || dragged.type === 'Column') && (dragged.type !== 'Column' || node.type === 'Grid');
		const empty = node.childList.length === 0;
		const ownLine = y >= content.top && y <= content.bottom;
		// moving right over a block (past its text's start) drops inside it
		if (fits && (ownLine || (empty && y <= rect.bottom)) && x > content.left + 36) return { mode: empty ? 'Into' : 'First', key };
		if (fits && empty && content.height <= 4 && y >= rect.top && y <= rect.bottom) return { mode: 'Into', key };
		if (y < content.top + content.height / 2) return { mode: 'Before', key };
		return { mode: 'After', key };
	};

	const showDrop = (value: Drop | undefined): void => {
		drop = value;
		for (const element of host.root.querySelectorAll('.oi-drop-into')) element.classList.remove('oi-drop-into');
		// on its Board, the block itself follows the pointer
		if (!value || value.mode === 'Move') {
			dropLine.hidden = true;
			return;
		}
		const frame = host.frameOf(value.key);
		if (!frame) {
			dropLine.hidden = true;
			return;
		}
		const rect = frame.getBoundingClientRect();
		const content = firstLineRect(frame);
		dropLine.hidden = false;
		const standing = value.mode === 'Left' || value.mode === 'Right' || value.across === true;
		dropLine.classList.toggle('drop-line-side', standing);
		if (standing) {
			const before = value.mode === 'Left' || value.mode === 'Before';
			dropLine.style.left = `${before ? rect.left - 6 : rect.right + 3}px`;
			dropLine.style.top = `${rect.top}px`;
			dropLine.style.width = '3px';
			dropLine.style.height = `${Math.max(24, rect.height)}px`;
			if (!value.across) frame.classList.add('oi-drop-into');
			return;
		}
		dropLine.style.height = '';
		let left = rect.left;
		let top = value.mode === 'Before' ? rect.top - 4 : rect.bottom + 3;
		if (value.mode === 'Into' || value.mode === 'First') {
			frame.classList.add('oi-drop-into');
			left = rect.left + 24;
			top = value.mode === 'First' ? content.bottom + 3 : rect.bottom - 6;
		}
		dropLine.style.left = `${left}px`;
		dropLine.style.width = `${Math.max(48, rect.right - left)}px`;
		dropLine.style.top = `${top}px`;
	};

	/** The zoom a Board's area has when it shrinks to fit its column. */
	const zoomOf = (area: HTMLElement): number => Number.parseFloat(area.style.zoom || '1') || 1;

	const moveGhost = (x: number, y: number): void => {
		if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
		// on its Board, the block itself moves (the Board may be shrunk to fit: its zoom scales the move)
		const frame = dragKey ? host.frameOf(dragKey) : undefined;
		if (!frame) return;
		const moving = drop?.mode === 'Move';
		const zoom = moving && dragKey ? zoomOf(freeBoardOf(dragKey)?.area ?? frame) : 1;
		frame.style.translate = moving ? `${(x - start.x) / zoom}px ${(y - start.y) / zoom}px` : '';
		if (ghost) ghost.hidden = moving;
		frame.classList.toggle('oi-board-moving', moving);
	};

	const autoScroll = (): void => {
		scrollFrame = 0;
		if (!dragging || !view) return;
		const rect = view.getBoundingClientRect();
		const edge = 56;
		let step = 0;
		if (last.y < rect.top + edge) step = -Math.min(18, (rect.top + edge - last.y) / 3);
		else if (last.y > rect.bottom - edge) step = Math.min(18, (last.y - rect.bottom + edge) / 3);
		if (step !== 0) {
			view.scrollBy(0, step);
			showDrop(target(last.x, last.y));
		}
		scrollFrame = requestAnimationFrame(autoScroll);
	};

	const begin = (): void => {
		dragging = true;
		box.hidden = true;
		const frame = host.frameOf(dragKey!);
		frame?.classList.add('oi-dragging');
		document.body.classList.add('dragging');
		if (frame) {
			ghost = document.createElement('div');
			ghost.className = 'drag-ghost';
			ghost.setAttribute('aria-hidden', 'true');
			const copy = frame.cloneNode(true) as HTMLElement;
			copy.classList.remove('oi-dragging');
			copy.removeAttribute('data-oi-key');
			copy.style.translate = '';
			for (const element of copy.querySelectorAll('[data-oi-key]')) element.removeAttribute('data-oi-key');
			ghost.style.width = `${Math.min(frame.getBoundingClientRect().width, 460)}px`;
			ghost.append(copy);
			document.getElementById('layer')!.append(ghost);
		}
		gutter.classList.add('gutter-dragging');
		scrollFrame = requestAnimationFrame(autoScroll);
	};

	/**
	 * A press on a block that may become a drag: past 5px it picks the block up; `onClick` runs when it
	 * stays put (the block menu for ⋮⋮). Listens on the window, so it works from anywhere on the page.
	 */
	const beginPress = (key: string, event: PointerEvent, onClick?: (event: PointerEvent) => void): void => {
		option.session.close();
		press = { key, pointerId: event.pointerId, touch: event.pointerType === 'touch', onClick };
		dragKey = key;
		dragging = false;
		start = { x: event.clientX, y: event.clientY };
		last = start;
		window.addEventListener('pointermove', onPressMove, true);
		window.addEventListener('pointerup', finish, true);
		window.addEventListener('pointercancel', finish, true);
	};
	const onPressMove = (event: PointerEvent): void => {
		if (!press || event.pointerId !== press.pointerId) return;
		last = { x: event.clientX, y: event.clientY };
		if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) begin();
		if (!dragging) return;
		event.preventDefault();
		// where it drops first: on its Board, the block itself follows
		showDrop(target(event.clientX, event.clientY));
		moveGhost(event.clientX, event.clientY);
	};

	const finish = (event: PointerEvent): void => {
		if (!press || event.pointerId !== press.pointerId) return;
		const { key, onClick } = press;
		press = undefined;
		window.removeEventListener('pointermove', onPressMove, true);
		window.removeEventListener('pointerup', finish, true);
		window.removeEventListener('pointercancel', finish, true);
		const dragFrame = host.frameOf(key);
		const frameRect = dragFrame?.getBoundingClientRect();
		if (dragFrame) {
			dragFrame.style.translate = '';
			dragFrame.classList.remove('oi-board-moving');
		}
		dragKey = undefined;
		cancelAnimationFrame(scrollFrame);
		host.frameOf(key)?.classList.remove('oi-dragging');
		document.body.classList.remove('dragging');
		gutter.classList.remove('gutter-dragging');
		ghost?.remove();
		ghost = undefined;
		const place = drop;
		showDrop(undefined);
		if (!dragging) {
			if (event.type !== 'pointercancel') onClick?.(event);
			return;
		}
		dragging = false;
		// the click that ends a drag is not a click on the block
		swallowClick = true;
		window.setTimeout(() => (swallowClick = false), 0);
		const model = option.model();
		if (!model || !place || event.type === 'pointercancel') return;
		try {
			if (place.mode === 'Move') {
				const board = freeBoardOf(key);
				const zoom = board ? zoomOf(board.area) : 1;
				if (model.parentOf(key)?.type === 'Arrow' && board && frameRect) {
					// text on an arrow dropped on the Board: free text where it was let go
					const areaRect = board.area.getBoundingClientRect();
					const shiftX = Number(board.area.dataset.oiShiftX ?? 0);
					const shiftY = Number(board.area.dataset.oiShiftY ?? 0);
					const x = Math.round(((frameRect.left - areaRect.left) / zoom + shiftX) * 10) / 10;
					const y = Math.round(((frameRect.top - areaRect.top) / zoom + shiftY) * 10) / 10;
					model.transact(() => {
						model.move(key, board.key === '' ? null : board.key, model.get(board.key)?.childList.at(-1)?.key ?? model.document.itemList.at(-1)?.key ?? null);
						for (const name of ['Side', 'At']) model.setProperty(key, name, undefined);
						model.setProperty(key, 'X', x);
						model.setProperty(key, 'Y', y);
					});
					return;
				}
				moveOnBoard(model, key, (event.clientX - start.x) / zoom, (event.clientY - start.y) / zoom);
				return;
			}
			if (place.mode === 'Left' || place.mode === 'Right') {
				const from = model.parentOf(key)?.key;
				model.transact(() => {
					placeBeside(model, key, place.key, place.mode as 'Left' | 'Right');
					tidyColumn(model, from);
					tidyPlace(model, key, (type) => fixedType(type), fixedType(rootLayout().type));
				});
				option.session.select(key);
				return;
			}
			const from = model.parentOf(key)?.key;
			model.transact(() => {
				if (place.mode === 'Into') model.move(key, place.key, model.get(place.key)!.childList.at(-1)?.key ?? null);
				else if (place.mode === 'First') model.move(key, place.key, null);
				else {
					const where = model.placeOf(place.key);
					const afterKey = place.mode === 'After' ? place.key : where.index > 0 ? where.list[where.index - 1]!.key : null;
					if (afterKey !== key) model.move(key, where.parentKey, afterKey);
				}
				// a column dropped outside a grid gives up its blocks; the grid it left may be one column now
				if (model.get(key)?.type === 'Column' && model.parentOf(key)?.type !== 'Grid') spreadColumn(model, key);
				tidyColumn(model, from);
				tidyGrid(model, from);
				tidyPlace(model, key, (type) => fixedType(type), fixedType(rootLayout().type));
			});
			option.session.select(key);
			host.frameOf(key)?.scrollIntoView({ block: 'nearest' });
		} catch {
			// dropping a block into itself (or into a block that can't hold blocks) changes nothing
		}
	};

	handle.addEventListener('pointerdown', (event) => {
		if (!hoverKey || event.button !== 0) return;
		event.preventDefault();
		const key = hoverKey;
		beginPress(key, event, (up) => option.onMenu(key, up.clientX, up.clientY + 8));
	});
	handle.addEventListener('keydown', (event) => {
		if ((event.key === 'Enter' || event.key === ' ') && hoverKey) {
			event.preventDefault();
			const rect = handle.getBoundingClientRect();
			option.onMenu(hoverKey, rect.left, rect.bottom + 4);
		}
	});

	// Alt + drag, a selected block, or a held finger: from anywhere on the block
	host.root.addEventListener('pointerdown', (event) => {
		if (option.readOnly() || event.button !== 0 || press) return;
		const element = event.target as Element;
		if (event.pointerType === 'touch') {
			holdStart(event);
			return;
		}
		// a block that uses Alt + drag itself (a calendar copies events with it) keeps it there
		if (event.altKey && !element.closest('[data-oi-own-alt]')) {
			const inner = host.keyAt(element);
			const key = altKey ?? (inner ? climb(inner, altLevel) : undefined);
			if (!key) return;
			event.preventDefault();
			altUsed = true;
			// Alt + click: the block is selected
			beginPress(key, event, () => {
				swallowClick = true;
				window.setTimeout(() => (swallowClick = false), 0);
				option.session.select(key);
				showBox(key, true);
			});
			return;
		}
		const selected = option.session.selected();
		const selectedFrame = selected ? host.frameOf(selected) : undefined;
		if (!selected || !selectedFrame?.hasAttribute('data-oi-selected') || !selectedFrame.contains(element)) return;
		if (element.closest('[data-oi-interactive], input, select, textarea, button, a[href], [data-oi-link]')) return;
		// a selected block is picked up as a whole: no text selection on the way
		event.preventDefault();
		beginPress(selected, event);
	});

	// a click that starts editing the hovered block: its own outline takes over
	host.root.addEventListener('click', () => window.setTimeout(() => {
		if (hoverKey && !dragKey && !altKey) showBox(hoverKey, false);
	}));

	// ---- right-click and long-press menus
	host.root.addEventListener('contextmenu', (event) => {
		const key = host.keyAt(event.target as Element);
		if (!key || option.readOnly()) return;
		event.preventDefault();
		option.onMenu(key, event.clientX, event.clientY);
	});
	/** A finger held still lifts the block: then moving drags it, letting go opens its menu. */
	let hold: { key: string; x: number; y: number; pointerId: number; timer: number; lifted: boolean } | undefined;
	const holdStart = (event: PointerEvent): void => {
		const key = host.keyAt(event.target as Element);
		if (!key) return;
		const begun = { key, x: event.clientX, y: event.clientY, pointerId: event.pointerId, lifted: false, timer: 0 };
		begun.timer = window.setTimeout(() => {
			if (hold !== begun) return;
			begun.lifted = true;
			showBox(key, true);
			navigator.vibrate?.(10);
		}, 450);
		hold = begun;
	};
	host.root.addEventListener('pointermove', (event) => {
		if (!hold || event.pointerId !== hold.pointerId) return;
		const distance = Math.hypot(event.clientX - hold.x, event.clientY - hold.y);
		if (!hold.lifted) {
			// moving first: the page scrolls
			if (distance >= 8) {
				window.clearTimeout(hold.timer);
				hold = undefined;
			}
			return;
		}
		if (distance < 6) return;
		const { key, x, y } = hold;
		hold = undefined;
		const down = new PointerEvent('pointerdown', { pointerId: event.pointerId, pointerType: 'touch', clientX: x, clientY: y });
		beginPress(key, down);
		onPressMove(event);
	});
	const holdEnd = (event: PointerEvent): void => {
		if (!hold || event.pointerId !== hold.pointerId) return;
		window.clearTimeout(hold.timer);
		const { key, x, y, lifted } = hold;
		hold = undefined;
		if (!lifted || event.type === 'pointercancel') return;
		swallowClick = true;
		box.hidden = true;
		option.onMenu(key, x, y);
	};
	host.root.addEventListener('pointerup', holdEnd);
	host.root.addEventListener('pointercancel', holdEnd);
	// a lifted block holds the page still while the finger drags it
	document.addEventListener(
		'touchmove',
		(event) => {
			if (hold?.lifted || (press && dragging)) event.preventDefault();
		},
		{ passive: false },
	);
	host.root.addEventListener(
		'click',
		(event) => {
			if (!swallowClick) return;
			swallowClick = false;
			event.stopPropagation();
			event.preventDefault();
		},
		true,
	);
	return {
		hide,
		/** After the handle setting changed. */
		refresh: () => {
			if (hoverKey) show(hoverKey);
		},
	};
}

/** Moves a block on a Board by (dx, dy) px: its X and Y, and the ends of an arrow that are points. */
function moveOnBoard(model: NoteModel, key: string, dx: number, dy: number): void {
	const node = model.get(key);
	if (!node || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return;
	const round = (value: number): number => Math.round(value * 10) / 10;
	const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
	model.transact(() => {
		for (const [name, delta] of [['X', dx], ['Y', dy]] as const) if (node.property.has(name) || node.type !== 'Arrow') model.setProperty(key, name, round(number(node.property.get(name)) + delta));
		for (const name of ['From', 'To']) {
			const value = node.property.get(name);
			if (Array.isArray(value) && value.length === 2) model.setProperty(key, name, [round(number(value[0]) + dx), round(number(value[1]) + dy)]);
		}
	});
}

/** A block moved where blocks flow loses its place on a Board or an arrow (X, Y, Side, At…). */
function tidyPlace(model: NoteModel, key: string, fixed: (type: string) => boolean, rootFixed: boolean): void {
	const node = model.get(key);
	const parent = model.parentOf(key);
	if (!node || (parent ? fixed(parent.type) : rootFixed)) return;
	for (const name of placeKeyList) if (node.property.has(name)) model.setProperty(key, name, undefined);
}

/**
 * Puts a block beside another: next to a column, a new column in its grid; next to any other block, a
 * new Grid in its place with the two in columns.
 */
function placeBeside(model: NoteModel, key: string, besideKey: string, side: 'Left' | 'Right'): void {
	const beside = model.get(besideKey)!;
	const place = model.placeOf(besideKey);
	if (beside.type === 'Column') {
		const afterKey = side === 'Right' ? besideKey : place.index > 0 ? place.list[place.index - 1]!.key : null;
		const columnKey = model.insert(place.parentKey, afterKey, model.parseFragment('Column:')[0]!);
		model.move(key, columnKey, null);
		return;
	}
	const gridKey = model.insert(place.parentKey, besideKey, model.parseFragment('Grid:\n\tColumn:\n\tColumn:')[0]!);
	const [first, second] = model.get(gridKey)!.childList.map((node) => node.key);
	model.move(besideKey, side === 'Right' ? first! : second!, null);
	model.move(key, side === 'Right' ? second! : first!, null);
}

/** After a block left a column: an empty column goes, and a grid down to one column becomes its blocks. */
function tidyColumn(model: NoteModel, columnKey: string | undefined): void {
	const column = columnKey ? model.get(columnKey) : undefined;
	if (!column || column.type !== 'Column' || column.childList.length > 0) return;
	const grid = model.parentOf(column.key);
	model.delete(column.key);
	tidyGrid(model, grid?.key);
}

/** A grid of one column becomes that column's blocks, in its place; an empty grid goes. */
function tidyGrid(model: NoteModel, gridKey: string | undefined): void {
	const grid = gridKey ? model.get(gridKey) : undefined;
	if (!grid || grid.type !== 'Grid' || grid.childList.length > 1) return;
	if (grid.childList.length === 1) spreadColumn(model, grid.childList[0]!.key, grid.key);
	model.delete(grid.key);
}

/** A column's blocks where the column (or `placeKey`) is, and the column goes. */
function spreadColumn(model: NoteModel, columnKey: string, placeKey = columnKey): void {
	const column = model.get(columnKey);
	if (!column) return;
	const place = model.placeOf(placeKey);
	let afterKey = placeKey;
	for (const child of [...column.childList]) {
		model.move(child.key, place.parentKey, afterKey);
		afterKey = child.key;
	}
	model.delete(columnKey);
}
