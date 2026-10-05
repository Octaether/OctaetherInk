// Diagram → SVG (+ HTML node labels). 1 cm = 2.36 em, so drawings scale with the block's font
// size. Default color is currentColor (follows the theme). Every item carries its source span.

import type { Diagram, DiagramNode, DiagramPath, PathCommand, Point, Style } from './tikz';

export interface DiagramRenderOption {
	/** Size factor (a module setting); 1 = 1 cm per 2.36 em. */
	scale?: number;
	renderLabel(content: string, offset: number): string;
	resolveColor(value: string): string | undefined;
}

const baseEmPerCm = 2.36;

function number(value: number): string {
	return (Math.round(value * 1000) / 1000).toString();
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function renderDiagram(diagram: Diagram, option: DiagramRenderOption): string {
	const emPerCm = baseEmPerCm * (option.scale ?? 1);
	const { box } = diagram;
	const map = (x: number, y: number): Point => ({ x: (x - box.minX) * emPerCm, y: (box.maxY - y) * emPerCm });
	const color = (value: string | undefined): string | undefined => {
		if (!value) return undefined;
		if (/^[A-Z]/.test(value)) return option.resolveColor(value);
		return value;
	};
	const strokeWidth = (style: Style): number => Math.max(style.width * 0.083, 0.035);

	const pathData = (commandList: readonly PathCommand[]): string => {
		const partList: string[] = [];
		for (const command of commandList) {
			if (command.kind === 'Z') {
				partList.push('Z');
				continue;
			}
			const point = map(command.x, command.y);
			if (command.kind === 'M' || command.kind === 'L') partList.push(`${command.kind} ${number(point.x)} ${number(point.y)}`);
			else if (command.kind === 'C') {
				const first = map(command.x1, command.y1);
				const second = map(command.x2, command.y2);
				partList.push(`C ${number(first.x)} ${number(first.y)} ${number(second.x)} ${number(second.y)} ${number(point.x)} ${number(point.y)}`);
			} else if (command.kind === 'A') {
				// counterclockwise in maths (y up) is sweep 0 on screen (y down)
				partList.push(`A ${number(command.rx * emPerCm)} ${number(command.ry * emPerCm)} 0 ${command.large ? 1 : 0} ${command.counterclockwise ? 0 : 1} ${number(point.x)} ${number(point.y)}`);
			}
		}
		return partList.join(' ');
	};

	const head = (tip: Point, from: Point, size: number, fill: string): string => {
		const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
		const ux = (tip.x - from.x) / length;
		const uy = (tip.y - from.y) / length;
		const base = { x: tip.x - ux * size, y: tip.y - uy * size };
		const pointList = [tip, { x: base.x - uy * size * 0.5, y: base.y + ux * size * 0.5 }, { x: base.x + uy * size * 0.5, y: base.y - ux * size * 0.5 }];
		return `<polygon points="${pointList.map((point) => `${number(point.x)},${number(point.y)}`).join(' ')}" fill="${fill}" stroke="none"/>`;
	};

	const drawnPoint = (command: PathCommand, previous: Point): { point: Point; toward: Point } | undefined => {
		if (command.kind === 'Z') return undefined;
		const point = map(command.x, command.y);
		if (command.kind === 'C') return { point, toward: map(command.x2, command.y2) };
		return { point, toward: previous };
	};

	const pathElement = (path: DiagramPath): string => {
		const stroke = color(path.style.stroke);
		const fill = color(path.style.fill);
		const width = strokeWidth(path.style);
		const dash = path.style.dash === 'Dashed' ? ` stroke-dasharray="${number(width * 6)} ${number(width * 4)}"` : path.style.dash === 'Dotted' ? ` stroke-dasharray="0.001 ${number(width * 3.5)}" stroke-linecap="round"` : '';
		const opacity = path.style.opacity !== undefined ? ` opacity="${number(path.style.opacity)}"` : '';
		let out = `<path d="${pathData(path.commandList)}" fill="${fill ? escapeXml(fill) : 'none'}" stroke="${stroke ? escapeXml(stroke) : 'none'}" stroke-width="${number(width)}"${dash}${opacity}/>`;
		// arrow tips at the first and last drawn points
		const drawable = path.commandList.filter((command) => command.kind !== 'Z');
		if (stroke && drawable.length >= 2 && (path.style.arrowStart || path.style.arrowEnd)) {
			const size = Math.max(width * 5, 0.28);
			if (path.style.arrowEnd) {
				const last = drawnPoint(drawable[drawable.length - 1]!, map((drawable[drawable.length - 2] as { x: number; y: number }).x, (drawable[drawable.length - 2] as { x: number; y: number }).y));
				if (last) out += head(last.point, last.toward, size, escapeXml(stroke));
			}
			if (path.style.arrowStart) {
				const first = drawable[0] as { x: number; y: number };
				const second = drawable[1]!;
				const toward = second.kind === 'C' ? map(second.x1, second.y1) : map((second as { x: number; y: number }).x, (second as { x: number; y: number }).y);
				out += head(map(first.x, first.y), toward, size, escapeXml(stroke));
			}
		}
		return `<g data-oi-s="${path.span.start}" data-oi-e="${path.span.end}">${out}</g>`;
	};

	const shapeElement = (node: DiagramNode): string => {
		if (node.shape === 'None' && !node.style.fill) return '';
		const center = map(node.x, node.y);
		const stroke = color(node.style.stroke);
		const fill = color(node.style.fill);
		const attribute = `fill="${fill ? escapeXml(fill) : 'none'}" stroke="${stroke ? escapeXml(stroke) : 'none'}" stroke-width="${number(strokeWidth(node.style))}"`;
		const width = node.halfWidth * emPerCm;
		const height = node.halfHeight * emPerCm;
		if (node.shape === 'Circle') return `<circle cx="${number(center.x)}" cy="${number(center.y)}" r="${number(Math.max(width, height))}" ${attribute}/>`;
		return `<rect x="${number(center.x - width)}" y="${number(center.y - height)}" width="${number(width * 2)}" height="${number(height * 2)}" rx="0.12" ${attribute}/>`;
	};

	const labelElement = (node: DiagramNode): string => {
		const at = map(node.x, node.y);
		const gap = 0.3;
		const transform = {
			Center: 'translate(-50%, -50%)',
			Above: `translate(-50%, calc(-100% - ${gap}em))`,
			Below: `translate(-50%, ${gap}em)`,
			Left: `translate(calc(-100% - ${gap}em), -50%)`,
			Right: `translate(${gap}em, -50%)`,
			AboveLeft: `translate(calc(-100% - ${gap}em), calc(-100% - ${gap}em))`,
			AboveRight: `translate(${gap}em, calc(-100% - ${gap}em))`,
			BelowLeft: `translate(calc(-100% - ${gap}em), ${gap}em)`,
			BelowRight: `translate(${gap}em, ${gap}em)`,
		}[node.placement];
		const textColor = color(node.style.textColor);
		// left/top are in the scene's em, so the smaller type lives on the inner element
		return `<div class="oi-diagram-label" style="left: ${number(at.x)}em; top: ${number(at.y)}em; transform: ${transform};${textColor ? ` color: ${escapeXml(textColor)};` : ''}"><div class="oi-diagram-label-text">${option.renderLabel(node.text, node.textOffset)}</div></div>`;
	};

	const width = (box.maxX - box.minX) * emPerCm;
	const height = (box.maxY - box.minY) * emPerCm;
	return (
		`<div class="oi-diagram-scene" style="width: ${number(width)}em; height: ${number(height)}em">` +
		`<svg class="oi-diagram-svg" viewBox="0 0 ${number(width)} ${number(height)}" style="width: ${number(width)}em; height: ${number(height)}em" role="img" aria-label="diagram" stroke-linecap="round" stroke-linejoin="round">` +
		diagram.pathList.map(pathElement).join('') +
		diagram.nodeList.map(shapeElement).join('') +
		'</svg>' +
		diagram.nodeList.filter((node) => node.text.trim() !== '').map(labelElement).join('') +
		'</div>'
	);
}
