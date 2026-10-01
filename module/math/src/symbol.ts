// Symbol tables for the TeX-math subset (command name → Unicode).

export const greekMap: Readonly<Record<string, string>> = {
	alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
	theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
	pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
	phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
	Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
	Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** Ordinary symbols, rendered as identifiers. */
export const ordinaryMap: Readonly<Record<string, string>> = {
	infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ',
	Im: 'ℑ', aleph: 'ℵ', wp: '℘', prime: '′', degree: '°', angle: '∠', triangle: '△', top: '⊤', bot: '⊥',
	clubsuit: '♣', diamondsuit: '♢', heartsuit: '♡', spadesuit: '♠', flat: '♭', natural: '♮', sharp: '♯',
	checkmark: '✓', circledR: '®', imath: 'ı', jmath: 'ȷ', complement: '∁', mho: '℧', Box: '□',
};

/** Operators, relations, arrows, and punctuation, rendered as <mo>. */
export const operatorMap: Readonly<Record<string, string>> = {
	pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
	oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙', cup: '∪', cap: '∩', sqcup: '⊔',
	sqcap: '⊓', vee: '∨', lor: '∨', wedge: '∧', land: '∧', setminus: '∖', wr: '≀', amalg: '⨿',
	dagger: '†', ddagger: '‡', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
	leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', equiv: '≡', approx: '≈', cong: '≅',
	sim: '∼', simeq: '≃', propto: '∝', ll: '≪', gg: '≫', prec: '≺', succ: '≻', preceq: '⪯',
	succeq: '⪰', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', subsetneq: '⊊',
	supsetneq: '⊋', in: '∈', ni: '∋', notin: '∉', mid: '∣', nmid: '∤', parallel: '∥', perp: '⟂',
	vdash: '⊢', dashv: '⊣', models: '⊨', asymp: '≍', doteq: '≐', coloneqq: '≔', leqslant: '⩽',
	geqslant: '⩾', lesssim: '≲', gtrsim: '≳',
	to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒',
	Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', impliedby: '⟸', iff: '⟺', mapsto: '↦',
	longrightarrow: '⟶', longleftarrow: '⟵', longleftrightarrow: '⟷', Longrightarrow: '⟹',
	Longleftarrow: '⟸', longmapsto: '⟼', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
	Uparrow: '⇑', Downarrow: '⇓', nearrow: '↗', searrow: '↘', swarrow: '↙', nwarrow: '↖',
	hookrightarrow: '↪', hookleftarrow: '↩', rightleftharpoons: '⇌', leftrightharpoons: '⇋',
	rightharpoonup: '⇀', rightharpoondown: '⇁', leftharpoonup: '↼', leftharpoondown: '↽',
	rightleftarrows: '⇄', leftrightarrows: '⇆', circlearrowright: '↻', circlearrowleft: '↺',
	ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', colon: ':', therefore: '∴',
	because: '∵', lbrack: '[', rbrack: ']', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋',
	lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖',
	'{': '{', '}': '}', '|': '‖', '#': '#', '%': '%', '&': '&', $: '$', _: '_',
};

/** `\not` + relation. */
export const negationMap: Readonly<Record<string, string>> = {
	'=': '≠', '<': '≮', '>': '≯', in: '∉', subset: '⊄', supset: '⊅', subseteq: '⊈', supseteq: '⊉',
	equiv: '≢', le: '≰', leq: '≰', ge: '≱', geq: '≱', sim: '≁', approx: '≉', mid: '∤', parallel: '∦',
	cong: '≇', simeq: '≄',
};

export const functionSet: ReadonlySet<string> = new Set([
	'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
	'log', 'ln', 'lg', 'exp', 'deg', 'det', 'dim', 'ker', 'hom', 'arg', 'gcd', 'lim', 'liminf', 'limsup',
	'max', 'min', 'sup', 'inf', 'Pr',
]);

/** Functions whose scripts sit under/over them in display math. */
export const limitFunctionSet: ReadonlySet<string> = new Set(['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'Pr']);

export const largeOperatorMap: Readonly<Record<string, string>> = {
	sum: '∑', prod: '∏', coprod: '∐', bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀',
	bigoplus: '⨁', bigotimes: '⨂', bigodot: '⨀', biguplus: '⨄', bigsqcup: '⨆',
	int: '∫', iint: '∬', iiint: '∭', oint: '∮',
};

export const integralSet: ReadonlySet<string> = new Set(['int', 'iint', 'iiint', 'oint']);

/** name → [accent character, stretchy]. */
export const overAccentMap: Readonly<Record<string, readonly [string, boolean]>> = {
	hat: ['^', false], widehat: ['^', true], check: ['ˇ', false], tilde: ['~', false], widetilde: ['~', true],
	acute: ['´', false], grave: ['`', false], dot: ['˙', false], ddot: ['¨', false], breve: ['˘', false],
	bar: ['¯', false], vec: ['→', false], mathring: ['˚', false], overline: ['‾', true],
	overrightarrow: ['→', true], overleftarrow: ['←', true], overleftrightarrow: ['↔', true],
	overbrace: ['⏞', true],
};

export const underAccentMap: Readonly<Record<string, readonly [string, boolean]>> = {
	underline: ['_', true], underrightarrow: ['→', true], underleftarrow: ['←', true], underbrace: ['⏟', true],
};

/** Delimiters after \left, \right, \big… (command name or character). */
export const delimiterMap: Readonly<Record<string, string>> = {
	'(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', lbrace: '{', rbrace: '}', langle: '⟨',
	rangle: '⟩', '<': '⟨', '>': '⟩', vert: '|', '|': '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖',
	rVert: '‖', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', '/': '/', backslash: '∖', uparrow: '↑',
	downarrow: '↓', updownarrow: '↕', '.': '',
};

export const spaceMap: Readonly<Record<string, string>> = {
	',': '0.1667em', ':': '0.2222em', '>': '0.2222em', ';': '0.2778em', '!': '-0.1667em', ' ': '0.25em',
	quad: '1em', qquad: '2em', thinspace: '0.1667em', medspace: '0.2222em', thickspace: '0.2778em',
	enspace: '0.5em', negthinspace: '-0.1667em',
};

export const bigSizeMap: Readonly<Record<string, string>> = {
	big: '1.2em', Big: '1.623em', bigg: '2.047em', Bigg: '2.470em',
};

/** Character operators typed directly. */
export const characterOperatorMap: Readonly<Record<string, string>> = {
	'+': '+', '-': '−', '*': '∗', '=': '=', '<': '<', '>': '>', ',': ',', ';': ';', ':': ':', '!': '!',
	'/': '/', '|': '|', '(': '(', ')': ')', '[': '[', ']': ']', '.': '.', '?': '?', '@': '@',
};

/** Unicode mathematical alphanumerics: [capital A, small a, digit 0 (optional)] + letter exceptions. */
const alphabetMap: Readonly<Record<string, { upper: number; lower: number; digit?: number; hole?: Readonly<Record<string, number>> }>> = {
	Bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
	Italic: { upper: 0x1d434, lower: 0x1d44e, hole: { h: 0x210e } },
	BoldItalic: { upper: 0x1d468, lower: 0x1d482 },
	Script: {
		upper: 0x1d49c,
		lower: 0x1d4b6,
		hole: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
	},
	Fraktur: { upper: 0x1d504, lower: 0x1d51e, hole: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 } },
	DoubleStruck: {
		upper: 0x1d538,
		lower: 0x1d552,
		digit: 0x1d7d8,
		hole: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
	},
	SansSerif: { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
	Monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
};

export type Variant = keyof typeof alphabetMap | 'Normal';

export const fontCommandMap: Readonly<Record<string, Variant>> = {
	mathrm: 'Normal', mathup: 'Normal', mathit: 'Italic', mathbf: 'Bold', boldsymbol: 'BoldItalic',
	bm: 'BoldItalic', mathcal: 'Script', mathscr: 'Script', mathfrak: 'Fraktur', mathbb: 'DoubleStruck',
	mathsf: 'SansSerif', mathtt: 'Monospace', operatorname: 'Normal',
};

/** Maps ASCII letters and digits to a math alphabet; other characters stay as they are. */
export function styleText(text: string, variant: Variant): string {
	if (variant === 'Normal') return text;
	const alphabet = alphabetMap[variant]!;
	let result = '';
	for (const character of text) {
		const hole = alphabet.hole?.[character];
		if (hole !== undefined) result += String.fromCodePoint(hole);
		else if (character >= 'A' && character <= 'Z') result += String.fromCodePoint(alphabet.upper + character.charCodeAt(0) - 65);
		else if (character >= 'a' && character <= 'z') result += String.fromCodePoint(alphabet.lower + character.charCodeAt(0) - 97);
		else if (character >= '0' && character <= '9' && alphabet.digit !== undefined) {
			result += String.fromCodePoint(alphabet.digit + character.charCodeAt(0) - 48);
		} else result += character;
	}
	return result;
}
