// Theme protocol, host side: token sets, CSS variables, safe value validation.

import type { ModuleToken, ThemeContext, ThemeDefinition } from '@octaether/core-sdk';

const fontBody = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const fontMath = "'STIX Two Math', 'Latin Modern Math', 'Cambria Math', 'Libertinus Math', 'Noto Sans Math', math";
const fontCode = "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export const lightTheme: ThemeDefinition = {
	name: 'Light',
	mode: 'Light',
	token: {
		// warm greys, so the page sits with the gold instead of against it
		'Color.Text': '#1f1d1a',
		'Color.TextMuted': '#66615a',
		'Color.Background': '#ffffff',
		'Color.Surface1': '#f7f6f3',
		'Color.Surface2': '#efede8',
		'Color.Surface3': '#e4e1da',
		'Color.Border': '#dbd6cc',
		// Octaether gold: the brand colour, dark enough for links on white
		'Color.Accent': '#8a6a1c',
		'Color.AccentSoft': '#f8f3e7',
		'Color.Danger': '#c4302b',
		'Color.Success': '#3f7d2c',
		'Color.Warning': '#b35a00',
		'Color.Highlight': '#fff1a8',
		'Color.Selection': '#f0e2bb',
		'Font.Body': fontBody,
		'Font.Math': fontMath,
		'Font.Code': fontCode,
		'Size.Body': '16px',
	},
};

export const darkTheme: ThemeDefinition = {
	name: 'Dark',
	mode: 'Dark',
	token: {
		// warm greys around Octaether gold, as on octaether.com
		'Color.Text': '#e8e6e1',
		'Color.TextMuted': '#a19d94',
		'Color.Background': '#161616',
		'Color.Surface1': '#1d1d1c',
		'Color.Surface2': '#262625',
		'Color.Surface3': '#31302e',
		'Color.Border': '#3d3b37',
		'Color.Accent': '#d4a84b',
		'Color.AccentSoft': '#33291a',
		'Color.Danger': '#f47067',
		'Color.Success': '#57ab5a',
		'Color.Warning': '#e0823d',
		'Color.Highlight': '#5c4a00',
		'Color.Selection': '#4a3d22',
		'Font.Body': fontBody,
		'Font.Math': fontMath,
		'Font.Code': fontCode,
		'Size.Body': '16px',
	},
};

/** `Color.TextMuted` → `--oi-color-text-muted`. */
export function tokenVariable(token: string): string {
	return `--oi-${token
		.split('.')
		.map((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
		.join('-')}`;
}

const tokenPattern = /^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*$/;
const hexPattern = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const colorFunctionPattern = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]*\)$/;
const namedColorPattern = /^[a-z]{3,20}$/;
const lengthPattern = /^-?(?:\d+|\d*\.\d+)(?:px|mm|cm|pt|pc|in|%|em|rem|ex|ch|vh|vw|fr)$/;
const fontPattern = /^[\p{L}\p{N}\s,'"._-]+$/u;

export function isColorText(text: string): boolean {
	return hexPattern.test(text) || colorFunctionPattern.test(text) || namedColorPattern.test(text);
}

export function isLengthText(text: string): boolean {
	return lengthPattern.test(text) || text === '0';
}

/** Rejects anything that could load resources or break out of a declaration (untrusted theme files). */
export function sanitizeTokenValue(token: string, value: string): string | undefined {
	const text = value.trim();
	if (text === '' || /url\(|expression|[;{}<>\\]/i.test(text)) return undefined;
	if (token.startsWith('Color.') || /(?:Color|Background)$/.test(token)) return isColorText(text) ? text : undefined;
	if (token.startsWith('Font.')) return fontPattern.test(text) ? text : undefined;
	if (token.startsWith('Size.')) return isLengthText(text) ? text : undefined;
	return isColorText(text) || isLengthText(text) || fontPattern.test(text) ? text : undefined;
}

/**
 * Colour property value → CSS colour. `Accent` and `Color.Accent` are theme tokens (only known
 * ones), raw colours are validated; anything else returns undefined.
 */
export function resolveColor(value: string, isKnownToken: (token: string) => boolean): string | undefined {
	const text = value.trim();
	if (tokenPattern.test(text)) {
		const token = text.includes('.') ? text : `Color.${text}`;
		return isKnownToken(token) ? `var(${tokenVariable(token)})` : undefined;
	}
	return isColorText(text) ? text : undefined;
}

/** Writes a theme (plus module tokens) as CSS variables on an element. */
export function applyThemeVariable(element: HTMLElement, theme: ThemeDefinition, moduleTokenList: readonly ModuleToken[]): void {
	for (const [token, value] of Object.entries(theme.token)) {
		const safe = sanitizeTokenValue(token, value);
		if (safe !== undefined) element.style.setProperty(tokenVariable(token), safe);
	}
	for (const moduleToken of moduleTokenList) {
		for (const [token, pair] of Object.entries(moduleToken)) {
			const value = sanitizeTokenValue(token, theme.token[token] ?? pair[theme.mode]);
			if (value !== undefined) element.style.setProperty(tokenVariable(token), value);
		}
	}
	element.dataset.oiTheme = theme.name;
	element.dataset.oiMode = theme.mode;
	element.style.colorScheme = theme.mode === 'Dark' ? 'dark' : 'light';
}

export function themeContext(theme: ThemeDefinition): ThemeContext {
	return { name: theme.name, mode: theme.mode, token: theme.token };
}

export class ThemeRegistry {
	private readonly themeMap = new Map<string, ThemeDefinition>([
		[lightTheme.name, lightTheme],
		[darkTheme.name, darkTheme],
	]);
	private currentName = lightTheme.name;
	private readonly listenerSet = new Set<(theme: ThemeDefinition) => void>();
	/** Tokens you choose yourself (an accent colour), laid over whichever theme is active. */
	private overrideOf: ((theme: ThemeDefinition) => Readonly<Record<string, string>>) | undefined;

	/** Lays your own tokens over every theme (undefined removes them); they may depend on the theme (light or dark). */
	setOverride(overrideOf: ((theme: ThemeDefinition) => Readonly<Record<string, string>>) | undefined): void {
		this.overrideOf = overrideOf;
		this.emit();
	}

	/** Registers a theme; tokens it leaves out come from the built-in theme of the same mode. */
	register(theme: ThemeDefinition): () => void {
		if (theme.name === lightTheme.name || theme.name === darkTheme.name) {
			throw new Error(`"${theme.name}" is a built-in theme`);
		}
		const base = theme.mode === 'Dark' ? darkTheme : lightTheme;
		const stored: ThemeDefinition = { ...theme, token: { ...base.token, ...theme.token } };
		this.themeMap.set(theme.name, stored);
		this.emit();
		return () => {
			if (this.themeMap.get(theme.name) !== stored) return;
			this.themeMap.delete(theme.name);
			if (this.currentName === theme.name) this.currentName = theme.mode === 'Dark' ? darkTheme.name : lightTheme.name;
			this.emit();
		};
	}

	list(): ThemeDefinition[] {
		return [...this.themeMap.values()];
	}

	get(name: string): ThemeDefinition | undefined {
		return this.themeMap.get(name);
	}

	current(): ThemeDefinition {
		const theme = this.themeMap.get(this.currentName) ?? lightTheme;
		const token = this.overrideOf?.(theme);
		return token && Object.keys(token).length > 0 ? { ...theme, token: { ...theme.token, ...token } } : theme;
	}

	apply(name: string): boolean {
		if (!this.themeMap.has(name)) return false;
		this.currentName = name;
		this.emit();
		return true;
	}

	subscribe(listener: (theme: ThemeDefinition) => void): () => void {
		this.listenerSet.add(listener);
		return () => this.listenerSet.delete(listener);
	}

	private emit(): void {
		const theme = this.current();
		for (const listener of this.listenerSet) listener(theme);
	}
}
