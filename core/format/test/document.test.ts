import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	type BlockNode,
	type NoteDocument,
	assignBlockId,
	collectIdSet,
	createBlockId,
	createBlockNode,
	createNote,
	createNoteId,
	createTextNode,
	editorOffset,
	ensureNoteProperty,
	markChanged,
	markChildChanged,
	ownSourceText,
	parseDocument,
	parseNote,
	type PropertyValue,
	readSource,
	blockSource,
	sectionToMap,
	serializeDocument,
	walkNode,
} from '../src';

const guideFolder = new URL('../../../sample/Guide/', import.meta.url);
const guideMap = new Map(readdirSync(guideFolder).filter((name) => name.endsWith('.oi')).map((name) => [name.slice(0, -3), readFileSync(new URL(name, guideFolder), 'utf8')]));
const welcome = guideMap.get('Welcome')!;
const reference = readFileSync(new URL('../../../sample/Reference.oi', import.meta.url), 'utf8');

function note(...lineList: string[]): NoteDocument {
	return parseNote(lineList.join('\n') + '\n');
}

function shape(nodeList: readonly BlockNode[]): unknown[] {
	return nodeList.map((node) => ({
		type: node.type,
		body: node.body,
		...(node.property.size > 0 ? { property: Object.fromEntries(node.property) } : {}),
		...(node.id ? { id: node.id } : {}),
		...(node.childList.length > 0 ? { child: shape(node.childList) } : {}),
	}));
}

function typeTree(nodeList: readonly BlockNode[]): unknown[] {
	return nodeList.map((node) => (node.childList.length > 0 ? [node.type, typeTree(node.childList)] : node.type));
}

describe('parseNote', () => {
	it('reads every guide note with no problem and writes it back byte for byte', () => {
		// the guide is notes people edit, so this checks what they show, not where
		expect([...guideMap.keys()].sort()).toEqual(['Chemistry', 'Code', 'Diagram', 'HTML', 'Image', 'Layout', 'Markdown', 'Math', 'Property', 'Text', 'Video', 'Welcome', 'Workspace']);
		const typeSet = new Set<string>();
		for (const [name, text] of guideMap) {
			const document = parseNote(text);
			expect(document.problemList, name).toEqual([]);
			expect(collectIdSet(document).size, name).toBe(0);
			expect(serializeDocument(document), name).toBe(text);
			// each guide has a Property block tagged Guide; it is a block like any other, so it needn't come first
			const property = document.itemList.find((node) => node.type === 'Property');
			expect(property?.body, name).toMatch(/^Tag: \[Guide/);
			walkNode(document.itemList, (node) => typeSet.add(node.type));
		}
		expect(typeSet).toEqual(new Set(['Property', 'Text', 'Math', 'Callout', 'Code', 'Chem', 'Grid', 'Column', 'Diagram', 'Image', 'Video', 'Markdown', 'HTML']));
		// the file after `Image:` and `Video:` is a property, the caption is the body
		const image = parseNote(guideMap.get('Image')!).itemList.find((node) => node.type === 'Image')!;
		expect(Object.fromEntries(image.property)).toEqual({ Source: 'Octahedron.svg', Width: 220 });
		expect(image.body).toBe('The Octaether octahedron: its lower half is a pen **nib**.');
		// the Property guide shows its block after the first paragraph: it is optional, and can sit anywhere
		expect(parseNote(guideMap.get('Property')!).itemList[0]!.type).toBe('Text');
		// the welcome note links to every other guide (the graph view shows them as a map)
		for (const name of guideMap.keys()) if (name !== 'Welcome') expect(welcome).toContain(`[[${name}]]`);
		const document = parseNote(welcome);
		expect(typeTree(document.itemList.filter((node) => node.body.startsWith('- Blocks hold blocks')))).toEqual([['Text', [['Text', ['Math']]]]]);
		// the guides show `Code: Python` first, and the aliases (``` for code, $$ for math) too
		const codeList = parseNote(guideMap.get('Code')!).itemList.filter((node) => node.type === 'Code');
		expect(codeList[0]).toMatchObject({ property: new Map([['Language', 'Python']]) });
		expect(codeList[0]!.alias).toBeUndefined();
		expect(codeList.some((node) => node.alias === '```')).toBe(true);
		expect(parseNote(guideMap.get('Math')!).itemList.some((node) => node.type === 'Math' && node.alias === '$$')).toBe(true);
	});

	it('reads blocks: a known type with a colon, or props, or an ID', () => {
		const document = note('Math: x^2', '', 'Summary: it works', '', 'Sheet: A1', '', 'Sheet {Rows: 3}:', '', 'Plain ^ab1c:', '', 'Thanks');
		expect(shape(document.itemList)).toEqual([
			{ type: 'Math', body: 'x^2' },
			{ type: 'Text', body: 'Summary: it works' },
			{ type: 'Text', body: 'Sheet: A1' },
			{ type: 'Sheet', body: '', property: { Rows: 3 } },
			{ type: 'Plain', body: '', id: 'ab1c' },
			{ type: 'Text', body: 'Thanks' },
		]);
	});

	it('keeps raw bodies verbatim, even when they look like blocks', () => {
		const document = note('Code {Language: Python}:', '\tMath: not a block', '\tif x:', '\t\tpass', '', '\tprint(x)');
		expect(document.itemList[0]!.body).toBe('Math: not a block\nif x:\n\tpass\n\nprint(x)');
	});

	it('lets text and container blocks hold children', () => {
		const document = note('# Section', '\tA paragraph in the section.', '\t- item', '\t\tMath: y', '', 'Group:', '', '\tInside after a blank line.');
		expect(shape(document.itemList)).toEqual([
			{
				type: 'Text',
				body: '# Section',
				child: [
					{ type: 'Text', body: 'A paragraph in the section.' },
					{ type: 'Text', body: '- item', child: [{ type: 'Math', body: 'y' }] },
				],
			},
			{ type: 'Group', body: '', child: [{ type: 'Text', body: 'Inside after a blank line.' }] },
		]);
	});

	it('splits list items into blocks and keeps continuation lines', () => {
		const document = note('- one', '  more of one', '- two', '1. first', 'para line one', 'para line two');
		expect(shape(document.itemList)).toEqual([
			{ type: 'Text', body: '- one\n  more of one' },
			{ type: 'Text', body: '- two' },
			{ type: 'Text', body: '1. first' },
			{ type: 'Text', body: 'para line one\npara line two' },
		]);
	});

	it('reads trailing props and IDs on text, and escaped look-alikes', () => {
		const document = note('Warm words. {Color: Accent} ^wd1a', '', '## Title {Size: 20px}', '', 'Literal \\{Color: Red}', '', 'Math in text $\\{x\\}$ {not: props}');
		expect(shape(document.itemList)).toEqual([
			{ type: 'Text', body: 'Warm words.', property: { Color: 'Accent' }, id: 'wd1a' },
			{ type: 'Text', body: '## Title', property: { Size: '20px' } },
			{ type: 'Text', body: 'Literal {Color: Red}' },
			{ type: 'Text', body: 'Math in text $\\{x\\}$ {not: props}' },
		]);
	});

	it('reads multi-line block properties and 4-space indentation', () => {
		const document = note('Plot {', '    Width: 45%', '    XRange: [-3, 3]', '}:', '    f(x) = x^3');
		expect(shape(document.itemList)).toEqual([{ type: 'Plot', body: 'f(x) = x^3', property: { Width: '45%', XRange: [-3, 3] } }]);
	});

	it('parses property documents (meta files)', () => {
		const document = parseDocument('Kind: Setting\nFormat: Oi 1\n\nEditor:\n\tClickToEdit: DoubleClick\n');
		expect(document.kind).toBe('Property');
		if (document.kind !== 'Property') return;
		expect((sectionToMap(document.section).get('Editor') as Map<string, unknown>).get('ClickToEdit')).toBe('DoubleClick');
	});
});

describe('round trip', () => {
	it('writes the sample back byte for byte', () => {
		expect(serializeDocument(parseDocument(welcome))).toBe(welcome);
		expect(serializeDocument(parseDocument(reference))).toBe(reference);
	});

	it('keeps CRLF, BOM, odd spacing, and a missing final newline', () => {
		const source = '\uFEFF---\r\nTitle:   Spaced\r\n---\r\n\r\n\r\nMath:   x\r\n  indented prose';
		expect(serializeDocument(parseDocument(source))).toBe(source);
	});

	it('rewrites only the block that changed, even deep inside another block', () => {
		const document = parseNote(reference);
		const nestedMath = document.itemList[4]!.childList[1]!.childList[0]!;
		nestedMath.body = 'x + y';
		markChanged(document, nestedMath);
		const before = reference.split('\n');
		const after = serializeDocument(document).split('\n');
		expect(after.filter((line, index) => line !== before[index])).toEqual(['\t\tMath: x + y']);
	});

	it('keeps the parent lines as written when only its children change', () => {
		const document = parseNote('- parent  {Color: Accent}\n\t- child\n');
		const parent = document.itemList[0]!;
		parent.childList.push({ ...createTextNode('- added'), level: 1 });
		markChildChanged(document, parent);
		expect(serializeDocument(document)).toBe('- parent  {Color: Accent}\n\t- child\n\t- added\n');
	});

	it('writes new blocks canonically and reads them back the same', () => {
		const document = createNote();
		const grid = createBlockNode('Grid', {
			childList: [
				{ ...createBlockNode('Column', { property: new Map([['Width', '50%']]), childList: [{ ...createTextNode('left'), level: 2 }] }), level: 1 },
				{ ...createBlockNode('Column', { childList: [{ ...createBlockNode('Math', { body: 'a\nb' }), level: 2 }] }), level: 1 },
			],
		});
		document.itemList.push(createTextNode('- one'), createTextNode('- two', { property: new Map([['Color', 'Danger']]) }), grid);
		const text = serializeDocument(document);
		// typed siblings inside a block (Column after Column) need no blank line between them
		expect(text).toBe('- one\n- two {Color: Danger}\n\nGrid:\n\tColumn {Width: 50%}:\n\t\tleft\n\tColumn:\n\t\tMath:\n\t\t\ta\n\t\t\tb\n');
		expect(shape(parseNote(text).itemList)).toEqual(shape(document.itemList));
	});

	it('escapes text that would read as a block, as properties, or as an ID', () => {
		const document = createNote();
		const textList = ['Math: in prose', 'Summary:', 'Thanks', 'ends with {Color: Red}', 'ends with ^word1', 'literal \\^word2', 'x \\{Size: 2px}'];
		const nodeList = textList.map((text) => createTextNode(text));
		nodeList[1]!.childList.push({ ...createTextNode('child makes the colon look like a block'), level: 1 });
		document.itemList.push(...nodeList);
		const text = serializeDocument(document);
		expect(text).toContain('\\Math: in prose');
		expect(text).toContain('\\Summary:');
		expect(text).toContain('ends with \\{Color: Red}');
		expect(text).toContain('ends with \\^word1');
		const back = parseNote(text).itemList;
		expect(back.map((node) => node.body)).toEqual(textList);
		expect(back.every((node) => node.type === 'Text' && node.property.size === 0)).toBe(true);
	});
});

describe('id', () => {
	it('creates lowercase block IDs with a letter, avoiding taken ones', () => {
		const taken = new Set<string>();
		for (let index = 0; index < 300; index++) {
			const id = createBlockId(taken);
			expect(id).toMatch(/^[a-z0-9]{4,}$/);
			expect(id).toMatch(/[a-z]/);
			expect(taken.has(id)).toBe(false);
			taken.add(id);
		}
	});

	it('creates 26-char lowercase ULIDs that sort by time', () => {
		const first = createNoteId(1_000_000);
		expect(first).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
		expect(first < createNoteId(2_000_000)).toBe(true);
	});

	it('assigns an ID only when asked, and writes it', () => {
		const document = note('Some  *text*  here');
		const id = assignBlockId(document, document.itemList[0]!);
		expect(serializeDocument(document)).toBe(`Some  *text*  here ^${id}\n`);
	});

	it('adds Id and Format properties to a note that has none', () => {
		const document = note('Hello');
		expect(ensureNoteProperty(document)).toBe(true);
		expect(serializeDocument(document)).toMatch(/^---\nId: [0-9a-z]{26}\nFormat: Oi 1\n---\n\nHello\n$/);
	});
});

describe('header arguments', () => {
	it('reads the main property after the colon, and every other one in {…} as for any block', () => {
		const document = note(
			'Code: Python',
			'\tprint(1)',
			'',
			'Code {Wrap: True, LineNumber: False}: Python',
			'\tx',
			'',
			'Code {Language: Rust}:',
			'\tfn main() {}',
			'',
			'Image {Width: 320}: My photo, 2.png',
			'\tA caption',
			'',
			'Image: "  spaced.png"',
		);
		expect(shape(document.itemList)).toEqual([
			{ type: 'Code', body: 'print(1)', property: { Language: 'Python' } },
			{ type: 'Code', body: 'x', property: { Language: 'Python', Wrap: true, LineNumber: false } },
			{ type: 'Code', body: 'fn main() {}', property: { Language: 'Rust' } },
			// a value is taken as it is written: no quotes needed for a comma
			{ type: 'Image', body: 'A caption', property: { Source: 'My photo, 2.png', Width: 320 } },
			{ type: 'Image', body: '', property: { Source: '  spaced.png' } },
		]);
		expect(document.problemList).toEqual([]);
		// a type without an argument keeps its one-line body after the colon
		expect(shape(note('Math {Numbered: True}: x = 1').itemList)).toEqual([{ type: 'Math', body: 'x = 1', property: { Numbered: true } }]);
	});

	it('writes the argument after the colon, the rest in {…}, the body indented, and reads it back', () => {
		const document = createNote();
		document.itemList.push(
			createBlockNode('Code', { property: new Map<string, PropertyValue>([['Language', 'Python'], ['Wrap', true]]), body: 'print(1)' }),
			createBlockNode('Code', { body: 'x' }),
			createBlockNode('Image', { property: new Map<string, PropertyValue>([['Source', 'photo, 2.png'], ['Width', 320]]) }),
			// what can't be written as it is stays in the braces
			createBlockNode('Image', { property: new Map<string, PropertyValue>([['Source', ' padded.png']]) }),
			createBlockNode('Code', { property: new Map<string, PropertyValue>([['Language', 3]]), body: 'y' }),
		);
		const text = serializeDocument(document);
		expect(text).toBe(
			'Code {Wrap: True}: Python\n\tprint(1)\n\nCode:\n\tx\n\nImage {Width: 320}: photo, 2.png\n\nImage {Source: " padded.png"}:\n\nCode {Language: 3}:\n\ty\n',
		);
		expect(shape(parseNote(text).itemList)).toEqual(shape(document.itemList));
	});
});

describe('aliases', () => {
	it('reads ``` and ~~~ code with its language, keeping the body verbatim', () => {
		const document = note('Intro', '```python', 'def f():', '    return 1', '', 'x = 2', '```', '~~~', 'plain', '~~~');
		expect(shape(document.itemList)).toEqual([
			{ type: 'Text', body: 'Intro' },
			{ type: 'Code', body: 'def f():\n    return 1\n\nx = 2', property: { Language: 'python' } },
			{ type: 'Code', body: 'plain' },
		]);
		expect(document.itemList[1]!.alias).toBe('```');
		expect(serializeDocument(document)).toBe('Intro\n```python\ndef f():\n    return 1\n\nx = 2\n```\n~~~\nplain\n~~~\n');
	});

	it('reads $$ math on one line or several, and leaves single dollar signs as text', () => {
		const lineList = ['$$ E = mc^2 $$', '', 'It costs $5, or $10 with tax.', '', '$$', 'a^2', '+ b^2 $$', '', '$$ not closed', '', 'Math: E = mc^2'];
		const document = note(...lineList);
		expect(shape(document.itemList)).toEqual([
			{ type: 'Math', body: 'E = mc^2' },
			{ type: 'Text', body: 'It costs $5, or $10 with tax.' },
			{ type: 'Math', body: 'a^2\n+ b^2' },
			{ type: 'Text', body: '$$ not closed' },
			{ type: 'Math', body: 'E = mc^2' },
		]);
		expect(serializeDocument(document)).toBe(`${lineList.join('\n')}\n`);
	});

	it('can be switched off or changed: the lines are text again, or open with other symbols', () => {
		const text = '```Python\nprint(1)\n```\n\n%%\nx^2\n%%\n';
		expect(parseNote(text, { aliasList: () => [] }).itemList.map((node) => node.type)).toEqual(['Text', 'Text']);
		const custom = parseNote(text, { aliasList: () => [{ marker: '%%', type: 'Math', opening: 'Body' }] });
		expect(shape(custom.itemList)).toEqual([
			{ type: 'Text', body: '```Python\nprint(1)\n```' },
			{ type: 'Math', body: 'x^2' },
		]);
	});

	it('nests aliases inside other blocks and writes changed ones canonically', () => {
		const document = note('- item', '\t```js {Width: 50%} ^code', '\tlet a = 1', '\t```');
		const code = document.itemList[0]!.childList[0]!;
		expect(code).toMatchObject({ type: 'Code', id: 'code', body: 'let a = 1' });
		expect(Object.fromEntries(code.property)).toEqual({ Language: 'js', Width: '50%' });
		code.body = 'let a = 2\n```inner fence';
		markChanged(document, code);
		// the fence grows so the body's own ``` line can't close it
		expect(serializeDocument(document)).toBe('- item\n\t````js {Width: 50%} ^code\n\tlet a = 2\n\t```inner fence\n\t````\n');
	});

	it('writes an edited block with its alias, or with Type: when the alias is off or can’t hold it', () => {
		const document = note('$$', 'a', '$$', '', '```Python', 'x', '```');
		const [math, code] = document.itemList;
		math!.body = 'b';
		markChanged(document, math!);
		code!.body = 'y';
		markChanged(document, code!);
		expect(serializeDocument(document)).toBe('$$\nb\n$$\n\n```Python\ny\n```\n');
		expect(serializeDocument(document, { aliasList: () => [] })).toBe('Math: b\n\nCode: Python\n\ty\n');
		// $$ holds no properties
		math!.property.set('Numbered', true);
		markChanged(document, math!);
		expect(serializeDocument(document)).toBe('Math {Numbered: True}: b\n\n```Python\ny\n```\n');
	});

	it('writes new blocks and escapes text that starts like an alias', () => {
		const document = createNote();
		document.itemList.push(
			createBlockNode('Code', { alias: '```', property: new Map([['Language', 'Python']]), body: 'print(1)' }),
			createTextNode('```not a fence\n$$ is just text'),
			createTextNode('\\$$ starts with a backslash'),
			createBlockNode('Math', { body: 'x^2' }),
		);
		const text = serializeDocument(document);
		expect(text).toBe('```Python\nprint(1)\n```\n\n\\```not a fence\n\\$$ is just text\n\n\\\\$$ starts with a backslash\n\nMath: x^2\n');
		expect(shape(parseNote(text).itemList)).toEqual(shape(document.itemList));
	});

	it('keeps an unclosed fence as code up to the end of its block and reports it', () => {
		const document = note('```', 'open', '', '');
		expect(shape(document.itemList)).toEqual([{ type: 'Code', body: 'open' }]);
		expect(document.problemList[0]!.message).toMatch(/not closed/);
	});
});

describe('block source (the block editor)', () => {
	it('gives a block’s own lines, where its body lines start, and room to type an empty body', () => {
		const document = note('- item', '\tMath {Numbered: True}:', '\t\ta', '\t\tb', '\t```Python', '\tx = 1', '\t```', '\t$$c$$', '\tCode: Python');
		const [math, code, dollar, empty] = document.itemList[0]!.childList;
		expect(ownSourceText(math!)).toBe('Math {Numbered: True}:\n\ta\n\tb');
		expect(blockSource(math!)).toEqual({ text: 'Math {Numbered: True}:\n\ta\n\tb', lineStartList: [24, 27] });
		expect(blockSource(code!)).toEqual({ text: '```Python\nx = 1\n```', lineStartList: [10] });
		expect(blockSource(dollar!)).toEqual({ text: '$$c$$', lineStartList: [2] });
		expect(blockSource(empty!).text).toBe('Code: Python\n\t');
		expect(blockSource(createBlockNode('Math')).text).toBe('Math: ');
		expect(blockSource(createBlockNode('Code', { alias: '```' })).text).toBe('```\n\n```');
		// a click on the second body line lands there in the editor
		expect(editorOffset('a\nb', [24, 27], 28, 2)).toBe(27);
	});

	it('reads an editor’s text as blocks, with no property section', () => {
		const read = readSource('---\n\nChem: H_2O\n\nMath: x');
		expect(read.itemList.map((node) => node.type)).toEqual(['Text', 'Chem', 'Math']);
		expect(read.lineStartMap.get(read.itemList[2]!.key)).toEqual([23]);
	});
});
