import { describe, expect, it } from 'vitest';
import { renderDocument, shiftOffset, toggleTaskAt } from '../src';

const option = { resolveColor: (value: string) => value };

describe('renderDocument', () => {
	it('draws a whole document, each piece at its own offset in the body', () => {
		const source = '# Lab report\n\nFirst *paragraph*\nsecond line\n\n---\n\n> A quote';
		const html = renderDocument(source, option);
		expect(html).toContain('<h1><span data-oi-s="2">Lab report</span></h1>');
		expect(html).toContain('<p><span data-oi-s="14">First </span><em><span data-oi-s="21">paragraph</span></em><br><span data-oi-s="32">second line</span></p>');
		expect(html).toContain('<hr data-oi-s="45">');
		expect(html).toContain('<blockquote><span data-oi-s="52">A quote</span></blockquote>');
	});

	it('nests lists by their indentation and ticks to-dos in the body', () => {
		const source = '- [x] Weigh\n\t- [ ] Twice\n- Titrate\n\n1. One\n2. Two';
		const html = renderDocument(source, option);
		expect(html).toMatch(/^<ul><li class="oi-task"><input type="checkbox" data-oi-interactive data-oi-markdown-task="2" checked aria-label="Done"> <span data-oi-s="6">Weigh<\/span><ul><li class="oi-task">.*<\/li><\/ul><\/li><li><span data-oi-s="\d+">Titrate<\/span><\/li><\/ul><ol start="1">/);
		expect(toggleTaskAt(source, 2)).toBe(source.replace('[x]', '[ ]'));
		expect(toggleTaskAt(source, 15)).toBe(source.replace('[ ] Twice', '[x] Twice'));
		expect(toggleTaskAt(source, 0)).toBe(source);
	});

	it('draws fenced code with the highlighter, at the offset of its first line', () => {
		const html = renderDocument('Intro\n\n```Python\nx = 1\n```\nAfter', { ...option, highlight: (code, language, offset) => `[${language}@${offset}:${code}]` });
		expect(html).toContain('<pre class="oi-markdown-code"><code>[Python@17:x = 1]</code></pre>');
		expect(html).toContain('<p><span data-oi-s="27">After</span></p>');
	});

	it('draws tables and moves offsets', () => {
		const html = renderDocument('Before\n\n| A | B |\n|---|---|\n| 1 | 2 |', option);
		expect(html).toContain('<table><thead><tr><th><span data-oi-s="10">A</span></th>');
		expect(shiftOffset('<span data-oi-s="3" data-oi-e="5">x</span>', 10)).toBe('<span data-oi-s="13" data-oi-e="15">x</span>');
	});
});
