// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import { type MenuEntry, type NoteIndex, type NoteSummary, type TableData, menuExtension, noteIndexExtension, tableDataExtension } from '@octaether/core-sdk';
import { textModule } from '@octaether/module-text';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv, parsePasted, tableModule, writeCsv, writeTsv } from '../src';
import { formatValue, guessType, numberOf, readTable, setCell, snapshotOf, summarize, viewOf } from '../src/table';
import { withColumnSetting } from '../src/view';

const property = (text: string): Map<string, unknown> => NoteModel.fromText(`Table ${text}:\n\ta\n`).document.itemList[0]!.property;

describe('CSV', () => {
	it('reads quotes, commas, line breaks, and spaces around cells', () => {
		const recordList = parseCsv('Name, Note\n"Smith, J", "said ""hi"""\n"two\nlines",x\n\nlast');
		expect(recordList.map((record) => record.cellList)).toEqual([['Name', 'Note'], ['Smith, J', 'said "hi"'], ['two\nlines', 'x'], ['last']]);
	});

	it('writes untouched rows back exactly as they were', () => {
		const body = 'Date ,  Workout\n2026-11-01,  Legs\n2026-11-02,Push';
		const model = readTable(new Map(), body);
		const next = setCell(model, 2, 1, 'Pull, light');
		expect(next).toBe('Date ,  Workout\n2026-11-01,  Legs\n2026-11-02,"Pull, light"');
		expect(writeCsv(parseCsv(body))).toBe(body);
	});

	it('reads what a spreadsheet copies (tab-separated) and writes it back', () => {
		expect(parsePasted('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
		expect(parsePasted('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
		expect(writeTsv([['x', 'y\tz']])).toBe('x\t"y\tz"');
	});
});

describe('columns', () => {
	it('guesses types from the values', () => {
		expect(guessType(['1', '2.5', '$1,200'])).toBe('Number');
		expect(guessType(['2026-11-01', ''])).toBe('Date');
		expect(guessType(['2026-11-01 09:00'])).toBe('DateTime');
		expect(guessType(['True', 'false'])).toBe('Checkbox');
		expect(guessType(['Legs', 'Push', 'Legs', 'Push', 'Legs'])).toBe('Choice');
		expect(guessType(['Hello there', 'Something else'])).toBe('Text');
		expect(numberOf('$1,200.50')).toBe(1200.5);
		expect(numberOf('15%')).toBe(0.15);
		expect(numberOf('72.4 kg')).toBe(72.4);
	});

	it('shows units, currency, and dates', () => {
		const model = readTable(property('{Column: {Calorie: {Unit: kcal}, Amount: {Unit: $}}}') as never, 'Date,Calorie,Amount\n2026-11-04,1200,3.5');
		const [date, calorie, amount] = model.columnList;
		const { valueOf, rowList } = viewOf(model);
		const valueList = valueOf(rowList[0]!);
		expect(formatValue(date!, valueList[0])).toBe('Nov 4, 2026');
		expect(formatValue(calorie!, valueList[1])).toBe('1,200 kcal');
		expect(formatValue(amount!, valueList[2])).toBe('$3.50');
	});
});

describe('formulas, filters, sorting, groups, and summaries', () => {
	const body = 'Date,Workout,Calorie,Burned\n2026-11-01,Legs,2100,520\n2026-11-03,Push,1980,410\n2026-11-20,Legs,2200,\n2026-10-30,Pull,1900,300';

	it('works out formula columns, empty numbers counting as 0', () => {
		const model = readTable(property('{Column: {Net: {Formula: "Calorie - Burned"}}}') as never, body);
		expect(model.columnList.map((column) => column.name)).toEqual(['Date', 'Workout', 'Calorie', 'Burned', 'Net']);
		const { rowList, valueOf } = viewOf(model);
		expect(rowList.map((row) => valueOf(row)[4])).toEqual([1580, 1570, 2200, 1600]);
	});

	it('filters and sorts', () => {
		const model = readTable(property('{Filter: "Calorie > 1950 and Workout = Legs", Sort: {Calorie: Down}}') as never, body);
		const { rowList, valueOf } = viewOf(model);
		expect(rowList.map((row) => valueOf(row)[2])).toEqual([2200, 2100]);
	});

	it('groups dates by month, newest last', () => {
		const model = readTable(property('{Group: {Date: Month}}') as never, body);
		const { groupList } = viewOf(model);
		expect(groupList!.map((group) => `${group.label}: ${group.rowList.length}`)).toEqual(['October 2026: 1', 'November 2026: 3']);
	});

	it('summarizes a column', () => {
		const model = readTable(new Map(), body);
		const { rowList, valueOf } = viewOf(model);
		const calorie = rowList.map((row) => valueOf(row)[2]);
		expect(summarize('Sum', calorie)).toBe(8180);
		expect(summarize('Average', calorie)).toBe(2045);
		expect(summarize('Median', calorie)).toBe(2040);
		expect(summarize('Empty', rowList.map((row) => valueOf(row)[3]))).toBe(1);
		expect(summarize('Unique', rowList.map((row) => valueOf(row)[1]))).toBe(3);
	});

	it('gives Plot and Calendar typed columns after the filter', () => {
		const snapshot = snapshotOf(readTable(property('{Filter: "Workout = Legs"}') as never, body));
		expect(snapshot.rowCount).toBe(2);
		expect(snapshot.columnList[0]).toMatchObject({ name: 'Date', type: 'Date' });
		expect(snapshot.columnList[2]!.valueList).toEqual([2100, 2200]);
	});
});

describe('tables of notes', () => {
	it('lists the notes of a folder or tag, with their properties as columns', () => {
		const noteList: NoteSummary[] = [
			{ path: 'Gym/Monday.oi', name: 'Monday', folder: 'Gym', property: new Map<string, never>([['Calorie', 500 as never], ['Tag', ['Gym'] as never]]), tagList: ['Gym'] },
			{ path: 'Gym/Wednesday.oi', name: 'Wednesday', folder: 'Gym', property: new Map([['Calorie', 450 as never]]), tagList: [] },
			{ path: 'Other.oi', name: 'Other', folder: '', property: new Map(), tagList: ['Gym'] },
		];
		const folder = readTable(new Map([['Source', 'Gym/']]), '', noteList);
		expect(folder.kind).toBe('Note');
		expect(folder.columnList.map((column) => `${column.name}:${column.type}`)).toEqual(['Name:Link', 'Calorie:Number', 'Tag:Text']);
		expect(folder.rowList.map((row) => row.path)).toEqual(['Gym/Monday.oi', 'Gym/Wednesday.oi']);
		expect(readTable(new Map([['Source', 'tag:Gym']]), '', noteList).rowList.map((row) => row.path)).toEqual(['Gym/Monday.oi', 'Other.oi']);
	});
});

describe('the Column setting', () => {
	it('changes one setting of one column', () => {
		const map = withColumnSetting(undefined, 'Calorie', 'Unit', 'kcal')!;
		expect(map.get('Calorie')).toEqual(new Map([['Unit', 'kcal']]));
		expect(withColumnSetting(map, 'Calorie', 'Unit', undefined)).toBeUndefined();
	});
});

describe('the Table block', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mount(text: string) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		const menuList: MenuEntry[][] = [];
		registry.registerExtension(menuExtension, { open: ({ itemList }: { itemList: MenuEntry[] }) => menuList.push(itemList), close: () => undefined, prompt: async () => undefined });
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		// the view loads on first use
		for (let tries = 0; tries < 50 && !document.querySelector('.oi-table'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, registry, menuList, root: document.querySelector<HTMLElement>('.oi-table')! };
	}

	const pointer = (element: Element, type: string): void => {
		element.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
	};

	it('draws a grid with typed cells and a summary', async () => {
		const { root } = await mount('Table {Column: {Calorie: {Summary: Sum, Unit: kcal}}}:\n\tDate,Workout,Calorie\n\t2026-11-01,Legs,500\n\t2026-11-02,Push,400\n');
		expect([...root.querySelectorAll('th .oi-table-name')].map((element) => element.textContent)).toEqual(['Date', 'Workout', 'Calorie']);
		expect(root.querySelector('td[data-row="0"][data-column="2"]')!.textContent).toBe('500 kcal');
		expect(root.querySelector('.oi-table-footer')!.textContent).toContain('900 kcal');
	});

	it('writes a typed cell into the CSV, and Enter moves down', async () => {
		const { model, root } = await mount('Table:\n\tName,Number\n\ta,1\n\tb,2\n');
		const cell = root.querySelector('td[data-row="0"][data-column="1"]')!;
		pointer(cell, 'pointerdown');
		pointer(cell, 'pointerup');
		const input = root.querySelector<HTMLInputElement>('input[data-field="cell"]')!;
		input.value = '42';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(model.document.itemList[0]!.body).toBe('Name,Number\na,42\nb,2');
		// the editor moved to the next row
		expect(document.querySelector('td.oi-table-editing')?.getAttribute('data-row')).toBe('1');
	});

	it('pastes a block from a spreadsheet at the selected cell, growing the table', async () => {
		const { model, root } = await mount('Table:\n\tName,Number\n\ta,1\n');
		const cell = root.querySelector('td[data-row="0"][data-column="0"]')!;
		pointer(cell, 'pointerdown');
		const event = new Event('paste', { bubbles: true }) as ClipboardEvent;
		Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'x\t7\ny\t8\n' } });
		cell.dispatchEvent(event);
		expect(model.document.itemList[0]!.body).toBe('Name,Number\nx,7\ny,8');
	});

	it('opens a column menu that sorts', async () => {
		const { model, root, menuList } = await mount('Table:\n\tName,Number\n\ta,1\n\tb,2\n');
		(root.querySelector('[data-action="Header"][data-column="1"]') as HTMLElement).click();
		const sort = menuList[0]!.find((item) => item.title === 'Sort descending')!;
		sort.run!();
		expect(model.document.itemList[0]!.property.get('Sort')).toEqual(new Map([['Number', 'Down']]));
		const root2 = document.querySelector('.oi-table')!;
		expect([...root2.querySelectorAll('td[data-column="0"]')].map((element) => element.textContent)).toEqual(['b', 'a']);
	});

	it('duplicates a row with the same name (no "(1)")', async () => {
		const { model, root, menuList } = await mount('Table:\n\tName,Number\n\tRun,1\n');
		(root.querySelector('[data-action="RowHandle"]') as HTMLElement).click();
		menuList[0]!.find((item) => item.title === 'Duplicate')!.run!();
		expect(model.document.itemList[0]!.body).toBe('Name,Number\nRun,1\nRun,1');
	});

	it('shows a Board with lanes by a Choice column, and the view choice is saved', async () => {
		const { model, root } = await mount('Table {Column: {Status: {Type: Choice, Choice: [To do, Done]}}}:\n\tTask,Status\n\tWash,To do\n\tCook,Done\n');
		(root.querySelector('[data-show="Board"]') as HTMLElement).click();
		expect(model.document.itemList[0]!.property.get('Show')).toBe('Board');
		const lane = [...document.querySelectorAll<HTMLElement>('.oi-table-lane')].map((element) => `${element.dataset.lane}:${element.querySelectorAll('.oi-table-card').length}`);
		expect(lane).toEqual(['To do:1', 'Done:1']);
	});

	it('reads tables for other blocks by their title', async () => {
		const { registry, model } = await mount('Table {Title: Gym log}:\n\tDate,Weight\n\t2026-11-01,72\n\t2026-11-02,71.5\n');
		const data = registry.extension<TableData>(tableDataExtension)!;
		const context = { note: model, extension: (name: string) => registry.extension(name) } as never;
		const snapshot = await data.read(context, 'gym LOG');
		expect(snapshot?.columnList[1]!.valueList).toEqual([72, 71.5]);
		expect(await data.read(context, 'None')).toBeUndefined();
	});
});

describe('tables in files and in other notes', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mountWith(text: string, fileMap: Record<string, string>, other?: NoteModel) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		const menuList: MenuEntry[][] = [];
		registry.registerExtension(menuExtension, { open: ({ itemList }: { itemList: MenuEntry[] }) => menuList.push(itemList), close: () => undefined, prompt: async () => undefined });
		const written: Record<string, string> = {};
		const index: Partial<NoteIndex> = {
			noteList: () => [],
			pathOf: () => 'Log.oi',
			subscribe: () => () => undefined,
			resolve: (target) => (target === 'Gym' ? 'Gym.oi' : undefined),
			modelOf: async (path) => (path === 'Gym.oi' ? other : undefined),
			findFile: (source) => (source in fileMap ? source : undefined),
			readFile: async (path) => new Blob([fileMap[path] ?? '']),
			writeFile: async (path, data) => {
				written[path] = typeof data === 'string' ? data : await data.text();
			},
			createFile: async (folder, name, data) => {
				written[name] = String(data);
				return name;
			},
		};
		registry.registerExtension(noteIndexExtension, index);
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 80 && !document.querySelector('.oi-table-grid'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, menuList, written, root: document.querySelector<HTMLElement>('.oi-table')! };
	}

	const typeInto = (root: HTMLElement, row: number, column: number, value: string): void => {
		const cell = root.querySelector(`td[data-row="${row}"][data-column="${column}"]`)!;
		cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
		cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
		const input = root.querySelector<HTMLInputElement>('input[data-field="cell"]')!;
		input.value = value;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	};

	it('shows a CSV file and writes an edit into it, line endings kept', async () => {
		const { root, written, model } = await mountWith('Table {Column: {Weight: {Unit: kg}}}: Gym.csv\n', { 'Gym.csv': 'Date,Weight\r\n2026-11-01,72\r\n' });
		expect(model.document.itemList[0]!.property.get('File')).toBe('Gym.csv');
		expect(root.querySelector('td[data-row="0"][data-column="1"]')!.textContent).toBe('72 kg');
		typeInto(root, 0, 1, '71.5');
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(written['Gym.csv']).toBe('Date,Weight\r\n2026-11-01,71.5');
		// the note keeps only the view
		expect(model.document.itemList[0]!.body).toBe('');
	});

	it('moves a table to a CSV file, and the table then shows the file', async () => {
		const { root, written, model, menuList } = await mountWith('Table:\n\tName,Number\n\ta,1\n', {});
		(root.querySelector('[data-action="More"]') as HTMLElement).click();
		menuList[0]!.find((item) => item.title === 'Move to a CSV file')!.run!();
		const input = root.querySelector<HTMLInputElement>('[data-field="ask"]')!;
		input.value = 'Numbers';
		root.querySelector<HTMLElement>('[data-action="AskDone"]')!.click();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(written['Numbers.csv']).toBe('Name,Number\na,1\n');
		expect(model.document.itemList[0]!.property.get('File')).toBe('Numbers.csv');
		expect(model.document.itemList[0]!.body).toBe('');
	});

	it('shows the Table of another note (From) and edits it there', async () => {
		const other = NoteModel.fromText('Table:\n\tName,Number\n\ta,1\n');
		const { root, model } = await mountWith('Table {From: "[[Gym]]"}:\n', {}, other);
		expect(root.querySelector('td[data-row="0"][data-column="0"]')!.textContent).toBe('a');
		typeInto(root, 0, 1, '5');
		expect(other.document.itemList[0]!.body).toBe('Name,Number\na,5');
		expect(model.document.itemList[0]!.body).toBe('');
	});
});

describe('titles, choices, and plotting a table', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mountMenu(text: string) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(tableModule, true);
		const menuList: MenuEntry[][] = [];
		registry.registerExtension(menuExtension, { open: ({ itemList }: { itemList: MenuEntry[] }) => menuList.push(itemList), close: () => undefined, prompt: async () => undefined });
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 60 && !document.querySelector('.oi-table-bar'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, menuList, registry, root: document.querySelector<HTMLElement>('.oi-table')! };
	}

	it('finds a table by its title for other blocks', async () => {
		const { model, registry, root } = await mountMenu('Table {Title: Gym log}:\n\tDate,Weight\n\t2026-11-01,72\n');
		expect(root.querySelector('.oi-table-title')!.textContent).toBe('Gym log');
		const context = { note: model, extension: (name: string) => registry.extension(name) } as never;
		const data = registry.extension<TableData>(tableDataExtension)!;
		expect((await data.read(context, 'gym LOG'))?.columnList[1]!.valueList).toEqual([72]);
	});

	it('picks a choice from a menu, adds one, and colors it', async () => {
		const { model, menuList, root } = await mountMenu('Table {Column: {Status: {Type: Choice, Choice: [To do, Done]}}}:\n\tTask,Status\n\tWash,To do\n');
		const cell = root.querySelector('td[data-row="0"][data-column="1"]')!;
		cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1 }));
		cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
		const menu = menuList.at(-1)!;
		expect(menu.map((item) => `${item.title}${item.checked ? ' ✓' : ''}`)).toEqual(['To do ✓', 'Done', 'New choice', 'Clear', 'Edit choices']);
		menu.find((item) => item.title === 'Done')!.run!();
		expect(model.document.itemList[0]!.body).toBe('Task,Status\nWash,Done');
	});

	it('plots itself: a Plot below, finding it by its title', async () => {
		const { model, menuList, root } = await mountMenu('Table {Title: Gym log}:\n\tDate,Weight\n\t2026-11-01,72\n');
		(root.querySelector('[data-action="More"]') as HTMLElement).click();
		menuList.at(-1)!.find((item) => item.title === 'Plot this table')!.run!();
		const plot = model.document.itemList[1]!;
		expect(plot.type).toBe('Plot');
		expect(plot.property.get('Data')).toBe('Gym log');
		expect(plot.body).toBe('(Date, Weight) {Kind: Line}');
	});
});
