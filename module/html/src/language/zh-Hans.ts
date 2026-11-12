// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"A block of HTML (\"HTML:\" with the HTML on the lines below), or inline as {HTML: <kbd>Ctrl</kbd>}. It is cleaned first: scripts, forms, frames, event handlers, and anything that could leave the block are removed, and links open in a new tab.": "一段 HTML（\"HTML:\"，HTML 写在下方的行中），或行内写作 {HTML: <kbd>Ctrl</kbd>}。它会先被清理：脚本、表单、框架、事件处理程序以及任何可能超出该块的内容都会被移除，链接在新标签页中打开。",
	"Keep style attributes": "保留 style 属性",
	"Keeps the colors, sizes, and spacing written in style=\"…\" (never positions or pictures from style). Off: plain HTML only.": "保留写在 style=\"…\" 中的颜色、大小和间距（绝不保留 style 中的定位或图片）。关闭：仅保留纯 HTML。",
	"HTML for what Markdown can’t say; nothing in it can run": "用 HTML 表达 Markdown 无法表达的内容；其中任何内容都不会被执行",
};

export default dictionary;
