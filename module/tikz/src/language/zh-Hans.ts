// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Drawings in a TikZ subset: \\draw, \\fill, \\node, \\coordinate, \\foreach, plots of functions, arrows, arcs, circles, grids, and to[out,in] curves. Our own parser and renderer; labels can hold $math$.": "用 TikZ 子集绘图：\\draw、\\fill、\\node、\\coordinate、\\foreach、函数图像、箭头、圆弧、圆、网格和 to[out,in] 曲线。使用我们自己的解析器和渲染器；标注中可以包含 $math$。",
	"How big 1 cm of a drawing is on screen. Labels keep the text size.": "绘图中的 1 cm 在屏幕上的大小。标注保持文字大小不变。",
	"Explains unknown commands under the drawing (the block is outlined either way).": "在绘图下方说明未知命令（无论如何该块都会加上轮廓）。",
	"Diagram (TikZ)": "图示（TikZ）",
	"Nodes and arrows, drawn from TikZ code": "节点和箭头，由 TikZ 代码绘制",
	"Geometry (TikZ)": "几何图形（TikZ）",
	"A triangle with an angle, drawn from TikZ code": "带一个角的三角形，由 TikZ 代码绘制",
	"Graph of a function (TikZ)": "函数图像（TikZ）",
	"Drawn from TikZ code. For a graph you can zoom and move, with sliders, use Plot": "由 TikZ 代码绘制。需要可缩放、可移动并带滑块的图像时请用 Plot",
};

export default dictionary;
