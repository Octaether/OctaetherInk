// Block actions shared by the editor, menus, hotkeys, and drag and drop. Each one is a single
// undo step built from model operations.

import { type BlockNode, createBlockNode, createTextNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';

const markerPattern = /^(?:(#{1,6})[ \t]+|([-*+])[ \t]+(\[[ xX]\][ \t]+)?|(\d{1,9})([.)])[ \t]+(\[[ xX]\][ \t]+)?|>[ \t]?)/;

/** Splits `- [ ] text` into its marker and text. */
export function splitMarker(body: string): { marker: string; text: string } {
	const match = markerPattern.exec(body);
	return match ? { marker: match[0], text: body.slice(match[0].length) } : { marker: '', text: body };
}

/** The marker the next block gets after Enter: bullets repeat, numbers count up, tasks restart open. */
export function nextMarker(marker: string): string {
	const match = markerPattern.exec(marker);
	if (!match) return '';
	if (match[1]) return '';
	if (match[2]) return `${match[2]} ${match[3] ? '[ ] ' : ''}`;
	if (match[4]) return `${Number(match[4]) + 1}${match[5]} ${match[6] ? '[ ] ' : ''}`;
	return marker.startsWith('>') ? '> ' : '';
}

/** Blocks in reading order (depth first). */
export function orderedList(model: NoteModel): BlockNode[] {
	const list: BlockNode[] = [];
	const walk = (nodeList: readonly BlockNode[]): void => {
		for (const node of nodeList) {
			list.push(node);
			walk(node.childList);
		}
	};
	walk(model.document.itemList);
	return list;
}

export function neighbourKey(model: NoteModel, key: string, step: -1 | 1, accept: (node: BlockNode) => boolean = () => true): string | undefined {
	const list = orderedList(model);
	for (let index = list.findIndex((node) => node.key === key) + step; index >= 0 && index < list.length; index += step) {
		if (accept(list[index]!)) return list[index]!.key;
	}
	return undefined;
}

const listLikePattern = /^([-*+]|\d{1,9}[.)])[ \t]/;

/** Enter inside a text block: the text after the caret becomes a new block below. Returns where to edit next. */
export function splitText(model: NoteModel, key: string, at: number): { key: string; caret: number } {
	const body = model.bodyOf(key);
	const { marker, text } = splitMarker(body);
	const place = model.placeOf(key);
	if (marker && text.trim() === '') {
		// Enter on an empty list item ends the list: leave the nesting, or become a paragraph
		const parent = model.parentOf(key);
		if (parent && parent.type === 'Text' && listLikePattern.test(parent.body)) {
			outdentBlock(model, key);
			return { key, caret: model.bodyOf(key).length };
		}
		model.setBody(key, '');
		return { key, caret: 0 };
	}
	if (at <= marker.length && body !== '') {
		// caret before the words: open an empty block above and stay here
		const above = listLikePattern.test(marker) ? nextMarker(marker).replace(/^\d+/, (number) => String(Number(number) - 1)) : '';
		model.insert(place.parentKey, place.index > 0 ? place.list[place.index - 1]!.key : null, createTextNode(above));
		return { key, caret: at };
	}
	const carry = nextMarker(marker);
	let newKey = '';
	model.transact(() => {
		model.setBody(key, body.slice(0, at));
		newKey = model.insert(place.parentKey, key, createTextNode(carry + body.slice(at)));
	});
	return { key: newKey, caret: carry.length };
}

/** Backspace at the very start of a text block. Returns where the caret goes, or undefined to do nothing. */
export function mergeBackward(model: NoteModel, key: string): { key: string; caret: number } | undefined {
	const node = model.get(key);
	if (!node) return undefined;
	const { marker, text } = splitMarker(node.body);
	if (marker) {
		// first remove the marker: a list item or heading becomes a paragraph
		model.setBody(key, text);
		return { key, caret: 0 };
	}
	const previousKey = neighbourKey(model, key, -1, (candidate) => candidate.type === 'Text');
	if (!previousKey) return undefined;
	const previous = model.get(previousKey)!;
	if (model.parentOf(key)?.key !== model.parentOf(previousKey)?.key && node.childList.length > 0) return undefined;
	const caret = previous.body.length;
	model.transact(() => {
		model.setBody(previousKey, previous.body + node.body);
		let afterKey: string | null = previous.childList.at(-1)?.key ?? null;
		for (const child of [...node.childList]) {
			model.move(child.key, previousKey, afterKey);
			afterKey = child.key;
		}
		model.delete(key);
	});
	return { key: previousKey, caret };
}

/** Tab: nest the block under the block above it. */
export function indentBlock(model: NoteModel, key: string): boolean {
	const place = model.placeOf(key);
	const previous = place.list[place.index - 1];
	if (!previous || previous.content !== 'Item') return false;
	model.move(key, previous.key, previous.childList.at(-1)?.key ?? null);
	return true;
}

/** Shift+Tab: move the block out of its parent, right after it. */
export function outdentBlock(model: NoteModel, key: string): boolean {
	const parent = model.parentOf(key);
	if (!parent) return false;
	const grand = model.parentOf(parent.key);
	model.move(key, grand?.key ?? null, parent.key);
	return true;
}

export function moveBlock(model: NoteModel, key: string, step: -1 | 1): boolean {
	const place = model.placeOf(key);
	if (step === -1) {
		if (place.index === 0) return false;
		model.move(key, place.parentKey, place.index >= 2 ? place.list[place.index - 2]!.key : null);
	} else {
		const next = place.list[place.index + 1];
		if (!next) return false;
		model.move(key, place.parentKey, next.key);
	}
	return true;
}

export function duplicateBlock(model: NoteModel, key: string): string {
	const node = model.get(key)!;
	return model.insert(model.placeOf(key).parentKey, key, node);
}

/** Inserts a template (OI source; '' = empty paragraph) after `afterKey`. Returns the new top keys. */
export function insertTemplate(model: NoteModel, parentKey: string | null, afterKey: string | null, source: string): string[] {
	const nodeList = source === '' ? [createTextNode('')] : model.parseFragment(source);
	const keyList: string[] = [];
	model.transact(() => {
		let after = afterKey;
		for (const node of nodeList) {
			after = model.insert(parentKey, after, node);
			keyList.push(after);
		}
	});
	return keyList;
}

function percentOf(node: BlockNode): number | undefined {
	const width = node.property.get('Width');
	return typeof width === 'string' && /^\d+(?:\.\d+)?%$/.test(width) ? parseFloat(width) : undefined;
}

/**
 * Adds a column beside a column (or at the end of a grid) and returns the new column's key.
 * A column on its own is first put in a grid where it stands, so the two sit side by side.
 * When every column has a `Width` in %, the new one gets the average share and all are scaled
 * back to 100%, so the existing columns keep their proportions.
 */
export function addColumn(model: NoteModel, key: string, side: 'Left' | 'Right', source = 'Column:\n\tNew column'): string {
	const node = model.get(key)!;
	let columnKey = '';
	model.transact(() => {
		let gridKey = key;
		let afterKey: string | null = side === 'Right' ? (node.childList.at(-1)?.key ?? null) : null;
		if (node.type !== 'Grid') {
			const parent = model.parentOf(key);
			if (parent?.type === 'Grid') gridKey = parent.key;
			else {
				const place = model.placeOf(key);
				gridKey = model.insert(place.parentKey, place.index > 0 ? place.list[place.index - 1]!.key : null, createBlockNode('Grid'));
				model.move(key, gridKey, null);
			}
			const place = model.placeOf(key);
			afterKey = side === 'Right' ? key : place.index > 0 ? place.list[place.index - 1]!.key : null;
		}
		columnKey = insertTemplate(model, gridKey, afterKey, source)[0]!;
		const otherList = model.childListOf(gridKey).filter((child) => child.key !== columnKey && child.type === 'Column');
		const shareList = otherList.map(percentOf);
		if (otherList.length === 0 || shareList.some((share) => share === undefined)) return;
		const total = (shareList as number[]).reduce((sum, share) => sum + share, 0);
		const added = total / otherList.length;
		const round = (share: number): string => `${Math.round((share / (total + added)) * 1000) / 10}%`;
		otherList.forEach((child, index) => model.setProperty(child.key, 'Width', round(shareList[index]!)));
		model.setProperty(columnKey, 'Width', round(added));
	});
	return columnKey;
}

/** Changes a block's kind. Text kinds keep the words; other kinds replace the block (children move along). */
export function turnInto(model: NoteModel, key: string, source: string): string {
	const node = model.get(key)!;
	const template = source === '' ? [createTextNode('')] : model.parseFragment(source);
	const first = template[0];
	if (!first) return key;
	const oldText = node.type === 'Text' ? splitMarker(node.body).text : node.body;
	if (node.type === 'Text' && first.type === 'Text' && template.length === 1 && first.childList.length === 0) {
		model.setBody(key, splitMarker(first.body).marker + oldText);
		return key;
	}
	let newKey = key;
	model.transact(() => {
		const place = model.placeOf(key);
		if (first.content === 'Raw' && oldText.trim() !== '' && first.body === '') {
			first.body = oldText;
			first.rawLineList = undefined;
			first.headLineList = undefined;
		}
		newKey = model.insert(place.parentKey, key, first);
		if (first.content === 'Item') {
			let afterKey: string | null = model.get(newKey)!.childList.at(-1)?.key ?? null;
			for (const child of [...node.childList]) {
				model.move(child.key, newKey, afterKey);
				afterKey = child.key;
			}
		} else {
			let afterKey = newKey;
			for (const child of [...node.childList]) {
				model.move(child.key, place.parentKey, afterKey);
				afterKey = child.key;
			}
		}
		model.delete(key);
	});
	return newKey;
}

// ---------------------------------------------------------------- inline format

export type FormatKind = 'Bold' | 'Italic' | 'Strike' | 'Highlight' | 'Code' | 'Math' | 'Link';

const wrapMap: Readonly<Record<FormatKind, readonly [string, string]>> = {
	Bold: ['**', '**'],
	Italic: ['*', '*'],
	Strike: ['~~', '~~'],
	Highlight: ['==', '=='],
	Code: ['`', '`'],
	// every inline block is written {Name: …}, math included
	Math: ['{Math: ', '}'],
	Link: ['[', '](https://)'],
};

/** Wraps (or unwraps, when already wrapped) the range [start, end) of `text`. */
export function toggleFormat(text: string, start: number, end: number, kind: FormatKind): { text: string; start: number; end: number } {
	const [open, close] = wrapMap[kind];
	if (kind !== 'Link' && text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
		return { text: text.slice(0, start - open.length) + text.slice(start, end) + text.slice(end + close.length), start: start - open.length, end: end - open.length };
	}
	const inner = text.slice(start, end);
	if (kind !== 'Link' && inner.startsWith(open) && inner.endsWith(close) && inner.length >= open.length + close.length) {
		const bare = inner.slice(open.length, inner.length - close.length);
		return { text: text.slice(0, start) + bare + text.slice(end), start, end: start + bare.length };
	}
	return { text: text.slice(0, start) + open + inner + close + text.slice(end), start: start + open.length, end: end + open.length };
}

/** Colours the range with a styled span `[text]{Color: Token}` (or removes the colour with `undefined`). */
export function colorRange(text: string, start: number, end: number, color: string | undefined): { text: string; start: number; end: number } {
	const inner = text.slice(start, end);
	const existing = /^\[([^\]]*)\]\{Color: [A-Za-z0-9.#]+\}$/.exec(inner);
	const bare = existing ? existing[1]! : inner;
	if (!color) return { text: text.slice(0, start) + bare + text.slice(end), start, end: start + bare.length };
	const wrapped = `[${bare}]{Color: ${color}}`;
	return { text: text.slice(0, start) + wrapped + text.slice(end), start: start + 1, end: start + 1 + bare.length };
}
