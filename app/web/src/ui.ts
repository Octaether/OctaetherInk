// Popup menu and modal. Everything floats above the page (nothing pushes the note down).
// Popups are marked data-oi-keep-editor so using them doesn't close the block editor.

import { icon } from './icon';

export interface MenuItem {
	title: string;
	/** A short line under the title saying what it does. */
	explain?: string;
	/** A short glyph, or one of our SVG icons (trusted markup from this app). */
	icon?: string;
	/** Right-aligned hint, usually the hotkey. */
	hint?: string;
	keywordList?: readonly string[];
	danger?: boolean;
	separatorBefore?: boolean;
	run?(): void;
	itemList?: MenuItem[];
}

export interface MenuOption {
	x: number;
	y: number;
	/** Show a search field at the top (block menu, color list). */
	search?: boolean;
	/** The query is typed somewhere else (the "/" menu types into the block editor). */
	externalQuery?: boolean;
	emptyText?: string;
	onClose?(): void;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function layer(): HTMLElement {
	return document.getElementById('layer')!;
}

let openMenuList: Menu[] = [];

/** The top-level menu that is open, if any. */
export function currentMenu(): Menu | undefined {
	return openMenuList[0];
}

export function closeAllMenu(): void {
	for (const menu of [...openMenuList].reverse()) menu.close();
}

export class Menu {
	readonly element: HTMLElement;
	private readonly listElement: HTMLElement;
	private readonly searchElement: HTMLInputElement | undefined;
	private visibleList: MenuItem[] = [];
	private active = 0;
	private child: Menu | undefined;
	private closed = false;
	private readonly onOutside = (event: PointerEvent): void => {
		const target = event.target as Node;
		if (!openMenuList.some((menu) => menu.element.contains(target))) closeAllMenu();
	};

	constructor(
		readonly itemList: MenuItem[],
		readonly option: MenuOption,
		readonly parent?: Menu,
	) {
		if (!parent) closeAllMenu();
		this.element = document.createElement('div');
		this.element.className = 'menu';
		this.element.setAttribute('role', 'menu');
		this.element.dataset.oiKeepEditor = '';
		if (option.search) {
			this.searchElement = document.createElement('input');
			this.searchElement.className = 'menu-search';
			this.searchElement.placeholder = 'Search';
			this.searchElement.setAttribute('aria-label', 'Search');
			this.searchElement.addEventListener('input', () => this.setQuery(this.searchElement!.value));
			this.searchElement.addEventListener('keydown', (event) => {
				if (this.handleKey(event)) event.preventDefault();
			});
			this.element.append(this.searchElement);
		}
		this.listElement = document.createElement('div');
		this.listElement.className = 'menu-list';
		this.element.append(this.listElement);
		this.element.addEventListener('keydown', (event) => {
			if (event.target !== this.searchElement && this.handleKey(event)) event.preventDefault();
		});
		layer().append(this.element);
		openMenuList.push(this);
		this.setQuery('');
		this.place(option.x, option.y);
		if (!parent) setTimeout(() => document.addEventListener('pointerdown', this.onOutside, true), 0);
		if (this.searchElement) this.searchElement.focus();
		else if (!option.externalQuery) {
			this.element.tabIndex = -1;
			this.element.focus({ preventScroll: true });
		}
	}

	/** Opens at (x, y); with no room below, it ends at `above` instead (default: y). */
	place(x: number, y: number, above = y): void {
		this.element.style.left = `${x}px`;
		this.element.style.top = `${y}px`;
		const rect = this.element.getBoundingClientRect();
		const width = document.documentElement.clientWidth;
		const height = document.documentElement.clientHeight;
		if (rect.right > width - 8) this.element.style.left = `${Math.max(8, width - rect.width - 8)}px`;
		if (rect.bottom > height - 8) this.element.style.top = `${Math.max(8, above - rect.height - 4)}px`;
	}

	setQuery(query: string): void {
		const text = query.trim().toLowerCase();
		// best first: title starts with the query, a title word does, the title contains it, then keywords
		const rank = (item: MenuItem): number => {
			const title = item.title.toLowerCase();
			if (title.startsWith(text)) return 0;
			if (title.split(/[\s-]+/).some((word) => word.startsWith(text))) return 1;
			if (title.includes(text)) return 2;
			const keywordList = (item.keywordList ?? []).map((word) => word.toLowerCase());
			if (keywordList.some((word) => word.startsWith(text))) return 3;
			return keywordList.some((word) => word.includes(text)) ? 4 : -1;
		};
		this.visibleList = text === ''
			? this.itemList
			: this.itemList
					.map((item, index) => ({ item, index, score: rank(item) }))
					.filter((entry) => entry.score >= 0)
					.sort((a, b) => a.score - b.score || a.index - b.index)
					.map((entry) => entry.item);
		this.active = 0;
		this.render();
	}

	/** Keys for the menu; returns true when handled. Works for keys routed from the editor too. */
	handleKey(event: KeyboardEvent): boolean {
		if (this.child) return this.child.handleKey(event);
		switch (event.key) {
			case 'ArrowDown':
				this.move(1);
				return true;
			case 'ArrowUp':
				this.move(-1);
				return true;
			case 'Enter':
			case 'Tab':
				this.runActive();
				return true;
			case 'ArrowRight':
				if (this.visibleList[this.active]?.itemList) {
					this.openChild(this.active);
					return true;
				}
				return false;
			case 'ArrowLeft':
				if (this.parent) {
					this.close();
					return true;
				}
				return false;
			case 'Escape':
				this.close();
				return true;
			default:
				return false;
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.child?.close();
		this.element.remove();
		openMenuList = openMenuList.filter((menu) => menu !== this);
		if (this.parent) this.parent.child = undefined;
		else document.removeEventListener('pointerdown', this.onOutside, true);
		this.option.onClose?.();
	}

	private move(step: number): void {
		if (this.visibleList.length === 0) return;
		this.active = (this.active + step + this.visibleList.length) % this.visibleList.length;
		this.render();
		this.listElement.children[this.active]?.scrollIntoView({ block: 'nearest' });
	}

	private runActive(): void {
		const item = this.visibleList[this.active];
		if (!item) return;
		if (item.itemList) {
			this.openChild(this.active);
			return;
		}
		closeAllMenu();
		item.run?.();
	}

	private openChild(index: number): void {
		const item = this.visibleList[index];
		const row = this.listElement.children[index] as HTMLElement | undefined;
		if (!item?.itemList || !row) return;
		this.child?.close();
		const rect = row.getBoundingClientRect();
		this.child = new Menu(item.itemList, { x: rect.right - 4, y: rect.top - 4 }, this);
	}

	private render(): void {
		if (this.visibleList.length === 0) {
			this.listElement.innerHTML = `<div class="menu-empty">${escapeHtml(this.option.emptyText ?? 'Nothing matches')}</div>`;
			return;
		}
		this.listElement.innerHTML = this.visibleList
			.map((item, index) => {
				const glyph = item.icon ? (item.icon.startsWith('<svg') ? item.icon : `<span class="menu-glyph">${escapeHtml(item.icon)}</span>`) : '<span class="menu-glyph"></span>';
				const title = item.explain ? `<span class="menu-title">${escapeHtml(item.title)}<span class="menu-explain">${escapeHtml(item.explain)}</span></span>` : `<span class="menu-title">${escapeHtml(item.title)}</span>`;
				return `${item.separatorBefore && index > 0 ? '<div class="menu-separator"></div>' : ''}<div class="menu-item${index === this.active ? ' active' : ''}${item.danger ? ' danger' : ''}" role="menuitem" data-index="${index}">${glyph}${title}${item.hint ? `<span class="menu-hint">${escapeHtml(item.hint)}</span>` : ''}${item.itemList ? `<span class="menu-chevron">${icon.Chevron}</span>` : ''}</div>`;
			})
			.join('');
		for (const row of this.listElement.querySelectorAll<HTMLElement>('.menu-item')) {
			const index = Number(row.dataset.index);
			row.addEventListener('pointerenter', () => {
				this.active = index;
				for (const other of this.listElement.querySelectorAll('.menu-item.active')) other.classList.remove('active');
				row.classList.add('active');
				if (this.visibleList[index]?.itemList) this.openChild(index);
				else this.child?.close();
			});
			// pointerdown keeps the text selection and the editor focus
			row.addEventListener('pointerdown', (event) => event.preventDefault());
			row.addEventListener('click', () => {
				this.active = index;
				this.runActive();
			});
		}
	}
}

/** A centred dialog over a dimmed page; returns a function that closes it. */
export function openModal(className: string, build: (body: HTMLElement, close: () => void) => void, onClose?: () => void): () => void {
	closeAllMenu();
	const backdrop = document.createElement('div');
	backdrop.className = 'modal-backdrop';
	const modal = document.createElement('div');
	modal.className = `modal ${className}`;
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.dataset.oiKeepEditor = '';
	backdrop.append(modal);
	let closed = false;
	const close = (): void => {
		if (closed) return;
		closed = true;
		backdrop.remove();
		document.removeEventListener('keydown', onKey, true);
		onClose?.();
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && !currentMenu()) {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	};
	backdrop.addEventListener('pointerdown', (event) => {
		if (event.target === backdrop) close();
	});
	document.addEventListener('keydown', onKey, true);
	layer().append(backdrop);
	build(modal, close);
	return close;
}

/** A yes/no question in a small dialog; resolves true for the action, false for Cancel or Esc. */
export function confirmDialog(message: string, action = 'OK', danger = false): Promise<boolean> {
	return new Promise((resolve) => {
		let answer = false;
		openModal(
			'dialog-modal',
			(modal, close) => {
				modal.innerHTML = `<p class="dialog-text">${escapeHtml(message)}</p><div class="dialog-row"><button type="button" class="dialog-button" data-answer="No">Cancel</button><button type="button" class="dialog-button primary${danger ? ' danger' : ''}" data-answer="Yes">${escapeHtml(action)}</button></div>`;
				for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-answer]')) {
					button.addEventListener('click', () => {
						answer = button.dataset.answer === 'Yes';
						close();
					});
				}
				modal.querySelector<HTMLButtonElement>('[data-answer="Yes"]')!.focus();
			},
			() => resolve(answer),
		);
	});
}

/** Asks for a line of text; resolves undefined on Cancel. */
export function promptDialog(message: string, value = '', action = 'OK'): Promise<string | undefined> {
	return new Promise((resolve) => {
		let answer: string | undefined;
		openModal(
			'dialog-modal',
			(modal, close) => {
				modal.innerHTML = `<p class="dialog-text">${escapeHtml(message)}</p><input class="dialog-input" aria-label="${escapeHtml(message)}"><div class="dialog-row"><button type="button" class="dialog-button" data-answer="No">Cancel</button><button type="button" class="dialog-button primary" data-answer="Yes">${escapeHtml(action)}</button></div>`;
				const input = modal.querySelector<HTMLInputElement>('.dialog-input')!;
				input.value = value;
				const finish = (keep: boolean): void => {
					answer = keep ? input.value : undefined;
					close();
				};
				input.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') finish(true);
				});
				for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-answer]')) button.addEventListener('click', () => finish(button.dataset.answer === 'Yes'));
				input.focus();
				input.select();
			},
			() => resolve(answer),
		);
	});
}

/** A button in a toast: Undo after a delete, Reload after an update. */
export interface ToastAction {
	title: string;
	run(): void;
}

/**
 * A short message at the bottom of the window that fades away (after 3.2 s, or 8 s with an
 * action). An action is a button in it; the toast stays while the pointer is over it.
 */
export function toast(message: string, time?: number, action?: ToastAction): void {
	// messages stack at the bottom instead of covering each other
	let stack = document.getElementById('toastStack');
	if (!stack) {
		stack = document.createElement('div');
		stack.id = 'toastStack';
		stack.className = 'toast-stack';
		layer().append(stack);
	}
	const element = document.createElement('div');
	element.className = 'toast';
	element.setAttribute('role', 'status');
	element.textContent = message;
	let timerList: ReturnType<typeof setTimeout>[] = [];
	const fade = (after: number): void => {
		timerList = [setTimeout(() => element.classList.add('toast-out'), after), setTimeout(() => element.remove(), after + 400)];
	};
	if (action) {
		element.classList.add('has-action');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'toast-action';
		button.textContent = action.title;
		button.addEventListener('click', () => {
			for (const timer of timerList) clearTimeout(timer);
			element.remove();
			action.run();
		});
		element.append(button);
		element.addEventListener('pointerenter', () => {
			for (const timer of timerList) clearTimeout(timer);
			element.classList.remove('toast-out');
		});
		element.addEventListener('pointerleave', () => fade(2500));
	}
	stack.append(element);
	fade(time ?? (action ? 8000 : 3200));
}

export { escapeHtml };
