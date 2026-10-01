// Find (Ctrl+F) and Replace (Ctrl+H) in the note. Works on what is showing: the rendered note
// (matches are highlighted in the page through the source maps, so a match inside bold text or a
// table cell lights up exactly there) or the Source view.

import type { EditSession } from '@octaether/core-edit';
import { walkNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import type { RenderHost } from '@octaether/core-render';
import { icon } from './icon';
import type { SourceEditor, TextMatch } from './source-editor';

export interface FindTarget {
	/** Finds every match; returns how many. */
	search(pattern: RegExp): number;
	/** Highlights the matches and the current one (and scrolls to it). */
	show(current: number, reveal: boolean): void;
	replace(current: number, text: string): void;
	replaceAll(text: string): number;
	clear(): void;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- the rendered note

interface NoteMatch {
	key: string;
	start: number;
	end: number;
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };

function highlightRegistry(): { registry: HighlightRegistry; Highlight: new (...rangeList: Range[]) => unknown } | undefined {
	const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
	const Highlight = (globalThis as unknown as { Highlight?: new (...rangeList: Range[]) => unknown }).Highlight;
	return registry && Highlight ? { registry, Highlight } : undefined;
}

/** Text nodes of pieces that copy their source 1:1, with the source offset where each starts. */
function segmentList(content: HTMLElement): { node: Text; start: number }[] {
	const list: { node: Text; start: number }[] = [];
	const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const piece = node.parentElement?.closest<HTMLElement>('[data-oi-s]');
		if (!piece || !content.contains(piece) || piece.hasAttribute('data-oi-e')) continue;
		// characters before this text node inside the same piece
		const before = document.createRange();
		before.setStart(piece, 0);
		before.setEnd(node, 0);
		list.push({ node, start: Number(piece.dataset.oiS) + before.toString().length });
	}
	return list;
}

export class NoteFindTarget implements FindTarget {
	private matchList: NoteMatch[] = [];

	constructor(
		private readonly model: () => NoteModel | undefined,
		private readonly host: RenderHost,
		private readonly session: EditSession,
	) {}

	search(pattern: RegExp): number {
		const model = this.model();
		this.matchList = [];
		if (!model) return 0;
		walkNode(model.document.itemList, (node) => {
			pattern.lastIndex = 0;
			for (let match = pattern.exec(node.body); match; match = pattern.exec(node.body)) {
				if (match[0] === '') {
					pattern.lastIndex++;
					continue;
				}
				this.matchList.push({ key: node.key, start: match.index, end: match.index + match[0].length });
			}
		});
		return this.matchList.length;
	}

	private rangeOf(match: NoteMatch): Range | undefined {
		const content = this.host.contentOf(match.key);
		if (!content) return undefined;
		const list = segmentList(content);
		// the start sits inside a piece; the end may sit at a piece's very end
		const locate = (offset: number, atEnd: boolean): { node: Text; offset: number } | undefined => {
			for (const segment of list) {
				const end = segment.start + segment.node.data.length;
				if (atEnd ? offset > segment.start && offset <= end : offset >= segment.start && offset < end) return { node: segment.node, offset: offset - segment.start };
			}
			return undefined;
		};
		const start = locate(match.start, false);
		const end = locate(match.end, true);
		const range = document.createRange();
		if (start && end) {
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
		} else range.selectNodeContents(content);
		return range;
	}

	show(current: number, reveal: boolean): void {
		// highlights are drawn on the page, so the block editor steps aside
		if (this.session.editingKey()) this.session.close();
		this.clearFallback();
		const highlight = highlightRegistry();
		const rangeList = this.matchList.map((match) => this.rangeOf(match));
		if (highlight) {
			highlight.registry.set('oi-find', new highlight.Highlight(...rangeList.filter((range): range is Range => range !== undefined)));
			const currentRange = rangeList[current];
			highlight.registry.set('oi-find-current', currentRange ? new highlight.Highlight(currentRange) : new highlight.Highlight());
		} else {
			for (const match of this.matchList) this.host.frameOf(match.key)?.classList.add('oi-find-hit');
		}
		const currentMatch = this.matchList[current];
		if (currentMatch) {
			this.host.frameOf(currentMatch.key)?.classList.add('oi-find-current-block');
			if (reveal) {
				const rect = rangeList[current]?.getBoundingClientRect();
				const view = document.getElementById('viewContent');
				if (rect && view && rect.height > 0) {
					const box = view.getBoundingClientRect();
					if (rect.top < box.top + 60 || rect.bottom > box.bottom - 40) view.scrollBy({ top: rect.top - box.top - box.height / 3 });
				} else this.host.frameOf(currentMatch.key)?.scrollIntoView({ block: 'center' });
			}
		}
	}

	replace(current: number, text: string): void {
		const model = this.model();
		const match = this.matchList[current];
		if (!model || !match || !model.get(match.key)) return;
		const body = model.bodyOf(match.key);
		model.setBody(match.key, body.slice(0, match.start) + text + body.slice(match.end));
	}

	replaceAll(text: string): number {
		const model = this.model();
		if (!model || this.matchList.length === 0) return 0;
		const count = this.matchList.length;
		const byKey = new Map<string, NoteMatch[]>();
		for (const match of this.matchList) byKey.set(match.key, [...(byKey.get(match.key) ?? []), match]);
		model.transact(() => {
			for (const [key, list] of byKey) {
				let body = model.bodyOf(key);
				for (const match of [...list].reverse()) body = body.slice(0, match.start) + text + body.slice(match.end);
				model.setBody(key, body);
			}
		});
		return count;
	}

	clear(): void {
		const highlight = highlightRegistry();
		highlight?.registry.delete('oi-find');
		highlight?.registry.delete('oi-find-current');
		this.clearFallback();
		this.matchList = [];
	}

	private clearFallback(): void {
		for (const element of this.host.root.querySelectorAll('.oi-find-hit, .oi-find-current-block')) element.classList.remove('oi-find-hit', 'oi-find-current-block');
	}
}

// ---------------------------------------------------------------- the Source view

export class SourceFindTarget implements FindTarget {
	private matchList: TextMatch[] = [];

	constructor(
		private readonly editor: () => SourceEditor | undefined,
		private readonly onEdit: () => void,
	) {}

	search(pattern: RegExp): number {
		const text = this.editor()?.text() ?? '';
		this.matchList = [];
		pattern.lastIndex = 0;
		for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
			if (match[0] === '') {
				pattern.lastIndex++;
				continue;
			}
			this.matchList.push({ start: match.index, end: match.index + match[0].length });
		}
		return this.matchList.length;
	}

	show(current: number, reveal: boolean): void {
		this.editor()?.setMatchList(this.matchList, current, reveal);
	}

	replace(current: number, text: string): void {
		const editor = this.editor();
		const match = this.matchList[current];
		if (!editor || !match) return;
		const value = editor.text();
		editor.setText(value.slice(0, match.start) + text + value.slice(match.end));
		this.onEdit();
	}

	replaceAll(text: string): number {
		const editor = this.editor();
		if (!editor || this.matchList.length === 0) return 0;
		let value = editor.text();
		for (const match of [...this.matchList].reverse()) value = value.slice(0, match.start) + text + value.slice(match.end);
		editor.setText(value);
		this.onEdit();
		return this.matchList.length;
	}

	clear(): void {
		this.matchList = [];
		this.editor()?.setMatchList([], -1, false);
	}
}

// ---------------------------------------------------------------- the bar

export class FindBar {
	readonly element: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly replaceInput: HTMLInputElement;
	private readonly countElement: HTMLElement;
	private count = 0;
	private current = 0;
	private matchCase = false;
	private regex = false;
	private target: FindTarget | undefined;

	constructor(
		container: HTMLElement,
		private readonly targetOf: () => FindTarget | undefined,
		private readonly notify: (message: string) => void,
	) {
		this.element = document.createElement('div');
		this.element.className = 'find-bar';
		this.element.hidden = true;
		this.element.dataset.oiKeepEditor = '';
		this.element.innerHTML =
			'<div class="find-row">' +
			'<input class="find-input" placeholder="Find" aria-label="Find in note" spellcheck="false">' +
			'<span class="find-count" aria-live="polite"></span>' +
			'<button type="button" class="find-toggle" data-toggle="Case" title="Match case" aria-pressed="false">Aa</button>' +
			'<button type="button" class="find-toggle" data-toggle="Regex" title="Regular expression" aria-pressed="false">.*</button>' +
			`<button type="button" class="find-button" data-step="-1" title="Previous (Shift+Enter)" aria-label="Previous">${icon.ChevronUp}</button>` +
			`<button type="button" class="find-button" data-step="1" title="Next (Enter)" aria-label="Next">${icon.ChevronDown}</button>` +
			`<button type="button" class="find-button" data-action="Close" title="Close (Esc)" aria-label="Close">${icon.Close}</button></div>` +
			'<div class="find-row find-replace" hidden><input class="find-input" placeholder="Replace" aria-label="Replace with" spellcheck="false">' +
			'<button type="button" class="find-text-button" data-action="Replace">Replace</button><button type="button" class="find-text-button" data-action="All">All</button></div>';
		container.prepend(this.element);
		const [input, replaceInput] = this.element.querySelectorAll<HTMLInputElement>('.find-input');
		this.input = input!;
		this.replaceInput = replaceInput!;
		this.countElement = this.element.querySelector('.find-count')!;
		this.input.addEventListener('input', () => this.run(true));
		this.input.addEventListener('keydown', (event) => this.onKey(event, false));
		this.replaceInput.addEventListener('keydown', (event) => this.onKey(event, true));
		for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-step]')) button.addEventListener('click', () => this.step(Number(button.dataset.step)));
		for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
			button.addEventListener('click', () => {
				if (button.dataset.toggle === 'Case') this.matchCase = !this.matchCase;
				else this.regex = !this.regex;
				button.setAttribute('aria-pressed', String(button.dataset.toggle === 'Case' ? this.matchCase : this.regex));
				button.classList.toggle('active', button.dataset.toggle === 'Case' ? this.matchCase : this.regex);
				this.run(true);
			});
		}
		this.element.querySelector('[data-action="Close"]')!.addEventListener('click', () => this.close());
		this.element.querySelector('[data-action="Replace"]')!.addEventListener('click', () => this.replaceOne());
		this.element.querySelector('[data-action="All"]')!.addEventListener('click', () => this.replaceAll());
	}

	isOpen(): boolean {
		return !this.element.hidden;
	}

	/** Opens the bar (with Replace when `replace`), starting from `query` (the selected text). */
	open(replace: boolean, query?: string, toggle?: { matchCase: boolean; regex: boolean }): void {
		this.element.hidden = false;
		this.element.querySelector<HTMLElement>('.find-replace')!.hidden = !replace;
		if (query && !query.includes('\n')) this.input.value = query;
		if (toggle) {
			this.matchCase = toggle.matchCase;
			this.regex = toggle.regex;
			for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
				const on = button.dataset.toggle === 'Case' ? this.matchCase : this.regex;
				button.classList.toggle('active', on);
				button.setAttribute('aria-pressed', String(on));
			}
		}
		this.input.focus();
		this.input.select();
		this.run(true);
	}

	close(): void {
		if (this.element.hidden) return;
		// the page's own keys (Alt+W, Delete on a block) work again at once
		if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
		this.element.hidden = true;
		this.target?.clear();
		this.target = undefined;
	}

	/** Searches again (after the note changed or the view switched). */
	refresh(): void {
		if (this.isOpen()) this.run(false);
	}

	private pattern(): RegExp | undefined {
		const text = this.input.value;
		if (text === '') return undefined;
		try {
			return new RegExp(this.regex ? text : escapeRegExp(text), this.matchCase ? 'gu' : 'giu');
		} catch {
			return undefined;
		}
	}

	private run(reveal: boolean): void {
		const target = this.targetOf();
		if (this.target && this.target !== target) this.target.clear();
		this.target = target;
		const pattern = this.pattern();
		if (!target || !pattern) {
			target?.clear();
			this.count = 0;
			this.countElement.textContent = this.input.value && !pattern ? 'Invalid' : '';
			return;
		}
		this.count = target.search(pattern);
		this.current = Math.min(this.current, Math.max(this.count - 1, 0));
		this.countElement.textContent = this.count === 0 ? 'No results' : `${this.current + 1} of ${this.count}`;
		target.show(this.count ? this.current : -1, reveal);
	}

	private step(direction: number): void {
		if (this.count === 0) return;
		this.current = (this.current + direction + this.count) % this.count;
		this.countElement.textContent = `${this.current + 1} of ${this.count}`;
		this.target?.show(this.current, true);
	}

	private replaceOne(): void {
		if (!this.target || this.count === 0) return;
		this.target.replace(this.current, this.replaceInput.value);
		this.run(true);
	}

	private replaceAll(): void {
		if (!this.target || this.count === 0) return;
		const count = this.target.replaceAll(this.replaceInput.value);
		this.notify(`Replaced ${count} ${count === 1 ? 'match' : 'matches'}.`);
		this.run(false);
	}

	private onKey(event: KeyboardEvent, inReplace: boolean): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (inReplace) {
				if (event.ctrlKey || event.metaKey) this.replaceAll();
				else this.replaceOne();
			} else this.step(event.shiftKey ? -1 : 1);
		}
	}
}
