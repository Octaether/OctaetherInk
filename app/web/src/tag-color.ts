// A tag's color across the vault: the same #Organic in a note's text, its properties, and a table.
// Kept as a setting of the vault (`Tag.Color: ["Organic: Danger", "Ada Lovelace: #2f7d6d"]`, a list
// so it reads plainly in `.oi/Setting.oi`), and drawn by one style sheet the app writes, so modules
// only mark their tags (`data-oi-tag`, `data-oi-label`) and use `--oi-tag-back` / `--oi-tag-text`.

import type { PropertyValue } from '@octaether/core-format';

export const tagColorSetting = 'Tag.Color';

/** Tag (in lower case) → its color as written: a theme color's name (`Danger`) or `#rrggbb`. */
export function tagColorMap(value: PropertyValue | undefined): Map<string, { tag: string; color: string }> {
	const map = new Map<string, { tag: string; color: string }>();
	for (const item of Array.isArray(value) ? value : []) {
		const text = String(item);
		const at = text.lastIndexOf(': ');
		if (at <= 0) continue;
		const tag = text.slice(0, at).trim();
		const color = text.slice(at + 2).trim();
		if (tag && color) map.set(tag.toLowerCase(), { tag, color });
	}
	return map;
}

/** The setting with one tag's color set (or taken away, with no color); undefined when none is left. */
export function withTagColor(value: PropertyValue | undefined, tag: string, color: string | undefined): string[] | undefined {
	const map = tagColorMap(value);
	if (color) map.set(tag.toLowerCase(), { tag, color });
	else map.delete(tag.toLowerCase());
	const list = [...map.values()].map((item) => `${item.tag}: ${item.color}`);
	return list.length ? list : undefined;
}

/** A theme color's name as its CSS variable (`TextMuted` → `var(--oi-color-text-muted)`), a hex as it is. */
export function cssColorOf(color: string): string | undefined {
	if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
	if (/^[A-Z][A-Za-z]*$/.test(color)) return `var(--oi-color-${color.replace(/[A-Z]/g, (letter, at: number) => `${at ? '-' : ''}${letter.toLowerCase()}`)})`;
	return undefined;
}

const quoted = (text: string): string => `"${text.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

/** The style sheet: each colored tag tints every chip and #tag of that name (in any case). */
export function tagColorCss(value: PropertyValue | undefined): string {
	return [...tagColorMap(value).values()]
		.map(({ tag, color }) => {
			const css = cssColorOf(color);
			if (!css) return '';
			const name = quoted(tag);
			return `[data-oi-tag=${name} i], [data-oi-label=${name} i] { --oi-tag-back: color-mix(in srgb, ${css} 22%, transparent); --oi-tag-text: color-mix(in srgb, ${css} 75%, var(--oi-color-text)); }`;
		})
		.filter(Boolean)
		.join('\n');
}
