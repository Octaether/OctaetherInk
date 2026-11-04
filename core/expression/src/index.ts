// Expressions for Table formulas and filters and for Plot: parsed into a tree, then compiled into
// plain functions (no eval or Function, so notes can't run code and the page's CSP holds).
//
//   numbers 2, 1.5, 3e8; dates 2026-11-04 (days from 1970, so they plot and subtract); "text"
//   + - * / ^ (right to left) ! mod, implicit multiplication (2x, a x, 2(x+1), sin 2x = sin(2x))
//   < <= > >= = != and or not contains; piecewise {x < 0: -x, x}; lists [1, 2, 3]; points (x, y)
//   functions sin … atanh, atan2, exp ln log log2 sqrt cbrt abs sign floor ceil round min max nCr
//   nPr, and over lists mean median sum count stdev var range quantile; constants pi π e tau τ
//   names x, a_1, θ (or theta), Weight (a capital first: a table column, never split into letters)
//
// Trigonometry is in radians (Plot); TikZ keeps its own degree-based evaluator.

export type Value = number | string | Value[];

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | 'mod' | '<' | '<=' | '>' | '>=' | '=' | '!=' | 'and' | 'or' | 'contains';

interface Span {
	start: number;
	end: number;
}

export type ExpressionNode = Span &
	(
		| { kind: 'Number'; value: number }
		| { kind: 'Text'; value: string }
		| { kind: 'Name'; name: string }
		| { kind: 'Call'; name: string; argumentList: ExpressionNode[] }
		| { kind: 'Unary'; operator: '-' | 'not' | '!'; operand: ExpressionNode }
		| { kind: 'Binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
		| { kind: 'List'; itemList: ExpressionNode[] }
		| { kind: 'Tuple'; itemList: ExpressionNode[] }
		| { kind: 'Piecewise'; caseList: { condition: ExpressionNode | undefined; value: ExpressionNode }[] }
	);

/** A mistake in an expression, with where it is (character offsets in the text). */
export class ExpressionError extends Error {
	constructor(
		message: string,
		readonly start: number,
		readonly end: number,
	) {
		super(message);
	}
}

// ---------------------------------------------------------------- dates

/** `2026-11-04` or `2026-11-04 09:30` (an offset after it is ignored) → days from 1970-01-01, the time as a fraction. */
export function dayOf(text: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text.trim());
	if (!match) return undefined;
	const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
	if (!Number.isFinite(day)) return undefined;
	return day + (match[4] ? (Number(match[4]) * 60 + Number(match[5])) / 1440 : 0);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Days from 1970 → `2026-11-04`, or `2026-11-04 09:30` when it has a time of day. */
export function dayText(day: number, withTime = day % 1 !== 0): string {
	const date = new Date(Math.round(day * 1440) * 60_000);
	const text = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
	return withTime ? `${text} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : text;
}

// ---------------------------------------------------------------- built-ins

type NumberFunction = (...valueList: number[]) => number;

const factorial = (value: number): number => {
	if (value < 0 || !Number.isInteger(value)) return Number.NaN;
	let result = 1;
	for (let index = 2; index <= value; index++) result *= index;
	return result;
};

/** Functions of numbers; a list given to one of them is mapped (sin of a list is a list). */
const numberFunctionMap: Readonly<Record<string, NumberFunction>> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	sec: (value) => 1 / Math.cos(value),
	csc: (value) => 1 / Math.sin(value),
	cot: (value) => 1 / Math.tan(value),
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	arcsin: Math.asin,
	arccos: Math.acos,
	arctan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	asinh: Math.asinh,
	acosh: Math.acosh,
	atanh: Math.atanh,
	atan2: Math.atan2,
	exp: Math.exp,
	ln: Math.log,
	log: (value, base) => (base === undefined ? Math.log10(value) : Math.log(value) / Math.log(base)),
	log2: Math.log2,
	sqrt: Math.sqrt,
	cbrt: Math.cbrt,
	abs: Math.abs,
	sign: Math.sign,
	floor: Math.floor,
	ceil: Math.ceil,
	round: (value, digit = 0) => Math.round(value * 10 ** digit) / 10 ** digit,
	nCr: (n, k) => factorial(n) / (factorial(k) * factorial(n - k)),
	nPr: (n, k) => factorial(n) / factorial(n - k),
	factorial,
};

const numberListOf = (valueList: readonly Value[]): number[] => {
	const list: number[] = [];
	const add = (value: Value): void => {
		if (Array.isArray(value)) value.forEach(add);
		else if (typeof value === 'number' && !Number.isNaN(value)) list.push(value);
	};
	valueList.forEach(add);
	return list;
};

/** The value at fraction `q` of a sorted list (linear between neighbours, as spreadsheets do). */
export function quantile(sortedList: readonly number[], q: number): number {
	if (sortedList.length === 0) return Number.NaN;
	const at = Math.min(Math.max(q, 0), 1) * (sortedList.length - 1);
	const low = Math.floor(at);
	const high = Math.ceil(at);
	return sortedList[low]! + (sortedList[high]! - sortedList[low]!) * (at - low);
}

const sum = (list: readonly number[]): number => list.reduce((total, value) => total + value, 0);
const variance = (list: readonly number[]): number => {
	if (list.length < 2) return Number.NaN;
	const mean = sum(list) / list.length;
	return sum(list.map((value) => (value - mean) ** 2)) / (list.length - 1);
};

/** Functions of lists (several numbers, or lists, or both: `mean(^gym.Weight)`, `max(a, b)`). */
const listFunctionMap: Readonly<Record<string, (list: number[]) => number>> = {
	mean: (list) => (list.length ? sum(list) / list.length : Number.NaN),
	average: (list) => (list.length ? sum(list) / list.length : Number.NaN),
	median: (list) => quantile([...list].sort((a, b) => a - b), 0.5),
	sum: (list) => sum(list),
	total: (list) => sum(list),
	count: (list) => list.length,
	length: (list) => list.length,
	stdev: (list) => Math.sqrt(variance(list)),
	var: (list) => variance(list),
	min: (list) => (list.length ? Math.min(...list) : Number.NaN),
	max: (list) => (list.length ? Math.max(...list) : Number.NaN),
	range: (list) => (list.length ? Math.max(...list) - Math.min(...list) : Number.NaN),
};

const constantMap: Readonly<Record<string, number>> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI, τ: 2 * Math.PI, inf: Number.POSITIVE_INFINITY, infinity: Number.POSITIVE_INFINITY, '∞': Number.POSITIVE_INFINITY };

const greekMap: Readonly<Record<string, string>> = {
	alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
	nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};

const keywordSet = new Set(['and', 'or', 'not', 'mod', 'contains']);

/** Built-in function names (for an editor's suggestions, and to tell `f(x)` calls from products). */
export const builtinFunctionList: readonly string[] = [...new Set([...Object.keys(numberFunctionMap), ...Object.keys(listFunctionMap), 'quantile'])];
const builtinFunctionSet = new Set(builtinFunctionList);
/** Functions that take one value and may be written without parentheses: `sin x`, `ln 2x`. */
const bareFunctionSet = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log2', 'sqrt', 'cbrt', 'abs']);

export function isConstant(name: string): boolean {
	return name in constantMap;
}

// ---------------------------------------------------------------- tokens

type TokenKind = 'Number' | 'Text' | 'Name' | 'Operator' | 'End';

interface Token extends Span {
	kind: TokenKind;
	text: string;
	value?: number;
	table?: string;
}

export interface ParseOption {
	/**
	 * Splits unknown runs of letters into single names (`ax` = a·x, `xy` = x·y), as Desmos does; the
	 * known names (and built-ins) stay whole, and so does a name with a capital first (a column). Off for tables, whose columns have long names.
	 */
	split?: boolean;
	/** Names that stay whole when splitting (defined variables and functions). */
	knownName?(name: string): boolean;
	/** Names that are functions (`f` in `f(x)`), besides the built-ins; otherwise `a(x+1)` is a product. */
	isFunction?(name: string): boolean;
}

const nameStart = /[A-Za-zͰ-Ͽ_]/;
const namePart = /[A-Za-z0-9Ͱ-Ͽ]/;

function tokenize(text: string, option: ParseOption): Token[] {
	const tokenList: Token[] = [];
	const known = (name: string): boolean =>
		name in constantMap || name in greekMap || builtinFunctionSet.has(name) || keywordSet.has(name) || (option.knownName?.(name) ?? false) || (option.isFunction?.(name) ?? false);
	let at = 0;
	while (at < text.length) {
		const character = text[at]!;
		if (/\s/.test(character)) {
			at++;
			continue;
		}
		const rest = text.slice(at);
		const date = /^\d{4}-\d{2}-\d{2}(?:T\d{1,2}:\d{2})?/.exec(rest);
		if (date) {
			tokenList.push({ kind: 'Number', text: date[0], value: dayOf(date[0].replace('T', ' ')), start: at, end: at + date[0].length });
			at += date[0].length;
			continue;
		}
		const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
		if (number) {
			tokenList.push({ kind: 'Number', text: number[0], value: Number(number[0]), start: at, end: at + number[0].length });
			at += number[0].length;
			continue;
		}
		if (character === '"') {
			const close = text.indexOf('"', at + 1);
			if (close < 0) throw new ExpressionError('a text without its closing "', at, text.length);
			tokenList.push({ kind: 'Text', text: text.slice(at + 1, close), start: at, end: close + 1 });
			at = close + 1;
			continue;
		}
		if (nameStart.test(character)) {
			let end = at + 1;
			while (end < text.length && namePart.test(text[end]!)) end++;
			let base = text.slice(at, end);
			let subscript = '';
			if (text[end] === '_' && end + 1 < text.length && namePart.test(text[end + 1]!)) {
				let subEnd = end + 1;
				while (subEnd < text.length && namePart.test(text[subEnd]!)) subEnd++;
				subscript = text.slice(end, subEnd);
				end = subEnd;
			}
			if (base.startsWith('_')) base = base.slice(1);
			const pieceList: { text: string; start: number }[] = [];
			// a capitalized name (a table column: Weight, Date) is never split into letters
			if (!option.split || known(base + subscript) || known(base) || base.length === 1 || /^[A-Z]/.test(base)) pieceList.push({ text: base, start: at });
			else {
				// the longest known name at each place, else one letter
				let index = 0;
				while (index < base.length) {
					let length = 1;
					for (let size = base.length - index; size > 1; size--) {
						if (known(base.slice(index, index + size))) {
							length = size;
							break;
						}
					}
					pieceList.push({ text: base.slice(index, index + length), start: at + index });
					index += length;
				}
			}
			pieceList.forEach((piece, index) => {
				const last = index === pieceList.length - 1;
				const name = (last ? piece.text + subscript : piece.text).trim();
				tokenList.push({ kind: 'Name', text: greekMap[name] ?? name, start: piece.start, end: last ? end : piece.start + piece.text.length });
			});
			at = end;
			continue;
		}
		const operator = /^(?:<=|>=|!=|==|\*\*|[≤≥≠·×÷−²³+\-*/^()[\]{},:<>=!|])/.exec(rest);
		if (operator) {
			const map: Record<string, string> = { '≤': '<=', '≥': '>=', '≠': '!=', '==': '=', '**': '^', '·': '*', '×': '*', '÷': '/', '−': '-' };
			const symbol = operator[0];
			if (symbol === '²' || symbol === '³') {
				tokenList.push({ kind: 'Operator', text: '^', start: at, end: at + 1 }, { kind: 'Number', text: symbol, value: symbol === '²' ? 2 : 3, start: at, end: at + 1 });
			} else tokenList.push({ kind: 'Operator', text: map[symbol] ?? symbol, start: at, end: at + symbol.length });
			at += symbol.length;
			continue;
		}
		throw new ExpressionError(`“${character}” is not part of an expression`, at, at + 1);
	}
	tokenList.push({ kind: 'End', text: '', start: text.length, end: text.length });
	return tokenList;
}

// ---------------------------------------------------------------- parser

class Parser {
	private index = 0;

	constructor(
		private readonly tokenList: Token[],
		private readonly option: ParseOption,
	) {}

	private get token(): Token {
		return this.tokenList[this.index]!;
	}

	private next(): Token {
		return this.tokenList[this.index++]!;
	}

	private isOperator(text: string): boolean {
		return this.token.kind === 'Operator' && this.token.text === text;
	}

	private isWord(text: string): boolean {
		return this.token.kind === 'Name' && this.token.text === text;
	}

	private expect(text: string): Token {
		if (!this.isOperator(text)) throw new ExpressionError(this.token.kind === 'End' ? `“${text}” is missing` : `“${text}” expected, not “${this.token.text}”`, this.token.start, this.token.end);
		return this.next();
	}

	private isFunction(name: string): boolean {
		return builtinFunctionSet.has(name) || (this.option.isFunction?.(name) ?? false);
	}

	parseAll(): ExpressionNode {
		const node = this.or();
		if (this.token.kind !== 'End') throw new ExpressionError(`“${this.token.text}” is not expected here`, this.token.start, this.token.end);
		return node;
	}

	private binary(operator: BinaryOperator, left: ExpressionNode, right: ExpressionNode): ExpressionNode {
		return { kind: 'Binary', operator, left, right, start: left.start, end: right.end };
	}

	private or(): ExpressionNode {
		let left = this.and();
		while (this.isWord('or')) {
			this.next();
			left = this.binary('or', left, this.and());
		}
		return left;
	}

	private and(): ExpressionNode {
		let left = this.not();
		while (this.isWord('and')) {
			this.next();
			left = this.binary('and', left, this.not());
		}
		return left;
	}

	private not(): ExpressionNode {
		if (this.isWord('not')) {
			const start = this.next().start;
			const operand = this.not();
			return { kind: 'Unary', operator: 'not', operand, start, end: operand.end };
		}
		return this.comparison();
	}

	private comparison(): ExpressionNode {
		const left = this.additive();
		if (this.token.kind === 'Operator' && ['<', '<=', '>', '>=', '=', '!='].includes(this.token.text)) {
			const operator = this.next().text as BinaryOperator;
			return this.binary(operator, left, this.additive());
		}
		if (this.isWord('contains')) {
			this.next();
			return this.binary('contains', left, this.additive());
		}
		return left;
	}

	private additive(): ExpressionNode {
		let left = this.multiplicative();
		while (this.isOperator('+') || this.isOperator('-')) {
			const operator = this.next().text as BinaryOperator;
			left = this.binary(operator, left, this.multiplicative());
		}
		return left;
	}

	/** Whether the next token can start a factor written right after another (2x, a(b), x sin x). */
	private startsImplicit(): boolean {
		const token = this.token;
		if (token.kind === 'Number') return true;
		if (token.kind === 'Name') return !keywordSet.has(token.text);
		return token.kind === 'Operator' && token.text === '(';
	}

	private multiplicative(): ExpressionNode {
		let left = this.unary();
		for (;;) {
			if (this.isOperator('*') || this.isOperator('/')) {
				const operator = this.next().text as BinaryOperator;
				left = this.binary(operator, left, this.unary());
			} else if (this.isWord('mod')) {
				this.next();
				left = this.binary('mod', left, this.unary());
			} else if (this.startsImplicit()) left = this.binary('*', left, this.power());
			else return left;
		}
	}

	private unary(): ExpressionNode {
		if (this.isOperator('-') || this.isOperator('+')) {
			const token = this.next();
			const operand = this.unary();
			return token.text === '-' ? { kind: 'Unary', operator: '-', operand, start: token.start, end: operand.end } : operand;
		}
		return this.power();
	}

	private power(): ExpressionNode {
		const base = this.postfix();
		if (this.isOperator('^')) {
			this.next();
			return this.binary('^', base, this.unary());
		}
		return base;
	}

	private postfix(): ExpressionNode {
		let node = this.primary();
		while (this.isOperator('!')) {
			const token = this.next();
			node = { kind: 'Unary', operator: '!', operand: node, start: node.start, end: token.end };
		}
		return node;
	}

	private listUntil(close: string): ExpressionNode[] {
		const itemList: ExpressionNode[] = [];
		if (this.isOperator(close)) return itemList;
		for (;;) {
			itemList.push(this.or());
			if (!this.isOperator(',')) return itemList;
			this.next();
		}
	}

	private primary(): ExpressionNode {
		const token = this.token;
		switch (token.kind) {
			case 'Number':
				this.next();
				if (token.value === undefined || Number.isNaN(token.value)) throw new ExpressionError(`“${token.text}” is not a number`, token.start, token.end);
				return { kind: 'Number', value: token.value, start: token.start, end: token.end };
			case 'Text':
				this.next();
				return { kind: 'Text', value: token.text, start: token.start, end: token.end };
			case 'Name': {
				if (keywordSet.has(token.text)) throw new ExpressionError(`“${token.text}” needs a value before it`, token.start, token.end);
				this.next();
				if (this.isFunction(token.text)) {
					if (this.isOperator('(')) {
						this.next();
						const argumentList = this.listUntil(')');
						const close = this.expect(')');
						return { kind: 'Call', name: token.text, argumentList, start: token.start, end: close.end };
					}
					if (bareFunctionSet.has(token.text) && this.startsImplicit()) {
						// sin x, sin 2x, ln 3y: the argument runs to the next + or − or function
						let argument = this.power();
						while (this.startsImplicit() && !(this.token.kind === 'Name' && this.isFunction(this.token.text)) && !this.isOperator('(')) argument = this.binary('*', argument, this.power());
						return { kind: 'Call', name: token.text, argumentList: [argument], start: token.start, end: argument.end };
					}
					if (builtinFunctionSet.has(token.text)) throw new ExpressionError(`${token.text} needs a value: ${token.text}(x)`, token.start, token.end);
				}
				return { kind: 'Name', name: token.text, start: token.start, end: token.end };
			}
			case 'Operator': {
				if (token.text === '(') {
					this.next();
					const itemList = this.listUntil(')');
					const close = this.expect(')');
					if (itemList.length === 0) throw new ExpressionError('empty parentheses', token.start, close.end);
					if (itemList.length === 1) return { ...itemList[0]!, start: token.start, end: close.end };
					return { kind: 'Tuple', itemList, start: token.start, end: close.end };
				}
				if (token.text === '[') {
					this.next();
					const itemList = this.listUntil(']');
					const close = this.expect(']');
					return { kind: 'List', itemList, start: token.start, end: close.end };
				}
				if (token.text === '|') {
					this.next();
					const operand = this.additive();
					const close = this.expect('|');
					return { kind: 'Call', name: 'abs', argumentList: [operand], start: token.start, end: close.end };
				}
				if (token.text === '{') {
					this.next();
					const caseList: { condition: ExpressionNode | undefined; value: ExpressionNode }[] = [];
					for (;;) {
						const first = this.or();
						if (this.isOperator(':')) {
							this.next();
							caseList.push({ condition: first, value: this.or() });
						} else caseList.push({ condition: undefined, value: first });
						if (!this.isOperator(',')) break;
						this.next();
					}
					const close = this.expect('}');
					return { kind: 'Piecewise', caseList, start: token.start, end: close.end };
				}
				break;
			}
		}
		throw new ExpressionError(token.kind === 'End' ? 'the expression ends too soon' : `“${token.text}” is not expected here`, token.start, token.end);
	}
}

/** Parses an expression; throws ExpressionError with its position. */
export function parseExpression(text: string, option: ParseOption = {}): ExpressionNode {
	return new Parser(tokenize(text, option), option).parseAll();
}

// ---------------------------------------------------------------- evaluation

export interface Scope {
	/** Variables by name (x, a, a column's value in a row). */
	variable: Record<string, Value | undefined>;
	/** Your functions (`f(x) = x^2`). */
	functionMap?: Readonly<Record<string, (...argumentList: Value[]) => Value>>;
}

export type Compiled = (scope: Scope) => Value;

export interface CompileOption {
	/** Unknown names are text (`Workout = Legs` in a table's filter), instead of a mistake. */
	nameAsText?: boolean;
}

const truthy = (value: Value): boolean => (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value !== '' : value !== 0 && !Number.isNaN(value));

function broadcast(left: Value, right: Value, work: (a: number, b: number) => number): Value {
	if (Array.isArray(left)) return Array.isArray(right) ? left.map((item, index) => broadcast(item, right[index] ?? Number.NaN, work)) : left.map((item) => broadcast(item, right, work));
	if (Array.isArray(right)) return right.map((item) => broadcast(left, item, work));
	return work(typeof left === 'number' ? left : Number.parseFloat(left), typeof right === 'number' ? right : Number.parseFloat(right));
}

function mapValue(value: Value, work: (a: number) => number): Value {
	if (Array.isArray(value)) return value.map((item) => mapValue(item, work));
	return work(typeof value === 'number' ? value : Number.parseFloat(value));
}

function compare(operator: BinaryOperator, left: Value, right: Value): Value {
	if (Array.isArray(left) || Array.isArray(right)) {
		if (operator === '=' || operator === '!=') {
			const same = JSON.stringify(left) === JSON.stringify(right);
			return (operator === '=') === same ? 1 : 0;
		}
		return broadcast(left, right, (a, b) => Number(compareNumber(operator, a, b)));
	}
	if (typeof left === 'string' || typeof right === 'string') {
		const a = String(left).toLowerCase();
		const b = String(right).toLowerCase();
		switch (operator) {
			case '=':
				return a === b ? 1 : 0;
			case '!=':
				return a !== b ? 1 : 0;
			default: {
				const order = a.localeCompare(b);
				return compareNumber(operator, order, 0) ? 1 : 0;
			}
		}
	}
	return compareNumber(operator, left, right) ? 1 : 0;
}

function compareNumber(operator: BinaryOperator, a: number, b: number): boolean {
	switch (operator) {
		case '<':
			return a < b;
		case '<=':
			return a <= b;
		case '>':
			return a > b;
		case '>=':
			return a >= b;
		case '=':
			return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
		default:
			return a !== b;
	}
}

function contain(left: Value, right: Value): Value {
	if (Array.isArray(left)) return left.some((item) => compare('=', item, right) === 1) ? 1 : 0;
	return String(left).toLowerCase().includes(String(right).toLowerCase()) ? 1 : 0;
}

function callBuiltin(name: string, argumentList: Value[], node: ExpressionNode): Value {
	if (name === 'quantile') {
		const [list, q] = argumentList;
		return quantile(numberListOf([list ?? []]).sort((a, b) => a - b), typeof q === 'number' ? q : Number.NaN);
	}
	// over every number given, lists included: max(a, b), mean(^gym.Weight)
	const listFunction = listFunctionMap[name];
	if (listFunction) return listFunction(numberListOf(argumentList));
	const work = numberFunctionMap[name];
	if (!work) throw new ExpressionError(`${name} is not a function`, node.start, node.end);
	if (argumentList.length === 1) return mapValue(argumentList[0]!, (value) => work(value));
	if (argumentList.length === 2) return broadcast(argumentList[0]!, argumentList[1]!, (a, b) => work(a, b));
	return work(...argumentList.map((value) => (typeof value === 'number' ? value : Number.NaN)));
}

/** Compiles a parsed expression into a function of a scope. Unknown names fail when they are evaluated. */
export function compile(node: ExpressionNode, option: CompileOption = {}): Compiled {
	switch (node.kind) {
		case 'Number': {
			const value = node.value;
			return () => value;
		}
		case 'Text': {
			const value = node.value;
			return () => value;
		}
		case 'Name': {
			const name = node.name;
			const constant = constantMap[name];
			return (scope) => {
				const value = scope.variable[name];
				if (value !== undefined) return value;
				if (constant !== undefined) return constant;
				if (option.nameAsText) return name;
				throw new ExpressionError(`${name} is not defined`, node.start, node.end);
			};
		}
		case 'Call': {
			const name = node.name;
			const argumentList = node.argumentList.map((item) => compile(item, option));
			return (scope) => {
				const valueList = argumentList.map((argument) => argument(scope));
				const own = scope.functionMap?.[name];
				if (own) return own(...valueList);
				return callBuiltin(name, valueList, node);
			};
		}
		case 'Unary': {
			const operand = compile(node.operand, option);
			if (node.operator === '-') return (scope) => mapValue(operand(scope), (value) => -value);
			if (node.operator === '!') return (scope) => mapValue(operand(scope), factorial);
			return (scope) => (truthy(operand(scope)) ? 0 : 1);
		}
		case 'Binary': {
			const left = compile(node.left, option);
			const right = compile(node.right, option);
			switch (node.operator) {
				case '+':
					return (scope) => {
						const a = left(scope);
						const b = right(scope);
						if (typeof a === 'string' && typeof b === 'string') return a + b;
						return typeof a === 'number' && typeof b === 'number' ? a + b : broadcast(a, b, (x, y) => x + y);
					};
				case '-':
					return (scope) => {
						const a = left(scope);
						const b = right(scope);
						return typeof a === 'number' && typeof b === 'number' ? a - b : broadcast(a, b, (x, y) => x - y);
					};
				case '*':
					return (scope) => {
						const a = left(scope);
						const b = right(scope);
						return typeof a === 'number' && typeof b === 'number' ? a * b : broadcast(a, b, (x, y) => x * y);
					};
				case '/':
					return (scope) => {
						const a = left(scope);
						const b = right(scope);
						return typeof a === 'number' && typeof b === 'number' ? a / b : broadcast(a, b, (x, y) => x / y);
					};
				case '^':
					return (scope) => broadcast(left(scope), right(scope), power);
				case 'mod':
					return (scope) => broadcast(left(scope), right(scope), (x, y) => ((x % y) + y) % y);
				case 'and':
					return (scope) => (truthy(left(scope)) && truthy(right(scope)) ? 1 : 0);
				case 'or':
					return (scope) => (truthy(left(scope)) || truthy(right(scope)) ? 1 : 0);
				case 'contains':
					return (scope) => contain(left(scope), right(scope));
				default: {
					const operator = node.operator;
					return (scope) => compare(operator, left(scope), right(scope));
				}
			}
		}
		case 'List':
		case 'Tuple': {
			const itemList = node.itemList.map((item) => compile(item, option));
			return (scope) => itemList.map((item) => item(scope));
		}
		case 'Piecewise': {
			const caseList = node.caseList.map((item) => ({ condition: item.condition ? compile(item.condition, option) : undefined, value: compile(item.value, option) }));
			return (scope) => {
				for (const item of caseList) if (!item.condition || truthy(item.condition(scope))) return item.value(scope);
				return Number.NaN;
			};
		}
	}
}

/** x^y, with odd roots of negative numbers kept real (x^(1/3) of −8 is −2). */
function power(base: number, exponent: number): number {
	if (base < 0 && !Number.isInteger(exponent)) {
		const inverse = 1 / exponent;
		if (Number.isInteger(Math.round(inverse)) && Math.abs(inverse - Math.round(inverse)) < 1e-9 && Math.round(inverse) % 2 !== 0) return -((-base) ** exponent);
	}
	return base ** exponent;
}

/** Parses and compiles at once. */
export function compileText(text: string, option: ParseOption & CompileOption = {}): Compiled {
	return compile(parseExpression(text, option), option);
}

/** Evaluates text with some variables: `evaluate('2x + 1', { x: 3 })` is 7. */
export function evaluate(text: string, variable: Record<string, Value> = {}, option: ParseOption & CompileOption = {}): Value {
	return compileText(text, option)({ variable });
}

/** Every name an expression reads that isn't a constant or a function: what it depends on. */
export function nameListOf(node: ExpressionNode): string[] {
	const nameSet = new Set<string>();
	const walk = (item: ExpressionNode): void => {
		switch (item.kind) {
			case 'Name':
				if (!(item.name in constantMap)) nameSet.add(item.name);
				break;
			case 'Call':
				item.argumentList.forEach(walk);
				break;
			case 'Unary':
				walk(item.operand);
				break;
			case 'Binary':
				walk(item.left);
				walk(item.right);
				break;
			case 'List':
			case 'Tuple':
				item.itemList.forEach(walk);
				break;
			case 'Piecewise':
				for (const entry of item.caseList) {
					if (entry.condition) walk(entry.condition);
					walk(entry.value);
				}
				break;
			default:
		}
	};
	walk(node);
	return [...nameSet];
}

/** Calls with a name that is neither built in nor yours (to report `g(x)` when g isn't defined). */
export function isBuiltinFunction(name: string): boolean {
	return builtinFunctionSet.has(name);
}
