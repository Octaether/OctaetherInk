import { describe, expect, it } from 'vitest';
import {
	type PropertyValue,
	formatInline,
	formatPairLineList,
	measureIndent,
	parseBlockMap,
	parsePropertySection,
	parseValueText,
	sectionToMap,
	serializeSection,
	setSectionValue,
	valueEqual,
} from '../src';

describe('parseValueText', () => {
	it('reads keywords case-sensitively', () => {
		expect(parseValueText('True').value).toBe(true);
		expect(parseValueText('False').value).toBe(false);
		expect(parseValueText('None').value).toBe(null);
		expect(parseValueText('true').value).toBe('true');
	});

	it('reads numbers but keeps look-alikes as text', () => {
		expect(parseValueText('12').value).toBe(12);
		expect(parseValueText('-3.5').value).toBe(-3.5);
		expect(parseValueText('1e-3').value).toBe(0.001);
		expect(parseValueText('05').value).toBe('05');
		expect(parseValueText('55%').value).toBe('55%');
		expect(parseValueText('1.4.0').value).toBe('1.4.0');
	});

	it('reads flow lists and maps', () => {
		expect(parseValueText('[Chem, Lecture 05, "SN1, SN2"]').value).toEqual(['Chem', 'Lecture 05', 'SN1, SN2']);
		const map = parseValueText('{Width: 1px, Nested: {Flag: True, List: [1, 2]}}').value as Map<string, PropertyValue>;
		expect(map.get('Width')).toBe('1px');
		expect((map.get('Nested') as Map<string, PropertyValue>).get('List')).toEqual([1, 2]);
	});

	it('keeps # and : inside values', () => {
		expect(parseValueText('#e6e6e6').value).toBe('#e6e6e6');
		const map = parseValueText('{Color: #e6e6e6, Start: 2026-09-29 10:02}').value as Map<string, PropertyValue>;
		expect(map.get('Color')).toBe('#e6e6e6');
		expect(map.get('Start')).toBe('2026-09-29 10:02');
	});

	it('falls back to text and reports a problem on broken flow', () => {
		const result = parseValueText('[a, b');
		expect(result.value).toBe('[a, b');
		expect(result.problem).toBeDefined();
	});
});

describe('property section', () => {
	const lineList = [
		'Title: SN2 mechanisms',
		'# a comment',
		'Tag: [Chem, Lecture 05]',
		'Style:',
		'\tColor: Accent',
		'\tBorder: {Width: 1px}',
		'Step:',
		'\t- {Command: Note.Create}',
		'\t- Plain item',
		'Explain: |',
		'\tLine one',
		'',
		'\t\tIndented line',
		'Empty:',
		'',
	];

	it('parses nested maps, lists, and multi-line text', () => {
		const section = parsePropertySection(lineList);
		expect(section.problemList).toEqual([]);
		const map = sectionToMap(section);
		expect(map.get('Tag')).toEqual(['Chem', 'Lecture 05']);
		expect((map.get('Style') as Map<string, PropertyValue>).get('Color')).toBe('Accent');
		const step = map.get('Step') as PropertyValue[];
		expect((step[0] as Map<string, PropertyValue>).get('Command')).toBe('Note.Create');
		expect(step[1]).toBe('Plain item');
		expect(map.get('Explain')).toBe('Line one\n\n\tIndented line');
		expect(map.get('Empty')).toBe(null);
	});

	it('is lossless and rewrites only the changed entry', () => {
		const section = parsePropertySection(lineList);
		expect(serializeSection(section)).toEqual(lineList);
		setSectionValue(section, 'Title', 'New title');
		const written = serializeSection(section);
		expect(written[0]).toBe('Title: New title');
		expect(written.slice(1)).toEqual(lineList.slice(1));
	});

	it('adds new keys before trailing blank lines and removes keys', () => {
		const section = parsePropertySection(['A: 1', '']);
		setSectionValue(section, 'B', 'two words');
		expect(serializeSection(section)).toEqual(['A: 1', 'B: two words', '']);
		setSectionValue(section, 'A', undefined);
		expect(serializeSection(section)).toEqual(['B: two words', '']);
	});

	it('reports lines that are not Key: value', () => {
		const section = parsePropertySection(['Just words']);
		expect(section.problemList).toHaveLength(1);
		expect(serializeSection(section)).toEqual(['Just words']);
	});
});

describe('formatting', () => {
	it('quotes only when needed', () => {
		expect(formatInline('Lecture 05')).toBe('Lecture 05');
		expect(formatInline('SN1, SN2')).toBe('"SN1, SN2"');
		expect(formatInline('True', false)).toBe('"True"');
		expect(formatInline('12', false)).toBe('"12"');
		expect(formatInline(12)).toBe('12');
		expect(formatInline(null)).toBe('None');
		expect(formatInline(new Map<string, PropertyValue>([['Color', '#e6e6e6']]))).toBe('{Color: #e6e6e6}');
	});

	it('round-trips every formatted value', () => {
		const valueList: PropertyValue[] = [
			'plain',
			'with, comma',
			'  padded ',
			'"quoted"',
			'line\nbreak',
			'True',
			'007',
			42,
			-0.5,
			true,
			null,
			['a', 'b, c', 3, false],
			new Map<string, PropertyValue>([
				['Key', 'value'],
				['Odd: key', [1, new Map<string, PropertyValue>([['Deep', null]])]],
			]),
		];
		for (const value of valueList) {
			const text = formatInline(value, false);
			expect(valueEqual(parseValueText(text).value, value), `${text}`).toBe(true);
		}
	});

	it('writes long lists as items and multi-line text as a block', () => {
		const long = Array.from({ length: 30 }, (_, index) => `Item ${index}`);
		const lineList = formatPairLineList('List', long, 0);
		expect(lineList[0]).toBe('List:');
		expect(lineList[1]).toBe('\t- Item 0');
		expect(formatPairLineList('Text', 'a\nb', 1)).toEqual(['\tText: |', '\t\ta', '\t\tb']);
		const map = parseBlockMap([...formatPairLineList('List', long, 0), ...formatPairLineList('Text', 'a\n\nb', 0)], 0);
		expect(map.get('List')).toEqual(long);
		expect(map.get('Text')).toBe('a\n\nb');
	});
});

describe('indentation', () => {
	it('counts tabs and 4-space groups as levels', () => {
		expect(measureIndent('\t\tx')).toEqual({ level: 2, rest: 'x' });
		expect(measureIndent('        x')).toEqual({ level: 2, rest: 'x' });
		expect(measureIndent('\t      x')).toEqual({ level: 2, rest: '  x' });
	});
});
