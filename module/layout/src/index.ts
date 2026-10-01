// Layout containers. Each container is a module block type that implements the layout
// protocol, so new layouts (Page, Canvas, Deck, Board…) plug in without core changes.
//
//   Grid:                       ← side by side; stacks when there is too little room
//   	Column {Width: 60%}:     ← each column holds any blocks
//   		…
//   	Column:
//   		…
//   Callout {Kind: Tip}: Title  ← a coloured box around blocks, like Obsidian's callouts
//   	…

import type { BlockTypeDefinition, ModuleDefinition, RenderContext, ResolvedBlock } from '@octaether/core-sdk';
import { escapeHtml } from '@octaether/core-sdk';

export const calloutKindList = ['Note', 'Info', 'Tip', 'Success', 'Question', 'Warning', 'Danger', 'Bug', 'Example', 'Quote'] as const;
export type CalloutKind = (typeof calloutKindList)[number];

/** Obsidian's callout names (and their aliases) → our kinds. */
export function calloutKind(value: unknown): CalloutKind {
	const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
	const aliasMap: Readonly<Record<string, CalloutKind>> = {
		abstract: 'Info', summary: 'Info', tldr: 'Info', todo: 'Info', hint: 'Tip', important: 'Tip', check: 'Success', done: 'Success',
		help: 'Question', faq: 'Question', caution: 'Warning', attention: 'Warning', failure: 'Danger', fail: 'Danger', missing: 'Danger', error: 'Danger', cite: 'Quote',
	};
	return calloutKindList.find((kind) => kind.toLowerCase() === text) ?? aliasMap[text] ?? 'Note';
}

const icon = (path: string): string => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

/** Small line icons, one per callout kind (drawn here so they look the same on every device). */
export const calloutIcon: Readonly<Record<CalloutKind, string>> = {
	Note: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
	Info: icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
	Tip: icon('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"/>'),
	Success: icon('<path d="M20 6 9 17l-5-5"/>'),
	Question: icon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
	Warning: icon('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
	Danger: icon('<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>'),
	Bug: icon('<rect x="8" y="6" width="8" height="14" rx="4"/><path d="m19 7-3 2"/><path d="m5 7 3 2"/><path d="M19 19l-3-2"/><path d="M5 19l3-2"/><path d="M20 13h-4"/><path d="M4 13h4"/><path d="m10 4 1 2"/><path d="m14 4-1 2"/>'),
	Example: icon('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
	Quote: icon('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'),
};

/** The colour of each kind, as a theme token (so callouts follow Light, Dark, and custom themes). */
export const calloutColor: Readonly<Record<CalloutKind, string>> = {
	Note: 'var(--oi-color-accent)',
	Info: 'var(--oi-color-accent)',
	Tip: 'var(--oi-color-success)',
	Success: 'var(--oi-color-success)',
	Question: 'var(--oi-color-warning)',
	Warning: 'var(--oi-color-warning)',
	Danger: 'var(--oi-color-danger)',
	Bug: 'var(--oi-color-danger)',
	Example: 'color-mix(in srgb, var(--oi-color-accent) 55%, var(--oi-color-danger))',
	Quote: 'var(--oi-color-text-muted)',
};

const calloutStyle = `
.oi-callout-box, .oi-frame[data-oi-type="Callout"] { --oi-callout: var(--oi-color-accent); }
${calloutKindList.map((kind) => `.oi-callout-${kind.toLowerCase()} { --oi-callout: ${calloutColor[kind]}; }`).join('\n')}
.oi-frame[data-oi-type="Callout"], .oi-callout-box { padding: 10px 14px; border-radius: 8px; border-inline-start: 3px solid var(--oi-callout); background: color-mix(in srgb, var(--oi-callout) 9%, transparent); }
.oi-callout-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--oi-callout); min-height: 1.6em; }
.oi-callout-title svg { flex: none; }
.oi-callout-fold { margin-inline-start: auto; width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--oi-callout); cursor: pointer; font: inherit; line-height: 1; }
.oi-callout-fold:hover { background: color-mix(in srgb, var(--oi-callout) 15%, transparent); }
.oi-frame[data-oi-type="Callout"] > .oi-child { margin-top: 0.4em; }
.oi-frame.oi-callout-collapsed > .oi-child { display: none; }
`;

const layoutStyle = `
.oi-frame[data-oi-type="Grid"] { container-type: inline-size; }
.oi-frame[data-oi-type="Grid"] > .oi-child { display: grid; gap: var(--oi-grid-gap, 16px); align-items: start; margin-top: 0; }
.oi-frame[data-oi-type="Grid"] > .oi-child > .oi-frame { min-width: 0; }
@container (max-width: 480px) { .oi-frame[data-oi-stack="480"] > .oi-child { grid-template-columns: 1fr !important; } }
@container (max-width: 640px) { .oi-frame[data-oi-stack="640"] > .oi-child { grid-template-columns: 1fr !important; } }
@container (max-width: 800px) { .oi-frame[data-oi-stack="800"] > .oi-child { grid-template-columns: 1fr !important; } }
.oi-frame[data-oi-type="Column"] > .oi-child, .oi-frame[data-oi-type="Flow"] > .oi-child { margin-top: 0; }
.oi-frame[data-oi-type="Column"] { min-height: 1.6em; }
.oi-layout-title { font-weight: 600; margin-bottom: 0.4em; }
.oi-layout-title:empty { display: none; }
${calloutStyle}
`;

/** Containers show their own inline text (`Column: Title`) as a small title. */
function titleRenderer(): BlockTypeDefinition['render'] {
	return {
		mount(frame, block) {
			const draw = (body: string): void => {
				frame.innerHTML = body ? `<div class="oi-layout-title" data-oi-s="0"></div>` : '';
				const title = frame.firstElementChild;
				if (title) title.textContent = body;
			};
			draw(block.body);
			return {
				update(next) {
					draw(next.body);
					return 'Done';
				},
			};
		},
	};
}

const flowArrange = { coordinate: 'Flow' as const, childPropertyList: ['Width', 'Align', 'Margin', 'Break'], arrange(area: HTMLElement) { area.classList.add('oi-flow'); } };

const flowType: BlockTypeDefinition = { name: 'Flow', content: 'Item', render: titleRenderer(), layout: flowArrange };

const columnType: BlockTypeDefinition = {
	name: 'Column',
	content: 'Item',
	render: titleRenderer(),
	layout: flowArrange,
	templateList: [{ title: 'Column', icon: '▯', source: 'Column:\n\t', keywordList: ['column'], explain: 'One column; add more beside it from its menu' }],
};

function drawCallout(frame: HTMLElement, block: ResolvedBlock, context: RenderContext): void {
	const kind = calloutKind(block.property.get('Kind'));
	const collapsed = block.property.get('Collapsed') === true;
	const title = block.body.trim();
	frame.innerHTML =
		`<div class="oi-callout-title">${calloutIcon[kind]}<span class="oi-callout-text"${title ? ' data-oi-s="0"' : ''}>${escapeHtml(title || kind)}</span>` +
		`<button type="button" class="oi-callout-fold" data-oi-interactive title="${collapsed ? 'Expand' : 'Collapse'}" aria-label="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button></div>`;
	frame.querySelector('.oi-callout-fold')!.addEventListener('click', () => context.setProperty('Collapsed', collapsed ? undefined : true));
}

/** A coloured box around blocks (Note, Tip, Warning, …), like Obsidian's callouts; its text is the title. */
const calloutType: BlockTypeDefinition = {
	name: 'Callout',
	content: 'Item',
	render: {
		mount(frame, block, context) {
			drawCallout(frame, block, context);
			return {
				update(next, nextContext) {
					drawCallout(frame, next, nextContext);
					return 'Done';
				},
			};
		},
	},
	edit: { kind: 'InlineText' },
	layout: flowArrange,
	frameClassList: (block) => [`oi-callout-${calloutKind(block.property.get('Kind')).toLowerCase()}`, ...(block.property.get('Collapsed') === true ? ['oi-callout-collapsed'] : [])],
	templateList: [
		{ title: 'Callout', icon: '❗', source: 'Callout {Kind: Note}:\n\tWrite inside the callout.', keywordList: ['box', 'note', 'admonition', 'container', 'group'], explain: 'A coloured box around blocks, like Obsidian’s callouts' },
		{ title: 'Callout: Tip', icon: '💡', source: 'Callout {Kind: Tip}:\n\t', keywordList: ['hint', 'box'] },
		{ title: 'Callout: Warning', icon: '⚠', source: 'Callout {Kind: Warning}:\n\t', keywordList: ['caution', 'box'] },
	],
	plainText: (block) => block.body,
};

/** Side by side. Each column's `Width` sets its share (`60%` → proportional, `240px` → fixed). */
const gridType: BlockTypeDefinition = {
	name: 'Grid',
	content: 'Item',
	style: layoutStyle,
	render: titleRenderer(),
	layout: {
		coordinate: 'Flow',
		childPropertyList: ['Width'],
		arrange(area, container, childList, context) {
			area.style.setProperty('--oi-grid-gap', context.resolveLength(container.property.get('Gap')) ?? '16px');
			// the columns stack once the grid is narrower than the chosen width
			const stack = String(context.setting('Layout.StackWidth') ?? '640px');
			const frame = area.parentElement;
			if (frame) {
				if (stack === 'Never') delete frame.dataset.oiStack;
				else frame.dataset.oiStack = String(Number.parseInt(stack, 10) || 640);
			}
			const shareList = childList.map((child) => {
				const width = child.property.get('Width');
				return typeof width === 'string' && /^\d+(?:\.\d+)?%$/.test(width) ? parseFloat(width) : undefined;
			});
			const givenList = shareList.filter((share) => share !== undefined);
			// a column without a Width gets the average share, never a sliver beside "50%" columns
			const average = givenList.length > 0 ? givenList.reduce((sum, share) => sum + share, 0) / givenList.length : 1;
			const columnList = childList.map((child, index) => {
				// the grid reads Width as the column size, so the frame itself fills its cell
				child.element.style.removeProperty('width');
				const share = shareList[index];
				if (share !== undefined) return `minmax(0, ${share}fr)`;
				const length = context.resolveLength(child.property.get('Width'));
				return length && length !== 'auto' ? length : `minmax(0, ${average}fr)`;
			});
			area.style.gridTemplateColumns = columnList.join(' ') || '1fr';
		},
	},
	templateList: [
		{ title: 'Two columns', icon: '▥', source: 'Grid:\n\tColumn:\n\t\tLeft\n\tColumn:\n\t\tRight', keywordList: ['grid', 'column', 'side by side'], explain: 'Blocks side by side; stacks on phones' },
		{ title: 'Three columns', icon: '▦', source: 'Grid:\n\tColumn:\n\t\tOne\n\tColumn:\n\t\tTwo\n\tColumn:\n\t\tThree', keywordList: ['grid', 'column'] },
	],
};

export const layoutModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Layout',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Layout',
	explain: 'Blocks that hold blocks: Grid with Columns (side by side, stacks on narrow screens) and Callout (a coloured box with a title, like Obsidian’s callouts). Always on.',
	core: true,
	settingList: [
		{
			id: 'Layout.StackWidth',
			title: 'Stack columns below',
			type: 'Choice',
			choiceList: ['480px', '640px', '800px', 'Never'],
			default: '640px',
			explain: 'Columns sit on top of each other when the grid is narrower than this, so text never gets squeezed on a phone.',
		},
	],
	blockTypeList: [flowType, gridType, columnType, calloutType],
};
