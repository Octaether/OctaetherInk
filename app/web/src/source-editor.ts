// The Source view: the whole note as text, like a code editor. Line numbers, the current line,
// colours for the OI syntax (properties, block headers, aliases, Markdown marks), Tab / Shift+Tab
// and auto-indent, and Find highlights. A transparent textarea sits exactly over the coloured
// lines, so typing, selection, IME, and undo are the browser's own.

import { type AliasMatch, type BlockAlias, matchAlias } from '@octaether/core-format';

export interface SourceEditorOption {
	/** The text changed (called a moment after typing stops, and on blur). */
	onChange(text: string): void;
	onCursor?(line: number, column: number): void;
	/** Types whose indented body is raw text (Math, Code, Chem…), coloured as such. */
	isRawType?(type: string): boolean;
	/** Types whose text after the colon is properties (`Code: Python`), not the body. */
	takesArgument?(type: string): boolean;
	/** The aliases in use (``` and $$ and the like), asked once per drawing. */
	aliasList?(): readonly BlockAlias[];
}

interface Syntax {
	isRawType(type: string): boolean;
	takesArgument(type: string): boolean;
	aliasOf(rest: string): AliasMatch | undefined;
}

interface TokenState {
	front: 'Before' | 'Inside' | 'After';
	/** Inside a block opened with an alias, until its closing line. */
	alias: { marker: string; opening: 'Argument' | 'Body'; repeat: boolean } | undefined;
	rawLevel: number | undefined;
}

export interface TextMatch {
	start: number;
	end: number;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

interface Token {
	from: number;
	to: number;
	className: string;
}

const headerPattern = /^(\t*)([A-Z][A-Za-z0-9]*)(@\d+)?((?:[ \t]+\^[a-z0-9]+)?)((?:[ \t]*\{.*\})?)(:)/;
const inlinePattern = /(\*\*[^*\n]+\*\*|==[^=\n]+==|~~[^~\n]+~~|`[^`\n]+`|!?\[\[[^\]\n]+\]\]|\{[A-Z][A-Za-z0-9]*(?:\s*\{[^}]*\})?:[^}\n]*\}|(?<![\p{L}\p{N}_&])#(?:\[[^\]\n]+\]|[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)|\[[^\]\n]*\]\{[^}\n]*\})/gu;

function inlineClass(text: string): string {
	if (text.startsWith('**')) return 's-strong';
	if (text.startsWith('==')) return 's-mark';
	if (text.startsWith('~~')) return 's-strike';
	if (text.startsWith('`')) return 's-code-inline';
	if (text.startsWith('[[') || text.startsWith('![[')) return 's-link';
	if (text.startsWith('{')) return 's-inline-block';
	if (text.startsWith('#')) return 's-tag';
	return 's-span';
}

/** Colours one line; `state` carries alias blocks and front matter across lines. */
function tokenize(line: string, state: TokenState, syntax: Syntax): Token[] {
	const whole = (className: string): Token[] => (line === '' ? [] : [{ from: 0, to: line.length, className }]);
	const indent = /^\t*/.exec(line)![0].length;
	if (state.front === 'Before') {
		if (line === '---') {
			state.front = 'Inside';
			return whole('s-fence');
		}
		state.front = 'After';
	} else if (state.front === 'Inside') {
		if (line === '---') {
			state.front = 'After';
			return whole('s-fence');
		}
		if (/^\s*#/.test(line)) return whole('s-comment');
		const key = /^(\s*)([^:]+?)(:)(\s|$)/.exec(line);
		return key ? [{ from: key[1]!.length, to: key[1]!.length + key[2]!.length + 1, className: 's-key' }] : [];
	}
	// inside a block opened with an alias (``` … ```, $$ … $$) until its closing line
	if (state.alias) {
		const alias = state.alias;
		const trimmed = line.slice(indent).trim();
		if (alias.opening === 'Body') {
			// $$ can't hold a blank line: there, it wasn't math after all
			if (trimmed === '') state.alias = undefined;
			else if (trimmed.endsWith(alias.marker)) {
				state.alias = undefined;
				const at = line.lastIndexOf(alias.marker);
				return [
					{ from: 0, to: at, className: 's-body' },
					{ from: at, to: at + alias.marker.length, className: 's-fence' },
				];
			}
			return whole('s-body');
		}
		const closes = alias.repeat ? trimmed.length >= alias.marker.length && trimmed[0] === alias.marker[0] && [...trimmed].every((character) => character === alias.marker[0]) : trimmed === alias.marker;
		if (closes) {
			state.alias = undefined;
			return whole('s-fence');
		}
		return whole('s-body');
	}
	// the raw body of a Math / Code / Chem / Diagram block
	if (state.rawLevel !== undefined) {
		if (line.trim() === '' || indent > state.rawLevel) return whole('s-body');
		state.rawLevel = undefined;
	}
	const rest = line.slice(indent);
	const alias = syntax.aliasOf(rest);
	if (alias) {
		const markerEnd = indent + alias.marker.length;
		const marker = alias.alias.marker;
		const after = alias.after.trimEnd();
		if (alias.alias.opening === 'Body' && after.length >= marker.length && after.endsWith(marker)) {
			// $$x^2$$ on one line
			return [
				{ from: indent, to: markerEnd, className: 's-fence' },
				{ from: markerEnd, to: markerEnd + after.length - marker.length, className: 's-body' },
				{ from: markerEnd + after.length - marker.length, to: markerEnd + after.length, className: 's-fence' },
			];
		}
		state.alias = { marker: alias.marker, opening: alias.alias.opening, repeat: alias.alias.repeat === true };
		return [
			{ from: indent, to: markerEnd, className: 's-fence' },
			{ from: markerEnd, to: line.length, className: alias.alias.opening === 'Argument' ? 's-language' : 's-body' },
		];
	}
	const header = headerPattern.exec(line);
	if (header) {
		const tokenList: Token[] = [];
		let at = header[1]!.length;
		tokenList.push({ from: at, to: at + header[2]!.length + (header[3]?.length ?? 0), className: 's-type' });
		at += header[2]!.length + (header[3]?.length ?? 0);
		if (header[4]) tokenList.push({ from: at, to: at + header[4].length, className: 's-id' });
		at += header[4]!.length;
		if (header[5]) tokenList.push({ from: at, to: at + header[5].length, className: 's-prop' });
		at += header[5]!.length;
		tokenList.push({ from: at, to: at + 1, className: 's-type' });
		const inlineBody = line.slice(at + 1);
		if (syntax.takesArgument(header[2]!)) {
			// `Code {Wrap: True}: Python`: the header argument after the colon, the body on the lines below
			if (inlineBody.trim() !== '') tokenList.push({ from: at + 1, to: line.length, className: 's-language' });
			state.rawLevel = indent;
		} else if (syntax.isRawType(header[2]!)) {
			if (inlineBody.trim() === '') state.rawLevel = indent;
			else tokenList.push({ from: at + 1, to: line.length, className: 's-body' });
		}
		return tokenList;
	}
	const tokenList: Token[] = [];
	const heading = /^#{1,6}(?=[ \t]|$)/.exec(rest);
	if (heading) return [{ from: indent, to: line.length, className: 's-heading' }];
	const marker = /^(?:[-*+](?:[ \t]+\[[ xX]\])?|\d{1,9}[.)]|>(?:[ \t]*\[![A-Za-z-]+\][+-]?)?)(?=[ \t]|$)/.exec(rest);
	if (marker) tokenList.push({ from: indent, to: indent + marker[0].length, className: 's-marker' });
	for (const match of line.matchAll(inlinePattern)) tokenList.push({ from: match.index, to: match.index + match[0].length, className: inlineClass(match[0]) });
	const id = /[ \t](\^[a-z0-9]{3,})[ \t]*$/.exec(line);
	if (id) tokenList.push({ from: id.index + 1, to: id.index + 1 + id[1]!.length, className: 's-id' });
	return tokenList.sort((left, right) => left.from - right.from).filter((token, index, list) => index === 0 || token.from >= list[index - 1]!.to);
}

/** HTML for one line: token colours, with find matches wrapped in <mark>. */
function lineHtml(line: string, tokenList: readonly Token[], matchList: readonly TextMatch[], currentIndex: number, lineStart: number, matchOffset: number): string {
	// class per character is simplest and fast enough for notes
	const classList: string[] = new Array(line.length).fill('');
	for (const token of tokenList) for (let index = token.from; index < token.to; index++) classList[index] = token.className;
	const markList: string[] = new Array(line.length).fill('');
	matchList.forEach((match, index) => {
		const from = Math.max(match.start - lineStart, 0);
		const to = Math.min(match.end - lineStart, line.length);
		for (let at = from; at < to; at++) markList[at] = index + matchOffset === currentIndex ? 'current' : 'match';
	});
	let out = '';
	let index = 0;
	while (index < line.length) {
		const className = classList[index]!;
		const mark = markList[index]!;
		let end = index + 1;
		while (end < line.length && classList[end] === className && markList[end] === mark) end++;
		let piece = escapeHtml(line.slice(index, end));
		if (className) piece = `<span class="${className}">${piece}</span>`;
		if (mark) piece = `<mark class="s-find${mark === 'current' ? ' s-find-current' : ''}">${piece}</mark>`;
		out += piece;
		index = end;
	}
	return out;
}

export class SourceEditor {
	readonly element: HTMLElement;
	readonly textarea: HTMLTextAreaElement;
	private readonly lineLayer: HTMLElement;
	private frame = 0;
	private changeTimer: ReturnType<typeof setTimeout> | undefined;
	private lastSent = '';
	private matchList: TextMatch[] = [];
	private currentMatch = -1;

	constructor(
		container: HTMLElement,
		readonly option: SourceEditorOption,
	) {
		this.element = document.createElement('div');
		this.element.className = 'source-editor';
		this.lineLayer = document.createElement('div');
		this.lineLayer.className = 'source-lines';
		this.lineLayer.setAttribute('aria-hidden', 'true');
		this.textarea = document.createElement('textarea');
		this.textarea.className = 'source-input';
		this.textarea.spellcheck = false;
		this.textarea.setAttribute('aria-label', 'Note source');
		this.textarea.setAttribute('autocapitalize', 'off');
		this.textarea.setAttribute('autocomplete', 'off');
		this.element.append(this.lineLayer, this.textarea);
		container.append(this.element);
		this.textarea.addEventListener('input', () => {
			this.schedule();
			clearTimeout(this.changeTimer);
			this.changeTimer = setTimeout(() => this.flush(), 350);
		});
		this.textarea.addEventListener('blur', () => this.flush());
		this.textarea.addEventListener('keydown', (event) => this.onKey(event));
		for (const type of ['keyup', 'click', 'select', 'focus'] as const) this.textarea.addEventListener(type, () => this.schedule());
	}

	text(): string {
		return this.textarea.value;
	}

	/** Shows new text (when the note changed elsewhere); keeps the caret where it was. */
	setText(text: string): void {
		if (text === this.textarea.value) return;
		const { selectionStart, selectionEnd } = this.textarea;
		this.textarea.value = text;
		this.lastSent = text;
		this.textarea.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length));
		this.render();
	}

	/** Sends pending typing to the note now. */
	flush(): void {
		clearTimeout(this.changeTimer);
		if (this.textarea.value === this.lastSent) return;
		this.lastSent = this.textarea.value;
		this.option.onChange(this.textarea.value);
	}

	focus(): void {
		this.textarea.focus({ preventScroll: true });
		this.schedule();
	}

	/** Highlights find matches; the current one is selected and scrolled into view. */
	setMatchList(matchList: TextMatch[], current: number, reveal: boolean): void {
		this.matchList = matchList;
		this.currentMatch = current;
		this.render();
		const match = matchList[current];
		if (match && reveal) {
			this.textarea.setSelectionRange(match.start, match.end);
			const line = this.textarea.value.slice(0, match.start).split('\n').length - 1;
			this.lineLayer.children[line]?.scrollIntoView({ block: 'center' });
		}
	}

	destroy(): void {
		this.flush();
		cancelAnimationFrame(this.frame);
		this.element.remove();
	}

	private schedule(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	render(): void {
		const text = this.textarea.value;
		const lineList = text.split('\n');
		const caretLine = text.slice(0, this.textarea.selectionStart).split('\n').length - 1;
		const state: TokenState = { front: 'Before', alias: undefined, rawLevel: undefined };
		const aliasList = this.option.aliasList?.() ?? [];
		const syntax: Syntax = {
			isRawType: this.option.isRawType ?? ((type: string) => ['Math', 'Code', 'Chem', 'Diagram', 'Plot', 'Table', 'HTML'].includes(type)),
			takesArgument: this.option.takesArgument ?? ((type: string) => type === 'Code'),
			aliasOf: (rest) => matchAlias(rest, aliasList),
		};
		let offset = 0;
		let matchIndex = 0;
		const html: string[] = [];
		lineList.forEach((line, index) => {
			const lineEnd = offset + line.length;
			// matches touching this line (they are in text order)
			while (matchIndex < this.matchList.length && this.matchList[matchIndex]!.end <= offset) matchIndex++;
			const lineMatchList: TextMatch[] = [];
			for (let at = matchIndex; at < this.matchList.length && this.matchList[at]!.start < lineEnd; at++) lineMatchList.push(this.matchList[at]!);
			const firstIndex = matchIndex;
			html.push(`<div class="source-line${index === caretLine && document.activeElement === this.textarea ? ' current' : ''}">${lineHtml(line, tokenize(line, state, syntax), lineMatchList, this.currentMatch, offset, firstIndex) || '<br>'}</div>`);
			offset = lineEnd + 1;
		});
		this.lineLayer.innerHTML = html.join('');
		// the textarea grows with the text; the page scrolls, not the editor
		this.textarea.style.height = 'auto';
		this.textarea.style.height = `${Math.max(this.textarea.scrollHeight, this.lineLayer.offsetHeight)}px`;
		const column = this.textarea.selectionStart - (text.lastIndexOf('\n', this.textarea.selectionStart - 1) + 1);
		this.option.onCursor?.(caretLine + 1, column + 1);
	}

	private insert(text: string): void {
		// execCommand keeps the browser's own undo working; setRangeText is the fallback
		this.textarea.focus();
		if (!document.execCommand?.('insertText', false, text)) {
			this.textarea.setRangeText(text, this.textarea.selectionStart, this.textarea.selectionEnd, 'end');
			this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	private onKey(event: KeyboardEvent): void {
		if (event.isComposing) return;
		const { value, selectionStart, selectionEnd } = this.textarea;
		if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
			const multiLine = value.slice(selectionStart, selectionEnd).includes('\n');
			if (!event.shiftKey && !multiLine) {
				this.insert('\t');
				return;
			}
			// indent or outdent every selected line
			const blockEnd = value.indexOf('\n', selectionEnd - (selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? 1 : 0));
			const end = blockEnd < 0 ? value.length : blockEnd;
			const lineList = value.slice(lineStart, end).split('\n');
			const next = lineList.map((line) => (event.shiftKey ? line.replace(/^(\t| {1,4})/, '') : `\t${line}`)).join('\n');
			this.textarea.setSelectionRange(lineStart, end);
			this.insert(next);
			this.textarea.setSelectionRange(lineStart, lineStart + next.length);
			return;
		}
		if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
			// keep the indentation; one level deeper after a block header like `Math:` or `Code: Python`
			const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
			const line = value.slice(lineStart, selectionStart);
			const indent = /^\t*/.exec(line)![0];
			const header = headerPattern.exec(line);
			const deeper = header && (/:\s*$/.test(line) || this.option.takesArgument?.(header[2]!)) ? '\t' : '';
			if (indent === '' && deeper === '') return;
			event.preventDefault();
			this.insert(`\n${indent}${deeper}`);
		}
	}
}
