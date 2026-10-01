// Hotkeys: `Mod+Shift+M`, chords `Mod+K Mod+C`, a `When` context, `Mod` = Cmd on Apple, Ctrl elsewhere.

import type { CommandRegistry } from './command';

export interface HotkeyBinding {
	key: string;
	command: string;
	argument?: unknown;
	when?: string;
}

const modifierOrder = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const keyAliasMap: Readonly<Record<string, string>> = {
	Esc: 'Escape',
	Return: 'Enter',
	Up: 'ArrowUp',
	Down: 'ArrowDown',
	Left: 'ArrowLeft',
	Right: 'ArrowRight',
	Space: ' ',
	Plus: '+',
};

export function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

/** Normalizes one chord such as `shift+mod+m` → `Mod+Shift+M`; returns undefined when invalid. */
export function normalizeChord(text: string): string | undefined {
	const partList = text.split('+');
	// a trailing "+" key: "Mod++" → ["Mod", "", ""]
	if (text.endsWith('++')) partList.splice(partList.length - 2, 2, '+');
	const key = partList.pop();
	if (!key) return undefined;
	const modifierSet = new Set<string>();
	for (const part of partList) {
		const name = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		const modifier = name === 'Cmd' || name === 'Command' ? 'Meta' : name === 'Control' ? 'Ctrl' : name === 'Option' ? 'Alt' : name;
		if (!(modifierOrder as readonly string[]).includes(modifier)) return undefined;
		modifierSet.add(modifier);
	}
	const alias = keyAliasMap[key] ?? key;
	const normalizedKey = alias.length === 1 ? alias.toUpperCase() : alias.charAt(0).toUpperCase() + alias.slice(1);
	return [...modifierOrder.filter((modifier) => modifierSet.has(modifier)), normalizedKey].join('+');
}

/** `Mod+K Mod+C` → [`Mod+K`, `Mod+C`]. */
export function parseHotkey(text: string): string[] | undefined {
	const chordList = text.trim().split(/\s+/).map(normalizeChord);
	return chordList.every((chord): chord is string => chord !== undefined) && chordList.length > 0 ? chordList : undefined;
}

/** The chord a keyboard event represents, with the platform's primary modifier written as `Mod`. */
export function eventChord(event: KeyboardEvent, apple = isApplePlatform()): string | undefined {
	if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return undefined;
	let key = event.key;
	if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
	else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
	else if (key.length === 1) key = key.toUpperCase();
	const modifierSet = new Set<string>();
	if (apple ? event.metaKey : event.ctrlKey) modifierSet.add('Mod');
	if (apple && event.ctrlKey) modifierSet.add('Ctrl');
	if (!apple && event.metaKey) modifierSet.add('Meta');
	if (event.altKey) modifierSet.add('Alt');
	if (event.shiftKey) modifierSet.add('Shift');
	return [...modifierOrder.filter((modifier) => modifierSet.has(modifier)), key].join('+');
}

export interface HotkeyOption {
	apple?: boolean;
	/** Whether a `When` context (e.g. `Editor.Focus`) is active right now. */
	isActive?(when: string): boolean;
	chordTimeoutMs?: number;
}

export class HotkeyManager {
	private bindingList: { chordList: string[]; binding: HotkeyBinding }[] = [];
	private pendingList: string[] = [];
	private pendingTime = 0;

	constructor(
		readonly commandRegistry: CommandRegistry,
		readonly option: HotkeyOption = {},
	) {}

	setBindingList(bindingList: readonly HotkeyBinding[]): string[] {
		const problemList: string[] = [];
		this.bindingList = [];
		for (const binding of bindingList) {
			const chordList = parseHotkey(binding.key);
			if (!chordList) problemList.push(`"${binding.key}" is not a valid hotkey`);
			else this.bindingList.push({ chordList, binding });
		}
		return problemList;
	}

	/** Keys bound to more than one command in the same context. */
	conflictList(): { key: string; commandList: string[] }[] {
		const groupMap = new Map<string, string[]>();
		for (const { chordList, binding } of this.bindingList) {
			const groupKey = `${chordList.join(' ')}|${binding.when ?? ''}`;
			groupMap.set(groupKey, [...(groupMap.get(groupKey) ?? []), binding.command]);
		}
		return [...groupMap]
			.filter(([, commandList]) => commandList.length > 1)
			.map(([groupKey, commandList]) => ({ key: groupKey.split('|')[0]!, commandList }));
	}

	/** Handles a keydown; returns true (and prevents the default) when a command ran or a chord is pending. */
	handle(event: KeyboardEvent): boolean {
		const chord = eventChord(event, this.option.apple ?? isApplePlatform());
		if (!chord) return false;
		const now = Date.now();
		if (now - this.pendingTime > (this.option.chordTimeoutMs ?? 1500)) this.pendingList = [];
		const sequence = [...this.pendingList, chord];
		const active = (binding: HotkeyBinding): boolean => !binding.when || (this.option.isActive?.(binding.when) ?? false);
		const candidateList = this.bindingList.filter(
			({ chordList, binding }) => active(binding) && sequence.every((item, index) => chordList[index] === item),
		);
		const exact = candidateList.find(({ chordList }) => chordList.length === sequence.length);
		if (exact && this.commandRegistry.get(exact.binding.command)) {
			this.pendingList = [];
			event.preventDefault();
			this.commandRegistry.run(exact.binding.command, exact.binding.argument);
			return true;
		}
		if (candidateList.some(({ chordList }) => chordList.length > sequence.length)) {
			this.pendingList = sequence;
			this.pendingTime = now;
			event.preventDefault();
			return true;
		}
		this.pendingList = [];
		return false;
	}
}
