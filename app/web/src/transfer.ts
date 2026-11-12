// Exporting and importing, loaded the first time one is asked for: a note as a picture or as
// Markdown, a vault as a .zip, and a vault from a .zip (README "Files"). The app hands in its parts.

import type { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import type { EditSession } from '@octaether/core-edit';
import { t } from '@octaether/core-sdk';
import { Vault, baseName, extensionOf, nameProblem, parentPath, stemOf } from '@octaether/core-vault';
import { BrowserFileSystem, DirectoryFileSystem, downloadBlob, downloadText } from './file-system';
import { confirmDialog, toast } from './ui';
import { type Workspace, nowText } from './workspace';
import { type ZipEntry, makeZip } from './zip';

export interface TransferApp {
	workspace: Workspace;
	session: EditSession;
	host: RenderHost;
	noteElement: HTMLElement;
	themeRegistry: ThemeRegistry;
	registry: Registry;
	viewMode(): 'Source' | 'Edit' | 'Read';
	setView(mode: 'Source' | 'Edit' | 'Read'): void;
	graphShown(): boolean;
	newVaultFolder(option: { title: string; text: string; name: string; action: string }): Promise<FileSystemDirectoryHandle | undefined>;
	openFolderHandle(handle: FileSystemDirectoryHandle): Promise<boolean>;
	openQuickNote(): Promise<boolean>;
	quickNote: { readonly id: string; readonly name: string };
}

/** Lets the page draw what was just changed (a view switched, an editor closed) before it is read. */
export function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** The drawn note ready to be read from the page: no editor open, and not the Source view. */
export async function settleNoteView(app: TransferApp): Promise<boolean> {
	if (!app.workspace.note || app.graphShown()) return false;
	app.session.close();
	app.session.select(undefined);
	if (app.viewMode() === 'Source') app.setView('Edit');
	await nextFrame();
	return true;
}

/** Saves the note, or one block of it, as a picture of what the screen shows (in the theme in use). */
export async function exportPicture(app: TransferApp, key?: string): Promise<void> {
	const note = app.workspace.note;
	if (!note || !(await settleNoteView(app))) return;
	const target = key ? app.host.frameOf(key) : app.noteElement;
	if (!target) return;
	const background = app.themeRegistry.current().token['Color.Background'] ?? '#ffffff';
	try {
		const { elementPicture } = await import('./export-image');
		const type = key ? note.model.get(key)?.type : undefined;
		downloadBlob(`${stemOf(note.path)}${type ? ` ${type}` : ''}.png`, await elementPicture(target, { background, padding: key ? 16 : 32 }));
	} catch {
		toast(t('This browser couldn’t make the picture. Print or save as PDF works everywhere.'), 6000);
	}
}

/** Saves the note as Markdown; with blocks Markdown can't say, as a .zip of the .md and their pictures. */
export async function exportMarkdown(app: TransferApp): Promise<void> {
	const note = app.workspace.note;
	if (!note || !(await settleNoteView(app))) return;
	const name = stemOf(note.path);
	const { noteMarkdown } = await import('./export-markdown');
	const result = noteMarkdown(note.model.document.itemList, { name, format: app.registry.formatOption(), canPicture: (node) => app.host.frameOf(node.key) !== undefined });
	if (result.pictureList.length === 0) {
		downloadText(`${name}.md`, result.text);
		return;
	}
	const encoder = new TextEncoder();
	const entryList: ZipEntry[] = [{ path: `${name}.md`, data: encoder.encode(result.text) }];
	const background = app.themeRegistry.current().token['Color.Background'] ?? '#ffffff';
	let missing = 0;
	try {
		const { elementPicture } = await import('./export-image');
		for (const picture of result.pictureList) {
			const frame = app.host.frameOf(picture.key);
			try {
				if (!frame) throw new Error('not drawn');
				entryList.push({ path: picture.file, data: new Uint8Array(await (await elementPicture(frame, { background, padding: 12 })).arrayBuffer()) });
			} catch {
				missing++;
			}
		}
	} catch {
		missing = result.pictureList.length;
	}
	downloadBlob(`${name}.zip`, makeZip(entryList));
	toast(missing > 0 ? t('Saved {name}.zip: the Markdown, without {count} pictures this browser couldn’t make.', { name, count: missing }) : t('Saved {name}.zip: the Markdown and {count} pictures of the blocks Markdown can’t hold.', { name, count: result.pictureList.length }), 6000);
}

/** The open vault as one .zip: every file at its path, with the vault's settings, without its trash. */
export async function exportVault(app: TransferApp): Promise<void> {
	const vault = app.workspace.vault;
	if (!vault) {
		toast(t('Open a vault first.'));
		return;
	}
	await app.workspace.saveAll();
	const { vaultZip, isExported } = await import('./vault-zip');
	const fileList: { path: string; data: Uint8Array<ArrayBuffer> }[] = [];
	try {
		for (const entry of await vault.fs.list()) {
			if (entry.kind === 'File' && isExported(entry.path)) fileList.push({ path: entry.path, data: new Uint8Array(await (await vault.fs.readBinary(entry.path)).arrayBuffer()) });
		}
	} catch {
		toast(t('Couldn’t read every file of the vault.'));
		return;
	}
	if (fileList.length === 0) {
		toast(t('There is nothing to export yet.'));
		return;
	}
	// today's date where you are: "Chemistry 2026-11-10.zip"
	downloadBlob(`${app.workspace.source?.name ?? 'Vault'} ${nowText().slice(0, 10)}.zip`, vaultZip(fileList));
}

/** Asks for a vault's .zip, then imports it. */
export function chooseVaultZip(app: TransferApp): void {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.zip,application/zip';
	input.addEventListener('change', () => {
		const file = input.files?.[0];
		if (file) void importVault(app, file, file.name);
	});
	input.click();
}

/**
 * A vault from a .zip: into a new folder you name and place (where the browser opens folders), or
 * with the quick notes (elsewhere). Nothing in the .zip is trusted: see vault-zip.ts.
 */
export async function importVault(app: TransferApp, file: Blob, fileName: string): Promise<void> {
	const { planImport, importBytes, ImportError } = await import('./vault-zip');
	let plan: import('./vault-zip').ImportPlan;
	try {
		plan = planImport(new Uint8Array(await file.arrayBuffer()));
	} catch (error) {
		toast(error instanceof ImportError ? t(error.message) : t('Couldn’t read “{name}”.', { name: fileName }), 6000);
		return;
	}
	// "Chemistry 2026-11-10.zip" → Chemistry
	const name = plan.name ?? fileName.replace(/\.zip$/i, '').replace(/ \d{4}-\d{2}-\d{2}$/, '');
	let count = 0;
	try {
		if (window.showDirectoryPicker) {
			const handle = await app.newVaultFolder({
				title: t('Import a vault'),
				text: t('The {count} files of “{name}” go into a new folder, which becomes the vault.', { count: plan.fileList.length, name: fileName }),
				name: nameProblem(name) ? 'Imported vault' : name,
				action: t('Import'),
			});
			if (!handle) return;
			const fs = new DirectoryFileSystem(handle);
			for (const item of plan.fileList) {
				await fs.writeBinary(item.path, new Blob([await importBytes(item)]));
				count++;
			}
			await app.openFolderHandle(handle);
		} else {
			// no folders here: the notes join the quick notes (the vault's own settings stay behind)
			if (!(await confirmDialog(t('This browser can’t open folders, so the {count} files of “{name}” go with your quick notes, kept in this browser.', { count: plan.fileList.length, name: fileName }), t('Import')))) return;
			if (app.workspace.kind !== 'None' && !(await app.workspace.closeAll())) return;
			const target = new Vault(new BrowserFileSystem(app.quickNote.id, app.quickNote.name));
			await target.load();
			for (const item of plan.fileList) {
				if (item.path.startsWith('.oi/')) continue;
				const extension = extensionOf(item.path);
				const stem = extension ? baseName(item.path).slice(0, -extension.length - 1) : baseName(item.path);
				const path = target.isTaken(item.path) ? target.uniquePath(parentPath(item.path), stem, extension) : item.path;
				await target.fs.writeBinary(path, new Blob([await importBytes(item)]));
				await target.load();
				count++;
			}
			await app.openQuickNote();
		}
	} catch (error) {
		toast(error instanceof ImportError ? t(error.message) : t('The import stopped after {count} files: the rest couldn’t be written.', { count }), 8000);
		return;
	}
	const skipped = plan.skippedList.length;
	toast(skipped > 0 ? t('Imported {count} files. {skipped} were left out: their paths lead outside a vault or can’t be file names.', { count, skipped }) : t('Imported {count} files.', { count }), 6000);
}
