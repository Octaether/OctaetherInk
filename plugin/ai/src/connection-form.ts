// The connection, on the AI's page in Setting: the provider, your key, the model, and the effort. A
// key once saved is never shown again, only its last four characters; Change types a new one.

import { type HostContext, type PopupMenu, comboField, escapeHtml, menuExtension, t } from '@octaether/core-sdk';
import { type Connection, type Effort, connectionOf, currentConnection, currentProvider, effortList, effortTitle, forgetConnection, isReady, modelTitle, providerList, providerOf, saveConnection, updateConnection } from './connection';
import { mark } from './composer';
import { ProviderError, listModel } from './provider';

export function mountConnectionForm(context: HostContext, element: HTMLElement, option: { fetch?: typeof fetch } = {}): () => void {
	const menu = (): PopupMenu | undefined => context.extension<PopupMenu>(menuExtension);
	let providerName = currentProvider();
	let changingKey = false;
	let message = '';
	let problem = false;
	let effort: Effort = connectionOf(providerName).effort ?? 'Default';
	let stopCombo: (() => void) | undefined;
	let closed = false;
	element.classList.add('oi-ai-connection');

	const say = (text: string, isProblem = false): void => {
		message = text;
		problem = isProblem;
		const status = element.querySelector<HTMLElement>('.oi-ai-status');
		if (!status) return;
		status.textContent = text;
		if (isProblem) status.dataset.kind = 'Problem';
		else delete status.dataset.kind;
	};

	/** The provider the form was drawn for: what is typed for it lives through a redraw (an effort chosen). */
	let drawnProvider = '';

	/** Draws the form; `keepTyped` keeps what is typed and not saved yet (false after Save, Forget, another provider). */
	const draw = (keepTyped = true): void => {
		stopCombo?.();
		const typed = keepTyped && drawnProvider === providerName ? { key: field('oi-ai-key')?.value, model: field('oi-ai-model')?.value, address: field('oi-ai-address')?.value } : undefined;
		drawnProvider = providerName;
		const provider = providerOf(providerName);
		const kept = connectionOf(provider.name);
		const addressed = provider.local === true || provider.custom === true;
		const inUse = currentConnection()?.provider === provider.name;
		const showKey = changingKey || kept.key === '';
		element.innerHTML =
			'<div class="oi-ai-form">' +
			`<label>${t('Provider')}</label><div class="oi-ai-field"><button type="button" class="oi-ai-pick" data-action="Provider">${escapeHtml(provider.title)}${mark.Chevron}</button>${inUse ? `<span class="oi-ai-tag">${escapeHtml(t('In use'))}</span>` : ''}</div>` +
			(addressed ? `<label for="oi-ai-address">${t('Address')}</label><div class="oi-ai-field"><input id="oi-ai-address" value="${escapeHtml(kept.baseUrl)}" placeholder="https://example.com/v1" spellcheck="false" autocomplete="off"></div>` : '') +
			`<label for="oi-ai-key">${provider.local ? t('Key (if it asks for one)') : t('API key')}</label><div class="oi-ai-field">${
				showKey
					? `<input id="oi-ai-key" type="password" value="" placeholder="${escapeHtml(kept.key ? t('A new key') : t('Paste your key'))}" spellcheck="false" autocomplete="off" data-1p-ignore data-lpignore="true">${kept.key ? `<button type="button" class="oi-ai-button" data-action="KeepKey">${t('Cancel')}</button>` : ''}`
					: `<span class="oi-ai-key-saved">${escapeHtml(t('Saved'))} <code>••••${escapeHtml(kept.key.slice(-4))}</code></span><button type="button" class="oi-ai-button" data-action="ChangeKey">${t('Change')}</button>`
			}${provider.keyUrl ? `<a href="${escapeHtml(provider.keyUrl)}" target="_blank" rel="noopener noreferrer">${t('Get a key')}</a>` : ''}</div>` +
			`<label for="oi-ai-model">${t('Model')}</label><div class="oi-ai-field"><input id="oi-ai-model" value="${escapeHtml(kept.model)}" placeholder="${t('Choose from the list, or type its name')}" spellcheck="false" autocomplete="off"><button type="button" class="oi-ai-button" data-action="Model" title="${t('Asks the provider which models this key can use; also a test that the key works')}">${t('List models')}</button></div>` +
			`<label>${t('Effort')}</label><div class="oi-ai-field"><button type="button" class="oi-ai-pick" data-action="Effort">${escapeHtml(t(effortTitle[effort]))}${mark.Chevron}</button><span class="oi-ai-hint">${escapeHtml(t('How long the model thinks before it answers. Default: the model’s own.'))}</span></div>` +
			`<p class="oi-ai-note">${escapeHtml(
				provider.local
					? t('The model runs on this computer, so nothing you write leaves it.')
					: t('Your key is kept in this browser only: never in a note, a vault, or a setting file. Requests go straight from this device to the provider, with the note you ask about; Octaether has no server in between and sees nothing. The provider bills your key, so give it a spending limit.'),
			)}${provider.note ? ` ${escapeHtml(t(provider.note))}` : ''}</p>` +
			'</div>' +
			`<div class="oi-ai-status" role="status"${problem ? ' data-kind="Problem"' : ''}>${escapeHtml(message)}</div>` +
			`<div class="oi-ai-row"><button type="button" class="oi-ai-button oi-ai-primary" data-action="Save">${t(inUse ? 'Save' : 'Save and use')}</button><span class="oi-ai-space"></span><button type="button" class="oi-ai-button oi-ai-danger" data-action="Forget" title="${t('Removes this provider’s key and model from this browser')}"${kept.key || kept.model !== provider.model ? '' : ' disabled'}>${t('Forget')}</button></div>`;
		const modelField = field('oi-ai-model')!;
		if (typed?.model !== undefined) modelField.value = typed.model;
		if (typed?.key !== undefined && field('oi-ai-key')) field('oi-ai-key')!.value = typed.key;
		if (typed?.address !== undefined && field('oi-ai-address')) field('oi-ai-address')!.value = typed.address;
		stopCombo = comboField(menu(), modelField, {
			openOnFocus: true,
			itemList: () => (connectionOf(provider.name).modelList ?? []).map((item) => ({ title: item.id, ...(item.title !== item.id ? { hint: modelTitle({ model: item.id, modelList: [item] }) } : {}) })),
			onPick: (model) => {
				modelField.value = model;
			},
		});
		field('oi-ai-key')?.addEventListener('change', () => {
			if (modelField.value.trim() === '' && field('oi-ai-key')!.value.trim() !== '') void loadModel();
		});
	};

	const field = (id: string): HTMLInputElement | null => element.querySelector<HTMLInputElement>(`#${id}`);

	const read = (): Connection => {
		const provider = providerOf(providerName);
		const kept = connectionOf(provider.name);
		const model = field('oi-ai-model')!.value.trim();
		const typedKey = field('oi-ai-key')?.value.trim();
		const listed = kept.modelList?.find((item) => item.id === model);
		return {
			...kept,
			provider: provider.name,
			key: typedKey === undefined || typedKey === '' ? kept.key : typedKey,
			model,
			baseUrl: (field('oi-ai-address')?.value ?? provider.baseUrl).trim(),
			effort,
			...(listed?.outputLimit !== undefined ? { outputLimit: listed.outputLimit } : model !== kept.model ? { outputLimit: undefined } : {}),
		};
	};

	const loadModel = async (): Promise<boolean> => {
		const draft = read();
		const addressed = providerOf(draft.provider).local === true || providerOf(draft.provider).custom === true;
		if (draft.baseUrl === '') {
			say(t('Type the server’s address first.'), true);
			return false;
		}
		if (draft.key === '' && !addressed) {
			say(t('Paste your key first.'), true);
			return false;
		}
		say(t('Asking for the models'));
		try {
			const modelList = await listModel(draft, option.fetch ?? fetch);
			if (closed) return false;
			// the list is kept with the provider, which doesn't become the one in use by it
			updateConnection(draft.provider, { modelList });
			say(modelList.length === 1 ? t('The key works: 1 model. Click the Model field to choose.') : modelList.length > 0 ? t('The key works: {count} models. Click the Model field to choose.', { count: modelList.length }) : t('The provider listed no models: type the model’s name.'));
			return true;
		} catch (error) {
			if (!closed) say(error instanceof ProviderError ? error.message : String(error), true);
			return false;
		}
	};

	element.addEventListener('click', (event) => {
		const button = (event.target as Element).closest<HTMLElement>('[data-action]');
		const action = button?.dataset.action;
		if (!button || !action) return;
		if (action === 'Provider') {
			const rect = button.getBoundingClientRect();
			menu()?.open({
				x: rect.left,
				y: rect.bottom + 4,
				itemList: providerList.map((provider) => ({
					title: provider.title,
					checked: provider.name === providerName,
					...(connectionOf(provider.name).key ? { hint: t('Key saved') } : {}),
					run: () => {
						providerName = provider.name;
						changingKey = false;
						effort = connectionOf(provider.name).effort ?? 'Default';
						say('');
						draw();
					},
				})),
			});
		} else if (action === 'Effort') {
			const rect = button.getBoundingClientRect();
			menu()?.open({
				x: rect.left,
				y: rect.bottom + 4,
				itemList: effortList.map((level) => ({
					title: t(effortTitle[level]),
					checked: level === effort,
					run: () => {
						effort = level;
						draw();
					},
				})),
			});
		} else if (action === 'ChangeKey') {
			changingKey = true;
			draw();
			field('oi-ai-key')?.focus();
		} else if (action === 'KeepKey') {
			changingKey = false;
			draw();
		} else if (action === 'Model') void loadModel();
		else if (action === 'Forget') {
			forgetConnection(providerName);
			changingKey = false;
			say(t('Forgotten: the key is no longer in this browser.'));
			draw(false);
		} else if (action === 'Save') {
			const draft = read();
			const addressed = providerOf(draft.provider).local === true || providerOf(draft.provider).custom === true;
			if (!isReady(draft)) {
				say(t(draft.baseUrl === '' ? 'Type the server’s address.' : draft.key === '' && !addressed ? 'Paste your key.' : 'Choose a model: List models shows what your key can use.'), true);
				if (draft.model === '' && (draft.key !== '' || addressed) && draft.baseUrl !== '') void loadModel();
				return;
			}
			if (!saveConnection(draft)) {
				say(t('This browser refused to keep the key (a private window?).'), true);
				return;
			}
			changingKey = false;
			say(t('Saved. The chat and Ask AI use it now.'));
			draw(false);
		}
	});
	element.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.isComposing && !event.defaultPrevented) {
			event.preventDefault();
			element.querySelector<HTMLButtonElement>('[data-action="Save"]')?.click();
		}
	});
	draw();
	return () => {
		closed = true;
		stopCombo?.();
		element.innerHTML = '';
	};
}
