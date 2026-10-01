import { describe, expect, it } from 'vitest';
import { evaluate, parseTikz, renderDiagram, tikzColor } from '../src';

describe('evaluate', () => {
	it('computes like TikZ: degrees by default, r for radians', () => {
		expect(evaluate('1 + 2 * 3')).toBe(7);
		expect(evaluate('2^3^2')).toBe(512);
		expect(evaluate('-2^2')).toBe(-4);
		expect(evaluate('sin(30)')).toBeCloseTo(0.5);
		expect(evaluate('sin(pi/2 r)')).toBeCloseTo(1);
		expect(evaluate('sqrt(x) + max(1, y)', { x: 9, y: 4 })).toBe(7);
		expect(() => evaluate('alert(1)')).toThrow(/unknown name "alert"/);
	});
});

describe('parseTikz', () => {
	it('draws lines, rectangles, circles, and arcs with styles', () => {
		const diagram = parseTikz('\\draw[->, thick, red] (0,0) -- (2,1);\n\\fill[blue!30] (0,0) rectangle (1,1);\n\\draw (0,0) circle (1);\n\\draw (1,0) arc (0:90:1);');
		expect(diagram.problemList).toEqual([]);
		const [line, rectangle, circle, arc] = diagram.pathList;
		expect(line!.style).toMatchObject({ arrowEnd: true, stroke: tikzColor('red'), width: 0.8 });
		expect(line!.commandList).toEqual([
			{ kind: 'M', x: 0, y: 0 },
			{ kind: 'L', x: 2, y: 1 },
		]);
		expect(rectangle!.style.fill).toContain('color-mix');
		expect(rectangle!.style.stroke).toBeUndefined();
		expect(circle!.commandList.filter((command) => command.kind === 'A')).toHaveLength(2);
		const end = arc!.commandList.at(-1)!;
		expect(end.kind === 'A' && end.x).toBeCloseTo(0);
		expect(end.kind === 'A' && end.y).toBeCloseTo(1);
		expect(diagram.box.minX).toBeLessThan(-1);
	});

	it('handles polar, relative, and named coordinates, -| and |-', () => {
		const diagram = parseTikz('\\coordinate (o) at (1,1);\n\\draw (o) -- ++(1,0) -- +(0,1) -| (0:3);\n\\draw (0,0) |- (2,2);');
		expect(diagram.pathList[0]!.commandList.map((command) => (command.kind === 'Z' ? 'Z' : `${command.kind}${Math.round(command.x * 10) / 10},${Math.round(command.y * 10) / 10}`))).toEqual([
			'M1,1', 'L2,1', 'L2,2', 'L3,2', 'L3,0',
		]);
		expect(diagram.pathList[1]!.commandList).toEqual([
			{ kind: 'M', x: 0, y: 0 },
			{ kind: 'L', x: 0, y: 2 },
			{ kind: 'L', x: 2, y: 2 },
		]);
	});

	it('plots functions and expands \\foreach ranges', () => {
		const diagram = parseTikz('\\draw[domain=0:180, samples=3] plot (\\x/90, {sin(\\x)});\n\\foreach \\i in {0,...,3} { \\draw (\\i,0) -- (\\i,1); }');
		const plot = diagram.pathList[0]!.commandList;
		expect(plot).toHaveLength(3);
		expect(plot[1]).toMatchObject({ kind: 'L', x: 1 });
		expect(plot[1]!.kind !== 'Z' && plot[1]!.y).toBeCloseTo(1);
		expect(diagram.pathList).toHaveLength(5);
	});

	it('places nodes and connects them edge to edge', () => {
		const source = '\\node[draw, circle] (a) at (0,0) {A};\n\\node[draw, circle] (b) at (3,0) {B};\n\\draw[->] (a) -- (b) node[midway, above] {$f$};';
		const diagram = parseTikz(source);
		expect(diagram.nodeList.map((node) => node.text)).toEqual(['A', 'B', '$f$']);
		const [move, line] = diagram.pathList[0]!.commandList;
		expect(move!.kind === 'M' && move!.x).toBeGreaterThan(0.1);
		expect(line!.kind === 'L' && line!.x).toBeLessThan(2.9);
		expect(diagram.nodeList[2]!.placement).toBe('Above');
		expect(diagram.nodeList[2]!.textOffset).toBe(source.indexOf('$f$'));
	});

	it('reports problems and keeps going', () => {
		const diagram = parseTikz('\\draw (0,0) -- (nowhere);\n\\draw (0,0) -- (1,1);');
		expect(diagram.problemList[0]!.message).toMatch(/nowhere/);
		expect(diagram.pathList).toHaveLength(1);
	});
});

describe('renderDiagram', () => {
	it('renders SVG paths with source spans and HTML labels', () => {
		const source = '\\draw[->] (0,0) -- (1,0) node[right] {$x$};';
		const html = renderDiagram(parseTikz(source), { resolveColor: () => undefined, renderLabel: (content, offset) => `<i data-at="${offset}">${content}</i>` });
		expect(html).toContain('<svg class="oi-diagram-svg"');
		expect(html).toMatch(/<g data-oi-s="0" data-oi-e="\d+"><path d="M [\d.]+ [\d.]+ L/);
		expect(html).toContain('<polygon');
		expect(html).toContain(`<i data-at="${source.indexOf('$x$')}">$x$</i>`);
	});

	it('reads every command, path, coordinate, and style the README lists', () => {
		const source = String.raw`\draw[->] (-3.2,0) -- (3.4,0) node[right] {$x$};
\draw[thick, Accent, domain=-3:3, samples=80] plot (\x, {sin(\x r)});
\node[draw, circle] (a) at (0,1) {A};  \node[draw] (b) at (2,1) {B};  \draw[->] (a) -- (b);
\draw[stealth-, red!40!blue, line width=1pt, opacity=0.5] (0,0) -- (1,1);
\node[anchor=north, text=Accent] at ({sqrt(4)}, 0) {n};
\draw (0,0) -| (1,1) |- (2,2) .. controls (3,3) and (4,4) .. (5,5) to[out=90,in=180] (6,6);
\draw (0,0) rectangle (1,1) (2,2) circle (1) (3,3) ellipse (1 and 2) (0,0) arc (0:90:1) (0,0) grid (2,2) (0,0) -- (1,0) -- (1,1) -- cycle;
\foreach \x in {0,...,4} { \fill (\x, 0) circle (0.05); }
\coordinate (o) at (30:2); \draw (o) -- +(1,0) -- ++(0,1); \draw (a.north) -- (b.south);
\filldraw[fill=blue!30, draw=red, dashed] (0,0) circle (0.5); \path (0,0) -- (1,1); \draw[dotted, ultra thick] (0,0) -- (1,0);
\begin{tikzpicture}[scale=2] \draw (0,0) -- (1,0); \end{tikzpicture}`;
		const diagram = parseTikz(source);
		expect(diagram.problemList).toEqual([]);
		expect(diagram.nodeList.map((node) => node.placement)).toEqual(['Right', 'Center', 'Center', 'Below']);
	});
});
