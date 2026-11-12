// How the blocks of this module are written, for an AI (BlockTypeDefinition.guide). Kept apart from the
// module so it loads only when an AI is first asked; examples stand between <example> lines.

export const plotGuide = String.raw`A graph, one thing per line as in Desmos, with a line's style in braces at its end. Functions: y = x^2, x = sin(y), f(x) = x^2 then y = f(x) + 1. Implicit curves and regions: x^2 + y^2 = 4, y < x. Polar: r = 1 + cos(θ). Parametric: (cos t, sin t). Points: (1, 2), or named, P = (2, f(2)). A number with a slider: a = 1 {Slider: [0, 5]}. A vector field (arrows): F(x, y) = (-y, x), with {Gradient: [Blue, Red]} to color the arrows by length and {Density: 2} for more of them. A surface (makes it 3D): z = sin(x) cos(y); in 3D, F(x, y, z) = (…, …, …) is a field in space, and a line in x and y (a curve, a region, points) lies on the plane z = 0, or at {Z: 2}. Dimension: 3 or 2 sets it. # starts a comment, shown to the reader. Multiplication may be implied (2x, a sin(x)); write powers with ^, and functions by name (sin, cos, tan, exp, ln, log, sqrt, abs).
A plot is a graph (the lines above) or a chart of a table, never both: a line of the other kind is not drawn, so put a chart in a Plot of its own, and a pie alone. Data from a table: Plot {Data: its title}, then (ColumnX, ColumnY) with the columns' names and {Kind: Scatter, Line, Bar, Area, Pie, or Donut}; Group: Day, Week, Month, or Year and Combine: Sum, Average, or Count total by period; Trend: Linear, Quadratic, or Exponential adds a fitted line.
Line style: {Color, Width, Style: Dashed or Dotted, Opacity, Label, Domain: [a, b], Hidden}. A hex color in braces is quoted ('#c0392b'). Block settings: X: [min, max], Y: [min, max], Height, Grid, Legend, XLabel, YLabel.

<example>
Plot {X: [-7, 7], Y: [-2, 2]}:
	y = a sin(x) {Color: Accent}
	a = 1 {Slider: [0, 2]}
	y = cos(x) {Style: Dashed}

Plot {Data: Gym log}:
	(Date, Weight) {Kind: Line, Trend: Linear}
</example>`;
