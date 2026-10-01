// The left sidebar, as in Obsidian: the file explorer (folders first, natural sort, drag to move,
// rename in place, right-click menu; pictures, videos, and sounds open in a tab of their own, and
// drag into a note) and search across every note. The vault's name sits at the
// bottom and opens the vault menu.

import { type SortOrder, baseName, extensionOf, isInside, mediaKindOf, parentPath, stemOf } from '@octaether/core-vault';
import { icon } from './icon';
import { Menu, type MenuItem, escapeHtml } from './ui';
import type { Workspace } from './workspace';

export interface SidebarOption {
	workspace: Workspace;
	/** Opens a note (in a new tab with Ctrl/Cmd+click or a middle-click). */
	openNote(path: string, newTab: boolean): void;
	/** Shows a picture, a video, or a sound of the vault in a tab (a new one when asked). */
	openFile(path: string, newTab: boolean): void;
	newNote(folder: string): void;
	notify(message: string): void;
	/** A search result was chosen: open the note and find the query there. */
	openSearchResult(path: string, query: string, matchCase: boolean, regex: boolean, newTab: boolean): void;
	vaultMenu(x: number, y: number): void;
	copyLink(path: string): void;
}

type Tab = 'File' | 'Search';

/** The drag type of a vault file dragged out of the file tree (its path). */
export const vaultPathType = 'application/x-octaether-path';

const layoutKey = 'OctaetherInk.Sidebar';

interface SavedLayout {
	width?: number;
	open?: boolean;
	tab?: Tab;
	order?: SortOrder;
	expanded?: Record<string, string[]>;
}

export class Sidebar {
	private tab: Tab = 'File';
	private order: SortOrder = 'NameAscending';
	private expandedSet = new Set<string>();
	private renamePath: string | undefined;
	/** The phone drawer, open for now (never remembered). */
	private drawerOpen = false;
	private readonly tree: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly searchResult: HTMLElement;
	private matchCase = false;
	private regex = false;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;
	private layout: SavedLayout;

	constructor(
		readonly element: HTMLElement,
		readonly option: SidebarOption,
	) {
		this.layout = this.readLayout();
		// 'Files' was the name before version 1
		this.tab = (this.layout.tab as string) === 'Search' ? 'Search' : 'File';
		this.order = this.layout.order ?? 'NameAscending';
		element.innerHTML =
			`<div class="sidebar-tab-row" role="tablist"><button type="button" class="sidebar-tab" data-tab="File" role="tab" title="File" aria-label="File">${icon.Folder}</button><button type="button" class="sidebar-tab" data-tab="Search" role="tab" title="Search (Ctrl+Shift+F)" aria-label="Search">${icon.Search}</button></div>` +
			'<div class="sidebar-pane" data-pane="File">' +
			`<div class="sidebar-tool-row"><button type="button" class="icon-button" data-action="NewNote" title="New note" aria-label="New note">${icon.FilePlus}</button><button type="button" class="icon-button" data-action="NewFolder" title="New folder" aria-label="New folder">${icon.FolderPlus}</button><button type="button" class="icon-button" data-action="Sort" title="Sort" aria-label="Sort">${icon.Sort}</button><button type="button" class="icon-button" data-action="Collapse" title="Collapse all" aria-label="Collapse all">${icon.Collapse}</button></div>` +
			'<div class="file-tree" role="tree" tabindex="0"></div></div>' +
			'<div class="sidebar-pane" data-pane="Search" hidden>' +
			'<div class="search-box"><input class="search-input" placeholder="Search every note" aria-label="Search every note" spellcheck="false"><button type="button" class="find-toggle" data-toggle="Case" title="Match case">Aa</button><button type="button" class="find-toggle" data-toggle="Regex" title="Regular expression">.*</button></div>' +
			'<div class="search-hint">Words or tag:Name. Enter opens the first result.</div><div class="search-result"></div></div>' +
			`<button type="button" class="vault-button" title="Vault menu">${icon.Folder}<span class="vault-name"></span>${icon.ChevronUp}</button>` +
			'<div class="sidebar-resize" title="Drag to resize"></div>';
		this.tree = element.querySelector('.file-tree')!;
		this.searchInput = element.querySelector('.search-input')!;
		this.searchResult = element.querySelector('.search-result')!;
		for (const button of element.querySelectorAll<HTMLButtonElement>('.sidebar-tab')) button.addEventListener('click', () => this.showTab(button.dataset.tab as Tab));
		element.querySelector('[data-action="NewNote"]')!.addEventListener('click', () => option.newNote(this.selectedFolder()));
		element.querySelector('[data-action="NewFolder"]')!.addEventListener('click', () => void this.newFolder(this.selectedFolder()));
		element.querySelector('[data-action="Sort"]')!.addEventListener('click', (event) => {
			const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			new Menu(
				[
					{ title: `${this.order === 'NameAscending' ? '✓ ' : ''}Name (A to Z)`, run: () => this.setOrder('NameAscending') },
					{ title: `${this.order === 'NameDescending' ? '✓ ' : ''}Name (Z to A)`, run: () => this.setOrder('NameDescending') },
				],
				{ x: rect.left, y: rect.bottom + 4 },
			);
		});
		element.querySelector('[data-action="Collapse"]')!.addEventListener('click', () => {
			this.expandedSet.clear();
			this.saveLayout();
			this.render();
		});
		element.querySelector('.vault-button')!.addEventListener('click', (event) => {
			const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			option.vaultMenu(rect.left, rect.top - 4);
		});
		this.searchInput.addEventListener('input', () => {
			clearTimeout(this.searchTimer);
			this.searchTimer = setTimeout(() => this.renderSearch(), 150);
		});
		this.searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') this.searchResult.querySelector<HTMLElement>('[data-path]')?.click();
		});
		for (const button of element.querySelectorAll<HTMLButtonElement>('.search-box [data-toggle]')) {
			button.addEventListener('click', () => {
				if (button.dataset.toggle === 'Case') this.matchCase = !this.matchCase;
				else this.regex = !this.regex;
				button.classList.toggle('active', button.dataset.toggle === 'Case' ? this.matchCase : this.regex);
				this.renderSearch();
			});
		}
		this.bindTree();
		this.bindResize();
		this.showTab(this.tab);
	}

	// ------------------------------------------------------------ layout

	private readLayout(): SavedLayout {
		try {
			return JSON.parse(localStorage.getItem(layoutKey) ?? '{}') as SavedLayout;
		} catch {
			return {};
		}
	}

	private saveLayout(): void {
		const id = this.option.workspace.source?.id;
		const expanded = { ...(this.layout.expanded ?? {}) };
		if (id) expanded[id] = [...this.expandedSet];
		this.layout = { ...this.layout, tab: this.tab, order: this.order, expanded };
		try {
			localStorage.setItem(layoutKey, JSON.stringify(this.layout));
		} catch {
			// not remembered
		}
	}

	/** Called when a vault opens: restores its open folders. */
	attach(): void {
		const id = this.option.workspace.source?.id;
		this.drawerOpen = false;
		this.expandedSet = new Set(id ? (this.layout.expanded?.[id] ?? []) : []);
		this.element.querySelector('.vault-name')!.textContent = this.option.workspace.source?.name ?? '';
		this.searchInput.value = '';
		this.searchResult.replaceChildren();
		this.render();
	}

	/** On a phone the sidebar is a drawer over the note: it opens when asked and starts closed, as in Obsidian mobile. */
	private phone(): boolean {
		return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
	}

	isOpen(): boolean {
		return this.phone() ? this.drawerOpen : this.layout.open !== false;
	}

	setOpen(open: boolean): void {
		if (this.phone()) {
			this.drawerOpen = open;
			return;
		}
		this.layout.open = open;
		this.saveLayout();
	}

	width(): number {
		return this.layout.width ?? 260;
	}

	showTab(tab: Tab): void {
		this.tab = tab;
		for (const button of this.element.querySelectorAll<HTMLElement>('.sidebar-tab')) button.classList.toggle('active', button.dataset.tab === tab);
		for (const pane of this.element.querySelectorAll<HTMLElement>('.sidebar-pane')) pane.hidden = pane.dataset.pane !== tab;
		this.saveLayout();
		if (tab === 'Search') this.searchInput.focus();
	}

	focusSearch(query?: string): void {
		this.showTab('Search');
		if (query !== undefined) this.searchInput.value = query;
		this.searchInput.focus();
		this.searchInput.select();
		this.renderSearch();
	}

	private setOrder(order: SortOrder): void {
		this.order = order;
		this.saveLayout();
		this.render();
	}

	// ------------------------------------------------------------ file tree

	/** The folder of the selected note (for New note / New folder), or the root. */
	private selectedFolder(): string {
		const note = this.option.workspace.note;
		return note && !note.external && this.option.workspace.option.setting('File.NewNoteLocation') === 'CurrentFolder' ? parentPath(note.path) : '';
	}

	/** Opens the folders above a path and scrolls it into view. */
	reveal(path: string): void {
		for (let parent = parentPath(path); parent !== ''; parent = parentPath(parent)) this.expandedSet.add(parent);
		this.saveLayout();
		this.render();
		this.tree.querySelector(`[data-path="${path.replace(/["\\]/g, '\\$&')}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	render(): void {
		const workspace = this.option.workspace;
		const vault = workspace.vault;
		if (!vault) {
			this.tree.replaceChildren();
			return;
		}
		const note = workspace.note;
		const current = workspace.file ?? (note && !note.external ? note.path : undefined);
		// new notes (in any tab) show where they will be, before they are written
		const pendingList = workspace.openNoteList().flatMap((item) => (!item.external && item.savedText === undefined && !vault.has(item.path) ? [item.path] : []));
		const rowList: string[] = [];
		const walk = (folder: string, depth: number): void => {
			const childList = vault.childList(folder, this.order).map((entry) => ({ ...entry, pending: false }));
			const pendingHere = pendingList.filter((path) => parentPath(path) === folder);
			if (pendingHere.length > 0) {
				for (const path of pendingHere) childList.push({ path, kind: 'File', pending: true });
				childList.sort((left, right) => (left.kind !== right.kind ? (left.kind === 'Folder' ? -1 : 1) : (this.order === 'NameDescending' ? -1 : 1) * baseName(left.path).localeCompare(baseName(right.path), undefined, { numeric: true, sensitivity: 'base' })));
			}
			for (const entry of childList) {
				const folderRow = entry.kind === 'Folder';
				const open = folderRow && this.expandedSet.has(entry.path);
				const note = extensionOf(entry.path) === 'oi';
				const name = folderRow ? baseName(entry.path) : note ? stemOf(entry.path) : baseName(entry.path);
				const renaming = this.renamePath === entry.path;
				const nameHtml = renaming ? `<input class="tree-rename" value="${escapeHtml(name)}" aria-label="New name" spellcheck="false">` : `<span class="tree-name">${escapeHtml(name)}</span>`;
				rowList.push(
					`<div class="tree-item${folderRow ? ' tree-folder' : ''}${entry.path === current ? ' active' : ''}${entry.pending ? ' pending' : ''}${!folderRow && !note ? (mediaKindOf(entry.path) ? ' media' : ' other') : ''}" role="treeitem" data-path="${escapeHtml(entry.path)}" data-kind="${entry.kind}"${folderRow ? ` aria-expanded="${open}"` : ''} draggable="${!renaming && !entry.pending}" style="--depth: ${depth}">` +
						`<span class="tree-chevron">${folderRow ? (open ? icon.ChevronDown : icon.Chevron) : ''}</span>${nameHtml}</div>`,
				);
				if (open) walk(entry.path, depth + 1);
			}
		};
		walk('', 0);
		this.tree.innerHTML = rowList.length > 0 ? rowList.join('') : '<div class="tree-empty">No note yet. Make one with the button above or Alt+N.</div>';
		const input = this.tree.querySelector<HTMLInputElement>('.tree-rename');
		if (input) {
			input.focus();
			input.select();
			const finish = (keep: boolean): void => {
				const path = this.renamePath;
				this.renamePath = undefined;
				if (!keep || !path || input.value.trim() === '') {
					this.render();
					return;
				}
				void this.option.workspace.rename(path, input.value.trim()).then(() => this.render());
			};
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') finish(true);
				if (event.key === 'Escape') finish(false);
				event.stopPropagation();
			});
			input.addEventListener('blur', () => finish(true));
		}
	}

	/** Notes, and the files the app can show on their own. */
	private canOpen(path: string): boolean {
		return extensionOf(path) === 'oi' || mediaKindOf(path) !== undefined;
	}

	private open(path: string, newTab: boolean): void {
		if (extensionOf(path) === 'oi') this.option.openNote(path, newTab);
		else if (mediaKindOf(path)) this.option.openFile(path, newTab);
		else this.option.notify(`No module opens .${extensionOf(path)} files yet.`);
	}

	startRename(path: string): void {
		this.renamePath = path;
		this.reveal(path);
	}

	private async newFolder(parent: string): Promise<void> {
		const path = await this.option.workspace.createFolder(parent);
		if (!path) return;
		this.expandedSet.add(parent);
		this.startRename(path);
	}

	private bindTree(): void {
		this.tree.addEventListener('click', (event) => {
			const row = (event.target as Element).closest<HTMLElement>('.tree-item');
			if (!row || (event.target as Element).closest('.tree-rename')) return;
			const path = row.dataset.path!;
			if (row.dataset.kind === 'Folder') {
				if (this.expandedSet.has(path)) this.expandedSet.delete(path);
				else this.expandedSet.add(path);
				this.saveLayout();
				this.render();
				return;
			}
			this.open(path, event.ctrlKey || event.metaKey);
		});
		// a middle-click opens a note in a new tab, as in a browser
		this.tree.addEventListener('mousedown', (event) => {
			if (event.button === 1) event.preventDefault();
		});
		this.tree.addEventListener('auxclick', (event) => {
			const row = (event.target as Element).closest<HTMLElement>('.tree-item');
			if (event.button !== 1 || !row || row.dataset.kind !== 'File' || !this.canOpen(row.dataset.path!)) return;
			event.preventDefault();
			this.open(row.dataset.path!, true);
		});
		this.tree.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			const row = (event.target as Element).closest<HTMLElement>('.tree-item');
			const path = row?.dataset.path;
			const folder = row?.dataset.kind === 'Folder' ? path! : path ? parentPath(path) : '';
			const itemList: MenuItem[] = [
				{ title: 'New note', icon: icon.FilePlus, run: () => this.option.newNote(folder) },
				{ title: 'New folder', icon: icon.FolderPlus, run: () => void this.newFolder(folder) },
			];
			if (path && row?.classList.contains('pending') === false) {
				if (row.dataset.kind === 'File' && this.canOpen(path)) itemList.unshift({ title: 'Open', run: () => this.open(path, false) }, { title: 'Open in a new tab', run: () => this.open(path, true) });
				itemList.push(
					{ title: 'Rename', hint: 'F2', separatorBefore: true, run: () => this.startRename(path) },
					...(row.dataset.kind === 'File' ? [{ title: 'Copy link', run: () => this.option.copyLink(path) }] : []),
					{ title: this.option.workspace.option.setting('File.DeleteTo') === 'Permanent' ? 'Delete' : 'Move to trash', icon: icon.Trash, danger: true, separatorBefore: true, run: () => void this.option.workspace.trash(path) },
				);
			}
			new Menu(itemList, { x: event.clientX, y: event.clientY });
		});
		this.tree.addEventListener('keydown', (event) => {
			if (event.key !== 'F2') return;
			const note = this.option.workspace.note;
			if (note && !note.external) this.startRename(note.path);
		});
		// drag files and folders onto folders (or the empty area for the vault root)
		let dragPath: string | undefined;
		this.tree.addEventListener('dragstart', (event) => {
			const row = (event.target as Element).closest<HTMLElement>('.tree-item');
			dragPath = row?.dataset.path;
			if (dragPath && event.dataTransfer) {
				event.dataTransfer.setData('text/plain', dragPath);
				// a file dropped on a note is linked there (a picture shows): the page reads this type
				if (row?.dataset.kind === 'File') event.dataTransfer.setData(vaultPathType, dragPath);
				event.dataTransfer.effectAllowed = 'copyMove';
			}
		});
		const targetFolder = (event: DragEvent): string | undefined => {
			const row = (event.target as Element).closest<HTMLElement>('.tree-item');
			if (!row) return '';
			const path = row.dataset.path!;
			return row.dataset.kind === 'Folder' ? path : parentPath(path);
		};
		this.tree.addEventListener('dragover', (event) => {
			const folder = targetFolder(event);
			if (dragPath === undefined || folder === undefined || isInside(folder, dragPath)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			for (const row of this.tree.querySelectorAll('.drop-target')) row.classList.remove('drop-target');
			if (folder === '') this.tree.classList.add('drop-target');
			else {
				this.tree.classList.remove('drop-target');
				this.tree.querySelector(`[data-path="${folder.replace(/["\\]/g, '\\$&')}"]`)?.classList.add('drop-target');
			}
		});
		const clear = (): void => {
			this.tree.classList.remove('drop-target');
			for (const row of this.tree.querySelectorAll('.drop-target')) row.classList.remove('drop-target');
		};
		this.tree.addEventListener('dragleave', (event) => {
			if (!this.tree.contains(event.relatedTarget as Node)) clear();
		});
		this.tree.addEventListener('drop', (event) => {
			event.preventDefault();
			const folder = targetFolder(event);
			const path = dragPath;
			dragPath = undefined;
			clear();
			if (path === undefined || folder === undefined || isInside(folder, path)) return;
			void this.option.workspace.move(path, folder).then(() => {
				if (folder) this.expandedSet.add(folder);
				this.render();
			});
		});
		this.tree.addEventListener('dragend', () => {
			dragPath = undefined;
			clear();
		});
	}

	private bindResize(): void {
		const handle = this.element.querySelector<HTMLElement>('.sidebar-resize')!;
		handle.addEventListener('pointerdown', (event) => {
			event.preventDefault();
			handle.setPointerCapture(event.pointerId);
			const start = event.clientX;
			const startWidth = this.element.getBoundingClientRect().width;
			const move = (moveEvent: PointerEvent): void => {
				const width = Math.max(180, Math.min(520, startWidth + moveEvent.clientX - start));
				this.element.style.width = `${width}px`;
				this.layout.width = width;
			};
			const up = (): void => {
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', up);
				this.saveLayout();
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', up);
		});
	}

	// ------------------------------------------------------------ search

	private renderSearch(): void {
		const vault = this.option.workspace.vault;
		const query = this.searchInput.value;
		if (!vault || query.trim() === '') {
			this.searchResult.replaceChildren();
			return;
		}
		const resultList = vault.search(query, { matchCase: this.matchCase, regex: this.regex });
		if (resultList.length === 0) {
			this.searchResult.innerHTML = '<div class="search-none">No notes match.</div>';
			return;
		}
		const total = resultList.reduce((sum, result) => sum + result.matchList.length, 0);
		this.searchResult.innerHTML =
			`<div class="search-summary">${resultList.length} ${resultList.length === 1 ? 'note' : 'notes'}${total ? `, ${total} ${total === 1 ? 'match' : 'matches'}` : ''}</div>` +
			resultList
				.map(
					(result) =>
						`<div class="search-file" data-path="${escapeHtml(result.path)}" role="button" tabindex="0"><span>${escapeHtml(stemOf(result.path))}</span>${result.matchList.length ? `<span class="search-count">${result.matchList.length}</span>` : ''}</div>` +
						result.matchList
							.map(
								(match) =>
									`<div class="search-line" data-path="${escapeHtml(result.path)}" role="button" tabindex="0">${escapeHtml(match.text.slice(0, match.start))}<mark>${escapeHtml(match.text.slice(match.start, match.end))}</mark>${escapeHtml(match.text.slice(match.end))}</div>`,
							)
							.join(''),
				)
				.join('');
		for (const item of this.searchResult.querySelectorAll<HTMLElement>('[data-path]')) {
			item.addEventListener('click', (event) => {
				const tagQuery = /^tag:#?(.+)$/i.exec(query.trim());
				this.option.openSearchResult(item.dataset.path!, tagQuery ? `#${tagQuery[1]}` : query, this.matchCase, this.regex, event.ctrlKey || event.metaKey);
			});
		}
	}

	/** Searches again after notes changed. */
	refreshSearch(): void {
		if (this.tab === 'Search' && this.searchInput.value.trim() !== '') this.renderSearch();
	}
}
