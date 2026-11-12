// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const imageGuide = String.raw`A picture: after the colon, a file of the vault (its name is enough: Cell.png) or a web address. The caption goes on the line below, in Markdown. Width in px. Never invent a file name or an address: use one that is in the note or that the user gives. In a line of text: ![caption](Cell.png).

<example>
Image {Width: 320}: Attachment/Benzene.png
	The ring, drawn as a hexagon.
</example>`;

export const videoGuide = String.raw`A video: after the colon, a YouTube or Vimeo address, or a video file of the vault. Start (seconds), Loop, Muted. Never invent an address.

<example>
Video {Start: 90}: Lecture 05.mp4
</example>`;
