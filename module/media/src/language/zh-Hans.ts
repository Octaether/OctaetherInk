// 简体中文 (Simplified Chinese): this module's own words. Left: the English text it passes to t().
// Right: what is shown. {name} and {0} stand for values and stay in the translation.

const dictionary: Readonly<Record<string, string>> = {
	"Pictures: \"Image: photo.png\" (from the vault) or a web address, with a caption on the lines below and settings in braces, as for every block: Image {Width: 320, Align: Left}: photo.png. Paste or drop a picture on a note to add it. Text can show pictures too, written ![](photo.png) or ![[photo.png]].": "图片：\"Image: photo.png\"（来自库）或一个网址，说明文字写在下方的行中，设置写在花括号里，与所有块相同：Image {Width: 320, Align: Left}: photo.png。把图片粘贴或拖到笔记上即可添加。文本中也可以显示图片，写作 ![](photo.png) 或 ![[photo.png]]。",
	"Where a picture sits": "图片的位置",
	"For a picture whose block doesn’t say ({Align: Left}).": "用于块中未写明位置（{Align: Left}）的图片。",
	"Click to see it full size": "点击查看原始大小",
	"In the Read view, a click on a picture shows it over everything; a click or Esc closes it.": "在阅读视图中，点击图片会将其显示在最上层；再次点击或按 Esc 关闭。",
	"A picture from the vault or the web; paste or drop one to add it": "来自库或网络的图片；粘贴或拖入即可添加",
	"Videos: a YouTube or Vimeo address, or a video file in the vault or on the web, with a caption on the lines below. {Start: 90} starts it 90 seconds in; {Loop: True} and {Muted: True} do what they say. YouTube plays without cookies until you press play.": "视频：YouTube 或 Vimeo 的地址，或者库中或网络上的视频文件，说明文字写在下方的行中。{Start: 90} 表示从第 90 秒开始；{Loop: True} 和 {Muted: True} 分别表示循环和静音。在你按下播放之前，YouTube 不会使用 cookie。",
	"Video width": "视频宽度",
	"For a video whose block doesn’t say (Width = 480).": "用于块中未写明宽度（Width = 480）的视频。",
	"YouTube, Vimeo, or a video file": "YouTube、Vimeo 或视频文件",
};

export default dictionary;
