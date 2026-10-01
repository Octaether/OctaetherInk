// Envelope (reserved block properties) → CSS. Every value is validated; unknown values are ignored.

import type { PropertyMap, PropertyValue } from '@octaether/core-format';
import { isLengthText } from './theme';

export function resolveLength(value: PropertyValue | undefined): string | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`;
	if (typeof value !== 'string') return undefined;
	const text = value.trim();
	if (text === 'Auto') return 'auto';
	return isLengthText(text) ? text : undefined;
}

function resolveSpacing(value: PropertyValue | undefined): string | undefined {
	if (Array.isArray(value)) {
		const partList = value.slice(0, 4).map((item) => resolveLength(item));
		return partList.every((part) => part !== undefined) && partList.length > 0 ? partList.join(' ') : undefined;
	}
	return resolveLength(value);
}

const fontTokenSet = new Set(['Body', 'Math', 'Code']);
const fontPattern = /^[\p{L}\p{N}\s,'"._-]+$/u;
const alignMap: Readonly<Record<string, string>> = { Start: 'start', Center: 'center', End: 'end', Justify: 'justify' };
const borderStyleSet = new Set(['Solid', 'Dashed', 'Dotted', 'Double', 'None']);

export interface EnvelopeStyle {
	/** CSS declarations for the block frame. */
	frame: Map<string, string>;
	/** CSS declarations for the content inside the frame. */
	content: Map<string, string>;
	presetList: string[];
}

export interface EnvelopeOption {
	resolveColor(value: string): string | undefined;
	/** `Fixed` parents (Page, Canvas, Slide) honour Position/X/Y/Layer/Rotate. */
	parentCoordinate: 'Flow' | 'Fixed';
}

export function envelopeStyle(property: PropertyMap, option: EnvelopeOption): EnvelopeStyle {
	const frame = new Map<string, string>();
	const content = new Map<string, string>();
	const text = (key: string): string | undefined => {
		const value = property.get(key);
		return typeof value === 'string' ? value : undefined;
	};
	const color = (key: string, css: string): void => {
		const value = text(key);
		const resolved = value === undefined ? undefined : option.resolveColor(value);
		if (resolved) frame.set(css, resolved);
	};
	const length = (key: string, css: string, target = frame): void => {
		const resolved = key === 'Padding' || key === 'Margin' ? resolveSpacing(property.get(key)) : resolveLength(property.get(key));
		if (resolved) target.set(css, resolved);
	};

	color('Color', 'color');
	color('Background', 'background');
	const font = text('Font');
	if (font !== undefined) {
		if (fontTokenSet.has(font)) frame.set('font-family', `var(--oi-font-${font.toLowerCase()})`);
		else if (fontPattern.test(font)) frame.set('font-family', font);
	}
	length('Size', 'font-size');
	const weight = property.get('Weight');
	if (typeof weight === 'number' && weight >= 100 && weight <= 900) frame.set('font-weight', String(Math.round(weight)));
	else if (weight === 'Bold' || weight === 'Normal') frame.set('font-weight', weight.toLowerCase());
	if (property.get('Italic') === true) frame.set('font-style', 'italic');
	if (property.get('Underline') === true) frame.set('text-decoration', 'underline');
	const lineHeight = property.get('LineHeight');
	if (typeof lineHeight === 'number' && lineHeight > 0 && lineHeight < 10) frame.set('line-height', String(lineHeight));
	else length('LineHeight', 'line-height');
	const opacity = property.get('Opacity');
	if (typeof opacity === 'number' && opacity >= 0 && opacity <= 1) frame.set('opacity', String(opacity));
	const textAlign = alignMap[text('TextAlign') ?? ''];
	if (textAlign) content.set('text-align', textAlign);
	length('Padding', 'padding');
	length('Margin', 'margin');
	length('Width', 'width');
	length('Height', 'height');
	length('Radius', 'border-radius');
	// Left and Right read as Start and End (a picture's {Align: Left})
	const align = text('Align');
	if (align === 'Left' || align === 'Start') frame.set('margin-inline-end', 'auto');
	else if (align === 'Center') {
		frame.set('margin-inline-start', 'auto');
		frame.set('margin-inline-end', 'auto');
	} else if (align === 'End' || align === 'Right') frame.set('margin-inline-start', 'auto');
	else if (align === 'Stretch') frame.set('width', '100%');
	const border = property.get('Border');
	if (border instanceof Map) {
		const width = resolveLength(border.get('Width')) ?? '1px';
		const styleValue = border.get('Style');
		const style = typeof styleValue === 'string' && borderStyleSet.has(styleValue) ? styleValue.toLowerCase() : 'solid';
		const colorValue = border.get('Color');
		const borderColor = typeof colorValue === 'string' ? option.resolveColor(colorValue) : 'var(--oi-color-border)';
		frame.set('border', `${width} ${style} ${borderColor ?? 'var(--oi-color-border)'}`);
	}
	if (property.get('Hidden') === true) frame.set('display', 'none');
	if (option.parentCoordinate === 'Fixed') {
		if (text('Position') !== 'Flow') {
			frame.set('position', 'absolute');
			length('X', 'left');
			length('Y', 'top');
		}
		const layer = property.get('Layer');
		if (typeof layer === 'number' && Number.isInteger(layer)) frame.set('z-index', String(layer));
		const rotate = property.get('Rotate');
		if (typeof rotate === 'number' && Number.isFinite(rotate)) frame.set('transform', `rotate(${rotate}deg)`);
	}
	const preset = property.get('Preset');
	const presetList = (Array.isArray(preset) ? preset : [preset]).filter(
		(item): item is string => typeof item === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(item),
	);
	return { frame, content, presetList };
}

export function kebab(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
