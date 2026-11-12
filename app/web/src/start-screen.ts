// The first screen: one quiet column in the middle of the window, set like a page (a small name,
// a large line of what the app is, then what you can do, each with a line saying what it is). Make
// a vault (a folder on disk) or open one, write a quick note kept in this browser, open a single
// file, or open the welcome guide; under them the vaults, quick notes, and files you had open, when
// there are any. The first action stands out: a vault where folders can be opened, a quick note
// elsewhere. The last thing open reopens by itself next time (a setting).

import { t } from '@octaether/core-sdk';
import { icon, logoMark, markIcon } from './icon';
import type { RecentEntry } from './storage';
import { supportLinkHtml } from './support';
import { escapeHtml } from './ui';

export interface StartScreenOption {
	canOpenFolder: boolean;
	version: string;
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

/** The app's mark, with the squarer corners of this page. */
const startLogo = logoMark.replace('rx="112"', 'rx="56"');

const kindLabel: Readonly<Record<RecentEntry['kind'], string>> = { Folder: 'Vault', File: 'File', Browser: 'In this browser' };

interface StartAction {
	action: string;
	title: string;
	explain: string;
	icon: string;
	command?: string;
	/** Needs a browser that opens folders. */
	folder?: boolean;
}

const actionList: readonly StartAction[] = [
	{ action: 'CreateVault', title: 'Create new vault', explain: 'A folder for your notes, wherever you choose', icon: icon.FolderPlus, folder: true },
	{ action: 'OpenFolder', title: 'Open folder as vault', explain: 'A folder of notes you already have', icon: icon.FolderOpen, command: 'Vault.Open', folder: true },
	{ action: 'QuickNote', title: 'Quick note', explain: 'One note, kept in this browser until you move it', icon: icon.FilePlus, command: 'Note.Create' },
	{ action: 'OpenFile', title: 'Open file', explain: 'A single .oi, .md, or .txt file', icon: icon.File, command: 'File.Open' },
	{ action: 'Sample', title: 'Open the welcome guide', explain: 'A short tour, with a note for every kind of block', icon: icon.Help },
];

export class StartScreen {
	constructor(
		readonly element: HTMLElement,
		readonly option: StartScreenOption,
	) {}

	async render(message?: string): Promise<void> {
		const option = this.option;
		// the action most people want first: a vault, or where no folder can be opened, a quick note
		const primary = option.canOpenFolder ? 'CreateVault' : 'QuickNote';
		const row = (item: StartAction): string => {
			const key = item.command ? option.hotkeyText(item.command) : '';
			const off = item.folder && !option.canOpenFolder;
			return (
				`<button type="button" class="start-link${item.action === primary ? ' primary' : ''}" data-action="${item.action}"${off ? ' disabled' : ''}>` +
				`${item.icon}<span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.explain)}</small>${key ? `<kbd>${escapeHtml(key)}</kbd>` : ''}</button>`
			);
		};
		this.element.innerHTML =
			'<div class="start">' +
			`<div class="start-brand"><div class="start-logo" aria-hidden="true">${startLogo}</div><div class="start-name">Octaether Ink</div></div>` +
			'<h1>Notes you own.</h1><p class="start-lead">Plain text files, any kind of block, on every device.</p>' +
			(message ? `<p class="start-message">${escapeHtml(message)}</p>` : '') +
			`<nav class="start-list" aria-label="Start">${actionList.map(row).join('')}</nav>` +
			`<p class="start-note">${
				option.canOpenFolder
					? 'A vault is an ordinary folder. Keep it in iCloud Drive, OneDrive, or Dropbox, and your notes follow you to your other devices.'
					: 'This browser can’t open folders, so it can’t hold a vault. Use Chrome or Edge on a computer, or the desktop app. Quick notes and single files work here.'
			}</p>` +
			`<section class="start-recent" hidden><h2>${escapeHtml(t('Recent'))}</h2><div class="start-list"></div></section>` +
			`<footer class="start-foot"><span>${escapeHtml(t('Free and open source. Support it on {link}.')).replace('{link}', supportLinkHtml())}</span><span class="start-version">v${escapeHtml(option.version)}</span></footer></div>`;
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
		// nothing opened yet: no empty box, just the actions
		if (!recent || list.length === 0) return;
		recent.hidden = false;
		const holder = recent.querySelector<HTMLElement>('.start-list')!;
		holder.innerHTML = list
			.map(
				(entry, index) =>
					`<div class="start-recent-item"><button type="button" class="start-link" data-index="${index}">${entry.kind === 'Folder' ? icon.Folder : entry.kind === 'File' ? icon.File : icon.Browser}<span>${escapeHtml(entry.name)}</span><small>${escapeHtml(t(kindLabel[entry.kind]))}</small></button>` +
					`<button type="button" class="start-remove" data-remove="${index}" title="${escapeHtml(t('Remove from the list (nothing is deleted)'))}" aria-label="${escapeHtml(t('Remove {name} from the list', { name: entry.name }))}">${markIcon.CrossLarge}</button></div>`,
			)
			.join('');
		for (const button of holder.querySelectorAll<HTMLButtonElement>('[data-index]')) button.addEventListener('click', () => option.openRecent(list[Number(button.dataset.index)]!));
		for (const button of holder.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
			button.addEventListener('click', () => void option.removeRecent(list[Number(button.dataset.remove)]!).then(() => this.render()));
		}
	}
}
