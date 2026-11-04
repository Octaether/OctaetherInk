import { describe, expect, it } from 'vitest';
import { readWorkbook, sheetGrid, writeSheet } from '../src/xlsx';
import { type ZipEntry, crc32, entryText, readZip, writeZip } from '../src/zip';

const serial = (text: string): number => Date.parse(`${text}T00:00:00Z`) / 86_400_000 + 25569;

/** A small workbook as Excel writes one: shared strings, a date style, a bold style, two sheets, a calcChain. */
function workbook(): Uint8Array {
	const part: Record<string, string> = {
		'[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
		'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
		'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="calcChain.xml"/></Relationships>',
		'xl/styles.xml': '<?xml version="1.0"?><styleSheet><fonts count="2"><font/><font><b/></font></fonts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="0" fontId="1"/></cellXfs></styleSheet>',
		'xl/sharedStrings.xml': '<?xml version="1.0"?><sst><si><t>Date</t></si><si><t>Item</t></si><si><t>Amount</t></si><si><r><t>Fo</t></r><r><t>od</t></r></si><si><t>Bus &amp; train</t></si></sst>',
		'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><dimension ref="A1:C3"/><sheetData><row r="1" spans="1:3"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" s="2" t="s"><v>1</v></c><c r="C1" s="2" t="s"><v>2</v></c></row><row r="2"><c r="A2" s="1"><v>${serial('2026-11-01')}</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>12.5</v></c></row><row r="3"><c r="A3" s="1"><v>${serial('2026-11-02')}</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><f>C2/5+0.5</f><v>3</v></c></row></sheetData><pageMargins left="0.7"/></worksheet>`,
		'xl/worksheets/sheet2.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>Hello</t></is></c><c r="C2" t="b"><v>1</v></c></row></sheetData></worksheet>',
		'xl/calcChain.xml': '<?xml version="1.0"?><calcChain><c r="C3" i="1"/></calcChain>',
	};
	const encoder = new TextEncoder();
	const entryList: ZipEntry[] = Object.entries(part).map(([name, text]) => {
		const raw = encoder.encode(text);
		return { name, method: 0, crc: crc32(raw), size: raw.length, raw, time: 0, date: 33 };
	});
	return writeZip(entryList);
}

describe('Excel workbooks', () => {
	it('reads a sheet: shared and rich strings, dates, numbers, formulas', async () => {
		const book = await readWorkbook(workbook());
		expect(book.sheetList.map((sheet) => sheet.name)).toEqual(['Data', 'Other']);
		const grid = (await sheetGrid(book))!;
		expect(grid.rowList).toEqual([
			['Date', 'Item', 'Amount'],
			['2026-11-01', 'Food', '12.5'],
			['2026-11-02', 'Bus & train', '3'],
		]);
		expect((await sheetGrid(book, 'Other'))!.rowList).toEqual([['Hello', 'True']]);
	});

	it('writes only the changed cells, keeping their style and the rest of the file', async () => {
		const bytes = workbook();
		const book = await readWorkbook(bytes);
		const grid = (await sheetGrid(book))!;
		const after = [...grid.rowList.map((row) => [...row]), ['2026-11-03', 'Book', '20']];
		after[1]![2] = '14';
		after[2]![1] = 'Bus';
		const written = await writeSheet(book, grid, after);
		const again = await readWorkbook(written);
		expect((await sheetGrid(again))!.rowList).toEqual(after);
		const entryOf = (list: ZipEntry[], name: string): ZipEntry => list.find((entry) => entry.name === name)!;
		const before = readZip(bytes);
		const now = readZip(written);
		// untouched parts are copied byte for byte
		for (const name of ['xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet2.xml']) expect(entryOf(now, name).raw).toEqual(entryOf(before, name).raw);
		const sheet = await entryText(entryOf(now, 'xl/worksheets/sheet1.xml'));
		// the header row is untouched, the new row's date takes the style above, an edited cell keeps none it didn't have
		expect(sheet).toContain('<row r="1" spans="1:3"><c r="A1" s="2" t="s"><v>0</v></c>');
		expect(sheet).toContain(`<c r="A4" s="1"><v>${serial('2026-11-03')}</v></c>`);
		expect(sheet).toContain('<c r="C2"><v>14</v></c>');
		expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">Bus</t></is></c>');
		// the formula nobody changed stays
		expect(sheet).toContain('<f>C2/5+0.5</f>');
		expect(sheet).toContain('<dimension ref="A1:C4"/>');
		expect(sheet).toContain('<pageMargins left="0.7"/>');
		// Excel works the formulas out again, and the stale calcChain is gone
		expect(await entryText(entryOf(now, 'xl/workbook.xml'))).toContain('<calcPr fullCalcOnLoad="1"/>');
		expect(now.some((entry) => entry.name === 'xl/calcChain.xml')).toBe(false);
		expect(await entryText(entryOf(now, '[Content_Types].xml'))).not.toContain('calcChain');
	});
});
