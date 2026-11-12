// The Ask AI box (Ctrl+J): a small window over the bottom of the note (the note stays in view above it).
//   ask         what the request is about (the selection, or the whole note), a few ready requests,
//               and the message field, with the same row under it as the chat's (the chats, the
//               model and its effort, a square Send); the answer streams in, drawn as the note would draw it
//   answer      Preview (rendered blocks) or Text (the OI text, which you can still change), then
//               Replace, Insert below, Copy, Try again, or a further request that revises it
//   kept        each conversation is kept as a chat (with the chat's, in .oi/AI/Chat/): "Open in chat"
//               carries it on in the chat beside the note, and the chats icon reopens any chat there
// Nothing is written into the note until you choose Replace or Insert, and that is one undo step.
// The connection (provider, key, model) is chosen in Setting → AI.

import { type BlockGuide, type HostContext, type NoteEditor, type PanelHost, type PopupMenu, type VaultFile, blockGuideExtension, escapeHtml, menuExtension, noteEditorExtension, panelExtension, t, tr, vaultFileExtension } from '@octaether/core-sdk';
import type { Turn } from './agent';
import { closeModelMenu, mark, modelButtonText, openConnectionSetting, openModelMenu } from './composer';
import { currentConnection, hostOf, providerOf } from './connection';
import { chatHub } from './hub';
import { buildGuide, buildRequest, presetList, scopeTitle, stripFence } from './prompt';
import { type ChatMessage, ProviderError, chat } from './provider';
import { type Chat, chatList, newChatId, readMemory, writeChat } from './store';
import { installPanelStyle } from './style';

export interface PanelOption {
	/** Connection: opens Setting → AI instead (where the connection is chosen now). */
	view?: 'Ask' | 'Connection';
	/** Sent at once: a ready request's name (`Format`) or any words. */
	request?: string;
	/** For tests. */
	fetch?: typeof fetch;
}

let closeCurrent: (() => void) | undefined;

export function closePanel(): void {
	closeCurrent?.();
}

export function isPanelOpen(): boolean {
	return closeCurrent !== undefined;
}

export function openPanel(context: HostContext, option: PanelOption = {}): void {
	if (option.view === 'Connection') {
		openConnectionSetting(context);
		return;
	}
	closePanel();
	installPanelStyle();
	const editor = context.extension<NoteEditor>(noteEditorExtension);
	const vault = (): VaultFile | undefined => context.extension<VaultFile>(vaultFileExtension);
	const panelHost = context.extension<PanelHost>(panelExtension);
	// before anything takes the focus: what is selected now is what the request is about
	const captured = editor?.capture();
	let target = captured;
	const fetcher = option.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	const startPath = vault()?.currentPath();

	const panel = document.createElement('div');
	panel.className = 'oi-ai';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-label', t('Ask AI'));
	// using the panel doesn't close the block being edited: its selection is where the answer goes
	panel.dataset.oiKeepEditor = '';
	const headIcon = (action: string, icon: string, title: string): string => `<button type="button" class="oi-ai-head-icon" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}</button>`;
	panel.innerHTML =
		`<div class="oi-ai-head"><span class="oi-ai-title">${t('Ask AI')}</span><span class="oi-ai-space"></span>${headIcon('OpenChat', mark.Open, t('Open in chat: carry this on in the chat beside the note'))}<button type="button" class="oi-ai-close" data-action="Close" aria-label="${t('Close')}" title="${t('Close (Esc)')}">${mark.Close}</button></div>` +
		'<div class="oi-ai-body" data-view="Ask">' +
		'<div class="oi-ai-scope"></div>' +
		`<div class="oi-ai-answer" hidden><div class="oi-ai-tab"><button type="button" data-tab="Preview">${t('Preview')}</button><button type="button" data-tab="Text" title="${t('The answer as OI text; you can change it before it goes into the note')}">${t('Text')}</button></div><div class="oi-ai-preview"></div><textarea class="oi-ai-source" spellcheck="false" aria-label="${t('The answer as OI text')}" hidden></textarea></div>` +
		'<div class="oi-ai-status" role="status"></div>' +
		'<div class="oi-ai-row oi-ai-apply" hidden></div>' +
		`<div class="oi-ai-preset">${presetList.map((preset) => `<button type="button" class="oi-ai-chip" data-preset="${preset.name}" title="${escapeHtml(t(preset.request))}">${escapeHtml(t(preset.title))}</button>`).join('')}</div>` +
		`<div class="oi-composer oi-ai-ask"><textarea rows="1" aria-label="${t('Your request')}"></textarea><div class="oi-composer-bar">` +
		`<button type="button" class="oi-composer-icon" data-action="History" title="${escapeHtml(t('Chats: reopen one in the chat'))}" aria-label="${escapeHtml(t('Chats'))}">${mark.History}</button>` +
		'<span class="oi-composer-space"></span><button type="button" class="oi-composer-model" data-action="Model"></button><button type="button" class="oi-composer-send" data-action="Send"></button></div></div>' +
		'<div class="oi-ai-sent oi-composer-note"></div>' +
		'</div>';
	document.body.append(panel);

	const find = <T extends HTMLElement>(selector: string): T => panel.querySelector<T>(selector)!;
	const scopeElement = find<HTMLElement>('.oi-ai-scope');
	const answerElement = find<HTMLElement>('.oi-ai-answer');
	const previewElement = find<HTMLElement>('.oi-ai-preview');
	const sourceElement = find<HTMLTextAreaElement>('.oi-ai-source');
	const statusElement = find<HTMLElement>('.oi-ai-status');
	const applyElement = find<HTMLElement>('.oi-ai-apply');
	const presetElement = find<HTMLElement>('.oi-ai-preset');
	const askElement = find<HTMLTextAreaElement>('.oi-ai-ask textarea');
	const sendButton = find<HTMLButtonElement>('[data-action="Send"]');
	const sentElement = find<HTMLElement>('.oi-ai-sent');
	const modelButton = find<HTMLButtonElement>('[data-action="Model"]');

	const messageList: ChatMessage[] = [];
	let answer = '';
	let streaming = false;
	let controller: AbortController | undefined;
	let where: 'Replace' | 'After' = 'After';
	let tab: 'Preview' | 'Text' = 'Preview';
	let lastRequest = '';
	let firstRequest = '';
	let chatId = '';
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	// the app draws into a page of its own inside the scrolling box, so the box keeps its own look
	const pageElement = document.createElement('div');
	previewElement.append(pageElement);
	const preview = editor?.preview(pageElement);

	const setStatus = (text: string, problem = false): void => {
		statusElement.textContent = text;
		if (problem) statusElement.dataset.kind = 'Problem';
		else delete statusElement.dataset.kind;
	};

	const withNote = (): boolean => context.setting('AI.Context') !== 'Selection';

	// ---------------------------------------------------------------- the ask view

	const drawHead = (): void => {
		const connection = currentConnection();
		modelButton.innerHTML = `<span>${escapeHtml(modelButtonText(connection))}</span>${mark.Chevron}`;
		modelButton.title = connection ? tr`${providerOf(connection.provider).title}: ${connection.model}. Click to change the model or the effort` : t('Connect an AI in Setting');
		if (!connection) sentElement.innerHTML = `${escapeHtml(t('No AI is connected.'))} <button type="button" data-action="Connection">${escapeHtml(t('Connect one in Setting'))}</button>`;
		else if (providerOf(connection.provider).local) sentElement.textContent = tr`Answered on this computer (${hostOf(connection)}). Nothing is written into the note until you choose.`;
		else if (!target) sentElement.textContent = tr`Sends your request to ${hostOf(connection)} with your key.`;
		else if (withNote() || target.scope === 'Note') sentElement.textContent = tr`Sends this note to ${hostOf(connection)} with your key. Nothing is written into the note until you choose.`;
		else sentElement.textContent = tr`Sends the selection to ${hostOf(connection)} with your key. Nothing is written into the note until you choose.`;
	};

	const drawScope = (): void => {
		if (!captured) {
			scopeElement.textContent = t('No note is open: the answer can be copied.');
			return;
		}
		if (captured.scope === 'Note') {
			scopeElement.textContent = tr`About: the whole note (${captured.name}). Select text or a block first to ask about just that.`;
			return;
		}
		scopeElement.innerHTML = `<label for="oi-ai-scope">${escapeHtml(t('About'))}</label><select id="oi-ai-scope"${messageList.length > 0 ? ' disabled' : ''}><option value="Selection"${target === captured ? ' selected' : ''}>${escapeHtml(scopeTitle(captured))}</option><option value="Note"${target === captured ? '' : ' selected'}>${escapeHtml(t('Whole note'))}</option></select>`;
		scopeElement.querySelector('select')!.addEventListener('change', (event) => {
			target = (event.target as HTMLSelectElement).value === 'Note' ? captured.whole() : captured;
			drawHead();
		});
	};

	const drawAnswer = (): void => {
		answerElement.hidden = answer === '' && !streaming;
		for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
		// without the app's renderer (a test, another host) the text is all there is to show
		const text = tab === 'Text' || !preview;
		previewElement.hidden = text;
		sourceElement.hidden = !text;
		sourceElement.readOnly = streaming;
		if (sourceElement.value !== answer) sourceElement.value = answer;
		preview?.update(answer);
		if (streaming) previewElement.scrollTop = previewElement.scrollHeight;
	};

	const scheduleAnswer = (): void => {
		previewTimer ??= setTimeout(() => {
			previewTimer = undefined;
			if (!closed) drawAnswer();
		}, 120);
	};

	const drawApply = (): void => {
		const done = !streaming && answer.trim() !== '';
		applyElement.hidden = !done;
		presetElement.hidden = streaming || messageList.length > 0;
		sendButton.innerHTML = streaming ? mark.Stop : mark.Send;
		sendButton.title = streaming ? t('Stop (Esc)') : t('Send (Enter)');
		sendButton.setAttribute('aria-label', sendButton.title);
		find<HTMLButtonElement>('[data-action="OpenChat"]').disabled = streaming;
		askElement.placeholder = t(messageList.length > 0 ? 'Ask for a change to this answer' : target?.scope === 'Note' || !target ? 'Ask for anything: “make a table of the reagents”, “write the SN2 mechanism”' : 'What should be done with the selection?');
		if (!done) return;
		const buttonList: { action: string; title: string; hint?: string }[] = [];
		if (target) {
			const empty = target.scope === 'Note' && target.text.trim() === '';
			if (!empty) buttonList.push({ action: 'Replace', title: target.scope === 'Text' ? t('Replace the selection') : target.scope === 'Block' ? t('Replace the block') : t('Replace the note'), hint: t('One step: Undo brings the old text back') });
			buttonList.push({ action: 'After', title: target.scope === 'Note' ? t('Insert') : t('Insert below'), hint: target.scope === 'Note' ? t('Under the block you were writing in, or at the end of the note') : t('Under the selection’s block') });
			if (empty) where = 'After';
		}
		buttonList.push({ action: 'Copy', title: t('Copy') }, { action: 'Retry', title: t('Try again') });
		applyElement.innerHTML = buttonList
			.map((button) => `<button type="button" class="oi-ai-button${button.action === where && target ? ' oi-ai-primary' : ''}" data-action="${button.action}"${button.hint ? ` title="${escapeHtml(t(button.hint))}"` : ''}>${escapeHtml(t(button.title))}</button>`)
			.join('');
	};

	const draw = (): void => {
		drawHead();
		drawScope();
		drawAnswer();
		drawApply();
	};

	/** The AI's memory of this vault (.oi/AI/Memory.oi), which the chat keeps too. */
	const instructionText = async (): Promise<string> => {
		try {
			return await readMemory(vault());
		} catch {
			return '';
		}
	};

	/** The conversation as a chat (text turns), kept with the chat's so both can reopen it. */
	const asChat = (): Chat => {
		const connection = currentConnection();
		const now = new Date().toISOString();
		const title = firstRequest.replace(/\s+/g, ' ').trim();
		return {
			id: chatId || newChatId(),
			title: title.length > 60 ? `${title.slice(0, 57).replace(/\s+\S*$/, '')}…` : title,
			created: now,
			updated: now,
			provider: connection?.provider ?? '',
			model: connection?.model ?? '',
			mode: 'Manual',
			kind: 'Ask',
			turnList: messageList.map((message): Turn => ({ role: message.role, content: [{ type: 'text', text: message.content }] })),
		};
	};

	const keepChat = (): void => {
		const v = vault();
		if (!v?.name() || messageList.length === 0) return;
		const kept = asChat();
		chatId = kept.id;
		void writeChat(v, kept).catch(() => undefined);
	};

	const send = async (request: string): Promise<void> => {
		const text = request.trim();
		if (!text || streaming) return;
		const connection = currentConnection();
		if (!connection) {
			askElement.value = text;
			setStatus(t('Connect an AI first: choose a provider and paste your key in Setting → AI.'), true);
			drawHead();
			return;
		}
		lastRequest = text;
		const first = messageList.length === 0;
		if (first) firstRequest = text;
		messageList.push({ role: 'user', content: first ? buildRequest(target ?? { name: '', text: '', scope: 'Note', selection: '' }, text, withNote()) : `<request>\n${text}\n</request>\n\nReply with the whole answer again, revised.` });
		answer = '';
		streaming = true;
		controller = new AbortController();
		askElement.value = '';
		resizeAsk();
		setStatus(t('Sending'));
		draw();
		try {
			const guide = context.extension<BlockGuide>(blockGuideExtension);
			const result = await chat({
				connection,
				system: buildGuide((await guide?.list()) ?? [], await instructionText()),
				messageList,
				signal: controller.signal,
				fetch: fetcher,
				onThink: () => {
					if (answer === '') setStatus(t('Thinking'));
				},
				onText: (piece) => {
					if (answer === '') setStatus(t('Writing'));
					answer += piece;
					scheduleAnswer();
				},
			});
			messageList.push({ role: 'assistant', content: result.text });
			answer = stripFence(result.text);
			if (result.stop === 'Refusal') setStatus(t(answer ? 'The model stopped here: it declined to go on.' : 'The model declined this request.'), true);
			else if (answer === '') setStatus(t('The model sent nothing. Try again, or ask in other words.'), true);
			else if (result.stop === 'Length') setStatus(t('Cut off: the answer reached the model’s length limit.'), true);
			else setStatus(t(target ? 'Done. Nothing is in the note yet: choose below, or ask for a change.' : 'Done.'));
			keepChat();
		} catch (error) {
			const stopped = error instanceof DOMException && error.name === 'AbortError';
			// stopped with something written: that is the answer, and it can be revised. Otherwise the
			// request is not part of the conversation, and comes back into the field to send again
			if (stopped && answer !== '') {
				messageList.push({ role: 'assistant', content: answer });
				keepChat();
			} else {
				messageList.pop();
				askElement.value = text;
			}
			if (stopped) setStatus(t(answer ? 'Stopped. What arrived is kept.' : 'Stopped.'));
			else setStatus(error instanceof ProviderError ? error.message : `${t('Something went wrong:')} ${error instanceof Error ? error.message : String(error)}`, true);
		}
		if (closed) return;
		streaming = false;
		controller = undefined;
		clearTimeout(previewTimer);
		previewTimer = undefined;
		resizeAsk();
		draw();
		askElement.focus();
	};

	const apply = (place: 'Replace' | 'After'): void => {
		if (!target) return;
		const text = sourceElement.hidden ? answer : sourceElement.value;
		if (target.apply(stripFence(text), place)) {
			close();
			return;
		}
		setStatus(t(target.scope === 'Note' ? 'The note is no longer open. Copy the answer instead.' : 'The selection has changed since you asked. Copy the answer, or choose “Whole note” to insert it there.'), true);
		if (captured && target === captured) {
			// the place is gone: the whole note still takes it
			target = captured.whole();
			drawApply();
		}
	};

	const resizeAsk = (): void => {
		askElement.style.height = 'auto';
		askElement.style.height = `${Math.min(askElement.scrollHeight + 2, window.innerHeight * 0.3)}px`;
	};

	/** Carries the conversation on in the chat beside the note; with nothing asked yet, the chat opens with what is typed. */
	const openInChat = (): void => {
		if (streaming || !panelHost) return;
		if (messageList.length === 0) {
			const state = `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
			if (askElement.value.trim()) chatHub.draftMap.set(state, askElement.value);
			close();
			panelHost.open('AI.Chat', state, { title: t('Chat'), beside: true });
			return;
		}
		const kept = asChat();
		chatId = kept.id;
		const v = vault();
		if (v?.name()) void writeChat(v, kept).catch(() => undefined);
		chatHub.pendingMap.set(kept.id, kept);
		close();
		panelHost.open('AI.Chat', kept.id, { title: kept.title || t('Chat'), beside: true });
	};

	/** The chats kept (with this box's): one opens in the chat beside the note. */
	const openChatList = async (anchor: HTMLElement): Promise<void> => {
		const menu = context.extension<PopupMenu>(menuExtension);
		const v = vault();
		const list = v?.name() ? await chatList(v) : [];
		const rect = anchor.getBoundingClientRect();
		menu?.open({
			x: rect.left,
			y: rect.top - 6,
			search: list.length > 8,
			itemList:
				list.length > 0
					? list.slice(0, 60).map((item) => ({
							title: item.title,
							hint: item.updated.slice(0, 10),
							...(item.kind === 'Ask' ? { explain: t('Ask AI') } : {}),
							run: () => {
								close();
								panelHost?.open('AI.Chat', item.id, { title: item.title, beside: true });
							},
						}))
					: [{ title: v?.name() ? t('No chat kept yet') : t('Chats are kept in a vault') }],
		});
	};

	// ---------------------------------------------------------------- events

	function close(): void {
		if (closed) return;
		closed = true;
		closeModelMenu();
		controller?.abort();
		clearTimeout(previewTimer);
		preview?.destroy();
		stopWatch?.();
		panel.remove();
		if (closeCurrent === close) closeCurrent = undefined;
	}
	closeCurrent = close;
	// another tab or pane in front (a chat, another note): the box was about this note, so it goes
	const stopWatch = panelHost?.subscribe?.(() => {
		if (streaming || closed) return;
		if (panelHost.current?.() !== undefined || vault()?.currentPath() !== startPath) close();
	});

	panel.addEventListener('click', (event) => {
		const element = (event.target as Element).closest<HTMLElement>('[data-action], [data-preset], [data-tab]');
		if (!element) return;
		if (element.dataset.tab) {
			tab = element.dataset.tab as 'Preview' | 'Text';
			drawAnswer();
			return;
		}
		if (element.dataset.preset) {
			const preset = presetList.find((item) => item.name === element.dataset.preset)!;
			where = preset.where;
			void send(preset.request);
			return;
		}
		const action = element.dataset.action;
		if (action === 'Close') close();
		else if (action === 'Send') {
			if (streaming) controller?.abort();
			else void send(askElement.value);
		} else if (action === 'Replace' || action === 'After') apply(action);
		else if (action === 'Copy') {
			const text = sourceElement.hidden ? answer : sourceElement.value;
			void navigator.clipboard?.writeText(text).then(
				() => setStatus(t('Copied.')),
				() => setStatus(t('The browser didn’t allow copying: select the text under Text instead.'), true),
			);
		} else if (action === 'Retry') {
			// the same request again, as if the last answer had not been given
			if (messageList.at(-1)?.role === 'assistant') messageList.splice(-2);
			void send(lastRequest);
		} else if (action === 'Model') openModelMenu(context, element, drawHead, (text, problem) => setStatus(text, problem));
		else if (action === 'Connection') {
			close();
			openConnectionSetting(context);
		} else if (action === 'OpenChat') openInChat();
		else if (action === 'History') void openChatList(element);
	});
	sourceElement.addEventListener('input', () => {
		if (streaming) return;
		answer = sourceElement.value;
		preview?.update(answer);
		drawApply();
	});
	askElement.addEventListener('input', resizeAsk);
	panel.addEventListener('keydown', (event) => {
		// the panel's keys are its own: the note's hotkeys (bold, undo, delete the block) stay out of it
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			if (streaming) controller?.abort();
			else close();
			return;
		}
		if (event.target === askElement && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			if (!streaming) void send(askElement.value);
		}
	});

	draw();
	askElement.focus();
	if (!currentConnection()) setStatus(t('Connect an AI first: choose a provider and paste your key in Setting → AI.'));
	if (option.request !== undefined && option.request.trim() !== '') {
		const preset = presetList.find((item) => item.name === option.request!.trim());
		if (preset) where = preset.where;
		void send(preset?.request ?? option.request);
	}
}
