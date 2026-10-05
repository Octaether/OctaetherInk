// Theme plugin: extra themes (Paper, HighContrast) and theme files (`.oi/Theme/*.oi`). It only
// contributes themes, as any plugin or module may: choosing one is the app's job (Setting →
// Appearance, the Theme.Switch and Theme.Cycle commands), so every theme shows in one list. The
// Light/Dark protocol itself lives in the render layer, so it works even with this plugin off.

import { type PropertyValue, parseDocument, sectionToMap } from '@octaether/core-format';
import type { PluginDefinition, ThemeDefinition, ThemeMode } from '@octaether/core-sdk';

export const paperTheme: ThemeDefinition = {
	name: 'Paper',
	mode: 'Light',
	token: {
		'Color.Text': '#3b3128',
		'Color.TextMuted': '#7a6a58',
		'Color.Background': '#f8f1e3',
		'Color.Surface1': '#f1e7d4',
		'Color.Surface2': '#eadcc2',
		'Color.Surface3': '#e0cfb0',
		'Color.Border': '#d6c3a1',
		'Color.Accent': '#8a4b16',
		'Color.AccentSoft': '#f1dfc9',
		'Color.Danger': '#b3261e',
		'Color.Success': '#3d7a2e',
		'Color.Warning': '#8c6a00',
		'Color.Highlight': '#f5e08a',
		'Color.Selection': '#e8cfa3',
		'Font.Body': "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
		'Code.Background': '#f1e7d4',
	},
};

export const highContrastTheme: ThemeDefinition = {
	name: 'HighContrast',
	mode: 'Dark',
	token: {
		'Color.Text': '#ffffff',
		'Color.TextMuted': '#d0d0d0',
		'Color.Background': '#000000',
		'Color.Surface1': '#0a0a0a',
		'Color.Surface2': '#141414',
		'Color.Surface3': '#1f1f1f',
		'Color.Border': '#ffffff',
		'Color.Accent': '#ffd400',
		'Color.AccentSoft': '#332b00',
		'Color.Danger': '#ff6b6b',
		'Color.Success': '#5dff8a',
		'Color.Warning': '#ffd400',
		'Color.Highlight': '#665500',
		'Color.Selection': '#6b5300',
		'Code.Background': '#000000',
	},
};

function flatten(value: PropertyValue, prefix: string, into: Record<string, string>): void {
	if (value instanceof Map) {
		for (const [key, item] of value) flatten(item, prefix ? `${prefix}.${key}` : key, into);
	} else if (typeof value === 'string' || typeof value === 'number') {
		into[prefix] = String(value);
	}
}

export interface ThemeParseResult {
	theme: ThemeDefinition | undefined;
	problemList: string[];
}

/**
 * Reads a theme file (`Kind: Theme`). `Color:`, `Font:`, `Size:` maps become tokens such as
 * `Color.Text`; `Module:` holds module tokens such as `Table.HeaderBackground`. Missing tokens
 * fall back to `baseToken` for the theme's mode. Values are validated again when applied.
 */
export function parseThemeDocument(source: string, baseToken: Readonly<Record<ThemeMode, Readonly<Record<string, string>>>>): ThemeParseResult {
	const problemList: string[] = [];
	const document = parseDocument(source);
	if (document.kind !== 'Property') return { theme: undefined, problemList: ['a theme file must start with "Kind: Theme"'] };
	problemList.push(...document.problemList.map((problem) => `line ${problem.line + 1}: ${problem.message}`));
	const map = sectionToMap(document.section);
	if (map.get('Kind') !== 'Theme') problemList.push('Kind must be Theme');
	const name = map.get('Name');
	if (typeof name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(name)) problemList.push('Name must be PascalCase, e.g. Midnight');
	const mode = map.get('Mode');
	if (mode !== 'Light' && mode !== 'Dark') problemList.push('Mode must be Light or Dark');
	if (problemList.length > 0 || typeof name !== 'string' || (mode !== 'Light' && mode !== 'Dark')) return { theme: undefined, problemList };
	const token: Record<string, string> = { ...baseToken[mode] };
	for (const [key, value] of map) {
		if (key === 'Kind' || key === 'Name' || key === 'Mode' || key === 'Format') continue;
		flatten(value, key === 'Module' ? '' : key, token);
	}
	return { theme: { name, mode, token }, problemList };
}

export const themePlugin: PluginDefinition = {
	kind: 'Plugin',
	name: 'Theme',
	publisher: 'Octaether',
	version: '0.1.0',
	title: 'Theme',
	explain: 'Adds the Paper and HighContrast themes (and, next, theme files from the vault). Pick a theme in Setting → Appearance or with Switch theme in the command palette; Light and Dark are built in and always there.',
	activate(context) {
		context.registerTheme(paperTheme);
		context.registerTheme(highContrastTheme);
	},
};
