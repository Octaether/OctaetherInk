// Trend lines through data: linear, quadratic, and exponential least squares, with R² (how much of
// the spread the line explains). Values are centred first, so dates (around 20,000 days) stay exact.

export type TrendKind = 'Linear' | 'Quadratic' | 'Exponential';

export interface Trend {
	kind: TrendKind;
	/** y at x. */
	at(x: number): number;
	/** Linear: slope and intercept; Quadratic: a, b, c of ax² + bx + c; Exponential: a, b of a·e^(bx). */
	coefficientList: number[];
	r2: number;
}

function solve(matrix: number[][], vector: number[]): number[] | undefined {
	const size = vector.length;
	const a = matrix.map((row, index) => [...row, vector[index]!]);
	for (let column = 0; column < size; column++) {
		let pivot = column;
		for (let row = column + 1; row < size; row++) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
		if (Math.abs(a[pivot]![column]!) < 1e-12) return undefined;
		[a[column], a[pivot]] = [a[pivot]!, a[column]!];
		for (let row = 0; row < size; row++) {
			if (row === column) continue;
			const factor = a[row]![column]! / a[column]![column]!;
			for (let k = column; k <= size; k++) a[row]![k]! -= factor * a[column]![k]!;
		}
	}
	return a.map((row, index) => row[size]! / row[index]!);
}

function rSquared(xList: readonly number[], yList: readonly number[], at: (x: number) => number): number {
	const mean = yList.reduce((total, y) => total + y, 0) / yList.length;
	let residual = 0;
	let total = 0;
	xList.forEach((x, index) => {
		residual += (yList[index]! - at(x)) ** 2;
		total += (yList[index]! - mean) ** 2;
	});
	return total === 0 ? 1 : 1 - residual / total;
}

/** A trend line through points (pairs with a non-number are left out). */
export function fitTrend(kind: TrendKind, xList: readonly number[], yList: readonly number[]): Trend | undefined {
	const pairList: [number, number][] = [];
	xList.forEach((x, index) => {
		const y = yList[index]!;
		if (Number.isFinite(x) && Number.isFinite(y) && (kind !== 'Exponential' || y > 0)) pairList.push([x, y]);
	});
	if (pairList.length < (kind === 'Quadratic' ? 3 : 2)) return undefined;
	const xs = pairList.map(([x]) => x);
	const ys = pairList.map(([, y]) => y);
	const center = xs.reduce((total, x) => total + x, 0) / xs.length;
	const u = xs.map((x) => x - center);
	if (kind === 'Linear' || kind === 'Exponential') {
		const target = kind === 'Exponential' ? ys.map(Math.log) : ys;
		const n = u.length;
		const su = u.reduce((total, value) => total + value, 0);
		const sy = target.reduce((total, value) => total + value, 0);
		const suu = u.reduce((total, value) => total + value * value, 0);
		const suy = u.reduce((total, value, index) => total + value * target[index]!, 0);
		const divisor = n * suu - su * su;
		if (Math.abs(divisor) < 1e-12) return undefined;
		const slope = (n * suy - su * sy) / divisor;
		const intercept = (sy - slope * su) / n;
		if (kind === 'Linear') {
			const at = (x: number): number => slope * (x - center) + intercept;
			return { kind, at, coefficientList: [slope, intercept - slope * center], r2: rSquared(xs, ys, at) };
		}
		const at = (x: number): number => Math.exp(intercept + slope * (x - center));
		return { kind, at, coefficientList: [Math.exp(intercept - slope * center), slope], r2: rSquared(xs, ys, at) };
	}
	const power = (k: number): number => u.reduce((total, value) => total + value ** k, 0);
	const powerY = (k: number): number => u.reduce((total, value, index) => total + value ** k * ys[index]!, 0);
	const solution = solve(
		[
			[power(4), power(3), power(2)],
			[power(3), power(2), power(1)],
			[power(2), power(1), u.length],
		],
		[powerY(2), powerY(1), powerY(0)],
	);
	if (!solution) return undefined;
	const [a, b, c] = solution as [number, number, number];
	const at = (x: number): number => a * (x - center) ** 2 + b * (x - center) + c;
	// back to x: a(x−m)² + b(x−m) + c
	return { kind, at, coefficientList: [a, b - 2 * a * center, a * center * center - b * center + c], r2: rSquared(xs, ys, at) };
}

const short = (value: number): string => {
	const magnitude = Math.abs(value);
	const text = magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3) ? value.toExponential(2) : String(Number(value.toPrecision(4)));
	return text.replace('-', '−');
};

/** The trend as written in the legend: `y = 0.12x + 3.4, R² = 0.91`; on dates, the change per day. */
export function trendText(trend: Trend, dateAxis: boolean): string {
	const r2 = `R² = ${trend.r2.toFixed(2)}`;
	if (dateAxis) {
		if (trend.kind === 'Linear') return `${short(trend.coefficientList[0]!)} per day, ${r2}`;
		if (trend.kind === 'Exponential') return `${short((Math.exp(trend.coefficientList[1]!) - 1) * 100)}% per day, ${r2}`;
		return `quadratic, ${r2}`;
	}
	const sign = (value: number): string => (value < 0 ? ` − ${short(-value)}` : ` + ${short(value)}`);
	const [a, b, c] = trend.coefficientList as [number, number, number];
	switch (trend.kind) {
		case 'Linear':
			return `y = ${short(a)}x${sign(b)}, ${r2}`;
		case 'Exponential':
			return `y = ${short(a)}e^(${short(b)}x), ${r2}`;
		case 'Quadratic':
			return `y = ${short(a)}x²${sign(b)}x${sign(c)}, ${r2}`;
	}
}
