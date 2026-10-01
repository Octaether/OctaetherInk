// The top of a note, as in Obsidian: its name, which is the file's name (editing it renames the
// file, and Ctrl+Z renames it back). Under it, while the note has no Property block, a quiet
// "+ Add property". The note's own header (Created, Id, Format) belongs to the app and shows only
// in the Source view; a note that keeps fields of its own there gets an offer to move them into
// a Property block.

import type { BlockNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import { escapeHtml } from './ui';

export interface NoteHeadOption {
	model(): NoteModel | undefined;
	/** The note's name as shown (the file's name without .oi). */
	name(): string;
	readOnly(): boolean;
	/** Rename; resolves false when the name was refused (it then reverts). */
	rename(name: string): Promise<boolean>;
	/** Enter in the name: go on writing in the note. */
	onTitleDone(): void;
	addProperty(): void;
	moveHeaderProperty(): void;
}

/** Fields of the note's header that the app manages. */
export const systemKeySet: ReadonlySet<string> = new Set(['Id', 'Format', 'Created']);

/** The first Property block of a note, at any depth. */
export function propertyBlockOf(model: NoteModel): BlockNode | undefined {
	const find = (list: readonly BlockNode[]): BlockNode | undefined => {
		for (const node of list) {
			if (node.type === 'Property') return node;
			const inner = find(node.childList);
			if (inner) return inner;
		}
		return undefined;
	};
	return find(model.document.itemList);
}

/** Fields of your own kept in the note's header (older notes, or notes from elsewhere). */
export function headerKeyList(model: NoteModel): string[] {
	return (model.document.front?.entryList ?? []).flatMap((entry) => (entry.kind === 'Pair' && !systemKeySet.has(entry.key!) ? [entry.key!] : []));
}

const plusIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

export class NoteHead {
	readonly title: HTMLTextAreaElement;
	readonly action: HTMLElement;
	private titleShown = '';

	constructor(
		container: HTMLElement,
		readonly option: NoteHeadOption,
	) {
		this.title = document.createElement('textarea');
		this.title.className = 'inline-title';
		this.title.rows = 1;
		this.title.spellcheck = false;
		this.title.setAttribute('aria-label', 'Note name');
		this.action = document.createElement('div');
		this.action.className = 'note-head-action';
		container.prepend(this.title, this.action);
		this.title.addEventListener('input', () => {
			// a name is one line
			if (this.title.value.includes('\n')) this.title.value = this.title.value.replace(/\n/g, ' ');
			this.fitTitle();
		});
		this.title.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void this.commitTitle().then(() => this.option.onTitleDone());
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.title.value = this.titleShown;
				this.title.blur();
			}
		});
		this.title.addEventListener('blur', () => void this.commitTitle());
		this.action.addEventListener('click', (event) => {
			const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
			if (action === 'AddProperty') this.option.addProperty();
			else if (action === 'MoveHeader') this.option.moveHeaderProperty();
		});
		// a long name wraps differently when the window (or the sidebar) changes width
		if (typeof ResizeObserver === 'function') {
			let width = 0;
			new ResizeObserver((entryList) => {
				const next = Math.round(entryList[0]?.contentRect.width ?? 0);
				if (next === width) return;
				width = next;
				// on the next frame: resizing inside the observer's callback would loop
				requestAnimationFrame(() => this.fitTitle());
			}).observe(this.title);
		}
	}

	/** Shows the current note's name and what can be added under it. */
	refresh(): void {
		const name = this.option.name();
		// keep a name being typed; otherwise show the current one (after a rename, or an undo)
		if (document.activeElement !== this.title || this.title.value === this.titleShown) this.title.value = name;
		this.titleShown = name;
		// global undo first puts back a name typed but not kept (see Edit.Undo)
		this.title.dataset.oiCommitted = name;
		this.title.readOnly = this.option.readOnly();
		this.fitTitle();
		this.renderAction();
	}

	focusTitle(): void {
		this.title.focus();
		this.title.select();
	}

	private fitTitle(): void {
		// a hidden title measures 0: leave it one line tall until it shows (the observer fits it then)
		if (this.title.offsetParent === null) {
			this.title.style.height = '';
			return;
		}
		this.title.style.height = 'auto';
		this.title.style.height = `${this.title.scrollHeight}px`;
	}

	private async commitTitle(): Promise<void> {
		const next = this.title.value.trim();
		if (next === '' || next === this.titleShown || this.option.readOnly()) {
			this.title.value = this.titleShown;
			return;
		}
		const done = await this.option.rename(next);
		if (!done) this.title.value = this.titleShown;
		this.fitTitle();
	}

	private renderAction(): void {
		const model = this.option.model();
		if (!model || this.option.readOnly()) {
			this.action.hidden = true;
			this.action.replaceChildren();
			return;
		}
		const keyList = headerKeyList(model);
		let html = '';
		if (keyList.length > 0) {
			const list = keyList.map((key) => `<b>${escapeHtml(key)}</b>`).join(', ');
			html += `<div class="note-head-notice">This note keeps ${list} in its header, which only the Source view shows. <button type="button" class="note-head-link" data-action="MoveHeader">Show as properties</button></div>`;
		}
		if (!propertyBlockOf(model)) html += `<button type="button" class="note-head-add" data-action="AddProperty" title="Add property (Ctrl+;)">${plusIcon}<span>Add property</span></button>`;
		this.action.innerHTML = html;
		this.action.hidden = html === '';
	}
}
