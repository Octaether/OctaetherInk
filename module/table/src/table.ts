// A table's data: its columns (types guessed from the values, or set in `Column`), its rows (CSV,
// or the notes of a folder or tag), formula columns, and what its view asks for (Filter, Sort,
// Group, summaries). Pure functions, so the view, Plot, and Calendar read tables the same way.
//
//   Table {Title: Gym log, Column: {Calorie: {Unit: kcal, Summary: Average}, Net: {Formula: "Calorie - Burned"}},
//               Sort: {Date: Down}, Filter: "Calorie > 300", Group: {Date: Month}}:
//   	Date,Workout,Calorie,Burned
//   	2026-11-01,Legs,2100,520

import { type Compiled, type Value, compileText, dayOf, dayText, quantile } from '@octaether/core-expression';
import { type PropertyMap, type PropertyValue, formatInline } from '@octaether/core-format';
import type { NoteSummary, TableCell, TableSnapshot } from '@octaether/core-sdk';
import { type CsvRecord, parseCsv, writeCsv } from './csv';

export const columnTypeList = ['Text', 'Number', 'Date', 'DateTime', 'Checkbox', 'Choice', 'List', 'Link', 'Formula'] as const;
export type ColumnType = (typeof columnTypeList)[number];

export const summaryList = ['None', 'Count', 'Filled', 'Empty', 'Unique', 'Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Deviation', 'Checked'] as const;
export type Summary = (typeof summaryList)[number];

export const summaryTitle: Readonly<Record<Summary, string>> = {
	None: 'None',
	Count: 'Count rows',
	Filled: 'Count filled',
	Empty: 'Count empty',
	Unique: 'Count unique',
	Sum: 'Sum',
	Average: 'Average',
	Median: 'Median',
	Min: 'Min',
	Max: 'Max',
	Range: 'Range',
	Deviation: 'Standard deviation',
	Checked: 'Percent checked',
};

export const showList = ['Table', 'Board', 'Gallery', 'List'] as const;
export type Show = (typeof showList)[number];

export const periodList = ['Day', 'Week', 'Month', 'Year'] as const;
export type Period = (typeof periodList)[number];

export interface ColumnInfo {
	name: string;
	type: ColumnType;
	/** What a formula column's results are (Number, Text, Date…). */
	valueType: ColumnType;
	unit: string | undefined;
	summary: Summary;
	formula: string | undefined;
	/** Digits after the point; undefined: as written. */
	decimal: number | undefined;
	percent: boolean;
	/** Choice and List: the values offered, in order. */
	choiceList: string[];
	width: number | undefined;
	hidden: boolean;
	/** Its place in each CSV record (or the note property's name); -1 for a formula. */
	index: number;
}

export interface Row {
	/** Its record in the CSV (1 = the first after the header), or its note's place in the list. */
	index: number;
	cellList: string[];
	/** For a table of notes, the row's note. */
	path?: string;
}

export interface GroupInfo {
	key: string;
	label: string;
	rowList: Row[];
}

export interface TableModel {
	columnList: ColumnInfo[];
	rowList: Row[];
	/** CSV records, the header first (empty for a table of notes). */
	recordList: CsvRecord[];
	kind: 'Csv' | 'Note';
	/** Where its notes come from (`Gym/`, `tag:Workout`). */
	source: string | undefined;
	sortList: { column: string; down: boolean }[];
	filter: string | undefined;
	group: { column: string; period: Period | undefined } | undefined;
	show: Show;
	/** Columns with this name are in the source (the Column map's keys too). */
	property: PropertyMap;
}

const currencySet = new Set(['$', '€', '£', '¥', '₹', '₩', '₽', 'CHF', 'A$', 'C$', 'HK$', 'NT$']);

/** A number as written in a cell: `1,200.50`, `$12`, `72.4 kg`, `15%`. */
export function numberOf(text: string): number | undefined {
	const clean = text
		.trim()
		.replace(/^[^\d\-+.]+/, '')
		.replace(/[^\d.%]+$/, '')
		.replace(/(\d),(?=\d{3}\b)/g, '$1');
	if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/.test(clean)) return undefined;
	const value = Number.parseFloat(clean);
	return clean.endsWith('%') ? value / 100 : value;
}

const checkTrue = /^(?:true|yes|y|x|✓|✔|1|done)$/i;
const checkFalse = /^(?:false|no|n|0|)$/i;

/** The column type most cells fit, for a column without a `Type`. */
export function guessType(cellList: readonly string[]): ColumnType {
	const filled = cellList.map((cell) => cell.trim()).filter((cell) => cell !== '');
	if (filled.length === 0) return 'Text';
	if (filled.every((cell) => /^(?:true|false)$/i.test(cell))) return 'Checkbox';
	if (filled.every((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell))) return 'Date';
	if (filled.every((cell) => /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(cell))) return 'DateTime';
	if (filled.every((cell) => numberOf(cell) !== undefined)) return 'Number';
	if (filled.every((cell) => /^\[\[[^\]]+\]\]$/.test(cell))) return 'Link';
	const distinct = new Set(filled.map((cell) => cell.toLowerCase()));
	if (filled.length >= 4 && distinct.size <= Math.max(2, Math.floor(filled.length / 2)) && distinct.size <= 12 && filled.every((cell) => cell.length <= 24)) return 'Choice';
	return 'Text';
}

/** A cell's value: numbers for Number, Checkbox (1/0), Date and DateTime (days from 1970); a list for List. */
export function cellValue(type: ColumnType, text: string): TableCell {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	switch (type) {
		case 'Number':
			return numberOf(trimmed);
		case 'Date':
		case 'DateTime':
			return dayOf(trimmed);
		case 'Checkbox':
			return checkTrue.test(trimmed) ? 1 : checkFalse.test(trimmed) ? 0 : undefined;
		case 'List':
			return trimmed
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean);
		case 'Link': {
			const match = /^\[\[([^\]|#]+)/.exec(trimmed);
			return match ? match[1]!.trim() : trimmed;
		}
		default:
			return trimmed;
	}
}

/** A name a formula or filter can use: `Body fat` → `Body_fat`. */
export function formulaName(name: string): string {
	return name.trim().replace(/[^A-Za-z0-9Ͱ-Ͽ_]+/g, '_');
}

const textOf = (value: PropertyValue | undefined): string | undefined => (value === undefined || value === null ? undefined : typeof value === 'string' ? value : String(value));

function mapOf(value: PropertyValue | undefined): PropertyMap {
	return value instanceof Map ? value : new Map();
}

/** A note property as a cell's text: a list as `a, b`. */
function propertyText(value: PropertyValue | undefined): string {
	if (value === undefined || value === null) return '';
	if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? item : formatInline(item))).join(', ');
	if (typeof value === 'boolean') return value ? 'True' : 'False';
	if (value instanceof Map) return formatInline(value);
	return String(value);
}

/** Notes a `Source` names: a folder (`Gym/`, `Gym`), a tag (`tag:Workout`), or several in a list. */
export function sourceNoteList(source: PropertyValue | undefined, noteList: readonly NoteSummary[], except?: string): NoteSummary[] {
	const partList = (Array.isArray(source) ? source : source === undefined || source === null ? [] : [source]).map(String);
	if (partList.length === 0) return [];
	return noteList.filter((note) => {
		if (note.path === except) return false;
		return partList.some((part) => {
			const tag = /^tag:\s*#?(.+)$/i.exec(part);
			if (tag) return note.tagList.some((item) => item.toLowerCase() === tag[1]!.trim().toLowerCase());
			const folder = part.replace(/^\/+|\/+$/g, '');
			return folder === '' ? true : note.folder === folder || note.folder.startsWith(`${folder}/`);
		});
	});
}

/** Reads a Table block. `noteList` is the vault's notes, for a table whose rows are notes (`Source`). */
export function readTable(property: PropertyMap, body: string, noteList: readonly NoteSummary[] = [], except?: string): TableModel {
	const columnProperty = mapOf(property.get('Column'));
	const source = property.get('Source');
	const hiddenValue = property.get('Hidden');
	const hiddenSet = new Set((Array.isArray(hiddenValue) ? hiddenValue : hiddenValue === undefined || hiddenValue === null ? [] : [hiddenValue]).map(String));
	let recordList: CsvRecord[] = [];
	let headerList: string[] = [];
	let rowList: Row[] = [];
	const kind = source === undefined || source === null || source === '' ? 'Csv' : 'Note';
	if (kind === 'Csv') {
		recordList = parseCsv(body);
		headerList = recordList[0]?.cellList.map((cell, index) => cell || `Column ${index + 1}`) ?? [];
		rowList = recordList.slice(1).map((record, index) => ({ index: index + 1, cellList: record.cellList }));
	} else {
		const list = sourceNoteList(source, noteList, except);
		headerList = ['Name'];
		for (const note of list) for (const key of note.property.keys()) if (!headerList.includes(key) && key !== 'Name') headerList.push(key);
		rowList = list.map((note, index) => ({
			index,
			path: note.path,
			cellList: headerList.map((key) => (key === 'Name' ? `[[${note.path.replace(/\.oi$/, '')}]]` : propertyText(note.property.get(key)))),
		}));
	}
	// headers the Column map gives that aren't in the data: formula columns
	const columnList: ColumnInfo[] = headerList.map((name, index) => columnOf(name, index, mapOf(columnProperty.get(name)), rowList, hiddenSet));
	for (const [name, value] of columnProperty) {
		if (headerList.includes(name)) continue;
		const formula = textOf(mapOf(value).get('Formula'));
		if (formula !== undefined) columnList.push(columnOf(name, -1, mapOf(value), rowList, hiddenSet));
	}
	if (kind === 'Note') {
		const name = columnList[0];
		if (name) name.type = name.valueType = 'Link';
	}
	const sortList: { column: string; down: boolean }[] = [];
	const sortValue = property.get('Sort');
	if (sortValue instanceof Map) for (const [column, way] of sortValue) sortList.push({ column, down: /^down|desc/i.test(String(way)) });
	else if (typeof sortValue === 'string' && sortValue.trim()) sortList.push({ column: sortValue.replace(/^-/, '').trim(), down: sortValue.trim().startsWith('-') });
	let group: TableModel['group'];
	const groupValue = property.get('Group');
	if (groupValue instanceof Map) {
		const [column, period] = [...groupValue][0] ?? [];
		if (column) group = { column, period: periodList.find((item) => item === String(period)) };
	} else if (typeof groupValue === 'string' && groupValue.trim()) group = { column: groupValue.trim(), period: undefined };
	const showText = textOf(property.get('Show'));
	return {
		columnList,
		rowList,
		recordList,
		kind,
		source: kind === 'Note' ? propertyText(source) : undefined,
		sortList,
		filter: textOf(property.get('Filter'))?.trim() || undefined,
		group,
		show: showList.find((item) => item === showText) ?? 'Table',
		property,
	};
}

function columnOf(name: string, index: number, setting: PropertyMap, rowList: readonly Row[], hiddenSet: ReadonlySet<string>): ColumnInfo {
	const formula = textOf(setting.get('Formula'));
	const typeText = textOf(setting.get('Type'));
	const given = columnTypeList.find((type) => type === typeText);
	const type: ColumnType = formula !== undefined ? 'Formula' : (given ?? guessType(index < 0 ? [] : rowList.map((row) => row.cellList[index] ?? '')));
	const valueTypeText = textOf(setting.get('Result'));
	const choiceValue = setting.get('Choice');
	let choiceList = (Array.isArray(choiceValue) ? choiceValue : []).map(String);
	if ((type === 'Choice' || type === 'List') && choiceList.length === 0) {
		const seen = new Set<string>();
		for (const row of rowList) {
			const value = cellValue(type, row.cellList[index] ?? '');
			for (const item of Array.isArray(value) ? value : value === undefined ? [] : [String(value)]) seen.add(item);
		}
		choiceList = [...seen];
	}
	const format = setting.get('Format');
	const decimalValue = format instanceof Map ? format.get('Decimal') : setting.get('Decimal');
	const summaryText = textOf(setting.get('Summary'));
	const widthValue = setting.get('Width');
	return {
		name,
		type,
		valueType: formula !== undefined ? (columnTypeList.find((item) => item === valueTypeText) ?? 'Number') : type,
		unit: textOf(setting.get('Unit')),
		summary: summaryList.find((item) => item === summaryText) ?? 'None',
		formula,
		decimal: typeof decimalValue === 'number' ? decimalValue : undefined,
		percent: (format instanceof Map ? format.get('Percent') : format) === 'Percent' || setting.get('Percent') === true,
		choiceList,
		width: typeof widthValue === 'number' ? widthValue : undefined,
		hidden: hiddenSet.has(name),
		index,
	};
}

// ---------------------------------------------------------------- computed values

/** Each row's values by column (formulas worked out in column order, so one can use another). */
export function computeValue(model: TableModel): { valueList: TableCell[][]; problem: string | undefined } {
	let problem: string | undefined;
	const compiledMap = new Map<string, Compiled>();
	for (const column of model.columnList) {
		if (column.formula === undefined) continue;
		try {
			compiledMap.set(column.name, compileText(column.formula, { nameAsText: true }));
		} catch (error) {
			problem ??= `${column.name}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	const valueList = model.rowList.map((row) => {
		const cellList: TableCell[] = [];
		const variable: Record<string, Value | undefined> = {};
		model.columnList.forEach((column, columnIndex) => {
			let value: TableCell;
			if (column.formula !== undefined) {
				const run = compiledMap.get(column.name);
				try {
					const result = run ? run({ variable }) : undefined;
					value = typeof result === 'number' ? (Number.isFinite(result) ? result : undefined) : Array.isArray(result) ? result.map(String) : result;
				} catch (error) {
					problem ??= `${column.name}: ${error instanceof Error ? error.message : String(error)}`;
					value = undefined;
				}
			} else value = cellValue(column.type, row.cellList[column.index] ?? '');
			cellList[columnIndex] = value;
			// empty number cells count as 0 in formulas (a missing Burned doesn't hide the Net)
			const numeric = column.valueType === 'Number' || column.valueType === 'Checkbox';
			variable[formulaName(column.name)] = value === undefined ? (numeric ? 0 : '') : (value as Value);
		});
		return cellList;
	});
	return { valueList, problem };
}

/** The rows a view shows: filtered, searched, and sorted; with `Group`, in groups. */
export function viewOf(model: TableModel, search = ''): { rowList: Row[]; valueOf: (row: Row) => TableCell[]; groupList: GroupInfo[] | undefined; problem: string | undefined } {
	const { valueList, problem: valueProblem } = computeValue(model);
	let problem = valueProblem;
	const valueMap = new Map<Row, TableCell[]>(model.rowList.map((row, index) => [row, valueList[index]!]));
	const valueOf = (row: Row): TableCell[] => valueMap.get(row) ?? [];
	let rowList = [...model.rowList];
	if (model.filter) {
		try {
			const run = compileText(model.filter, { nameAsText: true });
			rowList = rowList.filter((row) => {
				const variable: Record<string, Value | undefined> = {};
				model.columnList.forEach((column, index) => {
					const value = valueOf(row)[index];
					variable[formulaName(column.name)] = value === undefined ? '' : (value as Value);
				});
				const result = run({ variable });
				return Array.isArray(result) ? result.length > 0 : typeof result === 'string' ? result !== '' : result !== 0 && !Number.isNaN(result);
			});
		} catch (error) {
			problem ??= `Filter: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
	const query = search.trim().toLowerCase();
	if (query) rowList = rowList.filter((row) => row.cellList.some((cell) => cell.toLowerCase().includes(query)) || valueOf(row).some((value) => value !== undefined && String(value).toLowerCase().includes(query)));
	for (const sort of [...model.sortList].reverse()) {
		const index = model.columnList.findIndex((column) => column.name === sort.column);
		if (index < 0) continue;
		const direction = sort.down ? -1 : 1;
		rowList = rowList
			.map((row, order) => ({ row, order }))
			.sort((left, right) => {
				const a = valueOf(left.row)[index];
				const b = valueOf(right.row)[index];
				if (a === undefined || b === undefined) return a === b ? left.order - right.order : a === undefined ? 1 : -1;
				const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
				return order === 0 ? left.order - right.order : order * direction;
			})
			.map((entry) => entry.row);
	}
	let groupList: GroupInfo[] | undefined;
	if (model.group) {
		const index = model.columnList.findIndex((column) => column.name === model.group!.column);
		if (index >= 0) {
			const column = model.columnList[index]!;
			const map = new Map<string, GroupInfo>();
			for (const row of rowList) {
				const value = valueOf(row)[index];
				const keyList = Array.isArray(value) && value.length > 0 ? value : [value];
				for (const item of keyList) {
					const { key, label } = groupKey(column, item as TableCell, model.group.period);
					let group = map.get(key);
					if (!group) map.set(key, (group = { key, label, rowList: [] }));
					group.rowList.push(row);
				}
			}
			groupList = [...map.values()];
			if (column.valueType === 'Date' || column.valueType === 'DateTime' || column.valueType === 'Number') groupList.sort((left, right) => (left.key === '' ? 1 : right.key === '' ? -1 : left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
			else if (column.choiceList.length) groupList.sort((left, right) => rank(column.choiceList, left.key) - rank(column.choiceList, right.key));
		}
	}
	return { rowList, valueOf, groupList, problem };
}

const rank = (list: readonly string[], key: string): number => {
	const index = list.findIndex((item) => item.toLowerCase() === key.toLowerCase());
	return key === '' ? Number.MAX_SAFE_INTEGER : index < 0 ? list.length : index;
};

const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The first day of the period a day is in (weeks start on Monday). */
export function periodStart(day: number, period: Period): number {
	const whole = Math.floor(day);
	const date = new Date(whole * 86_400_000);
	switch (period) {
		case 'Day':
			return whole;
		case 'Week':
			return whole - ((date.getUTCDay() + 6) % 7);
		case 'Month':
			return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86_400_000;
		case 'Year':
			return Date.UTC(date.getUTCFullYear(), 0, 1) / 86_400_000;
	}
}

/** A period's name: `November 2026`, `Week of 2026-11-02`, `2026`. */
export function periodLabel(start: number, period: Period): string {
	const date = new Date(start * 86_400_000);
	switch (period) {
		case 'Day':
			return dayText(start);
		case 'Week':
			return `Week of ${dayText(start)}`;
		case 'Month':
			return `${monthName[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
		case 'Year':
			return String(date.getUTCFullYear());
	}
}

function groupKey(column: ColumnInfo, value: TableCell, period: Period | undefined): { key: string; label: string } {
	if (value === undefined || value === '') return { key: '', label: `No ${column.name}` };
	if (typeof value === 'number' && (column.valueType === 'Date' || column.valueType === 'DateTime')) {
		const start = periodStart(value, period ?? 'Day');
		return { key: String(start).padStart(8, '0'), label: periodLabel(start, period ?? 'Day') };
	}
	if (column.valueType === 'Checkbox') return { key: String(value), label: value === 1 ? 'Checked' : 'Not checked' };
	if (typeof value === 'number') return { key: String(value).padStart(16, '0'), label: formatValue(column, value) };
	return { key: String(value).toLowerCase(), label: String(value) };
}

// ---------------------------------------------------------------- summaries and statistics

const numberList = (valueList: readonly TableCell[]): number[] => valueList.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

/** A column's summary over some rows' values, as a number (undefined when it can't be worked out). */
export function summarize(summary: Summary, valueList: readonly TableCell[]): number | undefined {
	const filled = valueList.filter((value) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0));
	const list = numberList(valueList);
	switch (summary) {
		case 'None':
			return undefined;
		case 'Count':
			return valueList.length;
		case 'Filled':
			return filled.length;
		case 'Empty':
			return valueList.length - filled.length;
		case 'Unique':
			return new Set(filled.map((value) => (Array.isArray(value) ? value.join(',') : String(value).toLowerCase()))).size;
		case 'Sum':
			return list.reduce((total, value) => total + value, 0);
		case 'Average':
			return list.length ? list.reduce((total, value) => total + value, 0) / list.length : undefined;
		case 'Median':
			return list.length ? quantile([...list].sort((a, b) => a - b), 0.5) : undefined;
		case 'Min':
			return list.length ? Math.min(...list) : undefined;
		case 'Max':
			return list.length ? Math.max(...list) : undefined;
		case 'Range':
			return list.length ? Math.max(...list) - Math.min(...list) : undefined;
		case 'Deviation': {
			if (list.length < 2) return undefined;
			const mean = list.reduce((total, value) => total + value, 0) / list.length;
			return Math.sqrt(list.reduce((total, value) => total + (value - mean) ** 2, 0) / (list.length - 1));
		}
		case 'Checked':
			return valueList.length ? list.filter((value) => value === 1).length / valueList.length : undefined;
	}
}

/** Which summaries make sense for a column. */
export function summaryChoiceList(column: ColumnInfo): Summary[] {
	const always: Summary[] = ['None', 'Count', 'Filled', 'Empty', 'Unique'];
	switch (column.valueType) {
		case 'Number':
			return [...always, 'Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Deviation'];
		case 'Date':
		case 'DateTime':
			return [...always, 'Min', 'Max', 'Range'];
		case 'Checkbox':
			return [...always, 'Checked'];
		default:
			return always;
	}
}

/** A summary as shown: counts as counts, sums in the column's unit, a date range in days. */
export function summaryText(column: ColumnInfo, summary: Summary, value: number | undefined): string {
	if (value === undefined) return '';
	if (summary === 'Count' || summary === 'Filled' || summary === 'Empty' || summary === 'Unique') return String(value);
	if (summary === 'Checked') return `${Math.round(value * 100)}%`;
	if (column.valueType === 'Date' || column.valueType === 'DateTime') return summary === 'Range' ? `${Math.round(value)} days` : formatValue(column, value);
	return formatValue(column, summary === 'Average' || summary === 'Deviation' ? roundNice(value) : value);
}

const roundNice = (value: number): number => Math.round(value * 100) / 100;

/** The statistics of a number column (the Analyze card). */
export function statisticsOf(valueList: readonly TableCell[]): { count: number; mean: number; median: number; deviation: number; min: number; max: number; q1: number; q3: number; bin: { from: number; to: number; count: number }[] } | undefined {
	const list = numberList(valueList).sort((a, b) => a - b);
	if (list.length === 0) return undefined;
	const mean = list.reduce((total, value) => total + value, 0) / list.length;
	const deviation = list.length > 1 ? Math.sqrt(list.reduce((total, value) => total + (value - mean) ** 2, 0) / (list.length - 1)) : 0;
	const min = list[0]!;
	const max = list.at(-1)!;
	const binCount = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(list.length))));
	const width = (max - min) / binCount || 1;
	const bin = Array.from({ length: binCount }, (_, index) => ({ from: min + index * width, to: min + (index + 1) * width, count: 0 }));
	for (const value of list) bin[Math.min(binCount - 1, Math.floor((value - min) / width))]!.count++;
	return { count: list.length, mean, median: quantile(list, 0.5), deviation, min, max, q1: quantile(list, 0.25), q3: quantile(list, 0.75), bin };
}

// ---------------------------------------------------------------- showing values

const shortMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A value as a cell shows it: `1,200.5 kcal`, `$12.00`, `Nov 4, 2026`, `45%`. */
export function formatValue(column: ColumnInfo, value: TableCell): string {
	if (value === undefined) return '';
	if (typeof value === 'object') return value.join(', ');
	if (typeof value === 'string') return value;
	switch (column.valueType) {
		case 'Date':
		case 'DateTime': {
			const date = new Date(Math.round(value * 1440) * 60_000);
			const text = `${shortMonth[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
			return column.valueType === 'DateTime' || value % 1 !== 0 ? `${text} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}` : text;
		}
		case 'Checkbox':
			return value === 1 ? '✓' : '';
		default: {
			if (column.percent) return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: column.decimal ?? 1, minimumFractionDigits: column.decimal ?? 0 })}%`;
			const unit = column.unit ?? '';
			const currency = currencySet.has(unit);
			const digit = column.decimal ?? (currency ? 2 : undefined);
			const text = value.toLocaleString('en-US', digit === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: digit, maximumFractionDigits: digit });
			if (!unit) return text;
			return currency ? (value < 0 ? `-${unit}${text.slice(1)}` : `${unit}${text}`) : `${text} ${unit}`;
		}
	}
}

// ---------------------------------------------------------------- editing CSV

/** The body after setting one cell (row 0 is the header); rows and columns are added as needed. */
export function setCell(model: TableModel, recordIndex: number, cellIndex: number, text: string): string {
	const recordList = model.recordList.map((record) => ({ ...record, cellList: [...record.cellList] }));
	while (recordList.length <= recordIndex) recordList.push({ cellList: [] });
	const record = recordList[recordIndex]!;
	while (record.cellList.length <= cellIndex) record.cellList.push('');
	if (record.cellList[cellIndex] === text) return writeCsv(model.recordList);
	record.cellList[cellIndex] = text;
	record.text = undefined;
	return writeCsv(recordList);
}

/** The body after pasting a block of cells at a place (rows and columns grow to fit). */
export function pasteCell(model: TableModel, recordIndex: number, cellIndex: number, block: readonly (readonly string[])[]): string {
	const recordList = model.recordList.map((record) => ({ ...record, cellList: [...record.cellList] }));
	block.forEach((cellList, rowOffset) => {
		while (recordList.length <= recordIndex + rowOffset) recordList.push({ cellList: [] });
		const record = recordList[recordIndex + rowOffset]!;
		cellList.forEach((cell, columnOffset) => {
			while (record.cellList.length <= cellIndex + columnOffset) record.cellList.push('');
			record.cellList[cellIndex + columnOffset] = cell;
		});
		record.text = undefined;
	});
	return writeCsv(recordList);
}

/** The body with records added, removed, or reordered: `order` lists old record indexes (header first) or new cell lists. */
export function rewriteRecord(model: TableModel, order: readonly (number | readonly string[])[]): string {
	return writeCsv(order.map((item) => (typeof item === 'number' ? model.recordList[item]! : { cellList: [...item] })));
}

/** The body with a column inserted at a place (every record gets an empty cell there). */
export function insertColumn(model: TableModel, cellIndex: number, name: string): string {
	const recordList = (model.recordList.length ? model.recordList : [{ cellList: [] }]).map((record, index) => {
		const cellList = [...record.cellList];
		while (cellList.length < cellIndex) cellList.push('');
		cellList.splice(cellIndex, 0, index === 0 ? name : '');
		return { cellList };
	});
	return writeCsv(recordList);
}

/** The body without a column. */
export function removeColumn(model: TableModel, cellIndex: number): string {
	return writeCsv(model.recordList.map((record) => ({ cellList: record.cellList.filter((_, index) => index !== cellIndex) })));
}

/** The body with a column moved to another place. */
export function moveColumn(model: TableModel, from: number, to: number): string {
	return writeCsv(
		model.recordList.map((record) => {
			const cellList = [...record.cellList];
			const width = Math.max(cellList.length, from + 1, to + 1);
			while (cellList.length < width) cellList.push('');
			const [cell] = cellList.splice(from, 1);
			cellList.splice(to, 0, cell ?? '');
			return { cellList };
		}),
	);
}

/** A cell's text for a value typed in a column (a checkbox as True/False, a date as written). */
export function writtenOf(column: ColumnInfo, text: string): string {
	if (column.type === 'Checkbox') return checkTrue.test(text.trim()) ? 'True' : 'False';
	return text;
}

/** A typed value for a note's property, from a cell's text. */
export function propertyValueOf(column: ColumnInfo, text: string): PropertyValue | undefined {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	switch (column.type) {
		case 'Number':
			return numberOf(trimmed) ?? trimmed;
		case 'Checkbox':
			return checkTrue.test(trimmed);
		case 'List':
			return trimmed
				.split(',')
				.map((item) => item.trim())
				.filter(Boolean);
		default:
			return trimmed;
	}
}

// ---------------------------------------------------------------- for Plot and Calendar

/** A table's rows after its Filter and Sort, by column. */
export function snapshotOf(model: TableModel): TableSnapshot {
	const { rowList, valueOf } = viewOf(model);
	return {
		columnList: model.columnList.map((column, index) => ({ name: column.name, type: column.valueType, unit: column.unit, valueList: rowList.map((row) => valueOf(row)[index]) })),
		rowCount: rowList.length,
		pathList: model.kind === 'Note' ? rowList.map((row) => row.path) : undefined,
	};
}
