// A vault as one .zip, out and in (README §5.11): every file at its path, the app's own
// `.oi/Setting.oi` and `.oi/Hotkey.oi` included, the trash and caches left out. Reading one back
// trusts nothing in it: paths that climb out (`..`), start at a drive or the root, or name nothing
// are refused; sizes are checked before and after unpacking; the system files other tools add are
// skipped. Loaded only when a vault is exported or imported.

import { nameProblem } from '@octaether/core-vault';
import { type ZipEntry as PackedEntry, entryBytes, readZip } from '@octaether/module-table/zip';
import { type ZipEntry, makeZip } from './zip';

/** What a vault's .zip leaves out: what was deleted, and what is rebuilt anyway. */
export function isExported(path: string): boolean {
	return !/^\.oi\/(?:Trash|Cache)(?:\/|$)/.test(path);
}

export function vaultZip(fileList: readonly { path: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
	return makeZip(fileList.filter((file) => isExported(file.path)).map((file): ZipEntry => ({ path: file.path, data: file.data })));
}

export interface ImportPlan {
	/** The folder everything in the .zip sat in, when there was one: a name to offer for the vault. */
	name: string | undefined;
	fileList: { path: string; entry: PackedEntry }[];
	/** Entries left out, with why. */
	skippedList: { name: string; reason: string }[];
}

/** No more than this is unpacked from one .zip (a small file can claim to hold far more than a disk does). */
export const importLimit = { fileCount: 20_000, byteCount: 2 * 1024 ** 3 } as const;

export class ImportError extends Error {}

function pathProblem(path: string): string | undefined {
	if (path === '' || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'its path starts outside the vault';
	const partList = path.split('/');
	if (partList.some((part) => part === '..' || part === '.' || part === '')) return 'its path climbs out of the vault';
	return undefined;
}

/** Every part of a path inside the vault must be a name any system takes (the app's own `.oi` folder keeps its name). */
function partProblem(path: string): string | undefined {
	return path
		.split('/')
		.map((part, index) => (index === 0 && part === '.oi' ? undefined : nameProblem(part)))
		.find((item) => item !== undefined);
}

/** What a .zip holds that can go into a vault, and where. Throws ImportError when it is no vault's .zip at all. */
export function planImport(bytes: Uint8Array): ImportPlan {
	let entryList: PackedEntry[];
	try {
		entryList = readZip(bytes);
	} catch {
		throw new ImportError('This is not a .zip file the app can read.');
	}
	const skippedList: ImportPlan['skippedList'] = [];
	let fileList: ImportPlan['fileList'] = [];
	for (const entry of entryList) {
		const path = entry.name.replace(/\\/g, '/');
		// folders come with their files; macOS and Windows add files of their own
		if (path.endsWith('/')) continue;
		if (/(?:^|\/)(?:__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/.test(path)) continue;
		const problem = pathProblem(path);
		if (problem) skippedList.push({ name: entry.name, reason: problem });
		else if (!isExported(path)) continue;
		else fileList.push({ path, entry });
	}
	if (fileList.length > importLimit.fileCount) throw new ImportError(`This .zip holds ${fileList.length} files, more than a vault is imported with (${importLimit.fileCount}).`);
	if (fileList.reduce((sum, file) => sum + file.entry.size, 0) > importLimit.byteCount) throw new ImportError('This .zip unpacks to more than 2 GB.');
	// a zipped folder: its one top folder is the vault, not a folder inside it
	const topList = [...new Set(fileList.map((file) => file.path.split('/')[0]!))];
	let name: string | undefined;
	if (topList.length === 1 && topList[0] !== '.oi' && fileList.every((file) => file.path.includes('/'))) {
		name = topList[0]!;
		fileList = fileList.map((file) => ({ path: file.path.slice(name!.length + 1), entry: file.entry }));
	}
	fileList = fileList.filter((file) => {
		const problem = partProblem(file.path);
		if (problem) skippedList.push({ name: file.entry.name, reason: problem });
		return !problem && isExported(file.path);
	});
	// the same path twice (or differing only by case, which most disks can't hold): the first stays
	const seen = new Set<string>();
	fileList = fileList.filter((file) => {
		const key = file.path.toLowerCase();
		if (seen.has(key)) {
			skippedList.push({ name: file.entry.name, reason: 'another file has the same path' });
			return false;
		}
		seen.add(key);
		return true;
	});
	if (fileList.length === 0) throw new ImportError('This .zip holds no files to import.');
	return { name, fileList, skippedList };
}

/** A planned file's bytes; throws when it unpacks to something other than the .zip said. */
export async function importBytes(file: ImportPlan['fileList'][number]): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = await entryBytes(file.entry);
	if (bytes.length !== file.entry.size) throw new ImportError(`“${file.path}” is not the size the .zip says.`);
	return new Uint8Array(bytes);
}
