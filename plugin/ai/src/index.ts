// AI plugin: an AI of your own, connected with your own key, that writes and formats notes as OI
// blocks. There is no Octaether server and no account: requests go straight from this device to the
// provider you chose (Anthropic, OpenAI, Gemini, OpenRouter, a model on this computer with Ollama,
// or any OpenAI-compatible address), so the app stays a static site and the key stays yours.
//
//   Ask AI      a panel over the bottom of the note: the request is about the selection or the whole
//               note, the answer is drawn as blocks, and nothing enters the note until you choose
//               Replace or Insert (one undo step)
//   the guide   what the AI reads first is put together from the modules that are on: each block
//               type says how it is written (`BlockTypeDefinition.guide`), so new modules teach the
//               AI by themselves; a note of yours can add instructions (`AI.Instruction`)
//   the key     kept in this browser only, never in a vault's setting file
//
//   the chat    a tab of its own where the AI works in the vault with tools (read, search, write,
//               edit, move, delete, see a note drawn, run commands; the web with Claude), in Manual,
//               Plan, or Auto mode as in Claude Code; conversations and its memory are kept hidden in
//               the vault's .oi/AI/
//
// Only this file loads with the app; the panel, the chat, and the provider code load when first asked for.

import { type CommandAccess, type HostContext, type PanelHost, type PluginDefinition, commandExtension, panelExtension } from '@octaether/core-sdk';
import { chatHub } from './hub';

/** The plugin's context while it is on (its setting page draws the connection with it). */
let pluginContext: HostContext | undefined;

export const aiPlugin: PluginDefinition = {
	kind: 'Plugin',
	name: 'AI',
	publisher: 'Octaether',
	language: { 'zh-Hans': () => import('./language/zh-Hans').then((module) => module.default) },
	version: '0.1.0',
	title: 'AI',
	explain:
		'Connect an AI of your own to write and format notes: Claude, OpenAI, Gemini, DeepSeek, OpenRouter, a model on this computer (Ollama), or any OpenAI-compatible server. It knows how every block that is switched on is written, so its answers are real blocks: math, tables, plots, callouts. Your key stays in this browser, requests go straight to the provider, and nothing enters a note until you choose. Until you connect one, nothing is sent anywhere.',
	use: ['NoteEditor', 'BlockGuide', 'NoteIndex', 'VaultFile', 'Panel', 'Command'],
	settingList: [
		{
			id: 'AI.Connection',
			title: 'Connection',
			type: 'Custom',
			default: null,
			explain: 'The provider, your key for it, the model, and the effort. Kept in this browser only: never in a note, a vault, or .oi/Setting.oi.',
			mount(element) {
				let stop: (() => void) | undefined;
				let gone = false;
				const context = pluginContext;
				if (!context) return;
				void Promise.all([import('./connection-form'), import('./style')]).then(([form, style]) => {
					if (gone) return;
					style.installPanelStyle();
					stop = form.mountConnectionForm(context, element);
				});
				return () => {
					gone = true;
					stop?.();
				};
			},
		},
		{
			id: 'AI.Context',
			title: 'Send with a request',
			type: 'Choice',
			choiceList: ['Note', 'Selection'],
			default: 'Note',
			explain: 'Note: the whole note goes with every request, so the AI knows what the selection is part of. Selection: only what is selected is sent (the whole note still is when you ask about the whole note).',
		},
		{
			id: 'AI.Mode',
			title: 'Mode of a new chat',
			type: 'Choice',
			choiceList: ['Manual', 'Plan', 'Auto'],
			default: 'Manual',
			explain: 'Manual: every change to your notes is shown first and waits for Allow or Deny. Plan: the AI only looks, then proposes; you choose to carry it out. Auto: changes are made without asking, and each one can be undone. A chat can switch at any time.',
		},
		{
			id: 'AI.Web',
			title: 'Search the web',
			type: 'Toggle',
			default: true,
			explain: 'With Claude, the AI can search the web and read pages to answer, giving its sources as links. Off: it works only with your notes.',
		},
		{
			id: 'AI.Memory',
			title: 'Memory',
			type: 'Action',
			command: 'AI.Memory',
			action: 'Open',
			default: null,
			explain: 'What the AI knows about this vault and how you like to work, read before every conversation. It is a note kept hidden in the vault (.oi/AI/Memory.oi): the AI adds to it when you tell it to remember, and you can edit it.',
		},
	],
	activate(context) {
		pluginContext = context;
		let panel: typeof import('./panel') | undefined;
		context.registerCommand({
			id: 'AI.Ask',
			title: 'Ask AI',
			explain: 'About the selection, or the whole note. Argument: a request to send at once (Format, Fix, Shorten, Continue, Summarize, Explain, or any words)',
			key: ['Mod+J'],
			run: (argument) => {
				// over a chat, the chat is where to ask: its field takes the focus
				const front = panelHost?.current?.();
				if (front?.id === 'AI.Chat') {
					chatHub.focusMap.get(front.state)?.();
					return;
				}
				// the key again closes a panel that is waiting; with an argument it asks anew
				if (argument === undefined && panel?.isPanelOpen()) panel.closePanel();
				else open(typeof argument === 'string' && argument.trim() !== '' ? { request: argument } : {});
			},
		});
		context.registerCommand({
			id: 'AI.Connect',
			title: 'Connect an AI',
			explain: 'The provider, your key, and the model, in Setting',
			run: () => context.extension<CommandAccess>(commandExtension)?.run('Setting.Open', 'Module:AI'),
		});
		// the chat: a page in a tab, loaded the first time one opens
		const panelHost = context.extension<PanelHost>(panelExtension);
		const open = (option: import('./panel').PanelOption): void => {
			if (panel) panel.openPanel(context, option);
			else
				void import('./panel').then((module) => {
					panel = module;
					module.openPanel(context, option);
				});
		};
		const removePanel = panelHost?.register({
			id: 'AI.Chat',
			title: 'Chat',
			mount(element, state, tab) {
				let handle: { destroy(): void; shown(): void } | undefined;
				let gone = false;
				void import('./chat').then((module) => {
					if (!gone) handle = module.mountChat(context, element, state, tab);
				});
				return {
					destroy() {
						gone = true;
						handle?.destroy();
					},
					shown: () => handle?.shown(),
				};
			},
		});
		const newChat = (): string => `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
		// the chat button: the chat shown last, beside the note (a new one the first time)
		context.registerCommand({
			id: 'AI.Chat',
			title: 'Open the AI chat',
			explain: 'Beside the note, where the AI works in your vault. Argument: New for a new chat',
			run: (argument) => panelHost?.open('AI.Chat', argument === 'New' || !chatHub.last ? newChat() : chatHub.last, { title: 'Chat', beside: true }),
		});
		context.registerCommand({
			id: 'AI.Memory',
			title: 'Open the AI’s memory',
			explain: 'The note the AI reads before every conversation (.oi/AI/Memory.oi)',
			run: () => void import('./chat').then((module) => module.openMemory(context)),
		});
		return () => {
			panel?.closePanel();
			removePanel?.();
			pluginContext = undefined;
		};
	},
};
