// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Word count": "字数",
	"Character count": "字符数",
	"1 word": "1 个词",
	"{count} words": "{count} 个词",
	"{selected} of {count} words": "{selected} / {count} 个词",
	"1 character": "1 个字符",
	"{count} characters": "{count} 个字符",
	"Paragraphs, headings, lists, to-dos, quotes, Obsidian callouts (> [!tip]), and tables written in Markdown, with tags (#Tag, #[Tag With Space]), [[links]], pictures (![](photo.png), ![[photo.png]]), styled words [text]{Color: Accent}, and any block inline as {Type: …}, such as {Math: x^2}. Text blocks can hold other blocks. Always on.": "用 Markdown 书写的段落、标题、列表、待办、引用、Obsidian 标注（> [!tip]）和表格，支持标签（#Tag、#[Tag With Space]）、[[链接]]、图片（![](photo.png)、![[photo.png]]）、带样式的文字 [text]{Color: Accent}，以及以 {Type: …} 形式行内书写的任意块，如 {Math: x^2}。Text 块可以包含其他块。始终开启。",
	"Tick to-dos by clicking": "点击勾选待办",
	"Clicking a to-do’s box ticks it (in every view). Off: boxes only change when you edit the text.": "点击待办的方框即可勾选（在所有视图中）。关闭：只有编辑文本才会改变方框。",
	"Tags as pills": "标签显示为胶囊",
	"Shows #tags as small rounded labels. Off: tags are colored words.": "将 #标签 显示为小的圆角标签。关闭：标签显示为彩色文字。",
	"Spell check": "拼写检查",
	"Underlines misspelled words while you type in a text block.": "在文本块中输入时，为拼写错误的词加下划线。",
	"Plain writing": "普通文字",
	"Heading 1": "一级标题",
	"Heading 2": "二级标题",
	"Heading 3": "三级标题",
	"Bulleted list": "无序列表",
	"Numbered list": "有序列表",
	"To-do": "待办",
	"Plain Markdown; for one you can sort, sum, and plot, use Table": "纯 Markdown 表格；需要排序、求和、绘图时请用 Table",
	"Expand": "展开",
	"Collapse": "折叠",
	"List item": "列表项",
	"Type something, or press / for a block": "输入内容，或按 / 插入块",
};

export default dictionary;
