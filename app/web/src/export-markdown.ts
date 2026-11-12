// A note as Markdown that other apps read (Obsidian, GitHub, a static site). What Markdown can say
// is written in Markdown: text, lists, math ($ and $$), code fences, callouts (Obsidian's `> [!tip]`),
// tables (pipe tables), pictures, and properties (front matter). What it can't say (a structure, a
// plot, a board, a calendar) becomes a picture of the block, named beside the .md; without a
// picture (the Source view, a block that isn't drawn) its OI text is kept in a fence, so nothing is
// lost. Loaded only when a note is exported.

import { type BlockNode, type FormatOption, serializeNode } from '@octaether/core-format';

export interface MarkdownOption {
	/** The note's name: pictures are called `Name 1.png`, `Name 2.png`. */
	name: string;
	format: FormatOption;
	/** Whether a picture of this block can be made (it is drawn on screen). */
	canPicture(node: BlockNode): boolean;
}

export interface MarkdownResult {
	text: string;
	/** The blocks to draw, and the file each one's picture goes in. */
	pictureList: { key: string; file: string }[];
}

/** Types whose children are simply written one after another. */
const flowTypeSet = new Set(['Flow', 'Grid', 'Column']);
const listPattern = /^(?:[-*+]|\d+[.)])\s/;

/** The end of a `{…}` that opens at `start`, counting the braces inside it; -1 when it never closes. */
function closingBrace(text: string, start: number): number {
	let depth = 0;
	for (let at = start; at < text.length; at++) {
		if (text[at] === '\\') at++;
		else if (text[at] === '{') depth++;
		else if (text[at] === '}' && --depth === 0) return at;
	}
	return -1;
}

/** OI's inline forms in Markdown's: `{Math: x}` → `$x$`, `[words]{Color: Accent}` → `words`, `#[Two words]` → `#Two-words`. Code spans are left alone. */
export function inlineMarkdown(text: string): string {
	let out = '';
	let at = 0;
	while (at < text.length) {
		const character = text[at]!;
		if (character === '`') {
			// a code span, as it is
			const run = /^`+/.exec(text.slice(at))![0];
			const end = text.indexOf(run, at + run.length);
			const stop = end < 0 ? text.length : end + run.length;
			out += text.slice(at, stop);
			at = stop;
			continue;
		}
		if (character === '\\' && at + 1 < text.length) {
			// \{ and \^ are OI's escapes; Markdown needs neither
			out += /[{^]/.test(text[at + 1]!) ? text[at + 1] : text.slice(at, at + 2);
			at += 2;
			continue;
		}
		if (character === '{') {
			const head = /^\{([A-Z][A-Za-z0-9]*)(?:\s*\{[^{}]*\})?:\s?/.exec(text.slice(at));
			const end = head ? closingBrace(text, at) : -1;
			if (head && end > 0) {
				const content = text.slice(at + head[0].length, end);
				out += head[1] === 'Math' ? `$${content}$` : head[1] === 'Code' ? `\`${content}\`` : content;
				at = end + 1;
				continue;
			}
		}
		if (character === ']' && text[at + 1] === '{') {
			// a styled span: its words stay (they were written before the bracket closed), its style goes
			const end = closingBrace(text, at + 1);
			const open = out.lastIndexOf('[');
			if (end > 0 && open >= 0 && !out.slice(open).includes('\n')) {
				out = out.slice(0, open) + out.slice(open + 1);
				at = end + 1;
				continue;
			}
		}
		if (character === '#' && text[at + 1] === '[') {
			const end = text.indexOf(']', at);
			if (end > 0) {
				out += `#${text.slice(at + 2, end).trim().replace(/\s+/g, '-')}`;
				at = end + 1;
				continue;
			}
		}
		out += character;
		at++;
	}
	return out;
}

/** One line of CSV as its cells (quotes as spreadsheets write them). */
function csvCell(line: string): string[] {
	const cellList: string[] = [];
	let cell = '';
	let quoted = false;
	for (let at = 0; at < line.length; at++) {
		const character = line[at]!;
		if (quoted) {
			if (character === '"' && line[at + 1] === '"') {
				cell += '"';
				at++;
			} else if (character === '"') quoted = false;
			else cell += character;
		} else if (character === '"' && cell.trim() === '') quoted = true;
		else if (character === ',') {
			cellList.push(cell.trim());
			cell = '';
		} else cell += character;
	}
	cellList.push(cell.trim());
	return cellList;
}

function pipeTable(body: string): string[] {
	const rowList = body.split('\n').filter((line) => line.trim() !== '').map(csvCell);
	const width = Math.max(...rowList.map((row) => row.length));
	const line = (row: string[]): string => `| ${Array.from({ length: width }, (_, index) => (row[index] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
	return [line(rowList[0]!), `|${' --- |'.repeat(width)}`, ...rowList.slice(1).map(line)];
}

/** A path or address inside `(…)`: in angle brackets when it has spaces. */
function target(address: string): string {
	return /[\s()]/.test(address) ? `<${address}>` : address;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function noteMarkdown(itemList: readonly BlockNode[], option: MarkdownOption): MarkdownResult {
	const pictureList: MarkdownResult['pictureList'] = [];
	let front: string[] = [];

	const fenced = (node: BlockNode): string[] => {
		const lineList = serializeNode(node, option.format).map((line) => line.replace(new RegExp(`^\\t{${node.level}}`), ''));
		const fence = '`'.repeat(Math.max(3, ...lineList.map((line) => (/^`+/.exec(line.trim())?.[0].length ?? 0) + 1)));
		return [`${fence}oi`, ...lineList, fence];
	};
	const picture = (node: BlockNode): string[] => {
		if (!option.canPicture(node)) return fenced(node);
		const file = `${option.name} ${pictureList.length + 1}.png`;
		pictureList.push({ key: node.key, file });
		const title = text(node.property.get('Title')) || node.type;
		return [`![${title}](${target(file)})`];
	};
	const isListItem = (node: BlockNode): boolean => node.type === 'Text' && listPattern.test(node.body);
	const blockList = (list: readonly BlockNode[]): string[] => {
		const out: string[] = [];
		let previous: BlockNode | undefined;
		for (const node of list) {
			const lineList = block(node);
			if (lineList.length === 0) continue;
			// list items sit one under another; everything else is a paragraph apart
			if (previous && !(isListItem(previous) && isListItem(node))) out.push('');
			out.push(...lineList);
			previous = node;
		}
		return out;
	};
	const block = (node: BlockNode): string[] => {
		const body = node.body.replace(/\s+$/, '');
		if (node.type === 'Text') {
			const own = body === '' ? [] : inlineMarkdown(body).split('\n');
			// what is under a list item (or a paragraph) stays under it: four spaces deeper
			const inner = blockList(node.childList).map((line) => (line === '' ? '' : `    ${line}`));
			return [...own, ...inner];
		}
		if (flowTypeSet.has(node.type)) return blockList(node.childList);
		if (node.type === 'Property') {
			// a note's fields are Markdown's front matter (the first Property block; `Tag` is `tags` there)
			if (front.length === 0 && body !== '') {
				front = body.split('\n').map((line) => line.replace(/^Tag:/, 'tags:'));
				return [];
			}
			return fenced(node);
		}
		if (node.type === 'Math') return ['$$', ...body.split('\n'), '$$'];
		if (node.type === 'Code') {
			const fence = '`'.repeat(Math.max(3, ...body.split('\n').map((line) => (/^`+/.exec(line.trim())?.[0].length ?? 0) + 1)));
			return [`${fence}${text(node.property.get('Language'))}`, ...body.split('\n'), fence];
		}
		if (node.type === 'Markdown' || node.type === 'HTML') return body.split('\n');
		if (node.type === 'Image' || node.type === 'Video') {
			const source = text(node.property.get('Source'));
			if (source === '') return [];
			const caption = inlineMarkdown(body).replace(/\n+/g, ' ');
			return node.type === 'Image' ? [`![${caption}](${target(source)})`] : [`[${caption || source}](${target(source)})`];
		}
		if (node.type === 'Callout') {
			const kind = text(node.property.get('Kind')).toLowerCase() || 'note';
			return [`> [!${kind}]${body ? ` ${inlineMarkdown(body)}` : ''}`, ...blockList(node.childList).map((line) => (line === '' ? '>' : `> ${line}`))];
		}
		if (node.type === 'Table' && body.trim() !== '' && node.property.get('File') === undefined && node.property.get('Source') === undefined) {
			const title = text(node.property.get('Title'));
			return [...(title ? [`**${title}**`, ''] : []), ...pipeTable(body)];
		}
		return picture(node);
	};

	const lineList = blockList(itemList);
	const head = front.length > 0 ? ['---', ...front, '---', ''] : [];
	return { text: `${[...head, ...lineList].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`, pictureList };
}
