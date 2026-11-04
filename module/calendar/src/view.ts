// The Calendar block on the page: Month, Week, Day, and Agenda. Loaded the first time one shows.
//
//   make     click an empty time (or day), or drag across times, then type a name and press Enter
//   change   click an event to edit it; drag it to move, drag its bottom edge to resize, Alt + drag
//            to copy (same name, no "(1)"); right click for more (Duplicate, Skip this day, …)
//   repeats  moving or changing one asks: this event, this and following, or all
//   keys     T today, D W M A views, J K next and previous, C new; with an event picked: ← → a day,
//            ↑ ↓ the snap, Ctrl+D copy, Ctrl+C then Ctrl+V over a day, Delete (Setting → Hotkey)

import { type BlockNode, type PropertyMap, type PropertyValue, formatInline, serializeNode } from '@octaether/core-format';
import type { NoteModel } from '@octaether/core-model';
import {
	type HotkeyLookup,
	type LinkedBlock,
	type MenuEntry,
	type NoteIndex,
	type NoteSummary,
	type PopupMenu,
	type RenderContext,
	type Renderer,
	type ResolvedBlock,
	type TableData,
	type TableSnapshot,
	escapeHtml,
	hotkeyExtension,
	linkedBlock,
	linkedProperty,
	menuExtension,
	noteIndexExtension,
	tableDataExtension, installStyle } from '@octaether/core-sdk';
import {
	type CalendarEvent,
	type Occurrence,
	blockEventList,
	duplicateAt,
	eventProperty,
	eventSource,
	insertEvent,
	noteEventList,
	occurrenceList,
	splitFollowing,
	splitThis,
	tableEventList,
	timingProperty,
	writeBlockEvent,
} from './event';
import { calendarCommandList } from './command';
import {
	type Frequency,
	type Repeat,
	clockOf,
	clockText,
	convertMoment,
	dayFromPart,
	dayOf,
	dayOfMoment,
	dayText,
	durationOf,
	durationText,
	isZone,
	localZone,
	minutePerDay,
	monthName,
	monthShortName,
	nowIn,
	partOf,
	repeatTitle,
	weekdayLongName,
	weekdayName,
	weekdayOf,
	zoneCity,
	zoneLabel,
	zoneList,
	zoneOffset,
} from './time';
import { calendarStyle } from './style';

export type Show = 'Day' | 'Week' | 'Month' | 'Agenda';
export const showList: readonly Show[] = ['Day', 'Week', 'Month', 'Agenda'];

export { calendarCommandList } from './command';

const hourHeight = 44;
const colorList = ['Accent', '#c0643c', '#3d8a7a', '#7a8a35', '#b5546a', '#8a5a3c', '#5f8a5f', '#a08a5a'];
const kindColor: Readonly<Record<string, string>> = { Block: 'Accent', Note: '#3d8a7a', Table: '#7a8a35' };

/** The event you copied (Ctrl+C), for any calendar. */
let copied: CalendarEvent | undefined;
/** The calendar your keys go to (the one last used). */
let activeView: CalendarView | undefined;

export function runCalendarCommand(action: string): void {
	activeView?.command(action);
}

const svg = (body: string, size = 14): string =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const moreMark = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>';
const leftMark = svg('<path d="m15 6-6 6 6 6"/>');
const rightMark = svg('<path d="m9 6 6 6-6 6"/>');
const plusMark = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const crossMark = '<svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const repeatMark = svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>', 11);
const noteMark = svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 11);

const textOf = (value: PropertyValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

/** Notes a Source names: a folder (`Class`, `Class/`), a tag (`tag:Exam`), or `/` for all. */
export function sourceNote(sourceList: readonly string[], noteList: readonly NoteSummary[], except?: string): NoteSummary[] {
	if (sourceList.length === 0) return [];
	return noteList.filter((note) => {
		if (note.path === except) return false;
		return sourceList.some((part) => {
			const tag = /^tag:\s*#?(.+)$/i.exec(part);
			if (tag) return note.tagList.some((item) => item.toLowerCase() === tag[1]!.trim().toLowerCase());
			const folder = part.replace(/^\/+|\/+$/g, '');
			return folder === '' ? part.trim() === '/' : note.folder === folder || note.folder.startsWith(`${folder}/`);
		});
	});
}

/** Overlapping events in a day sit side by side: each gets a column and the count beside it. */
export function placeSideBySide<T extends { start: number; end: number }>(list: readonly T[]): Map<T, { column: number; count: number }> {
	const result = new Map<T, { column: number; count: number }>();
	const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
	let cluster: T[] = [];
	let clusterEnd = Number.NEGATIVE_INFINITY;
	const columnEnd: number[] = [];
	const flush = (): void => {
		const count = Math.max(1, columnEnd.length);
		for (const item of cluster) result.get(item)!.count = count;
		cluster = [];
		columnEnd.length = 0;
	};
	for (const item of sorted) {
		if (item.start >= clusterEnd) {
			flush();
			clusterEnd = Number.NEGATIVE_INFINITY;
		}
		let column = columnEnd.findIndex((end) => end <= item.start);
		if (column < 0) column = columnEnd.push(item.end) - 1;
		else columnEnd[column] = item.end;
		result.set(item, { column, count: 1 });
		cluster.push(item);
		clusterEnd = Math.max(clusterEnd, item.end);
	}
	flush();
	return result;
}

interface Press {
	kind: 'Move' | 'Resize' | 'Create' | 'CreateDay';
	pointerId: number;
	x: number;
	y: number;
	occurrence?: Occurrence;
	copy: boolean;
	day: number;
	minute: number | undefined;
	moved: boolean;
}

interface Preview {
	key: string | undefined;
	start: number;
	end: number;
	allDay: boolean;
	copy: boolean;
}

interface Draft {
	event: CalendarEvent;
	/** The occurrence being edited (undefined: a new event). */
	occurrence?: Occurrence;
}

class CalendarView {
	readonly root: HTMLElement;
	private show: Show;
	private anchor: number;
	private selected: string | undefined;
	private hover: { day: number; minute: number | undefined } | undefined;
	private eventList: CalendarEvent[] = [];
	private occurrenceMap = new Map<string, Occurrence>();
	private press: Press | undefined;
	private preview: Preview | undefined;
	private popover: HTMLElement | undefined;
	private draft: Draft | undefined;
	private message = '';
	private readonly snapshotMap = new Map<string, TableSnapshot | undefined>();
	private readonly watchMap = new Map<string, () => void>();
	private unsubscribeIndex: (() => void) | undefined;
	/** With From: the Calendar in another note that holds the events (its note's live model). */
	private linked: LinkedBlock | undefined;
	private linkedFrom: string | undefined;
	private linkState: 'Loading' | 'Ready' | 'Missing' = 'Ready';
	private unsubscribeLinked: (() => void) | undefined;
	/** When a click outside last closed the popover (that click doesn't also make an event). */
	private closedAt = 0;
	private readonly onOutside = (event: PointerEvent): void => {
		const target = event.target as Node;
		if (this.popover && !this.popover.contains(target) && !(target instanceof Element && target.closest('.menu'))) {
			this.closedAt = performance.now();
			this.closePopover();
		}
	};

	constructor(
		readonly frame: HTMLElement,
		private block: ResolvedBlock,
		private context: RenderContext,
	) {
		this.root = document.createElement('div');
		this.root.className = 'oi-calendar';
		this.root.dataset.oiInteractive = '';
		this.root.tabIndex = 0;
		frame.append(this.root);
		const showText = textOf(block.property.get('Show'));
		this.show = showList.find((item) => item === showText) ?? 'Month';
		this.anchor = dayOf(textOf(block.property.get('Date')) ?? '') ?? dayOfMoment(this.now());
		this.bind();
		document.addEventListener('pointerdown', this.onOutside, true);
		this.unsubscribeIndex = this.index()?.subscribe(() => {
			if (this.from()) this.relink();
			else this.render();
		});
		this.render();
	}

	update(block: ResolvedBlock, context: RenderContext): void {
		const before = textOf(this.property().get('Show'));
		this.block = block;
		this.context = context;
		const showText = textOf(this.property().get('Show'));
		if (showText !== before) this.show = showList.find((item) => item === showText) ?? this.show;
		this.render();
	}

	destroy(): void {
		if (activeView === this) activeView = undefined;
		document.removeEventListener('pointerdown', this.onOutside, true);
		this.unsubscribeIndex?.();
		this.unsubscribeLinked?.();
		for (const cleanup of this.watchMap.values()) cleanup();
		this.closePopover();
		this.root.remove();
	}

	/** `From: "[[Classes]]"`: the events live in that note's Calendar. */
	private from(): string | undefined {
		const value = this.block.property.get('From');
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	}

	private calendarNode(): BlockNode | undefined {
		if (this.from()) return this.linked ? this.linked.model.get(this.linked.key) : undefined;
		return this.block.node;
	}

	private calendarKey(): string {
		return this.linked && this.from() ? this.linked.key : this.block.key;
	}

	/** The note the events are in (this one, or the one From names). */
	private noteModel(): NoteModel {
		return this.from() && this.linked ? this.linked.model : this.context.note;
	}

	/** Its properties: its own, or the shown Calendar's with its own on top. */
	private property(): PropertyMap {
		const node = this.from() ? this.calendarNode() : undefined;
		return node ? linkedProperty(this.block.property, node.property) : this.block.property;
	}

	/** A property goes where it is written: on this block when it says it, otherwise on the Calendar it shows. */
	private setProperty(name: string, value: PropertyValue | undefined): void {
		if (this.from() && this.linked && !this.block.property.has(name)) this.linked.model.setProperty(this.linked.key, name, value);
		else this.context.setProperty(name, value);
	}

	/** Finds the Calendar that From names again (the note may have opened in a tab, or changed). */
	private relink(): void {
		const from = this.from();
		this.linkedFrom = from;
		if (!from) {
			this.unsubscribeLinked?.();
			this.unsubscribeLinked = undefined;
			this.linked = undefined;
			this.linkState = 'Ready';
			this.render();
			return;
		}
		if (!this.linked) this.linkState = 'Loading';
		void linkedBlock(this.context, from, 'Calendar').then((linked) => {
			if (this.linkedFrom !== from) return;
			if (linked?.model !== this.linked?.model || linked?.key !== this.linked?.key) {
				this.unsubscribeLinked?.();
				this.unsubscribeLinked = linked?.model.subscribe(() => this.render());
			}
			const first = !this.linked;
			this.linked = linked;
			this.linkState = linked ? 'Ready' : 'Missing';
			// the view it opens with is the shown calendar's (unless this block says its own)
			if (first && linked) this.show = showList.find((item) => item === textOf(this.property().get('Show'))) ?? this.show;
			this.render();
		});
	}

	/** The calendar becomes a note of its own; here, a Calendar that shows it (From) stays. */
	private async moveOut(name: string): Promise<void> {
		const index = this.index();
		const clean = name.trim();
		if (!index || !clean) return;
		const here = index.pathOf(this.context.note) ?? '';
		const folder = here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : '';
		// Full width is how this note shows it: it stays here (a note of its own is full width anyway)
		const property = new Map(this.block.property);
		const wide = property.get('Wide') === true;
		property.delete('Wide');
		const path = await index.createNote({ folder, name: clean, property: new Map(), body: calendarSource(this.block.node, property) });
		if (path) this.context.replaceWith(`Calendar {From: "[[${path.replace(/\.oi$/, '')}]]"${wide ? ', Wide: True' : ''}}:`);
	}

	/** The Calendar From shows comes into this note, events and all; its note goes to the trash (with Undo, if you agree). */
	private bringIn(): void {
		const node = this.calendarNode();
		const linked = this.linked;
		if (!node || !linked) return;
		this.context.replaceWith(calendarSource(node, linkedProperty(this.block.property, node.property)));
		void this.index()?.trashNote(linked.path);
	}

	private moreMenu(point: { x: number; y: number }): void {
		const index = this.index();
		const itemList: MenuEntry[] = [];
		const wide = this.block.property.get('Wide') === true;
		if (!this.readOnly()) itemList.push({ title: 'Full width', checked: wide, explain: 'Wider than the text around it', run: () => this.context.setProperty('Wide', wide ? undefined : true) });
		if (this.linked && this.from()) {
			itemList.push({ title: 'Open its note', explain: this.linked.path.replace(/\.oi$/, ''), separatorBefore: true, run: () => index?.open(this.linked!.path) });
			if (!this.readOnly()) itemList.push({ title: 'Bring into this note', explain: 'Its note goes to the trash', run: () => this.bringIn() });
		} else if (index && !this.readOnly())
			itemList.push({
				title: 'Move to its own note',
				explain: 'This note then shows it from there',
				separatorBefore: true,
				run: () => void this.menu()?.prompt('Name of the new note', 'Calendar', 'Move').then((name) => {
					if (name) void this.moveOut(name);
				}),
			});
		this.menu()?.open({ x: point.x, y: point.y, itemList });
	}

	/** The zone shown, chosen in the bar (undefined: the calendar's own). */
	private displayZone: string | undefined;

	/** The calendar's own zone: its TimeZone, or this device's. Events without a zone are in it. */
	private homeZone(): string {
		const zone = textOf(this.property().get('TimeZone'))?.trim();
		return zone && isZone(zone) ? zone : localZone();
	}

	private zone(): string {
		return this.displayZone ?? this.homeZone();
	}

	private now(): number {
		return nowIn(this.zone());
	}

	/** A wall time shown (in the zone on screen) as the event's own (in its zone). */
	private toEventZone(event: CalendarEvent, moment: number): number {
		return event.allDay ? moment : convertMoment(moment, this.zone(), event.timeZone ?? this.homeZone());
	}

	private zoneMenu(point: { x: number; y: number }): void {
		const home = this.homeZone();
		const shown = this.zone();
		const local = localZone();
		const pick = (zone: string): void => {
			this.displayZone = zone === home ? undefined : zone;
			this.render();
		};
		const itemList: MenuEntry[] = [
			{ title: `This calendar's (${zoneLabel(home)})`, checked: shown === home, run: () => pick(home) },
		];
		if (local !== home) itemList.push({ title: `This device's (${zoneLabel(local)})`, checked: shown === local, run: () => pick(local) });
		if (!this.readOnly() && shown !== home)
			itemList.push({ title: `Make ${zoneLabel(shown)} the calendar's own`, explain: 'Events without a time zone are in it', run: () => this.setProperty('TimeZone', shown === localZone() ? undefined : shown) });
		// places, by their offset now (daylight saving follows them), with their cities (searched too)
		const now = Date.now() / 60_000;
		const placeList = [...zoneList].sort((left, right) => zoneOffset(left.zone, now) - zoneOffset(right.zone, now));
		itemList.push(
			...placeList.map((entry, index) => ({
				title: zoneLabel(entry.zone, now),
				explain: entry.city,
				keywordList: [...entry.city.split(/,\s*/), entry.zone],
				checked: entry.zone === shown,
				separatorBefore: index === 0,
				run: () => pick(entry.zone),
			})),
		);
		this.menu()?.open({ x: point.x, y: point.y, itemList, search: true });
	}

	private index(): NoteIndex | undefined {
		return this.context.extension<NoteIndex>(noteIndexExtension);
	}

	private menu(): PopupMenu | undefined {
		return this.context.extension<PopupMenu>(menuExtension);
	}

	private readOnly(): boolean {
		return this.context.readOnly();
	}

	private snap(): number {
		const value = this.context.setting('Calendar.Snap');
		const minute = typeof value === 'string' ? durationOf(value) : typeof value === 'number' ? value : undefined;
		return minute && minute > 0 ? minute : 15;
	}

	private defaultDuration(): number {
		return durationOf(textOf(this.context.setting('Calendar.Duration') as PropertyValue) ?? '1h') ?? 60;
	}

	private weekStart(): number {
		return this.context.setting('Calendar.WeekStart') === 'Sunday' ? 6 : 0;
	}

	/** The first day of the week a day is in. */
	private weekOf(day: number): number {
		return day - ((weekdayOf(day) - this.weekStart() + 7) % 7);
	}

	// ------------------------------------------------------------ events

	private sourceList(): string[] {
		const source = this.property().get('Source');
		const list = (Array.isArray(source) ? source : source === undefined || source === null ? [] : [source]).map(String);
		const folder = textOf(this.property().get('Folder'));
		if (folder) list.push(folder);
		return list;
	}

	private gather(): void {
		const list = blockEventList(this.calendarNode() ?? this.block.node);
		const index = this.index();
		const sourceList = this.sourceList();
		const noteSourceList = sourceList;
		if (index && noteSourceList.length) {
			const dateKey = textOf(this.property().get('DateProperty')) ?? 'Start';
			list.push(...noteEventList(sourceNote(noteSourceList, index.noteList(), index.pathOf(this.context.note)), dateKey));
		}
		// tables by their titles (Data: Gym log), on their first date column
		const dataValue = this.property().get('Data');
		const tableList = (Array.isArray(dataValue) ? dataValue : dataValue === undefined || dataValue === null ? [] : [dataValue]).map(String).filter((item) => item.trim() !== '');
		this.watchTable(tableList);
		for (const reference of tableList) {
			const snapshot = this.snapshotMap.get(reference);
			if (snapshot) list.push(...tableEventList(reference, snapshot));
		}
		this.eventList = list;
	}

	private watchTable(referenceList: readonly string[]): void {
		const data = this.context.extension<TableData>(tableDataExtension);
		for (const [reference, cleanup] of this.watchMap) {
			if (referenceList.includes(reference)) continue;
			cleanup();
			this.watchMap.delete(reference);
			this.snapshotMap.delete(reference);
		}
		if (!data) return;
		for (const reference of referenceList) {
			if (this.watchMap.has(reference)) continue;
			const read = (): void => {
				void data.read(this.context, reference).then((snapshot) => {
					this.snapshotMap.set(reference, snapshot);
					this.render();
				});
			};
			this.watchMap.set(reference, data.watch(this.context, reference, read));
			read();
		}
	}

	private colorOf(event: CalendarEvent): string {
		const color = event.color ?? kindColor[event.kind]!;
		return this.context.resolveColor(color) ?? color;
	}

	// ------------------------------------------------------------ drawing

	private narrow(): boolean {
		const width = this.root.clientWidth || this.frame.clientWidth;
		return width > 0 && width < 560;
	}

	/** The days on screen. */
	private range(): { from: number; to: number } {
		switch (this.show) {
			case 'Day':
				return { from: this.anchor, to: this.anchor };
			case 'Week':
				return this.narrow() ? { from: this.anchor, to: this.anchor + 2 } : { from: this.weekOf(this.anchor), to: this.weekOf(this.anchor) + 6 };
			case 'Month': {
				const { year, month } = partOf(this.anchor);
				const first = dayFromPart(year, month, 1);
				const last = dayFromPart(year, month + 1, 0);
				const from = this.weekOf(first);
				return { from, to: this.weekOf(last) + 6 };
			}
			case 'Agenda':
				return { from: this.anchor, to: this.anchor + 29 };
		}
	}

	private title(): string {
		const { from, to } = this.range();
		const a = partOf(from);
		const b = partOf(to);
		switch (this.show) {
			case 'Day':
				return `${weekdayLongName[weekdayOf(from)]}, ${monthName[a.month]} ${a.date}, ${a.year}`;
			case 'Month': {
				const anchor = partOf(this.anchor);
				return `${monthName[anchor.month]} ${anchor.year}`;
			}
			default:
				if (a.year !== b.year) return `${monthShortName[a.month]} ${a.date}, ${a.year} – ${monthShortName[b.month]} ${b.date}, ${b.year}`;
				if (a.month !== b.month) return `${monthShortName[a.month]} ${a.date} – ${monthShortName[b.month]} ${b.date}, ${b.year}`;
				return `${monthName[a.month]} ${a.date} – ${b.date}, ${b.year}`;
		}
	}

	private render(): void {
		if (this.from() !== this.linkedFrom) this.relink();
		if (this.from() && this.linkState !== 'Ready') {
			this.root.innerHTML =
				this.linkState === 'Loading'
					? '<p class="oi-calendar-empty">Loading the calendar…</p>'
					: `<p class="oi-calendar-empty" data-oi-problem>No calendar in ${escapeHtml(this.from()!)}: the note may have been renamed or moved, or holds no Calendar.</p>`;
			return;
		}
		this.gather();
		const { from, to } = this.range();
		const list = occurrenceList(this.eventList, from, to, { home: this.homeZone(), display: this.zone() });
		// the event being dragged shows where it would go
		const preview = this.preview;
		let shown = list;
		if (preview) {
			const original = preview.key ? list.find((item) => item.key === preview.key) : undefined;
			const ghost: Occurrence | undefined = original
				? { ...original, start: preview.start, end: preview.end, key: `${original.key}#preview`, event: { ...original.event, allDay: preview.allDay } }
				: preview.key === undefined
					? { key: 'draft#preview', start: preview.start, end: preview.end, event: this.draftEvent(preview.start, preview.end, preview.allDay) }
					: undefined;
			shown = ghost ? [...(preview.copy || !original ? list : list.filter((item) => item !== original)), ghost] : list;
		}
		if (this.draft && !this.draft.occurrence && !preview) shown = [...list, { key: 'draft#preview', start: this.draft.event.start, end: this.draft.event.start + this.draft.event.duration, event: this.draft.event }];
		this.occurrenceMap = new Map(list.map((item) => [item.key, item]));
		const readOnly = this.readOnly();
		const toolbar =
			`<div class="oi-calendar-bar">` +
			`<button type="button" class="oi-calendar-button" data-action="Today">Today</button>` +
			`<button type="button" class="oi-calendar-icon" data-action="Previous" aria-label="Previous">${leftMark}</button>` +
			`<button type="button" class="oi-calendar-icon" data-action="Next" aria-label="Next">${rightMark}</button>` +
			`<span class="oi-calendar-title">${escapeHtml(this.title())}</span>` +
			`<span class="oi-calendar-space"></span>` +
			`<div class="oi-calendar-segment-row" role="group" aria-label="View">${showList.map((item) => `<button type="button" class="oi-calendar-segment${item === this.show ? ' active' : ''}" data-action="Show" data-show="${item}" aria-pressed="${item === this.show}">${item}</button>`).join('')}</div>` +
			`<button type="button" class="oi-calendar-button oi-calendar-zone${this.displayZone ? ' active' : ''}" data-action="Zone" title="${escapeHtml(zoneCity(this.zone()) ?? this.zone())}">${escapeHtml(zoneLabel(this.zone()))}</button>` +
			(readOnly ? '' : `<button type="button" class="oi-calendar-button primary" data-action="New">${plusMark}<span>New</span></button>`) +
			`<button type="button" class="oi-calendar-icon" data-action="More" aria-label="More">${moreMark}</button>` +
			`</div>`;
		let body: string;
		switch (this.show) {
			case 'Month':
				body = this.monthHtml(from, to, shown);
				break;
			case 'Agenda':
				body = this.agendaHtml(from, to, shown);
				break;
			default:
				body = this.timeGridHtml(from, to, shown);
		}
		const status = this.message ? `<div class="oi-calendar-message" role="status">${escapeHtml(this.message)}</div>` : '';
		this.root.innerHTML = toolbar + body + status;
		this.root.dataset.show = this.show;
		if (this.show === 'Week' || this.show === 'Day') this.scrollToHour();
	}

	private scrolled = '';
	/** The grid opens at the first busy hour (or 8:00), once per view. */
	private scrollToHour(): void {
		const key = `${this.show}|${this.range().from}`;
		if (this.scrolled === key) {
			const scroller = this.root.querySelector<HTMLElement>('.oi-calendar-scroll');
			if (scroller) scroller.scrollTop = this.scrollTop;
			return;
		}
		this.scrolled = key;
		const scroller = this.root.querySelector<HTMLElement>('.oi-calendar-scroll');
		if (!scroller) return;
		const hour = this.property().get('Hour');
		const first = Array.isArray(hour) && typeof hour[0] === 'number' ? hour[0] : 8;
		scroller.scrollTop = first * hourHeight;
		this.scrollTop = scroller.scrollTop;
	}
	private scrollTop = 0;

	private eventHtml(occurrence: Occurrence, style: string, compact: boolean, showTime: boolean): string {
		const { event } = occurrence;
		const preview = occurrence.key.endsWith('#preview');
		const selected = this.selected === occurrence.key;
		const time = !event.allDay && showTime ? `<span class="oi-calendar-time">${clockText(occurrence.start - dayOfMoment(occurrence.start) * minutePerDay)}${compact ? '' : `–${clockText((occurrence.end - dayOfMoment(occurrence.start) * minutePerDay) % minutePerDay)}`}</span>` : '';
		const mark = (event.repeat ? `<span class="oi-calendar-mark" title="${escapeHtml(repeatTitle(event.repeat, dayOfMoment(event.start)))}">${repeatMark}</span>` : '') + (event.kind === 'Note' ? `<span class="oi-calendar-mark" title="A note">${noteMark}</span>` : '');
		const resize = !compact && !event.readOnly && !this.readOnly() && !event.allDay ? '<span class="oi-calendar-resize" data-resize></span>' : '';
		const place = !compact && event.place ? `<span class="oi-calendar-place">${escapeHtml(event.place)}</span>` : '';
		return (
			`<div class="oi-calendar-event${preview ? ' oi-calendar-preview' : ''}${selected ? ' oi-calendar-selected' : ''}${event.allDay ? ' oi-calendar-allday-event' : ''}" data-occurrence="${escapeHtml(occurrence.key)}" style="--oi-calendar-color:${escapeHtml(this.colorOf(event))};${style}" title="${escapeHtml(event.title || 'Untitled')}">` +
			// a tall event: its name first, then its time and place (as Google Calendar does); a short one in a line
			(compact
				? `<span class="oi-calendar-event-title">${mark}${time}<span class="oi-calendar-name">${escapeHtml(event.title || 'Untitled')}</span></span>`
				: `<span class="oi-calendar-event-title">${mark}<span class="oi-calendar-name">${escapeHtml(event.title || 'Untitled')}</span></span><span class="oi-calendar-sub">${time}${place}</span>`) +
			`${resize}</div>`
		);
	}

	private dayHeadHtml(day: number, today: number): string {
		const { date } = partOf(day);
		return `<div class="oi-calendar-day-head${day === today ? ' oi-calendar-today' : ''}" data-day="${day}" data-action="GoDay"><span class="oi-calendar-weekday">${weekdayName[weekdayOf(day)]}</span><span class="oi-calendar-date">${date}</span></div>`;
	}

	private timeGridHtml(from: number, to: number, list: readonly Occurrence[]): string {
		const dayCount = to - from + 1;
		const today = dayOfMoment(this.now());
		const allDayList = list.filter((item) => item.event.allDay || item.end - item.start >= minutePerDay);
		const timedList = list.filter((item) => !allDayList.includes(item));
		// all-day bars, stacked into rows
		const rowEnd: number[] = [];
		let allDayHtml = '';
		for (const item of allDayList.sort((a, b) => a.start - b.start || b.end - a.end)) {
			const first = Math.max(from, dayOfMoment(item.start));
			const last = Math.min(to, dayOfMoment(item.end - 1));
			let row = rowEnd.findIndex((end) => end < first);
			if (row < 0) row = rowEnd.push(last) - 1;
			else rowEnd[row] = last;
			allDayHtml += this.eventHtml(item, `grid-column:${first - from + 1} / ${last - from + 2};grid-row:${row + 1};`, true, false);
		}
		const allDayCells = Array.from({ length: dayCount }, (_, index) => `<div class="oi-calendar-allday-cell" data-day="${from + index}" style="grid-column:${index + 1};grid-row:1 / ${Math.max(2, rowEnd.length + 2)}"></div>`).join('');
		// timed events, each day on its own (one running past midnight shows in both days)
		let columnHtml = '';
		for (let index = 0; index < dayCount; index++) {
			const day = from + index;
			const dayStart = day * minutePerDay;
			const pieceList = timedList
				.filter((item) => item.start < dayStart + minutePerDay && item.end > dayStart)
				.map((item) => ({ item, start: Math.max(item.start, dayStart), end: Math.min(item.end, dayStart + minutePerDay) }));
			const place = placeSideBySide(pieceList);
			let eventHtml = '';
			for (const piece of pieceList) {
				const { column, count } = place.get(piece)!;
				const top = ((piece.start - dayStart) / 60) * hourHeight;
				const height = Math.max(18, ((piece.end - piece.start) / 60) * hourHeight - 2);
				const compact = height < 34;
				eventHtml += this.eventHtml(piece.item, `top:${top}px;height:${height}px;left:calc(${(column / count) * 100}% + 1px);width:calc(${100 / count}% - 3px);`, compact, true);
			}
			const now = this.now();
			const nowLine = day === today ? `<div class="oi-calendar-now" style="top:${((now - dayStart) / 60) * hourHeight}px"></div>` : '';
			columnHtml += `<div class="oi-calendar-column${day === today ? ' oi-calendar-today' : ''}" data-day="${day}">${eventHtml}${nowLine}</div>`;
		}
		const hourHtml = Array.from({ length: 24 }, (_, hour) => `<div class="oi-calendar-hour" style="top:${hour * hourHeight}px">${hour === 0 ? '' : clockText(hour * 60)}</div>`).join('');
		const head = Array.from({ length: dayCount }, (_, index) => this.dayHeadHtml(from + index, today)).join('');
		return (
			`<div class="oi-calendar-week" data-oi-own-alt style="--oi-calendar-days:${dayCount};--oi-calendar-hour:${hourHeight}px">` +
			`<div class="oi-calendar-week-head"><div class="oi-calendar-gutter"></div>${head}</div>` +
			`<div class="oi-calendar-allday"><div class="oi-calendar-gutter oi-calendar-allday-label">All day</div><div class="oi-calendar-allday-lane">${allDayCells}${allDayHtml}</div></div>` +
			`<div class="oi-calendar-scroll"><div class="oi-calendar-grid" style="height:${24 * hourHeight}px"><div class="oi-calendar-gutter oi-calendar-hour-list">${hourHtml}</div><div class="oi-calendar-column-list">${columnHtml}</div></div></div>` +
			`</div>`
		);
	}

	private monthHtml(from: number, to: number, list: readonly Occurrence[]): string {
		const today = dayOfMoment(this.now());
		const month = partOf(this.anchor).month;
		const head = Array.from({ length: 7 }, (_, index) => `<div class="oi-calendar-month-weekday">${weekdayName[(index + this.weekStart()) % 7]}</div>`).join('');
		let cellHtml = '';
		const limit = 3;
		for (let day = from; day <= to; day++) {
			const dayStart = day * minutePerDay;
			const dayList = list.filter((item) => item.start < dayStart + minutePerDay && item.end > dayStart);
			const shownList = dayList.slice(0, dayList.length > limit ? limit - 1 : limit);
			const { date, month: cellMonth } = partOf(day);
			const more = dayList.length > shownList.length ? `<button type="button" class="oi-calendar-more" data-action="GoDay" data-day="${day}">+${dayList.length - shownList.length} more</button>` : '';
			cellHtml +=
				`<div class="oi-calendar-cell${cellMonth !== month ? ' oi-calendar-other' : ''}${day === today ? ' oi-calendar-today' : ''}" data-day="${day}">` +
				`<button type="button" class="oi-calendar-cell-date" data-action="GoDay" data-day="${day}">${date === 1 ? `${monthShortName[cellMonth]} 1` : date}</button>` +
				shownList.map((item) => this.eventHtml(item, '', true, true)).join('') +
				more +
				`</div>`;
		}
		return `<div class="oi-calendar-month" data-oi-own-alt><div class="oi-calendar-month-head">${head}</div><div class="oi-calendar-month-grid">${cellHtml}</div></div>`;
	}

	private agendaHtml(from: number, to: number, list: readonly Occurrence[]): string {
		const today = dayOfMoment(this.now());
		let html = '';
		for (let day = from; day <= to; day++) {
			const dayStart = day * minutePerDay;
			const dayList = list.filter((item) => item.start < dayStart + minutePerDay && item.end > dayStart && (dayOfMoment(item.start) === day || day === from || item.event.allDay));
			if (dayList.length === 0) continue;
			const { year, month, date } = partOf(day);
			html +=
				`<div class="oi-calendar-agenda-day${day === today ? ' oi-calendar-today' : ''}" data-day="${day}">` +
				`<button type="button" class="oi-calendar-agenda-date" data-action="GoDay" data-day="${day}"><b>${date}</b><span>${weekdayName[weekdayOf(day)]}, ${monthShortName[month]}${year !== partOf(today).year ? ` ${year}` : ''}</span></button>` +
				`<div class="oi-calendar-agenda-list">${dayList.map((item) => this.eventHtml(item, '', false, true)).join('')}</div></div>`;
		}
		return `<div class="oi-calendar-agenda">${html || `<p class="oi-calendar-empty">Nothing in the next 30 days.</p>`}</div>`;
	}

	// ------------------------------------------------------------ where the pointer is

	/** The day (and, in the time grid, the minute) under a point. */
	private spotAt(x: number, y: number): { day: number; minute: number | undefined } | undefined {
		const element = document.elementFromPoint(x, y);
		const column = element?.closest<HTMLElement>('.oi-calendar-column');
		if (column && this.root.contains(column)) {
			const rect = column.getBoundingClientRect();
			const minute = Math.max(0, Math.min(minutePerDay - 1, ((y - rect.top) / hourHeight) * 60));
			return { day: Number(column.dataset.day), minute };
		}
		// between columns while dragging: the column at this x
		const columnList = [...this.root.querySelectorAll<HTMLElement>('.oi-calendar-column')];
		for (const item of columnList) {
			const rect = item.getBoundingClientRect();
			if (x >= rect.left && x <= rect.right && y >= rect.top - 40 && y <= rect.bottom + 40) return { day: Number(item.dataset.day), minute: Math.max(0, Math.min(minutePerDay - 1, ((y - rect.top) / hourHeight) * 60)) };
		}
		const cell = element?.closest<HTMLElement>('[data-day]');
		if (cell && this.root.contains(cell)) return { day: Number(cell.dataset.day), minute: undefined };
		return undefined;
	}

	private snapMinute(minute: number): number {
		const snap = this.snap();
		return Math.round(minute / snap) * snap;
	}

	// ------------------------------------------------------------ pointer

	private bind(): void {
		const root = this.root;
		root.addEventListener('focusin', () => (activeView = this));
		root.addEventListener('pointerenter', () => (activeView = this));
		root.addEventListener('click', (event) => {
			const action = (event.target as Element).closest<HTMLElement>('[data-action]');
			if (!action || !root.contains(action)) return;
			switch (action.dataset.action) {
				case 'Show':
					this.setShow(action.dataset.show as Show);
					return;
				case 'Zone': {
					const rect = action.getBoundingClientRect();
					this.zoneMenu({ x: rect.left, y: rect.bottom + 2 });
					return;
				}
				case 'More': {
					const rect = action.getBoundingClientRect();
					this.moreMenu({ x: rect.left, y: rect.bottom + 2 });
					return;
				}
				case 'GoDay':
					if (this.press?.moved) return;
					this.anchor = Number(action.dataset.day);
					this.setShow('Day');
					return;
				default:
					this.command(action.dataset.action!);
			}
		});
		root.addEventListener('pointerdown', (event) => {
			activeView = this;
			if (event.button !== 0 || (event.target as Element).closest('button')) return;
			const target = event.target as Element;
			const chip = target.closest<HTMLElement>('.oi-calendar-event[data-occurrence]');
			const spot = this.spotAt(event.clientX, event.clientY);
			if (chip) {
				const occurrence = this.occurrenceMap.get(chip.dataset.occurrence!);
				if (!occurrence) return;
				this.press = { kind: target.closest('[data-resize]') ? 'Resize' : 'Move', pointerId: event.pointerId, x: event.clientX, y: event.clientY, occurrence, copy: event.altKey, day: spot?.day ?? dayOfMoment(occurrence.start), minute: spot?.minute, moved: false };
			} else if (spot && !this.readOnly()) {
				this.press = { kind: spot.minute === undefined ? 'CreateDay' : 'Create', pointerId: event.pointerId, x: event.clientX, y: event.clientY, copy: false, day: spot.day, minute: spot.minute, moved: false };
			} else return;
			root.setPointerCapture(event.pointerId);
			const scroller = root.querySelector<HTMLElement>('.oi-calendar-scroll');
			if (scroller) this.scrollTop = scroller.scrollTop;
			event.preventDefault();
			root.focus({ preventScroll: true });
		});
		root.addEventListener('pointermove', (event) => {
			const spot = this.spotAt(event.clientX, event.clientY);
			if (spot) this.hover = spot;
			const press = this.press;
			if (!press || event.pointerId !== press.pointerId) return;
			if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
			if (!spot) return;
			if (!press.moved && press.occurrence && (press.occurrence.event.readOnly || this.readOnly())) return;
			press.moved = true;
			this.dragTo(press, spot);
		});
		const end = (event: PointerEvent): void => {
			const press = this.press;
			if (!press || event.pointerId !== press.pointerId) return;
			this.press = undefined;
			const preview = this.preview;
			this.preview = undefined;
			if (event.type === 'pointercancel') {
				this.render();
				return;
			}
			if (!press.moved) {
				this.clickAt(press, event);
				return;
			}
			if (press.occurrence && preview) {
				this.moveOccurrence(press.occurrence, preview.start, preview.end, press.copy, { x: event.clientX, y: event.clientY });
				return;
			}
			if (preview) {
				this.openPopover(this.draftEvent(preview.start, preview.end, preview.allDay), undefined, { x: event.clientX, y: event.clientY });
				return;
			}
			this.render();
		};
		root.addEventListener('pointerup', end);
		root.addEventListener('pointercancel', end);
		root.addEventListener('contextmenu', (event) => {
			const chip = (event.target as Element).closest<HTMLElement>('.oi-calendar-event[data-occurrence]');
			const occurrence = chip ? this.occurrenceMap.get(chip.dataset.occurrence!) : undefined;
			if (!occurrence) return;
			event.preventDefault();
			this.selected = occurrence.key;
			this.render();
			this.eventMenu(occurrence, { x: event.clientX, y: event.clientY });
		});
		root.addEventListener('keydown', (event) => this.onKey(event));
		root.addEventListener('scroll', (event) => {
			const scroller = event.target as HTMLElement;
			if (scroller.classList?.contains('oi-calendar-scroll')) this.scrollTop = scroller.scrollTop;
		}, true);
	}

	private dragTo(press: Press, spot: { day: number; minute: number | undefined }): void {
		if (press.occurrence) {
			const occurrence = press.occurrence;
			const duration = occurrence.end - occurrence.start;
			if (press.kind === 'Resize' && spot.minute !== undefined) {
				const end = Math.max(occurrence.start + this.snap(), spot.day * minutePerDay + this.snapMinute(spot.minute));
				this.preview = { key: occurrence.key, start: occurrence.start, end, allDay: false, copy: false };
			} else {
				const dayShift = spot.day - press.day;
				const minuteShift = spot.minute !== undefined && press.minute !== undefined && !occurrence.event.allDay ? this.snapMinute(spot.minute - press.minute) : 0;
				const start = occurrence.start + dayShift * minutePerDay + minuteShift;
				this.preview = { key: occurrence.key, start, end: start + duration, allDay: occurrence.event.allDay, copy: press.copy };
			}
		} else if (press.kind === 'Create' && spot.minute !== undefined && press.minute !== undefined) {
			const a = press.day * minutePerDay + this.snapMinute(press.minute - this.snap() / 2);
			const b = press.day * minutePerDay + Math.min(minutePerDay, this.snapMinute(spot.minute + this.snap() / 2));
			const start = Math.min(a, b);
			this.preview = { key: undefined, start, end: Math.max(start + this.snap(), Math.max(a, b)), allDay: false, copy: false };
		} else if (press.kind === 'CreateDay') {
			const first = Math.min(press.day, spot.day);
			const last = Math.max(press.day, spot.day);
			this.preview = { key: undefined, start: first * minutePerDay, end: (last + 1) * minutePerDay, allDay: true, copy: false };
		}
		this.render();
	}

	private clickAt(press: Press, event: PointerEvent): void {
		const point = { x: event.clientX, y: event.clientY };
		if (press.occurrence) {
			this.selected = press.occurrence.key;
			this.render();
			this.openPopover(press.occurrence.event, press.occurrence, point);
			return;
		}
		if (this.popover || performance.now() - this.closedAt < 500) {
			this.closePopover();
			return;
		}
		this.selected = undefined;
		if (press.kind === 'Create' && press.minute !== undefined) {
			const start = press.day * minutePerDay + Math.floor(press.minute / this.snap()) * this.snap();
			this.openPopover(this.draftEvent(start, start + this.defaultDuration(), false), undefined, point);
		} else this.openPopover(this.draftEvent(press.day * minutePerDay, (press.day + 1) * minutePerDay, true), undefined, point);
	}

	/** A new event (not written until you save it). */
	private draftEvent(start: number, end: number, allDay: boolean): CalendarEvent {
		const timeZone = !allDay && this.displayZone ? this.displayZone : undefined;
		return { id: 'Draft', kind: 'Block', title: '', start, duration: Math.max(allDay ? minutePerDay : this.snap(), end - start), allDay, useDuration: false, repeat: undefined, skipList: [], color: undefined, place: undefined, timeZone, tagList: [], noteText: '', readOnly: false };
	}

	// ------------------------------------------------------------ changing events

	private say(message: string): void {
		this.message = message;
		this.render();
		setTimeout(() => {
			if (this.message === message) {
				this.message = '';
				this.render();
			}
		}, 3500);
	}

	/** Writes a changed event where it lives (its block, or its note). */
	private writeEvent(event: CalendarEvent, change: { title?: string; color?: string | null; place?: string | null; noteText?: string } = {}): void {
		if (event.kind === 'Block') writeBlockEvent(this.noteModel(), event, change);
		else if (event.kind === 'Note' && event.path) {
			const map = new Map<string, PropertyValue | undefined>(timingProperty(event));
			if (change.color !== undefined) map.set('Color', change.color ?? undefined);
			if (change.place !== undefined) map.set('Place', change.place || undefined);
			if (change.title !== undefined && change.title !== event.title) map.set('Title', change.title || undefined);
			void this.index()?.setProperty(event.path, map);
		}
	}

	/** Adds an event: an Event block in this calendar, or (asNote) a note in its folder. */
	private addEvent(event: CalendarEvent, asNote = false, afterKey?: string): void {
		if (asNote) {
			void this.addNote(event);
			return;
		}
		insertEvent(this.noteModel(), this.calendarKey(), eventSource(event), afterKey);
	}

	/** The folder linked notes go to: Folder, or one named after this note, set the first time. */
	private noteFolder(): string {
		const folder = textOf(this.property().get('Folder'));
		if (folder) return folder.replace(/^\/+|\/+$/g, '');
		const here = this.index()?.pathOf(this.context.note) ?? '';
		const parent = here.includes('/') ? here.slice(0, here.lastIndexOf('/')) : '';
		const name = (here.split('/').pop() ?? 'Calendar').replace(/\.oi$/, '') || 'Calendar';
		const made = parent ? `${parent}/${name}` : name;
		this.setProperty('Folder', made);
		return made;
	}

	private async addNote(event: CalendarEvent): Promise<string | undefined> {
		const index = this.index();
		if (!index) {
			this.say('Linked notes need a vault.');
			return undefined;
		}
		const folder = this.noteFolder();
		const property = eventProperty(event);
		const path = await index.createNote({ folder, name: event.title || 'Untitled', property, body: event.noteText });
		// a taken name gets a number in the file name: the calendar still shows the name you gave
		if (path && event.title && !path.endsWith(`/${event.title}.oi`) && path !== `${event.title}.oi`) await index.setProperty(path, new Map([['Title', event.title]]));
		return path;
	}

	/** Drops an occurrence elsewhere (or copies it there); a repeating one asks how much moves. */
	private moveOccurrence(occurrence: Occurrence, start: number, end: number, copy: boolean, point: { x: number; y: number }): void {
		const event = occurrence.event;
		if (event.readOnly || this.readOnly()) {
			this.say(event.kind === 'Table' ? 'This event comes from a table: change it there.' : 'This is the Read view.');
			return;
		}
		if (start === occurrence.start && end === occurrence.end) {
			this.render();
			return;
		}
		if (copy) {
			const single = { ...duplicateAt(event, this.toEventZone(event, start)), duration: end - start, repeat: undefined, skipList: [] };
			if (event.kind === 'Note') void this.copyNote(event, single);
			else this.addEvent(single, false, event.blockKey);
			this.selected = undefined;
			return;
		}
		const changed: CalendarEvent = { ...event, start: event.start + (start - occurrence.start), duration: end - start };
		const single: CalendarEvent = { ...event, start: this.toEventZone(event, start), duration: end - start };
		this.applyScoped(occurrence, changed, single, {}, point);
	}

	/** For a repeating event: this one, this and following, or all; otherwise just the change. */
	private applyScoped(occurrence: Occurrence, changedAll: CalendarEvent, changedOne: CalendarEvent, change: { title?: string; color?: string | null; place?: string | null; noteText?: string }, point: { x: number; y: number }): void {
		const event = occurrence.event;
		if (!event.repeat) {
			this.writeEvent(changedOne, change);
			return;
		}
		const one = (): void => {
			const { series, single } = splitThis(event, occurrence, { ...changedOne, title: change.title ?? changedOne.title, color: change.color === undefined ? changedOne.color : (change.color ?? undefined), place: change.place === undefined ? changedOne.place : change.place || undefined, noteText: change.noteText ?? changedOne.noteText });
			this.noteModel().transact(() => {
				this.writeEvent(series);
				if (event.kind === 'Note') void this.copyNote(event, single);
				else this.addEvent(single, false, event.blockKey);
			});
		};
		const following = (): void => {
			const shift = changedOne.start - occurrence.start;
			const { series, following: rest } = splitFollowing(event, occurrence, { ...changedAll, start: occurrence.start + shift, title: change.title ?? changedAll.title, color: change.color === undefined ? changedAll.color : (change.color ?? undefined), place: change.place === undefined ? changedAll.place : change.place || undefined, noteText: change.noteText ?? changedAll.noteText });
			this.noteModel().transact(() => {
				this.writeEvent(series);
				if (event.kind === 'Note') void this.copyNote(event, rest);
				else this.addEvent(rest, false, event.blockKey);
			});
		};
		const all = (): void => this.writeEvent(changedAll, change);
		const menu = this.menu();
		if (!menu) {
			all();
			return;
		}
		this.render();
		menu.open({
			x: point.x,
			y: point.y,
			itemList: [
				{ title: 'This event', explain: 'Only this day; the others stay', run: one },
				{ title: 'This and following', explain: 'From this day on', run: following },
				{ title: 'All events', run: all },
			],
		});
	}

	/** A note-backed event copied: a new note with the same name and what the note holds. */
	private async copyNote(event: CalendarEvent, copy: CalendarEvent): Promise<void> {
		const index = this.index();
		if (!index || !event.path) return;
		const text = (await index.readNote(event.path)) ?? '';
		const body = noteBody(text);
		await this.addNote({ ...copy, noteText: body });
	}

	private deleteOccurrence(occurrence: Occurrence, point: { x: number; y: number }): void {
		const event = occurrence.event;
		if (event.readOnly || this.readOnly()) return;
		const remove = (): void => {
			if (event.kind === 'Block' && event.blockKey) this.noteModel().delete(event.blockKey);
			else if (event.kind === 'Note' && event.path) void this.index()?.trashNote(event.path);
			this.selected = undefined;
		};
		if (!event.repeat) {
			remove();
			return;
		}
		const day = dayOfMoment(occurrence.start);
		this.menu()?.open({
			x: point.x,
			y: point.y,
			itemList: [
				{ title: 'Delete this event', explain: 'Skips this day', run: () => this.writeEvent({ ...event, skipList: [...event.skipList, [day, day]] }) },
				{ title: 'Delete this and following', run: () => this.writeEvent({ ...event, repeat: { ...event.repeat!, until: day - 1, count: undefined } }) },
				{ title: 'Delete all events', danger: true, run: remove },
			],
		});
	}

	private eventMenu(occurrence: Occurrence, point: { x: number; y: number }): void {
		const event = occurrence.event;
		const locked = event.readOnly || this.readOnly();
		const itemList: MenuEntry[] = [{ title: locked ? 'Show' : 'Edit', run: () => this.openPopover(event, occurrence, point) }];
		if (event.path) itemList.push({ title: 'Open note', run: () => this.index()?.open(event.path!) });
		if (!locked) {
			itemList.push(
				{ title: 'Duplicate', hint: this.keyText('Duplicate'), separatorBefore: true, run: () => this.moveOccurrence(occurrence, occurrence.start + minutePerDay, occurrence.end + minutePerDay, true, point) },
				{ title: 'Duplicate to next week', run: () => this.moveOccurrence(occurrence, occurrence.start + 7 * minutePerDay, occurrence.end + 7 * minutePerDay, true, point) },
				{ title: 'Copy', hint: this.keyText('Copy'), run: () => (copied = { ...event, start: occurrence.start }) },
			);
			if (event.repeat) {
				const day = dayOfMoment(occurrence.start);
				itemList.push({ title: 'Skip this day', explain: 'For a break or a holiday', run: () => this.writeEvent({ ...event, skipList: [...event.skipList, [day, day]] }) });
			}
			if (event.kind === 'Block' && this.index()) itemList.push({ title: 'Move to its own note', separatorBefore: true, run: () => void this.toNote(event) });
			if (event.kind === 'Note') itemList.push({ title: 'Move into the calendar', separatorBefore: true, run: () => void this.fromNote(event) });
			itemList.push({ title: 'Delete', danger: true, separatorBefore: true, hint: this.keyText('Delete'), run: () => this.deleteOccurrence(occurrence, point) });
		}
		this.menu()?.open({ x: point.x, y: point.y, itemList });
	}

	/** An Event block becomes a note of its own (the calendar shows it from its folder). */
	private async toNote(event: CalendarEvent): Promise<void> {
		const path = await this.addNote(event);
		if (path && event.blockKey) this.noteModel().delete(event.blockKey);
	}

	/** A note becomes an Event block here; the note goes to the trash (with Undo). */
	private async fromNote(event: CalendarEvent): Promise<void> {
		const index = this.index();
		if (!index || !event.path) return;
		const text = (await index.readNote(event.path)) ?? '';
		const property = index.noteList().find((note) => note.path === event.path)?.property ?? new Map();
		const kept: PropertyMap = new Map(eventProperty(event));
		for (const [key, value] of property) if (!kept.has(key) && !['Title', 'Start', 'End', 'Duration', 'Date', 'Repeat', 'Skip', 'AllDay', 'Tag', 'Color', 'Place'].includes(key)) kept.set(key, value);
		const body = noteBody(text);
		const indented = body ? `\n${body.split('\n').map((line) => `\t${line}`).join('\n')}` : '';
		const source = `Event ${formatInline(kept)}:${event.title ? ` ${event.title}` : ''}${indented}`;
		if (await index.trashNote(event.path)) insertEvent(this.noteModel(), this.calendarKey(), source);
	}

	// ------------------------------------------------------------ the event popover

	private openPopover(event: CalendarEvent, occurrence: Occurrence | undefined, point: { x: number; y: number }): void {
		this.closePopover();
		const locked = event.readOnly || this.readOnly();
		this.draft = { event, occurrence };
		const start = occurrence ? occurrence.start : event.start;
		const end = occurrence ? occurrence.end : event.start + event.duration;
		const startDay = dayOfMoment(start);
		const lastDay = dayOfMoment(event.allDay ? end - 1 : end);
		const repeat = event.repeat;
		const repeatKind = repeatKindOf(repeat, startDay);
		const index = this.index();
		const element = document.createElement('div');
		element.className = 'oi-calendar-popover';
		element.dataset.oiKeepEditor = '';
		element.dataset.oiInteractive = '';
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', occurrence ? 'Event' : 'New event');
		const disabled = locked ? ' disabled' : '';
		const colorHtml = [undefined, ...colorList]
			.map((color) => `<button type="button" class="oi-calendar-swatch${(event.color ?? undefined) === color ? ' active' : ''}" data-color="${color ?? ''}" style="--oi-calendar-color:${escapeHtml(color ? (this.context.resolveColor(color) ?? color) : 'transparent')}" aria-label="${color ?? 'Default color'}"${disabled}></button>`)
			.join('');
		const skipHtml = event.skipList.map(([from, to], at) => `<span class="oi-calendar-chip">${escapeHtml(from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`)}${locked ? '' : `<button type="button" data-skip-remove="${at}" aria-label="Remove">${crossMark}</button>`}</span>`).join('');
		element.innerHTML =
			`<form class="oi-calendar-form">` +
			`<input class="oi-calendar-name-input" name="title" value="${escapeHtml(event.title)}" placeholder="Name" aria-label="Name" autocomplete="off"${disabled}>` +
			`<div class="oi-calendar-form-row"><label class="oi-calendar-check"><input type="checkbox" name="allDay"${event.allDay ? ' checked' : ''}${disabled}> All day</label></div>` +
			`<div class="oi-calendar-form-row oi-calendar-when">` +
			`<input type="date" name="startDay" value="${dayText(startDay)}" aria-label="Date"${disabled}>` +
			`<input type="time" name="startClock" value="${clockText(start - startDay * minutePerDay)}" step="${this.snap() * 60}" aria-label="Start time" data-timed${disabled}>` +
			`</div>` +
			`<div class="oi-calendar-form-row oi-calendar-end">` +
			`<div class="oi-calendar-segment-row" role="group" aria-label="End or duration"><button type="button" class="oi-calendar-segment${event.useDuration ? '' : ' active'}" data-end-mode="End"${disabled}>End</button><button type="button" class="oi-calendar-segment${event.useDuration ? ' active' : ''}" data-end-mode="Duration"${disabled}>Duration</button></div>` +
			`<span class="oi-calendar-end-field" data-mode="End"${event.useDuration ? ' hidden' : ''}><input type="date" name="endDay" value="${dayText(lastDay)}" aria-label="End date" data-multi${disabled}><input type="time" name="endClock" value="${clockText(end - dayOfMoment(end) * minutePerDay)}" step="${this.snap() * 60}" aria-label="End time" data-timed${disabled}></span>` +
			`<span class="oi-calendar-end-field" data-mode="Duration"${event.useDuration ? '' : ' hidden'}><input name="duration" value="${escapeHtml(durationText(end - start))}" size="7" aria-label="Duration" placeholder="1h30m"${disabled}>${['30m', '1h', '1h30m', '2h'].map((value) => `<button type="button" class="oi-calendar-chip-button" data-duration="${value}"${disabled}>${value}</button>`).join('')}</span>` +
			`</div>` +
			`<div class="oi-calendar-form-row"><select name="repeat" aria-label="Repeat"${disabled}>${repeatOptionList(startDay).map(([value, label]) => `<option value="${value}"${value === repeatKind ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>` +
			`<div class="oi-calendar-form-row oi-calendar-custom"${repeatKind === 'Custom' ? '' : ' hidden'}>Every <input type="number" name="interval" min="1" value="${repeat?.interval ?? 1}" aria-label="Every"${disabled}><select name="every" aria-label="Unit"${disabled}>${(['Day', 'Week', 'Month', 'Year'] as Frequency[]).map((unit) => `<option value="${unit}"${(repeat?.every ?? 'Week') === unit ? ' selected' : ''}>${unit.toLowerCase()}s</option>`).join('')}</select>` +
			`<span class="oi-calendar-weekday-row">${weekdayName.map((name, at) => `<label class="oi-calendar-weekday-toggle"><input type="checkbox" name="on" value="${at}"${(repeat?.onList.length ? repeat.onList : [weekdayOf(startDay)]).includes(at) ? ' checked' : ''}${disabled}>${name.slice(0, 2)}</label>`).join('')}</span></div>` +
			`<div class="oi-calendar-form-row oi-calendar-repeat-more"${repeatKind === 'None' ? ' hidden' : ''}><label>Until <input type="date" name="until" value="${repeat?.until !== undefined ? dayText(repeat.until) : ''}" aria-label="Until"${disabled}></label></div>` +
			`<div class="oi-calendar-form-row oi-calendar-repeat-more oi-calendar-skip"${repeatKind === 'None' ? ' hidden' : ''}><span class="oi-calendar-label">Skip</span>${skipHtml}${locked ? '' : `<input type="date" name="skipFrom" aria-label="Skip from"><span>–</span><input type="date" name="skipTo" aria-label="Skip to (optional)"><button type="button" class="oi-calendar-chip-button" data-action-form="AddSkip">Add</button>`}</div>` +
			`<div class="oi-calendar-form-row"><input name="place" value="${escapeHtml(event.place ?? '')}" placeholder="Place" aria-label="Place"${disabled}></div>` +
			`<div class="oi-calendar-form-row oi-calendar-swatch-row">${colorHtml}</div>` +
			(event.kind === 'Block' ? `<textarea name="noteText" rows="2" placeholder="Notes" aria-label="Notes"${disabled}>${escapeHtml(event.noteText)}</textarea>` : '') +
			(!occurrence && index && !locked ? `<label class="oi-calendar-check oi-calendar-as-note"><input type="checkbox" name="asNote"> As a linked note</label>` : '') +
			(event.kind === 'Table' ? `<p class="oi-calendar-note">From a table: change it there.</p>` : '') +
			(!event.allDay && (this.displayZone || event.timeZone) ? `<p class="oi-calendar-note">Times in ${escapeHtml(zoneLabel(this.zone()))}${event.timeZone && event.timeZone !== this.zone() ? `; the event is set in ${escapeHtml(zoneLabel(event.timeZone))}` : ''}.</p>` : '') +
			`<div class="oi-calendar-form-action">` +
			(occurrence && !locked ? `<button type="button" class="oi-calendar-button" data-action-form="More" aria-label="More">More</button>` : '') +
			(event.path ? `<button type="button" class="oi-calendar-button" data-action-form="Open">Open note</button>` : '') +
			`<span class="oi-calendar-space"></span>` +
			`<button type="button" class="oi-calendar-button" data-action-form="Cancel">${locked ? 'Close' : 'Cancel'}</button>` +
			(locked ? '' : `<button type="submit" class="oi-calendar-button primary">Save</button>`) +
			`</div></form>`;
		document.body.append(element);
		this.popover = element;
		const form = element.querySelector('form')!;
		const skipList: [number, number][] = [...event.skipList];
		const sync = (): void => {
			const allDay = (form.elements.namedItem('allDay') as HTMLInputElement).checked;
			for (const input of element.querySelectorAll<HTMLElement>('[data-timed]')) input.hidden = allDay;
			const kind = (form.elements.namedItem('repeat') as HTMLSelectElement).value;
			element.querySelector<HTMLElement>('.oi-calendar-custom')!.hidden = kind !== 'Custom';
			for (const row of element.querySelectorAll<HTMLElement>('.oi-calendar-repeat-more')) row.hidden = kind === 'None';
			const every = (form.elements.namedItem('every') as HTMLSelectElement).value;
			element.querySelector<HTMLElement>('.oi-calendar-weekday-row')!.hidden = every !== 'Week';
		};
		sync();
		form.addEventListener('change', sync);
		element.addEventListener('click', (clickEvent) => {
			const target = clickEvent.target as HTMLElement;
			const mode = target.closest<HTMLElement>('[data-end-mode]')?.dataset.endMode;
			if (mode) {
				for (const button of element.querySelectorAll<HTMLElement>('[data-end-mode]')) button.classList.toggle('active', button.dataset.endMode === mode);
				for (const field of element.querySelectorAll<HTMLElement>('.oi-calendar-end-field')) field.hidden = field.dataset.mode !== mode;
				return;
			}
			const duration = target.closest<HTMLElement>('[data-duration]')?.dataset.duration;
			if (duration) {
				(form.elements.namedItem('duration') as HTMLInputElement).value = duration;
				return;
			}
			const swatch = target.closest<HTMLElement>('[data-color]');
			if (swatch) {
				for (const item of element.querySelectorAll('.oi-calendar-swatch')) item.classList.toggle('active', item === swatch);
				return;
			}
			const skipRemove = target.closest<HTMLElement>('[data-skip-remove]');
			if (skipRemove) {
				skipList.splice(Number(skipRemove.dataset.skipRemove), 1);
				skipRemove.closest('.oi-calendar-chip')?.remove();
				return;
			}
			const action = target.closest<HTMLElement>('[data-action-form]')?.dataset.actionForm;
			if (action === 'Cancel') this.closePopover();
			else if (action === 'Open' && event.path) {
				this.closePopover();
				this.index()?.open(event.path);
			} else if (action === 'More' && occurrence) {
				const rect = target.getBoundingClientRect();
				this.closePopover();
				this.eventMenu(occurrence, { x: rect.left, y: rect.bottom + 2 });
			} else if (action === 'AddSkip') {
				const from = dayOf((form.elements.namedItem('skipFrom') as HTMLInputElement).value);
				const to = dayOf((form.elements.namedItem('skipTo') as HTMLInputElement).value) ?? from;
				if (from === undefined || to === undefined) return;
				const range: [number, number] = [Math.min(from, to), Math.max(from, to)];
				skipList.push(range);
				const chip = document.createElement('span');
				chip.className = 'oi-calendar-chip';
				chip.innerHTML = `${escapeHtml(range[0] === range[1] ? shortDate(range[0]) : `${shortDate(range[0])} – ${shortDate(range[1])}`)}<button type="button" data-skip-remove="${skipList.length - 1}" aria-label="Remove">${crossMark}</button>`;
				target.closest('.oi-calendar-skip')!.insertBefore(chip, form.elements.namedItem('skipFrom') as HTMLInputElement);
				(form.elements.namedItem('skipFrom') as HTMLInputElement).value = '';
				(form.elements.namedItem('skipTo') as HTMLInputElement).value = '';
			}
		});
		element.addEventListener('keydown', (keyEvent) => {
			if (keyEvent.key === 'Escape') {
				keyEvent.preventDefault();
				keyEvent.stopPropagation();
				this.closePopover();
				this.root.focus({ preventScroll: true });
			} else if (keyEvent.key === 'Enter' && (keyEvent.target as HTMLElement).tagName !== 'TEXTAREA' && (keyEvent.target as HTMLElement).tagName !== 'BUTTON') {
				keyEvent.preventDefault();
				form.requestSubmit();
			} else if (keyEvent.key === 'Enter' && (keyEvent.ctrlKey || keyEvent.metaKey)) {
				keyEvent.preventDefault();
				form.requestSubmit();
			}
			keyEvent.stopPropagation();
		});
		form.addEventListener('submit', (submitEvent) => {
			submitEvent.preventDefault();
			if (locked) return;
			const read = this.readForm(form, event, skipList);
			if (!read) return;
			const saveRect = form.querySelector('[type="submit"]')!.getBoundingClientRect();
			this.closePopover();
			this.save(event, occurrence, read, { x: saveRect.left, y: saveRect.top }, (form.elements.namedItem('asNote') as HTMLInputElement | null)?.checked ?? false);
		});
		this.placePopover(element, point);
		const title = element.querySelector<HTMLInputElement>('.oi-calendar-name-input');
		title?.focus();
		if (!occurrence) this.render();
	}

	private placePopover(element: HTMLElement, point: { x: number; y: number }): void {
		const width = document.documentElement.clientWidth;
		const height = document.documentElement.clientHeight;
		const rect = element.getBoundingClientRect();
		let left = point.x + 12;
		if (left + rect.width > width - 8) left = Math.max(8, point.x - rect.width - 12);
		if (left + rect.width > width - 8) left = Math.max(8, width - rect.width - 8);
		let top = point.y - 40;
		if (top + rect.height > height - 8) top = Math.max(8, height - rect.height - 8);
		element.style.left = `${Math.max(8, left)}px`;
		element.style.top = `${Math.max(8, top)}px`;
	}

	private readForm(form: HTMLFormElement, event: CalendarEvent, skipList: [number, number][]): { event: CalendarEvent; change: { title: string; color: string | null; place: string; noteText?: string } } | undefined {
		const value = (name: string): string => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
		const allDay = (form.elements.namedItem('allDay') as HTMLInputElement).checked;
		const startDay = dayOf(value('startDay'));
		if (startDay === undefined) return undefined;
		const startClock = allDay ? 0 : (clockOf(value('startClock')) ?? 9 * 60);
		const start = startDay * minutePerDay + startClock;
		const useDuration = form.querySelector('[data-end-mode="Duration"]')!.classList.contains('active');
		let duration: number;
		if (useDuration) duration = durationOf(value('duration')) ?? (allDay ? minutePerDay : 60);
		else if (allDay) duration = ((dayOf(value('endDay')) ?? startDay) - startDay + 1) * minutePerDay;
		else {
			const endDay = dayOf(value('endDay')) ?? startDay;
			const endClock = clockOf(value('endClock')) ?? startClock + 60;
			duration = endDay * minutePerDay + endClock - start;
			// an end before the start on the same day: the next day (a night shift)
			if (duration <= 0) duration += minutePerDay;
		}
		if (allDay) duration = Math.max(minutePerDay, Math.round(duration / minutePerDay) * minutePerDay);
		const repeatKind = value('repeat');
		let repeat: Repeat | undefined;
		const until = dayOf(value('until'));
		if (repeatKind !== 'None') {
			const custom = repeatKind === 'Custom';
			const every = (custom ? value('every') : repeatKind === 'Weekday' ? 'Week' : repeatKind) as Frequency;
			const onList = custom ? [...form.querySelectorAll<HTMLInputElement>('input[name="on"]:checked')].map((input) => Number(input.value)) : repeatKind === 'Weekday' ? [0, 1, 2, 3, 4] : [];
			repeat = { every, interval: custom ? Math.max(1, Number(value('interval')) || 1) : 1, onList: every === 'Week' && (custom || repeatKind === 'Weekday') ? onList : [], until, count: undefined };
			if (every === 'Week' && repeat.onList.length === 1 && repeat.onList[0] === weekdayOf(startDay)) repeat.onList = [];
		}
		const color = form.querySelector<HTMLElement>('.oi-calendar-swatch.active')?.dataset.color || null;
		const changed: CalendarEvent = { ...event, start, duration, allDay, useDuration, repeat, skipList: repeat ? skipList : [], title: value('title').trim(), color: color ?? undefined, place: value('place').trim() || undefined };
		const noteInput = form.elements.namedItem('noteText') as HTMLTextAreaElement | null;
		if (noteInput) changed.noteText = noteInput.value;
		return { event: changed, change: { title: changed.title, color, place: changed.place ?? '', noteText: noteInput ? noteInput.value : undefined } };
	}

	private save(event: CalendarEvent, occurrence: Occurrence | undefined, read: { event: CalendarEvent; change: { title: string; color: string | null; place: string; noteText?: string } }, point: { x: number; y: number }, asNote: boolean): void {
		this.draft = undefined;
		if (!occurrence) {
			this.addEvent(read.event, asNote);
			this.render();
			return;
		}
		const changed = read.event;
		// "all": the series keeps its first day, moved by as much as this one moved
		const shift = changed.start - occurrence.start;
		const all: CalendarEvent = { ...changed, start: event.start + shift };
		const timingSame = changed.start === occurrence.start && changed.duration === event.duration && changed.allDay === event.allDay && JSON.stringify(changed.repeat) === JSON.stringify(event.repeat) && JSON.stringify(changed.skipList) === JSON.stringify(event.skipList);
		if (!event.repeat || (timingSame && changed.title === event.title)) {
			this.writeEvent(event.repeat ? { ...all, start: event.start } : { ...changed, start: this.toEventZone(event, changed.start) }, read.change);
			return;
		}
		// the repeat itself changed: that is for the whole series
		if (JSON.stringify(changed.repeat) !== JSON.stringify(event.repeat) || JSON.stringify(changed.skipList) !== JSON.stringify(event.skipList)) {
			this.writeEvent(all, read.change);
			return;
		}
		this.applyScoped(occurrence, all, { ...changed, start: this.toEventZone(event, changed.start), repeat: undefined }, read.change, point);
	}

	private closePopover(): void {
		const hadDraft = this.draft && !this.draft.occurrence;
		this.popover?.remove();
		this.popover = undefined;
		this.draft = undefined;
		if (hadDraft) this.render();
	}

	// ------------------------------------------------------------ keys

	private keyText(action: string): string {
		const lookup = this.context.extension<HotkeyLookup>(hotkeyExtension);
		if (lookup) return lookup.keyText(`Calendar.${action}`);
		return (calendarCommandList.find((item) => item.action === action)?.key[0] ?? '').replace('Mod+', 'Ctrl+');
	}

	private actionFor(event: KeyboardEvent): string | undefined {
		const lookup = this.context.extension<HotkeyLookup>(hotkeyExtension);
		if (lookup) return lookup.commandFor(event, 'Calendar')?.replace(/^Calendar\./, '');
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
		const chord = `${mod ? 'Mod+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`;
		return calendarCommandList.find((item) => item.key.includes(chord))?.action;
	}

	private onKey(event: KeyboardEvent): void {
		if ((event.target as HTMLElement).closest('input, textarea, select')) return;
		const selected = this.selected ? this.occurrenceMap.get(this.selected) : undefined;
		if (selected && !event.ctrlKey && !event.metaKey && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			const timed = !selected.event.allDay && (this.show === 'Week' || this.show === 'Day');
			const shift =
				event.key === 'ArrowLeft' ? -minutePerDay : event.key === 'ArrowRight' ? minutePerDay : timed ? (event.key === 'ArrowUp' ? -this.snap() : this.snap()) : event.key === 'ArrowUp' ? -7 * minutePerDay : 7 * minutePerDay;
			const rect = this.root.querySelector(`[data-occurrence="${CSS.escape(selected.key)}"]`)?.getBoundingClientRect();
			this.selected = `${selected.event.id}@${dayOfMoment(selected.start + shift)}`;
			this.moveOccurrence(selected, selected.start + shift, selected.end + shift, false, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
			return;
		}
		if (event.key === 'Escape' && this.selected) {
			event.preventDefault();
			event.stopPropagation();
			this.selected = undefined;
			this.render();
			return;
		}
		const action = this.actionFor(event);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		this.command(action);
	}

	/** A Calendar command (from a key, a button, or the hotkey list). */
	command(action: string): void {
		const selected = this.selected ? this.occurrenceMap.get(this.selected) : undefined;
		const rect = this.root.getBoundingClientRect();
		const point = this.hover ? { x: rect.left + rect.width / 2, y: rect.top + 60 } : { x: rect.left + rect.width / 2, y: rect.top + 60 };
		switch (action) {
			case 'Today':
				this.anchor = dayOfMoment(this.now());
				this.render();
				return;
			case 'Day':
			case 'Week':
			case 'Month':
			case 'Agenda':
				this.setShow(action);
				return;
			case 'Next':
			case 'Previous': {
				const way = action === 'Next' ? 1 : -1;
				if (this.show === 'Month') {
					const { year, month } = partOf(this.anchor);
					this.anchor = dayFromPart(year, month + way, 1);
				} else this.anchor += way * (this.show === 'Day' ? 1 : this.show === 'Week' ? (this.narrow() ? 3 : 7) : 30);
				this.render();
				return;
			}
			case 'New': {
				if (this.readOnly()) return;
				const day = this.hover?.day ?? (this.range().from <= dayOfMoment(this.now()) && dayOfMoment(this.now()) <= this.range().to ? dayOfMoment(this.now()) : this.anchor);
				const start = day * minutePerDay + 9 * 60;
				const allDay = this.show === 'Month' || this.show === 'Agenda';
				this.openPopover(this.draftEvent(allDay ? day * minutePerDay : start, allDay ? (day + 1) * minutePerDay : start + this.defaultDuration(), allDay), undefined, point);
				return;
			}
			case 'Duplicate':
				if (selected) this.moveOccurrence(selected, selected.start + minutePerDay, selected.end + minutePerDay, true, point);
				return;
			case 'Copy':
				if (selected) {
					copied = { ...selected.event, start: selected.start };
					this.say(`Copied “${selected.event.title || 'Untitled'}”: point at a day and paste.`);
				}
				return;
			case 'Paste': {
				if (!copied || this.readOnly()) return;
				const day = this.hover?.day ?? this.anchor;
				const clock = copied.allDay ? 0 : this.hover?.minute !== undefined ? this.snapMinute(this.hover.minute) : copied.start - dayOfMoment(copied.start) * minutePerDay;
				// the copy keeps its zone (or takes the one shown), its time where you paste it
				const pasted: CalendarEvent = { ...copied, kind: 'Block', path: undefined, readOnly: false, repeat: undefined, skipList: [], timeZone: copied.timeZone ?? (copied.allDay ? undefined : this.displayZone) };
				this.addEvent({ ...pasted, start: this.toEventZone(pasted, day * minutePerDay + clock) });
				return;
			}
			case 'Delete':
				if (selected) this.deleteOccurrence(selected, point);
				return;
		}
	}

	private setShow(show: Show): void {
		this.show = show;
		this.render();
	}
}

/** A Calendar block as OI text (its Event blocks and what they hold included), with these properties. */
function calendarSource(node: BlockNode, property: PropertyMap): string {
	const own = new Map(property);
	own.delete('From');
	const head = `Calendar${node.id ? ` ^${node.id}` : ''}${own.size ? ` ${formatInline(own)}` : ''}:`;
	const lineList = node.childList.flatMap((child) => serializeNode(child));
	const indent = Math.min(...lineList.filter((line) => line.trim() !== '').map((line) => /^\t*/.exec(line)![0].length));
	const body = lineList.map((line) => (line.trim() === '' ? '' : `\t${line.slice(Number.isFinite(indent) ? indent : 0)}`)).join('\n');
	return body.trim() ? `${head}\n${body}` : head;
}

/** What a note holds besides its header and first Property block, as OI text. */
function noteBody(text: string): string {
	const lineList = text.replace(/\r\n?/g, '\n').split('\n');
	let at = 0;
	if (lineList[0]?.trim() === '---') {
		const close = lineList.indexOf('---', 1);
		at = close < 0 ? 0 : close + 1;
	}
	const rest = lineList.slice(at);
	const property = rest.findIndex((line) => /^Property\s*(\{.*\})?\s*:\s*$/.test(line));
	if (property >= 0) {
		let end = property + 1;
		while (end < rest.length && (/^\t/.test(rest[end]!) || rest[end]!.trim() === '')) end++;
		rest.splice(property, end - property);
	}
	return rest.join('\n').trim();
}

const shortDate = (day: number): string => {
	const { month, date } = partOf(day);
	return `${monthShortName[month]} ${date}`;
};

function repeatOptionList(day: number): [string, string][] {
	const { month, date } = partOf(day);
	return [
		['None', 'Does not repeat'],
		['Day', 'Every day'],
		['Week', `Every week on ${weekdayLongName[weekdayOf(day)]}`],
		['Weekday', 'Every weekday (Mon to Fri)'],
		['Month', `Every month on the ${ordinal(date)}`],
		['Year', `Every year on ${monthShortName[month]} ${date}`],
		['Custom', 'Custom'],
	];
}

function repeatKindOf(repeat: Repeat | undefined, day: number): string {
	if (!repeat) return 'None';
	if (repeat.interval === 1 && repeat.until === undefined && repeat.count === undefined) {
		if (repeat.every !== 'Week' && repeat.onList.length === 0) return repeat.every;
		if (repeat.every === 'Week' && (repeat.onList.length === 0 || (repeat.onList.length === 1 && repeat.onList[0] === weekdayOf(day)))) return 'Week';
		if (repeat.every === 'Week' && repeat.onList.join() === '0,1,2,3,4') return 'Weekday';
	}
	if (repeat.interval === 1 && repeat.count === undefined) {
		if (repeat.every !== 'Week' || repeat.onList.length === 0 || (repeat.onList.length === 1 && repeat.onList[0] === weekdayOf(day))) return repeat.every;
		if (repeat.onList.join() === '0,1,2,3,4') return 'Weekday';
	}
	return 'Custom';
}

const ordinal = (value: number): string => `${value}${value % 10 === 1 && value !== 11 ? 'st' : value % 10 === 2 && value !== 12 ? 'nd' : value % 10 === 3 && value !== 13 ? 'rd' : 'th'}`;

export const calendarRenderer: Renderer = {
	mount(frame, block, context) {
		installStyle('calendar', calendarStyle);
		const view = new CalendarView(frame, block, context);
		return {
			update(next, nextContext) {
				view.update(next, nextContext);
				return 'Done';
			},
			destroy: () => view.destroy(),
		};
	},
};
