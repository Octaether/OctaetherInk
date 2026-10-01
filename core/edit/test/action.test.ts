import { describe, expect, it } from 'vitest';
import { NoteModel } from '@octaether/core-model';
import { addColumn, colorRange, indentBlock, insertTemplate, mergeBackward, outdentBlock, splitText, toggleFormat, turnInto } from '../src';

function model(text: string): NoteModel {
	return NoteModel.fromText(text);
}

function key(note: NoteModel, index: number): string {
	return note.document.itemList[index]!.key;
}

describe('splitText (Enter)', () => {
	it('splits a paragraph at the caret', () => {
		const note = model('Hello world\n');
		const next = splitText(note, key(note, 0), 5);
		expect(note.serialize()).toBe('Hello\n\n world\n');
		expect(next.caret).toBe(0);
	});

	it('continues lists with the next marker', () => {
		const note = model('- one\n3. three\n- [x] done\n');
		splitText(note, key(note, 0), 5);
		splitText(note, key(note, 2), 8);
		splitText(note, key(note, 4), 10);
		expect(note.serialize()).toBe('- one\n- \n3. three\n4. \n- [x] done\n- [ ] \n');
	});

	it('ends a list on an empty item and opens a line above when the caret is at the start', () => {
		const note = model('- \n');
		splitText(note, key(note, 0), 2);
		expect(note.bodyOf(key(note, 0))).toBe('');
		const other = model('Words\n');
		const result = splitText(other, key(other, 0), 0);
		expect(other.document.itemList.map((node) => node.body)).toEqual(['', 'Words']);
		expect(result.key).toBe(key(other, 1));
	});
});

describe('mergeBackward (Backspace at start)', () => {
	it('first removes a marker, then joins with the block above and keeps its children', () => {
		const note = model('First\n\n- second\n\t- child\n');
		const second = key(note, 1);
		expect(mergeBackward(note, second)).toEqual({ key: second, caret: 0 });
		const result = mergeBackward(note, second)!;
		expect(result.caret).toBe(5);
		expect(note.serialize()).toBe('Firstsecond\n\t- child\n');
	});
});

describe('indent and outdent (Tab)', () => {
	it('nests under the block above and comes back out', () => {
		const note = model('- a\n- b\n');
		const b = key(note, 1);
		expect(indentBlock(note, b)).toBe(true);
		expect(note.serialize()).toBe('- a\n\t- b\n');
		expect(outdentBlock(note, b)).toBe(true);
		expect(note.serialize()).toBe('- a\n- b\n');
	});
});

describe('turnInto and templates', () => {
	it('keeps the words when switching text kinds, and moves them into other blocks', () => {
		const note = model('- keep me\n');
		const item = key(note, 0);
		expect(turnInto(note, item, '# ')).toBe(item);
		expect(note.bodyOf(item)).toBe('# keep me');
		const math = turnInto(note, item, 'Math:');
		expect(note.get(math)?.type).toBe('Math');
		expect(note.serialize()).toBe('Math: keep me\n');
	});

	it('inserts templates, including an empty paragraph', () => {
		const note = model('Intro\n');
		const [grid] = insertTemplate(note, null, key(note, 0), 'Grid:\n\tColumn:\n\t\tLeft\n\tColumn:\n\t\tRight');
		expect(note.get(grid!)?.childList).toHaveLength(2);
		const [empty] = insertTemplate(note, null, null, '');
		expect(note.bodyOf(empty!)).toBe('');
	});
});

describe('addColumn', () => {
	it('adds a column beside a column and rescales % widths, keeping their proportions', () => {
		const note = model('Grid:\n\tColumn {Width: 70%}:\n\t\tLeft\n\tColumn {Width: 30%}:\n\t\tRight\n');
		const [left] = note.childListOf(key(note, 0));
		addColumn(note, left!.key, 'Right');
		expect(note.serialize()).toBe(
			'Grid:\n\tColumn {Width: 46.7%}:\n\t\tLeft\n\tColumn {Width: 33.3%}:\n\t\tNew column\n\tColumn {Width: 20%}:\n\t\tRight\n',
		);
		note.undo();
		expect(note.serialize()).toBe('Grid:\n\tColumn {Width: 70%}:\n\t\tLeft\n\tColumn {Width: 30%}:\n\t\tRight\n');
	});

	it('puts a column on its own into a grid first, and leaves unsized columns unsized', () => {
		const note = model('Intro\n\nColumn:\n\tAlone\n');
		const added = addColumn(note, key(note, 1), 'Left');
		expect(note.serialize()).toBe('Intro\n\nGrid:\n\tColumn:\n\t\tNew column\n\tColumn:\n\t\tAlone\n');
		expect(note.parentOf(added)?.type).toBe('Grid');
	});
});

describe('inline format', () => {
	it('wraps and unwraps a selection', () => {
		expect(toggleFormat('a word b', 2, 6, 'Bold')).toEqual({ text: 'a **word** b', start: 4, end: 8 });
		expect(toggleFormat('a **word** b', 4, 8, 'Bold')).toEqual({ text: 'a word b', start: 2, end: 6 });
		expect(toggleFormat('a **word** b', 2, 10, 'Bold')).toEqual({ text: 'a word b', start: 2, end: 6 });
		expect(toggleFormat('x', 0, 1, 'Link').text).toBe('[x](https://)');
	});

	it('colours with theme tokens and removes the colour again', () => {
		const coloured = colorRange('a hot day', 2, 5, 'Danger');
		expect(coloured.text).toBe('a [hot]{Color: Danger} day');
		expect(colorRange(coloured.text, 2, 22, undefined).text).toBe('a hot day');
	});
});
