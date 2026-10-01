// The body of a Property block is `Key: value` lines in the property syntax, the same as a meta
// file (YAML-like). These helpers change one entry and leave every other line as it was, so
// comments, order, and spacing survive editing in the rendered block.

import {
	type PropertyEntry,
	type PropertySection,
	type PropertyValue,
	formatInline,
	formatPairLineList,
	parsePropertySection,
	parseValueText,
	serializeSection,
	setSectionValue,
} from '@octaether/core-format';

/** The kinds of value a property can hold: the basic types of YAML, so any tool can read them. */
export type PropertyKind = 'Text' | 'Number' | 'Checkbox' | 'Date' | 'DateTime' | 'List';

export const propertyKindList: readonly PropertyKind[] = ['Text', 'List', 'Number', 'Checkbox', 'Date', 'DateTime'];

export const propertyKindTitle: Readonly<Record<PropertyKind, string>> = {
	Text: 'Text',
	List: 'List',
	Number: 'Number',
	Checkbox: 'Checkbox',
	Date: 'Date',
	DateTime: 'Date & time',
};

/** How each kind is written, for the "add property" menu. */
export const propertyKindExample: Readonly<Record<PropertyKind, string>> = {
	Text: 'Course: CHEM 2310',
	List: 'Tag: [Organic, Lab]',
	Number: 'Credit: 3',
	Checkbox: 'Done: False',
	Date: 'Due: 2026-10-05',
	DateTime: 'Exam: 2026-10-12 09:00 -04:00',
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?[ ]?([+-]\d{2}:\d{2}|Z)?$/;

export function kindOf(value: PropertyValue | undefined): PropertyKind {
	if (Array.isArray(value)) return 'List';
	if (typeof value === 'boolean') return 'Checkbox';
	if (typeof value === 'number') return 'Number';
	if (typeof value === 'string' && datePattern.test(value)) return 'Date';
	if (typeof value === 'string' && dateTimePattern.test(value)) return 'DateTime';
	return 'Text';
}

/** The kind a new property with this name most likely has (Tag is a list, Due a date…). */
export function guessKind(name: string): PropertyKind {
	const word = name.trim().toLowerCase();
	if (['tag', 'alias', 'author', 'topic', 'link', 'source'].includes(word)) return 'List';
	if (['due', 'date', 'deadline', 'start', 'end', 'birthday'].includes(word)) return 'Date';
	if (['created', 'updated', 'modified', 'time', 'exam', 'meeting'].includes(word)) return 'DateTime';
	if (['done', 'draft', 'publish', 'published', 'pinned', 'complete', 'archived'].includes(word)) return 'Checkbox';
	if (['credit', 'rating', 'score', 'priority', 'count', 'page', 'year', 'week'].includes(word)) return 'Number';
	return 'Text';
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** `2026-09-30` in local time. */
export function dateText(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `+02:00` or `-04:00` for a date's local offset. */
export function offsetText(date: Date): string {
	const offset = -date.getTimezoneOffset();
	return `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** `2026-09-30 14:05 -04:00` in local time, as note properties write dates with a time. */
export function dateTimeText(date: Date): string {
	return `${dateText(date)} ${pad(date.getHours())}:${pad(date.getMinutes())} ${offsetText(date)}`;
}

/** A stored date & time → the value of an `<input type="datetime-local">` (the offset is kept aside). */
export function dateTimeInput(value: string): { input: string; offset: string | undefined } {
	const match = dateTimePattern.exec(value);
	return match ? { input: `${match[1]}T${match[2]}`, offset: match[3] } : { input: '', offset: undefined };
}

/** An `<input type="datetime-local">` value → the stored form, keeping the offset it had (else the local one). */
export function dateTimeValue(input: string, offset: string | undefined, now = new Date()): string {
	const [date, time] = input.split('T');
	return `${date} ${(time ?? '00:00').slice(0, 5)} ${offset ?? offsetText(now)}`;
}

/** A value as plain text (lists joined by commas). */
export function plainText(value: PropertyValue | undefined): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'True' : 'False';
	if (Array.isArray(value)) return value.map((item) => plainText(item)).join(', ');
	return formatInline(value, true);
}

/** The value a new property of this kind starts with. */
export function defaultOf(kind: PropertyKind, now = new Date()): PropertyValue {
	switch (kind) {
		case 'List':
			return [];
		case 'Number':
			return 0;
		case 'Checkbox':
			return false;
		case 'Date':
			return dateText(now);
		case 'DateTime':
			return dateTimeText(now);
		default:
			return '';
	}
}

/** Converts a value to another kind, keeping what can be kept. */
export function convert(value: PropertyValue | undefined, kind: PropertyKind, now = new Date()): PropertyValue {
	if (kindOf(value) === kind) return value ?? defaultOf(kind, now);
	const text = plainText(value).trim();
	switch (kind) {
		case 'List':
			return text === '' ? [] : text.split(/\s*,\s*/).filter(Boolean);
		case 'Number': {
			const number = Number(text);
			return text !== '' && Number.isFinite(number) ? number : 0;
		}
		case 'Checkbox':
			return value === true || /^(true|yes|on|1|x)$/i.test(text);
		case 'Date':
			return datePattern.test(text.slice(0, 10)) ? text.slice(0, 10) : dateText(now);
		case 'DateTime':
			return datePattern.test(text) ? `${text} 00:00 ${offsetText(now)}` : defaultOf('DateTime', now);
		default:
			return text;
	}
}

/** What a typed text means for a property of this kind (Text stays text, even "12" or "True"). */
export function readTyped(text: string, kind: PropertyKind): PropertyValue {
	const trimmed = text.trim();
	if (kind === 'Number') {
		const number = Number(trimmed);
		return trimmed !== '' && Number.isFinite(number) ? number : 0;
	}
	if (kind === 'List') {
		const parsed = parseValueText(trimmed.startsWith('[') ? trimmed : `[${trimmed}]`);
		return Array.isArray(parsed.value) ? parsed.value : trimmed === '' ? [] : [trimmed];
	}
	return trimmed;
}

// ---------------------------------------------------------------- the body as a section

export function readSection(body: string): PropertySection {
	return parsePropertySection(body === '' ? [] : body.split('\n'), 0);
}

export function writeSection(section: PropertySection): string {
	return serializeSection(section)
		.join('\n')
		.replace(/\n+$/, '');
}

/** The properties in order: `[key, value]` for each `Key: value` line. */
export function entryList(body: string): [string, PropertyValue][] {
	return readSection(body)
		.entryList.filter((entry): entry is PropertyEntry & { key: string; value: PropertyValue } => entry.kind === 'Pair')
		.map((entry) => [entry.key, entry.value]);
}

export function hasKey(body: string, key: string): boolean {
	return entryList(body).some(([name]) => name === key);
}

/** Sets (or, with `undefined`, removes) one property; only its lines change. */
export function setValue(body: string, key: string, value: PropertyValue | undefined): string {
	const section = readSection(body);
	setSectionValue(section, key, value);
	return writeSection(section);
}

/** Renames a property in place, keeping its value and position. */
export function renameKey(body: string, from: string, to: string): string {
	const section = readSection(body);
	const entry = section.entryList.find((item) => item.kind === 'Pair' && item.key === from);
	if (!entry || from === to || section.entryList.some((item) => item.kind === 'Pair' && item.key === to)) return body;
	entry.key = to;
	entry.lineList = formatPairLineList(to, entry.value!, section.level);
	return writeSection(section);
}

/** Moves a property to position `index` among the properties. */
export function moveKey(body: string, key: string, index: number): string {
	const section = readSection(body);
	const from = section.entryList.findIndex((item) => item.kind === 'Pair' && item.key === key);
	if (from < 0) return body;
	const [entry] = section.entryList.splice(from, 1);
	const pairIndexList = section.entryList.flatMap((item, at) => (item.kind === 'Pair' ? [at] : []));
	const target = index >= pairIndexList.length ? (pairIndexList.length > 0 ? pairIndexList[pairIndexList.length - 1]! + 1 : section.entryList.length) : pairIndexList[Math.max(0, index)]!;
	section.entryList.splice(target, 0, entry!);
	return writeSection(section);
}

/** Moves an item of a list property from one position to another. */
export function moveListItem(body: string, key: string, from: number, to: number): string {
	const value = entryList(body).find(([name]) => name === key)?.[1];
	if (!Array.isArray(value) || from === to || from < 0 || from >= value.length) return body;
	const list = [...value];
	const [item] = list.splice(from, 1);
	list.splice(Math.max(0, Math.min(to, list.length)), 0, item!);
	return setValue(body, key, list);
}
