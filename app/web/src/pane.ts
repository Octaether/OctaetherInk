// Split panes, loaded once the screen splits (or a tab is first dragged): how the panes share the
// screen (splitters to drag, a double-click shares evenly), what a pane without the focus shows (its
// own tabs, its note's name and view buttons, the note drawn live as it changes, or its source), a
// tab dropped on a pane's side (a new pane there) or middle (into it), and scrolling kept together
// while two panes show the same note (Source beside Edit, say).
//
// The pane with the focus shows the app's own parts (its tab bar, header, and view, with the editor),
// moved into it; a click in another pane gives that one the focus, and the parts move there.

import type { NoteModel } from '@octaether/core-model';
import { type Registry, RenderHost, type ThemeRegistry } from '@octaether/core-render';
import { t } from '@octaether/core-sdk';
import { icon } from './icon';
import { TabBar, draggedTab, tabTitle } from './tab-bar';
import { escapeHtml } from './ui';
import type { PaneLayout, PaneSide, Tab, Workspace } from './workspace';

export interface PaneHost {
	workspace: Workspace;
	registry: Registry;
	themeRegistry: ThemeRegistry;
	/** Where the panes go (the workspace's own box). */
	root: HTMLElement;
	/** The parts of the pane with the focus: they move into it. */
	tabBar: HTMLElement;
	header: HTMLElement;
	content: HTMLElement;
	/** How the pane with the focus shows a note, and to change it. */
	mode(): string;
	setMode(mode: string): void;
	newNote(): void;
	closeTab(id: string): void;
	tabMenu(tab: Tab, x: number, y: number): void;
	/** Scrolling kept together while two panes show one note. */
	syncScroll(): boolean;
}

type Mode = 'Source' | 'Edit' | 'Read';
const modeList: Mode[] = ['Source', 'Edit', 'Read'];

/** A pane without the focus: its tabs, its note's name and view buttons, and the note drawn (not edited until it has the focus). */
class PaneView {
	readonly element: HTMLElement;
	readonly content: HTMLElement;
	private readonly tabBar: TabBar;
	private readonly head: HTMLElement;
	private readonly page: HTMLElement;
	/** The note's box; the note is drawn in a box of its own inside (the renderer owns that one's classes). */
	private readonly noteBox: HTMLElement;
	private readonly noteRoot: HTMLElement;
	private readonly source: HTMLElement;
	private readonly title: HTMLElement;
	private readonly renderHost: RenderHost;
	private shownModel: NoteModel | undefined;
	private shownTab: Tab | undefined;
	private unsubscribe: (() => void) | undefined;
	private sourceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		readonly paneId: string,
		private readonly host: PaneHost,
	) {
		this.element = document.createElement('section');
		this.element.className = 'pane';
		this.element.dataset.pane = paneId;
		const bar = document.createElement('div');
		bar.className = 'tab-bar';
		this.head = document.createElement('header');
		this.head.className = 'pane-head';
		this.content = document.createElement('div');
		this.content.className = 'view-content pane-view';
		this.page = document.createElement('div');
		this.page.className = 'page readable pane-page';
		this.noteBox = document.createElement('div');
		this.noteBox.className = 'pane-note';
		this.noteRoot = document.createElement('div');
		this.noteBox.append(this.noteRoot);
		this.source = document.createElement('div');
		this.source.className = 'source-editor pane-source';
		this.title = document.createElement('div');
		this.title.className = 'inline-title pane-note-title';
		this.page.append(this.title, this.noteBox, this.source);
		this.content.append(this.page);
		this.element.append(bar, this.head, this.content);
		this.renderHost = new RenderHost(this.noteRoot, host.registry, host.themeRegistry);
		this.renderHost.setReadOnly(true);
		this.tabBar = new TabBar(bar, {
			workspace: host.workspace,
			pane: () => this.paneId,
			newNote: () => host.newNote(),
			closeTab: (id) => host.closeTab(id),
			menu: (tab, x, y) => host.tabMenu(tab, x, y),
			onDragStart: () => armDrop(host),
		});
		// a click anywhere in it gives it the focus; a view button also sets how it shows the note
		this.element.addEventListener(
			'pointerdown',
			(event) => {
				const target = event.target as Element;
				if (target.closest('.tab-close, .tab-new')) return;
				const mode = target.closest<HTMLElement>('[data-pane-mode]')?.dataset.paneMode;
				const tab = target.closest<HTMLElement>('.tab')?.dataset.id;
				if (tab) return;
				host.workspace.focusPane(this.paneId);
				if (mode) host.setMode(mode);
			},
			true,
		);
		this.content.addEventListener('scroll', () => followScroll(host, this.content), { passive: true });
	}

	/** Draws what the pane shows, if that changed (and its tabs and name every time). */
	update(): void {
		const workspace = this.host.workspace;
		this.tabBar.render();
		const tab = workspace.activeTabOf(this.paneId);
		const pane = workspace.paneList.find((item) => item.id === this.paneId);
		const mode = (pane?.mode as Mode | undefined) ?? 'Edit';
		const note = tab?.view === 'Note' ? tab.note : undefined;
		const noMode = !note;
		this.head.innerHTML =
			`<span class="pane-title">${escapeHtml(tab ? tabTitle(tab) : '')}</span>` +
			(noMode ? '' : `<span class="pane-mode">${modeList.map((item) => `<button type="button" class="icon-button${item === mode ? ' active' : ''}" data-pane-mode="${item}" aria-pressed="${item === mode}" title="${escapeHtml(t(`${item} view`))}" aria-label="${escapeHtml(t(`${item} view`))}">${icon[item]}</button>`).join('')}</span>`);
		if (tab !== this.shownTab && this.shownTab) this.shownTab.scroll = this.content.scrollTop;
		const model = note?.model;
		if (model !== this.shownModel || tab !== this.shownTab) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
			this.shownTab = tab;
			this.shownModel = model;
			if (model) {
				this.renderHost.mount(model);
				this.unsubscribe = model.subscribe(() => this.scheduleSource());
			} else this.renderHost.unmount();
			requestAnimationFrame(() => (this.content.scrollTop = tab?.scroll ?? 0));
		}
		this.page.hidden = !note;
		this.page.dataset.paneMode = mode;
		this.renderHost.setReadOnly(true);
		this.noteBox.hidden = mode === 'Source';
		this.title.hidden = mode === 'Source';
		this.title.textContent = note ? (note.path.split('/').pop() ?? '').replace(/\.oi$/, '') : '';
		this.source.hidden = mode !== 'Source';
		if (mode === 'Source') this.drawSource();
		this.content.dataset.empty = note ? '' : tab ? t('Click to show it here') : t('No note is open');
	}

	private scheduleSource(): void {
		if (this.source.hidden) return;
		clearTimeout(this.sourceTimer);
		this.sourceTimer = setTimeout(() => this.drawSource(), 60);
	}

	/** The note as text, a line each (read only: the focus gives the editor). */
	private drawSource(): void {
		const text = this.shownModel?.serialize() ?? '';
		this.source.innerHTML = `<div class="source-lines">${text
			.split('\n')
			.map((line) => `<div class="source-line">${escapeHtml(line) || '<br>'}</div>`)
			.join('')}</div>`;
	}

	model(): NoteModel | undefined {
		return this.shownModel;
	}

	mode(): Mode {
		return (this.host.workspace.paneList.find((item) => item.id === this.paneId)?.mode as Mode | undefined) ?? 'Edit';
	}

	destroy(): void {
		this.unsubscribe?.();
		clearTimeout(this.sourceTimer);
		this.renderHost.unmount();
		this.element.remove();
	}
}

const viewMap = new Map<string, PaneView>();
let focusSection: HTMLElement | undefined;

/** Builds the panes as the workspace's layout says (or puts the app's parts back when there is one pane). */
export function layoutPane(host: PaneHost): void {
	const workspace = host.workspace;
	let paneRoot = host.root.querySelector<HTMLElement>(':scope > .pane-root');
	if (workspace.paneList.length < 2) {
		for (const view of viewMap.values()) view.destroy();
		viewMap.clear();
		host.root.append(host.tabBar, host.header, host.content);
		paneRoot?.remove();
		host.content.classList.remove('pane-view');
		return;
	}
	if (!paneRoot) {
		paneRoot = document.createElement('div');
		paneRoot.className = 'pane-root';
		host.root.append(paneRoot);
	}
	// panes gone go; panes new come
	for (const [id, view] of viewMap) {
		if (!workspace.paneList.some((pane) => pane.id === id) || id === workspace.paneId) {
			view.destroy();
			viewMap.delete(id);
		}
	}
	if (!focusSection) {
		focusSection = document.createElement('section');
		focusSection.className = 'pane focused';
		host.content.addEventListener('scroll', () => followScroll(host, host.content), { passive: true });
	}
	focusSection.dataset.pane = workspace.paneId;
	focusSection.append(host.tabBar, host.header, host.content);
	const build = (layout: PaneLayout): HTMLElement => {
		if (layout.kind === 'Pane') {
			if (layout.pane === workspace.paneId) return focusSection!;
			let view = viewMap.get(layout.pane);
			if (!view) {
				view = new PaneView(layout.pane, host);
				viewMap.set(layout.pane, view);
			}
			return view.element;
		}
		const split = document.createElement('div');
		split.className = 'pane-split';
		split.dataset.direction = layout.direction;
		layout.childList.forEach((child, index) => {
			if (index > 0) split.append(splitterOf(host, layout, index));
			const part = build(child);
			part.style.flex = `${layout.sizeList[index] ?? 1} 1 0px`;
			split.append(part);
		});
		return split;
	};
	paneRoot.replaceChildren(build(workspace.layout));
	refreshPane(host);
}

/** Draws each pane without the focus again (its tabs, and its note if that changed). */
export function refreshPane(host: PaneHost): void {
	for (const view of viewMap.values()) view.update();
}

/** A bar between two parts of a split: drag it to share differently, double-click to share evenly. */
function splitterOf(host: PaneHost, split: Extract<PaneLayout, { kind: 'Split' }>, index: number): HTMLElement {
	const bar = document.createElement('div');
	bar.className = 'pane-splitter';
	bar.setAttribute('role', 'separator');
	bar.setAttribute('aria-orientation', split.direction === 'Row' ? 'vertical' : 'horizontal');
	bar.addEventListener('dblclick', () => {
		host.workspace.resizePane(
			split,
			split.childList.map(() => 1),
		);
		layoutPane(host);
	});
	bar.addEventListener('pointerdown', (event) => {
		event.preventDefault();
		const before = bar.previousElementSibling as HTMLElement;
		const after = bar.nextElementSibling as HTMLElement;
		const row = split.direction === 'Row';
		const start = row ? event.clientX : event.clientY;
		const beforeSize = row ? before.offsetWidth : before.offsetHeight;
		const afterSize = row ? after.offsetWidth : after.offsetHeight;
		const shared = split.sizeList[index - 1]! + split.sizeList[index]!;
		bar.setPointerCapture(event.pointerId);
		bar.classList.add('dragging');
		let sizeList = [...split.sizeList];
		const move = (moveEvent: PointerEvent): void => {
			// each keeps at least 160 px
			const shift = Math.max(160 - beforeSize, Math.min(afterSize - 160, (row ? moveEvent.clientX : moveEvent.clientY) - start));
			const part = (beforeSize + shift) / (beforeSize + afterSize);
			sizeList = [...split.sizeList];
			sizeList[index - 1] = shared * part;
			sizeList[index] = shared * (1 - part);
			before.style.flex = `${sizeList[index - 1]} 1 0px`;
			after.style.flex = `${sizeList[index]} 1 0px`;
		};
		const end = (): void => {
			bar.classList.remove('dragging');
			bar.removeEventListener('pointermove', move);
			host.workspace.resizePane(split, sizeList);
		};
		bar.addEventListener('pointermove', move);
		bar.addEventListener('pointerup', end, { once: true });
		bar.addEventListener('pointercancel', end, { once: true });
	});
	return bar;
}

// ------------------------------------------------------------ a tab dropped on a pane

let dropArmed = false;
let dropMark: HTMLElement | undefined;

/** Where on a pane a tab lands: within a quarter of a side, beside it; else into it. */
function sideAt(rect: DOMRect, x: number, y: number): PaneSide {
	const left = (x - rect.left) / rect.width;
	const top = (y - rect.top) / rect.height;
	const nearest = Math.min(left, 1 - left, top, 1 - top);
	if (nearest > 0.25) return 'Center';
	if (nearest === left) return 'Left';
	if (nearest === 1 - left) return 'Right';
	return nearest === top ? 'Top' : 'Bottom';
}

/** From the first tab dragged on: a pane's view takes a tab, showing where it would go. */
export function armDrop(host: PaneHost): void {
	if (dropArmed) return;
	dropArmed = true;
	const paneOf = (target: Element): { id: string; view: HTMLElement } | undefined => {
		const view = target.closest<HTMLElement>('.view-content');
		if (!view || !host.root.contains(view)) return undefined;
		const id = view.closest<HTMLElement>('.pane')?.dataset.pane ?? host.workspace.paneId;
		return { id, view };
	};
	host.root.addEventListener('dragover', (event) => {
		if (!draggedTab()) return;
		const pane = paneOf(event.target as Element);
		if (!pane) return;
		event.preventDefault();
		const rect = pane.view.getBoundingClientRect();
		const side = sideAt(rect, event.clientX, event.clientY);
		dropMark ??= Object.assign(document.createElement('div'), { className: 'pane-drop' });
		document.body.append(dropMark);
		const half = { Left: [0, 0, 0.5, 1], Right: [0.5, 0, 0.5, 1], Top: [0, 0, 1, 0.5], Bottom: [0, 0.5, 1, 0.5], Center: [0, 0, 1, 1] }[side];
		Object.assign(dropMark.style, { left: `${rect.left + rect.width * half[0]!}px`, top: `${rect.top + rect.height * half[1]!}px`, width: `${rect.width * half[2]!}px`, height: `${rect.height * half[3]!}px` });
	});
	const clear = (): void => dropMark?.remove();
	host.root.addEventListener('dragleave', (event) => {
		if (!(event.relatedTarget instanceof Node) || !host.root.contains(event.relatedTarget)) clear();
	});
	document.addEventListener('dragend', clear);
	host.root.addEventListener('drop', (event) => {
		const id = draggedTab();
		clear();
		if (!id) return;
		const pane = paneOf(event.target as Element);
		if (!pane) return;
		event.preventDefault();
		const side = sideAt(pane.view.getBoundingClientRect(), event.clientX, event.clientY);
		if (side === 'Center') host.workspace.moveTab(id, host.workspace.paneTabList(pane.id).length, pane.id);
		else host.workspace.splitPane(side, { paneId: pane.id, tabId: id });
	});
}

// ------------------------------------------------------------ scrolling kept together

let following: HTMLElement | undefined;
let followTimer: ReturnType<typeof setTimeout> | undefined;

interface Scroller {
	element: HTMLElement;
	model: NoteModel;
	source: boolean;
}

/** The scrollers showing a note: the pane with the focus, and each other pane. */
function scrollerList(host: PaneHost): Scroller[] {
	const list: Scroller[] = [];
	const model = host.workspace.note?.model;
	if (model && host.content.isConnected) list.push({ element: host.content, model, source: host.mode() === 'Source' });
	for (const view of viewMap.values()) {
		const shown = view.model();
		if (shown && view.element.isConnected) list.push({ element: view.content, model: shown, source: view.mode() === 'Source' });
	}
	return list;
}

/** Each top-level block's first line in the note's text, found in order. */
function lineMapOf(model: NoteModel): Map<string, number> {
	const lineList = model.serialize().split('\n');
	const map = new Map<string, number>();
	let at = 0;
	for (const node of model.document.itemList) {
		const first = model.sourceOf(node.key).split('\n')[0]!.trim();
		for (let line = at; line < lineList.length; line++) {
			if (lineList[line]!.trim() !== first) continue;
			map.set(node.key, line);
			at = line + 1;
			break;
		}
	}
	return map;
}

/** The top-level blocks of a scroller, each with where it starts and ends in the scroller. */
function placeListOf(scroller: Scroller): { key: string; top: number; bottom: number }[] {
	const base = scroller.element.getBoundingClientRect().top - scroller.element.scrollTop;
	const list: { key: string; top: number; bottom: number }[] = [];
	if (scroller.source) {
		const lineElementList = scroller.element.querySelectorAll<HTMLElement>('.source-line');
		const entryList = [...lineMapOf(scroller.model)].sort((a, b) => a[1] - b[1]);
		entryList.forEach(([key, line], index) => {
			const first = lineElementList[line];
			const last = lineElementList[(entryList[index + 1]?.[1] ?? lineElementList.length) - 1] ?? first;
			if (first && last) list.push({ key, top: first.getBoundingClientRect().top - base, bottom: last.getBoundingClientRect().bottom - base });
		});
		return list;
	}
	const keySet = new Set(scroller.model.document.itemList.map((node) => node.key));
	for (const frame of scroller.element.querySelectorAll<HTMLElement>('.oi-frame[data-oi-key]')) {
		const key = frame.dataset.oiKey!;
		if (!keySet.has(key)) continue;
		const rect = frame.getBoundingClientRect();
		list.push({ key, top: rect.top - base, bottom: rect.bottom - base });
	}
	return list;
}

/** One pane scrolled: the others showing the same note go to the same block, as far into it. */
function followScroll(host: PaneHost, element: HTMLElement): void {
	if (!host.syncScroll() || following === element) return;
	const list = scrollerList(host);
	const from = list.find((scroller) => scroller.element === element);
	if (!from) return;
	const others = list.filter((scroller) => scroller !== from && scroller.model === from.model);
	if (others.length === 0) return;
	const top = element.scrollTop;
	const placeList = placeListOf(from);
	const at = placeList.find((place) => place.bottom > top) ?? placeList.at(-1);
	if (!at) return;
	const part = Math.max(0, Math.min(1, (top - at.top) / Math.max(1, at.bottom - at.top)));
	for (const other of others) {
		const place = placeListOf(other).find((item) => item.key === at.key);
		if (!place) continue;
		// its own scrolling isn't followed back
		following = other.element;
		other.element.scrollTop = place.top + part * (place.bottom - place.top);
	}
	clearTimeout(followTimer);
	followTimer = setTimeout(() => (following = undefined), 80);
}

