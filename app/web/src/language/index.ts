// The app's languages. English is what the code is written in; every other language is one file
// here: a list of `'English text': 'translation'` lines, loaded only when it is chosen.
//
// To add a language:
//   1. copy `zh-Hans.ts` to `<id>.ts` (the id is a BCP 47 tag: `ja`, `es`, `zh-Hant`) and translate
//      the right-hand sides (what is left out shows in English);
//   2. add a line to `languageList` below;
//   3. optionally translate the welcome guide: `sample/Guide/<id>/Welcome.oi` and the others, under
//      the same file names (a note without a translation shows the English one).
// `npm test` lists what a language file still lacks.
//
// What is translated is what the app says: buttons, menus, settings, messages. What a note is
// written in (block types such as `Math:`, properties, `True`/`False`) is syntax and stays, so a
// note reads the same in every language.

import { setDictionary } from '@octaether/core-sdk';

export interface Language {
	/** BCP 47: `en`, `zh-Hans`. */
	id: string;
	/** Its own name, as its speakers write it. */
	title: string;
	/** The browser languages it serves (`navigator.languages`), as prefixes: `zh-CN`, `zh`. */
	matchList: readonly string[];
	/** Its words; none for English. */
	load?(): Promise<Readonly<Record<string, string>>>;
}

export const languageList: readonly Language[] = [
	{ id: 'en', title: 'English', matchList: ['en'] },
	{ id: 'zh-Hans', title: '简体中文', matchList: ['zh-Hans', 'zh-CN', 'zh-SG', 'zh'], load: () => import('./zh-Hans').then((module) => module.default) },
];

const storageName = 'OctaetherInk.Language';

/** What you chose: a language's id, or `System` (the default) to follow the device. */
export function savedLanguage(): string {
	try {
		const saved = localStorage.getItem(storageName);
		return saved && languageList.some((language) => language.id === saved) ? saved : 'System';
	} catch {
		return 'System';
	}
}

export function saveLanguage(id: string): void {
	try {
		if (id === 'System') localStorage.removeItem(storageName);
		else localStorage.setItem(storageName, id);
	} catch {
		// not kept: the device's language is used
	}
}

/** The language a choice means on this device: itself, or for `System` the first of the browser's languages the app has. */
export function resolveLanguage(choice = savedLanguage(), deviceList: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])): Language {
	const chosen = languageList.find((language) => language.id === choice);
	if (chosen) return chosen;
	for (const device of deviceList) {
		const wanted = device.toLowerCase();
		const found = languageList.find((language) => language.matchList.some((match) => wanted === match.toLowerCase() || wanted.startsWith(`${match.toLowerCase()}-`)));
		if (found) return found;
	}
	return languageList[0]!;
}

let current: Language = languageList[0]!;

export function currentLanguage(): Language {
	return current;
}

/** Where words come from besides the app: the modules and plugins, each with its own translations (`Definition.language`). */
export type WordSource = { language?: Readonly<Record<string, () => Promise<Readonly<Record<string, string>>>>> };

/**
 * A language's words: the app's, then each module's and plugin's own (a module's word wins over the
 * app's for the same text). Undefined for English. A module whose words can't load stays in English.
 */
export async function loadDictionary(language: Language, sourceList: readonly WordSource[] = []): Promise<Readonly<Record<string, string>> | undefined> {
	if (!language.load) return undefined;
	const app = await language.load();
	const ownList = await Promise.all(sourceList.map((source) => source.language?.[language.id]?.().catch(() => undefined)));
	return Object.assign({}, app, ...ownList.filter((own) => own !== undefined));
}

/** Loads the language in use and starts translating what the app draws. A language that can't load leaves the app in English. */
export async function startLanguage(language = resolveLanguage(), sourceList: readonly WordSource[] = []): Promise<void> {
	current = language;
	let dictionary: Readonly<Record<string, string>> | undefined;
	try {
		dictionary = await loadDictionary(language, sourceList);
	} catch {
		current = languageList[0]!;
	}
	setDictionary(dictionary, dictionary ? current.id : 'en');
	if (typeof document === 'undefined') return;
	document.documentElement.lang = current.id;
	// the translator of what is drawn comes with a language other than English
	if (dictionary) (await import('./watch')).watch();
}
