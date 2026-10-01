// Hover gutter (+ add, ⋮⋮ drag or menu), drag and drop to reorder or nest, right-click and
// long-press menus. Pointer Events only, so mouse, touch, and pen all work.
//
//   where it drops   found from the pointer's height alone (the pointer can be anywhere left or
//                    right of the text); move right over a block to drop inside it
//   what you see     a copy of the block follows the pointer, the block you drag and the one you
//                    drop into get outlines, and a line shows the exact spot; the page scrolls
//                    near the top and bottom edges
//   right column     moving from a block toward its handle keeps that block, even across the
//                    column next to it

import type { EditSession } from '@octaether/core-edit';
import type { NoteModel } from '@octaether/core-model';
import type { RenderHost } from '@octaether/core-render';

export interface GutterOption {
	host: RenderHost;
	session: EditSession;
	model(): NoteModel | undefined;
	readOnly(): boolean;
	/** + was pressed: offer blocks to add below `key`. */
	onAdd(key: string, x: number, y: number): void;
	/** ⋮⋮ clicked, right-click, or long-press: the block menu. */
	onMenu(key: string, x: number, y: number): void;
}

type DropMode = 'Before' | 'After' | 'Into' | 'First';
type Drop = { mode: DropMode; key: string };

export function setupGutter(option: GutterOption): { hide(): void } {
	const { host } = option;
	const gutter = document.getElementById('gutter')!;
	const addButton = document.getElementById('gutterAdd')!;
	const handle = document.getElementById('gutterHandle')!;
	const dropLine = document.getElementById('dropLine')!;
	const view = document.getElementById('viewContent');
	let hoverKey: string | undefined;
	let hideTimer: number | undefined;
	let markedFrame: HTMLElement | undefined;

	/** Outlines the block the gutter belongs to while the pointer is on the gutter (and while dragging). */
	const mark = (on: boolean): void => {
		markedFrame?.classList.remove('oi-gutter-target');
		markedFrame = on && hoverKey ? host.frameOf(hoverKey) : undefined;
		markedFrame?.classList.add('oi-gutter-target');
	};

	const firstLineRect = (frame: HTMLElement): DOMRect => {
		const content = frame.querySelector<HTMLElement>(':scope > .oi-content');
		const rect = content?.getBoundingClientRect();
		return rect && rect.height > 0 ? rect : frame.getBoundingClientRect();
	};

	const show = (key: string): void => {
		const frame = host.frameOf(key);
		if (!frame || option.readOnly()) return;
		hoverKey = key;
		const rect = frame.getBoundingClientRect();
		const line = firstLineRect(frame);
		gutter.hidden = false;
		gutter.style.left = `${Math.max(2, rect.left - gutter.offsetWidth - 4)}px`;
		gutter.style.top = `${line.top + Math.min(Math.max((Math.min(line.height, 40) - 24) / 2, 0), 8)}px`;
	};
	const hide = (): void => {
		mark(false);
		gutter.hidden = true;
		hoverKey = undefined;
	};
	gutter.addEventListener('pointerenter', () => mark(true));
	gutter.addEventListener('pointerleave', () => {
		if (!dragKey) mark(false);
	});

	/** The strip between the gutter and its block: the pointer may cross other blocks there. */
	const inCorridor = (x: number, y: number): boolean => {
		if (!hoverKey || gutter.hidden) return false;
		const frame = host.frameOf(hoverKey);
		if (!frame) return false;
		const box = gutter.getBoundingClientRect();
		const rect = frame.getBoundingClientRect();
		const top = Math.min(box.top, rect.top) - 6;
		const bottom = Math.max(box.bottom, Math.min(rect.bottom, box.bottom + 24)) + 6;
		return x >= box.left - 6 && x <= rect.left + 8 && y >= top && y <= bottom;
	};

	let pointer: { x: number; y: number } | undefined;
	let scrollTimer: number | undefined;

	document.addEventListener('pointermove', (event) => {
		if (event.pointerType !== 'mouse') return;
		pointer = { x: event.clientX, y: event.clientY };
		if (dragKey || option.readOnly()) return;
		const target = event.target as Element | null;
		if (!target) return;
		if (gutter.contains(target) || inCorridor(event.clientX, event.clientY)) {
			window.clearTimeout(hideTimer);
			return;
		}
		const key = host.root.contains(target) ? host.keyAt(target) : undefined;
		if (key) {
			window.clearTimeout(hideTimer);
			if (key !== hoverKey) show(key);
			return;
		}
		window.clearTimeout(hideTimer);
		hideTimer = window.setTimeout(() => {
			if (!dragKey) hide();
		}, 300);
	});
	view?.addEventListener(
		'scroll',
		() => {
			if (dragKey) return;
			hide();
			// when the page stops scrolling under a resting mouse, the gutter comes back for the block there
			window.clearTimeout(scrollTimer);
			scrollTimer = window.setTimeout(() => {
				if (!pointer || dragKey || option.readOnly()) return;
				const target = document.elementFromPoint(pointer.x, pointer.y);
				const key = target && host.root.contains(target) ? host.keyAt(target) : undefined;
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

	const target = (x: number, y: number): Drop | undefined => {
		const model = option.model();
		if (!model || !dragKey) return undefined;
		const frame = frameAt(x, y);
		if (!frame) return undefined;
		const key = frame.dataset.oiKey!;
		const node = model.get(key);
		const dragged = model.get(dragKey);
		if (!node || !dragged || key === dragKey) return undefined;
		const rect = frame.getBoundingClientRect();
		const content = firstLineRect(frame);
		const holder = node.content === 'Item' && !frame.classList.contains('oi-heading');
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
		if (!value) {
			dropLine.hidden = true;
			return;
		}
		const frame = host.frameOf(value.key)!;
		const rect = frame.getBoundingClientRect();
		const content = firstLineRect(frame);
		dropLine.hidden = false;
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

	const moveGhost = (x: number, y: number): void => {
		if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
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
			for (const element of copy.querySelectorAll('[data-oi-key]')) element.removeAttribute('data-oi-key');
			ghost.style.width = `${Math.min(frame.getBoundingClientRect().width, 460)}px`;
			ghost.append(copy);
			document.getElementById('layer')!.append(ghost);
		}
		gutter.classList.add('gutter-dragging');
		scrollFrame = requestAnimationFrame(autoScroll);
	};

	handle.addEventListener('pointerdown', (event) => {
		if (!hoverKey || event.button !== 0) return;
		event.preventDefault();
		option.session.close();
		dragKey = hoverKey;
		dragging = false;
		start = { x: event.clientX, y: event.clientY };
		last = start;
		handle.setPointerCapture(event.pointerId);
	});
	handle.addEventListener('pointermove', (event) => {
		if (!dragKey) return;
		last = { x: event.clientX, y: event.clientY };
		if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) begin();
		if (!dragging) return;
		moveGhost(event.clientX, event.clientY);
		showDrop(target(event.clientX, event.clientY));
	});
	const finish = (event: PointerEvent): void => {
		if (!dragKey) return;
		const key = dragKey;
		dragKey = undefined;
		cancelAnimationFrame(scrollFrame);
		host.frameOf(key)?.classList.remove('oi-dragging');
		document.body.classList.remove('dragging');
		gutter.classList.remove('gutter-dragging');
		mark(false);
		ghost?.remove();
		ghost = undefined;
		const place = drop;
		showDrop(undefined);
		if (!dragging) {
			option.onMenu(key, event.clientX, event.clientY + 8);
			return;
		}
		dragging = false;
		const model = option.model();
		if (!model || !place || event.type === 'pointercancel') return;
		try {
			if (place.mode === 'Into') model.move(key, place.key, model.get(place.key)!.childList.at(-1)?.key ?? null);
			else if (place.mode === 'First') model.move(key, place.key, null);
			else {
				const where = model.placeOf(place.key);
				const afterKey = place.mode === 'After' ? place.key : where.index > 0 ? where.list[where.index - 1]!.key : null;
				if (afterKey !== key) model.move(key, where.parentKey, afterKey);
			}
			option.session.select(key);
			host.frameOf(key)?.scrollIntoView({ block: 'nearest' });
		} catch {
			// dropping a block into itself (or into a block that can't hold blocks) changes nothing
		}
	};
	handle.addEventListener('pointerup', finish);
	handle.addEventListener('pointercancel', finish);
	handle.addEventListener('keydown', (event) => {
		if ((event.key === 'Enter' || event.key === ' ') && hoverKey) {
			event.preventDefault();
			const rect = handle.getBoundingClientRect();
			option.onMenu(hoverKey, rect.left, rect.bottom + 4);
		}
	});

	// ---- right-click and long-press menus
	host.root.addEventListener('contextmenu', (event) => {
		const key = host.keyAt(event.target as Element);
		if (!key || option.readOnly()) return;
		event.preventDefault();
		option.onMenu(key, event.clientX, event.clientY);
	});
	let pressTimer: number | undefined;
	let pressStart = { x: 0, y: 0 };
	let swallowClick = false;
	host.root.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse' || option.readOnly()) return;
		const key = host.keyAt(event.target as Element);
		if (!key) return;
		pressStart = { x: event.clientX, y: event.clientY };
		pressTimer = window.setTimeout(() => {
			swallowClick = true;
			option.onMenu(key, pressStart.x, pressStart.y);
		}, 550);
	});
	const cancelPress = (event: PointerEvent): void => {
		if (event.type === 'pointermove' && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) < 8) return;
		window.clearTimeout(pressTimer);
	};
	host.root.addEventListener('pointermove', cancelPress);
	host.root.addEventListener('pointerup', cancelPress);
	host.root.addEventListener('pointercancel', cancelPress);
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
	return { hide };
}
