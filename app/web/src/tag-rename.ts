// A tag renamed everywhere in the vault: in a note's Tag property (its Property block and its ---
// header), as #Tag in text, and in the Tag columns of tables. Each note changes through its model, so
// an open note takes it as one undo step and a closed one is written back.

import { getSectionValue, parsePropertySection, serializeSection, setSectionValue, type PropertyValue } from '@octaether/core-format';
import type { NoteIndex } from '@octaether/core-sdk';
import { renameTagInTable } from '@octaether/module-table';

/** Blocks whose text may hold #tags. */
const textTypeSet = new Set(['Text', 'Callout', 'Markdown']);

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** How a tag is written in text: `#Organic`, or `#[Ada Lovelace]` when it holds more than a word's letters. */
export function inlineTag(tag: string): string {
	return /^[\p{L}\p{N}_\-/]+$/u.test(tag) && /[^\p{N}]/u.test(tag) ? `#${tag}` : `#[${tag}]`;
}

/** Text with #from (and #[from]) written as the new tag; the same text when there is none. */
export function renameInlineTag(text: string, from: string, to: string): string {
	const name = escapeRegExp(from);
	return text
		.replace(new RegExp(`#\\[${name}\\]`, 'giu'), inlineTag(to))
		.replace(new RegExp(`(?<![\\p{L}\\p{N}_&#])#${name}(?![\\p{L}\\p{N}_\\-/])`, 'giu'), inlineTag(to));
}

function renameList(value: PropertyValue | undefined, from: string, to: string): PropertyValue[] | undefined {
	const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : undefined;
	if (!list || !list.some((item) => typeof item === 'string' && same(item, from))) return undefined;
	const next: PropertyValue[] = [];
	for (const item of list) {
		const named = typeof item === 'string' && same(item, from) ? to : item;
		// the new name may be a tag the note had already: once is enough
		if (typeof named === 'string' && next.some((other) => typeof other === 'string' && same(other, named))) continue;
		next.push(named);
	}
	return next;
}

/** A Property block's text with its Tag list renamed; undefined when it has no such tag. */
export function renamePropertyTag(body: string, from: string, to: string): string | undefined {
	const section = parsePropertySection(body.split('\n'));
	const next = renameList(getSectionValue(section, 'Tag'), from, to);
	if (!next) return undefined;
	setSectionValue(section, 'Tag', next);
	return serializeSection(section).join('\n');
}

export interface TagRenameResult {
	noteList: string[];
}

/** Renames a tag in every note of the vault; resolves to the notes that changed. With `dryRun`, only counts them. */
export async function renameTagEverywhere(index: NoteIndex, from: string, to: string, dryRun = false): Promise<TagRenameResult> {
	const noteList: string[] = [];
	for (const summary of index.noteList()) {
		const model = await index.modelOf(summary.path);
		if (!model) continue;
		const work: (() => void)[] = [];
		const header = renameList(model.noteProperty('Tag'), from, to);
		if (header) work.push(() => model.setNoteProperty('Tag', header));
		for (const key of model.keyList()) {
			const node = model.get(key);
			if (!node) continue;
			const body = model.bodyOf(key);
			if (node.type === 'Property') {
				const next = renamePropertyTag(body, from, to);
				if (next !== undefined) work.push(() => model.setBody(key, next));
			} else if (node.type === 'Table') {
				const next = renameTagInTable(node.property, body, from, to);
				if (next) {
					work.push(() => {
						model.setProperty(key, 'Column', next.property.get('Column'));
						model.setBody(key, next.body);
					});
				}
			} else if (textTypeSet.has(node.type)) {
				const next = renameInlineTag(body, from, to);
				if (next !== body) work.push(() => model.setBody(key, next));
			}
		}
		if (work.length === 0) continue;
		noteList.push(summary.path);
		if (!dryRun) model.transact(() => work.forEach((step) => step()));
	}
	return { noteList };
}
