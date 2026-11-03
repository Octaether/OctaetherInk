// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { openStructureEditor } from '../src';

const body = '\\chemfig{*6(=-=-=-)} \\+ \\chemfig{@{o}O}\nLabel o {Side: Below}: oxygen';

function open(focus?: number): { result: string[] } {
	const result: string[] = [];
	openStructureEditor({ body, focus, onDone: (text) => result.push(text) });
	return { result };
}

const button = (action: string) => document.querySelector<HTMLButtonElement>(`.oi-draw [data-action="${action}"]`)!;
const source = () => document.querySelector<HTMLTextAreaElement>('.oi-draw-source')!;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('drawing tool panel', () => {
	it('shows the whole block: its text below, arrows and labels in the faded layer', () => {
		const { result } = open();
		expect(document.querySelector('.oi-draw-title')!.textContent).toBe('Drawing');
		expect(source().value).toBe(body);
		expect(document.querySelector('.oi-draw-context .oi-chem-label')!.textContent).toBe('oxygen');
		// every structure is editable, so none is drawn faded
		expect(document.querySelector('.oi-draw-context .oi-chem-bond')).toBeNull();
		expect(button('Whole').hidden).toBe(true);
		button('Done').click();
		expect(result).toEqual([body]);
		expect(document.querySelector('.oi-draw-backdrop')).toBeNull();
	});

	it('edits the block through its text, which then edits every structure', () => {
		const { result } = open(1);
		expect(document.querySelector('.oi-draw-title')!.textContent).toBe('One structure');
		expect(document.querySelector('.oi-draw-context .oi-chem-bond')).not.toBeNull();
		source().value = `${body}\nLabel o {Side: Above}: lone pairs`;
		source().dispatchEvent(new Event('input'));
		expect(document.querySelector('.oi-draw-title')!.textContent).toBe('Drawing');
		expect(document.querySelectorAll('.oi-draw-context .oi-chem-label')).toHaveLength(2);
		button('Undo').click();
		expect(source().value).toBe(body);
		button('Redo').click();
		source().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
		expect(result).toEqual([`${body}\nLabel o {Side: Above}: lone pairs`]);
	});

	it('shows mistakes in the hint and hides the text on request', () => {
		open();
		source().value = '\\chemfig{O}\nArrow x -> o';
		source().dispatchEvent(new Event('input'));
		expect(document.querySelector('.oi-draw-text')!.textContent).toContain('unknown name');
		button('Source').click();
		expect(source().hidden).toBe(true);
		expect(button('Source').getAttribute('aria-pressed')).toBe('false');
	});

	it('Cancel and Esc leave the block as it was', () => {
		const { result } = open();
		button('Clear').click();
		document.querySelector('.oi-draw-canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(result).toEqual([]);
		expect(document.querySelector('.oi-draw-backdrop')).toBeNull();
	});

	it('Clear erases every structure but keeps arrows, text, and labels', () => {
		const { result } = open();
		button('Clear').click();
		expect(source().value).toBe('\\+\nLabel o {Side: Below}: oxygen');
		button('Done').click();
		expect(result).toEqual(['\\+\nLabel o {Side: Below}: oxygen']);
	});
});
