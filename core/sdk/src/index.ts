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
	/** Theme token (`Accent`, `Color.Accent`) or raw colour → safe CSS colour, or undefined. */
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
	/** True in the Read view: hide editing affordances (buttons, handles). */
	readOnly(): boolean;
}

export interface RenderHandle {
	/** Update in place; return `Remount` to be re-mounted from scratch. */
	update?(next: ResolvedBlock, context: RenderContext): 'Done' | 'Remount';
	/** Repaint for a new theme (only needed when colours are not CSS variables). */
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
}

export interface LayoutContext {
	theme: ThemeContext;
	/** Number → px; validated CSS length text → as-is; otherwise undefined. */
	resolveLength(value: PropertyValue | undefined): string | undefined;
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

export interface FeatureDefinition {
	/** Full name, e.g. `Code.Run`. */
	id: string;
	title: string;
	explain: string;
	default: boolean;
	cost?: 'Low' | 'Medium' | 'High';
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
}

export interface HostContext {
	registerCommand(command: CommandDefinition): () => void;
	registerTheme(theme: ThemeDefinition): () => void;
	registerExtension<T>(name: string, value: T): () => void;
	extension<T>(name: string): T | undefined;
	setting(id: string): PropertyValue | undefined;
	theme(): ThemeContext;
	applyTheme(name: string): void;
	themeList(): readonly ThemeDefinition[];
}

interface DefinitionBase {
	name: string;
	publisher: string;
	version: string;
	title: string;
	explain: string;
	featureList?: readonly FeatureDefinition[];
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
