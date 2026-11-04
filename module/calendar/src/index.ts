// Calendar module: a Calendar block shows events in Month, Week, Day, and Agenda views. Its Event
// blocks hold the events (each can hold anything: notes, a checklist), and it can also show notes
// of the vault by their Start (or Date) and rows of a table by their date. Events repeat (every day,
// week on some days, month, year; until a day, or a number of times) and skip days (breaks).
// Making, moving, resizing, and copying events happens on the calendar itself. The view loads the
// first time a calendar shows.
//
//   Calendar {Show: Week, Source: tag:Class, Data: Gym log}:
//   	Event {Start: 2026-09-02 09:00, End: 10:30, Repeat: {Every: Week, On: [Mon, Wed], Until: 2026-12-15}, Skip: [2026-11-23..2026-11-29]}: Linear Algebra
//   		Room 204

import { type BlockTypeDefinition, type ModuleDefinition, escapeHtml, lazyRenderer } from '@octaether/core-sdk';
import { calendarCommandList } from './command';
import { eventOf } from './event';
import { clockText, dayOfMoment, minutePerDay, monthShortName, partOf, repeatTitle, weekdayName, weekdayOf } from './time';

export { blockEventList, eventOf, eventSource, occurrenceList, splitFollowing, splitThis } from './event';
export { durationOf, durationText, momentOf, repeatDayList, repeatOf, skipOf } from './time';

const calendarStyleOwn = `
.oi-event-card { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, var(--oi-calendar-color, var(--oi-color-accent)) 12%, var(--oi-color-background)); border-left: 3px solid var(--oi-calendar-color, var(--oi-color-accent)); }
.oi-event-card-name { font-weight: 600; }
.oi-event-card-when, .oi-event-card-repeat { color: var(--oi-color-text-muted); font-size: 0.9em; }
@media (max-width: 640px) {
	.oi-calendar-cell { min-height: 64px; }
	.oi-calendar-cell .oi-calendar-time { display: none; }
	.oi-calendar-agenda-day { grid-template-columns: 5em 1fr; }
	.oi-calendar-popover { left: 8px !important; right: 8px; width: auto; top: auto !important; bottom: 8px; }
}
`;

/** An Event outside a Calendar: a card saying when it is. */
function eventCardHtml(block: { property: Map<string, unknown>; body: string }, resolveColor: (value: string) => string | undefined): string {
	const event = eventOf(block.property as never, { id: 'Card', kind: 'Block', title: block.body.trim() });
	const name = `<span class="oi-event-card-name" data-oi-s="0">${escapeHtml(block.body.trim() || 'Untitled')}</span>`;
	if (!event) return `<div class="oi-event-card">${name}<span class="oi-event-card-when" data-oi-problem>needs a Start (2026-11-04 09:00)</span></div>`;
	const day = dayOfMoment(event.start);
	const { year, month, date } = partOf(day);
	let when = `${weekdayName[weekdayOf(day)]}, ${monthShortName[month]} ${date}, ${year}`;
	if (!event.allDay) when += ` · ${clockText(event.start - day * minutePerDay)}–${clockText((event.start + event.duration - day * minutePerDay) % minutePerDay)}`;
	else if (event.duration > minutePerDay) {
		const last = partOf(day + event.duration / minutePerDay - 1);
		when += ` – ${monthShortName[last.month]} ${last.date}`;
	}
	const color = event.color ? (resolveColor(event.color) ?? '') : '';
	return (
		`<div class="oi-event-card"${color ? ` style="--oi-calendar-color:${escapeHtml(color)}"` : ''}>${name}<span class="oi-event-card-when">${escapeHtml(when)}</span>` +
		(event.repeat ? `<span class="oi-event-card-repeat">${escapeHtml(repeatTitle(event.repeat, day))}</span>` : '') +
		(event.place ? `<span class="oi-event-card-when">${escapeHtml(event.place)}</span>` : '') +
		`</div>`
	);
}

const calendarType: BlockTypeDefinition = {
	name: 'Calendar',
	content: 'Item',
	render: lazyRenderer(() => import('./view').then((module) => module.calendarRenderer)),
	edit: { kind: 'Structured' },
	fillPage: true,
	// its Event blocks are drawn by the calendar; anything else inside shows below it
	layout: {
		coordinate: 'Flow',
		childPropertyList: [],
		arrange(_area, _container, childList) {
			for (const child of childList) child.element.hidden = child.type === 'Event';
		},
	},
	style: calendarStyleOwn,
	templateList: [
		{ title: 'Calendar', icon: '▦', source: 'Calendar:', keywordList: ['calendar', 'month', 'schedule', 'event', 'date', 'planner'], explain: 'Events by month, week, or day' },
		{
			title: 'Class schedule',
			icon: '▦',
			source:
				'Calendar {Show: Week}:\n\tEvent {Start: 2026-09-02 09:00, End: 10:30, Repeat: {Every: Week, On: [Mon, Wed], Until: 2026-12-15}, Skip: [2026-11-23..2026-11-29]}: Linear Algebra\n\t\tRoom 204\n\tEvent {Start: 2026-09-03 13:00, Duration: 2h, Repeat: {Every: Week, Until: 2026-12-15}, Skip: [2026-11-23..2026-11-29]}: Chemistry lab',
			keywordList: ['class', 'school', 'timetable', 'schedule', 'course', 'semester', 'repeat'],
			explain: 'Classes that repeat every week, with a break',
		},
		{ title: 'Week planner', icon: '▦', source: 'Calendar {Show: Week}:', keywordList: ['week', 'planner', 'time', 'schedule'], explain: 'A week by the hour' },
		{ title: 'Event', icon: '◷', source: 'Event {Start: 2026-11-04 09:00, End: 10:00}:', keywordList: ['event', 'meeting', 'appointment'], explain: 'One event, on its own' },
	],
	plainText: (block) => block.body,
};

const eventType: BlockTypeDefinition = {
	name: 'Event',
	content: 'Item',
	render: {
		mount(frame, block, context) {
			frame.innerHTML = eventCardHtml(block, context.resolveColor);
			return {
				update(next, nextContext) {
					frame.innerHTML = eventCardHtml(next, nextContext.resolveColor);
					return 'Done';
				},
			};
		},
	},
	plainText: (block) => block.body,
};

export const calendarModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Calendar',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Calendar',
	explain:
		'Calendars with Month, Week, Day, and Agenda views. Click or drag to make an event, drag to move, its edge to resize, Alt + drag to copy. Events repeat (on some weekdays, until a day) and skip days for breaks; one can move by itself or with the ones after it. Events live in the calendar, or as notes of their own (Start in their properties), and tables with dates show too.',
	use: ['NoteIndex', 'TableData', 'Menu', 'Hotkey'],
	settingList: [
		{ id: 'Calendar.WeekStart', title: 'Week starts on', type: 'Choice', choiceList: ['Monday', 'Sunday'], default: 'Monday', explain: 'The first day of each week in the Week and Month views.' },
		{ id: 'Calendar.Snap', title: 'Snap to', type: 'Choice', choiceList: ['5m', '10m', '15m', '30m', '1h'], default: '15m', explain: 'Dragging an event moves it by this much.' },
		{ id: 'Calendar.Duration', title: 'New event length', type: 'Choice', choiceList: ['15m', '30m', '45m', '1h', '1h30m', '2h'], default: '1h', explain: 'How long an event made with a click is.' },
	],
	blockTypeList: [calendarType, eventType],
	activate(host) {
		const cleanupList = calendarCommandList.map((command) =>
			host.registerCommand({
				id: `Calendar.${command.action}`,
				title: `Calendar: ${command.title}`,
				key: command.key,
				when: 'Calendar',
				run: () => void import('./view').then((module) => module.runCalendarCommand(command.action)),
			}),
		);
		return () => {
			for (const cleanup of cleanupList) cleanup();
		};
	},
};
