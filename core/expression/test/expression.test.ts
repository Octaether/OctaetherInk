import { describe, expect, it } from 'vitest';
import { ExpressionError, compileText, dayOf, dayText, evaluate, nameListOf, parseExpression } from '../src/index';

const close = (value: unknown, expected: number): void => {
	expect(typeof value).toBe('number');
	expect(value as number).toBeCloseTo(expected, 9);
};

describe('expression', () => {
	it('follows precedence, with powers right to left', () => {
		expect(evaluate('1 + 2 * 3')).toBe(7);
		expect(evaluate('2^3^2')).toBe(512);
		expect(evaluate('-2^2')).toBe(-4);
		expect(evaluate('(1 + 2) * 3')).toBe(9);
		expect(evaluate('7 mod 3')).toBe(1);
		expect(evaluate('5!')).toBe(120);
		expect(evaluate('3²')).toBe(9);
	});

	it('multiplies without a sign, like Desmos', () => {
		expect(evaluate('2x', { x: 3 })).toBe(6);
		expect(evaluate('a x + 1', { a: 2, x: 5 })).toBe(11);
		expect(evaluate('2(x + 1)', { x: 1 })).toBe(4);
		expect(evaluate('ax', { a: 2, x: 4 }, { split: true })).toBe(8);
		close(evaluate('sin 2x', { x: 0.25 }), Math.sin(0.5));
		close(evaluate('sin x cos x', { x: 0.3 }), Math.sin(0.3) * Math.cos(0.3));
		close(evaluate('2pi'), 2 * Math.PI);
		close(evaluate('xsinx', { x: 1 }, { split: true }), Math.sin(1));
	});

	it('knows functions, constants, Greek names, and subscripts', () => {
		close(evaluate('sin(pi / 2)'), 1);
		close(evaluate('ln(e^2)'), 2);
		close(evaluate('log(1000)'), 3);
		close(evaluate('log(8, 2)'), 3);
		expect(evaluate('nCr(5, 2)')).toBe(10);
		expect(evaluate('abs(-3) + |-2|')).toBe(5);
		close(evaluate('theta + θ', { θ: 1 }), 2);
		expect(evaluate('a_1 + a_2', { a_1: 1, a_2: 2 })).toBe(3);
		expect(evaluate('(-8)^(1/3)')).toBeCloseTo(-2);
	});

	it('works on lists and statistics', () => {
		expect(evaluate('mean([1, 2, 3, 6])')).toBe(3);
		expect(evaluate('median([5, 1, 3])')).toBe(3);
		expect(evaluate('sum(list)', { list: [1, 2, 3] })).toBe(6);
		expect(evaluate('[1, 2] * 2')).toEqual([2, 4]);
		expect(evaluate('max(1, 4, 2)')).toBe(4);
		close(evaluate('stdev([2, 4, 4, 4, 5, 5, 7, 9])'), Math.sqrt(32 / 7));
		expect(evaluate('quantile([1, 2, 3, 4], 0.5)')).toBe(2.5);
	});

	it('reads piecewise definitions, comparisons, and text', () => {
		expect(evaluate('{x < 0: -x, x}', { x: -3 })).toBe(3);
		expect(evaluate('{x < 0: -x, x}', { x: 2 })).toBe(2);
		expect(Number.isNaN(evaluate('{x < 0: 1}', { x: 2 }))).toBe(true);
		expect(evaluate('Calorie > 300 and Workout = Legs', { Calorie: 400, Workout: 'legs' }, { nameAsText: true })).toBe(1);
		expect(evaluate('Tag contains Gym', { Tag: ['Gym', 'Run'] }, { nameAsText: true })).toBe(1);
		expect(evaluate('not 0')).toBe(1);
	});

	it('reads dates as days, so they subtract', () => {
		expect(evaluate('2026-11-04 - 2026-11-01')).toBe(3);
		expect(dayText(dayOf('2026-11-04')!)).toBe('2026-11-04');
		expect(dayText(dayOf('2026-11-04 09:30')!)).toBe('2026-11-04 09:30');
	});

	it('calls functions of your own', () => {
		const run = compileText('f(3) + 1', { isFunction: (name) => name === 'f' });
		expect(run({ variable: {}, functionMap: { f: (x) => (x as number) ** 2 } })).toBe(10);
		// without knowing f, f(3) is f times 3
		expect(evaluate('f(3)', { f: 2 })).toBe(6);
	});

	it('gives where a mistake is', () => {
		const fail = (text: string): ExpressionError => {
			try {
				parseExpression(text);
			} catch (error) {
				return error as ExpressionError;
			}
			throw new Error('no error');
		};
		expect(fail('1 + ').start).toBe(4);
		expect(fail('2 * (3').message).toContain(')');
		expect(fail('1 # 2').start).toBe(2);
		expect(() => evaluate('y + 1')).toThrow(/y is not defined/);
	});

	it('lists the names an expression reads', () => {
		expect(nameListOf(parseExpression('a sin(b x) + pi')).sort()).toEqual(['a', 'b', 'x']);
	});
});
