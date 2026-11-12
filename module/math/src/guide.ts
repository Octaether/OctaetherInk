// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const mathGuide = String.raw`An equation in LaTeX math, with no $ or \[ \] around it. A short one goes after the colon; a long or many-line one on the lines below. Numbered: True gives it a number. Supported: fractions, roots, sums, integrals, limits, Greek letters, accents, \mathrm, \mathbf, \mathbb, \text{words}, \color{Accent}, \left( \right), and the environments aligned, cases, rcases, matrix, pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix, smallmatrix. Not supported: \label, \ref, \ce, \begin{equation} or {align} (use aligned). Inline in text: {Math: x^2}.

<example>
Math {Numbered: True}: E = mc^2

Math:
	\begin{aligned}
	a &= b + c \\
	  &= d
	\end{aligned}
</example>`;
