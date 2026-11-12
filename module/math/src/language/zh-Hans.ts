// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Math blocks (\"Math:\", or $$ … $$ as in Obsidian) and inline math ({Math: …}), written in TeX. Our own parser and macro engine turn it into MathML that the browser lays out, so colors, fonts, and themes follow the rest of the note, and clicking any rendered piece jumps to that exact spot in the source.": "用 TeX 书写的公式块（\"Math:\"，或像 Obsidian 那样的 $$ … $$）和行内公式（{Math: …}）。我们自己的解析器和宏引擎将其转换为由浏览器排版的 MathML，因此颜色、字体和主题与笔记其余部分一致，点击渲染结果的任意部分都能跳到源码中的对应位置。",
	"Math font": "公式字体",
	"The font for equations. Default picks the best math font your device has (STIX Two on Apple devices, Cambria on Windows, Noto on Android).": "公式使用的字体。Default 会选用设备上最好的数学字体（Apple 设备为 STIX Two，Windows 为 Cambria，Android 为 Noto）。",
	"Equation numbers": "公式编号",
	"Numbered: only blocks with {Numbered: True} get a number. All: every math block is numbered. None: no numbers.": "Numbered：只有带 {Numbered: True} 的块才编号。All：所有公式块都编号。None：不编号。",
	"Explains what’s wrong under an equation that has a mistake (the block is outlined either way).": "在有错误的公式下方说明问题所在（无论如何该块都会加上轮廓）。",
	"Display math in TeX; in a sentence write {Math: …}": "用 TeX 书写的独立公式；句中请写 {Math: …}",
};

export default dictionary;
