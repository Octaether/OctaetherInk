// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cleanStyle, sanitizeHtml, sanitizeHtmlFragment } from '../src';

describe('sanitizeHtml', () => {
	it('keeps harmless markup', () => {
		expect(sanitizeHtml('<p align="center">Press <kbd>Ctrl</kbd> + <b>S</b></p><details open><summary>Why</summary>Because.</details>')).toBe(
			'<p align="center">Press <kbd>Ctrl</kbd> + <b>S</b></p><details open=""><summary>Why</summary>Because.</details>',
		);
	});

	it('removes anything that could run', () => {
		const html = sanitizeHtml('<img src="x.png" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><iframe src="https://evil.example"></iframe><svg onload="alert(4)"></svg>');
		expect(html).not.toMatch(/alert|script|iframe|svg|onerror|javascript/);
		expect(html).toBe('<img data-oi-asset="x.png" loading="lazy"><a>x</a>');
	});

	it('opens links in a new tab and loads pictures through the vault or the web', () => {
		expect(sanitizeHtml('<a href="https://octaether.com" class="button" id="x">site</a>')).toBe('<a href="https://octaether.com" target="_blank" rel="noopener noreferrer">site</a>');
		expect(sanitizeHtml('<img src="https://example.com/a.png" alt="A" width="120">')).toBe('<img src="https://example.com/a.png" alt="A" width="120" loading="lazy">'.replace('src=', 'data-oi-asset='));
	});

	it('builds clean nodes to append, never read again from text', () => {
		const fragment = sanitizeHtmlFragment('<p>a<img src="x" onerror="alert(1)"></p><noscript><p title="</noscript><img src=x onerror=alert(2)>"></p></noscript>');
		const holder = document.createElement('div');
		holder.append(fragment);
		expect(holder.innerHTML).toBe('<p>a<img data-oi-asset="x" loading="lazy"></p>');
		expect(holder.querySelectorAll('[onerror]')).toHaveLength(0);
	});

	it('keeps an unknown wrapper’s text, and turns <center> into a centred div', () => {
		expect(sanitizeHtml('<custom-tag>kept <b>bold</b></custom-tag><center>mid</center>')).toBe('kept <b>bold</b><div style="text-align: center">mid</div>');
	});

	it('keeps colors and spacing, never positions or pictures in style', () => {
		expect(cleanStyle('color: var(--oi-color-accent); position: fixed; top: 0; background: url(https://evil.example/x.png); padding: 4px; z-index: 99')).toBe('color: var(--oi-color-accent); padding: 4px');
		expect(cleanStyle('color: var(--app-secret)')).toBe('');
		expect(sanitizeHtml('<span style="color: red; position: absolute">x</span>', { keepStyle: false })).toBe('<span>x</span>');
	});
});
