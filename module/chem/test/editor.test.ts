// @vitest-environment happy-dom
import type { PropertyMap } from '@octaether/core-format';
import type { BoardItem } from '@octaether/core-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { openStructureEditor } from '../src';

const button = (action: string) => document.querySelector<HTMLButtonElement>(`.oi-draw [data-action="${action}"]`)!;
const source = () => document.querySelector<HTMLTextAreaElement>('.oi-draw-source')!;
const canvas = () => document.querySelector<SVGSVGElement>('.oi-draw-canvas')!;
const type = (text: string) => {
	source().value = text;
	source().dispatchEvent(new Event('input'));
};

function item(kind: string, property: Record<string, unknown>, body = '', childList: BoardItem[] = []): BoardItem {
	return { type: kind, property: new Map(Object.entries(property)) as PropertyMap, body, childList };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('drawing tool on one structure', () => {
	it('shows the structure and its text, and Done gives the text back', () => {
		const result: string[] = [];
		openStructureEditor({ body: 'O@o^-:3 -0 C', onDone: (text) => result.push(text) });
		expect(document.querySelector('.oi-draw-title')!.textContent).toBe('Structure');
		expect(source().value).toBe('O@o^-:3 -0 C');
		expect(canvas().querySelectorAll('[data-bond]')).toHaveLength(1);
		button('Done').click();
		expect(result).toEqual(['O@o^-:3 -0 C']);
		expect(document.querySelector('.oi-draw-backdrop')).toBeNull();
	});

	it('follows typing in the text, with Undo and Redo, and Ctrl+Enter is Done', () => {
		const result: string[] = [];
		openStructureEditor({ body: 'C', onDone: (text) => result.push(text) });
		type('C -0 O');
		expect(canvas().querySelectorAll('[data-bond]')).toHaveLength(1);
		button('Undo').click();
		expect(source().value).toBe('C');
		button('Redo').click();
		expect(source().value).toBe('C -0 O');
		source().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
		expect(result).toEqual(['C -0 O']);
	});

	it('shows mistakes, and Esc leaves the block as it was', () => {
		const result: string[] = [];
		openStructureEditor({ body: 'C', onDone: (text) => result.push(text) });
		type('C O');
		expect(document.querySelector('.oi-draw-text')!.textContent).toContain('two atoms need a bond');
		button('Clear').click();
		canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(result).toEqual([]);
	});
});

describe('drawing tool on a Board', () => {
	const board = (): { property: PropertyMap; itemList: BoardItem[] } => ({
		property: new Map(),
		itemList: [
			item('Chem', { X: 10, Y: 20 }, 'O@o^-:3'),
			item('Chem', { X: 120, Y: 0 }, 'C@c -0@cb Br@br'),
			item('Arrow', { From: 'o.lp', To: 'c' }),
			item('Text', { X: 0, Y: 90 }, 'backside attack'),
			item('Arrow', { X: 0, Y: 150, Length: 60 }, '', [item('Text', { Side: 'Below' }, 'slow')]),
		],
	});

	it('draws every block: structures and arrows on the canvas, text over it', () => {
		const result: string[] = [];
		openStructureEditor({ board: board(), renderBlock: (_type, body) => `<p>${body}</p>`, onDone: (text) => result.push(text) });
		expect(document.querySelector('.oi-draw-title')!.textContent).toBe('Board');
		expect(document.querySelectorAll('.oi-draw-tool [data-group="Arrow"], .oi-draw-tool [data-group="Text"]')).toHaveLength(2);
		expect(canvas().querySelectorAll('.oi-arrow-shape')).toHaveLength(2);
		expect([...document.querySelectorAll('.oi-draw-layer [data-block]')].map((element) => element.textContent)).toEqual(['backside attack', 'slow']);
		expect(source().value.split('\n')[0]).toBe('Board:');
		// untouched, Done changes nothing in the note
		button('Done').click();
		expect(result).toEqual([]);
	});

	it('writes a new Board even untouched (a chemfig block turned into one), with its notice shown', () => {
		const result: string[] = [];
		openStructureEditor({ board: { ...board(), notice: 'Now a Board', changed: true }, onDone: (text) => result.push(text) });
		expect(document.querySelector('.oi-draw-text')!.textContent).toBe('Now a Board');
		button('Done').click();
		expect(result).toHaveLength(1);
		expect(result[0]).toContain('\tChem {X: 120, Y: 0}: C@c -0@cb Br@br');
		expect(result[0]).toContain('\tArrow {From: o.lp, To: c}:');
	});

	it('reads the Board from its text, and Clear empties it', () => {
		const result: string[] = [];
		openStructureEditor({ board: board(), onDone: (text) => result.push(text) });
		type('Board:\n\tText {X: 5, Y: 6}: just text');
		expect([...document.querySelectorAll('.oi-draw-layer [data-block]')].map((element) => element.textContent)).toEqual(['just text']);
		type('not a board');
		expect(document.querySelector('.oi-draw-text')!.textContent).toContain('one Board');
		button('Clear').click();
		button('Done').click();
		expect(result).toEqual(['Board:']);
	});

	it('changes an arrow from its right-click menu: kind, head, shape', () => {
		const result: string[] = [];
		openStructureEditor({ board: board(), onDone: (text) => result.push(text) });
		const svg = canvas();
		// the straight arrow's middle (happy-dom has no layout: the canvas is 200 × 200 around 0, 0)
		const curve = svg.querySelector('[data-block="5"]')!;
		const line = curve.querySelector('path')!.getAttribute('d')!.split(/[ MC]+/).filter(Boolean).map(Number);
		const at = { x: (line[0]! + line[6]!) / 2, y: (line[1]! + line[7]!) / 2 };
		const choose = (label: string): void => {
			svg.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: at.x, clientY: at.y, bubbles: true }));
			const entry = [...document.querySelectorAll<HTMLButtonElement>('.oi-draw-menu button')].find((item) => item.textContent!.includes(label))!;
			expect(entry, label).toBeDefined();
			entry.click();
			expect(document.querySelector<HTMLElement>('.oi-draw-menu')!.hidden).toBe(true);
		};
		choose('Equilibrium');
		choose('At both ends');
		button('Done').click();
		expect(result[0]).toContain('Arrow {X: 0, Y: 150, Length: 60, Kind: Equilibrium, Head: Both}:');
		// the top bar keeps only Undo, Redo, Clear, Cancel, and Done: nothing pushes Done onto a second row
		expect(document.querySelector('.oi-draw-arrow')).toBeNull();
	});

	it('adds and takes away lone pairs with a left and a right click, with no cap but the 8 places', () => {
		const result: string[] = [];
		openStructureEditor({ board: board(), onDone: (text) => result.push(text) });
		const svg = canvas();
		document.querySelector<HTMLButtonElement>('[data-group="Electron"]')!.click();
		// O@o^-:3 sits at the Board's top left; find its label on the canvas
		const label = [...svg.querySelectorAll('text')].find((element) => element.textContent!.startsWith('O') || element.textContent!.startsWith('H'))!;
		const at = { x: Number(label.getAttribute('x')) + 6, y: Number(label.getAttribute('y')) - 4 };
		const click = (button: 0 | 2): void => {
			if (button === 2) {
				svg.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: at.x, clientY: at.y, bubbles: true }));
				return;
			}
			svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
			svg.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
		};
		click(0);
		click(0);
		expect(source().value).toContain('O@o^-:5');
		click(2);
		expect(source().value).toContain('O@o^-:4');
		for (let index = 0; index < 6; index++) click(0);
		// one oxygen with a hydrogen: 8 places, so 8 pairs at most
		expect(source().value).toContain('O@o^-:8');
		expect(document.querySelector('.oi-draw-text')!.textContent).toContain('no room');
	});

	it('colors what it clicks, and a right click takes the color away', () => {
		const result: string[] = [];
		const colorPicker = { open: (option: { onPick(color: string | undefined): void }) => option.onPick('Accent'), close: () => {} };
		openStructureEditor({ board: board(), colorPicker, onDone: (text) => result.push(text) });
		const svg = canvas();
		document.querySelector<HTMLButtonElement>('[data-group="Color"]')!.click();
		const label = [...svg.querySelectorAll('text')].find((element) => element.textContent!.startsWith('O') || element.textContent!.startsWith('H'))!;
		const at = { x: Number(label.getAttribute('x')) + 6, y: Number(label.getAttribute('y')) - 4 };
		svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
		expect(source().value).toContain('O@o^-:3[Accent]');
		svg.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: at.x, clientY: at.y, bubbles: true }));
		expect(source().value).toContain('O@o^-:3\n');
	});

	it('opens a group of tools beside the bar, and Esc lets go of what is picked before it closes', () => {
		openStructureEditor({ board: board(), onDone: () => {} });
		const bond = document.querySelector<HTMLButtonElement>('[data-group="Bond"]')!;
		bond.click();
		expect(bond.classList.contains('active')).toBe(true);
		bond.click();
		const flyout = document.querySelector<HTMLElement>('.oi-draw-flyout')!;
		expect(flyout.hidden).toBe(false);
		flyout.querySelector<HTMLButtonElement>('[data-member="Double"]')!.click();
		expect(flyout.hidden).toBe(true);
		expect(bond.title).toBe('Double bond (2)');
		// Select, then a box over everything picks it; Esc lets go; a second Esc closes
		document.querySelector<HTMLButtonElement>('[data-group="Select"]')!.click();
		const svg = canvas();
		svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: -5000, clientY: -5000, pointerId: 1, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointermove', { button: 0, clientX: 5000, clientY: 5000, pointerId: 1, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 5000, clientY: 5000, pointerId: 1, bubbles: true }));
		expect(svg.querySelectorAll('circle[opacity="0.25"]').length).toBeGreaterThan(0);
		svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(svg.querySelectorAll('circle[opacity="0.25"]')).toHaveLength(0);
		expect(document.querySelector('.oi-draw-backdrop')).not.toBeNull();
		svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(document.querySelector('.oi-draw-backdrop')).toBeNull();
	});

	it('writes new text with the Text tool', () => {
		const result: string[] = [];
		openStructureEditor({ board: board(), onDone: (text) => result.push(text) });
		document.querySelector<HTMLButtonElement>('.oi-draw-tool [data-group="Text"]')!.click();
		const svg = canvas();
		svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 150, clientY: 150, pointerId: 1, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 150, clientY: 150, pointerId: 1, bubbles: true }));
		const inline = document.querySelector<HTMLTextAreaElement>('.oi-draw-inline')!;
		expect(inline).not.toBeNull();
		inline.value = 'H₂O leaves';
		inline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(document.querySelector('.oi-draw-inline')).toBeNull();
		button('Done').click();
		expect(result[0]).toMatch(/\tH₂O leaves \{X: -?[\d.]+, Y: -?[\d.]+\}/);
	});

	it('paints any color: the Color button asks the Palette, then colors what it clicks; no Color without it', () => {
		const result: string[] = [];
		const asked: (string | undefined)[] = [];
		const colorPicker = { open: (option: { current?: string; onPick(color: string | undefined): void }) => { asked.push(option.current); option.onPick('#1E88E5'); }, close: () => {} };
		openStructureEditor({ board: board(), colorPicker, onDone: (text) => result.push(text) });
		const group = document.querySelector<HTMLButtonElement>('[data-group="Color"]')!;
		group.click();
		expect(asked).toHaveLength(1);
		expect(group.innerHTML).toContain('#1e88e5');
		const svg = canvas();
		const label = [...svg.querySelectorAll('text')].find((element) => element.textContent!.startsWith('O') || element.textContent!.startsWith('H'))!;
		const at = { x: Number(label.getAttribute('x')) + 6, y: Number(label.getAttribute('y')) - 4 };
		svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: at.x, clientY: at.y, pointerId: 1, bubbles: true }));
		expect(source().value).toContain('O@o^-:3[#1e88e5]');
	});

	it('edits a plain Board without chemistry: arrows, text, and no elements, bonds, or Color without the Palette', () => {
		openStructureEditor({ board: { property: new Map(), itemList: [{ type: 'Text', property: new Map([['X', 0], ['Y', 0]]), body: 'Idea', childList: [] }] }, chemistry: false, onDone: () => {} });
		const groupList = [...document.querySelectorAll<HTMLElement>('[data-group]')].map((element) => element.dataset.group);
		expect(groupList).toEqual(['Select', 'Erase', 'Arrow', 'Text']);
		expect(document.querySelector<HTMLElement>('.oi-draw-element')!.hidden).toBe(true);
		// the arrow group: curved and straight only
		const arrow = document.querySelector<HTMLButtonElement>('[data-group="Arrow"]')!;
		arrow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect([...document.querySelectorAll<HTMLElement>('.oi-draw-flyout [data-member]')].map((element) => element.dataset.member)).toEqual(['Curved', 'Reaction']);
	});

	it('picks tools by key: the defaults, or your own keys from the app, shown in the titles', () => {
		openStructureEditor({ board: board(), onDone: () => {} });
		const key = (code: string, keyName: string, shiftKey = false): void =>
			void canvas().dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName, shiftKey, bubbles: true }));
		key('KeyA', 'a');
		expect(document.querySelector('[data-group="Arrow"]')!.classList.contains('active')).toBe(true);
		key('KeyW', 'W', true);
		expect(document.querySelector<HTMLElement>('[data-group="Bond"]')!.title).toMatch(/^Hashed wedge/);
		key('KeyV', 'v');
		expect(document.querySelector('[data-group="Select"]')!.classList.contains('active')).toBe(true);
		expect(document.querySelector<HTMLElement>('[data-group="Select"]')!.title.endsWith('(V)')).toBe(true);
		canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		// your keys: Q is the text tool
		const hotkey = { commandFor: (event: KeyboardEvent) => (event.code === 'KeyQ' ? 'Drawing.Text' : undefined), keyText: (command: string) => (command === 'Drawing.Text' ? 'Q' : '') };
		openStructureEditor({ board: board(), hotkey, onDone: () => {} });
		key('KeyA', 'a');
		expect(document.querySelector('[data-group="Arrow"]')!.classList.contains('active')).toBe(false);
		key('KeyQ', 'q');
		expect(document.querySelector('[data-group="Text"]')!.classList.contains('active')).toBe(true);
		expect(document.querySelector<HTMLElement>('[data-group="Text"]')!.title.endsWith('(Q)')).toBe(true);
	});
});
