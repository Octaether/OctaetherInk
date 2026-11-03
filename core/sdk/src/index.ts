// Public types for module and plugin authors.
//   Module = adds a block type (storage + render + edit + theme protocol).
//   Plugin = adds a system function; can extend modules through extensions.

import type { BlockNode, ContentKind, PropertyMap, PropertyValue } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';

// ---------------------------------------------------------------- theme protocol

export type ThemeMode = 'Light' | 'Dark';

export interface ThemeDefinition {
	/** PascalCase, e.g. `Light`, `Dark`, `Midnight`. */
	name: string;
	mode: ThemeMode;
	/** Token path → CSS value, e.g. `Color.Text` → `#1f2328`. */
	token: Readonly<Record<string, string>>;
}

export interface ThemeContext {
	name: string;
	mode: ThemeMode;
	token: Readonly<Record<string, string>>;
}

/** A module token with a default for each mode (every module must support Light and Dark). */
export type ModuleToken = Readonly<Record<string, { Light: string; Dark: string }>>;

// ---------------------------------------------------------------- render

export interface ResolvedBlock {
	/** Runtime key (never written). */
	key: string;
	/** Persistent ID, only when something links to the block. */
	id: string | undefined;
	type: string;
	version: number;
	body: string;
	property: PropertyMap;
	node: BlockNode;
}

/**
 * What an inline renderer gets. An inline block is a block like any other: the same type, the
 * same module, the same properties and settings, drawn inside a line of text. Every rendered
 * piece should carry `data-oi-s` (source start).
 */
export interface InlineContext {
	theme: ThemeContext;
	/** Theme token (`Accent`, `Color.Accent`) or raw color → safe CSS color, or undefined. */
	resolveColor(value: string): string | undefined;
	/** Renders `{Type {Props}: content}` of any block type inline; undefined when the type has no inline form. */
	renderInline(type: string, content: string, property: PropertyMap, offset: number): string | undefined;
	/** A setting's value (or its default), e.g. a module's own `Code.LineNumber`. Changing a setting re-renders. */
	setting(id: string): PropertyValue | undefined;
}

export interface RenderContext extends InlineContext {
	note: NoteModel;
	/** Shared extension points registered by modules and plugins. */
	extension<T>(name: string): T | undefined;
	/** Changes a property of this block as one undo step. */
	setProperty(name: string, value: PropertyValue | undefined): void;
	/** Replaces this block's body as one undo step (e.g. ticking a checkbox, a drawing tool). */
	setBody(body: string): void;
	/** Replaces this block, children included, with the blocks written in `source` (OI text), as one undo step. */
	replaceWith(source: string): void;
	/** True when a module's feature is on and every module it needs is on (`Chem.Board`). */
	feature(id: string): boolean;
	/** True in the Read view: hide editing affordances (buttons, handles). */
	readOnly(): boolean;
}

/** A point on screen (CSS px from the viewport's top left, as getBoundingClientRect gives). */
export interface Point {
	x: number;
	y: number;
}

export interface RenderHandle {
	/** Update in place; return `Remount` to be re-mounted from scratch. */
	update?(next: ResolvedBlock, context: RenderContext): 'Done' | 'Remount';
	/**
	 * A named point inside the block, for arrows and placement in a Board (`Anchor`): Chem answers for
	 * atoms (`c`), lone pairs (`o.lp`), and bonds (`cb`). With `toward`, the point moves to the edge
	 * of what it names on that side, so an arrow stops short of a label. Undefined for unknown names.
	 */
	anchor?(name: string, toward?: Point): Point | undefined;
	/** Repaint for a new theme (only needed when colors are not CSS variables). */
	theme?(context: ThemeContext): void;
	destroy?(): void;
}

export interface Renderer {
	/**
	 * Draws the block into `frame`. Mark every rendered piece with `data-oi-s="<source start>"`
	 * (plus `data-oi-e` when it doesn't map 1:1 to the source) so a click lands on that exact spot.
	 */
	mount(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): RenderHandle | void;
}

export interface InlineRenderer {
	/** HTML for `{Type {Props}: content}` inside text; `offset` is where `content` starts in the host source. */
	render(content: string, property: PropertyMap, context: InlineContext, offset: number): string;
}

// ---------------------------------------------------------------- layout protocol (containers)

export interface ChildFrame {
	key: string;
	element: HTMLElement;
	property: PropertyMap;
	type: string;
	/** The block's `^id`, when it has one. */
	id: string | undefined;
	/** The block's own named points (RenderHandle.anchor), in screen px. */
	anchor(name: string, toward?: Point): Point | undefined;
}

export interface LayoutContext {
	theme: ThemeContext;
	/** Number → px; validated CSS length text → as-is; otherwise undefined. */
	resolveLength(value: PropertyValue | undefined): string | undefined;
	/** Theme token (`Accent`) or raw color → safe CSS color, or undefined. */
	resolveColor(value: string): string | undefined;
	/** A setting's value (or its default), e.g. `Layout.StackWidth`. */
	setting(id: string): PropertyValue | undefined;
}

export interface LayoutProtocol {
	coordinate: 'Flow' | 'Fixed';
	/** Placement properties this container reads from its children. */
	childPropertyList: readonly string[];
	/** Places the child frames inside `area` (the block's child area). */
	arrange(area: HTMLElement, container: ResolvedBlock, childList: readonly ChildFrame[], context: LayoutContext): void;
}

// ---------------------------------------------------------------- edit

/**
 * How a block is edited in place. Whatever the kind, the editor shows the block's own source,
 * header included (`Math: x^2`), so its type and properties can be changed there too; only a
 * paragraph shows just its Markdown.
 */
export type EditorKind = 'InlineText' | 'SourcePreview' | 'Structured' | 'Surface';

export interface Editor {
	kind: EditorKind;
}

// ---------------------------------------------------------------- definition

/** An entry in the "+" and "/" block menus: OI source that becomes the new block(s). */
export interface BlockTemplate {
	title: string;
	/** OI source, e.g. `Math:` or `# ` or a Grid with two columns. */
	source: string;
	/** Short glyph shown in the menu. */
	icon?: string;
	keywordList?: readonly string[];
	explain?: string;
	/** Offered only while this feature is on (`Chem.Board`). */
	feature?: string;
}

/**
 * Symbols that open the block instead of `Type:` (``` for Code, $$ for Math). The module's
 * settings page gets a switch and a text field for them, and symbols two modules share are
 * reported there (the module listed first keeps them).
 */
export interface AliasDefinition {
	marker: string;
	/** Argument: the rest of the opening line is what `Type:` would hold (```Python); Body: it starts the body ($$x^2$$). */
	opening: 'Argument' | 'Body';
	/** A longer run of the marker's character opens it too (```` holds ```), as in Markdown. */
	repeat?: boolean;
}

export interface BlockTypeDefinition {
	/** PascalCase block type, e.g. `Math`. */
	name: string;
	/** Raw: the body is the block's own syntax. Item: the block holds child blocks. */
	content: ContentKind;
	/** False: a one-line body is still written on its own indented line (a Property block). Default true. */
	inlineBody?: boolean;
	/**
	 * Envelope properties (Align, Width, Margin, … §5.5) this type starts with, under the block's own,
	 * so a module can centre its blocks by default and let a setting change that. The host applies them
	 * like any block property, so every layout property works the same for every type.
	 */
	defaultProperty?(setting: (id: string) => PropertyValue | undefined): ReadonlyMap<string, PropertyValue>;
	/**
	 * The property the value after the colon sets: `Code: Python` is `Code {Language: Python}:`
	 * (Raw types). Other properties stay in `{…}`, as for every block; the body goes on indented lines.
	 */
	argument?: string;
	aliasList?: readonly AliasDefinition[];
	render: Renderer;
	edit?: Editor;
	layout?: LayoutProtocol;
	/** How the type renders inline inside text: `{Math: x^2}`, `{Chem: H_2O}`. */
	inline?: InlineRenderer;
	token?: ModuleToken;
	/** CSS for this block type; use `var(--oi-…)` tokens so it follows every theme. Installed while enabled. */
	style?: string;
	/** Extra classes on the block's frame (e.g. to space list items tightly). */
	frameClassList?(block: ResolvedBlock): string[];
	templateList?: readonly BlockTemplate[];
	plainText?(block: ResolvedBlock): string;
}

/**
 * A part of a module that can be switched on and off by itself, with its own settings, and that may
 * need other modules: Chem's drawing on Boards (`Chem.Board`) needs the Board module, while Chem's
 * formulas and structures don't. Its switch is a setting with its id.
 */
export interface FeatureDefinition {
	/** Full name, e.g. `Code.Run`. */
	id: string;
	title: string;
	explain: string;
	default: boolean;
	cost?: 'Low' | 'Medium' | 'High';
	/** Modules it needs besides its own (by name); it is off while any of them is off. */
	use?: readonly string[];
	/** Its own settings, shown under it on the module's page. */
	settingList?: readonly SettingDefinition[];
}

export type SettingDemo = { kind: 'Live'; note: string; compareList?: readonly PropertyValue[] } | { kind: 'Clip'; source: string };

export interface SettingDefinition {
	/** Full name, e.g. `Editor.ClickToEdit`. */
	id: string;
	title: string;
	/** Color: a `#rrggbb` value you pick or type ('' = the default). */
	type: 'Choice' | 'Toggle' | 'Text' | 'Number' | 'Color';
	choiceList?: readonly string[];
	default: PropertyValue;
	scopeList?: readonly ('Profile' | 'Vault' | 'Device')[];
	explain: string;
	demo?: SettingDemo;
}

/** What a status bar item can read. */
export interface StatusContext {
	note: NoteModel;
	/** The selected text (in the block editor, the page, or the source view); '' when nothing is selected. */
	selection: string;
}

/** An item in the status bar (bottom right); each one can be switched off in the settings. */
export interface StatusItemDefinition {
	/** `Module.Item`, e.g. `Text.WordCount`. */
	id: string;
	title: string;
	/** Lower comes first (further left). */
	order?: number;
	/** The text to show, or undefined to hide the item for now. */
	text(context: StatusContext): string | undefined;
}

export interface CommandDefinition {
	/** `Object.Action`, e.g. `Theme.Switch`. */
	id: string;
	title: string;
	explain?: string;
	run(argument?: unknown): void;
	/** Default keys (`V`, `Shift+W`, `Mod+K Mod+C`); you change them in Setting → Hotkey. */
	key?: readonly string[];
	/**
	 * Where the keys work: a context the module handles itself, such as `Drawing` (the drawing tool).
	 * Such commands are listed in Setting → Hotkey but not in the command palette, and the app never runs
	 * them from a key itself; the module asks for them (`HotkeyLookup`).
	 */
	when?: string;
}

/** The name of the extension the app registers for keys of your own: `context.extension<HotkeyLookup>(hotkeyExtension)`. */
export const hotkeyExtension = 'Hotkey';

export interface HotkeyLookup {
	/** The command whose key (yours, or its default) this keydown is, among those of a context (`Drawing`). */
	commandFor(event: KeyboardEvent, when: string): string | undefined;
	/** The keys of a command as shown (`⇧W`, `Ctrl+K`), for titles. */
	keyText(command: string): string;
}

export interface HostContext {
	registerCommand(command: CommandDefinition): () => void;
	registerTheme(theme: ThemeDefinition): () => void;
	/** An extension; with `feature`, it is there only while that feature is on. */
	registerExtension<T>(name: string, value: T, feature?: string): () => void;
	/** True when a feature is on and every module it needs is on. */
	feature(id: string): boolean;
	extension<T>(name: string): T | undefined;
	setting(id: string): PropertyValue | undefined;
	theme(): ThemeContext;
	/** Chooses the app's theme, as picking it in Setting → Appearance does (saved; `System` follows the device). */
	applyTheme(name: string): void;
	/** Every theme registered by the app, plugins, and modules. */
	themeList(): readonly ThemeDefinition[];
}

interface DefinitionBase {
	name: string;
	publisher: string;
	version: string;
	title: string;
	explain: string;
	featureList?: readonly FeatureDefinition[];
	/** Abilities this module or plugin gives others (`Anchor`), and those it relies on, for a view of which needs which. */
	provide?: readonly string[];
	use?: readonly string[];
	/** The module's or plugin's own settings, shown on its page in Setting. */
	settingList?: readonly SettingDefinition[];
	statusItemList?: readonly StatusItemDefinition[];
}

export interface ModuleDefinition extends DefinitionBase {
	kind: 'Module';
	/** Core modules can't be switched off (Text, Layout). */
	core?: boolean;
	blockTypeList: readonly BlockTypeDefinition[];
	/** Register extensions and commands; return a cleanup function if needed. */
	activate?(context: HostContext): void | (() => void);
}

export interface PluginDefinition extends DefinitionBase {
	kind: 'Plugin';
	activate(context: HostContext): void | (() => void);
}

export type Definition = ModuleDefinition | PluginDefinition;

export function fullName(definition: Definition): string {
	return `${definition.publisher}.${definition.name}`;
}

/** Escapes text for HTML. Every renderer should use it (or its own) for user text. */
export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** `#abc` or `#aabbcc` (any case) → `#aabbcc`; anything else → undefined. */
export function normalizeHex(text: string): string | undefined {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
	if (!match) return undefined;
	const hex = match[1]!.toLowerCase();
	return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
}

// ---------------------------------------------------------------- choosing a color

/** The name of the extension that lets you choose a color (the Palette plugin gives one). */
export const colorPickerExtension = 'ColorPicker';

export interface ColorPicker {
	/**
	 * Opens the picker at a point on screen (client px). `onPick` gets a theme color's name (`Accent`),
	 * a hex code (`#c0392b`), or undefined for no color; closing it without a choice calls nothing.
	 */
	open(option: { x: number; y: number; current?: string; title?: string; onPick(color: string | undefined): void }): void;
	close(): void;
}

// ---------------------------------------------------------------- the Board editor

/** The name of the extension that edits a Board in a panel (the Chem module gives one, with its drawing tools). */
export const boardEditorExtension = 'Board.Editor';

/** A block on a Board, as the Board editor reads and writes it. */
export interface BoardItem {
	type: string;
	property: PropertyMap;
	body: string;
	id?: string;
	childList: BoardItem[];
}

export interface BoardEditor {
	/**
	 * Opens the editor on a Board's blocks (`property` is the Board's own). `emPx` is the size of 1em
	 * where the Board is drawn, so drawings keep their size. Done gives the Board's new OI text.
	 */
	open(option: { property: PropertyMap; itemList: BoardItem[]; emPx: number; context: RenderContext; onDone(source: string): void }): void;
}

// ---------------------------------------------------------------- files a note shows (images, videos)

/** The name of the extension the app registers for files notes show: `context.extension<AssetResolver>(assetExtension)`. */
export const assetExtension = 'Asset';

export interface AssetResolver {
	/**
	 * A URL for what a block names: a path in the vault (from the vault's top, from the note's
	 * folder, or just a file name found anywhere, as in Obsidian), or a web address. Undefined
	 * when it can't be found.
	 */
	url(source: string): Promise<string | undefined>;
}

/** Web addresses and inline data load as they are; anything else is a file in the vault. */
export function isWebSource(source: string): boolean {
	return /^(?:https?:|data:image\/|blob:)/i.test(source.trim());
}

/**
 * Loads the images a renderer marked `<img data-oi-asset="path">` (it can't know their URL
 * until the vault is asked). A missing one gets `data-oi-problem`, so the block is outlined.
 */
export function loadAssetImage(root: ParentNode, context: { extension<T>(name: string): T | undefined }): void {
	const resolver = context.extension<AssetResolver>(assetExtension);
	for (const image of root.querySelectorAll<HTMLImageElement>('img[data-oi-asset]')) {
		const source = image.dataset.oiAsset ?? '';
		if (isWebSource(source)) {
			image.src = source.trim();
			continue;
		}
		void (resolver?.url(source) ?? Promise.resolve(undefined)).then((url) => {
			if (url) image.src = url;
			else {
				image.setAttribute('data-oi-problem', `“${source}” is not in the vault`);
				image.title = `“${source}” is not in the vault`;
			}
		});
	}
}
