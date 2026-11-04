// The Calendar's keys (`Calendar.<action>`, in the `Calendar` context): listed, and changed, in
// Setting → Hotkey; they act only while a calendar has the focus.

export const calendarCommandList: readonly { action: string; title: string; key: readonly string[] }[] = [
	{ action: 'Today', title: 'today', key: ['T'] },
	{ action: 'Day', title: 'day view', key: ['D'] },
	{ action: 'Week', title: 'week view', key: ['W'] },
	{ action: 'Month', title: 'month view', key: ['M'] },
	{ action: 'Agenda', title: 'agenda', key: ['A'] },
	{ action: 'Next', title: 'next', key: ['J'] },
	{ action: 'Previous', title: 'previous', key: ['K'] },
	{ action: 'New', title: 'new event', key: ['C', 'N'] },
	{ action: 'Duplicate', title: 'duplicate the event', key: ['Mod+D'] },
	{ action: 'Copy', title: 'copy the event', key: ['Mod+C'] },
	{ action: 'Paste', title: 'paste the event', key: ['Mod+V'] },
	{ action: 'Delete', title: 'delete the event', key: ['Delete', 'Backspace'] },
];
