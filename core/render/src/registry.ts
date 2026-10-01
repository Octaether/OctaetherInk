// Holds every module and plugin, switches them on and off, and scopes what each one
// registers (commands, themes, extensions) so switching off cleans up completely.

import {
	type BlockAlias,
	type ContentKind,
	type FormatOption,
	type PropertyValue,
	defaultArgumentMap,
	defaultIndentedTypeSet,
	defaultItemTypeSet,
	defaultKnownTypeSet,
} from '@octaether/core-format';
import type {
	BlockTemplate,
	BlockTypeDefinition,
	CommandDefinition,
	Definition,
	HostContext,
	InlineRenderer,
	ModuleToken,
	SettingDefinition,
	StatusItemDefinition,
	ThemeContext,
	ThemeDefinition,
} from '@octaether/core-sdk';

/** Characters an alias can't start with: they start Markdown or OI (headings, lists, quotes, tables, properties, escapes). */
const reservedAliasStart = '#-*+>|[]!{}\\^=_<(';

/** Why a marker can't be an alias, or undefined when it can. */
export function aliasMarkerProblem(marker: string): string | undefined {
	if (/[\p{L}\p{N}]/u.test(marker)) return `"${marker}" holds a letter or a digit, so ordinary text would open it`;
	if (reservedAliasStart.includes(marker[0]!)) return `"${marker}" starts like Markdown (${marker[0]})`;
	return undefined;
}

/** The two settings every block type with aliases gets: a switch and the symbols. */
function aliasSettingList(blockType: BlockTypeDefinition): SettingDefinition[] {
	const aliasList = blockType.aliasList ?? [];
	if (aliasList.length === 0) return [];
	const markerText = aliasList.map((alias) => alias.marker).join(' ');
	const first = aliasList[0]!;
	const how =
		first.opening === 'Argument'
			? `can also open with ${aliasList.map((alias) => alias.marker).join(' or ')} instead of “${blockType.name}:”, and close with the same symbols on a line of their own, as in Markdown`
			: `can also be written between ${first.marker} and ${first.marker} instead of after “${blockType.name}:”, as in Obsidian`;
	return [
		{
			id: `${blockType.name}.Alias`,
			title: 'Alias',
			type: 'Toggle',
			default: true,
			explain: `A ${blockType.name} block ${how}. Off: such lines are plain text.`,
		},
		{
			id: `${blockType.name}.AliasMarker`,
			title: 'Alias symbols',
			type: 'Text',
			default: markerText,
			explain: 'The symbols, separated by spaces. They can’t hold letters or digits or start like Markdown, and symbols another module uses are left to the module listed first.',
		},
	];
}

/** Services the app provides; the registry hands each module/plugin a scoped view of them. */
export interface HostService {
	registerCommand(command: CommandDefinition): () => void;
	registerTheme(theme: ThemeDefinition): () => void;
	setting(id: string): PropertyValue | undefined;
	theme(): ThemeContext;
	applyTheme(name: string): void;
	themeList(): readonly ThemeDefinition[];
}

export interface RegistryProblem {
	name: string;
	message: string;
}

export interface TemplateEntry extends BlockTemplate {
	type: string;
}

export class Registry {
	/** Increases whenever the set of active modules, plugins, or extensions changes. */
	revision = 0;
	readonly problemList: RegistryProblem[] = [];
	private readonly definitionMap = new Map<string, Definition>();
	private readonly enabledSet = new Set<string>();
	private readonly activeSet = new Set<string>();
	private readonly cleanupMap = new Map<string, (() => void)[]>();
	private readonly blockTypeOwner = new Map<string, string>();
	private readonly extensionMap = new Map<string, unknown>();
	private readonly listenerSet = new Set<() => void>();
	private service: HostService | undefined;

	add(definition: Definition, enabled = true): void {
		if (this.definitionMap.has(definition.name)) throw new Error(`"${definition.name}" is already registered`);
		this.definitionMap.set(definition.name, definition);
		if (definition.kind === 'Module') {
			for (const blockType of definition.blockTypeList) {
				const owner = this.blockTypeOwner.get(blockType.name);
				if (owner) this.problemList.push({ name: definition.name, message: `block type "${blockType.name}" is already provided by ${owner}` });
				else this.blockTypeOwner.set(blockType.name, definition.name);
			}
		}
		if (enabled || this.isCore(definition)) this.enabledSet.add(definition.name);
		if (this.service && this.enabledSet.has(definition.name)) this.activate(definition.name);
		this.emit();
	}

	/** Connects the app's services and activates everything that is enabled. */
	attach(service: HostService): void {
		this.service = service;
		for (const name of this.enabledSet) this.activate(name);
		this.emit();
	}

	definitionList(): Definition[] {
		return [...this.definitionMap.values()];
	}

	get(name: string): Definition | undefined {
		return this.definitionMap.get(name);
	}

	isEnabled(name: string): boolean {
		return this.enabledSet.has(name);
	}

	isCore(definition: Definition): boolean {
		return definition.kind === 'Module' && definition.core === true;
	}

	setEnabled(name: string, enabled: boolean): void {
		const definition = this.definitionMap.get(name);
		if (!definition || this.enabledSet.has(name) === enabled) return;
		if (!enabled && this.isCore(definition)) return;
		if (enabled) {
			this.enabledSet.add(name);
			this.activate(name);
		} else {
			this.enabledSet.delete(name);
			this.deactivate(name);
		}
		this.emit();
	}

	/** The definition of a block type whose module is enabled. */
	blockType(type: string): BlockTypeDefinition | undefined {
		const owner = this.blockTypeOwner.get(type);
		if (!owner || !this.enabledSet.has(owner)) return undefined;
		return this.knownBlockType(type);
	}

	/** The definition of a block type whether or not its module is enabled. */
	knownBlockType(type: string): BlockTypeDefinition | undefined {
		const owner = this.blockTypeOwner.get(type);
		const definition = owner ? this.definitionMap.get(owner) : undefined;
		if (!definition || definition.kind !== 'Module') return undefined;
		return definition.blockTypeList.find((blockType) => blockType.name === type);
	}

	ownerOf(type: string): string | undefined {
		return this.blockTypeOwner.get(type);
	}

	/**
	 * Parsing must not depend on module switches, or a file would read differently when a module
	 * is off. Aliases are the exception by design: switching one off makes its lines plain text.
	 */
	formatOption(): FormatOption {
		return {
			isKnownType: (type) => this.blockTypeOwner.has(type) || defaultKnownTypeSet.has(type),
			contentKind: (type): ContentKind => this.knownBlockType(type)?.content ?? (defaultItemTypeSet.has(type) ? 'Item' : 'Raw'),
			inlineBody: (type) => this.knownBlockType(type)?.inlineBody ?? !defaultIndentedTypeSet.has(type),
			argumentKey: (type) => {
				const known = this.knownBlockType(type);
				return known ? known.argument : defaultArgumentMap.get(type);
			},
			aliasList: () => this.aliasState().aliasList,
		};
	}

	/**
	 * The aliases in use, in the order the modules were added, and why any are left out: switched
	 * off, symbols that would break text, or symbols a module listed earlier uses (the same, or one
	 * starting the other, as `$` would `$$`).
	 */
	aliasState(): { aliasList: BlockAlias[]; problemList: RegistryProblem[] } {
		const aliasList: BlockAlias[] = [];
		const problemList: RegistryProblem[] = [];
		for (const [type, owner] of this.blockTypeOwner) {
			const blockType = this.knownBlockType(type);
			const definitionList = blockType?.aliasList ?? [];
			if (!blockType || definitionList.length === 0 || blockType.content !== 'Raw') continue;
			if (this.setting(`${type}.Alias`) === false) continue;
			const markerText = this.setting(`${type}.AliasMarker`);
			const markerList = (typeof markerText === 'string' ? markerText : definitionList.map((alias) => alias.marker).join(' ')).split(/\s+/).filter(Boolean);
			for (const marker of markerList) {
				// a symbol of its own keeps its kind; a new one takes the kind of the module's first
				const shape = definitionList.find((alias) => alias.marker === marker) ?? definitionList[0]!;
				const problem = aliasMarkerProblem(marker);
				if (problem) {
					problemList.push({ name: owner, message: `${type} alias ${problem}.` });
					continue;
				}
				const clash = aliasList.find((alias) => alias.marker.startsWith(marker) || marker.startsWith(alias.marker));
				if (clash) {
					// the same type listing ```` next to ``` is fine: ``` already opens it
					if (clash.type !== type) {
						const clashOwner = this.blockTypeOwner.get(clash.type) ?? clash.type;
						const how = clash.marker === marker ? 'is' : 'overlaps';
						problemList.push({ name: owner, message: `${type} alias "${marker}" ${how} ${clashOwner}’s "${clash.marker}", so ${clashOwner} keeps it.` });
					}
					continue;
				}
				aliasList.push({ marker, type, opening: shape.opening, ...(shape.repeat ? { repeat: true } : {}) });
			}
		}
		return { aliasList, problemList };
	}

	inlineRenderer(type: string): InlineRenderer | undefined {
		return this.blockType(type)?.inline;
	}

	/** A setting's value from the app (module and plugin settings included). */
	setting(id: string): PropertyValue | undefined {
		return this.service?.setting(id);
	}

	/** Every module's and plugin's own settings (with the alias settings of its block types), with the owner's name. */
	settingList(): { owner: string; setting: SettingDefinition }[] {
		return this.definitionList().flatMap((definition) =>
			[...(definition.settingList ?? []), ...(definition.kind === 'Module' ? definition.blockTypeList.flatMap(aliasSettingList) : [])].map((setting) => ({ owner: definition.name, setting })),
		);
	}

	/** Status bar items of the enabled modules and plugins, left to right. */
	statusItemList(): StatusItemDefinition[] {
		return this.definitionList()
			.filter((definition) => this.enabledSet.has(definition.name))
			.flatMap((definition) => definition.statusItemList ?? [])
			.sort((left, right) => (left.order ?? 50) - (right.order ?? 50));
	}

	/** Something every renderer may read changed (a module setting): everything re-renders. */
	touch(): void {
		this.emit();
	}

	templateList(): TemplateEntry[] {
		return this.enabledBlockTypeList().flatMap((blockType) => (blockType.templateList ?? []).map((template) => ({ ...template, type: blockType.name })));
	}

	moduleTokenList(): ModuleToken[] {
		return this.enabledBlockTypeList().flatMap((blockType) => (blockType.token ? [blockType.token] : []));
	}

	styleList(): { name: string; style: string }[] {
		return this.enabledBlockTypeList().flatMap((blockType) => (blockType.style ? [{ name: blockType.name, style: blockType.style }] : []));
	}

	registerExtension(name: string, value: unknown): () => void {
		this.extensionMap.set(name, value);
		this.emit();
		return () => {
			if (this.extensionMap.get(name) === value) {
				this.extensionMap.delete(name);
				this.emit();
			}
		};
	}

	extension<T>(name: string): T | undefined {
		return this.extensionMap.get(name) as T | undefined;
	}

	subscribe(listener: () => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	private enabledBlockTypeList(): BlockTypeDefinition[] {
		const list: BlockTypeDefinition[] = [];
		for (const [type, owner] of this.blockTypeOwner) {
			if (!this.enabledSet.has(owner)) continue;
			const blockType = this.knownBlockType(type);
			if (blockType) list.push(blockType);
		}
		return list;
	}

	private scopedContext(name: string): HostContext {
		const service = this.service!;
		const cleanupList = this.cleanupMap.get(name) ?? [];
		this.cleanupMap.set(name, cleanupList);
		const track = (dispose: () => void): (() => void) => {
			cleanupList.push(dispose);
			return dispose;
		};
		return {
			registerCommand: (command) => track(service.registerCommand(command)),
			registerTheme: (theme) => track(service.registerTheme(theme)),
			registerExtension: (key, value) => track(this.registerExtension(key, value)),
			extension: (key) => this.extension(key),
			setting: (id) => service.setting(id),
			theme: () => service.theme(),
			applyTheme: (themeName) => service.applyTheme(themeName),
			themeList: () => service.themeList(),
		};
	}

	private activate(name: string): void {
		const definition = this.definitionMap.get(name);
		if (!definition || !this.service || this.activeSet.has(name)) return;
		this.activeSet.add(name);
		try {
			const cleanup = definition.activate?.(this.scopedContext(name));
			if (typeof cleanup === 'function') this.cleanupMap.get(name)?.push(cleanup);
		} catch (error) {
			this.problemList.push({ name, message: error instanceof Error ? error.message : String(error) });
		}
	}

	private deactivate(name: string): void {
		if (!this.activeSet.delete(name)) return;
		const cleanupList = this.cleanupMap.get(name) ?? [];
		this.cleanupMap.delete(name);
		for (const cleanup of cleanupList.reverse()) {
			try {
				cleanup();
			} catch (error) {
				this.problemList.push({ name, message: error instanceof Error ? error.message : String(error) });
			}
		}
	}

	private emit(): void {
		this.revision++;
		for (const listener of this.listenerSet) listener();
	}
}
