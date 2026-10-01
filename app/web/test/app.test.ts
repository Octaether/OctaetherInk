// @vitest-environment happy-dom
// Boots the real web app (index.html body + main.ts) and drives it like a user.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryFileSystem } from '@octaether/core-vault';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const apple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
const mod = apple ? { metaKey: true } : { ctrlKey: true };
let app: (typeof import('../src/main'))['app'];

/** Lets pending promises and timers of 0 ms run (file reads, re-renders). */
async function settle(round = 8): Promise<void> {
	for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
}

function frameList(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('#note .oi-frame')];
}

function frameOfType(type: string, index = 0): HTMLElement {
	return [...document.querySelectorAll<HTMLElement>(`#note .oi-frame[data-oi-type="${type}"]`)][index]!;
}

function press(key: string, target: EventTarget = document, init: KeyboardEventInit = {}): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function type(textarea: HTMLTextAreaElement | HTMLInputElement, value: string): void {
	textarea.value = value;
	textarea.setSelectionRange(value.length, value.length);
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function click(element: Element, init: MouseEventInit = {}): void {
	element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

function editor(): HTMLTextAreaElement | null {
	return document.querySelector<HTMLTextAreaElement>('#note [data-oi-editing] > textarea');
}

function editingType(): string | undefined {
	return document.querySelector<HTMLElement>('#note [data-oi-editing]')?.dataset.oiType;
}

function command(id: string): void {
	document.querySelector<HTMLButtonElement>(`.ribbon [data-command="${id}"]`)!.click();
}

function menuItem(text: string): HTMLElement {
	return [...document.querySelectorAll<HTMLElement>('#layer .menu-item')].find((row) => row.textContent?.includes(text))!;
}

function settingSection(name: string): void {
	document.querySelector<HTMLButtonElement>(`.setting-nav [data-section="${name}"]`)!.click();
}

function setSetting(id: string, value: string | boolean): void {
	const field = document.querySelector<HTMLInputElement>(`.setting-body [data-setting="${id}"]`)!;
	if (typeof value === 'boolean') field.checked = value;
	else field.value = value;
	field.dispatchEvent(new Event('change'));
}

/** A new paragraph at the end of the note, being edited (a click below the last block). */
function writeAtEnd(): HTMLTextAreaElement {
	click(document.getElementById('page')!, { clientY: 99999 });
	return editor()!;
}

function tabTitleList(): string[] {
	return [...document.querySelectorAll('#tabBar .tab-title')].map((title) => title.textContent ?? '');
}

beforeAll(async () => {
	localStorage.clear();
	const html = readFileSync(resolve(here, '../index.html'), 'utf8');
	document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/, '');
	const main = await import('../src/main');
	await main.ready;
	app = main.app;
});

describe('web app', () => {
	it('starts on the start screen, like VS Code, under the black and gold mark', () => {
		const start = document.getElementById('startScreen')!;
		expect(start.hidden).toBe(false);
		expect(start.textContent).toContain('Open a folder as a vault');
		expect(start.textContent).toContain('New vault in this browser');
		expect(start.querySelector('.start-logo svg rect')!.getAttribute('fill')).toBe('#0c0b09');
		expect(document.getElementById('page')!.hidden).toBe(true);
		expect(document.getElementById('tabBar')!.hidden).toBe(true);
	});

	it('opens the welcome guide in a tab, with its properties on top and every guide beside it', async () => {
		command('Guide.Open');
		await settle();
		expect(document.getElementById('startScreen')!.hidden).toBe(true);
		expect(document.querySelector<HTMLTextAreaElement>('.inline-title')!.value).toBe('Welcome');
		expect(tabTitleList()).toEqual(['Welcome']);
		const pillList = [...frameOfType('Property').querySelectorAll('.oi-pill')].map((pill) => pill.firstChild!.textContent);
		expect(pillList).toEqual(['Guide', 'Start Here']);
		const treeList = [...document.querySelectorAll('.file-tree .tree-item')].map((row) => row.textContent);
		for (const name of ['Code', 'HTML', 'Image', 'Markdown', 'Math', 'Video', 'Welcome']) expect(treeList).toContain(name);
		// the header of a note belongs to the app: it shows only in the Source view
		expect(document.querySelector('#note')!.textContent).not.toContain('Created');
	});

	it('edits a block as its own source, header included, and changes its type right there', () => {
		const math = frameOfType('Math');
		click(math.querySelector('.oi-content')!);
		expect(editor()!.value).toBe('Math: e^{i\\pi} + 1 = 0');
		// the type changes as you type, and the block stays where it is
		type(editor()!, 'Chem: H_2O');
		expect(editingType()).toBe('Chem');
		expect(editor()!.value).toBe('Chem: H_2O');
		press('z', editor()!, { ...mod, code: 'KeyZ' });
		expect(editingType()).toBe('Math');
		expect(editor()!.value).toBe('Math: e^{i\\pi} + 1 = 0');
		// text that isn't a block any more becomes a paragraph when the editor closes
		type(editor()!, 'just words now');
		expect(editingType()).toBe('Math');
		press('Escape', editor()!);
		expect(frameList().some((frame) => frame.dataset.oiType === 'Text' && frame.textContent === 'just words now')).toBe(true);
		// and Ctrl+Z anywhere brings the equation back
		press('z', document, { ...mod, code: 'KeyZ' });
		expect(frameOfType('Math').querySelector('math')).not.toBeNull();
	});

	it('opens a paragraph at the clicked spot, and Ctrl+Z works while typing', () => {
		const paragraph = frameList().find((frame) => frame.dataset.oiType === 'Text' && frame.textContent?.startsWith('Octaether Ink keeps'))!;
		const code = paragraph.querySelector<HTMLElement>('code')!;
		click(code);
		const textarea = editor()!;
		expect(textarea.selectionStart).toBe(Number(code.dataset.oiS));
		expect(textarea.value.slice(textarea.selectionStart, textarea.selectionStart + 3)).toBe('.oi');
		const before = textarea.value;
		type(textarea, `${before} More.`);
		press('z', textarea, { ...mod, code: 'KeyZ' });
		expect(editor()!.value).toBe(before);
		press('z', editor()!, { ...mod, shiftKey: true, code: 'KeyZ' });
		expect(editor()!.value).toBe(`${before} More.`);
		press('z', editor()!, { ...mod, code: 'KeyZ' });
		press('Escape', editor()!);
		expect(editor()).toBeNull();
	});

	it('turns a paragraph into a block when a header or an alias is typed alone and Enter pressed', () => {
		type(writeAtEnd(), 'Code: Python');
		press('Enter', editor()!);
		expect(editingType()).toBe('Code');
		expect(editor()!.value).toBe('Code: Python\n\t');
		type(editor()!, 'Code: Python\n\tprint("hi")');
		press('Escape', editor()!);
		expect(frameOfType('Code', 0).querySelector('.oi-code-label')!.textContent).toBe('Python');
		type(writeAtEnd(), '$$');
		press('Enter', editor()!);
		expect(editingType()).toBe('Math');
		expect(editor()!.value).toBe('$$$$');
		type(editor()!, '$$x^2$$');
		press('Escape', editor()!);
		const last = frameList().at(-1)!;
		expect(last.dataset.oiType).toBe('Math');
		expect(last.querySelector('math')).not.toBeNull();
	});

	it('deletes highlighted text, not the block that was selected', () => {
		// select a block (Esc leaves its editor with the block selected)
		click(frameList().at(-1)!.querySelector('.oi-content')!);
		press('Escape', editor()!);
		expect(app.session.selected()).toBeDefined();
		const count = frameList().length;
		const paragraph = frameList().find((frame) => frame.textContent?.startsWith('Octaether Ink keeps'))!;
		const text = paragraph.querySelector('[data-oi-s]')!.firstChild!;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 'Octaether '.length);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(range);
		press('Delete');
		expect(frameList()).toHaveLength(count);
		expect(app.workspace.note!.model.serialize()).toContain('\nInk keeps each note');
		press('Escape', editor()!);
	});

	it('switches between the Source, Edit, and Read views', () => {
		document.getElementById('modeSource')!.click();
		const source = document.querySelector<HTMLTextAreaElement>('#sourceHost .source-input')!;
		expect(document.getElementById('note')!.hidden).toBe(true);
		expect(source.value).toContain('Callout {Kind: Tip}: Click anywhere to edit, exactly there');
		expect(source.value).toContain('Created: 2026-09-30 12:00 -04:00');
		expect(document.querySelectorAll('#sourceHost .source-line').length).toBe(source.value.split('\n').length);
		type(source, source.value.replace('## How blocks work\n', '## How blocks work here\n'));
		document.getElementById('modeEdit')!.click();
		expect(document.getElementById('note')!.hidden).toBe(false);
		expect(frameList().some((frame) => frame.textContent === 'How blocks work here')).toBe(true);
		document.getElementById('modeRead')!.click();
		expect(document.getElementById('note')!.classList.contains('oi-read-only')).toBe(true);
		click(frameList().find((frame) => frame.querySelector(':scope > .oi-content > p'))!.querySelector('p')!);
		expect(editor()).toBeNull();
		press('e', document, { ...mod, code: 'KeyE' });
		expect(app.view()).toBe('Edit');
	});

	it('finds text in the note with Ctrl+F', () => {
		press('f', document, { ...mod, code: 'KeyF' });
		const bar = document.querySelector<HTMLElement>('.find-bar')!;
		expect(bar.hidden).toBe(false);
		const input = bar.querySelector<HTMLInputElement>('.find-input')!;
		type(input, 'guide');
		expect(bar.querySelector('.find-count')!.textContent).toMatch(/^1 of [2-9]$/);
		press('Enter', input);
		expect(bar.querySelector('.find-count')!.textContent).toMatch(/^2 of /);
		press('Escape', input);
		expect(bar.hidden).toBe(true);
	});

	it('follows a link in the same tab, goes back, and opens one in a new tab with Ctrl', async () => {
		click(document.querySelector('#note [data-oi-link="Image"]')!);
		await settle();
		expect(app.workspace.note!.path).toBe('Image.oi');
		expect(tabTitleList()).toEqual(['Image']);
		// the picture comes from the vault
		expect(frameOfType('Image').querySelector('.oi-media-missing')).toBeNull();
		expect(frameOfType('Image').querySelector('.oi-media-caption')!.textContent).toContain('pen nib');
		document.getElementById('viewBack')!.click();
		await settle();
		expect(app.workspace.note!.path).toBe('Welcome.oi');
		click(document.querySelector('#note [data-oi-link="Markdown"]')!, mod);
		await settle();
		expect(tabTitleList()).toEqual(['Welcome', 'Markdown']);
		expect(frameOfType('Markdown').querySelectorAll('.oi-markdown li.oi-task')).toHaveLength(4);
		press('w', document, { altKey: true, code: 'KeyW' });
		await settle();
		expect(tabTitleList()).toEqual(['Welcome']);
	});

	it('opens a picture of the vault in the tab, as Obsidian does, and Back returns to the note', async () => {
		document.querySelector<HTMLElement>('.file-tree [data-path="Octahedron.svg"]')!.click();
		await settle();
		expect(tabTitleList()).toEqual(['Octahedron.svg']);
		expect(document.getElementById('fileView')!.hidden).toBe(false);
		expect(document.getElementById('page')!.hidden).toBe(true);
		expect(document.querySelector('#fileView img')!.getAttribute('src')).toMatch(/^blob:/);
		expect(document.getElementById('viewHeader')!.classList.contains('no-mode')).toBe(true);
		expect(document.querySelector('.file-tree [data-path="Octahedron.svg"]')!.classList.contains('active')).toBe(true);
		document.getElementById('viewBack')!.click();
		await settle();
		expect(tabTitleList()).toEqual(['Welcome']);
		expect(document.getElementById('fileView')!.hidden).toBe(true);
	});

	it('names a new note first, then turns a block into another type from the "/" menu', async () => {
		command('Note.Create');
		await settle();
		const title = document.querySelector<HTMLTextAreaElement>('.inline-title')!;
		expect(title.value).toBe('Untitled');
		expect(document.activeElement).toBe(title);
		expect(tabTitleList()).toEqual(['Welcome', 'Untitled']);
		press('Enter', title);
		await settle();
		const textarea = editor()!;
		type(textarea, '/che');
		expect(document.querySelector('#layer .menu-item')!.textContent).toContain('Chemical structure');
		type(textarea, '/mat');
		press('Enter', textarea);
		expect(document.querySelector('#layer .menu')).toBeNull();
		expect(editingType()).toBe('Math');
		// an empty block opens with room to type its body after the header
		expect(editor()!.value).toBe('Math: ');
		type(editor()!, 'Math: x^2');
		press('Escape', editor()!);
		expect(frameOfType('Math').querySelector('math')).not.toBeNull();
	});

	it('bolds selected text with the hotkey', () => {
		const textarea = writeAtEnd();
		type(textarea, 'make this bold');
		textarea.setSelectionRange(10, 14);
		press('b', textarea, { ...mod, code: 'KeyB' });
		expect(textarea.value).toBe('make this **bold**');
		press('Escape', textarea);
		expect(frameList().at(-1)!.querySelector('strong')?.textContent).toBe('bold');
	});

	it('opens a block menu on right-click and deletes the block', () => {
		const before = frameList().length;
		frameList().at(-1)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
		expect(document.querySelector('#layer .menu')!.textContent).toContain('Turn into');
		menuItem('Delete').click();
		expect(frameList()).toHaveLength(before - 1);
	});

	it('outlines a block whose module is off and keeps its text', () => {
		document.querySelector<HTMLButtonElement>('[data-command="Setting.Open"]')!.click();
		settingSection('Module');
		const off = document.querySelector<HTMLInputElement>('.setting-body input[data-name="Math"]')!;
		off.checked = false;
		off.dispatchEvent(new Event('change'));
		const math = frameOfType('Math');
		expect(math.classList.contains('oi-broken')).toBe(true);
		expect(math.dataset.oiBroken).toBe('Off');
		expect(math.textContent).toContain('x^2');
		const on = document.querySelector<HTMLInputElement>('.setting-body input[data-name="Math"]')!;
		on.checked = true;
		on.dispatchEvent(new Event('change'));
		expect(frameOfType('Math').classList.contains('oi-broken')).toBe(false);
		// the Text module can't be switched off
		expect(document.querySelector<HTMLInputElement>('.setting-body input[data-name="Text"]')!.disabled).toBe(true);
		// the new modules are there, each with its switch
		for (const name of ['Image', 'Video', 'Markdown', 'HTML']) expect(document.querySelector(`.setting-body input[data-name="${name}"]`)).not.toBeNull();
	});

	it('gives each module a page with its own settings, and its aliases with their conflicts', async () => {
		document.querySelector<HTMLButtonElement>('.setting-body [data-open="Code"]')!.click();
		expect(document.querySelector('.setting-body h2')!.textContent).toBe('Code');
		const nameList = [...document.querySelectorAll('.setting-body .setting-name')].map((name) => name.textContent);
		expect(nameList).toContain('Alias');
		expect(nameList).toContain('Alias symbols');
		expect(document.querySelector<HTMLInputElement>('.setting-body [data-setting="Code.AliasMarker"]')!.value).toBe('``` ~~~');
		// Math, listed first, keeps $$
		setSetting('Code.AliasMarker', '``` $$');
		expect(document.querySelector('.setting-body .setting-problem')!.textContent).toBe('Code alias "$$" is Math’s "$$", so Math keeps it.');
		setSetting('Code.AliasMarker', '``` ~~~');
		expect(document.querySelector('.setting-body .setting-problem')).toBeNull();
		// switched off, $$ lines are text again, and back on they are math
		document.querySelector<HTMLButtonElement>('.setting-body [data-back]')!.click();
		document.querySelector<HTMLButtonElement>('.setting-body [data-open="Math"]')!.click();
		setSetting('Math.Alias', false);
		expect(app.workspace.openNoteList().some((note) => note.model.document.itemList.some((node) => node.alias === '$$'))).toBe(false);
		setSetting('Math.Alias', true);
		expect(app.workspace.openNoteList().some((note) => note.model.document.itemList.some((node) => node.alias === '$$'))).toBe(true);
		document.querySelector<HTMLButtonElement>('.setting-body [data-back]')!.click();
		document.querySelector<HTMLButtonElement>('.setting-body [data-open="Code"]')!.click();
		setSetting('Code.LineNumber', true);
		expect(app.setting.get('Code.LineNumber')).toBe(true);
		settingSection('Appearance');
		// the theme follows the device until you pick one
		expect(document.querySelector<HTMLSelectElement>('.setting-body [data-theme]')!.value).toBe('System');
		press('Escape');
		expect(document.querySelector('.modal-backdrop')).toBeNull();
	});

	it('rebinds a hotkey like the controls screen of a game', () => {
		document.querySelector<HTMLButtonElement>('[data-command="Setting.Open"]')!.click();
		settingSection('Hotkey');
		document.querySelector<HTMLButtonElement>('.setting-body [data-record="Graph.Open"]')!.click();
		press('1', document, { altKey: true, shiftKey: true, code: 'Digit1' });
		press('2', document, { altKey: true, shiftKey: true, code: 'Digit2' });
		expect(app.setting.keyListOf('Graph.Open')).toContain('Alt+Shift+1 Alt+Shift+2');
		const row = document.querySelector<HTMLButtonElement>('.setting-body [data-record="Graph.Open"]')!.closest('.hotkey-row')!;
		(row.querySelector('[data-reset]') as HTMLButtonElement).click();
		expect(app.setting.isCustomized('Graph.Open')).toBe(false);
	});

	it('makes a macro that toggles a setting, run from the palette', () => {
		document.querySelector<HTMLButtonElement>('.setting-body [data-action="NewMacro"]')!.click();
		const modal = document.querySelector<HTMLElement>('.macro-modal')!;
		modal.querySelector<HTMLInputElement>('.macro-title')!.value = 'Numbers';
		const argument = modal.querySelector<HTMLSelectElement>('select[data-argument="0"]')!;
		argument.value = 'Code.LineNumber';
		argument.dispatchEvent(new Event('change'));
		modal.querySelector<HTMLButtonElement>('[data-action="Save"]')!.click();
		expect(app.setting.macroList()[0]!.stepList).toEqual([{ command: 'Setting.Toggle', argument: 'Code.LineNumber' }]);
		press('Escape');
		expect(app.setting.get('Code.LineNumber')).toBe(true);
		press('p', document, { ...mod, code: 'KeyP' });
		const input = document.querySelector<HTMLInputElement>('.palette-input')!;
		type(input, 'Macro: Numbers');
		press('Enter', input);
		expect(app.setting.get('Code.LineNumber')).toBe(false);
	});

	it('opens a vault with a sidebar, and keeps no blank Untitled notes', async () => {
		const fs = new MemoryFileSystem('Chemistry', {
			'Index.oi': 'See [[Lab/Titration]].\n',
			'Lab/Titration.oi': '---\nTag: [Lab]\n---\n\npH curve #Lab\n',
		});
		const opening = app.openVaultWith(fs, { id: 'memory', kind: 'Browser', name: 'Chemistry', time: 0 });
		await settle();
		document.querySelector<HTMLButtonElement>('.dialog-modal [data-answer="Yes"]')?.click();
		expect(await opening).toBe(true);
		await settle();
		expect(document.getElementById('sidebar')!.hidden).toBe(false);
		expect([...document.querySelectorAll('.file-tree .tree-item')].map((row) => row.textContent)).toEqual(['Lab', 'Index']);
		document.querySelector<HTMLElement>('.file-tree [data-path="Index.oi"]')!.click();
		await settle();
		expect(document.querySelector<HTMLTextAreaElement>('.inline-title')!.value).toBe('Index');
		click(document.querySelector<HTMLElement>('#note [data-oi-link]')!);
		await settle();
		expect(app.workspace.note!.path).toBe('Lab/Titration.oi');
		// a note that keeps its fields in the header is offered to show them as properties
		expect(document.querySelector('.note-head-notice')!.textContent).toContain('Tag');
		// new notes left blank are never written
		command('Note.Create');
		await settle();
		expect(document.querySelector('.file-tree .tree-item.pending')!.textContent).toBe('Untitled');
		await app.workspace.closeNote();
		expect(await fs.list()).not.toContainEqual({ path: 'Untitled.oi', kind: 'File' });
		// a named note is written at once
		command('Note.Create');
		await settle();
		const title = document.querySelector<HTMLTextAreaElement>('.inline-title')!;
		title.value = 'Plan';
		press('Enter', title);
		await settle();
		expect(await fs.read('Plan.oi')).toMatch(/Format: Oi 1/);
	});

	it('keeps a pasted picture in the vault and shows it in an Image block', async () => {
		press('Escape', editor() ?? document);
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'image.png', { type: 'image/png' })] } });
		document.body.dispatchEvent(event);
		await settle();
		expect(event.defaultPrevented).toBe(true);
		// a screenshot is just "image.png": it is named after the note
		expect((await app.workspace.vault!.readBinary('Attachment/Plan.png')).size).toBeGreaterThan(0);
		expect(app.workspace.note!.model.serialize()).toContain('\nImage: Attachment/Plan.png\n');
		expect(frameOfType('Image').querySelector('.oi-media-missing')).toBeNull();
	});

	it('undoes a rename with Ctrl+Z anywhere', async () => {
		const title = document.querySelector<HTMLTextAreaElement>('.inline-title')!;
		title.focus();
		title.value = 'Plan for Friday';
		press('Enter', title);
		await settle();
		expect(app.workspace.note!.path).toBe('Plan for Friday.oi');
		// Enter went on into the note; leaving it, Ctrl+Z steps back through the edits and the rename
		press('Escape', editor() ?? document);
		for (let step = 0; step < 3 && app.workspace.note!.path !== 'Plan.oi'; step++) {
			press('z', document, { ...mod, code: 'KeyZ' });
			await settle();
		}
		expect(app.workspace.note!.path).toBe('Plan.oi');
		expect(tabTitleList()).toContain('Plan');
		expect(app.workspace.vault!.has('Plan for Friday.oi')).toBe(false);
	});

	it('moves a deleted note to the trash after asking', async () => {
		expect(app.workspace.note!.path).toBe('Plan.oi');
		document.querySelector<HTMLButtonElement>('.ribbon [data-command="Command.Palette"]')!.click();
		const input = document.querySelector<HTMLInputElement>('.palette-input')!;
		type(input, 'Delete note');
		press('Enter', input);
		await settle();
		const dialog = document.querySelector<HTMLElement>('.dialog-modal')!;
		expect(dialog.textContent).toContain('to the trash');
		dialog.querySelector<HTMLButtonElement>('[data-answer="Yes"]')!.click();
		await settle();
		expect(app.workspace.vault!.has('Plan.oi')).toBe(false);
		expect(app.workspace.vault!.trashList().map((entry) => entry.path)).toEqual(['.oi/Trash/Plan.oi']);
	});

	it('shows every note in the graph view, and Back leaves it', async () => {
		document.querySelector<HTMLButtonElement>('.ribbon [data-command="Graph.Open"]')!.click();
		await settle();
		expect(document.querySelector<HTMLElement>('.graph-view')!.hidden).toBe(false);
		expect(document.getElementById('viewTitle')!.textContent).toBe('Graph view');
		document.getElementById('viewBack')!.click();
		await settle();
		expect(document.querySelector<HTMLElement>('.graph-view')!.hidden).toBe(true);
	});
});
