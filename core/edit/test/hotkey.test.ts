import { describe, expect, it } from 'vitest';
import { CommandRegistry, HotkeyManager, normalizeChord, parseHotkey } from '../src';

function keyEvent(key: string, code: string, modifier: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}): KeyboardEvent {
	let prevented = false;
	return {
		key,
		code,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...modifier,
		preventDefault() {
			prevented = true;
		},
		get defaultPrevented() {
			return prevented;
		},
	} as unknown as KeyboardEvent;
}

describe('hotkey', () => {
	it('normalizes chords to one canonical spelling', () => {
		expect(normalizeChord('shift+mod+m')).toBe('Mod+Shift+M');
		expect(normalizeChord('Mod++')).toBe('Mod++');
		expect(normalizeChord('Hyper+X')).toBeUndefined();
		expect(parseHotkey('Mod+K  Mod+C')).toEqual(['Mod+K', 'Mod+C']);
	});

	it('runs commands for single keys and chords, honouring When', () => {
		const registry = new CommandRegistry();
		const ranList: string[] = [];
		for (const id of ['Block.Insert', 'Style.Color.Pick', 'Edit.Undo']) registry.register({ id, title: id, run: () => ranList.push(id) });
		let typing = false;
		const manager = new HotkeyManager(registry, { apple: false, isActive: (when) => (when === 'NotTyping' ? !typing : false) });
		expect(
			manager.setBindingList([
				{ key: 'Mod+Shift+M', command: 'Block.Insert' },
				{ key: 'Mod+K Mod+C', command: 'Style.Color.Pick' },
				{ key: 'Mod+Z', command: 'Edit.Undo', when: 'NotTyping' },
			]),
		).toEqual([]);
		expect(manager.handle(keyEvent('M', 'KeyM', { ctrlKey: true, shiftKey: true }))).toBe(true);
		expect(manager.handle(keyEvent('k', 'KeyK', { ctrlKey: true }))).toBe(true);
		expect(manager.handle(keyEvent('c', 'KeyC', { ctrlKey: true }))).toBe(true);
		typing = true;
		expect(manager.handle(keyEvent('z', 'KeyZ', { ctrlKey: true }))).toBe(false);
		typing = false;
		expect(manager.handle(keyEvent('z', 'KeyZ', { ctrlKey: true }))).toBe(true);
		expect(ranList).toEqual(['Block.Insert', 'Style.Color.Pick', 'Edit.Undo']);
	});

	it('reports keys bound twice in the same context', () => {
		const manager = new HotkeyManager(new CommandRegistry());
		manager.setBindingList([
			{ key: 'Mod+S', command: 'Note.Save' },
			{ key: 'mod+s', command: 'Note.Export' },
		]);
		expect(manager.conflictList()).toEqual([{ key: 'Mod+S', commandList: ['Note.Save', 'Note.Export'] }]);
	});

	it('requires PascalCase dotted command IDs', () => {
		expect(() => new CommandRegistry().register({ id: 'save', title: 'x', run() {} })).toThrow(/PascalCase/);
	});
});
