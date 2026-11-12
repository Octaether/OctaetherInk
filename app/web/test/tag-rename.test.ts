import { tagListOf, tagText } from '@octaether/core-format';
import { describe, expect, it } from 'vitest';
import { inlineTag, renameInlineTag, renamePropertyTag } from '../src/tag-rename';

describe('tags', () => {
	it('reads and writes one rule: commas between, spaces inside, quotes around a tag with a comma', () => {
		expect(tagListOf('Organic, Ada Lovelace,  "Smith, J" , organic, #Lab')).toEqual(['Organic', 'Ada Lovelace', 'Smith, J', 'Lab']);
		expect(tagText(['Organic', 'Smith, J'])).toBe('Organic, "Smith, J"');
		expect(tagListOf(tagText(['a "quoted" one', 'b, c']))).toEqual(['a "quoted" one', 'b, c']);
		expect(tagListOf('')).toEqual([]);
	});

	it('renames a tag in text and in a Property block’s Tag list', () => {
		expect(inlineTag('Lab')).toBe('#Lab');
		expect(inlineTag('Ada Lovelace')).toBe('#[Ada Lovelace]');
		expect(renameInlineTag('See #organic and #[Organic], not #OrganicChem or a#Organic.', 'Organic', 'Organic Chem')).toBe('See #[Organic Chem] and #[Organic Chem], not #OrganicChem or a#Organic.');
		expect(renamePropertyTag('Tag: [Organic, Lab]\nDue: 2026-11-20', 'organic', 'Lab')).toBe('Tag: [Lab]\nDue: 2026-11-20');
		expect(renamePropertyTag('Tag: [Lab]', 'Organic', 'X')).toBeUndefined();
	});
});
