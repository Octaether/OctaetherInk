// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const columnGuide = String.raw`One column of a Grid; written only inside a Grid (see Grid).`;

export const calloutGuide = String.raw`A titled, colored box around blocks. Kind is Note, Info, Tip, Success, Question, Warning, Danger, Bug, Example, or Quote; the title after the colon is optional.

<example>
Callout {Kind: Warning}: Check the units
	The constant is in **kJ/mol**, not J/mol.

	Math: R = 8.314 \times 10^{-3}
</example>`;

export const gridGuide = String.raw`Blocks side by side: a Grid holds Column blocks, and each Column holds any blocks. Width is a share (60%) or a size (240px); Gap is the space between columns. Columns stack on a narrow screen.

<example>
Grid {Gap: 16px}:
	Column {Width: 60%}:
		The text on the left.
	Column {Width: 40%}:
		Image: Cell.png
</example>`;
