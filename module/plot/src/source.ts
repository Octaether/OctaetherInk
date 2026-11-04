// The data layer's edits: every change the editing layer makes (a line typed, a color, a slider's
// range, a value, a dragged point) is one of these functions of the block's text, so the text stays
// the one truth and each change is one undo step.

import { type PropertyValue, formatInline } from '@octaether/core-format';
import { splitStyle } from './parse';

/** A number as written back: as short as it can be without changing it. */
export function numberText(value: number): string {
	return String(Number(value.toPrecision(10)));
}

export function setLine(body: string, index: number, text: string): string {
	const lineList = body.split('\n');
	if (index >= lineList.length) lineList.push(text);
	else lineList[index] = text;
	return lineList.join('\n');
}

/** A new line after `index` (-1: first). */
export function insertLine(body: string, index: number, text: string): string {
	if (body === '') return text;
	const lineList = body.split('\n');
	lineList.splice(index + 1, 0, text);
	return lineList.join('\n');
}

export function removeLine(body: string, index: number): string {
	const lineList = body.split('\n');
	lineList.splice(index, 1);
	return lineList.join('\n');
}

/** A line's style with one setting changed (undefined removes it): `y = x {Color: Accent}`. */
export function setLineStyle(body: string, index: number, key: string, value: PropertyValue | undefined): string {
	const line = body.split('\n')[index];
	if (line === undefined) return body;
	const indent = /^\s*/.exec(line)![0];
	const { expression, style } = splitStyle(line);
	const next = new Map(style);
	if (value === undefined) next.delete(key);
	else next.set(key, value);
	return setLine(body, index, `${indent}${expression.trim()}${next.size ? ` ${formatInline(next)}` : ''}`);
}

/** Text replaced at places in the body (each `start`–`end`), the last first so the others stay put. */
export function replaceSpan(body: string, changeList: readonly { start: number; end: number; text: string }[]): string {
	let next = body;
	for (const change of [...changeList].sort((a, b) => b.start - a.start)) next = next.slice(0, change.start) + change.text + next.slice(change.end);
	return next;
}

/** A slider's range and step (no step: any value). */
export function setSliderRange(body: string, index: number, min: number, max: number, step: number | undefined): string {
	const low = Math.min(min, max);
	const high = Math.max(min, max);
	return setLineStyle(body, index, 'Slider', step !== undefined && step > 0 ? [low, high, step] : [low, high]);
}
