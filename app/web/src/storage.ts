// Browser storage, best effort: small preferences in localStorage, and IndexedDB for what
// localStorage can't hold (folder and file handles, quick notes kept in the browser). Everything
// still works when storage is blocked (private windows); it just isn't remembered.

export const storageKey = {
	Draft: 'OctaetherInk.Draft',
	Setting: 'OctaetherInk.Setting',
	Enabled: 'OctaetherInk.Enabled',
	Hotkey: 'OctaetherInk.Hotkey',
} as const;

export const storage = {
	get(key: string): string | undefined {
		try {
			return localStorage.getItem(key) ?? undefined;
		} catch {
			return undefined;
		}
	},
	set(key: string, value: string | undefined): void {
		try {
			if (value === undefined) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			// private mode or blocked storage: everything still works, it just isn't remembered
		}
	},
};

export function readJson<T>(key: string, fallback: T): T {
	try {
		const text = storage.get(key);
		return text ? (JSON.parse(text) as T) : fallback;
	} catch {
		return fallback;
	}
}

export function writeJson(key: string, value: unknown): void {
	storage.set(key, value === undefined ? undefined : JSON.stringify(value));
}

// ---------------------------------------------------------------- IndexedDB

const databaseName = 'OctaetherInk';
let database: Promise<IDBDatabase | undefined> | undefined;

/** The app's database (stores: `State` for handles and recents, `File` for notes kept in the browser). */
export function openDatabase(): Promise<IDBDatabase | undefined> {
	database ??= new Promise((resolve) => {
		try {
			if (typeof indexedDB === 'undefined') {
				resolve(undefined);
				return;
			}
			const request = indexedDB.open(databaseName, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains('State')) db.createObjectStore('State');
				if (!db.objectStoreNames.contains('File')) db.createObjectStore('File');
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(undefined);
			request.onblocked = () => resolve(undefined);
		} catch {
			resolve(undefined);
		}
	});
	return database;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
	const db = await openDatabase();
	if (!db) return undefined;
	try {
		return (await wrap(db.transaction(store, 'readonly').objectStore(store).get(key))) as T | undefined;
	} catch {
		return undefined;
	}
}

export async function idbSet(store: string, key: IDBValidKey, value: unknown): Promise<boolean> {
	const db = await openDatabase();
	if (!db) return false;
	try {
		await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
		return true;
	} catch {
		return false;
	}
}

export async function idbDelete(store: string, key: IDBValidKey | IDBKeyRange): Promise<void> {
	const db = await openDatabase();
	if (!db) return;
	try {
		await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
	} catch {
		// nothing to delete
	}
}

/** Every key in `range` with what `pick` takes from its value, in one pass of one transaction. */
export async function idbPickList<T>(store: string, range: IDBKeyRange, pick: (value: unknown) => T): Promise<[IDBValidKey, T][]> {
	const db = await openDatabase();
	if (!db) return [];
	return new Promise((resolve) => {
		const list: [IDBValidKey, T][] = [];
		try {
			const request = db.transaction(store, 'readonly').objectStore(store).openCursor(range);
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) {
					resolve(list);
					return;
				}
				list.push([cursor.primaryKey, pick(cursor.value)]);
				cursor.continue();
			};
			request.onerror = () => resolve(list);
		} catch {
			resolve(list);
		}
	});
}

// ---------------------------------------------------------------- recent vaults and files

export type RecentKind = 'Folder' | 'File' | 'Browser';

export interface RecentEntry {
	id: string;
	/** Browser: the quick notes (or a vault an earlier build kept in the browser). */
	kind: RecentKind;
	name: string;
	/** Folder and file handles (Chromium); notes kept in the browser have none. */
	handle?: FileSystemHandle;
	time: number;
}

export async function recentList(): Promise<RecentEntry[]> {
	return ((await idbGet<RecentEntry[]>('State', 'Recent')) ?? []).sort((left, right) => right.time - left.time);
}

export async function rememberRecent(entry: RecentEntry): Promise<void> {
	const list = (await recentList()).filter((item) => item.id !== entry.id && !(item.kind === entry.kind && item.kind === 'Browser' && item.name === entry.name));
	await idbSet('State', 'Recent', [entry, ...list].slice(0, 12));
	await idbSet('State', 'Last', entry.id);
}

export async function forgetRecent(id: string): Promise<void> {
	await idbSet('State', 'Recent', (await recentList()).filter((item) => item.id !== id));
	if ((await idbGet<string>('State', 'Last')) === id) await idbDelete('State', 'Last');
}

/** What was open when the app was last used ('None' after closing the vault or file). */
export async function lastEntry(): Promise<RecentEntry | undefined> {
	const id = await idbGet<string>('State', 'Last');
	if (!id) return undefined;
	return (await recentList()).find((item) => item.id === id);
}

export async function clearLast(): Promise<void> {
	await idbDelete('State', 'Last');
}

export function createId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
