// Excel workbooks (.xlsx) as tables: one sheet's cells as rows of text, and edits written back into
// that sheet only. A changed cell gets its new value and keeps its style (font, fill, number format,
// borders); new rows take the style of the row above; every other part of the file (styles, other
// sheets, charts, formulas you didn't touch) is copied as it was. Excel works formulas out again when
// it opens the file. Dates are shown as 2026-11-04 and written back as Excel's day numbers.

import { type ZipEntry, entryText, packEntry, readZip, writeZip } from './zip';

export interface Sheet {
	name: string;
	/** Its part in the zip: `xl/worksheets/sheet1.xml`. */
	path: string;
}

export interface Workbook {
	entryList: ZipEntry[];
	sheetList: Sheet[];
	sharedList: string[];
	/** Styles (their index in cellXfs) whose number format is a date. */
	dateStyleSet: Set<number>;
}

export interface SheetGrid {
	sheet: Sheet;
	/** Cell text, the first row being the header. */
	rowList: string[][];
	/** Where the grid starts in the sheet (1-based row, 0-based column). */
	firstRow: number;
	firstColumn: number;
}

const unescape = (text: string): string =>
	text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, code: string) => {
		const lower = code.toLowerCase();
		if (lower === 'lt') return '<';
		if (lower === 'gt') return '>';
		if (lower === 'amp') return '&';
		if (lower === 'quot') return '"';
		if (lower === 'apos') return "'";
		return String.fromCodePoint(lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1)));
	});
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attributeOf = (attributeText: string, name: string): string | undefined => {
	const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributeText);
	return match ? unescape(match[1]!) : undefined;
};

/** `B12` → row 12, column 1. */
export function cellPlace(reference: string): { row: number; column: number } {
	const match = /^([A-Z]+)(\d+)$/.exec(reference.toUpperCase());
	if (!match) return { row: 0, column: 0 };
	let column = 0;
	for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64);
	return { row: Number(match[2]), column: column - 1 };
}

export function cellReference(row: number, column: number): string {
	let name = '';
	for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
	return `${name}${row}`;
}

/** Text of the `<t>` runs in a piece of XML (a shared string, an inline string). */
const runText = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => unescape(match[1]!)).join('');

const builtinDateSet = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export async function readWorkbook(bytes: Uint8Array): Promise<Workbook> {
	const entryList = readZip(bytes);
	const byName = new Map(entryList.map((entry) => [entry.name, entry]));
	const text = async (name: string): Promise<string> => {
		const entry = byName.get(name);
		return entry ? entryText(entry) : '';
	};
	const workbook = await text('xl/workbook.xml');
	if (!workbook) throw new Error('not an Excel workbook');
	const relation = await text('xl/_rels/workbook.xml.rels');
	const targetMap = new Map<string, string>();
	for (const match of relation.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const id = attributeOf(match[1]!, 'Id');
		const target = attributeOf(match[1]!, 'Target');
		if (id && target) targetMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
	}
	const sheetList: Sheet[] = [];
	for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
		const name = attributeOf(match[1]!, 'name') ?? `Sheet${sheetList.length + 1}`;
		const id = attributeOf(match[1]!, 'r:id');
		const path = id ? targetMap.get(id) : undefined;
		if (path && byName.has(path)) sheetList.push({ name, path });
	}
	const sharedList = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => runText(match[1]!));
	const style = await text('xl/styles.xml');
	const customDateSet = new Set<number>();
	for (const match of style.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
		const id = Number(attributeOf(match[1]!, 'numFmtId'));
		const code = (attributeOf(match[1]!, 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
		if (/[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) customDateSet.add(id);
	}
	const dateStyleSet = new Set<number>();
	const cellXf = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(style)?.[1] ?? '';
	[...cellXf.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].forEach((match, index) => {
		const id = Number(attributeOf(match[1]!, 'numFmtId') ?? 0);
		if (builtinDateSet.has(id) || customDateSet.has(id)) dateStyleSet.add(index);
	});
	return { entryList, sheetList, sharedList, dateStyleSet };
}

interface CellXml {
	column: number;
	attribute: string;
	inner: string;
	raw: string;
}

interface RowXml {
	row: number;
	attribute: string;
	raw: string;
	cellList: CellXml[];
	changed: boolean;
}

function readSheetData(xml: string): { before: string; rowList: RowXml[]; after: string } {
	const open = /<sheetData\b[^>]*?(\/>|>)/.exec(xml);
	if (!open) return { before: xml, rowList: [], after: '' };
	if (open[1] === '/>') return { before: `${xml.slice(0, open.index)}<sheetData>`, rowList: [], after: `</sheetData>${xml.slice(open.index + open[0].length)}` };
	const start = open.index + open[0].length;
	const end = xml.indexOf('</sheetData>', start);
	const inner = xml.slice(start, end);
	const rowList: RowXml[] = [];
	for (const match of inner.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
		const attribute = match[1]!;
		const row = Number(attributeOf(attribute, 'r') ?? rowList.length + 1);
		const cellList: CellXml[] = [];
		let next = 0;
		for (const cell of (match[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const reference = attributeOf(cell[1]!, 'r');
			const column = reference ? cellPlace(reference).column : next;
			next = column + 1;
			cellList.push({ column, attribute: cell[1]!, inner: cell[2] ?? '', raw: cell[0] });
		}
		rowList.push({ row, attribute, raw: match[0], cellList, changed: false });
	}
	return { before: xml.slice(0, start), rowList, after: xml.slice(end) };
}

const dateFromSerial = (serial: number): string => {
	const time = Math.round((serial - 25569) * 86_400) * 1000;
	const date = new Date(time);
	const pad = (value: number): string => String(value).padStart(2, '0');
	const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
	return serial % 1 === 0 ? day : `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

const serialFromDate = (text: string): number | undefined => {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text.trim());
	if (!match) return undefined;
	const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
	return time / 86_400_000 + 25569;
};

function cellText(cell: CellXml, book: Workbook): string {
	const type = attributeOf(cell.attribute, 't');
	const style = Number(attributeOf(cell.attribute, 's') ?? 0);
	const value = /<v>([\s\S]*?)<\/v>/.exec(cell.inner)?.[1];
	switch (type) {
		case 's':
			return book.sharedList[Number(value)] ?? '';
		case 'inlineStr':
			return runText(/<is>([\s\S]*?)<\/is>/.exec(cell.inner)?.[1] ?? '');
		case 'b':
			return value === '1' ? 'True' : value === '0' ? 'False' : '';
		case 'str':
		case 'e':
			return value === undefined ? '' : unescape(value);
		default: {
			if (value === undefined) return '';
			const number = Number(value);
			if (!Number.isFinite(number)) return unescape(value);
			if (book.dateStyleSet.has(style)) return dateFromSerial(number);
			// binary floats as people wrote them: 0.30000000000000004 → 0.3
			return String(Number(number.toPrecision(15)));
		}
	}
}

/** A sheet's cells as rows of text (the first sheet, or the one named). */
export async function sheetGrid(book: Workbook, sheetName?: string): Promise<SheetGrid | undefined> {
	const sheet = book.sheetList.find((item) => item.name === sheetName) ?? book.sheetList[0];
	if (!sheet) return undefined;
	const entry = book.entryList.find((item) => item.name === sheet.path)!;
	const { rowList } = readSheetData(await entryText(entry));
	const filled = rowList.filter((row) => row.cellList.some((cell) => cellText(cell, book) !== ''));
	if (filled.length === 0) return { sheet, rowList: [], firstRow: 1, firstColumn: 0 };
	const firstRow = filled[0]!.row;
	const lastRow = filled.at(-1)!.row;
	let firstColumn = Number.POSITIVE_INFINITY;
	let lastColumn = 0;
	for (const row of filled) {
		for (const cell of row.cellList) {
			if (cellText(cell, book) === '') continue;
			firstColumn = Math.min(firstColumn, cell.column);
			lastColumn = Math.max(lastColumn, cell.column);
		}
	}
	const byRow = new Map(rowList.map((row) => [row.row, row]));
	const grid: string[][] = [];
	for (let row = firstRow; row <= lastRow; row++) {
		const line: string[] = [];
		const xml = byRow.get(row);
		for (let column = firstColumn; column <= lastColumn; column++) {
			const cell = xml?.cellList.find((item) => item.column === column);
			line.push(cell ? cellText(cell, book) : '');
		}
		grid.push(line);
	}
	return { sheet, rowList: grid, firstRow, firstColumn };
}

/** A new cell for a value, keeping the cell's style (and its other attributes, but not its type). */
function cellXml(reference: string, attribute: string, text: string, book: Workbook, wasBoolean: boolean): string {
	const kept = attribute
		.replace(/\s+(?:r|t)="[^"]*"/g, '')
		.trim();
	const head = `<c r="${reference}"${kept ? ` ${kept}` : ''}`;
	const value = text.trim();
	if (value === '') return `${head}/>`;
	const style = Number(attributeOf(attribute, 's') ?? 0);
	if (wasBoolean && /^(true|false)$/i.test(value)) return `${head} t="b"><v>${/^true$/i.test(value) ? 1 : 0}</v></c>`;
	const serial = serialFromDate(value);
	if (serial !== undefined && book.dateStyleSet.has(style)) return `${head}><v>${serial}</v></c>`;
	if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return `${head}><v>${value}</v></c>`;
	return `${head} t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`;
}

/**
 * The workbook with a sheet's cells changed from `before` to `after` (grids as `sheetGrid` gives
 * them). Only the cells that differ are written; the rest of the file is copied as it was.
 */
export async function writeSheet(book: Workbook, grid: SheetGrid, after: readonly (readonly string[])[]): Promise<Uint8Array> {
	const entry = book.entryList.find((item) => item.name === grid.sheet.path)!;
	const xml = await entryText(entry);
	const { before: head, rowList, after: tail } = readSheetData(xml);
	const byRow = new Map(rowList.map((row) => [row.row, row]));
	const height = Math.max(grid.rowList.length, after.length);
	const width = Math.max(...grid.rowList.map((row) => row.length), ...after.map((row) => row.length), 0);
	let changed = false;
	for (let rowIndex = 0; rowIndex < height; rowIndex++) {
		for (let columnIndex = 0; columnIndex < width; columnIndex++) {
			const old = grid.rowList[rowIndex]?.[columnIndex] ?? '';
			const next = after[rowIndex]?.[columnIndex] ?? '';
			if (old === next) continue;
			changed = true;
			const rowNumber = grid.firstRow + rowIndex;
			const column = grid.firstColumn + columnIndex;
			let row = byRow.get(rowNumber);
			if (!row) {
				row = { row: rowNumber, attribute: ` r="${rowNumber}"`, raw: '', cellList: [], changed: true };
				byRow.set(rowNumber, row);
				rowList.push(row);
			}
			row.changed = true;
			let cell = row.cellList.find((item) => item.column === column);
			if (!cell) {
				// a new cell takes the style of the one above it
				const above = byRow.get(rowNumber - 1)?.cellList.find((item) => item.column === column);
				const style = above ? attributeOf(above.attribute, 's') : undefined;
				cell = { column, attribute: style ? ` s="${style}"` : '', inner: '', raw: '' };
				row.cellList.push(cell);
			}
			const wasBoolean = attributeOf(cell.attribute, 't') === 'b';
			cell.raw = cellXml(cellReference(rowNumber, column), cell.attribute, next, book, wasBoolean);
		}
	}
	if (!changed) return writeZip(book.entryList);
	rowList.sort((a, b) => a.row - b.row);
	const body = rowList
		.map((row) => {
			if (!row.changed) return row.raw;
			row.cellList.sort((a, b) => a.column - b.column);
			// a row's spans hint would be stale; Excel works it out again
			const attribute = row.attribute.replace(/\s+spans="[^"]*"/, '');
			return `<row${attribute}>${row.cellList.map((cell) => cell.raw).join('')}</row>`;
		})
		.join('');
	let sheetXml = `${head}${body}${tail}`;
	// the used range grows with new rows and columns
	const lastRow = Math.max(...rowList.map((row) => row.row));
	const lastColumn = Math.max(0, ...rowList.flatMap((row) => row.cellList.map((cell) => cell.column)));
	sheetXml = sheetXml.replace(/<dimension\s+ref="([^"]*)"\s*\/>/, (whole, reference: string) => {
		const [from = 'A1', to = from] = reference.split(':');
		const end = cellPlace(to);
		return `<dimension ref="${from}:${cellReference(Math.max(end.row, lastRow), Math.max(end.column, lastColumn))}"/>`;
	});
	const entryList = [...book.entryList];
	const sheetIndex = entryList.findIndex((item) => item.name === grid.sheet.path);
	entryList[sheetIndex] = await packEntry(entry, sheetXml);
	// formulas that read the changed cells: Excel works everything out again on opening
	const workbookIndex = entryList.findIndex((item) => item.name === 'xl/workbook.xml');
	if (workbookIndex >= 0) {
		let workbook = await entryText(entryList[workbookIndex]!);
		if (/<calcPr\b/.test(workbook)) {
			if (!/fullCalcOnLoad=/.test(workbook)) workbook = workbook.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
		} else {
			// calcPr comes after the defined names (when there are some), else after the sheets
			const anchor = workbook.includes('</definedNames>') ? '</definedNames>' : '</sheets>';
			workbook = workbook.replace(anchor, `${anchor}<calcPr fullCalcOnLoad="1"/>`);
		}
		entryList[workbookIndex] = await packEntry(entryList[workbookIndex]!, workbook);
	}
	// the cached formula order may now be wrong; Excel rebuilds it
	const chain = entryList.findIndex((item) => item.name === 'xl/calcChain.xml');
	if (chain >= 0) {
		entryList.splice(chain, 1);
		for (const [index, item] of entryList.entries()) {
			if (item.name === '[Content_Types].xml' || item.name === 'xl/_rels/workbook.xml.rels') {
				const text = (await entryText(item)).replace(/<Override\b[^>]*calcChain[^>]*\/>/g, '').replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, '');
				entryList[index] = await packEntry(item, text);
			}
		}
	}
	return writeZip(entryList);
}
