// @vitest-environment happy-dom
// Settings and hotkeys: the browser profile, the vault's .oi/Setting.oi and .oi/Hotkey.oi.
import type { SettingDefinition } from '@octaether/core-sdk';
import { MemoryFileSystem, Vault } from '@octaether/core-vault';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingStore } from '../src/setting-store';

const definitionList: SettingDefinition[] = [
	{ id: 'Editor.ClickToEdit', title: 'Click to edit', type: 'Choice', choiceList: ['SingleClick', 'DoubleClick', 'HotkeyOnly'], default: 'SingleClick', explain: '' },
	{ id: 'Code.LineNumber', title: 'Line numbers', type: 'Toggle', default: false, explain: '' },
	{ id: 'Theme.Active', title: 'Theme', type: 'Choice', choiceList: ['System', 'Light', 'Dark'], default: 'System', explain: '' },
];

async function open(fileMap: Record<string, string> = {}) {
	const fs = new MemoryFileSystem('Test', fileMap);
	const vault = new Vault(fs);
	await vault.load();
	const store = new SettingStore();
	store.define(definitionList);
	store.defaultBindingList = [{ key: 'Mod+G', command: 'Graph.Open' }];
	await store.attachVault(vault);
	return { fs, store };
}

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SettingStore', () => {
	it('writes only what differs from the default, as flat lines', async () => {
		const { fs, store } = await open();
		expect(store.get('Editor.ClickToEdit')).toBe('SingleClick');
		store.set('Editor.ClickToEdit', 'DoubleClick');
		store.set('Code.LineNumber', true);
		await vi.advanceTimersByTimeAsync(500);
		expect(await fs.read('.oi/Setting.oi')).toBe('Kind: Setting\nFormat: Oi 1\nEditor.ClickToEdit: DoubleClick\nCode.LineNumber: True\n');
		// back to the default: the line goes away
		store.set('Code.LineNumber', false);
		await vi.advanceTimersByTimeAsync(500);
		expect(await fs.read('.oi/Setting.oi')).toBe('Kind: Setting\nFormat: Oi 1\nEditor.ClickToEdit: DoubleClick\n');
	});

	it('reads nested groups, keeps them nested, and keeps comments', async () => {
		const { fs, store } = await open({ '.oi/Setting.oi': 'Kind: Setting\nFormat: Oi 1\n\n# how blocks open\nEditor:\n\tClickToEdit: DoubleClick\nTheme.Active: Dark\n' });
		expect(store.get('Editor.ClickToEdit')).toBe('DoubleClick');
		expect(store.get('Theme.Active')).toBe('Dark');
		store.set('Editor.ClickToEdit', 'HotkeyOnly');
		await vi.advanceTimersByTimeAsync(500);
		const text = await fs.read('.oi/Setting.oi');
		expect(text).toContain('# how blocks open');
		expect(text).toMatch(/Editor:(\n\tClickToEdit: HotkeyOnly| \{ClickToEdit: HotkeyOnly\})/);
		expect(text).toContain('Theme.Active: Dark');
		expect(text).not.toContain('Editor.ClickToEdit');
		// a fresh start reads the same values back
		const again = await open({ '.oi/Setting.oi': text });
		expect(again.store.get('Editor.ClickToEdit')).toBe('HotkeyOnly');
	});

	it('keeps your keys and macros in .oi/Hotkey.oi and reads them back', async () => {
		const { fs, store } = await open();
		expect(store.keyListOf('Graph.Open')).toEqual(['Mod+G']);
		store.setKeyList('Graph.Open', ['Mod+G', 'Alt+Shift+1 Alt+Shift+2']);
		store.saveMacro({ id: 'Macro.LectureMode', title: 'Lecture mode', stepList: [{ command: 'Setting.Toggle', argument: 'Code.LineNumber' }, { command: 'View.Set', argument: 'Read' }] });
		await vi.advanceTimersByTimeAsync(500);
		const text = await fs.read('.oi/Hotkey.oi');
		expect(text).toBe(
			'Kind: Hotkey\nFormat: Oi 1\nBinding:\n\t- {Command: Graph.Open, Key: Mod+G}\n\t- {Command: Graph.Open, Key: Alt+Shift+1 Alt+Shift+2}\nMacro:\n\t- {Id: Macro.LectureMode, Title: Lecture mode, Step: [{Command: Setting.Toggle, Argument: Code.LineNumber}, {Command: View.Set, Argument: Read}]}\n',
		);
		localStorage.clear();
		const again = await open({ '.oi/Hotkey.oi': text });
		expect(again.store.keyListOf('Graph.Open')).toEqual(['Mod+G', 'Alt+Shift+1 Alt+Shift+2']);
		expect(again.store.isCustomized('Graph.Open')).toBe(true);
		expect(again.store.macroList()[0]!.stepList).toHaveLength(2);
		expect(again.store.bindingList()).toContainEqual(expect.objectContaining({ key: 'Alt+Shift+1 Alt+Shift+2', command: 'Graph.Open' }));
		// a key removed on purpose stays removed
		again.store.setKeyList('Graph.Open', []);
		expect(again.store.keyListOf('Graph.Open')).toEqual([]);
	});
});
