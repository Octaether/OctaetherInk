// Chemical formulas (mhchem-like subset): `2H_2 + O_2 -> 2H_2O`, `SO_4^{2-}`, `Na+`, `CuSO4·5H2O`.
// Digits right after an element or a closing bracket are subscripts; leading digits are
// coefficients; a trailing + or - is a charge. Used inline ({Chem: …}) and for scheme text.

export type FormulaPieceKind = 'Normal' | 'Sub' | 'Sup' | 'Operator';

export interface FormulaPiece {
	text: string;
	kind: FormulaPieceKind;
	/** Source offset of the piece (relative to the formula text). */
	start: number;
	end: number;
}

const arrowMap: ReadonlyArray<readonly [string, string]> = [
	['<=>', '⇌'],
	['<->', '↔'],
	['->', '→'],
	['<-', '←'],
];

function readGroup(text: string, at: number): { value: string; end: number } {
	// `{…}` or a single character / a run of digits plus an optional sign
	if (text[at] === '{') {
		let depth = 1;
		let index = at + 1;
		while (index < text.length && depth > 0) {
			if (text[index] === '{') depth++;
			else if (text[index] === '}') depth--;
			index++;
		}
		return { value: text.slice(at + 1, index - 1), end: index };
	}
	const run = /^(?:\d+[+-]?|[+-]|[^\s])/.exec(text.slice(at));
	const value = run ? run[0] : '';
	return { value, end: at + value.length };
}

export function parseFormula(text: string): FormulaPiece[] {
	const pieceList: FormulaPiece[] = [];
	const push = (piece: string, kind: FormulaPieceKind, start: number, end: number): void => {
		const last = pieceList[pieceList.length - 1];
		if (last && last.kind === kind && last.end === start && kind !== 'Operator') {
			last.text += piece;
			last.end = end;
		} else pieceList.push({ text: piece, kind, start, end });
	};
	let index = 0;
	// after an element, a closing bracket, or a subscript, digits become subscripts
	let afterSymbol = false;
	while (index < text.length) {
		const character = text[index]!;
		const arrow = arrowMap.find(([source]) => text.startsWith(source, index));
		if (arrow) {
			pieceList.push({ text: ` ${arrow[1]} `, kind: 'Operator', start: index, end: index + arrow[0].length });
			index += arrow[0].length;
			afterSymbol = false;
			continue;
		}
		if (character === '_' || character === '^') {
			const group = readGroup(text, index + 1);
			push(group.value.replace(/-/g, '−'), character === '_' ? 'Sub' : 'Sup', index, group.end);
			index = group.end;
			afterSymbol = character === '_';
			continue;
		}
		if (/\d/.test(character) && afterSymbol) {
			const digit = /^\d+/.exec(text.slice(index))![0];
			push(digit, 'Sub', index, index + digit.length);
			index += digit.length;
			continue;
		}
		if ((character === '+' || character === '-') && afterSymbol && (index + 1 >= text.length || /[\s)]/.test(text[index + 1]!))) {
			push(character === '-' ? '−' : '+', 'Sup', index, index + 1);
			index++;
			continue;
		}
		if (character === '+' && /\s/.test(text[index - 1] ?? ' ')) {
			pieceList.push({ text: ' + ', kind: 'Operator', start: index, end: index + 1 });
			index++;
			afterSymbol = false;
			continue;
		}
		if (character === '*' || character === '·') {
			push('·', 'Normal', index, index + 1);
			index++;
			afterSymbol = false;
			continue;
		}
		if (/\s/.test(character)) {
			index++;
			afterSymbol = false;
			continue;
		}
		push(character, 'Normal', index, index + 1);
		afterSymbol = /[A-Za-z)\]]/.test(character);
		index++;
	}
	return pieceList;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** HTML for an inline formula; every piece carries its source span (+ offset). */
export function formulaHtml(text: string, offset: number): string {
	return `<span class="oi-chem-formula">${parseFormula(text)
		.map((piece) => {
			const span = ` data-oi-s="${offset + piece.start}" data-oi-e="${offset + piece.end}"`;
			const one = piece.end - piece.start === piece.text.length ? ` data-oi-s="${offset + piece.start}"` : span;
			if (piece.kind === 'Sub') return `<sub${span}>${escapeHtml(piece.text)}</sub>`;
			if (piece.kind === 'Sup') return `<sup${span}>${escapeHtml(piece.text)}</sup>`;
			return `<span${piece.kind === 'Operator' ? span : one}>${escapeHtml(piece.text)}</span>`;
		})
		.join('')}</span>`;
}

/** Rough width in em (for layout without measuring the DOM). */
export function formulaWidth(pieceList: readonly FormulaPiece[]): number {
	let width = 0;
	for (const piece of pieceList) {
		const scale = piece.kind === 'Sub' || piece.kind === 'Sup' ? 0.7 : 1;
		for (const character of piece.text) width += characterWidth(character) * scale;
	}
	return width;
}

export function characterWidth(character: string): number {
	if (/[A-Z]/.test(character)) return character === 'I' ? 0.36 : character === 'M' || character === 'W' ? 0.9 : 0.72;
	if (/[a-z]/.test(character)) return character === 'l' || character === 'i' ? 0.28 : character === 'm' || character === 'w' ? 0.82 : 0.55;
	if (/\d/.test(character)) return 0.56;
	if (character === ' ') return 0.28;
	if ('+−-=→←⇌↔'.includes(character)) return 0.62;
	return 0.5;
}
