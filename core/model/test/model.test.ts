import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBlockNode, createTextNode } from '@octaether/core-format';
import { type Change, ModelError, NoteModel } from '../src';

const welcome = readFileSync(new URL('../../../sample/Reference.oi', import.meta.url), 'utf8');

function changedLineList(before: string, after: string): string[] {
	const beforeList = before.split('\n');
	return after.split('\n').filter((line, index) => line !== beforeList[index]);
}

/** Keys of the top-level blocks, and of the first blocks' children, in order. */
function top(model: NoteModel): string[] {
	return model.document.itemList.map((node) => node.key);
}

describe('NoteModel', () => {
	it('loads a note without adding anything to it', () => {
		const model = NoteModel.fromText(welcome);
		expect(model.serialize()).toBe(welcome);
		expect(model.keyList()).toHaveLength(26);
	});

	it('sets a body, undoes to the exact bytes, and redoes', () => {
		const model = NoteModel.fromText(welcome);
		const math = top(model)[7]!;
		model.setBody(math, 'x^2 + y^2');
		expect(changedLineList(welcome, model.serialize())).toEqual(['Math: x^2 + y^2']);
		model.undo();
		expect(model.serialize()).toBe(welcome);
		model.redo();
		expect(model.bodyOf(math)).toBe('x^2 + y^2');
	});

	it('coalesces typing into one undo step', () => {
		const model = NoteModel.fromText(welcome);
		const paragraph = top(model)[1]!;
		for (const body of ['a', 'ab', 'abc']) model.setBody(paragraph, body, { coalesceKey: `Type:${paragraph}` });
		model.undo();
		expect(model.serialize()).toBe(welcome);
	});

	it('styles a paragraph with trailing props and removes them again', () => {
		const model = NoteModel.fromText(welcome);
		const paragraph = top(model)[1]!;
		model.setProperty(paragraph, 'Color', 'Accent');
		expect(model.serialize()).toContain('handle to move a block. {Color: Accent}\n');
		model.setProperty(paragraph, 'Color', undefined);
		expect(model.serialize()).toBe(welcome);
	});

	it('nests and un-nests blocks, and every step reads back the same', () => {
		const model = NoteModel.fromText(welcome);
		const [heading, first, second] = top(model);
		model.move(second!, first!, null);
		expect(model.parentOf(second!)?.key).toBe(first);
		const inserted = model.insert(heading!, null, createTextNode('- under the heading'));
		model.move(first!, null, heading!);
		const text = model.serialize();
		expect(NoteModel.fromText(text).serialize()).toBe(text);
		expect(text.startsWith('---')).toBe(true);
		expect(text).toContain('# Welcome to Octaether Ink\n\t- under the heading\n');
		expect(model.bodyOf(inserted)).toBe('- under the heading');
	});

	it('restores exact bytes after undoing a delete and a move', () => {
		const model = NoteModel.fromText(welcome);
		const keyList = top(model);
		model.delete(keyList[5]!);
		model.move(keyList[9]!, null, keyList[1]!);
		model.undo();
		model.undo();
		expect(model.serialize()).toBe(welcome);
	});

	it('refuses impossible moves and leaves the note untouched', () => {
		const model = NoteModel.fromText(welcome);
		const group = top(model)[5]!;
		const math = top(model)[7]!;
		expect(() => model.move(group, group, null)).toThrow(ModelError);
		expect(() => model.move(group, math, null)).toThrow(/cannot hold blocks/);
		expect(model.serialize()).toBe(welcome);
		expect(model.canUndo()).toBe(false);
	});

	it('reports what changed', () => {
		const model = NoteModel.fromText(welcome);
		const changeList: Change[] = [];
		model.subscribe((change) => changeList.push(change));
		const math = top(model)[8]!;
		model.setBody(math, 'y');
		model.insert(null, null, createBlockNode('Math', { body: 'z' }));
		expect([...changeList[0]!.changedKeySet]).toEqual([math]);
		expect(changeList[0]!.structure).toBe(false);
		expect(changeList[1]!.structure).toBe(true);
		expect(model.revision).toBe(2);
	});

	it('changes one note property line', () => {
		const model = NoteModel.fromText(welcome);
		model.setNoteProperty('Title', 'Renamed');
		expect(changedLineList(welcome, model.serialize())).toEqual(['Title: Renamed']);
	});

	it('replaces the whole text as one undo step and keeps the keys of blocks that did not change', () => {
		const model = NoteModel.fromText('First\n\nSecond\n\nThird\n');
		const [first, second, third] = model.document.itemList.map((node) => node.key);
		const changeList: Change[] = [];
		model.subscribe((change) => changeList.push(change));
		model.setText('First\n\nSecond, edited\n\nThird\n');
		expect(model.document.itemList.map((node) => node.key)).toEqual([first, expect.not.stringMatching(second!), third]);
		expect(changeList[0]!.structure).toBe(true);
		model.undo();
		expect(model.serialize()).toBe('First\n\nSecond\n\nThird\n');
		model.setText(model.serialize());
		expect(model.canRedo()).toBe(true);
	});

	it('adds new note properties above the system fields', () => {
		const model = NoteModel.fromText('---\nId: 01k6b9x2m4q7r8s3t5v6w9y0za\nFormat: Oi 1\n---\n\nHello\n');
		model.setNoteProperty('Tag', ['Chem']);
		expect(model.serialize()).toBe('---\nTag: [Chem]\nId: 01k6b9x2m4q7r8s3t5v6w9y0za\nFormat: Oi 1\n---\n\nHello\n');
	});

	it('parses templates with the same rules as the note', () => {
		const model = NoteModel.fromText('');
		const [grid] = model.parseFragment('Grid:\n\tColumn:\n\t\tLeft\n\tColumn:\n\t\tRight\n');
		const key = model.insert(null, null, grid!);
		expect(model.get(key)?.childList.map((column) => column.type)).toEqual(['Column', 'Column']);
		expect(model.serialize()).toBe('Grid:\n\tColumn:\n\t\tLeft\n\tColumn:\n\t\tRight\n');
	});

	it('keeps actions outside the text (a rename) in order with the edits', () => {
		const model = NoteModel.fromText('a\n');
		const logList: string[] = [];
		const key = model.document.itemList[0]!.key;
		model.setBody(key, 'b');
		model.record({ label: 'Rename', undo: () => logList.push('undo rename'), redo: () => logList.push('redo rename') });
		model.setBody(key, 'c');
		expect(model.undoAction()).toBeUndefined();
		model.undo();
		expect(model.bodyOf(key)).toBe('b');
		expect(model.undoAction()).toBe('Rename');
		model.undo();
		expect(logList).toEqual(['undo rename']);
		model.undo();
		expect(model.bodyOf(key)).toBe('a');
		model.redo();
		model.redo();
		expect(logList).toEqual(['undo rename', 'redo rename']);
		expect(model.bodyOf(key)).toBe('b');
		// a new edit drops what could be redone
		model.setBody(key, 'd');
		expect(model.canRedo()).toBe(false);
	});

	it('changes a block’s own source, header included, keeping its key and the lines as typed', () => {
		const model = NoteModel.fromText('- item\n\tMath: x^2\n\nAfter\n');
		const math = model.document.itemList[0]!.childList[0]!.key;
		expect(model.sourceOf(math)).toBe('Math: x^2');
		const changeList: Change[] = [];
		model.subscribe((change) => changeList.push(change));
		model.setSource(math, 'Chem {Size:2}: H_2O');
		expect(model.get(math)).toMatchObject({ type: 'Chem', body: 'H_2O', level: 1 });
		expect(model.get(math)!.property.get('Size')).toBe(2);
		expect(model.serialize()).toBe('- item\n\tChem {Size:2}: H_2O\n\nAfter\n');
		expect([...changeList[0]!.changedKeySet]).toEqual([math]);
		model.setSource(math, '```Python\nprint(1)\n```');
		expect(model.get(math)).toMatchObject({ type: 'Code', alias: '```', body: 'print(1)' });
		expect(model.serialize()).toBe('- item\n\t```Python\n\tprint(1)\n\t```\n\nAfter\n');
		model.undo();
		model.undo();
		expect(model.serialize()).toBe('- item\n\tMath: x^2\n\nAfter\n');
		expect(() => model.setSource(math, 'Math: a\n\nMath: b')).toThrow(ModelError);
	});

	it('keeps the blocks inside a block whose header changes, and reads the text as the file will', () => {
		const model = NoteModel.fromText('Callout {Kind: Tip}: Title\n\tInside\n');
		const callout = model.document.itemList[0]!.key;
		expect(() => model.setSource(callout, 'Math: x')).toThrow(/can't hold/);
		// with blocks inside, "Note:" reads as a block of the unknown type Note (which holds only text),
		// so a paragraph that says "Note:" is written with a backslash
		expect(() => model.setSource(callout, 'Note:')).toThrow(/can't hold/);
		model.setSource(callout, '\\Note:');
		expect(model.get(callout)).toMatchObject({ type: 'Text', body: 'Note:' });
		expect(model.serialize()).toBe('\\Note:\n\tInside\n');
		expect(NoteModel.fromText(model.serialize()).document.itemList[0]).toMatchObject({ type: 'Text', body: 'Note:' });
	});

	it('reads the note again when the aliases change', () => {
		let aliasOn = true;
		const model = NoteModel.fromText('Intro\n\n$$x$$\n', { aliasList: () => (aliasOn ? [{ marker: '$$', type: 'Math', opening: 'Body' }] : []) });
		const intro = model.document.itemList[0]!.key;
		expect(model.document.itemList[1]!.type).toBe('Math');
		model.setBody(intro, 'Intro, edited');
		aliasOn = false;
		model.reparse();
		expect(model.document.itemList.map((node) => node.type)).toEqual(['Text', 'Text']);
		expect(model.document.itemList[0]!.key).not.toBe(intro);
		// the history spoke of blocks that read differently now
		expect(model.canUndo()).toBe(false);
		expect(model.serialize()).toBe('Intro, edited\n\n$$x$$\n');
	});
});
