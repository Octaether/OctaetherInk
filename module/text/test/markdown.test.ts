import { describe, expect, it } from 'vitest';
import type { PropertyMap } from '@octaether/core-format';
import { renderMarkdown, safeUrl, toggleTask } from '../src';

const callList: { type: string; content: string; offset: number }[] = [];
const option = {
	resolveColor: (value: string): string | undefined => (value === 'Accent' ? 'var(--oi-color-accent)' : undefined),
	renderInline: (type: string, content: string, _property: PropertyMap, offset: number): string | undefined => {
		callList.push({ type, content, offset });
		return type === 'Unknown' ? undefined : `<i data-type="${type}" data-at="${offset}">${content}</i>`;
	},
};

const render = (source: string): string => renderMarkdown(source, option);

describe('renderMarkdown with source spans', () => {
	it('marks every text run with its source offset', () => {
		expect(render('## Title')).toBe('<h2><span data-oi-s="3">Title</span></h2>');
		expect(render('a **bold** word')).toBe('<p><span data-oi-s="0">a </span><strong><span data-oi-s="4">bold</span></strong><span data-oi-s="10"> word</span></p>');
		expect(render('one\ntwo')).toBe('<p><span data-oi-s="0">one</span><br><span data-oi-s="4">two</span></p>');
	});

	it('marks pieces that are not one-to-one with start and end', () => {
		expect(render('\\*')).toBe('<p><span data-oi-s="0" data-oi-e="2">*</span></p>');
		expect(render('`a<b`')).toBe('<p><code data-oi-s="1">a&#60;b</code></p>');
		expect(render('#[Lecture 05]')).toContain('data-oi-s="0" data-oi-e="13">#Lecture 05</span>');
	});

	it('renders tags, wikilinks, and links', () => {
		const html = render('#Chem and #chem, not C# or #1 [[Note#^ab12|see]] [site](https://octaether.com) [bad](javascript:alert(1))');
		expect(html).toContain('data-oi-tag="Chem"');
		expect(html).toContain('data-oi-tag="chem"');
		expect(html).not.toContain('data-oi-tag="1"');
		expect(html).toContain('<a class="oi-wikilink" data-oi-link="Note#^ab12"><span data-oi-s="43">see</span></a>');
		expect(html).toContain('href="https://octaether.com"');
		expect(html).not.toContain('href="javascript');
		expect(safeUrl('data:text/html,x')).toBeUndefined();
	});

	it('shows pictures written as in Markdown and in Obsidian, loaded later by the app', () => {
		expect(render('See ![a cell](Cell.png) here')).toBe(
			'<p><span data-oi-s="0">See </span><img class="oi-text-image" alt="a cell" data-oi-asset="Cell.png" data-oi-s="4" data-oi-e="23"><span data-oi-s="23"> here</span></p>',
		);
		expect(render('![[Cell.png|300]]')).toBe('<p><img class="oi-text-image" alt="Cell.png" data-oi-asset="Cell.png" width="300" data-oi-s="0" data-oi-e="17"></p>');
		// an embedded note stays a link, and a script address is not a picture
		expect(render('![[Other note]]')).toContain('class="oi-wikilink oi-embed"');
		expect(render('![x](javascript:alert(1))')).not.toContain('<img');
	});

	it('renders every inline block as {Type: …} through the host, at the right offset', () => {
		callList.length = 0;
		render('Water {Chem: H_2O} and {Math: x^2} and {Code {Language: Python}: print(1)}');
		expect(callList).toEqual([
			{ type: 'Chem', content: 'H_2O', offset: 13 },
			{ type: 'Math', content: 'x^2', offset: 30 },
			{ type: 'Code', content: 'print(1)', offset: 65 },
		]);
		// dollar signs are just text now
		expect(render('$x^2$')).toBe('<p><span data-oi-s="0">$x^2$</span></p>');
		expect(render('{Unknown: thing}')).toContain('class="oi-inline-unknown"');
		expect(render('{Text {Color: Accent}: warm}')).toBe('<p><span style="color: var(--oi-color-accent)"><span data-oi-s="23">warm</span></span></p>');
		expect(render('costs $5 and $10')).toBe('<p><span data-oi-s="0">costs $5 and $10</span></p>');
	});

	it('styles spans with theme tokens and drops unsafe values', () => {
		expect(render('[hot]{Color: Accent}')).toBe('<p><span style="color: var(--oi-color-accent)"><span data-oi-s="1">hot</span></span></p>');
		expect(render('[x]{Color: "red;background:url(x)"}')).toBe('<p><span><span data-oi-s="1">x</span></span></p>');
	});

	it('renders one list item per block, with tasks and numbers', () => {
		expect(render('- item')).toBe('<ul><li><span><span data-oi-s="2">item</span></span></li></ul>');
		expect(render('3. x')).toBe('<ol start="3"><li><span><span data-oi-s="3">x</span></span></li></ol>');
		expect(render('- [x] done')).toContain('<input type="checkbox" data-oi-interactive data-oi-task checked aria-label="Done"> <span data-oi-s="6">done</span>');
		expect(toggleTask('- [ ] open')).toBe('- [x] open');
		expect(toggleTask('2. [x] done')).toBe('2. [ ] done');
	});

	it('renders quotes and tables with offsets', () => {
		expect(render('> a\n> b')).toBe('<blockquote><span data-oi-s="2">a</span><br><span data-oi-s="6">b</span></blockquote>');
		expect(render('| A | B |\n|:--|--:|\n| 1 | {Math: z} |')).toContain('<td style="text-align: right"><i data-type="Math" data-at="33">z</i></td>');
	});

	it('escapes HTML everywhere', () => {
		expect(render('<script>alert(1)</script>')).toBe('<p><span data-oi-s="0">&#60;script&#62;alert(1)&#60;/script&#62;</span></p>');
	});
});
