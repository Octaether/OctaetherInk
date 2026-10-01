// @vitest-environment happy-dom
import { NoteModel } from '@octaether/core-model';
import { Registry, RenderHost, ThemeRegistry } from '@octaether/core-render';
import { textModule } from '@octaether/module-text';
import { describe, expect, it } from 'vitest';
import {
	convert,
	dateTimeInput,
	dateTimeValue,
	entryList,
	guessKind,
	kindOf,
	moveKey,
	moveListItem,
	openPropertyForm,
	propertyModule,
	readTyped,
	renameKey,
	setValue,
} from '../src';

const body = 'Tag: [Organic, Lab]\n# kept as it is\nDue: 2026-10-05\nDone: False\nCredit: 3';

describe('Property body', () => {
	it('knows the kind of each value (the basic types of YAML)', () => {
		expect(entryList(body).map(([key, value]) => `${key}:${kindOf(value)}`)).toEqual(['Tag:List', 'Due:Date', 'Done:Checkbox', 'Credit:Number']);
		expect(kindOf('2026-10-12 09:00 -04:00')).toBe('DateTime');
		expect(kindOf('CHEM 2310')).toBe('Text');
		expect(kindOf(null)).toBe('Text');
		expect(guessKind('tag')).toBe('List');
		expect(guessKind('Due')).toBe('Date');
		expect(guessKind('Course')).toBe('Text');
	});

	it('changes one line and keeps every other line, comments included', () => {
		expect(setValue(body, 'Done', true)).toBe('Tag: [Organic, Lab]\n# kept as it is\nDue: 2026-10-05\nDone: True\nCredit: 3');
		expect(setValue(body, 'Course', 'CHEM 2310')).toBe(`${body}\nCourse: CHEM 2310`);
		expect(setValue(body, 'Due', undefined)).toBe('Tag: [Organic, Lab]\n# kept as it is\nDone: False\nCredit: 3');
		// text that looks like a number stays text
		expect(setValue('', 'Room', '12')).toBe('Room: "12"');
		expect(renameKey(body, 'Due', 'Deadline')).toContain('Deadline: 2026-10-05');
		expect(renameKey(body, 'Due', 'Tag')).toBe(body);
	});

	it('reorders properties and list items', () => {
		expect(entryList(moveKey(body, 'Credit', 0)).map(([key]) => key)).toEqual(['Credit', 'Tag', 'Due', 'Done']);
		expect(entryList(moveKey(body, 'Tag', 9)).map(([key]) => key)).toEqual(['Due', 'Done', 'Credit', 'Tag']);
		expect(moveListItem(body, 'Tag', 1, 0)).toContain('Tag: [Lab, Organic]');
	});

	it('converts between kinds and reads typed input', () => {
		expect(convert('Organic, Lab', 'List')).toEqual(['Organic', 'Lab']);
		expect(convert(['a', 'b'], 'Text')).toBe('a, b');
		expect(convert('yes', 'Checkbox')).toBe(true);
		expect(convert('3.5', 'Number')).toBe(3.5);
		expect(convert('soon', 'Number')).toBe(0);
		expect(readTyped('12', 'Text')).toBe('12');
		expect(readTyped('12', 'Number')).toBe(12);
		expect(readTyped('a, b', 'List')).toEqual(['a', 'b']);
		expect(dateTimeInput('2026-10-12 09:00 -04:00')).toEqual({ input: '2026-10-12T09:00', offset: '-04:00' });
		expect(dateTimeValue('2026-10-12T10:30', '-04:00')).toBe('2026-10-12 10:30 -04:00');
	});
});

describe('Property block', () => {
	function mount(text: string) {
		document.body.innerHTML = '<div id="note"></div>';
		const registry = new Registry();
		registry.add(textModule, true);
		registry.add(propertyModule, true);
		const model = NoteModel.fromText(text, registry.formatOption());
		const host = new RenderHost(document.getElementById('note')!, registry, new ThemeRegistry());
		host.mount(model);
		const frame = document.querySelector<HTMLElement>('#note .oi-frame[data-oi-type="Property"]')!;
		return { model, host, frame };
	}

	it('shows each property as a row with an editor for its type', () => {
		const { frame } = mount(`Property:\n\t${body.split('\n').join('\n\t')}\n`);
		expect([...frame.querySelectorAll<HTMLElement>('.oi-property-row')].map((row) => `${row.dataset.key}:${row.dataset.kind}`)).toEqual(['Tag:List', 'Due:Date', 'Done:Checkbox', 'Credit:Number']);
		expect([...frame.querySelectorAll('.oi-pill')].map((pill) => pill.firstChild!.textContent)).toEqual(['Organic', 'Lab']);
		expect(frame.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-10-05');
		expect(frame.querySelector('.oi-pill-add')!.textContent).toBe('+');
	});

	it('edits a tag in place, adds one with +, and writes the note', () => {
		const { model, frame } = mount('Property:\n\tTag: [Organic, Lab]\n');
		frame.querySelector<HTMLElement>('.oi-pill')!.click();
		const input = frame.querySelector<HTMLInputElement>('.oi-pill-input')!;
		expect(input.value).toBe('Organic');
		input.value = 'Organic chemistry';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(model.serialize()).toBe('Property:\n\tTag: [Organic chemistry, Lab]\n');
		// Enter moves on to a new pill, as in Obsidian
		const next = frame.querySelector<HTMLInputElement>('.oi-pill-input')!;
		next.value = '#Exam';
		next.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(model.serialize()).toBe('Property:\n\tTag: [Organic chemistry, Lab, Exam]\n');
		frame.querySelector<HTMLInputElement>('.oi-pill-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(frame.querySelector('.oi-pill-input')).toBeNull();
		// every change is one step back
		model.undo();
		expect(model.serialize()).toBe('Property:\n\tTag: [Organic chemistry, Lab]\n');
	});

	it('adds a property of a chosen type from the form', () => {
		const { model, frame } = mount('Property:\n');
		// an empty block opens with the form
		const name = frame.querySelector<HTMLInputElement>('.oi-property-new')!;
		name.value = 'Due';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		expect(frame.querySelector<HTMLSelectElement>('.oi-property-new-kind')!.value).toBe('Date');
		name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(model.serialize()).toMatch(/^Property:\n\tDue: \d{4}-\d{2}-\d{2}\n$/);
		expect(frame.querySelector('.oi-property-form')).toBeNull();
		// the app's Add property command opens the form again
		expect(openPropertyForm(frame)).toBe(true);
		expect(frame.querySelector('.oi-property-form')).not.toBeNull();
	});

	it('changes a value, a name, and a type', () => {
		const { model, frame } = mount('Property:\n\tCourse: CHEM\n\tDone: False\n');
		const course = frame.querySelector<HTMLInputElement>('.oi-property-input')!;
		course.value = 'CHEM 2310';
		course.dispatchEvent(new Event('change', { bubbles: true }));
		const done = frame.querySelector<HTMLInputElement>('.oi-property-check')!;
		done.checked = true;
		done.dispatchEvent(new Event('change', { bubbles: true }));
		expect(model.serialize()).toBe('Property:\n\tCourse: CHEM 2310\n\tDone: True\n');
		const key = frame.querySelector<HTMLInputElement>('.oi-property-key')!;
		key.value = 'Class';
		key.dispatchEvent(new Event('change', { bubbles: true }));
		expect(model.serialize()).toBe('Property:\n\tClass: CHEM 2310\n\tDone: True\n');
		frame.querySelector<HTMLElement>('.oi-property-row[data-key="Class"] .oi-property-kind')!.click();
		frame.querySelector<HTMLElement>('[data-kind-choice="List"]')!.click();
		expect(model.serialize()).toBe('Property:\n\tClass: [CHEM 2310]\n\tDone: True\n');
	});

	it('shows values without controls in the Read view', () => {
		const { host, frame } = mount('Property:\n\tTag: [Organic]\n\tDone: True\n');
		host.setReadOnly(true);
		expect(frame.querySelector('input:not([disabled]), button')).toBeNull();
		expect(frame.querySelector<HTMLElement>('.oi-pill')!.dataset.oiTag).toBe('Organic');
	});
});
