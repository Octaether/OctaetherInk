import { describe, expect, it } from 'vitest';
import { highlight } from '../src';

describe('highlight', () => {
	it('marks keywords, strings, numbers, comments, and functions with their source offsets', () => {
		const html = highlight('def rate(k):\n\treturn k * 2  # twice "x"', 'Python');
		expect(html).toContain('<span class="oi-code-keyword" data-oi-s="0">def</span><span data-oi-s="3"> </span><span class="oi-code-function" data-oi-s="4">rate</span>');
		expect(html).toContain('<span class="oi-code-number" data-oi-s="25">2</span>');
		expect(html).toContain('<span class="oi-code-comment" data-oi-s="28"># twice &#34;x&#34;</span>');
	});

	it('handles block comments and template strings in JavaScript', () => {
		const html = highlight('/* a */ const s = `x${1}`;', 'JavaScript');
		expect(html).toContain('<span class="oi-code-comment" data-oi-s="0">/* a */</span>');
		expect(html).toContain('<span class="oi-code-string" data-oi-s="18">`x${1}`</span>');
	});

	it('keeps unknown languages as escaped plain text, offset into the host', () => {
		expect(highlight('<b>', 'Cobol', 10)).toBe('<span data-oi-s="10">&#60;b&#62;</span>');
	});
});
