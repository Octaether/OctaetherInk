// The Board module: a block that holds blocks and places each one where its X and Y say, and Arrow
// blocks between named points of them (board.ts, arrow.ts). It knows nothing about chemistry: the
// Chem module names atoms, lone pairs, and bonds (Anchor) and gives the Board its editor, so a Board
// is also a whiteboard or (later) a Pinterest-style wall with no chemistry at all.

import type { ModuleDefinition } from '@octaether/core-sdk';
import { arrowType, boardType } from './board';

export * from './arrow';
export { arrangeBoard, arrowType, boardStyle, boardType, toPx } from './board';

export const boardModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Board',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Board',
	explain:
		'Blocks placed freely by X and Y, or next to a named point, with arrows between them (straight, curved, fishhook, equilibrium, retrosynthesis, crossed out) and text along the arrows. Boards hold Boards and shrink to fit narrow screens. The Chem module adds the drawing tool and its named points (atoms, lone pairs, bonds).',
	use: ['Anchor', 'Board.Editor'],
	blockTypeList: [boardType, arrowType],
};
