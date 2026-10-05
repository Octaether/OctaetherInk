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
	indentBlock,
	insertTemplate,
	installEditStyle,
	isApplePlatform,
	moveBlock,
	outdentBlock,
	toggleFormat,
	turnInto,
} from '@octaether/core-edit';
import { type HostService, Registry, RenderHost, type TemplateEntry, ThemeRegistry, applyThemeVariable, installBaseStyle, themeContext } from '@octaether/core-render';
import { type AssetResolver, type CommandDefinition, type Definition, type SettingDefinition, assetExtension } from '@octaether/core-sdk';
import { type FileSystem, MemoryFileSystem, Vault, baseName, extensionOf, isNote, joinPath, linkTargetOf, mediaKindOf, mediaTypeOf, nameProblem, parentPath, stemOf } from '@octaether/core-vault';
import { chemModule } from '@octaether/module-chem';
import { codeModule } from '@octaether/module-code';
import { diagramModule } from '@octaether/module-diagram';
import { htmlModule } from '@octaether/module-html';
import { layoutModule } from '@octaether/module-layout';
import { markdownModule } from '@octaether/module-markdown';
import { mathModule } from '@octaether/module-math';
import { imageModule, videoModule } from '@octaether/module-media';
import { openPropertyForm, propertyModule } from '@octaether/module-property';
import { textModule } from '@octaether/module-text';
import { themePlugin } from '@octaether/plugin-theme';
import { accentToken, normalizeHex, recentColorList, rememberColor } from './color';
import { BrowserFileSystem, DirectoryFileSystem, canOpenFolder, downloadBlob, downloadText, ensurePermission } from './file-system';
import { FindBar, NoteFindTarget, SourceFindTarget } from './find-bar';
import { setupFormatBar } from './format-bar';
import { GraphView } from './graph-view';
import { setupGutter } from './gutter';
import { setupHoverHighlight } from './hover-highlight';
import { icon } from './icon';
import { NoteHead, headerKeyList, propertyBlockOf, systemKeySet } from './note-head';
import { bestFuzzyScore, openCommandPalette, openPicker } from './palette';
import { SettingStore } from './setting-store';
import { openSettingModal } from './setting-modal';
import { Sidebar, vaultPathType } from './sidebar';
import { SourceEditor } from './source-editor';
import { StartScreen } from './start-screen';
import { StatusBar } from './status-bar';
import { type RecentEntry, clearLast, createId, forgetRecent, idbGet, idbSet, lastEntry, readJson, recentList, rememberRecent, storageKey, writeJson } from './storage';
import { TabBar } from './tab-bar';
import { Menu, type MenuItem, closeAllMenu, confirmDialog, currentMenu, escapeHtml, openModal, toast } from './ui';
import { type Tab, Workspace, newNoteText, nowText } from './workspace';
import { type ZipEntry, makeZip } from './zip';

export const appVersion = '1.0.0';
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
	{ id: 'Editor.ReadableWidth', title: 'Readable line length', type: 'Toggle', default: true, explain: 'Keeps lines about 750 px wide on a big screen. Off: text uses the whole window.' },
	{ id: 'Editor.BlockOutline', title: 'Outline the block being edited', type: 'Toggle', default: true, explain: 'A soft outline (and the block’s type) shows which block you’re editing, and a dashed one the block around it.' },
	{ id: 'Appearance.FontSize', title: 'Text size', type: 'Choice', choiceList: ['14px', '15px', '16px', '17px', '18px', '20px'], default: '16px', explain: 'The size of the note’s text; math, chemistry, and diagrams grow with it.' },
	{ id: 'Appearance.AccentColor', title: 'Accent colour', type: 'Color', default: '', explain: 'The colour of links, buttons, outlines, and tags. Pick one or type a hex code; ↺ goes back to the theme’s own (Octaether gold).' },
	{ id: 'Appearance.HoverHighlight', title: 'Highlight what the pointer is over', type: 'Toggle', default: true, explain: 'In the Edit view, the character (or the piece of an equation or drawing) under the pointer lights up, so you see where a click will land.' },
	{ id: 'Appearance.HoverColor', title: 'Hover highlight colour', type: 'Color', default: '', explain: 'The colour of that highlight, drawn see-through over the text. Default: the accent colour.' },
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

const setting = new SettingStore();
setting.define(appSettingList);

// ---------------------------------------------------------------- core

installBaseStyle();
installEditStyle();

const registry = new Registry();
const themeRegistry = new ThemeRegistry();
const commandRegistry = new CommandRegistry();
const enabledState = readJson<Record<string, boolean>>(storageKey.Enabled, {});
const definitionList: Definition[] = [
	textModule,
	propertyModule,
	layoutModule,
	mathModule,
	codeModule,
	chemModule,
	diagramModule,
	imageModule,
	videoModule,
	markdownModule,
	htmlModule,
	themePlugin,
];
for (const definition of definitionList) registry.add(definition, enabledState[definition.name] ?? true);
// the modules' own settings, and the alias switch and symbols of each block type that has aliases
setting.define(registry.settingList().map((item) => item.setting));

const service: HostService = {
	registerCommand: (command) => commandRegistry.register(command),
	registerTheme: (theme) => themeRegistry.register(theme),
	setting: (id) => setting.get(id),
	theme: () => themeContext(themeRegistry.current()),
	applyTheme: (name) => void themeRegistry.apply(name),
	themeList: () => themeRegistry.list(),
};
registry.attach(service);

// Theme.Active = System follows the device's light or dark appearance (as on phones and in
// Obsidian's "Adapt to system"). Picking a theme stops that; picking System brings it back.
const systemDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
let applyingSystemTheme = false;

function applySystemTheme(): void {
	if (setting.get('Theme.Active') !== 'System') return;
	applyingSystemTheme = true;
	themeRegistry.apply(systemDark?.matches ? 'Dark' : 'Light');
	applyingSystemTheme = false;
}

function chooseTheme(name: string): void {
	setting.set('Theme.Active', name);
	if (name === 'System') applySystemTheme();
	else themeRegistry.apply(name);
}

function applySavedTheme(): void {
	const saved = setting.get('Theme.Active');
	if (saved === 'System') applySystemTheme();
	else if (typeof saved === 'string') themeRegistry.apply(saved);
}

/** Your accent colour is laid over every theme (with a soft version mixed for light or dark). */
function applyAccentColor(): void {
	const hex = normalizeHex(String(setting.get('Appearance.AccentColor') ?? ''));
	themeRegistry.setOverride(hex ? (theme) => accentToken(hex, theme) : undefined);
}
applyAccentColor();
applySavedTheme();
systemDark?.addEventListener('change', applySystemTheme);

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
			toast('This note isn’t in the vault. Save it into the vault first (Ctrl+S).');
			return false;
		}
		return (await workspace.rename(note.path, name)) !== undefined;
	},
	onTitleDone: () => focusFirstBlock(),
	addProperty: () => addProperty(),
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

const graphView = new GraphView(element('graphHost'), {
	vault: () => workspace.vault,
	currentPath: () => {
		const note = workspace.tab?.note;
		return note && !note.external ? note.path : undefined;
	},
	openNote: (path) => void workspace.openNote(path),
	searchTag: (tag) => openVaultSearch(`tag:${tag}`),
	close: () => void workspace.hideGraph(),
});

const sidebar = new Sidebar(element('sidebar'), {
	workspace,
	openNote: (path, newTab) => {
		void workspace.openNote(path, { newTab });
		if (window.matchMedia?.('(max-width: 640px)').matches) setSidebar(false);
	},
	openFile: (path, newTab) => {
		workspace.openFile(path, { newTab });
		if (window.matchMedia?.('(max-width: 640px)').matches) setSidebar(false);
	},
	newNote: (folder) => void createNote(folder),
	notify: (message) => toast(message),
	openSearchResult: (path, query, matchCase, regex, newTab) => {
		void workspace.openNote(path, { newTab }).then((opened) => {
			if (opened) findBar.open(false, query, { matchCase, regex });
		});
	},
	vaultMenu: (x, y) => void openVaultMenu(x, y),
	copyLink: (path) => void navigator.clipboard?.writeText(linkTextOf(path)).then(() => toast('Link copied.')),
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
});

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
	element('startScreen').hidden = kind !== 'None' || workspace.tabList.length > 0;
	element('emptyView').hidden = !(kind === 'Vault' && !note && !graphOpen && !file);
	pageElement.hidden = !note || graphOpen;
	element('graphHost').hidden = !graphOpen;
	element('fileView').hidden = file === undefined;
	// the Source, Edit, and Read buttons belong to notes
	element('viewHeader').classList.toggle('no-mode', graphOpen || file !== undefined);
	element('tabBar').hidden = kind === 'None';
	// with no vault the sidebar offers vaults to open (shut unless you open it)
	const showSidebar = sidebar.isOpen();
	element('sidebar').hidden = !showSidebar;
	document.body.classList.toggle('sidebar-open', showSidebar);
	element('sidebar').style.width = `${sidebar.width()}px`;
	element('ribbonSidebar').classList.toggle('active', showSidebar);
	element('ribbonGraph').classList.toggle('active', graphOpen);
	element('viewHeader').classList.toggle('empty', !note && !graphOpen && !file);
	updateHeader();
	if (kind === 'Vault' && !note && !graphOpen && !file) renderEmptyView();
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
		const badge = note.external && workspace.kind === 'Vault' ? '<span class="view-badge" title="Not saved in this vault">outside vault</span>' : workspace.source?.kind === 'Guide' ? '<span class="view-badge" title="The guide lives in memory: changes stay until you close it">guide</span>' : '';
		title.innerHTML = `${folder ? `<span class="view-crumb">${escapeHtml(folder.split('/').join(' / '))} / </span>` : ''}<span class="view-crumb-name">${escapeHtml(stemOf(note.path))}</span>${badge}`;
	} else title.textContent = '';
	const name = graphShown() ? 'Graph view' : file ? baseName(file) : note ? stemOf(note.path) : '';
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
		if (viewMode === 'Source' && sourceEditor && !applyingSource) sourceEditor.setText(note.model.serialize());
		if (findBar.isOpen()) scheduleFindRefresh();
	});
	// show the page first: the title and the Source view measure their text
	updateLayout();
	noteHead.refresh();
	if (viewMode === 'Source') openSourceEditor();
	element('viewContent').scrollTop = tab?.scroll ?? 0;
	statusBar.schedule();
}

// ---------------------------------------------------------------- a file of the vault on its own

let fileViewPath: string | undefined;

/** Shows the picture, video, or sound in front, as Obsidian does; a click on a picture shows it at its real size. */
function renderFileView(): void {
	const view = element('fileView');
	const path = workspace.file;
	if (path === fileViewPath) return;
	fileViewPath = path;
	if (path === undefined) {
		view.replaceChildren();
		return;
	}
	const kind = mediaKindOf(path);
	view.innerHTML =
		'<div class="file-view-stage"><div class="file-view-message">Loading…</div></div>' +
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
			image.title = 'Click for the real size';
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
		toast('The graph shows the notes of a vault. Open a folder as a vault, your quick notes, or the welcome guide.');
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
	statusBar.schedule();
});

// ---------------------------------------------------------------- vaults and files

/** Opens a vault with the tabs it had; what was open stays on screen until it is ready. */
async function openVaultWith(fs: FileSystem, entry: RecentEntry): Promise<boolean> {
	try {
		// false: an open note has changes that can't be saved and you kept it
		if (!(await workspace.openVault(fs, { kind: entry.kind === 'Browser' ? 'Browser' : 'Folder', id: entry.id, name: entry.name, ...(entry.handle ? { handle: entry.handle as FileSystemDirectoryHandle } : {}) }, { restore: true }))) return false;
	} catch {
		toast(`Couldn’t open “${entry.name}”. It may have been moved or deleted.`);
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
		toast(folderMessage);
		return;
	}
	let parent = await idbGet<FileSystemDirectoryHandle>('State', 'VaultParent');
	const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve) => {
		let made: FileSystemDirectoryHandle | undefined;
		openModal(
			'dialog-modal vault-modal',
			(modal, close) => {
				modal.innerHTML =
					'<h2>Create new vault</h2>' +
					'<p class="dialog-text">A vault is a folder of notes on your computer. The app makes the folder; any other app can open its notes too.</p>' +
					'<label class="dialog-label">Name<input class="dialog-input" value="My vault" spellcheck="false"></label>' +
					'<div class="dialog-label">Location<div class="vault-location"><span class="vault-location-name"></span><button type="button" class="dialog-button" data-action="Choose">Choose</button></div></div>' +
					'<p class="dialog-problem" role="alert" hidden></p>' +
					'<div class="dialog-row"><button type="button" class="dialog-button" data-answer="No">Cancel</button><button type="button" class="dialog-button primary" data-answer="Yes">Create</button></div>';
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
						say(`The browser didn’t allow writing in “${place.name}”. Choose another place.`);
						return;
					}
					let existing: FileSystemDirectoryHandle | undefined;
					try {
						existing = await place.getDirectoryHandle(name);
					} catch {
						existing = undefined;
					}
					if (existing && !(await existing.keys().next()).done) {
						say(`“${place.name}” has a folder “${name}” with files in it already. Pick another name, or open it with Open folder as vault.`);
						return;
					}
					try {
						made = existing ?? (await place.getDirectoryHandle(name, { create: true }));
					} catch {
						say(`Couldn’t make the folder “${name}” in “${place.name}”.`);
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
	// a new vault starts with a note to write in (nothing is kept if it stays blank)
	if (handle && (await openFolderHandle(handle))) await createNote();
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
		toast(`Couldn’t write the notes into “${handle.name}”. They are still kept in this browser.`);
		return;
	}
	const noteCount = fileList.filter((file) => isNote(file.path)).length;
	if (!(await openFolderHandle(handle))) return;
	// all written: the browser's copies go
	for (const entry of vault.childList('')) await vault.deleteForever(entry.path);
	toast(`Moved ${noteCount} ${noteCount === 1 ? 'note' : 'notes'} into “${handle.name}”. They are no longer kept in the browser.`, 6000);
}

/** Downloads the notes kept in the browser (and their pictures) as one .zip, folders kept. */
async function downloadAll(): Promise<void> {
	const vault = workspace.vault;
	if (!vault) return;
	await workspace.saveAll();
	const entryList: ZipEntry[] = [];
	for (const file of await browserFileList(vault)) entryList.push({ path: file.path, data: new Uint8Array(await file.data.arrayBuffer()) });
	if (entryList.length === 0) {
		toast('There is nothing to download yet.');
		return;
	}
	// today's date where you are: "Quick note 2026-10-04.zip"
	downloadBlob(`${workspace.source?.name ?? 'Notes'} ${nowText().slice(0, 10)}.zip`, makeZip(entryList));
}

async function openFile(): Promise<void> {
	if (window.showOpenFilePicker) {
		try {
			const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Octaether Ink note', accept: { 'text/plain': ['.oi', '.md', '.txt'] } }] });
			if (!handle) return;
			const file = await handle.getFile();
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
	if (file) await workspace.openText(await file.text(), file.name, { keepVault: false });
	input.value = '';
});

async function openRecent(entry: RecentEntry, ask: boolean): Promise<boolean> {
	if (entry.kind === 'Browser') return openVaultWith(new BrowserFileSystem(entry.id, entry.name), entry);
	if (!entry.handle) return false;
	if (!(await ensurePermission(entry.handle, ask))) {
		if (ask) toast(`The browser didn’t allow access to “${entry.name}”.`);
		return false;
	}
	if (entry.kind === 'Folder') return openVaultWith(new DirectoryFileSystem(entry.handle as FileSystemDirectoryHandle), entry);
	try {
		const file = await (entry.handle as FileSystemFileHandle).getFile();
		await workspace.openText(await file.text(), file.name, { handle: entry.handle as FileSystemFileHandle });
		await rememberRecent({ ...entry, time: Date.now() });
		return true;
	} catch {
		toast(`Couldn’t find “${entry.name}”.`);
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

// The welcome guide: a small vault in memory, one note per module plus an overview, all linked,
// so links, tabs, and the graph work in it (with a picture for the Image guide). Changes stay
// until it is closed.
const guideFileMap = Object.fromEntries(
	Object.entries(import.meta.glob('../../../sample/Guide/*.{oi,svg}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(([path, text]) => [path.split('/').pop()!, text]),
);

async function openGuide(): Promise<void> {
	if (workspace.source?.kind === 'Guide') {
		await workspace.openNote('Welcome.oi');
		return;
	}
	if (!(await workspace.openVault(new MemoryFileSystem('Welcome guide', guideFileMap), { kind: 'Guide', id: 'guide', name: 'Welcome guide' }))) return;
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
		toast('Open a vault first: a pasted picture is saved as a file next to your notes.');
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
			toast(`Couldn’t save “${name}”: ${error instanceof Error ? error.message : String(error)}`);
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
	if (current) itemList.push({ title: current.name, icon: vaultIcon(current.kind), hint: '✓', run: () => undefined });
	for (const entry of await vaultEntryList()) {
		if (entry.id === current?.id) continue;
		itemList.push({ title: entry.name, icon: vaultIcon(entry.kind), ...(entry.kind === 'Browser' ? { hint: 'in this browser' } : {}), run: () => void openRecent(entry, true) });
	}
	itemList.push(
		{ title: 'Create new vault', icon: icon.FolderPlus, separatorBefore: true, run: () => void createVault() },
		{ title: 'Open folder as vault', icon: icon.FolderOpen, hint: hotkeyText('Vault.Open'), run: () => void openFolder() },
	);
	if (current) itemList.push({ title: current.kind === 'Guide' ? 'Close the guide' : 'Close vault', separatorBefore: true, run: () => void closeVault() });
	const menu = new Menu(itemList, { x, y });
	// the menu opens above the button
	const rect = menu.element.getBoundingClientRect();
	menu.place(x, Math.max(8, y - rect.height), y);
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
	const index = workspace.tabList.indexOf(tab);
	const note = tab.note;
	const inVault = note && !note.external && workspace.kind === 'Vault';
	new Menu(
		[
			{ title: 'Close', hint: hotkeyText('Tab.Close'), run: () => void workspace.closeTab(tab.id) },
			{ title: 'Close every other tab', run: () => void closeTabList(workspace.tabList.filter((item) => item !== tab)) },
			{ title: 'Close every tab to the right', run: () => void closeTabList(workspace.tabList.slice(index + 1)) },
			...(inVault
				? [
						{ title: 'Copy link', separatorBefore: true, run: () => void navigator.clipboard?.writeText(`[[${linkTargetOf(stemOf(note.path))}]]`).then(() => toast('Link copied.')) },
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
		toast('Quick notes have no trash: a deleted one comes back only with the Undo button shown for a few seconds right after deleting it.', 6000);
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
						toast(`Restored “${stemOf(path)}”.`);
						render();
					});
				});
			}
			for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
				button.addEventListener('click', () => {
					const entry = list[Number(button.dataset.remove)]!;
					void confirmDialog(`Delete “${stemOf(entry.path)}” for good?`, 'Delete', true).then((ok) => (ok ? vault.deleteForever(entry.path).then(render) : undefined));
				});
			}
			modal.querySelector('[data-action="Empty"]')?.addEventListener('click', () => {
				void confirmDialog('Empty the trash? Everything in it is deleted for good.', 'Empty trash', true).then((ok) => (ok ? vault.emptyTrash().then(render) : undefined));
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
async function followLink(target: string, newTab: boolean): Promise<void> {
	const vault = workspace.vault;
	if (!vault) {
		toast('Links between notes work inside a vault. Open a folder as a vault, your quick notes, or the welcome guide.');
		return;
	}
	const name = target.split('#')[0]!.trim();
	const from = workspace.note && !workspace.note.external ? workspace.note.path : undefined;
	const path = vault.resolve(name, from);
	if (path) {
		await workspace.openNote(path, { newTab });
		return;
	}
	// [[Cell.png]]: a picture, a video, or a sound opens on its own, as in Obsidian
	const file = vault.findFile(name, from ?? '');
	if (file && mediaKindOf(file)) {
		workspace.openFile(file, { newTab });
		return;
	}
	if (file) {
		toast(`No module opens .${file.split('.').pop()} files yet.`);
		return;
	}
	if (await confirmDialog(`“${name}” doesn’t exist yet. Create it?`, 'Create')) await createNamedNote(name.split('/').pop()!, name.includes('/') ? parentPath(`${name}.oi`) : workspace.newNoteFolder(), newTab);
}

host.root.addEventListener('click', (event) => {
	const target = event.target as Element;
	const link = target.closest<HTMLElement>('[data-oi-link]');
	if (link) {
		event.preventDefault();
		void followLink(link.dataset.oiLink!, event.ctrlKey || event.metaKey);
		return;
	}
	const tag = target.closest<HTMLElement>('[data-oi-tag]');
	if (tag && viewMode !== 'Edit') openVaultSearch(`tag:${tag.dataset.oiTag}`);
});
// a middle-click on a link opens it in a new tab
host.root.addEventListener('auxclick', (event) => {
	const link = (event.target as Element).closest<HTMLElement>('[data-oi-link]');
	if (event.button !== 1 || !link) return;
	event.preventDefault();
	void followLink(link.dataset.oiLink!, true);
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
	toast(`Moved ${headerKeyList(note).length === 0 ? 'them' : 'what could be moved'} into a Property block. Ctrl+Z puts them back.`);
}

function templateItemList(run: (template: TemplateEntry) => void): MenuItem[] {
	return registry.templateList().map((template) => ({
		title: template.title,
		icon: template.icon,
		...(template.explain ? { explain: template.explain } : {}),
		keywordList: [...(template.keywordList ?? []), template.type],
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

function colorItemList(): MenuItem[] {
	const swatch = (color: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
	return [
		...['Accent', 'Danger', 'Success', 'Warning', 'TextMuted'].map((color) => ({ title: color === 'TextMuted' ? 'Muted' : color, icon: swatch(`var(--oi-color-${color === 'TextMuted' ? 'text-muted' : color.toLowerCase()})`), run: () => applyColor(color) })),
		// colours of your own: the last few you used, and any hex code
		...recentColorList().map((hex, index) => ({ title: hex, icon: swatch(hex), separatorBefore: index === 0, run: () => applyColor(hex) })),
		{ title: 'Custom colour', icon: '#', separatorBefore: recentColorList().length === 0, run: () => void pickCustomColor() },
		{ title: 'No colour', separatorBefore: true, run: () => applyColor(undefined) },
	];
}

/** Asks for a colour (a picker and a hex code) for the selected text. */
async function pickCustomColor(): Promise<void> {
	const range = session.textRange();
	const hex = await new Promise<string | undefined>((resolve) => {
		let answer: string | undefined;
		openModal(
			'dialog-modal',
			(modal, close) => {
				const start = recentColorList()[0] ?? '#b5452c';
				modal.innerHTML =
					'<p class="dialog-text">A colour for the selected text: pick it, or type a hex code.</p>' +
					`<div class="color-control color-dialog"><input type="color" class="color-pick" value="${start}" aria-label="Pick a colour"><input class="dialog-input color-hex" value="${start}" maxlength="7" spellcheck="false" aria-label="Hex code"></div>` +
					'<div class="dialog-row"><button type="button" class="dialog-button" data-answer="No">Cancel</button><button type="button" class="dialog-button primary" data-answer="Yes">Colour it</button></div>';
				const picker = modal.querySelector<HTMLInputElement>('.color-pick')!;
				const text = modal.querySelector<HTMLInputElement>('.color-hex')!;
				picker.addEventListener('input', () => {
					text.value = picker.value;
				});
				text.addEventListener('input', () => {
					const valid = normalizeHex(text.value);
					if (valid) picker.value = valid;
				});
				const finish = (keep: boolean): void => {
					answer = keep ? normalizeHex(text.value) : undefined;
					if (keep && !answer) {
						text.focus();
						return;
					}
					close();
				};
				text.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') finish(true);
				});
				for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-answer]')) button.addEventListener('click', () => finish(button.dataset.answer === 'Yes'));
				text.focus();
				text.select();
			},
			() => resolve(answer),
		);
	});
	if (!hex || !range) return;
	rememberColor(hex);
	const note = model();
	if (!note || note.get(range.key)?.type !== 'Text') return;
	session.replace(range.key, (body) => colorRange(body, range.start, range.end, hex));
}

function applyFormat(kind: FormatKind): void {
	const note = model();
	const range = session.textRange();
	if (!note || !range || range.start === range.end || note.get(range.key)?.type !== 'Text') return;
	session.replace(range.key, (body) => toggleFormat(body, range.start, range.end, kind));
}

function applyColor(color: string | undefined): void {
	const note = model();
	const range = session.textRange();
	if (!note || !range || range.start === range.end || note.get(range.key)?.type !== 'Text') return;
	if (color?.startsWith('#')) rememberColor(color);
	session.replace(range.key, (body) => colorRange(body, range.start, range.end, color));
}

function blockMenu(key: string, x: number, y: number): void {
	const note = model();
	if (!note?.get(key) || viewMode !== 'Edit') return;
	const node = note.get(key)!;
	const range = session.textRange();
	const hasText = range !== undefined && range.key === key && range.start !== range.end && node.type === 'Text';
	const container = registry.blockType(node.type)?.layout !== undefined;
	const itemList: MenuItem[] = [];
	if (hasText) itemList.push({ title: 'Format', itemList: formatItemList() }, { title: 'Colour', itemList: colorItemList() });
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
	itemList.push({ title: 'Add block below', icon: icon.Plus, itemList: templateItemList((template) => insertBlock(template.source, { parentKey: note.placeOf(key).parentKey, afterKey: key })) });
	// anywhere inside a column (or on a grid) a new column can go beside it
	let columnKey: string | undefined;
	for (let at: BlockNode | null | undefined = node; at; at = note.parentOf(at.key)) {
		if (at.type === 'Column') {
			columnKey = at.key;
			break;
		}
	}
	if (node.type === 'Grid') itemList.push({ title: 'Add column', run: () => insertColumn(key, 'Right') });
	else if (columnKey) {
		const column = columnKey;
		itemList.push({ title: 'Add column to the left', run: () => insertColumn(column, 'Left') }, { title: 'Add column to the right', run: () => insertColumn(column, 'Right') });
	}
	itemList.push(
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

setting.defaultBindingList = [
	inBrowserTab ? { key: 'Alt+N', command: 'Note.Create', when: 'NotTyping' } : { key: 'Mod+N', command: 'Note.Create' },
	inBrowserTab ? { key: 'Alt+W', command: 'Tab.Close', when: 'NotTyping' } : { key: 'Mod+W', command: 'Tab.Close' },
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
	{ key: 'Mod+Y', command: 'Edit.Redo', when: 'GlobalUndo' },
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
		toast(`No setting “${id}”.`);
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
	toast(`${definition.title}: ${value === true ? 'On' : value === false ? 'Off' : String(value)}`);
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
	{ id: 'Tab.Close', title: 'Close the tab', run: () => void workspace.closeTab() },
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
	{ id: 'Setting.Open', title: 'Open Setting', run: () => openSetting() },
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
				{ title: 'Copy link', run: () => void navigator.clipboard?.writeText(linkTextOf(file)).then(() => toast('Link copied.')) },
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
			{ title: 'Find in the note', hint: hotkeyText('Find.Open'), run: () => commandRegistry.run('Find.Open') },
			{ title: 'Export (download .oi)', run: () => commandRegistry.run('Note.Export') },
			{ title: 'Print or save as PDF', run: () => window.print() },
			...(inVault
				? [
						{ title: 'Copy link', run: () => void navigator.clipboard?.writeText(`[[${linkTargetOf(stemOf(note.path))}]]`).then(() => toast('Link copied.')) },
						{ title: workspace.deletesForGood() ? 'Delete the note' : 'Move to trash', danger: true, separatorBefore: true, run: () => void workspace.delete(note.path) },
					]
				: []),
			{ title: 'Close the tab', hint: hotkeyText('Tab.Close'), separatorBefore: true, run: () => void workspace.closeTab() },
		],
		{ x: rect.right - 220, y: rect.bottom + 4 },
	);
});

function openSetting(): void {
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
		// a colour left at its default shows the theme's accent in its swatch
		defaultColor: () => normalizeHex(themeRegistry.current().token['Color.Accent'] ?? '') ?? '#8a6a1c',
		storageText: () => (workspace.vault && workspace.source?.kind === 'Folder' ? `this browser and in the vault (${workspace.source.name}/.oi/Setting.oi, .oi/Hotkey.oi)` : 'this browser'),
		version: appVersion,
		formatName,
	});
}

let shownThemeName = themeRegistry.current().name;
themeRegistry.subscribe((theme) => {
	// a theme picked by hand (menu, Theme.Cycle) sticks; one applied for System doesn't, and neither
	// does the same theme drawn again (a new accent colour), or System would quietly become Light
	if (!applyingSystemTheme && theme.name !== shownThemeName && setting.get('Theme.Active') !== theme.name) setting.set('Theme.Active', theme.name);
	shownThemeName = theme.name;
	applyChromeTheme();
});

/** Settings the app itself reads: text size, line length, the edit outline, the hover highlight. */
function applyEditorSetting(): void {
	const root = document.documentElement.style;
	// the note's own theme sets --oi-size-body on the note, so the app's size goes through its own variable
	root.setProperty('--app-note-size', String(setting.get('Appearance.FontSize') ?? '16px'));
	pageElement.classList.toggle('readable', setting.get('Editor.ReadableWidth') !== false);
	document.body.classList.toggle('no-block-outline', setting.get('Editor.BlockOutline') === false);
	// one colour for every hover highlight (text, code, math, chemistry, diagrams), drawn see-through
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
		button.title = `${commandRegistry.get(command)?.title ?? ''}${key ? ` (${key})` : ''}`;
	}
	for (const button of document.querySelectorAll<HTMLElement>('.view-mode [data-mode]')) {
		const mode = button.dataset.mode!;
		const key = hotkeyText(mode === 'Source' ? 'View.Source' : 'View.Toggle');
		button.title = `${mode} view${key ? ` (${key})` : ''}`;
	}
}

for (const [id, svg] of Object.entries({
	ribbonSidebar: icon.Sidebar,
	ribbonSwitcher: icon.Switch,
	ribbonSearch: icon.Search,
	ribbonGraph: icon.Graph,
	ribbonNew: icon.FilePlus,
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
host.setReadOnly(viewMode === 'Read');
element('sourceHost').hidden = viewMode !== 'Source';
noteElement.hidden = viewMode === 'Source';

const gutterControl = setupGutter({
	host,
	session,
	model,
	readOnly: () => viewMode !== 'Edit',
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
	color: (x, y) => new Menu(colorItemList(), { x, y }),
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
	let offered = false;
	navigator.serviceWorker.addEventListener('message', (event) => {
		if ((event.data as { type?: string } | null)?.type !== 'Updated' || offered) return;
		offered = true;
		toast('A new version of Octaether Ink is ready.', 20000, { title: 'Reload', run: () => location.reload() });
	});
	// the worker may have fetched the new version before this page listened: it is asked once
	void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: 'Version', script: document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src }));
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
		.catch(() => toast(`Couldn’t open “${handle.name}”.`));
});

/** What the app opens first: the last vault or file (when allowed), a kept draft, or the start screen. */
async function boot(): Promise<void> {
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
export const ready = boot();
