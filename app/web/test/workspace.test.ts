// @vitest-environment happy-dom
// The workspace's file rules, on a vault in memory: new notes, blank notes, saving, renaming,
// deleting (to the trash, or for good) with Undo, switching vaults, and Back / Forward.
import { insertTemplate } from '@octaether/core-edit';
import type { PropertyValue } from '@octaether/core-format';
import { MemoryFileSystem } from '@octaether/core-vault';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type NotifyAction, type VaultSource, Workspace, isBlankNote } from '../src/workspace';

async function open(fileMap: Record<string, string> = {}, settingMap: Record<string, PropertyValue> = {}, answer = true, kind: VaultSource['kind'] = 'Folder') {
	const fs = new MemoryFileSystem('Test', fileMap);
	const messageList: string[] = [];
	const actionList: NotifyAction[] = [];
	const questionList: string[] = [];
	const workspace = new Workspace({
		formatOption: () => ({}),
		setting: (id) => settingMap[id],
		confirm: async (message) => {
			questionList.push(message);
			return answer;
		},
		notify: (message, action) => {
			messageList.push(message);
			if (action) actionList.push(action);
		},
	});
	await workspace.openVault(fs, { kind, id: 'test', name: 'Test' });
	return { fs, workspace, vault: workspace.vault!, messageList, actionList, questionList };
}

/** Lets the promise a toast's button starts (Undo) finish. */
async function settle(): Promise<void> {
	for (let index = 0; index < 6; index++) await new Promise((done) => setTimeout(done, 0));
}

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('Workspace', () => {
	it('writes a new note only once it has content', async () => {
		const { workspace, vault } = await open();
		const note = (await workspace.newNote())!;
		expect(note.path).toBe('Untitled.oi');
		expect(note.model.serialize()).toMatch(/^---\nCreated: .+\nId: [a-z0-9]+\nFormat: Oi 1\n---\n$/);
		expect(isBlankNote(note.model)).toBe(true);
		insertTemplate(note.model, null, null, '');
		await workspace.save();
		expect(vault.has('Untitled.oi')).toBe(false);
		insertTemplate(note.model, null, null, 'Hello');
		await workspace.save();
		expect(vault.has('Untitled.oi')).toBe(true);
		expect(await vault.read('Untitled.oi')).toContain('Hello');
		// the next new note gets the next free name
		expect((await workspace.newNote())!.path).toBe('Untitled 1.oi');
	});

	it('drops a blank Untitled note for good, even after typing and undoing', async () => {
		const { workspace, vault } = await open();
		// each new note opens in a tab of its own; closing a blank one leaves nothing behind
		await workspace.newNote();
		await workspace.newNote();
		expect(workspace.tabList.map((tab) => tab.note?.path)).toEqual(['Untitled.oi', 'Untitled 1.oi']);
		await workspace.closeNote();
		await workspace.closeNote();
		expect(workspace.tabList).toEqual([]);
		expect(vault.noteList()).toEqual([]);
		const note = (await workspace.newNote())!;
		expect(note.path).toBe('Untitled.oi');
		insertTemplate(note.model, null, null, 'Draft');
		await workspace.save();
		expect(vault.has('Untitled.oi')).toBe(true);
		note.model.undo();
		expect(isBlankNote(note.model)).toBe(true);
		expect(workspace.isDirty()).toBe(true);
		await workspace.closeNote();
		expect(vault.has('Untitled.oi')).toBe(false);
		// removed for good: not in the trash either
		expect(vault.trashList()).toEqual([]);
	});

	it('saves by itself a moment after a change', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { workspace, vault } = await open({ 'Lab.oi': 'pH 7\n' });
		await workspace.openNote('Lab.oi');
		const model = workspace.note!.model;
		model.setBody(model.document.itemList[0]!.key, 'pH 4');
		expect(workspace.saveState).toBe('Unsaved');
		await vi.advanceTimersByTimeAsync(700);
		expect(await vault.read('Lab.oi')).toBe('pH 4\n');
		expect(workspace.saveState).toBe('Saved');
	});

	it('keeps a named note even while it is empty', async () => {
		const { workspace, vault } = await open();
		await workspace.newNote();
		expect(await workspace.rename('Untitled.oi', 'Plan')).toBe('Plan.oi');
		expect(workspace.note!.autoNamed).toBe(false);
		expect(vault.has('Plan.oi')).toBe(true);
		await workspace.closeNote();
		expect(vault.has('Plan.oi')).toBe(true);
	});

	it('renames a note and rewrites the links to it', async () => {
		const { workspace, vault, messageList } = await open({ 'Index.oi': 'See [[Titration]] and [[Titration#Result|the result]].\n', 'Titration.oi': 'pH\n' });
		await workspace.openNote('Titration.oi');
		expect(await workspace.rename('Titration.oi', 'Acid base')).toBe('Acid base.oi');
		expect(workspace.note!.path).toBe('Acid base.oi');
		expect(vault.has('Titration.oi')).toBe(false);
		expect(await vault.read('Index.oi')).toBe('See [[Acid base]] and [[Acid base#Result|the result]].\n');
		expect(messageList.at(-1)).toBe('Updated the links in 1 note.');
		// and Ctrl+Z renames it back
		workspace.note!.model.undo();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(workspace.note!.path).toBe('Titration.oi');
		// names a disk can't hold are refused
		expect(await workspace.rename('Acid base.oi', 'a/b')).toBeUndefined();
	});

	it('moves a deleted note to the trash after asking, and Undo brings it back into its tab', async () => {
		const { workspace, vault, questionList, messageList, actionList } = await open({ 'Lab/Titration.oi': 'pH\n', 'Keep.oi': 'x\n' });
		await workspace.openNote('Lab/Titration.oi');
		expect(await workspace.delete('Lab/Titration.oi')).toBe(true);
		expect(questionList[0]).toBe('Move “Titration” to the trash? It goes to the vault’s .oi/Trash folder.');
		expect(workspace.note).toBeUndefined();
		expect(vault.has('Lab/Titration.oi')).toBe(false);
		expect(vault.trashList().map((entry) => entry.path)).toEqual(['.oi/Trash/Lab/Titration.oi']);
		expect(messageList.at(-1)).toBe('Moved “Titration” to the trash.');
		expect(actionList.at(-1)!.title).toBe('Undo');
		actionList.at(-1)!.run();
		await settle();
		expect(await vault.read('Lab/Titration.oi')).toBe('pH\n');
		expect(vault.trashList()).toEqual([]);
		expect(workspace.note!.path).toBe('Lab/Titration.oi');
		// a folder goes to the trash under its own name
		expect(await workspace.delete('Lab')).toBe(true);
		expect(questionList.at(-1)).toMatch(/^Move the folder “Lab” and everything in it to the trash\?/);
		expect(vault.has('.oi/Trash/Lab/Titration.oi')).toBe(true);
	});

	it('deletes for good when set to, and does nothing when the question is cancelled', async () => {
		const permanent = await open({ 'Old.oi': 'x\n' }, { 'File.DeleteTo': 'Permanent', 'File.ConfirmDelete': false });
		expect(await permanent.workspace.delete('Old.oi')).toBe(true);
		expect(permanent.vault.has('Old.oi')).toBe(false);
		expect(permanent.vault.trashList()).toEqual([]);
		expect(permanent.questionList).toEqual([]);
		// Undo still works right after: a copy was kept in memory
		permanent.actionList.at(-1)!.run();
		await settle();
		expect(await permanent.vault.read('Old.oi')).toBe('x\n');
		const cancelled = await open({ 'Old.oi': 'x\n' }, {}, false);
		expect(await cancelled.workspace.delete('Old.oi')).toBe(false);
		expect(cancelled.vault.has('Old.oi')).toBe(true);
	});

	it('deletes quick notes for good, always asking first, and Undo puts them back', async () => {
		const { workspace, vault, questionList, messageList, actionList } = await open({ 'Idea.oi': 'Remember this\n', 'Attachment/Sketch.png': 'png' }, { 'File.ConfirmDelete': false }, true, 'Browser');
		expect(workspace.deletesForGood()).toBe(true);
		expect(await workspace.delete('Idea.oi')).toBe(true);
		expect(questionList).toEqual(['Delete “Idea”? Notes kept in this browser have no trash: the Undo button shown for a few seconds right after is the only way to get it back.']);
		expect(vault.has('Idea.oi')).toBe(false);
		expect(vault.trashList()).toEqual([]);
		expect(messageList.at(-1)).toBe('Deleted “Idea”.');
		actionList.at(-1)!.run();
		await settle();
		expect(await vault.read('Idea.oi')).toBe('Remember this\n');
		expect(vault.resolve('Idea')).toBe('Idea.oi');
		// pictures and folders too
		expect(await workspace.delete('Attachment')).toBe(true);
		expect(questionList.at(-1)).toMatch(/^Delete the folder “Attachment” and everything in it\? Notes kept in this browser have no trash:/);
		actionList.at(-1)!.run();
		await settle();
		expect(await (await vault.readBinary('Attachment/Sketch.png')).text()).toBe('png');
	});

	it('switches vaults in one step: no moment without a vault, and the tabs come back with it', async () => {
		const first = await open({ 'A.oi': 'a\n' });
		await first.workspace.openNote('A.oi');
		const second = new MemoryFileSystem('Second', { 'B.oi': 'b\n', 'C.oi': 'c\n' });
		localStorage.setItem('OctaetherInk.Tab.second', JSON.stringify({ pathList: ['B.oi', 'C.oi'], active: 'C.oi' }));
		const seenList: string[] = [];
		first.workspace.subscribe((event) => seenList.push(`${event}:${first.workspace.kind}:${first.workspace.tabList.length}`));
		expect(await first.workspace.openVault(second, { kind: 'Folder', id: 'second', name: 'Second' }, { restore: true })).toBe(true);
		// one round of events, each seeing the new vault with its tabs
		expect(seenList).toEqual(['Vault:Vault:2', 'Tab:Vault:2', 'Note:Vault:2', 'Save:Vault:2', 'Tree:Vault:2']);
		expect(first.workspace.note!.path).toBe('C.oi');
		// a vault that can't be read leaves the open one as it was
		const broken = new MemoryFileSystem('Broken');
		broken.list = () => Promise.reject(new Error('gone'));
		await expect(first.workspace.openVault(broken, { kind: 'Folder', id: 'broken', name: 'Broken' })).rejects.toThrow('gone');
		expect(first.workspace.source!.id).toBe('second');
		expect(first.workspace.tabList).toHaveLength(2);
	});

	it('asks before closing a single file whose changes can’t be saved, then shows the start', async () => {
		const kept = await open({}, {}, false);
		await kept.workspace.closeAll();
		expect(await kept.workspace.openText('Lab notes\n', 'Lab.oi')).toBe(true);
		const model = kept.workspace.note!.model;
		model.setBody(model.document.itemList[0]!.key, 'Lab notes, edited');
		expect(kept.workspace.saveState).toBe('Download');
		// you keep it: nothing closes
		expect(await kept.workspace.closeNote()).toBe(false);
		expect(kept.workspace.note!.path).toBe('Lab.oi');
		expect(kept.questionList[0]).toMatch(/aren’t saved to a file/);
		const dropped = await open();
		await dropped.workspace.closeAll();
		await dropped.workspace.openText('Lab notes\n', 'Lab.oi');
		expect(dropped.workspace.kind).toBe('File');
		expect(await dropped.workspace.closeNote()).toBe(true);
		expect(dropped.workspace.kind).toBe('None');
		expect(dropped.questionList).toEqual([]);
	});

	it('goes back and forward through the notes you visited, in each tab', async () => {
		const { workspace } = await open({ 'A.oi': 'a\n', 'B.oi': 'b\n', 'C.oi': 'c\n' });
		await workspace.openNote('A.oi');
		await workspace.openNote('B.oi');
		await workspace.openNote('C.oi');
		await workspace.goBack();
		await workspace.goBack();
		expect(workspace.note!.path).toBe('A.oi');
		expect(workspace.canGoBack()).toBe(false);
		await workspace.goForward();
		expect(workspace.note!.path).toBe('B.oi');
		// opening another note drops the forward list
		await workspace.openNote('A.oi');
		expect(workspace.canGoForward()).toBe(false);
		// a new tab has a history of its own, and the graph is a place in it
		await workspace.openNote('C.oi', { newTab: true });
		expect(workspace.tabList).toHaveLength(2);
		expect(workspace.canGoBack()).toBe(false);
		await workspace.showGraph();
		expect(workspace.tab!.view).toBe('Graph');
		await workspace.goBack();
		expect(workspace.tab!.view).toBe('Note');
		expect(workspace.note!.path).toBe('C.oi');
		// a note open in a tab is shown there rather than opened twice
		await workspace.openNote('A.oi');
		expect(workspace.tabList).toHaveLength(2);
		expect(workspace.activeTabId).toBe(workspace.tabList[0]!.id);
	});

	it('shows a picture of the vault in the tab, follows its rename, and lets it go when it is deleted', async () => {
		const { workspace, vault } = await open({ 'Lab.oi': 'pH\n', 'Attachment/Cell.png': 'png bytes' });
		await workspace.openNote('Lab.oi');
		expect(workspace.openFile('Attachment/Cell.png')).toBe(true);
		expect(workspace.file).toBe('Attachment/Cell.png');
		expect(workspace.note).toBeUndefined();
		expect(await (await vault.readBinary('Attachment/Cell.png')).text()).toBe('png bytes');
		// Back returns to the note the tab held, Forward to the picture
		await workspace.goBack();
		expect(workspace.note!.path).toBe('Lab.oi');
		await workspace.goForward();
		expect(workspace.file).toBe('Attachment/Cell.png');
		// a file opened twice is shown in its tab
		workspace.openFile('Attachment/Cell.png', { newTab: true });
		expect(workspace.tabList).toHaveLength(1);
		expect(await workspace.rename('Attachment/Cell.png', 'Plant cell')).toBe('Attachment/Plant cell.png');
		expect(workspace.file).toBe('Attachment/Plant cell.png');
		expect(await workspace.delete('Attachment/Plant cell.png')).toBe(true);
		expect(workspace.tab!.view).toBe('Note');
		expect(workspace.note!.path).toBe('Lab.oi');
		// files that can't be shown are refused
		expect(workspace.openFile('Missing.png')).toBe(false);
	});

	it('moves notes between folders and follows the open one', async () => {
		const { workspace, vault } = await open({ 'Lab/Titration.oi': 'pH\n', 'Index.oi': '[[Lab/Titration]]\n' });
		await vault.createFolder('', 'Archive');
		await workspace.openNote('Lab/Titration.oi');
		await workspace.move('Lab', 'Archive');
		expect(workspace.note!.path).toBe('Archive/Lab/Titration.oi');
		expect(vault.has('Archive/Lab/Titration.oi')).toBe(true);
		expect(await vault.read('Index.oi')).toBe('[[Archive/Lab/Titration]]\n');
	});
});
