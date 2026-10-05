// Setting, Obsidian-style: sections on the left, details on the right. Every setting explains
// itself. Each module and plugin has its own page with its switch and its own settings.

import type { PropertyValue } from '@octaether/core-format';
import type { CommandRegistry } from '@octaether/core-edit';
import type { Registry, ThemeRegistry } from '@octaether/core-render';
import type { Definition, SettingDefinition, StatusItemDefinition } from '@octaether/core-sdk';
import { normalizeHex } from './color';
import { renderHotkeyEditor } from './hotkey-editor';
import type { SettingStore } from './setting-store';
import { isStatusItemOn } from './status-bar';
import { escapeHtml, openModal } from './ui';

export interface SettingModalOption {
	registry: Registry;
	themeRegistry: ThemeRegistry;
	setting: SettingStore;
	appSettingList: readonly SettingDefinition[];
	commandRegistry: CommandRegistry;
	chooseTheme(name: string): void;
	setEnabled(name: string, enabled: boolean): void;
	statusItemList(): StatusItemDefinition[];
	onHotkeyChange(): void;
	keyText(key: string): string;
	/** The color a Color setting shows while it is left at its default (the theme's accent…). */
	defaultColor(id: string): string;
	/** Where settings are saved, e.g. "this browser and Chemistry/.oi/Setting.oi". */
	storageText(): string;
	version: string;
	formatName: string;
}

export type SettingSection = 'Editor' | 'File' | 'Appearance' | 'Hotkey' | 'Module' | 'Plugin' | 'About';

const sectionList: readonly SettingSection[] = ['Editor', 'File', 'Appearance', 'Hotkey', 'Module', 'Plugin', 'About'];

function control(definition: SettingDefinition, value: PropertyValue | undefined, defaultColor: string): string {
	const label = escapeHtml(definition.title);
	if (definition.type === 'Toggle') return `<label class="switch"><input type="checkbox" data-setting="${definition.id}"${value === true ? ' checked' : ''} aria-label="${label}"><span></span></label>`;
	if (definition.type === 'Choice') {
		return `<select data-setting="${definition.id}" aria-label="${label}">${(definition.choiceList ?? []).map((choice) => `<option${choice === value ? ' selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select>`;
	}
	if (definition.type === 'Color') {
		const hex = typeof value === 'string' ? (normalizeHex(value) ?? '') : '';
		return (
			`<span class="color-control"><input type="color" data-color-pick="${definition.id}" value="${escapeHtml(hex || defaultColor)}" aria-label="Pick ${label}">` +
			`<input class="color-hex" data-setting="${definition.id}" value="${escapeHtml(hex)}" placeholder="Default" maxlength="7" spellcheck="false" aria-label="${label} (hex)">` +
			`<button type="button" class="setting-button" data-color-reset="${definition.id}" title="Back to the default"${hex ? '' : ' disabled'} aria-label="Back to the default">↺</button></span>`
		);
	}
	return `<input data-setting="${definition.id}" type="${definition.type === 'Number' ? 'number' : 'text'}" value="${escapeHtml(value === undefined || value === null ? '' : String(value))}" aria-label="${label}">`;
}

function settingRow(definition: SettingDefinition, value: PropertyValue | undefined, defaultColor: string): string {
	return `<div class="setting-row"><div class="setting-text"><div class="setting-name">${escapeHtml(definition.title)}</div><div class="setting-explain">${escapeHtml(definition.explain)}</div></div><div class="setting-control">${control(definition, value, defaultColor)}</div></div>`;
}

export function openSettingModal(option: SettingModalOption, start: SettingSection | `Module:${string}` = 'Editor'): void {
	openModal('setting-modal', (modal, close) => {
		modal.innerHTML = `<nav class="setting-nav" aria-label="Setting">${sectionList.map((name) => `<button type="button" data-section="${name}">${name}</button>`).join('')}</nav><section class="setting-body"></section><button type="button" class="modal-close" aria-label="Close">×</button>`;
		const body = modal.querySelector<HTMLElement>('.setting-body')!;
		modal.querySelector('.modal-close')!.addEventListener('click', close);
		let shown: SettingSection | `Module:${string}` = start;
		const row = (definition: SettingDefinition): string => settingRow(definition, option.setting.get(definition.id), option.defaultColor(definition.id));

		const bindSetting = (): void => {
			for (const field of body.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-setting]')) {
				field.addEventListener('change', () => {
					const id = field.dataset.setting!;
					const definition = option.setting.definition(id);
					let value: PropertyValue | undefined;
					if (field instanceof HTMLInputElement && field.type === 'checkbox') value = field.checked;
					else if (definition?.type === 'Number') value = Number(field.value);
					else if (definition?.type === 'Color') {
						// a hex code, or empty for the default; anything else goes back to what it was
						const hex = field.value.trim() === '' ? '' : normalizeHex(field.value);
						if (hex === undefined) {
							const saved = option.setting.get(id);
							field.value = typeof saved === 'string' ? saved : '';
							return;
						}
						value = hex === '' ? undefined : hex;
					} else value = field.value;
					option.setting.set(id, value);
					// a color shows its reset; an alias change may clash with another module's
					if (definition?.type === 'Color' || /\.Alias(?:Marker)?$/.test(id)) show(shown);
				});
			}
			for (const picker of body.querySelectorAll<HTMLInputElement>('[data-color-pick]')) {
				const id = picker.dataset.colorPick!;
				const hexField = body.querySelector<HTMLInputElement>(`.color-hex[data-setting="${id}"]`);
				// the color follows the picker live; the page settles when the picker closes
				picker.addEventListener('input', () => {
					if (hexField) hexField.value = picker.value;
					option.setting.set(id, picker.value);
				});
				picker.addEventListener('change', () => show(shown));
			}
			for (const button of body.querySelectorAll<HTMLButtonElement>('[data-color-reset]')) {
				button.addEventListener('click', () => {
					option.setting.set(button.dataset.colorReset!, undefined);
					show(shown);
				});
			}
		};

		/** A module's own settings, with the alias settings of its block types. */
		const ownSettingList = (definition: Definition): SettingDefinition[] =>
			option.registry
				.settingList()
				.filter((item) => item.owner === definition.name)
				.map((item) => item.setting);

		const definitionPage = (definition: Definition): string => {
			const enabled = option.registry.isEnabled(definition.name);
			const core = option.registry.isCore(definition);
			const settingList = ownSettingList(definition);
			const back = definition.kind === 'Module' ? 'Module' : 'Plugin';
			const problemList = option.registry.aliasState().problemList.filter((problem) => problem.name === definition.name);
			return (
				`<button type="button" class="setting-back" data-back="${back}">‹ ${back}</button>` +
				`<h2>${escapeHtml(definition.title)}</h2><p class="setting-explain">${escapeHtml(definition.explain)}</p>` +
				problemList.map((problem) => `<p class="setting-problem" role="alert">${escapeHtml(problem.message)}</p>`).join('') +
				`<div class="setting-row"><div class="setting-text"><div class="setting-name">On${core ? '<span class="setting-badge">always on</span>' : ''}</div><div class="setting-explain">${definition.kind === 'Module' ? 'Off: its blocks show their text in an outlined box, and nothing is lost.' : 'Off: the function goes away; its files stay.'}</div></div><div class="setting-control"><label class="switch"><input type="checkbox" data-name="${definition.name}"${enabled ? ' checked' : ''}${core ? ' disabled' : ''} aria-label="${escapeHtml(definition.title)} on"><span></span></label></div></div>` +
				(settingList.length ? settingList.map(row).join('') : '<p class="setting-explain">No setting of its own.</p>') +
				`<p class="setting-meta">${escapeHtml(definition.publisher)}.${escapeHtml(definition.name)} · version ${escapeHtml(definition.version)}</p>`
			);
		};

		const show = (name: SettingSection | `Module:${string}`): void => {
			const previous = shown;
			shown = name;
			const scroll = body.scrollTop;
			const section = name.startsWith('Module:') ? (option.registry.get(name.slice(7))?.kind === 'Plugin' ? 'Plugin' : 'Module') : (name as SettingSection);
			for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-section]')) button.classList.toggle('active', button.dataset.section === section);
			let html = '';
			if (name.startsWith('Module:')) {
				const definition = option.registry.get(name.slice(7));
				if (definition) html = definitionPage(definition);
			} else if (name === 'Editor' || name === 'File') {
				html = `<h2>${name}</h2>${option.appSettingList
					.filter((item) => item.id.startsWith(`${name}.`))
					.map(row)
					.join('')}<p class="setting-meta">Saved in ${escapeHtml(option.storageText())}.</p>`;
			} else if (name === 'Appearance') {
				const current = option.setting.get('Theme.Active') === 'System' ? 'System' : option.themeRegistry.current().name;
				const choiceList = ['System', ...option.themeRegistry.list().map((theme) => theme.name)];
				html =
					'<h2>Appearance</h2>' +
					`<div class="setting-row"><div class="setting-text"><div class="setting-name">Theme</div><div class="setting-explain">The color set every block uses. Match system follows your device's light or dark mode.</div></div><div class="setting-control"><select data-theme aria-label="Theme">${choiceList.map((item) => `<option value="${escapeHtml(item)}"${item === current ? ' selected' : ''}>${item === 'System' ? 'Match system' : escapeHtml(item)}</option>`).join('')}</select></div></div>` +
					option.appSettingList
						.filter((item) => item.id.startsWith('Appearance.'))
						.map(row)
						.join('') +
					'<h3>Status bar</h3><p class="setting-explain">What the bar at the bottom right shows. Modules and plugins can add their own items.</p>' +
					option
						.statusItemList()
						.map((item) => `<div class="setting-row"><div class="setting-text"><div class="setting-name">${escapeHtml(item.title)}</div><div class="setting-explain">${escapeHtml(item.id)}</div></div><div class="setting-control"><label class="switch"><input type="checkbox" data-status="${escapeHtml(item.id)}"${isStatusItemOn(option.setting, item.id) ? ' checked' : ''} aria-label="${escapeHtml(item.title)}"><span></span></label></div></div>`)
						.join('');
			} else if (name === 'Hotkey') {
				html = '<h2>Hotkey</h2><div class="hotkey-editor"></div>';
			} else if (name === 'Module' || name === 'Plugin') {
				html =
					`<h2>${name}</h2><p class="setting-explain">${name === 'Module' ? 'A module adds a kind of block. Switched off, its blocks keep their text in an outlined box and nothing is lost.' : 'A plugin adds a system function. Switched off, it goes away; its files stay.'} Open one for its settings.</p>` +
					option.registry
						.definitionList()
						.filter((definition) => definition.kind === name)
						.map((definition) => {
							const core = option.registry.isCore(definition);
							const count = ownSettingList(definition).length;
							return `<div class="setting-row"><button type="button" class="setting-text setting-open" data-open="${definition.name}"><div class="setting-name">${escapeHtml(definition.title)}${core ? '<span class="setting-badge">always on</span>' : ''}</div><div class="setting-explain">${escapeHtml(definition.explain)}</div>${count ? `<div class="setting-more">Setting (${count}) ›</div>` : ''}</button><div class="setting-control"><label class="switch"><input type="checkbox" data-name="${definition.name}"${option.registry.isEnabled(definition.name) ? ' checked' : ''}${core ? ' disabled' : ''} aria-label="${escapeHtml(definition.title)}"><span></span></label></div></div>`;
						})
						.join('');
			} else if (name === 'About') {
				html =
					'<h2>About</h2>' +
					`<p><b>Octaether Ink</b> (OI) ${escapeHtml(option.version)} · <a href="https://octaether.com" target="_blank" rel="noopener noreferrer">octaether.com</a> · MIT licence</p>` +
					`<p class="setting-explain">Notes are plain <code>.oi</code> text files (format “${escapeHtml(option.formatName)}”). Everything is a block; every block type comes from a module, every system function from a plugin. Settings and hotkeys are saved in ${escapeHtml(option.storageText())}.</p>` +
					`<p><a href="https://github.com/Octaether/OctaetherInk" target="_blank" rel="noopener noreferrer">GitHub repository</a> — browse the source code or report an issue.</p>`;
			}
			body.innerHTML = html;
			bindSetting();
			body.querySelector<HTMLSelectElement>('[data-theme]')?.addEventListener('change', (event) => {
				option.chooseTheme((event.target as HTMLSelectElement).value);
				show(shown);
			});
			for (const input of body.querySelectorAll<HTMLInputElement>('input[data-name]')) {
				input.addEventListener('change', () => {
					option.setEnabled(input.dataset.name!, input.checked);
					show(name);
				});
			}
			for (const input of body.querySelectorAll<HTMLInputElement>('input[data-status]')) input.addEventListener('change', () => option.setting.set(`Status.${input.dataset.status}`, input.checked));
			for (const button of body.querySelectorAll<HTMLButtonElement>('[data-open]')) button.addEventListener('click', () => show(`Module:${button.dataset.open}`));
			body.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', (event) => show((event.currentTarget as HTMLElement).dataset.back as SettingSection));
			const hotkey = body.querySelector<HTMLElement>('.hotkey-editor');
			if (hotkey) {
				renderHotkeyEditor(hotkey, {
					setting: option.setting,
					commandRegistry: option.commandRegistry,
					onChange: option.onHotkeyChange,
					themeList: () => option.themeRegistry.list().map((theme) => theme.name),
					settingList: () => [...option.appSettingList, ...option.registry.settingList().map((item) => item.setting)],
					keyText: option.keyText,
				});
			}
			// a page redrawn after a change keeps its place
			body.scrollTop = name === previous ? scroll : 0;
		};
		for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-section]')) button.addEventListener('click', () => show(button.dataset.section as SettingSection));
		show(start);
	});
}
