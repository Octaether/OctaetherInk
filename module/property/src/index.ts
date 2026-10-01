// Property module: a Property block holds a note's fields (tags, dates, numbers, checkboxes,
// lists) as rows you edit in place, like Obsidian's properties. The body is `Key: value` lines
// (YAML-like), so any tool can read it. A note's own `---` header is system metadata (Created,
// Id, Format), shown only in the Source view.
//
//   Property:
//   	Tag: [Organic, Mechanism]
//   	Due: 2026-10-05
//   	Done: False

import type { PropertyValue } from '@octaether/core-format';
import { type BlockTypeDefinition, type ModuleDefinition, type RenderContext, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import {
	type PropertyKind,
	convert,
	dateTimeInput,
	dateTimeValue,
	defaultOf,
	entryList,
	guessKind,
	hasKey,
	kindOf,
	moveKey,
	moveListItem,
	plainText,
	propertyKindExample,
	propertyKindList,
	propertyKindTitle,
	readTyped,
	renameKey,
	setValue,
} from './body';

export * from './body';

const addPropertyEvent = 'oi-property-add';

/** Opens the "add property" form of the Property block in this frame (the app's Add property command). */
export function openPropertyForm(frame: HTMLElement | undefined): boolean {
	const view = frame?.querySelector('.oi-property');
	if (!view) return false;
	view.dispatchEvent(new CustomEvent(addPropertyEvent));
	return true;
}

const icon = (path: string): string =>
	`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const propertyKindIcon: Readonly<Record<PropertyKind, string>> = {
	Text: icon('<path d="M4 7h16M4 12h16M4 17h10"/>'),
	List: icon('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
	Number: icon('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
	Checkbox: icon('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>'),
	Date: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
	DateTime: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};

const suggestionList = ['Tag', 'Alias', 'Course', 'Due', 'Status', 'Author', 'Source', 'Done', 'Rating', 'Topic'];

/** A value safe inside a double-quoted attribute selector. */
function attributeValue(text: string): string {
	return text.replace(/["\\]/g, '\\$&');
}

let viewCounter = 0;

interface FocusSpot {
	field: string;
	start: number | null;
	end: number | null;
}

interface DragState {
	kind: 'Pill' | 'Row';
	key: string;
	index: number;
	element: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	moving: boolean;
	target: number;
}

class PropertyView {
	private readonly root: HTMLElement;
	private readonly id = ++viewCounter;
	private formOpen: boolean;
	private formName = '';
	private formKind: PropertyKind = 'Text';
	private formKindChosen = false;
	/** The pill being edited in place: an index, or -1 for a new one. */
	private pillEdit: { key: string; index: number } | undefined;
	private menu: HTMLElement | undefined;
	private drag: DragState | undefined;
	private swallowClick = false;
	/** The body this view last wrote itself: no redraw needed when it comes back. */
	private expectedBody: string | undefined;
	private renderedState = '';
	private readonly onDocumentPointer = (event: PointerEvent): void => {
		if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
	};

	constructor(
		readonly frame: HTMLElement,
		private block: ResolvedBlock,
		private context: RenderContext,
	) {
		this.root = document.createElement('div');
		this.root.className = 'oi-property';
		// the edit session leaves clicks here to these controls
		this.root.dataset.oiInteractive = '';
		frame.append(this.root);
		this.formOpen = block.body.trim() === '';
		this.bind();
		this.root.addEventListener(addPropertyEvent, this.onAddRequest);
		this.render();
	}

	update(block: ResolvedBlock, context: RenderContext): void {
		this.block = block;
		this.context = context;
		// our own value edits are already on screen; redraw for anything else
		if (block.body === this.expectedBody && this.stateKey() === this.renderedState) return;
		this.expectedBody = undefined;
		this.render();
	}

	destroy(): void {
		this.closeMenu();
		this.root.remove();
	}

	private readonly onAddRequest = (): void => {
		this.formOpen = true;
		this.render();
		this.root.querySelector<HTMLInputElement>('[data-field="new"]')?.focus();
	};

	private readOnly(): boolean {
		return this.context.readOnly();
	}

	private stateKey(): string {
		return `${this.readOnly()}|${this.context.setting('Property.ShowType')}|${this.context.setting('Property.TagHash')}`;
	}

	/** Writes a new body as one undo step. `quiet`: the screen already shows it (a typed value). */
	private commit(body: string, quiet = false): void {
		if (body === this.block.body) return;
		this.expectedBody = quiet ? body : undefined;
		this.context.setBody(body);
	}

	// ------------------------------------------------------------ drawing

	private render(): void {
		const focus = this.captureFocus();
		this.closeMenu();
		const readOnly = this.readOnly();
		const list = entryList(this.block.body);
		const rowHtml = list.map(([key, value], index) => this.rowHtml(key, value, index, readOnly)).join('');
		let footer = '';
		if (!readOnly) {
			footer = this.formOpen
				? `<div class="oi-property-form">` +
					`<input class="oi-property-new" data-field="new" data-oi-focus value="${escapeHtml(this.formName)}" placeholder="Property name" aria-label="Property name" list="oi-property-suggestion-${this.id}" spellcheck="false">` +
					`<select class="oi-property-new-kind" data-field="new-kind" aria-label="Type">${propertyKindList.map((kind) => `<option value="${kind}"${kind === this.formKind ? ' selected' : ''}>${propertyKindTitle[kind]}</option>`).join('')}</select>` +
					`<button type="button" class="oi-property-button primary" data-action="AddConfirm">Add</button>` +
					`<button type="button" class="oi-property-button" data-action="AddCancel">Cancel</button>` +
					`<datalist id="oi-property-suggestion-${this.id}">${suggestionList.filter((name) => !list.some(([key]) => key === name)).map((name) => `<option value="${name}"></option>`).join('')}</datalist>` +
					`<div class="oi-property-hint">${escapeHtml(propertyKindExample[this.formKind])}</div>` +
					`</div>`
				: `<button type="button" class="oi-property-add" data-action="Add" data-oi-focus>+ Add property</button>`;
		}
		this.root.innerHTML = rowHtml + footer;
		this.root.toggleAttribute('data-empty', list.length === 0);
		this.renderedState = this.stateKey();
		this.restoreFocus(focus);
	}

	private rowHtml(key: string, value: PropertyValue, index: number, readOnly: boolean): string {
		const kind = kindOf(value);
		const showType = this.context.setting('Property.ShowType') !== false;
		const name = escapeHtml(key);
		const kindButton = showType
			? readOnly
				? `<span class="oi-property-kind" title="${propertyKindTitle[kind]}">${propertyKindIcon[kind]}</span>`
				: `<button type="button" class="oi-property-kind" data-action="Kind" title="${propertyKindTitle[kind]}: click to change the type, drag to move" aria-label="Type: ${propertyKindTitle[kind]}">${propertyKindIcon[kind]}</button>`
			: '';
		const keyHtml = readOnly
			? `<span class="oi-property-key-text">${name}</span>`
			: `<input class="oi-property-key" data-field="key:${name}" data-oi-committed="${name}" value="${name}" aria-label="Property name" spellcheck="false">`;
		return (
			`<div class="oi-property-row" data-key="${name}" data-index="${index}" data-kind="${kind}">` +
			`<div class="oi-property-name">${kindButton}${keyHtml}</div>` +
			`<div class="oi-property-value">${this.valueHtml(key, value, kind, readOnly)}</div>` +
			(readOnly ? '' : `<button type="button" class="oi-property-remove" data-action="Remove" title="Remove this property" aria-label="Remove ${name}">×</button>`) +
			`</div>`
		);
	}

	private valueHtml(key: string, value: PropertyValue, kind: PropertyKind, readOnly: boolean): string {
		const field = `value:${escapeHtml(key)}`;
		const text = plainText(value);
		switch (kind) {
			case 'Checkbox':
				return `<input type="checkbox" class="oi-property-check" data-field="${field}"${value === true ? ' checked' : ''}${readOnly ? ' disabled' : ''} aria-label="${escapeHtml(key)}">`;
			case 'List':
				return this.pillHtml(key, value as PropertyValue[], readOnly);
			case 'Number':
			case 'Date':
			case 'DateTime': {
				if (readOnly) return `<span class="oi-property-text">${escapeHtml(text)}</span>`;
				const type = kind === 'Number' ? 'number" step="any' : kind === 'Date' ? 'date' : 'datetime-local';
				const local = kind === 'DateTime' ? dateTimeInput(text) : undefined;
				const shown = local ? local.input : text;
				return `<input type="${type}" class="oi-property-input" data-field="${field}" data-kind="${kind}"${local?.offset ? ` data-offset="${escapeHtml(local.offset)}"` : ''} data-oi-committed="${escapeHtml(shown)}" value="${escapeHtml(shown)}" aria-label="${escapeHtml(key)}">`;
			}
			default:
				if (readOnly) return `<span class="oi-property-text">${escapeHtml(text)}</span>`;
				return `<input class="oi-property-input" data-field="${field}" data-kind="Text" data-oi-committed="${escapeHtml(text)}" value="${escapeHtml(text)}" placeholder="Empty" aria-label="${escapeHtml(key)}">`;
		}
	}

	private pillHtml(key: string, list: PropertyValue[], readOnly: boolean): string {
		const tag = key === 'Tag';
		const hash = tag && this.context.setting('Property.TagHash') === true ? '#' : '';
		const itemHtml = list
			.map((item, index) => {
				const text = plainText(item);
				if (!readOnly && this.pillEdit?.key === key && this.pillEdit.index === index) {
					return `<input class="oi-pill-input" data-field="pill:${escapeHtml(key)}:${index}" value="${escapeHtml(text)}" size="${Math.max(4, text.length + 1)}" aria-label="Edit ${escapeHtml(text)}" spellcheck="false">`;
				}
				const tagAttribute = tag ? ` data-oi-tag="${escapeHtml(text)}"` : '';
				return `<span class="oi-pill${tag ? ' oi-pill-tag' : ''}" data-index="${index}"${tagAttribute}${readOnly ? '' : ' tabindex="0" role="button" title="Click to edit, drag to move"'}>${escapeHtml(hash + text)}${readOnly ? '' : `<button type="button" class="oi-pill-remove" data-action="PillRemove" data-index="${index}" tabindex="-1" aria-label="Remove ${escapeHtml(text)}">×</button>`}</span>`;
			})
			.join('');
		let add = '';
		if (!readOnly) {
			add =
				this.pillEdit?.key === key && this.pillEdit.index === -1
					? `<input class="oi-pill-input" data-field="pill:${escapeHtml(key)}:-1" size="6" placeholder="New" aria-label="Add to ${escapeHtml(key)}" spellcheck="false">`
					: `<button type="button" class="oi-pill-add" data-action="PillAdd" title="Add" aria-label="Add to ${escapeHtml(key)}">+</button>`;
		}
		return `<div class="oi-property-pill-row" data-key="${escapeHtml(key)}">${itemHtml}${add}</div>`;
	}

	private captureFocus(): FocusSpot | undefined {
		const active = document.activeElement as HTMLInputElement | null;
		if (!active || !this.root.contains(active) || !active.dataset.field) return undefined;
		let start: number | null = null;
		let end: number | null = null;
		try {
			start = active.selectionStart;
			end = active.selectionEnd;
		} catch {
			// inputs such as date and checkbox have no selection
		}
		return { field: active.dataset.field, start, end };
	}

	private restoreFocus(spot: FocusSpot | undefined): void {
		const pill = this.pillEdit ? this.root.querySelector<HTMLInputElement>('.oi-pill-input') : null;
		if (pill) {
			pill.focus({ preventScroll: true });
			pill.select();
			return;
		}
		if (!spot) return;
		const target = this.root.querySelector<HTMLInputElement>(`[data-field="${attributeValue(spot.field)}"]`);
		if (!target) return;
		target.focus({ preventScroll: true });
		try {
			if (spot.start !== null) target.setSelectionRange(spot.start, spot.end ?? spot.start);
		} catch {
			// no selection on this kind of input
		}
	}

	// ------------------------------------------------------------ events

	private rowKey(element: Element): string | undefined {
		return element.closest<HTMLElement>('.oi-property-row')?.dataset.key;
	}

	private bind(): void {
		const root = this.root;
		root.addEventListener('click', (event) => {
			if (this.swallowClick) {
				this.swallowClick = false;
				event.preventDefault();
				return;
			}
			const target = event.target as HTMLElement;
			const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
			const key = this.rowKey(target);
			if (target.closest('[data-kind-choice]')) {
				const choice = target.closest<HTMLElement>('[data-kind-choice]')!;
				const menuKey = this.menu?.dataset.key;
				this.closeMenu();
				if (menuKey) this.changeKind(menuKey, choice.dataset.kindChoice as PropertyKind);
				return;
			}
			if (action === 'Add') {
				this.formOpen = true;
				this.render();
				root.querySelector<HTMLInputElement>('[data-field="new"]')?.focus();
			} else if (action === 'AddConfirm') this.addFromForm();
			else if (action === 'AddCancel') this.closeForm();
			else if (action === 'Remove' && key !== undefined) this.commit(setValue(this.block.body, key, undefined));
			else if (action === 'Kind' && key !== undefined) this.toggleMenu(key, target.closest<HTMLElement>('.oi-property-kind')!);
			else if (action === 'PillRemove' && key !== undefined) this.removePill(key, Number(target.closest<HTMLElement>('[data-index]')!.dataset.index));
			else if (action === 'PillAdd' && key !== undefined) this.editPill(key, -1);
			else if (target.closest('.oi-pill') && key !== undefined && !this.readOnly()) this.editPill(key, Number(target.closest<HTMLElement>('.oi-pill')!.dataset.index));
		});
		root.addEventListener('change', (event) => {
			const target = event.target as HTMLInputElement;
			const key = this.rowKey(target);
			if (target.classList.contains('oi-property-new-kind')) {
				this.formKind = target.value as PropertyKind;
				this.formKindChosen = true;
				const hint = root.querySelector('.oi-property-hint');
				if (hint) hint.textContent = propertyKindExample[this.formKind];
				return;
			}
			if (key === undefined) return;
			if (target.classList.contains('oi-property-key')) this.renameProperty(key, target);
			else if (target.classList.contains('oi-property-check')) this.commit(setValue(this.block.body, key, target.checked), true);
			else if (target.classList.contains('oi-property-input')) this.commitInput(key, target);
		});
		root.addEventListener('input', (event) => {
			const target = event.target as HTMLInputElement;
			if (target.classList.contains('oi-property-new')) {
				this.formName = target.value;
				if (!this.formKindChosen) {
					this.formKind = guessKind(target.value);
					const select = root.querySelector<HTMLSelectElement>('.oi-property-new-kind');
					if (select) select.value = this.formKind;
					const hint = root.querySelector('.oi-property-hint');
					if (hint) hint.textContent = propertyKindExample[this.formKind];
				}
			} else if (target.classList.contains('oi-pill-input')) target.size = Math.max(4, target.value.length + 1);
		});
		root.addEventListener('keydown', (event) => this.onKey(event));
		root.addEventListener('focusout', (event) => {
			const target = event.target as HTMLInputElement;
			// a pill being edited is kept when you click or tab away
			if (target.classList.contains('oi-pill-input') && this.pillEdit && target.isConnected) {
				const edit = this.pillEdit;
				window.setTimeout(() => {
					if (this.pillEdit === edit) this.commitPill(edit.key, edit.index, target.value, false);
				}, 0);
			}
		});
		root.addEventListener('pointerdown', (event) => this.onPointerDown(event));
		root.addEventListener('pointermove', (event) => this.onPointerMove(event));
		root.addEventListener('pointerup', (event) => this.onPointerUp(event));
		root.addEventListener('pointercancel', () => this.endDrag(false));
	}

	private onKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		if (event.isComposing) return;
		if (event.key === 'Escape' && this.menu) {
			event.preventDefault();
			event.stopPropagation();
			this.closeMenu();
			return;
		}
		if (target instanceof HTMLInputElement && target.classList.contains('oi-property-new')) {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.addFromForm();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.closeForm();
			}
			return;
		}
		if (target instanceof HTMLInputElement && target.classList.contains('oi-pill-input')) {
			const edit = this.pillEdit;
			if (!edit) return;
			if (event.key === 'Enter' || (event.key === ',' && edit.key !== 'Alias')) {
				event.preventDefault();
				// Enter or a comma keeps the pill and starts the next one, as in Obsidian
				this.commitPill(edit.key, edit.index, target.value, target.value.trim() !== '');
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.pillEdit = undefined;
				this.render();
			} else if (event.key === 'Backspace' && target.value === '' && edit.index >= 0) {
				event.preventDefault();
				this.pillEdit = undefined;
				this.removePill(edit.key, edit.index);
			}
			return;
		}
		if (target instanceof HTMLInputElement && (target.classList.contains('oi-property-input') || target.classList.contains('oi-property-key'))) {
			if (event.key === 'Enter') {
				event.preventDefault();
				target.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				target.value = target.dataset.oiCommitted ?? target.value;
				target.blur();
			}
			return;
		}
		if (target.classList.contains('oi-pill') && (event.key === 'Enter' || event.key === ' ')) {
			event.preventDefault();
			const key = this.rowKey(target);
			if (key !== undefined) this.editPill(key, Number(target.dataset.index));
		}
		if (target.classList.contains('oi-pill') && (event.key === 'Delete' || event.key === 'Backspace')) {
			event.preventDefault();
			const key = this.rowKey(target);
			if (key !== undefined) this.removePill(key, Number(target.dataset.index));
		}
	}

	// ------------------------------------------------------------ actions

	private addFromForm(): void {
		const input = this.root.querySelector<HTMLInputElement>('[data-field="new"]');
		const name = (input?.value ?? this.formName).trim().replace(/:+$/, '');
		if (name === '') {
			input?.focus();
			return;
		}
		if (hasKey(this.block.body, name)) {
			this.closeForm();
			this.root.querySelector<HTMLElement>(`.oi-property-row[data-key="${attributeValue(name)}"] [data-field]`)?.focus();
			return;
		}
		const kind = this.formKind;
		this.formOpen = false;
		this.formName = '';
		this.formKindChosen = false;
		this.formKind = 'Text';
		// a list starts by asking for its first item
		if (kind === 'List') this.pillEdit = { key: name, index: -1 };
		this.commit(setValue(this.block.body, name, defaultOf(kind)));
		if (kind !== 'List') this.root.querySelector<HTMLElement>(`.oi-property-row[data-key="${attributeValue(name)}"] .oi-property-value [data-field]`)?.focus();
	}

	private closeForm(): void {
		this.formOpen = false;
		this.formName = '';
		this.formKindChosen = false;
		this.formKind = 'Text';
		this.render();
		this.root.querySelector<HTMLElement>('.oi-property-add')?.focus();
	}

	private renameProperty(key: string, input: HTMLInputElement): void {
		const next = input.value.trim().replace(/:+$/, '');
		if (next === '' || next === key || hasKey(this.block.body, next)) {
			input.value = key;
			return;
		}
		this.commit(renameKey(this.block.body, key, next));
	}

	private commitInput(key: string, input: HTMLInputElement): void {
		const kind = (input.dataset.kind ?? 'Text') as PropertyKind;
		let value: PropertyValue;
		if (kind === 'DateTime') value = input.value === '' ? '' : dateTimeValue(input.value, input.dataset.offset);
		else if (kind === 'Date') value = input.value;
		else value = readTyped(input.value, kind);
		input.dataset.oiCommitted = input.value;
		this.commit(setValue(this.block.body, key, value), true);
	}

	private changeKind(key: string, kind: PropertyKind): void {
		const value = entryList(this.block.body).find(([name]) => name === key)?.[1];
		if (kindOf(value) === kind) return;
		this.commit(setValue(this.block.body, key, convert(value, kind)));
	}

	private listOf(key: string): PropertyValue[] {
		const value = entryList(this.block.body).find(([name]) => name === key)?.[1];
		return Array.isArray(value) ? value : [];
	}

	private editPill(key: string, index: number): void {
		this.pillEdit = { key, index };
		this.render();
	}

	private removePill(key: string, index: number): void {
		const list = this.listOf(key).filter((_, at) => at !== index);
		this.commit(setValue(this.block.body, key, list));
		this.render();
	}

	/** Keeps an edited pill; `next` starts a new one right after. */
	private commitPill(key: string, index: number, text: string, next: boolean): void {
		const clean = (key === 'Tag' ? text.replace(/^#+/, '') : text).trim();
		const list = [...this.listOf(key)];
		if (index < 0) {
			if (clean !== '') list.push(clean);
		} else if (clean === '') list.splice(index, 1);
		else list[index] = clean;
		this.pillEdit = next ? { key, index: -1 } : undefined;
		const body = setValue(this.block.body, key, list);
		if (body === this.block.body) this.render();
		else this.commit(body);
	}

	// ------------------------------------------------------------ the type menu

	private toggleMenu(key: string, anchor: HTMLElement): void {
		if (this.menu?.dataset.key === key) {
			this.closeMenu();
			return;
		}
		this.closeMenu();
		const current = kindOf(entryList(this.block.body).find(([name]) => name === key)?.[1]);
		const menu = document.createElement('div');
		menu.className = 'oi-property-menu';
		menu.dataset.key = key;
		menu.setAttribute('role', 'menu');
		menu.innerHTML = propertyKindList
			.map((kind) => `<button type="button" class="oi-property-menu-item${kind === current ? ' active' : ''}" role="menuitem" data-kind-choice="${kind}">${propertyKindIcon[kind]}<span>${propertyKindTitle[kind]}</span></button>`)
			.join('');
		const rect = anchor.getBoundingClientRect();
		const box = this.root.getBoundingClientRect();
		menu.style.left = `${rect.left - box.left}px`;
		menu.style.top = `${rect.bottom - box.top + 4}px`;
		this.root.append(menu);
		this.menu = menu;
		menu.querySelector<HTMLElement>('.active')?.focus();
		document.addEventListener('pointerdown', this.onDocumentPointer, true);
	}

	private closeMenu(): void {
		if (!this.menu) return;
		this.menu.remove();
		this.menu = undefined;
		document.removeEventListener('pointerdown', this.onDocumentPointer, true);
	}

	// ------------------------------------------------------------ dragging pills and rows

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 || this.readOnly()) return;
		const target = event.target as HTMLElement;
		if (target.closest('.oi-pill-remove, input')) return;
		const pill = target.closest<HTMLElement>('.oi-pill');
		const kindButton = target.closest<HTMLElement>('.oi-property-kind');
		const element = pill ?? kindButton?.closest<HTMLElement>('.oi-property-row');
		const key = this.rowKey(target);
		if (!element || key === undefined) return;
		this.drag = {
			kind: pill ? 'Pill' : 'Row',
			key,
			index: Number(pill ? pill.dataset.index : element.dataset.index),
			element,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			moving: false,
			target: -1,
		};
	}

	private onPointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.moving) {
			if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
			drag.moving = true;
			drag.element.setAttribute('data-dragging', '');
			try {
				this.root.setPointerCapture(event.pointerId);
			} catch {
				// the pointer may already be gone
			}
			this.closeMenu();
		}
		event.preventDefault();
		for (const marker of this.root.querySelectorAll('.oi-property-drop')) marker.remove();
		const marker = document.createElement('span');
		marker.className = 'oi-property-drop';
		if (drag.kind === 'Pill') {
			const pillList = [...this.root.querySelectorAll<HTMLElement>(`.oi-property-pill-row[data-key="${attributeValue(drag.key)}"] .oi-pill`)];
			// the first pill whose middle is right of (or below) the pointer
			let target = pillList.length;
			for (const [at, pill] of pillList.entries()) {
				const rect = pill.getBoundingClientRect();
				if (event.clientY < rect.top) {
					target = at;
					break;
				}
				if (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2) {
					target = at;
					break;
				}
			}
			drag.target = target;
			const anchor = pillList[target] ?? this.root.querySelector(`.oi-property-pill-row[data-key="${attributeValue(drag.key)}"] .oi-pill-add, .oi-property-pill-row[data-key="${attributeValue(drag.key)}"] .oi-pill-input`);
			if (anchor) anchor.before(marker);
			else this.root.querySelector(`.oi-property-pill-row[data-key="${attributeValue(drag.key)}"]`)?.append(marker);
		} else {
			marker.classList.add('oi-property-drop-row');
			const rowList = [...this.root.querySelectorAll<HTMLElement>('.oi-property-row')];
			let target = rowList.length;
			for (const [at, row] of rowList.entries()) {
				const rect = row.getBoundingClientRect();
				if (event.clientY < rect.top + rect.height / 2) {
					target = at;
					break;
				}
			}
			drag.target = target;
			const anchor = rowList[target];
			if (anchor) anchor.before(marker);
			else rowList[rowList.length - 1]?.after(marker);
		}
	}

	private onPointerUp(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		this.endDrag(drag.moving);
	}

	private endDrag(apply: boolean): void {
		const drag = this.drag;
		this.drag = undefined;
		if (!drag) return;
		drag.element.removeAttribute('data-dragging');
		for (const marker of this.root.querySelectorAll('.oi-property-drop')) marker.remove();
		if (!apply || !drag.moving) return;
		// the click that ends a drag isn't a click on the pill
		this.swallowClick = true;
		window.setTimeout(() => {
			this.swallowClick = false;
		}, 0);
		if (drag.target < 0) return;
		const to = drag.target > drag.index ? drag.target - 1 : drag.target;
		if (to === drag.index) return;
		if (drag.kind === 'Pill') this.commit(moveListItem(this.block.body, drag.key, drag.index, to));
		else this.commit(moveKey(this.block.body, drag.key, to));
	}
}

const propertyStyle = `
.oi-property { position: relative; display: flex; flex-direction: column; gap: 1px; font-size: 0.9em; }
.oi-read-only .oi-property[data-empty] { display: none; }
.oi-property-row { display: grid; grid-template-columns: minmax(110px, 30%) minmax(0, 1fr) 26px; align-items: center; gap: 6px; min-height: 32px; padding: 1px 4px; border-radius: 6px; }
.oi-read-only .oi-property-row { grid-template-columns: minmax(110px, 30%) minmax(0, 1fr); }
.oi-property-row:hover, .oi-property-row:focus-within { background: var(--oi-color-surface1); }
.oi-property-row[data-dragging] { opacity: 0.45; }
.oi-property-name { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--oi-color-text-muted); }
.oi-property-kind { flex: none; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: none; border-radius: 5px; background: none; color: var(--oi-color-text-muted); cursor: pointer; touch-action: none; }
button.oi-property-kind:hover { background: var(--oi-color-surface2); color: var(--oi-color-text); }
.oi-property-key, .oi-property-input { width: 100%; min-width: 0; padding: 3px 6px; border: none; border-radius: 4px; background: transparent; color: inherit; font: inherit; outline: none; }
.oi-property-input { color: var(--oi-color-text); }
.oi-property-key:focus, .oi-property-input:focus { background: var(--oi-color-background); color: var(--oi-color-text); box-shadow: inset 0 0 0 1px var(--oi-color-accent); }
.oi-property-input::placeholder { color: var(--oi-color-text-muted); opacity: 0.6; }
.oi-property-key-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 6px; }
.oi-property-text { padding: 3px 6px; overflow-wrap: anywhere; }
.oi-property-check { width: 16px; height: 16px; margin: 0 6px; accent-color: var(--oi-color-accent); }
.oi-property-remove { width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; background: none; color: var(--oi-color-text-muted); font-size: 15px; opacity: 0; cursor: pointer; }
.oi-property-row:hover .oi-property-remove, .oi-property-remove:focus-visible { opacity: 1; }
.oi-property-remove:hover { background: var(--oi-color-surface2); color: var(--oi-color-danger); }
.oi-property-pill-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 3px 2px; }
.oi-pill { display: inline-flex; align-items: center; padding: 1px 3px 1px 9px; border-radius: 999px; background: var(--oi-color-accent-soft); color: var(--oi-color-accent); line-height: 1.55; cursor: text; user-select: none; -webkit-user-select: none; touch-action: none; }
.oi-read-only .oi-pill { padding-inline-end: 9px; cursor: default; }
.oi-read-only .oi-pill-tag { cursor: pointer; }
.oi-pill[data-dragging] { opacity: 0.4; }
.oi-pill:focus-visible { outline: 2px solid var(--oi-color-accent); outline-offset: 1px; }
.oi-pill-remove { padding: 0 5px; border: none; background: none; color: inherit; font: inherit; line-height: 1; opacity: 0.55; cursor: pointer; }
.oi-pill-remove:hover { opacity: 1; }
.oi-pill-input { min-width: 4ch; padding: 1px 8px; border: 1px solid var(--oi-color-accent); border-radius: 999px; background: var(--oi-color-background); color: var(--oi-color-text); font: inherit; line-height: 1.5; outline: none; }
.oi-pill-add { width: 24px; height: 24px; padding: 0; border: 1px dashed var(--oi-color-border); border-radius: 999px; background: none; color: var(--oi-color-text-muted); font: inherit; line-height: 1; cursor: pointer; }
.oi-pill-add:hover { border-color: var(--oi-color-accent); color: var(--oi-color-accent); }
.oi-property-drop { display: inline-block; width: 2px; height: 22px; border-radius: 1px; background: var(--oi-color-accent); }
.oi-property-drop.oi-property-drop-row { display: block; width: 100%; height: 2px; }
.oi-property-add { align-self: flex-start; margin: 2px 0 0; padding: 4px 8px; border: none; border-radius: 5px; background: none; color: var(--oi-color-text-muted); font: inherit; cursor: pointer; }
.oi-property-add:hover, .oi-property-add:focus-visible { background: var(--oi-color-surface1); color: var(--oi-color-text); }
.oi-property-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 4px; }
.oi-property-new { flex: 1; min-width: 140px; padding: 4px 8px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); font: inherit; outline: none; }
.oi-property-new:focus, .oi-property-new-kind:focus { border-color: var(--oi-color-accent); }
.oi-property-new-kind { padding: 4px 6px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-background); color: var(--oi-color-text); font: inherit; }
.oi-property-button { padding: 4px 10px; border: 1px solid var(--oi-color-border); border-radius: 6px; background: var(--oi-color-surface1); color: var(--oi-color-text); font: inherit; cursor: pointer; }
.oi-property-button.primary { border-color: var(--oi-color-accent); background: var(--oi-color-accent); color: var(--oi-color-background); }
.oi-property-hint { flex-basis: 100%; padding: 0 2px; color: var(--oi-color-text-muted); font-family: var(--oi-font-code); font-size: 0.85em; }
.oi-property-menu { position: absolute; z-index: 5; min-width: 150px; display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--oi-color-border); border-radius: 8px; background: var(--oi-color-background); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); }
.oi-property-menu-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: none; border-radius: 5px; background: none; color: var(--oi-color-text); font: inherit; text-align: start; cursor: pointer; }
.oi-property-menu-item:hover, .oi-property-menu-item:focus-visible { background: var(--oi-color-surface2); outline: none; }
.oi-property-menu-item.active { color: var(--oi-color-accent); }
`;

const propertyBlockType: BlockTypeDefinition = {
	name: 'Property',
	content: 'Raw',
	// `Property: Tag: [Chem]` would read oddly: the fields always go on their own lines
	inlineBody: false,
	render: {
		mount(frame, block, context) {
			const view = new PropertyView(frame, block, context);
			return {
				update(next, nextContext) {
					view.update(next, nextContext);
					return 'Done';
				},
				destroy() {
					view.destroy();
				},
			};
		},
	},
	edit: { kind: 'Structured' },
	templateList: [
		{
			title: 'Property',
			icon: '☰',
			source: 'Property:',
			keywordList: ['tag', 'metadata', 'field', 'frontmatter', 'yaml', 'due', 'date'],
			explain: 'Tags, dates, checkboxes, and other fields, edited in place',
		},
	],
	style: propertyStyle,
	plainText: (block) => entryList(block.body).map(([key, value]) => `${key} ${plainText(value)}`).join('\n'),
};

export const propertyModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Property',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Property',
	explain:
		'A Property block holds the fields of a note (tags, dates, numbers, checkboxes, lists) as rows you edit in place, like Obsidian’s properties. It is written as plain Key: value lines, the basic types of YAML, so other tools can read it. Add one with + Add property under the title, /property, or Ctrl+;.',
	blockTypeList: [propertyBlockType],
	settingList: [
		{ id: 'Property.ShowType', title: 'Show the type icon', type: 'Toggle', default: true, explain: 'An icon before each name shows its type (text, list, number, checkbox, date). Click it to change the type, drag it to reorder.' },
		{ id: 'Property.TagHash', title: 'Show # on tags', type: 'Toggle', default: false, explain: 'Writes the tags in a Tag property as #Tag, like tags in text.' },
	],
};
