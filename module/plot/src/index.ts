// Plot module: functions and data, like Desmos, written one per line. Curves, implicit curves and
// regions, polar and parametric curves, points, sliders, data from tables (lines, points, bars,
// areas, by period, with trend lines), and 3D surfaces, implicit surfaces, curves, and points.
// Interactive (drag, zoom, turn) or fixed. The drawing code loads when a plot first shows.
//
//   Plot {X: [-5, 5]}:
//   	y = a sin(x)
//   	a = 1 {Slider: [0, 5]}
//   Plot {Data: Gym log}:   (a table by its title; its columns by name)
//   	(Date, Weight) {Kind: Line, Trend: Linear}

import { type BlockTypeDefinition, type ModuleDefinition, lazyRenderer } from '@octaether/core-sdk';

export { parsePlot, splitStyle } from './parse';


const plotType: BlockTypeDefinition = {
	name: 'Plot',
	content: 'Raw',
	render: lazyRenderer(() => import('./view').then((module) => module.plotRenderer)),
	edit: { kind: 'SourcePreview' },
	templateList: [
		{ title: 'Plot', icon: '∿', source: 'Plot:\n\ty = a sin(x)\n\ta = 1 {Slider: [0, 3]}', keywordList: ['plot', 'graph', 'function', 'desmos', 'curve', 'chart'], explain: 'Functions you can zoom and move, with sliders' },
		{
			title: 'Plot of a table',
			icon: '∿',
			source: 'Plot {Data: Gym log}:\n\t(Date, Weight) {Kind: Line, Trend: Linear}',
			keywordList: ['chart', 'data', 'table', 'line chart', 'trend', 'graph'],
			explain: 'A line through the columns of a table, found by its title (Gym log)',
		},
		{
			title: 'Bar chart',
			icon: '▮',
			source: 'Plot {Data: Spending}:\n\t(Category, Amount) {Kind: Bar, Combine: Sum}',
			keywordList: ['bar', 'chart', 'histogram', 'category', 'expense'],
			explain: 'Totals by category from a table titled Spending',
		},
		{ title: 'Pie chart', icon: '◔', source: 'Plot {Data: Spending}:\n\t(Category, Amount) {Kind: Pie}', keywordList: ['pie', 'donut', 'share', 'chart', 'category'], explain: 'Shares by category from a table titled Spending; Kind: Donut for a ring' },
		{ title: '3D surface', icon: '◬', source: 'Plot {X: [-3, 3], Y: [-3, 3]}:\n\tz = sin(x) cos(y)', keywordList: ['3d', 'surface', 'plot', 'graph', 'space'], explain: 'A surface you can turn' },
		{ title: 'Implicit curve', icon: '◯', source: 'Plot:\n\tx^2 + y^2 = 4\n\ty < x {Opacity: 0.15}', keywordList: ['implicit', 'circle', 'inequality', 'region'], explain: 'Equations and regions in x and y' },
	],
	plainText: (block) => block.body,
};

export const plotModule: ModuleDefinition = {
	kind: 'Module',
	name: 'Plot',
	publisher: 'Octaether',
	version: '1.0.0',
	title: 'Plot',
	explain:
		'Graphs like Desmos, one line each: y = f(x), x² + y² = 4, y < x, r = 1 + cos(θ), (cos t, sin t), points, sliders for numbers, and data from tables (lines, points, bars, areas, totals by month, trend lines). In 3D: z = f(x, y), implicit surfaces, curves, and points. Drag, zoom, and turn them, or fix the view.',
	use: ['TableData'],
	settingList: [
		{ id: 'Plot.Interactive', title: 'Interactive plots', type: 'Toggle', default: true, explain: 'Plots can be dragged, zoomed, and turned unless they say Interactive: False. Off: every plot shows exactly its X and Y.' },
		{ id: 'Plot.Height', title: 'Height', type: 'Choice', choiceList: ['14em', '20em', '26em', '32em'], default: '20em', explain: 'How tall a plot is, unless it says Height.' },
	],
	blockTypeList: [plotType],
};
