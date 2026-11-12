// @vitest-environment happy-dom
// Every language file must hold the app's words. The words are found two ways: the text written
// in code (`t('…')`, tr`…`, and what commands, settings, modules, and templates say of themselves),
// and what the app actually draws when it is driven through its screens in that language.
// A new language fails here until it is complete; the message lists what it lacks.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { missingTextList, t, tr } from '@octaether/core-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { languageList, loadDictionary, resolveLanguage } from '../src/language';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
let app: (typeof import('../src/main'))['app'];
let dictionary: Readonly<Record<string, string>>;

async function settle(round = 8): Promise<void> {
	for (let index = 0; index < round; index++) await new Promise((done) => setTimeout(done, 0));
}

function sourceFileList(folder: string): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'test' || entry.name === 'dist' || entry.name === 'language' ? [] : sourceFileList(path);
		return /\.ts$/.test(entry.name) ? [path] : [];
	});
}

/** The texts given to `t('…')` and tr`…` in the code, as their dictionary keys. */
function writtenTextList(): string[] {
	return [...new Set(['app', 'core', 'module', 'plugin'].flatMap((folder) => sourceFileList(join(root, folder))).flatMap((file) => writtenTextOf(readFileSync(file, 'utf8'))))];
}

/** The texts one file gives to `t('…')` and tr`…`. */
function writtenTextOf(source: string): string[] {
	const found = new Set<string>();
	{
		for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) found.add(match[1]!.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
		for (const match of source.matchAll(/\btr`/g)) {
			// a template: its values become {0}, {1}, … (a value may hold braces and templates of its own)
			let at = match.index + 3;
			let key = '';
			let count = 0;
			while (at < source.length && source[at] !== '`') {
				if (source[at] === '$' && source[at + 1] === '{') {
					let depth = 0;
					let quote = '';
					for (at += 1; at < source.length; at++) {
						const character = source[at]!;
						if (quote) {
							if (character === '\\') at++;
							else if (character === quote) quote = '';
						} else if (character === "'" || character === '"' || character === '`') quote = character;
						else if (character === '{') depth++;
						else if (character === '}' && --depth === 0) break;
					}
					key += `{${count++}}`;
					at++;
				} else key += source[at++];
			}
			found.add(key);
		}
	}
	return [...found];
}

beforeAll(async () => {
	localStorage.clear();
	localStorage.setItem('OctaetherInk.Language', 'zh-Hans');
	const html = readFileSync(resolve(here, '../index.html'), 'utf8');
	document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/, '');
	const main = await import('../src/main');
	await main.ready;
	app = main.app;
	// the app's words and every module's and plugin's own, as the app loads them
	dictionary = (await loadDictionary(languageList.find((language) => language.id === 'zh-Hans')!, app.registry.definitionList()))!;
});

describe('language', () => {
	it('follows the device unless one is chosen, and falls back to English', () => {
		expect(resolveLanguage('System', ['zh-CN', 'en-US']).id).toBe('zh-Hans');
		expect(resolveLanguage('System', ['zh-Hans-CN']).id).toBe('zh-Hans');
		expect(resolveLanguage('System', ['fr-FR', 'en-GB']).id).toBe('en');
		expect(resolveLanguage('System', ['ja-JP']).id).toBe('en');
		expect(resolveLanguage('zh-Hans', ['en-US']).id).toBe('zh-Hans');
		expect(resolveLanguage('en', ['zh-CN']).id).toBe('en');
		expect(languageList.map((language) => language.title)).toEqual(['English', '简体中文']);
	});

	it('translates by the English text, fills values in, and shows English for what is missing', () => {
		expect(t('Cancel')).toBe('取消');
		expect(t('A sentence no language file has.')).toBe('A sentence no language file has.');
		expect(tr`Couldn’t find “${'SN2'}”.`).toBe('找不到“SN2”。');
		expect(t('Imported {count} files.', { count: 3 })).toBe('已导入 3 个文件。');
		expect(document.documentElement.lang).toBe('zh-Hans');
	});

	it('holds every text written in the code, and what commands, settings, modules, and templates say', () => {
		const wantedSet = new Set(writtenTextList());
		for (const command of app.commandRegistry.list()) {
			if (command.id.startsWith('Macro.')) continue;
			wantedSet.add(command.title);
			if (command.explain) wantedSet.add(command.explain);
		}
		for (const definition of app.registry.definitionList()) {
			wantedSet.add(definition.explain);
			for (const feature of definition.featureList ?? []) [feature.title, feature.explain].forEach((text) => wantedSet.add(text));
		}
		for (const { setting } of app.registry.settingList()) {
			wantedSet.add(setting.title);
			wantedSet.add(setting.explain);
			if (setting.action) wantedSet.add(setting.action);
		}
		for (const template of app.registry.templateList()) {
			wantedSet.add(template.title);
			if (template.explain) wantedSet.add(template.explain);
		}
		// a block type's name (`Table`, `Math`) is the file's syntax, the same in every language
		const missing = [...wantedSet].filter((text) => text.trim() !== '' && app.registry.knownBlockType(text) === undefined && dictionary[text] === undefined).sort();
		if (process.env.OI_HARVEST) writeFileSync(join(process.env.OI_HARVEST, 'written.json'), JSON.stringify(missing, null, '\t'));
		expect(missing, `zh-Hans lacks ${missing.length} texts`).toEqual([]);
		// a translation keeps every value its text has
		const broken = Object.entries(dictionary).filter(([key, value]) => (key.match(/\{\w+\}/g) ?? []).some((name) => !value.includes(name)));
		expect(broken.map(([key]) => key)).toEqual([]);
	});

	it('draws the app in the language: the start screen, the settings, the menus, a note', async () => {
		const start = document.getElementById('startScreen')!;
		expect(start.querySelector('h1')!.textContent).toBe('属于你的笔记。');
		expect([...start.querySelectorAll('[data-action] span')].map((span) => span.textContent)).toEqual(['新建库', '将文件夹作为库打开', '快速笔记', '打开文件', '打开欢迎指南']);
		expect(document.getElementById('ribbonSetting')!.title).toContain('打开设置');
		// every page of Setting, and every module's and plugin's own
		app.commandRegistry.run('Setting.Open');
		for (const section of ['Editor', 'File', 'Appearance', 'Hotkey', 'Module', 'Plugin', 'About']) {
			document.querySelector<HTMLButtonElement>(`.setting-nav [data-section="${section}"]`)!.click();
			await settle(2);
		}
		for (const definition of app.registry.definitionList()) {
			document.querySelector<HTMLButtonElement>(`.setting-nav [data-section="${definition.kind}"]`)!.click();
			document.querySelector<HTMLButtonElement>(`.setting-body [data-open="${definition.name}"]`)!.click();
			await settle(2);
		}
		document.querySelector<HTMLButtonElement>('.setting-nav [data-section="Appearance"]')!.click();
		await settle(2);
		expect(document.querySelector('.setting-body h2')!.textContent).toBe('外观');
		// each language is listed under its own name, whatever language is shown
		expect([...document.querySelectorAll('.setting-body [data-language] option')].map((option) => option.textContent)).toEqual(['跟随系统 (English)', 'English', '简体中文']);
		// Match system names the device's language (English here), not the one shown
		document.querySelector<HTMLButtonElement>('.modal-close')!.click();
		// the welcome guide is in the language too, under the same file names (so its links still work)
		await app.openGuide();
		await settle(20);
		expect(app.workspace.note!.path).toBe('Welcome.oi');
		expect(app.workspace.note!.model.serialize()).toContain('欢迎');
		expect(app.workspace.note!.model.serialize()).toContain('[[Table]]');
		// the sidebar, the note's menu, a block's menu, the command palette, find, the graph, the AI panel
		app.commandRegistry.run('Sidebar.Toggle');
		await settle();
		document.getElementById('moreButton')!.click();
		await settle(2);
		expect([...document.querySelectorAll('#layer .menu-item .menu-title')].map((title) => title.firstChild?.textContent)).toContain('导出');
		document.querySelector<HTMLElement>('#layer .menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		const frame = document.querySelector<HTMLElement>('#note .oi-frame[data-oi-type="Text"]')!;
		frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
		await settle(2);
		document.querySelector<HTMLElement>('#layer .menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		document.querySelector<HTMLButtonElement>('.vault-button')?.click();
		await settle(4);
		document.querySelector<HTMLElement>('#layer .menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		app.commandRegistry.run('Command.Palette');
		await settle(2);
		expect(document.querySelector<HTMLInputElement>('.palette-input')!.placeholder).toBe('输入命令');
		document.querySelector<HTMLInputElement>('.palette-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		app.commandRegistry.run('Find.Open');
		app.commandRegistry.run('Find.Replace');
		await settle(2);
		app.findBar.close();
		app.commandRegistry.run('Graph.Open');
		await settle(4);
		app.commandRegistry.run('Graph.Open');
		app.commandRegistry.run('AI.Connect');
		await settle(30);
		// the connection, on the AI's page in Setting
		expect(document.querySelector('.setting-body [data-custom="AI.Connection"] .oi-ai-form label')!.textContent).toBe('服务商');
		document.querySelector<HTMLButtonElement>('.setting-modal .modal-close')!.click();
		// the Ask AI box: its bottom row, in the language
		app.commandRegistry.run('AI.Ask');
		await settle(30);
		expect(document.querySelector('.oi-ai [data-action="Model"]')!.textContent).toBe('连接 AI');
		document.querySelector<HTMLElement>('.oi-ai')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		// what was drawn and had no translation: none, apart from names (yours, a module's, a theme's, a key's)
		const nameSet = new Set<string>([
			...app.registry.definitionList().flatMap((definition) => [definition.name, definition.title, `${definition.publisher}.${definition.name}`]),
			...app.themeRegistry.list().map((theme) => theme.name),
			...app.registry.settingList().flatMap((item) => [item.setting.id, ...(item.setting.choiceList ?? [])]),
			...app.commandRegistry.list().map((command) => command.id),
			// the welcome guide's note names: file names, linked to by name
			...['Welcome', 'Workspace', 'Tracker', 'Chemistry', 'Calendar', 'Expense', 'Octahedron'],
			// a setting's values are written into .oi/Setting.oi as they are
			'SingleClick', 'DoubleClick', 'HotkeyOnly', 'VaultRoot', 'CurrentFolder', 'Permanent',
		]);
		// text with letters of another script is in the language already (a translation with a value or a key in it)
		const untranslated = missingTextList().filter((text) => !nameSet.has(text) && /[A-Za-z]{2}/.test(text) && !/(?![A-Za-z])\p{L}/u.test(text));
		if (process.env.OI_HARVEST) writeFileSync(join(process.env.OI_HARVEST, 'drawn.json'), JSON.stringify(untranslated.sort(), null, '\t'));
		expect(untranslated.filter((text) => !allowed.test(text)), 'drawn in English').toEqual([]);
	});
});

// ---------------------------------------------------------------- words that skip t()

const propertyNameSet = new Set(['title', 'explain', 'hint', 'placeholder', 'emptyText', 'caption', 'label']);
const callNameSet = new Set(['askFor', 'prompt', 'confirm', 'alert', 'toast', 'notify', 'say', 'setStatus']);
const assignNameSet = new Set(['textContent', 'title', 'placeholder', 'ariaLabel', 'innerText']);
const wordPattern = /^[A-Z][A-Za-z0-9’'-]*(?:[ ,][A-Za-z0-9’'(),.:;?!/-]+)*[.?!…:]?$/;
/** Words a person reads: a capital, a small letter, not an identifier (`TextMuted`, `Plot.Grid`). */
const isWords = (text: string): boolean => wordPattern.test(text) && /[a-z]/.test(text) && text.length >= 2 && !/^[A-Z][a-z]+[A-Z]/.test(text) && !/^[A-Z][a-zA-Z]*\.[A-Z]/.test(text);
const functionTypeSet = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

interface Node {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
}

/** The words a file draws without `t()`: in menus, messages, and HTML, inside functions (what runs when something is drawn). */
async function unwrappedWordList(file: string): Promise<{ line: number; text: string }[]> {
	const { parseSync } = (await import('rolldown/experimental')) as unknown as { parseSync: (name: string, source: string, option: object) => { program: Node | string } };
	const source = readFileSync(file, 'utf8');
	const parsed = parseSync(file, source, { lang: 'ts', sourceType: 'module' }).program;
	const program = (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as Node;
	const found: { line: number; text: string }[] = [];
	const add = (node: Node, text: string): void => void found.push({ line: source.slice(0, node.start).split('\n').length, text });
	const isLiteral = (node: unknown): node is Node & { value: string } => !!node && (node as Node).type === 'Literal' && typeof (node as Node).value === 'string';
	const keyName = (node: Node): string | undefined => ((node.key as Node | undefined)?.name ?? (node.key as Node | undefined)?.value) as string | undefined;
	const htmlWordList = (text: string): string[] => [
		...[...text.matchAll(/\b(?:title|aria-label|placeholder|data-placeholder)="([^"$<>{}]+)"/g)].map((match) => match[1]!),
		...[...text.matchAll(/>([^<>${}]+)</g)].map((match) => match[1]!.trim()),
	].filter(isWords);
	const walk = (node: unknown, parent: Node | undefined, inside: boolean): void => {
		if (!node || typeof (node as Node).type !== 'string') return;
		const current = node as Node;
		// a command or a panel registered: the app translates what it says of itself
		if (current.type === 'CallExpression' && /^register/.test(String(((current.callee as Node).property as Node | undefined)?.name ?? (current.callee as Node).name ?? ''))) return;
		const nowInside = inside || functionTypeSet.has(current.type);
		if (nowInside) {
			const key = current.type === 'Property' ? keyName(current) : undefined;
			// a single word as a hint is a value (a callout's `hint: 'Tip'`), not a sentence
			if (key && !current.computed && propertyNameSet.has(key) && isLiteral(current.value) && isWords(current.value.value) && !(key === 'hint' && !current.value.value.includes(' '))) add(current.value, current.value.value);
			if (current.type === 'CallExpression') {
				const callee = current.callee as Node;
				const name = (callee.type === 'MemberExpression' ? (callee.property as Node).name : callee.name) as string;
				const first = (current.arguments as Node[])[0];
				if (callNameSet.has(name) && isLiteral(first) && isWords(first.value)) add(first, first.value);
			}
			if (current.type === 'AssignmentExpression' && (current.left as Node).type === 'MemberExpression' && assignNameSet.has(((current.left as Node).property as Node).name as string) && isLiteral(current.right) && isWords(current.right.value)) add(current.right, current.right.value);
			// x ? 'Expand' : 'Collapse' in a drawn place
			const inHtml = parent?.type === 'TemplateLiteral' && (parent.quasis as Node[]).some((quasi) => /[<>"]/.test(source.slice(quasi.start, quasi.end)));
			if (current.type === 'ConditionalExpression' && parent && (inHtml || (parent.type === 'Property' && propertyNameSet.has(keyName(parent) ?? ''))))
				for (const side of [current.consequent, current.alternate]) if (isLiteral(side) && isWords(side.value)) add(side as Node, side.value);
			if (current.type === 'TemplateLiteral') for (const quasi of current.quasis as Node[]) for (const text of htmlWordList(source.slice(quasi.start, quasi.end))) add(quasi, text);
			if (isLiteral(current) && /[<>]/.test(current.value)) {
				const wrapped = parent?.type === 'CallExpression' && ((parent.callee as Node).name === 't' || (parent.callee as Node).name === 'tr');
				if (!wrapped) for (const text of htmlWordList(current.value)) add(current, text);
			}
		}
		for (const [key, value] of Object.entries(current)) {
			if (key === 'parent') continue;
			if (Array.isArray(value)) for (const item of value) walk(item, current, nowInside);
			else if (value && typeof value === 'object') walk(value, current, nowInside);
		}
	};
	walk(program, undefined, false);
	return found;
}

describe('words in the code', () => {
	it('gives every word a module or plugin draws to t(), and each has it in its own language file', async () => {
		const problemList: string[] = [];
		const appWord = (await languageList.find((language) => language.id === 'zh-Hans')!.load!()) as Record<string, string>;
		for (const kind of ['module', 'plugin']) {
			for (const name of readdirSync(join(root, kind))) {
				const folder = join(root, kind, name, 'src');
				let own: Record<string, string> = {};
				try {
					own = (await import(/* @vite-ignore */ pathToFileURL(join(folder, 'language/zh-Hans.ts')).href)).default;
				} catch {
					// a module without a language shows its words in English
				}
				// guides and prompts are written for the AI, in English
				for (const file of sourceFileList(folder).filter((path) => !/(?:guide|prompt|agent)\.ts$/.test(path))) {
					const short = file.slice(root.length + 1).replace(/\\/g, '/');
					for (const { line, text } of await unwrappedWordList(file)) problemList.push(`${short}:${line} not given to t(): ${text}`);
					for (const text of writtenTextOf(readFileSync(file, 'utf8'))) if (own[text] === undefined && appWord[text] === undefined) problemList.push(`${short} lacks in its language file: ${text}`);
				}
			}
		}
		if (process.env.OI_HARVEST) writeFileSync(join(process.env.OI_HARVEST, 'module.json'), JSON.stringify(problemList, null, '\t'));
		expect(problemList).toEqual([]);
	});

	it('has in the app’s language file every word the app draws without t() (the page translates them)', async () => {
		const missing = new Set<string>();
		for (const file of sourceFileList(join(root, 'app/web/src'))) for (const { text } of await unwrappedWordList(file)) if (dictionary[text] === undefined && !allowed.test(text)) missing.add(text);
		if (process.env.OI_HARVEST) writeFileSync(join(process.env.OI_HARVEST, 'app.json'), JSON.stringify([...missing].sort(), null, '\t'));
		expect([...missing].sort()).toEqual([]);
	});
});

/** Drawn as they are in every language: versions, addresses, key names, the product's and its makers' names, sample values. */
const allowed = /^(?:(?:(?:Ctrl|Alt|Shift|Mod)\+)+\S+|Del|Shift\+Tab|Aa|[A-Z][A-Za-z]+\.[A-Z][A-Za-z.]+|Octaether\.[A-Za-z]+ · .*|\(OI\) .*|v?\d[\d.]*|Octaether(?: Ink)?|OI|GitHub(?: Sponsors| repository)?|Ko-fi|octaether\.com|MIT|Ctrl|Alt|Shift|Esc|Enter|Tab|Mod|F\d+|[A-Z]|.*(?:\.oi|\.md|\.png|\.zip)|https?:.*|\d+px|Tab|Anthropic.*|Google Gemini|OpenAI|#[0-9a-f]{3,6}|\d+px|Anthropic.*|OpenAI|Google Gemini|OpenRouter.*|Ollama.*|DeepSeek|deepseek-.*|claude-.*|English|简体中文|Light|Dark|Paper|HighContrast|System)$/;
