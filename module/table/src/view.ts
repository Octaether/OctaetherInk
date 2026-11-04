// The Table block on the page: a grid you type into (like a spreadsheet), or the same rows as a
// Board (lanes by a column), a Gallery (cards), or a List. Loaded the first time a table shows.
//
//   cells    click to type; Enter/Tab/arrows move; drag across cells to select (Count, Sum, Average
//            show below); Delete clears; Ctrl+C copies, Ctrl+V pastes (tab-separated from a
//            spreadsheet, or CSV); a checkbox toggles with a click
//   header   click: rename, type, sort, filter, group, summary, unit, hide, insert, move, delete, Analyze
//   rows     the handle on the left drags a row, or opens its menu; "New" adds one
//   footer   a summary per column (sum, average, …), changed with a click

import { type BlockNode, type PropertyMap, type PropertyValue, formatInline } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import {
	type ColorPicker,
	type LinkedBlock,
	type MenuEntry,
	type NoteIndex,
	type PopupMenu,
	type RenderContext,
	type Renderer,
	type ResolvedBlock,
	type TableCell,
	colorPickerExtension,
	escapeHtml,
	linkedBlock,
	linkedProperty,
	menuExtension,
	noteIndexExtension, installStyle } from '@octaether/core-sdk';
import { parseCsv, parsePasted, recordText, writeCsv, writeTsv } from './csv';
import { type SheetGrid, type Workbook, readWorkbook, sheetGrid, writeSheet } from './xlsx';
import {
	type ColumnInfo,
	type ColumnType,
	type Period,
	type Row,
	type Show,
	type Summary,
	type TableModel,
	cellValue,
	columnTypeList,
	formatValue,
	insertColumn,
	moveColumn,
	pasteCell,
	periodList,
	propertyValueOf,
	readTable,
	removeColumn,
	rewriteRecord,
	setCell,
	showList,
	statisticsOf,
	summarize,
	summaryChoiceList,
	summaryText,
	summaryTitle,
	viewOf,
	writtenOf,
} from './table';
import { tableStyle } from './style';

interface Place {
	/** Position in the rows shown. */
	row: number;
	/** Position among the columns shown. */
	column: number;
}

const svg = (body: string, size = 14): string =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const typeIcon: Readonly<Record<ColumnType, string>> = {
	Text: svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
	Number: svg('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
	Date: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
	DateTime: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
	Checkbox: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>'),
	Choice: svg('<circle cx="12" cy="12" r="9"/><path d="m8 11 4 4 4-4"/>'),
	List: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
	Link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
	Formula: svg('<path d="M9 19c2 0 2-14 4-14h3M7 11h8"/>'),
};
const plusMark = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const crossMark = '<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const moreMark = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';
const handleMark = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>';

const typeTitle: Readonly<Record<ColumnType, string>> = { Text: 'Text', Number: 'Number', Date: 'Date', DateTime: 'Date and time', Checkbox: 'Checkbox', Choice: 'Choice', List: 'List', Link: 'Link', Formula: 'Formula' };

/** A Column map with one setting of one column changed (undefined removes it; an empty column's entry goes). */
export function withColumnSetting(columnMap: PropertyValue | undefined, name: string, key: string, value: PropertyValue | undefined): PropertyMap | undefined {
	const map = new Map(columnMap instanceof Map ? columnMap : []);
	const own = new Map(map.get(name) instanceof Map ? (map.get(name) as PropertyMap) : []);
	if (value === undefined) own.delete(key);
	else own.set(key, value);
	if (own.size) map.set(name, own);
	else map.delete(name);
	return map.size ? map : undefined;
}

class TableView {
	private readonly root: HTMLElement;
	private model!: TableModel;
	/** The rows shown, in order, with their values. */
	private shownRowList: Row[] = [];
	private valueOf: (row: Row) => TableCell[] = () => [];
	/** Columns shown (not hidden), by their index in the model. */
	private shownColumnList: number[] = [];
	private search = '';
	private selection: { anchor: Place; focus: Place } | undefined;
	private editing: Place | undefined;
	/** Show every row, past `Table.MaxRow`. */
	private showAll = false;
	private sourceOpen = false;
	private ask: { label: string; value: string; placeholder?: string; onDone(value: string): void } | undefined;
	private analyze: number | undefined;
	private rowForm: Row | undefined;
	/** In the Read view (or before a vault), the view choice stays on screen only. */
	private localShow: Show | undefined;
	private press: { place: Place; pointerId: number; moved: boolean } | undefined;
	private rowDrag: { row: Row; pointerId: number; startY: number; moving: boolean; target: number } | undefined;
	private cardDrag: { row: Row; pointerId: number; startX: number; startY: number; moving: boolean; ghost?: HTMLElement } | undefined;
	private swallowClick = false;
	private unsubscribeIndex: (() => void) | undefined;
	/** With From: the Table in another note that holds the rows (its note's live model). */
	private linked: LinkedBlock | undefined;
	private linkedFrom: string | undefined;
	private linkState: 'Loading' | 'Ready' | 'Missing' = 'Ready';
	private unsubscribeLinked: (() => void) | undefined;
	/** With File: the data file the rows live in (a .csv, a .tsv, or a sheet of an .xlsx). */
	private data: DataFile | undefined;
	private dataWrite: Promise<void> = Promise.resolve();
	private readonly onDocumentKey = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && (this.analyze !== undefined || this.rowForm)) {
			this.analyze = undefined;
			this.rowForm = undefined;
			this.render();
		}
	};

	constructor(
		readonly frame: HTMLElement,
		private block: ResolvedBlock,
		private context: RenderContext,
	) {
		this.root = document.createElement('div');
		this.root.className = 'oi-table';
		this.root.dataset.oiInteractive = '';
		this.root.tabIndex = -1;
		frame.append(this.root);
		this.bind();
		document.addEventListener('keydown', this.onDocumentKey);
		this.watchIndex();
		this.render();
	}

	update(block: ResolvedBlock, context: RenderContext): void {
		this.block = block;
		this.context = context;
		this.watchIndex();
		this.render();
	}

	destroy(): void {
		this.unsubscribeIndex?.();
		this.unsubscribeLinked?.();
		document.removeEventListener('keydown', this.onDocumentKey);
		this.menu()?.close();
		this.root.remove();
	}

	private index(): NoteIndex | undefined {
		return this.context.extension<NoteIndex>(noteIndexExtension);
	}

	private menu(): PopupMenu | undefined {
		return this.context.extension<PopupMenu>(menuExtension);
	}

	/** A table of notes follows the vault; one from another note follows that note (opened in a tab, its model changes). */
	private watchIndex(): void {
		const wanted = this.block.property.get('Source') !== undefined || this.from() !== undefined;
		if (wanted && !this.unsubscribeIndex)
			this.unsubscribeIndex = this.index()?.subscribe(() => {
				if (this.from()) this.relink();
				else this.render();
			});
		else if (!wanted && this.unsubscribeIndex) {
			this.unsubscribeIndex();
			this.unsubscribeIndex = undefined;
		}
	}

	private readOnly(): boolean {
		return this.context.readOnly();
	}

	private show(): Show {
		return this.localShow ?? this.model.show;
	}

	// ------------------------------------------------------------ writing

	/** `Table: Data/Gym.csv` (or `File`): the rows live in that file. */
	private file(): string | undefined {
		const value = this.block.property.get('File');
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	}

	private sheetName(): string | undefined {
		const value = this.block.property.get('Sheet');
		return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
	}

	/** Reads the file (again): its rows become the table's CSV, as for one in the note. */
	private loadFile(): void {
		const source = this.file();
		const sheet = this.sheetName();
		const index = this.index();
		if (!source) {
			this.data = undefined;
			return;
		}
		const key = `${source}|${sheet ?? ''}`;
		const path = index?.findFile(source, index.pathOf(this.context.note));
		this.data = { key, source, path, kind: kindOf(source), body: '', crlf: false, status: 'Loading', message: undefined, book: undefined, grid: undefined };
		const data = this.data;
		if (!index || !path) {
			data.status = 'Missing';
			return;
		}
		void readDataFile(index, path, data.kind, sheet).then(
			(read) => {
				if (this.data !== data) return;
				Object.assign(data, read, { status: 'Ready' });
				this.render();
			},
			(error: unknown) => {
				if (this.data !== data) return;
				data.status = 'Error';
				data.message = error instanceof Error ? error.message : String(error);
				this.render();
			},
		);
	}

	/** Writes the rows into the file (in order, one write after another). */
	private writeFile(body: string): void {
		const data = this.data;
		const index = this.index();
		if (!data || !data.path || !index || data.status !== 'Ready') return;
		data.body = body;
		this.render();
		const path = data.path;
		this.dataWrite = this.dataWrite
			.then(async () => {
				if (data.kind === 'Csv') await index.writeFile(path, data.crlf ? body.replace(/\n/g, '\r\n') : body);
				else if (data.kind === 'Tsv') await index.writeFile(path, writeTsv(parseCsv(body).map((record) => record.cellList)) + (data.crlf ? '\r\n' : '\n'));
				else if (data.book && data.grid) {
					const after = parseCsv(body).map((record) => record.cellList);
					const bytes = await writeSheet(data.book, data.grid, after);
					await index.writeFile(path, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
					const read = await readDataFile(index, path, 'Xlsx', this.sheetName());
					if (this.data === data) Object.assign(data, { book: read.book, grid: read.grid });
				}
			})
			.catch((error: unknown) => {
				data.message = `Couldn’t write ${data.source}: ${error instanceof Error ? error.message : String(error)}`;
				this.render();
			});
	}

	/** `From: "[[Gym]]"`: the rows live in that note's Table. */
	private from(): string | undefined {
		const value = this.block.property.get('From');
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	}

	private linkedNode(): BlockNode | undefined {
		return this.linked ? this.linked.model.get(this.linked.key) : undefined;
	}

	/** The table's title: what plots and other notes find it by. */
	private title(): string | undefined {
		const value = this.property().get('Title');
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	}

	/** A choice's own color (from Column → ChoiceColor), as CSS. */
	private choiceColor(column: ColumnInfo, choice: string): string | undefined {
		const own = this.property().get('Column');
		const setting = own instanceof Map ? own.get(column.name) : undefined;
		const map = setting instanceof Map ? setting.get('ChoiceColor') : undefined;
		if (!(map instanceof Map)) return undefined;
		const entry = [...map].find(([key]) => key.toLowerCase() === choice.toLowerCase())?.[1];
		return typeof entry === 'string' ? (this.context.resolveColor(entry) ?? undefined) : undefined;
	}

	private pillHtml(column: ColumnInfo, choice: string): string {
		const color = this.choiceColor(column, choice);
		if (color) return `<span class="oi-table-pill oi-table-pill-own" style="--oi-pill:${escapeHtml(color)}">${escapeHtml(choice)}</span>`;
		return `<span class="oi-table-pill" data-hue="${hueOf(column.choiceList, choice)}">${escapeHtml(choice)}</span>`;
	}

	/** The choices for one cell: a click picks one (a List toggles it); new ones can be added. */
	private choiceMenu(row: Row, columnIndex: number, rect: DOMRect): void {
		const column = this.model.columnList[columnIndex]!;
		const current = cellValue(column.type, row.cellList[column.index] ?? '');
		const list = Array.isArray(current) ? [...current] : current === undefined ? [] : [String(current)];
		const has = (choice: string): boolean => list.some((item) => item.toLowerCase() === choice.toLowerCase());
		const write = (next: string[]): void => this.writeCell(row, columnIndex, next.join(', '));
		const itemList: MenuEntry[] = column.choiceList.map((choice) => ({
			title: choice,
			checked: has(choice),
			run: () => {
				if (column.type === 'List') write(has(choice) ? list.filter((item) => item.toLowerCase() !== choice.toLowerCase()) : [...list, choice]);
				else write(has(choice) ? [] : [choice]);
			},
		}));
		itemList.push({
			title: 'New choice',
			separatorBefore: true,
			run: () =>
				this.askFor(`New choice for ${column.name}`, '', (name) => {
					const clean = name.trim();
					if (!clean) return;
					this.noteModel().transact(() => {
						if (!column.choiceList.some((item) => item.toLowerCase() === clean.toLowerCase())) this.setColumn(column.name, 'Choice', [...column.choiceList, clean]);
						write(column.type === 'List' ? [...list, clean] : [clean]);
					});
				}),
		});
		if (list.length) itemList.push({ title: 'Clear', run: () => write([]) });
		itemList.push({ title: 'Edit choices', childList: this.choiceEntryList(column, rect) });
		this.openMenu(rect, itemList);
	}

	/** Each choice of a column (color, rename, move, delete), and a new one. */
	private choiceEntryList(column: ColumnInfo, rect: DOMRect): MenuEntry[] {
		const picker = this.context.extension<ColorPicker>(colorPickerExtension);
		const choiceList = [...column.choiceList];
		const colorMap = (): Map<string, PropertyValue> => {
			const own = this.property().get('Column');
			const setting = own instanceof Map ? own.get(column.name) : undefined;
			const map = setting instanceof Map ? setting.get('ChoiceColor') : undefined;
			return new Map(map instanceof Map ? map : []);
		};
		const move = (from: number, to: number): void => {
			const list = [...choiceList];
			const [item] = list.splice(from, 1);
			list.splice(to, 0, item!);
			this.setColumn(column.name, 'Choice', list);
		};
		const entryList: MenuEntry[] = choiceList.map((choice, index) => ({
			title: choice,
			childList: [
				...(picker
					? [
							{
								title: 'Color',
								run: () =>
									picker.open({
										x: rect.left,
										y: rect.bottom + 4,
										title: choice,
										onPick: (color: string | undefined) => {
											const map = colorMap();
											if (color) map.set(choice, color);
											else map.delete(choice);
											this.setColumn(column.name, 'ChoiceColor', map.size ? map : undefined);
										},
									}),
							},
						]
					: []),
				{ title: 'Rename', run: () => this.askFor(`Rename ${choice}`, choice, (name) => this.renameChoice(column, choice, name.trim())) },
				...(index > 0 ? [{ title: 'Move up', run: () => move(index, index - 1) }] : []),
				...(index < choiceList.length - 1 ? [{ title: 'Move down', run: () => move(index, index + 1) }] : []),
				{ title: 'Delete', danger: true, explain: 'Cells keep their text', run: () => this.setColumn(column.name, 'Choice', choiceList.filter((item) => item !== choice)) },
			],
		}));
		entryList.push({
			title: 'Add a choice',
			separatorBefore: entryList.length > 0,
			run: () =>
				this.askFor(`New choice for ${column.name}`, '', (name) => {
					const clean = name.trim();
					if (clean && !choiceList.some((item) => item.toLowerCase() === clean.toLowerCase())) this.setColumn(column.name, 'Choice', [...choiceList, clean]);
				}),
		});
		return entryList;
	}

	/** A choice renamed: in the column's choices, its color, and every cell that has it. */
	private renameChoice(column: ColumnInfo, from: string, to: string): void {
		if (!to || to === from) return;
		const same = (item: string): boolean => item.toLowerCase() === from.toLowerCase();
		this.noteModel().transact(() => {
			this.setColumn(column.name, 'Choice', column.choiceList.map((item) => (same(item) ? to : item)));
			const own = this.property().get('Column');
			const setting = own instanceof Map ? own.get(column.name) : undefined;
			const map = setting instanceof Map ? setting.get('ChoiceColor') : undefined;
			if (map instanceof Map && [...map.keys()].some(same)) this.setColumn(column.name, 'ChoiceColor', new Map([...map].map(([key, value]) => [same(key) ? to : key, value])));
			if (this.model.kind === 'Csv' && column.index >= 0) {
				const recordList = this.model.recordList.map((record, index) => {
					if (index === 0) return record;
					const cell = record.cellList[column.index] ?? '';
					const next = cell.split(',').map((part) => (same(part.trim()) ? to : part.trim())).join(', ');
					if (next === cell || cellValue(column.type, cell) === undefined) return record;
					const cellList = [...record.cellList];
					cellList[column.index] = column.type === 'List' ? next : to;
					return { cellList };
				});
				this.setBody(writeCsv(recordList));
			}
		});
	}

	/** A Plot below the table, drawing it by its title (asked for when it has none). */
	private plotTable(): void {
		const insert = (title: string): void => {
			const date = this.model.columnList.find((column) => column.valueType === 'Date' || column.valueType === 'DateTime');
			const number = this.model.columnList.find((column) => column.valueType === 'Number');
			const category = this.model.columnList.find((column) => column.type === 'Choice' || column.type === 'Text');
			const x = date ?? category;
			if (!number || !x) return;
			const name = (column: ColumnInfo): string => column.name.trim().replace(/[^A-Za-z0-9\u0370-\u03ff_]+/g, '_');
			const source = `Plot ${formatInline(new Map([['Data', title]]))}:\n\t(${name(x)}, ${name(number)}) {Kind: ${date ? 'Line' : 'Bar'}}`;
			const note = this.context.note;
			const place = note.placeOf(this.block.key);
			note.transact(() => {
				let after = this.block.key;
				for (const node of note.parseFragment(source)) after = note.insert(place.parentKey, after, node);
			});
		};
		const title = this.title();
		if (title) insert(title);
		else
			this.askFor('A title for this table (the plot finds it by it)', 'Table', (name) => {
				const clean = name.trim();
				if (!clean) return;
				this.context.note.transact(() => {
					this.context.setProperty('Title', clean);
					insert(clean);
				});
			});
	}

	/** The table's properties: its own, or those of the Table it shows with its own on top. */
	private property(): PropertyMap {
		const node = this.linkedNode();
		return node ? linkedProperty(this.block.property, node.property) : this.block.property;
	}

	private body(): string {
		if (this.file()) return this.data?.body ?? '';
		return this.from() ? (this.linkedNode()?.body ?? '') : this.block.body;
	}

	/** The note the rows are in (this one, or the one From names). */
	private noteModel(): NoteModel {
		return this.linked?.model ?? this.context.note;
	}

	private setBody(body: string): void {
		if (body === this.body()) return;
		if (this.file()) {
			this.writeFile(body);
			return;
		}
		if (this.linked && this.linkedNode()) this.linked.model.setBody(this.linked.key, body);
		else if (!this.from()) this.context.setBody(body);
	}

	/** A property goes where it is written: on this block when it says it, otherwise on the Table it shows. */
	private setProperty(name: string, value: PropertyValue | undefined): void {
		if (this.linked && this.linkedNode() && !this.block.property.has(name)) this.linked.model.setProperty(this.linked.key, name, value);
		else this.context.setProperty(name, value);
	}

	private setColumn(name: string, key: string, value: PropertyValue | undefined): void {
		this.setProperty('Column', withColumnSetting(this.property().get('Column'), name, key, value));
	}

	/** Finds the Table that From names again (the note may have opened in a tab, or changed). */
	private relink(): void {
		const from = this.from();
		this.linkedFrom = from;
		if (!from) {
			this.unsubscribeLinked?.();
			this.unsubscribeLinked = undefined;
			this.linked = undefined;
			this.linkState = 'Ready';
			this.render();
			return;
		}
		if (!this.linked) this.linkState = 'Loading';
		void linkedBlock(this.context, from, 'Table').then((linked) => {
			if (this.linkedFrom !== from) return;
			if (linked?.model !== this.linked?.model || linked?.key !== this.linked?.key) {
				this.unsubscribeLinked?.();
				this.unsubscribeLinked = linked?.model.subscribe(() => this.render());
			}
			this.linked = linked;
			this.linkState = linked ? 'Ready' : 'Missing';
			this.render();
		});
	}

	// ------------------------------------------------------------ into and out of a note of its own

	/** The table becomes a note of its own; here, a Table that shows it (From) stays. */
	private moveOut(name: string): void {
		const index = this.index();
		const clean = name.trim();
		if (!index || !clean) return;
		const here = index.pathOf(this.context.note) ?? '';
		const folder = here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : '';
		const id = this.block.id;
		// Full width is how this note shows it: it stays here
		const property: PropertyMap = new Map(this.block.property);
		const wide = property.get('Wide') === true;
		property.delete('Wide');
		const head = `Table${id ? ` ^${id}` : ''}${property.size ? ` ${formatInline(property)}` : ''}:`;
		const source = `${head}${this.block.body ? `\n${this.block.body.split('\n').map((line) => `\t${line}`).join('\n')}` : ''}`;
		void index.createNote({ folder, name: clean, property: new Map(), body: source }).then((path) => {
			if (!path) return;
			const link = path.replace(/\.oi$/, '');
			this.context.replaceWith(`Table${id ? ` ^${id}` : ''} {From: "[[${link}]]"${wide ? ', Wide: True' : ''}}:`);
		});
	}

	/** The rows go to a .csv file next to the note; the table keeps its settings and shows the file. */
	private async moveToFile(name: string): Promise<void> {
		const index = this.index();
		const clean = name.trim().replace(/\.csv$/i, '');
		if (!index || !clean) return;
		const here = index.pathOf(this.context.note) ?? '';
		const folder = here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : '';
		const text = writeCsv(parseCsv(this.block.body).map((record) => ({ cellList: record.cellList })));
		const path = await index.createFile(folder, `${clean}.csv`, `${text}\n`);
		if (!path) return;
		this.context.note.transact(() => {
			this.context.setBody('');
			this.context.setProperty('File', path);
		});
	}

	/** The Table From shows comes into this note; its note goes to the trash (with Undo, and only if you agree). */
	private bringIn(): void {
		const node = this.linkedNode();
		const linked = this.linked;
		if (!node || !linked) return;
		const property = linkedProperty(this.block.property, node.property);
		const id = this.block.id;
		const head = `Table${id ? ` ^${id}` : ''}${property.size ? ` ${formatInline(property)}` : ''}:`;
		const source = `${head}${node.body ? `\n${node.body.split('\n').map((line) => `\t${line}`).join('\n')}` : ''}`;
		this.context.replaceWith(source);
		void this.index()?.trashNote(linked.path);
	}

	private moreMenu(rect: DOMRect): void {
		const itemList: MenuEntry[] = [];
		const index = this.index();
		if (!this.readOnly() && this.model.columnList.some((column) => column.valueType === 'Number')) itemList.push({ title: 'Plot this table', explain: 'A Plot below, drawing it by its title', run: () => this.plotTable() });
		const wide = this.block.property.get('Wide') === true;
		if (!this.readOnly()) itemList.push({ title: 'Full width', checked: wide, explain: 'Wider than the text around it', run: () => this.context.setProperty('Wide', wide ? undefined : true) });
		if (this.data?.path) {
			const path = this.data.path;
			itemList.push({ title: 'Open the file', explain: path, separatorBefore: true, run: () => index?.open(path) });
			if (!this.readOnly() && this.data.status === 'Ready')
				itemList.push({
					title: 'Bring into this note',
					explain: 'The rows are kept here; the file stays as it is',
					run: () =>
						this.context.note.transact(() => {
							this.context.setBody(this.data!.body);
							this.context.setProperty('File', undefined);
							this.context.setProperty('Sheet', undefined);
						}),
				});
		} else if (this.linked) {
			itemList.push({ title: 'Open its note', explain: this.linked.path.replace(/\.oi$/, ''), run: () => index?.open(this.linked!.path) });
			if (!this.readOnly()) itemList.push({ title: 'Bring into this note', explain: 'Its note goes to the trash', run: () => this.bringIn() });
		} else if (index && !this.readOnly() && this.model.kind === 'Csv') {
			itemList.push({
				title: 'Move to a CSV file',
				explain: 'Excel and other apps open it too; this table shows it',
				separatorBefore: true,
				run: () => this.askFor('File name', 'Table', (name) => void this.moveToFile(name)),
			});
			itemList.push({ title: 'Move to its own note', explain: 'This note then shows it from there', run: () => this.askFor('Note name', 'Table', (name) => this.moveOut(name)) });
		}
		if (this.model.kind === 'Csv') itemList.push({ title: this.sourceOpen ? 'Hide the CSV' : 'Show the CSV', run: () => this.toggleSource() });
		this.openMenu(rect, itemList);
	}

	private toggleSource(): void {
		this.sourceOpen = !this.sourceOpen;
		this.render();
		if (this.sourceOpen) this.root.querySelector<HTMLTextAreaElement>('.oi-table-source')?.focus();
	}

	/** Writes a cell: into the CSV, or into the row's note. */
	private writeCell(row: Row, columnIndex: number, text: string): void {
		const column = this.model.columnList[columnIndex];
		if (!column || column.formula !== undefined) return;
		if (this.model.kind === 'Note') {
			if (!row.path || column.name === 'Name') return;
			void this.index()?.setProperty(row.path, new Map([[column.name, propertyValueOf(column, text)]]));
			return;
		}
		this.setBody(setCell(this.model, row.index, column.index, writtenOf(column, text)));
	}

	/** A new row (with some cells set), at the end or after a row. */
	private addRow(cellMap: ReadonlyMap<number, string> = new Map(), after?: Row): void {
		if (this.model.kind === 'Note') {
			const folder = this.noteFolder();
			const index = this.index();
			if (!index || folder === undefined) return;
			const property: PropertyMap = new Map();
			for (const [columnIndex, text] of cellMap) {
				const column = this.model.columnList[columnIndex];
				if (column && column.name !== 'Name') {
					const value = propertyValueOf(column, text);
					if (value !== undefined) property.set(column.name, value);
				}
			}
			void index.createNote({ folder, name: 'Untitled', property }).then((path) => {
				if (path) index.open(path);
			});
			return;
		}
		const width = Math.max(1, this.model.recordList[0]?.cellList.length ?? 1);
		const cellList = Array.from({ length: width }, (_, index) => '');
		for (const [columnIndex, text] of cellMap) {
			const column = this.model.columnList[columnIndex];
			if (column && column.index >= 0) cellList[column.index] = writtenOf(column, text);
		}
		if (this.model.recordList.length === 0) {
			this.setBody(rewriteRecord({ ...this.model, recordList: [] }, [['Name'], cellList]));
			return;
		}
		const order: (number | readonly string[])[] = this.model.recordList.map((_, index) => index);
		order.splice(after ? after.index + 1 : order.length, 0, cellList);
		this.setBody(rewriteRecord(this.model, order));
	}

	/** Where a table of notes makes new notes: its Source folder. */
	private noteFolder(): string | undefined {
		const source = this.model.source ?? '';
		const first = source.split(',')[0]!.trim();
		if (first.startsWith('tag:')) return '';
		return first.replace(/^\/+|\/+$/g, '');
	}

	// ------------------------------------------------------------ drawing

	private render(): void {
		const focus = document.activeElement;
		const refocus = focus && this.root.contains(focus) && focus instanceof HTMLInputElement ? { field: focus.dataset.field, start: focus.selectionStart, end: focus.selectionEnd } : undefined;
		if (this.from() !== this.linkedFrom) this.relink();
		if (this.from() && this.linkState !== 'Ready') {
			this.root.innerHTML =
				this.linkState === 'Loading'
					? '<p class="oi-table-empty">Loading the table…</p>'
					: `<p class="oi-table-empty" data-oi-problem>No table in ${escapeHtml(this.from()!)}: the note may have been renamed or moved, or holds no Table.</p>`;
			return;
		}
		const fileKey = this.file() ? `${this.file()}|${this.sheetName() ?? ''}` : undefined;
		if (fileKey !== this.data?.key) this.loadFile();
		if (this.data && this.data.status !== 'Ready') {
			const message =
				this.data.status === 'Loading'
					? `Reading ${escapeHtml(this.data.source)}…`
					: this.data.status === 'Missing'
						? `${escapeHtml(this.data.source)} is not in the vault.`
						: `Couldn’t read ${escapeHtml(this.data.source)}: ${escapeHtml(this.data.message ?? '')}`;
			this.root.innerHTML = `<p class="oi-table-empty"${this.data.status === 'Loading' ? '' : ' data-oi-problem'}>${message}</p>`;
			return;
		}
		const property = this.property();
		const noteList = property.get('Source') !== undefined ? (this.index()?.noteList() ?? []) : [];
		this.model = readTable(property, this.body(), noteList, this.linked?.path ?? this.index()?.pathOf(this.context.note));
		const view = viewOf(this.model, this.search);
		this.shownRowList = view.rowList;
		this.valueOf = view.valueOf;
		this.shownColumnList = this.model.columnList.map((column, index) => (column.hidden ? -1 : index)).filter((index) => index >= 0);
		const show = this.show();
		this.root.dataset.show = show;
		let html = this.barHtml(view.problem);
		if (this.model.columnList.length === 0 && this.model.kind === 'Csv') html += this.emptyHtml();
		else if (show === 'Table') html += this.gridHtml(view.groupList);
		else html += this.cardHtml(show);
		html += `<div class="oi-table-status" aria-live="polite"></div>`;
		if (this.sourceOpen) html += `<textarea class="oi-table-source" data-field="source" spellcheck="false" aria-label="CSV"${this.readOnly() ? ' readonly' : ''}>${escapeHtml(this.body())}</textarea>`;
		if (view.problem) html += `<div class="oi-table-problem" data-oi-problem>${escapeHtml(view.problem)}</div>`;
		if (this.analyze !== undefined) html += this.analyzeHtml(this.analyze);
		if (this.rowForm) html += this.rowFormHtml(this.rowForm);
		this.root.innerHTML = html;
		this.paintSelection();
		if (this.editing) this.openEditor(this.editing);
		else if (refocus?.field) {
			const input = this.root.querySelector<HTMLInputElement>(`[data-field="${refocus.field}"]`);
			if (input) {
				input.focus({ preventScroll: true });
				try {
					input.setSelectionRange(refocus.start, refocus.end);
				} catch {
					// not a text field
				}
			}
		}
	}

	private barHtml(problem: string | undefined): string {
		const readOnly = this.readOnly();
		const show = this.show();
		const segment = showList.map((item) => `<button type="button" class="oi-table-segment${item === show ? ' active' : ''}" data-action="Show" data-show="${item}" aria-pressed="${item === show}">${item}</button>`).join('');
		const chipList: string[] = [];
		const chip = (kind: string, text: string): string =>
			`<span class="oi-table-chip" data-chip="${kind}"><button type="button" class="oi-table-chip-text" data-action="Chip" data-chip="${kind}">${escapeHtml(text)}</button>${readOnly ? '' : `<button type="button" class="oi-table-chip-remove" data-action="ChipRemove" data-chip="${kind}" aria-label="Remove">${crossMark}</button>`}</span>`;
		if (this.model.filter) chipList.push(chip('Filter', `Filter: ${this.model.filter}`));
		for (const sort of this.model.sortList) chipList.push(chip('Sort', `Sort: ${sort.column} ${sort.down ? '↓' : '↑'}`));
		if (this.model.group) chipList.push(chip('Group', `Group: ${this.model.group.column}${this.model.group.period ? ` by ${this.model.group.period.toLowerCase()}` : ''}`));
		const hiddenCount = this.model.columnList.filter((column) => column.hidden).length;
		if (hiddenCount) chipList.push(chip('Hidden', `${hiddenCount} hidden`));
		if (this.model.kind === 'Note') chipList.push(`<span class="oi-table-chip oi-table-chip-source" title="Each row is a note">Notes: ${escapeHtml(this.model.source ?? '')}</span>`);
		if (this.data?.path) {
			const sheetList = this.data.book?.sheetList ?? [];
			const picker =
				sheetList.length > 1
					? `<select class="oi-table-sheet" data-field="sheet" aria-label="Sheet">${sheetList.map((sheet) => `<option${sheet.name === this.data!.grid?.sheet.name ? ' selected' : ''}>${escapeHtml(sheet.name)}</option>`).join('')}</select>`
					: '';
			chipList.push(`<span class="oi-table-chip oi-table-chip-source" title="The rows live in this file">File <button type="button" class="oi-table-link oi-table-file" data-action="OpenFile">${escapeHtml(this.data.path.split('/').pop() ?? '')}</button></span>${picker}`);
		}
		if (this.data?.message) chipList.push(`<span class="oi-table-chip oi-table-problem" data-oi-problem>${escapeHtml(this.data.message)}</span>`);
		if (this.linked) chipList.push(`<span class="oi-table-chip oi-table-chip-source" title="The rows live in this note">From <a class="oi-table-link" data-oi-link="${escapeHtml(this.linked.path.replace(/\.oi$/, ''))}">${escapeHtml(this.linked.path.replace(/\.oi$/, '').split('/').pop() ?? '')}</a></span>`);
		const askHtml = this.ask
			? `<div class="oi-table-ask"><label>${escapeHtml(this.ask.label)}</label><input data-field="ask" value="${escapeHtml(this.ask.value)}" placeholder="${escapeHtml(this.ask.placeholder ?? '')}" spellcheck="false"><button type="button" class="oi-table-button primary" data-action="AskDone">OK</button><button type="button" class="oi-table-button" data-action="AskCancel">Cancel</button></div>`
			: '';
		const title = this.title();
		const titleHtml = title
			? `<button type="button" class="oi-table-title" data-action="Title" title="The table's title: plots and other notes find it by it"${readOnly ? ' disabled' : ''}>${escapeHtml(title)}</button>`
			: readOnly
				? ''
				: `<button type="button" class="oi-table-title oi-table-title-empty" data-action="Title">Add a title</button>`;
		return (
			`<div class="oi-table-bar">` +
			titleHtml +
			`<div class="oi-table-segment-row" role="group" aria-label="Layout">${segment}</div>` +
			chipList.join('') +
			`<span class="oi-table-bar-space"></span>` +
			`<input class="oi-table-search" data-field="search" type="search" placeholder="Search" value="${escapeHtml(this.search)}" aria-label="Search the table">` +
			(this.model.kind === 'Csv' ? `<button type="button" class="oi-table-button${this.sourceOpen ? ' active' : ''}" data-action="Source" title="The table's CSV">CSV</button>` : '') +
			`<button type="button" class="oi-table-icon" data-action="More" title="More" aria-label="More">${moreMark}</button>` +
			`</div>` +
			askHtml +
			(problem ? '' : '')
		);
	}

	private emptyHtml(): string {
		if (this.readOnly()) return `<p class="oi-table-empty">An empty table.</p>`;
		return `<div class="oi-table-empty"><p>An empty table. Paste rows from a spreadsheet, or start with columns:</p><button type="button" class="oi-table-button primary" data-action="Start">Name, Date, Number</button></div>`;
	}

	private maxRow(): number {
		const value = this.context.setting('Table.MaxRow');
		return typeof value === 'number' && value > 0 ? value : 100;
	}

	private headerHtml(columnIndex: number, place: number): string {
		const column = this.model.columnList[columnIndex]!;
		const sort = this.model.sortList.find((item) => item.column === column.name);
		const width = column.width ? ` style="width:${column.width}px;min-width:${column.width}px"` : '';
		return `<th data-column="${place}" data-type="${column.valueType}"${width} scope="col"><button type="button" class="oi-table-head" data-action="Header" data-column="${place}" title="${typeTitle[column.type]}${column.formula ? `: ${escapeHtml(column.formula)}` : ''}"><span class="oi-table-type">${typeIcon[column.type]}</span><span class="oi-table-name">${escapeHtml(column.name)}</span>${sort ? `<span class="oi-table-sort">${sort.down ? '↓' : '↑'}</span>` : ''}</button></th>`;
	}

	private gridHtml(groupList: { key: string; label: string; rowList: Row[] }[] | undefined): string {
		const readOnly = this.readOnly();
		const head = this.shownColumnList.map((columnIndex, place) => this.headerHtml(columnIndex, place)).join('');
		const addColumn = readOnly || this.model.kind === 'Note' ? '' : `<th class="oi-table-add-column"><button type="button" class="oi-table-icon" data-action="AddColumn" title="Add a column" aria-label="Add a column">${plusMark}</button></th>`;
		const handleHead = readOnly ? '' : '<th class="oi-table-handle" aria-hidden="true"></th>';
		const columnCount = this.shownColumnList.length + (readOnly ? 0 : 1) + (addColumn ? 1 : 0);
		const limit = this.showAll ? Number.POSITIVE_INFINITY : this.maxRow();
		let body = '';
		let position = 0;
		const rowHtml = (row: Row): string => {
			const at = position++;
			if (at >= limit) return '';
			const valueList = this.valueOf(row);
			const cellHtml = this.shownColumnList
				.map((columnIndex, place) => {
					const column = this.model.columnList[columnIndex]!;
					return `<td data-row="${at}" data-column="${place}" data-type="${column.valueType}">${this.cellHtml(column, valueList[columnIndex], row)}</td>`;
				})
				.join('');
			const handle = readOnly ? '' : `<td class="oi-table-handle"><button type="button" class="oi-table-row-handle" data-action="RowHandle" data-row="${at}" tabindex="-1" title="Drag to move, click for more" aria-label="Row ${at + 1}">${handleMark}</button></td>`;
			return `<tr data-row="${at}">${handle}${cellHtml}${addColumn ? '<td class="oi-table-add-column"></td>' : ''}</tr>`;
		};
		const orderList: Row[] = [];
		if (groupList) {
			for (const group of groupList) {
				body += `<tr class="oi-table-group"><td colspan="${columnCount}"><span class="oi-table-group-label">${escapeHtml(group.label)}</span><span class="oi-table-group-count">${group.rowList.length}</span></td></tr>`;
				for (const row of group.rowList) {
					orderList.push(row);
					body += rowHtml(row);
				}
				body += this.summaryRowHtml(group.rowList, true, readOnly, addColumn !== '');
			}
		} else
			for (const row of this.shownRowList) {
				orderList.push(row);
				body += rowHtml(row);
			}
		// a row in several groups (a List column) shows once per group; selection follows the order drawn
		this.shownRowList = orderList;
		if (position > limit) body += `<tr class="oi-table-more"><td colspan="${columnCount}"><button type="button" class="oi-table-button" data-action="ShowAll">Show all ${position} rows</button></td></tr>`;
		if (!readOnly && (this.model.kind === 'Csv' || this.noteFolder() !== undefined)) body += `<tr class="oi-table-new"><td colspan="${columnCount}"><button type="button" class="oi-table-new-button" data-action="AddRow">${plusMark}<span>New</span></button></td></tr>`;
		const foot = this.summaryRowHtml(this.shownRowList, false, readOnly, addColumn !== '');
		return `<div class="oi-table-scroll"><table class="oi-table-grid"><thead><tr>${handleHead}${head}${addColumn}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
	}

	private summaryRowHtml(rowList: readonly Row[], group: boolean, readOnly: boolean, addColumn: boolean): string {
		const anySummary = this.shownColumnList.some((columnIndex) => this.model.columnList[columnIndex]!.summary !== 'None');
		if (group && !anySummary) return '';
		if (!group && !anySummary && readOnly) return '';
		const cellHtml = this.shownColumnList
			.map((columnIndex, place) => {
				const column = this.model.columnList[columnIndex]!;
				const value = summarize(
					column.summary,
					rowList.map((row) => this.valueOf(row)[columnIndex]),
				);
				const text = column.summary === 'None' ? '' : summaryText(column, column.summary, value);
				const label = column.summary === 'None' ? '' : `<span class="oi-table-summary-label">${escapeHtml(shortSummary(column.summary))}</span>`;
				if (group) return `<td class="oi-table-summary">${label}${escapeHtml(text)}</td>`;
				return `<td class="oi-table-summary">${readOnly ? `${label}${escapeHtml(text)}` : `<button type="button" class="oi-table-summary-button" data-action="Summary" data-column="${place}" title="Summary">${label}${escapeHtml(text) || '<span class="oi-table-summary-hint">Summary</span>'}</button>`}</td>`;
			})
			.join('');
		return `<tr class="${group ? 'oi-table-subtotal' : 'oi-table-footer'}">${readOnly ? '' : '<td class="oi-table-handle"></td>'}${cellHtml}${addColumn ? '<td class="oi-table-add-column"></td>' : ''}</tr>`;
	}

	private cellHtml(column: ColumnInfo, value: TableCell, row: Row): string {
		if (column.valueType === 'Checkbox' && column.formula === undefined) {
			return `<input type="checkbox" class="oi-table-check" data-action="Check"${value === 1 ? ' checked' : ''}${this.readOnly() ? ' disabled' : ''} aria-label="${escapeHtml(column.name)}">`;
		}
		if (value === undefined) return '';
		if (column.type === 'Choice' || column.type === 'List') {
			const list = Array.isArray(value) ? value : [String(value)];
			return list.map((item) => this.pillHtml(column, item)).join('');
		}
		if (column.type === 'Link') {
			const target = row.path && column.name === 'Name' && this.model.kind === 'Note' ? row.path.replace(/\.oi$/, '') : String(value);
			const label = target.split('/').pop() ?? target;
			return `<a class="oi-table-link" data-oi-link="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
		}
		return escapeHtml(formatValue(column, value));
	}

	private cardHtml(show: Show): string {
		const readOnly = this.readOnly();
		const titleIndex = this.shownColumnList[0] ?? 0;
		const card = (row: Row, at: number): string => {
			const valueList = this.valueOf(row);
			const title = this.model.columnList[titleIndex] ? this.cellHtml(this.model.columnList[titleIndex]!, valueList[titleIndex], row) : '';
			const fieldList = this.shownColumnList
				.slice(1)
				.filter((columnIndex) => valueList[columnIndex] !== undefined && valueList[columnIndex] !== '' && !(Array.isArray(valueList[columnIndex]) && (valueList[columnIndex] as string[]).length === 0))
				.filter((columnIndex) => !(show === 'Board' && this.boardColumn() === columnIndex))
				.map((columnIndex) => {
					const column = this.model.columnList[columnIndex]!;
					return `<div class="oi-table-field"><span class="oi-table-field-name">${escapeHtml(column.name)}</span><span class="oi-table-field-value">${this.cellHtml(column, valueList[columnIndex], row)}</span></div>`;
				})
				.join('');
			return `<div class="oi-table-card" data-row="${at}" tabindex="0"><div class="oi-table-card-title">${title || '<span class="oi-table-untitled">Untitled</span>'}</div>${fieldList}</div>`;
		};
		const newButton = (value?: string): string =>
			readOnly || (this.model.kind === 'Note' && this.noteFolder() === undefined) ? '' : `<button type="button" class="oi-table-new-button" data-action="AddRow"${value !== undefined ? ` data-lane="${escapeHtml(value)}"` : ''}>${plusMark}<span>New</span></button>`;
		if (show === 'Board') {
			const columnIndex = this.boardColumn();
			if (columnIndex === undefined) return `<p class="oi-table-empty">A Board needs a Choice column to make its lanes (or Group: a column).</p>`;
			const column = this.model.columnList[columnIndex]!;
			const laneList = [...column.choiceList];
			const laneMap = new Map<string, string[]>(laneList.map((lane) => [lane.toLowerCase(), []]));
			const noneList: string[] = [];
			this.shownRowList.forEach((row, at) => {
				const value = this.valueOf(row)[columnIndex];
				const key = Array.isArray(value) ? (value[0] ?? '') : value === undefined ? '' : String(value);
				(laneMap.get(key.toLowerCase()) ?? noneList).push(card(row, at));
			});
			const lane = (title: string, value: string, cardList: string[], hue: number): string =>
				`<div class="oi-table-lane" data-lane="${escapeHtml(value)}"><div class="oi-table-lane-head">${value ? this.pillHtml(column, title) : `<span class="oi-table-pill" data-hue="${hue}">${escapeHtml(title)}</span>`}<span class="oi-table-group-count">${cardList.length}</span></div><div class="oi-table-lane-body">${cardList.join('')}${newButton(value)}</div></div>`;
			const laneHtml = laneList.map((value) => lane(value, value, laneMap.get(value.toLowerCase()) ?? [], hueOf(column.choiceList, value))).join('');
			return `<div class="oi-table-board" data-column="${columnIndex}">${noneList.length ? lane(`No ${column.name}`, '', noneList, -1) : ''}${laneHtml}</div>`;
		}
		const cardList = this.shownRowList.map(card).join('');
		return `<div class="oi-table-${show === 'Gallery' ? 'gallery' : 'list'}">${cardList}${newButton()}</div>`;
	}

	/** The column a Board's lanes come from: its Group, else the first Choice column. */
	private boardColumn(): number | undefined {
		const group = this.model.group ? this.model.columnList.findIndex((column) => column.name === this.model.group!.column) : -1;
		if (group >= 0) return group;
		const choice = this.model.columnList.findIndex((column) => column.type === 'Choice');
		return choice >= 0 ? choice : undefined;
	}

	private analyzeHtml(columnIndex: number): string {
		const column = this.model.columnList[columnIndex];
		if (!column) return '';
		const stat = statisticsOf(this.shownRowList.map((row) => this.valueOf(row)[columnIndex]));
		const format = (value: number): string => formatValue(column, Math.round(value * 1000) / 1000);
		let body = '<p>No numbers in this column.</p>';
		if (stat) {
			const top = Math.max(...stat.bin.map((bin) => bin.count), 1);
			const barWidth = 100 / stat.bin.length;
			const bar = stat.bin
				.map((bin, index) => `<rect x="${index * barWidth + 0.6}" y="${40 - (bin.count / top) * 38}" width="${barWidth - 1.2}" height="${(bin.count / top) * 38}" rx="0.8"><title>${escapeHtml(`${format(bin.from)} – ${format(bin.to)}: ${bin.count}`)}</title></rect>`)
				.join('');
			const line = (label: string, value: string): string => `<div class="oi-table-stat"><span>${label}</span><b>${escapeHtml(value)}</b></div>`;
			body =
				`<div class="oi-table-stat-grid">${line('Count', String(stat.count))}${line('Mean', format(stat.mean))}${line('Median', format(stat.median))}${line('Std. deviation', format(stat.deviation))}${line('Min', format(stat.min))}${line('Max', format(stat.max))}${line('Q1', format(stat.q1))}${line('Q3', format(stat.q3))}</div>` +
				`<svg class="oi-table-histogram" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Histogram">${bar}</svg>` +
				`<div class="oi-table-histogram-axis"><span>${escapeHtml(format(stat.min))}</span><span>${escapeHtml(format(stat.max))}</span></div>`;
		}
		return `<div class="oi-table-card-panel" role="dialog" aria-label="Analyze ${escapeHtml(column.name)}"><div class="oi-table-panel-head"><b>${escapeHtml(column.name)}</b><span class="oi-table-panel-note">${this.shownRowList.length} rows shown</span><button type="button" class="oi-table-icon" data-action="PanelClose" aria-label="Close">${crossMark}</button></div>${body}</div>`;
	}

	private rowFormHtml(row: Row): string {
		const readOnly = this.readOnly();
		const valueList = this.valueOf(row);
		const fieldList = this.model.columnList
			.map((column, columnIndex) => {
				const value = valueList[columnIndex];
				const editable = !readOnly && column.formula === undefined && !(this.model.kind === 'Note' && column.name === 'Name');
				let input: string;
				if (!editable) input = `<span class="oi-table-form-value">${this.cellHtml(column, value, row)}</span>`;
				else if (column.valueType === 'Checkbox') input = `<input type="checkbox" data-field="form:${columnIndex}" data-form="${columnIndex}"${value === 1 ? ' checked' : ''}>`;
				else input = this.inputHtml(column, row.cellList[column.index] ?? '', `form:${columnIndex}`, columnIndex);
				return `<label class="oi-table-form-row"><span class="oi-table-field-name">${typeIcon[column.type]}${escapeHtml(column.name)}</span>${input}</label>`;
			})
			.join('');
		const open = row.path ? `<button type="button" class="oi-table-button" data-action="OpenNote">Open note</button>` : '';
		return `<div class="oi-table-card-panel oi-table-form" role="dialog" aria-label="Row"><div class="oi-table-panel-head"><b>Row</b>${open}<button type="button" class="oi-table-icon" data-action="PanelClose" aria-label="Close">${crossMark}</button></div>${fieldList}</div>`;
	}

	/** An input for a cell's text, by its column's type. */
	private inputHtml(column: ColumnInfo, text: string, field: string, columnIndex: number): string {
		const list = column.type === 'Choice' || column.type === 'List' ? ` list="oi-table-choice-${columnIndex}"` : '';
		const datalist = list ? `<datalist id="oi-table-choice-${columnIndex}">${column.choiceList.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist>` : '';
		if (column.type === 'Date' && /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) === (text.trim() !== '')) return `<input type="date" class="oi-table-input" data-field="${field}" data-form="${columnIndex}" value="${escapeHtml(text.trim())}">`;
		if (column.type === 'DateTime') {
			const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(text.trim());
			if (match || text.trim() === '') return `<input type="datetime-local" class="oi-table-input" data-field="${field}" data-form="${columnIndex}" data-kind="DateTime" value="${match ? `${match[1]}T${match[2]!.padStart(2, '0')}:${match[3]}` : ''}">`;
		}
		return `<input class="oi-table-input" data-field="${field}" data-form="${columnIndex}" value="${escapeHtml(text)}"${list} spellcheck="false">${datalist}`;
	}

	// ------------------------------------------------------------ selection and typing

	private cellElement(place: Place): HTMLElement | null {
		return this.root.querySelector<HTMLElement>(`td[data-row="${place.row}"][data-column="${place.column}"]`);
	}

	private paintSelection(): void {
		for (const element of this.root.querySelectorAll('.oi-table-selected, .oi-table-active')) element.classList.remove('oi-table-selected', 'oi-table-active');
		const status = this.root.querySelector<HTMLElement>('.oi-table-status');
		if (!this.selection) {
			if (status) status.textContent = '';
			return;
		}
		const { anchor, focus } = this.selection;
		const rowLow = Math.min(anchor.row, focus.row);
		const rowHigh = Math.max(anchor.row, focus.row);
		const columnLow = Math.min(anchor.column, focus.column);
		const columnHigh = Math.max(anchor.column, focus.column);
		const numberList: number[] = [];
		let filled = 0;
		for (let row = rowLow; row <= rowHigh; row++) {
			for (let column = columnLow; column <= columnHigh; column++) {
				this.cellElement({ row, column })?.classList.add('oi-table-selected');
				const columnIndex = this.shownColumnList[column];
				const shownRow = this.shownRowList[row];
				if (columnIndex === undefined || !shownRow) continue;
				const value = this.valueOf(shownRow)[columnIndex];
				if (value !== undefined && value !== '') filled++;
				const type = this.model.columnList[columnIndex]!.valueType;
				if (typeof value === 'number' && type !== 'Date' && type !== 'DateTime' && type !== 'Checkbox') numberList.push(value);
			}
		}
		this.cellElement(focus)?.classList.add('oi-table-active');
		if (status) {
			const many = rowHigh > rowLow || columnHigh > columnLow;
			if (!many) status.textContent = '';
			else {
				const sum = numberList.reduce((total, value) => total + value, 0);
				const part = [`Count ${filled}`];
				if (numberList.length) part.push(`Sum ${round(sum)}`, `Average ${round(sum / numberList.length)}`);
				status.textContent = part.join(' · ');
			}
		}
	}

	private select(place: Place | undefined, extend = false): void {
		if (!place) this.selection = undefined;
		else if (extend && this.selection) this.selection = { anchor: this.selection.anchor, focus: place };
		else this.selection = { anchor: place, focus: place };
		this.paintSelection();
	}

	private clampPlace(place: Place): Place {
		return { row: Math.max(0, Math.min(place.row, this.shownRowList.length - 1)), column: Math.max(0, Math.min(place.column, this.shownColumnList.length - 1)) };
	}

	/** Opens the cell editor in place (an input over the cell). */
	private openEditor(place: Place, initial?: string): void {
		const row = this.shownRowList[place.row];
		const columnIndex = this.shownColumnList[place.column];
		const cell = this.cellElement(place);
		if (!row || columnIndex === undefined || !cell || this.readOnly()) {
			this.editing = undefined;
			return;
		}
		const column = this.model.columnList[columnIndex]!;
		if (column.formula !== undefined || column.valueType === 'Checkbox' || (this.model.kind === 'Note' && column.name === 'Name')) {
			this.editing = undefined;
			this.select(place);
			return;
		}
		if ((column.type === 'Choice' || column.type === 'List') && initial === undefined) {
			// pick from the choices (typing on the cell still types)
			this.editing = undefined;
			this.select(place);
			this.choiceMenu(row, columnIndex, cell.getBoundingClientRect());
			return;
		}
		this.editing = place;
		this.select(place);
		const text = row.cellList[column.index] ?? '';
		cell.classList.add('oi-table-editing');
		cell.innerHTML = this.inputHtml(column, initial ?? text, 'cell', columnIndex);
		const input = cell.querySelector<HTMLInputElement>('input')!;
		input.dataset.committed = text;
		input.focus({ preventScroll: true });
		if (input.type === 'text') {
			const end = input.value.length;
			input.setSelectionRange(initial !== undefined ? end : 0, end);
		}
	}

	/** Writes the open cell editor (if it changed) and closes it. */
	private commitEditor(move?: Place): void {
		const place = this.editing;
		const input = this.root.querySelector<HTMLInputElement>('input[data-field="cell"]');
		this.editing = undefined;
		if (!place || !input) return;
		const row = this.shownRowList[place.row];
		const columnIndex = this.shownColumnList[place.column];
		let text = input.value;
		if (input.dataset.kind === 'DateTime') text = text.replace('T', ' ');
		const changed = text !== (input.dataset.committed ?? '');
		if (move) {
			this.editing = this.clampPlace(move);
			this.selection = { anchor: this.editing, focus: this.editing };
		} else this.selection = { anchor: place, focus: place };
		if (changed && row && columnIndex !== undefined) this.writeCell(row, columnIndex, text);
		else this.render();
		if (!move) this.root.focus({ preventScroll: true });
	}

	private cancelEditor(): void {
		const place = this.editing;
		this.editing = undefined;
		this.render();
		if (place) this.select(place);
		this.root.focus({ preventScroll: true });
	}

	/** The selected cells' text, as rows. */
	private selectedText(): string[][] {
		if (!this.selection) return [];
		const { anchor, focus } = this.selection;
		const rowList: string[][] = [];
		for (let row = Math.min(anchor.row, focus.row); row <= Math.max(anchor.row, focus.row); row++) {
			const shownRow = this.shownRowList[row];
			if (!shownRow) continue;
			const cellList: string[] = [];
			for (let column = Math.min(anchor.column, focus.column); column <= Math.max(anchor.column, focus.column); column++) {
				const columnIndex = this.shownColumnList[column];
				const info = columnIndex === undefined ? undefined : this.model.columnList[columnIndex];
				if (!info) continue;
				cellList.push(info.formula !== undefined ? formatValue(info, this.valueOf(shownRow)[columnIndex!]) : (shownRow.cellList[info.index] ?? ''));
			}
			rowList.push(cellList);
		}
		return rowList;
	}

	private clearSelected(): void {
		if (!this.selection || this.readOnly()) return;
		const { anchor, focus } = this.selection;
		let body = this.body();
		this.noteModel().transact(() => {
			for (let row = Math.min(anchor.row, focus.row); row <= Math.max(anchor.row, focus.row); row++) {
				for (let column = Math.min(anchor.column, focus.column); column <= Math.max(anchor.column, focus.column); column++) {
					const shownRow = this.shownRowList[row];
					const info = this.model.columnList[this.shownColumnList[column] ?? -1];
					if (!shownRow || !info || info.formula !== undefined) continue;
					if (this.model.kind === 'Note') this.writeCell(shownRow, this.shownColumnList[column]!, '');
					// every cleared cell in one new body: one undo step
					else body = setCell(readTable(this.property(), body), shownRow.index, info.index, '');
				}
			}
			if (this.model.kind === 'Csv') this.setBody(body);
		});
	}

	/** Pasted rows go in at the selected cell (at the end when nothing is selected); the table grows to fit. */
	private paste(text: string): void {
		if (this.readOnly() || this.model.kind !== 'Csv') return;
		const block = parsePasted(text);
		if (block.length === 0) return;
		if (this.model.recordList.length === 0) {
			this.setBody(rewriteRecord({ ...this.model, recordList: [] }, block));
			return;
		}
		const place = this.selection?.anchor;
		const row = place ? this.shownRowList[place.row] : undefined;
		const columnIndex = place ? this.shownColumnList[place.column] : undefined;
		const column = columnIndex === undefined ? undefined : this.model.columnList[columnIndex];
		const recordIndex = row ? row.index : this.model.recordList.length;
		this.setBody(pasteCell(this.model, recordIndex, column && column.index >= 0 ? column.index : 0, block));
	}

	// ------------------------------------------------------------ menus

	private openMenu(event: { clientX: number; clientY: number } | DOMRect, itemList: MenuEntry[]): void {
		const x = 'clientX' in event ? event.clientX : event.left;
		const y = 'clientY' in event ? event.clientY : event.bottom + 2;
		this.menu()?.open({ x, y, itemList });
	}

	private askFor(label: string, value: string, onDone: (value: string) => void, placeholder?: string): void {
		this.ask = { label, value, placeholder, onDone };
		this.render();
		const input = this.root.querySelector<HTMLInputElement>('[data-field="ask"]');
		input?.focus();
		input?.select();
	}

	private headerMenu(place: number, rect: DOMRect): void {
		const columnIndex = this.shownColumnList[place];
		if (columnIndex === undefined) return;
		const column = this.model.columnList[columnIndex]!;
		const readOnly = this.readOnly();
		const csv = this.model.kind === 'Csv';
		const sort = this.model.sortList.find((item) => item.column === column.name);
		const itemList: MenuEntry[] = [];
		const date = column.valueType === 'Date' || column.valueType === 'DateTime';
		if (!readOnly) {
			if (csv || column.formula !== undefined)
				itemList.push({
					title: 'Rename',
					run: () => this.askFor('Name', column.name, (name) => this.renameColumn(column, name)),
				});
			if (column.formula !== undefined) itemList.push({ title: 'Edit formula', hint: column.formula, run: () => this.askFor(`${column.name} =`, column.formula ?? '', (formula) => this.setColumn(column.name, 'Formula', formula || undefined), 'Calorie - Burned') });
			else
				itemList.push({
					title: 'Type',
					hint: typeTitle[column.type],
					childList: columnTypeList
						.filter((type) => type !== 'Formula')
						.map((type) => ({ title: typeTitle[type], checked: type === column.type, run: () => this.setColumn(column.name, 'Type', type) })),
				});
			itemList.push(
				{ title: 'Sort ascending', checked: sort && !sort.down, separatorBefore: true, run: () => this.setProperty('Sort', new Map([[column.name, 'Up']])) },
				{ title: 'Sort descending', checked: sort?.down === true, run: () => this.setProperty('Sort', new Map([[column.name, 'Down']])) },
			);
			if (sort) itemList.push({ title: 'Clear sort', run: () => this.setProperty('Sort', undefined) });
			itemList.push({ title: 'Filter', run: () => this.askFor('Filter', this.model.filter ?? `${filterName(column.name)} ${date ? '>= 2026-01-01' : column.valueType === 'Number' ? '> 0' : '= '}`, (filter) => this.setProperty('Filter', filter.trim() || undefined), 'Calorie > 300 and Workout = Legs') });
			if (date)
				itemList.push({
					title: 'Group by',
					childList: periodList.map((period: Period) => ({ title: period, checked: this.model.group?.column === column.name && this.model.group.period === period, run: () => this.setProperty('Group', new Map([[column.name, period]])) })),
				});
			else itemList.push({ title: 'Group by this column', checked: this.model.group?.column === column.name, run: () => this.setProperty('Group', column.name) });
			if (this.model.group) itemList.push({ title: 'Ungroup', run: () => this.setProperty('Group', undefined) });
			itemList.push({
				title: 'Summary',
				separatorBefore: true,
				hint: column.summary === 'None' ? '' : summaryTitle[column.summary],
				childList: summaryChoiceList(column).map((summary: Summary) => ({ title: summaryTitle[summary], checked: summary === column.summary, run: () => this.setColumn(column.name, 'Summary', summary === 'None' ? undefined : summary) })),
			});
			if ((column.type === 'Choice' || column.type === 'List') && column.formula === undefined) itemList.push({ title: 'Choices', separatorBefore: true, childList: this.choiceEntryList(column, rect) });
			if (column.valueType === 'Number') {
				itemList.push(
					{ title: 'Unit', hint: column.unit ?? '', run: () => this.askFor('Unit', column.unit ?? '', (unit) => this.setColumn(column.name, 'Unit', unit.trim() || undefined), 'kcal, kg, $, €') },
					{
						title: 'Decimal places',
						hint: column.decimal === undefined ? 'Auto' : String(column.decimal),
						childList: [undefined, 0, 1, 2, 3].map((digit) => ({ title: digit === undefined ? 'As written' : String(digit), checked: column.decimal === digit, run: () => this.setColumn(column.name, 'Decimal', digit) })),
					},
				);
			}
			if (column.valueType === 'Number' || date) itemList.push({ title: 'Analyze', run: () => this.openAnalyze(columnIndex) });
			itemList.push({ title: 'Hide', separatorBefore: true, run: () => this.setHidden(column.name, true) });
			if (csv) {
				itemList.push(
					{ title: 'Insert left', run: () => this.askFor('New column', '', (name) => this.addColumn(name, column.index)) },
					{ title: 'Insert right', run: () => this.askFor('New column', '', (name) => this.addColumn(name, column.index + 1)) },
				);
				if (column.index > 0) itemList.push({ title: 'Move left', run: () => this.setBody(moveColumn(this.model, column.index, column.index - 1)) });
				if (column.index >= 0 && column.index < (this.model.recordList[0]?.cellList.length ?? 0) - 1) itemList.push({ title: 'Move right', run: () => this.setBody(moveColumn(this.model, column.index, column.index + 1)) });
			}
			itemList.push({ title: 'Add a formula column', run: () => this.addFormulaColumn() });
			if (csv || column.formula !== undefined) itemList.push({ title: 'Delete column', danger: true, separatorBefore: true, run: () => this.deleteColumn(column) });
		} else {
			if (column.valueType === 'Number' || date) itemList.push({ title: 'Analyze', run: () => this.openAnalyze(columnIndex) });
		}
		if (itemList.length) this.openMenu(rect, itemList);
	}

	private openAnalyze(columnIndex: number): void {
		this.analyze = columnIndex;
		this.rowForm = undefined;
		this.render();
	}

	private setHidden(name: string, hidden: boolean): void {
		const list = this.model.columnList.filter((column) => column.hidden && column.name !== name).map((column) => column.name);
		if (hidden) list.push(name);
		this.setProperty('Hidden', list.length ? list : undefined);
	}

	private addColumn(name: string, at: number): void {
		const clean = name.trim();
		if (!clean) return;
		this.setBody(insertColumn(this.model, at, clean));
	}

	private addFormulaColumn(): void {
		this.askFor('Formula column name', '', (name) => {
			const clean = name.trim();
			if (!clean) return;
			const numberColumn = this.model.columnList.find((column) => column.valueType === 'Number');
			this.askFor(`${clean} =`, numberColumn ? `${filterName(numberColumn.name)} * 2` : '', (formula) => {
				if (formula.trim()) this.setColumn(clean, 'Formula', formula.trim());
			});
		});
	}

	private renameColumn(column: ColumnInfo, name: string): void {
		const clean = name.trim();
		if (!clean || clean === column.name) return;
		this.noteModel().transact(() => {
			if (column.index >= 0 && this.model.kind === 'Csv') this.setBody(setCell(this.model, 0, column.index, clean));
			const columnMap = this.property().get('Column');
			if (columnMap instanceof Map && columnMap.has(column.name)) {
				const next = new Map<string, PropertyValue>();
				for (const [key, value] of columnMap) next.set(key === column.name ? clean : key, value);
				this.setProperty('Column', next);
			}
			const sort = this.property().get('Sort');
			if (sort instanceof Map && sort.has(column.name)) this.setProperty('Sort', new Map([...sort].map(([key, value]) => [key === column.name ? clean : key, value])));
			const group = this.property().get('Group');
			if (group === column.name) this.setProperty('Group', clean);
			else if (group instanceof Map && group.has(column.name)) this.setProperty('Group', new Map([...group].map(([key, value]) => [key === column.name ? clean : key, value])));
			if (this.model.filter) this.setProperty('Filter', this.model.filter.replace(new RegExp(`\\b${filterName(column.name)}\\b`, 'g'), filterName(clean)));
		});
	}

	private deleteColumn(column: ColumnInfo): void {
		this.noteModel().transact(() => {
			if (column.index >= 0) this.setBody(removeColumn(this.model, column.index));
			if (this.property().get('Column') instanceof Map) {
				const next = new Map(this.property().get('Column') as PropertyMap);
				next.delete(column.name);
				this.setProperty('Column', next.size ? next : undefined);
			}
		});
	}

	private rowMenu(at: number, rect: DOMRect): void {
		const row = this.shownRowList[at];
		if (!row) return;
		const itemList: MenuEntry[] = [{ title: 'Open as a form', run: () => this.openRowForm(row) }];
		if (row.path) itemList.push({ title: 'Open note', run: () => this.index()?.open(row.path!) });
		if (this.model.kind === 'Csv') {
			const order = (): (number | readonly string[])[] => this.model.recordList.map((_, index) => index);
			itemList.push(
				{
					title: 'Insert above',
					separatorBefore: true,
					run: () => {
						const list = order();
						list.splice(row.index, 0, []);
						this.setBody(rewriteRecord(this.model, list));
					},
				},
				{ title: 'Insert below', run: () => this.addRow(new Map(), row) },
				{
					title: 'Duplicate',
					run: () => {
						const list = order();
						// the copy is the same row: no "(1)" or "copy" added to it
						list.splice(row.index + 1, 0, [...row.cellList]);
						this.setBody(rewriteRecord(this.model, list));
					},
				},
				{
					title: 'Delete row',
					danger: true,
					separatorBefore: true,
					run: () => this.setBody(rewriteRecord(this.model, order().filter((index) => index !== row.index))),
				},
			);
		}
		this.openMenu(rect, itemList);
	}

	private openRowForm(row: Row): void {
		this.rowForm = row;
		this.analyze = undefined;
		this.render();
	}

	private summaryMenu(place: number, rect: DOMRect): void {
		const columnIndex = this.shownColumnList[place];
		const column = columnIndex === undefined ? undefined : this.model.columnList[columnIndex];
		if (!column) return;
		this.openMenu(
			rect,
			summaryChoiceList(column).map((summary) => ({ title: summaryTitle[summary], checked: summary === column.summary, run: () => this.setColumn(column.name, 'Summary', summary === 'None' ? undefined : summary) })),
		);
	}

	private chipMenu(kind: string, rect: DOMRect): void {
		if (kind === 'Filter') this.askFor('Filter', this.model.filter ?? '', (filter) => this.setProperty('Filter', filter.trim() || undefined), 'Calorie > 300 and Workout = Legs');
		else if (kind === 'Hidden')
			this.openMenu(
				rect,
				this.model.columnList.filter((column) => column.hidden).map((column) => ({ title: `Show ${column.name}`, run: () => this.setHidden(column.name, false) })),
			);
		else if (kind === 'Sort') {
			const sort = this.model.sortList[0];
			if (sort) this.setProperty('Sort', new Map([[sort.column, sort.down ? 'Up' : 'Down']]));
		}
	}

	// ------------------------------------------------------------ events

	private placeOf(target: Element): Place | undefined {
		const cell = target.closest<HTMLElement>('td[data-row][data-column]');
		if (!cell || !this.root.contains(cell)) return undefined;
		return { row: Number(cell.dataset.row), column: Number(cell.dataset.column) };
	}

	private bind(): void {
		const root = this.root;
		root.addEventListener('click', (event) => {
			if (this.swallowClick) {
				this.swallowClick = false;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const target = event.target as HTMLElement;
			const actionElement = target.closest<HTMLElement>('[data-action]');
			const action = actionElement?.dataset.action;
			const rect = actionElement?.getBoundingClientRect();
			switch (action) {
				case 'Show': {
					const show = actionElement!.dataset.show as Show;
					if (this.readOnly()) {
						this.localShow = show;
						this.render();
					} else {
						this.localShow = undefined;
						this.setProperty('Show', show === 'Table' ? undefined : show);
					}
					return;
				}
				case 'Source':
					this.toggleSource();
					return;
				case 'More':
					this.moreMenu(rect!);
					return;
				case 'Title':
					this.askFor('Title', this.title() ?? '', (title) => this.setProperty('Title', title.trim() || undefined), 'Gym log');
					return;
				case 'OpenFile':
					if (this.data?.path) this.index()?.open(this.data.path);
					return;
				case 'Header':
					this.headerMenu(Number(actionElement!.dataset.column), rect!);
					return;
				case 'Summary':
					this.summaryMenu(Number(actionElement!.dataset.column), rect!);
					return;
				case 'Chip':
					this.chipMenu(actionElement!.dataset.chip!, rect!);
					return;
				case 'ChipRemove': {
					const chip = actionElement!.dataset.chip;
					if (chip === 'Filter') this.setProperty('Filter', undefined);
					else if (chip === 'Sort') this.setProperty('Sort', undefined);
					else if (chip === 'Group') this.setProperty('Group', undefined);
					else if (chip === 'Hidden') this.setProperty('Hidden', undefined);
					return;
				}
				case 'AddColumn':
					this.askFor('New column', '', (name) => this.addColumn(name, this.model.recordList[0]?.cellList.length ?? 0));
					return;
				case 'AddRow': {
					const lane = actionElement!.dataset.lane;
					const boardColumn = this.boardColumn();
					this.addRow(lane !== undefined && boardColumn !== undefined ? new Map([[boardColumn, lane]]) : new Map());
					if (this.show() === 'Table' && this.model.kind === 'Csv') {
						// type into the new row's first cell right away
						const at = this.model.sortList.length || this.model.group ? undefined : this.shownRowList.length;
						if (at !== undefined) this.editing = { row: at, column: 0 };
					}
					return;
				}
				case 'ShowAll':
					this.showAll = true;
					this.render();
					return;
				case 'Start':
					this.setBody('Name,Date,Number\n,,');
					return;
				case 'AskDone':
					this.finishAsk(true);
					return;
				case 'AskCancel':
					this.finishAsk(false);
					return;
				case 'PanelClose':
					this.analyze = undefined;
					this.rowForm = undefined;
					this.render();
					return;
				case 'OpenNote':
					if (this.rowForm?.path) this.index()?.open(this.rowForm.path);
					return;
				case 'RowHandle':
					this.rowMenu(Number(actionElement!.dataset.row), rect!);
					return;
				case 'Check': {
					const place = this.placeOf(target);
					const row = place ? this.shownRowList[place.row] : undefined;
					const columnIndex = place ? this.shownColumnList[place.column] : undefined;
					if (row && columnIndex !== undefined && !this.readOnly()) this.writeCell(row, columnIndex, (target as HTMLInputElement).checked ? 'True' : 'False');
					return;
				}
			}
			const card = target.closest<HTMLElement>('.oi-table-card');
			if (card && !target.closest('[data-oi-link]')) {
				const row = this.shownRowList[Number(card.dataset.row)];
				if (row) this.openRowForm(row);
			}
		});
		root.addEventListener('pointerdown', (event) => {
			const target = event.target as HTMLElement;
			if (event.button !== 0) return;
			const handle = target.closest<HTMLElement>('[data-action="RowHandle"]');
			if (handle && !this.readOnly() && this.model.kind === 'Csv' && this.model.sortList.length === 0 && !this.model.group && !this.search) {
				const row = this.shownRowList[Number(handle.dataset.row)];
				if (row) this.rowDrag = { row, pointerId: event.pointerId, startY: event.clientY, moving: false, target: Number(handle.dataset.row) };
				return;
			}
			const card = target.closest<HTMLElement>('.oi-table-card');
			if (card && this.show() === 'Board' && !this.readOnly()) {
				const row = this.shownRowList[Number(card.dataset.row)];
				if (row) this.cardDrag = { row, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moving: false };
				return;
			}
			if (target.closest('input, button, a, textarea, select')) return;
			const place = this.placeOf(target);
			if (!place) return;
			if (this.editing) this.commitEditor();
			if (event.shiftKey && this.selection) {
				event.preventDefault();
				this.select(place, true);
				return;
			}
			this.press = { place, pointerId: event.pointerId, moved: false };
			this.select(place);
		});
		root.addEventListener('pointermove', (event) => {
			if (this.press && event.pointerId === this.press.pointerId && event.buttons & 1) {
				const element = document.elementFromPoint(event.clientX, event.clientY);
				const place = element ? this.placeOf(element) : undefined;
				if (place && (place.row !== this.press.place.row || place.column !== this.press.place.column)) {
					this.press.moved = true;
					this.select(place, true);
				}
				return;
			}
			if (this.rowDrag && event.pointerId === this.rowDrag.pointerId) this.moveRowDrag(event);
			if (this.cardDrag && event.pointerId === this.cardDrag.pointerId) this.moveCardDrag(event);
		});
		const end = (event: PointerEvent): void => {
			if (this.press && event.pointerId === this.press.pointerId) {
				const { place, moved } = this.press;
				this.press = undefined;
				if (!moved && event.type === 'pointerup') this.openEditor(place);
			}
			if (this.rowDrag && event.pointerId === this.rowDrag.pointerId) this.endRowDrag(event.type === 'pointerup');
			if (this.cardDrag && event.pointerId === this.cardDrag.pointerId) this.endCardDrag(event);
		};
		root.addEventListener('pointerup', end);
		root.addEventListener('pointercancel', end);
		root.addEventListener('keydown', (event) => this.onKey(event));
		root.addEventListener('input', (event) => {
			const target = event.target as HTMLInputElement | HTMLTextAreaElement;
			if (target.dataset.field === 'search') {
				this.search = target.value;
				this.selection = undefined;
				this.render();
			} else if (target.dataset.field === 'source') this.setBody(target.value);
		});
		root.addEventListener('change', (event) => {
			const target = event.target as HTMLInputElement;
			const field = target.dataset.field ?? '';
			if (field === 'sheet') {
				this.context.setProperty('Sheet', target.value);
				return;
			}
			if (field.startsWith('form:') && this.rowForm) {
				const columnIndex = Number(target.dataset.form);
				const column = this.model.columnList[columnIndex];
				if (!column) return;
				const text = target.type === 'checkbox' ? (target.checked ? 'True' : 'False') : target.dataset.kind === 'DateTime' ? target.value.replace('T', ' ') : target.value;
				this.writeCell(this.rowForm, columnIndex, text);
			} else if (field === 'cell' && (target.type === 'date' || target.type === 'datetime-local')) this.commitEditor();
		});
		root.addEventListener('focusout', (event) => {
			const target = event.target as HTMLElement;
			if (target.dataset.field !== 'cell') return;
			const next = event.relatedTarget as Element | null;
			if (next && this.root.contains(next)) return;
			// leaving the table writes what was typed
			setTimeout(() => {
				if (this.editing && !this.root.contains(document.activeElement)) this.commitEditor();
			}, 0);
		});
		root.addEventListener('copy', (event) => {
			if ((event.target as HTMLElement).closest('input, textarea') || !this.selection) return;
			event.preventDefault();
			event.clipboardData?.setData('text/plain', writeTsv(this.selectedText()));
		});
		root.addEventListener('paste', (event) => {
			if ((event.target as HTMLElement).closest('input, textarea')) return;
			const text = event.clipboardData?.getData('text/plain') ?? '';
			if (!text) return;
			event.preventDefault();
			this.paste(text);
		});
	}

	private finishAsk(done: boolean): void {
		const ask = this.ask;
		const value = this.root.querySelector<HTMLInputElement>('[data-field="ask"]')?.value ?? '';
		this.ask = undefined;
		if (done && ask) ask.onDone(value);
		this.render();
	}

	private onKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		const field = target.dataset.field;
		const mod = event.ctrlKey || event.metaKey;
		if (field === 'ask') {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.finishAsk(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.finishAsk(false);
			}
			return;
		}
		if (field === 'cell' && this.editing) {
			const place = this.editing;
			if (event.key === 'Enter') {
				event.preventDefault();
				this.commitEditor({ row: place.row + (event.shiftKey ? -1 : 1), column: place.column });
				if (!event.shiftKey && place.row + 1 >= this.shownRowList.length) this.editing = undefined;
			} else if (event.key === 'Tab') {
				event.preventDefault();
				const next = place.column + (event.shiftKey ? -1 : 1);
				if (next >= this.shownColumnList.length) this.commitEditor({ row: place.row + 1, column: 0 });
				else if (next < 0) this.commitEditor({ row: place.row - 1, column: this.shownColumnList.length - 1 });
				else this.commitEditor({ row: place.row, column: next });
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.cancelEditor();
			} else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !(target instanceof HTMLInputElement && (target.type === 'date' || target.type === 'datetime-local'))) {
				event.preventDefault();
				this.commitEditor({ row: place.row + (event.key === 'ArrowDown' ? 1 : -1), column: place.column });
			}
			event.stopPropagation();
			return;
		}
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
		if (!this.selection) return;
		const focus = this.selection.focus;
		const move = (row: number, column: number): void => {
			event.preventDefault();
			event.stopPropagation();
			this.select(this.clampPlace({ row: focus.row + row, column: focus.column + column }), event.shiftKey);
			this.cellElement(this.selection!.focus)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		};
		switch (event.key) {
			case 'ArrowUp':
				return move(-1, 0);
			case 'ArrowDown':
				return move(1, 0);
			case 'ArrowLeft':
				return move(0, -1);
			case 'ArrowRight':
				return move(0, 1);
			case 'Tab':
				return move(0, event.shiftKey ? -1 : 1);
			case 'Enter':
			case 'F2':
				event.preventDefault();
				event.stopPropagation();
				this.openEditor(focus);
				return;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				event.stopPropagation();
				this.clearSelected();
				return;
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				this.select(undefined);
				return;
		}
		if (mod && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			event.stopPropagation();
			this.selection = { anchor: { row: 0, column: 0 }, focus: { row: this.shownRowList.length - 1, column: this.shownColumnList.length - 1 } };
			this.paintSelection();
			return;
		}
		if (!mod && !event.altKey && event.key.length === 1) {
			// typing on a selected cell replaces it, as in a spreadsheet
			event.preventDefault();
			event.stopPropagation();
			this.openEditor(focus, event.key);
		}
	}

	// ------------------------------------------------------------ dragging rows and cards

	private moveRowDrag(event: PointerEvent): void {
		const drag = this.rowDrag!;
		if (!drag.moving && Math.abs(event.clientY - drag.startY) < 5) return;
		if (!drag.moving) {
			drag.moving = true;
			this.root.classList.add('oi-table-dragging');
		}
		const rowElementList = [...this.root.querySelectorAll<HTMLElement>('tbody tr[data-row]')];
		let target = rowElementList.length;
		for (const element of rowElementList) {
			const rect = element.getBoundingClientRect();
			if (event.clientY < rect.top + rect.height / 2) {
				target = Number(element.dataset.row);
				break;
			}
		}
		drag.target = target;
		for (const element of rowElementList) {
			element.classList.toggle('oi-table-drop-before', Number(element.dataset.row) === target);
			element.classList.toggle('oi-table-drop-after', target === rowElementList.length && element === rowElementList.at(-1));
		}
	}

	private endRowDrag(drop: boolean): void {
		const drag = this.rowDrag!;
		this.rowDrag = undefined;
		this.root.classList.remove('oi-table-dragging');
		if (!drag.moving) return;
		this.swallowClick = true;
		setTimeout(() => (this.swallowClick = false), 0);
		if (!drop) {
			this.render();
			return;
		}
		// shown rows are the records in order (no sort, group, or search): move the record
		const order = this.model.recordList.map((_, index) => index).filter((index) => index !== drag.row.index);
		const targetRow = this.shownRowList[drag.target];
		const at = targetRow ? order.indexOf(targetRow.index) : order.length;
		order.splice(at < 0 ? order.length : at, 0, drag.row.index);
		this.setBody(rewriteRecord(this.model, order));
	}

	private moveCardDrag(event: PointerEvent): void {
		const drag = this.cardDrag!;
		if (!drag.moving && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
		if (!drag.moving) {
			drag.moving = true;
			const card = this.root.querySelector<HTMLElement>(`.oi-table-card[data-row="${this.shownRowList.indexOf(drag.row)}"]`);
			card?.classList.add('oi-table-card-lifted');
			this.root.classList.add('oi-table-dragging');
		}
		for (const lane of this.root.querySelectorAll<HTMLElement>('.oi-table-lane')) {
			const rect = lane.getBoundingClientRect();
			lane.classList.toggle('oi-table-lane-target', event.clientX >= rect.left && event.clientX <= rect.right);
		}
	}

	private endCardDrag(event: PointerEvent): void {
		const drag = this.cardDrag!;
		this.cardDrag = undefined;
		this.root.classList.remove('oi-table-dragging');
		if (!drag.moving) return;
		this.swallowClick = true;
		setTimeout(() => (this.swallowClick = false), 0);
		const lane = [...this.root.querySelectorAll<HTMLElement>('.oi-table-lane')].find((element) => {
			const rect = element.getBoundingClientRect();
			return event.clientX >= rect.left && event.clientX <= rect.right;
		});
		const columnIndex = this.boardColumn();
		if (!lane || columnIndex === undefined || event.type !== 'pointerup') {
			this.render();
			return;
		}
		const value = lane.dataset.lane ?? '';
		const current = cellValue(this.model.columnList[columnIndex]!.type, drag.row.cellList[this.model.columnList[columnIndex]!.index] ?? '');
		if ((Array.isArray(current) ? current[0] : current) === value) {
			this.render();
			return;
		}
		this.writeCell(drag.row, columnIndex, value);
	}
}

const round = (value: number): string => (Math.round(value * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

const shortSummary = (summary: Summary): string =>
	({ None: '', Count: 'Count', Filled: 'Filled', Empty: 'Empty', Unique: 'Unique', Sum: 'Sum', Average: 'Avg', Median: 'Median', Min: 'Min', Max: 'Max', Range: 'Range', Deviation: 'SD', Checked: 'Checked' })[summary];

const filterName = (name: string): string => name.trim().replace(/[^A-Za-z0-9Ͱ-Ͽ_]+/g, '_');

/** A color for a choice: its place in the column's choices (the same choice keeps its color). */
function hueOf(choiceList: readonly string[], value: string): number {
	const index = choiceList.findIndex((item) => item.toLowerCase() === value.toLowerCase());
	return index < 0 ? -1 : index % 8;
}

type DataKind = 'Csv' | 'Tsv' | 'Xlsx';

interface DataFile {
	key: string;
	source: string;
	path: string | undefined;
	kind: DataKind;
	/** The rows as CSV, as a table in the note keeps them. */
	body: string;
	crlf: boolean;
	status: 'Loading' | 'Ready' | 'Missing' | 'Error';
	message: string | undefined;
	book: Workbook | undefined;
	grid: SheetGrid | undefined;
}

const kindOf = (source: string): DataKind => (/\.xlsx$/i.test(source) ? 'Xlsx' : /\.tsv$/i.test(source) ? 'Tsv' : 'Csv');

/** A data file's rows as CSV text (a sheet of a workbook: the one named, or the first). */
async function readDataFile(index: NoteIndex, path: string, kind: DataKind, sheet: string | undefined): Promise<{ body: string; crlf: boolean; book?: Workbook; grid?: SheetGrid }> {
	const blob = await index.readFile(path);
	if (!blob) throw new Error('the file can’t be read');
	if (kind === 'Xlsx') {
		const book = await readWorkbook(new Uint8Array(await blob.arrayBuffer()));
		const grid = await sheetGrid(book, sheet);
		if (!grid) throw new Error('the workbook has no sheet');
		// an empty row stays a row (a blank line would be skipped, and the rows below would move up)
		return { body: grid.rowList.map((row) => recordText(row) || ',').join('\n'), crlf: false, book, grid };
	}
	const text = (await blob.text()).replace(/^\uFEFF/, '');
	const crlf = text.includes('\r\n');
	const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
	if (kind === 'Tsv') return { body: parseCsv(clean, '\t').map((record) => recordText(record.cellList) || ',').join('\n'), crlf };
	return { body: clean, crlf };
}

export const tableRenderer: Renderer = {
	mount(frame, block, context) {
		installStyle('table', tableStyle);
		const view = new TableView(frame, block, context);
		return {
			update(next, nextContext) {
				view.update(next, nextContext);
				return 'Done';
			},
			destroy: () => view.destroy(),
		};
	},
};
