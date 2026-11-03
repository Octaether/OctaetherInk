// The accent color you pick (Setting → Appearance). Text colors come from the Palette plugin.
// Only `#rrggbb` hex is accepted, so what is saved is always a plain, portable value.

import { type ThemeDefinition, normalizeHex } from '@octaether/core-sdk';

export { normalizeHex } from '@octaether/core-sdk';

function channelList(hex: string): [number, number, number] {
	return [0, 2, 4].map((at) => Number.parseInt(hex.slice(1 + at, 3 + at), 16)) as [number, number, number];
}

/** Mixes two hex colors: `weight` of the first, the rest of the second. */
export function mixHex(first: string, second: string, weight: number): string {
	const a = channelList(first);
	const b = channelList(second);
	return `#${a.map((value, index) => Math.round(value * weight + b[index]! * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}

/** The tokens an accent color sets on a theme: the accent and its soft background. */
export function accentToken(hex: string, theme: ThemeDefinition): Record<string, string> {
	const background = normalizeHex(theme.token['Color.Background'] ?? '') ?? (theme.mode === 'Dark' ? '#161616' : '#ffffff');
	return { 'Color.Accent': hex, 'Color.AccentSoft': mixHex(hex, background, theme.mode === 'Dark' ? 0.2 : 0.12) };
}
