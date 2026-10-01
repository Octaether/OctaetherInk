import { describe, expect, it } from 'vitest';
import { buildScene, defaultBondLength, formulaHtml, labelPieceList, measureLabel, parseFormula, parseMolecule, renderScene } from '../src';

const close = (value: number, expected: number): void => expect(value).toBeCloseTo(expected, 5);

describe('parseMolecule', () => {
	it('places atoms along bonds with angles, branches, and names', () => {
		const molecule = parseMolecule('H_3C-@{c}C(-[2]H)(-[6]H)@{cb}-@{br}Br');
		expect(molecule.problemList).toEqual([]);
		expect(molecule.atomList.map((atom) => atom.label)).toEqual(['H_3C', 'C', 'H', 'H', 'Br']);
		const [, carbon, up, down, bromine] = molecule.atomList;
		close(carbon!.x, 1);
		close(up!.y, 1);
		close(down!.y, -1);
		close(bromine!.x, 2);
		expect(carbon!.name).toBe('c');
		expect(bromine!.name).toBe('br');
		expect(molecule.bondList.find((bond) => bond.name === 'cb')).toMatchObject({ from: 1, to: 4 });
	});

	it('reads absolute, step, and relative angles and length factors', () => {
		const [, a] = parseMolecule('-[:30]').atomList;
		close(a!.x, Math.cos(Math.PI / 6));
		close(a!.y, 0.5);
		const [, , b] = parseMolecule('-[1]-[::-45]').atomList;
		close(b!.y, Math.SQRT1_2);
		const [, c] = parseMolecule('-[,2]').atomList;
		close(c!.x, 2);
	});

	it('draws regular rings, closes them, and marks aromatic ones', () => {
		const benzene = parseMolecule('*6(=-=-=-)');
		expect(benzene.atomList).toHaveLength(6);
		expect(benzene.bondList).toHaveLength(6);
		expect(benzene.bondList[5]!.to).toBe(0);
		for (const bond of benzene.bondList) {
			const from = benzene.atomList[bond.from]!;
			const to = benzene.atomList[bond.to]!;
			close(Math.hypot(to.x - from.x, to.y - from.y), 1);
			expect(bond.ringCenter).toBeDefined();
		}
		expect(parseMolecule('**6(------)').ringList[0]!.aromatic).toBe(true);
	});

	it('points ring substituents outward and supports wedges and ring closure', () => {
		const toluene = parseMolecule('*6(-=-(-CH_3)=-=)');
		const methyl = toluene.atomList.find((atom) => atom.label === 'CH_3')!;
		const ring = toluene.ringList[0]!;
		const substituted = toluene.atomList[3]!;
		expect(Math.hypot(methyl.x - ring.x, methyl.y - ring.y)).toBeGreaterThan(Math.hypot(substituted.x - ring.x, substituted.y - ring.y));
		expect(parseMolecule('C>O<:N').bondList.map((bond) => bond.kind)).toEqual(['WedgeFront', 'DashBack']);
		expect(parseMolecule('A?-B-C?').bondList).toHaveLength(3);
	});

	it('reads bond styles for partial and highlighted bonds', () => {
		const { bondList } = parseMolecule('HO-[,,,,dashed]C-[:0,1.2,,,dotted]Br-[,,,,red]X=[,,,,Accent]Y');
		expect(bondList.map((bond) => [bond.dash, bond.color])).toEqual([
			['Dashed', undefined],
			['Dotted', undefined],
			[undefined, 'red'],
			[undefined, 'Accent'],
		]);
		const html = renderScene(buildScene('\\chemfig{A-[,,,,dashed]B}'), { resolveColor: () => undefined, renderLabel: (content) => content });
		expect(html).toContain('stroke-dasharray');
	});

	it('reports mistakes with their source position', () => {
		const molecule = parseMolecule('A-*6', 10);
		expect(molecule.problemList[0]).toMatchObject({ message: 'a ring is written *6(…)', start: 12 });
	});

	it('splits labels into pieces and centres the main atom', () => {
		expect(labelPieceList('H_3C')).toEqual([
			{ text: 'H', kind: 'Normal' },
			{ text: '3', kind: 'Sub' },
			{ text: 'C', kind: 'Normal' },
		]);
		expect(labelPieceList('O^{-}')).toEqual([
			{ text: 'O', kind: 'Normal' },
			{ text: '−', kind: 'Sup' },
		]);
		const { width, anchor } = measureLabel(labelPieceList('H_3C'));
		expect(anchor).toBeGreaterThan(width / 2);
	});
});

describe('formula', () => {
	it('reads coefficients, subscripts, charges, and arrows', () => {
		expect(parseFormula('2H_2 + O_2 -> 2H_2O').map((piece) => `${piece.kind}:${piece.text}`)).toEqual([
			'Normal:2H', 'Sub:2', 'Operator: + ', 'Normal:O', 'Sub:2', 'Operator: → ', 'Normal:2H', 'Sub:2', 'Normal:O',
		]);
		expect(parseFormula('SO4^{2-}').map((piece) => `${piece.kind}:${piece.text}`)).toEqual(['Normal:SO', 'Sub:4', 'Sup:2−']);
		expect(parseFormula('Na+').at(-1)).toMatchObject({ kind: 'Sup', text: '+' });
		expect(formulaHtml('H2O', 5)).toBe('<span class="oi-chem-formula"><span data-oi-s="5">H</span><sub data-oi-s="6" data-oi-e="7">2</sub><span data-oi-s="7">O</span></span>');
	});
});

describe('scene', () => {
	const mechanism = [
		'\\chemfig{@{o}HO^{-}} \\chemfig{H_3C-@{c}C(-[2]H)(-[6]H)@{cb}-@{br}Br}',
		'Arrow o -> c {Curve: 60}',
		'Arrow cb -> br {Curve: -60, Kind: Fishhook}',
		'Label c {Side: Below}: backside **attack**',
	].join('\n');

	it('lays out molecules, curved arrows, and labels', () => {
		const scene = buildScene(mechanism);
		expect(scene.problemList).toEqual([]);
		expect(scene.moleculeList).toHaveLength(2);
		expect(scene.curveList.map((curve) => curve.kind)).toEqual(['Pair', 'Fishhook']);
		expect(scene.labelList[0]).toMatchObject({ side: 'Below', content: 'backside **attack**' });
		const [first, second] = scene.moleculeList;
		expect(second!.dx).toBeGreaterThan(first!.dx);
		expect(Number.isFinite(scene.box.maxX)).toBe(true);
	});

	it('moves labels clear of atoms, bonds, and other labels', () => {
		const scene = buildScene(`${mechanism}\nLabel c {Side: Below}: second`);
		const [first, second] = scene.labelList;
		const molecule = scene.moleculeList[1]!;
		const lowerH = molecule.molecule.atomList[3]!;
		// the label starts below the lower H instead of on top of it
		expect(first!.box.maxY).toBeLessThan(lowerH.y * molecule.unit + molecule.dy - 0.5);
		expect(second!.box.maxY).toBeLessThanOrEqual(first!.box.minY);
		// Avoid: False keeps a label right at its target
		const kept = buildScene(mechanism.replace('{Side: Below}', '{Side: Below, Avoid: False}')).labelList[0]!;
		expect(kept.box.maxY).toBeGreaterThan(first!.box.maxY);
		expect(buildScene('\\chemfig{@{a}A}\nLabel (1, 1) {Side: Center}: x').labelList[0]!.at).toEqual({ x: defaultBondLength, y: defaultBondLength });
	});

	it('starts curved arrows outside the atoms they join', () => {
		const scene = buildScene(mechanism);
		const oxygen = scene.moleculeList[0]!;
		const atom = oxygen.molecule.atomList[0]!;
		const center = { x: atom.x * oxygen.unit + oxygen.dx, y: atom.y * oxygen.unit + oxygen.dy };
		const start = scene.curveList[0]!.from;
		const outside = start.y > center.y + 0.42 || start.x > center.x - atom.anchor + atom.width || start.x < center.x - atom.anchor;
		expect(outside).toBe(true);
	});

	it('adds space with \\quad, \\qquad, and \\hspace', () => {
		const gapOf = (between: string): number => {
			const [a, b] = buildScene(`\\chemfig{A}${between}\\chemfig{B}`).moleculeList;
			return b!.dx - a!.dx;
		};
		expect(gapOf(' \\qquad ') - gapOf(' ')).toBeCloseTo(2, 5);
		expect(gapOf('\\hspace{1cm}') - gapOf(' ')).toBeCloseTo(2.36, 5);
		expect(buildScene('\\chemfig{A}\\hspace{wide}').problemList[0]!.message).toMatch(/length/);
	});

	it('reports unknown names', () => {
		expect(buildScene('\\chemfig{A}\nArrow a -> b').problemList[0]!.message).toMatch(/unknown name "a"/);
	});

	it('builds schemes with conditions and turns them downward', () => {
		const scene = buildScene('\\schemestart A \\arrow{->[H_2O][\\Delta]} B \\arrow{->}[-90] C \\schemestop');
		expect(scene.arrowList).toHaveLength(2);
		expect(scene.arrowList[0]!.above?.pieceList.map((piece) => piece.text).join('')).toBe('H2O');
		expect(scene.arrowList[0]!.below?.pieceList[0]!.text).toBe('Δ');
		const [, , c] = scene.textList;
		const [, b] = scene.textList;
		expect(c!.y).toBeLessThan(b!.y - 1);
	});

	it('stacks rows downward', () => {
		const scene = buildScene('\\chemfig{A-B}\n\\chemfig{C-D}');
		expect(scene.moleculeList[1]!.dy).toBeLessThan(scene.moleculeList[0]!.dy);
	});

	it('renders SVG with source spans and HTML labels', () => {
		const html = renderScene(buildScene(mechanism), { resolveColor: () => undefined, renderLabel: (content, offset) => `<b data-at="${offset}">${content}</b>` });
		expect(html).toContain('<svg class="oi-chem-svg"');
		expect(html).toContain('class="oi-chem-atom"');
		expect(html).toContain('class="oi-chem-curve"');
		expect(html).toMatch(/<g class="oi-chem-bond" data-oi-s="\d+" data-oi-e="\d+">/);
		expect(html).toContain(`<b data-at="${mechanism.indexOf('backside')}">backside **attack**</b>`);
	});

	it('draws lone pairs, single electrons, and bars from \\lewis', () => {
		const { atomList } = parseMolecule('\\lewis{0:2.4|,O}-H');
		expect(atomList[0]!.electronList).toEqual([
			{ angle: 0, kind: 'Pair' },
			{ angle: 90, kind: 'Single' },
			{ angle: 180, kind: 'Bar' },
		]);
		expect(atomList[0]!.pieceList.map((piece) => piece.text).join('')).toBe('O');
		const html = renderScene(buildScene('\\chemfig{\\lewis{26,O}}'), { resolveColor: () => undefined, renderLabel: (content) => content });
		expect(html.match(/<circle/g)).toHaveLength(4);
		expect(html).toContain('class="oi-chem-electron"');
	});

	it('starts electron-pushing arrows at a lone pair and ends them where a bond forms', () => {
		const source = String.raw`\chemfig{@{o}\lewis{0:4:,HO}^{-}} \qquad \chemfig{@{c}C(-[2]H)(-[6]H)-@{br}Br}
Arrow o.lp -> o!0.5!c {Curve: 30}
Arrow o.lp4 -> c`;
		const scene = buildScene(source);
		expect(scene.problemList).toEqual([]);
		const oxygen = scene.moleculeList[0]!;
		const center = { x: oxygen.dx, y: oxygen.dy };
		const [facing, back] = scene.curveList;
		// the first arrow leaves from the pair on the right (it faces the carbon); the second from the pair at 4 × 45° = left
		expect(facing!.from.x).toBeGreaterThan(center.x + 0.5);
		expect(back!.from.x).toBeLessThan(center.x - 0.5);
		const carbon = scene.moleculeList[1]!;
		const halfway = (center.x + carbon.dx) / 2;
		expect(Math.abs(facing!.to.x - halfway)).toBeLessThan(0.01);
	});

	it('bows an arrow away from the atoms when no Curve is given', () => {
		// atoms below the chord: the arrow goes over the top
		const scene = buildScene('\\chemfig{@{a}A-[6]B-[0]C-[2]@{d}D}\nArrow a -> d');
		const curve = scene.curveList[0]!;
		expect(Math.min(curve.control1.y, curve.control2.y)).toBeGreaterThan(Math.max(curve.from.y, curve.to.y) - 0.01);
	});

	it('reads \\chemmove with TikZ to[out, in], bend, and calc targets', () => {
		const scene = buildScene(String.raw`\chemfig{@{x}X-@{y}Y-@{z}Z}
\chemmove{\draw[->](x) to[out=90,in=90] (z); \draw[->](y) to[bend right=40] (z); \draw[->]($(x)!0.5!(y)$) .. controls +(90:1cm) and +(90:1cm) .. (z);}`);
		expect(scene.problemList).toEqual([]);
		expect(scene.curveList).toHaveLength(3);
		const [outIn] = scene.curveList;
		expect(outIn!.control1.y).toBeGreaterThan(outIn!.from.y);
	});

	it('reads every part of the syntax the README lists', () => {
		const source = String.raw`\chemfig{@{nu}HO^{-}} \qquad \chemfig{@{c}C(-[:100]H)(>[:215]H)(>:[:250]H)@{cb}-@{lg}Br}
Arrow nu -> c {Curve: 45}
Arrow cb -> lg {Curve: 70, Kind: Fishhook, Color: Danger}
Label c {Side: Below}: backside attack, **inversion** of configuration
\schemestart \arrow{->[][slow]} \chemfig{HO-[,,,,dashed]@{ts}C(-[2]H)(>[:235]H)(>:[:305]H)-[,,,,dashed]Br} \arrow{->} \chemfig{HO-C(-[:80]H)(>[:-35]H)(>:[:-70]H)} \+ Br^{-} \schemestop
Label ts {Side: Below, Color: Accent}: transition state
\chemfig{@{a}A>|B<|C-[::30]D=[,1.5]E~F-[,,,,red]G=[,,,,dashed]H} \chemfig{**6(------)} \chemfig{*6(=-=-=-)} \chemfig{A?-B-C?} \chemfig{N\oplus} SO_4^{2-} \hspace{2em} H_2O
\schemestart A \arrow{<->} B \arrow{-/>} C \arrow{--}[-90] D \arrow{<=>[a][b]}[180,2] E \arrow{<-} F \schemestop
Arrow a.north -> c.45 {Curve: 30}
Label (1, 1) {Side: Center}: pinned
Label a {Side: Right, Gap: 0.5, Avoid: False}: $\delta^+$
\chemfig{@{x}X-@{y}Y}
\chemmove{\draw[->](x) .. controls +(90:1cm) and +(90:1cm) .. (y);}`;
		const scene = buildScene(source);
		expect(scene.problemList).toEqual([]);
		expect([scene.moleculeList.length, scene.arrowList.length, scene.curveList.length]).toEqual([10, 7, 4]);
		// labels with a coordinate target are placed last, after every row
		expect(scene.labelList.map((label) => label.side)).toEqual(['Below', 'Below', 'Right', 'Center']);
	});
});
