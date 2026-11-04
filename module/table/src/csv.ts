// CSV as spreadsheets write it: commas between cells, "quotes" around a cell holding a comma, a
// quote ("" inside), or a line break. Spaces around a cell without quotes are dropped, so the
// source can be lined up by hand. Each record keeps the text it was read from, so rows nobody
// changed are written back exactly as they were.

export interface CsvRecord {
	cellList: string[];
	/** The source lines this record was read from; undefined for a new or changed record. */
	text?: string;
}

/** Reads CSV (or tab-separated text, as copied from a spreadsheet: `separator` '\t'). Blank lines are skipped. */
export function parseCsv(body: string, separator = ','): CsvRecord[] {
	const recordList: CsvRecord[] = [];
	let at = 0;
	const text = body.replace(/\r\n?/g, '\n');
	while (at < text.length) {
		const start = at;
		const cellList: string[] = [];
		let cell = '';
		let quoted = false;
		let wasQuoted = false;
		let end = text.length;
		for (; at <= text.length; at++) {
			const character = text[at];
			if (quoted) {
				if (character === undefined) {
					// an unclosed quote runs to the end
					cellList.push(cell);
					break;
				}
				if (character === '"') {
					if (text[at + 1] === '"') {
						cell += '"';
						at++;
					} else quoted = false;
				} else cell += character;
				continue;
			}
			if (character === '"' && cell.trim() === '') {
				quoted = true;
				wasQuoted = true;
				cell = '';
				continue;
			}
			if (character === separator || character === '\n' || character === undefined) {
				cellList.push(wasQuoted ? cell : cell.trim());
				cell = '';
				wasQuoted = false;
				if (character !== separator) {
					end = at;
					at++;
					break;
				}
				continue;
			}
			if (wasQuoted) {
				// text after a closing quote ("a"b) is kept, as spreadsheets do
				if (character.trim() !== '') cell += character;
				continue;
			}
			cell += character;
		}
		const source = text.slice(start, Math.min(end, text.length));
		if (source.trim() === '') continue;
		recordList.push({ cellList, text: source });
	}
	return recordList;
}

/** A cell as CSV: quoted when it holds a separator, a quote, a line break, or spaces at its ends. */
export function cellText(cell: string, separator = ','): string {
	if (cell.includes(separator) || cell.includes('"') || cell.includes('\n') || cell !== cell.trim()) return `"${cell.replace(/"/g, '""')}"`;
	return cell;
}

/** A record as one CSV line (or more, for cells with line breaks). Empty cells at the end are left out. */
export function recordText(cellList: readonly string[], separator = ','): string {
	let last = cellList.length;
	while (last > 1 && cellList[last - 1] === '') last--;
	return cellList.slice(0, last).map((cell) => cellText(cell, separator)).join(separator);
}

/** Writes records back: untouched ones as they were read. */
export function writeCsv(recordList: readonly CsvRecord[]): string {
	return recordList.map((record) => record.text ?? recordText(record.cellList)).join('\n');
}

/** Pasted text → rows: tab-separated (a spreadsheet's copy) when it has tabs, otherwise CSV. */
export function parsePasted(text: string): string[][] {
	const separator = text.includes('\t') ? '\t' : ',';
	return parseCsv(text.replace(/\n+$/, ''), separator).map((record) => record.cellList);
}

/** Rows → tab-separated text, for a spreadsheet's paste. */
export function writeTsv(rowList: readonly (readonly string[])[]): string {
	return rowList.map((cellList) => cellList.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join('\t')).join('\n');
}
