// Own Markdown subset for Text blocks. Every rendered text run carries `data-oi-s` (its
// source offset; `data-oi-e` when it doesn't map 1:1) so a click lands on that exact spot.
// All text is escaped; only known tags are produced.

import { type PropertyMap, findClosingBracket, parseFlowMapText } from '@octaether/core-format';
import { escapeHtml } from '@octaether/core-sdk';
import { calloutIcon, calloutKind } from '@octaether/module-layout';

export interface MarkdownOption {
	resolveColor(value: string): string | undefined;
	/** Renders an inline block `{Type {Props}: content}`; `offset` = where content starts in the block source. */
	renderInline?(type: string, content: string, property: PropertyMap, offset: number): string | undefined;
}

const punctuationPattern = /[!-/:-@[-`{-~]/;
/** Files `![[…]]` shows as a picture rather than linking to. */
const imagePathPattern = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const safeUrlPattern = /^(?:https?:\/\/|mailto:|#|\/|\.{1,2}\/|[^:/?#]+(?:[/?#]|$))/i;
const typePattern = /^[A-Z][A-Za-z0-9]*/;

export function safeUrl(url: string): string | undefined {
	const text = url.trim();
	if (text === '' || /[\u0000-\u001f]/.test(text)) return undefined;
	return safeUrlPattern.test(text) ? text : undefined;
}

/** Inline style from block-like props (`Color`, `Background`, `Weight`, `Italic`, `Underline`, `Size`). */
export function inlineStyle(property: PropertyMap, resolveColor: (value: string) => string | undefined): string {
	const declarationList: string[] = [];
	const color = property.get('Color');
	if (typeof color === 'string') {
		const resolved = resolveColor(color);
		if (resolved) declarationList.push(`color: ${resolved}`);
	}
	const background = property.get('Background');
	if (typeof background === 'string') {
		const resolved = resolveColor(background);
		if (resolved) declarationList.push(`background: ${resolved}`, 'border-radius: 3px', 'padding: 0 0.15em');
	}
	const weight = property.get('Weight');
	if (weight === 'Bold' || weight === 700) declarationList.push('font-weight: 700');
	if (property.get('Italic') === true) declarationList.push('font-style: italic');
	if (property.get('Underline') === true) declarationList.push('text-decoration: underline');
	const size = property.get('Size');
	if (typeof size === 'string' && /^\d+(?:\.\d+)?(?:px|em|rem|%)$/.test(size)) declarationList.push(`font-size: ${size}`);
	return declarationList.join('; ');
}

/** Finds the closing delimiter for emphasis, skipping code spans. */
function findClose(text: string, from: number, delimiter: string): number {
	for (let index = from; index < text.length; index++) {
		const character = text[index]!;
		if (character === '\\') {
			index++;
			continue;
		}
		if (character === '`') {
			const close = text.indexOf(character, index + 1);
			if (close > 0) index = close;
			continue;
		}
		if (text.startsWith(delimiter, index)) {
			if (delimiter.length === 1 && text[index + 1] === delimiter) {
				index++;
				continue;
			}
			if (index > from && !/\s/.test(text[index - 1]!)) return index;
		}
	}
	return -1;
}

/** `{Type {Props}: content}` starting at `start` (the `{`). */
export function readInlineBlock(text: string, start: number): { type: string; property: PropertyMap; contentStart: number; contentEnd: number; end: number } | undefined {
	const close = findClosingBracket(text, start);
	if (close < 0) return undefined;
	const typeMatch = typePattern.exec(text.slice(start + 1));
	if (!typeMatch) return undefined;
	let position = start + 1 + typeMatch[0].length;
	let property: PropertyMap = new Map();
	if (text[position] === ' ' && text[position + 1] === '{') {
		const propertyClose = findClosingBracket(text, position + 1);
		if (propertyClose < 0 || propertyClose >= close) return undefined;
		const parsed = parseFlowMapText(text.slice(position + 1, propertyClose + 1));
		if (parsed.problem) return undefined;
		property = parsed.value;
		position = propertyClose + 1;
	}
	if (text[position] !== ':') return undefined;
	position++;
	if (text[position] === ' ') position++;
	return { type: typeMatch[0], property, contentStart: position, contentEnd: close, end: close + 1 };
}

export function renderInline(text: string, option: MarkdownOption, offset: number): string {
	let out = '';
	let runStart = -1;
	let runText = '';
	const flush = (): void => {
		if (runText !== '') out += `<span data-oi-s="${offset + runStart}">${escapeHtml(runText)}</span>`;
		runText = '';
		runStart = -1;
	};
	const plain = (character: string, at: number): void => {
		if (runStart < 0) runStart = at;
		runText += character;
	};
	const emit = (html: string): void => {
		flush();
		out += html;
	};
	const isWordCharacter = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}]/u.test(character);
	let index = 0;
	while (index < text.length) {
		const character = text[index]!;
		const rest = text.slice(index);
		if (character === '\\' && index + 1 < text.length && punctuationPattern.test(text[index + 1]!)) {
			emit(`<span data-oi-s="${offset + index}" data-oi-e="${offset + index + 2}">${escapeHtml(text[index + 1]!)}</span>`);
			index += 2;
			continue;
		}
		if (character === '`') {
			const run = /^`+/.exec(rest)![0];
			const close = text.indexOf(run, index + run.length);
			if (close > 0) {
				emit(`<code data-oi-s="${offset + index + run.length}">${escapeHtml(text.slice(index + run.length, close))}</code>`);
				index = close + run.length;
				continue;
			}
		}
		if (character === '{' && /[A-Z]/.test(text[index + 1] ?? '')) {
			const inline = readInlineBlock(text, index);
			if (inline) {
				const content = text.slice(inline.contentStart, inline.contentEnd);
				const html = inline.type === 'Text'
					? renderStyled(content, inline.property, option, offset + inline.contentStart)
					: option.renderInline?.(inline.type, content, inline.property, offset + inline.contentStart);
				emit(html ?? `<span class="oi-inline-unknown" data-oi-s="${offset + index}">${escapeHtml(text.slice(index, inline.end))}</span>`);
				index = inline.end;
				continue;
			}
		}
		if (rest.startsWith('![[') || rest.startsWith('[[')) {
			const start = index + (rest.startsWith('!') ? 3 : 2);
			const close = text.indexOf(']]', start);
			if (close > start) {
				const inner = text.slice(start, close);
				const bar = inner.indexOf('|');
				const target = bar >= 0 ? inner.slice(0, bar) : inner;
				const labelStart = bar >= 0 ? start + bar + 1 : start;
				const label = text.slice(labelStart, close);
				const embed = rest.startsWith('!');
				if (embed && imagePathPattern.test(target.trim())) {
					// Obsidian's ![[photo.png]] (or ![[photo.png|300]] for a width) shows the picture
					const width = bar >= 0 && /^\d{1,4}$/.test(label.trim()) ? ` width="${label.trim()}"` : '';
					emit(`<img class="oi-text-image" alt="${escapeHtml(bar >= 0 && !width ? label : target.trim())}" data-oi-asset="${escapeHtml(target.trim())}"${width} data-oi-s="${offset + index}" data-oi-e="${offset + close + 2}">`);
					index = close + 2;
					continue;
				}
				emit(`<a class="oi-wikilink${embed ? ' oi-embed' : ''}" data-oi-link="${escapeHtml(target.trim())}"><span data-oi-s="${offset + labelStart}">${escapeHtml(label)}</span></a>`);
				index = close + 2;
				continue;
			}
		}
		if (rest.startsWith('![')) {
			// a Markdown image: ![what it shows](photo.png or https://…)
			const close = findClosingBracket(text, index + 1);
			if (close > 0 && text[close + 1] === '(') {
				const urlClose = text.indexOf(')', close + 2);
				const source = urlClose > 0 ? text.slice(close + 2, urlClose).trim().replace(/^<(.*)>$/, '$1') : '';
				if (source !== '' && !/^(?:javascript|vbscript|file):/i.test(source)) {
					emit(`<img class="oi-text-image" alt="${escapeHtml(text.slice(index + 2, close))}" data-oi-asset="${escapeHtml(source)}" data-oi-s="${offset + index}" data-oi-e="${offset + urlClose + 1}">`);
					index = urlClose + 1;
					continue;
				}
			}
		}
		if (character === '[') {
			const close = findClosingBracket(text, index);
			const next = close > 0 ? text[close + 1] : undefined;
			if (close > 0 && next === '{') {
				const propertyClose = findClosingBracket(text, close + 1);
				const parsed = propertyClose > 0 ? parseFlowMapText(text.slice(close + 1, propertyClose + 1)) : undefined;
				if (parsed && !parsed.problem) {
					emit(renderStyled(text.slice(index + 1, close), parsed.value, option, offset + index + 1));
					index = propertyClose + 1;
					continue;
				}
			}
			if (close > 0 && next === '(') {
				const urlClose = text.indexOf(')', close + 2);
				const url = urlClose > 0 ? safeUrl(text.slice(close + 2, urlClose)) : undefined;
				if (url) {
					emit(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${renderInline(text.slice(index + 1, close), option, offset + index + 1)}</a>`);
					index = urlClose + 1;
					continue;
				}
			}
		}
		let matched = false;
		for (const [delimiter, tag] of [['**', 'strong'], ['__', 'strong'], ['~~', 's'], ['==', 'mark'], ['*', 'em'], ['_', 'em']] as const) {
			if (!rest.startsWith(delimiter) || /\s/.test(text[index + delimiter.length] ?? ' ')) continue;
			if (delimiter[0] === '_' && isWordCharacter(text[index - 1])) continue;
			const close = findClose(text, index + delimiter.length, delimiter);
			if (close < 0) continue;
			if (delimiter[0] === '_' && isWordCharacter(text[close + delimiter.length])) continue;
			emit(`<${tag}>${renderInline(text.slice(index + delimiter.length, close), option, offset + index + delimiter.length)}</${tag}>`);
			index = close + delimiter.length;
			matched = true;
			break;
		}
		if (matched) continue;
		if (character === '#' && !isWordCharacter(text[index - 1]) && text[index - 1] !== '&') {
			if (text[index + 1] === '[') {
				const close = text.indexOf(']', index + 2);
				if (close > index + 2) {
					const tag = text.slice(index + 2, close);
					emit(`<span class="oi-tag" data-oi-tag="${escapeHtml(tag)}" data-oi-s="${offset + index}" data-oi-e="${offset + close + 1}">#${escapeHtml(tag)}</span>`);
					index = close + 1;
					continue;
				}
			}
			const tagMatch = /^#([\p{L}\p{N}_\-/]+)/u.exec(rest);
			if (tagMatch && /[^\p{N}]/u.test(tagMatch[1]!)) {
				emit(`<span class="oi-tag" data-oi-tag="${escapeHtml(tagMatch[1]!)}" data-oi-s="${offset + index}">${escapeHtml(tagMatch[0])}</span>`);
				index += tagMatch[0].length;
				continue;
			}
		}
		const urlMatch = /^https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/.exec(rest);
		if (urlMatch && !isWordCharacter(text[index - 1])) {
			emit(`<a href="${escapeHtml(urlMatch[0])}" target="_blank" rel="noopener noreferrer"><span data-oi-s="${offset + index}">${escapeHtml(urlMatch[0])}</span></a>`);
			index += urlMatch[0].length;
			continue;
		}
		plain(character, index);
		index++;
	}
	flush();
	return out;
}

function renderStyled(content: string, property: PropertyMap, option: MarkdownOption, offset: number): string {
	const style = inlineStyle(property, option.resolveColor);
	const preset = property.get('Preset');
	const className = typeof preset === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(preset) ? ` class="oi-preset-${preset.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}"` : '';
	return `<span${className}${style ? ` style="${escapeHtml(style)}"` : ''}>${renderInline(content, option, offset)}</span>`;
}

// ---------------------------------------------------------------- blocks

const headingPattern = /^(#{1,6})(?:[ \t]+|$)/;
const listPattern = /^([-*+]|(\d{1,9})[.)])(?:[ \t]+|$)/;
const taskPattern = /^\[([ xX])\](?:[ \t]+|$)/;
const rulePattern = /^[ \t]*(?:-[ \t]*){3,}$|^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:_[ \t]*){3,}$/;
const tableSeparatorPattern = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;

export interface ListShape {
	marker: string;
	ordered: boolean;
	number: number;
	task: 'Open' | 'Done' | undefined;
	/** Where the item text starts in the body. */
	textStart: number;
}

export function listShape(body: string): ListShape | undefined {
	const match = listPattern.exec(body);
	if (!match) return undefined;
	let textStart = match[0].length;
	let task: ListShape['task'];
	const taskMatch = taskPattern.exec(body.slice(textStart));
	if (taskMatch) {
		task = taskMatch[1] === ' ' ? 'Open' : 'Done';
		textStart += taskMatch[0].length;
	}
	return { marker: match[1]!, ordered: match[2] !== undefined, number: Number(match[2] ?? 1), task, textStart };
}

export function headingLevel(body: string): number {
	const match = headingPattern.exec(body);
	return match ? match[1]!.length : 0;
}

function splitRow(line: string, lineOffset: number): { text: string; offset: number }[] {
	const cellList: { text: string; offset: number }[] = [];
	let start = 0;
	let end = line.length;
	const leading = /^[ \t]*\|/.exec(line);
	if (leading) start = leading[0].length;
	const trailing = /\|[ \t]*$/.exec(line.slice(start));
	if (trailing) end = start + trailing.index;
	let cellStart = start;
	for (let index = start; index <= end; index++) {
		if (index === end || (line[index] === '|' && line[index - 1] !== '\\')) {
			const raw = line.slice(cellStart, index);
			cellList.push({ text: raw.trim(), offset: lineOffset + cellStart + (raw.length - raw.trimStart().length) });
			cellStart = index + 1;
		}
	}
	return cellList;
}

function renderTable(lineList: readonly string[], offsetList: readonly number[], option: MarkdownOption): string {
	const alignList = splitRow(lineList[1]!, 0).map(({ text }) => (text.startsWith(':') && text.endsWith(':') ? 'center' : text.endsWith(':') ? 'right' : text.startsWith(':') ? 'left' : ''));
	const cell = (tag: string, item: { text: string; offset: number }, index: number): string =>
		`<${tag}${alignList[index] ? ` style="text-align: ${alignList[index]}"` : ''}>${renderInline(item.text, option, item.offset)}</${tag}>`;
	const head = splitRow(lineList[0]!, offsetList[0]!).map((item, index) => cell('th', item, index)).join('');
	const body = lineList
		.slice(2)
		.map((line, index) => `<tr>${splitRow(line, offsetList[index + 2]!).map((item, cellIndex) => cell('td', item, cellIndex)).join('')}</tr>`)
		.join('');
	return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function lines(source: string): { lineList: string[]; offsetList: number[] } {
	const lineList = source.split('\n');
	const offsetList: number[] = [];
	let position = 0;
	for (const line of lineList) {
		offsetList.push(position);
		position += line.length + 1;
	}
	return { lineList, offsetList };
}

function inlineLineList(lineList: readonly string[], offsetList: readonly number[], option: MarkdownOption): string {
	return lineList
		.map((line, index) => {
			const trimmed = line.trimStart();
			return renderInline(trimmed, option, offsetList[index]! + (line.length - trimmed.length));
		})
		.join('<br>');
}

/** Renders one Text block (a heading, list item, quote, table, rule, or paragraph). */
export function renderMarkdown(source: string, option: MarkdownOption): string {
	const { lineList, offsetList } = lines(source);
	const first = lineList[0] ?? '';
	const heading = headingPattern.exec(first);
	if (heading) {
		const level = heading[1]!.length;
		const text = first.slice(heading[0].length);
		const inner = renderInline(text, option, heading[0].length);
		return `<h${level}${text === '' ? ` class="oi-empty-line" data-placeholder="Heading ${level}"` : ''}>${inner}</h${level}>`;
	}
	const list = listShape(source);
	if (list) {
		const firstText = first.slice(list.textStart);
		const box = list.task ? `<input type="checkbox" data-oi-interactive data-oi-task${list.task === 'Done' ? ' checked' : ''} aria-label="Done"> ` : '';
		const more = lineList.length > 1 ? `<br>${inlineLineList(lineList.slice(1), offsetList.slice(1), option)}` : '';
		const emptyClass = firstText === '' && lineList.length === 1 ? ' class="oi-empty-line" data-placeholder="List item"' : '';
		const item = `<li${list.task ? ' class="oi-task"' : ''}><span${emptyClass}>${box}${renderInline(firstText, option, list.textStart)}${more}</span></li>`;
		return list.ordered ? `<ol start="${list.number}">${item}</ol>` : `<ul>${item}</ul>`;
	}
	if (/^[ \t]*>/.test(first)) {
		const prefixList = lineList.map((line) => /^[ \t]*>[ \t]?/.exec(line)?.[0] ?? '');
		const render = (index: number): string => renderInline(lineList[index]!.slice(prefixList[index]!.length), option, offsetList[index]! + prefixList[index]!.length);
		// Obsidian's callouts: > [!tip] Title, and [!tip]- starts folded
		const callout = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/.exec(first.slice(prefixList[0]!.length));
		if (callout) {
			const kind = calloutKind(callout[1]);
			const folded = callout[2] === '-';
			const titleOffset = prefixList[0]!.length + first.slice(prefixList[0]!.length).length - callout[3]!.length;
			const title = callout[3] ? renderInline(callout[3], option, titleOffset) : `<span data-oi-s="${prefixList[0]!.length}" data-oi-e="${first.length}">${escapeHtml(kind)}</span>`;
			const fold = callout[2] ? `<button type="button" class="oi-callout-fold" data-oi-interactive data-oi-callout-fold aria-label="${folded ? 'Expand' : 'Collapse'}">${folded ? '▸' : '▾'}</button>` : '';
			const body = lineList.length > 1 && !folded ? `<div class="oi-callout-body">${lineList.slice(1).map((_, index) => render(index + 1)).join('<br>')}</div>` : '';
			return `<div class="oi-callout-box oi-callout-${kind.toLowerCase()}"><div class="oi-callout-title">${calloutIcon[kind]}<span class="oi-callout-text">${title}</span>${fold}</div>${body}</div>`;
		}
		return `<blockquote>${lineList.map((_, index) => render(index)).join('<br>')}</blockquote>`;
	}
	if (lineList.length >= 2 && first.includes('|') && tableSeparatorPattern.test(lineList[1]!)) return renderTable(lineList, offsetList, option);
	if (lineList.length === 1 && rulePattern.test(first)) return `<hr data-oi-s="0">`;
	return `<p>${inlineLineList(lineList, offsetList, option)}</p>`;
}

/** Folds or unfolds an Obsidian callout (`[!tip]-` ↔ `[!tip]+`). */
export function toggleCalloutFold(body: string): string {
	return body.replace(/^([ \t]*>[ \t]?\[![A-Za-z-]+\])([+-])/, (_, head: string, sign: string) => `${head}${sign === '-' ? '+' : '-'}`);
}

/** Words in a text: word-like segments in any script (Intl.Segmenter), else runs of letters and digits. */
export function countWord(text: string): number {
	const Segmenter = (Intl as { Segmenter?: new (locale?: string, option?: { granularity: 'word' }) => { segment(text: string): Iterable<{ isWordLike?: boolean }> } }).Segmenter;
	if (Segmenter) {
		let count = 0;
		for (const part of new Segmenter(undefined, { granularity: 'word' }).segment(text)) if (part.isWordLike) count++;
		return count;
	}
	return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

/** A Text block's words without Markdown marks, for counting. */
export function markdownPlainText(body: string): string {
	return body
		.replace(/^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+|>[ \t]?(?:\[![A-Za-z-]+\][+-]?)?)/gm, '')
		.replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, label: string | undefined) => label ?? target)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1')
		.replace(/\{[A-Z][A-Za-z0-9]*(?:\s*\{[^}]*\})?:\s*([^}]*)\}/g, '$1')
		.replace(/[*_~=`]/g, '');
}

/** Ticks or unticks the task box of a list item. */
export function toggleTask(body: string): string {
	const list = listShape(body);
	if (!list?.task) return body;
	const boxAt = body.indexOf('[', body.search(/[-*+\d]/));
	return body.slice(0, boxAt + 1) + (list.task === 'Open' ? 'x' : ' ') + body.slice(boxAt + 2);
}
