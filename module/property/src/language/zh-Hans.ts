// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"A Property block holds the fields of a note (tags, dates, numbers, checkboxes, lists) as rows you edit in place, like Obsidian’s properties. It is written as plain Key: value lines, the basic types of YAML, so other tools can read it. Add one with + Add property under the title, /property, or Ctrl+;.": "Property 块以可就地编辑的行保存笔记的字段（标签、日期、数字、复选框、列表），类似 Obsidian 的属性。它写成普通的 Key: value 行，使用 YAML 的基本类型，其他工具也能读取。可通过标题下方的“+ 添加属性”、/property 或 Ctrl+; 添加。",
	"Show the type icon": "显示类型图标",
	"An icon before each name shows its type (text, list, number, checkbox, date). Click it to change the type, drag it to reorder.": "每个名称前的图标显示其类型（文本、列表、数字、复选框、日期）。点击可更改类型，拖动可调整顺序。",
	"Show # on tags": "标签显示 #",
	"Writes the tags in a Tag property as #Tag, like tags in text.": "将 Tag 属性中的标签写成 #Tag，与正文中的标签一致。",
	"Tags, dates, checkboxes, and other fields, edited in place": "标签、日期、复选框等字段，就地编辑",
	"Property name": "属性名称",
	"Remove this property": "移除此属性",
	"Type: {type}": "类型：{type}",
	"{type}: click to change the type, drag to move": "{type}：点击更改类型，拖动以移动",
	"Number": "数字",
	"Checkbox": "复选框",
	"Date & time": "日期和时间",
	"List": "列表",
	"Add property": "添加属性",
	"Click to edit, drag to move": "点击编辑，拖动移动",
	"Remove {0}": "移除 {0}",
	"Edit {0}": "编辑 {0}",
};

export default dictionary;
