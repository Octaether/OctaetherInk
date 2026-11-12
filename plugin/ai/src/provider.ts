// Talking to the AI you connected, straight from this browser: no Octaether server stands between,
// and no library either (two small wire formats, read as they stream).
//   Anthropic   POST {base}/messages          x-api-key, server-sent events (content_block_delta…)
//   OpenAI      POST {base}/chat/completions  Bearer key, server-sent events (choices[0].delta…)
// The second shape is what OpenAI, Gemini, OpenRouter, Ollama, LM Studio and most gateways take.

import { tr } from '@octaether/core-sdk';
import { type Connection, type Effort, type ModelEntry, effortOf, hostOf, markNoEffort, providerOf } from './connection';

export type { ModelEntry };

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	connection: Connection;
	/** What the AI must know before any request: the guide to OI text. The same for every request, so providers can cache it. */
	system: string;
	messageList: readonly ChatMessage[];
	signal?: AbortSignal;
	/** Called with each piece of the answer as it arrives. */
	onText(text: string): void;
	/** Called when the model starts thinking before it writes. */
	onThink?(): void;
	/** For tests. */
	fetch?: typeof fetch;
}

/** End: the answer is whole. Length: cut off at the model's limit. Refusal: the model declined. */
export type StopKind = 'End' | 'Length' | 'Refusal';

export interface ChatResult {
	text: string;
	stop: StopKind;
}

/** Key: the key was refused. Limit: too many requests or no credit. Network: the provider wasn't reached. Request: it refused the request. Server: it failed. */
export type ProblemKind = 'Key' | 'Limit' | 'Network' | 'Request' | 'Server';

export class ProviderError extends Error {
	constructor(
		readonly kind: ProblemKind,
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

/** The newest Anthropic API version; with it the request sends no sampling settings. */
const anthropicVersion = '2026-10-21';
/** Models whose safety checks may decline a request: the API then answers with the model Anthropic recommends instead. */
export const fallbackModel = /^claude-(?:fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const fallbackBeta = 'server-side-fallback-2026-07-01';
/** Room for a long answer (and the thinking before it); streaming keeps the wait from timing out. */
export const outputRoom = 64000;

export function header(connection: Connection): Record<string, string> {
	const key = connection.key.trim();
	if (providerOf(connection.provider).protocol === 'Anthropic') {
		return {
			'content-type': 'application/json',
			'x-api-key': key,
			'anthropic-version': anthropicVersion,
			// the key is the user's own, typed into their own browser: that is what this header says
			'anthropic-dangerous-direct-browser-access': 'true',
			...(fallbackModel.test(connection.model) ? { 'anthropic-beta': fallbackBeta } : {}),
		};
	}
	return { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

const anthropicEffort: Readonly<Record<Exclude<Effort, 'Default'>, string>> = { Low: 'low', Medium: 'medium', High: 'high', ExtraHigh: 'xhigh', Max: 'max' };

/**
 * What a request adds for the effort: Claude's `output_config.effort` (low to max), a reasoning
 * effort elsewhere (low, medium, high: Extra high and Max ask for high), OpenRouter's `reasoning`.
 */
export function effortBody(connection: Connection): Record<string, unknown> {
	const effort = effortOf(connection);
	if (effort === 'Default') return {};
	if (providerOf(connection.provider).protocol === 'Anthropic') return { output_config: { effort: anthropicEffort[effort] } };
	const level = effort === 'Low' ? 'low' : effort === 'Medium' ? 'medium' : 'high';
	if (connection.provider === 'OpenRouter') return { reasoning: { effort: level } };
	return { reasoning_effort: level };
}

/**
 * Sends a request built for a connection; when the provider refuses it (400) while it carries an
 * effort, the model is remembered as having none and the request goes again without it.
 */
export async function post(connection: Connection, build: (connection: Connection) => { url: string; header: Record<string, string>; body: Record<string, unknown> }, signal: AbortSignal | null, fetcher: typeof fetch): Promise<Response> {
	const built = build(connection);
	try {
		return await send(connection, built.url, { method: 'POST', headers: built.header, body: JSON.stringify(built.body), signal }, fetcher);
	} catch (error) {
		if (!(error instanceof ProviderError) || error.status !== 400 || effortOf(connection) === 'Default') throw error;
		markNoEffort(connection);
		const without = { ...connection, noEffortList: [...(connection.noEffortList ?? []), connection.model] };
		const again = build(without);
		return send(without, again.url, { method: 'POST', headers: again.header, body: JSON.stringify(again.body), signal }, fetcher);
	}
}

/** The request as it is sent (also what the tests look at). */
export function buildRequest(connection: Connection, system: string, messageList: readonly ChatMessage[]): { url: string; header: Record<string, string>; body: Record<string, unknown> } {
	const base = connection.baseUrl.replace(/\/+$/, '');
	if (providerOf(connection.provider).protocol === 'Anthropic') {
		return {
			url: `${base}/messages`,
			header: header(connection),
			body: {
				model: connection.model,
				max_tokens: Math.min(outputRoom, connection.outputLimit ?? outputRoom),
				stream: true,
				// the guide is long and never changes between requests: cached, it costs a tenth
				system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
				messages: messageList.map((message) => ({ role: message.role, content: message.content })),
				...(fallbackModel.test(connection.model) ? { fallbacks: 'default' } : {}),
				...effortBody(connection),
			},
		};
	}
	return {
		url: `${base}/chat/completions`,
		header: header(connection),
		body: { model: connection.model, stream: true, messages: [{ role: 'system', content: system }, ...messageList.map((message) => ({ role: message.role, content: message.content }))], ...effortBody(connection) },
	};
}

/** The provider's own words for a failure, from whatever JSON it sent. */
function providerMessage(text: string): string {
	try {
		let data = JSON.parse(text) as unknown;
		if (Array.isArray(data)) data = data[0];
		const error = (data as { error?: unknown }).error;
		if (typeof error === 'string') return error;
		const message = (error as { message?: unknown } | undefined)?.message ?? (data as { message?: unknown }).message;
		return typeof message === 'string' ? message : '';
	} catch {
		return text.trim().slice(0, 200);
	}
}

function statusError(connection: Connection, status: number, text: string): ProviderError {
	const host = hostOf(connection);
	const said = providerMessage(text);
	const tail = said ? ` (${said})` : '';
	const add = (text: string): string => `${text}${tail}`;
	if (status === 401 || status === 403) return new ProviderError('Key', add(tr`${host} refused the key. Check it under Connection.`), status);
	if (status === 402 || status === 429) return new ProviderError('Limit', add(tr`${host} is limiting requests, or the account is out of credit.`), status);
	if (status === 404) return new ProviderError('Request', add(tr`${host} has no model “${connection.model}” at this address.`), status);
	if (status >= 500) return new ProviderError('Server', add(tr`${host} is busy or down. Try again in a moment.`), status);
	return new ProviderError('Request', add(tr`${host} refused the request.`), status);
}

function networkError(connection: Connection): ProviderError {
	const provider = providerOf(connection.provider);
	const host = hostOf(connection);
	if (provider.local) return new ProviderError('Network', tr`Couldn’t reach ${host}. Is it running, and does it allow this page (OLLAMA_ORIGINS)?`);
	if (provider.custom) return new ProviderError('Network', tr`Couldn’t reach ${host}. Check the address, and that the server allows requests from a web page (CORS).`);
	return new ProviderError('Network', tr`Couldn’t reach ${host}. Check the internet connection.`);
}

export async function send(connection: Connection, url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
	let response: Response;
	try {
		response = await fetcher(url, init);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw networkError(connection);
	}
	if (!response.ok) throw statusError(connection, response.status, await response.text().catch(() => ''));
	return response;
}

/** The events of a server-sent stream, one `{ event, data }` per blank-line-separated record. */
export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const record = (text: string): { event: string; data: string } | undefined => {
		let event = '';
		const dataList: string[] = [];
		for (const line of text.split(/\r?\n/)) {
			if (line.startsWith('event:')) event = line.slice(6).trim();
			else if (line.startsWith('data:')) dataList.push(line.slice(5).replace(/^ /, ''));
		}
		return dataList.length > 0 ? { event, data: dataList.join('\n') } : undefined;
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			for (;;) {
				const match = /\r?\n\r?\n/.exec(buffer);
				if (!match) break;
				const item = record(buffer.slice(0, match.index));
				buffer = buffer.slice(match.index + match[0].length);
				if (item) yield item;
			}
			if (done) break;
		}
		const last = record(buffer);
		if (last) yield last;
	} finally {
		reader.releaseLock();
	}
}

interface AnthropicEvent {
	type?: string;
	content_block?: { type?: string };
	delta?: { type?: string; text?: string; stop_reason?: string | null };
	error?: { message?: string };
}

interface OpenAIEvent {
	choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
	error?: { message?: string } | string;
}

/** Sends the conversation and reads the answer as it streams. Rejects with a ProviderError, or an AbortError when stopped. */
export async function chat(request: ChatRequest): Promise<ChatResult> {
	const { connection } = request;
	const response = await post(connection, (with_) => buildRequest(with_, request.system, request.messageList), request.signal ?? null, request.fetch ?? fetch);
	if (!response.body) throw new ProviderError('Server', tr`${hostOf(connection)} sent no answer.`);
	let text = '';
	let stop: StopKind = 'End';
	const add = (piece: string | null | undefined): void => {
		if (!piece) return;
		text += piece;
		request.onText(piece);
	};
	const anthropic = providerOf(connection.provider).protocol === 'Anthropic';
	try {
		for await (const { data } of readEventStream(response.body)) {
			if (data === '[DONE]') break;
			let event: unknown;
			try {
				event = JSON.parse(data);
			} catch {
				continue;
			}
			if (anthropic) {
				const item = event as AnthropicEvent;
				if (item.type === 'error') throw new ProviderError('Server', `${tr`${hostOf(connection)} stopped the answer.`}${item.error?.message ? ` (${item.error.message})` : ''}`);
				if (item.type === 'content_block_start' && item.content_block?.type === 'thinking') request.onThink?.();
				if (item.type === 'content_block_delta' && item.delta?.type === 'text_delta') add(item.delta.text);
				if (item.type === 'message_delta' && item.delta?.stop_reason) stop = item.delta.stop_reason === 'max_tokens' ? 'Length' : item.delta.stop_reason === 'refusal' ? 'Refusal' : 'End';
			} else {
				const item = event as OpenAIEvent;
				if (item.error) throw new ProviderError('Server', `${tr`${hostOf(connection)} stopped the answer.`} (${typeof item.error === 'string' ? item.error : (item.error.message ?? '')})`);
				const choice = item.choices?.[0];
				if (!choice) continue;
				if (!choice.delta?.content && (choice.delta?.reasoning || choice.delta?.reasoning_content)) request.onThink?.();
				add(choice.delta?.content);
				if (choice.finish_reason) stop = choice.finish_reason === 'length' ? 'Length' : choice.finish_reason === 'content_filter' ? 'Refusal' : 'End';
			}
		}
	} catch (error) {
		if (error instanceof ProviderError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
		// the connection dropped mid-answer
		throw new ProviderError('Network', tr`The answer from ${hostOf(connection)} was cut off. Try again.`);
	}
	return { text, stop };
}

/** The models the provider offers this key, newest first where it says. Also the test that a key works. */
export async function listModel(connection: Connection, fetcher: typeof fetch = fetch): Promise<ModelEntry[]> {
	const base = connection.baseUrl.replace(/\/+$/, '');
	const anthropic = providerOf(connection.provider).protocol === 'Anthropic';
	const requestHeader = header({ ...connection, model: '' });
	delete requestHeader['content-type'];
	const response = await send(connection, anthropic ? `${base}/models?limit=1000` : `${base}/models`, { method: 'GET', headers: requestHeader }, fetcher);
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new ProviderError('Server', tr`${hostOf(connection)} sent a list that can’t be read.`);
	}
	const list = Array.isArray(data) ? data : (((data as { data?: unknown }).data ?? (data as { models?: unknown }).models) as unknown);
	if (!Array.isArray(list)) return [];
	return list.flatMap((item: unknown): ModelEntry[] => {
		const model = item as { id?: unknown; name?: unknown; display_name?: unknown; max_tokens?: unknown };
		const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : '';
		if (!id) return [];
		return [{ id, title: typeof model.display_name === 'string' ? model.display_name : id, ...(typeof model.max_tokens === 'number' ? { outputLimit: model.max_tokens } : {}) }];
	});
}
