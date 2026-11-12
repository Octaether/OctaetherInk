// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const textGuide = String.raw`A line of Markdown, written as it is (no "Text:" in front): a heading (# to ######), a list item (- item, 1. item), a to-do (- [ ] open, - [x] done), a quote (> words), a Markdown table (| A | B | lines with a |---|---| line under the first), or a paragraph. A nested list item goes one TAB deeper, under its parent. "Text {X: 0, Y: 0}: words" is written only where a paragraph needs settings (on a Board).

<example>
## Rate law

The rate depends on **both** species: {Math: v = k[A][B]}. See [[Kinetics]] #Exam

- First point
	- A detail under it
- [ ] Something to do
</example>`;
