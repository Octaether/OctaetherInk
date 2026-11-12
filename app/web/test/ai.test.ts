// @vitest-environment happy-dom
// The AI plugin in the real app: what the modules teach it, and how its answers get into a note.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BlockNode, parseNote, walkNode } from '@octaether/core-format';
import { type BlockGuide, type NoteEditor, blockGuideExtension, noteEditorExtension } from '@octaether/core-sdk';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
let app: (typeof import('../src/main'))['app'];

async function settle(round = 8): Promise<void> {
	for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
}

function click(element: Element): void {
	element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function frameOfType(type: string, index = 0): HTMLElement {
	return [...document.querySelectorAll<HTMLElement>(`#note .oi-frame[data-oi-type="${type}"]`)][index]!;
}

const editor = (): NoteEditor => app.registry.extension<NoteEditor>(noteEditorExtension)!;
const noteText = (): string => app.workspace.note!.model.serialize();

async function openNote(text: string): Promise<void> {
	await app.workspace.openText(text, 'Lecture.oi');
	app.setView('Edit');
	await settle();
}

beforeAll(async () => {
	localStorage.clear();
	const html = readFileSync(resolve(here, '../index.html'), 'utf8');
	document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/, '');
	const main = await import('../src/main');
	await main.ready;
	app = main.app;
});

describe('AI in the app', () => {
	it('learns every block type from its module, and every example in a guide is valid OI text', async () => {
		const list = await app.registry.extension<BlockGuide>(blockGuideExtension)!.list();
		expect(list.map((entry) => entry.type).sort()).toEqual(['Arrow', 'Board', 'Calendar', 'Callout', 'Chem', 'Code', 'Column', 'Event', 'Grid', 'HTML', 'Image', 'Markdown', 'Math', 'Plot', 'Property', 'Table', 'Text', 'TikZ', 'Video']);
		for (const entry of list) {
			// a new module without a guide fails here: its blocks would be unknown to the AI
			expect(entry.guide, `${entry.type} has no guide`).toBeTruthy();
			for (const [, example] of entry.guide!.matchAll(/<example>\n([\s\S]*?)\n<\/example>/g)) {
				const document = parseNote(`${example}\n`, app.registry.formatOption());
				expect(document.problemList, `${entry.type}: ${example}`).toEqual([]);
				const typeList: string[] = [];
				walkNode(document.itemList, (node: BlockNode) => void typeList.push(node.type));
				for (const type of typeList) expect(app.registry.blockType(type), `${entry.type} example uses ${type}`).toBeDefined();
			}
		}
		expect(list.find((entry) => entry.type === 'Code')).toMatchObject({ argument: 'Language', aliasList: ['```', '~~~'], content: 'Raw' });
		// a module switched off is left out, so the AI never writes blocks that would not draw
		app.registry.setEnabled('Chem', false);
		expect((await app.registry.extension<BlockGuide>(blockGuideExtension)!.list()).some((entry) => entry.type === 'Chem')).toBe(false);
		app.registry.setEnabled('Chem', true);
	});

	it('has a ribbon button and a Connect button on its page, there while the plugin is on', async () => {
		const ribbon = document.getElementById('ribbonAI')!;
		expect(ribbon.hidden).toBe(false);
		// the ribbon opens the chat; Ctrl+J is the quick Ask panel
		expect(ribbon.title).toBe('Open the AI chat');
		expect(app.commandRegistry.get('AI.Ask')).toBeDefined();
		app.commandRegistry.run('Setting.Open');
		document.querySelector<HTMLButtonElement>('.setting-nav [data-section="Plugin"]')!.click();
		document.querySelector<HTMLButtonElement>('.setting-body [data-open="AI"]')!.click();
		const body = document.querySelector<HTMLElement>('.setting-body')!;
		expect(body.textContent).toContain('Kept in this browser only');
		expect(body.querySelector('[data-setting="AI.Mode"]')).not.toBeNull();
		expect(body.querySelector('[data-run="AI.Memory"]')).not.toBeNull();
		// the connection is drawn on this page: provider, key, model, effort
		await settle(30);
		const form = body.querySelector<HTMLElement>('[data-custom="AI.Connection"]')!;
		expect(form.querySelector('[data-action="Provider"]')!.textContent).toContain('Anthropic (Claude)');
		expect(form.querySelector('#oi-ai-key')).not.toBeNull();
		expect(form.querySelector('[data-action="Effort"]')!.textContent).toContain('Default');
		document.querySelector<HTMLButtonElement>('.setting-modal .modal-close')!.click();
		// Connect an AI opens this page
		app.commandRegistry.run('AI.Connect');
		await settle(30);
		expect(document.querySelector('.setting-body [data-custom="AI.Connection"] .oi-ai-form')).not.toBeNull();
		document.querySelector<HTMLButtonElement>('.setting-modal .modal-close')!.click();
		expect(document.querySelector('.setting-modal')).toBeNull();
		// the key is not a setting, so it can't reach a vault's Setting.oi
		expect(app.setting.get('AI.Connection')).toBeNull();
		app.registry.setEnabled('AI', false);
		expect(ribbon.hidden).toBe(true);
		expect(app.commandRegistry.get('AI.Ask')).toBeUndefined();
		app.registry.setEnabled('AI', true);
		expect(ribbon.hidden).toBe(false);
	});

	it('captures no note, the whole note, a selected block, or highlighted text', async () => {
		await openNote('---\nCreated: 2026-11-10 09:00\nFormat: Oi 1\n---\n\nThe rate is x squared.\n\n- A point\n\t- A detail\n');
		const whole = editor().capture()!;
		expect(whole).toMatchObject({ name: 'Lecture', scope: 'Note', selection: '', text: '\nThe rate is x squared.\n\n- A point\n\t- A detail\n' });
		expect(whole.type).toBeUndefined();
		// a selected block comes with what it holds
		const item = app.workspace.note!.model.document.itemList[1]!;
		app.session.select(item.key);
		expect(editor().capture()).toMatchObject({ scope: 'Block', type: 'Text', selection: '- A point\n\t- A detail' });
		// highlighted characters in the block being edited
		click(frameOfType('Text').querySelector('.oi-content')!);
		const area = app.session.activeTextarea()!;
		area.setSelectionRange(12, 21);
		const text = editor().capture()!;
		expect(text).toMatchObject({ scope: 'Text', type: 'Text', selection: 'x squared' });
		expect(text.whole()).toMatchObject({ scope: 'Note', selection: '' });
		app.session.close();
	});

	it('writes an answer over the highlighted text, as if typed there, and Undo takes it back', async () => {
		await openNote('The rate is x squared.\n\nAfter.\n');
		click(frameOfType('Text').querySelector('.oi-content')!);
		app.session.activeTextarea()!.setSelectionRange(12, 21);
		const target = editor().capture()!;
		expect(target.apply('{Math: x^2}', 'Replace')).toBe(true);
		app.session.close();
		expect(noteText()).toBe('The rate is {Math: x^2}.\n\nAfter.\n');
		expect(frameOfType('Text').querySelector('math')).not.toBeNull();
		// the same place twice: the text there is no longer what was asked about
		expect(target.apply('again', 'Replace')).toBe(false);
		expect(noteText()).toBe('The rate is {Math: x^2}.\n\nAfter.\n');
		app.session.history('Undo');
		expect(noteText()).toBe('The rate is x squared.\n\nAfter.\n');
	});

	it('replaces a selected block with the blocks of the answer in one undo step, or puts them under it', async () => {
		await openNote('Before.\n\nx squared over two\n\nAfter.\n');
		const model = app.workspace.note!.model;
		app.session.select(model.document.itemList[1]!.key);
		const target = editor().capture()!;
		expect(target.apply('\n\nMath: \\frac{x^2}{2}\n\nCallout {Kind: Tip}: Why\n\tHalf of the square.\n\n', 'Replace')).toBe(true);
		expect(noteText()).toBe('Before.\n\nMath: \\frac{x^2}{2}\n\nCallout {Kind: Tip}: Why\n\tHalf of the square.\n\nAfter.\n');
		expect(frameOfType('Math').querySelector('math')).not.toBeNull();
		expect(app.session.selected()).toBe(model.document.itemList[1]!.key);
		// the block asked about is gone now
		expect(target.apply('more', 'After')).toBe(false);
		app.session.history('Undo');
		expect(noteText()).toBe('Before.\n\nx squared over two\n\nAfter.\n');
		app.session.select(model.document.itemList[0]!.key);
		expect(editor().capture()!.apply('- One\n- Two', 'After')).toBe(true);
		expect(noteText()).toBe('Before.\n\n- One\n- Two\n\nx squared over two\n\nAfter.\n');
	});

	it('writes for the whole note where you were writing, or in place of every block, keeping the header', async () => {
		await openNote('---\nCreated: 2026-11-10 09:00\nFormat: Oi 1\n---\n\nFirst.\n\nLast.\n');
		// an empty line being written in (it goes away when its editor closes): the answer lands there
		click(frameOfType('Text').querySelector('.oi-content')!);
		const first = app.session.activeTextarea()!;
		first.setSelectionRange(first.value.length, first.value.length);
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(app.session.activeTextarea()!.value).toBe('');
		const here = editor().capture()!;
		expect(here.scope).toBe('Note');
		expect(here.apply('Table:\n\tName,Mass\n\tWater,18', 'After')).toBe(true);
		expect(noteText()).toBe('---\nCreated: 2026-11-10 09:00\nFormat: Oi 1\n---\n\nFirst.\n\nTable:\n\tName,Mass\n\tWater,18\n\nLast.\n');
		// with nothing being written, it goes to the end
		app.session.close();
		app.session.select(undefined);
		expect(editor().capture()!.apply('The end.', 'After')).toBe(true);
		expect(noteText().endsWith('Last.\n\nThe end.\n')).toBe(true);
		// the whole note, from the Read view too
		app.setView('Read');
		expect(editor().capture()!.apply('```oi-not-a-fence\n# Clean\n\nAll new.', 'Replace')).toBe(true);
		expect(app.view()).toBe('Edit');
		expect(noteText()).toBe('---\nCreated: 2026-11-10 09:00\nFormat: Oi 1\n---\n\n```oi-not-a-fence\n# Clean\n\nAll new.\n');
		app.session.history('Undo');
		expect(noteText().endsWith('Last.\n\nThe end.\n')).toBe(true);
	});

	it('works on the selection of the Source view', async () => {
		await openNote('Callout {Kind: Tip}: Rate\n\tx squared\n\nAfter.\n');
		app.setView('Source');
		const area = app.sourceEditor()!.textarea;
		const start = area.value.indexOf('x squared');
		area.setSelectionRange(start, start + 9);
		const target = editor().capture()!;
		expect(target).toMatchObject({ scope: 'Text', selection: 'x squared' });
		// under the block the selection is in, not in the middle of it
		expect(target.apply('Math: x^2', 'After')).toBe(true);
		expect(noteText()).toBe('Callout {Kind: Tip}: Rate\n\tx squared\n\nMath: x^2\n\nAfter.\n');
		expect(area.value).toBe(noteText());
		expect(target.apply('{Math: x^2}', 'Replace')).toBe(true);
		expect(noteText()).toBe('Callout {Kind: Tip}: Rate\n\t{Math: x^2}\n\nMath: x^2\n\nAfter.\n');
		app.setView('Edit');
	});

	it('draws a preview with the real modules, apart from the note', async () => {
		await openNote('Only this.\n');
		const element = document.createElement('div');
		document.body.append(element);
		const preview = editor().preview(element);
		preview.update('Math: x^2\n\nCallout {Kind: Tip}: Why\n\tBecause.');
		expect(element.querySelector('.oi-frame[data-oi-type="Math"] math')).not.toBeNull();
		expect(element.querySelector('.oi-frame[data-oi-type="Callout"]')!.textContent).toContain('Because.');
		expect(element.classList.contains('oi-read-only')).toBe(true);
		// as it streams, a block half written is just redrawn
		preview.update('Math: x^2\n\nCallout {Kind: Tip}: Why\n\tBecause it is.\n\n- one');
		expect(element.querySelectorAll('.oi-frame[data-oi-type="Text"]').length).toBeGreaterThan(0);
		expect(noteText()).toBe('Only this.\n');
		preview.destroy();
		expect(element.children).toHaveLength(0);
		expect(frameOfType('Text').textContent).toBe('Only this.');
		element.remove();
	});
});
