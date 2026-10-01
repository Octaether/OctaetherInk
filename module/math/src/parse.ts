// TeX-math subset, part 1: node types, tokenizer, macro expander. Every token and node keeps
// its source span, so a click on any rendered piece maps back to exactly that part of the source.

export interface Span {
	start: number;
	end: number;
}

export type Limit = 'Always' | 'Display' | 'Never';

export type MathNode =
	| { kind: 'Row'; childList: MathNode[]; span: Span }
	| { kind: 'Identifier'; text: string; normal: boolean; function?: boolean; limit?: Limit; span: Span }
	| { kind: 'Number'; text: string; span: Span }
	| { kind: 'Operator'; text: string; stretchy?: boolean; large?: boolean; limit?: Limit; size?: string; fence?: 'Open' | 'Close' | 'Middle'; span: Span }
	| { kind: 'Text'; text: string; bold?: boolean; italic?: boolean; span: Span }
	| { kind: 'Space'; width: string; span: Span }
	| { kind: 'Script'; base: MathNode; sub?: MathNode; sup?: MathNode; limit: Limit; span: Span }
	| { kind: 'Fraction'; numerator: MathNode; denominator: MathNode; thickness?: string; display?: boolean; span: Span }
	| { kind: 'Root'; base: MathNode; index?: MathNode; span: Span }
	| { kind: 'Accent'; base: MathNode; accent: string; stretchy: boolean; under: boolean; span: Span }
	| { kind: 'Fenced'; open: string; close: string; child: MathNode; span: Span }
	| { kind: 'Table'; rowList: MathNode[][]; columnAlignList: string[]; open: string; close: string; spacing: 'Matrix' | 'Align' | 'Gather'; span: Span }
	| { kind: 'Style'; color?: string; display?: boolean; box?: boolean; child: MathNode; span: Span }
	| { kind: 'Phantom'; child: MathNode; span: Span }
	| { kind: 'Error'; text: string; message: string; span: Span };

export interface MathProblem {
	start: number;
	end: number;
	message: string;
}

// ---------------------------------------------------------------- tokenizer

type TokenKind = 'Command' | 'Char' | 'Open' | 'Close' | 'Super' | 'Sub' | 'Align' | 'Param' | 'Space' | 'Tilde' | 'Prime';

export interface Token {
	kind: TokenKind;
	text: string;
	start: number;
	end: number;
}

const letterPattern = /[A-Za-z]/;

export function tokenize(source: string, offset = 0): Token[] {
	const tokenList: Token[] = [];
	let index = 0;
	const push = (kind: TokenKind, text: string, start: number, end: number): void => {
		tokenList.push({ kind, text, start: start + offset, end: end + offset });
	};
	while (index < source.length) {
		const character = source[index]!;
		const start = index;
		if (character === '\\') {
			const next = source[index + 1];
			if (next === undefined) {
				push('Char', '\\', start, index + 1);
				index++;
			} else if (letterPattern.test(next)) {
				let end = index + 1;
				while (end < source.length && letterPattern.test(source[end]!)) end++;
				push('Command', source.slice(index + 1, end), start, end);
				index = end;
				while (index < source.length && /[ \t\r\n]/.test(source[index]!)) index++;
			} else {
				push('Command', next, start, index + 2);
				index += 2;
			}
			continue;
		}
		if (character === '%') {
			while (index < source.length && source[index] !== '\n') index++;
			continue;
		}
		if (/\s/.test(character)) {
			let end = index;
			while (end < source.length && /\s/.test(source[end]!)) end++;
			push('Space', source.slice(index, end), start, end);
			index = end;
			continue;
		}
		if (character === '#') {
			const digit = source[index + 1];
			if (digit !== undefined && /[1-9]/.test(digit)) {
				push('Param', digit, start, index + 2);
				index += 2;
			} else {
				push('Char', '#', start, index + 1);
				index++;
			}
			continue;
		}
		const kindMap: Readonly<Record<string, TokenKind>> = { '{': 'Open', '}': 'Close', '^': 'Super', _: 'Sub', '&': 'Align', '~': 'Tilde', "'": 'Prime' };
		const text = String.fromCodePoint(source.codePointAt(index)!);
		push(kindMap[text] ?? 'Char', text, start, index + text.length);
		index += text.length;
	}
	return tokenList;
}

// ---------------------------------------------------------------- macro expansion

export interface Macro {
	parameterCount: number;
	defaultTokenList: Token[] | undefined;
	bodyTokenList: Token[];
}

export type MacroScope = Map<string, Macro>;

const expansionLimit = 2000;
const tokenLimit = 100_000;

class Expander {
	private readonly stack: Token[];
	private readonly output: Token[] = [];
	private count = 0;

	constructor(
		tokenList: readonly Token[],
		readonly scope: MacroScope,
		readonly problemList: MathProblem[],
	) {
		this.stack = [...tokenList].reverse();
	}

	run(): Token[] {
		for (;;) {
			const token = this.stack.pop();
			if (!token) break;
			if (token.kind === 'Command') {
				if (token.text === 'newcommand' || token.text === 'renewcommand' || token.text === 'providecommand') {
					this.define(token);
					continue;
				}
				if (token.text === 'def') {
					this.defineDef(token);
					continue;
				}
				if (token.text === 'DeclareMathOperator') {
					this.defineOperator(token);
					continue;
				}
				const macro = this.scope.get(token.text);
				if (macro) {
					if (!this.expand(token, macro)) break;
					continue;
				}
			}
			this.output.push(token);
		}
		return this.output;
	}

	private report(token: Token, message: string): void {
		this.problemList.push({ start: token.start, end: token.end, message });
	}

	private skipSpace(): void {
		while (this.stack[this.stack.length - 1]?.kind === 'Space') this.stack.pop();
	}

	private readGroup(): { tokenList: Token[]; end: number } | undefined {
		this.skipSpace();
		const first = this.stack.pop();
		if (!first) return undefined;
		if (first.kind !== 'Open') return { tokenList: [first], end: first.end };
		const tokenList: Token[] = [];
		let depth = 1;
		for (;;) {
			const token = this.stack.pop();
			if (!token) {
				this.report(first, 'missing "}"');
				return { tokenList, end: tokenList[tokenList.length - 1]?.end ?? first.end };
			}
			if (token.kind === 'Open') depth++;
			else if (token.kind === 'Close' && --depth === 0) return { tokenList, end: token.end };
			tokenList.push(token);
		}
	}

	private readOptional(): Token[] | undefined {
		this.skipSpace();
		const next = this.stack[this.stack.length - 1];
		if (!next || next.kind !== 'Char' || next.text !== '[') return undefined;
		this.stack.pop();
		const tokenList: Token[] = [];
		let depth = 0;
		for (;;) {
			const token = this.stack.pop();
			if (!token) return tokenList;
			if (token.kind === 'Open') depth++;
			if (token.kind === 'Close') depth--;
			if (token.kind === 'Char' && token.text === ']' && depth === 0) return tokenList;
			tokenList.push(token);
		}
	}

	private define(command: Token): void {
		const nameToken = this.readGroup()?.tokenList.find((token) => token.kind === 'Command');
		if (!nameToken) {
			this.report(command, `expected a command name after \\${command.text}`);
			return;
		}
		let parameterCount = 0;
		const countList = this.readOptional();
		if (countList) {
			const count = Number(countList.map((token) => token.text).join(''));
			if (Number.isInteger(count) && count >= 0 && count <= 9) parameterCount = count;
			else this.report(command, 'the number of arguments must be 0 to 9');
		}
		const defaultTokenList = parameterCount > 0 ? this.readOptional() : undefined;
		const body = this.readGroup();
		if (!body) {
			this.report(command, `\\${command.text} needs a body`);
			return;
		}
		if (command.text === 'providecommand' && this.scope.has(nameToken.text)) return;
		this.scope.set(nameToken.text, { parameterCount, defaultTokenList, bodyTokenList: body.tokenList });
	}

	private defineDef(command: Token): void {
		this.skipSpace();
		const nameToken = this.stack.pop();
		if (!nameToken || nameToken.kind !== 'Command') {
			this.report(command, 'expected a command name after \\def');
			return;
		}
		let parameterCount = 0;
		while (this.stack[this.stack.length - 1]?.kind === 'Param') {
			this.stack.pop();
			parameterCount++;
		}
		const body = this.readGroup();
		if (body) this.scope.set(nameToken.text, { parameterCount, defaultTokenList: undefined, bodyTokenList: body.tokenList });
	}

	private defineOperator(command: Token): void {
		const nameToken = this.readGroup()?.tokenList.find((token) => token.kind === 'Command');
		const text = this.readGroup();
		if (!nameToken || !text) {
			this.report(command, '\\DeclareMathOperator needs {\\name}{text}');
			return;
		}
		const at = { start: command.start, end: command.end };
		this.scope.set(nameToken.text, {
			parameterCount: 0,
			defaultTokenList: undefined,
			bodyTokenList: [{ kind: 'Command', text: 'operatorname', ...at }, { kind: 'Open', text: '{', ...at }, ...text.tokenList, { kind: 'Close', text: '}', ...at }],
		});
	}

	private expand(token: Token, macro: Macro): boolean {
		if (++this.count > expansionLimit || this.stack.length > tokenLimit) {
			this.report(token, 'macro expansion is too deep (does a macro call itself?)');
			this.output.push({ kind: 'Command', text: '\u0000Overflow', start: token.start, end: token.end });
			return false;
		}
		const argumentList: Token[][] = [];
		let end = token.end;
		for (let index = 0; index < macro.parameterCount; index++) {
			if (index === 0 && macro.defaultTokenList) {
				argumentList.push(this.readOptional() ?? macro.defaultTokenList);
				continue;
			}
			const group = this.readGroup();
			if (!group) {
				this.report(token, `\\${token.text} needs ${macro.parameterCount} argument(s)`);
				argumentList.push([]);
				continue;
			}
			argumentList.push(group.tokenList);
			end = Math.max(end, group.end);
		}
		const result: Token[] = [];
		for (const bodyToken of macro.bodyTokenList) {
			if (bodyToken.kind === 'Param') {
				result.push(...(argumentList[Number(bodyToken.text) - 1] ?? []));
				continue;
			}
			// expanded pieces map back to the macro call
			result.push({ ...bodyToken, start: token.start, end });
		}
		for (let index = result.length - 1; index >= 0; index--) this.stack.push(result[index]!);
		return true;
	}
}

export function expandMacro(tokenList: readonly Token[], scope: MacroScope, problemList: MathProblem[]): Token[] {
	return new Expander(tokenList, scope, problemList).run();
}

/** Reads macro definitions (e.g. a `.oi/Macro/*.tex` file) into a scope. */
export function defineMacro(scope: MacroScope, source: string): MathProblem[] {
	const problemList: MathProblem[] = [];
	expandMacro(tokenize(source), scope, problemList);
	return problemList;
}
