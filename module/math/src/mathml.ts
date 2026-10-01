// MathNode → MathML Core. Every element carries data-oi-s / data-oi-e source offsets.

import type { MathNode } from './parse';

export interface EmitOption {
	display: boolean;
	resolveColor(value: string): string | undefined;
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function span(node: MathNode): string {
	return ` data-oi-s="${node.span.start}" data-oi-e="${node.span.end}"`;
}

function isFunction(node: MathNode): boolean {
	if (node.kind === 'Identifier') return node.function === true;
	if (node.kind === 'Script') return isFunction(node.base);
	return false;
}

function fence(text: string, form: 'prefix' | 'postfix' | 'infix'): string {
	return text === '' ? '' : `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${escapeXml(text)}</mo>`;
}

class Emitter {
	constructor(readonly option: EmitOption) {}

	node(node: MathNode): string {
		switch (node.kind) {
			case 'Row': {
				if (node.childList.length === 1) return this.node(node.childList[0]!);
				let inner = '';
				node.childList.forEach((child, index) => {
					inner += this.node(child);
					// U+2061 FUNCTION APPLICATION gives "sin x" its proper spacing
					if (isFunction(child) && index < node.childList.length - 1) inner += '<mo>&#x2061;</mo>';
				});
				return `<mrow${span(node)}>${inner}</mrow>`;
			}
			case 'Identifier': {
				const normal = node.normal && [...node.text].length === 1 ? ' mathvariant="normal"' : '';
				return `<mi${span(node)}${normal}>${escapeXml(node.text)}</mi>`;
			}
			case 'Number':
				return `<mn${span(node)}>${escapeXml(node.text)}</mn>`;
			case 'Operator': {
				let attribute = '';
				if (node.stretchy !== undefined) attribute += ` stretchy="${node.stretchy}"`;
				if (node.large) attribute += ' largeop="true" movablelimits="false"';
				if (node.size) attribute += ` symmetric="true" minsize="${node.size}" maxsize="${node.size}"`;
				if (node.fence === 'Middle') attribute += ' fence="true" form="infix"';
				return `<mo${span(node)}${attribute}>${escapeXml(node.text)}</mo>`;
			}
			case 'Text': {
				const style = [node.bold ? 'font-weight: bold' : '', node.italic ? 'font-style: italic' : ''].filter(Boolean).join('; ');
				return `<mtext${span(node)}${style ? ` style="${style}"` : ''}>${escapeXml(node.text)}</mtext>`;
			}
			case 'Space':
				return `<mspace${span(node)} width="${node.width}"></mspace>`;
			case 'Script':
				return this.script(node);
			case 'Fraction': {
				const thickness = node.thickness !== undefined ? ` linethickness="${node.thickness}"` : '';
				const fraction = `<mfrac${span(node)}${thickness}>${this.wrap(node.numerator)}${this.wrap(node.denominator)}</mfrac>`;
				return node.display === undefined ? fraction : `<mstyle displaystyle="${node.display}">${fraction}</mstyle>`;
			}
			case 'Root':
				return node.index
					? `<mroot${span(node)}>${this.wrap(node.base)}${this.wrap(node.index)}</mroot>`
					: `<msqrt${span(node)}>${this.node(node.base)}</msqrt>`;
			case 'Accent': {
				const accent = `<mo stretchy="${node.stretchy}">${escapeXml(node.accent)}</mo>`;
				return node.under
					? `<munder${span(node)} accentunder="true">${this.wrap(node.base)}${accent}</munder>`
					: `<mover${span(node)} accent="true">${this.wrap(node.base)}${accent}</mover>`;
			}
			case 'Fenced':
				return `<mrow${span(node)}>${fence(node.open, 'prefix')}${this.node(node.child)}${fence(node.close, 'postfix')}</mrow>`;
			case 'Table':
				return this.table(node);
			case 'Style': {
				if (node.display !== undefined) return `<mstyle${span(node)} displaystyle="${node.display}">${this.node(node.child)}</mstyle>`;
				if (node.box) return `<mrow${span(node)} style="border: 1px solid currentColor; padding: 0.15em 0.3em">${this.node(node.child)}</mrow>`;
				const color = node.color !== undefined ? this.option.resolveColor(node.color) : undefined;
				const style = color ? ` style="color: ${escapeXml(color)}"` : '';
				return `<mrow${span(node)}${style}>${this.node(node.child)}</mrow>`;
			}
			case 'Phantom':
				return `<mphantom${span(node)}>${this.node(node.child)}</mphantom>`;
			case 'Error':
				return `<mtext${span(node)} class="oi-math-error" title="${escapeXml(node.message)}">${escapeXml(node.text)}</mtext>`;
		}
	}

	/** Children of fixed-arity elements must be exactly one element; every node emits exactly one. */
	private wrap(node: MathNode): string {
		return this.node(node);
	}

	private script(node: Extract<MathNode, { kind: 'Script' }>): string {
		const under = node.limit === 'Always' || (node.limit === 'Display' && this.option.display);
		const base = this.wrap(node.base);
		const sub = node.sub ? this.wrap(node.sub) : '';
		const sup = node.sup ? this.wrap(node.sup) : '';
		if (node.sub && node.sup) {
			const tag = under ? 'munderover' : 'msubsup';
			return `<${tag}${span(node)}>${base}${sub}${sup}</${tag}>`;
		}
		const tag = node.sub ? (under ? 'munder' : 'msub') : under ? 'mover' : 'msup';
		return `<${tag}${span(node)}>${base}${sub}${sup}</${tag}>`;
	}

	private table(node: Extract<MathNode, { kind: 'Table' }>): string {
		const rowText = node.rowList
			.map((cellList) => {
				const cellText = cellList
					.map((cell, index) => {
						const align = node.columnAlignList[index] ?? 'center';
						let padding = '';
						if (node.spacing === 'Align') padding = index % 2 === 0 ? 'padding-inline-end: 0' : 'padding-inline-start: 0';
						return `<mtd style="text-align: ${align}${padding ? `; ${padding}` : ''}">${this.node(cell)}</mtd>`;
					})
					.join('');
				return `<mtr>${cellText}</mtr>`;
			})
			.join('');
		const display = node.spacing === 'Matrix' ? '' : ' displaystyle="true"';
		const table = `<mtable${span(node)}${display} class="oi-math-table-${node.spacing.toLowerCase()}">${rowText}</mtable>`;
		if (!node.open && !node.close) return table;
		return `<mrow>${fence(node.open, 'prefix')}${table}${fence(node.close, 'postfix')}</mrow>`;
	}
}

export function toMathML(root: MathNode, option: EmitOption): string {
	const display = option.display ? ' display="block"' : '';
	return `<math class="oi-math"${display}>${new Emitter(option).node(root)}</math>`;
}
