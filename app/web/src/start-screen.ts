// The first screen, as in VS Code: open a folder as a vault, open a single file, start a note,
// keep a vault in this browser (Safari, Firefox, iPad), or open the welcome guide, plus what you
// had open recently. The last vault reopens by itself next time (a setting).

import { icon, logoMark } from './icon';
import type { RecentEntry } from './storage';
import { escapeHtml } from './ui';

export interface StartScreenOption {
	canOpenFolder: boolean;
	openFolder(): void;
	openFile(): void;
	newNote(): void;
	newBrowserVault(): void;
	openSample(): void;
	openRecent(entry: RecentEntry): void;
	removeRecent(entry: RecentEntry): void;
	recentList(): Promise<RecentEntry[]>;
	hotkeyText(command: string): string;
}

const kindLabel: Readonly<Record<RecentEntry['kind'], string>> = { Folder: 'Folder', File: 'File', Browser: 'Kept in this browser' };

export class StartScreen {
	constructor(
		readonly element: HTMLElement,
		readonly option: StartScreenOption,
	) {}

	async render(message?: string): Promise<void> {
		const option = this.option;
		const key = (command: string): string => {
			const text = option.hotkeyText(command);
			return text ? `<kbd>${escapeHtml(text)}</kbd>` : '';
		};
		this.element.innerHTML =
			'<div class="start">' +
			`<div class="start-brand"><div class="start-logo" aria-hidden="true">${logoMark}</div>` +
			'<div><h1>Octaether Ink</h1><p>Notes you own: plain text files, any kind of block, on every device.</p></div></div>' +
			(message ? `<p class="start-message">${escapeHtml(message)}</p>` : '') +
			'<div class="start-grid"><section class="start-column"><h2>Start</h2>' +
			`<button type="button" class="start-link" data-action="OpenFolder"${option.canOpenFolder ? '' : ' disabled'}>${icon.FolderOpen}<span>Open a folder as a vault…</span>${key('Vault.Open')}</button>` +
			(option.canOpenFolder ? '' : '<p class="start-note">This browser can’t open folders. Use Chrome or Edge on a computer, the desktop app, or keep a vault in this browser.</p>') +
			`<button type="button" class="start-link" data-action="OpenFile">${icon.File}<span>Open a file…</span>${key('File.Open')}</button>` +
			`<button type="button" class="start-link" data-action="NewNote">${icon.FilePlus}<span>New note</span>${key('Note.Create')}</button>` +
			`<button type="button" class="start-link" data-action="BrowserVault">${icon.Browser}<span>New vault in this browser…</span></button>` +
			`<button type="button" class="start-link" data-action="Sample">${icon.Help}<span>Open the welcome guide</span></button>` +
			'</section><section class="start-column"><h2>Recent</h2><div class="start-recent"><p class="start-note">Loading…</p></div></section></div></div>';
		const action: Readonly<Record<string, () => void>> = {
			OpenFolder: option.openFolder,
			OpenFile: option.openFile,
			NewNote: option.newNote,
			BrowserVault: option.newBrowserVault,
			Sample: option.openSample,
		};
		for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action]')) button.addEventListener('click', () => action[button.dataset.action!]?.());
		const list = await option.recentList();
		const recent = this.element.querySelector<HTMLElement>('.start-recent');
		if (!recent) return;
		if (list.length === 0) {
			recent.innerHTML = '<p class="start-note">Nothing yet. Folders, files, and browser vaults you open show up here.</p>';
			return;
		}
		recent.innerHTML = list
			.map(
				(entry, index) =>
					`<div class="start-recent-item"><button type="button" class="start-link" data-index="${index}">${entry.kind === 'Folder' ? icon.Folder : entry.kind === 'File' ? icon.File : icon.Browser}<span>${escapeHtml(entry.name)}</span><small>${kindLabel[entry.kind]}</small></button>` +
					`<button type="button" class="start-remove" data-remove="${index}" title="Remove from the list" aria-label="Remove ${escapeHtml(entry.name)} from the list">×</button></div>`,
			)
			.join('');
		for (const button of recent.querySelectorAll<HTMLButtonElement>('[data-index]')) button.addEventListener('click', () => option.openRecent(list[Number(button.dataset.index)]!));
		for (const button of recent.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
			button.addEventListener('click', () => {
				option.removeRecent(list[Number(button.dataset.remove)]!);
				void this.render();
			});
		}
	}
}
