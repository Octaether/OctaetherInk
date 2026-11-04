// The vault's notes for modules (NoteIndex): a calendar shows notes by their Start or Date, a table
// lists the notes of a folder. A note's properties are its first Property block over any kept in
// its `---` header; an open note is read from its tab, so unsaved edits count. Each note's text is
// parsed once and kept until it changes.

import { type FormatOption, type PropertyMap, type PropertyValue, createBlockNode, getSectionValue, parseNote, sectionToMap, walkNode } from '@octaether/core-format';
import { NoteModel } from '@octaether/core-model';
import type { NoteIndex, NoteSummary } from '@octaether/core-sdk';
import { parentPath, stemOf } from '@octaether/core-vault';
import { entryList, setValue } from '@octaether/module-property';
import { propertyBlockOf, systemKeySet } from './note-head';
import type { Workspace } from './workspace';

interface Parsed {
	text: string;
	property: PropertyMap;
	tagList: string[];
}

/** Your properties in a note's text: the header's own keys, then its first Property block over them. */
export function propertyOfText(text: string, option: FormatOption = {}): { property: PropertyMap; tagList: string[] } {
	const document = parseNote(text, option);
	const property: PropertyMap = new Map();
	if (document.front) for (const [key, value] of sectionToMap(document.front)) if (!systemKeySet.has(key)) property.set(key, value);
	let found = false;
	walkNode(document.itemList, (node) => {
		if (found || node.type !== 'Property') return;
		found = true;
		for (const [key, value] of entryList(node.body)) property.set(key, value);
	});
	const tag = property.get('Tag');
	const tagList = (Array.isArray(tag) ? tag : typeof tag === 'string' ? [tag] : []).map(String);
	return { property, tagList };
}

/** Sets properties in a note: in its header when they are kept there, otherwise in its Property block (made at the top when missing). */
export function applyProperty(model: NoteModel, change: ReadonlyMap<string, PropertyValue | undefined>): void {
	model.transact(() => {
		for (const [key, value] of change) {
			if (model.document.front && getSectionValue(model.document.front, key) !== undefined) {
				model.setNoteProperty(key, value);
				continue;
			}
			const block = propertyBlockOf(model);
			if (block) model.setBody(block.key, setValue(block.body, key, value));
			else if (value !== undefined) model.insert(null, null, createBlockNode('Property', { body: setValue('', key, value) }));
		}
	});
}

export function createNoteIndex(option: { workspace: Workspace; formatOption(): FormatOption; newNoteText(): string; open(path: string, newTab: boolean): void }): NoteIndex {
	const { workspace } = option;
	const cache = new Map<string, Parsed>();
	const listenerSet = new Set<() => void>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const notify = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			for (const listener of [...listenerSet]) listener();
		}, 60);
	};
	// files changed, or an open note's text did (its Save state moves with every edit)
	workspace.subscribe((event) => {
		if (event === 'Tree' || event === 'Vault' || event === 'Save' || event === 'Rename') notify();
	});

	/** Notes not open in a tab that a block shows (`From`): their model, and the text last written. */
	const detachedMap = new Map<string, { model: NoteModel; written: string; writing: Promise<void> }>();

	const openModel = (path: string): NoteModel | undefined => workspace.openNoteList().find((note) => note.path === path && !note.external)?.model;

	/** A note's current text: its tab's when it is open, otherwise the vault's copy. */
	const textOf = (path: string): string | undefined => {
		const model = openModel(path);
		if (model) return model.serialize();
		return workspace.vault?.cachedText(path);
	};

	const parsed = (path: string): Parsed | undefined => {
		const text = textOf(path);
		if (text === undefined) return undefined;
		const known = cache.get(path);
		if (known?.text === text) return known;
		const { property, tagList } = propertyOfText(text, option.formatOption());
		const entry = { text, property, tagList };
		cache.set(path, entry);
		return entry;
	};

	return {
		noteList() {
			const vault = workspace.vault;
			if (!vault) return [];
			const list: NoteSummary[] = [];
			const pathList = vault.noteList();
			for (const path of [...cache.keys()]) if (!pathList.includes(path)) cache.delete(path);
			for (const path of pathList) {
				const entry = parsed(path);
				if (entry) list.push({ path, name: stemOf(path), folder: parentPath(path), property: entry.property, tagList: entry.tagList });
			}
			return list;
		},
		pathOf(note) {
			return workspace.openNoteList().find((entry) => entry.model === note && !entry.external)?.path;
		},
		subscribe(listener) {
			listenerSet.add(listener);
			return () => listenerSet.delete(listener);
		},
		async setProperty(path, change) {
			const model = openModel(path);
			if (model) {
				applyProperty(model, change);
				return;
			}
			const vault = workspace.vault;
			if (!vault?.has(path)) return;
			const other = NoteModel.fromText(await vault.read(path), option.formatOption());
			applyProperty(other, change);
			await vault.write(path, other.serialize());
		},
		async createNote({ folder, name, property, body }) {
			const vault = workspace.vault;
			if (!vault) return undefined;
			const path = vault.uniquePath(folder, name.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Untitled');
			const model = NoteModel.fromText(option.newNoteText(), option.formatOption());
			model.transact(() => {
				let after: string | null = null;
				if (property.size) {
					let propertyBody = '';
					for (const [key, value] of property) propertyBody = setValue(propertyBody, key, value);
					after = model.insert(null, null, createBlockNode('Property', { body: propertyBody }));
				}
				for (const node of body?.trim() ? model.parseFragment(body) : []) after = model.insert(null, after, node);
			});
			await vault.write(path, model.serialize());
			return path;
		},
		trashNote(path) {
			return workspace.delete(path);
		},
		async modelOf(path) {
			const open = openModel(path);
			if (open) {
				detachedMap.delete(path);
				return open;
			}
			const vault = workspace.vault;
			if (!vault?.has(path)) return undefined;
			const text = await vault.read(path);
			const known = detachedMap.get(path);
			if (known && known.written === text) return known.model;
			// not open: a model of the file, each change written back at once
			const model = NoteModel.fromText(text, option.formatOption());
			const entry = { model, written: text, writing: Promise.resolve() };
			model.subscribe(() => {
				if (detachedMap.get(path) !== entry) return;
				const next = model.serialize();
				if (next === entry.written) return;
				entry.written = next;
				entry.writing = entry.writing.then(() => vault.write(path, next)).catch(() => undefined);
			});
			detachedMap.set(path, entry);
			return model;
		},
		async readNote(path) {
			const text = textOf(path);
			if (text !== undefined) return text;
			const vault = workspace.vault;
			return vault?.has(path) ? vault.read(path) : undefined;
		},
		resolve(target, from) {
			return workspace.vault?.resolve(target, from);
		},
		findFile(source, from) {
			return workspace.vault?.findFile(source, from ?? '');
		},
		async readFile(path) {
			const vault = workspace.vault;
			return vault?.has(path) ? vault.readBinary(path).catch(() => undefined) : undefined;
		},
		async writeFile(path, data) {
			const vault = workspace.vault;
			if (!vault) return;
			if (typeof data === 'string') await vault.write(path, data);
			else await vault.writeBinary(path, data);
		},
		async createFile(folder, name, data) {
			const vault = workspace.vault;
			if (!vault) return undefined;
			return vault.addFile(folder, name, typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data);
		},
		open(path, newTab = false) {
			option.open(path, newTab);
		},
	};
}
