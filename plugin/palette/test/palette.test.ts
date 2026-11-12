// @vitest-environment happy-dom
import { readGradient, writeGradient } from '@octaether/core-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createGradientPicker, readGradientFile, readSavedGradient } from '../src/gradient';
import { createColorPicker, forgetColor, readAse, readPaletteState, readPaletteText, recentColorList, rememberColor, startPaletteList, themeColorList, writePaletteState } from '../src';

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
});

/** An Adobe swatch file with one RGB color and one gray. */
function aseFile(): ArrayBuffer {
	const part: number[] = [];
	const u16 = (value: number): void => void part.push((value >> 8) & 255, value & 255);
	const u32 = (value: number): void => void part.push((value >>> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255);
	const f32 = (value: number): void => {
		const view = new DataView(new ArrayBuffer(4));
		view.setFloat32(0, value);
		part.push(...new Uint8Array(view.buffer));
	};
	const entry = (model: string, valueList: number[]): void => {
		const name = 'A\u0000';
		u16(1);
		u32(2 + name.length * 2 + 4 + valueList.length * 4 + 2);
		u16(name.length);
		for (const character of name) u16(character.charCodeAt(0));
		for (const character of model) part.push(character.charCodeAt(0));
		for (const value of valueList) f32(value);
		u16(0);
	};
	for (const character of 'ASEF') part.push(character.charCodeAt(0));
	u16(1);
	u16(0);
	u32(2);
	entry('RGB ', [1, 0, 0.5]);
	entry('Gray', [0.5]);
	return new Uint8Array(part).buffer;
}

describe('Palette', () => {
	it('reads palettes: Adobe .ase, GIMP .gpl, and text with hex codes', () => {
		expect(readAse(aseFile())).toEqual(['#ff0080', '#808080']);
		expect(readPaletteText('GIMP Palette\nName: Sea\n#\n  0 128 255\tBlue\n255 255 255 White\n')).toEqual(['#0080ff', '#ffffff']);
		expect(readPaletteText('ff5733-c70039-900c3f')).toEqual(['#ff5733', '#c70039', '#900c3f']);
		expect(readPaletteText('a { color: #ABC; } width: 123456px; ["#2f5fd0"]')).toEqual(['#aabbcc', '#2f5fd0']);
	});

	it('remembers the last twelve colors, newest first, and forgets one or all', () => {
		for (let index = 1; index <= 14; index++) rememberColor(`#0000${index.toString(16).padStart(2, '0')}`);
		expect(recentColorList()).toHaveLength(12);
		expect(recentColorList()[0]).toBe('#00000e');
		forgetColor('#00000e');
		expect(recentColorList()[0]).toBe('#00000d');
		forgetColor(undefined);
		expect(recentColorList()).toEqual([]);
	});

	it('is one menu: theme colors, a palette, recent colors, any hex code, and No color', () => {
		rememberColor('#123456');
		const picker = createColorPicker();
		const pickList: (string | undefined)[] = [];
		picker.open({ x: 10, y: 10, current: 'Accent', onPick: (color) => pickList.push(color) });
		const swatchList = [...document.querySelectorAll<HTMLElement>('.oi-palette-swatch')];
		expect(swatchList).toHaveLength(themeColorList.length + startPaletteList[0]!.colorList.length + 1);
		expect(document.querySelector('[data-color="Accent"]')!.getAttribute('aria-pressed')).toBe('true');
		document.querySelector<HTMLElement>('[data-color="Danger"]')!.click();
		expect(pickList).toEqual(['Danger']);
		expect(document.querySelector('.oi-palette')).toBeNull();
		// a typed hex code: checked, then given back lowercase and remembered
		picker.open({ x: 10, y: 10, onPick: (color) => pickList.push(color) });
		const hex = document.querySelector<HTMLInputElement>('.oi-palette-hex')!;
		hex.value = 'nope';
		hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(hex.getAttribute('aria-invalid')).toBe('true');
		hex.value = '#1E88E5';
		hex.dispatchEvent(new Event('input', { bubbles: true }));
		hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(pickList.at(-1)).toBe('#1e88e5');
		expect(recentColorList()[0]).toBe('#1e88e5');
		// No color, and Esc closes without a choice
		picker.open({ x: 10, y: 10, onPick: (color) => pickList.push(color) });
		document.querySelector<HTMLElement>('.oi-palette-none')!.click();
		expect(pickList.at(-1)).toBeUndefined();
		expect(pickList).toHaveLength(3);
		picker.open({ x: 10, y: 10, onPick: (color) => pickList.push(color) });
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(document.querySelector('.oi-palette')).toBeNull();
		expect(pickList).toHaveLength(3);
	});

	it('switches palettes, adds the typed color, and removes colors while editing', () => {
		writePaletteState({ current: 'Mine', list: [{ name: 'Mine', colorList: ['#111111'] }, { name: 'Other', colorList: ['#222222'] }] });
		rememberColor('#333333');
		const picker = createColorPicker();
		const pickList: (string | undefined)[] = [];
		picker.open({ x: 10, y: 10, onPick: (color) => pickList.push(color) });
		const hex = document.querySelector<HTMLInputElement>('.oi-palette-hex')!;
		hex.value = '#abcdef';
		hex.dispatchEvent(new Event('input', { bubbles: true }));
		document.querySelector<HTMLElement>('[data-action="AddColor"]')!.click();
		expect(readPaletteState().list[0]!.colorList).toEqual(['#111111', '#abcdef']);
		// Edit: a click takes a color away instead of choosing it
		document.querySelector<HTMLElement>('[data-action="Edit"]')!.click();
		document.querySelector<HTMLElement>('[data-remove="Palette"][data-color="#111111"]')!.click();
		document.querySelector<HTMLElement>('[data-remove="Recent"][data-color="#333333"]')!.click();
		expect(readPaletteState().list[0]!.colorList).toEqual(['#abcdef']);
		expect(recentColorList()).toEqual([]);
		expect(pickList).toEqual([]);
		// another palette, then delete it
		const select = document.querySelector<HTMLSelectElement>('.oi-palette select')!;
		select.value = 'Other';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(readPaletteState().current).toBe('Other');
		document.querySelector<HTMLElement>('[data-action="DeletePalette"]')!.click();
		expect(readPaletteState().list.map((palette) => palette.name)).toEqual(['Mine']);
	});
});

describe('gradients', () => {
	it('reads and writes stops at their places: even ones as plain colors', () => {
		expect(readGradient(['Blue', 'Red'])).toEqual([{ color: 'Blue', at: 0 }, { color: 'Red', at: 1 }]);
		expect(readGradient(['Blue', 'Teal 25%', 'Gold', 'Red'])).toEqual([{ color: 'Blue', at: 0 }, { color: 'Teal', at: 0.25 }, { color: 'Gold', at: 0.625 }, { color: 'Red', at: 1 }]);
		expect(readGradient(['Red 100%', 'Blue 0%']).map((stop) => stop.color)).toEqual(['Blue', 'Red']);
		expect(writeGradient([{ color: 'Blue', at: 0 }, { color: 'Gold', at: 0.5 }, { color: 'Red', at: 1 }])).toEqual(['Blue', 'Gold', 'Red']);
		expect(writeGradient([{ color: '#440154', at: 0 }, { color: 'Teal', at: 0.4 }, { color: 'Red', at: 1 }])).toEqual(['#440154 0%', 'Teal 40%', 'Red 100%']);
	});

	it('imports gradients from GIMP, SVG, CSS, and hex codes', () => {
		const ggr = 'GIMP Gradient\nName: Sunset\n2\n0.000000 0.250000 0.500000 1.000000 0.000000 0.000000 1.000000 1.000000 0.500000 0.000000 1.000000 0 0\n0.500000 0.750000 1.000000 1.000000 0.500000 0.000000 1.000000 1.000000 1.000000 0.000000 1.000000 0 0\n';
		expect(readGradientFile('sun.ggr', ggr)).toEqual([{ name: 'Sunset', stopList: ['#ff0000', '#ff8000', '#ffff00'] }]);
		const svg = '<svg><defs><linearGradient id="Sea"><stop offset="0" stop-color="#001f3f"/><stop offset="30%" stop-color="#0074d9"/><stop offset="1" style="stop-color:#7fdbff"/></linearGradient></defs></svg>';
		expect(readGradientFile('sea.svg', svg)).toEqual([{ name: 'Sea', stopList: ['#001f3f 0%', '#0074d9 30%', '#7fdbff 100%'] }]);
		expect(readGradientFile('a.css', '.x { background: linear-gradient(to right, #000 0%, rgb(255, 0, 0) 50%, #fff); }')).toEqual([{ name: 'a', stopList: ['#000', 'rgb(255, 0, 0)', '#fff'] }]);
		expect(readGradientFile('hex.txt', '#111111 #222222\n#333333, #444444, #555555\n')).toEqual([
			{ name: 'hex 1', stopList: ['#111111', '#222222'] },
			{ name: 'hex 2', stopList: ['#333333', '#444444', '#555555'] },
		]);
		expect(readGradientFile('none.txt', 'nothing here')).toEqual([]);
	});

	it('edits as it goes: a place typed, Ctrl+Z and Ctrl+Shift+Z, colors without "No color", Save, Esc puts it back', () => {
		const opened: { none?: boolean; onPick(color: string | undefined): void }[] = [];
		const colorPicker = { open: (option: { none?: boolean; onPick(color: string | undefined): void }) => void opened.push(option), close: () => undefined };
		const picker = createGradientPicker(() => colorPicker, (color) => color, '');
		const changeList: (string[] | undefined)[] = [];
		const pickList: (string[] | undefined)[] = [];
		picker.open({ x: 0, y: 0, current: ['Blue', 'Red'], onChange: (list) => void changeList.push(list), onPick: (list) => void pickList.push(list) });
		const menu = document.querySelector<HTMLElement>('.oi-gradient')!;
		// the second color, chosen; its place typed
		menu.querySelector<HTMLElement>('.oi-gradient-track [data-stop="1"]')!.click();
		expect(opened.at(-1)!.none).toBe(false);
		opened.at(-1)!.onPick('Gold');
		expect(changeList.at(-1)).toEqual(['Blue', 'Gold']);
		const place = menu.querySelector<HTMLInputElement>('[data-field="place"]')!;
		place.value = '60';
		place.dispatchEvent(new Event('change', { bubbles: true }));
		expect(changeList.at(-1)).toEqual(['Blue 0%', 'Gold 60%']);
		expect(menu.querySelector('[aria-current="true"] .oi-gradient-pct')!.textContent).toBe('60%');
		// Ctrl+Z steps back, Ctrl+Shift+Z forward
		const key = (name: string, shift = false): void => void menu.dispatchEvent(new KeyboardEvent('keydown', { key: name, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
		key('z');
		expect(changeList.at(-1)).toEqual(['Blue', 'Gold']);
		key('z');
		expect(changeList.at(-1)).toEqual(['Blue', 'Red']);
		key('Z', true);
		key('Z', true);
		expect(changeList.at(-1)).toEqual(['Blue 0%', 'Gold 60%']);
		// kept to use again
		menu.querySelector<HTMLElement>('[data-action="Save"]')!.click();
		expect(readSavedGradient()).toEqual([{ name: 'My gradient', stopList: ['Blue 0%', 'Gold 60%'] }]);
		// Esc puts back what was there
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(document.querySelector('.oi-gradient')).toBeNull();
		expect(changeList.at(-1)).toEqual(['Blue', 'Red']);
		expect(pickList).toEqual([]);
	});
});
