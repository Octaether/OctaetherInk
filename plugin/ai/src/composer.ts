// What the chat and the Ask AI box share at the bottom, as in Claude Code's input: the icons, the
// model button (`Opus 5.5 · High`) and its menu (the models your key can use, the effort, the
// connection's settings).

import { type CommandAccess, type HostContext, commandExtension, escapeHtml, t } from '@octaether/core-sdk';
import { type Connection, type Effort, type ModelEntry, connectionOf, currentConnection, effortList, effortOf, effortTitle, modelTitle, updateConnection } from './connection';
import { ProviderError, listModel } from './provider';

const svg = (path: string, size = 15): string => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const mark = {
	/** Send: an arrow up. */
	Send: svg('<path d="M8 13V3.5"/><path d="M3.8 7.6 8 3.4l4.2 4.2"/>', 16),
	/** Stop: a square. */
	Stop: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>',
	Plus: svg('<path d="M8 3v10M3 8h10"/>'),
	/** The chats kept: a clock with an arrow going back. */
	History: svg('<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.3 2.6v2.6h2.6"/><path d="M8 5v3.2l2.1 1.3"/>'),
	/** A new chat: a page with a pencil. */
	New: svg('<path d="M13.5 8.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4.5"/><path d="M11.6 2.1a1.3 1.3 0 0 1 1.9 1.9L8.2 9.3 6 10l.7-2.2z"/>'),
	/** Memory: a bookmark. */
	Memory: svg('<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z"/>'),
	/** Open in the chat: a box with an arrow out of it. */
	Open: svg('<path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 7.5 8.5"/><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>'),
	Chevron: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>', 12),
	Close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 12),
	Archive: svg('<rect x="2" y="3" width="12" height="3" rx="0.6"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/><path d="M6.5 9h3"/>', 14),
	Unarchive: svg('<rect x="2" y="3" width="12" height="3" rx="0.6"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/><path d="M8 12.5V8.5M6.3 10.2 8 8.5l1.7 1.7"/>', 14),
	Delete: svg('<path d="M3 4.5h10"/><path d="M6.5 4.5V3h3v1.5"/><path d="M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5"/>', 14),
	Rename: svg('<path d="M11.6 2.1a1.3 1.3 0 0 1 1.9 1.9L5 12.5l-2.5.7.7-2.5z"/>', 14),
	Note: svg('<path d="M4 2.5h5.5L12.5 5.5v8H4z"/><path d="M9.5 2.5v3h3"/>', 14),
	File: svg('<path d="M10.5 6.5 6.6 10.4a1.6 1.6 0 0 1-2.3-2.3l4.6-4.6a2.6 2.6 0 0 1 3.7 3.7L8 11.8"/>', 14),
	/** Manual: a hand that holds each change. */
	Manual: svg('<path d="M5.5 8V3.8a1 1 0 0 1 2 0V7"/><path d="M7.5 7V3a1 1 0 0 1 2 0v4"/><path d="M9.5 7V3.8a1 1 0 0 1 2 0V9"/><path d="M5.5 8 4.6 7a1 1 0 0 0-1.5 1.3l2 2.9A4 4 0 0 0 8.4 13h.6a2.5 2.5 0 0 0 2.5-2.5V9"/>', 14),
	/** Plan: a list. */
	Plan: svg('<path d="M6 4.5h7M6 8h7M6 11.5h7"/><path d="M3 4.5h.5M3 8h.5M3 11.5h.5"/>', 14),
	/** Auto: a bolt. */
	Auto: svg('<path d="M9 2 4 9h3.5L7 14l5-7H8.5z"/>', 14),
};

/** The model button's words: `Opus 5.5 · High` (the effort only when one is set). */
export function modelButtonText(connection: Connection | undefined): string {
	if (!connection) return t('Connect an AI');
	const effort = effortOf(connection);
	return effort === 'Default' ? modelTitle(connection) : `${modelTitle(connection)} · ${t(effortTitle[effort])}`;
}

/** Opens Setting at the AI's page, where the provider, the key, and the model are chosen. */
export function openConnectionSetting(context: HostContext): void {
	context.extension<CommandAccess>(commandExtension)?.run('Setting.Open', 'Module:AI');
}

let closePicker: (() => void) | undefined;

/** Closes the model picker, when it is open. */
export function closeModelMenu(): void {
	closePicker?.();
}

/**
 * The model picker, over the model button, as in Claude Code: the models your key can use (by
 * name, filtered as you type when there are many), and under them the effort as a slider (← →).
 * A click on a model chooses it and closes; the effort changes at once and the picker stays.
 * At the bottom: a fresh list of models, and the connection's settings. `onChange` runs after a choice.
 */
export function openModelMenu(context: HostContext, anchor: HTMLElement, onChange: () => void, say?: (text: string, problem?: boolean) => void): void {
	if (closePicker) {
		closePicker();
		return;
	}
	if (!currentConnection()) {
		openConnectionSetting(context);
		return;
	}
	const picker = document.createElement('div');
	picker.className = 'oi-model-menu';
	picker.setAttribute('role', 'dialog');
	picker.setAttribute('aria-label', t('Select a model'));
	picker.dataset.oiKeepEditor = '';
	document.body.append(picker);
	let query = '';
	let active = -1;

	const modelListOf = (connection: Connection): ModelEntry[] => {
		const list = [...(connection.modelList ?? [])];
		if (!list.some((item) => item.id === connection.model)) list.push({ id: connection.model, title: connection.model });
		const name = (item: ModelEntry): string => modelTitle({ model: item.id, modelList: [item] });
		return list.sort((left, right) => name(left).localeCompare(name(right), undefined, { numeric: true, sensitivity: 'base' }));
	};

	const draw = (): void => {
		const connection = currentConnection();
		if (!connection) {
			close();
			return;
		}
		const all = modelListOf(connection);
		const text = query.trim().toLowerCase();
		const shown = text ? all.filter((item) => `${modelTitle({ model: item.id, modelList: [item] })} ${item.id}`.toLowerCase().includes(text)) : all;
		if (active >= shown.length) active = shown.length - 1;
		const noEffort = connection.noEffortList?.includes(connection.model) === true;
		const effort = noEffort ? 'Default' : (connection.effort ?? 'Default');
		const level = effortList.indexOf(effort);
		const focusedSearch = document.activeElement?.classList.contains('oi-model-search') === true;
		picker.innerHTML =
			`<div class="oi-model-head">${escapeHtml(t('Select a model'))}</div>` +
			(all.length > 8 ? `<input class="oi-model-search" placeholder="${escapeHtml(t('Search'))}" aria-label="${escapeHtml(t('Search'))}" value="${escapeHtml(query)}" spellcheck="false" autocomplete="off">` : '') +
			`<div class="oi-model-list" role="listbox">${
				shown.length
					? shown
							.map((item, index) => {
								const title = modelTitle({ model: item.id, modelList: [item] });
								const current = item.id === connection.model;
								return `<button type="button" class="oi-model-row${index === active ? ' active' : ''}" role="option" aria-selected="${current}" data-model="${escapeHtml(item.id)}"><span class="oi-model-name"><span>${escapeHtml(title)}</span>${title !== item.id ? `<span class="oi-model-id">${escapeHtml(item.id)}</span>` : ''}</span>${current ? '<span class="oi-model-check" aria-hidden="true">✓</span>' : ''}</button>`;
							})
							.join('')
					: `<div class="oi-model-none">${escapeHtml(t('Nothing matches'))}</div>`
			}</div>` +
			`<div class="oi-model-effort${noEffort ? ' off' : ''}" title="${escapeHtml(noEffort ? t('This model refused an effort setting; it answers with its own') : t('How long the model thinks before it answers (← →)'))}">` +
			`<span class="oi-model-effort-name">${escapeHtml(t('Effort'))} <span>(${escapeHtml(noEffort ? t('this model has none') : t(effortTitle[effort]))})</span></span>` +
			`<div class="oi-effort" role="slider" tabindex="0" aria-label="${escapeHtml(t('Effort'))}" aria-valuemin="0" aria-valuemax="${effortList.length - 1}" aria-valuenow="${level}" aria-valuetext="${escapeHtml(t(effortTitle[effort]))}"${noEffort ? ' aria-disabled="true"' : ''} style="--oi-effort: ${level / (effortList.length - 1)}">` +
			`<span class="oi-effort-fill"></span>${effortList.map((item, index) => `<button type="button" class="oi-effort-stop${index <= level ? ' on' : ''}${index === level ? ' now' : ''}" data-effort="${item}" tabindex="-1" title="${escapeHtml(t(effortTitle[item]))}" aria-label="${escapeHtml(t(effortTitle[item]))}"></button>`).join('')}</div></div>` +
			`<div class="oi-model-foot"><button type="button" data-picker="Refresh">${escapeHtml(t('Refresh the list of models'))}</button><button type="button" data-picker="Setting">${escapeHtml(t('Connection settings'))}</button></div>`;
		place();
		const search = picker.querySelector<HTMLInputElement>('.oi-model-search');
		if (search && focusedSearch) {
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
		}
		picker.querySelector('.oi-model-row.active')?.scrollIntoView({ block: 'nearest' });
	};

	/** Above the button, its right edge at the button's (inside the window). */
	const place = (): void => {
		const rect = anchor.getBoundingClientRect();
		const box = picker.getBoundingClientRect();
		const left = Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8));
		const top = rect.top - box.height - 6 >= 8 ? rect.top - box.height - 6 : Math.min(rect.bottom + 6, window.innerHeight - box.height - 8);
		picker.style.left = `${left}px`;
		picker.style.top = `${Math.max(8, top)}px`;
	};

	const setEffort = (effort: Effort): void => {
		const connection = currentConnection();
		if (!connection || connection.noEffortList?.includes(connection.model)) return;
		updateConnection(connection.provider, { effort });
		onChange();
		draw();
		picker.querySelector<HTMLElement>('.oi-effort')?.focus();
	};

	const choose = (model: string): void => {
		const connection = currentConnection();
		if (!connection) return;
		const item = connection.modelList?.find((entry) => entry.id === model);
		updateConnection(connection.provider, { model, ...(item?.outputLimit !== undefined ? { outputLimit: item.outputLimit } : {}) });
		close();
		onChange();
	};

	picker.addEventListener('click', (event) => {
		const target = event.target as Element;
		const row = target.closest<HTMLElement>('[data-model]');
		if (row) {
			choose(row.dataset.model!);
			return;
		}
		const stop = target.closest<HTMLElement>('[data-effort]');
		if (stop) {
			setEffort(stop.dataset.effort as Effort);
			return;
		}
		const action = target.closest<HTMLElement>('[data-picker]')?.dataset.picker;
		if (action === 'Setting') {
			close();
			openConnectionSetting(context);
		} else if (action === 'Refresh') {
			const connection = currentConnection();
			if (!connection) return;
			say?.(t('Asking for the models'));
			void listModel(connectionOf(connection.provider)).then(
				(modelList) => {
					updateConnection(connection.provider, { modelList });
					say?.(modelList.length === 1 ? t('1 model.') : t('{count} models.', { count: modelList.length }));
					onChange();
					if (closePicker) draw();
				},
				(error: unknown) => say?.(error instanceof ProviderError ? error.message : String(error), true),
			);
		}
	});
	picker.addEventListener('input', (event) => {
		const target = event.target as HTMLInputElement;
		if (!target.classList.contains('oi-model-search')) return;
		query = target.value;
		active = 0;
		draw();
	});
	const onKey = (event: KeyboardEvent): void => {
		const connection = currentConnection();
		if (!connection) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			anchor.focus();
			return;
		}
		const rowList = [...picker.querySelectorAll<HTMLElement>('[data-model]')];
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = rowList.length ? (Math.max(active, step > 0 ? -1 : 0) + step + rowList.length) % rowList.length : -1;
			draw();
			return;
		}
		// ← → move the effort, wherever the focus is in the picker (not while typing in its search)
		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target as Element).classList.contains('oi-model-search')) {
			event.preventDefault();
			event.stopPropagation();
			const now = effortList.indexOf(connection.effort ?? 'Default');
			const next = effortList[Math.max(0, Math.min(effortList.length - 1, now + (event.key === 'ArrowRight' ? 1 : -1)))]!;
			if (next !== (connection.effort ?? 'Default')) setEffort(next);
			return;
		}
		if (event.key === 'Enter' && active >= 0 && rowList[active]) {
			event.preventDefault();
			event.stopPropagation();
			choose(rowList[active]!.dataset.model!);
		}
	};
	picker.addEventListener('keydown', onKey);
	const onOutside = (event: PointerEvent): void => {
		if (!picker.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
	};
	const onResize = (): void => place();
	function close(): void {
		document.removeEventListener('pointerdown', onOutside, true);
		window.removeEventListener('resize', onResize);
		picker.remove();
		closePicker = undefined;
	}
	closePicker = close;
	document.addEventListener('pointerdown', onOutside, true);
	window.addEventListener('resize', onResize);
	active = Math.max(0, modelListOf(currentConnection()!).findIndex((item) => item.id === currentConnection()!.model));
	draw();
	(picker.querySelector<HTMLElement>('.oi-model-search') ?? picker.querySelector<HTMLElement>('.oi-model-row.active') ?? picker).focus({ preventScroll: true });
}
