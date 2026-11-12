// Tabs, as in Obsidian and VS Code: every open note (or the graph) is a tab. Click to switch,
// × or a middle-click to close, drag to reorder (or to another pane's bar), + for a new note,
// right-click for more. Each pane has a bar of its own.

import { t } from '@octaether/core-sdk';
import { baseName, mediaKindOf, stemOf } from '@octaether/core-vault';
import { icon } from './icon';
import { escapeHtml } from './ui';
import type { Tab, Workspace } from './workspace';

export interface TabBarOption {
	workspace: Workspace;
	/** The pane whose tabs it shows (the one with the focus, when not given). */
	pane?(): string;
	/** A tab begins to be dragged (the app gets ready for it to land on a pane's side). */
	onDragStart?(): void;
	newNote(): void;
	closeTab(id: string): void;
	menu(tab: Tab, x: number, y: number): void;
}

export function tabTitle(tab: Tab): string {
	if (tab.view === 'Graph') return t('Graph view');
	if (tab.view === 'Panel') return tab.panel?.title || t('New tab');
	// a file keeps its extension, as in Obsidian: "Cell.png" is a picture, "Cell" a note
	if (tab.view === 'File' && tab.file) return baseName(tab.file);
	return tab.note ? stemOf(tab.note.path) : t('New tab');
}

/** The icon before a tab's name: the graph, or the kind of file it shows. */
function tabIcon(tab: Tab): string {
	if (tab.view === 'Graph') return icon.Graph;
	if (tab.view === 'Panel') return icon.Chat;
	if (tab.view === 'File' && tab.file) return icon[mediaKindOf(tab.file) ?? 'File'];
	return '';
}

/** The tab being dragged, from any pane's bar: another bar or a pane's side can take it. */
let draggedId: string | undefined;

export function draggedTab(): string | undefined {
	return draggedId;
}

export class TabBar {
	private get paneId(): string {
		return this.option.pane?.() ?? this.option.workspace.paneId;
	}

	private get dragId(): string | undefined {
		return draggedId;
	}

	private set dragId(id: string | undefined) {
		draggedId = id;
	}

	constructor(
		readonly element: HTMLElement,
		readonly option: TabBarOption,
	) {
		element.addEventListener('click', (event) => {
			const target = event.target as Element;
			const close = target.closest<HTMLElement>('[data-close]');
			if (close) {
				option.closeTab(close.dataset.close!);
				return;
			}
			if (target.closest('.tab-new')) {
				option.workspace.focusPane(this.paneId);
				option.newNote();
				return;
			}
			const tab = target.closest<HTMLElement>('.tab');
			if (tab) option.workspace.activateTab(tab.dataset.id!);
		});
		// a middle-click closes a tab, as in a browser
		element.addEventListener('mousedown', (event) => {
			if (event.button === 1 && (event.target as Element).closest('.tab')) event.preventDefault();
		});
		element.addEventListener('auxclick', (event) => {
			const tab = (event.target as Element).closest<HTMLElement>('.tab');
			if (event.button === 1 && tab) {
				event.preventDefault();
				option.closeTab(tab.dataset.id!);
			}
		});
		element.addEventListener('contextmenu', (event) => {
			const tab = (event.target as Element).closest<HTMLElement>('.tab');
			const item = tab && option.workspace.tabList.find((entry) => entry.id === tab.dataset.id);
			if (!item) return;
			event.preventDefault();
			option.menu(item, event.clientX, event.clientY);
		});
		element.addEventListener('dblclick', (event) => {
			if ((event.target as Element).closest('.tab, button')) return;
			option.workspace.focusPane(this.paneId);
			option.newNote();
		});
		element.addEventListener('dragstart', (event) => {
			const tab = (event.target as Element).closest<HTMLElement>('.tab');
			if (!tab || !event.dataTransfer) return;
			this.dragId = tab.dataset.id;
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', tabTitle(option.workspace.tabList.find((entry) => entry.id === this.dragId)!));
			tab.classList.add('dragging');
			option.onDragStart?.();
		});
		element.addEventListener('dragover', (event) => {
			if (!this.dragId) return;
			const tab = (event.target as Element).closest<HTMLElement>('.tab');
			event.preventDefault();
			this.clearDrop();
			if (!tab || tab.dataset.id === this.dragId) return;
			const rect = tab.getBoundingClientRect();
			tab.classList.add(event.clientX < rect.left + rect.width / 2 ? 'drop-before' : 'drop-after');
		});
		element.addEventListener('drop', (event) => {
			const id = this.dragId;
			const tab = (event.target as Element).closest<HTMLElement>('.tab');
			event.preventDefault();
			this.endDrag();
			if (!id || tab?.dataset.id === id) return;
			// among this pane's tabs: before or after the one it was dropped on, or last
			const list = option.workspace.paneTabList(this.paneId);
			let index = list.length;
			if (tab) {
				const rect = tab.getBoundingClientRect();
				index = list.findIndex((entry) => entry.id === tab.dataset.id) + (event.clientX < rect.left + rect.width / 2 ? 0 : 1);
			}
			const from = list.findIndex((entry) => entry.id === id);
			if (from >= 0 && from < index) index--;
			option.workspace.moveTab(id, index, this.paneId);
		});
		element.addEventListener('dragend', () => this.endDrag());
	}

	private clearDrop(): void {
		for (const tab of this.element.querySelectorAll('.drop-before, .drop-after')) tab.classList.remove('drop-before', 'drop-after');
	}

	private endDrag(): void {
		this.dragId = undefined;
		this.clearDrop();
		for (const tab of document.querySelectorAll('.tab.dragging')) tab.classList.remove('dragging');
	}

	render(): void {
		const workspace = this.option.workspace;
		const activeId = workspace.activeTabOf(this.paneId)?.id;
		const html = workspace
			.paneTabList(this.paneId)
			.map((tab) => {
				const title = tabTitle(tab);
				const note = tab.view === 'Note' ? tab.note : undefined;
				const dirty = note !== undefined && (note.saveState === 'Unsaved' || note.saveState === 'Download' || note.saveState === 'Failed');
				const active = tab.id === activeId;
				const tip = tab.view === 'Graph' ? t('Graph view') : tab.view === 'Panel' ? title : tab.view === 'File' ? (tab.file ?? title) : (tab.note?.path ?? title);
				const glyph = tabIcon(tab);
				return (
					`<div class="tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}${note?.savedText === undefined && note?.autoNamed ? ' pending' : ''}" role="tab" aria-selected="${active}" data-id="${tab.id}" draggable="true" title="${escapeHtml(tip)}">` +
					(glyph ? `<span class="tab-icon">${glyph}</span>` : '') +
					`<span class="tab-title">${escapeHtml(title)}</span>` +
					`<span class="tab-dirty" aria-hidden="true"></span>` +
					`<button type="button" class="tab-close" data-close="${tab.id}" title="${escapeHtml(t('Close'))}" aria-label="${escapeHtml(t('Close'))} ${escapeHtml(title)}">${icon.Close}</button>` +
					'</div>'
				);
			})
			.join('');
		this.element.innerHTML = `<div class="tab-list" role="tablist">${html}</div><button type="button" class="tab-new" title="New note" aria-label="New note">${icon.Plus}</button>`;
		this.element.querySelector('.tab.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	}
}
