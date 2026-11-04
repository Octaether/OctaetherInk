// Events, wherever they come from: Event blocks inside the Calendar, notes of the vault (their
// Start or Date), and table rows (their first date column). Each becomes a CalendarEvent; repeats
// unfold into occurrences for the days on screen. Changes go back to where the event lives.

import { type BlockNode, type FormatOption, type PropertyMap, type PropertyValue, formatInline, serializeNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import type { NoteSummary, TableSnapshot } from '@octaether/core-sdk';
import {
	type Repeat,
	clockOf,
	clockText,
	convertMoment,
	isZone,
	dayOf,
	dayOfMoment,
	dayText,
	durationOf,
	durationText,
	minutePerDay,
	momentOf,
	momentText,
	repeatDayList,
	repeatOf,
	repeatValue,
	skipOf,
	skipValue,
} from './time';

export type EventKind = 'Block' | 'Note' | 'Table';

export interface CalendarEvent {
	/** `Block:<key>`, `Note:<path>`, `Table:<reference>:<row>`. */
	id: string;
	kind: EventKind;
	blockKey?: string;
	path?: string;
	title: string;
	/** Its first moment (minutes, wall time). */
	start: number;
	/** Minutes; whole days for an all-day event. */
	duration: number;
	allDay: boolean;
	/** Written with Duration rather than End. */
	useDuration: boolean;
	repeat: Repeat | undefined;
	skipList: [number, number][];
	color: string | undefined;
	place: string | undefined;
	/** The zone its times are in (`Asia/Tokyo`); undefined: the calendar's own. */
	timeZone: string | undefined;
	tagList: string[];
	/** What it holds, as OI text (an Event block's children). */
	noteText: string;
	/** From a table: changed in the table, not here. */
	readOnly: boolean;
}

export interface Occurrence {
	event: CalendarEvent;
	start: number;
	end: number;
	/** `<event id>@<day>`. */
	key: string;
}

const textOf = (value: PropertyValue | undefined): string | undefined => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined);

/** An event from properties (`Start`, `End` or `Duration`, `AllDay`, `Repeat`, `Skip`, `Color`, `Place`, `Tag`). */
export function eventOf(property: PropertyMap, base: { id: string; kind: EventKind; title: string; blockKey?: string; path?: string; noteText?: string; readOnly?: boolean }, dateKey = 'Start'): CalendarEvent | undefined {
	const start = momentOf(property.get(dateKey) ?? (dateKey === 'Start' ? property.get('Date') : undefined));
	if (!start) return undefined;
	const allDay = property.get('AllDay') === true || (start.allDay && property.get('AllDay') !== false);
	const startMoment = allDay ? dayOfMoment(start.moment) * minutePerDay : start.moment;
	let duration: number | undefined;
	const durationValue = durationOf(property.get('Duration'));
	const endValue = textOf(property.get('End'));
	if (durationValue !== undefined) duration = allDay ? Math.max(1, Math.round(durationValue / minutePerDay)) * minutePerDay : durationValue;
	else if (endValue) {
		const day = dayOf(endValue);
		if (day !== undefined) {
			const end = momentOf(endValue)!;
			// an all-day end is the last day, included
			duration = allDay || end.allDay ? (day + 1) * minutePerDay - startMoment : end.moment - startMoment;
		} else {
			const clock = clockOf(endValue);
			if (clock !== undefined) duration = dayOfMoment(startMoment) * minutePerDay + clock - startMoment;
		}
	}
	if (duration === undefined || duration <= 0) duration = allDay ? minutePerDay : 60;
	const tag = property.get('Tag');
	const zone = textOf(property.get('TimeZone'))?.trim();
	return {
		...base,
		noteText: base.noteText ?? '',
		readOnly: base.readOnly ?? false,
		start: startMoment,
		duration,
		allDay,
		useDuration: durationValue !== undefined,
		repeat: repeatOf(property.get('Repeat')),
		skipList: skipOf(property.get('Skip')),
		color: textOf(property.get('Color')),
		place: textOf(property.get('Place')),
		timeZone: zone && isZone(zone) ? zone : undefined,
		tagList: (Array.isArray(tag) ? tag : tag === undefined || tag === null ? [] : [tag]).map(String),
	};
}

/** An Event block's children as OI text (at the left edge). */
export function childText(node: BlockNode, option: FormatOption = {}): string {
	const lineList = node.childList.flatMap((child) => serializeNode(child, option));
	const indent = Math.min(...lineList.filter((line) => line.trim() !== '').map((line) => /^\t*/.exec(line)![0].length));
	return lineList.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join('\n').trim();
}

/** The Event blocks of a Calendar. */
export function blockEventList(calendar: BlockNode, option: FormatOption = {}): CalendarEvent[] {
	const list: CalendarEvent[] = [];
	for (const node of calendar.childList) {
		if (node.type !== 'Event') continue;
		const event = eventOf(node.property, { id: `Block:${node.key}`, kind: 'Block', title: node.body.trim(), blockKey: node.key, noteText: childText(node, option) });
		if (event) list.push(event);
	}
	return list;
}

/** Notes with a date (`Start`, or `Date`, or the calendar's `DateProperty`). */
export function noteEventList(noteList: readonly NoteSummary[], dateKey: string): CalendarEvent[] {
	const list: CalendarEvent[] = [];
	for (const note of noteList) {
		const title = textOf(note.property.get('Title')) ?? note.name;
		const event = eventOf(note.property, { id: `Note:${note.path}`, kind: 'Note', title, path: note.path }, note.property.has(dateKey) ? dateKey : dateKey === 'Start' ? 'Date' : dateKey);
		if (event) list.push(event);
	}
	return list;
}

/** A table's rows on their first date column; named by their first text column. */
export function tableEventList(reference: string, snapshot: TableSnapshot): CalendarEvent[] {
	const dateColumn = snapshot.columnList.find((column) => column.type === 'Date' || column.type === 'DateTime');
	if (!dateColumn) return [];
	const nameColumn = snapshot.columnList.find((column) => column !== dateColumn && ['Text', 'Choice', 'Link'].includes(column.type));
	const list: CalendarEvent[] = [];
	dateColumn.valueList.forEach((value, row) => {
		if (typeof value !== 'number') return;
		const allDay = dateColumn.type === 'Date' && value % 1 === 0;
		const name = nameColumn?.valueList[row];
		list.push({
			id: `Table:${reference}:${row}`,
			kind: 'Table',
			title: name === undefined ? reference : Array.isArray(name) ? name.join(', ') : String(name),
			start: Math.round(value * minutePerDay),
			duration: allDay ? minutePerDay : 60,
			allDay,
			useDuration: false,
			repeat: undefined,
			skipList: [],
			color: undefined,
			place: undefined,
			timeZone: undefined,
			tagList: [],
			noteText: '',
			readOnly: true,
			path: snapshot.pathList?.[row],
		});
	});
	return list;
}

/**
 * Every time the events happen that touches the days from `fromDay` to `toDay`. With `zone`, timed
 * events are shown in `zone.display`: an event's times are in its own TimeZone, or the calendar's (`home`).
 */
export function occurrenceList(eventList: readonly CalendarEvent[], fromDay: number, toDay: number, zone?: { home: string; display: string }): Occurrence[] {
	const list: Occurrence[] = [];
	for (const event of eventList) {
		const startDay = dayOfMoment(event.start);
		const clock = event.start - startDay * minutePerDay;
		const from = event.timeZone ?? zone?.home;
		const shift = zone && from && !event.allDay && from !== zone.display;
		// an occurrence that began earlier may still run into the window (a day more either way for another zone)
		const reach = Math.ceil((clock + event.duration) / minutePerDay) + (shift ? 1 : 0);
		for (const day of repeatDayList(startDay, event.repeat, event.skipList, fromDay - reach, toDay + (shift ? 1 : 0))) {
			let start = day * minutePerDay + clock;
			let end = start + event.duration;
			if (shift) {
				start = convertMoment(start, from, zone.display);
				end = convertMoment(end, from, zone.display);
			}
			if (end <= fromDay * minutePerDay || start >= (toDay + 1) * minutePerDay) continue;
			list.push({ event, start, end, key: `${event.id}@${day}` });
		}
	}
	return list.sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---------------------------------------------------------------- writing

/** The properties that say when an event is: Start, then End or Duration, Repeat, Skip. */
export function timingProperty(event: Pick<CalendarEvent, 'start' | 'duration' | 'allDay' | 'useDuration' | 'repeat' | 'skipList' | 'timeZone'>): Map<string, PropertyValue | undefined> {
	const map = new Map<string, PropertyValue | undefined>();
	map.set('Start', momentText(event.start, event.allDay));
	const startDay = dayOfMoment(event.start);
	const end = event.start + event.duration;
	if (event.useDuration) {
		map.set('Duration', durationText(event.duration));
		map.set('End', undefined);
	} else {
		map.set('Duration', undefined);
		if (event.allDay) map.set('End', event.duration > minutePerDay ? dayText(dayOfMoment(end) - 1) : undefined);
		// the same day: just the time (`End: 10:30`)
		else map.set('End', dayOfMoment(end) === startDay ? clockText(end - startDay * minutePerDay) : momentText(end));
	}
	map.set('AllDay', undefined);
	map.set('TimeZone', event.allDay ? undefined : event.timeZone);
	map.set('Repeat', repeatValue(event.repeat));
	map.set('Skip', skipValue(event.skipList));
	return map;
}

/** Everything an event says about itself, in the order a note or block writes it. */
export function eventProperty(event: CalendarEvent): PropertyMap {
	const map: PropertyMap = new Map();
	for (const [key, value] of timingProperty(event)) if (value !== undefined) map.set(key, value);
	if (event.color) map.set('Color', event.color);
	if (event.place) map.set('Place', event.place);
	if (event.tagList.length) map.set('Tag', event.tagList);
	return map;
}

/** An Event block as OI text: `Event {Start: …, End: …}: Name`, with what it holds below. */
export function eventSource(event: CalendarEvent): string {
	const property = eventProperty(event);
	const head = `Event ${formatInline(property)}:${event.title ? ` ${event.title}` : ''}`;
	const body = event.noteText.trim() ? `\n${event.noteText.split('\n').map((line) => `\t${line}`).join('\n')}` : '';
	return head + body;
}

/** Changes an Event block's timing (and other fields) in place. */
export function writeBlockEvent(model: NoteModel, event: CalendarEvent, change: { title?: string; color?: string | null; place?: string | null; noteText?: string } = {}): void {
	const key = event.blockKey;
	if (!key || !model.get(key)) return;
	model.transact(() => {
		const node = model.get(key)!;
		for (const [name, value] of timingProperty(event)) {
			const current = node.property.get(name);
			if (value === undefined ? current !== undefined : formatInline(value) !== (current === undefined ? undefined : formatInline(current))) model.setProperty(key, name, value);
		}
		if (change.title !== undefined && change.title !== node.body) model.setBody(key, change.title);
		if (change.color !== undefined) model.setProperty(key, 'Color', change.color ?? undefined);
		if (change.place !== undefined) model.setProperty(key, 'Place', change.place || undefined);
		if (change.noteText !== undefined && change.noteText.trim() !== event.noteText.trim()) {
			for (const child of [...node.childList]) model.delete(child.key);
			let after: string | null = null;
			for (const child of change.noteText.trim() ? model.parseFragment(change.noteText) : []) after = model.insert(key, after, child);
		}
	});
}

/** Adds Event blocks (OI text) to a Calendar, after a block or at the end. */
export function insertEvent(model: NoteModel, calendarKey: string, source: string, afterKey?: string): string | undefined {
	const calendar = model.get(calendarKey);
	if (!calendar) return undefined;
	let after: string | null = afterKey ?? calendar.childList.at(-1)?.key ?? null;
	let first: string | undefined;
	model.transact(() => {
		for (const node of model.parseFragment(source)) {
			after = model.insert(calendarKey, after, node);
			first ??= after;
		}
	});
	return first;
}

/** One occurrence of a repeating event gets its own event: the series skips that day. */
export function splitThis(event: CalendarEvent, occurrence: Occurrence, changed: CalendarEvent): { series: CalendarEvent; single: CalendarEvent } {
	const day = dayOfMoment(occurrence.start);
	return {
		series: { ...event, skipList: [...event.skipList, [day, day]] },
		single: { ...changed, repeat: undefined, skipList: [] },
	};
}

/** This occurrence and the ones after it become a new series; the old one ends the day before. */
export function splitFollowing(event: CalendarEvent, occurrence: Occurrence, changed: CalendarEvent): { series: CalendarEvent; following: CalendarEvent } {
	const day = dayOfMoment(occurrence.start);
	const repeat = event.repeat ? { ...event.repeat, until: day - 1 } : undefined;
	const followingRepeat = changed.repeat ? { ...changed.repeat, count: undefined } : undefined;
	return {
		series: { ...event, repeat },
		following: { ...changed, repeat: followingRepeat, skipList: event.skipList.filter(([, to]) => to >= day) },
	};
}

/** A copy of an event at another start: the same name (no "(1)"), what it holds, and its repeat. */
export function duplicateAt(event: CalendarEvent, start: number): CalendarEvent {
	return { ...event, start, skipList: event.repeat ? event.skipList : [] };
}

export { momentText, dayText };
