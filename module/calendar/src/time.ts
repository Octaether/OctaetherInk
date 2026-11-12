// Time for calendars: a moment is minutes from 1970-01-01 00:00 in local "wall" time, with no time
// zone (a class at 09:00 stays at 09:00); a day is days from 1970. Durations are written 1h30m, 45m,
// 2d; repeats are `{Every: Week, On: [Mon, Wed], Until: 2026-12-15}`; skips are dates and `a..b`.

import type { PropertyMap, PropertyValue } from '@octaether/core-format';
import { languageTag, t, tr } from '@octaether/core-sdk';

export const minutePerDay = 1440;

// ---------------------------------------------------------------- in words, in the language in use
// The English names below are also the syntax (`On: [Mon, Wed]`); what is shown goes through these.

const english = (): boolean => languageTag() === 'en';
const formatMap = new Map<string, Intl.DateTimeFormat>();
function dateFormat(option: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${languageTag()} ${JSON.stringify(option)}`;
	let format = formatMap.get(key);
	if (!format) formatMap.set(key, (format = new Intl.DateTimeFormat(languageTag(), { ...option, timeZone: 'UTC' })));
	return format;
}
const dateOfDay = (day: number): Date => new Date(day * 86_400_000);

/** A weekday's name (0 = Monday): Mon, Monday, or Mo (narrow). */
export function weekdayText(index: number, width: 'short' | 'long' | 'narrow' = 'short'): string {
	if (english()) return width === 'long' ? weekdayLongName[index]! : width === 'narrow' ? weekdayName[index]!.slice(0, 2) : weekdayName[index]!;
	// 1970-01-05 was a Monday
	return dateFormat({ weekday: width }).format(dateOfDay(4 + index));
}

/** A month's name (0 = January): Jan or January. */
export function monthText(month: number, width: 'short' | 'long' = 'short'): string {
	if (english()) return width === 'long' ? monthName[month]! : monthShortName[month]!;
	return dateFormat({ month: width }).format(new Date(Date.UTC(2026, month, 1)));
}

/** A day in words: `Nov 4`, `Wed, Nov 4, 2026`, `Wednesday, November 4, 2026`. */
export function dateText(day: number, option: { weekday?: 'short' | 'long'; month?: 'short' | 'long'; year?: boolean } = {}): string {
	const { year, month, date } = partOf(day);
	if (!english()) return dateFormat({ weekday: option.weekday, month: option.month ?? 'short', day: 'numeric', year: option.year ? 'numeric' : undefined }).format(dateOfDay(day));
	const text = `${monthText(month, option.month)} ${date}${option.year ? `, ${year}` : ''}`;
	return option.weekday ? `${weekdayText(weekdayOf(day), option.weekday)}, ${text}` : text;
}

/** A month and year: `November 2026`. */
export function monthYearText(day: number): string {
	const { year, month } = partOf(day);
	return english() ? `${monthName[month]} ${year}` : dateFormat({ month: 'long', year: 'numeric' }).format(dateOfDay(day));
}

/** Two days as a range: `Nov 2 – 8, 2026`, `Oct 26 – Nov 1, 2026`. */
export function rangeText(from: number, to: number): string {
	const a = partOf(from);
	const b = partOf(to);
	if (!english()) {
		const format = dateFormat({ month: 'short', day: 'numeric', year: 'numeric' }) as Intl.DateTimeFormat & { formatRange?: (start: Date, end: Date) => string };
		return format.formatRange ? format.formatRange(dateOfDay(from), dateOfDay(to)) : `${format.format(dateOfDay(from))} – ${format.format(dateOfDay(to))}`;
	}
	if (a.year !== b.year) return `${monthShortName[a.month]} ${a.date}, ${a.year} – ${monthShortName[b.month]} ${b.date}, ${b.year}`;
	if (a.month !== b.month) return `${monthShortName[a.month]} ${a.date} – ${monthShortName[b.month]} ${b.date}, ${b.year}`;
	return `${monthName[a.month]} ${a.date} – ${b.date}, ${b.year}`;
}

/** Items in a sentence: `Mon, Wed`, or 周一、周三 in Chinese. */
export function listText(list: readonly string[]): string {
	if (english() || typeof Intl.ListFormat !== 'function') return list.join(', ');
	return new Intl.ListFormat(languageTag(), { style: 'narrow', type: 'unit' }).format(list);
}

/** The 4th in English; elsewhere the number, for the language's own sentence (每月 4 日). */
export function ordinalText(value: number): string {
	if (!english()) return String(value);
	return `${value}${value % 10 === 1 && value !== 11 ? 'st' : value % 10 === 2 && value !== 12 ? 'nd' : value % 10 === 3 && value !== 13 ? 'rd' : 'th'}`;
}

/** A repeat's unit in words, with how many: day, 3 weeks. */
function unitText(every: string, count: number): string {
	if (count === 1) return ({ Day: t('day'), Week: t('week'), Month: t('month'), Year: t('year') } as Record<string, string>)[every] ?? every;
	return ({ Day: tr`${count} days`, Week: tr`${count} weeks`, Month: tr`${count} months`, Year: tr`${count} years` } as Record<string, string>)[every] ?? `${count} ${every}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `2026-11-04` → its day. */
export function dayOf(text: string): number | undefined {
	const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
	if (!match) return undefined;
	const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
	return Number.isFinite(value) ? value : undefined;
}

/** `09:00`, `9:30`, `9:30 PM` → minutes into the day. */
export function clockOf(text: string): number | undefined {
	const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(text);
	if (!match) return undefined;
	let hour = Number(match[1]);
	const minute = Number(match[2]);
	if (match[3]) {
		const pm = /p/i.test(match[3]);
		if (hour === 12) hour = pm ? 12 : 0;
		else if (pm) hour += 12;
	}
	if (hour > 24 || minute > 59) return undefined;
	return hour * 60 + minute;
}

/** `2026-11-04 09:00` (an offset after it is ignored) → a moment; `2026-11-04` → its first minute, and `allDay`. */
export function momentOf(value: PropertyValue | undefined): { moment: number; allDay: boolean } | undefined {
	if (typeof value !== 'string') return undefined;
	const day = dayOf(value);
	if (day === undefined) return undefined;
	const clock = clockOf(value.replace(/^\s*\d{4}-\d{1,2}-\d{1,2}[ T]?/, ''));
	return clock === undefined ? { moment: day * minutePerDay, allDay: true } : { moment: day * minutePerDay + clock, allDay: false };
}

export const dayText = (day: number): string => {
	const date = new Date(day * 86_400_000);
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const clockText = (minute: number): string => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** A moment as written: `2026-11-04 09:00`, or `2026-11-04` for a day. */
export function momentText(moment: number, allDay = false): string {
	const day = Math.floor(moment / minutePerDay);
	return allDay ? dayText(day) : `${dayText(day)} ${clockText(moment - day * minutePerDay)}`;
}

/** Now, on this device's wall clock. */
export function nowMoment(date = new Date()): number {
	return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000) * minutePerDay + date.getHours() * 60 + date.getMinutes();
}

export const dayOfMoment = (moment: number): number => Math.floor(moment / minutePerDay);

/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (day: number): number => (new Date(day * 86_400_000).getUTCDay() + 6) % 7;

export const weekdayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekdayLongName = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthShortName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function partOf(day: number): { year: number; month: number; date: number } {
	const value = new Date(day * 86_400_000);
	return { year: value.getUTCFullYear(), month: value.getUTCMonth(), date: value.getUTCDate() };
}

export const dayFromPart = (year: number, month: number, date: number): number => Date.UTC(year, month, date) / 86_400_000;

/** `1h30m`, `90m`, `1.5h`, `2d`, `45` (minutes) → minutes. */
export function durationOf(value: PropertyValue | undefined): number | undefined {
	if (typeof value === 'number') return value > 0 ? value : undefined;
	if (typeof value !== 'string') return undefined;
	const text = value.trim().toLowerCase();
	if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
	let total = 0;
	let matched = false;
	for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(days|day|d|hours|hour|hr|h|minutes|minute|min|m)(?![a-z])/g)) {
		matched = true;
		const amount = Number(match[1]);
		const unit = match[2]![0];
		total += unit === 'd' ? amount * minutePerDay : unit === 'h' ? amount * 60 : amount;
	}
	return matched && total > 0 ? Math.round(total) : undefined;
}

/** Minutes → `1h30m`, `45m`, `2d`. */
export function durationText(minute: number): string {
	if (minute % minutePerDay === 0) return `${minute / minutePerDay}d`;
	const hour = Math.floor(minute / 60);
	const rest = minute % 60;
	return `${hour ? `${hour}h` : ''}${rest || !hour ? `${rest}m` : ''}`;
}

// ---------------------------------------------------------------- repeating

export type Frequency = 'Day' | 'Week' | 'Month' | 'Year';

export interface Repeat {
	every: Frequency;
	interval: number;
	/** Week: the weekdays (0 = Monday). */
	onList: number[];
	/** The last day it may happen on. */
	until: number | undefined;
	/** How many times it happens (skipped days count). */
	count: number | undefined;
}

const frequencyAlias: Readonly<Record<string, Frequency>> = {
	day: 'Day', daily: 'Day', week: 'Week', weekly: 'Week', month: 'Month', monthly: 'Month', year: 'Year', yearly: 'Year', annually: 'Year',
};

/** `Week` or `Weekly`, or `{Every: Week, Interval: 2, On: [Mon, Wed], Until: 2026-12-15, Count: 10}`. */
export function repeatOf(value: PropertyValue | undefined): Repeat | undefined {
	if (typeof value === 'string') {
		const every = frequencyAlias[value.trim().toLowerCase()];
		return every ? { every, interval: 1, onList: [], until: undefined, count: undefined } : undefined;
	}
	if (!(value instanceof Map)) return undefined;
	const every = frequencyAlias[String(value.get('Every') ?? '').trim().toLowerCase()];
	if (!every) return undefined;
	const interval = typeof value.get('Interval') === 'number' ? Math.max(1, Math.round(value.get('Interval') as number)) : 1;
	const onValue = value.get('On');
	const onList = (Array.isArray(onValue) ? onValue : onValue === undefined || onValue === null ? [] : [onValue])
		.map((item) => weekdayName.findIndex((name) => name.toLowerCase() === String(item).trim().slice(0, 3).toLowerCase()))
		.filter((index) => index >= 0);
	const untilValue = value.get('Until');
	const countValue = value.get('Count');
	return {
		every,
		interval,
		onList: [...new Set(onList)].sort((a, b) => a - b),
		until: typeof untilValue === 'string' ? dayOf(untilValue) : undefined,
		count: typeof countValue === 'number' && countValue > 0 ? Math.round(countValue) : undefined,
	};
}

/** A repeat written back: `Week` when it is that simple, otherwise a map. */
export function repeatValue(repeat: Repeat | undefined): PropertyValue | undefined {
	if (!repeat) return undefined;
	if (repeat.interval === 1 && repeat.onList.length === 0 && repeat.until === undefined && repeat.count === undefined) return repeat.every;
	const map: PropertyMap = new Map([['Every', repeat.every]]);
	if (repeat.interval !== 1) map.set('Interval', repeat.interval);
	if (repeat.onList.length) map.set('On', repeat.onList.map((index) => weekdayName[index]!));
	if (repeat.until !== undefined) map.set('Until', dayText(repeat.until));
	if (repeat.count !== undefined) map.set('Count', repeat.count);
	return map;
}

/** In words: "Every week on Mon, Wed until Dec 15, 2026". */
export function repeatTitle(repeat: Repeat, startDay: number): string {
	let text = tr`Every ${unitText(repeat.every, repeat.interval)}`;
	if (repeat.every === 'Week') text = tr`${text} on ${listText((repeat.onList.length ? repeat.onList : [weekdayOf(startDay)]).map((index) => weekdayText(index)))}`;
	if (repeat.until !== undefined) text = tr`${text} until ${dateText(repeat.until, { year: true })}`;
	if (repeat.count !== undefined) text = tr`${text}, ${repeat.count} times`;
	return text;
}

/** Skipped days: `2026-11-25`, `2026-11-23..2026-11-29`, in a list or alone → [first, last] pairs. */
export function skipOf(value: PropertyValue | undefined): [number, number][] {
	const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	const rangeList: [number, number][] = [];
	for (const item of list) {
		if (typeof item !== 'string') continue;
		const [from, to] = item.split('..').map((part) => dayOf(part));
		if (from === undefined) continue;
		rangeList.push([from, to ?? from].sort((a, b) => a - b) as [number, number]);
	}
	return rangeList;
}

export function skipValue(rangeList: readonly [number, number][]): PropertyValue | undefined {
	if (rangeList.length === 0) return undefined;
	return rangeList.map(([from, to]) => (from === to ? dayText(from) : `${dayText(from)}..${dayText(to)}`));
}

/** Adds a day to the skips (joining a range it touches). */
export function addSkip(rangeList: readonly [number, number][], day: number): [number, number][] {
	return [...rangeList, [day, day] as [number, number]].sort((a, b) => a[0] - b[0]);
}

const isSkipped = (rangeList: readonly [number, number][], day: number): boolean => rangeList.some(([from, to]) => day >= from && day <= to);

/**
 * The days a repeating event starts on, from `fromDay` to `toDay` (both included): every n days,
 * weeks (on its weekdays), months (on its date; months without it are passed), or years.
 */
export function repeatDayList(startDay: number, repeat: Repeat | undefined, skipList: readonly [number, number][], fromDay: number, toDay: number): number[] {
	if (!repeat) return startDay >= fromDay && startDay <= toDay && !isSkipped(skipList, startDay) ? [startDay] : [];
	const list: number[] = [];
	const last = Math.min(toDay, repeat.until ?? Number.POSITIVE_INFINITY);
	let index = 0;
	const take = (day: number): boolean => {
		if (repeat.count !== undefined && index >= repeat.count) return false;
		index++;
		if (day >= fromDay && day <= last && !isSkipped(skipList, day)) list.push(day);
		return true;
	};
	switch (repeat.every) {
		case 'Day': {
			// jump near the window instead of walking from the start
			const skipCount = repeat.count === undefined ? Math.max(0, Math.floor((fromDay - startDay) / repeat.interval)) : 0;
			index = skipCount;
			for (let day = startDay + skipCount * repeat.interval; day <= last; day += repeat.interval) if (!take(day)) break;
			break;
		}
		case 'Week': {
			const onList = repeat.onList.length ? repeat.onList : [weekdayOf(startDay)];
			const firstMonday = startDay - weekdayOf(startDay);
			const weekJump = repeat.count === undefined ? Math.max(0, Math.floor((fromDay - firstMonday) / 7 / repeat.interval) - 1) : 0;
			index = weekJump * onList.length;
			for (let monday = firstMonday + weekJump * 7 * repeat.interval; monday <= last; monday += 7 * repeat.interval) {
				let stop = false;
				for (const weekday of onList) {
					const day = monday + weekday;
					if (day < startDay) continue;
					if (day > last) break;
					if (!take(day)) {
						stop = true;
						break;
					}
				}
				if (stop) break;
			}
			break;
		}
		case 'Month':
		case 'Year': {
			const start = partOf(startDay);
			for (let step = 0; ; step++) {
				const monthIndex = start.month + step * repeat.interval * (repeat.every === 'Year' ? 12 : 1);
				const year = start.year + Math.floor(monthIndex / 12);
				const month = ((monthIndex % 12) + 12) % 12;
				const day = dayFromPart(year, month, start.date);
				if (day > last) break;
				// no 31st this month: none this time
				if (partOf(day).month !== month) continue;
				if (!take(day)) break;
			}
			break;
		}
	}
	return list;
}

// ---------------------------------------------------------------- time zones

/** This device's time zone (`America/Toronto`). */
export function localZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/** `UTC+9`, `UTC-3:30`, `UTC−5`, `UTC` → minutes ahead of UTC; undefined for anything else. */
export function fixedOffset(zone: string): number | undefined {
	const match = /^UTC(?:\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?)?$/i.exec(zone.trim());
	if (!match) return undefined;
	if (!match[1]) return 0;
	const minute = Number(match[2]) * 60 + Number(match[3] ?? 0);
	return match[1] === '+' ? minute : -minute;
}

/** True for a zone: an offset (`UTC+9`) or a zone the browser knows (`Asia/Tokyo`). */
export function isZone(zone: string): boolean {
	if (fixedOffset(zone) !== undefined) return true;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * The zones a picker offers: real places, so daylight saving follows them (New York is UTC−5 in
 * winter, UTC−4 in summer); each is shown by its offset now, with cities that keep the same clock.
 */
export const zoneList: readonly { zone: string; city: string }[] = [
	{ zone: 'Pacific/Pago_Pago', city: 'Pago Pago' },
	{ zone: 'Pacific/Honolulu', city: 'Honolulu' },
	{ zone: 'America/Anchorage', city: 'Anchorage' },
	{ zone: 'America/Los_Angeles', city: 'Los Angeles, Vancouver, Seattle' },
	{ zone: 'America/Phoenix', city: 'Phoenix' },
	{ zone: 'America/Denver', city: 'Denver, Calgary' },
	{ zone: 'America/Chicago', city: 'Chicago, Winnipeg' },
	{ zone: 'America/Mexico_City', city: 'Mexico City' },
	{ zone: 'America/New_York', city: 'New York, Toronto, Montreal' },
	{ zone: 'America/Bogota', city: 'Bogotá, Lima' },
	{ zone: 'America/Halifax', city: 'Halifax' },
	{ zone: 'America/Caracas', city: 'Caracas' },
	{ zone: 'America/Santiago', city: 'Santiago' },
	{ zone: 'America/St_Johns', city: "St. John's" },
	{ zone: 'America/Sao_Paulo', city: 'São Paulo, Buenos Aires' },
	{ zone: 'Atlantic/Azores', city: 'Azores' },
	{ zone: 'UTC', city: 'Coordinated Universal Time' },
	{ zone: 'Europe/London', city: 'London, Dublin, Lisbon' },
	{ zone: 'Atlantic/Reykjavik', city: 'Reykjavík, Dakar' },
	{ zone: 'Europe/Paris', city: 'Paris, Berlin, Madrid, Rome' },
	{ zone: 'Africa/Lagos', city: 'Lagos, Kinshasa' },
	{ zone: 'Europe/Athens', city: 'Athens, Helsinki, Kyiv' },
	{ zone: 'Africa/Cairo', city: 'Cairo' },
	{ zone: 'Africa/Johannesburg', city: 'Johannesburg' },
	{ zone: 'Europe/Istanbul', city: 'Istanbul, Moscow, Riyadh' },
	{ zone: 'Africa/Nairobi', city: 'Nairobi' },
	{ zone: 'Asia/Tehran', city: 'Tehran' },
	{ zone: 'Asia/Dubai', city: 'Dubai, Baku' },
	{ zone: 'Asia/Kabul', city: 'Kabul' },
	{ zone: 'Asia/Karachi', city: 'Karachi, Tashkent' },
	{ zone: 'Asia/Kolkata', city: 'Mumbai, Delhi, Colombo' },
	{ zone: 'Asia/Kathmandu', city: 'Kathmandu' },
	{ zone: 'Asia/Dhaka', city: 'Dhaka, Almaty' },
	{ zone: 'Asia/Yangon', city: 'Yangon' },
	{ zone: 'Asia/Bangkok', city: 'Bangkok, Jakarta, Hanoi' },
	{ zone: 'Asia/Shanghai', city: 'Beijing, Shanghai, Hong Kong' },
	{ zone: 'Asia/Taipei', city: 'Taipei' },
	{ zone: 'Asia/Singapore', city: 'Singapore, Kuala Lumpur, Manila' },
	{ zone: 'Australia/Perth', city: 'Perth' },
	{ zone: 'Asia/Tokyo', city: 'Tokyo, Seoul' },
	{ zone: 'Australia/Darwin', city: 'Darwin' },
	{ zone: 'Australia/Adelaide', city: 'Adelaide' },
	{ zone: 'Australia/Brisbane', city: 'Brisbane, Guam' },
	{ zone: 'Australia/Sydney', city: 'Sydney, Melbourne' },
	{ zone: 'Pacific/Noumea', city: 'Nouméa, Solomon Islands' },
	{ zone: 'Pacific/Auckland', city: 'Auckland, Wellington' },
	{ zone: 'Pacific/Fiji', city: 'Fiji' },
	{ zone: 'Pacific/Tongatapu', city: 'Tonga' },
	{ zone: 'Pacific/Kiritimati', city: 'Kiritimati' },
];

/** The picker's place for a zone (its cities), when it has one. */
export function zoneCity(zone: string): string | undefined {
	return zoneList.find((entry) => entry.zone === zone)?.city;
}

const formatterMap = new Map<string, Intl.DateTimeFormat>();

/** How many minutes a zone is ahead of UTC at a moment (minutes from 1970, in UTC). */
export function zoneOffset(zone: string, utcMinute: number): number {
	const fixed = fixedOffset(zone);
	if (fixed !== undefined) return fixed;
	let formatter = formatterMap.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
		formatterMap.set(zone, formatter);
	}
	const part: Record<string, number> = {};
	for (const item of formatter.formatToParts(new Date(utcMinute * 60_000))) if (item.type !== 'literal') part[item.type] = Number(item.value);
	const wall = Date.UTC(part.year!, part.month! - 1, part.day!, part.hour! % 24, part.minute!) / 60_000;
	return Math.round(wall - Math.floor(utcMinute));
}

/** A wall time in one zone as the wall time in another (09:00 in Toronto → 23:00 in Tokyo). */
export function convertMoment(moment: number, from: string, to: string): number {
	if (from === to) return moment;
	const guess = moment - zoneOffset(from, moment);
	const utc = moment - zoneOffset(from, guess);
	return utc + zoneOffset(to, utc);
}

/** A zone as an offset: `UTC+9`, `UTC−3:30`, `UTC` (at a moment, for zones with daylight saving). */
export function zoneLabel(zone: string, utcMinute = Date.now() / 60_000): string {
	const offset = zoneOffset(zone, utcMinute);
	if (offset === 0) return 'UTC';
	const hour = Math.floor(Math.abs(offset) / 60);
	const minute = Math.abs(offset) % 60;
	return `UTC${offset < 0 ? '−' : '+'}${hour}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`;
}

/** Now, on the wall clock of a zone. */
export function nowIn(zone: string): number {
	const utc = Math.floor(Date.now() / 60_000);
	return utc + zoneOffset(zone, utc);
}
