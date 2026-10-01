// Maps a point or a DOM selection inside a rendered block to an offset in the block's source.
// Renderers mark pieces with data-oi-s (source start) and, when the piece doesn't map 1:1,
// data-oi-e (source end). Works in Chromium, WebKit (caretRangeFromPoint) and Gecko
// (caretPositionFromPoint).

export interface DomPosition {
	node: Node;
	offset: number;
}

type CaretDocument = Document & {
	caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
	caretRangeFromPoint?(x: number, y: number): Range | null;
};

export function caretFromPoint(x: number, y: number): DomPosition | undefined {
	const target = document as CaretDocument;
	try {
		if (target.caretPositionFromPoint) {
			const position = target.caretPositionFromPoint(x, y);
			if (position) return { node: position.offsetNode, offset: position.offset };
		}
		if (target.caretRangeFromPoint) {
			const range = target.caretRangeFromPoint(x, y);
			if (range) return { node: range.startContainer, offset: range.startOffset };
		}
	} catch {
		// some engines throw for points outside the document
	}
	return undefined;
}

function textNodeList(root: Node): Text[] {
	const list: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let current = walker.nextNode(); current; current = walker.nextNode()) list.push(current as Text);
	return list;
}

/** Turns "between child nodes" positions into a position inside a text node. */
function toTextPosition(position: DomPosition): { node: Text; offset: number } | undefined {
	if (position.node.nodeType === Node.TEXT_NODE) return { node: position.node as Text, offset: position.offset };
	const childList = position.node.childNodes;
	const after = childList[position.offset];
	const first = after ? textNodeList(after)[0] : undefined;
	if (first) return { node: first, offset: 0 };
	const before = childList[position.offset - 1];
	const last = before ? textNodeList(before).at(-1) : undefined;
	if (last) return { node: last, offset: last.length };
	const inside = textNodeList(position.node);
	return inside[0] ? { node: inside[0], offset: 0 } : undefined;
}

/** Source offset for a DOM position inside a block's content, or undefined when nothing is marked there. */
export function sourceOffset(content: HTMLElement, position: DomPosition): number | undefined {
	if (!content.contains(position.node)) return undefined;
	const text = toTextPosition(position);
	if (!text || !content.contains(text.node)) return undefined;
	const marked = text.node.parentElement?.closest<HTMLElement>('[data-oi-s]');
	if (!marked || !content.contains(marked)) return undefined;
	const start = Number(marked.dataset.oiS);
	if (!Number.isFinite(start)) return undefined;
	let inside = 0;
	for (const node of textNodeList(marked)) {
		if (node === text.node) {
			inside += text.offset;
			break;
		}
		inside += node.length;
	}
	const rendered = marked.textContent ?? '';
	const end = marked.dataset.oiE !== undefined ? Number(marked.dataset.oiE) : start + rendered.length;
	// 1:1 pieces map character by character; others snap to the nearer edge
	if (end - start === rendered.length) return start + Math.min(inside, rendered.length);
	return inside < rendered.length / 2 ? start : end;
}

/** Source offset under a point, falling back to the nearest marked element of `target`. */
export function sourceOffsetAtPoint(content: HTMLElement, x: number, y: number, target: Element | null): number | undefined {
	const position = caretFromPoint(x, y);
	const offset = position ? sourceOffset(content, position) : undefined;
	if (offset !== undefined) return offset;
	const marked = target?.closest<HTMLElement>('[data-oi-s]');
	if (marked && content.contains(marked)) return Number(marked.dataset.oiS);
	return undefined;
}

/** The source range of the current DOM selection when it lies inside one block's content. */
export function sourceRangeOfSelection(content: HTMLElement): { start: number; end: number } | undefined {
	const selection = document.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
	const range = selection.getRangeAt(0);
	const start = sourceOffset(content, { node: range.startContainer, offset: range.startOffset });
	const end = sourceOffset(content, { node: range.endContainer, offset: range.endOffset });
	if (start === undefined || end === undefined || start === end) return undefined;
	return { start: Math.min(start, end), end: Math.max(start, end) };
}
