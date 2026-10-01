// Scene → SVG (+ HTML labels on top). One SVG unit = 1em, so drawings scale with the block's
// font size. Strokes use currentColor, so every theme applies. Every piece carries its source
// span (data-oi-s / data-oi-e) for click-to-edit.

import type { FormulaPiece } from './formula';
import { type Atom, type Bond, type ElectronGroup, type Molecule, edgeDistance } from './molecule';
import type { CurveArrow, PlacedArrow, PlacedText, Point, Scene } from './scene';

export interface RenderOption {
	/** Renders a label's inline text (Markdown, math) to HTML; `offset` = its source offset. */
	renderLabel(content: string, offset: number): string;
	resolveColor(value: string): string | undefined;
}

const stroke = 0.058;

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function number(value: number): string {
	return (Math.round(value * 1000) / 1000).toString();
}

function spanOf(start: number, end: number): string {
	return ` data-oi-s="${start}" data-oi-e="${end}"`;
}

/** Text with sub/superscripts as tspans (dy shifts work in every engine, unlike baseline-shift). */
function textPieces(pieceList: readonly { text: string; kind: string }[]): string {
	let shift = 0;
	let out = '';
	for (const piece of pieceList) {
		const target = piece.kind === 'Sub' ? 0.3 : piece.kind === 'Sup' ? -0.45 : 0;
		const size = piece.kind === 'Sub' || piece.kind === 'Sup' ? ' font-size="0.7"' : '';
		const dy = target - shift;
		shift = target;
		out += `<tspan${dy !== 0 ? ` dy="${number(dy)}"` : ''}${size}>${escapeXml(piece.text)}</tspan>`;
	}
	return out;
}

class Painter {
	readonly partList: string[] = [];

	constructor(
		readonly scene: Scene,
		readonly option: RenderOption,
	) {}

	/** Scene (em, y up) → SVG (em, y down). */
	point(x: number, y: number): Point {
		return { x: x - this.scene.box.minX, y: this.scene.box.maxY - y };
	}

	line(from: Point, to: Point, extra = ''): string {
		return `<line x1="${number(from.x)}" y1="${number(from.y)}" x2="${number(to.x)}" y2="${number(to.y)}"${extra}/>`;
	}

	/** Pulls a bond end back from a labelled atom so the line stops at the label's edge. */
	trim(atom: Atom, toward: Point, from: Point): Point {
		if (atom.label === '') return from;
		const dx = toward.x - from.x;
		const dy = toward.y - from.y;
		const length = Math.hypot(dx, dy) || 1;
		const cos = dx / length;
		const sin = dy / length;
		const horizontal = cos > 0 ? atom.width - atom.anchor + 0.08 : atom.anchor + 0.08;
		const distance = Math.min(Math.abs(cos) * horizontal + Math.abs(sin) * 0.52, length * 0.45);
		return { x: from.x + cos * distance, y: from.y + sin * distance };
	}

	molecule(molecule: Molecule, unit: number, dx: number, dy: number): void {
		const position = (atom: Atom): Point => this.point(atom.x * unit + dx, atom.y * unit + dy);
		for (const ring of molecule.ringList) {
			if (!ring.aromatic) continue;
			const center = this.point(ring.x * unit + dx, ring.y * unit + dy);
			this.partList.push(`<circle cx="${number(center.x)}" cy="${number(center.y)}" r="${number(ring.radius * unit)}" fill="none"${spanOf(ring.span.start, ring.span.end)}/>`);
		}
		for (const bond of molecule.bondList) if (!bond.hidden) this.bond(molecule, bond, position, unit, dx, dy);
		for (const atom of molecule.atomList) {
			const at = position(atom);
			for (const group of atom.electronList) this.electron(atom, at, group);
			if (atom.label === '' || atom.pieceList.length === 0) continue;
			this.partList.push(
				`<text class="oi-chem-atom" x="${number(at.x - atom.anchor)}" y="${number(at.y + 0.36)}"${spanOf(atom.span.start, atom.span.end)}>${textPieces(atom.pieceList)}</text>`,
			);
		}
	}

	/** A lone pair (two dots), a single electron (one dot), or a bar, just outside the atom's label. */
	electron(atom: Atom, at: Point, group: ElectronGroup): void {
		const radian = (group.angle * Math.PI) / 180;
		const ux = Math.cos(radian);
		const uy = Math.sin(radian);
		const distance = edgeDistance(atom, ux, uy) + 0.17;
		// SVG y points down; (uy, ux) is the direction across the pair
		const center = { x: at.x + ux * distance, y: at.y - uy * distance };
		const across = { x: uy, y: ux };
		const dot = (offset: number): string => `<circle cx="${number(center.x + across.x * offset)}" cy="${number(center.y + across.y * offset)}" r="0.062" fill="currentColor" stroke="none"/>`;
		const shape =
			group.kind === 'Single'
				? dot(0)
				: group.kind === 'Pair'
					? dot(0.14) + dot(-0.14)
					: this.line({ x: center.x - across.x * 0.2, y: center.y - across.y * 0.2 }, { x: center.x + across.x * 0.2, y: center.y + across.y * 0.2 });
		this.partList.push(`<g class="oi-chem-electron"${spanOf(atom.span.start, atom.span.end)}>${shape}</g>`);
	}

	bond(molecule: Molecule, bond: Bond, position: (atom: Atom) => Point, unit: number, dx: number, dy: number): void {
		const fromAtom = molecule.atomList[bond.from]!;
		const toAtom = molecule.atomList[bond.to]!;
		const a0 = position(fromAtom);
		const b0 = position(toAtom);
		const a = this.trim(fromAtom, b0, a0);
		const b = this.trim(toAtom, a0, b0);
		const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const nx = -(b.y - a.y) / length;
		const ny = (b.x - a.x) / length;
		const offset = (point: Point, distance: number): Point => ({ x: point.x + nx * distance, y: point.y + ny * distance });
		const partList: string[] = [];
		// partial bonds (transition states) and highlighted bonds
		const dash = bond.dash === 'Dashed' ? ' stroke-dasharray="0.16 0.12"' : bond.dash === 'Dotted' ? ' stroke-dasharray="0.001 0.14"' : '';
		const color = bond.color ? (/^[A-Z]/.test(bond.color) ? this.option.resolveColor(bond.color) : bond.color) : undefined;
		const style = color ? ` style="color: ${escapeXml(color)}"` : '';
		switch (bond.kind) {
			case 'Single':
				partList.push(this.line(a, b, dash));
				break;
			case 'Double': {
				if (bond.ringCenter) {
					// second line inside the ring, a little shorter
					const center = this.point(bond.ringCenter.x * unit + dx, bond.ringCenter.y * unit + dy);
					const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					const side = (center.x - middle.x) * nx + (center.y - middle.y) * ny > 0 ? 1 : -1;
					const inset = 0.16 * side;
					const shrink = (point: Point, toward: Point): Point => ({ x: point.x + (toward.x - point.x) * 0.14, y: point.y + (toward.y - point.y) * 0.14 });
					partList.push(this.line(a, b), this.line(offset(shrink(a, b), inset), offset(shrink(b, a), inset), dash));
				} else {
					// a dashed double bond is one solid line and one dashed line (delocalised)
					partList.push(this.line(offset(a, 0.075), offset(b, 0.075)), this.line(offset(a, -0.075), offset(b, -0.075), dash));
				}
				break;
			}
			case 'Triple':
				partList.push(this.line(a, b, dash), this.line(offset(a, 0.12), offset(b, 0.12), dash), this.line(offset(a, -0.12), offset(b, -0.12), dash));
				break;
			case 'WedgeFront':
			case 'WedgeBack':
			case 'HollowFront':
			case 'HollowBack': {
				const [narrow, wide] = bond.kind.endsWith('Front') ? [a, b] : [b, a];
				const fill = bond.kind.startsWith('Hollow') ? ' fill="none"' : ' fill="currentColor"';
				const pointList = [narrow, offset(wide, 0.14), offset(wide, -0.14)].map((point) => `${number(point.x)},${number(point.y)}`).join(' ');
				partList.push(`<polygon points="${pointList}"${fill} stroke-linejoin="round"/>`);
				break;
			}
			case 'DashFront':
			case 'DashBack': {
				const [narrow, wide] = bond.kind === 'DashFront' ? [a, b] : [b, a];
				const count = Math.max(4, Math.round(length / 0.16));
				for (let index = 1; index <= count; index++) {
					const share = index / count;
					const point = { x: narrow.x + (wide.x - narrow.x) * share, y: narrow.y + (wide.y - narrow.y) * share };
					partList.push(this.line(offset(point, 0.14 * share), offset(point, -0.14 * share)));
				}
				break;
			}
		}
		this.partList.push(`<g class="oi-chem-bond"${style}${spanOf(bond.span.start, bond.span.end)}>${partList.join('')}</g>`);
	}

	head(tip: Point, from: Point, kind: 'Pair' | 'Fishhook' | 'Harpoon', side = 1): string {
		const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
		const ux = (tip.x - from.x) / length;
		const uy = (tip.y - from.y) / length;
		const size = 0.32;
		const base = { x: tip.x - ux * size, y: tip.y - uy * size };
		const left = { x: base.x - uy * size * 0.45, y: base.y + ux * size * 0.45 };
		const right = { x: base.x + uy * size * 0.45, y: base.y - ux * size * 0.45 };
		const pointList = kind === 'Pair' ? [tip, left, right] : [tip, side > 0 ? left : right, base];
		return `<polygon points="${pointList.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="currentColor" stroke="none"/>`;
	}

	schemeArrow(arrow: PlacedArrow): void {
		const from = this.point(arrow.from.x, arrow.from.y);
		const to = this.point(arrow.to.x, arrow.to.y);
		const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
		const nx = -(to.y - from.y) / length;
		const ny = (to.x - from.x) / length;
		const partList: string[] = [];
		if (arrow.type === '<=>') {
			const shift = (point: Point, distance: number): Point => ({ x: point.x + nx * distance, y: point.y + ny * distance });
			const top = [shift(from, -0.09), shift(to, -0.09)] as const;
			const bottom = [shift(to, 0.09), shift(from, 0.09)] as const;
			partList.push(this.line(top[0], top[1]), this.head(top[1], top[0], 'Harpoon', 1), this.line(bottom[0], bottom[1]), this.head(bottom[1], bottom[0], 'Harpoon', 1));
		} else {
			partList.push(this.line(from, to));
			if (arrow.type === '->' || arrow.type === '<->' || arrow.type === '-/>') partList.push(this.head(to, from, 'Pair'));
			if (arrow.type === '<-' || arrow.type === '<->') partList.push(this.head(from, to, 'Pair'));
			if (arrow.type === '-/>') {
				const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
				partList.push(this.line({ x: middle.x - 0.18, y: middle.y + 0.22 }, { x: middle.x + 0.18, y: middle.y - 0.22 }));
			}
		}
		this.partList.push(`<g class="oi-chem-arrow"${spanOf(arrow.span.start, arrow.span.end)}>${partList.join('')}</g>`);
		for (const label of [arrow.above, arrow.below]) if (label) this.text(label, 'oi-chem-condition');
	}

	text(text: PlacedText, className: string): void {
		const at = this.point(text.x, text.y);
		const pieceList: readonly FormulaPiece[] = text.pieceList;
		this.partList.push(`<text class="${className}" x="${number(at.x)}" y="${number(at.y)}"${spanOf(text.span.start, text.span.end)}>${textPieces(pieceList)}</text>`);
	}

	curve(curve: CurveArrow): void {
		const from = this.point(curve.from.x, curve.from.y);
		const control1 = this.point(curve.control1.x, curve.control1.y);
		const control2 = this.point(curve.control2.x, curve.control2.y);
		const to = this.point(curve.to.x, curve.to.y);
		const color = curve.color ? this.option.resolveColor(curve.color) : undefined;
		const style = color ? ` style="color: ${escapeXml(color)}"` : '';
		const path = `<path d="M ${number(from.x)} ${number(from.y)} C ${number(control1.x)} ${number(control1.y)} ${number(control2.x)} ${number(control2.y)} ${number(to.x)} ${number(to.y)}" fill="none"/>`;
		const headList: string[] = [];
		const kind = curve.kind === 'Fishhook' ? 'Fishhook' : 'Pair';
		if (curve.head !== 'Start') headList.push(this.head(to, control2, kind));
		if (curve.head !== 'End') headList.push(this.head(from, control1, kind));
		this.partList.push(`<g class="oi-chem-curve"${style}${spanOf(curve.span.start, curve.span.end)}>${path}${headList.join('')}</g>`);
	}
}

export function renderScene(scene: Scene, option: RenderOption): string {
	const painter = new Painter(scene, option);
	for (const placed of scene.moleculeList) painter.molecule(placed.molecule, placed.unit, placed.dx, placed.dy);
	for (const text of scene.textList) painter.text(text, text.plus ? 'oi-chem-plus' : 'oi-chem-text');
	for (const arrow of scene.arrowList) painter.schemeArrow(arrow);
	for (const curve of scene.curveList) painter.curve(curve);
	const width = scene.box.maxX - scene.box.minX;
	const height = scene.box.maxY - scene.box.minY;
	const labelList = scene.labelList.map((label) => {
		const at = painter.point(label.at.x, label.at.y);
		// the scene already placed the label clear of the drawing; this only picks the edge that touches `at`
		const translate = {
			Below: 'translate(-50%, 0)',
			Above: 'translate(-50%, -100%)',
			Left: 'translate(-100%, -50%)',
			Right: 'translate(0, -50%)',
			Center: 'translate(-50%, -50%)',
		}[label.side];
		const color = label.property.get('Color');
		const resolved = typeof color === 'string' ? option.resolveColor(color) : undefined;
		return `<div class="oi-chem-label" style="left: ${number(at.x)}em; top: ${number(at.y)}em; transform: ${translate};${resolved ? ` color: ${escapeXml(resolved)};` : ''}"><div class="oi-chem-label-text">${option.renderLabel(label.content, label.contentOffset)}</div></div>`;
	});
	return (
		`<div class="oi-chem-scene" style="width: ${number(width)}em; height: ${number(height)}em">` +
		// font-size lives on the inner group: on the <svg> itself it would also shrink the em-based size
		`<svg class="oi-chem-svg" viewBox="0 0 ${number(width)} ${number(height)}" style="width: ${number(width)}em; height: ${number(height)}em" role="img" aria-label="chemical drawing">` +
		`<g stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" font-size="1">${painter.partList.join('')}</g>` +
		'</svg>' +
		labelList.join('') +
		'</div>'
	);
}
