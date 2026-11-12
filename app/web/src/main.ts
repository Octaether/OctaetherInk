// Octaether Ink, web app: wires the core (registry, render host, edit session), the modules and
// plugins, the workspace (a vault or single files, in tabs), and the Obsidian-style shell around them.

import './app.css';
import { type BlockNode, type PropertyValue, formatName, formatPairLineList, serializeNode } from '@octaether/core-format';
import {
	type ClickToEdit,
	CommandRegistry,
	EditSession,
	type FormatKind,
	type HotkeyBinding,
	HotkeyManager,
	addColumn,
	colorRange,
	duplicateBlock,
	eventChord,
	indentBlock,
	insertTemplate,
	installEditStyle,
	isApplePlatform,
	moveBlock,
	outdentBlock,
	parseHotkey,
	toggleFormat,
	turnInto,
} from '@octaether/core-edit';
import { type HostService, Registry, RenderHost, type TemplateEntry, ThemeRegistry, applyThemeVariable, installBaseStyle, readLayout, themeContext } from '@octaether/core-render';
import {
	type AssetResolver,
	type BlockGuide,
	type ColorPicker,
	type CommandDefinition,
	type Definition,
	type HotkeyLookup,
	type MenuEntry,
	type NoteEditor,
	type NoteScope,
	type NoteTarget,
	type PopupMenu,
	type SettingDefinition,
	assetExtension,
	blockGuideExtension,
	colorPickerExtension,
	hotkeyExtension,
	menuExtension,
	type CommandAccess,
	type PanelDefinition,
	type PanelHost,
	type VaultChange,
	type VaultFile,
	commandExtension,
	noteEditorExtension,
	noteIndexExtension,
	panelExtension,
	tagExtension,
	type TagAccess,
	type NoteIndex,
	t,
	vaultFileExtension,
	tr,
} from '@octaether/core-sdk';
import { type FileSystem, MemoryFileSystem, Vault, baseName, extensionOf, isDataFile, isNote, joinPath, linkTargetOf, mediaKindOf, mediaTypeOf, nameProblem, parentPath, stemOf } from '@octaether/core-vault';
import { calendarModule } from '@octaether/module-calendar';
import { chemModule } from '@octaether/module-chem';
import { codeModule } from '@octaether/module-code';
import { htmlModule } from '@octaether/module-html';
import { boardModule } from '@octaether/module-board';
import { layoutModule } from '@octaether/module-layout';
import { markdownModule } from '@octaether/module-markdown';
import { mathModule } from '@octaether/module-math';
import { imageModule, videoModule } from '@octaether/module-media';
import { plotModule } from '@octaether/module-plot';
import { openPropertyForm, propertyModule } from '@octaether/module-property';
import { tableModule } from '@octaether/module-table';
import { textModule } from '@octaether/module-text';
import { tikzModule } from '@octaether/module-tikz';
import { aiPlugin } from '@octaether/plugin-ai';
import { palettePlugin } from '@octaether/plugin-palette';
import { themePlugin } from '@octaether/plugin-theme';
import { accentToken, normalizeHex } from './color';
import { BrowserFileSystem, DirectoryFileSystem, canOpenFolder, downloadBlob, downloadText, ensurePermission } from './file-system';
import { FindBar, NoteFindTarget, SourceFindTarget } from './find-bar';
import { setupFormatBar } from './format-bar';
import type { GraphView } from './graph-view';
import { setupGutter } from './gutter';
import { setupHoverHighlight } from './hover-highlight';
import { icon } from './icon';
import { currentLanguage, startLanguage } from './language';
import { NoteHead, headerKeyList, propertyBlockOf, systemKeySet } from './note-head';
import { createNoteIndex } from './note-index';
import { NoteModel } from '@octaether/core-model';
import { bestFuzzyScore, openCommandPalette, openPicker } from './palette';
import { SettingStore } from './setting-store';
import type { openSettingModal as OpenSettingModal } from './setting-modal';
import { type OpenHow, Sidebar, vaultPathType } from './sidebar';
import { SourceEditor } from './source-editor';
import { StartScreen } from './start-screen';
import { StatusBar } from './status-bar';
import { type RecentEntry, clearLast, createId, forgetRecent, idbGet, idbSet, lastEntry, readJson, recentList, rememberRecent, storageKey, writeJson } from './storage';
import { TabBar } from './tab-bar';
import { cssColorOf, tagColorCss, tagColorMap, tagColorSetting, withTagColor } from './tag-color';
import { Menu, type MenuItem, closeAllMenu, confirmDialog, currentMenu, escapeHtml, openModal, promptDialog, toast } from './ui';
import { type Tab, Workspace, newNoteText, nowText, paneIdListOf } from './workspace';
import { type ZipEntry, makeZip } from './zip';
// the one place the version is written: the repository's package.json (README §12.3)
import { version as packageVersion } from '../../../package.json';

export const appVersion: string = packageVersion;
export type ViewMode = 'Source' | 'Edit' | 'Read';

function element<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}

// ---------------------------------------------------------------- settings

const appSettingList: SettingDefinition[] = [
	{
		id: 'Editor.ClickToEdit',
		title: 'Click to edit',
		type: 'Choice',
		choiceList: ['SingleClick', 'DoubleClick', 'HotkeyOnly'],
		default: 'SingleClick',
		explain: 'How a block switches into editing. SingleClick edits right where you click. DoubleClick avoids accidental edits while reading or scrolling on a tablet. HotkeyOnly keeps notes still until you select a block and press Enter.',
	},
	{ id: 'Editor.DefaultView', title: 'View for a note you open', type: 'Choice', choiceList: ['Edit', 'Read', 'Source'], default: 'Edit', explain: 'Edit: blocks turn into text where you click. Read: nothing changes by accident. Source: the whole note as text, like a code editor.' },
	{ id: 'Editor.SyncScroll', title: 'Scroll panes together', type: 'Toggle', default: true, explain: 'When two panes show the same note (its source beside it, say), scrolling one scrolls the other to the same place.' },
	{ id: 'Editor.ReadableWidth', title: 'Readable line length', type: 'Toggle', default: true, explain: 'Keeps lines about 750 px wide on a big screen. Off: text uses the whole window.' },
	{
		id: 'Editor.BlockHandle',
		title: 'Show the block handle',
		type: 'Toggle',
		default: false,
		explain: 'The ⋮⋮ handle (drag it, or click it for the block menu) and + beside the block under the mouse. Without it: hold Alt (Option on a Mac) and drag any block, Alt + the wheel for the block around it, right-click for the menu. On a touch screen, hold a block, then drag.',
	},
	{ id: 'Editor.BlockOutline', title: 'Outline the block being edited', type: 'Toggle', default: true, explain: 'A soft outline (and the block’s type) shows which block you’re editing, and a dashed one the block around it.' },
	{ id: 'Appearance.FontSize', title: 'Text size', type: 'Choice', choiceList: ['14px', '15px', '16px', '17px', '18px', '20px'], default: '16px', explain: 'The size of the note’s text; math, chemistry, and diagrams grow with it.' },
	{ id: 'Appearance.AccentColor', title: 'Accent color', type: 'Color', default: '', explain: 'The color of links, buttons, outlines, and tags. Pick one or type a hex code; ↺ goes back to the theme’s own (Octaether gold).' },
	{ id: 'Appearance.HoverHighlight', title: 'Highlight what the pointer is over', type: 'Toggle', default: true, explain: 'In the Edit view, the character (or the piece of an equation or drawing) under the pointer lights up, so you see where a click will land.' },
	{ id: 'Appearance.HoverColor', title: 'Hover highlight color', type: 'Color', default: '', explain: 'The color of that highlight, drawn see-through over the text. Default: the accent color.' },
	{ id: 'File.OpenLast', title: 'Reopen what was open', type: 'Toggle', default: true, explain: 'Opens the last vault (with its tabs) or file when the app starts. In a browser tab, a folder may need one click to allow access again.' },
	{ id: 'File.NewNoteLocation', title: 'Where a new note goes', type: 'Choice', choiceList: ['VaultRoot', 'CurrentFolder'], default: 'VaultRoot', explain: 'VaultRoot: the top of the vault. CurrentFolder: the folder of the note you are in.' },
	{
		id: 'File.DeleteTo',
		title: 'A deleted file goes to',
		type: 'Choice',
		choiceList: ['Trash', 'Permanent'],
		default: 'Trash',
		explain: 'Trash: the vault’s own trash, the .oi/Trash folder inside it (browsers can’t reach the computer’s recycle bin). Permanent: deleted, with no trash to restore from. Either way, the Undo button shown for a few seconds after a delete brings it back. Quick notes have no trash, and a blank Untitled note is always removed permanently.',
	},
	{ id: 'File.ConfirmDelete', title: 'Ask before deleting', type: 'Toggle', default: true, explain: 'Asks before a note or folder is deleted. Quick notes, kept in this browser, always ask.' },
	{ id: 'File.UpdateLink', title: 'Update links when renaming', type: 'Toggle', default: true, explain: 'Renaming a note rewrites the [[links]] to it in every other note.' },
	{ id: 'File.AttachmentFolder', title: 'Folder for pasted pictures', type: 'Text', default: 'Attachment', explain: 'A picture or video pasted or dropped on a note is saved in this folder of the vault, and an Image or Video block shows it. Empty: next to the note.' },
];

/**
 * The theme. The app owns this choice (Setting → Appearance, Switch theme); plugins and modules
 * only add themes, and its list follows every theme registered. `Theme.Active` is the ID vault
 * setting files already use.
 */
const themeSetting: SettingDefinition = {
	id: 'Theme.Active',
	title: 'Theme',
	type: 'Choice',
	choiceList: ['System', 'Light', 'Dark'],
	default: 'System',
	scopeList: ['Profile', 'Vault', 'Device'],
	explain: 'The color set of the whole app and every block. System follows your device: Light by day, Dark when the device is dark. Plugins and modules can add themes; they all show here.',
};

const setting = new SettingStore();
setting.define([...appSettingList, themeSetting]);

// ---------------------------------------------------------------- core

installBaseStyle();
installEditStyle();

const registry = new Registry();
const themeRegistry = new ThemeRegistry();
const commandRegistry = new CommandRegistry();
const enabledState = readJson<Record<string, boolean>>(storageKey.Enabled, {});
// the TikZ module was called Diagram: its switch carries over
if ('Diagram' in enabledState && !('TikZ' in enabledState)) enabledState.TikZ = enabledState.Diagram!;
const definitionList: Definition[] = [
	textModule,
	propertyModule,
	layoutModule,
	boardModule,
	mathModule,
	codeModule,
	chemModule,
	tikzModule,
	tableModule,
	plotModule,
	calendarModule,
	imageModule,
	videoModule,
	markdownModule,
	htmlModule,
	themePlugin,
	palettePlugin,
	aiPlugin,
];
for (const definition of definitionList) registry.add(definition, enabledState[definition.name] ?? true);
// the modules' own settings, and the alias switch and symbols of each block type that has aliases
setting.define(registry.settingList().map((item) => item.setting));

/** The app's own default keys, and those modules and plugins give their commands (the drawing tool's, in its `Drawing` context). */
let appBindingList: HotkeyBinding[] = [];
const moduleBindingList: HotkeyBinding[] = [];
function refreshDefaultBinding(): void {
	setting.defaultBindingList = [...appBindingList, ...moduleBindingList];
	setting.defaultBindingChanged();
}

const service: HostService = {
	registerCommand: (command) => {
		const remove = commandRegistry.register(command);
		const bindingList = (command.key ?? []).map((key): HotkeyBinding => ({ key, command: command.id, ...(command.when ? { when: command.when } : {}) }));
		moduleBindingList.push(...bindingList);
		refreshDefaultBinding();
		return () => {
			remove();
			// a cleanup may run twice (the module's own, then the registry's): a binding already gone must not take another's place
			for (const binding of bindingList) if (moduleBindingList.includes(binding)) moduleBindingList.splice(moduleBindingList.indexOf(binding), 1);
			refreshDefaultBinding();
		};
	},
	registerTheme: (theme) => themeRegistry.register(theme),
	setting: (id) => setting.get(id),
	theme: () => themeContext(themeRegistry.current()),
	// a plugin choosing a theme chooses it as you would: saved, and shown in Appearance
	applyTheme: (name) => chooseTheme(name),
	themeList: () => themeRegistry.list(),
};

// The setting is the one source of truth: whatever sets Theme.Active (Appearance, Switch theme,
// a macro, a vault's Setting.oi, a plugin) shows that theme at once. System follows the device's
// light or dark appearance, as on phones and in Obsidian's "Adapt to system".
const systemDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;

/** The theme the setting asks for; one whose plugin is off falls back to Light or Dark as the device is. */
function wantedTheme(): string {
	const saved = String(setting.get('Theme.Active') ?? 'System');
	return saved !== 'System' && themeRegistry.get(saved) ? saved : systemDark?.matches ? 'Dark' : 'Light';
}

/** Shows the theme the setting names (after the setting, the device, or the list of themes changes). */
function applySavedTheme(): void {
	const wanted = wantedTheme();
	if (themeRegistry.current().name !== wanted) themeRegistry.apply(wanted);
}

/** Chooses a theme (or System) and keeps it. */
function chooseTheme(name: string): void {
	if (name !== 'System' && !themeRegistry.get(name)) {
		toast(tr`No theme “${name}”. The themes are: ${themeRegistry.list().map((theme) => theme.name).join(', ')}.`);
		return;
	}
	setting.set('Theme.Active', name);
	applySavedTheme();
}

themeRegistry.subscribe(() => {
	// the setting's list is every theme there is now; a theme just added that the setting names shows
	themeSetting.choiceList = ['System', ...themeRegistry.list().map((theme) => theme.name)];
	applySavedTheme();
	applyChromeTheme();
});
// plugin pages in tabs: there before plugins start, since they add their pages as they start
const panelDefinitionMap = new Map<string, PanelDefinition>();
registry.registerExtension(panelExtension, {
	register(panel) {
		panelDefinitionMap.set(panel.id, panel);
		return () => {
			if (panelDefinitionMap.get(panel.id) !== panel) return;
			panelDefinitionMap.delete(panel.id);
			// its open tabs say it is gone
			for (const [tabId, page] of panelPageMap) {
				if (page.id !== panel.id) continue;
				page.handle?.destroy();
				page.element.remove();
				panelPageMap.delete(tabId);
			}
			showTab();
		};
	},
	open(id, state, option = {}) {
		const panel = { id, state, title: option.title ?? panelDefinitionMap.get(id)?.title ?? '' };
		if (workspace.kind === 'None' && !option.background) {
			// nothing open: the page needs a tab bar to sit in, so the quick notes open first
			void openQuickNote().then(() => workspace.openPanel(panel, { background: option.background }));
			return;
		}
		if (option.beside && !option.background) {
			openBeside(panel);
			return;
		}
		workspace.openPanel(panel, { background: option.background });
	},
	show(id) {
		const front = workspace.paneList.map((pane) => workspace.activeTabOf(pane.id)).find((tab) => tab?.view === 'Panel' && tab.panel?.id === id);
		const tab = front ?? workspace.tabList.find((item) => item.view === 'Panel' && item.panel?.id === id);
		if (!tab) return false;
		if (tab.pane) workspace.focusPane(tab.pane);
		workspace.activateTab(tab.id);
		return true;
	},
	current() {
		const tab = workspace.tab;
		return tab?.view === 'Panel' && tab.panel ? { id: tab.panel.id, state: tab.panel.state } : undefined;
	},
	subscribe(listener) {
		return workspace.subscribe((event) => {
			if (event === 'Tab' || event === 'Note') listener();
		});
	},
} satisfies PanelHost);

/** A plugin's page in a pane beside the note: the pane there already, or a new one on the right. */
function openBeside(panel: { id: string; state: string; title: string }): void {
	const open = workspace.tabList.find((tab) => tab.view === 'Panel' && tab.panel?.id === panel.id && tab.panel.state === panel.state);
	if (open) {
		if (open.pane) workspace.focusPane(open.pane);
		workspace.activateTab(open.id);
		return;
	}
	// a pane that shows a page of this kind takes it; else any other pane; else a new one on the right
	const other = workspace.paneList.filter((pane) => pane.id !== workspace.paneId);
	const target = other.find((pane) => workspace.activeTabOf(pane.id)?.panel?.id === panel.id) ?? other.at(-1);
	if (target) {
		workspace.focusPane(target.id);
		workspace.openPanel(panel);
		return;
	}
	session.close();
	sourceEditor?.flush();
	if (!workspace.splitPane('Right')) {
		workspace.openPanel(panel);
		return;
	}
	// the new pane's copy of the note becomes the page
	workspace.openPanel(panel, { newTab: false, history: true });
}
registry.attach(service);

/** Your accent color is laid over every theme (with a soft version mixed for light or dark). */
function applyAccentColor(): void {
	const hex = normalizeHex(String(setting.get('Appearance.AccentColor') ?? ''));
	themeRegistry.setOverride(hex ? (theme) => accentToken(hex, theme) : undefined);
}
applyAccentColor();
applySavedTheme();
systemDark?.addEventListener('change', applySavedTheme);

const noteElement = element<HTMLDivElement>('note');
const host = new RenderHost(noteElement, registry, themeRegistry);

function applyChromeTheme(): void {
	applyThemeVariable(document.documentElement, themeRegistry.current(), registry.moduleTokenList());
}

// ---------------------------------------------------------------- workspace

const workspace = new Workspace({
	formatOption: () => registry.formatOption(),
	setting: (id) => setting.get(id),
	confirm: (message, action, danger) => confirmDialog(message, action, danger),
	notify: (message, action) => toast(message, undefined, action),
	// a vault's own settings (theme, aliases, hotkeys) apply before its notes show, so they are drawn once
	prepareVault: async (vault, source) => {
		await setting.attachVault(source?.kind === 'Guide' ? undefined : vault);
		applyAccentColor();
		applySavedTheme();
		applyEditorSetting();
		hotkeyManager.setBindingList(setting.bindingList());
		registerMacro();
	},
});

const model = (): import('@octaether/core-model').NoteModel | undefined => workspace.note?.model;

// Files notes show (pictures, videos): found in the open vault as Obsidian finds them, read once,
// and kept as blob URLs until the vault closes.
const assetUrlMap = new Map<string, Promise<string | undefined>>();
let assetVault: Vault | undefined;

function forgetAsset(): void {
	for (const url of assetUrlMap.values()) void url.then((value) => value && URL.revokeObjectURL(value));
	assetUrlMap.clear();
}

function assetUrl(source: string): Promise<string | undefined> {
	const vault = workspace.vault;
	if (vault !== assetVault) {
		forgetAsset();
		assetVault = vault;
	}
	const path = vault?.findFile(source, workspace.note?.path ?? '');
	if (!vault || !path) return Promise.resolve(undefined);
	let url = assetUrlMap.get(path);
	if (!url) {
		url = vault.readBinary(path).then(
			(blob) => URL.createObjectURL(blob),
			() => undefined,
		);
		assetUrlMap.set(path, url);
	}
	return url;
}

registry.registerExtension(assetExtension, { url: assetUrl } satisfies AssetResolver);
// how each block type that is on is written, in its module's own words (what the AI plugin reads)
registry.registerExtension(blockGuideExtension, { list: () => registry.guideList() } satisfies BlockGuide);
// the vault's notes, for calendars and tables of notes
registry.registerExtension(
	noteIndexExtension,
	createNoteIndex({
		workspace,
		formatOption: () => registry.formatOption(),
		newNoteText,
		open: (path, newTab) => (isNote(path) ? void workspace.openNote(path, { newTab }) : void workspace.openFile(path, { newTab })),
	}),
);
// the app's menus, for modules' own (a table's column menu, a calendar event's)
const menuItemOf = (entry: MenuEntry): MenuItem => ({
	// a module's menu holds names of yours (columns, choices) beside its own words: it says them itself
	literal: true,
	title: entry.title,
	explain: entry.explain,
	hint: entry.hint,
	danger: entry.danger,
	separatorBefore: entry.separatorBefore,
	icon: entry.checked ? '✓' : undefined,
	keywordList: entry.keywordList,
	run: entry.run,
	itemList: entry.childList?.map(menuItemOf),
});
registry.registerExtension(menuExtension, {
	open: ({ x, y, itemList, search, onClose }) => void new Menu(itemList.map(menuItemOf), { x, y, search, onClose }),
	openQuery: ({ x, y, itemList, emptyText, free, onClose }) => {
		const menu = new Menu(itemList.map(menuItemOf), { x, y, externalQuery: true, emptyText, free, onClose });
		return { setQuery: (query) => menu.setQuery(query), place: (left, top, above) => menu.place(left, top, above), close: () => menu.close() };
	},
	close: () => closeAllMenu(),
	prompt: (message, value, action) => promptDialog(message, value, action),
	confirm: (message, action, danger) => confirmDialog(message, action, danger),
} satisfies PopupMenu);

let viewMode: ViewMode = (setting.get('Editor.DefaultView') as ViewMode | undefined) ?? 'Edit';
let slashMenu: Menu | undefined;
let slashAnchor: HTMLElement | undefined;
let sourceEditor: SourceEditor | undefined;
let sourceCursor: { line: number; column: number } | undefined;
let unsubscribeNote: (() => void) | undefined;
let applyingSource = false;
/** The tab and note on screen, to keep each tab's scroll position when switching. */
let shownTab: Tab | undefined;
let shownModel: import('@octaether/core-model').NoteModel | undefined;
/** The note shown last (its path follows a rename), for a plugin's page in front of it: what the AI's chat is about. */
let lastNote: import('./workspace').OpenNote | undefined;

function placeSlashMenu(): void {
	if (!slashMenu || !slashAnchor) return;
	const rect = slashAnchor.getBoundingClientRect();
	slashMenu.place(rect.left, rect.bottom + 4, rect.top);
}

const session = new EditSession(host, registry, model, {
	clickToEdit: () => (setting.get('Editor.ClickToEdit') as ClickToEdit | undefined) ?? 'SingleClick',
	readOnly: () => viewMode !== 'Edit',
	spellcheck: () => setting.get('Text.SpellCheck') !== false,
	onStateChange: () => statusBar.schedule(),
	onSlash: (key, query, anchor) => {
		if (query === undefined) {
			slashMenu?.close();
			slashMenu = undefined;
			return;
		}
		slashAnchor = anchor;
		if (!slashMenu) {
			slashMenu = new Menu(templateItemList((template) => applySlash(key, template)), {
				x: 0,
				y: 0,
				externalQuery: true,
				emptyText: 'No block type matches',
				onClose: () => {
					slashMenu = undefined;
					slashAnchor = undefined;
				},
			});
		}
		slashMenu.setQuery(query);
		// measured on every keystroke: the block may have moved since the menu opened
		placeSlashMenu();
	},
});

// ---------------------------------------------------------------- views

const pageElement = element('page');
const noteHead = new NoteHead(element('noteHead'), {
	model,
	name: () => (workspace.note ? stemOf(workspace.note.path) : ''),
	readOnly: () => viewMode === 'Read' || workspace.note === undefined,
	rename: async (name) => {
		const note = workspace.note;
		if (!note) return false;
		if (note.external && workspace.kind === 'Vault') {
			toast(t('This note isn’t in the vault. Save it into the vault first (Ctrl+S).'));
			return false;
		}
		return (await workspace.rename(note.path, name)) !== undefined;
	},
	onTitleDone: () => focusFirstBlock(),
	addProperty: () => addProperty(),
	pageLayout: () => pageLayoutOf(model()),
	setPageLayout: (layout) => setPageLayout(layout),
	moveHeaderProperty: () => moveHeaderProperty(),
});

const findBar = new FindBar(
	element('viewContent'),
	() => (viewMode === 'Source' ? sourceFindTarget : workspace.note ? noteFindTarget : undefined),
	(message) => toast(message),
);
const noteFindTarget = new NoteFindTarget(model, host, session);
const sourceFindTarget = new SourceFindTarget(
	() => sourceEditor,
	() => sourceEditor?.flush(),
);

// The graph view and the settings come in their own files, fetched right after the app starts
// (the first screen doesn't wait for them); `ready` waits, so they open at once afterwards.
let graphViewShown: GraphView | undefined;
const graphLoad = import('./graph-view').then(({ GraphView: View }) => {
	graphViewShown = new View(element('graphHost'), {
		vault: () => workspace.vault,
		currentPath: () => {
			const note = workspace.tab?.note;
			return note && !note.external ? note.path : undefined;
		},
		openNote: (path) => void workspace.openNote(path),
		searchTag: (tag) => openVaultSearch(`tag:${tag}`),
		tagColor: (tag) => {
			const color = tagColorMap(setting.get(tagColorSetting)).get(tag.toLowerCase())?.color;
			const css = color ? cssColorOf(color) : undefined;
			const variable = css && /^var\((--[\w-]+)\)$/.exec(css);
			return variable ? getComputedStyle(document.documentElement).getPropertyValue(variable[1]!).trim() || undefined : css;
		},
		tagMenu: (tag, x, y) => tagMenu(tag, x, y),
		close: () => void workspace.hideGraph(),
	});
	if (graphShown()) graphViewShown.show();
	return graphViewShown;
});
const graphView = {
	show: (): void => void graphLoad.then((view) => graphShown() && view.show()),
	hide: (): void => graphViewShown?.hide(),
	rebuild: (): void => graphViewShown?.rebuild(),
};
let openSettingModal: typeof OpenSettingModal | undefined;
const settingLoad = import('./setting-modal').then((module) => (openSettingModal = module.openSettingModal));

/**
 * Opens a note or a file of the vault. Here: in the tab in front. Background: a tab of its own,
 * behind the one in front (Ctrl+click, a middle-click). NewTab (a double-click): a tab of its own;
 * when the first click of it showed the file here, this tab goes back to what it showed before.
 */
async function openHow(path: string, how: OpenHow): Promise<void> {
	const open = (option: { newTab?: boolean; background?: boolean }): Promise<unknown> => (isNote(path) ? workspace.openNote(path, option) : Promise.resolve(workspace.openFile(path, option)));
	if (how === 'Here') {
		await open({});
		return;
	}
	if (how === 'Background') {
		await open({ newTab: true, background: true });
		return;
	}
	const tab = workspace.tab;
	const here = tab && ((tab.view === 'Note' && tab.note?.path === path) || (tab.view === 'File' && tab.file === path));
	// alone in a tab already (nothing to go back to): it is its own tab
	if (here && !workspace.canGoBack()) return;
	if (here) await workspace.goBack();
	await open({ newTab: true });
}

const sidebar = new Sidebar(element('sidebar'), {
	workspace,
	openNote: (path, how) => {
		void openHow(path, how);
		if (how !== 'Background' && window.matchMedia?.('(max-width: 640px)').matches) setSidebar(false);
	},
	openFile: (path, how) => {
		void openHow(path, how);
		if (how !== 'Background' && window.matchMedia?.('(max-width: 640px)').matches) setSidebar(false);
	},
	newNote: (folder) => void createNote(folder),
	notify: (message) => toast(message),
	tagMenu: (tag, x, y) => tagMenu(tag, x, y),
	openSearchResult: (path, query, matchCase, regex, how) => {
		if (how === 'Background') {
			void workspace.openNote(path, { newTab: true, background: true });
			return;
		}
		void workspace.openNote(path, { newTab: how === 'NewTab' }).then((opened) => {
			if (opened) findBar.open(false, query, { matchCase, regex });
		});
	},
	vaultMenu: (x, y) => void openVaultMenu(x, y),
	copyLink: (path) => void navigator.clipboard?.writeText(linkTextOf(path)).then(() => toast(t('Link copied.'))),
	canOpenFolder: canOpenFolder(),
	moveToFolder: () => void moveToFolder(),
	downloadAll: () => void downloadAll(),
	renderNoVault: (container) => renderNoVault(container),
});

/** The file pane while no vault is open: make or open one, a quick note, or a vault used before. */
function renderNoVault(container: HTMLElement): void {
	const noFolder = !canOpenFolder();
	const link = (action: string, svg: string, title: string, disabled = false): string =>
		`<button type="button" class="sidebar-empty-link" data-action="${action}"${disabled ? ' disabled' : ''}>${svg}<span>${escapeHtml(title)}</span></button>`;
	container.innerHTML =
		'<div class="sidebar-empty"><p class="sidebar-empty-title">No vault is open</p>' +
		link('CreateVault', icon.FolderPlus, 'Create new vault', noFolder) +
		link('OpenFolder', icon.FolderOpen, 'Open folder as vault', noFolder) +
		link('QuickNote', icon.FilePlus, 'Quick note') +
		'<div class="sidebar-empty-list"></div></div>';
	const run: Readonly<Record<string, () => void>> = {
		CreateVault: () => void createVault(),
		OpenFolder: () => void openFolder(),
		QuickNote: () => void createNote(),
	};
	for (const button of container.querySelectorAll<HTMLButtonElement>('[data-action]')) button.addEventListener('click', () => run[button.dataset.action!]?.());
	const holder = container.querySelector<HTMLElement>('.sidebar-empty-list')!;
	void vaultEntryList().then((list) => {
		if (list.length === 0) return;
		holder.innerHTML =
			'<p class="sidebar-empty-head">Recent</p>' +
			list.map((entry, index) => `<button type="button" class="sidebar-empty-link" data-index="${index}">${vaultIcon(entry.kind)}<span>${escapeHtml(entry.name)}</span></button>`).join('');
		for (const button of holder.querySelectorAll<HTMLButtonElement>('[data-index]')) button.addEventListener('click', () => void openRecent(list[Number(button.dataset.index)]!, true));
	});
}

/**
 * How a note links to a vault file: `[[Note]]`, or `![[Cell.png]]` for a picture, which then shows.
 * A file goes by its name alone when no other file has it, as in Obsidian.
 */
function linkTextOf(path: string): string {
	if (isNote(path)) return `[[${stemOf(path)}]]`;
	const name = baseName(path);
	const unique = workspace.vault?.findFile(name) === path;
	return `${mediaKindOf(path) === 'Image' ? '!' : ''}[[${unique ? name : path}]]`;
}

const tabBar = new TabBar(element('tabBar'), {
	workspace,
	newNote: () => void createNote(),
	closeTab: (id) => void workspace.closeTab(id),
	menu: (tab, x, y) => tabMenu(tab, x, y),
	onDragStart: () => void loadPane().then((pane) => pane.armDrop(paneHost)),
});

// ---------------------------------------------------------------- panes

// The screen splits into panes (pane.ts, loaded when it first does). The pane with the focus holds
// the app's own tab bar, header, and view; each pane keeps how it shows a note (Edit, Read, Source).
let paneModule: typeof import('./pane') | undefined;
const loadPane = async (): Promise<typeof import('./pane')> => (paneModule ??= await import('./pane'));
const paneHost: import('./pane').PaneHost = {
	workspace,
	registry,
	themeRegistry,
	root: document.querySelector<HTMLElement>('.workspace')!,
	tabBar: element('tabBar'),
	header: element('viewHeader'),
	content: element('viewContent'),
	mode: () => viewMode,
	setMode: (mode) => setView(mode as ViewMode),
	newNote: () => void createNote(),
	closeTab: (id) => void workspace.closeTab(id),
	tabMenu: (tab, x, y) => tabMenu(tab, x, y),
	syncScroll: () => setting.get('Editor.SyncScroll') !== false,
};
let focusedPane = workspace.paneId;
let paneShape = '';

/** After the panes changed: the focus moves the app's parts (and each pane's own view), and the layout is drawn again. */
function arrangePane(): void {
	if (workspace.paneId !== focusedPane) {
		const left = workspace.paneList.find((pane) => pane.id === focusedPane);
		if (left) left.mode = viewMode;
		// where the tab being left was scrolled to, before its view moves
		if (shownTab) shownTab.scroll = element('viewContent').scrollTop;
		focusedPane = workspace.paneId;
		const mode = (workspace.pane.mode as ViewMode | undefined) ?? viewMode;
		if (mode !== viewMode) setView(mode);
	}
	const shape = `${JSON.stringify(workspace.layout)} ${focusedPane}`;
	if (shape === paneShape) return;
	paneShape = shape;
	if (workspace.paneList.length < 2 && !paneModule) return;
	void loadPane().then((pane) => pane.layoutPane(paneHost));
}

/** A new pane beside the one with the focus, showing what it shows. */
function splitPane(side: 'Right' | 'Bottom'): void {
	session.close();
	sourceEditor?.flush();
	workspace.splitPane(side);
}

const statusBar = new StatusBar(element('status'), {
	registry,
	setting,
	workspace,
	selection: () => currentSelection(),
	cursor: () => (viewMode === 'Source' ? sourceCursor : undefined),
	save: () => void workspace.save(true),
});

const startScreen = new StartScreen(element('startScreen'), {
	canOpenFolder: canOpenFolder(),
	version: appVersion,
	createVault: () => void createVault(),
	openFolder: () => void openFolder(),
	quickNote: () => void createNote(),
	openFile: () => void openFile(),
	openSample: () => void openGuide(),
	openRecent: (entry) => void openRecent(entry, true),
	removeRecent: (entry) => forgetRecent(entry.id),
	recentList,
	hotkeyText,
});

function currentSelection(): string {
	if (viewMode === 'Source' && sourceEditor) {
		const { selectionStart, selectionEnd, value } = sourceEditor.textarea;
		return value.slice(selectionStart, selectionEnd);
	}
	const textarea = session.activeTextarea();
	if (textarea) return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
	const selection = document.getSelection();
	return selection && !selection.isCollapsed && noteElement.contains(selection.anchorNode) ? selection.toString() : '';
}

function focusFirstBlock(): void {
	const note = model();
	if (!note || viewMode !== 'Edit') return;
	// start writing in the first text block (a Property block at the top is skipped)
	let first = note.document.itemList.find((node) => node.type !== 'Property');
	if (!first) first = note.get(insertTemplate(note, null, note.document.itemList.at(-1)?.key ?? null, '')[0]!);
	if (first) editFirst([first.key]);
}

function graphShown(): boolean {
	return workspace.tab?.view === 'Graph';
}

/** Shows what is open: the start screen, an empty vault, a note, a file, or the graph. */
function updateLayout(): void {
	const kind = workspace.kind;
	const note = workspace.note;
	const graphOpen = graphShown();
	const file = workspace.file;
	document.body.classList.toggle('in-vault', kind === 'Vault');
	document.body.classList.toggle('no-vault', kind !== 'Vault');
	const start = kind === 'None' && workspace.tabList.length === 0;
	element('startScreen').hidden = !start;
	// the start screen is a page of its own: no Back, Forward, or view buttons over it
	element('viewHeader').hidden = start;
	element('emptyView').hidden = !(kind === 'Vault' && !note && !graphOpen && !file && workspace.tab?.view !== 'Panel');
	pageElement.hidden = !note || graphOpen || workspace.tab?.view === 'Panel';
	element('graphHost').hidden = !graphOpen;
	element('fileView').hidden = file === undefined;
	element('panelHost').hidden = workspace.tab?.view !== 'Panel';
	// a plugin's page has its own buttons: no Source, Edit, and Read over it
	element('viewHeader').classList.toggle('no-mode', graphOpen || file !== undefined || workspace.tab?.view === 'Panel');
	element('tabBar').hidden = kind === 'None';
	// with no vault the sidebar offers vaults to open (shut unless you open it)
	const showSidebar = sidebar.isOpen();
	element('sidebar').hidden = !showSidebar;
	document.body.classList.toggle('sidebar-open', showSidebar);
	element('sidebar').style.width = `${sidebar.width()}px`;
	element('ribbonSidebar').classList.toggle('active', showSidebar);
	element('ribbonGraph').classList.toggle('active', graphOpen);
	element('viewHeader').classList.toggle('empty', !note && !graphOpen && !file && workspace.tab?.view !== 'Panel');
	updateHeader();
	if (kind === 'Vault' && !note && !graphOpen && !file && workspace.tab?.view !== 'Panel') renderEmptyView();
}

function renderEmptyView(): void {
	const key = (command: string): string => (hotkeyText(command) ? `<kbd>${escapeHtml(hotkeyText(command))}</kbd>` : '');
	element('emptyView').innerHTML =
		'<div class="empty-state"><div class="empty-title">No note is open</div>' +
		`<button type="button" class="empty-link" data-command="Note.Create">Create a new note ${key('Note.Create')}</button>` +
		`<button type="button" class="empty-link" data-command="Note.Switch">Go to a note ${key('Note.Switch')}</button>` +
		`<button type="button" class="empty-link" data-command="Graph.Open">Open graph view ${key('Graph.Open')}</button>` +
		`<button type="button" class="empty-link" data-command="Vault.Close">${workspace.source?.kind === 'Guide' ? 'Close the guide' : 'Close this vault'}</button></div>`;
	for (const button of element('emptyView').querySelectorAll<HTMLButtonElement>('[data-command]')) button.addEventListener('click', () => commandRegistry.run(button.dataset.command!));
}

function updateHeader(): void {
	const note = workspace.note;
	const title = element('viewTitle');
	const file = workspace.file;
	if (graphShown()) {
		title.innerHTML = '<span class="view-crumb-name">Graph view</span>';
	} else if (file) {
		const folder = parentPath(file);
		title.innerHTML = `${folder ? `<span class="view-crumb">${escapeHtml(folder.split('/').join(' / '))} / </span>` : ''}<span class="view-crumb-name">${escapeHtml(baseName(file))}</span>`;
	} else if (note) {
		const folder = !note.external && workspace.kind === 'Vault' ? parentPath(note.path) : '';
		const badge = note.external && workspace.kind === 'Vault' ? `<span class="view-badge" title="${escapeHtml(t('Not saved in this vault'))}">${escapeHtml(t('outside vault'))}</span>` : workspace.source?.kind === 'Guide' ? `<span class="view-badge" title="${escapeHtml(t('The guide lives in memory: changes stay until you close it'))}">${escapeHtml(t('guide'))}</span>` : '';
		title.innerHTML = `${folder ? `<span class="view-crumb">${escapeHtml(folder.split('/').join(' / '))} / </span>` : ''}<span class="view-crumb-name">${escapeHtml(stemOf(note.path))}</span>${badge}`;
	} else title.textContent = '';
	const panelTitle = workspace.tab?.view === 'Panel' ? workspace.tab.panel?.title || t('New tab') : undefined;
	if (panelTitle !== undefined) title.innerHTML = `<span class="view-crumb-name">${escapeHtml(panelTitle)}</span>`;
	const name = panelTitle ?? (graphShown() ? t('Graph view') : file ? baseName(file) : note ? stemOf(note.path) : '');
	document.title = name ? `${name}${workspace.source ? ` - ${workspace.source.name}` : ''} - Octaether Ink` : workspace.source ? `${workspace.source.name} - Octaether Ink` : 'Octaether Ink';
	for (const button of document.querySelectorAll<HTMLButtonElement>('.view-mode [data-mode]')) {
		const active = button.dataset.mode === viewMode;
		button.classList.toggle('active', active);
		button.setAttribute('aria-checked', String(active));
	}
	(element('viewBack') as HTMLButtonElement).disabled = !workspace.canGoBack();
	(element('viewForward') as HTMLButtonElement).disabled = !workspace.canGoForward();
	document.body.dataset.view = viewMode;
}

/** Shows the tab in front: its note (mounted, with its own scroll position), or the graph. */
function showTab(): void {
	const tab = workspace.tab;
	const note = workspace.note;
	// the tab being left keeps where it was scrolled to; a tab that moved on to another note starts that one at its own place
	if (shownTab && shownModel && shownTab.note?.model === shownModel) shownTab.scroll = element('viewContent').scrollTop;
	if (tab === shownTab && note?.model === shownModel && note) {
		updateLayout();
		return;
	}
	session.close();
	session.select(undefined);
	findBar.close();
	gutterControl.hide();
	hoverControl.hide();
	unsubscribeNote?.();
	unsubscribeNote = undefined;
	shownTab = tab;
	shownModel = note?.model;
	if (note && !note.external && tab?.view === 'Note') lastNote = note;
	showPanel(tab?.view === 'Panel' ? tab : undefined);
	if (tab?.view === 'Panel') {
		host.unmount();
		sourceEditor?.destroy();
		sourceEditor = undefined;
		graphView.hide();
		renderFileView();
		updateLayout();
		statusBar.schedule();
		return;
	}
	if (graphShown()) {
		host.unmount();
		sourceEditor?.destroy();
		sourceEditor = undefined;
		renderFileView();
		updateLayout();
		graphView.show();
		statusBar.schedule();
		return;
	}
	graphView.hide();
	renderFileView();
	if (workspace.file) {
		host.unmount();
		sourceEditor?.destroy();
		sourceEditor = undefined;
		updateLayout();
		statusBar.schedule();
		return;
	}
	if (!note) {
		host.unmount();
		sourceEditor?.destroy();
		sourceEditor = undefined;
		updateLayout();
		statusBar.schedule();
		return;
	}
	host.mount(note.model);
	unsubscribeNote = note.model.subscribe((change) => {
		statusBar.schedule();
		// a Property block added or removed changes what the note's top offers
		if (change.notePropertyChanged || change.structure) noteHead.refresh();
		else noteHead.noteChanged();
		if (change.notePropertyChanged || change.structure) applyPageLayout();
		if (viewMode === 'Source' && sourceEditor && !applyingSource) sourceEditor.setText(note.model.serialize());
		if (findBar.isOpen()) scheduleFindRefresh();
	});
	// show the page first: the title and the Source view measure their text
	applyPageLayout();
	updateLayout();
	noteHead.refresh();
	if (viewMode === 'Source') openSourceEditor();
	element('viewContent').scrollTop = tab?.scroll ?? 0;
	statusBar.schedule();
}

// ---------------------------------------------------------------- a file of the vault on its own

let fileViewPath: string | undefined;
/** The table a data file shows in the File view. */
let dataHost: RenderHost | undefined;

/** Shows the picture, video, or sound in front, as Obsidian does; a click on a picture shows it at its real size. */
function renderFileView(): void {
	const view = element('fileView');
	const path = workspace.file;
	if (path === fileViewPath) return;
	fileViewPath = path;
	dataHost?.destroy();
	dataHost = undefined;
	if (path === undefined) {
		view.replaceChildren();
		return;
	}
	// a .csv, .tsv, or .xlsx: a table over the whole page, edited in place
	if (isDataFile(path)) {
		view.innerHTML = '<div class="file-view-data"><div class="file-view-data-note"></div></div>';
		dataHost = new RenderHost(view.querySelector<HTMLElement>('.file-view-data-note')!, registry, themeRegistry);
		dataHost.mount(NoteModel.fromText(`Table {File: "${path.replace(/"/g, '')}"}:\n`, registry.formatOption()));
		return;
	}
	const kind = mediaKindOf(path);
	view.innerHTML =
		`<div class="file-view-stage"><div class="file-view-message">${t('Loading…')}</div></div>` +
		`<div class="file-view-meta"><span class="file-view-name">${escapeHtml(baseName(path))}</span><span class="file-view-size"></span></div>`;
	const stage = view.querySelector<HTMLElement>('.file-view-stage')!;
	const size = view.querySelector<HTMLElement>('.file-view-size')!;
	void assetUrl(path).then((url) => {
		if (fileViewPath !== path) return;
		if (!url || !kind) {
			stage.innerHTML = `<div class="file-view-message">Couldn’t read “${escapeHtml(baseName(path))}”.</div>`;
			return;
		}
		let media: HTMLImageElement | HTMLMediaElement;
		if (kind === 'Image') {
			const image = document.createElement('img');
			image.alt = baseName(path);
			image.title = t('Click for the real size');
			image.addEventListener('load', () => {
				if (image.naturalWidth > 0) size.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
			});
			image.addEventListener('click', () => stage.classList.toggle('actual'));
			media = image;
		} else {
			media = document.createElement(kind === 'Video' ? 'video' : 'audio');
			media.controls = true;
			media.preload = 'metadata';
			if (media instanceof HTMLVideoElement) {
				media.playsInline = true;
				media.addEventListener('loadedmetadata', () => {
					if (media instanceof HTMLVideoElement && media.videoWidth > 0) size.textContent = `${media.videoWidth} × ${media.videoHeight}`;
				});
			}
			media.addEventListener('error', () => {
				if (fileViewPath === path) stage.innerHTML = `<div class="file-view-message">This browser can’t play “${escapeHtml(baseName(path))}”.</div>`;
			});
		}
		media.className = `file-view-media file-view-${kind.toLowerCase()}`;
		media.src = url;
		stage.replaceChildren(media);
	});
}

let findTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleFindRefresh(): void {
	clearTimeout(findTimer);
	findTimer = setTimeout(() => findBar.refresh(), 250);
}

function openSourceEditor(): void {
	const note = model();
	if (!note) return;
	if (!sourceEditor) {
		sourceEditor = new SourceEditor(element('sourceHost'), {
			onChange: (text) => {
				const current = model();
				if (!current) return;
				applyingSource = true;
				try {
					current.setText(text, { coalesceKey: 'Source' });
				} finally {
					applyingSource = false;
				}
			},
			onCursor: (line, column) => {
				sourceCursor = { line, column };
				statusBar.schedule();
			},
			isRawType: (type) => registry.formatOption().contentKind?.(type) === 'Raw',
			takesArgument: (type) => registry.formatOption().argumentKey?.(type) !== undefined,
			aliasList: () => registry.aliasState().aliasList,
		});
	}
	sourceEditor.setText(note.serialize());
}

/** Switches between Source (the whole note as text), Edit, and Read. */
function setView(mode: ViewMode): void {
	if (mode === viewMode && (mode !== 'Source' || sourceEditor || !workspace.note)) {
		updateHeader();
		return;
	}
	const previous = viewMode;
	session.close();
	session.select(undefined);
	if (previous === 'Source' && sourceEditor) {
		sourceEditor.flush();
		sourceEditor.destroy();
		sourceEditor = undefined;
		sourceCursor = undefined;
	}
	viewMode = mode;
	workspace.pane.mode = mode;
	host.setReadOnly(mode === 'Read');
	gutterControl.hide();
	hoverControl.hide();
	element('sourceHost').hidden = mode !== 'Source';
	noteElement.hidden = mode === 'Source';
	if (mode === 'Source') {
		openSourceEditor();
		sourceEditor?.focus();
	}
	noteHead.refresh();
	updateHeader();
	findBar.refresh();
	statusBar.schedule();
}

function toggleGraph(): void {
	if (graphShown()) {
		void workspace.hideGraph();
		return;
	}
	if (workspace.kind !== 'Vault') {
		toast(t('The graph shows the notes of a vault. Open a folder as a vault, your quick notes, or the welcome guide.'));
		return;
	}
	workspace.showGraph();
}

function setSidebar(open: boolean): void {
	sidebar.setOpen(open);
	updateLayout();
}

function openVaultSearch(query?: string): void {
	if (workspace.kind !== 'Vault') {
		findBar.open(false, query);
		return;
	}
	setSidebar(true);
	sidebar.focusSearch(query);
}

workspace.subscribe((event) => {
	if (event === 'Tab') arrangePane();
	if (event === 'Vault') {
		// its settings are attached already (prepareVault)
		sidebar.attach();
		updateLayout();
	} else if (event === 'Note') {
		showTab();
		// the file tree opens the folders above the note (or file), as VS Code's explorer does
		const note = workspace.note;
		const shown = workspace.file ?? (note && !note.external ? note.path : undefined);
		if (shown) sidebar.reveal(shown);
		else sidebar.render();
		graphView.rebuild();
	} else if (event === 'Tab') {
		tabBar.render();
		updateLayout();
	} else if (event === 'Tree') {
		sidebar.render();
		sidebar.refreshSearch();
		graphView.rebuild();
	} else if (event === 'Rename') {
		noteHead.refresh();
		sidebar.render();
		tabBar.render();
		updateHeader();
	} else if (event === 'Save') {
		tabBar.render();
	}
	if (paneModule) paneModule.refreshPane(paneHost);
	statusBar.schedule();
});

// ---------------------------------------------------------------- vaults and files

/** Opens a vault with the tabs it had; what was open stays on screen until it is ready. */
async function openVaultWith(fs: FileSystem, entry: RecentEntry): Promise<boolean> {
	try {
		// false: an open note has changes that can't be saved and you kept it
		if (!(await workspace.openVault(fs, { kind: entry.kind === 'Browser' ? 'Browser' : 'Folder', id: entry.id, name: entry.name, ...(entry.handle ? { handle: entry.handle as FileSystemDirectoryHandle } : {}) }, { restore: true }))) return false;
	} catch {
		toast(tr`Couldn’t open “${entry.name}”. It may have been moved or deleted.`);
		await forgetRecent(entry.id);
		if (workspace.kind === 'None') void startScreen.render(`Couldn’t find “${entry.name}”.`);
		return false;
	}
	await rememberRecent({ ...entry, time: Date.now() });
	return true;
}

const folderMessage = 'This browser can’t open folders on your computer. Use Chrome or Edge, or the desktop app. Quick notes work here.';

/** A folder handle as a vault, under the ID it had before when it was opened already. */
async function openFolderHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
	let id = createId();
	for (const entry of await recentList()) {
		if (entry.kind !== 'Folder' || !entry.handle || entry.name !== handle.name) continue;
		if (await (entry.handle as FileSystemHandle & { isSameEntry?(other: FileSystemHandle): Promise<boolean> }).isSameEntry?.(handle)) id = entry.id;
	}
	return openVaultWith(new DirectoryFileSystem(handle), { id, kind: 'Folder', name: handle.name, handle, time: Date.now() });
}

async function openFolder(): Promise<void> {
	if (!window.showDirectoryPicker) {
		toast(folderMessage);
		return;
	}
	let handle: FileSystemDirectoryHandle;
	try {
		handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'oi-vault' });
	} catch {
		return;
	}
	await openFolderHandle(handle);
}

/**
 * A new vault, as in Obsidian: a name and a place, and the app makes the folder there (the place
 * is remembered for next time). An empty folder of that name is used as it is.
 */
async function createVault(): Promise<void> {
	if (!window.showDirectoryPicker) {
		toast(t(folderMessage));
		return;
	}
	const handle = await newVaultFolder({
		title: t('Create new vault'),
		text: t('A vault is a folder of notes on your computer. The app makes the folder; any other app can open its notes too. Put it in iCloud Drive, OneDrive, or Dropbox and it follows you to your other devices.'),
		name: t('My vault'),
		action: t('Create'),
	});
	// a new vault starts with a note to write in (nothing is kept if it stays blank)
	if (handle && (await openFolderHandle(handle))) await createNote();
}

/** Asks for a name and a place, and makes that folder (empty, or new): for a new vault, and for one imported from a .zip. */
async function newVaultFolder(option: { title: string; text: string; name: string; action: string }): Promise<FileSystemDirectoryHandle | undefined> {
	let parent = await idbGet<FileSystemDirectoryHandle>('State', 'VaultParent');
	return new Promise<FileSystemDirectoryHandle | undefined>((resolve) => {
		let made: FileSystemDirectoryHandle | undefined;
		openModal(
			'dialog-modal vault-modal',
			(modal, close) => {
				modal.innerHTML =
					`<h2>${escapeHtml(option.title)}</h2>` +
					`<p class="dialog-text">${escapeHtml(option.text)}</p>` +
					`<label class="dialog-label">${escapeHtml(t('Name'))}<input class="dialog-input" value="${escapeHtml(option.name)}" spellcheck="false"></label>` +
					`<div class="dialog-label">${escapeHtml(t('Location'))}<div class="vault-location"><span class="vault-location-name"></span><button type="button" class="dialog-button" data-action="Choose">${escapeHtml(t('Choose'))}</button></div></div>` +
					'<p class="dialog-problem" role="alert" hidden></p>' +
					`<div class="dialog-row"><button type="button" class="dialog-button" data-answer="No">${escapeHtml(t('Cancel'))}</button><button type="button" class="dialog-button primary" data-answer="Yes">${escapeHtml(option.action)}</button></div>`;
				const input = modal.querySelector<HTMLInputElement>('.dialog-input')!;
				const location = modal.querySelector<HTMLElement>('.vault-location-name')!;
				const problem = modal.querySelector<HTMLElement>('.dialog-problem')!;
				const say = (text?: string): void => {
					problem.hidden = text === undefined;
					problem.textContent = text ?? '';
				};
				const showLocation = (): void => {
					location.textContent = parent ? parent.name : 'No folder chosen yet';
					location.classList.toggle('empty', !parent);
				};
				const choose = async (): Promise<boolean> => {
					const pick = (startIn: FileSystemHandle | 'documents'): Promise<FileSystemDirectoryHandle> => window.showDirectoryPicker!({ id: 'oi-vault-parent', mode: 'readwrite', startIn });
					try {
						parent = await pick(parent ?? 'documents').catch((error: unknown) => {
							// the place picked last time may be gone: start in Documents instead (but a cancel is a cancel)
							if (error instanceof DOMException && error.name === 'AbortError') throw error;
							return pick('documents');
						});
					} catch {
						return false;
					}
					void idbSet('State', 'VaultParent', parent);
					showLocation();
					say();
					return true;
				};
				const create = async (): Promise<void> => {
					const name = input.value.trim();
					const issue = nameProblem(name);
					if (issue) {
						say(issue);
						input.focus();
						return;
					}
					if (!parent && !(await choose())) return;
					const place = parent!;
					if (!(await ensurePermission(place, true))) {
						say(tr`The browser didn’t allow writing in “${place.name}”. Choose another place.`);
						return;
					}
					let existing: FileSystemDirectoryHandle | undefined;
					try {
						existing = await place.getDirectoryHandle(name);
					} catch {
						existing = undefined;
					}
					if (existing && !(await existing.keys().next()).done) {
						say(tr`“${place.name}” has a folder “${name}” with files in it already. Pick another name, or open it with Open folder as vault.`);
						return;
					}
					try {
						made = existing ?? (await place.getDirectoryHandle(name, { create: true }));
					} catch {
						say(tr`Couldn’t make the folder “${name}” in “${place.name}”.`);
						return;
					}
					close();
				};
				showLocation();
				modal.querySelector('[data-action="Choose"]')!.addEventListener('click', () => void choose());
				modal.querySelector('[data-answer="Yes"]')!.addEventListener('click', () => void create());
				modal.querySelector('[data-answer="No"]')!.addEventListener('click', close);
				input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') void create();
				});
				input.focus();
				input.select();
			},
			() => resolve(made),
		);
	});
}

// The quick notes: a few notes kept in this browser, for when no vault is needed (yet). Every
// browser has them, Safari, Firefox, and phones too; the sidebar warns that they live only here,
// and moves them into a folder or downloads them.
const quickNote = { id: 'quick', name: 'Quick note' } as const;

async function openQuickNote(): Promise<boolean> {
	if (workspace.source?.id === quickNote.id) return true;
	return openVaultWith(new BrowserFileSystem(quickNote.id, quickNote.name), { id: quickNote.id, kind: 'Browser', name: quickNote.name, time: Date.now() });
}

/** The files of the notes kept in the browser (not the app's .oi folder), with their bytes. */
async function browserFileList(vault: Vault): Promise<{ path: string; data: Blob }[]> {
	const list: { path: string; data: Blob }[] = [];
	for (const entry of vault.visibleEntryList()) if (entry.kind === 'File') list.push({ path: entry.path, data: await vault.readBinary(entry.path) });
	return list;
}

/**
 * Moves the notes kept in the browser into a folder (a vault or a new one), then opens it: the
 * copies are written first, and only then removed from the browser. A name taken there gets a
 * free one.
 */
async function moveToFolder(): Promise<void> {
	const vault = workspace.vault;
	if (!vault || workspace.source?.kind !== 'Browser') return;
	if (!window.showDirectoryPicker) {
		toast(folderMessage);
		return;
	}
	let handle: FileSystemDirectoryHandle;
	try {
		handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'oi-vault' });
	} catch {
		return;
	}
	await workspace.saveAll();
	const fileList = await browserFileList(vault);
	if (fileList.length === 0) {
		await openFolderHandle(handle);
		return;
	}
	try {
		const target = new Vault(new DirectoryFileSystem(handle));
		await target.load();
		for (const file of fileList) {
			const extension = extensionOf(file.path);
			const stem = extension ? baseName(file.path).slice(0, -extension.length - 1) : baseName(file.path);
			const path = target.isTaken(file.path) ? target.uniquePath(parentPath(file.path), stem, extension) : file.path;
			await target.fs.writeBinary(path, file.data);
		}
	} catch {
		toast(tr`Couldn’t write the notes into “${handle.name}”. They are still kept in this browser.`);
		return;
	}
	const noteCount = fileList.filter((file) => isNote(file.path)).length;
	if (!(await openFolderHandle(handle))) return;
	// all written: the browser's copies go
	for (const entry of vault.childList('')) await vault.deleteForever(entry.path);
	toast(noteCount === 1 ? tr`Moved 1 note into “${handle.name}”. It is no longer kept in the browser.` : tr`Moved ${noteCount} notes into “${handle.name}”. They are no longer kept in the browser.`, 6000);
}

/** Downloads the notes kept in the browser (and their pictures) as one .zip, folders kept. */
async function downloadAll(): Promise<void> {
	const vault = workspace.vault;
	if (!vault) return;
	await workspace.saveAll();
	const entryList: ZipEntry[] = [];
	for (const file of await browserFileList(vault)) entryList.push({ path: file.path, data: new Uint8Array(await file.data.arrayBuffer()) });
	if (entryList.length === 0) {
		toast(t('There is nothing to download yet.'));
		return;
	}
	// today's date where you are: "Quick note 2026-10-04.zip"
	downloadBlob(`${workspace.source?.name ?? 'Notes'} ${nowText().slice(0, 10)}.zip`, makeZip(entryList));
}

async function openFile(): Promise<void> {
	if (window.showOpenFilePicker) {
		try {
			const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Octaether Ink note, or a vault’s .zip', accept: { 'text/plain': ['.oi', '.md', '.txt'], 'application/zip': ['.zip'] } }] });
			if (!handle) return;
			const file = await handle.getFile();
			if (/\.zip$/i.test(file.name)) {
				void importVault(file, file.name);
				return;
			}
			await workspace.openText(await file.text(), file.name, { handle });
			await rememberRecent({ id: createId(), kind: 'File', name: file.name, handle, time: Date.now() });
		} catch {
			// cancelled
		}
		return;
	}
	element<HTMLInputElement>('fileInput').click();
}

element<HTMLInputElement>('fileInput').addEventListener('change', async (event) => {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (file && /\.zip$/i.test(file.name)) void importVault(file, file.name);
	else if (file) await workspace.openText(await file.text(), file.name, { keepVault: false });
	input.value = '';
});

async function openRecent(entry: RecentEntry, ask: boolean): Promise<boolean> {
	if (entry.kind === 'Browser') return openVaultWith(new BrowserFileSystem(entry.id, entry.name), entry);
	if (!entry.handle) return false;
	if (!(await ensurePermission(entry.handle, ask))) {
		if (ask) toast(tr`The browser didn’t allow access to “${entry.name}”.`);
		return false;
	}
	if (entry.kind === 'Folder') return openVaultWith(new DirectoryFileSystem(entry.handle as FileSystemDirectoryHandle), entry);
	try {
		const file = await (entry.handle as FileSystemFileHandle).getFile();
		await workspace.openText(await file.text(), file.name, { handle: entry.handle as FileSystemFileHandle });
		await rememberRecent({ ...entry, time: Date.now() });
		return true;
	} catch {
		toast(tr`Couldn’t find “${entry.name}”.`);
		await forgetRecent(entry.id);
		return false;
	}
}

async function closeVault(): Promise<void> {
	if (!(await workspace.closeAll())) return;
	forgetAsset();
	await clearLast();
	void startScreen.render();
	updateLayout();
}

// ---------------------------------------------------------------- plugin pages in tabs, the vault's files, the commands (for plugins: the AI)

/** The page element of each open panel tab: it stays while its tab is open, so a chat keeps streaming behind another tab. */
const panelPageMap = new Map<string, { element: HTMLElement; id: string; state: string; handle?: { destroy(): void; shown?(): void } }>();

/** Shows the page of a panel tab (making it the first time), hides the others, and lets go of pages whose tab closed. */
function showPanel(tab: import('./workspace').Tab | undefined): void {
	const panelHost = element('panelHost');
	for (const [tabId, page] of panelPageMap) {
		const open = workspace.tabList.find((item) => item.id === tabId);
		if (!open || open.view !== 'Panel' || open.panel?.id !== page.id) {
			page.handle?.destroy();
			page.element.remove();
			panelPageMap.delete(tabId);
		} else page.element.hidden = open !== tab;
	}
	if (!tab?.panel) return;
	let page = panelPageMap.get(tab.id);
	if (!page) {
		const pageElement = document.createElement('div');
		pageElement.className = 'panel-page';
		panelHost.append(pageElement);
		page = { element: pageElement, id: tab.panel.id, state: tab.panel.state };
		panelPageMap.set(tab.id, page);
		const definition = panelDefinitionMap.get(tab.panel.id);
		if (!definition) {
			pageElement.innerHTML = `<p class="panel-missing">${escapeHtml(t('This page belongs to a plugin that is off.'))}</p>`;
			return;
		}
		const tabId = tab.id;
		const current = page;
		page.handle = definition.mount(pageElement, tab.panel.state, {
			setState: (state) => {
				current.state = state;
				workspace.updatePanel(tabId, { state });
			},
			setTitle: (title) => {
				workspace.updatePanel(tabId, { title });
				if (workspace.activeTabId === tabId) updateHeader();
			},
			isShown: () => workspace.activeTabId === tabId && workspace.tab?.view === 'Panel',
		});
	}
	page.element.hidden = false;
	page.handle?.shown?.();
}



registry.registerExtension(commandExtension, {
	list: () =>
		commandRegistry
			.list()
			.filter((command) => command.when === undefined && !command.id.startsWith('Macro.'))
			.map((command) => ({ id: command.id, title: command.title, ...(command.explain ? { explain: command.explain } : {}) })),
	run: (id, argument) => commandRegistry.run(id, argument),
} satisfies CommandAccess);

/** A picture of a note as the app draws it, made off screen so nothing on screen moves. */
async function notePicture(path: string): Promise<Blob | undefined> {
	const vault = workspace.vault;
	if (!vault?.has(path) || !isNote(path)) return undefined;
	const text = workspace.openNoteList().find((note) => note.path === path)?.model.serialize() ?? (await vault.read(path));
	const stage = document.createElement('div');
	stage.setAttribute('style', 'position:fixed;left:-20000px;top:0;width:760px;background:var(--oi-color-background)');
	stage.setAttribute('aria-hidden', 'true');
	const root = document.createElement('div');
	stage.append(root);
	document.body.append(stage);
	const pictureHost = new RenderHost(root, registry, themeRegistry);
	try {
		pictureHost.setReadOnly(true);
		pictureHost.mount(NoteModel.fromText(text, registry.formatOption()));
		// modules that load on first use (plots, tables) draw a moment later
		for (let round = 0; round < 6; round++) await new Promise((done) => setTimeout(done, 80));
		const { elementPicture } = await import('./export-image');
		return await elementPicture(root, { background: themeRegistry.current().token['Color.Background'] ?? '#ffffff', padding: 24, scale: 1 });
	} catch {
		return undefined;
	} finally {
		pictureHost.destroy();
		stage.remove();
	}
}

/** A change of the vault the plugin made, and its way back. */
const change = (path: string, undo: () => Promise<void>): VaultChange => ({ path, undo });

registry.registerExtension(vaultFileExtension, {
	name: () => (workspace.kind === 'Vault' ? workspace.source?.name : undefined),
	list(folder = '') {
		const vault = workspace.vault;
		if (!vault || workspace.kind !== 'Vault') return [];
		const hidden = folder === '.oi' || folder.startsWith('.oi/');
		const list = hidden ? vault.allEntryList() : vault.visibleEntryList();
		return list.filter((entry) => folder === '' || entry.path.startsWith(`${folder}/`)).map((entry) => ({ path: entry.path, kind: entry.kind }));
	},
	has: (path) => workspace.kind === 'Vault' && (workspace.vault?.has(path) ?? false),
	async read(path) {
		const vault = workspace.vault;
		if (!vault || workspace.kind !== 'Vault' || vault.kindOf(path) !== 'File') return undefined;
		const open = workspace.openNoteList().find((note) => !note.external && note.path === path);
		if (open) return open.model.serialize();
		if (!/\.(?:oi|md|txt|csv|tsv|json|svg|html|css|js|ts|py|tex|bib|yaml|yml|xml)$/i.test(path)) return undefined;
		return vault.read(path);
	},
	async write(path, text) {
		const vault = workspace.vault;
		if (!vault || workspace.kind !== 'Vault') throw new Error(t('No vault is open'));
		const open = workspace.openNoteList().find((note) => !note.external && note.path === path);
		if (open) {
			// a note that is open changes in its tab: one undo step there, saved as typing is
			const before = open.model.serialize();
			open.model.setText(text);
			await workspace.save(false, open);
			return change(path, async () => {
				const now = workspace.openNoteList().find((note) => note.path === path);
				if (now) {
					now.model.setText(before);
					await workspace.save(false, now);
				} else await vault.write(path, before);
			});
		}
		const existed = vault.kindOf(path) === 'File';
		const before = existed ? await vault.read(path) : undefined;
		await vault.write(path, text);
		return change(path, async () => {
			if (before !== undefined) await vault.write(path, before);
			else await workspace.trashQuietly(path);
		});
	},
	async makeFolder(path) {
		const vault = workspace.vault;
		if (!vault || workspace.kind !== 'Vault') throw new Error(t('No vault is open'));
		const made = await vault.createFolder(parentPath(path), baseName(path));
		return change(made, async () => void (await workspace.trashQuietly(made)));
	},
	async move(path, target) {
		const moved = await workspace.relocate(path, target);
		return change(moved, async () => void (await workspace.relocate(moved, path)));
	},
	async remove(path) {
		// only the app's own files: a note never goes without the trash
		if (!path.startsWith('.oi/') || path.startsWith('.oi/Trash')) throw new Error(tr`Couldn’t delete “${path}”.`);
		await workspace.vault?.deleteForever(path);
	},
	async trash(path) {
		const undo = await workspace.trashQuietly(path);
		if (!undo) throw new Error(tr`Couldn’t delete “${path}”.`);
		return change(path, undo);
	},
	search(query, limit = 20) {
		const vault = workspace.vault;
		if (!vault || workspace.kind !== 'Vault') return [];
		return vault
			.search(query)
			.slice(0, limit)
			.map((result) => ({ path: result.path, line: result.matchList[0]?.text ?? '' }));
	},
	open(path, option = {}) {
		if (isNote(path)) void workspace.openNote(path, { newTab: option.background === true, background: option.background });
		else workspace.openFile(path, { newTab: option.background === true, background: option.background });
	},
	picture: notePicture,
	// with a plugin's page in front (the chat), the note you were last looking at, as VS Code's chat does
	currentPath: () => (workspace.note && !workspace.note.external ? workspace.note.path : lastNote && !lastNote.external && workspace.vault?.has(lastNote.path) ? lastNote.path : undefined),
} satisfies VaultFile);

// ---------------------------------------------------------------- export and import (transfer.ts, loaded when first used)

const transferApp = (): import('./transfer').TransferApp => ({
	workspace,
	session,
	host,
	noteElement,
	themeRegistry,
	registry,
	viewMode: () => viewMode,
	setView,
	graphShown,
	newVaultFolder,
	openFolderHandle,
	openQuickNote,
	quickNote,
});
const transfer = (): Promise<typeof import('./transfer')> => import('./transfer');
const exportPicture = async (key?: string): Promise<void> => (await transfer()).exportPicture(transferApp(), key);
const exportMarkdown = async (): Promise<void> => (await transfer()).exportMarkdown(transferApp());
const exportVault = async (): Promise<void> => (await transfer()).exportVault(transferApp());
const chooseVaultZip = (): void => void transfer().then((module) => module.chooseVaultZip(transferApp()));
const importVault = async (file: Blob, name: string): Promise<void> => (await transfer()).importVault(transferApp(), file, name);

// The welcome guide: a small vault in memory, one note per module plus an overview, all linked,
// so links, tabs, and the graph work in it (with a picture for the Image guide). Changes stay
// until it is closed. Its files load the first time it opens (the page prefetches them).
// A language has its own notes in sample/Guide/<id>/, under the same names; one it lacks is the English one.
const guideLoaderMap = import.meta.glob(['../../../sample/Guide/*.{oi,svg,csv}', '../../../sample/Guide/*/*.oi'], { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
let guideFileMap: Record<string, string> | undefined;

async function guideFile(): Promise<Record<string, string>> {
	if (guideFileMap) return guideFileMap;
	const own = `/Guide/${currentLanguage().id}/`;
	const pick = (folder: (path: string) => boolean): Promise<(readonly [string, string])[]> =>
		Promise.all(
			Object.entries(guideLoaderMap)
				.filter(([path]) => folder(path))
				.map(async ([path, load]) => [path.split('/').pop()!, await load()] as const),
		);
	guideFileMap = Object.fromEntries([...(await pick((path) => /\/Guide\/[^/]+$/.test(path))), ...(await pick((path) => path.includes(own)))]);
	return guideFileMap;
}

async function openGuide(): Promise<void> {
	if (workspace.source?.kind === 'Guide') {
		await workspace.openNote('Welcome.oi');
		return;
	}
	if (!(await workspace.openVault(new MemoryFileSystem(t('Welcome guide'), await guideFile()), { kind: 'Guide', id: 'guide', name: t('Welcome guide') }))) return;
	await workspace.openNote('Welcome.oi');
}

// ---------------------------------------------------------------- pictures and videos pasted or dropped on a note

function isMediaFile(file: File): boolean {
	return /^(?:image|video)\//.test(file.type || mediaTypeOf(file.name));
}

/** Saves pictures and videos in the vault, and shows each in a block after `targetKey` (or where you are). */
async function addMediaFile(fileList: readonly File[], targetKey?: string): Promise<void> {
	const note = workspace.note;
	const vault = workspace.vault;
	if (!note) return;
	if (!vault || note.external) {
		toast(t('Open a vault first: a pasted picture is saved as a file next to your notes.'));
		return;
	}
	const folderSetting = String(setting.get('File.AttachmentFolder') ?? '').trim();
	const folder = folderSetting === '' ? parentPath(note.path) : joinPath(folderSetting);
	const target = targetKey ?? session.editingKey() ?? session.selected();
	const place = target && note.model.get(target) ? note.model.placeOf(target) : undefined;
	const previous = place && place.index > 0 ? place.list[place.index - 1]!.key : null;
	// closing the editor may drop the empty paragraph you were in
	session.close();
	let afterKey: string | null = target && note.model.get(target) ? target : place ? previous : (note.model.document.itemList.at(-1)?.key ?? null);
	for (const file of fileList) {
		const type = file.type || mediaTypeOf(file.name);
		const extension = /\.([A-Za-z0-9]{1,5})$/.exec(file.name)?.[1] ?? (type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/\+xml$/, '');
		// a pasted screenshot is just "image.png": it is named after the note instead
		const name = file.name && !/^image\.[a-z0-9]+$/i.test(file.name) ? file.name : `${stemOf(note.path)}.${extension}`;
		let path: string;
		try {
			path = await vault.addFile(folder, name, file);
		} catch (error) {
			toast(tr`Couldn’t save “${name}”: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const blockType = type.startsWith('video/') ? 'Video' : 'Image';
		const [key] = insertTemplate(note.model, place?.parentKey ?? null, afterKey, `${blockType}: ${path}`);
		afterKey = key ?? afterKey;
	}
	if (afterKey) session.select(afterKey);
}

document.addEventListener('paste', (event) => {
	if (viewMode !== 'Edit' || !workspace.note || graphShown()) return;
	const fileList = [...(event.clipboardData?.files ?? [])].filter(isMediaFile);
	if (fileList.length === 0) return;
	// into the note or one of its blocks: not into the note's name, a dialog, or the sidebar
	const target = event.target as Element | null;
	if (target && target !== document.body && (!pageElement.contains(target) || target.closest('.inline-title'))) return;
	event.preventDefault();
	void addMediaFile(fileList);
});

/**
 * A file dragged out of the sidebar onto a note, as in Obsidian: a picture or a video gets its
 * block, anything else a link, after the block it was dropped on (or at the end).
 */
function insertVaultFile(path: string, targetKey: string | undefined): void {
	const note = model();
	if (!note) return;
	const kind = mediaKindOf(path);
	const source = kind === 'Image' || kind === 'Video' ? `${kind}: ${path}` : linkTextOf(path).replace(/^!/, '');
	session.close();
	const place = targetKey && note.get(targetKey) ? note.placeOf(targetKey) : undefined;
	const afterKey = targetKey && note.get(targetKey) ? targetKey : (note.document.itemList.at(-1)?.key ?? null);
	const [key] = insertTemplate(note, place?.parentKey ?? null, afterKey, source);
	if (key) session.select(key);
}

/** Drops onto the page itself; a block editor takes text dropped into it as text. */
function droppedOnPage(event: DragEvent): boolean {
	return viewMode === 'Edit' && !(event.target instanceof HTMLTextAreaElement);
}

pageElement.addEventListener('dragover', (event) => {
	const typeList = event.dataTransfer?.types ?? [];
	if (!droppedOnPage(event) || (!typeList.includes('Files') && !typeList.includes(vaultPathType))) return;
	event.preventDefault();
	event.dataTransfer!.dropEffect = 'copy';
});

pageElement.addEventListener('drop', (event) => {
	if (!droppedOnPage(event)) return;
	const targetKey = host.keyAt(event.target as Element) ?? undefined;
	const vaultPath = event.dataTransfer?.getData(vaultPathType);
	if (vaultPath && workspace.vault?.has(vaultPath)) {
		event.preventDefault();
		insertVaultFile(vaultPath, targetKey);
		return;
	}
	const fileList = [...(event.dataTransfer?.files ?? [])].filter(isMediaFile);
	if (fileList.length === 0) return;
	event.preventDefault();
	void addMediaFile(fileList, targetKey);
});

/** A new note in the vault; outside a vault, a quick note, kept in this browser. */
async function createNote(folder?: string): Promise<void> {
	if (workspace.kind !== 'Vault' && !(await openQuickNote())) return;
	if (viewMode === 'Read') setView('Edit');
	const created = await workspace.newNote(folder ?? workspace.newNoteFolder());
	if (!created) return;
	const note = created.model;
	// an empty paragraph to write in; the name is picked first, as in Obsidian
	insertTemplate(note, null, null, '');
	if (viewMode === 'Source') {
		sourceEditor?.setText(note.serialize());
		sourceEditor?.focus();
		return;
	}
	noteHead.focusTitle();
}

/** Vaults to switch to: folders, the quick notes, and vaults an earlier build kept in the browser. */
async function vaultEntryList(): Promise<RecentEntry[]> {
	return (await recentList()).filter((entry) => entry.kind !== 'File');
}

const vaultIcon = (kind: RecentEntry['kind'] | 'Guide'): string => (kind === 'Browser' ? icon.Browser : kind === 'Guide' ? icon.Help : icon.Folder);

/** The vault switcher, as in Obsidian: the vaults you use (one click to switch), make or open another, or close this one. */
async function openVaultMenu(x: number, y: number): Promise<void> {
	const current = workspace.source;
	const itemList: MenuItem[] = [];
	if (current) itemList.push({ title: current.name, literal: true, icon: vaultIcon(current.kind), hint: '✓', run: () => undefined });
	for (const entry of await vaultEntryList()) {
		if (entry.id === current?.id) continue;
		itemList.push({ title: entry.name, literal: true, icon: vaultIcon(entry.kind), ...(entry.kind === 'Browser' ? { hint: t('in this browser') } : {}), run: () => void openRecent(entry, true) });
	}
	itemList.push(
		{ title: 'Create new vault', icon: icon.FolderPlus, separatorBefore: true, run: () => void createVault() },
		{ title: 'Open folder as vault', icon: icon.FolderOpen, hint: hotkeyText('Vault.Open'), run: () => void openFolder() },
		{ title: 'Import a vault from .zip', separatorBefore: true, run: () => chooseVaultZip() },
	);
	if (current) itemList.push({ title: 'Export this vault as .zip', run: () => void exportVault() });
	if (current) itemList.push({ title: current.kind === 'Guide' ? 'Close the guide' : 'Close vault', separatorBefore: true, run: () => void closeVault() });
	const menu = new Menu(itemList, { x, y });
	// the menu opens above the button
	const rect = menu.element.getBoundingClientRect();
	menu.place(x, Math.max(8, y - rect.height), y);
}

/** Switch theme without a name: every theme there is (from the app, plugins, and modules), and System. */
function openThemePicker(): void {
	const saved = String(setting.get('Theme.Active') ?? 'System');
	const itemList = [
		{ name: 'System', hint: systemDark?.matches ? 'follows the device: Dark now' : 'follows the device: Light now' },
		...themeRegistry.list().map((theme) => ({ name: theme.name, hint: theme.mode })),
	];
	openPicker({
		placeholder: 'Switch to a theme',
		emptyText: 'No theme matches',
		itemList: (query) =>
			itemList
				.map((item) => ({ item, score: bestFuzzyScore(query, [[item.name, 0]]) }))
				.filter((entry) => entry.score >= 0)
				.sort((left, right) => left.score - right.score)
				.map(({ item }) => ({ title: item.name, hint: item.name === saved ? `✓ ${item.hint}` : item.hint, run: () => chooseTheme(item.name) })),
	});
}

/** The vault switcher from the keyboard (command palette: Switch vault). */
async function switchVault(): Promise<void> {
	const list = (await vaultEntryList()).filter((entry) => entry.id !== workspace.source?.id);
	openPicker({
		placeholder: 'Switch to a vault',
		emptyText: 'No other vault yet',
		itemList: (query) =>
			list
				.map((entry) => ({ entry, score: bestFuzzyScore(query, [[entry.name, 0]]) }))
				.filter((item) => item.score >= 0)
				.sort((left, right) => left.score - right.score)
				.map(({ entry }) => ({ title: entry.name, hint: entry.kind === 'Browser' ? 'in this browser' : 'vault', run: () => void openRecent(entry, true) })),
	});
}

function tabMenu(tab: Tab, x: number, y: number): void {
	const index = workspace.paneTabList(tab.pane).indexOf(tab);
	const note = tab.note;
	const inVault = note && !note.external && workspace.kind === 'Vault';
	new Menu(
		[
			{ title: 'Close', hint: hotkeyText('Tab.Close'), run: () => void workspace.closeTab(tab.id) },
			{ title: 'Close every other tab', run: () => void closeTabList(workspace.paneTabList(tab.pane).filter((item) => item !== tab)) },
			{ title: 'Close every tab to the right', run: () => void closeTabList(workspace.paneTabList(tab.pane).slice(index + 1)) },
			{
				title: 'Split right',
				hint: hotkeyText('Pane.SplitRight'),
				separatorBefore: true,
				run: () => {
					workspace.activateTab(tab.id);
					splitPane('Right');
				},
			},
			{
				title: 'Split down',
				run: () => {
					workspace.activateTab(tab.id);
					splitPane('Bottom');
				},
			},
			...(inVault
				? [
						{ title: 'Copy link', separatorBefore: true, run: () => void navigator.clipboard?.writeText(`[[${linkTargetOf(stemOf(note.path))}]]`).then(() => toast(t('Link copied.'))) },
						{
							title: 'Show in the sidebar',
							run: () => {
								setSidebar(true);
								sidebar.showTab('File');
								sidebar.reveal(note.path);
							},
						},
					]
				: []),
		],
		{ x, y },
	);
}

async function closeTabList(list: readonly Tab[]): Promise<void> {
	for (const tab of [...list]) if (!(await workspace.closeTab(tab.id))) return;
}

/** The vault's trash (command palette: Open the trash): restore, or delete for good. */
function openTrash(): void {
	const vault = workspace.vault;
	if (!vault) return;
	if (workspace.source?.kind === 'Browser') {
		toast(t('Quick notes have no trash: a deleted one comes back only with the Undo button shown for a few seconds right after deleting it.'), 6000);
		return;
	}
	openModal('trash-modal', (modal, close) => {
		const render = (): void => {
			const list = vault.trashList();
			modal.innerHTML =
				'<h2>Trash</h2><p class="setting-explain">A deleted note waits in the vault’s <code>.oi/Trash</code> folder (open the vault’s folder to see it) until you empty it.</p>' +
				(list.length === 0
					? '<p class="empty-trash">The trash is empty.</p>'
					: `<div class="trash-list">${list.map((entry, index) => `<div class="trash-row"><span>${escapeHtml(entry.path.slice('.oi/Trash/'.length))}</span><button type="button" class="setting-button" data-restore="${index}">Restore</button><button type="button" class="setting-button danger" data-remove="${index}">Delete</button></div>`).join('')}</div>`) +
				`<div class="dialog-row">${list.length ? '<button type="button" class="dialog-button danger" data-action="Empty">Empty trash</button><span class="dialog-space"></span>' : ''}<button type="button" class="dialog-button" data-action="Close">Close</button></div>`;
			for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-restore]')) {
				button.addEventListener('click', () => {
					const entry = list[Number(button.dataset.restore)]!;
					void vault.restore(entry.path).then((path) => {
						toast(tr`Restored “${stemOf(path)}”.`);
						render();
					});
				});
			}
			for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
				button.addEventListener('click', () => {
					const entry = list[Number(button.dataset.remove)]!;
					void confirmDialog(tr`Delete “${stemOf(entry.path)}” for good?`, t('Delete'), true).then((ok) => (ok ? vault.deleteForever(entry.path).then(render) : undefined));
				});
			}
			modal.querySelector('[data-action="Empty"]')?.addEventListener('click', () => {
				void confirmDialog(t('Empty the trash? Everything in it is deleted for good.'), t('Empty trash'), true).then((ok) => (ok ? vault.emptyTrash().then(render) : undefined));
			});
			modal.querySelector('[data-action="Close"]')!.addEventListener('click', close);
		};
		render();
	});
}

function openSwitcher(): void {
	const vault = workspace.vault;
	if (!vault) {
		void openFile();
		return;
	}
	openPicker({
		placeholder: 'Find a note or a file, or type a new name',
		emptyText: 'No note or file matches',
		// notes, and the pictures, videos, and sounds the app shows on their own (a note wins a tie)
		itemList: (query) =>
			[
				...vault.noteList(),
				...vault
					.visibleEntryList()
					.filter((entry) => entry.kind === 'File' && mediaKindOf(entry.path))
					.map((entry) => entry.path),
			]
				.map((path) => {
					const title = isNote(path) ? stemOf(path) : baseName(path);
					return { path, title, score: bestFuzzyScore(query, [[title, 0], [path, 0.5]]) + (isNote(path) ? 0 : 0.01) };
				})
				.filter((item) => item.score >= 0)
				.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
				.slice(0, 60)
				.map(({ path, title }) => ({
					title,
					hint: parentPath(path),
					run: () => (isNote(path) ? void workspace.openNote(path) : void workspace.openFile(path)),
				})),
		fallback: (query) =>
			query.trim() === ''
				? undefined
				: {
						title: `Create “${query.trim()}”`,
						hint: 'Enter',
						run: () => void createNamedNote(query.trim()),
					},
	});
}

/** A note with a name (from the switcher or a link), written right away, in a new tab when asked. */
async function createNamedNote(name: string, folder = workspace.newNoteFolder(), newTab = false): Promise<void> {
	const vault = workspace.vault;
	if (!vault) return;
	const path = vault.uniquePath(folder, name.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Untitled');
	await vault.write(path, newNoteText());
	await workspace.openNote(path, { newTab });
	focusFirstBlock();
}

/** A click on [[Note]]: open it (or make it, as in Obsidian); Ctrl/Cmd+click opens a new tab. */
async function followLink(target: string, newTab: boolean, background = false): Promise<void> {
	const vault = workspace.vault;
	if (!vault) {
		toast(t('Links between notes work inside a vault. Open a folder as a vault, your quick notes, or the welcome guide.'));
		return;
	}
	const name = target.split('#')[0]!.trim();
	const from = workspace.note && !workspace.note.external ? workspace.note.path : undefined;
	const path = vault.resolve(name, from);
	if (path) {
		await workspace.openNote(path, { newTab, background });
		return;
	}
	// [[Cell.png]]: a picture, a video, or a sound opens on its own, as in Obsidian
	const file = vault.findFile(name, from ?? '');
	if (file && (mediaKindOf(file) || isDataFile(file))) {
		workspace.openFile(file, { newTab, background });
		return;
	}
	if (file) {
		toast(tr`No module opens .${file.split('.').pop() ?? ''} files yet.`);
		return;
	}
	if (await confirmDialog(tr`“${name}” doesn’t exist yet. Create it?`, t('Create'))) await createNamedNote(name.split('/').pop()!, name.includes('/') ? parentPath(`${name}.oi`) : workspace.newNoteFolder(), newTab);
}

host.root.addEventListener('click', (event) => {
	const target = event.target as Element;
	const link = target.closest<HTMLElement>('[data-oi-link]');
	if (link) {
		event.preventDefault();
		const behind = event.ctrlKey || event.metaKey;
		void followLink(link.dataset.oiLink!, behind, behind);
		return;
	}
	const tag = target.closest<HTMLElement>('[data-oi-tag]');
	if (tag && viewMode !== 'Edit') openVaultSearch(`tag:${tag.dataset.oiTag}`);
});

// ---------------------------------------------------------------- tag colors

/** Tints every #tag and tag chip of a colored tag, in every note, property, and table. */
function applyTagColor(): void {
	let element = document.getElementById('oiTagColor');
	if (!element) {
		element = document.createElement('style');
		element.id = 'oiTagColor';
		document.head.append(element);
	}
	element.textContent = tagColorCss(setting.get(tagColorSetting));
}
applyTagColor();

/** A tag's menu (a #tag in the text, a tag in the properties): its color for the whole vault, and the notes that have it. */
function tagMenu(tag: string, x: number, y: number): void {
	const picker = colorPicker();
	const current = tagColorMap(setting.get(tagColorSetting)).get(tag.toLowerCase())?.color;
	const itemList: MenuItem[] = [];
	if (picker)
		itemList.push({
			title: 'Tag color',
			explain: 'The same color wherever this tag is',
			run: () => picker.open({ x, y: y + 8, current, title: `#${tag}`, onPick: (color) => setting.set(tagColorSetting, withTagColor(setting.get(tagColorSetting), tag, color)) }),
		});
	if (current) itemList.push({ title: 'Remove tag color', run: () => setting.set(tagColorSetting, withTagColor(setting.get(tagColorSetting), tag, undefined)) });
	itemList.push({ title: 'Notes with this tag', separatorBefore: itemList.length > 0, run: () => openVaultSearch(`tag:${tag}`) });
	if (workspace.vault) itemList.push({ title: 'Rename everywhere', explain: 'In properties, #tags in text, and tables', run: () => void renameTag(tag) });
	new Menu(itemList, { x, y });
}

/** Renames a tag in every note of the vault (asked first, with how many notes change); its color goes with it. */
async function renameTag(tag: string): Promise<void> {
	const index = registry.extension<NoteIndex>(noteIndexExtension);
	if (!index) return;
	const to = (await promptDialog(tr`Rename the tag ${tag} everywhere to`, tag, t('Rename')))?.trim();
	if (!to || to === tag) return;
	const { renameTagEverywhere } = await import('./tag-rename');
	const { noteList } = await renameTagEverywhere(index, tag, to, true);
	if (noteList.length === 0) {
		toast(tr`No note has the tag ${tag}.`);
		return;
	}
	if (!(await confirmDialog(noteList.length === 1 ? tr`Rename ${tag} to ${to} in 1 note?` : tr`Rename ${tag} to ${to} in ${noteList.length} notes?`, t('Rename')))) return;
	await renameTagEverywhere(index, tag, to);
	const color = tagColorMap(setting.get(tagColorSetting)).get(tag.toLowerCase())?.color;
	if (color) setting.set(tagColorSetting, withTagColor(withTagColor(setting.get(tagColorSetting), tag, undefined), to, color));
	toast(noteList.length === 1 ? tr`Renamed in 1 note.` : tr`Renamed in ${noteList.length} notes.`);
}

registry.registerExtension(tagExtension, {
	colorOf: (tag) => tagColorMap(setting.get(tagColorSetting)).get(tag.toLowerCase())?.color,
	setColor: (tag, color) => setting.set(tagColorSetting, withTagColor(setting.get(tagColorSetting), tag, color)),
	openMenu: (tag, x, y) => tagMenu(tag, x, y),
} satisfies TagAccess);
// before the block's own menu: a right-click on a tag is about the tag
host.root.addEventListener(
	'contextmenu',
	(event) => {
		const tag = (event.target as Element).closest<HTMLElement>('[data-oi-tag]');
		if (!tag?.dataset.oiTag) return;
		event.preventDefault();
		event.stopPropagation();
		tagMenu(tag.dataset.oiTag, event.clientX, event.clientY);
	},
	true,
);
// a middle-click on a link opens it in a new tab
host.root.addEventListener('auxclick', (event) => {
	const link = (event.target as Element).closest<HTMLElement>('[data-oi-link]');
	if (event.button !== 1 || !link) return;
	event.preventDefault();
	void followLink(link.dataset.oiLink!, true, true);
});

// clicking below the last block continues writing there
pageElement.addEventListener('click', (event) => {
	const note = model();
	if (!note || viewMode !== 'Edit' || (event.target as Element).closest('.oi-frame, .note-head, #sourceHost')) return;
	const lastFrame = noteElement.lastElementChild as HTMLElement | null;
	if (lastFrame && event.clientY < lastFrame.getBoundingClientRect().bottom) return;
	const last = note.document.itemList.at(-1);
	if (last && last.type === 'Text' && last.body.trim() === '' && last.childList.length === 0) {
		session.edit(last.key);
		return;
	}
	insertBlock('', { parentKey: null, afterKey: last?.key ?? null });
});

// ---------------------------------------------------------------- blocks

/** Where a new block goes: after the selected (or edited) block, else at the end. */
function insertPlace(): { parentKey: string | null; afterKey: string | null } {
	const note = model();
	const key = session.editingKey() ?? session.selected();
	if (note && key && note.get(key)) return { parentKey: note.placeOf(key).parentKey, afterKey: key };
	return { parentKey: null, afterKey: note?.document.itemList.at(-1)?.key ?? null };
}

function editFirst(keyList: readonly string[]): void {
	const note = model();
	if (!note) return;
	for (const key of keyList) {
		let node = note.get(key);
		// for containers (Grid, Column) start typing in their first block; a callout edits its title
		while (node && registry.blockType(node.type)?.layout && !registry.blockType(node.type)?.edit && node.childList[0]) node = node.childList[0];
		if (node) {
			session.edit(node.key);
			return;
		}
	}
}

function insertBlock(source: string, place = insertPlace()): void {
	const note = model();
	if (!note) return;
	if (viewMode !== 'Edit') setView('Edit');
	editFirst(insertTemplate(note, place.parentKey, place.afterKey, source));
}

function applySlash(key: string, template: TemplateEntry): void {
	const note = model();
	if (!note?.get(key)) return;
	// close first (the block still holds "/…" so it isn't dropped as empty), then swap it in one step
	session.close();
	let next = key;
	note.transact(() => {
		note.setBody(key, '');
		next = turnInto(note, key, template.source);
	});
	editFirst([next]);
}

/** Adds the note's Property block at the top (or opens its "add property" form). */
function addProperty(): void {
	const note = model();
	if (!note) return;
	if (viewMode !== 'Edit') setView('Edit');
	const existing = propertyBlockOf(note);
	if (existing) {
		openPropertyForm(host.frameOf(existing.key));
		return;
	}
	const [key] = insertTemplate(note, null, null, 'Property:');
	if (key) session.edit(key);
}

/** Moves the fields an older note keeps in its header into a Property block, as one step. */
function moveHeaderProperty(): void {
	const note = model();
	if (!note) return;
	const entryList = (note.document.front?.entryList ?? []).filter((entry) => entry.kind === 'Pair' && !systemKeySet.has(entry.key!));
	if (entryList.length === 0) return;
	const lineList = entryList.flatMap((entry) => formatPairLineList(entry.key!, entry.value!, 1));
	note.transact(() => {
		for (const entry of entryList) note.setNoteProperty(entry.key!, undefined);
		insertTemplate(note, null, null, `Property:\n${lineList.join('\n')}`);
	});
	toast(headerKeyList(note).length === 0 ? t('Moved them into a Property block. Ctrl+Z puts them back.') : t('Moved what could be moved into a Property block. Ctrl+Z puts them back.'));
}

function templateItemList(run: (template: TemplateEntry) => void): MenuItem[] {
	return registry.templateList().map((template) => ({
		title: template.title,
		icon: template.icon,
		...(template.explain ? { explain: template.explain } : {}),
		keywordList: [...(template.keywordList ?? []), template.type, template.module],
		group: template.module,
		run: () => run(template),
	}));
}

function formatItemList(): MenuItem[] {
	const list: [FormatKind, string, string][] = [
		['Bold', 'Bold', 'Format.Bold'],
		['Italic', 'Italic', 'Format.Italic'],
		['Strike', 'Strikethrough', 'Format.Strike'],
		['Highlight', 'Highlight', 'Format.Highlight'],
		['Code', 'Inline code', 'Format.Code'],
		['Math', 'Inline math', 'Format.Math'],
		['Link', 'Link', 'Format.Link'],
	];
	return list.map(([kind, title, command]) => ({ title, hint: hotkeyText(command), run: () => applyFormat(kind) }));
}

/** Where the pointer last went down: a color menu opened from a menu opens there. */
let lastPress = { x: 120, y: 120 };
document.addEventListener('pointerdown', (event) => (lastPress = { x: event.clientX, y: event.clientY }), true);

/** The Palette plugin's color menu; without the plugin there is no color choice. */
function colorPicker(): ColorPicker | undefined {
	return registry.extension<ColorPicker>(colorPickerExtension);
}

/** Colors the selected text from the Palette plugin's menu, opened at (x, y). */
function openTextColor(x: number, y: number): void {
	const range = session.textRange();
	const picker = colorPicker();
	if (!picker || !range || range.start === range.end) return;
	picker.open({
		x,
		y,
		title: 'Text color',
		onPick: (color) => {
			if (model()?.get(range.key)?.type !== 'Text') return;
			session.replace(range.key, (body) => colorRange(body, range.start, range.end, color));
		},
	});
}

function applyFormat(kind: FormatKind): void {
	const note = model();
	const range = session.textRange();
	if (!note || !range || range.start === range.end || note.get(range.key)?.type !== 'Text') return;
	session.replace(range.key, (body) => toggleFormat(body, range.start, range.end, kind));
}

function blockMenu(key: string, x: number, y: number): void {
	const note = model();
	if (!note?.get(key) || viewMode !== 'Edit') return;
	const node = note.get(key)!;
	const range = session.textRange();
	const hasText = range !== undefined && range.key === key && range.start !== range.end && node.type === 'Text';
	const container = registry.blockType(node.type)?.layout !== undefined;
	const itemList: MenuItem[] = [];
	if (hasText) itemList.push({ title: 'Format', itemList: formatItemList() }, ...(colorPicker() ? [{ title: 'Color', run: () => openTextColor(lastPress.x, lastPress.y + 8) }] : []));
	if (!container) {
		itemList.push({
			title: 'Turn into',
			separatorBefore: hasText,
			itemList: templateItemList((template) => {
				session.close();
				editFirst([turnInto(note, key, template.source)]);
			}),
		});
	}
	if (commandRegistry.get('AI.Ask')) {
		itemList.push({
			title: 'Ask AI',
			icon: icon.Sparkle,
			hint: hotkeyText('AI.Ask'),
			explain: hasText ? 'About the selected text' : 'About this block',
			separatorBefore: true,
			run: () => {
				// without highlighted text the request is about the block: it is selected, not edited
				if (!hasText) {
					session.close();
					session.select(key);
				}
				commandRegistry.run('AI.Ask');
			},
		});
	}
	itemList.push({ title: 'Add block below', icon: icon.Plus, itemList: templateItemList((template) => insertBlock(template.source, { parentKey: note.placeOf(key).parentKey, afterKey: key })) });
	// anywhere inside a column (or on a grid) a new column can go beside it
	let columnKey: string | undefined;
	for (let at: BlockNode | null | undefined = node; at; at = note.parentOf(at.key)) {
		if (at.type === 'Column') {
			columnKey = at.key;
			break;
		}
	}
	// a block at the top of the page can be wider than the text (a calendar, a table, a plot)
	if (!note.parentOf(key) && pageLayoutOf(note) === 'Flow') {
		const wide = node.property.get('Wide') === true;
		itemList.push({ title: 'Full width', icon: wide ? '✓' : undefined, explain: 'Wider than the text around it', run: () => note.setProperty(key, 'Wide', wide ? undefined : true) });
	}
	if (node.type === 'Grid') itemList.push({ title: 'Add column', run: () => insertColumn(key, 'Right') });
	else if (columnKey) {
		const column = columnKey;
		itemList.push({ title: 'Add column to the left', run: () => insertColumn(column, 'Left') }, { title: 'Add column to the right', run: () => insertColumn(column, 'Right') });
	}
	itemList.push(
		{ title: 'Save as picture', run: () => void exportPicture(key) },
		{ title: 'Duplicate', hint: hotkeyText('Block.Duplicate'), separatorBefore: true, run: () => duplicateBlock(note, key) },
		{ title: 'Move up', hint: hotkeyText('Block.MoveUp'), run: () => moveBlock(note, key, -1) },
		{ title: 'Move down', hint: hotkeyText('Block.MoveDown'), run: () => moveBlock(note, key, 1) },
		{ title: 'Nest under the block above', hint: 'Tab', run: () => indentBlock(note, key) },
		{ title: 'Move out of its parent', hint: 'Shift+Tab', run: () => outdentBlock(note, key) },
		{
			title: 'Copy as OI text',
			run: () => void navigator.clipboard?.writeText(serializeNode(note.get(key)!, registry.formatOption()).map((line) => line.replace(new RegExp(`^\\t{${node.level}}`), '')).join('\n')),
		},
		{ title: 'Delete', hint: 'Del', danger: true, separatorBefore: true, run: () => deleteBlock(key) },
	);
	session.select(key);
	new Menu(itemList, { x, y });
}

function insertColumn(key: string, side: 'Left' | 'Right'): void {
	const note = model();
	if (!note?.get(key)) return;
	session.close();
	editFirst([addColumn(note, key, side)]);
}

function deleteBlock(key: string): void {
	const note = model();
	if (!note?.get(key)) return;
	session.close();
	session.select(undefined);
	note.delete(key);
}

// ---------------------------------------------------------------- commands and hotkeys

// A browser tab never receives Ctrl+N or Ctrl+W (the browser keeps them), so the web uses Alt+N
// and Alt+W, and only outside the editor, where Option+N on a Mac still types ñ. The native
// shell keeps Mod+N and Mod+W.
const inBrowserTab = !('__TAURI_INTERNALS__' in window);
const apple = isApplePlatform();

appBindingList = [
	inBrowserTab ? { key: 'Alt+N', command: 'Note.Create', when: 'NotTyping' } : { key: 'Mod+N', command: 'Note.Create' },
	inBrowserTab ? { key: 'Alt+W', command: 'Tab.Close', when: 'NotTyping' } : { key: 'Mod+W', command: 'Tab.Close' },
	{ key: 'Mod+\\', command: 'Pane.SplitRight' },
	{ key: 'Alt+PageDown', command: 'Tab.Next' },
	{ key: 'Alt+PageUp', command: 'Tab.Previous' },
	{ key: 'Mod+O', command: 'Note.Switch' },
	{ key: 'Mod+S', command: 'Note.Save' },
	{ key: 'Mod+P', command: 'Command.Palette' },
	{ key: 'Mod+,', command: 'Setting.Open' },
	{ key: 'Mod+E', command: 'View.Toggle' },
	{ key: 'Mod+Shift+E', command: 'View.Source' },
	{ key: 'Mod+F', command: 'Find.Open' },
	{ key: apple ? 'Mod+Alt+F' : 'Mod+H', command: 'Find.Replace' },
	{ key: 'Mod+Shift+F', command: 'Search.Vault' },
	{ key: 'Mod+G', command: 'Graph.Open' },
	{ key: 'Mod+;', command: 'Property.Add' },
	{ key: 'Mod+Alt+ArrowLeft', command: 'Navigate.Back' },
	{ key: 'Mod+Alt+ArrowRight', command: 'Navigate.Forward' },
	{ key: 'F2', command: 'Note.Rename', when: 'NotTyping' },
	// undo works from anywhere: the note's text, its name, its properties (see Edit.Undo)
	{ key: 'Mod+Z', command: 'Edit.Undo', when: 'GlobalUndo' },
	{ key: 'Mod+Shift+Z', command: 'Edit.Redo', when: 'GlobalUndo' },
	{ key: 'Mod+B', command: 'Format.Bold' },
	{ key: 'Mod+I', command: 'Format.Italic' },
	{ key: 'Mod+Shift+X', command: 'Format.Strike' },
	{ key: 'Mod+Shift+H', command: 'Format.Highlight' },
	{ key: 'Mod+Shift+C', command: 'Format.Code' },
	{ key: 'Mod+Shift+M', command: 'Format.Math' },
	{ key: 'Mod+K', command: 'Format.Link' },
	{ key: 'Mod+D', command: 'Block.Duplicate' },
	{ key: 'Alt+ArrowUp', command: 'Block.MoveUp' },
	{ key: 'Alt+ArrowDown', command: 'Block.MoveDown' },
	{ key: 'Mod+Shift+L', command: 'Theme.Cycle' },
	{ key: 'Delete', command: 'Block.Delete', when: 'BlockSelected' },
	{ key: 'Backspace', command: 'Block.Delete', when: 'BlockSelected' },
] satisfies HotkeyBinding[];
refreshDefaultBinding();

// keys of your own for contexts a module handles itself (the drawing tool's `Drawing`)
const hotkeyLookup: HotkeyLookup = {
	commandFor: (event, when) => {
		const chord = eventChord(event, apple);
		if (!chord) return undefined;
		return setting.bindingList().find((binding) => binding.when === when && parseHotkey(binding.key)?.length === 1 && parseHotkey(binding.key)![0] === chord)?.command;
	},
	keyText: (command) => hotkeyText(command),
};
registry.registerExtension(hotkeyExtension, hotkeyLookup);

// ---------------------------------------------------------------- the note on screen, for plugins that write into it (AI)

/** A block with what it holds, as OI text at level 0. */
function blockText(note: NoteModel, key: string): string {
	const node = note.get(key)!;
	return serializeNode(node, registry.formatOption())
		.map((line) => line.replace(new RegExp(`^\\t{${node.level}}`), ''))
		.join('\n');
}

/** A note's text in two parts: the app's `---` header, and its blocks. */
function splitHeader(note: NoteModel): { head: string; body: string } {
	const text = note.serialize();
	const match = note.document.front ? /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text) : null;
	return match ? { head: match[0], body: text.slice(match[0].length) } : { head: '', body: text };
}

/**
 * The note on screen and what is selected in it, for a plugin that writes there later (the AI's
 * answer comes after a while): highlighted characters in the block being edited (or in the Source
 * view), a selected block, or the whole note. `apply` checks that the place is still what it was.
 */
function captureNote(): NoteTarget | undefined {
	const open = workspace.note;
	if (!open || graphShown()) return undefined;
	const note = open.model;
	const name = stemOf(open.path);
	const alive = (): boolean => workspace.note?.model === note;
	const clean = (source: string): string => source.replace(/\r\n/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
	const show = (key: string | undefined): void => {
		if (!key || viewMode === 'Source') return;
		session.select(key);
		host.frameOf(key)?.scrollIntoView({ block: 'nearest' });
	};
	const replaceNote = (text: string): boolean => {
		session.close();
		const { head } = splitHeader(note);
		note.setText(`${head}${head ? '\n' : ''}${text}\n`);
		return true;
	};

	// the Source view: the selection is characters of the note's text
	if (viewMode === 'Source' && sourceEditor) {
		sourceEditor.flush();
		const { selectionStart: start, selectionEnd: end, value } = sourceEditor.textarea;
		const make = (scope: NoteScope): NoteTarget => ({
			name,
			text: splitHeader(note).body,
			scope,
			selection: scope === 'Text' ? value.slice(start, end) : '',
			apply(source, where) {
				const text = clean(source);
				if (!alive() || text === '') return false;
				if (scope === 'Note') {
					if (where === 'Replace') return replaceNote(text);
					insertTemplate(note, null, note.document.itemList.at(-1)?.key ?? null, text);
					return true;
				}
				const now = note.serialize();
				if (now.slice(start, end) !== value.slice(start, end)) return false;
				if (where === 'Replace') {
					note.setText(now.slice(0, start) + text + now.slice(end));
					return true;
				}
				// under the block the selection ends in: past the indented lines that still belong to it
				const lineList = now.split('\n');
				let at = now.slice(0, end).split('\n').length;
				for (;;) {
					let look = at;
					while (look < lineList.length && lineList[look]!.trim() === '') look++;
					if (look < lineList.length && /^(?:\t| {4})/.test(lineList[look]!)) at = look + 1;
					else break;
				}
				const before = lineList.slice(0, at);
				const after = lineList.slice(at);
				while (before.length > 0 && before.at(-1)!.trim() === '') before.pop();
				while (after.length > 0 && after[0]!.trim() === '') after.shift();
				note.setText([...before, '', ...text.split('\n'), '', ...after].join('\n').replace(/\n*$/, '\n'));
				return true;
			},
			whole: () => make('Note'),
		});
		return make(start !== end ? 'Text' : 'Note');
	}

	const range = session.textRange();
	const editingKey = session.editingKey();
	const area = session.activeTextarea();
	const selectedKey = range?.source === 'View' ? range.key : session.selected();
	let scope: NoteScope = 'Note';
	let key = editingKey;
	let selection = '';
	if (area && editingKey && range?.source === 'Editor' && range.start !== range.end) {
		scope = 'Text';
		selection = area.value.slice(range.start, range.end);
	} else if (!editingKey && selectedKey && note.get(selectedKey)) {
		scope = 'Block';
		key = selectedKey;
		selection = blockText(note, selectedKey);
	}
	const start = range?.start ?? 0;
	const end = range?.end ?? 0;
	const type = key ? note.get(key)?.type : undefined;
	/** Under a block; when closing its editor dropped it (an empty line), where it was. */
	const insertUnder = (anchor: string | undefined, text: string): boolean => {
		let parentKey: string | null = null;
		let afterKey: string | null = note.document.itemList.at(-1)?.key ?? null;
		if (anchor && note.get(anchor)) {
			const place = note.placeOf(anchor);
			const fallback = place.list[place.index - 1]?.key ?? null;
			session.close();
			parentKey = place.parentKey;
			afterKey = note.get(anchor) ? anchor : fallback;
		} else session.close();
		show(insertTemplate(note, parentKey, afterKey, text)[0]);
		return true;
	};
	const make = (made: NoteScope): NoteTarget => ({
		name,
		text: splitHeader(note).body,
		scope: made,
		selection: made === 'Note' ? '' : selection,
		...(type && made !== 'Note' ? { type } : {}),
		apply(source, where) {
			const text = clean(source);
			if (!alive() || text === '' || viewMode === 'Source') return false;
			if (viewMode === 'Read') setView('Edit');
			if (made === 'Note') return where === 'Replace' ? replaceNote(text) : insertUnder(key, text);
			if (!key || !note.get(key)) return false;
			if (where === 'After') return insertUnder(key, text);
			if (made === 'Text') {
				// as if typed over the selection in the block's editor, which must still hold it
				if (session.editingKey() !== key) session.edit(key);
				if (session.activeTextarea()?.value.slice(start, end) !== selection) return false;
				session.replace(key, (value) => ({ text: value.slice(0, start) + text + value.slice(end), start, end: start + text.length }));
				return true;
			}
			if (blockText(note, key) !== selection) return false;
			session.close();
			session.select(undefined);
			const { parentKey } = note.placeOf(key);
			const keyList: string[] = [];
			const old = key;
			note.transact(() => {
				let after = old;
				for (const node of note.parseFragment(text)) keyList.push((after = note.insert(parentKey, after, node)));
				note.delete(old);
			});
			show(keyList[0]);
			return true;
		},
		whole: () => make('Note'),
	});
	return make(scope);
}

registry.registerExtension(noteEditorExtension, {
	capture: captureNote,
	preview(target) {
		// a note of its own, drawn by the same modules and theme, that nothing can edit
		const previewModel = NoteModel.fromText('', registry.formatOption());
		const previewHost = new RenderHost(target, registry, themeRegistry);
		previewHost.setReadOnly(true);
		previewHost.mount(previewModel);
		return {
			update: (source) => previewModel.setText(source.trim() === '' ? '' : `${source.replace(/\s+$/, '')}\n`),
			destroy: () => previewHost.destroy(),
		};
	},
} satisfies NoteEditor);

/** `Mod+Shift+M` → `Ctrl+Shift+M` (or `⌘⇧M` style on Apple devices). */
function keyText(key: string): string {
	return apple ? key.replace(/Mod/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '') : key.replace(/Mod/g, 'Ctrl');
}

function hotkeyText(command: string): string {
	const key = setting.keyListOf(command)[0];
	return key ? keyText(key) : '';
}

const activeKey = (): string | undefined => session.editingKey() ?? session.selected();

function toggleSetting(argument: unknown): void {
	const id = String(argument ?? '');
	const definition = setting.definition(id);
	if (!definition) {
		toast(tr`No setting “${id}”.`);
		return;
	}
	let value: PropertyValue;
	if (definition.type === 'Toggle') value = setting.get(id) !== true;
	else if (definition.type === 'Choice' && definition.choiceList?.length) {
		const list = definition.choiceList;
		value = list[(list.indexOf(String(setting.get(id))) + 1) % list.length]!;
	} else return;
	if (id === 'Theme.Active') chooseTheme(String(value));
	else setting.set(id, value);
	toast(`${t(definition.title)}: ${value === true ? t('On') : value === false ? t('Off') : String(value)}`);
}

/**
 * Undo from anywhere. A name or property typed but not kept yet is put back first; after that,
 * Undo steps back through the note's history: its text, its properties, and renames.
 */
function undoGlobal(kind: 'Undo' | 'Redo'): void {
	const active = document.activeElement;
	if (kind === 'Undo' && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.dataset.oiCommitted !== undefined && active.value !== active.dataset.oiCommitted) {
		active.value = active.dataset.oiCommitted;
		active.dispatchEvent(new Event('input', { bubbles: true }));
		return;
	}
	if (graphShown()) return;
	session.history(kind);
}

/** Fields that keep their own undo: dialogs, search boxes, the Source view. */
function ownUndoField(target: Element | null): boolean {
	if (target instanceof HTMLElement && target.closest('#sourceHost')) return true;
	const textField = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text', 'search', 'email', 'url', ''].includes(target.type)) || (target instanceof HTMLElement && target.isContentEditable);
	return textField && (target as HTMLElement).dataset.oiCommitted === undefined;
}

const commandList: CommandDefinition[] = [
	{ id: 'Note.Create', title: 'Create a new note', run: () => void createNote() },
	{ id: 'Note.Switch', title: 'Open the quick switcher', run: () => openSwitcher() },
	{ id: 'Note.Save', title: 'Save the note', run: () => void workspace.save(true) },
	{ id: 'Note.Rename', title: 'Rename the note', run: () => workspace.note && noteHead.focusTitle() },
	{ id: 'Page.Flow', title: 'Page layout: Flow (one block under another)', run: () => setPageLayout('Flow') },
	{ id: 'Page.Masonry', title: 'Page layout: Masonry (cards in columns, Pinterest style)', run: () => setPageLayout('Masonry') },
	{
		id: 'Note.Quick',
		title: 'New quick note (kept in this browser)',
		run: () =>
			void openQuickNote().then(async (opened) => {
				if (opened) await createNote();
			}),
	},
	{
		id: 'Note.Delete',
		title: 'Delete the note',
		run: () => {
			const note = workspace.note;
			if (note && !note.external) void workspace.delete(note.path);
		},
	},
	{
		id: 'Note.Export',
		title: 'Export the note (download .oi)',
		run: () => {
			const note = workspace.note;
			if (note) downloadText(note.path.split('/').pop()!.endsWith('.oi') ? note.path.split('/').pop()! : `${stemOf(note.path)}.oi`, note.model.serialize());
		},
	},
	{ id: 'Note.ExportPicture', title: 'Export the note as a picture (.png)', run: () => void exportPicture() },
	{ id: 'Note.ExportMarkdown', title: 'Export the note as Markdown (.md)', explain: 'Blocks Markdown can’t hold go beside it as pictures, in a .zip', run: () => void exportMarkdown() },
	{ id: 'Block.ExportPicture', title: 'Save the block as a picture (.png)', run: () => activeKey() && void exportPicture(activeKey()) },
	{ id: 'Vault.Export', title: 'Export the vault as .zip', run: () => void exportVault() },
	{ id: 'Vault.Import', title: 'Import a vault from .zip', run: () => chooseVaultZip() },
	{ id: 'Tab.Close', title: 'Close the tab', run: () => void workspace.closeTab() },
	{ id: 'Pane.SplitRight', title: 'Split right: a pane beside this one', run: () => splitPane('Right') },
	{ id: 'Pane.SplitDown', title: 'Split down: a pane below this one', run: () => splitPane('Bottom') },
	{
		id: 'Pane.Next',
		title: 'Go to the next pane',
		run: () => {
			const order = paneIdListOf(workspace.layout);
			workspace.focusPane(order[(order.indexOf(workspace.paneId) + 1) % order.length]!);
		},
	},
	{ id: 'Tab.Next', title: 'Next tab', run: () => workspace.cycleTab(1) },
	{ id: 'Tab.Previous', title: 'Previous tab', run: () => workspace.cycleTab(-1) },
	{ id: 'Guide.Open', title: 'Open the welcome guide', run: () => void openGuide() },
	{ id: 'File.Open', title: 'Open a file', run: () => void openFile() },
	{ id: 'Vault.Create', title: 'Create new vault', run: () => void createVault() },
	{ id: 'Vault.Open', title: 'Open folder as vault', run: () => void openFolder() },
	{ id: 'Vault.Switch', title: 'Switch vault', run: () => void switchVault() },
	{ id: 'Vault.Close', title: 'Close the vault', run: () => void closeVault() },
	{ id: 'Trash.Open', title: 'Open the trash', run: () => openTrash() },
	{ id: 'Command.Palette', title: 'Open the command palette', run: () => openCommandPalette(commandRegistry, hotkeyText) },
	{ id: 'Setting.Open', title: 'Open Setting', explain: 'Argument: a page (Editor, Appearance, or Module:AI for a module’s or plugin’s own)', run: (argument) => openSetting(typeof argument === 'string' && argument ? argument : undefined) },
	{
		id: 'Theme.Switch',
		title: 'Switch theme',
		explain: 'Argument: a theme name (Dark) or System. Without one, pick from the list',
		run: (argument) => {
			const name = typeof argument === 'string' ? argument : argument instanceof Map ? argument.get('Name') : (argument as { Name?: unknown } | undefined)?.Name;
			if (typeof name === 'string' && name.trim() !== '') chooseTheme(name.trim());
			else openThemePicker();
		},
	},
	{
		id: 'Theme.Cycle',
		title: 'Next theme',
		run: () => {
			const list = themeRegistry.list();
			const next = list[(list.findIndex((theme) => theme.name === themeRegistry.current().name) + 1) % list.length]!.name;
			chooseTheme(next);
			toast(tr`Theme: ${next}`);
		},
	},
	{ id: 'Setting.Toggle', title: 'Toggle a setting', explain: 'Argument: the setting’s ID, e.g. Code.LineNumber', run: toggleSetting },
	{ id: 'Sidebar.Toggle', title: 'Show or hide the sidebar', run: () => setSidebar(!sidebar.isOpen()) },
	{ id: 'Property.Add', title: 'Add a property', run: () => addProperty() },
	{ id: 'View.Source', title: 'Source view (the note as text)', run: () => setView(viewMode === 'Source' ? 'Edit' : 'Source') },
	{ id: 'View.Edit', title: 'Edit view', run: () => setView('Edit') },
	{ id: 'View.Read', title: 'Read view', run: () => setView('Read') },
	{ id: 'View.Toggle', title: 'Switch between Edit and Read', run: () => setView(viewMode === 'Edit' ? 'Read' : 'Edit') },
	{ id: 'View.Set', title: 'Set the view', explain: 'Argument: Source, Edit, or Read', run: (argument) => (['Source', 'Edit', 'Read'].includes(String(argument)) ? setView(String(argument) as ViewMode) : undefined) },
	{
		id: 'Find.Open',
		title: 'Find in the note',
		run: () => {
			if (workspace.note) findBar.open(false, currentSelection());
		},
	},
	{
		id: 'Find.Replace',
		title: 'Find and replace in the note',
		run: () => {
			if (workspace.note) findBar.open(true, currentSelection());
		},
	},
	{ id: 'Search.Vault', title: 'Search every note', run: () => openVaultSearch(currentSelection() || undefined) },
	{ id: 'Graph.Open', title: 'Open the graph view', run: () => toggleGraph() },
	{ id: 'Navigate.Back', title: 'Go back', run: () => void workspace.goBack() },
	{ id: 'Navigate.Forward', title: 'Go forward', run: () => void workspace.goForward() },
	{ id: 'Edit.Undo', title: 'Undo', run: () => undoGlobal('Undo') },
	{ id: 'Edit.Redo', title: 'Redo', run: () => undoGlobal('Redo') },
	{ id: 'Format.Bold', title: 'Bold', run: () => applyFormat('Bold') },
	{ id: 'Format.Italic', title: 'Italic', run: () => applyFormat('Italic') },
	{ id: 'Format.Strike', title: 'Strikethrough', run: () => applyFormat('Strike') },
	{ id: 'Format.Highlight', title: 'Highlight', run: () => applyFormat('Highlight') },
	{ id: 'Format.Code', title: 'Inline code', run: () => applyFormat('Code') },
	{ id: 'Format.Math', title: 'Inline math', run: () => applyFormat('Math') },
	{ id: 'Format.Link', title: 'Link', run: () => applyFormat('Link') },
	{
		id: 'Block.Insert',
		title: 'Insert a block',
		run: () => {
			if (!model()) return;
			const key = activeKey();
			const rect = (key ? host.frameOf(key) : noteElement)?.getBoundingClientRect();
			new Menu(templateItemList((template) => insertBlock(template.source)), { x: rect?.left ?? 80, y: (rect?.bottom ?? 120) + 4, search: true });
		},
	},
	{ id: 'Block.Delete', title: 'Delete the block', run: () => activeKey() && deleteBlock(activeKey()!) },
	{ id: 'Block.Duplicate', title: 'Duplicate the block', run: () => model() && activeKey() && duplicateBlock(model()!, activeKey()!) },
	{ id: 'Block.MoveUp', title: 'Move the block up', run: () => model() && activeKey() && moveBlock(model()!, activeKey()!, -1) },
	{ id: 'Block.MoveDown', title: 'Move the block down', run: () => model() && activeKey() && moveBlock(model()!, activeKey()!, 1) },
];
for (const command of commandList) commandRegistry.register(command);

let macroDisposeList: (() => void)[] = [];
/** Your macros become commands (with hotkeys and a place in the palette). */
function registerMacro(): void {
	for (const dispose of macroDisposeList) dispose();
	macroDisposeList = [];
	for (const macro of setting.macroList()) {
		try {
			macroDisposeList.push(
				commandRegistry.register({
					id: macro.id,
					title: `Macro: ${macro.title}`,
					run: () => {
						for (const step of macro.stepList) commandRegistry.run(step.command, step.argument);
					},
				}),
			);
		} catch {
			// a macro whose ID clashes with a command is skipped
		}
	}
}
registerMacro();

function isTyping(): boolean {
	const active = document.activeElement;
	return active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable);
}

const hotkeyManager = new HotkeyManager(commandRegistry, {
	isActive: (when) => {
		if (when === 'NotTyping') return !isTyping();
		if (when === 'GlobalUndo') return !ownUndoField(document.activeElement);
		// with text highlighted on the page, Delete removes that text, not the selected block
		if (when === 'BlockSelected') return !isTyping() && session.selected() !== undefined && session.editingKey() === undefined && viewMode === 'Edit' && !session.hasViewSelection();
		return false;
	},
});
hotkeyManager.setBindingList(setting.bindingList());
setting.subscribeHotkey(() => {
	hotkeyManager.setBindingList(setting.bindingList());
	applyTip();
});

document.addEventListener(
	'keydown',
	(event) => {
		// the "/" menu takes its keys from the block editor
		const menu = currentMenu();
		if (menu?.option.externalQuery && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
			if (menu.handleKey(event)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}
	},
	true,
);

document.addEventListener('keydown', (event) => {
	if (event.defaultPrevented || document.querySelector('.modal-backdrop, .oi-draw-backdrop') || (currentMenu() && !currentMenu()!.option.externalQuery)) return;
	if (event.key === 'Escape' && graphShown() && !isTyping()) {
		void workspace.hideGraph();
		return;
	}
	if (hotkeyManager.handle(event)) return;
	if (!isTyping() && viewMode === 'Edit') session.handleKey(event);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-command]')) {
	button.addEventListener('click', () => commandRegistry.run(button.dataset.command!));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('.view-mode [data-mode]')) button.addEventListener('click', () => setView(button.dataset.mode as ViewMode));
// on a phone the sidebar is a drawer over the note; tapping beside it closes it
element('sidebarBackdrop').addEventListener('click', () => setSidebar(false));

element('moreButton').addEventListener('click', (event) => {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const file = workspace.file;
	if (file) {
		new Menu(
			[
				{ title: 'Copy link', run: () => void navigator.clipboard?.writeText(linkTextOf(file)).then(() => toast(t('Link copied.'))) },
				{
					title: 'Show in the sidebar',
					run: () => {
						setSidebar(true);
						sidebar.showTab('File');
						sidebar.reveal(file);
					},
				},
				{
					title: 'Rename',
					run: () => {
						setSidebar(true);
						sidebar.showTab('File');
						sidebar.startRename(file);
					},
				},
				{ title: workspace.deletesForGood() ? 'Delete the file' : 'Move to trash', danger: true, separatorBefore: true, run: () => void workspace.delete(file) },
				{ title: 'Close the tab', hint: hotkeyText('Tab.Close'), separatorBefore: true, run: () => void workspace.closeTab() },
			],
			{ x: rect.right - 220, y: rect.bottom + 4 },
		);
		return;
	}
	const note = workspace.note;
	const inVault = note && !note.external && workspace.kind === 'Vault';
	new Menu(
		[
			{ title: 'Save', hint: hotkeyText('Note.Save'), run: () => void workspace.save(true) },
			...(inVault ? [{ title: 'Rename', hint: hotkeyText('Note.Rename'), run: () => noteHead.focusTitle() }] : []),
			{ title: 'Add a property', hint: hotkeyText('Property.Add'), run: () => addProperty() },
			...(viewMode === 'Read' ? [] : [{ title: 'Page layout', itemList: pageLayoutItemList() }]),
			{ title: 'Find in the note', hint: hotkeyText('Find.Open'), run: () => commandRegistry.run('Find.Open') },
			{
				title: 'Export',
				itemList: [
					{ title: 'OI note (.oi)', explain: 'The note as it is', run: () => commandRegistry.run('Note.Export') },
					{ title: 'Markdown (.md)', explain: 'For other apps; plots and drawings as pictures', run: () => void exportMarkdown() },
					{ title: 'Picture (.png)', explain: 'What the screen shows, in this theme', run: () => void exportPicture() },
					{ title: 'Print or save as PDF', run: () => window.print() },
				],
			},
			{ title: 'Split right', hint: hotkeyText('Pane.SplitRight'), separatorBefore: true, run: () => splitPane('Right') },
			{ title: 'Split down', run: () => splitPane('Bottom') },
			...(workspace.paneList.length > 1 ? [{ title: 'Scroll panes together', icon: setting.get('Editor.SyncScroll') !== false ? '✓' : undefined, run: () => setting.set('Editor.SyncScroll', setting.get('Editor.SyncScroll') === false) }] : []),
			...(inVault
				? [
						{ title: 'Copy link', separatorBefore: true, run: () => void navigator.clipboard?.writeText(`[[${linkTargetOf(stemOf(note.path))}]]`).then(() => toast(t('Link copied.'))) },
						{ title: workspace.deletesForGood() ? 'Delete the note' : 'Move to trash', danger: true, separatorBefore: true, run: () => void workspace.delete(note.path) },
					]
				: []),
			{ title: 'Close the tab', hint: hotkeyText('Tab.Close'), separatorBefore: true, run: () => void workspace.closeTab() },
		],
		{ x: rect.right - 220, y: rect.bottom + 4 },
	);
});

function openSetting(start?: string): void {
	if (!openSettingModal) {
		void settingLoad.then(() => openSetting(start));
		return;
	}
	openSettingModal({
		registry,
		themeRegistry,
		setting,
		appSettingList,
		commandRegistry,
		chooseTheme,
		setEnabled: (name, enabled) => {
			registry.setEnabled(name, enabled);
			enabledState[name] = enabled;
			writeJson(storageKey.Enabled, enabledState);
			applyChromeTheme();
		},
		statusItemList: () => statusBar.itemList(),
		onHotkeyChange: () => {
			registerMacro();
			hotkeyManager.setBindingList(setting.bindingList());
			applyTip();
		},
		keyText,
		// a color left at its default shows the theme's accent in its swatch
		defaultColor: () => normalizeHex(themeRegistry.current().token['Color.Accent'] ?? '') ?? '#8a6a1c',
		storageText: () => (workspace.vault && workspace.source?.kind === 'Folder' ? `this browser and in the vault (${workspace.source.name}/.oi/Setting.oi, .oi/Hotkey.oi)` : 'this browser'),
		version: appVersion,
		formatName,
		restart: () => void workspace.saveAll().then(() => location.reload()),
	}, (start as Parameters<typeof OpenSettingModal>[1]) ?? undefined);
}

/** The note's page layout (its `Layout:` header): Flow, or a Masonry Board, which uses the whole width. */
function pageLayoutOf(note: import('@octaether/core-model').NoteModel | undefined): PageLayout {
	const layout = readLayout(note?.noteProperty('Layout'));
	if (layout.type !== 'Board') return 'Flow';
	return layout.property.get('Arrange') === 'Masonry' ? 'Masonry' : 'Board';
}
type PageLayout = 'Flow' | 'Masonry' | 'Board';

/** A note that is just a Table or a Calendar (a Property block aside): it gets the window's width too. */
function fillsPage(note: import('@octaether/core-model').NoteModel | undefined): boolean {
	const list = (note?.document.itemList ?? []).filter((node) => node.type !== 'Property' && !(node.type === 'Text' && node.body.trim() === '' && node.childList.length === 0));
	return list.length === 1 && registry.blockType(list[0]!.type)?.fillPage === true;
}

function applyPageLayout(): void {
	pageElement.classList.toggle('wide', pageLayoutOf(model()) === 'Masonry' || fillsPage(model()));
}

/** Sets the note's page layout (one undo step); Flow takes the header away. */
function setPageLayout(layout: 'Flow' | 'Masonry'): void {
	const note = model();
	if (!note || viewMode === 'Read') return;
	note.setNoteProperty('Layout', layout === 'Flow' ? undefined : 'Board {Arrange: Masonry}');
	applyPageLayout();
}

function pageLayoutItemList(): MenuItem[] {
	const current = pageLayoutOf(model());
	const mark = (layout: PageLayout): string => (current === layout ? '✓' : '');
	return [
		{ title: 'Flow', explain: 'Blocks one under another, as in a document', icon: mark('Flow'), run: () => setPageLayout('Flow') },
		{ title: 'Masonry', explain: 'Cards in columns, Pinterest style', icon: mark('Masonry'), run: () => setPageLayout('Masonry') },
	];
}

/** Settings the app itself reads: text size, line length, the edit outline, the hover highlight. */
function applyEditorSetting(): void {
	const root = document.documentElement.style;
	// the note's own theme sets --oi-size-body on the note, so the app's size goes through its own variable
	root.setProperty('--app-note-size', String(setting.get('Appearance.FontSize') ?? '16px'));
	pageElement.classList.toggle('readable', setting.get('Editor.ReadableWidth') !== false);
	document.body.classList.toggle('no-block-outline', setting.get('Editor.BlockOutline') === false);
	// one color for every hover highlight (text, code, math, chemistry, diagrams), drawn see-through
	const hover = normalizeHex(String(setting.get('Appearance.HoverColor') ?? ''));
	root.setProperty('--oi-hover', setting.get('Appearance.HoverHighlight') === false ? 'transparent' : `color-mix(in srgb, ${hover ?? 'var(--oi-color-accent)'} ${hover ? 40 : 32}%, transparent)`);
}

const moduleSettingSet = new Set(registry.settingList().map((item) => item.setting.id));
setting.subscribe((id) => {
	if (id === '*' || /\.Alias(?:Marker)?$/.test(id)) {
		// an alias switched on, off, or to other symbols: open notes read their lines again
		session.close();
		for (const note of workspace.openNoteList()) note.model.reparse();
	}
	if (id === '*' || moduleSettingSet.has(id)) registry.touch();
	if (id === '*' || id === 'Appearance.AccentColor') applyAccentColor();
	if (id === '*' || id === tagColorSetting) applyTagColor();
	if (id === '*' || id === 'Theme.Active') applySavedTheme();
	if (id === '*' || id.startsWith('Editor.') || id.startsWith('Appearance.')) {
		applyEditorSetting();
		noteHead.refresh();
	}
	if (id === '*' || id.startsWith('Status.')) statusBar.schedule();
});

// ---------------------------------------------------------------- start

function applyTip(): void {
	for (const button of document.querySelectorAll<HTMLElement>('[data-tip]')) {
		const command = button.dataset.tip!;
		const key = hotkeyText(command);
		button.title = `${t(commandRegistry.get(command)?.title ?? '')}${key ? ` (${key})` : ''}`;
	}
	for (const button of document.querySelectorAll<HTMLElement>('.view-mode [data-mode]')) {
		const mode = button.dataset.mode!;
		const key = hotkeyText(mode === 'Source' ? 'View.Source' : 'View.Toggle');
		button.title = `${t(`${mode} view`)}${key ? ` (${key})` : ''}`;
	}
}

for (const [id, svg] of Object.entries({
	ribbonSidebar: icon.Sidebar,
	ribbonSwitcher: icon.Switch,
	ribbonSearch: icon.Search,
	ribbonGraph: icon.Graph,
	ribbonNew: icon.FilePlus,
	ribbonAI: icon.Sparkle,
	ribbonPalette: icon.Command,
	ribbonHelp: icon.Help,
	ribbonSetting: icon.Setting,
	viewBack: icon.Back,
	viewForward: icon.Forward,
	modeSource: icon.Source,
	modeEdit: icon.Edit,
	modeRead: icon.Read,
	moreButton: icon.More,
	gutterAdd: icon.Plus,
	gutterHandle: icon.Grip,
})) {
	element(id).innerHTML = svg;
}
applyTip();
applyChromeTheme();
applyEditorSetting();
// the AI button is there while the AI plugin is on
const showAIButton = (): void => void (element('ribbonAI').hidden = !registry.isEnabled('AI'));
registry.subscribe(showAIButton);
showAIButton();
host.setReadOnly(viewMode === 'Read');
element('sourceHost').hidden = viewMode !== 'Source';
noteElement.hidden = viewMode === 'Source';

const gutterControl = setupGutter({
	host,
	session,
	model,
	readOnly: () => viewMode !== 'Edit',
	showHandle: () => setting.get('Editor.BlockHandle') === true,
	onAdd: (key, x, y) => {
		const note = model();
		if (!note) return;
		new Menu(templateItemList((template) => insertBlock(template.source, { parentKey: note.placeOf(key).parentKey, afterKey: key })), { x, y, search: true });
	},
	onMenu: blockMenu,
});
const hoverControl = setupHoverHighlight({
	host,
	enabled: () => viewMode === 'Edit' && setting.get('Appearance.HoverHighlight') !== false && !document.body.classList.contains('dragging'),
});
setupFormatBar({
	session,
	model,
	format: applyFormat,
	color: openTextColor,
	hasColor: () => colorPicker() !== undefined,
	hotkey: hotkeyText,
});
closeAllMenu();
// popups belong to a spot on the page: the "/" menu follows its block when the view scrolls, and
// the other menus close when the user scrolls (not when the app scrolls a block into view)
element('viewContent').addEventListener('scroll', placeSlashMenu, { passive: true });
for (const type of ['wheel', 'touchmove'] as const) {
	element('viewContent').addEventListener(
		type,
		() => {
			if (currentMenu() && currentMenu() !== slashMenu) closeAllMenu();
		},
		{ passive: true },
	);
}
document.addEventListener('selectionchange', () => statusBar.schedule());

// saving never waits for you: leaving the page saves, and warns only when it can't
window.addEventListener('pagehide', () => void workspace.saveAll());
window.addEventListener('beforeunload', (event) => {
	const unsaved = workspace.openNoteList().some((note) => !workspace.canAutoSave(note) && workspace.isDirty(note) && !(workspace.kind === 'Vault' && note.external));
	if (unsaved) {
		event.preventDefault();
		event.returnValue = '';
	}
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') void workspace.saveAll();
});

// installable and usable offline (the page, scripts, and styles are cached on first visit); the
// app opens from that copy at once, and a new version, fetched meanwhile, is offered with Reload
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
	// A new version shows by itself when that loses nothing: right away while the page was only
	// opened (nothing clicked or typed yet), otherwise the next time the window is put aside with
	// every note saved and no block being edited. Until then a message offers Reload, and stays.
	let updateReady = false;
	let touched = false;
	let checkedAt = Date.now();
	const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
	const canReload = (): boolean => session.editingKey() === undefined && !workspace.openNoteList().some((note) => !workspace.canAutoSave(note) && workspace.isDirty(note));
	const reloadForUpdate = (): void => void workspace.saveAll().then(
		() => location.reload(),
		() => undefined,
	);
	for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => (touched = true), { capture: true, once: true, passive: true });
	navigator.serviceWorker.addEventListener('message', (event) => {
		if ((event.data as { type?: string } | null)?.type !== 'Updated' || updateReady) return;
		updateReady = true;
		if ((!touched || document.visibilityState === 'hidden') && canReload()) reloadForUpdate();
		else toast(t('A new version of Octaether Ink is ready.'), 86_400_000, { title: t('Reload'), run: reloadForUpdate });
	});
	const askWorker = (type: 'Version' | 'Check'): void => void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type, script }));
	// the worker may have fetched the new version before this page listened: it is asked once
	askWorker('Version');
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			if (updateReady && canReload()) reloadForUpdate();
			return;
		}
		// a window left open for days (an installed app) never loads the page again: coming back to it looks for a new version
		if (updateReady || Date.now() - checkedAt < 15 * 60_000) return;
		checkedAt = Date.now();
		askWorker('Check');
	});
}

// the installed app opens .oi files from the computer's file manager ("Open with Octaether Ink")
let launchedFile = false;
window.launchQueue?.setConsumer((params) => {
	const handle = params.files.find((item): item is FileSystemFileHandle => item.kind === 'file');
	if (!handle) return;
	launchedFile = true;
	void handle
		.getFile()
		.then(async (file) => {
			await workspace.openText(await file.text(), file.name, { handle });
			await rememberRecent({ id: createId(), kind: 'File', name: file.name, handle, time: Date.now() });
		})
		.catch(() => toast(tr`Couldn’t open “${handle.name}”.`));
});

/** What the app opens first: the last vault or file (when allowed), a kept draft, or the start screen. */
async function boot(): Promise<void> {
	// the language first: nothing is drawn in English and then again in yours
	// every module and plugin brings its own words for the language too
	await startLanguage(undefined, registry.definitionList());
	applyTip();
	sidebar.attach();
	updateLayout();
	tabBar.render();
	await startScreen.render();
	// a file opened from the computer's file manager wins over what was open last time
	if (launchedFile) return;
	if (setting.get('File.OpenLast') !== false) {
		const last = await lastEntry();
		// something was opened meanwhile (a click on the start screen, a launched file): that wins
		if (launchedFile || workspace.kind !== 'None') return;
		if (last) {
			if (await openRecent(last, false)) return;
			if (last.kind !== 'Browser') void startScreen.render(`Click “${last.name}” under Recent to open it again (the browser asks for access once).`);
			return;
		}
	}
	const draft = readJson<{ name?: string; text?: string; saved?: boolean } | undefined>(storageKey.Draft, undefined);
	if (draft?.text !== undefined && draft.saved === false && !launchedFile) await workspace.openText(draft.text, draft.name ?? 'Untitled.oi', { saved: false });
}

/** For tests and the console: the app's parts. */
export const app = { registry, host, session, workspace, setting, commandRegistry, sidebar, graphView, findBar, openVaultWith, openGuide, setView, view: () => viewMode, sourceEditor: () => sourceEditor, themeRegistry };
export const ready = boot().then(async () => {
	await Promise.all([graphLoad, settingLoad]);
	reopenSetting();
});

/** After a restart for a new language: Setting opens again on the page it was on, scrolled as it was, with the language field focused. */
function reopenSetting(): void {
	let saved: { page?: unknown; scroll?: unknown } | undefined;
	try {
		const text = sessionStorage.getItem('OctaetherInk.Setting.Reopen');
		sessionStorage.removeItem('OctaetherInk.Setting.Reopen');
		saved = text ? (JSON.parse(text) as { page?: unknown; scroll?: unknown }) : undefined;
	} catch {
		return;
	}
	if (!saved || typeof saved.page !== 'string') return;
	openSetting(saved.page);
	const body = document.querySelector<HTMLElement>('.setting-modal .setting-body');
	if (body && typeof saved.scroll === 'number') body.scrollTop = saved.scroll;
	body?.querySelector<HTMLSelectElement>('[data-language]')?.focus({ preventScroll: true });
}
