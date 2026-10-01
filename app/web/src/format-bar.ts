// Floating format bar over selected text (in the rendered view or in the block editor).

import type { EditSession, FormatKind } from '@octaether/core-edit';
import type { NoteModel } from '@octaether/core-model';

export interface FormatBarOption {
	session: EditSession;
	model(): NoteModel | undefined;
	format(kind: FormatKind): void;
	color(x: number, y: number): void;
	hotkey(command: string): string;
}

const buttonList: readonly { kind: FormatKind | 'Color'; label: string; title: string; command: string }[] = [
	{ kind: 'Bold', label: '<b>B</b>', title: 'Bold', command: 'Format.Bold' },
	{ kind: 'Italic', label: '<i>I</i>', title: 'Italic', command: 'Format.Italic' },
	{ kind: 'Strike', label: '<s>S</s>', title: 'Strikethrough', command: 'Format.Strike' },
	{ kind: 'Highlight', label: '<mark>H</mark>', title: 'Highlight', command: 'Format.Highlight' },
	{ kind: 'Code', label: '<code>&lt;/&gt;</code>', title: 'Inline code', command: 'Format.Code' },
	{ kind: 'Math', label: '∑', title: 'Inline math', command: 'Format.Math' },
	{ kind: 'Link', label: '🔗', title: 'Link', command: 'Format.Link' },
	{ kind: 'Color', label: '<span class="format-color">A</span>', title: 'Colour', command: 'Format.Color' },
];

export function setupFormatBar(option: FormatBarOption): () => void {
	const bar = document.createElement('div');
	bar.className = 'format-bar';
	bar.dataset.oiKeepEditor = '';
	bar.hidden = true;
	bar.setAttribute('role', 'toolbar');
	bar.setAttribute('aria-label', 'Format');
	bar.innerHTML = buttonList
		.map((button) => `<button type="button" data-kind="${button.kind}" title="${button.title}${option.hotkey(button.command) ? ` (${option.hotkey(button.command)})` : ''}" aria-label="${button.title}">${button.label}</button>`)
		.join('');
	document.getElementById('layer')!.append(bar);
	for (const element of bar.querySelectorAll<HTMLButtonElement>('button')) {
		// keep the selection where it is
		element.addEventListener('pointerdown', (event) => event.preventDefault());
		element.addEventListener('click', () => {
			const kind = element.dataset.kind as FormatKind | 'Color';
			if (kind === 'Color') {
				const rect = element.getBoundingClientRect();
				option.color(rect.left, rect.bottom + 4);
			} else option.format(kind);
			window.requestAnimationFrame(update);
		});
	}

	let frame = 0;
	const update = (): void => {
		frame = 0;
		const range = option.session.textRange();
		const node = range ? option.model()?.get(range.key) : undefined;
		if (!range || range.start === range.end || node?.type !== 'Text') {
			bar.hidden = true;
			return;
		}
		let rect: DOMRect | undefined;
		if (range.source === 'View') {
			const selection = document.getSelection();
			rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
		} else {
			rect = option.session.activeTextarea()?.getBoundingClientRect();
		}
		if (!rect) {
			bar.hidden = true;
			return;
		}
		bar.hidden = false;
		const width = bar.offsetWidth;
		const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), document.documentElement.clientWidth - width - 8);
		const top = rect.top - bar.offsetHeight - 8;
		bar.style.left = `${left}px`;
		bar.style.top = `${top < 8 ? rect.bottom + 8 : top}px`;
	};
	const schedule = (): void => {
		if (frame === 0) frame = window.requestAnimationFrame(update);
	};
	document.addEventListener('selectionchange', schedule);
	document.addEventListener('keyup', schedule);
	document.addEventListener('pointerup', schedule);
	document.getElementById('viewContent')?.addEventListener('scroll', () => {
		bar.hidden = true;
	}, { passive: true });
	return schedule;
}
