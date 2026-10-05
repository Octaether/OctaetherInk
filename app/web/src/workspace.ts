// The workspace: what is open (nothing, a vault, or single files), the tabs, and saving.
//
//   tab        each tab shows a note, a file of the vault (a picture, a video, a sound, as in
//              Obsidian), or the graph, with its own Back and Forward. A note is open in one tab
//              at most: opening it again switches to that tab.
//   new note   "Untitled.oi" (then "Untitled 1.oi", …), in a new tab. Nothing is written until it
//              has content, and a blank Untitled note is removed for good when you leave it
//              (never to the trash), even after typing and undoing back to nothing.
//   save       automatic (0.6 s after a change) in a vault and for files opened with write access;
//              elsewhere Ctrl+S downloads, and a draft is kept in this browser meanwhile.
//   delete     to the vault's trash, .oi/Trash/ (or for good, a setting), after a question (a
//              setting too). Notes kept in the browser have no trash: always asked, always for
//              good. Either way the message after it offers Undo.
//   rename     renames the file and rewrites [[links]] to it (a setting); Ctrl+Z takes it back.
//   switch     the next vault is read while the current one stays on screen, then everything
//              changes at once (its settings, its tabs): no flash of the start screen between.

import { type FormatOption, type PropertyValue, createNoteId, formatName, walkNode } from '@octaether/core-format';
import { NoteModel } from '@octaether/core-model';
import { type FileSystem, Vault, VaultError, type VaultSnapshot, baseName, extensionOf, isInside, isNote, joinPath, nameProblem, parentPath, stemOf } from '@octaether/core-vault';
import { downloadText, writeHandle } from './file-system';
import { storage, storageKey } from './storage';

export type WorkspaceKind = 'None' | 'Vault' | 'File';
export type SaveState = 'Saved' | 'Saving' | 'Unsaved' | 'Failed' | 'Download';
/** Vault: opened or closed. Tree: files changed. Tab: tabs opened, closed, moved. Note: the tab shows something else. */
export type WorkspaceEvent = 'Vault' | 'Tree' | 'Tab' | 'Note' | 'Save' | 'Rename';

export interface OpenNote {
	/** The note's path in the vault, or its file name. */
	path: string;
	model: NoteModel;
	/** The text on disk; undefined while it hasn't been written. */
	savedText: string | undefined;
	/** Made with "New note" and still called "Untitled…". */
	autoNamed: boolean;
	/** A single file opened with write access (Chromium). */
	handle?: FileSystemFileHandle;
	/** Not a file of the open vault (a file opened on its own). */
	external: boolean;
	saveState: SaveState;
}

/** A place a tab can show, for Back and Forward. */
export type TabPlace = { kind: 'Note'; path: string } | { kind: 'File'; path: string } | { kind: 'Graph' };

function samePlace(left: TabPlace | undefined, right: TabPlace): boolean {
	if (!left || left.kind !== right.kind) return false;
	return right.kind === 'Graph' || (left.kind !== 'Graph' && left.path === right.path);
}

export interface Tab {
	id: string;
	/** The note of this tab; kept while the tab shows the graph or a file, so Back returns to it as it was. */
	note: OpenNote | undefined;
	/** The vault file the tab shows in the File view (a picture, a video, a sound). */
	file: string | undefined;
	/** What the tab shows. */
	view: 'Note' | 'Graph' | 'File';
	historyList: TabPlace[];
	historyIndex: number;
	/** Where the note was scrolled to (the app keeps it up to date). */
	scroll: number;
}

export interface VaultSource {
	/** Folder: a folder on disk. Browser: notes kept in this browser (the quick notes). Guide: the welcome guide, in memory. */
	kind: 'Folder' | 'Browser' | 'Guide';
	id: string;
	name: string;
	handle?: FileSystemDirectoryHandle;
}

/** A button with a message: Undo after a delete. */
export interface NotifyAction {
	title: string;
	run(): void;
}

export interface WorkspaceOption {
	formatOption(): FormatOption;
	setting(id: string): PropertyValue | undefined;
	/** Asks a yes/no question; resolves false to cancel. */
	confirm(message: string, action: string, danger?: boolean): Promise<boolean>;
	notify(message: string, action?: NotifyAction): void;
	/**
	 * Called when the open vault changes (undefined: none), before anything of it shows, so the
	 * app reads its settings first and draws its notes once.
	 */
	prepareVault?(vault: Vault | undefined, source: VaultSource | undefined): Promise<void>;
}

const untitledPattern = /^Untitled(?: \d+)?\.oi$/;
const systemPropertySet = new Set(['Id', 'Format', 'Created']);

/** No content: every block empty and no properties of your own (a blank note is never kept). */
export function isBlankNote(model: NoteModel): boolean {
	let blank = true;
	walkNode(model.document.itemList, (node) => {
		if (node.body.trim() !== '') blank = false;
	});
	if (!blank) return false;
	for (const entry of model.document.front?.entryList ?? []) if (entry.kind === 'Pair' && !systemPropertySet.has(entry.key!)) return false;
	return true;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** `2026-09-30 14:05 -04:00` in local time, as note properties write dates. */
export function nowText(date = new Date()): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function newNoteText(): string {
	return `---\nCreated: ${nowText()}\nId: ${createNoteId()}\nFormat: ${formatName}\n---\n`;
}

let tabCounter = 0;

export class Workspace {
	kind: WorkspaceKind = 'None';
	vault: Vault | undefined;
	source: VaultSource | undefined;
	tabList: Tab[] = [];
	activeTabId: string | undefined;
	private readonly listenerSet = new Set<(event: WorkspaceEvent) => void>();
	private readonly saveTimerMap = new Map<OpenNote, ReturnType<typeof setTimeout>>();
	private readonly unsubscribeMap = new Map<OpenNote, () => void>();
	private unsubscribeVault: (() => void) | undefined;
	private saving: Promise<void> = Promise.resolve();
	/** While above 0, events wait in `heldEventSet` and go out once at the end (see `hold`). */
	private holdDepth = 0;
	private readonly heldEventSet = new Set<WorkspaceEvent>();

	constructor(readonly option: WorkspaceOption) {}

	subscribe(listener: (event: WorkspaceEvent) => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	private emit(event: WorkspaceEvent): void {
		if (this.holdDepth > 0) {
			this.heldEventSet.add(event);
			return;
		}
		for (const listener of this.listenerSet) listener(event);
	}

	/**
	 * Runs `step` with the screen held: what it changes goes out as one round of events at the end,
	 * so the screen goes straight from before to after (no empty or start screen between).
	 */
	private async hold<T>(step: () => Promise<T>): Promise<T> {
		this.holdDepth++;
		try {
			return await step();
		} finally {
			this.holdDepth--;
			if (this.holdDepth === 0) {
				const order: WorkspaceEvent[] = ['Vault', 'Tab', 'Note', 'Save', 'Tree', 'Rename'];
				const list = order.filter((event) => this.heldEventSet.has(event));
				this.heldEventSet.clear();
				for (const event of list) this.emit(event);
			}
		}
	}

	/** The tab in front. */
	get tab(): Tab | undefined {
		return this.tabList.find((tab) => tab.id === this.activeTabId);
	}

	/** The note in front (undefined while the tab shows the graph or a file). */
	get note(): OpenNote | undefined {
		const tab = this.tab;
		return tab?.view === 'Note' ? tab.note : undefined;
	}

	/** The vault file in front, in the File view. */
	get file(): string | undefined {
		const tab = this.tab;
		return tab?.view === 'File' ? tab.file : undefined;
	}

	get saveState(): SaveState {
		return this.note?.saveState ?? 'Saved';
	}

	/** Every note open in a tab. */
	openNoteList(): OpenNote[] {
		return this.tabList.flatMap((tab) => (tab.note ? [tab.note] : []));
	}

	private tabOfPath(path: string): Tab | undefined {
		return this.tabList.find((tab) => tab.note && !tab.note.external && tab.note.path === path);
	}

	// ------------------------------------------------------------ vault

	/**
	 * Opens a vault (with the tabs it had last time, when `restore`); false when you kept a note
	 * that couldn't be saved. Throws when the vault can't be read; what was open then stays.
	 */
	async openVault(fs: FileSystem, source: VaultSource, option: { restore?: boolean } = {}): Promise<boolean> {
		// read it first: what is on screen stays meanwhile
		const vault = new Vault(fs);
		await vault.load();
		return this.hold(async () => {
			if (!(await this.close(false))) return false;
			await this.option.prepareVault?.(vault, source);
			this.vault = vault;
			this.source = source;
			this.kind = 'Vault';
			this.unsubscribeVault = vault.subscribe(() => this.emit('Tree'));
			this.emit('Vault');
			if (option.restore) await this.restoreTab();
			return true;
		});
	}

	/** Leaves every tab (saving, or dropping blank Untitled notes) and closes the vault or files. */
	closeAll(): Promise<boolean> {
		return this.hold(() => this.close(true));
	}

	/** Closes everything; `prepare`: tell the app no vault is open (not when another opens next). */
	private async close(prepare: boolean): Promise<boolean> {
		for (const tab of [...this.tabList]) if (!(await this.release(tab))) return false;
		for (const tab of this.tabList) if (tab.note) this.forget(tab.note);
		const hadVault = this.vault !== undefined;
		this.tabList = [];
		this.activeTabId = undefined;
		this.unsubscribeVault?.();
		this.unsubscribeVault = undefined;
		this.vault = undefined;
		this.source = undefined;
		this.kind = 'None';
		if (prepare && hadVault) await this.option.prepareVault?.(undefined, undefined);
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
		this.emit('Vault');
		return true;
	}

	/**
	 * Before a tab lets its note go: saves it, or, when its changes can't be saved (a single file
	 * without write access), asks first. False: keep it open.
	 */
	private async release(tab: Tab): Promise<boolean> {
		const note = tab.note;
		if (!note) return true;
		if (!this.canAutoSave(note) && this.isDirty(note)) {
			const ok = await this.option.confirm(`“${stemOf(note.path)}” has changes that aren’t saved to a file. Close it anyway?`, 'Close without saving', true);
			if (!ok) return false;
			storage.set(storageKey.Draft, undefined);
		}
		if (this.canAutoSave(note)) await this.save(false, note);
		return true;
	}

	// ------------------------------------------------------------ tabs

	private createTab(note: OpenNote | undefined, place: TabPlace | undefined, afterId = this.activeTabId): Tab {
		const tab: Tab = { id: `t${++tabCounter}`, note, file: undefined, view: 'Note', historyList: place ? [place] : [], historyIndex: place ? 0 : -1, scroll: 0 };
		const at = this.tabList.findIndex((item) => item.id === afterId);
		this.tabList.splice(at < 0 ? this.tabList.length : at + 1, 0, tab);
		if (note) this.watch(note);
		return tab;
	}

	activateTab(id: string): void {
		if (this.activeTabId === id || !this.tabList.some((tab) => tab.id === id)) return;
		this.activeTabId = id;
		this.remember();
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
	}

	/** Closes a tab (its note is saved, or asked about); false when you kept it. */
	async closeTab(id = this.activeTabId): Promise<boolean> {
		const tab = this.tabList.find((item) => item.id === id);
		if (!tab) return true;
		if (!(await this.release(tab))) return false;
		const index = this.tabList.indexOf(tab);
		if (tab.note) this.forget(tab.note);
		this.tabList.splice(index, 1);
		if (this.activeTabId === id) this.activeTabId = (this.tabList[index] ?? this.tabList[index - 1])?.id;
		// the last single file closed: back to the start screen
		if (this.tabList.length === 0 && this.kind === 'File') {
			this.kind = 'None';
			this.emit('Vault');
		}
		this.remember();
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
		this.emit('Tree');
		return true;
	}

	/** Closes the tab in front; a single file goes back to the start screen. */
	closeNote(): Promise<boolean> {
		return this.closeTab(this.activeTabId);
	}

	moveTab(id: string, index: number): void {
		const from = this.tabList.findIndex((tab) => tab.id === id);
		if (from < 0) return;
		const [tab] = this.tabList.splice(from, 1);
		this.tabList.splice(Math.max(0, Math.min(index, this.tabList.length)), 0, tab!);
		this.remember();
		this.emit('Tab');
	}

	/** The next (or, with -1, the previous) tab, going round. */
	cycleTab(step: 1 | -1): void {
		if (this.tabList.length < 2) return;
		const index = this.tabList.findIndex((tab) => tab.id === this.activeTabId);
		this.activateTab(this.tabList[(index + step + this.tabList.length) % this.tabList.length]!.id);
	}

	// ------------------------------------------------------------ notes

	private makeNote(path: string, text: string, option: Partial<OpenNote> = {}): OpenNote {
		return { path, model: NoteModel.fromText(text, this.option.formatOption()), savedText: text, autoNamed: false, external: false, saveState: 'Saved', ...option };
	}

	/** Shows `note` in the tab in front (or a new tab): the tab's old note is saved and let go. */
	private async place(note: OpenNote, newTab: boolean, history: boolean): Promise<boolean> {
		const tab = this.tab;
		if (!tab || newTab) {
			const created = this.createTab(note, { kind: 'Note', path: note.path });
			this.activeTabId = created.id;
		} else {
			if (tab.note !== note) {
				if (!(await this.release(tab))) return false;
				if (tab.note) this.forget(tab.note);
				tab.note = note;
				this.watch(note);
			}
			tab.view = 'Note';
			tab.scroll = 0;
			if (history) this.push(tab, { kind: 'Note', path: note.path });
		}
		this.remember();
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
		this.emit('Tree');
		return true;
	}

	private push(tab: Tab, place: TabPlace): void {
		if (samePlace(tab.historyList[tab.historyIndex], place)) return;
		tab.historyList.splice(tab.historyIndex + 1);
		tab.historyList.push(place);
		tab.historyIndex = tab.historyList.length - 1;
	}

	/** Opens a note of the vault: in its tab if it is open, else here (or in a new tab). */
	async openNote(path: string, option: { newTab?: boolean; history?: boolean } = {}): Promise<boolean> {
		const vault = this.vault;
		if (!vault) return false;
		const open = this.tabOfPath(path);
		if (open) {
			if (open.id !== this.activeTabId) this.activateTab(open.id);
			if (open.view !== 'Note') {
				open.view = 'Note';
				if (option.history !== false) this.push(open, { kind: 'Note', path });
				this.emit('Tab');
				this.emit('Note');
				this.emit('Save');
			}
			return true;
		}
		let text: string;
		try {
			text = await vault.read(path);
		} catch {
			this.option.notify(`Couldn’t read “${stemOf(path)}”.`);
			return false;
		}
		// the note may have been opened meanwhile (two quick clicks)
		if (this.tabOfPath(path)) return this.openNote(path, option);
		return this.place(this.makeNote(path, text), option.newTab === true, option.history !== false);
	}

	/**
	 * Shows a file of the vault on its own (a picture, a video, a sound), as Obsidian does: in its
	 * tab if one shows it already, else here (the tab's note stays, for Back) or in a new tab.
	 */
	openFile(path: string, option: { newTab?: boolean; history?: boolean } = {}): boolean {
		if (!this.vault?.has(path)) return false;
		const open = this.tabList.find((tab) => tab.view === 'File' && tab.file === path);
		if (open) {
			this.activateTab(open.id);
			return true;
		}
		let tab = this.tab;
		if (!tab || option.newTab) {
			tab = this.createTab(undefined, undefined);
			this.activeTabId = tab.id;
		}
		// the tab's note keeps its scroll position, for Back
		tab.file = path;
		tab.view = 'File';
		if (option.history !== false) this.push(tab, { kind: 'File', path });
		this.remember();
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
		this.emit('Tree');
		return true;
	}

	/** Opens text that isn't a vault file, in a new tab: a single file, or a kept draft. */
	openText(text: string, name: string, option: { handle?: FileSystemFileHandle; keepVault?: boolean; saved?: boolean } = {}): Promise<boolean> {
		return this.hold(async () => {
			if (!option.keepVault && this.kind === 'Vault' && !(await this.close(true))) return false;
			if (this.kind === 'None') this.kind = 'File';
			const note = this.makeNote(name, text, {
				savedText: option.saved === false ? undefined : text,
				external: true,
				...(option.handle ? { handle: option.handle } : {}),
			});
			note.saveState = this.isDirty(note) ? (this.canAutoSave(note) ? 'Unsaved' : 'Download') : 'Saved';
			const done = await this.place(note, this.tabList.length > 0, true);
			this.emit('Vault');
			return done;
		});
	}

	/** A free "Untitled" name in a folder: not on disk and not a new note in another tab. */
	private freePath(folder: string, stem: string): string {
		for (let count = 0; ; count++) {
			const name = count === 0 ? stem : `${stem} ${count}`;
			const path = this.vault ? this.vault.uniquePath(folder, name) : `${name}.oi`;
			if (!this.tabList.some((tab) => tab.note?.path === path)) return path;
		}
	}

	/**
	 * A new note in a new tab: "Untitled.oi" in the vault (in the current folder or the root, a
	 * setting), or an untitled note on its own. Nothing is written until it has content.
	 */
	async newNote(folder?: string): Promise<OpenNote | undefined> {
		const text = newNoteText();
		let note: OpenNote;
		if (this.vault) {
			note = this.makeNote(this.freePath(folder ?? '', 'Untitled'), text, { savedText: undefined, autoNamed: true });
		} else {
			this.kind = 'File';
			note = this.makeNote(this.freePath('', 'Untitled'), text, { savedText: undefined, autoNamed: true, external: true });
		}
		await this.place(note, true, true);
		if (!this.vault) this.emit('Vault');
		return note;
	}

	/** The folder a new note goes to: the current note's (a setting) or the vault root. */
	newNoteFolder(): string {
		if (this.option.setting('File.NewNoteLocation') === 'CurrentFolder' && this.note && !this.note.external) return parentPath(this.note.path);
		return '';
	}

	private watch(note: OpenNote): void {
		if (this.unsubscribeMap.has(note)) return;
		this.unsubscribeMap.set(
			note,
			note.model.subscribe(() => this.onModelChange(note)),
		);
	}

	private forget(note: OpenNote): void {
		clearTimeout(this.saveTimerMap.get(note));
		this.saveTimerMap.delete(note);
		this.unsubscribeMap.get(note)?.();
		this.unsubscribeMap.delete(note);
	}

	/** Whether a note has something to save. */
	isDirty(note = this.note): boolean {
		if (!note) return false;
		const blank = note.autoNamed && isBlankNote(note.model);
		if (blank) return note.savedText !== undefined && !note.external;
		return note.model.serialize() !== (note.savedText ?? '');
	}

	canAutoSave(note = this.note): boolean {
		if (!note) return false;
		return (this.kind === 'Vault' && !note.external) || note.handle !== undefined;
	}

	private onModelChange(note: OpenNote): void {
		if (this.canAutoSave(note)) {
			this.setSaveState(note, this.isDirty(note) ? 'Unsaved' : 'Saved');
			clearTimeout(this.saveTimerMap.get(note));
			this.saveTimerMap.set(
				note,
				setTimeout(() => void this.save(false, note), 600),
			);
		} else {
			this.setSaveState(note, this.isDirty(note) ? 'Download' : 'Saved');
			this.saveDraft(note);
		}
	}

	private setSaveState(note: OpenNote, state: SaveState): void {
		if (note.saveState === state) return;
		note.saveState = state;
		this.emit('Save');
	}

	/** Saves a note (the one in front by default). `explicit` (Ctrl+S) also downloads a file that can't be written in place. */
	save(explicit = false, note = this.note): Promise<void> {
		if (!note) return this.saving;
		this.saving = this.saving.then(() => this.saveNow(note, explicit)).catch(() => undefined);
		return this.saving;
	}

	/** Saves every open note (when the page is hidden or closed). */
	async saveAll(): Promise<void> {
		for (const note of this.openNoteList()) if (this.canAutoSave(note)) await this.save(false, note);
	}

	private async saveNow(note: OpenNote, explicit: boolean): Promise<void> {
		clearTimeout(this.saveTimerMap.get(note));
		const text = note.model.serialize();
		if (this.kind === 'Vault' && this.vault && !note.external) {
			if (note.autoNamed && isBlankNote(note.model)) {
				// a blank Untitled note is never kept, not even in the trash
				if (note.savedText !== undefined && this.vault.has(note.path)) await this.vault.deleteForever(note.path);
				note.savedText = undefined;
				this.setSaveState(note, 'Saved');
				return;
			}
			if (text === note.savedText) {
				this.setSaveState(note, 'Saved');
				return;
			}
			this.setSaveState(note, 'Saving');
			try {
				await this.vault.write(note.path, text);
				note.savedText = text;
				this.setSaveState(note, note.model.serialize() !== text ? 'Unsaved' : 'Saved');
				this.remember();
			} catch {
				this.setSaveState(note, 'Failed');
				this.option.notify(`Couldn’t save “${stemOf(note.path)}”. The changes are still here; try again with Ctrl+S.`);
			}
			return;
		}
		if (note.handle) {
			this.setSaveState(note, 'Saving');
			if (await writeHandle(note.handle, text)) {
				note.savedText = text;
				this.setSaveState(note, 'Saved');
			} else {
				this.setSaveState(note, 'Failed');
				this.option.notify('The browser didn’t let the app write the file. Use Save as to pick a place.');
			}
			return;
		}
		if (!explicit) return;
		if (this.vault && note.external) {
			// a stray file: save it into the vault
			const path = this.freePath('', stemOf(note.path));
			await this.vault.write(path, text);
			note.path = path;
			note.savedText = text;
			note.external = false;
			note.autoNamed = false;
			this.setSaveState(note, 'Saved');
			this.option.notify(`Saved into ${this.source?.kind === 'Browser' ? 'the quick notes' : 'the vault'} as “${stemOf(path)}”.`);
			this.emit('Rename');
			this.emit('Tab');
			return;
		}
		// no way to write the file in place: pick a place (Chromium) or download
		if (window.showSaveFilePicker) {
			try {
				const handle = await window.showSaveFilePicker({ suggestedName: note.path, types: [{ description: 'Octaether Ink note', accept: { 'text/plain': ['.oi'] } }] });
				if (await writeHandle(handle, text)) {
					note.handle = handle;
					note.path = handle.name;
					note.savedText = text;
					note.autoNamed = false;
					this.setSaveState(note, 'Saved');
					this.emit('Rename');
					this.emit('Tab');
				}
				return;
			} catch {
				return;
			}
		}
		downloadText(note.path.endsWith('.oi') ? note.path : `${note.path}.oi`, text);
		note.savedText = text;
		this.saveDraft(note);
		this.setSaveState(note, 'Saved');
	}

	/** Saves every note that saves by itself (in a vault this also removes blank Untitled notes). */
	async leaveNote(): Promise<void> {
		await this.saveAll();
	}

	private saveDraft(note: OpenNote): void {
		if (this.canAutoSave(note) || (this.vault && note.external)) return;
		const text = note.model.serialize();
		storage.set(storageKey.Draft, JSON.stringify({ name: note.path, text, saved: text === note.savedText }));
	}

	// ------------------------------------------------------------ files and folders

	/**
	 * Renames a note (give its new name without `.oi`) or a folder; returns the new path. Renaming
	 * an open note is a step in its history, so Ctrl+Z takes it back.
	 */
	async rename(path: string, newName: string, option: { history?: boolean } = {}): Promise<string | undefined> {
		const name = newName.trim();
		const tab = this.tabList.find((item) => item.note?.path === path);
		const note = tab?.note;
		const isFolder = this.vault?.kindOf(path) === 'Folder';
		const extension = isFolder ? '' : extensionOf(path) || 'oi';
		const fileName = extension ? `${name}.${extension}` : name;
		const problem = nameProblem(fileName);
		if (problem) {
			this.option.notify(problem);
			return undefined;
		}
		const oldName = stemOf(path);
		const record = (next: string): void => {
			if (!note || option.history === false || stemOf(next) === oldName) return;
			// undo renames back (and redo again), in order with the note's edits
			note.model.record({
				label: 'Rename',
				undo: () => void this.rename(note.path, oldName, { history: false }),
				redo: () => void this.rename(note.path, stemOf(next), { history: false }),
			});
		};
		// a note not written yet (or a single file) only changes its name here
		if (note && (note.external || note.savedText === undefined)) {
			const target = note.external ? fileName : joinPath(parentPath(path), fileName);
			if (target === path) return path;
			if (!note.external && (this.vault?.isTaken(target, path) || this.tabList.some((item) => item.note !== note && item.note?.path === target))) {
				this.option.notify(`“${name}” already exists there.`);
				return undefined;
			}
			note.path = target;
			note.autoNamed = untitledPattern.test(target.split('/').pop() ?? '') && note.autoNamed;
			this.renamePlace(path, target);
			record(target);
			this.emit('Rename');
			this.emit('Tab');
			this.emit('Tree');
			// a named note is kept even while empty
			if (!note.external) await this.save(false, note);
			return target;
		}
		const vault = this.vault;
		if (!vault) return undefined;
		const target = joinPath(parentPath(path), fileName);
		if (target === path) return path;
		try {
			if (note) await this.save(false, note);
			const result = await vault.rename(path, target, { updateLink: this.option.setting('File.UpdateLink') !== false });
			this.afterMove(path, result.path);
			record(result.path);
			if (result.changedList.length > 0) this.option.notify(`Updated the links in ${result.changedList.length} ${result.changedList.length === 1 ? 'note' : 'notes'}.`);
			return result.path;
		} catch (error) {
			this.option.notify(error instanceof VaultError ? error.message : `Couldn’t rename “${stemOf(path)}”.`);
			return undefined;
		}
	}

	/** Moves a file or folder into another folder ('' = the vault root). */
	async move(path: string, folder: string): Promise<void> {
		const vault = this.vault;
		if (!vault || parentPath(path) === folder) return;
		const name = path.split('/').pop()!;
		try {
			for (const note of this.openNoteList()) if (!note.external && isInside(note.path, path)) await this.save(false, note);
			const result = await vault.rename(path, joinPath(folder, name), { updateLink: this.option.setting('File.UpdateLink') !== false });
			this.afterMove(path, result.path);
		} catch (error) {
			this.option.notify(error instanceof VaultError ? error.message : `Couldn’t move “${name}”.`);
		}
	}

	/** Follows a rename or move in the open notes and in every tab's history. */
	private afterMove(from: string, to: string): void {
		let changed = false;
		for (const note of this.openNoteList()) {
			if (note.external || !isInside(note.path, from)) continue;
			note.path = to + note.path.slice(from.length);
			if (!untitledPattern.test(note.path.split('/').pop() ?? '')) note.autoNamed = false;
			changed = true;
		}
		for (const tab of this.tabList) {
			if (tab.file === undefined || !isInside(tab.file, from)) continue;
			tab.file = to + tab.file.slice(from.length);
			changed = true;
		}
		this.renamePlace(from, to);
		if (changed) {
			this.remember();
			this.emit('Rename');
			this.emit('Tab');
		}
	}

	private renamePlace(from: string, to: string): void {
		for (const tab of this.tabList) {
			for (const place of tab.historyList) if (place.kind !== 'Graph' && isInside(place.path, from)) place.path = to + place.path.slice(from.length);
		}
	}

	/** Whether deleting here is for good: notes kept in the browser have no trash, and a setting can ask for it. */
	deletesForGood(): boolean {
		return this.source?.kind === 'Browser' || this.option.setting('File.DeleteTo') === 'Permanent';
	}

	/**
	 * Deletes a file or folder: to the vault's trash, or for good (see `deletesForGood`), after
	 * asking (a setting, and always for notes kept in the browser). The message after it offers
	 * Undo, which puts it back and shows the note again.
	 */
	async delete(path: string): Promise<boolean> {
		const vault = this.vault;
		if (!vault) return false;
		const affected = this.tabList.filter((tab) => tab.note && !tab.note.external && isInside(tab.note.path, path));
		const current = affected.find((tab) => tab.note!.path === path)?.note;
		// a blank Untitled note that was never written just goes away
		if (current && current.autoNamed && isBlankNote(current.model)) {
			if (vault.has(path)) await vault.deleteForever(path);
			for (const tab of affected) await this.dropTab(tab);
			this.emit('Tree');
			return true;
		}
		if (!vault.has(path)) return false;
		const browser = this.source?.kind === 'Browser';
		const forGood = this.deletesForGood();
		const folder = vault.kindOf(path) === 'Folder';
		const name = `“${isNote(path) ? stemOf(path) : baseName(path)}”`;
		const label = folder ? `the folder ${name}` : name;
		if (browser || this.option.setting('File.ConfirmDelete') !== false) {
			const what = folder ? `${label} and everything in it` : label;
			const ok = await this.option.confirm(
				browser
					? `Delete ${what}? Notes kept in this browser have no trash: the Undo button shown for a few seconds right after is the only way to get it back.`
					: forGood
						? `Delete ${what} permanently? It doesn’t go to the trash: the Undo button shown for a few seconds right after is the only way to get it back.`
						: `Move ${what} to the trash? It goes to the vault’s .oi/Trash folder.`,
				forGood ? 'Delete' : 'Move to trash',
				true,
			);
			if (!ok) return false;
		}
		// the note in front comes back with Undo
		const reopen = this.note && !this.note.external && this.note.path === path ? path : undefined;
		// save the latest text first, so the trash (or the copy kept for Undo) holds what you last saw
		for (const tab of affected) await this.save(false, tab.note);
		let snapshot: VaultSnapshot | undefined;
		if (forGood) snapshot = await vault.snapshot(path).catch(() => undefined);
		for (const tab of affected) await this.dropTab(tab);
		// a tab showing a file that goes: back to its note, or closed
		for (const tab of this.tabList.filter((item) => item.file !== undefined && isInside(item.file, path))) {
			tab.file = undefined;
			tab.historyList = tab.historyList.filter((place) => place.kind === 'Graph' || !isInside(place.path, path));
			tab.historyIndex = Math.min(tab.historyIndex, tab.historyList.length - 1);
			if (tab.view !== 'File') continue;
			if (tab.note) {
				tab.view = 'Note';
				this.emit('Tab');
				this.emit('Note');
			} else await this.closeTab(tab.id);
		}
		try {
			if (forGood) {
				await vault.deleteForever(path);
				const kept = snapshot;
				this.option.notify(`Deleted ${label}.`, kept ? { title: 'Undo', run: () => void this.undoDelete(vault, () => vault.putBack(kept), reopen) } : undefined);
			} else {
				const trashPath = await vault.trash(path);
				this.option.notify(`Moved ${label} to the trash.`, { title: 'Undo', run: () => void this.undoDelete(vault, () => vault.restore(trashPath), reopen) });
			}
			return true;
		} catch {
			this.option.notify(`Couldn’t delete ${label}.`);
			return false;
		}
	}

	/** Undo of a delete: puts it back (while its vault is still open), and shows the note again if it was in front. */
	private async undoDelete(vault: Vault, putBack: () => Promise<string>, reopen: string | undefined): Promise<void> {
		if (this.vault !== vault) return;
		try {
			const path = await putBack();
			if (reopen && isNote(path)) await this.openNote(path);
		} catch {
			this.option.notify('Couldn’t put it back.');
		}
	}

	/** Closes a tab whose note is gone, without saving it again. */
	private async dropTab(tab: Tab): Promise<void> {
		if (tab.note) this.forget(tab.note);
		tab.note = undefined;
		await this.closeTab(tab.id);
	}

	async createFolder(parent: string): Promise<string | undefined> {
		try {
			return await this.vault?.createFolder(parent, 'Untitled');
		} catch (error) {
			this.option.notify(error instanceof VaultError ? error.message : 'Couldn’t make the folder.');
			return undefined;
		}
	}

	// ------------------------------------------------------------ the graph and history, per tab

	/** Shows the graph in the tab in front (a new tab when none is open); Back returns to the note. */
	showGraph(): void {
		let tab = this.tab;
		if (!tab) {
			tab = this.createTab(undefined, undefined);
			this.activeTabId = tab.id;
		}
		if (tab.view === 'Graph') return;
		tab.view = 'Graph';
		this.push(tab, { kind: 'Graph' });
		this.emit('Tab');
		this.emit('Note');
		this.emit('Save');
	}

	/** Leaves the graph: back to where the tab was, or to its note. */
	async hideGraph(): Promise<void> {
		const tab = this.tab;
		if (!tab || tab.view !== 'Graph') return;
		if (this.canGoBack()) {
			await this.goBack();
			return;
		}
		if (tab.note) {
			tab.view = 'Note';
			this.emit('Tab');
			this.emit('Note');
			this.emit('Save');
		} else await this.closeTab(tab.id);
	}

	canGoBack(): boolean {
		return (this.tab?.historyIndex ?? 0) > 0;
	}

	canGoForward(): boolean {
		const tab = this.tab;
		return tab !== undefined && tab.historyIndex < tab.historyList.length - 1;
	}

	private async goTo(index: number): Promise<void> {
		const tab = this.tab;
		const place = tab?.historyList[index];
		if (!tab || !place) return;
		if (place.kind === 'Graph' || (place.kind === 'File' && this.vault?.has(place.path))) {
			tab.historyIndex = index;
			tab.view = place.kind;
			if (place.kind === 'File') tab.file = place.path;
			this.emit('Tab');
			this.emit('Note');
			this.emit('Save');
			this.emit('Tree');
			return;
		}
		if (place.kind === 'File') {
			this.option.notify(`“${baseName(place.path)}” is no longer in the vault.`);
			return;
		}
		if (tab.note?.path === place.path) {
			tab.historyIndex = index;
			tab.view = 'Note';
			this.emit('Tab');
			this.emit('Note');
			this.emit('Save');
			return;
		}
		// another tab may hold that note now: it moves here
		const other = this.tabOfPath(place.path);
		if (other && other !== tab) {
			this.activateTab(other.id);
			return;
		}
		const index0 = tab.historyIndex;
		tab.historyIndex = index;
		if (!(await this.openNote(place.path, { history: false }))) tab.historyIndex = index0;
	}

	async goBack(): Promise<void> {
		if (this.canGoBack()) await this.goTo(this.tab!.historyIndex - 1);
	}

	async goForward(): Promise<void> {
		if (this.canGoForward()) await this.goTo(this.tab!.historyIndex + 1);
	}

	// ------------------------------------------------------------ remembered tabs

	private tabKey(): string {
		return `OctaetherInk.Tab.${this.source?.id ?? 'None'}`;
	}

	/** Remembers which notes and files are open in this vault, to open them again next time. */
	private remember(): void {
		if (!this.source || this.source.kind === 'Guide') return;
		const shownOf = (tab: Tab | undefined): string | undefined => {
			if (tab?.view === 'File') return tab.file;
			return tab?.view === 'Note' && tab.note && !tab.note.external && tab.note.savedText !== undefined ? tab.note.path : undefined;
		};
		const pathList = this.tabList.flatMap((tab) => shownOf(tab) ?? []);
		storage.set(this.tabKey(), JSON.stringify({ pathList, active: shownOf(this.tab) }));
	}

	/** Opens the notes and files that were open last time in this vault (those that still exist). */
	async restoreTab(): Promise<boolean> {
		const vault = this.vault;
		if (!vault || !this.source) return false;
		let saved: { pathList?: string[]; active?: string } = {};
		try {
			saved = JSON.parse(storage.get(this.tabKey()) ?? '{}') as typeof saved;
		} catch {
			saved = {};
		}
		const pathList = (saved.pathList ?? []).filter((path) => vault.has(path));
		for (const path of pathList) {
			if (isNote(path)) await this.openNote(path, { newTab: true });
			else this.openFile(path, { newTab: true });
		}
		const active = saved.active && this.tabList.find((tab) => (tab.view === 'File' ? tab.file : tab.note?.path) === saved.active);
		if (active) this.activateTab(active.id);
		return pathList.length > 0;
	}
}
