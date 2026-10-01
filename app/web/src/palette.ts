// Pickers in a floating box: the command palette (Ctrl+P) and the quick switcher (Ctrl+O in a
// vault). Type to filter, arrows to move, Enter to run.

import type { CommandRegistry } from '@octaether/core-edit';
import { escapeHtml, openModal } from './ui';

export interface PickerItem {
	title: string;
	/** Muted text on the right (a hotkey, a folder). */
	hint?: string;
	/** Extra words that also match. */
	keyword?: string;
	run(): void;
}

export interface PickerOption {
	placeholder: string;
	itemList(query: string): PickerItem[];
	/** Shown (as an item) when nothing matches, e.g. "Create note “…”". */
	fallback?(query: string): PickerItem | undefined;
	emptyText?: string;
}

/** Scores how well `query` matches `text`: whole words first, then in order, else -1. */
export function fuzzyScore(text: string, query: string): number {
	const haystack = text.toLowerCase();
	const needle = query.trim().toLowerCase();
	if (needle === '') return 0;
	if (haystack.startsWith(needle)) return 0;
	const at = haystack.indexOf(needle);
	if (at >= 0) return 1 + at / 100;
	// letters in order (quick switcher style: "lec5" finds "Lecture 05")
	let position = 0;
	let gap = 0;
	for (const character of needle) {
		const next = haystack.indexOf(character, position);
		if (next < 0) return -1;
		gap += next - position;
		position = next + 1;
	}
	return 3 + gap / 50;
}

/** The best score over several texts (each with a penalty added), or -1 when none of them matches. */
export function bestFuzzyScore(query: string, candidateList: readonly (readonly [text: string, penalty: number])[]): number {
	let best = -1;
	for (const [text, penalty] of candidateList) {
		const score = fuzzyScore(text, query);
		if (score >= 0 && (best < 0 || score + penalty < best)) best = score + penalty;
	}
	return best;
}

export function openPicker(option: PickerOption): void {
	openModal('palette-modal', (modal, close) => {
		modal.innerHTML = `<input class="palette-input" placeholder="${escapeHtml(option.placeholder)}" aria-label="${escapeHtml(option.placeholder)}" spellcheck="false"><div class="palette-list" role="listbox"></div>`;
		const input = modal.querySelector<HTMLInputElement>('.palette-input')!;
		const list = modal.querySelector<HTMLElement>('.palette-list')!;
		let active = 0;
		let visible: PickerItem[] = [];
		const compute = (): void => {
			visible = option.itemList(input.value);
			if (visible.length === 0) {
				const fallback = option.fallback?.(input.value);
				if (fallback) visible = [fallback];
			}
		};
		const render = (): void => {
			list.innerHTML =
				visible
					.map((item, index) => `<div class="palette-item${index === active ? ' active' : ''}" role="option" aria-selected="${index === active}" data-index="${index}"><span>${escapeHtml(item.title)}</span>${item.hint ? `<kbd>${escapeHtml(item.hint)}</kbd>` : ''}</div>`)
					.join('') || `<div class="menu-empty">${escapeHtml(option.emptyText ?? 'Nothing matches')}</div>`;
			for (const row of list.querySelectorAll<HTMLElement>('.palette-item')) {
				row.addEventListener('click', () => run(Number(row.dataset.index)));
				row.addEventListener('pointermove', () => {
					if (active === Number(row.dataset.index)) return;
					active = Number(row.dataset.index);
					render();
				});
			}
			list.children[active]?.scrollIntoView({ block: 'nearest' });
		};
		const run = (index: number): void => {
			const item = visible[index];
			if (!item) return;
			close();
			item.run();
		};
		input.addEventListener('input', () => {
			active = 0;
			compute();
			render();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				active = (active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % Math.max(visible.length, 1);
				render();
			} else if (event.key === 'Enter') {
				event.preventDefault();
				run(active);
			}
		});
		compute();
		render();
		input.focus();
	});
}

export function openCommandPalette(commandRegistry: CommandRegistry, hotkey: (command: string) => string): void {
	openPicker({
		placeholder: 'Type a command',
		emptyText: 'No command matches',
		itemList: (query) =>
			commandRegistry
				.list()
				.map((command) => ({ command, score: bestFuzzyScore(query, [[command.title, 0], [command.id, 0.5]]) }))
				.filter((item) => item.score >= 0)
				.sort((left, right) => left.score - right.score || left.command.title.localeCompare(right.command.title))
				.map(({ command }) => ({ title: command.title, hint: hotkey(command.id), run: () => void commandRegistry.run(command.id) })),
	});
}
