// TeX-math subset, part 2: tokens (after macro expansion) → MathNode tree with spans.

import type { Limit, MathNode, MathProblem, Span, Token } from './parse';
import {
	type Variant,
	bigSizeMap,
	characterOperatorMap,
	delimiterMap,
	fontCommandMap,
	functionSet,
	greekMap,
	integralSet,
	largeOperatorMap,
	limitFunctionSet,
	negationMap,
	operatorMap,
	ordinaryMap,
	overAccentMap,
	spaceMap,
	styleText,
	underAccentMap,
} from './symbol';

const fenceCharacterSet = new Set(['(', ')', '[', ']', '|', '{', '}', '⟨', '⟩', '‖', '⌊', '⌋', '⌈', '⌉']);

function row(childList: MathNode[], fallback: Span): MathNode {
	if (childList.length === 0) return { kind: 'Row', childList, span: fallback };
	return { kind: 'Row', childList, span: { start: childList[0]!.span.start, end: childList[childList.length - 1]!.span.end } };
}

function isEmpty(node: MathNode): boolean {
	return node.kind === 'Row' && node.childList.every(isEmpty);
}

function tokenText(token: Token): string {
	switch (token.kind) {
		case 'Space':
			return ' ';
		case 'Tilde':
			return ' ';
		case 'Command':
			return /^[A-Za-z]/.test(token.text) ? `\\${token.text}` : token.text === ' ' ? ' ' : token.text;
		default:
			return token.text;
	}
}

/** Applies \mathbf, \mathbb… to identifiers and numbers; \mathrm joins adjacent letters (`Br`). */
function applyVariant(node: MathNode, variant: Variant): MathNode {
	switch (node.kind) {
		case 'Identifier':
			if (node.function) return node;
			return variant === 'Normal' ? { ...node, normal: true } : { ...node, text: styleText(node.text, variant), normal: true };
		case 'Number':
			return variant === 'Normal' ? node : { ...node, text: styleText(node.text, variant) };
		case 'Row': {
			const childList: MathNode[] = [];
			for (const child of node.childList.map((item) => applyVariant(item, variant))) {
				const previous = childList[childList.length - 1];
				if (
					variant === 'Normal' &&
					previous?.kind === 'Identifier' &&
					child.kind === 'Identifier' &&
					!previous.function &&
					!child.function &&
					/^\p{L}+$/u.test(previous.text + child.text)
				) {
					childList[childList.length - 1] = { ...previous, text: previous.text + child.text, span: { start: previous.span.start, end: child.span.end } };
				} else childList.push(child);
			}
			return { ...node, childList };
		}
		case 'Script':
			return {
				...node,
				base: applyVariant(node.base, variant),
				...(node.sub ? { sub: applyVariant(node.sub, variant) } : {}),
				...(node.sup ? { sup: applyVariant(node.sup, variant) } : {}),
			};
		case 'Fraction':
			return { ...node, numerator: applyVariant(node.numerator, variant), denominator: applyVariant(node.denominator, variant) };
		case 'Root':
			return { ...node, base: applyVariant(node.base, variant) };
		case 'Accent':
			return { ...node, base: applyVariant(node.base, variant) };
		case 'Fenced':
		case 'Style':
		case 'Phantom':
			return { ...node, child: applyVariant(node.child, variant) };
		default:
			return node;
	}
}

export class Parser {
	private position = 0;

	constructor(
		readonly tokenList: readonly Token[],
		readonly problemList: MathProblem[],
	) {}

	/** Top level: `\\` and `&` outside environments make an implicit gathered/aligned table. */
	parseDocument(): MathNode {
		const start = this.tokenList[0]?.start ?? 0;
		const rowList = this.parseTableBody(undefined);
		this.skipSpace();
		if (rowList.length === 1 && rowList[0]!.length === 1) return rowList[0]![0]!;
		const hasAlign = rowList.some((cellList) => cellList.length > 1);
		const columnCount = Math.max(...rowList.map((cellList) => cellList.length));
		return {
			kind: 'Table',
			rowList,
			columnAlignList: Array.from({ length: columnCount }, (_, index) => (hasAlign ? (index % 2 === 0 ? 'right' : 'left') : 'center')),
			open: '',
			close: '',
			spacing: hasAlign ? 'Align' : 'Gather',
			span: { start, end: this.tokenList[this.tokenList.length - 1]?.end ?? start },
		};
	}

	// ------------------------------------------------------------ helper

	private peek(): Token | undefined {
		return this.tokenList[this.position];
	}

	private next(): Token | undefined {
		return this.tokenList[this.position++];
	}

	private skipSpace(): void {
		while (this.peek()?.kind === 'Space') this.position++;
	}

	private report(span: Span, message: string): void {
		this.problemList.push({ start: span.start, end: span.end, message });
	}

	private lastEnd(fallback: number): number {
		return this.tokenList[this.position - 1]?.end ?? fallback;
	}

	/** `{abc}` → "abc" (raw text, for names, colours, and \text). */
	private readText(at: Token): string {
		this.skipSpace();
		const open = this.next();
		if (!open) {
			this.report(at, `\\${at.text} needs {…}`);
			return '';
		}
		if (open.kind !== 'Open') return tokenText(open);
		let depth = 1;
		let text = '';
		for (;;) {
			const token = this.next();
			if (!token) {
				this.report(open, 'missing "}"');
				return text;
			}
			if (token.kind === 'Open') depth++;
			else if (token.kind === 'Close' && --depth === 0) return text;
			else text += tokenText(token);
		}
	}

	private readDelimiter(at: Token): string {
		this.skipSpace();
		const token = this.next();
		if (!token) {
			this.report(at, `\\${at.text} needs a delimiter`);
			return '';
		}
		const text = delimiterMap[token.text] ?? (token.kind === 'Command' ? operatorMap[token.text] : undefined);
		if (text === undefined) {
			this.report(token, `"${tokenText(token)}" is not a delimiter`);
			return '';
		}
		return text;
	}

	private readOptionalRow(): MathNode | undefined {
		this.skipSpace();
		const token = this.peek();
		if (!token || token.kind !== 'Char' || token.text !== '[') return undefined;
		this.position++;
		const node = this.parseRow((item) => item.kind === 'Char' && item.text === ']');
		if (this.peek()?.text === ']') this.position++;
		return node;
	}

	// ------------------------------------------------------------ structure

	private parseTableBody(endName: string | undefined): MathNode[][] {
		const rowList: MathNode[][] = [];
		let cellList: MathNode[] = [];
		const stop = (token: Token): boolean =>
			token.kind === 'Align' || (token.kind === 'Command' && (token.text === '\\' || token.text === 'cr' || (endName !== undefined && token.text === 'end')));
		for (;;) {
			cellList.push(this.parseRow(stop));
			const token = this.peek();
			if (!token) {
				if (endName !== undefined) this.report({ start: this.lastEnd(0), end: this.lastEnd(0) }, `missing \\end{${endName}}`);
				break;
			}
			this.position++;
			if (token.kind === 'Align') continue;
			if (token.text === '\\' || token.text === 'cr') {
				this.readOptionalRow();
				rowList.push(cellList);
				cellList = [];
				continue;
			}
			const name = this.readText(token);
			if (name !== endName) this.report(token, `\\end{${name}} does not match \\begin{${endName}}`);
			break;
		}
		rowList.push(cellList);
		if (rowList.length > 1 && rowList[rowList.length - 1]!.every(isEmpty)) rowList.pop();
		return rowList;
	}

	parseRow(stop: (token: Token) => boolean): MathNode {
		const childList: MathNode[] = [];
		const fallback = this.peek()?.start ?? this.lastEnd(0);
		for (;;) {
			this.skipSpace();
			const token = this.peek();
			if (!token || stop(token)) break;
			if (token.kind === 'Close' || token.kind === 'Align') {
				this.position++;
				this.report(token, token.kind === 'Close' ? 'unexpected "}"' : '"&" only works inside a table or aligned environment');
				continue;
			}
			if (token.kind === 'Command' && (token.text === 'color' || token.text === 'displaystyle' || token.text === 'textstyle')) {
				this.position++;
				const color = token.text === 'color' ? this.readText(token) : undefined;
				const rest = this.parseRow(stop);
				childList.push({
					kind: 'Style',
					...(color !== undefined ? { color } : { display: token.text === 'displaystyle' }),
					child: rest,
					span: { start: token.start, end: Math.max(rest.span.end, token.end) },
				});
				break;
			}
			const atom = this.parseAtomWithScript();
			if (atom) childList.push(atom);
		}
		return row(childList, { start: fallback, end: fallback });
	}

	private parseAtomWithScript(): MathNode | undefined {
		const base = this.parseAtom();
		if (!base) return undefined;
		let limit: Limit =
			(base.kind === 'Operator' || base.kind === 'Identifier' ? base.limit : undefined) ??
			(base.kind === 'Accent' && (base.accent === '⏞' || base.accent === '⏟') ? 'Always' : 'Never');
		let sub: MathNode | undefined;
		let sup: MathNode | undefined;
		let end = base.span.end;
		for (;;) {
			this.skipSpace();
			const token = this.peek();
			if (!token) break;
			if (token.kind === 'Command' && (token.text === 'limits' || token.text === 'nolimits')) {
				this.position++;
				limit = token.text === 'limits' ? 'Always' : 'Never';
				continue;
			}
			if (token.kind === 'Prime') {
				let count = 0;
				while (this.peek()?.kind === 'Prime') {
					this.position++;
					count++;
				}
				const prime: MathNode = { kind: 'Operator', text: ['′', '″', '‴', '⁗'][Math.min(count, 4) - 1]!, span: { start: token.start, end: this.lastEnd(token.end) } };
				sup = sup ? row([sup, prime], prime.span) : prime;
				end = prime.span.end;
				continue;
			}
			if (token.kind === 'Super' || token.kind === 'Sub') {
				this.position++;
				const argument = this.parseScriptArgument(token);
				end = Math.max(end, argument.span.end);
				if (token.kind === 'Super') {
					if (sup && !(sup.kind === 'Operator' && '′″‴⁗'.includes(sup.text))) this.report(token, 'double superscript');
					sup = sup && sup.kind === 'Operator' ? row([sup, argument], argument.span) : argument;
				} else {
					if (sub) this.report(token, 'double subscript');
					sub = argument;
				}
				continue;
			}
			break;
		}
		if (!sub && !sup) return base;
		return { kind: 'Script', base, ...(sub ? { sub } : {}), ...(sup ? { sup } : {}), limit, span: { start: base.span.start, end } };
	}

	private parseScriptArgument(at: Token): MathNode {
		this.skipSpace();
		const token = this.peek();
		if (!token || token.kind === 'Close' || token.kind === 'Align' || token.kind === 'Super' || token.kind === 'Sub') {
			this.report(at, `"${at.text}" needs something after it`);
			return { kind: 'Row', childList: [], span: { start: at.end, end: at.end } };
		}
		return this.parseAtom() ?? { kind: 'Row', childList: [], span: { start: at.end, end: at.end } };
	}

	/** A `{group}` or a single atom (used for command arguments). */
	private parseArgument(at: Token): MathNode {
		this.skipSpace();
		const token = this.peek();
		if (!token || token.kind === 'Close') {
			this.report(at, `\\${at.text} is missing an argument`);
			return { kind: 'Row', childList: [], span: { start: at.end, end: at.end } };
		}
		return this.parseAtom() ?? { kind: 'Row', childList: [], span: { start: at.end, end: at.end } };
	}

	private parseAtom(): MathNode | undefined {
		const token = this.next();
		if (!token) return undefined;
		const span = { start: token.start, end: token.end };
		switch (token.kind) {
			case 'Open': {
				const inner = this.parseRow((item) => item.kind === 'Close');
				const close = this.next();
				if (!close) this.report(token, 'missing "}"');
				return { kind: 'Row', childList: inner.kind === 'Row' ? inner.childList : [inner], span: { start: token.start, end: close?.end ?? inner.span.end } };
			}
			case 'Super':
			case 'Sub':
				// a script with no base ({}^2): give it an empty base
				this.position--;
				return { kind: 'Row', childList: [], span: { start: token.start, end: token.start } };
			case 'Tilde':
				return { kind: 'Text', text: ' ', span };
			case 'Prime':
				return { kind: 'Operator', text: '′', span };
			case 'Param':
				this.report(token, 'a macro parameter (#) is only allowed inside a definition');
				return { kind: 'Error', text: `#${token.text}`, message: 'parameter outside a macro', span };
			case 'Close':
			case 'Align':
			case 'Space':
				return undefined;
			case 'Char':
				return this.parseCharacter(token);
			case 'Command':
				return this.parseCommand(token);
		}
	}

	private parseCharacter(token: Token): MathNode {
		const text = token.text;
		const nextIsDigit = (): boolean => /^[0-9]$/.test(this.peek()?.text ?? '') && this.peek()?.kind === 'Char';
		if (/^[0-9]$/.test(text) || (text === '.' && nextIsDigit())) {
			let value = text;
			let end = token.end;
			for (;;) {
				const next = this.peek();
				if (next?.kind !== 'Char') break;
				if (/^[0-9]$/.test(next.text)) {
					value += next.text;
				} else if (next.text === '.' && !value.includes('.') && /^[0-9]$/.test(this.tokenList[this.position + 1]?.text ?? '')) {
					value += '.';
				} else break;
				end = next.end;
				this.position++;
			}
			return { kind: 'Number', text: value, span: { start: token.start, end } };
		}
		const operator = characterOperatorMap[text];
		if (operator !== undefined) {
			return { kind: 'Operator', text: operator, ...(fenceCharacterSet.has(text) ? { stretchy: false } : {}), span: { start: token.start, end: token.end } };
		}
		if (/^\p{L}$/u.test(text)) return { kind: 'Identifier', text, normal: false, span: { start: token.start, end: token.end } };
		return { kind: 'Operator', text, span: { start: token.start, end: token.end } };
	}

	private parseCommand(token: Token): MathNode {
		const name = token.text;
		const span = { start: token.start, end: token.end };
		const greek = greekMap[name];
		if (greek) return { kind: 'Identifier', text: greek, normal: /^[A-Z]/.test(name), span };
		const ordinary = ordinaryMap[name];
		if (ordinary) return { kind: 'Identifier', text: ordinary, normal: true, span };
		const large = largeOperatorMap[name];
		if (large) return { kind: 'Operator', text: large, large: true, limit: integralSet.has(name) ? 'Never' : 'Display', span };
		if (functionSet.has(name)) return { kind: 'Identifier', text: name, normal: true, function: true, limit: limitFunctionSet.has(name) ? 'Display' : 'Never', span };
		const operator = operatorMap[name];
		if (operator) return { kind: 'Operator', text: operator, ...(fenceCharacterSet.has(operator) ? { stretchy: false } : {}), span };
		const space = spaceMap[name];
		if (space) return { kind: 'Space', width: space, span };
		const variant = fontCommandMap[name];
		if (variant) {
			if (name === 'operatorname') {
				const text = this.readText(token);
				return { kind: 'Identifier', text, normal: true, function: true, limit: 'Never', span: { start: token.start, end: this.lastEnd(token.end) } };
			}
			const argument = this.parseArgument(token);
			return { ...applyVariant(argument, variant), span: { start: token.start, end: argument.span.end } } as MathNode;
		}
		const overAccent = overAccentMap[name];
		const underAccent = underAccentMap[name];
		if (overAccent || underAccent) {
			const [accent, stretchy] = (overAccent ?? underAccent)!;
			const base = this.parseArgument(token);
			return { kind: 'Accent', base, accent, stretchy, under: !overAccent, span: { start: token.start, end: base.span.end } };
		}
		const bigName = name.replace(/[lrm]$/, '');
		const bigSize = bigSizeMap[bigName];
		if (bigSize) {
			const text = this.readDelimiter(token);
			return { kind: 'Operator', text, stretchy: true, size: bigSize, span: { start: token.start, end: this.lastEnd(token.end) } };
		}
		return this.parseStructure(token, span);
	}

	private parseStructure(token: Token, span: Span): MathNode {
		const end = (): Span => ({ start: token.start, end: this.lastEnd(token.end) });
		switch (token.text) {
			case 'frac':
			case 'dfrac':
			case 'tfrac':
			case 'cfrac': {
				const numerator = this.parseArgument(token);
				const denominator = this.parseArgument(token);
				const display = token.text === 'dfrac' || token.text === 'cfrac' ? true : token.text === 'tfrac' ? false : undefined;
				return { kind: 'Fraction', numerator, denominator, ...(display !== undefined ? { display } : {}), span: end() };
			}
			case 'binom':
			case 'dbinom':
			case 'tbinom': {
				const numerator = this.parseArgument(token);
				const denominator = this.parseArgument(token);
				const fraction: MathNode = { kind: 'Fraction', numerator, denominator, thickness: '0', span: end() };
				return { kind: 'Fenced', open: '(', close: ')', child: fraction, span: end() };
			}
			case 'sqrt': {
				const index = this.readOptionalRow();
				const base = this.parseArgument(token);
				return { kind: 'Root', base, ...(index ? { index } : {}), span: end() };
			}
			case 'left':
				return this.parseLeftRight(token);
			case 'text':
			case 'textrm':
			case 'textup':
			case 'textnormal':
			case 'mbox':
			case 'textbf':
			case 'textit': {
				const text = this.readText(token);
				return { kind: 'Text', text, ...(token.text === 'textbf' ? { bold: true } : {}), ...(token.text === 'textit' ? { italic: true } : {}), span: end() };
			}
			case 'textcolor': {
				const color = this.readText(token);
				const child = this.parseArgument(token);
				return { kind: 'Style', color, child, span: end() };
			}
			case 'boxed': {
				const child = this.parseArgument(token);
				return { kind: 'Style', box: true, child, span: end() };
			}
			case 'phantom': {
				const child = this.parseArgument(token);
				return { kind: 'Phantom', child, span: end() };
			}
			case 'not': {
				this.skipSpace();
				const next = this.next();
				const negated = next ? negationMap[next.text] : undefined;
				if (!next || !negated) {
					this.report(token, '\\not needs a relation such as = or \\in');
					return { kind: 'Operator', text: '̸', span };
				}
				return { kind: 'Operator', text: negated, span: end() };
			}
			case 'overset':
			case 'stackrel':
			case 'underset': {
				const mark = this.parseArgument(token);
				const base = this.parseArgument(token);
				const under = token.text === 'underset';
				return { kind: 'Script', base, ...(under ? { sub: mark } : { sup: mark }), limit: 'Always', span: end() };
			}
			case 'xrightarrow':
			case 'xleftarrow': {
				const below = this.readOptionalRow();
				const above = this.parseArgument(token);
				const arrow: MathNode = { kind: 'Operator', text: token.text === 'xrightarrow' ? '→' : '←', stretchy: true, span };
				return { kind: 'Script', base: arrow, sup: above, ...(below ? { sub: below } : {}), limit: 'Always', span: end() };
			}
			case 'pmod': {
				const argument = this.parseArgument(token);
				const childList: MathNode[] = [
					{ kind: 'Space', width: '0.4444em', span },
					{ kind: 'Operator', text: '(', stretchy: false, span },
					{ kind: 'Identifier', text: 'mod', normal: true, span },
					{ kind: 'Space', width: '0.3333em', span },
					argument,
					{ kind: 'Operator', text: ')', stretchy: false, span },
				];
				return { kind: 'Row', childList, span: end() };
			}
			case 'bmod':
			case 'mod':
				return { kind: 'Row', childList: [{ kind: 'Space', width: '0.2222em', span }, { kind: 'Identifier', text: 'mod', normal: true, span }, { kind: 'Space', width: '0.2222em', span }], span };
			case 'begin':
				return this.parseEnvironment(token);
			case 'right':
			case 'middle':
			case 'end':
				this.report(token, `\\${token.text} without a matching opening`);
				return { kind: 'Error', text: `\\${token.text}`, message: 'unmatched', span };
			case '\u0000Overflow':
				return { kind: 'Error', text: '…', message: 'macro expansion stopped', span };
			default:
				this.report(token, `unknown command \\${token.text}`);
				return { kind: 'Error', text: `\\${token.text}`, message: 'unknown command', span };
		}
	}

	private parseLeftRight(left: Token): MathNode {
		const open = this.readDelimiter(left);
		const childList: MathNode[] = [];
		for (;;) {
			const part = this.parseRow((token) => token.kind === 'Command' && (token.text === 'right' || token.text === 'middle'));
			childList.push(...(part.kind === 'Row' ? part.childList : [part]));
			const token = this.next();
			if (!token) {
				this.report(left, 'missing \\right');
				return { kind: 'Fenced', open, close: '', child: row(childList, left), span: { start: left.start, end: this.lastEnd(left.end) } };
			}
			if (token.text === 'middle') {
				const middle = this.readDelimiter(token);
				childList.push({ kind: 'Operator', text: middle, stretchy: true, fence: 'Middle', span: { start: token.start, end: this.lastEnd(token.end) } });
				continue;
			}
			const close = this.readDelimiter(token);
			return { kind: 'Fenced', open, close, child: row(childList, left), span: { start: left.start, end: this.lastEnd(token.end) } };
		}
	}

	private parseEnvironment(begin: Token): MathNode {
		const name = this.readText(begin);
		let open = '';
		let close = '';
		let spacing: 'Matrix' | 'Align' | 'Gather' = 'Matrix';
		let alignList: string[] | undefined;
		switch (name) {
			case 'matrix':
			case 'smallmatrix':
				break;
			case 'pmatrix':
				[open, close] = ['(', ')'];
				break;
			case 'bmatrix':
				[open, close] = ['[', ']'];
				break;
			case 'Bmatrix':
				[open, close] = ['{', '}'];
				break;
			case 'vmatrix':
				[open, close] = ['|', '|'];
				break;
			case 'Vmatrix':
				[open, close] = ['‖', '‖'];
				break;
			case 'cases':
				open = '{';
				alignList = ['left', 'left'];
				break;
			case 'rcases':
				close = '}';
				alignList = ['left', 'left'];
				break;
			case 'aligned':
			case 'align':
			case 'align*':
			case 'alignat':
			case 'alignat*':
			case 'split':
				spacing = 'Align';
				break;
			case 'gathered':
			case 'gather':
			case 'gather*':
				spacing = 'Gather';
				break;
			case 'array': {
				const specification = this.readText(begin);
				const alignMap: Readonly<Record<string, string>> = { l: 'left', c: 'center', r: 'right' };
				alignList = [...specification].flatMap((letter) => (alignMap[letter] ? [alignMap[letter]!] : []));
				break;
			}
			case 'equation':
			case 'equation*': {
				const body = this.parseRow((token) => token.kind === 'Command' && token.text === 'end');
				if (this.next()) this.readText(begin);
				return body;
			}
			default:
				this.report(begin, `unknown environment "${name}"`);
		}
		const rowList = this.parseTableBody(name);
		const columnCount = Math.max(1, ...rowList.map((cellList) => cellList.length));
		const align = (index: number): string =>
			alignList?.[index] ?? (spacing === 'Align' ? (index % 2 === 0 ? 'right' : 'left') : 'center');
		return {
			kind: 'Table',
			rowList,
			columnAlignList: Array.from({ length: columnCount }, (_, index) => align(index)),
			open,
			close,
			spacing,
			span: { start: begin.start, end: this.lastEnd(begin.end) },
		};
	}
}
