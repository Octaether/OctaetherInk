// Palette plugin: one color menu for everything that colors (the drawing tool, text colors). Other
// modules reuse it through the `ColorPicker` extension; with the plugin off they show no color choice.
//
//   one menu    the theme's colors (they follow the theme), the palette you chose, the colors you used
//               lately, and any color (the browser's picker or a hex code), with No color
//   palettes    Element (the usual colors of the elements) and Basic to start; import more from a file
//               (Adobe .ase, GIMP .gpl, or any text with hex codes: Coolors, CSS, JSON); + adds the
//               color in the hex field; Edit removes colors (× on each), recent ones, or a whole palette
//   kept        palettes and recent colors are kept in this browser
//
// What it gives back is a theme color's name (`Accent`) or `#rrggbb`, so notes keep plain values.

import { type ColorPicker, type PluginDefinition, colorPickerExtension, escapeHtml, normalizeHex } from '@octaether/core-sdk';

/** Theme colors: a name the note keeps (it follows the theme), and its CSS variable. */
export const themeColorList: readonly { name: string; title: string; variable: string }[] = [
	{ name: 'Accent', title: 'Accent', variable: '--oi-color-accent' },
	{ name: 'Danger', title: 'Red (Danger)', variable: '--oi-color-danger' },
	{ name: 'Success', title: 'Green (Success)', variable: '--oi-color-success' },
	{ name: 'Warning', title: 'Orange (Warning)', variable: '--oi-color-warning' },
	{ name: 'TextMuted', title: 'Muted', variable: '--oi-color-text-muted' },
];

export interface Palette {
	name: string;
	colorList: string[];
}

/** The palettes there are before you import any. */
export const startPaletteList: readonly Palette[] = [
	{ name: 'Element', colorList: ['#e0311f', '#2f5fd0', '#e8b400', '#2e9e44', '#f07c00', '#9c2a1c', '#7a3d9c', '#5f6b73', '#90a4ae', '#000000'] },
	{ name: 'Basic', colorList: ['#c2185b', '#d84315', '#f9a825', '#558b2f', '#00897b', '#1565c0', '#6d4c41', '#b5452c', '#8a6d00', '#37474f'] },
];

const recentKey = 'OctaetherInk.RecentColor';
const paletteKey = 'OctaetherInk.Palette';

function readJson<T>(key: string, fallback: T): T {
	try {
		const text = localStorage.getItem(key);
		return text ? (JSON.parse(text) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// not kept
	}
}

/** Hex colors you used lately, newest first (at most 12). */
export function recentColorList(): string[] {
	const list = readJson<unknown>(recentKey, []);
	return Array.isArray(list) ? list.flatMap((item) => (typeof item === 'string' && normalizeHex(item) ? [normalizeHex(item)!] : [])).slice(0, 12) : [];
}

export function rememberColor(hex: string): void {
	writeJson(recentKey, [hex, ...recentColorList().filter((item) => item !== hex)].slice(0, 12));
}

export function forgetColor(hex: string | undefined): void {
	writeJson(recentKey, hex === undefined ? [] : recentColorList().filter((item) => item !== hex));
}

/** Your palettes and the one in use. */
export function readPaletteState(): { current: string; list: Palette[] } {
	const state = readJson<{ current?: unknown; list?: unknown }>(paletteKey, {});
	const list = Array.isArray(state.list)
		? state.list.flatMap((item: unknown): Palette[] => {
				const palette = item as { name?: unknown; colorList?: unknown };
				if (typeof palette.name !== 'string' || !Array.isArray(palette.colorList)) return [];
				return [{ name: palette.name, colorList: palette.colorList.flatMap((color) => (typeof color === 'string' && normalizeHex(color) ? [normalizeHex(color)!] : [])) }];
			})
		: startPaletteList.map((palette) => ({ ...palette, colorList: [...palette.colorList] }));
	const current = typeof state.current === 'string' && list.some((palette) => palette.name === state.current) ? state.current : (list[0]?.name ?? '');
	return { current, list };
}

export function writePaletteState(state: { current: string; list: Palette[] }): void {
	writeJson(paletteKey, state);
}

/** A name not used yet: `Name`, `Name 2`, `Name 3`… */
function freeName(name: string, list: readonly Palette[]): string {
	const base = name.trim() || 'Palette';
	if (!list.some((palette) => palette.name === base)) return base;
	for (let number = 2; ; number++) if (!list.some((palette) => palette.name === `${base} ${number}`)) return `${base} ${number}`;
}

const toHex = (red: number, green: number, blue: number): string =>
	`#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;

/** The colors of an Adobe swatch exchange file (.ase): RGB, gray, and CMYK entries. */
export function readAse(data: ArrayBuffer): string[] {
	const view = new DataView(data);
	if (view.byteLength < 12 || view.getUint32(0) !== 0x41534546) return [];
	const count = view.getUint32(8);
	const colorList: string[] = [];
	let at = 12;
	for (let index = 0; index < count && at + 6 <= view.byteLength; index++) {
		const type = view.getUint16(at);
		const length = view.getUint32(at + 2);
		const start = at + 6;
		if (type === 0x0001 && start + 2 <= view.byteLength) {
			const nameLength = view.getUint16(start);
			let cursor = start + 2 + nameLength * 2;
			const model = String.fromCharCode(view.getUint8(cursor), view.getUint8(cursor + 1), view.getUint8(cursor + 2), view.getUint8(cursor + 3));
			cursor += 4;
			const value = (offset: number): number => view.getFloat32(cursor + offset * 4);
			if (model === 'RGB ') colorList.push(toHex(value(0) * 255, value(1) * 255, value(2) * 255));
			else if (model === 'Gray') colorList.push(toHex(value(0) * 255, value(0) * 255, value(0) * 255));
			else if (model === 'CMYK') {
				const key = 1 - value(3);
				colorList.push(toHex(255 * (1 - value(0)) * key, 255 * (1 - value(1)) * key, 255 * (1 - value(2)) * key));
			}
		}
		at = start + length;
	}
	return colorList;
}

/** The colors of a text palette: GIMP's `R G B name` lines, and every hex code (Coolors, CSS, JSON…). */
export function readPaletteText(text: string): string[] {
	const colorList: string[] = [];
	if (/^GIMP Palette/.test(text.trimStart())) {
		for (const line of text.split(/\r?\n/)) {
			const match = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line);
			if (match) colorList.push(toHex(Number(match[1]), Number(match[2]), Number(match[3])));
		}
	}
	for (const [, , hash, digit] of text.matchAll(/(^|[^0-9a-z#])(#?)([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi)) {
		// without #, only six hex digits with a letter among them (Coolors' ff5733-c70039): a bare number is no color
		if (!hash && (digit!.length === 3 || /^\d+$/.test(digit!))) continue;
		const hex = normalizeHex(digit!);
		if (hex) colorList.push(hex);
	}
	return [...new Set(colorList)];
}

const style = `
.oi-palette { position: fixed; z-index: 95; width: 260px; box-sizing: border-box; padding: 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; background: var(--oi-color-background, #fff); color: var(--oi-color-text, #222); border: 1px solid var(--oi-color-border, #ccc); border-radius: 10px; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22); font: 13px/1.3 var(--oi-font-body, system-ui, sans-serif); }
.oi-palette-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.oi-palette-title { flex: 1; font-weight: 600; }
.oi-palette-label { display: flex; align-items: center; gap: 6px; color: var(--oi-color-text-muted, #777); font-size: 11.5px; margin-bottom: 4px; }
.oi-palette-label > span { flex: 1; }
.oi-palette-row { display: flex; flex-wrap: wrap; gap: 5px; }
.oi-palette-swatch { position: relative; width: 22px; height: 22px; padding: 0; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 50%; cursor: pointer; background: var(--swatch); }
.oi-palette-swatch:hover { transform: scale(1.12); }
.oi-palette-swatch:focus-visible { outline: 2px solid var(--oi-color-accent, #b5452c); outline-offset: 1px; }
.oi-palette-swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--oi-color-background, #fff), 0 0 0 3.5px var(--oi-color-text, #222); }
.oi-palette-editing .oi-palette-swatch[data-remove]::after { content: ''; position: absolute; top: -5px; right: -5px; width: 13px; height: 13px; border-radius: 50%; background: var(--oi-color-text, #222) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M5 5l6 6M11 5l-6 6' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") center / 9px no-repeat; }
.oi-palette-add { width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 1px dashed var(--oi-color-border, #ccc); border-radius: 50%; background: none; color: var(--oi-color-text-muted, #777); cursor: pointer; }
.oi-palette-add:hover { color: var(--oi-color-text, #222); border-color: var(--oi-color-text-muted, #777); }
.oi-palette select { min-width: 0; flex: 1; height: 24px; padding: 0 4px; font: inherit; font-size: 12px; color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 6px; }
.oi-palette-link { padding: 2px 6px; font: inherit; font-size: 12px; color: var(--oi-color-text-muted, #777); background: none; border: none; border-radius: 5px; cursor: pointer; }
.oi-palette-link:hover, .oi-palette-link[aria-pressed="true"] { color: var(--oi-color-accent, #b5452c); background: var(--oi-color-surface1, #f4f4f4); }
.oi-palette-custom { display: flex; gap: 6px; align-items: center; min-width: 0; }
.oi-palette-custom input[type="color"] { width: 30px; height: 28px; flex: none; padding: 0; border: 1px solid var(--oi-color-border, #ccc); border-radius: 6px; background: none; cursor: pointer; }
.oi-palette-hex { flex: 1; min-width: 0; height: 28px; padding: 0 8px; box-sizing: border-box; font: 13px/1 var(--oi-font-mono, ui-monospace, monospace); color: inherit; background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 6px; }
.oi-palette-hex[aria-invalid="true"] { border-color: var(--oi-color-danger, #c00); }
.oi-palette-use, .oi-palette-none { height: 28px; padding: 0 10px; font: inherit; color: inherit; background: var(--oi-color-surface2, #eee); border: 1px solid var(--oi-color-border, #ccc); border-radius: 6px; cursor: pointer; }
.oi-palette-use:hover, .oi-palette-none:hover { border-color: var(--oi-color-accent, #b5452c); }
.oi-palette-none { justify-self: start; background: none; }
.oi-palette-empty { color: var(--oi-color-text-muted, #777); font-size: 12px; }
`;

const plusMark = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';

/** The menu itself (made when it opens; one is open at a time). */
export function createColorPicker(): ColorPicker {
	let element: HTMLElement | undefined;
	let cleanup: (() => void) | undefined;
	let editing = false;
	const close = (): void => {
		cleanup?.();
		cleanup = undefined;
		element?.remove();
		element = undefined;
		editing = false;
	};
	const open: ColorPicker['open'] = (option) => {
		close();
		if (!document.getElementById('oi-palette-style')) {
			const tag = document.createElement('style');
			tag.id = 'oi-palette-style';
			tag.textContent = style;
			document.head.append(tag);
		}
		const current = option.current ?? '';
		element = document.createElement('div');
		element.className = 'oi-palette';
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', option.title ?? 'Color');
		document.body.append(element);
		const menu = element;
		let typed = normalizeHex(current) ?? recentColorList()[0] ?? '#b5452c';

		const swatch = (color: string, css: string, title: string, remove?: string): string =>
			`<button type="button" class="oi-palette-swatch" data-color="${escapeHtml(color)}"${remove ? ` data-remove="${escapeHtml(remove)}"` : ''} style="--swatch: ${escapeHtml(css)}" title="${escapeHtml(editing && remove ? `Remove ${title}` : title)}" aria-label="${escapeHtml(editing && remove ? `Remove ${title}` : title)}" aria-pressed="${current.toLowerCase() === color.toLowerCase()}"></button>`;
		const draw = (): void => {
			const state = readPaletteState();
			const palette = state.list.find((item) => item.name === state.current);
			const recentList = recentColorList();
			menu.classList.toggle('oi-palette-editing', editing);
			menu.innerHTML =
				`<div class="oi-palette-head"><span class="oi-palette-title">${escapeHtml(option.title ?? 'Color')}</span><button type="button" class="oi-palette-link" data-action="Edit" aria-pressed="${editing}" title="Remove colors from the palette or the recent ones">${editing ? 'Done' : 'Edit'}</button></div>` +
				`<div><div class="oi-palette-label"><span>Theme</span></div><div class="oi-palette-row">${themeColorList.map((item) => swatch(item.name, `var(${item.variable})`, item.title)).join('')}</div></div>` +
				`<div><div class="oi-palette-label"><select aria-label="Palette">${state.list.map((item) => `<option${item.name === state.current ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>` +
				(editing && palette ? '<button type="button" class="oi-palette-link" data-action="DeletePalette" title="Delete this palette">Delete</button>' : '<button type="button" class="oi-palette-link" data-action="Import" title="A palette from a file: Adobe .ase, GIMP .gpl, or text with hex codes">Import</button>') +
				`</div><div class="oi-palette-row">${(palette?.colorList ?? []).map((hex) => swatch(hex, hex, hex, 'Palette')).join('')}` +
				(palette && !editing ? `<button type="button" class="oi-palette-add" data-action="AddColor" title="Add the color below to this palette" aria-label="Add the color below to this palette">${plusMark}</button>` : '') +
				'</div></div>' +
				(recentList.length > 0
					? `<div><div class="oi-palette-label"><span>Recent</span>${editing ? '<button type="button" class="oi-palette-link" data-action="ClearRecent">Clear</button>' : ''}</div><div class="oi-palette-row">${recentList.map((hex) => swatch(hex, hex, hex, 'Recent')).join('')}</div></div>`
					: '') +
				`<div class="oi-palette-custom"><input type="color" value="${typed}" aria-label="Pick any color"><input class="oi-palette-hex" value="${typed}" size="7" maxlength="7" spellcheck="false" aria-label="Hex code"><button type="button" class="oi-palette-use">Use</button></div>` +
				'<button type="button" class="oi-palette-none" data-color="">No color</button>';
			const picker = menu.querySelector<HTMLInputElement>('input[type="color"]')!;
			const text = menu.querySelector<HTMLInputElement>('.oi-palette-hex')!;
			picker.addEventListener('input', () => {
				text.value = picker.value;
				typed = picker.value;
				text.removeAttribute('aria-invalid');
			});
			// the browser's own picker closes with a change: that is the choice
			picker.addEventListener('change', () => pick(picker.value));
			text.addEventListener('input', () => {
				const hex = normalizeHex(text.value);
				text.toggleAttribute('aria-invalid', !hex && text.value.trim() !== '');
				if (hex) {
					picker.value = hex;
					typed = hex;
				}
			});
			text.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					useTyped();
				}
			});
			menu.querySelector('select')!.addEventListener('change', (event) => {
				writePaletteState({ ...readPaletteState(), current: (event.target as HTMLSelectElement).value });
				draw();
			});
		};
		const pick = (color: string | undefined): void => {
			const hex = color ? normalizeHex(color) : undefined;
			if (hex) rememberColor(hex);
			close();
			option.onPick(color === undefined || color === '' ? undefined : (hex ?? color));
		};
		const useTyped = (): void => {
			const text = menu.querySelector<HTMLInputElement>('.oi-palette-hex')!;
			const hex = normalizeHex(text.value);
			if (!hex) {
				text.setAttribute('aria-invalid', 'true');
				text.focus();
				return;
			}
			pick(hex);
		};
		const importFile = (): void => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.ase,.gpl,.txt,.hex,.css,.json,.csv,text/*';
			input.addEventListener('change', async () => {
				const file = input.files?.[0];
				if (!file) return;
				const colorList = /\.ase$/i.test(file.name) ? readAse(await file.arrayBuffer()) : readPaletteText(await file.text());
				if (colorList.length === 0) {
					window.alert(`No colors found in ${file.name}.`);
					return;
				}
				const state = readPaletteState();
				const name = freeName(file.name.replace(/\.[^.]+$/, ''), state.list);
				writePaletteState({ current: name, list: [...state.list, { name, colorList }] });
				if (element === menu) draw();
			});
			input.click();
		};
		menu.addEventListener('click', (event) => {
			const target = event.target as Element;
			const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
			const state = readPaletteState();
			if (action === 'Edit') {
				editing = !editing;
				draw();
				return;
			}
			if (action === 'Import') return importFile();
			if (action === 'AddColor') {
				const palette = state.list.find((item) => item.name === state.current);
				if (palette && !palette.colorList.includes(typed)) palette.colorList.push(typed);
				writePaletteState(state);
				draw();
				return;
			}
			if (action === 'DeletePalette') {
				const list = state.list.filter((item) => item.name !== state.current);
				writePaletteState({ current: list[0]?.name ?? '', list });
				draw();
				return;
			}
			if (action === 'ClearRecent') {
				forgetColor(undefined);
				draw();
				return;
			}
			if (target.closest('.oi-palette-use')) return useTyped();
			const button = target.closest<HTMLElement>('[data-color]');
			if (!button) return;
			// editing: a palette or recent color is taken away instead of chosen
			if (editing && button.dataset.remove) {
				const hex = button.dataset.color!;
				if (button.dataset.remove === 'Recent') forgetColor(hex);
				else {
					const palette = state.list.find((item) => item.name === state.current);
					if (palette) palette.colorList = palette.colorList.filter((item) => item !== hex);
					writePaletteState(state);
				}
				draw();
				return;
			}
			pick(button.dataset.color);
		});
		draw();
		// next to the point, kept inside the window
		const box = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(8, Math.min(option.x, window.innerWidth - box.width - 8))}px`;
		menu.style.top = `${option.y + box.height + 8 <= window.innerHeight ? option.y : Math.max(8, option.y - box.height - 8)}px`;
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			close();
		};
		const onDown = (event: PointerEvent): void => {
			if (element && !element.contains(event.target as Node)) close();
		};
		document.addEventListener('keydown', onKey, true);
		// after this click: the press that opened it must not close it
		const timer = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true));
		cleanup = () => {
			window.clearTimeout(timer);
			document.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onDown, true);
		};
		menu.querySelector<HTMLElement>('[aria-pressed="true"].oi-palette-swatch')?.focus();
	};
	return { open, close };
}

export const palettePlugin: PluginDefinition = {
	kind: 'Plugin',
	name: 'Palette',
	publisher: 'Octaether',
	version: '0.2.0',
	title: 'Palette',
	explain:
		'Colors for everything that colors (atoms, bonds, arrows, and text in the drawing tool; text colors), in one menu: the theme’s colors, a palette (Element and Basic to start; import Adobe .ase, GIMP .gpl, or any list of hex codes), the colors you used lately, and any color or hex code. Without it, nothing offers colors.',
	provide: ['ColorPicker'],
	activate(context) {
		const picker = createColorPicker();
		const remove = context.registerExtension<ColorPicker>(colorPickerExtension, picker);
		return () => {
			picker.close();
			remove();
		};
	},
};
