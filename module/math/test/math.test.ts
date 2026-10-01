import { describe, expect, it } from 'vitest';
import { renderMath, tokenize } from '../src';

const resolveColor = (value: string): string | undefined => (value === 'Accent' ? 'var(--oi-color-accent)' : /^#[0-9a-f]{6}$/.test(value) ? value : undefined);

function render(source: string, display = true): string {
	return renderMath(source, { display, resolveColor }).mathml;
}

function problemOf(source: string): string[] {
	return renderMath(source, { display: true, resolveColor }).problemList.map((problem) => problem.message);
}

/** Strips source-span attributes to compare structure. */
function bare(source: string, display = true): string {
	return render(source, display).replace(/ data-oi-[se]="\d+"/g, '');
}

describe('tokenize', () => {
	it('keeps source offsets, skips spaces after command words, drops comments', () => {
		const tokenList = tokenize('\\alpha  x % note\n+1', 10);
		expect(tokenList.map((token) => [token.kind, token.text, token.start, token.end])).toEqual([
			['Command', 'alpha', 10, 16],
			['Char', 'x', 18, 19],
			['Space', ' ', 19, 20],
			['Space', '\n', 26, 27],
			['Char', '+', 27, 28],
			['Char', '1', 28, 29],
		]);
	});
});

describe('renderMath', () => {
	it('maps every element back to its source range', () => {
		const mathml = render('x + y');
		expect(mathml).toContain('<mi data-oi-s="0" data-oi-e="1">x</mi>');
		expect(mathml).toContain('<mo data-oi-s="2" data-oi-e="3">+</mo>');
		expect(mathml).toContain('<mi data-oi-s="4" data-oi-e="5">y</mi>');
		expect(mathml.startsWith('<math class="oi-math" display="block">')).toBe(true);
	});

	it('renders fractions, roots, scripts, and numbers', () => {
		expect(bare('\\frac{a}{b}')).toContain('<mfrac><mi>a</mi><mi>b</mi></mfrac>');
		expect(bare('\\sqrt[3]{x}')).toContain('<mroot><mi>x</mi><mn>3</mn></mroot>');
		expect(bare('x_i^2')).toContain('<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>');
		expect(bare('3.14')).toContain('<mn>3.14</mn>');
		expect(bare("f''(x)")).toContain('<msup><mi>f</mi><mo>″</mo></msup>');
	});

	it('puts limits under big operators only in display math', () => {
		expect(bare('\\sum_{i=0}^n i')).toContain('<munderover><mo largeop="true" movablelimits="false">∑</mo>');
		expect(bare('\\sum_{i=0}^n i', false)).toContain('<msubsup><mo largeop="true" movablelimits="false">∑</mo>');
		expect(bare('\\int_0^1 x')).toContain('<msubsup><mo largeop="true" movablelimits="false">∫</mo>');
		expect(bare('\\lim_{x \\to 0} f')).toContain('<munder><mi>lim</mi>');
	});

	it('adds function application after function names', () => {
		expect(bare('\\sin x')).toContain('<mi>sin</mi><mo>&#x2061;</mo><mi>x</mi>');
	});

	it('expands macros; expanded pieces point back to the call, arguments to their own source', () => {
		expect(bare('\\R')).toContain('<mi mathvariant="normal">ℝ</mi>');
		const source = '\\newcommand{\\sq}[1]{#1^2} \\sq{y}';
		const mathml = render(source);
		const yStart = source.lastIndexOf('y');
		expect(mathml).toContain(`<mi data-oi-s="${yStart}" data-oi-e="${yStart + 1}">y</mi>`);
		expect(mathml).toMatch(new RegExp(`<mn data-oi-s="${source.indexOf('\\sq{y}')}" data-oi-e="${source.length}">2</mn>`));
	});

	it('supports optional macro arguments and \\DeclareMathOperator', () => {
		expect(bare('\\newcommand{\\p}[2][x]{#1+#2} \\p{y} \\p[z]{w}')).toContain('<mi>x</mi><mo>+</mo><mi>y</mi>');
		expect(bare('\\DeclareMathOperator{\\Tr}{Tr} \\Tr A')).toContain('<mi>Tr</mi><mo>&#x2061;</mo><mi>A</mi>');
	});

	it('stops runaway macros with a problem instead of hanging', () => {
		expect(problemOf('\\def\\loop{\\loop x}\\loop')[0]).toMatch(/too deep/);
	});

	it('joins upright letters and keeps chemistry readable', () => {
		expect(bare('\\mathrm{CH_3Br}')).toContain(
			'<mi mathvariant="normal">C</mi><msub><mi mathvariant="normal">H</mi><mn>3</mn></msub><mi>Br</mi>',
		);
		expect(bare('\\mathbf{v} \\mathbb{Z} \\mathcal{L}')).toContain('𝐯');
		expect(bare('\\mathcal{L}')).toContain('ℒ');
	});

	it('applies theme colours safely', () => {
		expect(bare('\\textcolor{Accent}{k}')).toContain('<mrow style="color: var(--oi-color-accent)"><mi>k</mi></mrow>');
		expect(bare('\\color{#ff0000} x')).toContain('style="color: #ff0000"');
		expect(bare('\\textcolor{red;background:url(x)}{k}')).not.toContain('style=');
	});

	it('renders matrices, cases, and aligned rows', () => {
		const matrix = bare('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
		expect(matrix).toContain('<mo fence="true" form="prefix" stretchy="true" symmetric="true">(</mo><mtable');
		expect(matrix.match(/<mtr>/g)).toHaveLength(2);
		const aligned = bare('a &= b \\\\ &= c');
		expect(aligned).toContain('class="oi-math-table-align"');
		expect(aligned).toContain('<mtd style="text-align: right; padding-inline-end: 0">');
		expect(bare('f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}')).toContain('<mtext>otherwise</mtext>');
	});

	it('stretches \\left…\\right and \\middle', () => {
		const mathml = bare('\\left( \\frac{a}{b} \\middle| c \\right)');
		expect(mathml).toContain('<mo fence="true" form="prefix" stretchy="true" symmetric="true">(</mo>');
		expect(mathml).toContain('<mo stretchy="true" fence="true" form="infix">|</mo>');
	});

	it('shows unknown commands and keeps rendering the rest', () => {
		const result = renderMath('a + \\foo + b', { display: true, resolveColor });
		expect(result.mathml).toContain('class="oi-math-error"');
		expect(result.mathml).toContain('<mi data-oi-s="11" data-oi-e="12">b</mi>');
		expect(result.problemList[0]!.message).toBe('unknown command \\foo');
	});

	it('shifts spans for inline math inside a paragraph', () => {
		const mathml = renderMath('x^2', { display: false, offset: 20, resolveColor }).mathml;
		expect(mathml).toContain('<mi data-oi-s="20" data-oi-e="21">x</mi>');
		expect(mathml.startsWith('<math class="oi-math">')).toBe(true);
	});

	it('escapes text so notes cannot inject markup', () => {
		expect(render('\\text{<img src=x onerror=alert(1)>}')).not.toContain('<img');
	});
});
