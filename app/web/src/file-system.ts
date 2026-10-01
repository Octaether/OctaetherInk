// The browser's file systems for a vault:
//   DirectoryFileSystem   a real folder on disk (File System Access: Chrome, Edge, Opera, Brave)
//   BrowserFileSystem     a vault kept in this browser (IndexedDB: every browser, iPad and iPhone too)
// Both implement core-vault's FileSystem, like the memory one the tests use.

import { type Entry, type FileSystem, FileSystemError, baseName, isInside, joinPath, mediaTypeOf, parentPath } from '@octaether/core-vault';
import { idbDelete, idbGet, idbKeyList, idbSet } from './storage';

/** Whether this browser can open a folder with read and write access. */
export function canOpenFolder(): boolean {
	return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function canOpenFileHandle(): boolean {
	return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/** Asks for read and write access again (needs a click on the web after a reload). */
export async function ensurePermission(handle: FileSystemHandle, ask: boolean): Promise<boolean> {
	const option = { mode: 'readwrite' as const };
	try {
		if ((await handle.queryPermission?.(option)) === 'granted') return true;
		if (!ask) return false;
		return (await handle.requestPermission?.(option)) === 'granted';
	} catch {
		return false;
	}
}

export class DirectoryFileSystem implements FileSystem {
	constructor(readonly root: FileSystemDirectoryHandle) {}

	get name(): string {
		return this.root.name;
	}

	async list(): Promise<Entry[]> {
		const list: Entry[] = [];
		const walk = async (folder: FileSystemDirectoryHandle, path: string): Promise<void> => {
			for await (const [name, handle] of folder.entries()) {
				const childPath = joinPath(path, name);
				if (handle.kind === 'directory') {
					list.push({ path: childPath, kind: 'Folder' });
					// the app's own folder is listed shallowly except for the trash and settings
					if (name === 'node_modules' || name === '.git') continue;
					await walk(handle as FileSystemDirectoryHandle, childPath);
				} else list.push({ path: childPath, kind: 'File' });
			}
		};
		await walk(this.root, '');
		return list;
	}

	async read(path: string): Promise<string> {
		const file = await (await this.fileHandle(path, false)).getFile();
		return file.text();
	}

	async write(path: string, text: string): Promise<void> {
		const handle = await this.fileHandle(path, true);
		const writable = await handle.createWritable();
		await writable.write(text);
		await writable.close();
	}

	async readBinary(path: string): Promise<Blob> {
		const file = await (await this.fileHandle(path, false)).getFile();
		// the disk may not say what the file is; its extension does
		return file.type === '' && mediaTypeOf(path) !== '' ? new Blob([file], { type: mediaTypeOf(path) }) : file;
	}

	async writeBinary(path: string, data: Blob): Promise<void> {
		const handle = await this.fileHandle(path, true);
		const writable = await handle.createWritable();
		await writable.write(data);
		await writable.close();
	}

	async remove(path: string): Promise<void> {
		const parent = await this.folderHandle(parentPath(path), false);
		await parent.removeEntry(baseName(path), { recursive: true });
	}

	async move(from: string, to: string): Promise<void> {
		if (from === to) return;
		const kind = await this.kindOf(from);
		if (!kind) throw new FileSystemError(`no file or folder “${from}”`);
		const targetParent = await this.folderHandle(parentPath(to), true);
		// Chromium can move a handle in place; otherwise copy, then remove the original
		const handle = kind === 'File' ? await this.fileHandle(from, false) : await this.folderHandle(from, false);
		if (typeof handle.move === 'function') {
			try {
				await handle.move(targetParent, baseName(to));
				return;
			} catch {
				// fall back to copying
			}
		}
		// bytes, not text, so images and videos move unharmed
		if (kind === 'File') {
			await this.writeBinary(to, await this.readBinary(from));
		} else {
			if (isInside(to, from)) throw new FileSystemError('a folder can’t move into itself');
			await this.makeFolder(to);
			for (const entry of (await this.list()).filter((item) => isInside(item.path, from) && item.path !== from)) {
				const target = to + entry.path.slice(from.length);
				if (entry.kind === 'Folder') await this.makeFolder(target);
				else await this.writeBinary(target, await this.readBinary(entry.path));
			}
		}
		await this.remove(from);
	}

	async makeFolder(path: string): Promise<void> {
		await this.folderHandle(path, true);
	}

	private async folderHandle(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
		let folder = this.root;
		for (const part of path.split('/').filter(Boolean)) folder = await folder.getDirectoryHandle(part, { create });
		return folder;
	}

	private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
		const folder = await this.folderHandle(parentPath(path), create);
		return folder.getFileHandle(baseName(path), { create });
	}

	private async kindOf(path: string): Promise<'File' | 'Folder' | undefined> {
		const parent = await this.folderHandle(parentPath(path), false).catch(() => undefined);
		if (!parent) return undefined;
		try {
			await parent.getFileHandle(baseName(path));
			return 'File';
		} catch {
			try {
				await parent.getDirectoryHandle(baseName(path));
				return 'Folder';
			} catch {
				return undefined;
			}
		}
	}
}

interface StoredEntry {
	kind: 'File' | 'Folder';
	text?: string;
	/**
	 * A file stored as bytes (an image). Kept as an ArrayBuffer, not a Blob: private windows in
	 * Safari and Firefox refuse to store a Blob in IndexedDB.
	 */
	data?: ArrayBuffer | Blob;
	/** The bytes' media type. */
	type?: string;
}

/** The bytes of a stored file, as a Blob of its type. */
function entryBlob(entry: StoredEntry, path: string): Blob {
	const type = entry.type || mediaTypeOf(path);
	if (entry.data instanceof Blob) return entry.data.type || !type ? entry.data : new Blob([entry.data], { type });
	return new Blob([entry.data ?? entry.text ?? ''], { type });
}

/** A vault kept in this browser's storage (IndexedDB), for browsers that can't open folders. */
export class BrowserFileSystem implements FileSystem {
	constructor(
		readonly id: string,
		readonly name: string,
	) {}

	private key(path: string): string {
		return `${this.id}/${path}`;
	}

	private range(): IDBKeyRange {
		return IDBKeyRange.bound(`${this.id}/`, `${this.id}/￿`);
	}

	async list(): Promise<Entry[]> {
		const keyList = await idbKeyList('File', this.range());
		const list: Entry[] = [];
		for (const key of keyList) {
			const path = String(key).slice(this.id.length + 1);
			const entry = await idbGet<StoredEntry>('File', key);
			if (entry) list.push({ path, kind: entry.kind });
		}
		return list;
	}

	async read(path: string): Promise<string> {
		const entry = await idbGet<StoredEntry>('File', this.key(path));
		if (!entry || entry.kind !== 'File') throw new FileSystemError(`no file “${path}”`);
		return entry.data ? entryBlob(entry, path).text() : (entry.text ?? '');
	}

	async write(path: string, text: string): Promise<void> {
		await this.store(path, { kind: 'File', text }, 'the note');
	}

	async readBinary(path: string): Promise<Blob> {
		const entry = await idbGet<StoredEntry>('File', this.key(path));
		if (!entry || entry.kind !== 'File') throw new FileSystemError(`no file “${path}”`);
		return entryBlob(entry, path);
	}

	async writeBinary(path: string, data: Blob): Promise<void> {
		await this.store(path, { kind: 'File', data: await data.arrayBuffer(), type: data.type }, 'the file');
	}

	private async store(path: string, entry: StoredEntry, what: string): Promise<void> {
		for (let parent = parentPath(path); parent !== ''; parent = parentPath(parent)) {
			if (!(await idbGet<StoredEntry>('File', this.key(parent)))) await idbSet('File', this.key(parent), { kind: 'Folder' });
		}
		if (!(await idbSet('File', this.key(path), entry))) throw new FileSystemError(`this browser didn’t store ${what} (storage may be full or blocked)`);
	}

	async remove(path: string): Promise<void> {
		for (const entry of await this.list()) if (isInside(entry.path, path)) await idbDelete('File', this.key(entry.path));
	}

	async move(from: string, to: string): Promise<void> {
		if (from === to) return;
		const all = await this.list();
		if (all.some((entry) => entry.path === to)) throw new FileSystemError(`“${to}” already exists`);
		for (const entry of all.filter((item) => isInside(item.path, from))) {
			const target = to + entry.path.slice(from.length);
			const stored = await idbGet<StoredEntry>('File', this.key(entry.path));
			if (stored) await idbSet('File', this.key(target), stored);
			await idbDelete('File', this.key(entry.path));
		}
		for (let parent = parentPath(to); parent !== ''; parent = parentPath(parent)) {
			if (!(await idbGet<StoredEntry>('File', this.key(parent)))) await idbSet('File', this.key(parent), { kind: 'Folder' });
		}
	}

	async makeFolder(path: string): Promise<void> {
		for (let folder = path; folder !== ''; folder = parentPath(folder)) {
			if (!(await idbGet<StoredEntry>('File', this.key(folder)))) await idbSet('File', this.key(folder), { kind: 'Folder' });
		}
	}
}

/** Downloads text as a file (the fallback for saving where browsers can't write files). */
export function downloadText(name: string, text: string): void {
	const link = document.createElement('a');
	link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Writes through a file handle (Chromium); false when that isn't possible. */
export async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<boolean> {
	try {
		const writable = await handle.createWritable();
		await writable.write(text);
		await writable.close();
		return true;
	} catch {
		return false;
	}
}
