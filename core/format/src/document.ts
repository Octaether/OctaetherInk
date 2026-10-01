// OI document v2: a note (optional `---` property section + an indented block tree) or a
// property document (meta file whose first line is `Kind: ...`).
//
//   Math {Numbered: True}: x^2              ← a block: `Type {Props}:` (always a colon), then its body
//   Code {Wrap: True}: Python               ← a type with a header argument: its main property after the colon,
//   	print(1)                                and the body on the indented lines
//   A paragraph with trailing props. {Color: Accent}
//   - a list item
//   	- a nested item                       ← any text or container block holds indented children
//   ```Python                               ← an alias: symbols a module lets you open its block with
//   print(1)                                   (``` and ~~~ for Code, $$ for Math), as in Markdown
//   ```
//
// IDs (`^id`) are optional and only written when something points at a block. Runtime
// `key`s identify blocks in memory and are never written. Lossless: untouched blocks keep
// their exact lines; a block whose children changed keeps its own lines.

import {
	type Problem,
	type PropertyMap,
	type PropertySection,
	chunkEnd,
	findClosingBracket,
	formatInline,
	formatPairLineList,
	indentText,
	isBlank,
	maxInlineWidth,
	measureIndent,
	parseBlockMap,
	parseFlowMapText,
	parsePropertySection,
	readArgument,
	serializeSection,
	stripIndent,
	writeArgument,
} from './property';

export type ContentKind = 'Raw' | 'Item';

export interface BlockNode {
	/** Runtime identity (never written). */
	key: string;
	/** `Text` for plain paragraphs, headings, list items, quotes, and tables. */
	type: string;
	/** Written as plain Markdown lines instead of `Type:` (Text only). */
	implicit: boolean;
	/** Written with an alias instead of `Type:`: the exact symbols it opened with (```` ``` ````, `~~~~`, `$$`). */
	alias?: string;
	version: number;
	/** Optional persistent ID (`^id`), written only when something links to the block. */
	id: string | undefined;
	property: PropertyMap;
	/** Raw blocks: the verbatim body. Item blocks: their own text (Text: Markdown; containers: usually ''). */
	body: string;
	/** Child blocks (Item blocks only). */
	childList: BlockNode[];
	content: ContentKind;
	level: number;
	/** Exact blank lines before this block; undefined = canonical. */
	gapLineList: string[] | undefined;
	/** Exact lines of the block's own part (header/text/raw body); undefined = changed. */
	headLineList: string[] | undefined;
	/** Exact lines of the whole block including children; undefined = changed. */
	rawLineList: string[] | undefined;
}

interface SourceShape {
	bom: boolean;
	newline: '\n' | '\r\n';
	finalNewline: boolean;
	problemList: Problem[];
}

export interface NoteDocument extends SourceShape {
	kind: 'Note';
	front: PropertySection | undefined;
	itemList: BlockNode[];
	tailLineList: string[];
}

export interface PropertyDocument extends SourceShape {
	kind: 'Property';
	section: PropertySection;
}

export type OiDocument = NoteDocument | PropertyDocument;

/**
 * Symbols that open a block instead of `Type:`, as Markdown's ``` does for code. A module
 * declares its own; each can be switched off or changed in its settings.
 */
export interface BlockAlias {
	/** The symbols, e.g. "```" or "$$". */
	marker: string;
	/** The block type it opens (a Raw type). */
	type: string;
	/**
	 * What follows the marker on its line. Argument: what follows `Type:` (a code fence's language),
	 * and the block ends on a line holding only the marker. Body: the start of the body (`$$x^2$$`),
	 * and the block ends on the line that ends with the marker.
	 */
	opening: 'Argument' | 'Body';
	/** A longer run of the marker's character opens it too and must close it (```` holds ```), as in Markdown. */
	repeat?: boolean;
}

export interface FormatOption {
	/** Registered block types (switched on or off). A known type followed by ":" is always a block. */
	isKnownType?(type: string): boolean;
	/** Raw: the indented body is verbatim text. Item: it holds child blocks. Unknown types are Raw. */
	contentKind?(type: string): ContentKind;
	/** Whether a one-line body may be written after the colon (`Math: x^2`). A Property block always indents its lines. */
	inlineBody?(type: string): boolean;
	/**
	 * The property the value after the colon sets (`Code: Python` → `Language: Python`). Other
	 * properties stay in `{…}` before the colon, as for every block, and the body always goes on
	 * indented lines.
	 */
	argumentKey?(type: string): string | undefined;
	/** The aliases in use (switched-off ones left out). */
	aliasList?(): readonly BlockAlias[];
}

/** Types whose body is always written on indented lines, even when it is one line. */
export const defaultIndentedTypeSet: ReadonlySet<string> = new Set(['Property']);

export const defaultArgumentMap: ReadonlyMap<string, string> = new Map([
	['Code', 'Language'],
	['Image', 'Source'],
	['Video', 'Source'],
	['Audio', 'Source'],
	['PDF', 'Source'],
]);

export const defaultAliasList: readonly BlockAlias[] = [
	{ marker: '```', type: 'Code', opening: 'Argument', repeat: true },
	{ marker: '~~~', type: 'Code', opening: 'Argument', repeat: true },
	{ marker: '$$', type: 'Math', opening: 'Body' },
];

export const defaultItemTypeSet: ReadonlySet<string> = new Set([
	'Text', 'Flow', 'Grid', 'Column', 'Group', 'Page', 'Canvas', 'Deck', 'Slide', 'Event', 'Callout', 'Toggle',
]);

export const defaultKnownTypeSet: ReadonlySet<string> = new Set([
	...defaultItemTypeSet,
	'Math', 'Code', 'Chem', 'Plot', 'Diagram', 'Image', 'Ink', 'Table', 'PDF', 'Audio', 'Video', 'HTML', 'Markdown', 'View', 'Property',
]);

interface ResolvedOption {
	isKnownType(type: string): boolean;
	contentKind(type: string): ContentKind;
	inlineBody(type: string): boolean;
	/** Only for Raw types: an Item type's text after the colon is its title. */
	argumentKey(type: string): string | undefined;
	/** Longest marker first, so `$$` is tried before `$`. */
	aliasList: readonly BlockAlias[];
}

function resolveOption(option: FormatOption): ResolvedOption {
	const contentKind = option.contentKind ?? ((type: string): ContentKind => (defaultItemTypeSet.has(type) ? 'Item' : 'Raw'));
	const argumentKey = option.argumentKey ?? ((type: string) => defaultArgumentMap.get(type));
	return {
		isKnownType: option.isKnownType ?? ((type) => defaultKnownTypeSet.has(type)),
		contentKind,
		inlineBody: option.inlineBody ?? ((type) => !defaultIndentedTypeSet.has(type)),
		argumentKey: (type) => (contentKind(type) === 'Raw' ? argumentKey(type) : undefined),
		aliasList: [...(option.aliasList?.() ?? defaultAliasList)]
			.filter((alias) => alias.marker !== '' && contentKind(alias.type) === 'Raw')
			.sort((left, right) => right.marker.length - left.marker.length),
	};
}

let keyCounter = 0;

/** A runtime key, unique within this session. */
export function createKey(): string {
	keyCounter += 1;
	return `k${keyCounter.toString(36)}`;
}

// ---------------------------------------------------------------- header line

export interface HeaderText {
	type: string;
	version: number;
	id: string | undefined;
	propText: string | undefined;
	openMulti: boolean;
	colon: boolean;
	inline: string | undefined;
}

const typePattern = /^([A-Z][A-Za-z0-9]*)(?:@([1-9]\d*))?/;
const headerIdPattern = /^[ \t]+\^([a-z0-9]+)(?=[ \t{:]|$)/;
const headingPattern = /^#{1,6}(?:[ \t]|$)/;
const listPattern = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const quotePattern = /^>/;
const tableSeparatorPattern = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;
/** ` ^id` at the end of a text block: 3+ chars with at least one letter (so "x ^2" stays text). */
export const textIdPattern = /[ \t]\^((?=[a-z0-9]*[a-z])[a-z0-9]{3,})[ \t]*$/;
const escapedTextIdPattern = /[ \t](\\*)\^(?=[a-z0-9]*[a-z])[a-z0-9]{3,}[ \t]*$/;
const pascalKeyPattern = /^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*$/;

/** A marker made of one character repeated (```), which may run longer when `repeat` is set. */
function isRun(marker: string): boolean {
	return [...marker].every((character) => character === marker[0]);
}

function runsLonger(alias: BlockAlias): boolean {
	return alias.repeat === true && isRun(alias.marker);
}

export interface AliasMatch {
	alias: BlockAlias;
	/** The symbols as written (a fence may be longer than its alias). */
	marker: string;
	/** What follows them on the line. */
	after: string;
}

/** The alias a line (without its indentation) starts with, if any. */
export function matchAlias(rest: string, aliasList: readonly BlockAlias[]): AliasMatch | undefined {
	for (const alias of aliasList) {
		if (!rest.startsWith(alias.marker)) continue;
		let length = alias.marker.length;
		if (runsLonger(alias)) while (rest[length] === alias.marker[0]) length++;
		const after = rest.slice(length);
		// as in Markdown, the info string of a backtick fence can't hold a backtick (so ```x``` is inline code)
		if (alias.opening === 'Argument' && alias.marker[0] === '`' && after.includes('`')) continue;
		return { alias, marker: rest.slice(0, length), after };
	}
	return undefined;
}

/** A text line that starts like an alias (so text holding one is written with a leading `\`). */
function opensAlias(line: string, aliasList: readonly BlockAlias[]): boolean {
	return matchAlias(line, aliasList) !== undefined;
}

function readColon(after: string): { colon: boolean; inline: string | undefined } | undefined {
	if (after.trim() === '') return { colon: false, inline: undefined };
	if (after[0] !== ':') return undefined;
	const rest = after.slice(1);
	if (rest.trim() === '') return { colon: true, inline: undefined };
	if (rest[0] !== ' ' && rest[0] !== '\t') return undefined;
	return { colon: true, inline: rest.slice(1) };
}

/** Parses `Type[@v] [^id] [{props}]:[ inline]` (no indentation). */
export function parseHeaderText(rest: string): HeaderText | undefined {
	const typeMatch = typePattern.exec(rest);
	if (!typeMatch) return undefined;
	let position = typeMatch[0].length;
	const next = rest[position];
	if (next !== undefined && next !== ' ' && next !== '\t' && next !== '{' && next !== ':') return undefined;
	const base = { type: typeMatch[1]!, version: typeMatch[2] ? Number(typeMatch[2]) : 1 };
	let id: string | undefined;
	const idMatch = headerIdPattern.exec(rest.slice(position));
	if (idMatch) {
		id = idMatch[1];
		position += idMatch[0].length;
	}
	let cursor = position;
	while (rest[cursor] === ' ' || rest[cursor] === '\t') cursor++;
	let propText: string | undefined;
	if (rest[cursor] === '{') {
		const close = findClosingBracket(rest, cursor);
		if (close < 0) {
			if (rest.slice(cursor + 1).trim() !== '') return undefined;
			return { ...base, id, propText: undefined, openMulti: true, colon: false, inline: undefined };
		}
		propText = rest.slice(cursor, close + 1);
		position = close + 1;
	}
	const tail = readColon(rest.slice(position));
	if (!tail) return undefined;
	return { ...base, id, propText, openMulti: false, colon: tail.colon, inline: tail.inline };
}

/**
 * A header needs a colon, and then: a known type, an `^id`, `{props}`, or a bare colon with
 * deeper-indented lines after it. So prose like "Summary: it works" stays text.
 */
export function acceptHeader(header: HeaderText, nextDeeper: boolean, isKnownType: (type: string) => boolean): boolean {
	if (header.openMulti) return header.id !== undefined || isKnownType(header.type) || nextDeeper;
	if (!header.colon) return false;
	return isKnownType(header.type) || header.id !== undefined || header.propText !== undefined || (header.inline === undefined && nextDeeper);
}

function deeperFollows(lineList: readonly string[], from: number, end: number, level: number): boolean {
	for (let index = from; index < end; index++) {
		const line = lineList[index]!;
		if (isBlank(line)) continue;
		return measureIndent(line).level > level;
	}
	return false;
}

interface HeaderMatch extends HeaderText {
	headerEnd: number;
	propLineList: string[] | undefined;
	propLineIndex: number;
}

function matchHeader(lineList: readonly string[], index: number, end: number, level: number, option: ResolvedOption): HeaderMatch | undefined {
	const indent = measureIndent(lineList[index]!);
	if (indent.level !== level || /^[ \t]/.test(indent.rest)) return undefined;
	const header = parseHeaderText(indent.rest);
	if (!header) return undefined;
	if (!header.openMulti) {
		if (!acceptHeader(header, deeperFollows(lineList, index + 1, end, level), option.isKnownType)) return undefined;
		return { ...header, headerEnd: index + 1, propLineList: undefined, propLineIndex: index };
	}
	let close = -1;
	for (let scan = index + 1; scan < end; scan++) {
		const line = lineList[scan]!;
		if (isBlank(line)) continue;
		const scanIndent = measureIndent(line);
		if (scanIndent.level > level) continue;
		if (scanIndent.level === level && scanIndent.rest.startsWith('}')) close = scan;
		break;
	}
	if (close < 0) return undefined;
	const tail = readColon(measureIndent(lineList[close]!).rest.slice(1));
	if (!tail || !tail.colon) return undefined;
	const full: HeaderText = { ...header, openMulti: false, colon: true, inline: tail.inline, propText: '{}' };
	if (!acceptHeader(full, true, option.isKnownType)) return undefined;
	return { ...full, headerEnd: close + 1, propLineList: lineList.slice(index + 1, close), propLineIndex: index + 1 };
}

// ---------------------------------------------------------------- text helpers

type TextShape = 'Heading' | 'List' | 'Quote' | 'Table' | 'Paragraph';

function textShape(rest: string, nextRest: string | undefined): TextShape {
	if (headingPattern.test(rest)) return 'Heading';
	if (listPattern.test(rest)) return 'List';
	if (quotePattern.test(rest)) return 'Quote';
	if (rest.includes('|') && nextRest !== undefined && tableSeparatorPattern.test(nextRest)) return 'Table';
	return 'Paragraph';
}

/** Finds trailing ` {Key: value}` block properties at the end of a text line. */
function findTrailingProperty(line: string): { at: number; property: PropertyMap } | undefined {
	const trimmed = line.trimEnd();
	if (!trimmed.endsWith('}')) return undefined;
	for (let start = trimmed.lastIndexOf('{'); start > 0; start = trimmed.lastIndexOf('{', start - 1)) {
		const before = trimmed[start - 1];
		if (before !== ' ' && before !== '\t') continue;
		if (findClosingBracket(trimmed, start) !== trimmed.length - 1) continue;
		const { value, problem } = parseFlowMapText(trimmed.slice(start));
		if (problem || value.size === 0 || ![...value.keys()].every((key) => pascalKeyPattern.test(key))) return undefined;
		return { at: start - 1, property: value };
	}
	return undefined;
}

/** `text \{Key: v}` → one backslash fewer (the text really ends in `{Key: v}`). */
function trailingEscapeAt(line: string): number {
	const trimmed = line.trimEnd();
	if (!trimmed.endsWith('}')) return -1;
	for (let start = trimmed.lastIndexOf('{'); start > 0; start = trimmed.lastIndexOf('{', start - 1)) {
		if (trimmed[start - 1] !== '\\') continue;
		let slash = start - 1;
		while (slash > 0 && trimmed[slash - 1] === '\\') slash--;
		const before = trimmed[slash - 1];
		if (slash > 0 && before !== ' ' && before !== '\t') continue;
		if (findClosingBracket(trimmed, start) !== trimmed.length - 1) continue;
		const { value, problem } = parseFlowMapText(trimmed.slice(start));
		if (problem || value.size === 0 || ![...value.keys()].every((key) => pascalKeyPattern.test(key))) continue;
		return start - 1;
	}
	return -1;
}

// ---------------------------------------------------------------- parse

interface SplitSource {
	lineList: string[];
	bom: boolean;
	newline: '\n' | '\r\n';
	finalNewline: boolean;
}

function splitSource(source: string): SplitSource {
	let text = source;
	const bom = text.startsWith('﻿');
	if (bom) text = text.slice(1);
	const firstBreak = text.indexOf('\n');
	const newline = firstBreak > 0 && text[firstBreak - 1] === '\r' ? '\r\n' : '\n';
	const normalized = text.replace(/\r\n/g, '\n');
	// an empty file gets a final newline as soon as it has content
	const finalNewline = normalized.endsWith('\n') || normalized === '';
	const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
	const lineList = normalized === '' ? [] : body.split('\n');
	return { lineList, bom, newline, finalNewline };
}

class NoteParser {
	private lineStartList: number[] | undefined;

	constructor(
		readonly lineList: readonly string[],
		readonly option: ResolvedOption,
		readonly problemList: Problem[],
		/** When given: where each body line of a block starts in the source, by key (for editors). */
		readonly spanMap?: Map<string, number[]>,
	) {}

	itemList(start: number, end: number, level: number): { itemList: BlockNode[]; tailLineList: string[] } {
		const itemList: BlockNode[] = [];
		let pending: string[] = [];
		let index = start;
		while (index < end) {
			const line = this.lineList[index]!;
			if (isBlank(line)) {
				pending.push(line);
				index++;
				continue;
			}
			const header = matchHeader(this.lineList, index, end, level, this.option);
			const parsed = header ? this.block(index, end, level, header) : (this.alias(index, end, level, true) ?? this.text(index, end, level));
			parsed.node.gapLineList = pending;
			pending = [];
			itemList.push(parsed.node);
			index = parsed.next;
		}
		return { itemList, tailLineList: pending };
	}

	private regionEnd(from: number, end: number, level: number): number {
		// deeper lines (possibly after blank lines) belong to the block that starts at `from - 1`
		return Math.max(chunkEnd(this.lineList, from - 1, level, end), from);
	}

	/** Where a line starts in the source. */
	private offsetOf(index: number): number {
		if (!this.lineStartList) {
			this.lineStartList = [];
			let offset = 0;
			for (const line of this.lineList) {
				this.lineStartList.push(offset);
				offset += line.length + 1;
			}
		}
		return this.lineStartList[index] ?? 0;
	}

	/** Where a line's text starts once `level` indentation units are left out. */
	private textStart(index: number, level: number): number {
		const line = this.lineList[index]!;
		return this.offsetOf(index) + line.length - stripIndent(line, level).length;
	}

	block(index: number, end: number, level: number, header: HeaderMatch): { node: BlockNode; next: number } {
		let property: PropertyMap = new Map();
		if (header.propLineList) {
			property = parseBlockMap(header.propLineList, level + 1, header.propLineIndex, this.problemList);
		} else if (header.propText !== undefined) {
			const result = parseFlowMapText(header.propText);
			if (result.problem) this.problemList.push({ line: index, message: `block properties: ${result.problem}` });
			property = result.value;
		}
		const content = this.option.contentKind(header.type);
		const argumentKey = this.option.argumentKey(header.type);
		let inline = header.inline;
		if (argumentKey !== undefined && inline !== undefined) {
			// `Code {Wrap: True}: Python`: what follows the colon is the main property, and the body is indented
			property = withArgument(property, argumentKey, readArgument(inline));
			inline = undefined;
		}
		const regionEnd = this.regionEnd(header.headerEnd, end, level);
		const node: BlockNode = {
			key: createKey(),
			type: header.type,
			implicit: false,
			version: header.version,
			id: header.id,
			property,
			body: '',
			childList: [],
			content,
			level,
			gapLineList: undefined,
			headLineList: undefined,
			rawLineList: this.lineList.slice(index, regionEnd),
		};
		const inlineLine = header.headerEnd - 1;
		const spanList = this.spanMap && inline !== undefined ? [this.offsetOf(inlineLine) + this.lineList[inlineLine]!.length - inline.length] : [];
		if (content === 'Item') {
			node.body = inline ?? '';
			node.childList = this.itemList(header.headerEnd, regionEnd, level + 1).itemList;
			node.headLineList = this.lineList.slice(index, header.headerEnd);
		} else {
			const bodyLineList = this.lineList.slice(header.headerEnd, regionEnd).map((line) => stripIndent(line, level + 1));
			if (inline !== undefined) bodyLineList.unshift(inline);
			node.body = bodyLineList.join('\n');
			node.headLineList = node.rawLineList;
			if (this.spanMap) for (let at = header.headerEnd; at < regionEnd; at++) spanList.push(this.textStart(at, level + 1));
		}
		this.spanMap?.set(node.key, spanList);
		return { node, next: regionEnd };
	}

	/** A block opened with an alias at this level: ```Python … ```, $$ … $$. `record` = not a look-ahead. */
	alias(index: number, end: number, level: number, record: boolean): { node: BlockNode; next: number } | undefined {
		const indent = measureIndent(this.lineList[index]!);
		if (indent.level !== level || /^[ \t]/.test(indent.rest)) return undefined;
		const match = matchAlias(indent.rest, this.option.aliasList);
		if (!match) return undefined;
		return match.alias.opening === 'Argument' ? this.argumentAlias(index, end, level, match, record) : this.bodyAlias(index, end, level, match, record);
	}

	private aliasNode(match: AliasMatch, level: number, body: string, property: PropertyMap, id: string | undefined, lineList: string[]): BlockNode {
		return {
			key: createKey(),
			type: match.alias.type,
			implicit: false,
			alias: match.marker,
			version: 1,
			id,
			property,
			body,
			childList: [],
			content: 'Raw',
			level,
			gapLineList: undefined,
			headLineList: lineList,
			rawLineList: lineList,
		};
	}

	/** ```Python ^id … ```: the opening line holds what `Code:` would, and a line of just the marker closes it. */
	private argumentAlias(index: number, end: number, level: number, match: AliasMatch, record: boolean): { node: BlockNode; next: number } {
		const { alias, marker } = match;
		const closes = (rest: string): boolean => {
			const trimmed = rest.trimEnd();
			return runsLonger(alias) ? trimmed.length >= marker.length && trimmed[0] === marker[0] && isRun(trimmed) : trimmed === marker;
		};
		let close = -1;
		let stop = end;
		for (let scan = index + 1; scan < end; scan++) {
			const line = this.lineList[scan]!;
			if (isBlank(line)) continue;
			const scanIndent = measureIndent(line);
			// a line left of the opening one ends it (the block around it ended)
			if (scanIndent.level < level) {
				stop = scan;
				break;
			}
			if (scanIndent.level === level && closes(scanIndent.rest)) {
				close = scan;
				break;
			}
		}
		let bodyEnd = close >= 0 ? close : stop;
		if (close < 0) {
			// an unclosed block runs to the end of the block around it, as in Markdown; trailing blank lines stay a gap
			while (bodyEnd > index + 1 && isBlank(this.lineList[bodyEnd - 1]!)) bodyEnd--;
			if (record) this.problemList.push({ line: index, message: `the ${alias.type} block is not closed with ${marker}` });
		}
		const next = close >= 0 ? close + 1 : bodyEnd;
		// the opening line, as in Markdown: the header argument (a language), then optional ` {Props}` and ` ^id`
		let info = ` ${match.after.trim()}`;
		let id: string | undefined;
		const idMatch = textIdPattern.exec(info);
		if (idMatch) {
			id = idMatch[1];
			info = info.slice(0, idMatch.index);
		}
		let property: PropertyMap = new Map();
		const trailing = findTrailingProperty(info);
		if (trailing) {
			property = trailing.property;
			info = info.slice(0, trailing.at);
		}
		const argumentKey = this.option.argumentKey(alias.type);
		let bodyLineList = this.lineList.slice(index + 1, bodyEnd).map((line) => (isBlank(line) ? '' : stripIndent(line, level)));
		const spanList: number[] = [];
		if (argumentKey !== undefined) property = withArgument(property, argumentKey, readArgument(info));
		else if (info.trim() !== '') {
			// a type with no header argument: the text is the start of the body, so nothing is lost
			bodyLineList = [info.trim(), ...bodyLineList];
			if (record) this.problemList.push({ line: index, message: `${alias.type} takes nothing after ${marker}: the text starts its body` });
			if (record && this.spanMap) spanList.push(this.textStart(index, level) + marker.length + match.after.length - match.after.trimStart().length);
		}
		const body = bodyLineList.join('\n');
		const node = this.aliasNode(match, level, body, property, id, this.lineList.slice(index, next));
		if (record && this.spanMap) {
			for (let at = index + 1; at < bodyEnd; at++) spanList.push(this.textStart(at, level));
			this.spanMap.set(node.key, spanList);
		}
		return { node, next };
	}

	/** `$$x^2$$` on one line, or lines up to one that ends with the marker; a blank line means it wasn't one. */
	private bodyAlias(index: number, end: number, level: number, match: AliasMatch, record: boolean): { node: BlockNode; next: number } | undefined {
		const marker = match.alias.marker;
		const span = record && this.spanMap !== undefined;
		const leading = (text: string): number => text.length - text.trimStart().length;
		// where the text after the marker starts in the source
		const afterStart = span ? this.textStart(index, level) + match.marker.length : 0;
		const after = match.after.trimEnd();
		if (after.length >= marker.length && after.endsWith(marker)) {
			const inner = after.slice(0, -marker.length);
			const node = this.aliasNode(match, level, inner.trim(), new Map(), undefined, this.lineList.slice(index, index + 1));
			if (span) this.spanMap!.set(node.key, [afterStart + leading(inner)]);
			return { node, next: index + 1 };
		}
		for (let scan = index + 1; scan < end; scan++) {
			const line = this.lineList[scan]!;
			if (isBlank(line) || measureIndent(line).level < level) return undefined;
			const lineRest = stripIndent(line, level).trimEnd();
			if (!lineRest.endsWith(marker)) continue;
			// the body: the rest of the opening line, the lines between, and the closing line up to the marker
			const partList: { text: string; start: number }[] = [];
			const first = match.after.trim();
			if (first !== '') partList.push({ text: first, start: afterStart + leading(match.after) });
			for (let at = index + 1; at < scan; at++) partList.push({ text: stripIndent(this.lineList[at]!, level), start: span ? this.textStart(at, level) : 0 });
			const last = lineRest.slice(0, -marker.length).trimEnd();
			if (last !== '') partList.push({ text: last, start: span ? this.textStart(scan, level) : 0 });
			const node = this.aliasNode(match, level, partList.map((part) => part.text).join('\n'), new Map(), undefined, this.lineList.slice(index, scan + 1));
			if (span) this.spanMap!.set(node.key, partList.map((part) => part.start));
			return { node, next: scan + 1 };
		}
		return undefined;
	}

	text(index: number, end: number, level: number): { node: BlockNode; next: number } {
		const rest = (at: number): string => stripIndent(this.lineList[at]!, level);
		const sameLevel = (at: number): boolean => at < end && !isBlank(this.lineList[at]!) && measureIndent(this.lineList[at]!).level === level;
		const continuation = (at: number): boolean => sameLevel(at) && /^[ \t]/.test(rest(at));
		const shape = textShape(rest(index), index + 1 < end ? rest(index + 1) : undefined);
		let next = index + 1;
		if (shape === 'List') {
			while (continuation(next)) next++;
		} else if (shape === 'Quote') {
			while (sameLevel(next) && quotePattern.test(rest(next))) next++;
		} else if (shape === 'Table') {
			while (sameLevel(next) && rest(next).includes('|')) next++;
		} else if (shape === 'Paragraph') {
			while (sameLevel(next)) {
				const lineRest = rest(next);
				if (!/^[ \t]/.test(lineRest)) {
					if (headingPattern.test(lineRest) || listPattern.test(lineRest) || quotePattern.test(lineRest)) break;
					if (matchHeader(this.lineList, next, end, level, this.option)) break;
					if (opensAlias(lineRest, this.option.aliasList) && this.alias(next, end, level, false)) break;
					if (lineRest.includes('|') && next + 1 < end && tableSeparatorPattern.test(rest(next + 1))) break;
				}
				next++;
			}
		}
		const ownEnd = next;
		const regionEnd = this.regionEnd(ownEnd, end, level);
		const hasChild = regionEnd > ownEnd;
		const lineList = this.lineList.slice(index, ownEnd).map((_, offset) => rest(index + offset));
		const lastIndex = lineList.length - 1;
		const unescaped = lineList.map((line, lineIndex) => {
			if (!line.startsWith('\\')) return line;
			const bare = line.replace(/^\\+/, '');
			// text that really starts like an alias (``` or $$) is written with a leading `\`
			if (opensAlias(bare, this.option.aliasList)) return line.slice(1);
			const header = parseHeaderText(bare);
			const nextDeeper = lineIndex === lastIndex ? hasChild : false;
			return header && acceptHeader(header, nextDeeper, this.option.isKnownType) ? line.slice(1) : line;
		});
		let id: string | undefined;
		const idMatch = textIdPattern.exec(unescaped[lastIndex]!);
		if (idMatch) {
			id = idMatch[1];
			unescaped[lastIndex] = unescaped[lastIndex]!.slice(0, idMatch.index);
		}
		let property: PropertyMap = new Map();
		const trailing = findTrailingProperty(unescaped[lastIndex]!);
		if (trailing) {
			property = trailing.property;
			unescaped[lastIndex] = unescaped[lastIndex]!.slice(0, trailing.at);
		} else {
			const at = trailingEscapeAt(unescaped[lastIndex]!);
			if (at >= 0) unescaped[lastIndex] = unescaped[lastIndex]!.slice(0, at) + unescaped[lastIndex]!.slice(at + 1);
		}
		const escapeMatch = escapedTextIdPattern.exec(unescaped[lastIndex]!);
		if (escapeMatch && escapeMatch[1]!.length > 0) {
			const at = escapeMatch.index + 1;
			unescaped[lastIndex] = unescaped[lastIndex]!.slice(0, at) + unescaped[lastIndex]!.slice(at + 1);
		}
		const node: BlockNode = {
			key: createKey(),
			type: 'Text',
			implicit: true,
			version: 1,
			id,
			property,
			body: unescaped.join('\n'),
			childList: hasChild ? this.itemList(ownEnd, regionEnd, level + 1).itemList : [],
			content: 'Item',
			level,
			gapLineList: undefined,
			headLineList: this.lineList.slice(index, ownEnd),
			rawLineList: this.lineList.slice(index, regionEnd),
		};
		return { node, next: regionEnd };
	}
}

export function parseNote(source: string, option: FormatOption = {}): NoteDocument {
	const split = splitSource(source);
	const problemList: Problem[] = [];
	const lineList = split.lineList;
	let start = 0;
	let front: PropertySection | undefined;
	if (lineList[0] === '---') {
		const close = lineList.indexOf('---', 1);
		if (close > 0) {
			front = parsePropertySection(lineList.slice(1, close), 0, 1);
			problemList.push(...front.problemList);
			start = close + 1;
		} else {
			problemList.push({ line: 0, message: 'the property section is not closed with "---"' });
		}
	}
	const parser = new NoteParser(lineList, resolveOption(option), problemList);
	const { itemList, tailLineList } = parser.itemList(start, lineList.length, 0);
	return { kind: 'Note', front, itemList, tailLineList, bom: split.bom, newline: split.newline, finalNewline: split.finalNewline, problemList };
}

/** A file whose first line is `Kind: ...` is a property document (meta file); anything else is a note. */
export function parseDocument(source: string, option: FormatOption = {}): OiDocument {
	const split = splitSource(source);
	if (split.lineList[0] !== undefined && /^Kind:[ \t]/.test(split.lineList[0])) {
		const section = parsePropertySection(split.lineList, 0, 0);
		return { kind: 'Property', section, bom: split.bom, newline: split.newline, finalNewline: split.finalNewline, problemList: section.problemList };
	}
	return parseNote(source, option);
}

// ---------------------------------------------------------------- serialize

function isListItem(node: BlockNode): boolean {
	return node.implicit && listPattern.test(node.body);
}

function defaultGap(previous: BlockNode | undefined, node: BlockNode, nested = false): string[] {
	if (!previous) return [];
	if (isListItem(previous) && isListItem(node)) return [];
	// inside a block, typed siblings (a Column after a Column) sit on consecutive lines
	if (nested && !previous.implicit && !node.implicit) return [];
	return [''];
}

function textHeadLineList(node: BlockNode, option: ResolvedOption): string[] {
	const lineList = node.body.split('\n');
	const lastIndex = lineList.length - 1;
	let last = lineList[lastIndex]!;
	const escapeMatch = escapedTextIdPattern.exec(last);
	if (escapeMatch) {
		const at = escapeMatch.index + 1;
		last = `${last.slice(0, at)}\\${last.slice(at)}`;
	}
	// text that really ends in `{Key: v}` is written `\{Key: v}` so it isn't read as properties
	const trailing = findTrailingProperty(last);
	const escapeAt = trailingEscapeAt(last);
	if (trailing) last = `${last.slice(0, trailing.at + 1)}\\${last.slice(trailing.at + 1)}`;
	else if (escapeAt >= 0) last = `${last.slice(0, escapeAt)}\\${last.slice(escapeAt)}`;
	if (node.property.size > 0) last += ` ${formatInline(node.property, true)}`;
	if (node.id) last += ` ^${node.id}`;
	lineList[lastIndex] = last;
	const escaped = lineList.map((line, index) => {
		if (/^[ \t]/.test(line)) return line;
		const bare = line.replace(/^\\+/, '');
		if (opensAlias(bare, option.aliasList)) return `\\${line}`;
		const header = parseHeaderText(bare);
		const nextDeeper = index === lastIndex ? node.childList.length > 0 : false;
		return header && acceptHeader(header, nextDeeper, option.isKnownType) ? `\\${line}` : line;
	});
	const indent = indentText(node.level);
	return escaped.map((line) => (line === '' ? '' : indent + line));
}

function blockHeadLineList(node: BlockNode, option: ResolvedOption): string[] {
	const indent = indentText(node.level);
	const head = `${node.type}${node.version > 1 ? `@${node.version}` : ''}${node.id ? ` ^${node.id}` : ''}`;
	const raw = node.content === 'Raw';
	const bodyIndent = indentText(node.level + 1);
	const bodyLineList = (): string[] => (node.body === '' ? [] : node.body.split('\n').map((line) => (line === '' ? '' : bodyIndent + line)));
	// `Type {Props}:` on one line, or the props on lines of their own when that line is long
	const headOf = (property: PropertyMap, suffix: string): string[] => {
		const propText = property.size > 0 ? ` ${formatInline(property, true)}` : '';
		const oneLine = `${indent}${head}${propText}`;
		if (propText === '' || oneLine.length <= maxInlineWidth) return [oneLine + suffix];
		return [`${indent}${head} {`, ...[...property].flatMap(([key, value]) => formatPairLineList(key, value, node.level + 1)), `${indent}}${suffix}`];
	};
	const argumentKey = option.argumentKey(node.type);
	if (argumentKey !== undefined) {
		// `Code {Wrap: True}: Python`, with the body on indented lines
		const split = splitArgument(node.property, argumentKey);
		return [...headOf(split.property, split.argument === undefined ? ':' : `: ${split.argument}`), ...bodyLineList()];
	}
	const body = raw ? node.body : node.body.replace(/\n/g, ' ');
	const inlineBody = body !== '' && !body.includes('\n') && body.length <= 80 && (!raw || option.inlineBody(node.type));
	const headLineList = headOf(node.property, inlineBody ? `: ${body}` : ':');
	if (!raw || inlineBody || body === '') return headLineList;
	return [...headLineList, ...bodyLineList()];
}

/** The header argument as written after the colon (when it can be), and the properties left for `{…}`. */
function splitArgument(property: PropertyMap, argumentKey: string, fits: (text: string) => boolean = () => true): { argument: string | undefined; property: PropertyMap } {
	const argument = writeArgument(property.get(argumentKey));
	if (argument === undefined || !fits(argument)) return { argument: undefined, property };
	const rest = new Map(property);
	rest.delete(argumentKey);
	return { argument, property: rest };
}

/** Sets a block's header argument (first among its properties); `undefined` leaves the properties as they are. */
function withArgument(property: PropertyMap, argumentKey: string, value: string | undefined): PropertyMap {
	if (value === undefined) return property;
	const rest = new Map(property);
	rest.delete(argumentKey);
	return new Map([[argumentKey, value], ...rest]);
}

/** The block written with its alias (```Python … ```, $$ … $$), or undefined when the alias is off or can't hold it. */
function aliasLineList(node: BlockNode, option: ResolvedOption): string[] | undefined {
	const used = node.alias;
	if (used === undefined || node.content !== 'Raw' || node.version > 1) return undefined;
	const candidateList = option.aliasList.filter((alias) => alias.type === node.type);
	// the alias it was written with; when its symbols were changed in the settings, another of its type
	const alias =
		candidateList.find((item) => (runsLonger(item) ? used[0] === item.marker[0] && isRun(used) && used.length >= item.marker.length : used === item.marker)) ??
		candidateList[0];
	if (!alias) return undefined;
	const indent = indentText(node.level);
	const indentLine = (line: string): string => (line === '' ? '' : indent + line);
	const bodyLineList = node.body === '' ? [] : node.body.split('\n');
	if (alias.opening === 'Body') {
		// $$ holds a plain body: no properties or ID, no blank line, no line that ends like the marker
		if (node.property.size > 0 || node.id) return undefined;
		if (bodyLineList.length === 0) return [indentLine(alias.marker + alias.marker)];
		if (bodyLineList.some((line) => line.trim() === '' || line.trimEnd().endsWith(alias.marker))) return undefined;
		return [indentLine(alias.marker), ...bodyLineList.map(indentLine), indentLine(alias.marker)];
	}
	let marker = alias.marker;
	if (runsLonger(alias)) {
		// longer than any run of its character that starts a body line, so the body can't close it
		let length = used[0] === alias.marker[0] ? Math.max(alias.marker.length, used.length) : alias.marker.length;
		for (const line of bodyLineList) {
			const trimmed = line.trimStart();
			let run = 0;
			while (trimmed[run] === alias.marker[0]) run++;
			if (run >= length) length = run + 1;
		}
		marker = alias.marker[0]!.repeat(length);
	} else if (bodyLineList.some((line) => line.trim() === alias.marker)) {
		return undefined;
	}
	// as in Markdown: the argument (a language), then ` {Props}` and ` ^id`. An argument that would
	// read back differently there (ending like props or an ID, starting with the marker's character) goes in the props
	const argumentKey = option.argumentKey(node.type);
	const fits = (text: string): boolean => text[0] !== marker[0] && !textIdPattern.test(` ${text}`) && !findTrailingProperty(` ${text}`);
	const split = argumentKey !== undefined ? splitArgument(node.property, argumentKey, fits) : { argument: undefined, property: node.property };
	const opening = [split.argument ?? '', split.property.size > 0 ? formatInline(split.property, true) : '', node.id ? `^${node.id}` : ''].filter(Boolean).join(' ');
	// the opening line of a backtick fence can't hold a backtick
	if (marker[0] === '`' && opening.includes('`')) return undefined;
	return [indentLine(marker + opening), ...bodyLineList.map(indentLine), indentLine(marker)];
}

/** A block's own lines (header and body, or a paragraph's text), without the blocks inside it. */
function headLineListOf(node: BlockNode, option: ResolvedOption): string[] {
	return (
		node.headLineList ??
		(node.alias !== undefined ? aliasLineList(node, option) : undefined) ??
		(node.implicit ? textHeadLineList(node, option) : blockHeadLineList(node, option))
	);
}

function childLineList(childList: readonly BlockNode[], option: ResolvedOption): string[] {
	return childList.flatMap((child, index) => [...(child.gapLineList ?? defaultGap(childList[index - 1], child, true)), ...serializeLineList(child, option)]);
}

function serializeLineList(node: BlockNode, option: ResolvedOption): string[] {
	if (node.rawLineList) return node.rawLineList;
	const head = headLineListOf(node, option);
	if (node.content === 'Raw') return head;
	return [...head, ...childLineList(node.childList, option)];
}

export function serializeNode(node: BlockNode, option: FormatOption = {}): string[] {
	return serializeLineList(node, resolveOption(option));
}

function noteLineList(document: NoteDocument, option: ResolvedOption): string[] {
	const out: string[] = [];
	if (document.front) out.push('---', ...serializeSection(document.front), '---');
	document.itemList.forEach((node, index) => {
		const gap = node.gapLineList ?? (index === 0 ? (document.front ? [''] : []) : defaultGap(document.itemList[index - 1], node));
		out.push(...gap, ...serializeLineList(node, option));
	});
	out.push(...document.tailLineList);
	return out;
}

export function serializeDocument(document: OiDocument, option: FormatOption = {}): string {
	const lineList = document.kind === 'Property' ? serializeSection(document.section) : noteLineList(document, resolveOption(option));
	let text = lineList.join('\n');
	if (document.finalNewline && lineList.length > 0) text += '\n';
	if (document.newline === '\r\n') text = text.replace(/\n/g, '\r\n');
	return (document.bom ? '﻿' : '') + text;
}

// ---------------------------------------------------------------- construct & walk

export function createNote(): NoteDocument {
	return { kind: 'Note', front: undefined, itemList: [], tailLineList: [], bom: false, newline: '\n', finalNewline: true, problemList: [] };
}

export function createTextNode(text: string, option: { property?: PropertyMap; childList?: BlockNode[]; id?: string } = {}): BlockNode {
	return {
		key: createKey(),
		type: 'Text',
		implicit: true,
		version: 1,
		id: option.id,
		property: option.property ?? new Map(),
		body: text,
		childList: option.childList ?? [],
		content: 'Item',
		level: 0,
		gapLineList: undefined,
		headLineList: undefined,
		rawLineList: undefined,
	};
}

export function createBlockNode(
	type: string,
	option: { id?: string; property?: PropertyMap; body?: string; content?: ContentKind; childList?: BlockNode[]; alias?: string } = {},
): BlockNode {
	return {
		key: createKey(),
		type,
		implicit: false,
		...(option.alias ? { alias: option.alias } : {}),
		version: 1,
		id: option.id,
		property: option.property ?? new Map(),
		body: option.body ?? '',
		childList: option.childList ?? [],
		content: option.content ?? (defaultItemTypeSet.has(type) ? 'Item' : 'Raw'),
		level: 0,
		gapLineList: undefined,
		headLineList: undefined,
		rawLineList: undefined,
	};
}

export function walkNode(itemList: readonly BlockNode[], visit: (node: BlockNode, parent: BlockNode | undefined) => void, parent?: BlockNode): void {
	for (const node of itemList) {
		visit(node, parent);
		if (node.childList.length > 0) walkNode(node.childList, visit, node);
	}
}

/** Sets `level` on a subtree (after a move); blocks whose level changed are written canonically. */
export function relevel(node: BlockNode, level: number): void {
	if (node.level !== level) {
		node.level = level;
		node.rawLineList = undefined;
		node.headLineList = undefined;
	}
	for (const child of node.childList) relevel(child, level + 1);
	if (node.childList.some((child) => child.rawLineList === undefined)) node.rawLineList = undefined;
}

function findPath(itemList: readonly BlockNode[], target: BlockNode): BlockNode[] | undefined {
	for (const node of itemList) {
		if (node === target) return [];
		const inner = findPath(node.childList, target);
		if (inner) return [node, ...inner];
	}
	return undefined;
}

/** The block's own content changed: its own lines and the containers around it are rewritten. */
export function markChanged(document: NoteDocument, node: BlockNode): void {
	node.rawLineList = undefined;
	node.headLineList = undefined;
	markChildChanged(document, node);
}

/** Only the children of `node` changed (insert/delete/move): its own lines stay as written. */
export function markChildChanged(document: NoteDocument, node: BlockNode | undefined): void {
	if (!node) return;
	node.rawLineList = undefined;
	for (const ancestor of findPath(document.itemList, node) ?? []) ancestor.rawLineList = undefined;
}

// ---------------------------------------------------------------- one block's source (the block editor)

export interface SourceRead {
	itemList: BlockNode[];
	problemList: Problem[];
	/** Where each body line of a block starts in the text, by key. */
	lineStartMap: Map<string, number[]>;
}

/** The alias a line (without indentation) opens, with the aliases in use. */
export function aliasOf(line: string, option: FormatOption = {}): AliasMatch | undefined {
	return matchAlias(line, resolveOption(option).aliasList);
}

/** Reads OI source as blocks at level 0 with no property section: a block editor's text, a pasted piece. */
export function readSource(text: string, option: FormatOption = {}): SourceRead {
	const normalized = text.replace(/\r\n/g, '\n');
	const lineList = normalized === '' ? [] : normalized.split('\n');
	const problemList: Problem[] = [];
	const lineStartMap = new Map<string, number[]>();
	const itemList = new NoteParser(lineList, resolveOption(option), problemList, lineStartMap).itemList(0, lineList.length, 0).itemList;
	return { itemList, problemList, lineStartMap };
}

/** A block's own lines (its header and body, not the blocks inside it) at level 0, exactly as written while unchanged. */
export function ownSourceText(node: BlockNode, option: FormatOption = {}): string {
	return headLineListOf(node, resolveOption(option))
		.map((line) => stripIndent(line, node.level))
		.join('\n');
}

export interface BlockSource {
	/** What a block editor shows: the block's own source, with room to type when the body is empty. */
	text: string;
	/** Where each body line starts in `text` (rendered pieces carry body offsets); empty = the end of the text. */
	lineStartList: number[];
}

export function blockSource(node: BlockNode, option: FormatOption = {}): BlockSource {
	const resolved = resolveOption(option);
	let text = ownSourceText(node, option);
	if (!node.implicit && node.body === '') {
		const lineList = text.split('\n');
		if (node.alias !== undefined) {
			// ```Python and ``` get an empty line between them
			if (lineList.length === 2 && matchAlias(lineList[0]!, resolved.aliasList)?.alias.opening === 'Argument') text = `${lineList[0]}\n\n${lineList[1]}`;
		} else if (node.content === 'Raw' && (resolved.argumentKey(node.type) !== undefined || !resolved.inlineBody(node.type))) {
			// `Code: Python` takes its body on the next line
			text += '\n\t';
		} else if (text.endsWith(':')) {
			text += ' ';
		}
	}
	const read = readSource(text, option);
	const first = read.itemList[0];
	return { text, lineStartList: first ? (read.lineStartMap.get(first.key) ?? []) : [] };
}

/** Body offset → offset in a block editor's text. */
export function editorOffset(body: string, lineStartList: readonly number[], textLength: number, offset: number): number {
	if (lineStartList.length === 0) return textLength;
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < offset && index < body.length; index++) {
		if (body[index] === '\n') {
			line++;
			lineStart = index + 1;
		}
	}
	const start = lineStartList[Math.min(line, lineStartList.length - 1)]!;
	return Math.min(start + offset - lineStart, textLength);
}
