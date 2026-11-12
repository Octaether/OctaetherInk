// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const propertyGuide = String.raw`The note's own fields, one "Key: value" line each under "Property:", at the top of the note (one per note). Tag is a list. Values are text, a number, True or False, a date (2026-10-12), a date and time (2026-10-12 09:30), or a list.

<example>
Property:
	Tag: [Organic, Lecture 05]
	Course: CHEM 2310
	Exam: 2026-10-12
</example>`;
