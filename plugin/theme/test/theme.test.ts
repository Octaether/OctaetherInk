import { describe, expect, it } from 'vitest';
import { parseThemeDocument } from '../src';

const base = {
	Light: { 'Color.Text': '#000000', 'Color.Background': '#ffffff' },
	Dark: { 'Color.Text': '#ffffff', 'Color.Background': '#000000' },
};

describe('parseThemeDocument', () => {
	it('reads a theme file into tokens, filling gaps from the base of its mode', () => {
		const source = [
			'Kind: Theme',
			'Name: Midnight',
			'Mode: Dark',
			'Format: Oi 1',
			'',
			'Color:',
			'\tAccent: oklch(0.72 0.14 250)',
			'\tBackground: #0f1115',
			'Font:',
			'\tBody: Inter',
			'Module:',
			'\tTable.HeaderBackground: #1b2130',
		].join('\n');
		const { theme, problemList } = parseThemeDocument(source, base);
		expect(problemList).toEqual([]);
		expect(theme).toEqual({
			name: 'Midnight',
			mode: 'Dark',
			token: {
				'Color.Text': '#ffffff',
				'Color.Background': '#0f1115',
				'Color.Accent': 'oklch(0.72 0.14 250)',
				'Font.Body': 'Inter',
				'Table.HeaderBackground': '#1b2130',
			},
		});
	});

	it('explains what is wrong with a bad theme file', () => {
		const { theme, problemList } = parseThemeDocument('Kind: Theme\nName: midnight\nMode: Dusk\n', base);
		expect(theme).toBeUndefined();
		expect(problemList).toEqual(['Name must be PascalCase, e.g. Midnight', 'Mode must be Light or Dark']);
	});
});
