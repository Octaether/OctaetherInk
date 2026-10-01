// OI property syntax: `Key: value` lines, flow `[...]` / `{...}`, `True/False/None`,
// tab (or 4-space) indentation. Used by note properties, block `{...}` and meta files.

export type PropertyValue = string | number | boolean | null | PropertyValue[] | PropertyMap;
export type PropertyMap = Map<string, PropertyValue>;

export interface Problem {
	line: number;
	message: string;
}

export interface Indent {
	level: number;
	rest: string;
}

const numberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const keywordMap: ReadonlyMap<string, PropertyValue> = new Map<string, PropertyValue>([
	['True', true],
	['False', false],
	['None', null],
]);

export const maxInlineWidth = 100;

// ---------------------------------------------------------------- indentation

export function measureIndent(line: string): Indent {
	let level = 0;
	let position = 0;
	for (;;) {
		if (line[position] === '\t') {
			level++;
			position++;
		} else if (line.startsWith('    ', position)) {
			level++;
			position += 4;
		} else {
			break;
		}
	}
	return { level, rest: line.slice(position) };
}

export function isBlank(line: string): boolean {
	return line.trim() === '';
}

export function indentText(level: number): string {
	return '\t'.repeat(level);
}

/** Removes up to `level` indentation units (tab or 4 spaces); blank lines become ''. */
export function stripIndent(line: string, level: number): string {
	if (isBlank(line)) return '';
	let position = 0;
	for (let unit = 0; unit < level; unit++) {
		if (line[position] === '\t') position++;
		else if (line.startsWith('    ', position)) position += 4;
		else break;
	}
	return line.slice(position);
}

/** End (exclusive) of the chunk that starts at `start`: every following line indented deeper, trailing blank lines excluded. */
export function chunkEnd(lineList: readonly string[], start: number, level: number, limit = lineList.length): number {
	let last = start;
	for (let index = start + 1; index < limit; index++) {
		const line = lineList[index]!;
		if (isBlank(line)) continue;
		if (measureIndent(line).level > level) {
			last = index;
			continue;
		}
		break;
	}
	return last + 1;
}

// ---------------------------------------------------------------- flow values

class FlowError extends Error {}

class Cursor {
	position = 0;
	constructor(readonly text: string) {}

	peek(): string {
		return this.text[this.position] ?? '';
	}

	atEnd(): boolean {
		return this.position >= this.text.length;
	}

	skipSpace(): void {
		while (this.peek() === ' ' || this.peek() === '\t') this.position++;
	}

	expect(character: string): void {
		if (this.peek() !== character) throw new FlowError(`expected "${character}"`);
		this.position++;
	}
}

function plainScalar(text: string): PropertyValue {
	const keyword = keywordMap.get(text);
	if (keyword !== undefined) return keyword;
	if (numberPattern.test(text)) return Number(text);
	return text;
}

function readQuoted(cursor: Cursor): string {
	const quote = cursor.peek();
	cursor.position++;
	let result = '';
	for (;;) {
		if (cursor.atEnd()) throw new FlowError('unclosed quote');
		const character = cursor.peek();
		cursor.position++;
		if (quote === "'") {
			if (character === "'") {
				if (cursor.peek() === "'") {
					result += "'";
					cursor.position++;
					continue;
				}
				return result;
			}
			result += character;
			continue;
		}
		if (character === '"') return result;
		if (character !== '\\') {
			result += character;
			continue;
		}
		const escape = cursor.peek();
		cursor.position++;
		switch (escape) {
			case 'n':
				result += '\n';
				break;
			case 't':
				result += '\t';
				break;
			case 'r':
				result += '\r';
				break;
			case 'u': {
				const hex = cursor.text.slice(cursor.position, cursor.position + 4);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new FlowError('bad \\u escape');
				result += String.fromCharCode(parseInt(hex, 16));
				cursor.position += 4;
				break;
			}
			case '':
				throw new FlowError('unclosed quote');
			default:
				result += escape;
		}
	}
}

function readFlowValue(cursor: Cursor): PropertyValue {
	cursor.skipSpace();
	const character = cursor.peek();
	if (character === '[') return readFlowList(cursor);
	if (character === '{') return readFlowMap(cursor);
	if (character === '"' || character === "'") return readQuoted(cursor);
	const start = cursor.position;
	while (!cursor.atEnd() && !',]}'.includes(cursor.peek())) cursor.position++;
	const text = cursor.text.slice(start, cursor.position).trim();
	return text === '' ? null : plainScalar(text);
}

function readFlowList(cursor: Cursor): PropertyValue[] {
	cursor.expect('[');
	const list: PropertyValue[] = [];
	cursor.skipSpace();
	if (cursor.peek() === ']') {
		cursor.position++;
		return list;
	}
	for (;;) {
		list.push(readFlowValue(cursor));
		cursor.skipSpace();
		if (cursor.peek() === ',') {
			cursor.position++;
			cursor.skipSpace();
			if (cursor.peek() === ']') {
				cursor.position++;
				return list;
			}
			continue;
		}
		if (cursor.peek() === ']') {
			cursor.position++;
			return list;
		}
		throw new FlowError('expected "," or "]"');
	}
}

function readFlowKey(cursor: Cursor): string {
	cursor.skipSpace();
	if (cursor.peek() === '"' || cursor.peek() === "'") return readQuoted(cursor);
	const start = cursor.position;
	while (!cursor.atEnd() && cursor.peek() !== ':') {
		if (',{}[]'.includes(cursor.peek())) throw new FlowError('expected "Key: value"');
		cursor.position++;
	}
	const key = cursor.text.slice(start, cursor.position).trim();
	if (key === '') throw new FlowError('empty key');
	return key;
}

function readFlowMap(cursor: Cursor): PropertyMap {
	cursor.expect('{');
	const map: PropertyMap = new Map();
	cursor.skipSpace();
	if (cursor.peek() === '}') {
		cursor.position++;
		return map;
	}
	for (;;) {
		const key = readFlowKey(cursor);
		cursor.skipSpace();
		cursor.expect(':');
		cursor.skipSpace();
		const value = cursor.peek() === ',' || cursor.peek() === '}' ? null : readFlowValue(cursor);
		map.set(key, value);
		cursor.skipSpace();
		if (cursor.peek() === ',') {
			cursor.position++;
			cursor.skipSpace();
			if (cursor.peek() === '}') {
				cursor.position++;
				return map;
			}
			continue;
		}
		if (cursor.peek() === '}') {
			cursor.position++;
			return map;
		}
		throw new FlowError('expected "," or "}"');
	}
}

/** Index of the bracket that closes the one at `start`, respecting quotes and nesting; -1 if not on this text. */
export function findClosingBracket(text: string, start: number): number {
	const stack: string[] = [];
	let quote = '';
	for (let index = start; index < text.length; index++) {
		const character = text[index]!;
		if (quote !== '') {
			if (quote === '"' && character === '\\') index++;
			else if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === "'") {
			// a quote only opens a string at the start of a value
			const before = text.slice(start, index).trimEnd();
			const last = before[before.length - 1];
			if (last === undefined || '[{,:'.includes(last)) quote = character;
			continue;
		}
		if (character === '[' || character === '{') stack.push(character === '[' ? ']' : '}');
		else if (character === ']' || character === '}') {
			if (stack.pop() !== character) return -1;
			if (stack.length === 0) return index;
		}
	}
	return -1;
}

export interface ValueResult {
	value: PropertyValue;
	problem?: string;
}

/** Parses a value written after `Key: ` (or inside a list item). Never throws. */
export function parseValueText(text: string): ValueResult {
	const trimmed = text.trim();
	if (trimmed === '') return { value: null };
	const first = trimmed[0]!;
	if (first === '[' || first === '{' || first === '"' || first === "'") {
		const cursor = new Cursor(trimmed);
		try {
			const value = readFlowValue(cursor);
			cursor.skipSpace();
			if (!cursor.atEnd()) throw new FlowError('unexpected text after the value');
			return { value };
		} catch (error) {
			return { value: trimmed, problem: error instanceof Error ? error.message : String(error) };
		}
	}
	return { value: plainScalar(trimmed) };
}

/** Parses `{Key: value, ...}`; returns an empty map plus a problem when the text isn't a map. */
export function parseFlowMapText(text: string): { value: PropertyMap; problem?: string } {
	const result = parseValueText(text);
	if (result.value instanceof Map) return result.problem ? { value: result.value, problem: result.problem } : { value: result.value };
	return { value: new Map(), problem: result.problem ?? 'expected {Key: value}' };
}

// ---------------------------------------------------------------- header arguments

/**
 * Reads what follows the colon of a block whose type takes a header argument (`Code: Python`,
 * `Image: My photo, 2.png`): one value, taken as it is written (no quotes needed), or a quoted
 * string. Undefined when there is nothing.
 */
export function readArgument(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	if (trimmed[0] === '"' || trimmed[0] === "'") {
		const result = parseValueText(trimmed);
		if (!result.problem && typeof result.value === 'string') return result.value;
	}
	return trimmed;
}

/** The value as written after the colon, or undefined when it can only go in `{…}` (not text, or text that would read back differently). */
export function writeArgument(value: PropertyValue | undefined): string | undefined {
	if (typeof value !== 'string' || value === '' || value !== value.trim() || /[\n\r]/.test(value)) return undefined;
	if (value[0] === '"' || value[0] === "'") return undefined;
	return value;
}

// ---------------------------------------------------------------- block (indented) values

function splitPair(rest: string): { key: string; valueText: string } | undefined {
	if (rest.startsWith('"') || rest.startsWith("'")) {
		const cursor = new Cursor(rest);
		try {
			const key = readQuoted(cursor);
			cursor.skipSpace();
			cursor.expect(':');
			return { key, valueText: rest.slice(cursor.position) };
		} catch {
			return undefined;
		}
	}
	for (let index = 0; index < rest.length; index++) {
		if (rest[index] !== ':') continue;
		const next = rest[index + 1];
		if (next !== undefined && next !== ' ' && next !== '\t') continue;
		const key = rest.slice(0, index).trim();
		return key === '' ? undefined : { key, valueText: rest.slice(index + 1) };
	}
	return undefined;
}

function isListLine(rest: string): boolean {
	return rest === '-' || rest.startsWith('- ');
}

class BlockReader {
	constructor(
		readonly lineList: readonly string[],
		readonly lineOffset: number,
		readonly problemList: Problem[],
	) {}

	report(index: number, message: string): void {
		this.problemList.push({ line: this.lineOffset + index, message });
	}

	/** Value for `Key: <valueText>` whose deeper lines are lineList[start, end). */
	pairValue(valueText: string, start: number, end: number, level: number, lineIndex: number): PropertyValue {
		const text = valueText.trim();
		let hasChild = false;
		for (let index = start; index < end; index++) if (!isBlank(this.lineList[index]!)) hasChild = true;
		if (text === '|') {
			return this.lineList
				.slice(start, end)
				.map((line) => stripIndent(line, level + 1))
				.join('\n');
		}
		if (text === '') return hasChild ? this.block(start, end, level + 1) : null;
		const result = parseValueText(text);
		if (result.problem) this.report(lineIndex, result.problem);
		if (hasChild) this.report(start, 'indented lines after an inline value are ignored');
		return result.value;
	}

	/** A block map or block list whose lines are lineList[start, end) at `level`. */
	block(start: number, end: number, level: number): PropertyValue {
		for (let index = start; index < end; index++) {
			const line = this.lineList[index]!;
			if (isBlank(line)) continue;
			const indent = measureIndent(line);
			if (indent.rest.startsWith('#')) continue;
			return isListLine(indent.rest) ? this.list(start, end, level) : this.map(start, end, level);
		}
		return null;
	}

	list(start: number, end: number, level: number): PropertyValue[] {
		const list: PropertyValue[] = [];
		let index = start;
		while (index < end) {
			const line = this.lineList[index]!;
			const indent = measureIndent(line);
			if (isBlank(line) || (indent.level === level && indent.rest.startsWith('#'))) {
				index++;
				continue;
			}
			const stop = chunkEnd(this.lineList, index, level, end);
			if (indent.level !== level || !isListLine(indent.rest)) {
				this.report(index, 'expected "- item"');
				index = stop;
				continue;
			}
			list.push(this.pairValue(indent.rest.slice(1), index + 1, stop, level, index));
			index = stop;
		}
		return list;
	}

	map(start: number, end: number, level: number): PropertyMap {
		const map: PropertyMap = new Map();
		let index = start;
		while (index < end) {
			const line = this.lineList[index]!;
			const indent = measureIndent(line);
			if (isBlank(line) || (indent.level === level && indent.rest.startsWith('#'))) {
				index++;
				continue;
			}
			const stop = chunkEnd(this.lineList, index, level, end);
			const pair = indent.level === level ? splitPair(indent.rest) : undefined;
			if (!pair) {
				this.report(index, 'expected "Key: value"');
				index = stop;
				continue;
			}
			if (map.has(pair.key)) this.report(index, `duplicate key "${pair.key}"`);
			map.set(pair.key, this.pairValue(pair.valueText, index + 1, stop, level, index));
			index = stop;
		}
		return map;
	}
}

/** Parses indented `Key: value` lines at `level` into a map (used for multi-line block properties). */
export function parseBlockMap(
	lineList: readonly string[],
	level: number,
	lineOffset = 0,
	problemList: Problem[] = [],
): PropertyMap {
	return new BlockReader(lineList, lineOffset, problemList).map(0, lineList.length, level);
}

// ---------------------------------------------------------------- property section (lossless)

export interface PropertyEntry {
	kind: 'Pair' | 'Comment' | 'Blank' | 'Invalid';
	key?: string;
	value?: PropertyValue;
	/** The exact source lines of this entry. */
	lineList: string[];
}

export interface PropertySection {
	level: number;
	entryList: PropertyEntry[];
	problemList: Problem[];
}

export function parsePropertySection(lineList: readonly string[], level = 0, lineOffset = 0): PropertySection {
	const problemList: Problem[] = [];
	const reader = new BlockReader(lineList, lineOffset, problemList);
	const entryList: PropertyEntry[] = [];
	let index = 0;
	while (index < lineList.length) {
		const line = lineList[index]!;
		if (isBlank(line)) {
			entryList.push({ kind: 'Blank', lineList: [line] });
			index++;
			continue;
		}
		const indent = measureIndent(line);
		if (indent.level === level && indent.rest.startsWith('#')) {
			entryList.push({ kind: 'Comment', lineList: [line] });
			index++;
			continue;
		}
		const stop = chunkEnd(lineList, index, level);
		const pair = indent.level === level ? splitPair(indent.rest) : undefined;
		if (!pair) {
			reader.report(index, 'expected "Key: value"');
			entryList.push({ kind: 'Invalid', lineList: lineList.slice(index, stop) });
			index = stop;
			continue;
		}
		const value = reader.pairValue(pair.valueText, index + 1, stop, level, index);
		entryList.push({ kind: 'Pair', key: pair.key, value, lineList: lineList.slice(index, stop) });
		index = stop;
	}
	return { level, entryList, problemList };
}

export function sectionToMap(section: PropertySection): PropertyMap {
	const map: PropertyMap = new Map();
	for (const entry of section.entryList) if (entry.kind === 'Pair') map.set(entry.key!, entry.value!);
	return map;
}

export function getSectionValue(section: PropertySection, key: string): PropertyValue | undefined {
	for (let index = section.entryList.length - 1; index >= 0; index--) {
		const entry = section.entryList[index]!;
		if (entry.kind === 'Pair' && entry.key === key) return entry.value;
	}
	return undefined;
}

/**
 * Sets (or removes, with `undefined`) one key; only that entry's lines change. A new key goes at
 * the end, or before the first of `beforeKeyList` (a note's system fields `Id`, `Format` stay last).
 */
export function setSectionValue(section: PropertySection, key: string, value: PropertyValue | undefined, beforeKeyList: readonly string[] = []): void {
	const index = section.entryList.findIndex((entry) => entry.kind === 'Pair' && entry.key === key);
	if (value === undefined) {
		if (index >= 0) section.entryList.splice(index, 1);
		return;
	}
	const entry: PropertyEntry = { kind: 'Pair', key, value, lineList: formatPairLineList(key, value, section.level) };
	if (index >= 0) {
		section.entryList[index] = entry;
		return;
	}
	let insertAt = section.entryList.length;
	while (insertAt > 0 && section.entryList[insertAt - 1]!.kind === 'Blank') insertAt--;
	if (!beforeKeyList.includes(key)) {
		const systemAt = section.entryList.findIndex((item) => item.kind === 'Pair' && beforeKeyList.includes(item.key!));
		if (systemAt >= 0 && systemAt < insertAt) insertAt = systemAt;
	}
	section.entryList.splice(insertAt, 0, entry);
}

export function serializeSection(section: PropertySection): string[] {
	return section.entryList.flatMap((entry) => entry.lineList);
}

export function createSection(map: PropertyMap, level = 0): PropertySection {
	const section: PropertySection = { level, entryList: [], problemList: [] };
	for (const [key, value] of map) setSectionValue(section, key, value);
	return section;
}

// ---------------------------------------------------------------- formatting

function isPlainSafe(text: string, flow: boolean): boolean {
	if (text === '' || text !== text.trim()) return false;
	if (/[\n\r\t]/.test(text)) return false;
	if (keywordMap.has(text) || numberPattern.test(text)) return false;
	if ('[{"\''.includes(text[0]!)) return false;
	if (text === '|' || text === '-') return false;
	if (flow && /[,[\]{}]/.test(text)) return false;
	return true;
}

export function quoteText(text: string): string {
	let result = '"';
	for (const character of text) {
		if (character === '"') result += '\\"';
		else if (character === '\\') result += '\\\\';
		else if (character === '\n') result += '\\n';
		else if (character === '\t') result += '\\t';
		else if (character === '\r') result += '\\r';
		else if (character < ' ') result += `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
		else result += character;
	}
	return result + '"';
}

export function formatKey(key: string, flow: boolean): string {
	const safe =
		key !== '' &&
		key === key.trim() &&
		!key.includes(':') &&
		!/[\n\r\t]/.test(key) &&
		!'"\'#-[{'.includes(key[0]!) &&
		!(flow && /[,[\]{}]/.test(key));
	return safe ? key : quoteText(key);
}

/** One-line form of a value; `flow` = inside `[...]` or `{...}`. */
export function formatInline(value: PropertyValue, flow = true): string {
	if (value === null) return 'None';
	if (value === true) return 'True';
	if (value === false) return 'False';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : quoteText(String(value));
	if (typeof value === 'string') return isPlainSafe(value, flow) ? value : quoteText(value);
	if (Array.isArray(value)) return `[${value.map((item) => formatInline(item, true)).join(', ')}]`;
	return `{${[...value].map(([key, item]) => `${formatKey(key, true)}: ${formatInline(item, true)}`).join(', ')}}`;
}

function isScalar(value: PropertyValue): boolean {
	return !(value instanceof Map) && !Array.isArray(value);
}

/** Canonical lines for `Key: value` at `level` (nested maps indent, long lists become `- item` lines). */
export function formatPairLineList(key: string, value: PropertyValue, level: number): string[] {
	const prefix = `${indentText(level)}${formatKey(key, false)}:`;
	if (value instanceof Map) {
		if (value.size === 0) return [`${prefix} {}`];
		return [prefix, ...[...value].flatMap(([childKey, child]) => formatPairLineList(childKey, child, level + 1))];
	}
	if (Array.isArray(value)) {
		const inline = `${prefix} ${formatInline(value, false)}`;
		if (value.every(isScalar) && inline.length <= maxInlineWidth) return [inline];
		if (value.length === 0) return [`${prefix} []`];
		return [prefix, ...value.map((item) => `${indentText(level + 1)}- ${formatInline(item, true)}`)];
	}
	if (typeof value === 'string' && value.includes('\n')) {
		return [`${prefix} |`, ...value.split('\n').map((line) => (line === '' ? '' : indentText(level + 1) + line))];
	}
	return [`${prefix} ${formatInline(value, false)}`];
}

// ---------------------------------------------------------------- helper

export function cloneValue(value: PropertyValue): PropertyValue {
	if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneValue(item)]));
	if (Array.isArray(value)) return value.map(cloneValue);
	return value;
}

export function valueEqual(left: PropertyValue | undefined, right: PropertyValue | undefined): boolean {
	if (left === right) return true;
	if (left instanceof Map && right instanceof Map) {
		if (left.size !== right.size) return false;
		for (const [key, value] of left) if (!right.has(key) || !valueEqual(value, right.get(key))) return false;
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((item, index) => valueEqual(item, right[index]));
	}
	return false;
}
