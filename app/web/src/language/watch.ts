// Translates what the app draws, as it is drawn, for a language other than English (loaded with it).

import { lookup } from '@octaether/core-sdk';

// ---------------------------------------------------------------- what is drawn

/**
 * Where the words are yours, not the app's: notes, file names, tabs, lists of notes. Nothing in
 * there is looked up, so a note called "Search" keeps its name. Menus and messages are translated
 * where they are made (they mix both), and fields hold what you typed.
 */
const ownSelector = '.oi-note, .tree-name, .vault-name, .search-result, .tab-title, .view-title, .start-recent, .menu, .toast, .palette-list, .note-head, .file-view, .graph-host, [data-oi-literal], textarea, kbd, code, script, style, title';
const attributeList = ['title', 'aria-label', 'placeholder'] as const;

/** A tooltip is often the app's words and a key after them, `Bold (Ctrl+B)`: the words are translated, the key stays. */
function translate(text: string): string | undefined {
	const keyed = /^(.+?) (\((?:Ctrl|Alt|Shift|Mod|Esc|Enter|F\d|⌘|⌥|⇧)[^()]*\))$/.exec(text);
	if (!keyed) return lookup(text);
	const base = lookup(keyed[1]!);
	return base === undefined ? undefined : `${base} ${keyed[2]}`;
}

function localizeNode(node: Node): void {
	if (node.nodeType === Node.TEXT_NODE) {
		const raw = node.nodeValue ?? '';
		const text = raw.trim();
		if (text.length < 2) return;
		const found = translate(text);
		if (found !== undefined) node.nodeValue = raw.replace(text, found);
		return;
	}
	if (!(node instanceof Element) || node.closest(ownSelector)) return;
	for (const name of attributeList) {
		const value = node.getAttribute(name);
		const found = value ? translate(value) : undefined;
		if (found !== undefined) node.setAttribute(name, found);
	}
	if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) {
		// a list's choices are the app's words; what a field holds is yours
		if (node instanceof HTMLSelectElement) for (const option of node.options) if (!option.hasAttribute('data-oi-literal')) localizeNode(option.firstChild ?? option);
		return;
	}
	for (const child of [...node.childNodes]) {
		if (child.nodeType === Node.TEXT_NODE) localizeNode(child);
		else if (child instanceof Element && !child.matches(ownSelector)) localizeNode(child);
	}
}

/** Translates what is drawn under `root` now (the app's own words there; see `ownSelector`). */
export function localize(root: Node = document.body): void {
	if (root.nodeType === Node.TEXT_NODE) {
		if (!root.parentElement?.closest(ownSelector)) localizeNode(root);
	} else localizeNode(root);
}

let watching = false;

/** From now on, whatever the app draws is translated before it is seen. */
export function watch(): void {
	if (watching || typeof MutationObserver === 'undefined') return;
	watching = true;
	let busy = false;
	const observer = new MutationObserver((recordList) => {
		if (busy) return;
		busy = true;
		for (const record of recordList) {
			if (record.type === 'childList') for (const node of record.addedNodes) localize(node);
			else if (record.type === 'characterData') localize(record.target);
			else if (record.target instanceof Element && !record.target.closest(ownSelector)) {
				const value = record.attributeName ? record.target.getAttribute(record.attributeName) : null;
				const found = value ? translate(value) : undefined;
				if (found !== undefined && record.attributeName) record.target.setAttribute(record.attributeName, found);
			}
		}
		// what was just written here is not news
		observer.takeRecords();
		busy = false;
	});
	observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...attributeList] });
	localize(document.body);
}
