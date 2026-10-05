// Minimal line icons (24×24, stroke = currentColor), drawn for this app so they look the same on
// every device.

const svg = (body: string): string =>
	`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
	FilePlus: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>'),
	File: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
	FolderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h13l3-8H6l-3 8"/>'),
	Folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
	FolderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>'),
	Browser: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/>'),
	Command: svg('<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>'),
	Source: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
	Edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
	Read: svg('<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'),
	Setting: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
	More: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
	Plus: svg('<path d="M12 5v14M5 12h14"/>'),
	Grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
	Close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
	Search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
	Chevron: svg('<path d="m9 6 6 6-6 6"/>'),
	ChevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
	ChevronUp: svg('<path d="m18 15-6-6-6 6"/>'),
	ChevronUpDown: svg('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
	Warning: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
	Download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
	Back: svg('<path d="m15 18-6-6 6-6"/>'),
	Forward: svg('<path d="m9 18 6-6-6-6"/>'),
	Sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
	Image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
	Video: svg('<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/>'),
	Audio: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
	Graph: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="m8.2 7.3 7.6.9M8 15.7l-1.3-7.3M16.3 10l-5.6 6.2"/>'),
	Switch: svg('<path d="M4 7h16"/><path d="m16 3 4 4-4 4"/><path d="M20 17H4"/><path d="m8 13-4 4 4 4"/>'),
	Sort: svg('<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/>'),
	Collapse: svg('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
	Trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
	Help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
	Fit: svg('<path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>'),
} as const;

/** The app's mark (an ink drop in an octagon, as in public/icon.svg), white for a coloured tile. */
/** The app's mark (as public/icon.svg, on its black tile): the octahedron of octaether.com, whose lower half is a pen nib. */
export const logoMark =
	'<svg viewBox="0 0 512 512" width="58" height="58" aria-hidden="true"><defs>' +
	'<linearGradient id="oiLogoGold" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#e6c76a"/><stop offset="0.55" stop-color="#c8a032"/><stop offset="1" stop-color="#9a7720"/></linearGradient>' +
	'<linearGradient id="oiLogoTine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8a032" stop-opacity="0.34"/><stop offset="1" stop-color="#c8a032" stop-opacity="0.08"/></linearGradient></defs>' +
	'<rect width="512" height="512" rx="112" fill="#0c0b09"/>' +
	'<path d="M84 244 256 300 256 420Z M428 244 256 300 256 420Z" fill="url(#oiLogoTine)"/>' +
	'<path d="M256 92 256 188M84 244 256 188 428 244M256 188 256 420" fill="none" stroke="#c8a032" stroke-opacity="0.26" stroke-width="7" stroke-linecap="round"/>' +
	'<path d="M256 92 84 244 256 420 428 244Z M84 244 256 300 428 244 M256 92 256 300 256 420" fill="none" stroke="url(#oiLogoGold)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>' +
	'<circle cx="256" cy="300" r="16" fill="#0c0b09" stroke="url(#oiLogoGold)" stroke-width="9"/></svg>';
