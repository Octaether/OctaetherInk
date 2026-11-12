// What the AI's parts share while the app runs (small, so it loads with the plugin): the chats open
// now (to give one the focus), the chat shown last (the chat button opens it again), and a
// conversation handed from the Ask AI box to a chat that is about to open.

import type { Chat } from './store';

export const chatHub = {
	/** Each open chat's way to take the focus, by its tab's state. */
	focusMap: new Map<string, () => void>(),
	/** The state of the chat shown last. */
	last: '',
	/** Conversations waiting for the chat tab that opens them, by state. */
	pendingMap: new Map<string, Chat>(),
	/** Words typed in the Ask AI box, for the chat that opens them, by state. */
	draftMap: new Map<string, string>(),
};
