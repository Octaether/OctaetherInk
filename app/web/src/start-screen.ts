// The first screen, as in Obsidian's vault manager and VS Code's welcome page: make a vault (a
// folder on disk) or open one, write a quick note kept in this browser, open a single file, or
// open the welcome guide, plus the vaults, quick notes, and files you had open. The last one
// reopens by itself next time (a setting).

import { icon, logoMark } from './icon';
import type { RecentEntry } from './storage';
import { escapeHtml } from './ui';

export interface StartScreenOption {
	canOpenFolder: boolean;
	createVault(): void;
	openFolder(): void;
	quickNote(): void;
	openFile(): void;
	openSample(): void;
	openRecent(entry: RecentEntry): void;
	removeRecent(entry: RecentEntry): Promise<void>;
	recentList(): Promise<RecentEntry[]>;
	hotkeyText(command: string): string;
}

const kindLabel: Readonly<Record<RecentEntry['kind'], string>> = { Folder: 'Vault', File: 'File', Browser: 'In this browser' };

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
		const folder = option.canOpenFolder ? '' : ' disabled';
		this.element.innerHTML =
			'<div class="start">' +
			`<div class="start-brand"><div class="start-logo" aria-hidden="true">${logoMark}</div>` +
			'<div><h1>Octaether Ink</h1><p>Notes you own: plain text files, any kind of block, on every device.</p></div></div>' +
			(message ? `<p class="start-message">${escapeHtml(message)}</p>` : '') +
			'<div class="start-grid"><section class="start-column"><h2>Start</h2>' +
			`<button type="button" class="start-link" data-action="CreateVault"${folder} title="A new folder for your notes, wherever you choose">${icon.FolderPlus}<span>Create new vault</span></button>` +
			`<button type="button" class="start-link" data-action="OpenFolder"${folder} title="A folder of notes you already have">${icon.FolderOpen}<span>Open folder as vault</span>${key('Vault.Open')}</button>` +
			(option.canOpenFolder ? '' : '<p class="start-note">This browser can’t open folders, so it can’t hold a vault. Use Chrome or Edge on a computer, or the desktop app. Quick notes and single files work here.</p>') +
			`<button type="button" class="start-link" data-action="QuickNote" title="A note kept in this browser, with no folder needed. Move it into a vault later">${icon.FilePlus}<span>Quick note</span><small>in this browser</small>${key('Note.Create')}</button>` +
			`<button type="button" class="start-link" data-action="OpenFile">${icon.File}<span>Open file</span>${key('File.Open')}</button>` +
			`<button type="button" class="start-link" data-action="Sample">${icon.Help}<span>Open the welcome guide</span></button>` +
			'</section><section class="start-column"><h2>Recent</h2><div class="start-recent"><p class="start-note">Loading…</p></div></section></div></div>';
		const action: Readonly<Record<string, () => void>> = {
			CreateVault: option.createVault,
			OpenFolder: option.openFolder,
			QuickNote: option.quickNote,
			OpenFile: option.openFile,
			Sample: option.openSample,
		};
		for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action]')) button.addEventListener('click', () => action[button.dataset.action!]?.());
		const list = await option.recentList();
		const recent = this.element.querySelector<HTMLElement>('.start-recent');
		if (!recent) return;
		if (list.length === 0) {
			recent.innerHTML = '<p class="start-note">Nothing yet. The vaults, quick notes, and files you open show up here.</p>';
			return;
		}
		recent.innerHTML = list
			.map(
				(entry, index) =>
					`<div class="start-recent-item"><button type="button" class="start-link" data-index="${index}">${entry.kind === 'Folder' ? icon.Folder : entry.kind === 'File' ? icon.File : icon.Browser}<span>${escapeHtml(entry.name)}</span><small>${kindLabel[entry.kind]}</small></button>` +
					`<button type="button" class="start-remove" data-remove="${index}" title="Remove from the list (nothing is deleted)" aria-label="Remove ${escapeHtml(entry.name)} from the list">×</button></div>`,
			)
			.join('');
		for (const button of recent.querySelectorAll<HTMLButtonElement>('[data-index]')) button.addEventListener('click', () => option.openRecent(list[Number(button.dataset.index)]!));
		for (const button of recent.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
			button.addEventListener('click', () => void option.removeRecent(list[Number(button.dataset.remove)]!).then(() => this.render()));
		}
	}
}
