// The gradient picker: colors along a line, for what is colored by how much (a vector field's arrows
// by their strength), weakest on the left, strongest on the right. It works on what it colors as you
// go: each change shows at once (`onChange`), Done keeps it, Esc puts back what was there, and
// Undo and Redo (Ctrl+Z, Ctrl+Shift+Z, or your keys for them) step through the changes made while it is open.
//   the bar     the gradient; a click on it adds a color there
//   the colors  under the bar, each at its place: drag one along (its place shows in %), click it to
//               choose it and pick its color, or type its place; × takes it away (two stay)
//   yours       gradients you saved or imported (GIMP .ggr, SVG, CSS linear-gradient, or hex codes)
//   ready       gradients to start from; Reverse turns it around
// Any module asks for it through the `GradientPicker` extension, as for one color through `ColorPicker`.

import { type ColorPicker, type GradientPicker, type GradientStop, type HotkeyLookup, escapeHtml, gradientCssText, readGradient, t, tr, writeGradient } from '@octaether/core-sdk';

export const gradientStyle = `
.oi-gradient { width: 300px; }
.oi-gradient-bar { position: relative; height: 26px; border-radius: 7px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); cursor: copy; }
.oi-gradient-end { display: flex; justify-content: space-between; margin-top: 3px; font-size: 11px; color: var(--oi-color-text-muted, #777); }
.oi-gradient-track { position: relative; height: 44px; margin: 0 11px; }
.oi-gradient-stop { position: absolute; top: 6px; display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); touch-action: none; }
.oi-gradient-stop::before { content: ''; width: 0; height: 0; margin-bottom: 1px; border: 5px solid transparent; border-top: 0; border-bottom: 6px solid var(--oi-color-text-muted, #777); }
.oi-gradient-stop[aria-current="true"]::before { border-bottom-color: var(--oi-color-text, #222); }
.oi-gradient-stop .oi-palette-swatch { width: 22px; height: 22px; cursor: grab; }
.oi-gradient-stop[aria-current="true"] .oi-palette-swatch { box-shadow: 0 0 0 2px var(--oi-color-background, #fff), 0 0 0 3.5px var(--oi-color-text, #222); }
.oi-gradient-stop.oi-gradient-moving .oi-palette-swatch { cursor: grabbing; transform: scale(1.12); }
.oi-gradient-pct { position: absolute; top: 34px; font-size: 10.5px; line-height: 1; color: var(--oi-color-text-muted, #777); white-space: nowrap; font-variant-numeric: tabular-nums; opacity: 0; pointer-events: none; }
.oi-gradient-stop:hover .oi-gradient-pct, .oi-gradient-stop[aria-current="true"] .oi-gradient-pct, .oi-gradient-moving .oi-gradient-pct { opacity: 1; }
.oi-gradient-moving .oi-gradient-pct { color: var(--oi-color-text, #222); font-weight: 600; }
.oi-gradient-place { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--oi-color-text-muted, #777); }
.oi-gradient-place .oi-palette-swatch { width: 18px; height: 18px; }
.oi-gradient-place input { width: 54px; height: 24px; padding: 0 6px; box-sizing: border-box; font: inherit; color: var(--oi-color-text, #222); background: var(--oi-color-surface1, #f4f4f4); border: 1px solid var(--oi-color-border, #ccc); border-radius: 6px; text-align: right; }
.oi-gradient-place .oi-palette-link { margin-inline-start: auto; }
.oi-gradient-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.oi-gradient-item { position: relative; }
.oi-gradient-item > button:first-child { width: 100%; height: 18px; padding: 0; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 5px; cursor: pointer; }
.oi-gradient-item > button:first-child:hover { transform: scale(1.04); }
.oi-gradient-forget { position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; display: grid; place-items: center; padding: 0; font-size: 9px; line-height: 1; color: var(--oi-color-background, #fff); background: var(--oi-color-text, #222); border: 0; border-radius: 50%; cursor: pointer; opacity: 0; }
.oi-gradient-item:hover .oi-gradient-forget, .oi-gradient-forget:focus-visible { opacity: 1; }
.oi-gradient-foot { display: flex; gap: 6px; align-items: center; }
`;

/** Ready gradients: from weak to strong. */
const readyList: readonly { name: string; stopList: readonly string[] }[] = [
	{ name: 'Blue to red', stopList: ['#3b6fd8', '#d8443b'] },
	{ name: 'Viridis', stopList: ['#440154', '#21918c', '#fde725'] },
	{ name: 'Magma', stopList: ['#000004', '#b63679', '#fcfdbf'] },
	{ name: 'Green, orange, red', stopList: ['Success', 'Warning', 'Danger'] },
	{ name: 'Muted to accent', stopList: ['TextMuted', 'Accent'] },
	{ name: 'Ice to fire', stopList: ['#2c7bb6', '#ffffbf', '#d7191c'] },
];

const maxStop = 8;
const storageName = 'OctaetherInk.Gradient';

export interface SavedGradient {
	name: string;
	stopList: string[];
}

/** Your gradients, kept in this browser (as palettes are). */
export function readSavedGradient(): SavedGradient[] {
	try {
		const data = JSON.parse(localStorage.getItem(storageName) ?? '[]') as unknown;
		return Array.isArray(data) ? data.filter((item): item is SavedGradient => typeof item?.name === 'string' && Array.isArray(item.stopList) && item.stopList.length >= 2).map((item) => ({ name: item.name, stopList: item.stopList.map(String) })) : [];
	} catch {
		return [];
	}
}

function writeSavedGradient(list: readonly SavedGradient[]): void {
	try {
		localStorage.setItem(storageName, JSON.stringify(list));
	} catch {
		// a private window keeps nothing: the gradient still works now
	}
}

const hex = (value: number): string =>
	Math.round(Math.max(0, Math.min(1, value)) * 255)
		.toString(16)
		.padStart(2, '0');

/**
 * The gradients in a file: GIMP's .ggr, SVG `<linearGradient>`s, CSS `linear-gradient(…)`s, or text
 * with hex codes (a line with two or more is a gradient; one per line, the file is one).
 */
export function readGradientFile(fileName: string, text: string): SavedGradient[] {
	const base = fileName.replace(/\.[^.]+$/, '') || t('Imported');
	const list: SavedGradient[] = [];
	if (/^GIMP Gradient/.test(text.trim())) {
		const lineList = text.split(/\r?\n/).map((line) => line.trim());
		const name = /^Name:\s*(.+)$/m.exec(text)?.[1]?.trim() || base;
		const stopList: GradientStop[] = [];
		for (const line of lineList) {
			const value = line.split(/\s+/).map(Number);
			if (value.length < 11 || value.some((item, index) => index < 11 && !Number.isFinite(item))) continue;
			const [left, , right, r0, g0, b0, , r1, g1, b1] = value as [number, number, number, number, number, number, number, number, number, number];
			const first = { color: `#${hex(r0)}${hex(g0)}${hex(b0)}`, at: left };
			const last = stopList.at(-1);
			if (!last || last.color !== first.color || Math.abs(last.at - first.at) > 1e-6) stopList.push(first);
			stopList.push({ color: `#${hex(r1)}${hex(g1)}${hex(b1)}`, at: right });
		}
		if (stopList.length >= 2) list.push({ name, stopList: writeGradient(stopList.slice(0, maxStop)) });
		return list;
	}
	if (/<linearGradient/i.test(text)) {
		for (const match of text.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi)) {
			const id = /\bid="([^"]+)"/.exec(match[1]!)?.[1];
			const stopList: GradientStop[] = [];
			for (const stop of match[2]!.matchAll(/<stop\b([^>]*)\/?>/gi)) {
				const attribute = stop[1]!;
				const offset = /\boffset="([^"]+)"/.exec(attribute)?.[1] ?? '0';
				const color = /\bstop-color="([^"]+)"/.exec(attribute)?.[1] ?? /stop-color:\s*([^;"]+)/.exec(attribute)?.[1];
				if (!color) continue;
				stopList.push({ color: color.trim(), at: offset.endsWith('%') ? Number.parseFloat(offset) / 100 : Number.parseFloat(offset) });
			}
			if (stopList.length >= 2) list.push({ name: id || `${base} ${list.length + 1}`, stopList: writeGradient(stopList.slice(0, maxStop)) });
		}
		return list;
	}
	if (/linear-gradient\(/i.test(text)) {
		for (const match of text.matchAll(/linear-gradient\(((?:[^()]|\([^()]*\))*)\)/gi)) {
			const partList: string[] = [];
			let depth = 0;
			let part = '';
			for (const character of match[1]!) {
				if (character === '(') depth++;
				if (character === ')') depth--;
				if (character === ',' && depth === 0) {
					partList.push(part.trim());
					part = '';
				} else part += character;
			}
			partList.push(part.trim());
			const colorList = partList.filter((item) => !/^(?:to\s|-?[\d.]+(?:deg|turn|rad))/i.test(item)).map((item) => item.replace(/\s+/g, ' '));
			if (colorList.length >= 2) list.push({ name: `${base}${list.length ? ` ${list.length + 1}` : ''}`, stopList: writeGradient(readGradient(colorList).slice(0, maxStop)) });
		}
		return list;
	}
	const lineList = text.split(/\r?\n/).map((line) => line.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi) ?? []);
	const many = lineList.filter((line) => line.length >= 2);
	if (many.length > 0) many.forEach((line, index) => list.push({ name: many.length > 1 ? `${base} ${index + 1}` : base, stopList: line.slice(0, maxStop) }));
	else {
		const all = lineList.flat();
		if (all.length >= 2) list.push({ name: base, stopList: all.slice(0, maxStop) });
	}
	return list;
}

export function createGradientPicker(colorPicker: () => ColorPicker | undefined, cssOf: (color: string) => string, style: string, hotkey?: () => HotkeyLookup | undefined): GradientPicker {
	let element: HTMLElement | undefined;
	let cleanup: (() => void) | undefined;
	const close = (): void => {
		cleanup?.();
		cleanup = undefined;
		element?.remove();
		element = undefined;
		colorPicker()?.close();
	};
	const open: GradientPicker['open'] = (option) => {
		close();
		for (const [id, text] of [
			['oi-palette-style', style],
			['oi-gradient-style', gradientStyle],
		] as const) {
			if (document.getElementById(id)) continue;
			const tag = document.createElement('style');
			tag.id = id;
			tag.textContent = text;
			document.head.append(tag);
		}
		const original = option.current && option.current.length >= 2 ? [...option.current] : undefined;
		let stopList: GradientStop[] = readGradient(original ?? ['#3b6fd8', '#d8443b']);
		let selected = 0;
		let changed = false;
		const past: GradientStop[][] = [];
		const future: GradientStop[][] = [];
		const copy = (list: readonly GradientStop[]): GradientStop[] => list.map((stop) => ({ ...stop }));
		const menu = document.createElement('div');
		menu.className = 'oi-palette oi-gradient';
		menu.setAttribute('role', 'dialog');
		menu.setAttribute('aria-label', option.title ?? t('Gradient'));
		document.body.append(menu);
		element = menu;
		const percent = (at: number): string => `${Math.round(at * 100)}%`;
		const listHtml = (list: readonly SavedGradient[] | readonly { name: string; stopList: readonly string[] }[], kind: 'ready' | 'mine'): string =>
			list
				.map(
					(item, index) =>
						`<span class="oi-gradient-item"><button type="button" data-${kind}="${index}" style="background: ${escapeHtml(gradientCssText(readGradient(item.stopList), cssOf))}" title="${escapeHtml(kind === 'ready' ? t(item.name) : item.name)}" aria-label="${escapeHtml(kind === 'ready' ? t(item.name) : item.name)}"></button>${kind === 'mine' ? `<button type="button" class="oi-gradient-forget" data-forget="${index}" title="${escapeHtml(t('Remove'))}" aria-label="${escapeHtml(tr`Remove ${item.name}`)}">×</button>` : ''}</span>`,
				)
				.join('');

		const draw = (): void => {
			const savedList = readSavedGradient();
			const current = stopList[selected];
			const focus = document.activeElement instanceof HTMLInputElement && menu.contains(document.activeElement) ? document.activeElement.dataset.field : undefined;
			menu.innerHTML =
				`<div class="oi-palette-head"><span class="oi-palette-title">${escapeHtml(option.title ?? t('Gradient'))}</span></div>` +
				`<div><div class="oi-gradient-bar" data-bar style="background: ${escapeHtml(gradientCssText(stopList, cssOf))}" title="${escapeHtml(stopList.length < maxStop ? t('Click to add a color here') : '')}"></div>` +
				`<div class="oi-gradient-end"><span>${escapeHtml(option.lowTitle ?? t('Low'))}</span><span>${escapeHtml(option.highTitle ?? t('High'))}</span></div></div>` +
				`<div class="oi-gradient-track">${stopList
					.map(
						(stop, index) =>
							`<span class="oi-gradient-stop" data-handle="${index}" style="left: ${(stop.at * 100).toFixed(2)}%"${index === selected ? ' aria-current="true"' : ''}><button type="button" class="oi-palette-swatch" data-stop="${index}" style="--swatch: ${escapeHtml(cssOf(stop.color))}" title="${escapeHtml(tr`${stop.color} at ${percent(stop.at)}. Drag to move it, click to pick its color`)}" aria-label="${escapeHtml(tr`Color ${index + 1}: ${stop.color} at ${percent(stop.at)}`)}"></button><span class="oi-gradient-pct">${percent(stop.at)}</span></span>`,
					)
					.join('')}</div>` +
				(current
					? `<div class="oi-gradient-place"><button type="button" class="oi-palette-swatch" data-stop="${selected}" style="--swatch: ${escapeHtml(cssOf(current.color))}" title="${escapeHtml(t('Pick its color'))}" aria-label="${escapeHtml(t('Pick its color'))}"></button><span>${escapeHtml(tr`Color ${selected + 1} at`)}</span><input type="number" min="0" max="100" step="1" data-field="place" value="${Math.round(current.at * 100)}" aria-label="${escapeHtml(t('Its place, in percent'))}"><span>%</span>${stopList.length > 2 ? `<button type="button" class="oi-palette-link" data-action="RemoveStop">${escapeHtml(t('Remove'))}</button>` : ''}</div>`
					: '') +
				`<div><div class="oi-palette-label"><span>${escapeHtml(t('Yours'))}</span><button type="button" class="oi-palette-link" data-action="Save" title="${escapeHtml(t('Keep this gradient to use again'))}">${escapeHtml(t('Save'))}</button><button type="button" class="oi-palette-link" data-action="Import" title="${escapeHtml(t('Gradients from a file: GIMP .ggr, SVG, CSS linear-gradient, or hex codes'))}">${escapeHtml(t('Import'))}</button></div>` +
				(savedList.length ? `<div class="oi-gradient-list">${listHtml(savedList, 'mine')}</div>` : `<div class="oi-palette-empty">${escapeHtml(t('Save or import gradients to use them again.'))}</div>`) +
				'</div>' +
				`<div><div class="oi-palette-label"><span>${escapeHtml(t('Ready'))}</span><button type="button" class="oi-palette-link" data-action="Reverse" title="${escapeHtml(t('Strong colors become weak ones'))}">${escapeHtml(t('Reverse'))}</button></div><div class="oi-gradient-list">${listHtml(readyList, 'ready')}</div></div>` +
				`<div class="oi-gradient-foot"><button type="button" class="oi-palette-use" data-action="Done">${escapeHtml(t('Done'))}</button><button type="button" class="oi-palette-none" data-action="None">${escapeHtml(option.noneTitle ?? t('No gradient'))}</button></div>`;
			if (focus) menu.querySelector<HTMLInputElement>(`[data-field="${focus}"]`)?.focus();
		};

		/** What it colors shows the gradient as it is now. */
		const show = (): void => {
			option.onChange?.(writeGradient(stopList));
		};
		/** A change: kept for Ctrl+Z, shown at once. `keepPast`: part of a change already kept (a drag). */
		const change = (next: GradientStop[], keepPast = false): void => {
			if (!keepPast) {
				past.push(copy(stopList));
				future.length = 0;
			}
			changed = true;
			const chosen = next[selected];
			stopList = next.sort((left, right) => left.at - right.at);
			selected = chosen ? stopList.indexOf(chosen) : Math.min(selected, stopList.length - 1);
			draw();
			show();
		};
		const step = (back: boolean): void => {
			const from = back ? past : future;
			const to = back ? future : past;
			const state = from.pop();
			if (!state) return;
			to.push(copy(stopList));
			stopList = state;
			selected = Math.min(selected, stopList.length - 1);
			changed = true;
			draw();
			show();
		};
		const finish = (list: string[] | undefined): void => {
			close();
			option.onPick(list);
		};
		const pickColor = (index: number): void => {
			const swatch = menu.querySelector<HTMLElement>(`.oi-gradient-place [data-stop]`) ?? menu.querySelector<HTMLElement>(`[data-stop="${index}"]`);
			const box = (swatch ?? menu).getBoundingClientRect();
			const stop = stopList[index];
			if (!stop) return;
			colorPicker()?.open({
				x: box.left,
				y: box.bottom + 6,
				current: stop.color,
				title: tr`Color ${index + 1}`,
				none: false,
				onPick: (color) => {
					if (!color || element !== menu) return;
					const next = copy(stopList);
					next[index]!.color = color;
					change(next);
				},
			});
		};
		const importFile = (): void => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.ggr,.svg,.css,.txt,.json,.hex,text/*,image/svg+xml';
			input.addEventListener('change', async () => {
				const file = input.files?.[0];
				if (!file) return;
				const found = readGradientFile(file.name, await file.text());
				if (found.length === 0) {
					window.alert(tr`No gradient found in ${file.name}.`);
					return;
				}
				const list = readSavedGradient();
				for (const item of found) {
					let name = item.name;
					for (let number = 2; list.some((other) => other.name === name); number++) name = `${item.name} ${number}`;
					list.push({ name, stopList: item.stopList });
				}
				writeSavedGradient(list);
				// the first one found is the gradient now
				if (element === menu) change(readGradient(found[0]!.stopList));
			});
			input.click();
		};

		menu.addEventListener('click', (event) => {
			const target = event.target as Element;
			const stop = target.closest<HTMLElement>('[data-stop]');
			if (stop) {
				if (stop.dataset.dragged === 'true') return;
				const index = Number(stop.dataset.stop);
				// in the track: choose it first; its swatch in the row below (or a second click) picks its color
				if (stop.closest('.oi-gradient-track') && index !== selected) {
					selected = index;
					draw();
				}
				pickColor(index);
				return;
			}
			const bar = target.closest<HTMLElement>('[data-bar]');
			if (bar && stopList.length < maxStop) {
				// a new color where the bar was clicked, starting as the one on its left; then pick it
				const box = bar.getBoundingClientRect();
				const at = Math.max(0, Math.min(1, ((event as MouseEvent).clientX - box.left) / box.width));
				const left = [...stopList].reverse().find((item) => item.at <= at) ?? stopList[0]!;
				const added = { color: left.color, at };
				const next = [...copy(stopList), added];
				selected = -1;
				change(next);
				selected = stopList.findIndex((item) => item.at === at && item.color === left.color);
				draw();
				pickColor(selected);
				return;
			}
			const ready = target.closest<HTMLElement>('[data-ready]');
			if (ready) {
				selected = 0;
				change(readGradient(readyList[Number(ready.dataset.ready)]!.stopList));
				return;
			}
			const forget = target.closest<HTMLElement>('[data-forget]');
			if (forget) {
				writeSavedGradient(readSavedGradient().filter((_, index) => index !== Number(forget.dataset.forget)));
				draw();
				return;
			}
			const mine = target.closest<HTMLElement>('[data-mine]');
			if (mine) {
				const item = readSavedGradient()[Number(mine.dataset.mine)];
				if (item) {
					selected = 0;
					change(readGradient(item.stopList));
				}
				return;
			}
			const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
			if (action === 'Reverse') change(copy(stopList).map((item) => ({ color: item.color, at: 1 - item.at })));
			else if (action === 'RemoveStop' && stopList.length > 2) {
				const next = copy(stopList).filter((_, index) => index !== selected);
				selected = Math.max(0, selected - 1);
				change(next);
			} else if (action === 'Save') {
				const list = readSavedGradient();
				let name = t('My gradient');
				for (let number = 2; list.some((item) => item.name === name); number++) name = `${t('My gradient')} ${number}`;
				writeSavedGradient([...list, { name, stopList: writeGradient(stopList) }]);
				draw();
			} else if (action === 'Import') importFile();
			else if (action === 'Done') finish(writeGradient(stopList));
			else if (action === 'None') finish(undefined);
		});
		menu.addEventListener('change', (event) => {
			const input = event.target as HTMLInputElement;
			if (input.dataset.field !== 'place' || !stopList[selected]) return;
			const value = Number(input.value);
			if (!Number.isFinite(value)) return;
			const next = copy(stopList);
			next[selected]!.at = Math.max(0, Math.min(100, value)) / 100;
			const chosen = next[selected];
			change(next);
			selected = stopList.findIndex((item) => item.at === chosen!.at && item.color === chosen!.color);
			draw();
		});
		// a color dragged along the track: anywhere from 0% to 100%, its place showing as it goes
		menu.addEventListener('pointerdown', (event) => {
			const handle = (event.target as Element).closest<HTMLElement>('[data-handle]');
			if (!handle || event.button !== 0) return;
			const index = Number(handle.dataset.handle);
			const dragged = stopList[index]!;
			const startX = event.clientX;
			let moved = false;
			const onMove = (moveEvent: PointerEvent): void => {
				if (!moved && Math.abs(moveEvent.clientX - startX) < 3) return;
				// the track as drawn now (each move draws it again)
				const box = menu.querySelector<HTMLElement>('.oi-gradient-track')!.getBoundingClientRect();
				const at = Math.round(Math.max(0, Math.min(1, (moveEvent.clientX - box.left) / box.width)) * 1000) / 1000;
				const next = copy(stopList);
				const place = stopList.indexOf(dragged);
				next[place]!.at = at;
				selected = place;
				// the first move is kept for Ctrl+Z; the rest are part of it
				change(next, moved);
				moved = true;
				const now = menu.querySelector<HTMLElement>(`[data-handle="${selected}"]`);
				now?.classList.add('oi-gradient-moving');
				// the same stop, followed across a redraw
				Object.assign(dragged, stopList[selected]);
				stopList[selected] = dragged;
			};
			const onUp = (): void => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				if (!moved) return;
				menu.querySelector<HTMLElement>('.oi-gradient-moving')?.classList.remove('oi-gradient-moving');
				// the click after a drag isn't a click on the color
				const swatch = menu.querySelector<HTMLElement>(`[data-handle="${selected}"] [data-stop]`);
				if (swatch) swatch.dataset.dragged = 'true';
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});
		draw();
		const box = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(8, Math.min(option.x, window.innerWidth - box.width - 8))}px`;
		menu.style.top = `${option.y + box.height + 8 <= window.innerHeight ? option.y : Math.max(8, option.y - box.height - 8)}px`;
		const onKey = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement;
			const typing = target.isContentEditable || (target instanceof HTMLInputElement && target.type !== 'number') || target instanceof HTMLTextAreaElement;
			// Undo / Redo (your keys for them in Setting → Hotkey): the changes made in it, one by one (not while typing elsewhere)
			const lookup = hotkey?.();
			const command = lookup ? lookup.commandFor(event, 'GlobalUndo') : (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z' ? (event.shiftKey ? 'Edit.Redo' : 'Edit.Undo') : undefined;
			if ((command === 'Edit.Undo' || command === 'Edit.Redo') && !(typing && !menu.contains(target))) {
				event.preventDefault();
				event.stopPropagation();
				step(command === 'Edit.Undo');
				return;
			}
			// Esc closes the color picker over it first; then puts back what was there
			if (event.key !== 'Escape' || document.querySelector('.oi-palette:not(.oi-gradient)')) return;
			event.preventDefault();
			event.stopPropagation();
			close();
			if (changed) option.onChange?.(original ? [...original] : undefined);
		};
		const onDown = (event: PointerEvent): void => {
			// the color picker for a color sits beside it: a click there is still choosing. Outside: what was changed is kept, as Done
			if (!element || element.contains(event.target as Node) || (event.target as Element).closest?.('.oi-palette')) return;
			if (changed) finish(writeGradient(stopList));
			else close();
		};
		document.addEventListener('keydown', onKey, true);
		const timer = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true));
		cleanup = () => {
			window.clearTimeout(timer);
			document.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onDown, true);
		};
	};
	return { open, close };
}
