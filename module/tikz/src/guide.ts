// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const tikzGuide = String.raw`A drawing in a subset of TikZ, one command per line under "TikZ:", without \begin{tikzpicture} around it. Commands: \draw, \fill, \filldraw, \path, \node, \coordinate, \foreach. Paths: --, -|, |-, .. controls .., rectangle, circle, ellipse, arc, grid, to[out=,in=], cycle, plot[domain=a:b] (\x, {expression}). Coordinates: (x,y), (angle:radius), named nodes, +(dx,dy), ++(dx,dy). Styles: arrow tips (->, <->), thick, dashed, dotted, opacity, fill and draw colors (red, blue!40, or theme colors such as Accent), node shapes (circle, rectangle) and placement (above, right). Labels may hold math as $x$ (only here). No libraries, no \usetikzlibrary, no pgfplots: for the graph of a function or a chart use a Plot.

<example>
TikZ:
	\draw[->] (-0.5,0) -- (3,0) node[right] {$x$};
	\draw[->] (0,-0.5) -- (0,2) node[above] {$y$};
	\node[draw, circle] (a) at (1,1) {A};
	\node[draw] (b) at (2.5,1) {B};
	\draw[->, Accent] (a) -- (b);
</example>`;
