// Setting → Hotkey. Every command with its keys: click + and press the keys you want (like the
// controls screen of a game), × removes a key, ↺ puts the default back. Keys used twice turn red.
// Macros are your own commands: a list of steps (any command, e.g. "toggle a setting"), with
// hotkeys of their own. Everything is saved in the browser and in the vault's .oi/Hotkey.oi.

import { type CommandRegistry, eventChord, isApplePlatform, parseHotkey } from '@octaether/core-edit';
import type { SettingDefinition } from '@octaether/core-sdk';
import type { Macro, MacroStep, SettingStore } from './setting-store';
import { confirmDialog, escapeHtml, openModal } from './ui';

export interface HotkeyEditorOption {
	setting: SettingStore;
	commandRegistry: CommandRegistry;
	/** Keys or macros changed: bindings and macro commands are rebuilt. */
	onChange(): void;
	themeList(): string[];
	settingList(): SettingDefinition[];
	keyText(key: string): string;
}

/** Arguments some commands take, as a list to pick from. */
function argumentChoiceList(command: string, option: HotkeyEditorOption): { value: string; label: string }[] | undefined {
	if (command === 'Setting.Toggle') {
		return option
			.settingList()
			.filter((setting) => setting.type === 'Toggle' || setting.type === 'Choice')
			.map((setting) => ({ value: setting.id, label: `${setting.title} (${setting.id})` }));
	}
	if (command === 'Theme.Switch') return ['System', ...option.themeList()].map((name) => ({ value: name, label: name }));
	if (command === 'View.Set') return ['Source', 'Edit', 'Read'].map((name) => ({ value: name, label: name }));
	return undefined;
}

function pascalId(title: string): string {
	const word = title
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join('');
	return /^[A-Z]/.test(word) ? word : `Macro${word}`;
}

export function renderHotkeyEditor(container: HTMLElement, option: HotkeyEditorOption): void {
	let filter = '';
	let recording: { command: string; stop(): void } | undefined;

	const conflictMap = (): Map<string, string[]> => {
		const map = new Map<string, string[]>();
		for (const binding of option.setting.bindingList()) {
			const key = `${(parseHotkey(binding.key) ?? [binding.key]).join(' ')}|${binding.when ?? ''}`;
			map.set(key, [...(map.get(key) ?? []), binding.command]);
		}
		return map;
	};

	const render = (): void => {
		recording?.stop();
		recording = undefined;
		const conflict = conflictMap();
		const commandList = option.commandRegistry.list().filter((command) => {
			if (filter === '') return true;
			const keyText = option.setting.keyListOf(command.id).join(' ').toLowerCase();
			return `${command.title} ${command.id}`.toLowerCase().includes(filter) || keyText.includes(filter);
		});
		const macroList = option.setting.macroList();
		container.innerHTML =
			'<div class="hotkey-head"><input class="hotkey-search" placeholder="Filter by name or key" aria-label="Filter hotkeys" spellcheck="false"><button type="button" class="setting-button" data-action="ResetAll">Reset all to default</button></div>' +
			'<p class="setting-explain">Click <b>+</b> and press the keys you want; <kbd>Esc</kbd> cancels. Two chords in a row work too (<kbd>Ctrl+K</kbd> then <kbd>Ctrl+C</kbd>). A red key is used by more than one command. A browser tab can’t use a few keys the browser keeps for itself (<kbd>Ctrl+N</kbd>, <kbd>Ctrl+T</kbd>, <kbd>Ctrl+W</kbd>).</p>' +
			'<div class="macro-section"><div class="setting-subhead"><h3>Macro</h3><button type="button" class="setting-button" data-action="NewMacro">+ New macro</button></div>' +
			(macroList.length === 0
				? '<p class="setting-explain">A macro runs several commands in a row, or toggles a setting, from one key. It shows up below and in the command palette.</p>'
				: macroList
						.map(
							(macro) =>
								`<div class="macro-row"><div><b>${escapeHtml(macro.title)}</b><small>${escapeHtml(macro.stepList.map((step) => `${option.commandRegistry.get(step.command)?.title ?? step.command}${step.argument ? ` (${step.argument})` : ''}`).join(' → '))}</small></div><button type="button" class="setting-button" data-edit-macro="${escapeHtml(macro.id)}">Edit</button></div>`,
						)
						.join('')) +
			'</div>' +
			`<div class="hotkey-table">${commandList
				.map((command) => {
					const keyList = option.setting.keyListOf(command.id);
					const when = option.setting.defaultBindingList.find((binding) => binding.command === command.id)?.when ?? '';
					const chipList = keyList
						.map((key) => {
							const clash = (conflict.get(`${(parseHotkey(key) ?? [key]).join(' ')}|${when}`) ?? []).filter((other) => other !== command.id);
							return `<span class="key-chip${clash.length ? ' conflict' : ''}"${clash.length ? ` title="Also used by: ${escapeHtml(clash.map((other) => option.commandRegistry.get(other)?.title ?? other).join(', '))}"` : ''}><kbd>${escapeHtml(option.keyText(key))}</kbd><button type="button" data-remove-key="${escapeHtml(key)}" data-command="${escapeHtml(command.id)}" aria-label="Remove ${escapeHtml(option.keyText(key))}">×</button></span>`;
						})
						.join('');
					return (
						`<div class="hotkey-row"><div class="hotkey-command"><span>${escapeHtml(command.title)}</span><small>${escapeHtml(command.id)}</small></div>` +
						`<div class="hotkey-key-list">${chipList}<button type="button" class="key-add" data-record="${escapeHtml(command.id)}" title="Add a key" aria-label="Add a key for ${escapeHtml(command.title)}">+</button></div>` +
						`${option.setting.isCustomized(command.id) ? `<button type="button" class="key-reset" data-reset="${escapeHtml(command.id)}" title="Back to the default keys" aria-label="Back to the default keys">↺</button>` : '<span class="key-reset-space"></span>'}</div>`
					);
				})
				.join('')}</div>`;
		const search = container.querySelector<HTMLInputElement>('.hotkey-search')!;
		search.value = filter;
		search.addEventListener('input', () => {
			filter = search.value.trim().toLowerCase();
			const position = search.selectionStart;
			render();
			const next = container.querySelector<HTMLInputElement>('.hotkey-search')!;
			next.focus();
			next.setSelectionRange(position, position);
		});
		container.querySelector('[data-action="ResetAll"]')!.addEventListener('click', () => {
			void confirmDialog('Put every hotkey back to its default? (Macros stay.)', 'Reset all').then((ok) => {
				if (!ok) return;
				option.setting.resetAllKey();
				option.onChange();
				render();
			});
		});
		container.querySelector('[data-action="NewMacro"]')!.addEventListener('click', () => openMacroEditor(option, undefined, render));
		for (const button of container.querySelectorAll<HTMLButtonElement>('[data-edit-macro]')) {
			button.addEventListener('click', () => openMacroEditor(option, option.setting.macroList().find((macro) => macro.id === button.dataset.editMacro), render));
		}
		for (const button of container.querySelectorAll<HTMLButtonElement>('[data-remove-key]')) {
			button.addEventListener('click', () => {
				const command = button.dataset.command!;
				option.setting.setKeyList(command, option.setting.keyListOf(command).filter((key) => key !== button.dataset.removeKey));
				option.onChange();
				render();
			});
		}
		for (const button of container.querySelectorAll<HTMLButtonElement>('[data-reset]')) {
			button.addEventListener('click', () => {
				option.setting.setKeyList(button.dataset.reset!, undefined);
				option.onChange();
				render();
			});
		}
		for (const button of container.querySelectorAll<HTMLButtonElement>('[data-record]')) button.addEventListener('click', () => record(button));
	};

	/** Waits for a key (or two chords in a row) and adds it to the command. */
	const record = (button: HTMLButtonElement): void => {
		recording?.stop();
		const command = button.dataset.record!;
		const chordList: string[] = [];
		let timer: ReturnType<typeof setTimeout> | undefined;
		button.classList.add('recording');
		button.textContent = 'Press keys';
		const finish = (): void => {
			stop();
			if (chordList.length === 0) return;
			option.setting.setKeyList(command, [...option.setting.keyListOf(command), chordList.join(' ')]);
			option.onChange();
			render();
		};
		const onKey = (event: KeyboardEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Escape' && chordList.length === 0) {
				stop();
				render();
				return;
			}
			const chord = eventChord(event, isApplePlatform());
			if (!chord) return;
			chordList.push(chord);
			// a chord recorded, waiting for a possible second one
			button.textContent = `${chordList.map(option.keyText).join(' then ')} then`;
			clearTimeout(timer);
			if (chordList.length >= 2) finish();
			else timer = setTimeout(finish, 900);
		};
		const stop = (): void => {
			clearTimeout(timer);
			document.removeEventListener('keydown', onKey, true);
			recording = undefined;
		};
		document.addEventListener('keydown', onKey, true);
		recording = { command, stop };
	};

	render();
}

function openMacroEditor(option: HotkeyEditorOption, macro: Macro | undefined, after: () => void): void {
	const commandList = option.commandRegistry.list().filter((command) => !command.id.startsWith('Macro.'));
	let stepList: MacroStep[] = macro ? macro.stepList.map((step) => ({ ...step })) : [{ command: 'Setting.Toggle', argument: 'Code.LineNumber' }];
	openModal('macro-modal', (modal, close) => {
		const render = (): void => {
			modal.innerHTML =
				`<h2>${macro ? 'Edit macro' : 'New macro'}</h2>` +
				`<label class="macro-field">Name<input class="macro-title" value="${escapeHtml(macro?.title ?? '')}" placeholder="e.g. Lecture setup" spellcheck="false"></label>` +
				'<div class="macro-step-list">' +
				stepList
					.map((step, index) => {
						const choiceList = argumentChoiceList(step.command, option);
						const argument = choiceList
							? `<select data-argument="${index}" aria-label="What">${choiceList.map((choice) => `<option value="${escapeHtml(choice.value)}"${choice.value === step.argument ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}</select>`
							: `<input data-argument="${index}" value="${escapeHtml(step.argument ?? '')}" placeholder="(no value)" aria-label="Value" spellcheck="false">`;
						return `<div class="macro-step"><span class="macro-number">${index + 1}</span><select data-command="${index}" aria-label="Command">${commandList.map((command) => `<option value="${escapeHtml(command.id)}"${command.id === step.command ? ' selected' : ''}>${escapeHtml(command.title)}</option>`).join('')}</select>${argument}<button type="button" data-remove-step="${index}" aria-label="Remove step">×</button></div>`;
					})
					.join('') +
				'</div><button type="button" class="setting-button" data-action="AddStep">+ Add step</button>' +
				`<div class="dialog-row">${macro ? '<button type="button" class="dialog-button danger" data-action="Delete">Delete</button><span class="dialog-space"></span>' : ''}<button type="button" class="dialog-button" data-action="Cancel">Cancel</button><button type="button" class="dialog-button primary" data-action="Save">Save</button></div>`;
			const title = modal.querySelector<HTMLInputElement>('.macro-title')!;
			for (const select of modal.querySelectorAll<HTMLSelectElement>('[data-command]')) {
				select.addEventListener('change', () => {
					const index = Number(select.dataset.command);
					const choiceList = argumentChoiceList(select.value, option);
					stepList[index] = { command: select.value, ...(choiceList?.[0] ? { argument: choiceList[0].value } : {}) };
					const keep = title.value;
					render();
					modal.querySelector<HTMLInputElement>('.macro-title')!.value = keep;
				});
			}
			for (const field of modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-argument]')) {
				field.addEventListener('change', () => {
					const index = Number(field.dataset.argument);
					stepList[index] = { ...stepList[index]!, ...(field.value.trim() ? { argument: field.value.trim() } : { argument: undefined }) };
				});
			}
			for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-remove-step]')) {
				button.addEventListener('click', () => {
					const keep = title.value;
					stepList = stepList.filter((_, index) => index !== Number(button.dataset.removeStep));
					render();
					modal.querySelector<HTMLInputElement>('.macro-title')!.value = keep;
				});
			}
			modal.querySelector('[data-action="AddStep"]')!.addEventListener('click', () => {
				const keep = title.value;
				stepList.push({ command: commandList[0]?.id ?? 'Command.Palette' });
				render();
				modal.querySelector<HTMLInputElement>('.macro-title')!.value = keep;
			});
			modal.querySelector('[data-action="Cancel"]')!.addEventListener('click', close);
			modal.querySelector('[data-action="Delete"]')?.addEventListener('click', () => {
				if (!macro) return;
				option.setting.removeMacro(macro.id);
				option.onChange();
				close();
				after();
			});
			modal.querySelector('[data-action="Save"]')!.addEventListener('click', () => {
				const name = title.value.trim();
				if (name === '' || stepList.length === 0) {
					title.focus();
					return;
				}
				// argument fields may not have fired change yet
				for (const field of modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-argument]')) {
					const index = Number(field.dataset.argument);
					stepList[index] = { ...stepList[index]!, ...(field.value.trim() ? { argument: field.value.trim() } : {}) };
				}
				let id = macro?.id ?? `Macro.${pascalId(name)}`;
				if (!macro) for (let count = 2; option.commandRegistry.get(id) || option.setting.macroList().some((item) => item.id === id); count++) id = `Macro.${pascalId(name)}${count}`;
				option.setting.saveMacro({ id, title: name, stepList: stepList.map((step) => ({ command: step.command, ...(step.argument ? { argument: step.argument } : {}) })) });
				option.onChange();
				close();
				after();
			});
		};
		render();
		modal.querySelector<HTMLInputElement>('.macro-title')?.focus();
	});
}
