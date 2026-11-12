// @vitest-environment happy-dom
import type { BlockGuide, CommandAccess, HostContext, NoteEditor, PanelTab, VaultChange, VaultFile, VaultFileEntry } from '@octaether/core-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Turn, anthropicRequest, openAIMessageList, runAgent, usesResponses } from '../src/agent';
import { mountChat } from '../src/chat';
import { currentConnection, saveConnection } from '../src/connection';
import { agentGuide } from '../src/prompt';
import { chatList, chatPath, newChatId, readMemory, titleOf } from '../src/store';
import { lineDiff, memoryPath, pathProblem, prepareTool, toolList } from '../src/tool';

/** A vault in memory, with the undo of every change, as the app's VaultFile behaves. */
function memoryVault(start: Record<string, string> = {}): VaultFile & { fileMap: Map<string, string>; openList: string[] } {
	const fileMap = new Map(Object.entries(start));
	const folderSet = new Set<string>();
	const openList: string[] = [];
	const change = (path: string, undo: () => Promise<void>): VaultChange => ({ path, undo });
	return {
		fileMap,
		openList,
		name: () => 'Test',
		list(folder = '') {
			const all: VaultFileEntry[] = [...[...folderSet].map((path) => ({ path, kind: 'Folder' as const })), ...[...fileMap.keys()].map((path) => ({ path, kind: 'File' as const }))];
			const hidden = folder === '.oi' || folder.startsWith('.oi/');
			return all.filter((entry) => (hidden || !entry.path.startsWith('.oi/')) && (folder === '' || entry.path.startsWith(`${folder}/`)));
		},
		has: (path) => fileMap.has(path) || folderSet.has(path) || [...fileMap.keys()].some((key) => key.startsWith(`${path}/`)),
		async remove(path) {
			for (const key of [...fileMap.keys()]) if (key === path || key.startsWith(`${path}/`)) fileMap.delete(key);
		},
		read: async (path) => fileMap.get(path),
		async write(path, text) {
			const before = fileMap.get(path);
			fileMap.set(path, text);
			return change(path, async () => void (before === undefined ? fileMap.delete(path) : fileMap.set(path, before)));
		},
		async makeFolder(path) {
			folderSet.add(path);
			return change(path, async () => void folderSet.delete(path));
		},
		async move(path, target) {
			const text = fileMap.get(path)!;
			fileMap.delete(path);
			fileMap.set(target, text);
			return change(target, async () => {
				fileMap.delete(target);
				fileMap.set(path, text);
			});
		},
		async trash(path) {
			const text = fileMap.get(path)!;
			fileMap.delete(path);
			return change(path, async () => void fileMap.set(path, text));
		},
		search: (query) => [...fileMap].filter(([path, text]) => !path.startsWith('.oi/') && text.includes(query)).map(([path, text]) => ({ path, line: text.split('\n').find((line) => line.includes(query)) ?? '' })),
		open: (path) => void openList.push(path),
		picture: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
		currentPath: () => 'Lecture.oi',
	};
}

const guide: BlockGuide = { list: async () => [{ type: 'Math', module: 'Math', content: 'Raw', aliasList: [], guide: 'An equation in LaTeX. More words.', exampleList: [] }] };
const commandList = [
	{ id: 'View.Read', title: 'Read view' },
	{ id: 'AI.Chat', title: 'Open the AI chat' },
];

/** A response whose body is these server-sent events. */
function stream(eventList: unknown[]): Response {
	const text = eventList.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
	return new Response(new Blob([text]).stream(), { status: 200 });
}

const delta = (index: number, value: Record<string, unknown>): Record<string, unknown> => ({ type: 'content_block_delta', index, delta: value });
const start = (index: number, block: Record<string, unknown>): Record<string, unknown> => ({ type: 'content_block_start', index, content_block: block });
const stop = (index: number): Record<string, unknown> => ({ type: 'content_block_stop', index });
const end = (reason: string): Record<string, unknown> => ({ type: 'message_delta', delta: { stop_reason: reason } });

/** Claude: thinks, says a word, and asks to read a file (its input in two pieces). */
const claudeToolTurn = stream([
	{ type: 'message_start' },
	start(0, { type: 'thinking', thinking: '' }),
	delta(0, { type: 'thinking_delta', thinking: 'Read it first.' }),
	delta(0, { type: 'signature_delta', signature: 'sig-1' }),
	stop(0),
	start(1, { type: 'text', text: '' }),
	delta(1, { type: 'text_delta', text: 'Let me look.' }),
	stop(1),
	start(2, { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }),
	delta(2, { type: 'input_json_delta', partial_json: '{"path": "Lec' }),
	delta(2, { type: 'input_json_delta', partial_json: 'ture.oi"}' }),
	stop(2),
	end('tool_use'),
	{ type: 'message_stop' },
]);
const claudeAnswer = (text: string): Response => stream([start(0, { type: 'text', text: '' }), delta(0, { type: 'text_delta', text }), stop(0), end('end_turn'), { type: 'message_stop' }]);

beforeEach(() => localStorage.clear());
afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('AI tools', () => {
	it('keeps the AI inside the vault and out of the app’s own folder', () => {
		expect(pathProblem('Notes/SN2.oi')).toBeUndefined();
		for (const path of ['../x.oi', '/etc/x', 'C:/x.oi', 'a//b.oi', '.oi/Setting.oi', 'a/./b', 'what?.oi']) expect(pathProblem(path), path).toBeDefined();
	});

	it('reads, searches, and lists, and prepares changes without making them', async () => {
		const vault = memoryVault({ 'Lecture.oi': 'One.\n\nTwo.\n', 'Chem/SN2.oi': 'Backside attack.\n', '.oi/Setting.oi': 'Kind: Setting\n' });
		const host = { vault, command: undefined, guide };
		const read = await prepareTool('read_file', { path: 'Lecture.oi' }, host);
		expect(read.kind).toBe('Read');
		expect(read.kind === 'Read' && (await read.run()).text).toBe('One.\n\nTwo.\n');
		const list = await prepareTool('list_files', {}, host);
		expect(list.kind === 'Read' && (await list.run()).text).toBe('Lecture.oi\nChem/SN2.oi');
		const search = await prepareTool('search_notes', { query: 'Backside' }, host);
		expect(search.kind === 'Read' && (await search.run()).text).toBe('Chem/SN2.oi: Backside attack.');
		const skill = await prepareTool('read_skill', { type: 'math' }, host);
		expect(skill.kind === 'Read' && (await skill.run()).text).toBe('## Math\n\nAn equation in LaTeX. More words.');
		const picture = await prepareTool('view_note', { path: 'Lecture.oi' }, host);
		expect(picture.kind === 'Read' && (await picture.run()).picture).toBe(btoa(String.fromCharCode(137, 80, 78, 71)));
		// an edit: the text before and after, nothing changed yet
		const edit = await prepareTool('edit_file', { path: 'Lecture.oi', old_text: 'Two.', new_text: 'Math: x^2' }, host);
		expect(edit.kind).toBe('Change');
		if (edit.kind !== 'Change') return;
		expect(edit.preview).toEqual({ title: 'Edit Lecture.oi', path: 'Lecture.oi', before: 'One.\n\nTwo.\n', after: 'One.\n\nMath: x^2\n' });
		expect(vault.fileMap.get('Lecture.oi')).toBe('One.\n\nTwo.\n');
		const { change } = await edit.apply();
		expect(vault.fileMap.get('Lecture.oi')).toBe('One.\n\nMath: x^2\n');
		await change!.undo();
		expect(vault.fileMap.get('Lecture.oi')).toBe('One.\n\nTwo.\n');
	});

	it('says why a call can’t run, so the AI can try again', async () => {
		const vault = memoryVault({ 'A.oi': 'x x\n' });
		const host = { vault, command: undefined, guide };
		const twice = await prepareTool('edit_file', { path: 'A.oi', old_text: 'x', new_text: 'y' }, host);
		expect(twice.kind === 'Error' && twice.output.text).toContain('2 times');
		const missing = await prepareTool('edit_file', { path: 'A.oi', old_text: 'z', new_text: 'y' }, host);
		expect(missing.kind === 'Error' && missing.output.text).toContain('isn’t in');
		expect((await prepareTool('write_file', { path: '.oi/Hotkey.oi', content: 'x' }, host)).kind).toBe('Error');
		expect((await prepareTool('read_file', {}, host)).kind).toBe('Error');
		expect((await prepareTool('nothing', {}, host)).kind).toBe('Error');
		const none = await prepareTool('read_file', { path: 'A.oi' }, { vault: undefined, command: undefined, guide });
		expect(none.kind === 'Error' && none.output.text).toContain('No vault is open');
	});

	it('remembers in the memory note, and runs the app’s commands but never its own', async () => {
		const vault = memoryVault();
		const ranList: string[] = [];
		const command: CommandAccess = { list: () => commandList, run: (id) => (ranList.push(id), true) };
		const host = { vault, command, guide };
		const remember = await prepareTool('remember', { text: 'Answers in French.' }, host);
		if (remember.kind !== 'Change') throw new Error('not a change');
		await remember.apply();
		expect(vault.fileMap.get(memoryPath)).toMatch(/^# Memory\n\n.+\n\n- Answers in French\.\n$/);
		expect(await readMemory(vault)).toContain('- Answers in French.');
		const run = await prepareTool('run_command', { id: 'View.Read' }, host);
		if (run.kind !== 'Change') throw new Error('not a change');
		await run.apply();
		expect(ranList).toEqual(['View.Read']);
		expect((await prepareTool('run_command', { id: 'AI.Chat' }, host)).kind).toBe('Error');
	});

	it('shows a change as the lines that changed', () => {
		expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
			{ kind: 'Same', text: 'a' },
			{ kind: 'Remove', text: 'b' },
			{ kind: 'Add', text: 'B' },
			{ kind: 'Same', text: 'c' },
		]);
		const long = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
		const diff = lineDiff(long, long.replace('line 15', 'LINE 15'));
		expect(diff[0]).toEqual({ kind: 'Gap', text: '' });
		expect(diff.filter((line) => line.kind !== 'Same' && line.kind !== 'Gap')).toEqual([
			{ kind: 'Remove', text: 'line 15' },
			{ kind: 'Add', text: 'LINE 15' },
		]);
		expect(lineDiff('', 'new\n')).toEqual([{ kind: 'Add', text: 'new' }]);
	});
});

describe('AI agent', () => {
	const claude = { provider: 'Anthropic', key: 'sk-ant-test', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' };

	it('asks Claude with the tools, its web search, and the conversation cached', () => {
		const request = anthropicRequest({ connection: claude, system: 'GUIDE', turnList: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], toolList, web: true });
		const toolNameList = (request.body.tools as { name: string; type?: string }[]).map((tool) => tool.type ?? tool.name);
		expect(toolNameList).toEqual([...toolList.map((tool) => tool.name), 'web_search_20260209', 'web_fetch_20260209']);
		expect((request.body.tools as Record<string, unknown>[])[0]).toMatchObject({ name: 'list_files', eager_input_streaming: true, input_schema: { type: 'object', additionalProperties: false } });
		expect(request.body).toMatchObject({ stream: true, cache_control: { type: 'ephemeral' }, system: [{ text: 'GUIDE', cache_control: { type: 'ephemeral' } }], fallbacks: 'default' });
		// an older Haiku gets the basic search, and no web without the setting
		const old = anthropicRequest({ connection: { ...claude, model: 'claude-haiku-4-5' }, system: '', turnList: [], toolList: [], web: true });
		expect(old.body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
		expect(anthropicRequest({ connection: claude, system: '', turnList: [], toolList: [], web: false }).body.tools).toBeUndefined();
	});

	it('runs Claude’s tool calls and sends its thinking back exactly as it came', async () => {
		const bodyList: Record<string, unknown>[] = [];
		const responseList = [claudeToolTurn, claudeAnswer('It says one, two.')];
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'What is in Lecture?' }] }];
		const callList: unknown[] = [];
		const stopped = await runAgent({
			connection: claude,
			system: 'GUIDE',
			turnList,
			toolList,
			web: false,
			signal: new AbortController().signal,
			fetch: async (_url, init) => {
				bodyList.push(JSON.parse(String(init?.body)));
				return responseList.shift()!;
			},
			onToolCall: async (call) => {
				callList.push(call);
				return { text: 'One.\n\nTwo.' };
			},
		});
		expect(stopped).toBe('End');
		expect(callList).toEqual([{ id: 'toolu_1', name: 'read_file', input: { path: 'Lecture.oi' } }]);
		expect(turnList.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
		// the second request carries the first answer unchanged: thinking with its signature, then the call and its result
		const secondMessageList = bodyList[1]!.messages as { role: string; content: Record<string, unknown>[] }[];
		expect(secondMessageList[1]!.content).toEqual([
			{ type: 'thinking', thinking: 'Read it first.', signature: 'sig-1' },
			{ type: 'text', text: 'Let me look.' },
			{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'Lecture.oi' } },
		]);
		expect(secondMessageList[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'One.\n\nTwo.' }] }]);
		expect(turnList[3]!.content).toEqual([{ type: 'text', text: 'It says one, two.' }]);
	});

	it('gives Claude a picture of a note, and other providers its words only', async () => {
		const pictureTurn = stream([start(0, { type: 'tool_use', id: 'toolu_2', name: 'view_note', input: {} }), delta(0, { type: 'input_json_delta', partial_json: '{"path":"A.oi"}' }), stop(0), end('tool_use')]);
		const responseList = [pictureTurn, claudeAnswer('It looks fine.')];
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'Look' }] }];
		await runAgent({ connection: claude, system: '', turnList, toolList, web: false, signal: new AbortController().signal, fetch: async () => responseList.shift()!, onToolCall: async () => ({ text: 'A.oi as drawn:', picture: 'iVBOR' }) });
		expect(turnList[2]!.content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'A.oi as drawn:' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] });
		// in the chat shape, the same conversation is messages and tool results
		expect(openAIMessageList('GUIDE', turnList)).toEqual([
			{ role: 'system', content: 'GUIDE' },
			{ role: 'user', content: 'Look' },
			{ role: 'assistant', content: null, tool_calls: [{ id: 'toolu_2', type: 'function', function: { name: 'view_note', arguments: '{"path":"A.oi"}' } }] },
			{ role: 'tool', tool_call_id: 'toolu_2', content: 'A.oi as drawn:' },
			{ role: 'assistant', content: 'It looks fine.' },
		]);
	});

	it('runs tool calls streamed in the OpenAI shape', async () => {
		const local = { provider: 'Ollama', key: '', model: 'llama', baseUrl: 'http://localhost:11434/v1' };
		const first = stream([
			{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'search_notes', arguments: '{"query":' } }] } }] },
			{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"SN2"}' } }] } }] },
			{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
			'[DONE]',
		]);
		const second = stream([{ choices: [{ delta: { content: 'In Chem/SN2.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']);
		const responseList = [first, second];
		const bodyList: Record<string, any>[] = [];
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'Where?' }] }];
		const callList: unknown[] = [];
		await runAgent({
			connection: local,
			system: 'GUIDE',
			turnList,
			toolList,
			web: true,
			signal: new AbortController().signal,
			fetch: async (_url, init) => {
				bodyList.push(JSON.parse(String(init?.body)));
				return responseList.shift()!;
			},
			onToolCall: async (call) => (callList.push(call), { text: 'Chem/SN2.oi: SN2' }),
		});
		expect(callList).toEqual([{ id: 'call_a', name: 'search_notes', input: { query: 'SN2' } }]);
		// no picture tool, no web search where Claude isn't the provider
		expect(bodyList[0]!.tools.map((tool: { function: { name: string } }) => tool.function.name)).not.toContain('view_note');
		expect(bodyList[1]!.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_a', content: 'Chem/SN2.oi: SN2' });
		expect(turnList.at(-1)!.content).toEqual([{ type: 'text', text: 'In Chem/SN2.' }]);
	});

	it('gives DeepSeek its reasoning back while tools are in use, and no one else', async () => {
		const deepSeek = { provider: 'DeepSeek', key: 'sk', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' };
		const first = stream([
			{ choices: [{ delta: { reasoning_content: 'Search ' } }] },
			{ choices: [{ delta: { reasoning_content: 'first.' } }] },
			{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'search_notes', arguments: '{"query":"SN2"}' } }] } }] },
			{ choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
			'[DONE]',
		]);
		const second = stream([{ choices: [{ delta: { content: 'Found.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']);
		const responseList = [first, second];
		const bodyList: Record<string, any>[] = [];
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'Where?' }] }];
		await runAgent({
			connection: deepSeek,
			system: 'GUIDE',
			turnList,
			toolList,
			web: false,
			signal: new AbortController().signal,
			fetch: async (_url, init) => (bodyList.push(JSON.parse(String(init?.body))), responseList.shift()!),
			onToolCall: async () => ({ text: 'Chem/SN2.oi' }),
		});
		expect(turnList[1]!.content[0]).toEqual({ type: 'reasoning', text: 'Search first.' });
		expect(bodyList[1]!.messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'Search first.' });
		// another server never gets the field, and Claude never reads another's reasoning
		expect(openAIMessageList('GUIDE', turnList)[2]).not.toHaveProperty('reasoning_content');
		const forClaude = anthropicRequest({ connection: claude, system: '', turnList, toolList: [], web: false } as never).body as { messages: { content: { type: string }[] }[] };
		expect(forClaude.messages[1]!.content.map((block) => block.type)).toEqual(['tool_use']);
	});

	it('answers every call when stopped, so the conversation can go on', async () => {
		const controller = new AbortController();
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'Go' }] }];
		const twoCall = stream([start(0, { type: 'tool_use', id: 'a', name: 'list_files', input: {} }), stop(0), start(1, { type: 'tool_use', id: 'b', name: 'list_files', input: {} }), stop(1), end('tool_use')]);
		const result = await runAgent({
			connection: claude,
			system: '',
			turnList,
			toolList,
			web: false,
			signal: controller.signal,
			fetch: async () => twoCall,
			onToolCall: async () => {
				controller.abort();
				throw new DOMException('Stopped', 'AbortError');
			},
		});
		expect(result).toBe('Stopped');
		expect(turnList.at(-1)!.content.map((block) => [block.tool_use_id, block.is_error])).toEqual([
			['a', true],
			['b', true],
		]);
	});

	it('tells the AI how to work, the skills by one line, and its memory', () => {
		const text = agentGuide([{ type: 'Table', module: 'Table', content: 'Raw', aliasList: [], guide: 'Rows of data, as CSV. More.\n\n<example>\nTable:\n</example>', exampleList: [] }], '- Answers in French.', 'Chemistry');
		expect(text).toContain('# Working in the vault');
		expect(text).toContain('their vault “Chemistry”');
		expect(text).toContain('- Table: Rows of data, as CSV.');
		expect(text).not.toContain('<example>');
		expect(text).toMatch(/# Your memory of this vault .*\n\n- Answers in French\.$/);
		expect(agentGuide([], '', undefined)).not.toContain('# Your memory');
	});

	it('keeps chats by time and names them by their first request', () => {
		expect(newChatId(new Date(2026, 10, 10, 14, 32, 5))).toMatch(/^20261110-143205-[a-z0-9]{4}$/);
		expect(titleOf([{ role: 'user', content: [{ type: 'text', text: 'Fix the tables in Lecture 05\n\n<context>The note on screen: A.oi</context>\n\n<mode>Manual</mode>' }] }])).toBe('Fix the tables in Lecture 05');
		expect(chatPath('abc')).toBe('.oi/AI/Chat/abc.json');
	});
});

describe('AI with OpenAI', () => {
	const events = (list: Record<string, unknown>[]): Response => new Response(list.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join(''));

	it('works through /responses (tools with reasoning), giving its reasoning and the call results back', async () => {
		const bodyList: Record<string, any>[] = [];
		const urlList: string[] = [];
		const responseList = [
			events([
				{ type: 'response.output_item.added', item: { id: 'rs_1', type: 'reasoning' } },
				{ type: 'response.output_item.done', item: { id: 'rs_1', type: 'reasoning', encrypted_content: 'SECRET', summary: [] } },
				{ type: 'response.output_item.added', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '' } },
				{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":' },
				{ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"Lecture.oi"}' },
				{ type: 'response.output_item.done', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"Lecture.oi"}' } },
				{ type: 'response.completed', response: { status: 'completed' } },
			]),
			events([
				{ type: 'response.output_item.added', item: { id: 'msg_1', type: 'message' } },
				{ type: 'response.output_text.delta', item_id: 'msg_1', delta: 'It says ' },
				{ type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Two.' },
				{ type: 'response.completed', response: { status: 'completed' } },
			]),
		];
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'What is in Lecture?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }];
		const callList: string[] = [];
		const stop = await runAgent({
			connection: { provider: 'OpenAI', key: 'sk', model: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1', effort: 'High' },
			system: 'GUIDE',
			turnList,
			toolList: toolList.filter((tool) => tool.name === 'read_file'),
			web: false,
			signal: new AbortController().signal,
			fetch: (async (url: unknown, init?: RequestInit) => (urlList.push(String(url)), bodyList.push(JSON.parse(String(init?.body))), responseList.shift()!)) as typeof fetch,
			onToolCall: async (call) => (callList.push(`${call.name} ${JSON.stringify(call.input)}`), { text: 'Two.' }),
		});
		expect(stop).toBe('End');
		expect(urlList).toEqual(['https://api.openai.com/v1/responses', 'https://api.openai.com/v1/responses']);
		expect(bodyList[0]).toMatchObject({ model: 'gpt-6-luna', instructions: 'GUIDE', store: false, reasoning: { effort: 'high' }, tools: [{ type: 'function', name: 'read_file' }] });
		expect(bodyList[0]!.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'What is in Lecture?' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }]);
		expect(callList).toEqual(['read_file {"path":"Lecture.oi"}']);
		// the second request: the reasoning as it came, the call, and its output
		expect(bodyList[1]!.input.slice(1)).toEqual([
			{ id: 'rs_1', type: 'reasoning', encrypted_content: 'SECRET', summary: [] },
			{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"Lecture.oi"}' },
			{ type: 'function_call_output', call_id: 'call_1', output: 'Two.' },
		]);
		expect(turnList.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'It says Two.' }] });
	});

	it('keeps the chat messages for other servers of the OpenAI shape', () => {
		expect(usesResponses({ provider: 'OpenAI', key: 'k', model: 'm', baseUrl: 'https://api.openai.com/v1' })).toBe(true);
		expect(usesResponses({ provider: 'DeepSeek', key: 'k', model: 'm', baseUrl: 'https://api.deepseek.com' })).toBe(false);
		expect(usesResponses({ provider: 'Custom', key: 'k', model: 'm', baseUrl: 'https://gateway.example.com/v1' })).toBe(false);
	});
});

describe('AI attachments', () => {
	it('sends a picture to the OpenAI shape as a data URL, in one message with the words', () => {
		const turnList: Turn[] = [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' }, title: 'paper.pdf' }] }];
		const [, user] = openAIMessageList('GUIDE', turnList);
		expect(user).toEqual({
			role: 'user',
			content: [
				{ type: 'text', text: 'What is this?' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
				{ type: 'text', text: '(A PDF was attached: paper.pdf. This model can’t read it here; say so if it matters.)' },
			],
		});
		// words alone stay one plain message
		expect(openAIMessageList('GUIDE', [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }])[1]).toEqual({ role: 'user', content: 'a\n\nb' });
	});
});

describe('AI chat', () => {
	function mount(vault = memoryVault({ 'Lecture.oi': 'Two.\n' }), setting: Record<string, unknown> = {}): { element: HTMLElement; vault: ReturnType<typeof memoryVault>; tab: PanelTab & { state: string; title: string }; destroy(): void } {
		const element = document.createElement('div');
		document.body.append(element);
		const editor: NoteEditor = { capture: () => undefined, preview: (target) => ({ update: (source) => void (target.textContent = source), destroy: () => undefined }) };
		const extensionMap = new Map<string, unknown>([
			['VaultFile', vault],
			['NoteEditor', editor],
			['BlockGuide', guide],
			['Command', { list: () => commandList, run: () => true }],
		]);
		const context = { extension: (name: string) => extensionMap.get(name), setting: (id: string) => setting[id] } as unknown as HostContext;
		const tab = {
			state: '',
			title: '',
			setState(state: string) {
				this.state = state;
			},
			setTitle(title: string) {
				this.title = title;
			},
			isShown: () => true,
		};
		const handle = mountChat(context, element, '', tab);
		return { element, vault, tab, destroy: handle.destroy };
	}

	const settle = async (round = 30): Promise<void> => {
		for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
	};
	const send = (element: HTMLElement, text: string): void => {
		const ask = element.querySelector<HTMLTextAreaElement>('.oi-composer textarea')!;
		ask.value = text;
		ask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	};
	const writeTurn = (): Response => stream([start(0, { type: 'tool_use', id: 'toolu_w', name: 'edit_file', input: {} }), delta(0, { type: 'input_json_delta', partial_json: '{"path":"Lecture.oi","old_text":"Two.","new_text":"Math: x^2"}' }), stop(0), end('tool_use')]);

	it('in Manual mode shows each change with its diff, and makes it only when allowed', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' });
		const responseList = [writeTurn(), claudeAnswer('Done: the line is an equation.')];
		const bodyList: Record<string, any>[] = [];
		vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => (bodyList.push(JSON.parse(String(init.body))), responseList.shift()!));
		const { element, vault, tab } = mount();
		expect(element.querySelector('.oi-composer-mode [aria-checked="true"]')!.textContent).toBe('Manual');
		send(element, 'Make the second line an equation');
		await settle();
		// waiting: the diff shows, the file is as it was
		const card = element.querySelector('.oi-chat-approve')!;
		expect(card.querySelector('.oi-chat-approve-title')!.textContent).toBe('Edit Lecture.oi');
		expect(card.querySelector('.oi-chat-diff-remove')!.textContent).toBe('− Two.');
		expect(card.querySelector('.oi-chat-diff-add')!.textContent).toBe('+ Math: x^2');
		expect(vault.fileMap.get('Lecture.oi')).toBe('Two.\n');
		card.querySelector<HTMLButtonElement>('[data-approve="Allow"]')!.click();
		await settle();
		expect(vault.fileMap.get('Lecture.oi')).toBe('Math: x^2\n');
		expect(element.querySelector('.oi-chat-answer')!.textContent).toBe('Done: the line is an equation.');
		// the message said where the user was and the mode; the AI read its guide with the memory
		expect(bodyList[0]!.messages[0].content[0].text).toContain('<context>The note on screen: Lecture.oi</context>');
		expect(bodyList[0]!.messages[0].content[0].text).toContain('<mode>Manual:');
		// Undo puts it back
		element.querySelector<HTMLButtonElement>('[data-undo="toolu_w"]')!.click();
		await settle();
		expect(vault.fileMap.get('Lecture.oi')).toBe('Two.\n');
		expect(element.querySelector('.oi-chat-tool[data-kind="Change"] .oi-chat-tag')!.textContent).toBe('Undone');
		// kept in the vault, and the tab knows which chat it is
		await new Promise((done) => setTimeout(done, 350));
		expect(tab.state).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
		expect(tab.title).toBe('Make the second line an equation');
		const saved = JSON.parse(vault.fileMap.get(chatPath(tab.state))!);
		expect(saved.turnList).toHaveLength(5);
		expect((await chatList(vault)).map((item) => item.title)).toEqual(['Make the second line an equation']);
	});

	it('tells the AI when a change is denied, with the reason', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' });
		const responseList = [writeTurn(), claudeAnswer('All right, I left it.')];
		const bodyList: Record<string, any>[] = [];
		vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => (bodyList.push(JSON.parse(String(init.body))), responseList.shift()!));
		const { element, vault } = mount();
		send(element, 'Change it');
		await settle();
		element.querySelector<HTMLInputElement>('.oi-chat-reason')!.value = 'Keep it as text';
		element.querySelector<HTMLButtonElement>('[data-approve="Deny"]')!.click();
		await settle();
		expect(vault.fileMap.get('Lecture.oi')).toBe('Two.\n');
		const result = bodyList[1]!.messages.at(-1).content[0];
		expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_w', is_error: true });
		expect(result.content[0].text).toContain('They said: Keep it as text');
		expect(element.querySelector('.oi-chat-tool[data-kind="Change"]')!.getAttribute('data-state')).toBe('Declined');
	});

	it('in Plan mode only looks, then offers to carry the plan out', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' });
		const responseList = [claudeAnswer('1. Make the line an equation.'), writeTurn(), claudeAnswer('Done.')];
		const bodyList: Record<string, any>[] = [];
		vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => (bodyList.push(JSON.parse(String(init.body))), responseList.shift()!));
		const { element, vault } = mount(undefined, { 'AI.Mode': 'Plan' });
		send(element, 'Plan it');
		await settle();
		const toolNameList = bodyList[0]!.tools.map((tool: { name: string }) => tool.name);
		expect(toolNameList).toContain('read_file');
		expect(toolNameList).not.toContain('edit_file');
		expect(bodyList[0]!.messages[0].content[0].text).toContain('<mode>Plan:');
		// carried out without asking: the change is made at once
		element.querySelector<HTMLButtonElement>('[data-carry="Auto"]')!.click();
		await settle();
		expect(element.querySelector('.oi-composer-mode [aria-checked="true"]')!.textContent).toBe('Auto');
		expect(bodyList[1]!.messages.at(-1).content[0].text).toContain('<mode>Auto:');
		expect(element.querySelector('.oi-chat-approve')).toBeNull();
		expect(vault.fileMap.get('Lecture.oi')).toBe('Math: x^2\n');
	});

	it('says so without a connection, and opens Setting → AI instead of sending', async () => {
		const ranList: unknown[][] = [];
		const element = document.createElement('div');
		const context = { extension: (name: string) => (name === 'Command' ? { list: () => [], run: (id: string, argument?: unknown) => (ranList.push([id, argument]), true) } : name === 'VaultFile' ? memoryVault() : undefined), setting: () => undefined } as unknown as HostContext;
		mountChat(context, element, '', { setState: () => undefined, setTitle: () => undefined, isShown: () => true });
		expect(element.querySelector('.oi-composer-note')!.textContent).toContain('No AI is connected.');
		expect(element.querySelector('.oi-composer-model')!.textContent).toBe('Connect an AI');
		send(element, 'Hi');
		expect(ranList).toEqual([['Setting.Open', 'Module:AI']]);
	});

	it('has everything at the bottom: the mode as equal tabs with icons, the model with its effort, a square Send', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1', effort: 'High' });
		const { element } = mount();
		expect(element.querySelector('.oi-chat-head, header')).toBeNull();
		const bar = element.querySelector('.oi-composer-bar')!;
		expect([...bar.querySelectorAll('[data-action]')].map((button) => (button as HTMLElement).dataset.action)).toEqual(['Attach', 'History', 'New', 'Memory', 'Model', 'Send']);
		expect([...bar.querySelectorAll('.oi-composer-mode button')].map((button) => button.querySelector('svg') !== null && button.textContent)).toEqual(['Manual', 'Plan', 'Auto']);
		expect(bar.querySelector('.oi-composer-model')!.textContent).toBe('Opus 5.5 · High');
		const sendButton = bar.querySelector<HTMLButtonElement>('.oi-composer-send')!;
		expect(sendButton.querySelector('svg')).not.toBeNull();
		expect(sendButton.disabled).toBe(true);
	});

	it('picks the model and the effort in one panel: the models by name, the effort as a slider', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1', modelList: [{ id: 'claude-sonnet-5-5', title: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', title: 'Claude Opus 5.5' }] });
		const { element } = mount();
		const button = element.querySelector<HTMLButtonElement>('.oi-composer-model')!;
		expect(button.textContent).toBe('Opus 5.5');
		button.click();
		const picker = (): HTMLElement | null => document.querySelector<HTMLElement>('.oi-model-menu');
		expect([...picker()!.querySelectorAll('.oi-model-row')].map((row) => row.querySelector('.oi-model-name span')!.textContent)).toEqual(['Opus 5.5', 'Sonnet 5.5']);
		expect(picker()!.querySelector('.oi-effort')!.getAttribute('aria-valuetext')).toBe('Default');
		// the effort changes at once, and the picker stays
		picker()!.querySelector<HTMLElement>('[data-effort="High"]')!.click();
		expect(currentConnection()!.effort).toBe('High');
		expect(button.textContent).toBe('Opus 5.5 · High');
		expect(picker()!.querySelector('.oi-model-effort-name')!.textContent).toBe('Effort (High)');
		// → moves it one stop
		picker()!.querySelector<HTMLElement>('.oi-effort')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
		expect(currentConnection()!.effort).toBe('ExtraHigh');
		// a model closes it
		picker()!.querySelector<HTMLElement>('[data-model="claude-sonnet-5-5"]')!.click();
		expect(picker()).toBeNull();
		expect(currentConnection()!.model).toBe('claude-sonnet-5-5');
		expect(button.textContent).toBe('Sonnet 5.5 · Extra high');
	});

	it('attaches a text file and a picture: the text goes in the message, the picture is copied beside the chat', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' });
		const bodyList: Record<string, any>[] = [];
		vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => (bodyList.push(JSON.parse(String(init.body))), claudeAnswer('Seen.')));
		const { element, vault, tab } = mount();
		const input = element.querySelector<HTMLInputElement>('.oi-chat-file')!;
		const fileList = [new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' }), new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })];
		Object.defineProperty(input, 'files', { value: fileList, configurable: true });
		input.dispatchEvent(new Event('change'));
		await settle();
		expect([...element.querySelectorAll('.oi-composer-chip')].map((chip) => chip.textContent)).toEqual(['Lecture', 'data.csv · 1 KB', 'shot.png · 1 KB']);
		send(element, 'What is in these?');
		await settle();
		const content = bodyList[0]!.messages[0].content as { type: string; text?: string; source?: { data: string } }[];
		expect(content.map((block) => block.type)).toEqual(['text', 'text', 'image']);
		expect(content[1]!.text).toContain('<attached_file name="data.csv">');
		expect(content[2]!.source!.data).toBe('iVBORw==');
		// the picture is a copy beside the chat, never among the notes; the chat names it
		const copy = [...vault.fileMap.keys()].find((path) => path.startsWith(`.oi/AI/Attachment/${tab.state}/`));
		expect(copy).toBeDefined();
		expect(vault.fileMap.get(copy!)).toBe('iVBORw==');
		expect(element.querySelector('.oi-chat-user-file')!.textContent).toBe('data.csv · 1 KBshot.png · 1 KB');
	});

	it('keeps chats in a list in place of the conversation: open one, rename, archive, and delete it with its files', async () => {
		saveConnection({ provider: 'Anthropic', key: 'sk', model: 'claude-opus-5-5', baseUrl: 'https://api.anthropic.com/v1' });
		vi.stubGlobal('fetch', async () => claudeAnswer('Hello.'));
		const vault = memoryVault({ 'Lecture.oi': 'Two.\n', '.oi/AI/Chat/20261101-100000-aaaa.json': JSON.stringify({ title: 'Older chat', updated: '2026-11-01T10:00:00.000Z', turnList: [{ role: 'user', content: [{ type: 'text', text: 'Old question' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Old answer' }] }] }), '.oi/AI/Attachment/20261101-100000-aaaa/0-a.png.txt': 'xx' });
		const { element, tab } = mount(vault);
		send(element, 'Say hello');
		await settle();
		await new Promise((done) => setTimeout(done, 350));
		const click = (selector: string): void => element.querySelector<HTMLElement>(selector)!.click();
		click('[data-action="History"]');
		await settle();
		const titleList = (): string[] => [...element.querySelectorAll('.oi-chat-history-title')].map((item) => item.textContent ?? '');
		expect(element.querySelector<HTMLElement>('.oi-chat-list')!.hidden).toBe(true);
		expect(titleList()).toEqual(['Say hello', 'Older chat']);
		// open the older one, here
		click('[data-open="20261101-100000-aaaa"]');
		await settle();
		expect(tab.state).toBe('20261101-100000-aaaa');
		expect(element.querySelector('.oi-chat-user')!.textContent).toBe('Old question');
		// rename it
		click('[data-action="History"]');
		await settle();
		click('[data-history="Rename"][data-id="20261101-100000-aaaa"]');
		const field = element.querySelector<HTMLInputElement>('[data-rename]')!;
		field.value = 'Renamed';
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle();
		expect(titleList()).toContain('Renamed');
		// archive the first: out of the list, in Archived
		const first = vault.fileMap.has('.oi/AI/Chat/20261101-100000-aaaa.json');
		expect(first).toBe(true);
		const other = titleList().indexOf('Say hello');
		const otherId = element.querySelectorAll<HTMLElement>('[data-open]')[other]!.dataset.open!;
		click(`[data-history="Archive"][data-id="${otherId}"]`);
		await settle();
		expect(titleList()).toEqual(['Renamed']);
		expect(vault.fileMap.has(`.oi/AI/Chat/Archive/${otherId}.json`)).toBe(true);
		click('[data-history-tab="Archive"]');
		await settle();
		expect(titleList()).toEqual(['Say hello']);
		click('[data-history-tab="Chat"]');
		await settle();
		// delete for good, with its attached files
		click('[data-history="Delete"][data-id="20261101-100000-aaaa"]');
		await settle();
		expect(vault.fileMap.has('.oi/AI/Chat/20261101-100000-aaaa.json')).toBe(false);
		expect([...vault.fileMap.keys()].some((path) => path.startsWith('.oi/AI/Attachment/20261101-100000-aaaa'))).toBe(false);
		expect(titleList()).toEqual([]);
	});
});
