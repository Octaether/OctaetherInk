// The one interface every platform implements: a folder on disk (File System Access, Tauri),
// the quick notes kept in the browser (IndexedDB), or memory (tests, the guide). Paths use "/"
// and have no leading slash; "" is the vault's root.

export type EntryKind = 'File' | 'Folder';

export interface Entry {
	path: string;
	kind: EntryKind;
}

export interface FileSystem {
	/** Shown in the app: the folder's name. */
	readonly name: string;
	/** Every file and folder inside, recursively. */
	list(): Promise<Entry[]>;
	read(path: string): Promise<string>;
	/** Creates or replaces a file; missing parent folders are created. */
	write(path: string, text: string): Promise<void>;
	/** A file's bytes: an image or a video a note shows. */
	readBinary(path: string): Promise<Blob>;
	/** Creates or replaces a file with bytes (a pasted image); missing parent folders are created. */
	writeBinary(path: string, data: Blob): Promise<void>;
	/** Removes a file, or a folder with everything in it, permanently. */
	remove(path: string): Promise<void>;
	/** Renames or moves a file or a folder. */
	move(from: string, to: string): Promise<void>;
	makeFolder(path: string): Promise<void>;
}

export class FileSystemError extends Error {}

// ---------------------------------------------------------------- paths

export function joinPath(...partList: string[]): string {
	return partList
		.flatMap((part) => part.split('/'))
		.filter((part) => part !== '' && part !== '.')
		.join('/');
}

export function parentPath(path: string): string {
	const at = path.lastIndexOf('/');
	return at < 0 ? '' : path.slice(0, at);
}

export function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** `Chem/SN2.oi` → `SN2`. */
export function stemOf(path: string): string {
	const name = baseName(path);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

export function extensionOf(path: string): string {
	const name = baseName(path);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1) : '';
}

export function isInside(path: string, folder: string): boolean {
	return folder === '' || path === folder || path.startsWith(`${folder}/`);
}

const mediaTypeMap: Readonly<Record<string, string>> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	mp4: 'video/mp4',
	m4v: 'video/mp4',
	webm: 'video/webm',
	ogv: 'video/ogg',
	mov: 'video/quicktime',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
	pdf: 'application/pdf',
	oi: 'text/plain',
	md: 'text/markdown',
	txt: 'text/plain',
};

/** The media type a file's extension stands for (`photo.PNG` → `image/png`), or '' when unknown. */
export function mediaTypeOf(path: string): string {
	return mediaTypeMap[extensionOf(path).toLowerCase()] ?? '';
}

export type MediaKind = 'Image' | 'Video' | 'Audio';

/** Whether the app can show a file on its own (a picture, a video, a sound), as Obsidian does; undefined for anything else. */
export function mediaKindOf(path: string): MediaKind | undefined {
	const type = mediaTypeOf(path);
	if (type.startsWith('image/')) return 'Image';
	// QuickTime files play only where the browser has the codec; they are listed, not offered
	if (type.startsWith('video/') && type !== 'video/quicktime') return 'Video';
	if (type.startsWith('audio/')) return 'Audio';
	return undefined;
}

const forbiddenPattern = /[<>:"/\\|?*\u0000-\u001f]/;
const reservedSet = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3']);

/** Why a file or folder name can't be used on every system, or undefined when it's fine. */
export function nameProblem(name: string): string | undefined {
	const trimmed = name.trim();
	if (trimmed === '') return 'A name can’t be empty.';
	if (trimmed !== name) return 'A name can’t start or end with a space.';
	if (name.startsWith('.')) return 'A name can’t start with a dot.';
	if (forbiddenPattern.test(name)) return 'A name can’t contain < > : " / \\ | ? *';
	if (reservedSet.has(stemOf(name).toUpperCase())) return `“${name}” is reserved on Windows.`;
	if (name.length > 200) return 'That name is too long.';
	return undefined;
}

// ---------------------------------------------------------------- memory (tests, previews)

export class MemoryFileSystem implements FileSystem {
	private readonly fileMap = new Map<string, string | Blob>();
	private readonly folderSet = new Set<string>();

	constructor(
		readonly name = 'Memory',
		initial: Readonly<Record<string, string | Blob>> = {},
	) {
		for (const [path, content] of Object.entries(initial)) {
			this.fileMap.set(path, content);
			this.addParent(path);
		}
	}

	async list(): Promise<Entry[]> {
		return [...[...this.folderSet].map((path) => ({ path, kind: 'Folder' as const })), ...[...this.fileMap.keys()].map((path) => ({ path, kind: 'File' as const }))];
	}

	async read(path: string): Promise<string> {
		const content = this.fileMap.get(path);
		if (content === undefined) throw new FileSystemError(`no file “${path}”`);
		return typeof content === 'string' ? content : content.text();
	}

	async write(path: string, text: string): Promise<void> {
		if (this.folderSet.has(path)) throw new FileSystemError(`“${path}” is a folder`);
		this.fileMap.set(path, text);
		this.addParent(path);
	}

	async readBinary(path: string): Promise<Blob> {
		const content = this.fileMap.get(path);
		if (content === undefined) throw new FileSystemError(`no file “${path}”`);
		return typeof content === 'string' ? new Blob([content], { type: mediaTypeOf(path) }) : content;
	}

	async writeBinary(path: string, data: Blob): Promise<void> {
		if (this.folderSet.has(path)) throw new FileSystemError(`“${path}” is a folder`);
		this.fileMap.set(path, data);
		this.addParent(path);
	}

	async remove(path: string): Promise<void> {
		if (!this.fileMap.delete(path) && !this.folderSet.has(path)) throw new FileSystemError(`no file or folder “${path}”`);
		for (const file of [...this.fileMap.keys()]) if (isInside(file, path)) this.fileMap.delete(file);
		for (const folder of [...this.folderSet]) if (isInside(folder, path)) this.folderSet.delete(folder);
	}

	async move(from: string, to: string): Promise<void> {
		if (from === to) return;
		if (this.fileMap.has(to) || this.folderSet.has(to)) throw new FileSystemError(`“${to}” already exists`);
		const content = this.fileMap.get(from);
		if (content !== undefined) {
			this.fileMap.delete(from);
			this.fileMap.set(to, content);
			this.addParent(to);
			return;
		}
		if (!this.folderSet.has(from)) throw new FileSystemError(`no file or folder “${from}”`);
		if (isInside(to, from)) throw new FileSystemError('a folder can’t move into itself');
		const rename = (path: string): string => to + path.slice(from.length);
		for (const [file, content] of [...this.fileMap]) {
			if (!isInside(file, from)) continue;
			this.fileMap.delete(file);
			this.fileMap.set(rename(file), content);
		}
		for (const folder of [...this.folderSet]) {
			if (!isInside(folder, from)) continue;
			this.folderSet.delete(folder);
			this.folderSet.add(rename(folder));
		}
		this.addParent(to);
	}

	async makeFolder(path: string): Promise<void> {
		if (this.fileMap.has(path)) throw new FileSystemError(`“${path}” is a file`);
		this.folderSet.add(path);
		this.addParent(path);
	}

	private addParent(path: string): void {
		for (let parent = parentPath(path); parent !== ''; parent = parentPath(parent)) this.folderSet.add(parent);
	}
}
