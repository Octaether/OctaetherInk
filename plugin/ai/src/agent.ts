// The AI at work: it answers, asks for tools, gets their results, and goes on until it is done, as
// Claude Code does. A conversation is kept in Anthropic's own shape (content blocks), exactly as
// the API sent it, and only ever added to: thinking, web search results, and tool calls go back to
// the API unchanged on the next request, which is what Claude's thinking needs. For the OpenAI shape
// (OpenAI, Gemini, OpenRouter, Ollama…) the same conversation is written as chat messages.

import { tr } from '@octaether/core-sdk';
import { type Connection, hostOf, providerOf } from './connection';
import { ProviderError, effortBody, fallbackModel, header, outputRoom, post, readEventStream } from './provider';
import type { ToolDefinition, ToolOutput } from './tool';

/** A content block as Anthropic's API has it: text, thinking, tool_use, tool_result, image, server tools' blocks. */
export type Block = { type: string } & Record<string, unknown>;

export interface Turn {
	role: 'user' | 'assistant';
	content: Block[];
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

/** End: done. Length: cut at the model's limit. Refusal: declined. Stopped: you stopped it. Limit: too many rounds of tools. */
export type AgentStop = 'End' | 'Length' | 'Refusal' | 'Stopped' | 'Limit';

export interface AgentRun {
	connection: Connection;
	system: string;
	/** The conversation: turns are added to it as they come. */
	turnList: Turn[];
	toolList: readonly ToolDefinition[];
	/** Claude's own web search and web fetch, run by Anthropic. */
	web: boolean;
	signal: AbortSignal;
	fetch?: typeof fetch;
	/** A block began (text, thinking, a tool call, a web search…). */
	onBlock?(block: Block): void;
	onText?(text: string): void;
	/** The assistant's turn grew or a turn was added: draw it, save it. */
	onChange?(): void;
	/** Runs a tool call (asking first, in Manual mode) and gives its result. */
	onToolCall(call: ToolCall): Promise<ToolOutput>;
	/** At most this many rounds of tools before it stops and says so. */
	roundLimit?: number;
	/** The conversation as the API reads it (attachments turned into their blocks); `turnList` as it is without. */
	expand?(turnList: readonly Turn[]): Promise<Turn[]>;
}

/** The models that have Anthropic's newest web search and fetch (with filtering of results). */
const newWebModel = /^claude-(?:opus|sonnet|fable|mythos)-(?:[5-9]|4-[6-9])/;

function webToolList(model: string): Block[] {
	if (newWebModel.test(model)) return [{ type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' }];
	return [{ type: 'web_search_20250305', name: 'web_search' }];
}

/** A tool result block for the API. */
export function toolResultBlock(id: string, output: ToolOutput, picture: boolean): Block {
	const content: Block[] = [{ type: 'text', text: output.text || '(empty)' }];
	if (picture && output.picture) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: output.picture } });
	return { type: 'tool_result', tool_use_id: id, content, ...(output.isError ? { is_error: true } : {}) };
}

// ---------------------------------------------------------------- Anthropic

export function anthropicRequest(run: Pick<AgentRun, 'connection' | 'system' | 'turnList' | 'toolList' | 'web'>): { url: string; header: Record<string, string>; body: Record<string, unknown> } {
	const { connection } = run;
	const toolList: Record<string, unknown>[] = run.toolList.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.schema, eager_input_streaming: true }));
	if (run.web) toolList.push(...webToolList(connection.model));
	return {
		url: `${connection.baseUrl.replace(/\/+$/, '')}/messages`,
		header: header(connection),
		body: {
			model: connection.model,
			max_tokens: Math.min(outputRoom, connection.outputLimit ?? outputRoom),
			stream: true,
			// the guide and the tools never change between requests, and the conversation only grows: both are cached
			system: [{ type: 'text', text: run.system, cache_control: { type: 'ephemeral' } }],
			cache_control: { type: 'ephemeral' },
			// another provider's reasoning (a chat begun with DeepSeek) is not Claude's to read back
			messages: run.turnList.map((turn) => ({ role: turn.role, content: turn.content.filter((block) => block.type !== 'reasoning' && block.type !== 'openai_item') })),
			...(toolList.length > 0 ? { tools: toolList } : {}),
			...(fallbackModel.test(connection.model) ? { fallbacks: 'default' } : {}),
			...effortBody(connection),
		},
	};
}

/** One assistant turn from Anthropic, its blocks gathered as they stream (thinking's signature, tools' input). */
async function anthropicTurn(run: AgentRun): Promise<{ content: Block[]; stop: string }> {
	const response = await post(run.connection, (connection) => anthropicRequest({ ...run, connection }), run.signal, run.fetch ?? fetch);
	if (!response.body) throw new ProviderError('Server', tr`${hostOf(run.connection)} sent no answer.`);
	const blockList: Block[] = [];
	const partialMap = new Map<number, string>();
	let stop = 'end_turn';
	for await (const { data } of readEventStream(response.body)) {
		let event: Record<string, any>;
		try {
			event = JSON.parse(data) as Record<string, any>;
		} catch {
			continue;
		}
		if (event.type === 'error') throw new ProviderError('Server', `${tr`${hostOf(run.connection)} stopped the answer.`}${event.error?.message ? ` (${event.error.message})` : ''}`);
		if (event.type === 'content_block_start') {
			const block = { ...(event.content_block as Block) };
			blockList[event.index as number] = block;
			if ('input' in block && (block.type === 'tool_use' || block.type === 'server_tool_use')) partialMap.set(event.index as number, '');
			run.onBlock?.(block);
		} else if (event.type === 'content_block_delta') {
			const block = blockList[event.index as number];
			const delta = event.delta as Record<string, any>;
			if (!block) continue;
			if (delta.type === 'text_delta') {
				block.text = `${String(block.text ?? '')}${delta.text}`;
				run.onText?.(String(delta.text));
			} else if (delta.type === 'thinking_delta') block.thinking = `${String(block.thinking ?? '')}${delta.thinking}`;
			else if (delta.type === 'signature_delta') block.signature = delta.signature;
			else if (delta.type === 'input_json_delta') partialMap.set(event.index as number, `${partialMap.get(event.index as number) ?? ''}${delta.partial_json}`);
			else if (delta.type === 'citations_delta') block.citations = [...((block.citations as unknown[]) ?? []), delta.citation];
		} else if (event.type === 'content_block_stop') {
			const partial = partialMap.get(event.index as number);
			const block = blockList[event.index as number];
			if (partial !== undefined && block) {
				try {
					block.input = partial.trim() === '' ? {} : JSON.parse(partial);
				} catch {
					// cut off or broken: the call gets an error result instead of running
					block.input = {};
					block.oiBroken = true;
				}
				partialMap.delete(event.index as number);
			}
			run.onChange?.();
		} else if (event.type === 'message_delta' && event.delta?.stop_reason) stop = String(event.delta.stop_reason);
	}
	return { content: blockList.filter(Boolean), stop };
}

// ---------------------------------------------------------------- OpenAI's shape

/**
 * The conversation as chat messages: text, tool calls, and tool results (pictures and thinking are Claude's only).
 * `reasoning`: give each answer's reasoning back as `reasoning_content`, which DeepSeek's thinking needs with tools
 * (it answers 400 without it); other servers don't know the field.
 */
export function openAIMessageList(system: string, turnList: readonly Turn[], reasoning = false): Record<string, unknown>[] {
	const list: Record<string, unknown>[] = [{ role: 'system', content: system }];
	for (const turn of turnList) {
		if (turn.role === 'assistant') {
			const text = turn.content.filter((block) => block.type === 'text').map((block) => String(block.text ?? '')).join('');
			const callList = turn.content.filter((block) => block.type === 'tool_use').map((block) => ({ id: String(block.id), type: 'function', function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) } }));
			const thought = turn.content.filter((block) => block.type === 'reasoning').map((block) => String(block.text ?? '')).join('');
			list.push({ role: 'assistant', content: text || null, ...(reasoning && thought ? { reasoning_content: thought } : {}), ...(callList.length > 0 ? { tool_calls: callList } : {}) });
			continue;
		}
		// what you wrote and attached is one message; pictures go as data URLs (a PDF only Claude reads)
		const partList: Record<string, unknown>[] = [];
		const flush = (): void => {
			if (partList.length === 0) return;
			const plain = partList.every((part) => part.type === 'text');
			list.push({ role: 'user', content: plain ? partList.map((part) => String(part.text)).join('\n\n') : [...partList] });
			partList.length = 0;
		};
		for (const block of turn.content) {
			if (block.type === 'tool_result') {
				flush();
				const text = ((block.content as Block[] | undefined) ?? []).filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n');
				list.push({ role: 'tool', tool_call_id: String(block.tool_use_id), content: block.is_error ? `Error: ${text}` : text });
			} else if (block.type === 'text') partList.push({ type: 'text', text: String(block.text ?? '') });
			else if (block.type === 'image') {
				const source = block.source as { media_type?: string; data?: string } | undefined;
				if (source?.data) partList.push({ type: 'image_url', image_url: { url: `data:${source.media_type ?? 'image/png'};base64,${source.data}` } });
			} else if (block.type === 'document') partList.push({ type: 'text', text: `(A PDF was attached${block.title ? `: ${String(block.title)}` : ''}. This model can’t read it here; say so if it matters.)` });
		}
		flush();
	}
	return list;
}

/** DeepSeek wants its reasoning given back while tools are in use: its own API, or a server at its address. */
function sendsReasoningBack(connection: Connection): boolean {
	return connection.provider === 'DeepSeek' || /(^|\.)deepseek\.com/.test(hostOf(connection));
}

export function openAIRequest(run: Pick<AgentRun, 'connection' | 'system' | 'turnList' | 'toolList'>): { url: string; header: Record<string, string>; body: Record<string, unknown> } {
	const toolList = run.toolList.filter((tool) => !tool.picture).map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } }));
	return {
		url: `${run.connection.baseUrl.replace(/\/+$/, '')}/chat/completions`,
		header: header(run.connection),
		body: { model: run.connection.model, stream: true, messages: openAIMessageList(run.system, run.turnList, sendsReasoningBack(run.connection)), ...(toolList.length > 0 ? { tools: toolList } : {}), ...effortBody(run.connection) },
	};
}

async function openAITurn(run: AgentRun): Promise<{ content: Block[]; stop: string }> {
	const response = await post(run.connection, (connection) => openAIRequest({ ...run, connection }), run.signal, run.fetch ?? fetch);
	if (!response.body) throw new ProviderError('Server', tr`${hostOf(run.connection)} sent no answer.`);
	const text: Block = { type: 'text', text: '' };
	const thought: Block = { type: 'reasoning', text: '' };
	const callList: { id: string; name: string; argument: string }[] = [];
	let stop = 'end_turn';
	let started = false;
	for await (const { data } of readEventStream(response.body)) {
		if (data === '[DONE]') break;
		let event: Record<string, any>;
		try {
			event = JSON.parse(data) as Record<string, any>;
		} catch {
			continue;
		}
		if (event.error) throw new ProviderError('Server', `${tr`${hostOf(run.connection)} stopped the answer.`} (${typeof event.error === 'string' ? event.error : (event.error.message ?? '')})`);
		const choice = event.choices?.[0];
		if (!choice) continue;
		// DeepSeek and others send their thinking as reasoning_content (OpenRouter: reasoning)
		const thinking = (choice.delta?.reasoning_content ?? choice.delta?.reasoning) as string | null | undefined;
		if (thinking) {
			if (String(thought.text) === '') run.onBlock?.(thought);
			thought.text = `${String(thought.text)}${thinking}`;
		}
		const piece = choice.delta?.content as string | null | undefined;
		if (piece) {
			if (!started) {
				started = true;
				run.onBlock?.(text);
			}
			text.text = `${String(text.text)}${piece}`;
			run.onText?.(piece);
		}
		for (const part of (choice.delta?.tool_calls ?? []) as { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]) {
			const index = part.index ?? callList.length;
			callList[index] ??= { id: part.id ?? `call_${index}_${Date.now().toString(36)}`, name: '', argument: '' };
			if (part.id) callList[index]!.id = part.id;
			if (part.function?.name) callList[index]!.name += part.function.name;
			if (part.function?.arguments) callList[index]!.argument += part.function.arguments;
		}
		if (choice.finish_reason) stop = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason === 'content_filter' ? 'refusal' : 'end_turn';
	}
	const content: Block[] = [...(String(thought.text) !== '' ? [thought] : []), ...(String(text.text) !== '' ? [text] : [])];
	for (const call of callList.filter(Boolean)) {
		let input: Record<string, unknown> = {};
		let broken = false;
		try {
			input = call.argument.trim() === '' ? {} : (JSON.parse(call.argument) as Record<string, unknown>);
		} catch {
			broken = true;
		}
		const block: Block = { type: 'tool_use', id: call.id, name: call.name, input, ...(broken ? { oiBroken: true } : {}) };
		run.onBlock?.(block);
		content.push(block);
	}
	if (callList.length > 0) stop = 'tool_use';
	return { content, stop };
}

// ---------------------------------------------------------------- OpenAI's Responses API

/**
 * OpenAI's own models take tools together with reasoning only through /responses, its newer API
 * (/chat/completions refuses "function tools with reasoning_effort"). Every other provider of the
 * OpenAI shape keeps the chat messages.
 */
export function usesResponses(connection: Connection): boolean {
	return connection.provider === 'OpenAI' && /(^|\.)openai\.com$/.test(hostOf(connection));
}

/** The conversation as Responses input items: messages, function calls and their outputs, the model's reasoning as it sent it. */
export function responsesInput(turnList: readonly Turn[]): Record<string, unknown>[] {
	const list: Record<string, unknown>[] = [];
	for (const turn of turnList) {
		if (turn.role === 'assistant') {
			for (const block of turn.content) {
				if (block.type === 'openai_item' && block.item) list.push(block.item as Record<string, unknown>);
				else if (block.type === 'text' && String(block.text ?? '') !== '') list.push({ role: 'assistant', content: String(block.text) });
				else if (block.type === 'tool_use') list.push({ type: 'function_call', call_id: String(block.id), name: String(block.name), arguments: JSON.stringify(block.input ?? {}) });
			}
			continue;
		}
		const partList: Record<string, unknown>[] = [];
		const flush = (): void => {
			if (partList.length === 0) return;
			const plain = partList.every((part) => part.type === 'input_text');
			list.push({ role: 'user', content: plain ? partList.map((part) => String(part.text)).join('\n\n') : [...partList] });
			partList.length = 0;
		};
		for (const block of turn.content) {
			if (block.type === 'tool_result') {
				flush();
				const text = ((block.content as Block[] | undefined) ?? []).filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n');
				list.push({ type: 'function_call_output', call_id: String(block.tool_use_id), output: block.is_error ? `Error: ${text}` : text });
			} else if (block.type === 'text') partList.push({ type: 'input_text', text: String(block.text ?? '') });
			else if (block.type === 'image' || block.type === 'document') {
				const source = block.source as { media_type?: string; data?: string } | undefined;
				if (!source?.data) continue;
				const url = `data:${source.media_type ?? 'image/png'};base64,${source.data}`;
				partList.push(block.type === 'image' ? { type: 'input_image', image_url: url } : { type: 'input_file', filename: String(block.title ?? 'file.pdf'), file_data: url });
			}
		}
		flush();
	}
	return list;
}

export function responsesRequest(run: Pick<AgentRun, 'connection' | 'system' | 'turnList' | 'toolList'>): { url: string; header: Record<string, string>; body: Record<string, unknown> } {
	const toolList = run.toolList.filter((tool) => !tool.picture).map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.schema }));
	const effort = effortBody(run.connection).reasoning_effort;
	return {
		url: `${run.connection.baseUrl.replace(/\/+$/, '')}/responses`,
		header: header(run.connection),
		body: {
			model: run.connection.model,
			instructions: run.system,
			input: responsesInput(run.turnList),
			stream: true,
			// nothing is kept on OpenAI's side: the reasoning comes back encrypted, to send with the next request
			store: false,
			include: ['reasoning.encrypted_content'],
			...(toolList.length > 0 ? { tools: toolList } : {}),
			...(effort ? { reasoning: { effort } } : {}),
		},
	};
}

async function responsesTurn(run: AgentRun): Promise<{ content: Block[]; stop: string }> {
	const response = await post(run.connection, (connection) => responsesRequest({ ...run, connection }), run.signal, run.fetch ?? fetch);
	if (!response.body) throw new ProviderError('Server', tr`${hostOf(run.connection)} sent no answer.`);
	const content: Block[] = [];
	const textMap = new Map<string, Block>();
	const callMap = new Map<string, Block & { argument: string }>();
	let stop = 'end_turn';
	const fail = (message: unknown): never => {
		throw new ProviderError('Server', `${tr`${hostOf(run.connection)} stopped the answer.`}${message ? ` (${String(message)})` : ''}`);
	};
	for await (const { data } of readEventStream(response.body)) {
		if (data === '[DONE]') break;
		let event: Record<string, any>;
		try {
			event = JSON.parse(data) as Record<string, any>;
		} catch {
			continue;
		}
		const type = String(event.type ?? '');
		if (type === 'error') fail(event.message ?? event.error?.message);
		if (type === 'response.failed') fail(event.response?.error?.message);
		if (type === 'response.output_item.added') {
			const item = event.item as Record<string, any>;
			if (item.type === 'reasoning') run.onBlock?.({ type: 'reasoning' });
			else if (item.type === 'message') {
				const text: Block = { type: 'text', text: '' };
				textMap.set(String(item.id), text);
				content.push(text);
				run.onBlock?.(text);
			} else if (item.type === 'function_call') {
				const call = { type: 'tool_use', id: String(item.call_id ?? item.id), name: String(item.name ?? ''), input: {}, argument: String(item.arguments ?? '') };
				callMap.set(String(item.id), call);
				content.push(call);
			}
		} else if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
			let text = textMap.get(String(event.item_id));
			if (!text) {
				text = { type: 'text', text: '' };
				textMap.set(String(event.item_id), text);
				content.push(text);
				run.onBlock?.(text);
			}
			text.text = `${String(text.text)}${String(event.delta ?? '')}`;
			run.onText?.(String(event.delta ?? ''));
			if (type === 'response.refusal.delta') stop = 'refusal';
		} else if (type === 'response.function_call_arguments.delta') {
			const call = callMap.get(String(event.item_id));
			if (call) call.argument += String(event.delta ?? '');
		} else if (type === 'response.output_item.done') {
			const item = event.item as Record<string, any>;
			// reasoning goes back as it came (encrypted), placed before what it led to
			if (item.type === 'reasoning') content.push({ type: 'openai_item', item });
			else if (item.type === 'function_call') {
				const call = callMap.get(String(item.id));
				if (call && typeof item.arguments === 'string') call.argument = item.arguments;
			}
		} else if (type === 'response.completed' || type === 'response.incomplete') {
			const reason = event.response?.incomplete_details?.reason;
			if (reason === 'max_output_tokens') stop = 'max_tokens';
			else if (reason === 'content_filter') stop = 'refusal';
		}
	}
	const result: Block[] = [];
	for (const block of content) {
		if (block.type === 'text' && String(block.text ?? '') === '') continue;
		if (block.type === 'tool_use') {
			const { argument, ...call } = block as Block & { argument: string };
			try {
				call.input = argument.trim() === '' ? {} : (JSON.parse(argument) as Record<string, unknown>);
			} catch {
				call.oiBroken = true;
			}
			run.onBlock?.(call);
			result.push(call);
			continue;
		}
		result.push(block);
	}
	if (result.some((block) => block.type === 'tool_use') && stop === 'end_turn') stop = 'tool_use';
	return { content: result, stop };
}

// ---------------------------------------------------------------- the loop

/** What may go back to the API from a turn cut off by Stop: whole text, nothing half made. */
function keptOf(blockList: readonly Block[]): Block[] {
	return blockList.filter((block) => block.type === 'text' && String(block.text ?? '').trim() !== '').map((block) => ({ type: 'text', text: block.text }));
}

/** Runs the conversation forward until the AI is done, tools and all. The turns land in `run.turnList`. */
export async function runAgent(run: AgentRun): Promise<AgentStop> {
	const anthropic = providerOf(run.connection.provider).protocol === 'Anthropic';
	const limit = run.roundLimit ?? 40;
	for (let round = 0; ; round++) {
		if (round >= limit) return 'Limit';
		const live: Block[] = [];
		let result: { content: Block[]; stop: string };
		try {
			const sent = run.expand ? await run.expand(run.turnList) : run.turnList;
			result = await (anthropic ? anthropicTurn : usesResponses(run.connection) ? responsesTurn : openAITurn)({
				...run,
				turnList: sent,
				onBlock: (block) => {
					live.push(block);
					run.onBlock?.(block);
				},
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				const kept = keptOf(live);
				if (kept.length > 0) {
					run.turnList.push({ role: 'assistant', content: kept });
					run.onChange?.();
				}
				return 'Stopped';
			}
			throw error;
		}
		// a turn with nothing in it can't go back to the API
		if (result.content.length > 0) run.turnList.push({ role: 'assistant', content: result.content });
		run.onChange?.();
		// Anthropic paused a long turn of its own tools: ask it to go on
		if (result.stop === 'pause_turn') continue;
		const callList = result.content.filter((block) => block.type === 'tool_use');
		if (result.stop !== 'tool_use' || callList.length === 0) return result.stop === 'max_tokens' ? 'Length' : result.stop === 'refusal' ? 'Refusal' : 'End';
		// every call gets a result, in one turn, even when it is stopped
		const resultList: Block[] = [];
		let stopped = false;
		for (const block of callList) {
			const id = String(block.id);
			const picture = anthropic && block.name === 'view_note';
			if (stopped || run.signal.aborted) {
				stopped = true;
				resultList.push(toolResultBlock(id, { text: 'Stopped by the user before this ran.', isError: true }, false));
				continue;
			}
			if (block.oiBroken) {
				resultList.push(toolResultBlock(id, { text: 'The input of this call was cut off or not valid JSON; nothing ran. Try again.', isError: true }, false));
				continue;
			}
			try {
				resultList.push(toolResultBlock(id, await run.onToolCall({ id, name: String(block.name), input: (block.input as Record<string, unknown>) ?? {} }), picture));
			} catch (error) {
				const aborted = error instanceof DOMException && error.name === 'AbortError';
				if (aborted) stopped = true;
				resultList.push(toolResultBlock(id, { text: aborted ? 'Stopped by the user before this ran.' : `Failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }, false));
			}
		}
		run.turnList.push({ role: 'user', content: resultList });
		run.onChange?.();
		if (stopped) return 'Stopped';
	}
}
