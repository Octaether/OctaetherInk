// @vitest-environment happy-dom
// Tabs and what plugins reach through the app: a double-click and Ctrl+click in the sidebar, the
// vault's files as the AI changes them, plugin pages in tabs, and the AI's chat and memory.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PanelHost, type VaultFile, panelExtension, vaultFileExtension } from '@octaether/core-sdk';
import { MemoryFileSystem } from '@octaether/core-vault';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
let app: (typeof import('../src/main'))['app'];

async function settle(round = 8): Promise<void> {
	for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
}

function click(element: Element, init: MouseEventInit = {}): void {
	element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

const frameText = (): string => document.querySelector<HTMLElement>('#note .oi-frame[data-oi-type="Text"]')?.textContent ?? '';
const noteText = (): string => app.workspace.note!.model.serialize();
const row = (name: string): HTMLElement => [...document.querySelectorAll<HTMLElement>('.tree-item')].find((item) => item.textContent?.trim() === name)!;
const titleList = (): string[] => [...document.querySelectorAll('#tabBar .tab-title')].map((title) => title.textContent ?? '');

beforeAll(async () => {
	localStorage.clear();
	const html = readFileSync(resolve(here, '../index.html'), 'utf8');
	document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/, '');
	const main = await import('../src/main');
	await main.ready;
	app = main.app;
	await app.openVaultWith(new MemoryFileSystem('Tabs', { 'One.oi': 'One.\n', 'Two.oi': 'Two.\n', 'Three.oi': 'Three.\n' }), { id: 'tabs', kind: 'Browser', name: 'Tabs', time: Date.now() });
	app.commandRegistry.run('Sidebar.Toggle');
	await settle(20);
});

describe('tabs', () => {
	it('opens a note in a new tab on a double-click, and behind the one in front on Ctrl+click', async () => {
		click(row('One'));
		await settle();
		expect(app.workspace.note!.path).toBe('One.oi');
		// a double-click: its first click showed Two here; Two moves to a tab of its own, and this tab is One again
		click(row('Two'));
		await settle();
		row('Two').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
		await settle(12);
		expect(titleList()).toEqual(['One', 'Two']);
		expect(app.workspace.note!.path).toBe('Two.oi');
		// Ctrl+click: a tab behind; Two stays in front
		click(row('Three'), { ctrlKey: true });
		await settle();
		expect(titleList()).toEqual(['One', 'Two', 'Three']);
		expect(app.workspace.note!.path).toBe('Two.oi');
		// a click on a note open in another tab brings that tab to the front
		click(row('Three'));
		await settle();
		expect(app.workspace.note!.path).toBe('Three.oi');
		expect(titleList()).toEqual(['One', 'Two', 'Three']);
	});
});

describe('the vault, for plugins', () => {
	it('changes a note that is open in its tab, with the note’s own Undo and the change’s undo', async () => {
		const vault = app.registry.extension<VaultFile>(vaultFileExtension)!;
		expect(vault.name()).toBe('Tabs');
		expect(vault.currentPath()).toBe('Three.oi');
		const change = await vault.write('Three.oi', 'Changed.\n');
		await settle();
		expect(frameText()).toBe('Changed.');
		await change.undo();
		await settle();
		expect(frameText()).toBe('Three.');
		await vault.write('Three.oi', 'Again.\n');
		app.session.history('Undo');
		expect(noteText()).toBe('Three.\n');
	});

	it('makes, moves (links follow), and deletes to the trash, each with its way back', async () => {
		const vault = app.registry.extension<VaultFile>(vaultFileExtension)!;
		await vault.write('Folder/New.oi', 'See [[One]].\n');
		expect(vault.list('Folder').map((entry) => entry.path)).toEqual(['Folder/New.oi']);
		const moved = await vault.move('One.oi', 'Folder/First.oi');
		expect(moved.path).toBe('Folder/First.oi');
		expect(await vault.read('Folder/New.oi')).toBe('See [[First]].\n');
		await moved.undo();
		expect(vault.has('One.oi')).toBe(true);
		const gone = await vault.trash('Two.oi');
		expect(vault.has('Two.oi')).toBe(false);
		expect(app.workspace.tabList.some((tab) => tab.note?.path === 'Two.oi')).toBe(false);
		await gone.undo();
		expect(vault.has('Two.oi')).toBe(true);
		// the app's own folder is reached only when asked for
		await vault.write('.oi/AI/Note.oi', 'x\n');
		expect(vault.list().some((entry) => entry.path.startsWith('.oi'))).toBe(false);
		expect(vault.list('.oi/AI').map((entry) => entry.path)).toContain('.oi/AI/Note.oi');
		expect(vault.search('See').map((item) => item.path)).toEqual(['Folder/New.oi']);
		expect(await vault.picture('Folder/New.oi')).toBeUndefined();
	});
});

describe('plugin pages in tabs', () => {
	it('shows a page in a tab of its own, kept while other tabs are in front, and remembered', async () => {
		const panel = app.registry.extension<PanelHost>(panelExtension)!;
		let shown = 0;
		const remove = panel.register({
			id: 'Test.Page',
			title: 'Test page',
			mount(element, state, tab) {
				element.innerHTML = `<p class="test-page">${state}</p>`;
				tab.setTitle(`Page ${state}`);
				return { destroy: () => undefined, shown: () => void shown++ };
			},
		});
		panel.open('Test.Page', 'a');
		await settle();
		const page = document.querySelector<HTMLElement>('#panelHost .test-page')!;
		expect(page.textContent).toBe('a');
		expect(app.workspace.tab!.view).toBe('Panel');
		expect(document.getElementById('page')!.hidden).toBe(true);
		expect(document.querySelector('#tabBar .tab.active .tab-title')!.textContent).toBe('Page a');
		expect(document.getElementById('viewHeader')!.classList.contains('no-mode')).toBe(true);
		app.workspace.activateTab(app.workspace.tabList[0]!.id);
		await settle();
		expect(document.getElementById('panelHost')!.hidden).toBe(true);
		panel.open('Test.Page', 'a');
		await settle();
		// the same page, not drawn again
		expect(document.querySelector('#panelHost .test-page')).toBe(page);
		expect(shown).toBeGreaterThanOrEqual(2);
		const kept = JSON.parse(localStorage.getItem('OctaetherInk.Tab.tabs')!) as { pathList: string[] };
		expect(kept.pathList.find((path) => path.startsWith('panel:'))).toBe('panel:{"id":"Test.Page","state":"a","title":"Page a"}');
		// its plugin gone: the page says so
		remove();
		await settle();
		expect(document.querySelector('#panelHost .panel-missing')!.textContent).toContain('plugin that is off');
		await app.workspace.closeTab();
	});

	it('opens the AI chat beside the note, and the AI’s memory, kept hidden in the vault', async () => {
		const workspace = app.workspace;
		app.commandRegistry.run('AI.Chat');
		await settle(40);
		// a pane of its own on the right, with the focus; everything at the bottom
		expect(workspace.paneList).toHaveLength(2);
		expect(workspace.paneId).toBe(workspace.paneList[1]!.id);
		expect(workspace.tab!.view).toBe('Panel');
		expect(document.querySelector('#panelHost .oi-chat .oi-composer-mode')!.textContent).toBe('ManualPlanAuto');
		expect(document.querySelector('#panelHost .oi-chat-head')).toBeNull();
		expect(document.querySelector('#panelHost .oi-composer-note')!.textContent).toContain('No AI is connected');
		// the button again: the same chat, not another pane
		app.commandRegistry.run('AI.Chat');
		await settle(20);
		expect(workspace.paneList).toHaveLength(2);
		app.commandRegistry.run('AI.Memory');
		await settle(40);
		expect(workspace.note!.path).toBe('.oi/AI/Memory.oi');
		expect(noteText()).toMatch(/^# Memory\n\n/);
		// back to one pane for what follows
		for (const tab of workspace.paneTabList(workspace.paneList[1]!.id)) await workspace.closeTab(tab.id);
		await settle(12);
		expect(workspace.paneList).toHaveLength(1);
	});
});

describe('panes', () => {
	it('splits right with the same note (one note, live in both), keeps each pane’s view, and closes back to one', async () => {
		const workspace = app.workspace;
		click(row('One'));
		await settle();
		app.commandRegistry.run('Pane.SplitRight');
		await settle(30);
		expect(workspace.paneList).toHaveLength(2);
		const [left, right] = workspace.paneList.map((pane) => workspace.activeTabOf(pane.id)!);
		// two tabs, one note: one model, saved once
		expect(left!.note).toBe(right!.note);
		expect(workspace.openNoteList().filter((note) => note.path === 'One.oi')).toHaveLength(1);
		expect(document.querySelectorAll('.pane-root .pane')).toHaveLength(2);
		// the new pane has the focus; Source there, Edit in the other
		app.setView('Source');
		await settle();
		const other = document.querySelector<HTMLElement>('.pane:not(.focused)')!;
		expect(other.querySelector('.pane-mode [aria-pressed="true"]')!.getAttribute('data-pane-mode')).toBe('Edit');
		// a change shows in the other pane at once
		workspace.note!.model.setText('One, changed.\n');
		await settle(12);
		expect(other.querySelector('.pane-note')!.textContent).toContain('One, changed.');
		// the other pane takes the focus with a click: the app's view moves there, and its own view comes back
		other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await settle(12);
		expect(workspace.paneId).toBe(workspace.paneList[0]!.id);
		expect(app.view()).toBe('Edit');
		expect(document.querySelector('.pane.focused #viewContent')).not.toBeNull();
		// remembered with the panes
		const kept = JSON.parse(localStorage.getItem('OctaetherInk.Tab.tabs')!) as { paneList: { pathList: string[]; mode?: string }[]; layout: unknown };
		expect(kept.paneList.map((pane) => pane.pathList)).toEqual([expect.arrayContaining(['One.oi']), ['One.oi']]);
		expect(kept.paneList[1]!.mode).toBe('Source');
		expect(kept.layout).toEqual({ direction: 'Row', childList: [0, 1], sizeList: [0.5, 0.5] });
		// closing the right pane's only tab: one pane again, and the note is still watched (saved) by the left
		const rightTab = workspace.paneTabList(workspace.paneList[1]!.id)[0]!;
		await workspace.closeTab(rightTab.id);
		await settle(12);
		expect(workspace.paneList).toHaveLength(1);
		expect(document.querySelector('.pane-root')).toBeNull();
		workspace.note!.model.setText('One.\n');
		await new Promise((done) => setTimeout(done, 700));
		expect(await workspace.vault!.read('One.oi')).toBe('One.\n');
	});

	it('moves a tab into a new pane below, by dropping it on a pane’s side', async () => {
		const workspace = app.workspace;
		const count = workspace.tabList.length;
		await workspace.openNote('Two.oi', { newTab: true });
		const tab = workspace.tab!;
		workspace.splitPane('Bottom', { tabId: tab.id });
		await settle(20);
		expect(workspace.layout).toMatchObject({ kind: 'Split', direction: 'Column' });
		expect(workspace.tab).toBe(tab);
		expect(workspace.paneTabList()).toEqual([tab]);
		expect(workspace.tabList).toHaveLength(count + 1);
		// back into the first pane: the empty pane goes
		workspace.moveTab(tab.id, 0, workspace.paneList[0]!.id);
		await settle(12);
		expect(workspace.paneList).toHaveLength(1);
		expect(workspace.paneTabList()[0]).toBe(tab);
	});
});
