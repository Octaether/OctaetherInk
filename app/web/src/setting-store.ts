// Settings and hotkeys. Values live in this browser's profile and, while a vault is open, also in
// the vault's own meta files (`.oi/Setting.oi`, `.oi/Hotkey.oi`), so they travel with the vault
// to other devices. Precedence: default → profile → vault. Only values that differ from the
// default are written.

import { type PropertyDocument, type PropertyMap, type PropertyValue, createSection, formatName, parseDocument, sectionToMap, serializeDocument, setSectionValue } from '@octaether/core-format';
import type { HotkeyBinding } from '@octaether/core-edit';
import type { SettingDefinition } from '@octaether/core-sdk';
import type { Vault } from '@octaether/core-vault';
import { readJson, storageKey, writeJson } from './storage';

export const settingFile = '.oi/Setting.oi';
export const hotkeyFile = '.oi/Hotkey.oi';

export interface MacroStep {
	command: string;
	/** Text argument (a setting's ID for Setting.Toggle, a theme for Theme.Switch, …). */
	argument?: string;
}

/** Your own command: a list of steps, with its own hotkeys like any command. */
export interface Macro {
	/** `Macro.Something`. */
	id: string;
	title: string;
	stepList: MacroStep[];
}

interface HotkeyData {
	/** Command → its keys; an empty list means "no key". Commands not listed keep their defaults. */
	binding: Record<string, string[]>;
	macro: Macro[];
}

/** A value as comparable text (maps included, which JSON would flatten to `{}`). */
function plainValue(value: PropertyValue | undefined): string {
	return JSON.stringify(value, (_, item: unknown) => (item instanceof Map ? Object.fromEntries(item) : item));
}

function valueEqual(left: PropertyValue | undefined, right: PropertyValue | undefined): boolean {
	return plainValue(left) === plainValue(right);
}

export class SettingStore {
	private readonly definitionMap = new Map<string, SettingDefinition>();
	private readonly profile: Map<string, PropertyValue>;
	private vaultValue = new Map<string, PropertyValue>();
	private vaultDocument: PropertyDocument | undefined;
	private vault: Vault | undefined;
	private readonly listenerSet = new Set<(id: string) => void>();
	private writeTimer: ReturnType<typeof setTimeout> | undefined;
	private hotkey: HotkeyData;
	private hotkeyFromVault = false;
	private readonly hotkeyListenerSet = new Set<() => void>();
	defaultBindingList: HotkeyBinding[] = [];

	constructor() {
		this.profile = new Map(Object.entries(readJson<Record<string, PropertyValue>>(storageKey.Setting, {})));
		this.hotkey = readJson<HotkeyData>(storageKey.Hotkey, { binding: {}, macro: [] });
	}

	define(list: readonly SettingDefinition[]): void {
		for (const definition of list) this.definitionMap.set(definition.id, definition);
	}

	definition(id: string): SettingDefinition | undefined {
		return this.definitionMap.get(id);
	}

	get(id: string): PropertyValue | undefined {
		if (this.vaultValue.has(id)) return this.vaultValue.get(id);
		if (this.profile.has(id)) return this.profile.get(id);
		return this.definitionMap.get(id)?.default;
	}

	/** Sets a value (in the profile, and in the open vault's `.oi/Setting.oi`). */
	set(id: string, value: PropertyValue | undefined): void {
		if (valueEqual(this.get(id), value)) return;
		const fallback = this.definitionMap.get(id)?.default;
		if (value === undefined || valueEqual(value, fallback)) this.profile.delete(id);
		else this.profile.set(id, value);
		writeJson(storageKey.Setting, Object.fromEntries(this.profile));
		if (this.vault) {
			if (value === undefined || valueEqual(value, fallback)) this.vaultValue.delete(id);
			else this.vaultValue.set(id, value);
			this.scheduleVaultWrite();
		}
		for (const listener of this.listenerSet) listener(id);
	}

	subscribe(listener: (id: string) => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	/** Reads the vault's settings and hotkeys (or forgets them when `vault` is undefined). */
	async attachVault(vault: Vault | undefined): Promise<void> {
		this.vault = vault;
		this.vaultValue = new Map();
		this.vaultDocument = undefined;
		this.hotkeyFromVault = false;
		this.hotkey = readJson<HotkeyData>(storageKey.Hotkey, { binding: {}, macro: [] });
		if (vault) {
			try {
				const document = parseDocument(await vault.fs.read(settingFile));
				if (document.kind === 'Property') {
					this.vaultDocument = document;
					// keys may be written flat (Editor.ClickToEdit: DoubleClick) or nested (Editor: / ClickToEdit: …)
					const read = (prefix: string, value: PropertyValue): void => {
						if (value instanceof Map) for (const [key, item] of value) read(`${prefix}.${key}`, item);
						else this.vaultValue.set(prefix, value);
					};
					for (const [key, value] of sectionToMap(document.section)) if (key !== 'Kind' && key !== 'Format') read(key, value);
				}
			} catch {
				// no settings file yet: the profile's values apply
			}
			try {
				const document = parseDocument(await vault.fs.read(hotkeyFile));
				if (document.kind === 'Property') {
					this.hotkey = readHotkeyDocument(sectionToMap(document.section));
					this.hotkeyFromVault = true;
				}
			} catch {
				// no hotkey file yet
			}
		}
		for (const listener of this.listenerSet) listener('*');
		for (const listener of this.hotkeyListenerSet) listener();
	}

	// ------------------------------------------------------------ hotkeys

	subscribeHotkey(listener: () => void): () => void {
		this.hotkeyListenerSet.add(listener);
		return () => this.hotkeyListenerSet.delete(listener);
	}

	/** The keys that run a command now (yours, or the default). */
	keyListOf(command: string): string[] {
		const own = this.hotkey.binding[command];
		if (own) return own;
		return this.defaultBindingList.filter((binding) => binding.command === command).map((binding) => binding.key);
	}

	isCustomized(command: string): boolean {
		return this.hotkey.binding[command] !== undefined;
	}

	setKeyList(command: string, keyList: string[] | undefined): void {
		if (keyList === undefined) delete this.hotkey.binding[command];
		else this.hotkey.binding[command] = [...new Set(keyList)];
		this.saveHotkey();
	}

	resetAllKey(): void {
		this.hotkey.binding = {};
		this.saveHotkey();
	}

	/** Every binding in effect: defaults, replaced command by command by yours, plus your macros' keys. */
	bindingList(): HotkeyBinding[] {
		const list: HotkeyBinding[] = [];
		const seen = new Set<string>();
		for (const binding of this.defaultBindingList) {
			if (this.hotkey.binding[binding.command]) continue;
			list.push(binding);
			seen.add(binding.command);
		}
		for (const [command, keyList] of Object.entries(this.hotkey.binding)) {
			const when = this.defaultBindingList.find((binding) => binding.command === command)?.when;
			for (const key of keyList) list.push({ key, command, ...(when ? { when } : {}) });
		}
		return list;
	}

	macroList(): Macro[] {
		return this.hotkey.macro;
	}

	saveMacro(macro: Macro): void {
		const index = this.hotkey.macro.findIndex((item) => item.id === macro.id);
		if (index >= 0) this.hotkey.macro[index] = macro;
		else this.hotkey.macro.push(macro);
		this.saveHotkey();
	}

	removeMacro(id: string): void {
		this.hotkey.macro = this.hotkey.macro.filter((item) => item.id !== id);
		delete this.hotkey.binding[id];
		this.saveHotkey();
	}

	private saveHotkey(): void {
		writeJson(storageKey.Hotkey, this.hotkey);
		if (this.vault) {
			this.hotkeyFromVault = true;
			void this.vault.fs.write(hotkeyFile, writeHotkeyDocument(this.hotkey)).catch(() => undefined);
		}
		for (const listener of this.hotkeyListenerSet) listener();
	}

	private scheduleVaultWrite(): void {
		clearTimeout(this.writeTimer);
		this.writeTimer = setTimeout(() => void this.writeVaultSetting(), 400);
	}

	private async writeVaultSetting(): Promise<void> {
		const vault = this.vault;
		if (!vault) return;
		// edit the existing file in place, so comments and order survive
		const document: PropertyDocument = this.vaultDocument ?? {
			kind: 'Property',
			section: createSection(new Map<string, PropertyValue>([['Kind', 'Setting'], ['Format', formatName]])),
			bom: false,
			newline: '\n',
			finalNewline: true,
			problemList: [],
		};
		const present = sectionToMap(document.section);
		// a group you wrote nested (Editor: / ClickToEdit: …) stays nested; everything else is one flat line
		const groupList = [...present].filter(([, value]) => value instanceof Map).map(([key]) => key);
		const groupOf = (id: string): string | undefined => groupList.find((group) => id.startsWith(`${group}.`));
		const nest = (group: string): Map<string, PropertyValue> | undefined => {
			const root = new Map<string, PropertyValue>();
			for (const [id, value] of this.vaultValue) {
				if (!id.startsWith(`${group}.`)) continue;
				const partList = id.slice(group.length + 1).split('.');
				let at = root;
				for (const part of partList.slice(0, -1)) {
					const next = at.get(part);
					if (next instanceof Map) at = next;
					else {
						const created = new Map<string, PropertyValue>();
						at.set(part, created);
						at = created;
					}
				}
				at.set(partList.at(-1)!, value);
			}
			return root.size > 0 ? root : undefined;
		};
		for (const [key, value] of present) {
			if (key === 'Kind' || key === 'Format') continue;
			if (groupList.includes(key)) {
				const next = nest(key);
				if (plainValue(next) !== plainValue(value)) setSectionValue(document.section, key, next);
			} else if (!this.vaultValue.has(key)) setSectionValue(document.section, key, undefined);
		}
		for (const [id, value] of this.vaultValue) if (!groupOf(id)) setSectionValue(document.section, id, value);
		this.vaultDocument = document;
		try {
			await vault.fs.write(settingFile, serializeDocument(document));
		} catch {
			// read-only folder: the profile keeps the value
		}
	}

	/** Whether the hotkeys came from the vault's `.oi/Hotkey.oi`. */
	hotkeyInVault(): boolean {
		return this.hotkeyFromVault;
	}
}

function readHotkeyDocument(map: PropertyMap): HotkeyData {
	const data: HotkeyData = { binding: {}, macro: [] };
	const bindingList = map.get('Binding');
	if (Array.isArray(bindingList)) {
		for (const item of bindingList) {
			if (!(item instanceof Map)) continue;
			const command = item.get('Command');
			const key = item.get('Key');
			if (typeof command !== 'string') continue;
			data.binding[command] ??= [];
			if (typeof key === 'string' && key.trim() !== '') data.binding[command]!.push(key.trim());
		}
	}
	const macroList = map.get('Macro');
	if (Array.isArray(macroList)) {
		for (const item of macroList) {
			if (!(item instanceof Map)) continue;
			const id = item.get('Id');
			const title = item.get('Title');
			const stepList = item.get('Step');
			if (typeof id !== 'string' || !Array.isArray(stepList)) continue;
			data.macro.push({
				id,
				title: typeof title === 'string' ? title : id,
				stepList: stepList.flatMap((step) => {
					if (!(step instanceof Map)) return [];
					const command = step.get('Command');
					const argument = step.get('Argument');
					return typeof command === 'string' ? [{ command, ...(argument !== undefined && argument !== null ? { argument: String(argument) } : {}) }] : [];
				}),
			});
		}
	}
	return data;
}

function writeHotkeyDocument(data: HotkeyData): string {
	const map = new Map<string, PropertyValue>([['Kind', 'Hotkey'], ['Format', formatName]]);
	const bindingList: PropertyValue[] = [];
	for (const [command, keyList] of Object.entries(data.binding)) {
		if (keyList.length === 0) bindingList.push(new Map<string, PropertyValue>([['Command', command], ['Key', null]]));
		for (const key of keyList) bindingList.push(new Map<string, PropertyValue>([['Command', command], ['Key', key]]));
	}
	if (bindingList.length > 0) map.set('Binding', bindingList);
	if (data.macro.length > 0) {
		map.set(
			'Macro',
			data.macro.map(
				(macro) =>
					new Map<string, PropertyValue>([
						['Id', macro.id],
						['Title', macro.title],
						['Step', macro.stepList.map((step) => new Map<string, PropertyValue>([['Command', step.command], ...(step.argument !== undefined ? [['Argument', step.argument] as [string, PropertyValue]] : [])]))],
					]),
			),
		);
	}
	const document: PropertyDocument = { kind: 'Property', section: createSection(map), bom: false, newline: '\n', finalNewline: true, problemList: [] };
	return serializeDocument(document);
}
