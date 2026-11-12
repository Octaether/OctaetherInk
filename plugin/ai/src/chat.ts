// The AI's chat, in a tab of its own (beside the note, in a pane, as VS Code's chat sits beside the
// editors). The AI works in the vault with tools, in one of three modes, as in Claude Code:
//   Manual  every change is shown first (with what it does to the file) and waits for Allow or Deny
//   Plan    the AI only looks, then proposes; "Carry out" starts the work in Manual or Auto
//   Auto    changes are made at once; each one has its Undo
// Everything you use sits at the bottom, under the message field: attach (a note, a file), the
// chats kept, a new chat, memory, the mode, the model and its effort, and Send.
// Conversations are kept in the vault's .oi/AI/Chat/ (put away in Archive/), the AI's memory in .oi/AI/Memory.oi.

import {
	type BlockGuide,
	type CommandAccess,
	type HostContext,
	type MenuEntry,
	type NoteEditor,
	type NoteIndex,
	type PanelTab,
	type PopupMenu,
	type VaultChange,
	type VaultFile,
	blockGuideExtension,
	commandExtension,
	escapeHtml,
	installStyle,
	menuExtension,
	noteEditorExtension,
	noteIndexExtension,
	t,
	tr,
	vaultFileExtension,
} from '@octaether/core-sdk';
import { type AgentStop, type Block, type ToolCall, type Turn, runAgent } from './agent';
import { type Attachment, attachmentBlock, attachmentKindTitle, attachmentLabel, attachmentOf, expandTurnList, keepInVault, readFile } from './attach';
import { closeModelMenu, mark, modelButtonText, openConnectionSetting, openModelMenu } from './composer';
import { currentConnection, hostOf, providerOf } from './connection';
import { chatHub } from './hub';
import { agentGuide } from './prompt';
import { ProviderError } from './provider';
import { type Chat, type ChatSummary, type Mode, archiveChat, chatList, deleteChat, isArchived, memoryPath, modeList, newChatId, readChat, readMemory, renameChat, titleOf, writeChat } from './store';
import { chatStyle, composerStyle } from './style';
import { type ChangePreview, type PreparedTool, type ToolOutput, describe, lineDiff, prepareTool, toolList } from './tool';

export const chatPanelId = 'AI.Chat';

const modeExplain: Readonly<Record<Mode, string>> = {
	Manual: 'Asks before each change',
	Plan: 'Looks and proposes; changes nothing',
	Auto: 'Changes without asking; each can be undone',
};

const modeNote: Readonly<Record<Mode, string>> = {
	Manual: 'Manual: each change you make is shown to the user first, who allows or declines it.',
	Plan: 'Plan: look around with the reading tools only, then propose the changes as a numbered plan and stop. Change nothing; the user decides whether to carry it out.',
	Auto: 'Auto: your changes are made at once, without asking; the user can undo each one.',
};

interface Approval {
	call: ToolCall;
	prepared: Extract<PreparedTool, { kind: 'Change' }>;
	resolve(answer: { allow: boolean; reason?: string }): void;
}

/** One status per tool call, from its result in the next turn. */
function resultOf(turnList: readonly Turn[], id: string): Block | undefined {
	for (const turn of turnList) {
		if (turn.role !== 'user') continue;
		const found = turn.content.find((block) => block.type === 'tool_result' && block.tool_use_id === id);
		if (found) return found;
	}
	return undefined;
}

const resultText = (block: Block | undefined): string => ((block?.content as Block[] | undefined) ?? []).filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n');

/** What the user wrote, without what the app added to it. */
const userText = (text: string): string => text.replace(/\n*<context>[\s\S]*?<\/context>/g, '').replace(/\n*<mode>[\s\S]*?<\/mode>/g, '').replace(/^<request>\n?([\s\S]*?)\n?<\/request>[\s\S]*$/, '$1').trim();

/** Opens the AI's memory note in a tab (made the first time); false without a vault. */
export async function openMemory(context: HostContext): Promise<boolean> {
	const vault = context.extension<VaultFile>(vaultFileExtension);
	if (!vault?.name()) return false;
	if (!vault.has(memoryPath)) await vault.write(memoryPath, `${t('# Memory')}\n\n${t('What the AI knows about this vault and how you like to work. It reads this before every conversation; edit it freely.')}\n`);
	vault.open(memoryPath);
	return true;
}

function diffHtml(preview: ChangePreview): string {
	if (preview.before === undefined || preview.after === undefined) return '';
	const lineList = lineDiff(preview.before, preview.after);
	if (lineList.length === 0) return `<div class="oi-chat-diff-none">${escapeHtml(t('No change to the text.'))}</div>`;
	return `<pre class="oi-chat-diff">${lineList
		.map((line) => (line.kind === 'Gap' ? '<span class="oi-chat-diff-gap">⋯</span>' : `<span class="oi-chat-diff-${line.kind.toLowerCase()}">${line.kind === 'Add' ? '+ ' : line.kind === 'Remove' ? '− ' : '  '}${escapeHtml(line.text)}</span>`))
		.join('')}</pre>`;
}

/** `Nov 11`, or `Nov 11, 2025` in another year, in the app's language. */
function dateText(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	const now = new Date();
	if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(document.documentElement.lang || undefined, { hour: 'numeric', minute: '2-digit' });
	return date.toLocaleDateString(document.documentElement.lang || undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

const newState = (): string => `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function mountChat(context: HostContext, element: HTMLElement, state: string, tab: PanelTab): { destroy(): void; shown(): void } {
	installStyle('AI.Chat', chatStyle);
	installStyle('AI.Composer', composerStyle);
	const vault = (): VaultFile | undefined => context.extension<VaultFile>(vaultFileExtension);
	const editor = context.extension<NoteEditor>(noteEditorExtension);
	const menu = (): PopupMenu | undefined => context.extension<PopupMenu>(menuExtension);
	const savedMode = (): Mode => {
		const value = String(context.setting('AI.Mode') ?? 'Manual');
		return modeList.includes(value as Mode) ? (value as Mode) : 'Manual';
	};
	const emptyChat = (): Chat => ({ id: '', title: '', created: new Date().toISOString(), updated: '', provider: '', model: '', mode: savedMode(), turnList: [] });
	let chat: Chat = emptyChat();
	let tabState = state;
	let controller: AbortController | undefined;
	let status = '';
	let problem = '';
	let approval: Approval | undefined;
	let withNote = true;
	let closed = false;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let drawTimer: ReturnType<typeof setTimeout> | undefined;
	/** What goes with the next message. */
	let attachList: Attachment[] = [];
	/** The chats kept, shown in place of the conversation. */
	let history: { archived: boolean; query: string; list: ChatSummary[]; renaming?: string } | undefined;
	/** In this session: what each change did (for its diff) and its way back. */
	const previewMap = new Map<string, ChangePreview>();
	const undoMap = new Map<string, VaultChange>();
	const undoneSet = new Set<string>();
	/** Attachments as the API reads them, read once. */
	const expandCache = new WeakMap<Block, Block[]>();
	/** Each answer's drawn blocks, kept while the list is drawn again. */
	const answerMap = new Map<string, { element: HTMLElement; preview?: { update(source: string): void; destroy(): void }; text: string }>();

	const iconButton = (action: string, icon: string, title: string): string => `<button type="button" class="oi-composer-icon" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}</button>`;
	element.innerHTML =
		'<div class="oi-chat">' +
		'<div class="oi-chat-list" role="log" aria-live="polite"></div>' +
		'<div class="oi-chat-history" hidden></div>' +
		'<footer class="oi-chat-foot"><div class="oi-composer">' +
		'<div class="oi-composer-context"></div>' +
		`<textarea rows="1" aria-label="${escapeHtml(t('Your message'))}"></textarea>` +
		'<div class="oi-composer-bar">' +
		iconButton('Attach', mark.Plus, t('Attach a note or a file')) +
		iconButton('History', mark.History, t('Chats')) +
		iconButton('New', mark.New, t('New chat')) +
		'<span class="oi-composer-separator"></span>' +
		iconButton('Memory', mark.Memory, t('Memory: what the AI knows about this vault (.oi/AI/Memory.oi)')) +
		'<div class="oi-composer-mode" role="radiogroup"></div>' +
		'<span class="oi-composer-space"></span>' +
		'<button type="button" class="oi-composer-model" data-action="Model"></button>' +
		'<button type="button" class="oi-composer-send" data-action="Send"></button>' +
		'</div></div><div class="oi-composer-note"></div></footer>' +
		'<input type="file" class="oi-chat-file" multiple hidden></div>';
	const find = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
	const root = find<HTMLElement>('.oi-chat');
	const listElement = find<HTMLElement>('.oi-chat-list');
	const historyElement = find<HTMLElement>('.oi-chat-history');
	const askElement = find<HTMLTextAreaElement>('.oi-composer textarea');
	const sendButton = find<HTMLButtonElement>('.oi-composer-send');
	const composer = find<HTMLElement>('.oi-composer');
	const fileInput = find<HTMLInputElement>('.oi-chat-file');

	const focusChat = (): void => {
		if (!closed) askElement.focus({ preventScroll: true });
	};
	const setTabState = (next: string): void => {
		if (chatHub.focusMap.get(tabState) === focusChat) chatHub.focusMap.delete(tabState);
		tabState = next;
		chatHub.focusMap.set(tabState, focusChat);
		chatHub.last = tabState;
		tab.setState(next);
	};
	chatHub.focusMap.set(tabState, focusChat);
	chatHub.last = tabState;

	const save = (): void => {
		if (!chat.turnList.length) return;
		chat.updated = new Date().toISOString();
		if (!chat.title) chat.title = titleOf(chat.turnList);
		const target = vault();
		if (!target?.name()) return;
		if (!chat.id) chat.id = newChatId();
		if (tabState !== chat.id) setTabState(chat.id);
		tab.setTitle(chat.title || t('Chat'));
		clearTimeout(saveTimer);
		const snapshot = chat;
		saveTimer = setTimeout(() => {
			saveTimer = undefined;
			void writeChat(target, snapshot).catch(() => undefined);
		}, 300);
	};

	/** Writes what is waiting at once (before the chat is switched or put away). */
	const flushSave = async (): Promise<void> => {
		if (!saveTimer) return;
		clearTimeout(saveTimer);
		saveTimer = undefined;
		const target = vault();
		if (target?.name() && chat.id) await writeChat(target, chat).catch(() => undefined);
	};

	// ---------------------------------------------------------------- drawing

	const drawFoot = (): void => {
		const connection = currentConnection();
		root.dataset.chatMode = chat.mode;
		find<HTMLElement>('.oi-composer-mode').innerHTML = modeList
			.map((mode) => `<button type="button" role="radio" data-mode="${mode}" aria-checked="${chat.mode === mode}" title="${escapeHtml(`${t(mode)}: ${t(modeExplain[mode])}`)}"${controller ? ' disabled' : ''}>${mark[mode]}<span>${escapeHtml(t(mode))}</span></button>`)
			.join('');
		const model = find<HTMLButtonElement>('.oi-composer-model');
		model.innerHTML = `<span>${escapeHtml(modelButtonText(connection))}</span>${mark.Chevron}`;
		model.title = connection ? tr`${providerOf(connection.provider).title}: ${connection.model}. Click to change the model or the effort` : t('Connect an AI in Setting');
		const path = vault()?.currentPath();
		const chipList: string[] = [];
		if (path) chipList.push(`<span class="oi-composer-chip${withNote ? '' : ' off'}" title="${escapeHtml(t('The AI is told which note is on screen'))}">${mark.Note}<span>${escapeHtml(path.replace(/\.oi$/, '').split('/').pop() ?? path)}</span><button type="button" data-action="Context" aria-label="${escapeHtml(withNote ? t('Leave the note on screen out') : t('Tell the AI about the note on screen'))}">${withNote ? mark.Close : mark.Plus}</button></span>`);
		attachList.forEach((attachment, index) => {
			chipList.push(`<span class="oi-composer-chip" title="${escapeHtml(attachmentKindTitle(attachment.kind))}">${attachment.kind === 'Note' ? mark.Note : mark.File}<span>${escapeHtml(attachmentLabel(attachment))}</span><button type="button" data-unattach="${index}" aria-label="${escapeHtml(tr`Remove ${attachment.name}`)}">${mark.Close}</button></span>`);
		});
		find<HTMLElement>('.oi-composer-context').innerHTML = chipList.join('');
		sendButton.innerHTML = controller ? mark.Stop : mark.Send;
		sendButton.title = controller ? t('Stop (Esc)') : t('Send (Enter)');
		sendButton.setAttribute('aria-label', sendButton.title);
		sendButton.disabled = !controller && askElement.value.trim() === '';
		for (const action of ['History', 'New']) find<HTMLButtonElement>(`.oi-composer-bar [data-action="${action}"]`).disabled = controller !== undefined;
		find<HTMLButtonElement>('.oi-composer-bar [data-action="History"]').setAttribute('aria-pressed', String(history !== undefined));
		const note = find<HTMLElement>('.oi-composer-note');
		if (!connection) note.innerHTML = `${escapeHtml(t('No AI is connected.'))} <button type="button" data-action="Connection">${escapeHtml(t('Connect one in Setting'))}</button>`;
		else if (!vault()?.name()) note.textContent = t('No vault is open: the AI can talk, but not work with files, and the chat isn’t kept.');
		else note.textContent = providerOf(connection.provider).protocol === 'Anthropic' && context.setting('AI.Web') !== false ? tr`${t(modeExplain[chat.mode])}. Sends to ${hostOf(connection)} with your key; can search the web.` : tr`${t(modeExplain[chat.mode])}. Sends to ${hostOf(connection)} with your key.`;
	};

	const toolCard = (block: Block): string => {
		const id = String(block.id);
		const name = String(block.name);
		const input = (block.input as Record<string, unknown>) ?? {};
		const result = resultOf(chat.turnList, id);
		const text = resultText(result);
		const declined = text.startsWith('The user declined');
		const kind = toolList.find((tool) => tool.name === name)?.kind ?? 'Read';
		const state = !result ? (approval?.call.id === id ? 'Waiting' : controller ? 'Running' : 'Stopped') : declined ? 'Declined' : result.is_error ? 'Failed' : 'Done';
		const preview = previewMap.get(id);
		const change = undoMap.get(id);
		const undo = change && !undoneSet.has(id) ? `<button type="button" class="oi-chat-small" data-undo="${escapeHtml(id)}">${escapeHtml(t('Undo'))}</button>` : undoneSet.has(id) ? `<span class="oi-chat-tag">${escapeHtml(t('Undone'))}</span>` : '';
		const label = state === 'Declined' ? t('Declined') : state === 'Failed' ? t('Failed') : state === 'Running' ? t('Working') : state === 'Waiting' ? t('Waiting for you') : state === 'Stopped' ? t('Stopped') : '';
		const detail = kind === 'Change' && preview && state !== 'Waiting' ? `<details class="oi-chat-detail"><summary>${escapeHtml(t('What changed'))}</summary>${diffHtml(preview)}</details>` : state === 'Failed' ? `<div class="oi-chat-fail">${escapeHtml(text)}</div>` : '';
		return `<div class="oi-chat-tool" data-kind="${kind}" data-state="${state}"><div class="oi-chat-tool-line"><span class="oi-chat-dot"></span><span class="oi-chat-tool-title">${escapeHtml(describe(name, input))}</span>${label ? `<span class="oi-chat-tag">${escapeHtml(label)}</span>` : ''}${undo}</div>${detail}</div>`;
	};

	const webCard = (block: Block): string => {
		const input = (block.input as Record<string, unknown>) ?? {};
		const title = block.name === 'web_fetch' ? tr`Read ${String(input.url ?? '')}` : tr`Searched the web for “${String(input.query ?? '')}”`;
		return `<div class="oi-chat-tool" data-kind="Web"><div class="oi-chat-tool-line"><span class="oi-chat-dot"></span><span class="oi-chat-tool-title">${escapeHtml(title)}</span></div></div>`;
	};

	const sourceCard = (block: Block): string => {
		const list = Array.isArray(block.content) ? (block.content as Block[]).filter((item) => typeof item.url === 'string') : [];
		if (list.length === 0) return '';
		return `<details class="oi-chat-source"><summary>${escapeHtml(tr`${list.length} sources`)}</summary><ul>${list
			.slice(0, 12)
			.map((item) => `<li><a href="${escapeHtml(String(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(item.title || item.url))}</a></li>`)
			.join('')}</ul></details>`;
	};

	/** A message of yours: its words, and what was attached to it. */
	const userCard = (turn: Turn): string => {
		const text = turn.content
			.filter((block) => block.type === 'text')
			.map((block) => userText(String(block.text ?? '')))
			.filter(Boolean)
			.join('\n\n');
		const fileList = turn.content.map(attachmentOf).filter((item): item is Attachment => item !== undefined);
		if (!text && fileList.length === 0) return '';
		const files = fileList.length ? `<div class="oi-chat-user-file">${fileList.map((item) => `<span>${item.kind === 'Note' ? mark.Note : mark.File}${escapeHtml(attachmentLabel(item))}</span>`).join('')}</div>` : '';
		return `<div class="oi-chat-user">${escapeHtml(text)}${files}</div>`;
	};

	const draw = (): void => {
		if (closed) return;
		clearTimeout(drawTimer);
		drawTimer = undefined;
		drawFoot();
		listElement.hidden = history !== undefined;
		historyElement.hidden = history === undefined;
		if (history) return;
		const keepList = new Set<string>();
		const partList: string[] = [];
		const lastAssistant = chat.turnList.map((turn, index) => (turn.role === 'assistant' ? index : -1)).filter((index) => index >= 0).at(-1);
		chat.turnList.forEach((turn, turnIndex) => {
			if (turn.role === 'user') {
				partList.push(userCard(turn));
				return;
			}
			turn.content.forEach((block, blockIndex) => {
				if (block.type === 'text' && String(block.text ?? '').trim() !== '') {
					const key = `${turnIndex}:${blockIndex}`;
					keepList.add(key);
					partList.push(`<div class="oi-chat-answer-slot" data-key="${key}"></div>`);
				} else if (block.type === 'tool_use') partList.push(toolCard(block));
				else if (block.type === 'server_tool_use') partList.push(webCard(block));
				else if (block.type === 'web_search_tool_result') partList.push(sourceCard(block));
			});
		});
		if (approval) {
			partList.push(
				`<div class="oi-chat-approve" role="group" aria-label="${escapeHtml(t('A change waits for you'))}"><div class="oi-chat-approve-title">${escapeHtml(approval.prepared.title)}</div>${diffHtml(approval.prepared.preview)}` +
					`<div class="oi-chat-row"><button type="button" class="oi-chat-button primary" data-approve="Allow">${escapeHtml(t('Allow'))}</button><button type="button" class="oi-chat-button" data-approve="All" title="${escapeHtml(t('Allow this and every change after it in this chat (Auto mode)'))}">${escapeHtml(t('Allow all'))}</button><button type="button" class="oi-chat-button" data-approve="Deny">${escapeHtml(t('Deny'))}</button><input class="oi-chat-reason" placeholder="${escapeHtml(t('Why not, or what instead (optional)'))}"></div></div>`,
			);
		}
		if (!controller && chat.mode === 'Plan' && lastAssistant !== undefined && lastAssistant === chat.turnList.length - 1) {
			partList.push(
				`<div class="oi-chat-plan"><div class="oi-chat-plan-text"><b>${escapeHtml(t('Start this plan?'))}</b><span>${escapeHtml(t('Nothing has changed yet. Pick how the AI makes the changes, or keep talking to change the plan.'))}</span></div>` +
					`<div class="oi-chat-row"><button type="button" class="oi-chat-button primary" data-carry="Manual" title="${escapeHtml(t('Each change is shown first and waits for your Allow'))}">${mark.Manual}${escapeHtml(t('Start in Manual: ask before each change'))}</button>` +
					`<button type="button" class="oi-chat-button" data-carry="Auto" title="${escapeHtml(t('Every change is made at once; each one can be undone'))}">${mark.Auto}${escapeHtml(t('Start in Auto: make the changes'))}</button></div></div>`,
			);
		}
		if (status) partList.push(`<div class="oi-chat-status">${escapeHtml(status)}</div>`);
		if (problem) partList.push(`<div class="oi-chat-problem" role="alert">${escapeHtml(problem)}</div>`);
		if (chat.turnList.length === 0 && !status) {
			partList.push(
				`<div class="oi-chat-empty"><b>${escapeHtml(t('Ask the AI to work in your notes'))}</b><span>${escapeHtml(t('It can read, search, write, edit, move, and delete notes, see how a note looks, run the app’s commands, and (with Claude) search the web. “Make a note summarizing every note tagged Exam”, “Fix the tables in Lecture 05”, “Find where I wrote about SN2”.'))}</span><span>${escapeHtml(t('+ attaches a note or a file from this computer (text, a picture, a PDF); you can also drop files here or paste a picture.'))}</span></div>`,
			);
		}
		const atBottom = listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight < 60;
		// the drawn answers move into the new list instead of being drawn again
		const kept = new Map([...answerMap].filter(([key]) => keepList.has(key)));
		for (const [key, item] of answerMap) {
			if (kept.has(key)) continue;
			item.preview?.destroy();
			answerMap.delete(key);
		}
		for (const item of kept.values()) item.element.remove();
		listElement.innerHTML = partList.join('');
		for (const slot of listElement.querySelectorAll<HTMLElement>('.oi-chat-answer-slot')) {
			const key = slot.dataset.key!;
			const [turnIndex, blockIndex] = key.split(':').map(Number) as [number, number];
			const text = String(chat.turnList[turnIndex]?.content[blockIndex]?.text ?? '');
			let item = answerMap.get(key);
			if (!item) {
				const answer = document.createElement('div');
				answer.className = 'oi-chat-answer';
				// the note's renderer owns the element it draws in: it gets one of its own inside
				const page = document.createElement('div');
				answer.append(page);
				item = { element: answer, text: '' };
				if (editor) item.preview = editor.preview(page);
				answerMap.set(key, item);
			}
			if (item.text !== text) {
				item.text = text;
				if (item.preview) item.preview.update(text);
				else item.element.firstElementChild!.textContent = text;
			}
			slot.replaceWith(item.element);
		}
		if (atBottom || controller) listElement.scrollTop = listElement.scrollHeight;
	};

	/** While an answer streams, the list is drawn at most every 120 ms. */
	const drawSoon = (): void => {
		drawTimer ??= setTimeout(draw, 120);
	};

	// ---------------------------------------------------------------- the chats kept

	const drawHistory = (): void => {
		if (!history) return;
		const query = history.query.trim().toLowerCase();
		const list = query ? history.list.filter((item) => item.title.toLowerCase().includes(query)) : history.list;
		const focusSearch = document.activeElement?.classList.contains('oi-chat-history-search') === true;
		const action = (name: string, icon: string, title: string, id: string): string => `<button type="button" data-history="${name}" data-id="${escapeHtml(id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon}</button>`;
		historyElement.innerHTML =
			`<div class="oi-chat-history-head"><input class="oi-chat-history-search" placeholder="${escapeHtml(t('Search chats'))}" aria-label="${escapeHtml(t('Search chats'))}" value="${escapeHtml(history.query)}">` +
			`<div class="oi-chat-history-tab"><button type="button" data-history-tab="Chat" aria-pressed="${!history.archived}">${escapeHtml(t('Chats'))}</button><button type="button" data-history-tab="Archive" aria-pressed="${history.archived}">${escapeHtml(t('Archived'))}</button></div>` +
			`<button type="button" class="oi-composer-icon" data-history="Close" title="${escapeHtml(t('Back to the chat (Esc)'))}" aria-label="${escapeHtml(t('Back to the chat'))}">${mark.Close}</button></div>` +
			(list.length === 0
				? `<div class="oi-chat-history-none">${escapeHtml(!vault()?.name() ? t('Chats are kept in a vault: open one first.') : query ? t('No chat matches.') : history.archived ? t('No chat is put away.') : t('No chat kept yet.'))}</div>`
				: `<div class="oi-chat-history-list" role="list">${list
						.map(
							(item) =>
								`<div class="oi-chat-history-row" role="listitem" tabindex="0" data-open="${escapeHtml(item.id)}"${item.id === chat.id ? ' aria-current="true"' : ''}>` +
								`<span class="oi-chat-history-title">${history!.renaming === item.id ? `<input data-rename="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}" aria-label="${escapeHtml(t('Rename'))}">` : escapeHtml(item.title)}</span>` +
								(item.kind === 'Ask' ? `<span class="oi-chat-history-kind" title="${escapeHtml(t('Begun in Ask AI (Ctrl+J)'))}">${escapeHtml(t('Ask AI'))}</span>` : '') +
								`<span class="oi-chat-history-date">${escapeHtml(dateText(item.updated))}</span>` +
								`<span class="oi-chat-history-action">${action('Rename', mark.Rename, t('Rename'), item.id)}${history!.archived ? action('Unarchive', mark.Unarchive, t('Put back in the list'), item.id) : action('Archive', mark.Archive, t('Archive: put away, out of the list'), item.id)}${action('Delete', mark.Delete, t('Delete for good'), item.id)}</span>` +
								'</div>',
						)
						.join('')}</div>`);
		if (focusSearch) {
			const search = historyElement.querySelector<HTMLInputElement>('.oi-chat-history-search')!;
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
		}
		const rename = historyElement.querySelector<HTMLInputElement>('[data-rename]');
		if (rename) {
			rename.focus();
			rename.select();
		}
	};

	const loadHistory = async (): Promise<void> => {
		if (!history) return;
		const v = vault();
		await flushSave();
		history.list = v?.name() ? await chatList(v, { archived: history.archived }) : [];
		drawHistory();
	};

	const showHistory = (open: boolean): void => {
		if (open && controller) return;
		history = open ? { archived: false, query: '', list: [] } : undefined;
		draw();
		if (open) {
			drawHistory();
			void loadHistory();
			historyElement.querySelector<HTMLInputElement>('.oi-chat-history-search')?.focus();
		} else focusChat();
	};

	/** Shows another chat here (or a new one with no id); the one shown is saved first. */
	const switchTo = async (id: string): Promise<void> => {
		if (controller) return;
		await flushSave();
		const v = vault();
		const next = id && v?.name() ? await readChat(v, id) : undefined;
		if (closed) return;
		for (const item of answerMap.values()) item.preview?.destroy();
		answerMap.clear();
		previewMap.clear();
		undoMap.clear();
		undoneSet.clear();
		status = '';
		problem = '';
		attachList = [];
		chat = next ?? emptyChat();
		setTabState(next ? next.id : newState());
		tab.setTitle(next ? next.title || t('Chat') : t('New chat'));
		history = undefined;
		draw();
		focusChat();
	};

	const historyAction = async (name: string, id: string): Promise<void> => {
		const v = vault();
		if (!v?.name() || !history) return;
		if (name === 'Rename') {
			history.renaming = id;
			drawHistory();
			return;
		}
		if (name === 'Archive' || name === 'Unarchive') {
			if (id === chat.id) await flushSave();
			await archiveChat(v, id, name === 'Archive');
		} else if (name === 'Delete') {
			const title = history.list.find((item) => item.id === id)?.title ?? '';
			const confirm = await menu()?.confirm?.(tr`Delete the chat “${title}” for good? Its attached files go with it.`, t('Delete'), true);
			if (confirm === false) return;
			if (id === chat.id) {
				clearTimeout(saveTimer);
				saveTimer = undefined;
			}
			await deleteChat(v, id);
			if (id === chat.id) {
				chat = emptyChat();
				setTabState(newState());
				tab.setTitle(t('New chat'));
			}
		}
		await loadHistory();
	};

	const finishRename = async (input: HTMLInputElement, keep: boolean): Promise<void> => {
		const id = input.dataset.rename!;
		const title = input.value.trim();
		if (history) history.renaming = undefined;
		const v = vault();
		if (keep && title && v?.name()) {
			if (id === chat.id) {
				chat.title = title;
				tab.setTitle(title);
				save();
				await flushSave();
			} else await renameChat(v, id, title);
		}
		await loadHistory();
	};

	// ---------------------------------------------------------------- attaching

	const attachFileList = async (fileList: Iterable<File>): Promise<void> => {
		const problemList: string[] = [];
		for (const file of fileList) {
			const result = await readFile(file);
			if ('problem' in result) problemList.push(result.problem);
			else attachList.push(result);
		}
		problem = problemList.join(' ');
		draw();
		focusChat();
	};

	const openAttachMenu = (anchor: HTMLElement): void => {
		const v = vault();
		const noteList = v?.name()
			? v
					.list('')
					.filter((entry) => entry.kind === 'File' && entry.path.endsWith('.oi'))
					.map((entry) => entry.path)
					.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
			: [];
		const noteEntry: MenuEntry[] = noteList.slice(0, 500).map((path) => ({
			title: path.replace(/\.oi$/, '').split('/').pop() ?? path,
			...(path.includes('/') ? { hint: path.slice(0, path.lastIndexOf('/')) } : {}),
			keywordList: [path],
			run: () => {
				if (!attachList.some((item) => item.kind === 'Note' && item.path === path)) attachList.push({ kind: 'Note', name: path.split('/').pop() ?? path, path });
				draw();
				focusChat();
			},
		}));
		const rect = anchor.getBoundingClientRect();
		menu()?.open({
			x: rect.left,
			y: rect.top - 6,
			itemList: [
				{ title: t('A file from this computer'), explain: t('Text or code, a picture, a PDF: a copy is kept with the chat'), run: () => fileInput.click() },
				noteEntry.length
					? { title: t('A note of the vault'), explain: t('Its text goes with the message, as it is then'), childList: noteEntry }
					: { title: t('A note of the vault'), explain: t('Open a vault first') },
			],
		});
	};

	// ---------------------------------------------------------------- running

	const runTool = async (call: ToolCall, signal: AbortSignal): Promise<ToolOutput> => {
		const prepared = await prepareTool(call.name, call.input, { vault: vault(), command: context.extension<CommandAccess>(commandExtension), guide: context.extension<BlockGuide>(blockGuideExtension) });
		if (prepared.kind === 'Error') return prepared.output;
		if (prepared.kind === 'Read') return prepared.run();
		previewMap.set(call.id, prepared.preview);
		if (chat.mode === 'Plan') return { text: 'Plan mode: nothing may be changed. Propose this change in the plan instead.', isError: true };
		if (chat.mode === 'Manual') {
			const answer = await new Promise<{ allow: boolean; reason?: string }>((resolve, reject) => {
				approval = { call, prepared, resolve };
				signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
				status = '';
				draw();
				listElement.querySelector<HTMLButtonElement>('[data-approve="Allow"]')?.focus({ preventScroll: true });
			}).finally(() => {
				approval = undefined;
			});
			if (!answer.allow) return { text: `The user declined this change.${answer.reason ? ` They said: ${answer.reason}` : ''} Don’t make it; ask or go another way.`, isError: true };
		}
		status = t('Working');
		draw();
		const { output, change } = await prepared.apply();
		if (change) undoMap.set(call.id, change);
		return output;
	};

	const send = async (text: string): Promise<void> => {
		const request = text.trim();
		if (!request || controller) return;
		const connection = currentConnection();
		if (!connection) {
			openConnectionSetting(context);
			return;
		}
		const v = vault();
		const path = withNote ? v?.currentPath() : undefined;
		const contextLine = path ? `\n\n<context>The note on screen: ${path}</context>` : '';
		// a picture or a PDF is copied beside the chat (which gets its id now, to name the folder)
		if (v?.name() && !chat.id && attachList.some((item) => item.kind === 'Image' || item.kind === 'PDF')) chat.id = newChatId();
		const start = chat.turnList.reduce((sum, turn) => sum + turn.content.filter((block) => block.type === 'oi_attachment').length, 0);
		const fileList = await Promise.all(attachList.map((item, index) => keepInVault(v, chat.id, item, start + index).catch(() => item)));
		chat.turnList.push({ role: 'user', content: [{ type: 'text', text: `${request}${contextLine}\n\n<mode>${modeNote[chat.mode]}</mode>` }, ...fileList.map(attachmentBlock)] });
		attachList = [];
		chat.provider = connection.provider;
		chat.model = connection.model;
		askElement.value = '';
		resizeAsk();
		problem = '';
		status = t('Sending');
		controller = new AbortController();
		const signal = controller.signal;
		save();
		draw();
		let stop: AgentStop = 'End';
		try {
			const guide = context.extension<BlockGuide>(blockGuideExtension);
			stop = await runAgent({
				connection,
				system: agentGuide((await guide?.list()) ?? [], await readMemory(v), v?.name()),
				turnList: chat.turnList,
				toolList: chat.mode === 'Plan' ? toolList.filter((tool) => tool.kind === 'Read') : toolList,
				web: context.setting('AI.Web') !== false,
				signal,
				expand: (list) => expandTurnList(list, vault(), expandCache),
				onBlock: (block) => {
					status = block.type === 'thinking' || block.type === 'redacted_thinking' || block.type === 'reasoning' ? t('Thinking') : block.type === 'text' ? '' : t('Working');
					drawSoon();
				},
				onText: () => {
					status = '';
					drawSoon();
				},
				onChange: () => {
					save();
					drawSoon();
				},
				onToolCall: (call) => runTool(call, signal),
			});
		} catch (error) {
			problem = error instanceof ProviderError ? error.message : `${t('Something went wrong:')} ${error instanceof Error ? error.message : String(error)}`;
			// a request that never got an answer leaves the conversation as it was: it can be sent again
			const last = chat.turnList.at(-1);
			if (last?.role === 'user' && last.content.every((block) => block.type === 'text' || block.type === 'oi_attachment')) {
				chat.turnList.pop();
				askElement.value = request;
				attachList = last.content.map(attachmentOf).filter((item): item is Attachment => item !== undefined);
			}
		}
		controller = undefined;
		status = stop === 'Stopped' ? t('Stopped.') : stop === 'Length' ? t('Cut off: the answer reached the model’s length limit.') : stop === 'Refusal' ? t('The model declined this request.') : stop === 'Limit' ? t('Stopped after many steps. Say “go on” to continue.') : '';
		save();
		draw();
		if (!closed && tab.isShown()) focusChat();
	};

	const resizeAsk = (): void => {
		askElement.style.height = 'auto';
		askElement.style.height = `${Math.min(askElement.scrollHeight + 2, 220)}px`;
		sendButton.disabled = !controller && askElement.value.trim() === '';
	};

	const showMemory = async (): Promise<void> => {
		if (await openMemory(context)) return;
		problem = t('Memory is kept in a vault: open one first.');
		draw();
	};

	// ---------------------------------------------------------------- events

	element.addEventListener('click', (event) => {
		const target = event.target as Element;
		const link = target.closest<HTMLElement>('[data-oi-link]');
		if (link) {
			event.preventDefault();
			const index = context.extension<NoteIndex>(noteIndexExtension);
			const path = index?.resolve(link.dataset.oiLink!);
			if (path) index!.open(path, true);
			return;
		}
		// the chats kept
		const historyButton = target.closest<HTMLElement>('[data-history]');
		if (historyButton) {
			event.stopPropagation();
			if (historyButton.dataset.history === 'Close') showHistory(false);
			else void historyAction(historyButton.dataset.history!, historyButton.dataset.id!);
			return;
		}
		const historyTab = target.closest<HTMLElement>('[data-history-tab]');
		if (historyTab && history) {
			history.archived = historyTab.dataset.historyTab === 'Archive';
			history.list = [];
			drawHistory();
			void loadHistory();
			return;
		}
		const row = target.closest<HTMLElement>('[data-open]');
		if (row && !target.closest('input')) {
			void switchTo(row.dataset.open!);
			return;
		}
		const unattach = target.closest<HTMLElement>('[data-unattach]');
		if (unattach) {
			attachList.splice(Number(unattach.dataset.unattach), 1);
			draw();
			focusChat();
			return;
		}
		const mode = target.closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
		if (mode && !controller) {
			chat.mode = mode;
			save();
			draw();
			return;
		}
		const approve = target.closest<HTMLElement>('[data-approve]')?.dataset.approve;
		if (approve && approval) {
			const reason = listElement.querySelector<HTMLInputElement>('.oi-chat-reason')?.value.trim();
			if (approve === 'All') chat.mode = 'Auto';
			approval.resolve({ allow: approve !== 'Deny', ...(reason ? { reason } : {}) });
			return;
		}
		const carry = target.closest<HTMLElement>('[data-carry]')?.dataset.carry as Mode | undefined;
		if (carry) {
			chat.mode = carry;
			void send(t('Carry out the plan.'));
			return;
		}
		const undo = target.closest<HTMLElement>('[data-undo]')?.dataset.undo;
		if (undo) {
			const change = undoMap.get(undo);
			if (change && !undoneSet.has(undo)) {
				undoneSet.add(undo);
				void change.undo().then(draw, () => {
					undoneSet.delete(undo);
					problem = t('Couldn’t undo that change.');
					draw();
				});
				// the AI hears of it with the next message (never in the middle of its own turn)
				const call = chat.turnList.flatMap((turn) => turn.content).find((block) => block.id === undo);
				if (!controller) chat.turnList.push({ role: 'user', content: [{ type: 'text', text: `<context>The user undid this change: ${describe(String(call?.name ?? ''), (call?.input as Record<string, unknown>) ?? {})}</context>` }] });
				save();
			}
			return;
		}
		const button = target.closest<HTMLElement>('[data-action]');
		const action = button?.dataset.action;
		if (action === 'Send') {
			if (controller) controller.abort();
			else void send(askElement.value);
		} else if (action === 'Connection') openConnectionSetting(context);
		else if (action === 'Model') {
			openModelMenu(context, button!, drawFoot, (text, isProblem) => {
				problem = isProblem ? text : '';
				status = isProblem ? '' : text;
				draw();
			});
		} else if (action === 'History') showHistory(history === undefined);
		else if (action === 'Memory') void showMemory();
		else if (action === 'New') void switchTo('');
		else if (action === 'Attach') openAttachMenu(button!);
		else if (action === 'Context') {
			withNote = !withNote;
			drawFoot();
		}
	});
	historyElement.addEventListener('input', (event) => {
		const target = event.target as HTMLInputElement;
		if (!target.classList.contains('oi-chat-history-search') || !history) return;
		history.query = target.value;
		drawHistory();
	});
	historyElement.addEventListener('focusout', (event) => {
		const target = event.target as HTMLInputElement;
		if (target.dataset.rename && history?.renaming === target.dataset.rename) void finishRename(target, true);
	});
	askElement.addEventListener('input', resizeAsk);
	askElement.addEventListener('paste', (event) => {
		const fileList = [...(event.clipboardData?.files ?? [])];
		if (fileList.length === 0) return;
		event.preventDefault();
		void attachFileList(fileList);
	});
	fileInput.addEventListener('change', () => {
		void attachFileList([...(fileInput.files ?? [])]);
		fileInput.value = '';
	});
	composer.addEventListener('dragover', (event) => {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		composer.classList.add('oi-composer-drop');
	});
	composer.addEventListener('dragleave', () => composer.classList.remove('oi-composer-drop'));
	composer.addEventListener('drop', (event) => {
		composer.classList.remove('oi-composer-drop');
		const fileList = [...(event.dataTransfer?.files ?? [])];
		if (fileList.length === 0) return;
		event.preventDefault();
		void attachFileList(fileList);
	});
	element.addEventListener('keydown', (event) => {
		// the chat's keys are its own: the note's hotkeys stay out of it
		event.stopPropagation();
		const target = event.target as HTMLElement;
		if (target instanceof HTMLInputElement && target.dataset.rename) {
			if (event.key === 'Enter') {
				event.preventDefault();
				void finishRename(target, true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				void finishRename(target, false);
			}
			return;
		}
		if (history && event.key === 'Escape') {
			event.preventDefault();
			showHistory(false);
			return;
		}
		if (history && event.key === 'Enter' && target.dataset.open) {
			event.preventDefault();
			void switchTo(target.dataset.open);
			return;
		}
		if (target === askElement && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			if (!controller) void send(askElement.value);
		}
		if (event.key === 'Escape' && controller) controller.abort();
	});

	// what was typed in the Ask AI box comes along
	const draft = chatHub.draftMap.get(state);
	if (draft) {
		chatHub.draftMap.delete(state);
		askElement.value = draft;
	}
	// a conversation handed over by the Ask AI box, or a chat kept in the vault: open it as it was
	const pending = chatHub.pendingMap.get(state);
	if (pending) {
		chatHub.pendingMap.delete(state);
		chat = pending;
		tab.setTitle(chat.title || t('Chat'));
		save();
		draw();
	} else if (state && !state.startsWith('new-') && vault()?.name()) {
		void readChat(vault()!, state).then((saved) => {
			if (closed) return;
			if (saved) {
				chat = saved;
				tab.setTitle(chat.title || t('Chat'));
			}
			draw();
		});
	} else draw();
	resizeAsk();

	return {
		destroy() {
			closed = true;
			closeModelMenu();
			controller?.abort();
			clearTimeout(drawTimer);
			if (chatHub.focusMap.get(tabState) === focusChat) chatHub.focusMap.delete(tabState);
			if (saveTimer) {
				clearTimeout(saveTimer);
				const target = vault();
				if (target?.name() && chat.id) void writeChat(target, chat).catch(() => undefined);
			}
			for (const item of answerMap.values()) item.preview?.destroy();
			answerMap.clear();
			element.innerHTML = '';
		},
		shown() {
			chatHub.last = tabState;
			drawFoot();
			focusChat();
		},
	};
}

export { isArchived };
