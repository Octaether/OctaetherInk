// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const codeGuide = String.raw`Code, kept exactly as written. The language goes after the colon and the code on the lines below, each line one TAB deeper than "Code:" with the code's own indentation after that TAB. Highlighted: JavaScript, TypeScript, Python, Rust, C, C++, Java, SQL, Shell, R, Julia, LaTeX; any other language is shown plain. Settings: LineNumber, Wrap (True or False). Inline in text: between single backquotes.

<example>
Code {LineNumber: True}: Python
	def rate(k, a, b):
	    return k * a * b
</example>`;
