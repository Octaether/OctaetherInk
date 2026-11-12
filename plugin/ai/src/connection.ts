// The AI you connected: a provider, your key for it, and a model. Kept in this browser only
// (localStorage), apart from the settings: a key must never reach a vault's `.oi/Setting.oi`, which
// travels with the vault and may sit in git. Each provider keeps its own key, so switching back needs
// no typing.

/** How a provider is spoken to: Anthropic's Messages API, or the Chat Completions shape nearly every other one takes. */
export type Protocol = 'Anthropic' | 'OpenAI';

export interface Provider {
	/** PascalCase, kept in the connection. */
	name: string;
	title: string;
	protocol: Protocol;
	/** Up to the version (`…/v1`), without a slash at the end. */
	baseUrl: string;
	/** The model a new connection starts with ('' = pick one from the provider's list). */
	model: string;
	/** Where you make a key. */
	keyUrl?: string;
	/** Runs on this computer: no key, and the address can be changed. */
	local?: boolean;
	/** The address is yours to type. */
	custom?: boolean;
	note?: string;
}

export const providerList: readonly Provider[] = [
	{ name: 'Anthropic', title: 'Anthropic (Claude)', protocol: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5', keyUrl: 'https://platform.claude.com/settings/keys' },
	{ name: 'OpenAI', title: 'OpenAI', protocol: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', keyUrl: 'https://platform.openai.com/api-keys' },
	{ name: 'Gemini', title: 'Google Gemini', protocol: 'OpenAI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', keyUrl: 'https://aistudio.google.com/apikey' },
	{ name: 'DeepSeek', title: 'DeepSeek', protocol: 'OpenAI', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', keyUrl: 'https://platform.deepseek.com/api_keys' },
	{ name: 'OpenRouter', title: 'OpenRouter (many models, one key)', protocol: 'OpenAI', baseUrl: 'https://openrouter.ai/api/v1', model: '', keyUrl: 'https://openrouter.ai/keys' },
	{
		name: 'Ollama',
		title: 'Ollama (on this computer)',
		protocol: 'OpenAI',
		baseUrl: 'http://localhost:11434/v1',
		model: '',
		local: true,
		note: 'Nothing leaves this computer. Ollama must allow this page: start it with OLLAMA_ORIGINS set to this site’s address.',
	},
	{ name: 'Custom', title: 'Another (OpenAI-compatible)', protocol: 'OpenAI', baseUrl: '', model: '', custom: true, note: 'Any server that speaks the OpenAI chat API (LM Studio, a company gateway, Groq, Mistral…). It must allow requests from a web page (CORS).' },
];

/** How hard the model thinks before it answers: Default sends nothing (the model's own). */
export type Effort = 'Default' | 'Low' | 'Medium' | 'High' | 'ExtraHigh' | 'Max';
export const effortList: readonly Effort[] = ['Default', 'Low', 'Medium', 'High', 'ExtraHigh', 'Max'];
export const effortTitle: Readonly<Record<Effort, string>> = { Default: 'Default', Low: 'Low', Medium: 'Medium', High: 'High', ExtraHigh: 'Extra high', Max: 'Max' };

/** A model the provider listed for the key. */
export interface ModelEntry {
	id: string;
	title: string;
	outputLimit?: number;
}

export interface Connection {
	provider: string;
	key: string;
	model: string;
	/** Only for a provider whose address you set (local, custom). */
	baseUrl: string;
	/** The most the model writes in one answer, when the provider said so. */
	outputLimit?: number;
	effort?: Effort;
	/** What List models gave last, to switch models without asking again. */
	modelList?: ModelEntry[];
	/** Models that refused an effort setting (asked once, then left without). */
	noEffortList?: string[];
}

interface Stored {
	current?: unknown;
	list?: unknown;
}

const storageName = 'OctaetherInk.AI';

export function providerOf(name: string): Provider {
	return providerList.find((provider) => provider.name === name) ?? providerList[0]!;
}

function emptyConnection(provider: Provider): Connection {
	return { provider: provider.name, key: '', model: provider.model, baseUrl: provider.baseUrl };
}

function readStored(): { current: string; map: Map<string, Connection> } {
	let stored: Stored = {};
	try {
		stored = JSON.parse(localStorage.getItem(storageName) ?? '{}') as Stored;
	} catch {
		// nothing kept, or not ours
	}
	const map = new Map<string, Connection>();
	if (Array.isArray(stored.list)) {
		for (const item of stored.list as Partial<Connection>[]) {
			if (!item || typeof item.provider !== 'string' || !providerList.some((provider) => provider.name === item.provider)) continue;
			const provider = providerOf(item.provider);
			map.set(provider.name, {
				provider: provider.name,
				key: typeof item.key === 'string' ? item.key : '',
				model: typeof item.model === 'string' ? item.model : provider.model,
				baseUrl: (provider.local || provider.custom) && typeof item.baseUrl === 'string' ? item.baseUrl : provider.baseUrl,
				...(typeof item.outputLimit === 'number' ? { outputLimit: item.outputLimit } : {}),
				...(effortList.includes(item.effort as Effort) ? { effort: item.effort as Effort } : {}),
				...(Array.isArray(item.modelList) ? { modelList: item.modelList.filter((model): model is ModelEntry => typeof model?.id === 'string').map((model) => ({ id: model.id, title: typeof model.title === 'string' ? model.title : model.id, ...(typeof model.outputLimit === 'number' ? { outputLimit: model.outputLimit } : {}) })) } : {}),
				...(Array.isArray(item.noEffortList) ? { noEffortList: item.noEffortList.filter((model): model is string => typeof model === 'string') } : {}),
			});
		}
	}
	const current = typeof stored.current === 'string' && map.has(stored.current) ? stored.current : '';
	return { current, map };
}

function writeStored(current: string, map: Map<string, Connection>): boolean {
	try {
		localStorage.setItem(storageName, JSON.stringify({ current, list: [...map.values()] }));
		return true;
	} catch {
		return false;
	}
}

/** What is kept for a provider (an empty connection when nothing is). */
export function connectionOf(name: string): Connection {
	return readStored().map.get(providerOf(name).name) ?? emptyConnection(providerOf(name));
}

/** The connection in use, or undefined while none is ready (no provider chosen, no key, no model, no address). */
export function currentConnection(): Connection | undefined {
	const { current, map } = readStored();
	const connection = map.get(current);
	return connection && isReady(connection) ? connection : undefined;
}

/** The provider chosen last, ready or not. */
export function currentProvider(): string {
	return readStored().current || providerList[0]!.name;
}

export function isReady(connection: Connection): boolean {
	const provider = providerOf(connection.provider);
	return connection.model.trim() !== '' && connection.baseUrl.trim() !== '' && (provider.local === true || provider.custom === true || connection.key.trim() !== '');
}

/** Keeps a connection and makes it the one in use; false when this browser keeps nothing (a private window that refuses). */
export function saveConnection(connection: Connection): boolean {
	const { map } = readStored();
	const provider = providerOf(connection.provider);
	map.set(provider.name, { ...connection, provider: provider.name, key: connection.key.trim(), model: connection.model.trim(), baseUrl: connection.baseUrl.trim().replace(/\/+$/, '') });
	return writeStored(provider.name, map);
}

/** Changes what is kept for a provider (a model chosen, the effort, the list of models) without making it the one in use. */
export function updateConnection(name: string, change: Partial<Omit<Connection, 'provider'>>): boolean {
	const { current, map } = readStored();
	const provider = providerOf(name);
	map.set(provider.name, { ...(map.get(provider.name) ?? emptyConnection(provider)), ...change, provider: provider.name });
	return writeStored(current, map);
}

/** The model in use refused an effort: it is asked without one from now on. */
export function markNoEffort(connection: Connection): void {
	const kept = connectionOf(connection.provider);
	if (kept.noEffortList?.includes(connection.model)) return;
	updateConnection(connection.provider, { noEffortList: [...(kept.noEffortList ?? []), connection.model] });
}

/** The effort a request carries: none for Default, or for a model that refused one. */
export function effortOf(connection: Connection): Effort {
	return connection.effort && !connection.noEffortList?.includes(connection.model) ? connection.effort : 'Default';
}

/** How a model is named in a button: `Opus 5.5` for `claude-opus-5-5`, the list's own title, or the id. */
export function modelTitle(connection: Pick<Connection, 'model' | 'modelList'>): string {
	const listed = connection.modelList?.find((item) => item.id === connection.model)?.title;
	if (listed && listed !== connection.model) return listed.replace(/^Claude /, '');
	const claude = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(connection.model);
	if (claude) return `${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
	return connection.model;
}

/** Forgets a provider's key and model (every provider's when no name is given). */
export function forgetConnection(name?: string): void {
	const { current, map } = readStored();
	if (name === undefined) map.clear();
	else map.delete(name);
	writeStored(map.has(current) ? current : '', map);
}

/** The host a connection talks to, to name it on screen (`api.anthropic.com`). */
export function hostOf(connection: Connection): string {
	try {
		return new URL(connection.baseUrl).host;
	} catch {
		return connection.baseUrl;
	}
}
