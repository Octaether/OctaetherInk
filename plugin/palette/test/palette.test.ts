// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
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
