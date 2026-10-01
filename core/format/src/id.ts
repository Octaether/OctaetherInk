// IDs are optional. A block gets a persistent `^id` only when something needs to point at
// it (a link, stored ink data). Generated IDs are lowercase so they are safe as file names on
// case-insensitive disks. Note IDs are lowercase ULIDs (time-sortable, 26 chars).

import { type BlockNode, type NoteDocument, markChanged, walkNode } from './document';
import { type PropertySection, getSectionValue, setSectionValue } from './property';

const blockAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const ulidAlphabet = '0123456789abcdefghjkmnpqrstvwxyz';

export const formatName = 'Oi 1';

function randomText(length: number, alphabet: string): string {
	const byteList = new Uint8Array(length);
	globalThis.crypto.getRandomValues(byteList);
	let text = '';
	for (const byte of byteList) text += alphabet[byte % alphabet.length];
	return text;
}

export function createBlockId(taken: ReadonlySet<string> = new Set(), length = 4): string {
	for (let attempt = 0; ; attempt++) {
		const id = randomText(length + Math.floor(attempt / 32), blockAlphabet);
		if (/[a-z]/.test(id) && !taken.has(id)) return id;
	}
}

export function createNoteId(time: number = Date.now()): string {
	let timeText = '';
	let rest = Math.floor(time);
	for (let index = 0; index < 10; index++) {
		timeText = ulidAlphabet[rest % 32] + timeText;
		rest = Math.floor(rest / 32);
	}
	return timeText + randomText(16, ulidAlphabet);
}

export function collectIdSet(document: NoteDocument): Set<string> {
	const taken = new Set<string>();
	walkNode(document.itemList, (node) => {
		if (node.id) taken.add(node.id);
	});
	return taken;
}

/** Gives one block a persistent ID (for a link or stored data) and returns it. */
export function assignBlockId(document: NoteDocument, node: BlockNode): string {
	if (node.id) return node.id;
	node.id = createBlockId(collectIdSet(document));
	markChanged(document, node);
	return node.id;
}

/** Ensures the note has `Id` and `Format` properties (added at the end, system fields last). */
export function ensureNoteProperty(document: NoteDocument): boolean {
	const section: PropertySection = document.front ?? { level: 0, entryList: [], problemList: [] };
	let changed = false;
	if (getSectionValue(section, 'Id') === undefined) {
		const formatValue = getSectionValue(section, 'Format');
		if (formatValue !== undefined) setSectionValue(section, 'Format', undefined);
		setSectionValue(section, 'Id', createNoteId());
		setSectionValue(section, 'Format', formatValue ?? formatName);
		changed = true;
	} else if (getSectionValue(section, 'Format') === undefined) {
		setSectionValue(section, 'Format', formatName);
		changed = true;
	}
	if (changed && !document.front) {
		document.front = section;
		const first = document.itemList[0];
		if (first && first.gapLineList && first.gapLineList.length === 0) first.gapLineList = [''];
	}
	return changed;
}
