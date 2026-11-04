// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import { type MenuEntry, type NoteIndex, type NoteSummary, menuExtension, noteIndexExtension } from '@octaether/core-sdk';
import { textModule } from '@octaether/module-text';
import { afterEach, describe, expect, it } from 'vitest';
import { calendarModule } from '../src';
import { blockEventList, duplicateAt, eventOf, eventSource, noteEventList, occurrenceList, splitFollowing, splitThis, timingProperty } from '../src/event';
import { convertMoment, dayOf, dayText, durationOf, durationText, momentOf, repeatDayList, repeatOf, repeatTitle, skipOf, zoneLabel } from '../src/time';
import { placeSideBySide, sourceNote } from '../src/view';

const day = (text: string): number => dayOf(text)!;
const at = (text: string): number => momentOf(text)!.moment;
const map = (text: string): Map<string, never> => NoteModel.fromText(`Event ${text}: x\n`).document.itemList[0]!.property as Map<string, never>;

describe('time', () => {
	it('reads and writes durations', () => {
		expect(durationOf('1h30m')).toBe(90);
		expect(durationOf('45m')).toBe(45);
		expect(durationOf('1.5h')).toBe(90);
		expect(durationOf('2d')).toBe(2880);
		expect(durationText(90)).toBe('1h30m');
		expect(durationText(60)).toBe('1h');
		expect(durationText(30)).toBe('30m');
		expect(durationText(2880)).toBe('2d');
	});

	it('reads moments, an offset ignored', () => {
		expect(momentOf('2026-11-04 09:30 -05:00')).toEqual({ moment: day('2026-11-04') * 1440 + 570, allDay: false });
		expect(momentOf('2026-11-04')).toEqual({ moment: day('2026-11-04') * 1440, allDay: true });
	});

	it('repeats on weekdays until a day, skipping a break', () => {
		const repeat = repeatOf(map('{Repeat: {Every: Week, On: [Mon, Wed]}}').get('Repeat'))!;
		repeat.until = day('2026-12-02');
		const skip = skipOf(['2026-11-23..2026-11-29', '2026-11-04']);
		const list = repeatDayList(day('2026-11-02'), repeat, skip, day('2026-11-01'), day('2026-12-31')).map(dayText);
		expect(list).toEqual(['2026-11-02', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18', '2026-11-30', '2026-12-02']);
		expect(repeatTitle(repeat, day('2026-11-02'))).toBe('Every week on Mon, Wed until Dec 2, 2026');
	});

	it('counts repeats, skipped ones included', () => {
		const repeat = repeatOf(new Map<string, never>([['Every', 'Day' as never], ['Count', 3 as never]]))!;
		expect(repeatDayList(day('2026-11-01'), repeat, skipOf('2026-11-02'), day('2026-10-01'), day('2026-12-01')).map(dayText)).toEqual(['2026-11-01', '2026-11-03']);
	});

	it('repeats monthly on its date, passing months without it', () => {
		const list = repeatDayList(day('2026-01-31'), repeatOf('Monthly'), [], day('2026-01-01'), day('2026-06-30')).map(dayText);
		expect(list).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
	});

	it('every other week', () => {
		const repeat = repeatOf(new Map<string, never>([['Every', 'Week' as never], ['Interval', 2 as never]]))!;
		expect(repeatDayList(day('2026-11-02'), repeat, [], day('2026-11-01'), day('2026-11-30')).map(dayText)).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
	});
});

describe('events', () => {
	it('takes End as a time, a date, or a Duration', () => {
		const base = { id: 'x', kind: 'Block' as const, title: 'x' };
		expect(eventOf(map('{Start: 2026-11-04 09:00, End: 10:30}'), base)!.duration).toBe(90);
		expect(eventOf(map('{Start: 2026-11-04 09:00, Duration: 2h}'), base)!.duration).toBe(120);
		const trip = eventOf(map('{Start: 2026-11-08, End: 2026-11-10}'), base)!;
		expect(trip.allDay).toBe(true);
		expect(trip.duration).toBe(3 * 1440);
		expect(eventOf(map('{Start: 2026-11-04 09:00}'), base)!.duration).toBe(60);
		expect(eventOf(map('{End: 10:00}'), base)).toBeUndefined();
	});

	it('writes timing back the way it was given', () => {
		const base = { id: 'x', kind: 'Block' as const, title: 'x' };
		const timed = eventOf(map('{Start: 2026-11-04 09:00, End: 10:30}'), base)!;
		expect([...timingProperty({ ...timed, start: timed.start + 60 })].filter(([, value]) => value !== undefined)).toEqual([
			['Start', '2026-11-04 10:00'],
			['End', '11:30'],
		]);
		const lasting = eventOf(map('{Start: 2026-11-04 09:00, Duration: 1h30m}'), base)!;
		expect(timingProperty(lasting).get('Duration')).toBe('1h30m');
		const trip = eventOf(map('{Start: 2026-11-08, End: 2026-11-10}'), base)!;
		expect(timingProperty(trip).get('End')).toBe('2026-11-10');
	});

	it('unfolds repeats into the days on screen, a multi-day event included', () => {
		const model = NoteModel.fromText('Calendar:\n\tEvent {Start: 2026-11-02 09:00, End: 10:00, Repeat: Weekly}: Class\n\tEvent {Start: 2026-10-30, End: 2026-11-03}: Trip\n');
		const list = occurrenceList(blockEventList(model.document.itemList[0]!), day('2026-11-01'), day('2026-11-14'));
		expect(list.map((item) => `${item.event.title} ${dayText(Math.floor(item.start / 1440))}`)).toEqual(['Trip 2026-10-30', 'Class 2026-11-02', 'Class 2026-11-09']);
	});

	it('splits a repeating event for one day, or from a day on', () => {
		const event = eventOf(map('{Start: 2026-11-02 09:00, End: 10:00, Repeat: Weekly}'), { id: 'x', kind: 'Block', title: 'Class' })!;
		const occurrence = occurrenceList([event], day('2026-11-09'), day('2026-11-09'))[0]!;
		const moved = { ...event, start: at('2026-11-09 11:00') };
		const one = splitThis(event, occurrence, moved);
		expect(one.series.skipList).toEqual([[day('2026-11-09'), day('2026-11-09')]]);
		expect(one.single.repeat).toBeUndefined();
		expect(one.single.title).toBe('Class');
		const rest = splitFollowing(event, occurrence, moved);
		expect(rest.series.repeat!.until).toBe(day('2026-11-08'));
		expect(rest.following.start).toBe(at('2026-11-09 11:00'));
	});

	it('copies keep the same name, with no "(1)"', () => {
		const event = eventOf(map('{Start: 2026-11-02 09:00}'), { id: 'x', kind: 'Block', title: 'Gym' })!;
		const copy = duplicateAt(event, at('2026-11-03 09:00'));
		expect(eventSource(copy)).toBe('Event {Start: 2026-11-03 09:00, End: 10:00}: Gym');
	});

	it('reads notes by Start or Date, and Source names their folder or tag', () => {
		const noteList: NoteSummary[] = [
			{ path: 'Class/Exam.oi', name: 'Exam', folder: 'Class', property: new Map([['Date', '2026-12-10' as never]]), tagList: [] },
			{ path: 'Class/Plain.oi', name: 'Plain', folder: 'Class', property: new Map(), tagList: [] },
			{ path: 'Other/Party.oi', name: 'Party', folder: 'Other', property: new Map([['Start', '2026-12-12 20:00' as never], ['Title', 'Birthday' as never]]), tagList: ['Fun'] },
		];
		expect(sourceNote(['Class'], noteList).map((note) => note.name)).toEqual(['Exam', 'Plain']);
		expect(sourceNote(['tag:Fun'], noteList).map((note) => note.name)).toEqual(['Party']);
		expect(noteEventList(noteList, 'Start').map((event) => event.title)).toEqual(['Exam', 'Birthday']);
	});

	it('puts overlapping events side by side', () => {
		const a = { start: 0, end: 60 };
		const b = { start: 30, end: 90 };
		const c = { start: 120, end: 150 };
		const place = placeSideBySide([a, b, c]);
		expect(place.get(a)).toEqual({ column: 0, count: 2 });
		expect(place.get(b)).toEqual({ column: 1, count: 2 });
		expect(place.get(c)).toEqual({ column: 0, count: 1 });
	});
});

describe('the Calendar block', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mount(text: string, noteList: NoteSummary[] = [], other?: NoteModel) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(calendarModule, true);
		const menuList: MenuEntry[][] = [];
		registry.registerExtension(menuExtension, { open: ({ itemList }: { itemList: MenuEntry[] }) => menuList.push(itemList), close: () => undefined, prompt: async () => 'Classes' });
		const created: { folder: string; name: string; property: Map<string, unknown>; body?: string }[] = [];
		registry.registerExtension(noteIndexExtension, {
			noteList: () => noteList,
			pathOf: () => 'Plan.oi',
			subscribe: () => () => undefined,
			setProperty: async () => undefined,
			createNote: async (option: { folder: string; name: string; property: Map<string, unknown>; body?: string }) => {
				created.push(option);
				return `${option.folder}/${option.name}.oi`;
			},
			trashNote: async () => true,
			readNote: async () => '',
			modelOf: async (path: string) => (path === 'Classes.oi' ? other : undefined),
			findFile: () => undefined,
			readFile: async () => undefined,
			writeFile: async () => undefined,
			createFile: async () => undefined,
			resolve: (target: string) => (target === 'Classes' ? 'Classes.oi' : undefined),
			open: () => undefined,
		} satisfies NoteIndex as never);
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 50 && !document.querySelector('.oi-calendar-bar'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, menuList, created, root: document.querySelector<HTMLElement>('.oi-calendar')! };
	}

	it('shows a month with its events and hides the Event blocks themselves', async () => {
		const { root } = await mount('Calendar {Date: 2026-11-15}:\n\tEvent {Start: 2026-11-04 09:00, End: 10:00, Repeat: Weekly}: Class\n');
		expect(root.querySelector('.oi-calendar-title')!.textContent).toBe('November 2026');
		// Nov 4, 11, 18, 25, and Dec 2 (the grid's last week)
		expect(root.querySelectorAll('.oi-calendar-event').length).toBe(5);
		const frame = document.querySelector<HTMLElement>('.oi-frame[data-oi-type="Event"]')!;
		expect(frame.hidden).toBe(true);
	});

	it('makes an event: click a day, type a name, Enter', async () => {
		const { model, root } = await mount('Calendar {Date: 2026-11-15}:\n');
		const cell = root.querySelector<HTMLElement>('.oi-calendar-cell[data-day]')!;
		const fake = (type: string): void => {
			cell.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 5, clientY: 5 }));
		};
		(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => cell;
		fake('pointerdown');
		fake('pointerup');
		const popover = document.querySelector<HTMLElement>('.oi-calendar-popover')!;
		expect(popover).not.toBeNull();
		const name = popover.querySelector<HTMLInputElement>('input[name="title"]')!;
		name.value = 'Dentist';
		popover.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		const calendar = model.document.itemList[0]!;
		expect(calendar.childList.map((node) => `${node.type}: ${node.body}`)).toEqual(['Event: Dentist']);
		expect(calendar.childList[0]!.property.get('Start')).toBe(dayText(Number(cell.dataset.day)));
	});

	it('changes one day of a repeating event: it asks, and "This event" splits it off', async () => {
		const { model, root, menuList } = await mount('Calendar {Date: 2026-11-15}:\n\tEvent {Start: 2026-11-04 09:00, End: 10:00, Repeat: Weekly}: Class\n');
		const chip = root.querySelectorAll<HTMLElement>('.oi-calendar-event')[1]!;
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
		const duplicate = menuList[0]!.find((item) => item.title === 'Skip this day')!;
		duplicate.run!();
		expect(model.document.itemList[0]!.childList[0]!.property.get('Skip')).toEqual(['2026-11-11']);
	});

	it('moves an event to its own note and back in the calendar', async () => {
		const { model, root, menuList, created } = await mount('Calendar {Date: 2026-11-15}:\n\tEvent {Start: 2026-11-04 09:00, End: 10:00}: Review\n');
		root.querySelector<HTMLElement>('.oi-calendar-event')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
		menuList[0]!.find((item) => item.title === 'Move to its own note')!.run!();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(created[0]).toMatchObject({ folder: 'Plan', name: 'Review' });
		expect(created[0]!.property.get('Start')).toBe('2026-11-04 09:00');
		expect(model.document.itemList[0]!.childList).toEqual([]);
		expect(model.document.itemList[0]!.property.get('Folder')).toBe('Plan');
	});
});


describe('calendars in other notes', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	async function mountFrom(text: string, other?: NoteModel) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(calendarModule, true);
		const menuList: MenuEntry[][] = [];
		registry.registerExtension(menuExtension, { open: ({ itemList }: { itemList: MenuEntry[] }) => menuList.push(itemList), close: () => undefined, prompt: async () => 'Classes' });
		const created: { folder: string; name: string; body?: string }[] = [];
		const index: Partial<NoteIndex> = {
			noteList: () => [],
			pathOf: () => 'Plan.oi',
			subscribe: () => () => undefined,
			resolve: (target) => (target === 'Classes' ? 'Classes.oi' : undefined),
			modelOf: async (path) => (path === 'Classes.oi' ? other : undefined),
			createNote: async (option) => {
				created.push(option);
				return `${option.name}.oi`;
			},
		};
		registry.registerExtension(noteIndexExtension, index);
		registry.attach({ registerCommand: () => () => undefined, registerTheme: () => () => undefined, setting: () => undefined, theme: () => ({ name: 'Light', mode: 'Light', token: {} }), applyTheme: () => undefined, themeList: () => [] });
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		for (let tries = 0; tries < 80 && !document.querySelector('.oi-calendar-bar'); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
		return { model, menuList, created, root: document.querySelector<HTMLElement>('.oi-calendar')! };
	}

	it('shows the Calendar of another note (From) and changes its events there', async () => {
		const other = NoteModel.fromText('Calendar:\n\tEvent {Start: 2026-11-04 09:00, End: 10:00}: Review\n');
		const { root, menuList, model } = await mountFrom('Calendar {From: "[[Classes]]", Date: 2026-11-15}:\n', other);
		expect(root.querySelector('.oi-calendar-name')!.textContent).toBe('Review');
		root.querySelector<HTMLElement>('.oi-calendar-event')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
		menuList[0]!.find((item) => item.title === 'Duplicate')!.run!();
		expect(other.document.itemList[0]!.childList.map((node) => node.body)).toEqual(['Review', 'Review']);
		expect(model.document.itemList[0]!.childList).toEqual([]);
	});

	it('moves a calendar to its own note, leaving a From behind, and marks Full width', async () => {
		const { root, menuList, model, created } = await mountFrom('Calendar {Show: Week}:\n\tEvent {Start: 2026-11-04 09:00}: Review\n\t\tRoom 1\n');
		root.querySelector<HTMLElement>('[data-action="More"]')!.click();
		menuList[0]!.find((item) => item.title === 'Full width')!.run!();
		expect(model.document.itemList[0]!.property.get('Wide')).toBe(true);
		expect(document.querySelector('.oi-frame[data-oi-type="Calendar"]')!.classList.contains('oi-wide')).toBe(true);
		document.querySelector<HTMLElement>('.oi-calendar [data-action="More"]')!.click();
		menuList[1]!.find((item) => item.title === 'Move to its own note')!.run!();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(created[0]!.body).toBe('Calendar {Show: Week}:\n\tEvent {Start: 2026-11-04 09:00}: Review\n\t\tRoom 1');
		expect(model.document.itemList[0]!.property.get('From')).toBe('[[Classes]]');
		expect(model.document.itemList[0]!.property.get('Wide')).toBe(true);
	});
});

describe('time zones', () => {
	it('converts wall times between zones, daylight saving included', () => {
		// Nov 4: Toronto is UTC−5, Tokyo UTC+9
		expect(convertMoment(at('2026-11-04 09:00'), 'America/Toronto', 'Asia/Tokyo')).toBe(at('2026-11-04 23:00'));
		// Jul 1: Toronto is UTC−4
		expect(convertMoment(at('2026-07-01 09:00'), 'America/Toronto', 'UTC')).toBe(at('2026-07-01 13:00'));
		expect(zoneLabel('Asia/Tokyo')).toBe('UTC+9');
		expect(zoneLabel('UTC+5:30')).toBe('UTC+5:30');
		expect(convertMoment(at('2026-11-04 09:00'), 'UTC−5', 'UTC+5:30')).toBe(at('2026-11-04 19:30'));
	});

	it('shows timed events in the zone chosen; all-day ones stay on their day', () => {
		const model = NoteModel.fromText('Calendar:\n\tEvent {Start: 2026-11-04 09:00, End: 10:00}: Class\n\tEvent {Start: 2026-11-04 20:00, TimeZone: Asia/Tokyo}: Call\n\tEvent {Start: 2026-11-05}: Holiday\n');
		const eventList = blockEventList(model.document.itemList[0]!);
		const list = occurrenceList(eventList, day('2026-11-01'), day('2026-11-08'), { home: 'America/Toronto', display: 'UTC' });
		const byName = Object.fromEntries(list.map((item) => [item.event.title, `${dayText(Math.floor(item.start / 1440))} ${String(Math.floor((item.start % 1440) / 60)).padStart(2, '0')}`]));
		expect(byName).toEqual({ Class: '2026-11-04 14', Call: '2026-11-04 11', Holiday: '2026-11-05 00' });
	});
});

describe('daylight saving', () => {
	it('keeps a place’s clock across the switch: 09:00 in New York is 14:00 UTC in winter, 13:00 in summer', () => {
		expect(convertMoment(at('2026-01-15 09:00'), 'America/New_York', 'UTC')).toBe(at('2026-01-15 14:00'));
		expect(convertMoment(at('2026-07-15 09:00'), 'America/New_York', 'UTC')).toBe(at('2026-07-15 13:00'));
		// a fixed offset doesn't move
		expect(convertMoment(at('2026-07-15 09:00'), 'UTC−5', 'UTC')).toBe(at('2026-07-15 14:00'));
		expect(zoneLabel('America/New_York', Date.parse('2026-07-15T12:00:00Z') / 60_000)).toBe('UTC−4');
	});
});
