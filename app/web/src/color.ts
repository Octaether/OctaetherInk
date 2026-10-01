// Colours you pick yourself: the accent colour (Setting → Appearance) and custom text colours.
// Only `#rrggbb` hex is accepted, so what is saved is always a plain, portable value.

import type { ThemeDefinition } from '@octaether/core-sdk';

/** `#abc` or `#aabbcc` (any case) → `#aabbcc`; anything else → undefined. */
export function normalizeHex(text: string): string | undefined {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
	if (!match) return undefined;
	const hex = match[1]!.toLowerCase();
	return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
}

function channelList(hex: string): [number, number, number] {
	return [0, 2, 4].map((at) => Number.parseInt(hex.slice(1 + at, 3 + at), 16)) as [number, number, number];
}

/** Mixes two hex colours: `weight` of the first, the rest of the second. */
export function mixHex(first: string, second: string, weight: number): string {
	const a = channelList(first);
	const b = channelList(second);
	return `#${a.map((value, index) => Math.round(value * weight + b[index]! * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}

/** The tokens an accent colour sets on a theme: the accent and its soft background. */
export function accentToken(hex: string, theme: ThemeDefinition): Record<string, string> {
	const background = normalizeHex(theme.token['Color.Background'] ?? '') ?? (theme.mode === 'Dark' ? '#161616' : '#ffffff');
	return { 'Color.Accent': hex, 'Color.AccentSoft': mixHex(hex, background, theme.mode === 'Dark' ? 0.2 : 0.12) };
}

const recentKey = 'OctaetherInk.RecentColor';

/** Custom text colours you used lately, newest first. */
export function recentColorList(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(recentKey) ?? '[]') as unknown;
		return Array.isArray(list) ? list.flatMap((item) => (typeof item === 'string' && normalizeHex(item) ? [normalizeHex(item)!] : [])).slice(0, 6) : [];
	} catch {
		return [];
	}
}

export function rememberColor(hex: string): void {
	try {
		localStorage.setItem(recentKey, JSON.stringify([hex, ...recentColorList().filter((item) => item !== hex)].slice(0, 6)));
	} catch {
		// not remembered
	}
}
