// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Blocks that hold blocks: Grid with Columns (side by side, stacks on narrow screens) and Callout (a colored box with a title, like Obsidian’s callouts). Always on. Blocks placed freely are the Board module.": "包含其他块的块：带 Column 的 Grid（并排，窄屏时上下堆叠）和 Callout（带标题的彩色方框，类似 Obsidian 的标注）。始终开启。自由摆放的块属于 Board 模块。",
	"Stack columns below": "低于此宽度时堆叠分栏",
	"Columns sit on top of each other when the grid is narrower than this, so text never gets squeezed on a phone.": "当网格窄于此宽度时，分栏会上下排列，这样文字在手机上不会被挤压。",
	"One column; add more beside it from its menu": "一个分栏；可从它的菜单在旁边添加更多",
	"A colored box around blocks, like Obsidian’s callouts": "围住若干块的彩色方框，类似 Obsidian 的标注",
	"Callout: Tip": "Callout：提示",
	"Callout: Warning": "Callout：警告",
	"Two columns": "两栏",
	"Three columns": "三栏",
	"Blocks side by side; stacks on phones": "块并排排列；在手机上堆叠",
	"Expand": "展开",
	"Collapse": "折叠",
};

export default dictionary;
