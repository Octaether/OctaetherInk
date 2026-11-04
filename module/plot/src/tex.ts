// A Plot's line as TeX, so the list under the plot shows typeset math (sin x, fractions, powers)
// rather than the text typed. A table column shows as its name.

import type { ExpressionNode } from '@octaether/core-expression';

const greekTex: Readonly<Record<string, string>> = {
	α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta', ι: '\\iota', κ: '\\kappa', λ: '\\lambda',
	μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\varphi', χ: '\\chi', ψ: '\\psi', ω: '\\omega',
};

const functionTex = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'min', 'max']);
const functionAlias: Readonly<Record<string, string>> = { asin: 'arcsin', acos: 'arccos', atan: 'arctan' };

const relationTex: Readonly<Record<string, string>> = { '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '=': '=', '!=': '\\ne', and: '\\;\\text{and}\\;', or: '\\;\\text{or}\\;', contains: '\\ni' };

/** How tightly an operator binds (higher binds tighter). */
function rank(node: ExpressionNode): number {
	switch (node.kind) {
		case 'Binary':
			switch (node.operator) {
				case 'or':
					return 1;
				case 'and':
					return 2;
				case '+':
				case '-':
					return 4;
				case '*':
				case '/':
				case 'mod':
					return 5;
				case '^':
					return 7;
				default:
					return 3;
			}
		case 'Unary':
			return node.operator === '!' ? 8 : 6;
		default:
			return 9;
	}
}

const name = (text: string): string => {
	const [base, subscript] = text.split('_');
	const head = greekTex[base!] ?? (base!.length > 1 ? `\\mathit{${base}}` : base!);
	return subscript ? `${head}_{${subscript}}` : head;
};

const text = (value: string): string => `\\text{${value.replace(/[\\{}]/g, '')}}`;

/** TeX for an expression. */
export function toTex(node: ExpressionNode): string {
	const wrap = (child: ExpressionNode, least: number): string => (rank(child) < least ? `\\left(${toTex(child)}\\right)` : toTex(child));
	switch (node.kind) {
		case 'Number':
			return String(node.value);
		case 'Text':
			return text(node.value);
		case 'Name':
			return name(node.name);
		case 'Call': {
			const argumentList = node.argumentList.map(toTex);
			const fn = functionAlias[node.name] ?? node.name;
			if (fn === 'sqrt') return `\\sqrt{${argumentList[0] ?? ''}}`;
			if (fn === 'cbrt') return `\\sqrt[3]{${argumentList[0] ?? ''}}`;
			if (fn === 'abs') return `\\left|${argumentList[0] ?? ''}\\right|`;
			if (fn === 'floor') return `\\left\\lfloor ${argumentList[0] ?? ''}\\right\\rfloor`;
			if (fn === 'ceil') return `\\left\\lceil ${argumentList[0] ?? ''}\\right\\rceil`;
			const head = functionTex.has(fn) ? `\\${fn}` : fn.length > 1 ? `\\operatorname{${fn}}` : fn;
			// sin x for a lone name or number, sin(x + 1) otherwise
			const only = node.argumentList[0];
			if (functionTex.has(fn) && node.argumentList.length === 1 && only && (only.kind === 'Name' || only.kind === 'Number')) return `${head} ${argumentList[0]}`;
			return `${head}\\left(${argumentList.join(', ')}\\right)`;
		}
		case 'Unary':
			if (node.operator === '-') return `-${wrap(node.operand, 6)}`;
			if (node.operator === '!') return `${wrap(node.operand, 9)}!`;
			return `\\neg ${wrap(node.operand, 6)}`;
		case 'Binary': {
			const own = rank(node);
			switch (node.operator) {
				case '/':
					return `\\frac{${toTex(node.left)}}{${toTex(node.right)}}`;
				case '^':
					return `${wrap(node.left, 8)}^{${toTex(node.right)}}`;
				case '*': {
					const left = wrap(node.left, own);
					const right = wrap(node.right, own);
					// 2 · 3, but 2x and a sin x
					const numberNext = node.right.kind === 'Number' || (node.right.kind === 'Unary' && node.right.operator === '-');
					return numberNext ? `${left} \\cdot ${right}` : `${left}\\,${right}`;
				}
				case '+':
					return `${wrap(node.left, own)} + ${wrap(node.right, own)}`;
				case '-':
					return `${wrap(node.left, own)} - ${wrap(node.right, own + 1)}`;
				case 'mod':
					return `${wrap(node.left, own)} \\bmod ${wrap(node.right, own + 1)}`;
				default:
					return `${wrap(node.left, own + 1)} ${relationTex[node.operator]} ${wrap(node.right, own + 1)}`;
			}
		}
		case 'List':
			return `\\left[${node.itemList.map(toTex).join(', ')}\\right]`;
		case 'Tuple':
			return `\\left(${node.itemList.map(toTex).join(', ')}\\right)`;
		case 'Piecewise':
			return `\\begin{cases}${node.caseList.map((entry) => (entry.condition ? `${toTex(entry.value)} & ${toTex(entry.condition)}` : `${toTex(entry.value)} & \\text{otherwise}`)).join(' \\\\ ')}\\end{cases}`;
	}
}
