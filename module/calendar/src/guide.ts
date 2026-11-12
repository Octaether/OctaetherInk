// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const calendarGuide = String.raw`A calendar that holds Event blocks. Show is the view it opens with: Month, Week, Day, or Agenda; Date is the day it opens on. Data: a table's title adds that table's rows on their dates.

<example>
Calendar {Show: Week}:
	Event {Start: 2026-09-07 09:00, End: 10:30, Repeat: {Every: Week, On: [Mon, Wed]}, Place: Room 204}: Linear Algebra
		Bring the problem set.
	Event {Start: 2026-09-12}: Field trip
</example>`;

export const eventGuide = String.raw`One event, usually inside a Calendar; its name goes after the colon and its notes on the lines below. Start is a date and time (2026-09-07 09:00), or a date alone for all day. End is a time on the same day (10:30) or a date; or give Duration (1h30m). Repeat: Day, Week, Month, Year, or {Every: Week, Interval: 2, On: [Mon, Wed], Until: 2026-12-18}. Skip: [2026-11-23..2026-11-29] leaves days out. Also Place, Color, Tag.`;
