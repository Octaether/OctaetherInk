// The status bar (bottom right, as in Obsidian). The app shows whether the note is saved and,
// in the Source view, where the cursor is; modules and plugins add their own items (the Text
// module adds word and character counts). Every item can be switched off in Setting → Appearance.

import type { Registry } from '@octaether/core-render';
import type { StatusItemDefinition } from '@octaether/core-sdk';
import type { SettingStore } from './setting-store';
import { escapeHtml } from './ui';
import type { Workspace } from './workspace';

export interface StatusBarOption {
	registry: Registry;
	setting: SettingStore;
	workspace: Workspace;
	selection(): string;
	cursor(): { line: number; column: number } | undefined;
	save(): void;
}

/** The app's own items; module and plugin items come from the registry. */
export function appStatusItemList(option: Pick<StatusBarOption, 'workspace' | 'cursor'>): StatusItemDefinition[] {
	return [
		{
			id: 'App.Cursor',
			title: 'Cursor position (Source view)',
			order: 10,
			text: () => {
				const cursor = option.cursor();
				return cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : undefined;
			},
		},
		{
			id: 'App.BlockCount',
			title: 'Block count',
			order: 30,
			text: (context) => {
				const count = context.note.keyList().length;
				return `${count} ${count === 1 ? 'block' : 'blocks'}`;
			},
		},
		{
			id: 'App.Save',
			title: 'Saved or not',
			order: 90,
			text: () => {
				const workspace = option.workspace;
				switch (workspace.saveState) {
					case 'Saving':
						return 'Saving…';
					case 'Unsaved':
						return 'Unsaved';
					case 'Failed':
						return 'Not saved!';
					case 'Download':
						return 'Unsaved (Ctrl+S)';
					default:
						return workspace.note?.savedText === undefined && workspace.note?.autoNamed ? 'New' : 'Saved';
				}
			},
		},
	];
}

/** Items that start switched off. */
const offByDefault = new Set(['App.BlockCount']);

export function isStatusItemOn(setting: SettingStore, id: string): boolean {
	const value = setting.get(`Status.${id}`);
	return value === undefined ? !offByDefault.has(id) : value === true;
}

export class StatusBar {
	private frame = 0;

	constructor(
		readonly element: HTMLElement,
		readonly option: StatusBarOption,
	) {
		element.addEventListener('click', (event) => {
			const item = (event.target as Element).closest<HTMLElement>('[data-id]');
			if (item?.dataset.id === 'App.Save') option.save();
		});
	}

	itemList(): StatusItemDefinition[] {
		return [...appStatusItemList(this.option), ...this.option.registry.statusItemList()].sort((left, right) => (left.order ?? 50) - (right.order ?? 50));
	}

	schedule(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	render(): void {
		const note = this.option.workspace.note;
		if (!note) {
			this.element.replaceChildren();
			return;
		}
		const context = { note: note.model, selection: this.option.selection() };
		const partList: string[] = [];
		for (const item of this.itemList()) {
			if (!isStatusItemOn(this.option.setting, item.id)) continue;
			let text: string | undefined;
			try {
				text = item.text(context);
			} catch {
				text = undefined;
			}
			if (text) partList.push(`<span class="status-item${item.id === 'App.Save' ? ` status-save status-${this.option.workspace.saveState.toLowerCase()}` : ''}" data-id="${escapeHtml(item.id)}"${item.id === 'App.Save' ? ' role="button" title="Save now (Ctrl+S)"' : ''}>${escapeHtml(text)}</span>`);
		}
		this.element.innerHTML = partList.join('');
	}
}
