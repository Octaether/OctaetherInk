// Public types for module and plugin authors.
//   Module = adds a block type (storage + render + edit + theme protocol).
//   Plugin = adds a system function; can extend modules through extensions.

import type { BlockNode, ContentKind, PropertyMap, PropertyValue } from '@octaether/core-format';import type { NoteModel } from '@octaether/core-model';

// ---------------------------------------------------------------- language

let dictionary: Readonly<Record<string, string>> = {};
/** The translations themselves: text that is in the language already is not looked up again. */
let translatedSet = new Set<string>();
let translating = false;
const missingSet = new Set<string>();

let tag = 'en';

/** The words of the language in use: English text → its translation. None for English. The app sets it before anything is drawn.
 * `languageTag` is the language's BCP 47 tag (`zh-Hans`), for dates and numbers drawn with `Intl`. */
export function setDictionary(next: Readonly<Record<string, string>> | undefined, languageTag = next ? tag : 'en'): void {
	tag = languageTag;
	dictionary = next ?? {};
	translatedSet = new Set(Object.values(dictionary));
	translating = next !== undefined;
	missingSet.clear();
}

/** The language in use as a BCP 47 tag (`en`, `zh-Hans`): give it to `Intl` so weekdays, months, and numbers read in it. */
export function languageTag(): string {
	return tag;
}

/** True while a language other than English is in use. */
export function isTranslating(): boolean {
	return translating;
}

/**
 * The translation of text that is already on its way to the screen (a menu's title, a label in a
 * drawn page), or undefined when the language has none, which is also remembered for
 * `missingTextList`. For words written in code, use `t`.
 */
export function lookup(text: string): string | undefined {
	if (!translating || translatedSet.has(text)) return undefined;
	const found = dictionary[text];
	if (found === undefined && missingSet.size < 5000) missingSet.add(text);
	return found;
}

/** What was looked up and not found since the language was set: what a translation still lacks (for tests and translators). */
export function missingTextList(): string[] {
	return [...missingSet];
}

/**
 * The app's words in the language in use. The key is the English text itself, so code reads as it
 * always did, a missing translation shows the English, and a new language is one file of
 * `'English': 'translation'` lines. `{name}` in the text is filled from `value`:
 * `t('Moved {count} notes into “{name}”.', { count, name })`. Call it when the text is drawn, never
 * once at load: the language is known only after the app starts. A block's type, its properties,
 * and their values are syntax, not words: they are never translated.
 */
export function t(text: string, value?: Readonly<Record<string, string | number>>): string {
	const found = dictionary[text] ?? text;
	return value ? found.replace(/\{(\w+)\}/g, (whole, name: string) => (name in value ? String(value[name]) : whole)) : found;
}

/**
 * `t` for a sentence with values in it, written as a template: tr`Couldn’t open “${name}”.` looks
 * up `Couldn’t open “{0}”.` and puts the values back, wherever the translation wants them.
 */
export function tr(partList: TemplateStringsArray, ...valueList: readonly (string | number)[]): string {
	const key = partList.reduce((text, part, index) => `${text}{${index - 1}}${part}`);
	return t(key, Object.fromEntries(valueList.map((value, index) => [String(index), value])));
}

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
	/**
	 * How to write this block, for an AI: its syntax in a few plain lines with an example (what goes after
	 * the colon, in `{…}`, and on the lines below). The AI plugin reads the guides of the modules that are
	 * on (`BlockGuide`), so a new module teaches the AI by itself; without one, its templates are shown.
	 * A function loads it when it is first asked for (`() => import('./guide').then(…)`), so it costs the
	 * app nothing until then.
	 */
	guide?: string | (() => Promise<string>);
	plainText?(block: ResolvedBlock): string;
	/** The page uses the window's whole width when this is the note's only block (a Property block aside): a Table, a Calendar. */
	fillPage?: boolean;
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
	/**
	 * Color: a `#rrggbb` value you pick or type ('' = the default). Action: no value, a button that runs
	 * `command`. Custom: no value of the app's; `mount` draws its own control across the row (the AI's connection).
	 */
	type: 'Choice' | 'Toggle' | 'Text' | 'Number' | 'Color' | 'Action' | 'Custom';
	/** Custom: draws the control into `element`; returns what to do when the page goes. */
	mount?(element: HTMLElement): (() => void) | void;
	choiceList?: readonly string[];
	/** Action: the command its button runs (`AI.Connect`), and the button's words (default: the title). */
	command?: string;
	action?: string;
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
	/**
	 * Its words in other languages, by language id (`zh-Hans`): each loads only when that language is
	 * chosen and gives `'English text': 'translation'` for the texts it passes to `t()`, so a module
	 * from anyone brings its own translations. A language it lacks shows its words in English.
	 */
	language?: Readonly<Record<string, () => Promise<Readonly<Record<string, string>>>>>;
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
	open(option: { x: number; y: number; current?: string; title?: string; /** False: no "No color" (a color must be chosen, as for a gradient's). */ none?: boolean; onPick(color: string | undefined): void }): void;
	close(): void;
}

// ---------------------------------------------------------------- tags across the vault

/** The name of the extension the app registers for tags: `context.extension<TagAccess>(tagExtension)`. */
export const tagExtension = 'Tag';

export interface TagAccess {
	/** A tag's color across the vault, as written (`Danger`, `#2f7d6d`); undefined without one. */
	colorOf(tag: string): string | undefined;
	/** Sets (or, with undefined, removes) a tag's color, the same in text, properties, and tables. */
	setColor(tag: string, color: string | undefined): void;
	/** The tag's menu (its color, the notes with it, rename everywhere) at a point on screen. */
	openMenu(tag: string, x: number, y: number): void;
}

/** A color of a gradient, at its place along it (0 = the weak end, 1 = the strong end). */
export interface GradientStop {
	color: string;
	at: number;
}

/**
 * A gradient as written (`[Blue, "Teal 40%", Yellow]`) → its stops, in order. A color without a
 * place sits evenly between its neighbors that have one (the ends at 0% and 100%), as in CSS.
 */
export function readGradient(list: readonly string[]): GradientStop[] {
	const partList = list.map((item) => {
		const match = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(String(item).trim());
		return match ? { color: match[1]!.trim(), at: Math.max(0, Math.min(1, Number(match[2]) / 100)) as number | undefined } : { color: String(item).trim(), at: undefined as number | undefined };
	});
	if (partList.length === 0) return [];
	if (partList[0]!.at === undefined) partList[0]!.at = 0;
	if (partList.at(-1)!.at === undefined) partList.at(-1)!.at = partList.length === 1 ? 0 : 1;
	for (let index = 1; index < partList.length; index++) {
		if (partList[index]!.at !== undefined) continue;
		let next = index;
		while (partList[next]!.at === undefined) next++;
		const from = partList[index - 1]!.at!;
		const span = (partList[next]!.at! - from) / (next - index + 1);
		for (let at = index; at < next; at++) partList[at]!.at = from + span * (at - index + 1);
	}
	return partList.map((part) => ({ color: part.color, at: part.at! })).sort((left, right) => left.at - right.at);
}

/** Stops → as written: a color alone where it sits evenly, `Teal 40%` where it doesn't. */
export function writeGradient(stopList: readonly GradientStop[]): string[] {
	const sorted = [...stopList].sort((left, right) => left.at - right.at);
	const even = sorted.every((stop, index) => Math.abs(stop.at - (sorted.length < 2 ? 0 : index / (sorted.length - 1))) < 0.005);
	return sorted.map((stop) => (even ? stop.color : `${stop.color} ${Math.round(stop.at * 1000) / 10}%`));
}

/** The CSS of a gradient from left to right, its colors made CSS by `cssOf` (a theme color's name → its variable). */
export function gradientCssText(stopList: readonly GradientStop[], cssOf: (color: string) => string = (color) => color): string {
	if (stopList.length === 1) return cssOf(stopList[0]!.color);
	return `linear-gradient(to right, ${stopList.map((stop) => `${cssOf(stop.color)} ${(stop.at * 100).toFixed(1)}%`).join(', ')})`;
}

/** The name of the extension the Palette plugin registers for gradients: `context.extension<GradientPicker>(gradientPickerExtension)`. */
export const gradientPickerExtension = 'GradientPicker';

export interface GradientPicker {
	/**
	 * Opens the gradient picker at a point on screen (client px), with `current` (two or more colors,
	 * as the color picker gives them: a theme color's name or a hex code). `onPick` gets the colors
	 * chosen, or undefined for none (the thing's one color); closing it without a choice calls nothing.
	 */
	open(option: {
		x: number;
		y: number;
		current?: readonly string[];
		title?: string;
		/** The two ends' names under the bar (default Low, High). */
		lowTitle?: string;
		highTitle?: string;
		noneTitle?: string;
		/** Each change as it is made, to show it at once; Esc gives back `current` (undefined: none). */
		onChange?(stopList: string[] | undefined): void;
		onPick(stopList: string[] | undefined): void;
	}): void;
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

// ---------------------------------------------------------------- loading a renderer when it is first needed

/** Adds a module's CSS to the page once (for CSS that loads with the module's code, not with the app). */
export function installStyle(id: string, css: string): void {
	if (typeof document === 'undefined' || document.head.querySelector(`style[data-oi-style="${id}"]`)) return;
	const element = document.createElement('style');
	element.dataset.oiStyle = id;
	element.textContent = css;
	document.head.append(element);
}

// ---------------------------------------------------------------- loading a renderer when it is first needed

/**
 * A renderer whose code loads the first time a block of its type is drawn (`import('./view')`), so a
 * module costs nothing until it is used. Until then the block shows a quiet placeholder; updates
 * that come meanwhile are kept, and the last one is drawn.
 */
export function lazyRenderer(load: () => Promise<Renderer>, placeholderText = ''): Renderer {
	let loaded: Renderer | undefined;
	let loading: Promise<Renderer> | undefined;
	return {
		mount(frame, block, context) {
			if (loaded) return loaded.mount(frame, block, context);
			loading ??= load().then((renderer) => (loaded = renderer));
			const holder = document.createElement('div');
			holder.className = 'oi-loading';
			holder.textContent = placeholderText;
			frame.append(holder);
			let latest = { block, context };
			let handle: RenderHandle | void = undefined;
			let destroyed = false;
			loading.then(
				(renderer) => {
					if (destroyed) return;
					holder.remove();
					handle = renderer.mount(frame, latest.block, latest.context);
				},
				(error: unknown) => {
					loading = undefined;
					holder.textContent = `Could not load: ${error instanceof Error ? error.message : String(error)}`;
					holder.setAttribute('data-oi-problem', holder.textContent);
				},
			);
			return {
				update(next, nextContext) {
					if (!handle) {
						latest = { block: next, context: nextContext };
						return 'Done';
					}
					return handle.update ? handle.update(next, nextContext) : 'Remount';
				},
				anchor: (name, toward) => (handle ? handle.anchor?.(name, toward) : undefined),
				theme: (theme) => (handle ? handle.theme?.(theme) : undefined),
				destroy() {
					destroyed = true;
					if (handle) handle.destroy?.();
				},
			};
		},
	};
}

// ---------------------------------------------------------------- the vault's notes (calendars, tables of notes)

/** The name of the extension the app registers for the vault's notes: `context.extension<NoteIndex>(noteIndexExtension)`. */
export const noteIndexExtension = 'NoteIndex';

export interface NoteSummary {
	/** `Class/Linear Algebra.oi` */
	path: string;
	/** The file name without `.oi`. */
	name: string;
	/** Its folder (`Class`), '' at the top. */
	folder: string;
	/** Your properties: the note's first Property block, over any kept in its `---` header. */
	property: PropertyMap;
	tagList: readonly string[];
}

export interface NoteIndex {
	/** Every note of the vault, with its properties (unsaved edits of open notes included). */
	noteList(): readonly NoteSummary[];
	/** The path of an open note (the one a block is in). */
	pathOf(note: NoteModel): string | undefined;
	/** Called after any note changes, is added, or goes. */
	subscribe(listener: () => void): () => void;
	/** Sets (or, with undefined, removes) properties of a note, in its Property block; one undo step if it is open. */
	setProperty(path: string, change: ReadonlyMap<string, PropertyValue | undefined>): Promise<void>;
	/** Writes a new note with a Property block and a body (OI text); a taken name gets a number. Resolves to its path. */
	createNote(option: { folder: string; name: string; property: PropertyMap; body?: string }): Promise<string | undefined>;
	/** Moves a note to the trash (with Undo); true when it went. */
	trashNote(path: string): Promise<boolean>;
	/** A note's text, unsaved edits included. */
	readNote(path: string): Promise<string | undefined>;
	/**
	 * A note's live model, to show and change a block that lives there (`Table {From: "[[Gym]]"}`): the
	 * one of its tab when it is open (changes join that tab's undo), otherwise one read from the file,
	 * whose changes are written back at once. Undefined when there is no such note.
	 */
	modelOf(path: string): Promise<NoteModel | undefined>;
	/** A link's target (`Gym`, `Folder/Gym`) → a note's path. */
	resolve(target: string, from?: string): string | undefined;
	/** Opens a note (or a file the app shows, like a .csv) in this tab, or a new one. */
	open(path: string, newTab?: boolean): void;
	/** A file a block names (`Data/Gym.csv`, or just `Gym.csv` found anywhere, as Obsidian does) → its path. */
	findFile(source: string, from?: string): string | undefined;
	readFile(path: string): Promise<Blob | undefined>;
	/** Writes a file in place (text or bytes). */
	writeFile(path: string, data: string | Blob): Promise<void>;
	/** Writes a new file in a folder under a free name (`Table 1.csv`); resolves to its path. */
	createFile(folder: string, name: string, data: string | Blob): Promise<string | undefined>;
}

// ---------------------------------------------------------------- a table's data (Plot, Calendar)

/** The name of the extension the Table module registers for reading tables: `context.extension<TableData>(tableDataExtension)`. */
export const tableDataExtension = 'TableData';

/** A cell: a number (Number, Checkbox as 1/0, Date and DateTime as days from 1970), text, a list, or nothing. */
export type TableCell = number | string | readonly string[] | undefined;

export interface TableColumnData {
	name: string;
	/** Text, Number, Date, DateTime, Checkbox, Choice, List, Link, Formula */
	type: string;
	unit?: string;
	valueList: readonly TableCell[];
}

export interface TableSnapshot {
	columnList: readonly TableColumnData[];
	rowCount: number;
	/** For a table of notes, each row's note. */
	pathList?: readonly (string | undefined)[];
}

export interface TableData {
	/**
	 * A table's rows after its Filter and Sort, found by its title: `Gym log` (in this note) or
	 * `Gym#Gym log` (in the note Gym). Undefined when there is no such table.
	 */
	read(context: RenderContext, reference: string): Promise<TableSnapshot | undefined>;
	/** Calls `listener` when that table may have changed; returns the cleanup. */
	watch(context: RenderContext, reference: string, listener: () => void): () => void;
}

// ---------------------------------------------------------------- menus

/** The name of the extension the app registers for its menus, so a module's menus look like the app's: `context.extension<PopupMenu>(menuExtension)`. */
export const menuExtension = 'Menu';

export interface MenuEntry {
	title: string;
	/** A short line under the title. */
	explain?: string;
	/** Right-aligned: a key, a value. */
	hint?: string;
	/** A tick before the title (the current choice). */
	checked?: boolean;
	/** Other words a search finds it by. */
	keywordList?: readonly string[];
	danger?: boolean;
	separatorBefore?: boolean;
	run?(): void;
	/** A submenu. */
	childList?: readonly MenuEntry[];
}

/** A menu that filters by what is typed in a field of your own (a "/" in a line), as the note's "/" menu does. */
export interface QueryMenu {
	/** Shows the entries that match (case aside), best first. */
	setQuery(query: string): void;
	/** Moves it under a point (or, with no room below, above `above`). */
	place(x: number, y: number, above?: number): void;
	close(): void;
}

export interface PopupMenu {
	/** Opens a menu at a point on screen (client px); one menu is open at a time. */
	open(option: { x: number; y: number; itemList: readonly MenuEntry[]; search?: boolean; onClose?(): void }): void;
	/**
	 * Opens a menu that the keys of your field drive: typing stays in the field (give the menu what is
	 * typed with `setQuery`), while ↑ ↓ Enter Tab and Esc go to the menu. `onClose` runs however it closes.
	 */
	openQuery?(option: { x: number; y: number; itemList: readonly MenuEntry[]; emptyText?: string; /** Nothing picked until an arrow key, so Enter keeps what is typed. */ free?: boolean; onClose?(): void }): QueryMenu;
	close(): void;
	/** Asks for a line of text in the app's own dialog; undefined when cancelled. */
	prompt(message: string, value?: string, action?: string): Promise<string | undefined>;
	/** Asks yes or no in the app's own dialog (`danger`: the yes button warns). */
	confirm?(message: string, action?: string, danger?: boolean): Promise<boolean>;
}

export interface ComboItem {
	title: string;
	/** What a pick gives (default: the title). */
	value?: string;
	/** Right-aligned: a count, a provider. */
	hint?: string;
	checked?: boolean;
}

export interface ComboOption {
	/** What to offer; asked each time the list opens. */
	itemList(): readonly ComboItem[];
	onPick(value: string): void;
	/** Sorted by title (default), or kept in the order given. */
	sort?: boolean;
	/** Opens as soon as the field has the focus (default: once typing, or the down arrow). */
	openOnFocus?: boolean;
	emptyText?: string;
}

/**
 * A field that suggests, in the app's own menu (never the browser's list): it filters as you type,
 * the arrow keys choose, Enter takes the one chosen (or, with none chosen, stays with the field), Esc
 * closes. Returns its removal. Without the app's menu (a test, another host) it is a plain field.
 */
export function comboField(menu: PopupMenu | undefined, input: HTMLInputElement, option: ComboOption): () => void {
	if (!menu?.openQuery) return () => undefined;
	let open: QueryMenu | undefined;
	const show = (): void => {
		if (!input.isConnected) return;
		const rect = input.getBoundingClientRect();
		if (!open) {
			const list = [...option.itemList()];
			if (option.sort !== false) list.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true }));
			if (list.length === 0) return;
			open = menu.openQuery!({
				x: rect.left,
				y: rect.bottom + 2,
				free: true,
				itemList: list.map((item) => ({ title: item.title, ...(item.hint ? { hint: item.hint } : {}), ...(item.checked ? { checked: true } : {}), run: () => option.onPick(item.value ?? item.title) })),
				...(option.emptyText ? { emptyText: option.emptyText } : {}),
				onClose: () => {
					open = undefined;
				},
			});
		}
		open.setQuery(input.value);
		open.place(rect.left, rect.bottom + 2, rect.top);
	};
	const close = (): void => open?.close();
	const onKey = (event: KeyboardEvent): void => {
		if (!open && event.key === 'ArrowDown') {
			event.preventDefault();
			show();
		}
	};
	const onFocus = (): void => {
		if (option.openOnFocus) show();
	};
	input.addEventListener('input', show);
	input.addEventListener('keydown', onKey);
	input.addEventListener('focus', onFocus);
	input.addEventListener('blur', close);
	return () => {
		close();
		input.removeEventListener('input', show);
		input.removeEventListener('keydown', onKey);
		input.removeEventListener('focus', onFocus);
		input.removeEventListener('blur', close);
	};
}

// ---------------------------------------------------------------- how blocks are written (for the AI plugin)

/** The name of the extension the app registers for the block types that are on: `context.extension<BlockGuide>(blockGuideExtension)`. */
export const blockGuideExtension = 'BlockGuide';

export interface BlockGuideEntry {
	/** `Math` */
	type: string;
	/** The title of the module that gives it. */
	module: string;
	content: ContentKind;
	/** The property the text after the colon sets (`Code` → `Language`). */
	argument?: string;
	/** The symbols that open it instead of `Type:`, as set now. */
	aliasList: readonly string[];
	/** The module's own words on how to write it (`BlockTypeDefinition.guide`). */
	guide?: string;
	/** Its templates' OI text, as examples for a type without a guide. */
	exampleList: readonly string[];
}

export interface BlockGuide {
	/** Every block type whose module is on and that is written by hand, with its guide loaded. */
	list(): Promise<readonly BlockGuideEntry[]>;
}

// ---------------------------------------------------------------- the note on screen (for plugins that write into it)

/** The name of the extension the app registers for the note on screen: `context.extension<NoteEditor>(noteEditorExtension)`. */
export const noteEditorExtension = 'NoteEditor';

/** Text: characters highlighted in a block's editor. Block: a selected block, with what it holds. Note: the whole note. */
export type NoteScope = 'Text' | 'Block' | 'Note';

/** The note on screen and what is selected in it, as it was when captured; `apply` writes into that place. */
export interface NoteTarget {
	/** The note's name (its file's, without `.oi`). */
	name: string;
	/** The note's blocks as OI text, without the app's `---` header. */
	text: string;
	scope: NoteScope;
	/** The highlighted text, or the selected block's OI text; '' for the whole note. */
	selection: string;
	/** The type of the block the selection is in. */
	type?: string;
	/**
	 * Writes OI text as one undo step. Replace: in place of the selection (of every block, for the whole
	 * note). After: under the selection's block (for the whole note: under the block being written in,
	 * else at the end). False when it can't (the note was closed, the block is gone or has changed).
	 */
	apply(source: string, where: 'Replace' | 'After'): boolean;
	/** The same place, with the whole note as the scope. */
	whole(): NoteTarget;
}

export interface NoteEditor {
	/** The note on screen and its selection now; undefined when no note is shown. */
	capture(): NoteTarget | undefined;
	/** Draws OI text in `element` as the note would show it (read-only, with the modules that are on). */
	preview(element: HTMLElement): { update(source: string): void; destroy(): void };
}

// ---------------------------------------------------------------- the vault's files, for a plugin that changes them (the AI)

/** The name of the extension the app registers for the open vault's files: `context.extension<VaultFile>(vaultFileExtension)`. */
export const vaultFileExtension = 'VaultFile';

export interface VaultFileEntry {
	path: string;
	kind: 'File' | 'Folder';
}

/** A change made to the vault, and the way back while the vault stays open. */
export interface VaultChange {
	/** Where the file is now (a move or a rename may give it another name). */
	path: string;
	undo(): Promise<void>;
}

/**
 * The open vault's files, read and changed as the app does it: a note that is open is changed in
 * its tab (one undo step there, its unsaved edits read), links follow a move, a delete goes to the
 * trash. Paths are from the vault's top; `.oi/` (the app's own folder) is reachable but never listed
 * unless asked.
 */
export interface VaultFile {
	/** The open vault's name, or undefined when none is open. */
	name(): string | undefined;
	/** Every file and folder in `folder` and under it ('' = all); `.oi/` only when it is the folder asked for. */
	list(folder?: string): readonly VaultFileEntry[];
	has(path: string): boolean;
	/** A text file's text (a note's, unsaved edits included); undefined when there is no such file or it isn't text. */
	read(path: string): Promise<string | undefined>;
	/** Creates or replaces a text file. Missing folders are made. */
	write(path: string, text: string): Promise<VaultChange>;
	makeFolder(path: string): Promise<VaultChange>;
	/** Moves or renames a file or folder (the target is the new full path); `[[links]]` to it follow. */
	move(path: string, target: string): Promise<VaultChange>;
	/** To the trash (or, where there is none, deleted with a copy kept for undo). */
	trash(path: string): Promise<VaultChange>;
	/** Deletes a file or folder of the app's own folder (`.oi/`) for good: a plugin's own data, such as a chat. */
	remove?(path: string): Promise<void>;
	/** Notes whose text (or name, or tags with `tag:Name`) matches, with a line where. */
	search(query: string, limit?: number): readonly { path: string; line: string }[];
	/** Shows a note or file in a tab (in the background: a tab behind the one in front). */
	open(path: string, option?: { background?: boolean }): void;
	/** A picture of a note as the app draws it (PNG), without showing it; undefined when it can't. */
	picture(path: string): Promise<Blob | undefined>;
	/** The note on screen, or (with a page such as the chat in front) the note shown last. */
	currentPath(): string | undefined;
}

// ---------------------------------------------------------------- a page of a plugin's own in a tab (the AI's chat)

/** The name of the extension the app registers for plugin pages in tabs: `context.extension<PanelHost>(panelExtension)`. */
export const panelExtension = 'Panel';

/** What a panel's page can do to its tab. */
export interface PanelTab {
	/** The page moves on to another state (a new chat got its id): kept with the tab, for when the app opens again. */
	setState(state: string): void;
	setTitle(title: string): void;
	/** True while the tab is the one shown. */
	isShown(): boolean;
}

export interface PanelDefinition {
	/** `AI.Chat` */
	id: string;
	/** The tab's title before the page gives one. */
	title: string;
	/** Draws the page for a state (which chat) into `element`, which stays while the tab is open. */
	mount(element: HTMLElement, state: string, tab: PanelTab): { destroy(): void; shown?(): void };
}

export interface PanelHost {
	/** Adds a kind of page; returns its removal (its open tabs then say it is gone). */
	register(panel: PanelDefinition): () => void;
	/**
	 * Opens a page in a tab: the tab showing it already, or a new one (in the background: behind the
	 * tab in front). `beside`: in a pane beside the note (made when there is one pane), which takes the focus.
	 */
	open(id: string, state: string, option?: { title?: string; background?: boolean; beside?: boolean }): void;
	/** Shows a page of this kind that is open already (one in front of a pane first); false when none is. */
	show?(id: string): boolean;
	/** The page in the tab with the focus, when that tab shows one. */
	current?(): { id: string; state: string } | undefined;
	/** Called when another tab or pane comes to the front. */
	subscribe?(listener: () => void): () => void;
}

// ---------------------------------------------------------------- the app's commands, for a plugin that runs them (the AI)

/** The name of the extension the app registers for its commands: `context.extension<CommandAccess>(commandExtension)`. */
export const commandExtension = 'Command';

export interface CommandAccess {
	/** The commands the palette offers (not those of a context of their own, such as the drawing tool's). */
	list(): readonly { id: string; title: string; explain?: string }[];
	/** Runs one, as the palette would; false when there is no such command. */
	run(id: string, argument?: unknown): boolean;
}

// ---------------------------------------------------------------- a block that lives in another note (From)

/** Where a block with `From: "[[Note]]"` keeps its content: that note's model, the block's key there, and its path. */
export interface LinkedBlock {
	model: NoteModel;
	key: string;
	path: string;
}

/**
 * The block a `From` names: `[[Gym]]` (the first block of `type` there) or `[[Gym#Gym log]]` (the
 * one with that title). Undefined when the note or the block isn't there.
 */
export async function linkedBlock(context: RenderContext, from: string, type: string): Promise<LinkedBlock | undefined> {
	const match = /^\s*\[?\[?([^\]#|]+?)(?:#([^\]|]+))?\]?\]?\s*$/.exec(from);
	const index = context.extension<NoteIndex>(noteIndexExtension);
	if (!match || !index) return undefined;
	const here = index.pathOf(context.note);
	const path = index.resolve(match[1]!.trim(), here);
	if (!path || path === here) return undefined;
	const model = await index.modelOf(path);
	if (!model) return undefined;
	const title = match[2]?.trim().toLowerCase();
	const find = (list: readonly BlockNode[]): BlockNode | undefined => {
		for (const node of list) {
			const own = node.property.get('Title');
			if (node.type === type && (title ? typeof own === 'string' && own.trim().toLowerCase() === title : node.property.get('From') === undefined)) return node;
			const inner = find(node.childList);
			if (inner) return inner;
		}
		return undefined;
	};
	const node = find(model.document.itemList);
	return node ? { model, key: node.key, path } : undefined;
}

/** A linked block's properties, with the ones written on the reference itself on top (From left out). */
export function linkedProperty(own: PropertyMap, linked: PropertyMap): PropertyMap {
	const map: PropertyMap = new Map(linked);
	for (const [key, value] of own) if (key !== 'From') map.set(key, value);
	return map;
}
