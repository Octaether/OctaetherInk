// Math expressions for TikZ coordinates and plots: + - * / ^, parentheses, unary minus,
// sin cos tan (degrees, as in TikZ; `r` after a value converts radians), asin acos atan,
// exp ln log sqrt abs floor ceil round min max, pi, e, and named variables (\x → x).
// No eval: a tiny recursive-descent parser, so notes can't run code.

export type Variable = Readonly<Record<string, number>>;

const degree = Math.PI / 180;

const functionMap: Readonly<Record<string, (...valueList: number[]) => number>> = {
	sin: (value) => Math.sin(value * degree),
	cos: (value) => Math.cos(value * degree),
	tan: (value) => Math.tan(value * degree),
	asin: (value) => Math.asin(value) / degree,
	acos: (value) => Math.acos(value) / degree,
	atan: (value) => Math.atan(value) / degree,
	exp: Math.exp,
	ln: Math.log,
	log: Math.log10,
	sqrt: Math.sqrt,
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	round: Math.round,
	min: Math.min,
	max: Math.max,
	deg: (value) => value / degree,
	rad: (value) => value * degree,
};

class ExpressionParser {
	position = 0;

	constructor(
		readonly text: string,
		readonly variable: Variable,
	) {}

	parse(): number {
		const value = this.sum();
		this.skip();
		if (this.position < this.text.length) throw new Error(`unexpected "${this.text[this.position]}"`);
		return value;
	}

	private skip(): void {
		while (/\s/.test(this.text[this.position] ?? '')) this.position++;
	}

	private sum(): number {
		let value = this.product();
		for (;;) {
			this.skip();
			const character = this.text[this.position];
			if (character === '+') {
				this.position++;
				value += this.product();
			} else if (character === '-') {
				this.position++;
				value -= this.product();
			} else return this.radian(value);
		}
	}

	private product(): number {
		let value = this.unary();
		for (;;) {
			this.skip();
			const character = this.text[this.position];
			if (character === '*') {
				this.position++;
				value *= this.unary();
			} else if (character === '/') {
				this.position++;
				value /= this.unary();
			} else return value;
		}
	}

	/** Unary minus binds looser than ^, so -2^2 = -4. */
	private unary(): number {
		this.skip();
		if (this.text[this.position] === '-') {
			this.position++;
			return -this.unary();
		}
		if (this.text[this.position] === '+') {
			this.position++;
			return this.unary();
		}
		return this.power();
	}

	/** Right-associative: 2^3^2 = 2^9; the exponent may be negative (2^-1). */
	private power(): number {
		const base = this.atom();
		this.skip();
		if (this.text[this.position] === '^') {
			this.position++;
			return base ** this.unary();
		}
		return base;
	}

	/** `sin(\x r)`, `sin(pi/2 r)`: a trailing `r` says the whole expression is in radians. */
	private radian(value: number): number {
		const match = /^\s*r(?![A-Za-z])/.exec(this.text.slice(this.position));
		if (!match) return value;
		this.position += match[0].length;
		return value / degree;
	}

	private atom(): number {
		this.skip();
		const rest = this.text.slice(this.position);
		const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
		if (number) {
			this.position += number[0].length;
			return Number(number[0]);
		}
		if (rest.startsWith('(') || rest.startsWith('{')) {
			const close = rest[0] === '(' ? ')' : '}';
			this.position++;
			const value = this.sum();
			this.skip();
			if (this.text[this.position] !== close) throw new Error(`missing "${close}"`);
			this.position++;
			return value;
		}
		const name = /^\\?([A-Za-z]+)/.exec(rest);
		if (!name) throw new Error(rest === '' ? 'the expression ends too early' : `unexpected "${rest[0]}"`);
		this.position += name[0].length;
		const word = name[1]!;
		if (word === 'pi') return Math.PI;
		if (word === 'e' && !(word in this.variable)) return Math.E;
		if (word in this.variable) return this.variable[word]!;
		const fn = functionMap[word];
		if (!fn) throw new Error(`unknown name "${word}"`);
		this.skip();
		if (this.text[this.position] !== '(') return fn(this.atom());
		this.position++;
		const argumentList = [this.sum()];
		this.skip();
		while (this.text[this.position] === ',') {
			this.position++;
			argumentList.push(this.sum());
			this.skip();
		}
		if (this.text[this.position] !== ')') throw new Error('missing ")"');
		this.position++;
		return fn(...argumentList);
	}
}

/** Evaluates an expression; throws with a readable message when it can't. */
export function evaluate(text: string, variable: Variable = {}): number {
	return new ExpressionParser(text, variable).parse();
}
