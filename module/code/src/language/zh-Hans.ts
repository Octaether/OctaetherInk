// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Code blocks: \"Code: Python\" with the code on the indented lines below, or a Markdown fence (```Python … ```) as in Obsidian. Highlighting for JavaScript, TypeScript, Python, Rust, C/C++, Java, SQL, Shell, R, Julia, and LaTeX; inline code is `code` or {Code: …}. Running code comes later.": "代码块：\"Code: Python\"，代码写在下方缩进的行中；或像 Obsidian 那样使用 Markdown 围栏（```Python … ```）。支持 JavaScript、TypeScript、Python、Rust、C/C++、Java、SQL、Shell、R、Julia 和 LaTeX 的语法高亮；行内代码写作 `code` 或 {Code: …}。运行代码的功能将在以后推出。",
	"Show the language": "显示语言",
	"The language (after \"Code:\" or ```) appears in the corner of the block.": "语言（写在 \"Code:\" 或 ``` 之后）会显示在块的角落。",
	"Copy button": "复制按钮",
	"A Copy button appears when the pointer is over a code block.": "指针位于代码块上时显示“复制”按钮。",
	"Numbers every line. Long lines then scroll sideways instead of wrapping.": "为每一行编号。此时长行会横向滚动而不换行。",
	"Wrap long lines": "长行自动换行",
	"Long lines continue on the next line instead of scrolling sideways.": "长行会折到下一行，而不是横向滚动。",
	"Syntax colors": "语法着色",
	"Colors keywords, strings, numbers, comments, and function names.": "为关键字、字符串、数字、注释和函数名着色。",
	"Tab width": "制表符宽度",
	"How many spaces a tab takes in code blocks.": "代码块中一个制表符占几个空格。",
	"Type the language after \"Code:\" (Python, JavaScript, Rust…)": "在 \"Code:\" 之后输入语言（Python、JavaScript、Rust…）",
	"Code (Python)": "Code（Python）",
	"Code (JavaScript)": "Code（JavaScript）",
	"Function": "函数",
	"Copy": "复制",
	"Copied": "已复制",
	"Highlighted as": "高亮为",
	"Not highlighted": "未高亮",
};

export default dictionary;
