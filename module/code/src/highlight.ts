// Small own syntax highlighter: comments, strings, numbers, keywords, function names.
// Every emitted piece carries data-oi-s (its source offset), so a click on any character
// opens the editor at exactly that character.

import { escapeHtml } from '@octaether/core-sdk';

export interface LanguageRule {
	keywordSet: ReadonlySet<string>;
	lineCommentList: readonly string[];
	blockComment?: readonly [string, string];
	tripleQuote?: boolean;
	backtick?: boolean;
}

const jsKeyword =
	'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of null undefined true false static get set from as';

const cLike = { lineCommentList: ['//'], blockComment: ['/*', '*/'] as const };

export const languageMap: Readonly<Record<string, LanguageRule>> = {
	JavaScript: { keywordSet: new Set(jsKeyword.split(' ')), ...cLike, backtick: true },
	TypeScript: {
		keywordSet: new Set(`${jsKeyword} type interface enum implements private protected public readonly abstract declare namespace keyof infer is satisfies unknown never any`.split(' ')),
		...cLike,
		backtick: true,
	},
	Python: {
		keywordSet: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self print'.split(' ')),
		lineCommentList: ['#'],
		tripleQuote: true,
	},
	Rust: { keywordSet: new Set('as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn'.split(' ')), ...cLike },
	C: { keywordSet: new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL include define'.split(' ')), ...cLike },
	Java: { keywordSet: new Set('abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void while true false var record'.split(' ')), ...cLike },
	Sql: { keywordSet: new Set('select from where and or not insert into values update set delete create table index join left right inner outer on group by order having limit as distinct null is in like between case when then else end primary key'.split(' ')), lineCommentList: ['--'] },
	Shell: { keywordSet: new Set('if then else elif fi for while do done case esac function in return export local echo'.split(' ')), lineCommentList: ['#'] },
	R: { keywordSet: new Set('if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library return'.split(' ')), lineCommentList: ['#'] },
	Julia: { keywordSet: new Set('function end if elseif else for while return using import module struct mutable begin let local global true false nothing do try catch'.split(' ')), lineCommentList: ['#'] },
	Latex: { keywordSet: new Set<string>(), lineCommentList: ['%'] },
};

/** Lowercase names and aliases as written after ``` (as in Obsidian and GitHub). */
const aliasMap: Readonly<Record<string, string>> = {
	javascript: 'JavaScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', json: 'JavaScript',
	typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TypeScript',
	python: 'Python', py: 'Python',
	rust: 'Rust', rs: 'Rust',
	c: 'C', h: 'C', cpp: 'C', 'c++': 'C', cc: 'C', hpp: 'C',
	java: 'Java',
	sql: 'Sql',
	shell: 'Shell', bash: 'Shell', sh: 'Shell', zsh: 'Shell',
	r: 'R',
	julia: 'Julia', jl: 'Julia',
	latex: 'Latex', tex: 'Latex',
};

/** Languages as their own communities write them, for the label in a code block's corner. */
const displayNameMap: Readonly<Record<string, string>> = {
	javascript: 'JavaScript', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX', json: 'JSON',
	typescript: 'TypeScript', ts: 'TypeScript', tsx: 'TSX',
	python: 'Python', py: 'Python',
	rust: 'Rust', rs: 'Rust',
	c: 'C', h: 'C', cpp: 'C++', 'c++': 'C++', cc: 'C++', hpp: 'C++', csharp: 'C#', 'c#': 'C#', cs: 'C#',
	java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin', swift: 'Swift', go: 'Go', dart: 'Dart', scala: 'Scala',
	sql: 'SQL', shell: 'Shell', bash: 'Bash', sh: 'Shell', zsh: 'Zsh', powershell: 'PowerShell', ps1: 'PowerShell',
	r: 'R', julia: 'Julia', jl: 'Julia', matlab: 'MATLAB', latex: 'LaTeX', tex: 'TeX',
	html: 'HTML', css: 'CSS', xml: 'XML', yaml: 'YAML', yml: 'YAML', toml: 'TOML', markdown: 'Markdown', md: 'Markdown',
	ruby: 'Ruby', rb: 'Ruby', php: 'PHP', lua: 'Lua', perl: 'Perl', haskell: 'Haskell', text: 'Text', plaintext: 'Text', oi: 'OI',
};

/** `python` or `PY` → `Python`, `cpp` → `C++`; a name we don't know is shown as written. */
export function languageName(language: string | undefined): string | undefined {
	const name = language?.trim().split(/\s+/)[0];
	if (!name) return undefined;
	return displayNameMap[name.toLowerCase()] ?? name;
}

/** `python`, `Python`, `py`, or `python title=x` → `Python`; undefined when we don't highlight it. */
export function resolveLanguage(language: string | undefined): string | undefined {
	const name = language?.trim().split(/\s+/)[0];
	if (!name) return undefined;
	if (languageMap[name]) return name;
	return aliasMap[name.toLowerCase()];
}

export function languageRule(language: string | undefined): LanguageRule | undefined {
	const name = resolveLanguage(language);
	return name ? languageMap[name] : undefined;
}

export function highlight(source: string, language: string | undefined, offset = 0): string {
	const rule = languageRule(language);
	const caseless = resolveLanguage(language) === 'Sql';
	let out = '';
	let runStart = -1;
	let runText = '';
	const flush = (): void => {
		if (runText !== '') out += `<span data-oi-s="${offset + runStart}">${escapeHtml(runText)}</span>`;
		runText = '';
		runStart = -1;
	};
	const plain = (text: string, at: number): void => {
		if (runStart < 0) runStart = at;
		runText += text;
	};
	const token = (kind: string, text: string, at: number): void => {
		flush();
		out += `<span class="oi-code-${kind}" data-oi-s="${offset + at}">${escapeHtml(text)}</span>`;
	};
	if (!rule) {
		plain(source, 0);
		flush();
		return out;
	}
	let index = 0;
	while (index < source.length) {
		const rest = source.slice(index);
		const lineComment = rule.lineCommentList.find((marker) => rest.startsWith(marker));
		if (lineComment) {
			const end = source.indexOf('\n', index);
			const stop = end < 0 ? source.length : end;
			token('comment', source.slice(index, stop), index);
			index = stop;
			continue;
		}
		if (rule.blockComment && rest.startsWith(rule.blockComment[0])) {
			const end = source.indexOf(rule.blockComment[1], index + rule.blockComment[0].length);
			const stop = end < 0 ? source.length : end + rule.blockComment[1].length;
			token('comment', source.slice(index, stop), index);
			index = stop;
			continue;
		}
		const quote = rule.tripleQuote && (rest.startsWith('"""') || rest.startsWith("'''")) ? rest.slice(0, 3) : undefined;
		const character = source[index]!;
		if (quote || character === '"' || character === "'" || (rule.backtick && character === '`')) {
			const marker = quote ?? character;
			let stop = index + marker.length;
			while (stop < source.length && !source.startsWith(marker, stop)) {
				if (source[stop] === '\\') stop++;
				else if (marker.length === 1 && marker !== '`' && source[stop] === '\n') break;
				stop++;
			}
			stop = Math.min(source.length, stop + (source.startsWith(marker, stop) ? marker.length : 0));
			token('string', source.slice(index, stop), index);
			index = stop;
			continue;
		}
		const number = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
		if (number && !/[\p{L}\p{N}_]/u.test(source[index - 1] ?? '')) {
			token('number', number[0], index);
			index += number[0].length;
			continue;
		}
		const word = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(rest);
		if (word) {
			const text = word[0];
			const caseText = caseless ? text.toLowerCase() : text;
			if (rule.keywordSet.has(caseText)) token('keyword', text, index);
			else if (/^\s*\(/.test(source.slice(index + text.length))) token('function', text, index);
			else plain(text, index);
			index += text.length;
			continue;
		}
		plain(character, index);
		index++;
	}
	flush();
	return out;
}
