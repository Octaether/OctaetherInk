// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const boardGuide = String.raw`A block that holds blocks, in one of two arrangements. Free (the default): each block sits at its X and Y (px from the Board's top left), for whiteboards, diagrams, and reaction mechanisms, with Arrow blocks between them. Masonry: a wall of cards in columns (ColumnWidth, 15em by default; Gap, 12px), each block one card, with a blank line between cards.

<example>
Board:
	Text {X: 0, Y: 0}: An idea
	Text {X: 220, Y: 60}: Another
	Arrow {X: 90, Y: 30, Length: 110, Angle: -15}:
		leads to {Side: Above}

Board {Arrange: Masonry, ColumnWidth: 12em}:
	A card

	Math: E = mc^2
</example>`;

export const arrowGuide = String.raw`An arrow on a Board. Either placed by itself (X, Y, Length in px, Angle in degrees), or drawn between named points: From and To name an atom, lone pair, or bond of a Chem block on the same Board (o.lp, c, cb), or a side of a block that has an ID (^a.east). Kind: Single, Fishhook, Equilibrium, Retro, NoReaction, Line. Head: End, Start, Both. Curve: degrees of bend. Text under an arrow is its label, with Side (Above, Below) and At (0 to 1 along it).

<example>
Board:
	Chem {X: 14.7, Y: 37.8}: O@o^-:3
	Chem {X: 76.4, Y: 0}: H >35 C@c (-0@cb Br@br) (-100 H) <:250 H
	Arrow {From: o.lp, To: c}:
	Arrow {From: cb, To: br, Curve: 70}:
	Arrow {X: 8.8, Y: 206, Length: 51.2}:
		slow {Side: Below}
</example>`;
