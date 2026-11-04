// Axis ticks at "nice" numbers (1, 2, 5 × 10ⁿ), or at days, weeks, months, and years when the axis
// holds dates (days from 1970, as tables give them).

import { niceStep } from './parse';

export interface Tick {
	value: number;
	label: string;
}

/** A number as a tick shows it: as many decimals as the step needs, large and tiny ones as 1.2e6. */
export function numberLabel(value: number, step: number): string {
	if (Math.abs(value) < step * 1e-9) return '0';
	const magnitude = Math.abs(value);
	if (magnitude >= 1e6 || (magnitude < 1e-4 && magnitude > 0)) {
		const exponent = Math.floor(Math.log10(magnitude));
		const mantissa = value / 10 ** exponent;
		return `${Number(mantissa.toFixed(2))}e${exponent}`;
	}
	const decimal = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
	return value.toFixed(decimal).replace('-', '−');
}

/** Ticks between min and max, about `pixel / spacing` of them. */
export function numberTickList(min: number, max: number, pixel: number, spacing = 80): Tick[] {
	if (!(max > min)) return [];
	const step = niceStep((max - min) / Math.max(1, pixel / spacing));
	const list: Tick[] = [];
	const decimal = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + 1));
	for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
		const clean = Number((Math.round(value / step) * step).toFixed(decimal));
		list.push({ value: clean, label: numberLabel(clean, step) });
		if (list.length > 500) break;
	}
	return list;
}

const shortMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dateOf = (day: number): Date => new Date(Math.round(day * 1440) * 60_000);
const dayOfDate = (year: number, month: number, date = 1): number => Date.UTC(year, month, date) / 86_400_000;

/** Ticks on a date axis: days, weeks (Mondays), months, or years, whatever fits. */
export function dateTickList(min: number, max: number, pixel: number, spacing = 90): Tick[] {
	if (!(max > min)) return [];
	const span = max - min;
	const wanted = Math.max(1, pixel / spacing);
	const perTick = span / wanted;
	const list: Tick[] = [];
	if (perTick <= 0.25) {
		// hours
		const hourStep = [1, 2, 3, 6][[1, 2, 3, 6].findIndex((hour) => hour / 24 >= perTick)] ?? 6;
		for (let value = Math.ceil((min * 24) / hourStep) * hourStep; value / 24 <= max; value += hourStep) {
			const date = dateOf(value / 24);
			list.push({ value: value / 24, label: date.getUTCHours() === 0 ? `${shortMonth[date.getUTCMonth()]} ${date.getUTCDate()}` : `${String(date.getUTCHours()).padStart(2, '0')}:00` });
		}
		return list;
	}
	if (perTick <= 10) {
		const stepList = [1, 2, 7, 14];
		const dayStep = stepList.find((step) => step >= perTick) ?? 14;
		let first = Math.ceil(min);
		if (dayStep >= 7) first += (8 - dateOf(first).getUTCDay()) % 7; // Mondays
		for (let value = first; value <= max; value += dayStep) {
			const date = dateOf(value);
			list.push({ value, label: `${shortMonth[date.getUTCMonth()]} ${date.getUTCDate()}` });
		}
		return list;
	}
	if (perTick <= 200) {
		const monthStep = [1, 2, 3, 6].find((step) => step * 30 >= perTick) ?? 6;
		const start = dateOf(min);
		let year = start.getUTCFullYear();
		let month = Math.ceil(start.getUTCMonth() / monthStep) * monthStep;
		for (;;) {
			if (month >= 12) {
				year += Math.floor(month / 12);
				month %= 12;
			}
			const value = dayOfDate(year, month);
			if (value < min) {
				month += monthStep;
				continue;
			}
			if (value > max) break;
			list.push({ value, label: month === 0 ? `${shortMonth[0]} ${year}` : shortMonth[month]! });
			month += monthStep;
		}
		return list;
	}
	const yearStep = niceStep(perTick / 365);
	const step = Math.max(1, Math.round(yearStep));
	for (let year = Math.ceil(dateOf(min).getUTCFullYear() / step) * step; ; year += step) {
		const value = dayOfDate(year, 0);
		if (value > max) break;
		if (value >= min) list.push({ value, label: String(year) });
	}
	return list;
}

/** A date as a hover label shows it. */
export function dateLabel(day: number): string {
	const date = dateOf(day);
	const text = `${shortMonth[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
	return day % 1 === 0 ? text : `${text} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
