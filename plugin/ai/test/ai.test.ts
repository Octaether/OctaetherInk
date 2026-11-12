// @vitest-environment happy-dom
import type { BlockGuideEntry, HostContext, NoteEditor, NoteTarget } from '@octaether/core-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { aiPlugin } from '../src';
import { type Connection, connectionOf, currentConnection, forgetConnection, isReady, providerList, saveConnection } from '../src/connection';
import { mountConnectionForm } from '../src/connection-form';
import { chatHub } from '../src/hub';
import { closePanel, openPanel } from '../src/panel';
import { buildGuide, buildRequest as buildMessage, presetList, stripFence } from '../src/prompt';
import { ProviderError, buildRequest, chat, listModel, readEventStream } from '../src/provider';

afterEach(() => {
	closePanel();
	document.body.innerHTML = '';
	localStorage.clear();
});

const claude: Connection = { provider: 'Anthropic', key: 'sk-ant-test', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' };
const local: Connection = { provider: 'Ollama', key: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' };

/** A response whose body arrives in the given pieces (cut anywhere, as a network does). */
function streamOf(pieceList: string[], status = 200): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const piece of pieceList) controller.enqueue(encoder.encode(piece));
				controller.close();
			},
		}),
		{ status },
	);
}

const anthropicStream = [
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
	'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
	'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Math: "}}\n\nevent: content_blo',
	'ck_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"x^2"}}\n\n',
	'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
];

async function settle(round = 12): Promise<void> {
	for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
}

describe('AI connection', () => {
	it('keeps a key per provider in this browser, apart from the settings', () => {
		expect(currentConnection()).toBeUndefined();
		expect(saveConnection({ ...claude, key: '  sk-ant-test \n' })).toBe(true);
		expect(currentConnection()).toEqual(claude);
		saveConnection({ ...local, baseUrl: 'http://localhost:11434/v1/' });
		expect(currentConnection()).toEqual(local);
		// the first provider's key is still there to go back to
		expect(connectionOf('Anthropic').key).toBe('sk-ant-test');
		expect(Object.keys(localStorage)).toEqual(['OctaetherInk.AI']);
		forgetConnection('Ollama');
		expect(currentConnection()).toBeUndefined();
		expect(connectionOf('Anthropic').key).toBe('sk-ant-test');
		forgetConnection();
		expect(connectionOf('Anthropic').key).toBe('');
	});

	it('is ready with a key and a model; a model on this computer needs no key', () => {
		expect(isReady({ ...claude, key: '' })).toBe(false);
		expect(isReady({ ...claude, model: '' })).toBe(false);
		expect(isReady(claude)).toBe(true);
		expect(isReady(local)).toBe(true);
		expect(isReady({ provider: 'Custom', key: '', model: 'm', baseUrl: '' })).toBe(false);
		// a provider with a fixed address never takes another from storage
		localStorage.setItem('OctaetherInk.AI', JSON.stringify({ current: 'Anthropic', list: [{ ...claude, baseUrl: 'https://evil.example/v1' }] }));
		expect(currentConnection()!.baseUrl).toBe('https://api.anthropic.com/v1');
		expect(providerList.map((provider) => provider.name)).toEqual(['Anthropic', 'OpenAI', 'Gemini', 'DeepSeek', 'OpenRouter', 'Ollama', 'Custom']);
	});
});

describe('AI provider', () => {
	it('asks Claude through the Messages API, straight from the browser, with the guide cached', () => {
		const request = buildRequest(claude, 'GUIDE', [{ role: 'user', content: 'Hi' }]);
		expect(request.url).toBe('https://api.anthropic.com/v1/messages');
		expect(request.header).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
		expect(request.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, max_tokens: 64000, fallbacks: 'default', system: [{ type: 'text', text: 'GUIDE', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'Hi' }] });
		// no sampling settings, no thinking setting: the newest models refuse them
		expect(Object.keys(request.body).sort()).toEqual(['fallbacks', 'max_tokens', 'messages', 'model', 'stream', 'system']);
		// an older model gets no fallback, and no more room than it has
		const old = buildRequest({ ...claude, model: 'claude-haiku-4-5', outputLimit: 8000 }, 'GUIDE', []);
		expect(old.header['anthropic-beta']).toBeUndefined();
		expect(old.body.fallbacks).toBeUndefined();
		expect(old.body.max_tokens).toBe(8000);
	});

	it('asks every other provider through the chat completions shape', () => {
		const request = buildRequest({ provider: 'OpenAI', key: 'sk-test', model: 'm', baseUrl: 'https://api.openai.com/v1' }, 'GUIDE', [{ role: 'user', content: 'Hi' }]);
		expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(request.header.authorization).toBe('Bearer sk-test');
		expect(request.body).toEqual({ model: 'm', stream: true, messages: [{ role: 'system', content: 'GUIDE' }, { role: 'user', content: 'Hi' }] });
		expect(buildRequest(local, 'GUIDE', []).header.authorization).toBeUndefined();
	});

	it('reads server-sent events however the network cuts them', async () => {
		const eventList: { event: string; data: string }[] = [];
		for await (const event of readEventStream(streamOf(['event: a\r\ndata: 1\r\n\r\nda', 'ta: 2\n\n: comment\n\ndata: 3']).body!)) eventList.push(event);
		expect(eventList).toEqual([{ event: 'a', data: '1' }, { event: '', data: '2' }, { event: '', data: '3' }]);
	});

	it('streams Claude’s answer, telling thinking from writing', async () => {
		const pieceList: string[] = [];
		let thought = 0;
		let sent: RequestInit | undefined;
		const result = await chat({
			connection: claude,
			system: 'GUIDE',
			messageList: [{ role: 'user', content: 'Hi' }],
			onText: (piece) => pieceList.push(piece),
			onThink: () => thought++,
			fetch: async (_url, init) => {
				sent = init;
				return streamOf(anthropicStream);
			},
		});
		expect(result).toEqual({ text: 'Math: x^2', stop: 'End' });
		expect(pieceList).toEqual(['Math: ', 'x^2']);
		expect(thought).toBe(1);
		expect(sent?.method).toBe('POST');
		expect(JSON.parse(String(sent?.body)).model).toBe('claude-opus-5-5');
	});

	it('streams an OpenAI-compatible answer, and knows a refusal and a cut-off', async () => {
		const openAI = (finish: string): Response => streamOf([`data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\ndata: {"choices":[{"delta":{"content":"- one"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"${finish}"}]}\n\ndata: [DONE]\n\n`]);
		const ask = (response: Response): Promise<{ text: string; stop: string }> => chat({ connection: local, system: '', messageList: [], onText: () => undefined, fetch: async () => response });
		expect(await ask(openAI('stop'))).toEqual({ text: '- one', stop: 'End' });
		expect((await ask(openAI('length'))).stop).toBe('Length');
		expect((await ask(openAI('content_filter'))).stop).toBe('Refusal');
		const refused = streamOf(['event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n']);
		expect(await chat({ connection: claude, system: '', messageList: [], onText: () => undefined, fetch: async () => refused })).toEqual({ text: '', stop: 'Refusal' });
	});

	it('says what went wrong in plain words', async () => {
		const fail = async (response: () => Promise<Response>, connection = claude): Promise<ProviderError> => {
			try {
				await chat({ connection, system: '', messageList: [], onText: () => undefined, fetch: response });
			} catch (error) {
				return error as ProviderError;
			}
			throw new Error('no error');
		};
		const key = await fail(async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 }));
		expect(key).toBeInstanceOf(ProviderError);
		expect([key.kind, key.status]).toEqual(['Key', 401]);
		expect(key.message).toBe('api.anthropic.com refused the key. Check it under Connection. (invalid x-api-key)');
		expect((await fail(async () => new Response('{"error":{"message":"slow down"}}', { status: 429 }))).kind).toBe('Limit');
		expect((await fail(async () => new Response('', { status: 529 }))).kind).toBe('Server');
		expect((await fail(async () => new Response('[{"error":{"message":"no such model"}}]', { status: 404 }))).message).toContain('no such model');
		const network = await fail(async () => {
			throw new TypeError('Failed to fetch');
		}, local);
		expect(network.kind).toBe('Network');
		expect(network.message).toContain('OLLAMA_ORIGINS');
		const midway = await fail(async () => streamOf(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']));
		expect(midway.message).toContain('Overloaded');
	});

	it('lists the models a key can use, which is also the test of the key', async () => {
		let asked = '';
		let header: Record<string, string> = {};
		const list = await listModel(claude, async (url, init) => {
			asked = String(url);
			header = init?.headers as Record<string, string>;
			return new Response('{"data":[{"id":"claude-opus-5-5","display_name":"Claude Opus 5.5","max_tokens":128000},{"id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5"}],"has_more":false}');
		});
		expect(asked).toBe('https://api.anthropic.com/v1/models?limit=1000');
		expect(header['x-api-key']).toBe('sk-ant-test');
		expect(header['anthropic-beta']).toBeUndefined();
		expect(list).toEqual([{ id: 'claude-opus-5-5', title: 'Claude Opus 5.5', outputLimit: 128000 }, { id: 'claude-haiku-5-5', title: 'Claude Haiku 5.5' }]);
		expect(await listModel(local, async () => new Response('{"object":"list","data":[{"id":"llama3"}]}'))).toEqual([{ id: 'llama3', title: 'llama3' }]);
	});
});

describe('AI effort', () => {
	it('sends the effort each provider takes, and nothing for Default', () => {
		expect(buildRequest({ ...claude, effort: 'ExtraHigh' }, 'S', []).body.output_config).toEqual({ effort: 'xhigh' });
		expect(buildRequest(claude, 'S', []).body).not.toHaveProperty('output_config');
		expect(buildRequest({ ...claude, effort: 'Default' }, 'S', []).body).not.toHaveProperty('output_config');
		const openAI: Connection = { provider: 'OpenAI', key: 'k', model: 'gpt-x', baseUrl: 'https://api.openai.com/v1', effort: 'Max' };
		expect(buildRequest(openAI, 'S', []).body.reasoning_effort).toBe('high');
		expect(buildRequest({ ...openAI, effort: 'Low' }, 'S', []).body.reasoning_effort).toBe('low');
		expect(buildRequest({ ...openAI, provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }, 'S', []).body.reasoning).toEqual({ effort: 'high' });
		// a model that refused one is asked without
		expect(buildRequest({ ...claude, effort: 'High', noEffortList: ['claude-opus-5-5'] }, 'S', []).body).not.toHaveProperty('output_config');
	});

	it('asks again without the effort when a model refuses it, and remembers that model', async () => {
		saveConnection({ ...claude, model: 'claude-haiku-4-5', effort: 'High' });
		const effortList: unknown[] = [];
		const fetcher = async (_url: unknown, init?: RequestInit): Promise<Response> => {
			const body = JSON.parse(String(init?.body)) as { output_config?: { effort: string } };
			effortList.push(body.output_config?.effort);
			return body.output_config ? new Response('{"error":{"message":"effort is not supported"}}', { status: 400 }) : streamOf(anthropicStream);
		};
		const result = await chat({ connection: currentConnection()!, system: 'S', messageList: [{ role: 'user', content: 'Hi' }], onText: () => undefined, fetch: fetcher as typeof fetch });
		expect(result.text).toBe('Math: x^2');
		expect(effortList).toEqual(['high', undefined]);
		expect(connectionOf('Anthropic').noEffortList).toEqual(['claude-haiku-4-5']);
		// another 400 without an effort is the provider's answer, as it was
		await expect(chat({ connection: claude, system: 'S', messageList: [{ role: 'user', content: 'Hi' }], onText: () => undefined, fetch: (async () => new Response('{"error":{"message":"bad"}}', { status: 400 })) as typeof fetch })).rejects.toBeInstanceOf(ProviderError);
	});
});

describe('AI guide', () => {
	const entryList: BlockGuideEntry[] = [
		{ type: 'Math', module: 'Math', content: 'Raw', aliasList: ['$$'], guide: 'An equation in LaTeX.', exampleList: ['Math:'] },
		{ type: 'Sheet', module: 'Sheet', content: 'Raw', argument: 'File', aliasList: [], exampleList: ['Sheet: Budget.xlsx', '', 'Sheet {Tab: 2}: Budget.xlsx'] },
	];

	it('is put together from the modules that are on, so a new module teaches the AI by itself', () => {
		const guide = buildGuide(entryList);
		expect(guide).toContain('# OI text');
		expect(guide).toContain('## Math (raw body; notes may also open it with $$, which you leave as written; new blocks start with Math:)\n\nAn equation in LaTeX.');
		// a module with no guide shows by its templates
		expect(guide).toContain('## Sheet (raw body; after the colon: its File)\n\n<example>\nSheet: Budget.xlsx\n</example>\n\n<example>\nSheet {Tab: 2}: Budget.xlsx\n</example>');
		expect(guide).toContain('# Your answer');
		expect(guide).not.toContain('own instructions');
		expect(buildGuide(entryList, '  Answer in French.  ')).toMatch(/# The user’s own instructions\n\nAnswer in French\.$/);
		// the same text every time, so a provider can cache it
		expect(buildGuide(entryList)).toBe(guide);
	});

	it('sends the note, the selection, and the request, or only the selection when asked', () => {
		const target = { name: 'SN2 "notes"', text: 'A line.\n\nMath: x^2\n', scope: 'Block' as const, selection: 'Math: x^2', type: 'Math' };
		expect(buildMessage(target, ' Explain ')).toBe('<note name="SN2 notes">\nA line.\n\nMath: x^2\n</note>\n\n<selection scope="Block" type="Math">\nMath: x^2\n</selection>\n\n<request>\nExplain\n</request>\n\nThe request is about the selection.');
		expect(buildMessage(target, 'Explain', false)).not.toContain('<note');
		const whole = buildMessage({ ...target, scope: 'Note', selection: '' }, 'Format', false);
		expect(whole).toContain('<note name=');
		expect(whole).not.toContain('<selection');
		expect(whole).toContain('The request is about the whole note.');
		expect(presetList.map((preset) => preset.name)).toEqual(['Format', 'Fix', 'Shorten', 'Continue', 'Summarize', 'Explain']);
	});

	it('takes off a fence put around the whole answer, and leaves a real Code block alone', () => {
		expect(stripFence('```oi\nMath: x^2\n```')).toBe('Math: x^2');
		expect(stripFence('\n````text\n# Title\n\n```Python\nprint(1)\n```\n````\n')).toBe('# Title\n\n```Python\nprint(1)\n```');
		expect(stripFence('```Python\nprint(1)\n```')).toBe('```Python\nprint(1)\n```');
		expect(stripFence('```\nplain\n```')).toBe('```\nplain\n```');
		expect(stripFence('```oi\nA\n```\n\nB\n\n```oi\nC\n```')).toBe('```oi\nA\n```\n\nB\n\n```oi\nC\n```');
		expect(stripFence('  Just text. ')).toBe('Just text.');
	});
});

describe('AI panel', () => {
	interface Applied {
		source: string;
		where: string;
		scope: string;
	}

	function host(option: { target?: Partial<NoteTarget>; setting?: Record<string, string> } = {}): { context: HostContext; appliedList: Applied[]; commandMap: Map<string, (argument?: unknown) => void>; ranList: unknown[][] } {
		const appliedList: Applied[] = [];
		const commandMap = new Map<string, (argument?: unknown) => void>();
		const ranList: unknown[][] = [];
		const make = (scope: NoteTarget['scope']): NoteTarget => ({
			name: 'Lecture',
			text: 'Intro.\n\nx squared\n',
			scope,
			selection: scope === 'Note' ? '' : 'x squared',
			...(scope === 'Note' ? {} : { type: 'Text' }),
			...option.target,
			apply: (source, where) => {
				appliedList.push({ source, where, scope });
				return true;
			},
			whole: () => make('Note'),
		});
		const editor: NoteEditor = {
			capture: () => make((option.target?.scope as NoteTarget['scope'] | undefined) ?? 'Block'),
			preview: (element) => ({ update: (source) => void (element.textContent = source), destroy: () => undefined }),
		};
		const extensionMap = new Map<string, unknown>([
			['NoteEditor', editor],
			['BlockGuide', { list: async () => [{ type: 'Math', module: 'Math', content: 'Raw', aliasList: [], guide: 'An equation.', exampleList: [] }] }],
			['Command', { list: () => [], run: (id: string, argument?: unknown) => void ranList.push([id, argument]) }],
		]);
		const context = {
			registerCommand: (command: { id: string; run(argument?: unknown): void }) => {
				commandMap.set(command.id, command.run);
				return () => commandMap.delete(command.id);
			},
			extension: (name: string) => extensionMap.get(name),
			setting: (id: string) => option.setting?.[id],
		} as unknown as HostContext;
		return { context, appliedList, commandMap, ranList };
	}

	const panel = (): HTMLElement => document.querySelector<HTMLElement>('.oi-ai')!;
	const view = (name: string): HTMLElement => panel().querySelector<HTMLElement>(`[data-view="${name}"]`)!;
	const button = (action: string): HTMLButtonElement => [...panel().querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`)].find((item) => !item.closest('[hidden]'))!;

	it('connects in Setting: tests the key by listing its models, keeps it in this browser only, then shows only its end', async () => {
		const { context } = host();
		const urlList: string[] = [];
		const element = document.createElement('div');
		document.body.append(element);
		const stop = mountConnectionForm(context, element, {
			fetch: async (url) => {
				urlList.push(String(url));
				return new Response('{"data":[{"id":"claude-opus-5-5","display_name":"Claude Opus 5.5","max_tokens":128000}]}');
			},
		});
		const status = (): string => element.querySelector('.oi-ai-status')!.textContent ?? '';
		const action = (name: string): HTMLButtonElement => element.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
		expect(element.textContent).toContain('kept in this browser only');
		const key = element.querySelector<HTMLInputElement>('#oi-ai-key')!;
		expect(key.type).toBe('password');
		// saving without a key says what is missing
		action('Save').click();
		expect(status()).toBe('Paste your key.');
		key.value = 'sk-ant-test';
		action('Model').click();
		await settle();
		expect(urlList).toEqual(['https://api.anthropic.com/v1/models?limit=1000']);
		expect(status()).toContain('The key works: 1 model.');
		// the list is kept with the provider, for the model button
		expect(connectionOf('Anthropic').modelList).toEqual([{ id: 'claude-opus-5-5', title: 'Claude Opus 5.5', outputLimit: 128000 }]);
		action('Save').click();
		expect(currentConnection()).toMatchObject({ ...claude, outputLimit: 128000, effort: 'Default' });
		// once saved, the key is never shown again: only its end, and Change
		expect(element.querySelector('#oi-ai-key')).toBeNull();
		expect(element.querySelector('.oi-ai-key-saved')!.textContent).toContain('••••test');
		action('ChangeKey').click();
		expect(element.querySelector<HTMLInputElement>('#oi-ai-key')!.value).toBe('');
		stop();
	});

	it('opens the chat beside the note from the box at any time, with what is typed', async () => {
		saveConnection(claude);
		const { context } = host();
		const openList: unknown[][] = [];
		const extension = context.extension.bind(context);
		(context as { extension: (name: string) => unknown }).extension = (name: string) => (name === 'Panel' ? { register: () => () => undefined, open: (...argument: unknown[]) => void openList.push(argument) } : extension(name));
		openPanel(context);
		const openButton = panel().querySelector<HTMLButtonElement>('[data-action="OpenChat"]')!;
		expect(openButton.disabled).toBe(false);
		panel().querySelector<HTMLTextAreaElement>('.oi-ai-ask textarea')!.value = 'Make a table of the reagents';
		openButton.click();
		expect(document.querySelector('.oi-ai')).toBeNull();
		expect(openList).toHaveLength(1);
		const [id, state, option] = openList[0] as [string, string, { beside: boolean }];
		expect(id).toBe('AI.Chat');
		expect(option.beside).toBe(true);
		expect(chatHub.draftMap.get(state)).toBe('Make a table of the reagents');
	});

	it('without a connection, the box says where to connect, and keeps the request', async () => {
		const { context, ranList } = host();
		openPanel(context);
		expect(panel().dataset.oiKeepEditor).toBe('');
		expect(panel().querySelector('.oi-ai-sent')!.textContent).toContain('No AI is connected.');
		expect(panel().querySelector('[data-action="Model"]')!.textContent).toBe('Connect an AI');
		const ask = panel().querySelector<HTMLTextAreaElement>('.oi-ai-ask textarea')!;
		ask.value = 'Format it';
		button('Send').click();
		await settle();
		expect(ask.value).toBe('Format it');
		expect(panel().querySelector('.oi-ai-status')!.textContent).toContain('Setting → AI');
		panel().querySelector<HTMLButtonElement>('.oi-ai-sent [data-action="Connection"]')!.click();
		expect(ranList).toEqual([['Setting.Open', 'Module:AI']]);
		expect(document.querySelector('.oi-ai')).toBeNull();
	});

	it('sends the selection with the modules’ guide, shows the answer as it streams, and writes nothing until asked', async () => {
		saveConnection(claude);
		const { context, appliedList } = host();
		let body: { system: { text: string }[]; messages: { role: string; content: string }[] } | undefined;
		openPanel(context, {
			fetch: async (_url, init) => {
				body = JSON.parse(String(init?.body));
				return streamOf(anthropicStream);
			},
		});
		expect(view('Ask').hidden).toBe(false);
		expect(panel().querySelector<HTMLSelectElement>('#oi-ai-scope')!.value).toBe('Selection');
		expect(panel().querySelector('#oi-ai-scope option')!.textContent).toBe('Selected Text block');
		const ask = panel().querySelector<HTMLTextAreaElement>('.oi-ai-ask textarea')!;
		ask.value = 'Write this as an equation';
		ask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle(40);
		expect(body!.system[0]!.text).toContain('## Math (raw body)\n\nAn equation.');
		expect(body!.messages).toHaveLength(1);
		expect(body!.messages[0]!.content).toContain('<selection scope="Block" type="Text">\nx squared\n</selection>');
		expect(body!.messages[0]!.content).toContain('<request>\nWrite this as an equation\n</request>');
		expect(panel().querySelector('.oi-ai-preview')!.textContent).toBe('Math: x^2');
		expect(panel().querySelector('.oi-ai-status')!.textContent).toContain('Nothing is in the note yet');
		expect(appliedList).toEqual([]);
		// the answer can be changed as text before it goes in
		panel().querySelector<HTMLButtonElement>('[data-tab="Text"]')!.click();
		const source = panel().querySelector<HTMLTextAreaElement>('.oi-ai-source')!;
		expect(source.hidden).toBe(false);
		source.value = 'Math: x^{2}';
		source.dispatchEvent(new Event('input', { bubbles: true }));
		button('Replace').click();
		expect(appliedList).toEqual([{ source: 'Math: x^{2}', where: 'Replace', scope: 'Block' }]);
		expect(document.querySelector('.oi-ai')).toBeNull();
	});

	it('revises an answer in the same conversation, and a ready request says where its answer goes', async () => {
		saveConnection(claude);
		const { context, appliedList } = host({ setting: { 'AI.Context': 'Selection' } });
		const bodyList: { messages: { role: string; content: string }[] }[] = [];
		openPanel(context, {
			fetch: async (_url, init) => {
				bodyList.push(JSON.parse(String(init?.body)));
				return streamOf(anthropicStream);
			},
		});
		expect(panel().querySelector('.oi-ai-sent')!.textContent).toContain('Sends the selection to');
		panel().querySelector<HTMLButtonElement>('[data-preset="Summarize"]')!.click();
		await settle(40);
		expect(bodyList[0]!.messages[0]!.content).not.toContain('<note');
		expect(button('After').classList.contains('oi-ai-primary')).toBe(true);
		expect(button('Replace').classList.contains('oi-ai-primary')).toBe(false);
		// the ready requests make way for a request that revises
		expect(panel().querySelector<HTMLElement>('.oi-ai-preset')!.hidden).toBe(true);
		const ask = panel().querySelector<HTMLTextAreaElement>('.oi-ai-ask textarea')!;
		ask.value = 'Shorter';
		button('Send').click();
		await settle(40);
		expect(bodyList[1]!.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
		expect(bodyList[1]!.messages[1]!.content).toBe('Math: x^2');
		expect(bodyList[1]!.messages[2]!.content).toContain('<request>\nShorter\n</request>');
		// Try again asks the last request anew, without the answer it replaces
		button('Retry').click();
		await settle(40);
		expect(bodyList[2]!.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
		button('After').click();
		expect(appliedList).toEqual([{ source: 'Math: x^2', where: 'After', scope: 'Block' }]);
	});

	it('explains a failure, keeps the request, and never closes the panel on its own', async () => {
		saveConnection(claude);
		const { context, appliedList } = host({ target: { scope: 'Note' } });
		openPanel(context, { request: 'Format', fetch: async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }) });
		await settle(40);
		const status = panel().querySelector<HTMLElement>('.oi-ai-status')!;
		expect(status.textContent).toContain('refused the key');
		expect(status.dataset.kind).toBe('Problem');
		expect(panel().querySelector<HTMLTextAreaElement>('.oi-ai-ask textarea')!.value).toContain('Format this as clean OI blocks');
		expect(panel().querySelector<HTMLElement>('.oi-ai-apply')!.hidden).toBe(true);
		expect(panel().querySelector('.oi-ai-scope')!.textContent).toContain('About: the whole note (Lecture)');
		expect(appliedList).toEqual([]);
		// Esc closes it
		panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(document.querySelector('.oi-ai')).toBeNull();
	});

	it('registers Ask AI and Connect, and loads the panel only when asked', async () => {
		const { context, commandMap, ranList } = host();
		const cleanup = aiPlugin.activate(context);
		expect([...commandMap.keys()]).toEqual(['AI.Ask', 'AI.Connect', 'AI.Chat', 'AI.Memory']);
		expect(document.querySelector('.oi-ai')).toBeNull();
		commandMap.get('AI.Connect')!();
		expect(ranList).toEqual([['Setting.Open', 'Module:AI']]);
		commandMap.get('AI.Ask')!();
		await settle(40);
		expect(document.querySelector('.oi-ai')).not.toBeNull();
		// the key again closes a waiting panel
		commandMap.get('AI.Ask')!();
		expect(document.querySelector('.oi-ai')).toBeNull();
		commandMap.get('AI.Ask')!();
		expect(document.querySelector('.oi-ai')).not.toBeNull();
		if (typeof cleanup === 'function') cleanup();
		expect(document.querySelector('.oi-ai')).toBeNull();
		// the key is never a setting: settings travel with the vault
		expect(aiPlugin.settingList!.map((setting) => setting.id)).toEqual(['AI.Connection', 'AI.Context', 'AI.Mode', 'AI.Web', 'AI.Memory']);
		expect(aiPlugin.settingList![0]).toMatchObject({ type: 'Custom' });
	});
});
