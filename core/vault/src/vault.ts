// A vault: a folder of notes plus one `.oi/` folder the app owns (settings, trash, …).
// Works on any FileSystem, so the web app, the desktop and mobile shells, and tests share it.
//
//   create    unique names ("Untitled.oi", "Untitled 1.oi", …), never two that differ only by case
//   delete    moves to .oi/Trash/ (keeping the folder path), restore puts it back; or permanently,
//             with a copy in memory first (snapshot) so Undo can put it back
//   rename    renames or moves, and rewrites [[links]] to the note when its name changed
//   index     every note's links and tags → backlinks, the graph, and search

import { type Entry, type EntryKind, type FileSystem, baseName, extensionOf, isInside, joinPath, nameProblem, parentPath, stemOf } from './file-system';
import { type LinkReference, linkList, linkTargetOf, tagList } from './link';

export const systemFolder = '.oi';
export const trashFolder = '.oi/Trash';

export class VaultError extends Error {}

export type SortOrder = 'NameAscending' | 'NameDescending';

export interface GraphNode {
	/** A note's path, `Unresolved:<target>`, or `Tag:<tag>`. */
	id: string;
	label: string;
	kind: 'Note' | 'Unresolved' | 'Tag';
	degree: number;
}

export interface GraphEdge {
	from: string;
	to: string;
}

export interface GraphOption {
	tag?: boolean;
	unresolved?: boolean;
	orphan?: boolean;
}

export interface SearchMatch {
	line: number;
	/** The line, shortened around the match. */
	text: string;
	start: number;
	end: number;
}

export interface SearchResult {
	path: string;
	nameMatch: boolean;
	matchList: SearchMatch[];
}

export interface SearchOption {
	matchCase?: boolean;
	regex?: boolean;
	/** Most notes to return (default 200). */
	limit?: number;
}

/** A file or folder copied into memory before a permanent delete, so Undo can put it back. */
export interface VaultSnapshot {
	path: string;
	folderList: string[];
	fileList: { path: string; data: Blob }[];
}

export function isNote(path: string): boolean {
	return extensionOf(path) === 'oi';
}

/** A name split for numbering: `Cell.png` → `Cell` + `png`; a folder keeps its whole name (`v1.2`). */
function splitName(path: string, kind: EntryKind | undefined): { stem: string; extension: string } {
	const extension = kind === 'Folder' ? '' : extensionOf(path);
	const name = baseName(path);
	return { stem: extension ? name.slice(0, -extension.length - 1) : name, extension };
}

/** `.oi/` and dot-files are the app's, not shown in the file tree. */
export function isHidden(path: string): boolean {
	return path.split('/').some((part) => part.startsWith('.'));
}

function compareName(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Vault {
	private entryList: Entry[] = [];
	private readonly textMap = new Map<string, string>();
	private readonly listenerSet = new Set<() => void>();

	constructor(readonly fs: FileSystem) {}

	get name(): string {
		return this.fs.name;
	}

	/** Reads the folder and every note in it (links, tags, and search need the text). */
	async load(): Promise<void> {
		this.entryList = await this.fs.list();
		this.textMap.clear();
		const noteList = this.entryList.filter((entry) => entry.kind === 'File' && isNote(entry.path) && !isHidden(entry.path));
		await Promise.all(
			noteList.map(async (entry) => {
				try {
					this.textMap.set(entry.path, await this.fs.read(entry.path));
				} catch {
					// unreadable: it stays in the tree but not in the index
				}
			}),
		);
		this.emit();
	}

	subscribe(listener: () => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	// ------------------------------------------------------------ entries

	/** Files and folders shown in the file tree (not `.oi/`, not hidden files). */
	visibleEntryList(): Entry[] {
		return this.entryList.filter((entry) => !isHidden(entry.path));
	}

	/** The children of a folder ('' = the root), folders first, sorted by name. */
	childList(folder: string, order: SortOrder = 'NameAscending'): Entry[] {
		const list = this.visibleEntryList().filter((entry) => parentPath(entry.path) === folder);
		const direction = order === 'NameDescending' ? -1 : 1;
		return list.sort((left, right) => (left.kind !== right.kind ? (left.kind === 'Folder' ? -1 : 1) : direction * compareName(baseName(left.path), baseName(right.path))));
	}

	/** Every note, sorted by path. */
	noteList(): string[] {
		return this.visibleEntryList()
			.filter((entry) => entry.kind === 'File' && isNote(entry.path))
			.map((entry) => entry.path)
			.sort(compareName);
	}

	kindOf(path: string): EntryKind | undefined {
		return this.entryList.find((entry) => entry.path === path)?.kind;
	}

	has(path: string): boolean {
		return this.kindOf(path) !== undefined;
	}

	/** Taken regardless of case (Windows and macOS disks ignore case). */
	isTaken(path: string, except?: string): boolean {
		const lower = path.toLowerCase();
		return this.entryList.some((entry) => entry.path.toLowerCase() === lower && entry.path !== except);
	}

	/** A free path in `folder`: `Untitled.oi`, then `Untitled 1.oi`, `Untitled 2.oi`, … (`extension` '' for a folder or a bare name). */
	uniquePath(folder: string, stem: string, extension = 'oi', except?: string): string {
		for (let count = 0; ; count++) {
			const name = `${count === 0 ? stem : `${stem} ${count}`}${extension ? `.${extension}` : ''}`;
			const path = joinPath(folder, name);
			if (!this.isTaken(path, except)) return path;
		}
	}

	// ------------------------------------------------------------ read and write

	async read(path: string): Promise<string> {
		const cached = this.textMap.get(path);
		if (cached !== undefined) return cached;
		return this.fs.read(path);
	}

	async write(path: string, text: string): Promise<void> {
		await this.fs.write(path, text);
		this.addEntry(path, 'File');
		if (isNote(path) && !isHidden(path)) this.textMap.set(path, text);
		this.emit();
	}

	/** A file's bytes: an image or a video a note shows. */
	async readBinary(path: string): Promise<Blob> {
		return this.fs.readBinary(path);
	}

	/** Keeps a file a note shows (a pasted image) in `folder`, under a free name like `name 1.png`; returns its path. */
	async addFile(folder: string, name: string, data: Blob): Promise<string> {
		const extension = extensionOf(name);
		const stem = (extension ? name.slice(0, -extension.length - 1) : name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'File';
		const path = this.uniquePath(folder, stem, extension);
		if (folder !== '' && !this.has(folder)) {
			await this.fs.makeFolder(folder);
			this.addEntry(folder, 'Folder');
		}
		await this.fs.writeBinary(path, data);
		this.addEntry(path, 'File');
		this.emit();
		return path;
	}

	/**
	 * The file a note means by `source`, as in Obsidian: a path from the vault's top, a path from
	 * the note's folder, or a file name anywhere in the vault (the one nearest the note wins).
	 */
	findFile(source: string, notePath = ''): string | undefined {
		const clean = source.trim().replace(/^\.?\//, '');
		if (clean === '') return undefined;
		const fileList = this.entryList.filter((entry) => entry.kind === 'File').map((entry) => entry.path);
		const exact = (path: string): string | undefined => fileList.find((file) => file === path) ?? fileList.find((file) => file.toLowerCase() === path.toLowerCase());
		const fromNote = joinPath(parentPath(notePath), clean);
		const found = exact(clean) ?? exact(fromNote);
		if (found) return found;
		if (clean.includes('/')) return undefined;
		const lower = clean.toLowerCase();
		const byName = fileList.filter((file) => baseName(file).toLowerCase() === lower);
		const folder = parentPath(notePath);
		return byName.sort((left, right) => Number(!isInside(left, folder)) - Number(!isInside(right, folder)) || left.length - right.length)[0];
	}

	async createFolder(parent: string, name = 'Untitled'): Promise<string> {
		const problem = nameProblem(name);
		if (problem) throw new VaultError(problem);
		const path = this.uniquePath(parent, name, '');
		await this.fs.makeFolder(path);
		this.addEntry(path, 'Folder');
		this.emit();
		return path;
	}

	/**
	 * Renames or moves a file or folder. When a note's name changes, links to it in other notes
	 * are rewritten (with `updateLink`). Returns the new path and the notes whose text changed.
	 */
	async rename(path: string, newPath: string, option: { updateLink?: boolean } = {}): Promise<{ path: string; changedList: string[] }> {
		if (path === newPath) return { path, changedList: [] };
		const kind = this.kindOf(path);
		if (!kind) throw new VaultError(`“${path}” doesn’t exist`);
		const problem = nameProblem(baseName(newPath));
		if (problem) throw new VaultError(problem);
		if (this.isTaken(newPath, path)) throw new VaultError(`“${baseName(newPath)}” already exists there`);
		if (kind === 'Folder' && isInside(newPath, path)) throw new VaultError('A folder can’t move into itself.');
		// which notes move where, and which links point at them (resolved before anything moves)
		const moveMap = new Map<string, string>();
		for (const entry of this.entryList) {
			if (entry.kind === 'File' && isInside(entry.path, path)) moveMap.set(entry.path, newPath + entry.path.slice(path.length));
		}
		const rewriteList = option.updateLink ? this.linkRewriteList(moveMap) : [];
		await this.fs.move(path, newPath);
		this.entryList = this.entryList.map((entry) => (isInside(entry.path, path) ? { ...entry, path: newPath + entry.path.slice(path.length) } : entry));
		this.addParent(newPath);
		for (const [from, to] of moveMap) {
			const text = this.textMap.get(from);
			if (text === undefined) continue;
			this.textMap.delete(from);
			this.textMap.set(to, text);
		}
		const changedList: string[] = [];
		for (const item of rewriteList) {
			const target = moveMap.get(item.path) ?? item.path;
			await this.fs.write(target, item.text);
			this.textMap.set(target, item.text);
			changedList.push(target);
		}
		this.emit();
		return { path: newPath, changedList };
	}

	/** Moves a file or folder to `.oi/Trash/`, keeping its folder path; returns where it went. */
	async trash(path: string): Promise<string> {
		if (!this.has(path)) throw new VaultError(`“${path}” doesn’t exist`);
		if (isInside(path, trashFolder)) {
			await this.deleteForever(path);
			return path;
		}
		const { stem, extension } = splitName(path, this.kindOf(path));
		const target = this.uniquePath(joinPath(trashFolder, parentPath(path)), stem, extension);
		await this.fs.move(path, target);
		this.moveEntry(path, target);
		this.emit();
		return target;
	}

	/** Removes a file or folder permanently (a blank "Untitled" note, or emptying the trash). */
	async deleteForever(path: string): Promise<void> {
		if (!this.has(path)) return;
		await this.fs.remove(path);
		this.entryList = this.entryList.filter((entry) => !isInside(entry.path, path));
		for (const key of [...this.textMap.keys()]) if (isInside(key, path)) this.textMap.delete(key);
		this.emit();
	}

	/** Every file and folder inside `path` (itself included). */
	private entryListIn(path: string): Entry[] {
		return this.entryList.filter((entry) => isInside(entry.path, path));
	}

	/**
	 * A copy in memory of a file or folder, to put back after deleting it permanently (Undo).
	 * Undefined when it holds more than `limit` bytes (a folder of videos is not kept twice).
	 */
	async snapshot(path: string, limit = 200 * 1024 * 1024): Promise<VaultSnapshot | undefined> {
		const entryList = this.entryListIn(path);
		const fileList: VaultSnapshot['fileList'] = [];
		let size = 0;
		for (const entry of entryList) {
			if (entry.kind !== 'File') continue;
			const blob = await this.fs.readBinary(entry.path);
			size += blob.size;
			if (size > limit) return undefined;
			// a file on disk is read only when used, and after the delete it is gone: the bytes are copied now
			fileList.push({ path: entry.path, data: new Blob([await blob.arrayBuffer()], { type: blob.type }) });
		}
		return { path, folderList: entryList.filter((entry) => entry.kind === 'Folder').map((entry) => entry.path), fileList };
	}

	/** Puts a snapshot back where it was (under a free name if that is taken now); returns its path. */
	async putBack(snapshot: VaultSnapshot): Promise<string> {
		const kind = snapshot.folderList.includes(snapshot.path) ? 'Folder' : 'File';
		const { stem, extension } = splitName(snapshot.path, kind);
		const root = this.isTaken(snapshot.path) ? this.uniquePath(parentPath(snapshot.path), stem, extension) : snapshot.path;
		const moved = (path: string): string => root + path.slice(snapshot.path.length);
		for (const folder of snapshot.folderList) {
			await this.fs.makeFolder(moved(folder));
			this.addEntry(moved(folder), 'Folder');
		}
		for (const file of snapshot.fileList) {
			const path = moved(file.path);
			await this.fs.writeBinary(path, file.data);
			this.addEntry(path, 'File');
			if (isNote(path) && !isHidden(path)) this.textMap.set(path, await file.data.text());
		}
		this.emit();
		return root;
	}

	/** Files in the trash, newest structure as it is. */
	trashList(): Entry[] {
		return this.entryList.filter((entry) => entry.kind === 'File' && isInside(entry.path, trashFolder) && entry.path !== trashFolder);
	}

	/** Puts a file or folder from the trash back where it was (with a new name if that's taken); returns its path. */
	async restore(trashPath: string): Promise<string> {
		if (!isInside(trashPath, trashFolder) || trashPath === trashFolder || !this.has(trashPath)) throw new VaultError('That isn’t in the trash.');
		const original = trashPath.slice(trashFolder.length + 1);
		const { stem, extension } = splitName(original, this.kindOf(trashPath));
		const target = this.isTaken(original) ? this.uniquePath(parentPath(original), stem, extension) : original;
		await this.fs.move(trashPath, target);
		this.moveEntry(trashPath, target);
		// the folders it leaves empty in the trash go too, so Undo leaves no trace
		for (let folder = parentPath(trashPath); folder !== trashFolder && isInside(folder, trashFolder); folder = parentPath(folder)) {
			if (this.entryList.some((entry) => entry.path !== folder && isInside(entry.path, folder))) break;
			await this.fs.remove(folder);
			this.entryList = this.entryList.filter((entry) => entry.path !== folder);
		}
		// the trash isn't indexed: the notes that came back are read again for links, tags, and search
		for (const entry of this.entryListIn(target)) {
			if (entry.kind !== 'File' || !isNote(entry.path) || isHidden(entry.path)) continue;
			try {
				this.textMap.set(entry.path, await this.fs.read(entry.path));
			} catch {
				// it is back in the tree; the index catches up on the next load
			}
		}
		this.emit();
		return target;
	}

	async emptyTrash(): Promise<void> {
		if (this.has(trashFolder)) await this.deleteForever(trashFolder);
	}

	// ------------------------------------------------------------ links, graph, search

	/** The note a `[[target]]` points at: a path (`Folder/Note`), else a name, closest to `from` first. */
	resolve(target: string, from?: string): string | undefined {
		const clean = target.trim().replace(/^\.?\//, '').replace(/\.oi$/, '');
		if (clean === '') return undefined;
		const noteList = [...this.textMap.keys()];
		if (clean.includes('/')) {
			const path = `${clean}.oi`;
			return noteList.find((note) => note === path) ?? noteList.find((note) => note.toLowerCase() === path.toLowerCase());
		}
		const pick = (list: string[]): string | undefined => {
			if (list.length <= 1) return list[0];
			const folder = from ? parentPath(from) : '';
			return list.find((note) => parentPath(note) === folder) ?? [...list].sort((left, right) => left.length - right.length || compareName(left, right))[0];
		};
		return pick(noteList.filter((note) => stemOf(note) === clean)) ?? pick(noteList.filter((note) => stemOf(note).toLowerCase() === clean.toLowerCase()));
	}

	/** Every link in a note, with the note it resolves to (if any). */
	linkList(path: string): (LinkReference & { resolved: string | undefined })[] {
		const text = this.textMap.get(path) ?? '';
		return linkList(text).map((link) => ({ ...link, resolved: this.resolve(link.target, path) }));
	}

	/** Notes that link to `path`. */
	backlinkList(path: string): string[] {
		return [...this.textMap.keys()].filter((note) => note !== path && this.linkList(note).some((link) => link.resolved === path)).sort(compareName);
	}

	tagList(path: string): string[] {
		return tagList(this.textMap.get(path) ?? '');
	}

	graph(option: GraphOption = {}): { nodeList: GraphNode[]; edgeList: GraphEdge[] } {
		const nodeMap = new Map<string, GraphNode>();
		const edgeList: GraphEdge[] = [];
		const edgeSet = new Set<string>();
		const addEdge = (from: string, to: string): void => {
			const key = `${from}\u0000${to}`;
			if (from === to || edgeSet.has(key)) return;
			edgeSet.add(key);
			edgeList.push({ from, to });
		};
		for (const path of this.noteList()) nodeMap.set(path, { id: path, label: stemOf(path), kind: 'Note', degree: 0 });
		for (const path of this.noteList()) {
			for (const link of this.linkList(path)) {
				if (link.resolved) addEdge(path, link.resolved);
				else if (option.unresolved) {
					const id = `Unresolved:${link.target}`;
					if (!nodeMap.has(id)) nodeMap.set(id, { id, label: link.target, kind: 'Unresolved', degree: 0 });
					addEdge(path, id);
				}
			}
			if (option.tag) {
				for (const tag of this.tagList(path)) {
					const id = `Tag:${tag}`;
					if (!nodeMap.has(id)) nodeMap.set(id, { id, label: `#${tag}`, kind: 'Tag', degree: 0 });
					addEdge(path, id);
				}
			}
		}
		for (const edge of edgeList) {
			nodeMap.get(edge.from)!.degree++;
			nodeMap.get(edge.to)!.degree++;
		}
		const nodeList = [...nodeMap.values()].filter((node) => option.orphan !== false || node.degree > 0);
		const kept = new Set(nodeList.map((node) => node.id));
		return { nodeList, edgeList: edgeList.filter((edge) => kept.has(edge.from) && kept.has(edge.to)) };
	}

	/**
	 * Full-text search over every note. `tag:Chem` finds notes with that tag. Results are notes
	 * whose name or text matches, with up to 20 matching lines each.
	 */
	search(query: string, option: SearchOption = {}): SearchResult[] {
		const text = query.trim();
		if (text === '') return [];
		const tagQuery = /^tag:#?(.+)$/i.exec(text);
		if (tagQuery) {
			const wanted = tagQuery[1]!.trim();
			return this.noteList()
				.filter((path) => this.tagList(path).some((tag) => (option.matchCase ? tag === wanted : tag.toLowerCase() === wanted.toLowerCase())))
				.map((path) => ({ path, nameMatch: false, matchList: [] }));
		}
		let pattern: RegExp;
		try {
			pattern = new RegExp(option.regex ? text : escapeRegExp(text), option.matchCase ? 'g' : 'gi');
		} catch {
			return [];
		}
		const resultList: SearchResult[] = [];
		for (const path of this.noteList()) {
			const nameMatch = new RegExp(pattern.source, pattern.flags.replace('g', '')).test(stemOf(path));
			const matchList: SearchMatch[] = [];
			const lineList = (this.textMap.get(path) ?? '').split('\n');
			for (let line = 0; line < lineList.length && matchList.length < 20; line++) {
				const content = lineList[line]!;
				pattern.lastIndex = 0;
				const match = pattern.exec(content);
				if (!match || match[0] === '') continue;
				// keep about 60 characters on each side of the match
				const from = Math.max(0, match.index - 60);
				const to = Math.min(content.length, match.index + match[0].length + 60);
				const prefix = from > 0 ? '…' : '';
				const start = prefix.length + match.index - from;
				matchList.push({ line, text: `${prefix}${content.slice(from, to)}${to < content.length ? '…' : ''}`, start, end: start + match[0].length });
			}
			if (nameMatch || matchList.length > 0) resultList.push({ path, nameMatch, matchList });
			if (resultList.length >= (option.limit ?? 200)) break;
		}
		return resultList;
	}

	// ------------------------------------------------------------ internals

	/** Notes whose links point at a moved note by a name or path that no longer fits, with their new text. */
	private linkRewriteList(moveMap: ReadonlyMap<string, string>): { path: string; text: string }[] {
		const list: { path: string; text: string }[] = [];
		for (const [path, text] of this.textMap) {
			let result = '';
			let cursor = 0;
			let changed = false;
			for (const link of this.linkList(path)) {
				if (!link.resolved) continue;
				const moved = moveMap.get(link.resolved);
				if (!moved) continue;
				const byPath = link.target.includes('/');
				const next = byPath ? linkTargetOf(moved) : stemOf(moved);
				const current = byPath ? linkTargetOf(link.resolved) : stemOf(link.resolved);
				if (next === current) continue;
				result += text.slice(cursor, link.targetStart) + next;
				cursor = link.targetEnd;
				changed = true;
			}
			if (changed) list.push({ path, text: result + text.slice(cursor) });
		}
		return list;
	}

	private addEntry(path: string, kind: EntryKind): void {
		if (!this.has(path)) this.entryList.push({ path, kind });
		this.addParent(path);
	}

	private addParent(path: string): void {
		for (let parent = parentPath(path); parent !== ''; parent = parentPath(parent)) {
			if (!this.has(parent)) this.entryList.push({ path: parent, kind: 'Folder' });
		}
	}

	private moveEntry(from: string, to: string): void {
		this.entryList = this.entryList.map((entry) => (isInside(entry.path, from) ? { ...entry, path: to + entry.path.slice(from.length) } : entry));
		this.addParent(to);
		for (const [path, text] of [...this.textMap]) {
			if (!isInside(path, from)) continue;
			this.textMap.delete(path);
			if (!isHidden(to)) this.textMap.set(to + path.slice(from.length), text);
		}
	}

	private emit(): void {
		for (const listener of this.listenerSet) listener();
	}
}
