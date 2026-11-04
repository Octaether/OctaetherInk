// Table module: data you type into like a spreadsheet, kept as CSV in the note, with column types,
// formulas, Filter, Sort, Group, a summary per column, and Board, Gallery, and List layouts; or the
// notes of a folder or tag as rows (`Source`), so a table works like a database. Plot and Calendar
// read tables through TableData. The view loads the first time a table shows.
//
//   Table {Title: Gym log, Column: {Calorie: {Unit: kcal, Summary: Average}}, Sort: {Date: Down}}:
//   	Date,Workout,Calorie
//   	2026-11-01,Legs,520

import { type BlockTypeDefinition, type ModuleDefinition, type NoteIndex, type TableData, lazyRenderer, noteIndexExtension, tableDataExtension } from '@octaether/core-sdk';
import { findTableNode, parseReference } from './reference';

export { parseCsv, parsePasted, recordText, writeCsv, writeTsv } from './csv';
export { parseReference } from './reference';


/** Reads tables for Plot and Calendar; the reading code loads when it is first asked for. */
const tableData: TableData = {
	read: (context, reference) => import('./data').then((module) => module.readTableData(context, reference)),
	watch(context, reference, listener) {
		const parsed = parseReference(reference);
		const cleanupList: (() => void)[] = [];
		// a table in this note: when it (or the structure around it) changes
		cleanupList.push(
			context.note.subscribe((change) => {
				if (!parsed || parsed.note) return;
				const node = findTableNode(context.note.document.itemList, parsed);
				if (change.structure || (node && change.changedKeySet.has(node.key))) listener();
			}),
		);
		// a table in another note, or a table of notes: whenever the vault changes
		const index = context.extension<NoteIndex>(noteIndexExtension);
		if (index) cleanupList.push(index.subscribe(listener));
		return () => {
			for (const cleanup of cleanupList) cleanup();
		};
	},
};

const tableType: BlockTypeDefinition = {
	name: 'Table',
	content: 'Raw',
	render: lazyRenderer(() => import('./view').then((module) => module.tableRenderer)),
	edit: { kind: 'Structured' },
	// Table: Data/Gym.csv shows (and edits) a data file
	argument: 'File',
	token: { 'Table.HeaderBackground': { Light: '#f1efea', Dark: '#2a2927' } },
	frameClassList: () => ['oi-table-frame'],
	fillPage: true,
	templateList: [
		{ title: 'Table', icon: '▦', source: 'Table:\n\tName,Date,Number\n\t,,', keywordList: ['table', 'spreadsheet', 'csv', 'data', 'database', 'grid'], explain: 'Rows and columns you type into, like a spreadsheet' },
		{
			title: 'Gym log',
			icon: '▦',
			source:
				'Table {Title: Gym log, Column: {Calorie: {Unit: kcal, Summary: Average}, Weight: {Unit: kg, Summary: Average}}, Sort: {Date: Down}}:\n\tDate,Workout,Calorie,Weight\n\t2026-11-02,Legs,520,72.4\n\t2026-11-04,Push,410,72.1\n\t2026-11-06,Pull,450,71.9',
			keywordList: ['gym', 'workout', 'fitness', 'calorie', 'weight', 'tracker', 'log'],
			explain: 'Workouts, calories, and weight, with averages',
		},
		{
			title: 'Expense',
			icon: '▦',
			source:
				'Table {Title: Spending, Column: {Amount: {Unit: $, Summary: Sum}}, Group: {Date: Month}}:\n\tDate,Item,Category,Amount\n\t2026-11-01,Groceries,Food,54.20\n\t2026-11-03,Bus pass,Transport,30\n\t2026-11-05,Coffee,Food,4.50',
			keywordList: ['expense', 'money', 'budget', 'finance', 'spending', 'shopping'],
			explain: 'Spending by month, with totals',
		},
		{
			title: 'Reading list',
			icon: '▦',
			source: 'Table {Show: Board, Column: {Status: {Type: Choice, Choice: [To read, Reading, Done]}}}:\n\tTitle,Author,Status\n\tThe Art of Problem Solving,Paul Zeitz,Reading\n\tPrinciples of Chemistry,Mendeleev,To read',
			keywordList: ['reading', 'books', 'kanban', 'board', 'status'],
			explain: 'Cards in lanes by status',
		},
	],
	plainText: (block) => block.body,
};

export const tableModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Table',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Table',
	explain:
		'Tables you type into like a spreadsheet, kept as CSV in the note: column types, formulas, filters, sorting, groups (by month, by week), a summary per column, Analyze, and Board, Gallery, and List layouts. With Source, the notes of a folder or tag are the rows. Plot and Calendar can show a table.',
	provide: ['TableData'],
	use: ['NoteIndex', 'Menu'],
	settingList: [{ id: 'Table.MaxRow', title: 'Rows shown', type: 'Number', default: 100, explain: 'How many rows a table shows before “Show all”.' }],
	blockTypeList: [tableType],
	activate(host) {
		return host.registerExtension(tableDataExtension, tableData);
	},
};
