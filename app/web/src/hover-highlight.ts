// Shows where a click will land before you click: the character under the pointer in text and
// code gets a small highlight (math, chemistry, and diagrams light up their own pieces through
// the same color, `--oi-hover`). Only in the Edit view; Setting → Appearance switches it off
// or changes the color.

import type { RenderHost } from '@octaether/core-render';

export interface HoverHighlightOption {
	host: RenderHost;
	/** On (the setting, and the Edit view). */
	enabled(): boolean;
}

/** The text position under a point (caretPositionFromPoint, or WebKit's caretRangeFromPoint). */
function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
	const withPosition = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
	const position = withPosition.caretPositionFromPoint?.(x, y);
	if (position) return { node: position.offsetNode, offset: position.offset };
	const range = (document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }).caretRangeFromPoint?.(x, y);
	return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
}

/** The box of the character under the point: the one after the caret, or the one before it. */
function characterRect(node: Text, offset: number, x: number, y: number): DOMRect | undefined {
	for (const at of [offset, offset - 1]) {
		if (at < 0 || at >= node.data.length) continue;
		if (/\s/.test(node.data[at]!)) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + 1);
		for (const rect of range.getClientRects()) {
			if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1 && rect.width > 0) return rect;
		}
	}
	return undefined;
}

export function setupHoverHighlight(option: HoverHighlightOption): { hide(): void } {
	const box = document.createElement('div');
	box.className = 'hover-character';
	box.hidden = true;
	box.setAttribute('aria-hidden', 'true');
	document.getElementById('layer')!.append(box);
	let frame = 0;
	let point: { x: number; y: number } | undefined;

	const hide = (): void => {
		box.hidden = true;
	};

	const update = (): void => {
		frame = 0;
		if (!point || !option.enabled()) {
			hide();
			return;
		}
		const target = document.elementFromPoint(point.x, point.y);
		// text and code pieces that copy their source one to one; math and drawings have their own highlight
		const piece = target?.closest<HTMLElement>('[data-oi-s]');
		if (!target || !piece || !option.host.root.contains(piece) || piece.hasAttribute('data-oi-e') || piece.closest('math, svg, [data-oi-editing], [data-oi-interactive], .oi-read-only')) {
			hide();
			return;
		}
		const caret = caretAt(point.x, point.y);
		if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !piece.contains(caret.node)) {
			hide();
			return;
		}
		const rect = characterRect(caret.node as Text, caret.offset, point.x, point.y);
		if (!rect) {
			hide();
			return;
		}
		box.style.left = `${rect.left}px`;
		box.style.top = `${rect.top}px`;
		box.style.width = `${rect.width}px`;
		box.style.height = `${rect.height}px`;
		box.hidden = false;
	};

	document.addEventListener(
		'pointermove',
		(event) => {
			if (event.pointerType !== 'mouse') return;
			point = { x: event.clientX, y: event.clientY };
			if (!frame) frame = requestAnimationFrame(update);
		},
		{ passive: true },
	);
	document.addEventListener('pointerleave', hide);
	document.getElementById('viewContent')?.addEventListener('scroll', hide, { passive: true });
	// a click opens the editor, which has its own caret
	option.host.root.addEventListener('pointerdown', hide);
	return { hide };
}
