// Reading a table for another block (TableData), loaded when a Plot or a Calendar first asks.

import { type BlockNode, parseNote } from '@octaether/core-format';
import { type NoteIndex, type RenderContext, type TableSnapshot, linkedBlock, linkedProperty, noteIndexExtension } from '@octaether/core-sdk';
import { findTableNode, parseReference } from './reference';
import { readTable, snapshotOf } from './table';

async function findTable(context: RenderContext, reference: string): Promise<{ node: BlockNode; path: string | undefined } | undefined> {
	const parsed = parseReference(reference);
	if (!parsed) return undefined;
	const index = context.extension<NoteIndex>(noteIndexExtension);
	const here = index?.pathOf(context.note);
	if (!parsed.note) {
		const node = findTableNode(context.note.document.itemList, parsed);
		return node ? { node, path: here } : undefined;
	}
	const path = index?.resolve(parsed.note, here);
	if (!index || !path) return undefined;
	const text = await index.readNote(path);
	if (text === undefined) return undefined;
	const node = findTableNode(parseNote(text).itemList, parsed);
	return node ? { node, path } : undefined;
}

export async function readTableData(context: RenderContext, reference: string): Promise<TableSnapshot | undefined> {
	const found = await findTable(context, reference);
	if (!found) return undefined;
	const noteList = context.extension<NoteIndex>(noteIndexExtension)?.noteList() ?? [];
	// a Table that shows one of another note (From): that one's rows, its own settings on top
	const from = found.node.property.get('From');
	if (typeof from === 'string' && from.trim()) {
		const linked = await linkedBlock(context, from, 'Table');
		const node = linked?.model.get(linked.key);
		if (!linked || !node) return undefined;
		return snapshotOf(readTable(linkedProperty(found.node.property, node.property), node.body, noteList, linked.path));
	}
	return snapshotOf(readTable(found.node.property, found.node.body, noteList, found.path));
}
