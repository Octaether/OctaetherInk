// A whole Markdown document in one block: paragraphs, headings, nested lists and to-dos, quotes
// and callouts, tables, rules, and fenced code. Each piece is drawn by the Text module's own
// renderer, so it looks like the rest of the note, and every piece keeps its offset in the
// body (data-oi-s), so a click lands on its spot.

import { escapeHtml } from '@octaether/core-sdk';
import { type MarkdownOption, headingLevel, listShape, renderInline, renderMarkdown } from '@octaether/module-text';

export interface DocumentOption extends MarkdownOption {
	/** Colours fenced code (the Code module's highlighter); `offset` is where the code starts. */
	highlight?(code: string, language: string | undefined, offset: number): string;
}

interface Line {
	text: string;
	offset: number;
}

const fencePattern = /^(`{3,}|~{3,})(.*)$/;
const rulePattern = /^[ \t]*(?:-[ \t]*){3,}$|^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:_[ \t]*){3,}$/;
const tableSeparatorPattern = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;
const listItemPattern = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const quotePattern = /^[ \t]*>/;

/** Moves every source offset in rendered HTML by `by` (a piece drawn on its own starts at 0). */
export function shiftOffset(html: string, by: number): string {
	return by === 0 ? html : html.replace(/data-oi-([se])="(\d+)"/g, (_, kind: string, value: string) => `data-oi-${kind}="${Number(value) + by}"`);
}

function splitLine(source: string): Line[] {
	const list: Line[] = [];
	let offset = 0;
	for (const text of source.split('\n')) {
		list.push({ text, offset });
		offset += text.length + 1;
	}
	return list;
}

function isBlank(line: Line | undefined): boolean {
	return line === undefined || line.text.trim() === '';
}

function indentOf(text: string): number {
	let width = 0;
	for (const character of text) {
		if (character === ' ') width++;
		else if (character === '\t') width += 4;
		else break;
	}
	return width;
}

/** A line that starts a block of its own (so it ends a paragraph). */
function startsBlock(line: Line, next: Line | undefined): boolean {
	const text = line.text;
	return (
		headingLevel(text.trimStart()) > 0 ||
		fencePattern.test(text.trimStart()) ||
		quotePattern.test(text) ||
		listItemPattern.test(text) ||
		rulePattern.test(text) ||
		(text.includes('|') && next !== undefined && tableSeparatorPattern.test(next.text))
	);
}

/** A piece drawn by the Text module, moved to where it sits in the body. */
function piece(lineList: readonly Line[], option: DocumentOption): string {
	const first = lineList[0]!;
	return shiftOffset(renderMarkdown(lineList.map((line) => line.text).join('\n'), option), first.offset);
}

interface ListItem {
	indent: number;
	ordered: boolean;
	number: number;
	task: 'Open' | 'Done' | undefined;
	/** Where the `[ ]` box sits in the body (to tick it). */
	boxOffset: number;
	lineList: Line[];
	textStart: number;
	childList: ListItem[];
}

function renderList(itemList: readonly ListItem[], option: DocumentOption): string {
	const ordered = itemList[0]!.ordered;
	const html = itemList
		.map((item) => {
			const [first, ...rest] = item.lineList;
			const box = item.task ? `<input type="checkbox" data-oi-interactive data-oi-markdown-task="${item.boxOffset}"${item.task === 'Done' ? ' checked' : ''} aria-label="Done"> ` : '';
			const text = renderInline(first!.text.slice(item.textStart), option, first!.offset + item.textStart);
			const more = rest.map((line) => {
				const trimmed = line.text.trimStart();
				return `<br>${renderInline(trimmed, option, line.offset + line.text.length - trimmed.length)}`;
			});
			const child = item.childList.length > 0 ? renderList(item.childList, option) : '';
			return `<li${item.task ? ' class="oi-task"' : ''}>${box}${text}${more.join('')}${child}</li>`;
		})
		.join('');
	return ordered ? `<ol start="${itemList[0]!.number}">${html}</ol>` : `<ul>${html}</ul>`;
}

/** Reads a list from `start`; returns its HTML and the line after it. */
function readList(lineList: readonly Line[], start: number, option: DocumentOption): { html: string; next: number } {
	const rootList: ListItem[] = [];
	const stack: ListItem[] = [];
	let index = start;
	while (index < lineList.length) {
		const line = lineList[index]!;
		if (isBlank(line)) {
			// a blank line ends the list unless an item (or an indented line) follows
			const after = lineList[index + 1];
			if (after && !isBlank(after) && (listItemPattern.test(after.text) || indentOf(after.text) > 0)) {
				index++;
				continue;
			}
			break;
		}
		const match = listItemPattern.exec(line.text);
		if (!match) {
			// an indented line continues the item above; anything else ends the list
			if (stack.length === 0 || indentOf(line.text) === 0) break;
			stack[stack.length - 1]!.lineList.push(line);
			index++;
			continue;
		}
		const indent = indentOf(match[1]!);
		const shape = listShape(line.text.slice(match[1]!.length))!;
		const item: ListItem = {
			indent,
			ordered: shape.ordered,
			number: shape.number,
			task: shape.task,
			boxOffset: line.offset + line.text.indexOf('[', match[1]!.length),
			lineList: [line],
			textStart: match[1]!.length + shape.textStart,
			childList: [],
		};
		while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
		const parent = stack[stack.length - 1];
		(parent ? parent.childList : rootList).push(item);
		stack.push(item);
		index++;
	}
	// items of a different kind (bullets after numbers) at the top start a new list, as in Markdown
	const groupList: ListItem[][] = [];
	for (const item of rootList) {
		const last = groupList[groupList.length - 1];
		if (last && last[0]!.ordered === item.ordered) last.push(item);
		else groupList.push([item]);
	}
	return { html: groupList.map((group) => renderList(group, option)).join(''), next: index };
}

export function renderDocument(source: string, option: DocumentOption): string {
	const lineList = splitLine(source);
	const out: string[] = [];
	let index = 0;
	while (index < lineList.length) {
		const line = lineList[index]!;
		if (isBlank(line)) {
			index++;
			continue;
		}
		const fence = fencePattern.exec(line.text);
		if (fence) {
			const marker = fence[1]!;
			let close = index + 1;
			while (close < lineList.length && !(lineList[close]!.text.trimEnd().startsWith(marker) && /^[`~]+$/.test(lineList[close]!.text.trim()))) close++;
			const bodyList = lineList.slice(index + 1, close);
			const code = bodyList.map((item) => item.text).join('\n');
			const language = fence[2]!.trim().split(/\s+/)[0] || undefined;
			const offset = bodyList[0]?.offset ?? line.offset + line.text.length;
			const html = option.highlight ? option.highlight(code, language, offset) : `<span data-oi-s="${offset}">${escapeHtml(code)}</span>`;
			out.push(`<pre class="oi-markdown-code"><code>${html || ' '}</code></pre>`);
			index = close + 1;
			continue;
		}
		if (headingLevel(line.text) > 0 || rulePattern.test(line.text)) {
			out.push(piece([line], option));
			index++;
			continue;
		}
		if (listItemPattern.test(line.text)) {
			const list = readList(lineList, index, option);
			out.push(list.html);
			index = list.next;
			continue;
		}
		const next = lineList[index + 1];
		let end = index + 1;
		if (quotePattern.test(line.text)) {
			while (end < lineList.length && quotePattern.test(lineList[end]!.text)) end++;
		} else if (line.text.includes('|') && next && tableSeparatorPattern.test(next.text)) {
			end = index + 2;
			while (end < lineList.length && lineList[end]!.text.includes('|') && !isBlank(lineList[end])) end++;
		} else {
			// a paragraph: up to a blank line or a line that starts something else
			while (end < lineList.length && !isBlank(lineList[end]) && !startsBlock(lineList[end]!, lineList[end + 1])) end++;
		}
		out.push(piece(lineList.slice(index, end), option));
		index = end;
	}
	return out.join('');
}

/** Ticks or unticks the to-do whose `[ ]` sits at `boxOffset`. */
export function toggleTaskAt(body: string, boxOffset: number): string {
	const box = body.slice(boxOffset, boxOffset + 3);
	if (!/^\[[ xX]\]$/.test(box)) return body;
	return `${body.slice(0, boxOffset + 1)}${box[1] === ' ' ? 'x' : ' '}${body.slice(boxOffset + 2)}`;
}
