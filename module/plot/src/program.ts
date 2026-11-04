// Working a Plot out: its numbers (sliders included), your functions, and table columns become one
// scope; each line then gives what the views draw. Shared by the 2D and 3D views.

import { type Compiled, type ExpressionNode, ExpressionError, type Scope, type Value, compile } from '@octaether/core-expression';
import type { PropertyValue } from '@octaether/core-format';
import type { TableSnapshot } from '@octaether/core-sdk';
import { type PlotItem, type PlotProblem, type PlotProgram, parsePlot } from './parse';

export interface Evaluated {
	scope: Scope;
	/** Numbers lines give (`a = 2`, `mean(Weight)`), to show beside them. */
	valueMap: Map<PlotItem, Value>;
	problemList: PlotProblem[];
	/** Compiled once per line. */
	compiled: (node: ExpressionNode) => Compiled;
	/** The type of a table column (`Date`), when a part is just a column. */
	columnType(node: ExpressionNode): string | undefined;
	/** A part that is just a column of the plot's tables (`Weight`): its name, type, and unit. */
	columnInfo(node: ExpressionNode | undefined): { name: string; type: string; unit: string | undefined } | undefined;
}

/** Table cells as expression values: numbers stay, text stays (categories), lists join, gaps are NaN. */
function columnValue(valueList: readonly (number | string | readonly string[] | undefined)[]): Value[] {
	return valueList.map((value) => (value === undefined ? Number.NaN : typeof value === 'object' ? value.join(', ') : value));
}

/** A column's name as a formula writes it: `Body fat` → `Body_fat`. */
export const columnVariable = (name: string): string => name.trim().replace(/[^A-Za-z0-9\u0370-\u03ff_]+/g, '_');

/**
 * Works a plot out. `dataList` names the tables of `Data` (`Gym log`): their columns are names the
 * lines can use (`(Date, Weight)`), unless a line defines that name itself.
 */
export function evaluateProgram(program: PlotProgram, override: ReadonlyMap<string, number>, snapshotMap: ReadonlyMap<string, TableSnapshot | undefined>, dataList: readonly string[] = []): Evaluated {
	const problemList: PlotProblem[] = [];
	const variable: Record<string, Value | undefined> = {};
	const functionMap: Record<string, (...argumentList: Value[]) => Value> = {};
	const cache = new Map<ExpressionNode, Compiled>();
	const compiled = (node: ExpressionNode): Compiled => {
		let run = cache.get(node);
		if (!run) cache.set(node, (run = compile(node)));
		return run;
	};
	const scope: Scope = {
		variable,
		functionMap,
	};
	const report = (item: PlotItem, error: unknown): void => {
		if (error instanceof ExpressionError) problemList.push({ line: item.line, start: item.offset + error.start, end: item.offset + Math.max(error.end, error.start + 1), message: error.message });
		else problemList.push({ line: item.line, start: item.offset, end: item.offset + item.text.length, message: error instanceof Error ? error.message : String(error) });
	};
	for (const item of program.itemList) {
		if (item.kind !== 'Function') continue;
		const run = compiled(item.right!);
		const parameterList = item.parameterList ?? [];
		functionMap[item.name!] = (...argumentList) => {
			const local = Object.create(variable) as Record<string, Value | undefined>;
			parameterList.forEach((name, index) => (local[name] = argumentList[index]));
			return run({ ...scope, variable: local });
		};
	}
	for (const reference of dataList) {
		for (const column of snapshotMap.get(reference)?.columnList ?? []) {
			const name = columnVariable(column.name);
			if (variable[name] === undefined && !program.variableSet.has(name)) variable[name] = columnValue(column.valueList);
		}
	}
	// numbers, in as many rounds as they depend on each other
	const defineList = program.itemList.filter((item) => item.kind === 'Define');
	let pending = [...defineList];
	const failure = new Map<PlotItem, unknown>();
	for (let round = 0; round <= defineList.length && pending.length > 0; round++) {
		const next: PlotItem[] = [];
		for (const item of pending) {
			const forced = override.get(item.name!);
			if (forced !== undefined) {
				variable[item.name!] = forced;
				continue;
			}
			try {
				variable[item.name!] = compiled(item.right!)(scope);
			} catch (error) {
				failure.set(item, error);
				next.push(item);
			}
		}
		if (next.length === pending.length) break;
		pending = next;
	}
	for (const item of pending) report(item, failure.get(item));
	const columnInfo = (node: ExpressionNode | undefined): { name: string; type: string; unit: string | undefined } | undefined => {
		let found: TableSnapshot['columnList'][number] | undefined;
		if (node?.kind === 'Name' && !program.variableSet.has(node.name)) {
			for (const reference of dataList) {
				found = snapshotMap.get(reference)?.columnList.find((item) => columnVariable(item.name) === node.name);
				if (found) break;
			}
		}
		return found ? { name: found.name, type: found.type, unit: found.unit } : undefined;
	};
	const valueMap = new Map<PlotItem, Value>();
	for (const item of program.itemList) {
		if (item.kind === 'Define' && variable[item.name!] !== undefined) valueMap.set(item, variable[item.name!]!);
		if (item.kind === 'Value') {
			try {
				valueMap.set(item, compiled(item.node)(scope));
			} catch (error) {
				report(item, error);
			}
		}
	}
	return {
		scope,
		valueMap,
		problemList,
		compiled,
		columnType: (node) => columnInfo(node)?.type,
		columnInfo,
	};
}

/** A scope with some coordinates set (x, y, z, t, θ), reading everything else from the plot's. */
export function localScope(scope: Scope): { scope: Scope; variable: Record<string, Value | undefined> } {
	const variable = Object.create(scope.variable) as Record<string, Value | undefined>;
	return { scope: { ...scope, variable }, variable };
}

export const toNumber = (value: Value): number => (typeof value === 'number' ? value : Number.NaN);

// ---------------------------------------------------------------- data series

export type Period = 'Day' | 'Week' | 'Month' | 'Year';
export type Combine = 'Sum' | 'Average' | 'Count' | 'Min' | 'Max';

export interface Series {
	xList: number[];
	yList: number[];
	zList?: number[];
	/** When x is text: the names along the axis (x is then 0, 1, 2, …). */
	categoryList?: string[];
	dateAxis: boolean;
}

function periodStart(day: number, period: Period): number {
	const whole = Math.floor(day);
	const date = new Date(whole * 86_400_000);
	switch (period) {
		case 'Day':
			return whole;
		case 'Week':
			return whole - ((date.getUTCDay() + 6) % 7);
		case 'Month':
			return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86_400_000;
		case 'Year':
			return Date.UTC(date.getUTCFullYear(), 0, 1) / 86_400_000;
	}
}

function combine(list: readonly number[], way: Combine): number {
	const finite = list.filter(Number.isFinite);
	switch (way) {
		case 'Sum':
			return finite.reduce((total, value) => total + value, 0);
		case 'Average':
			return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : Number.NaN;
		case 'Count':
			return list.length;
		case 'Min':
			return finite.length ? Math.min(...finite) : Number.NaN;
		case 'Max':
			return finite.length ? Math.max(...finite) : Number.NaN;
	}
}

const textOf = (value: PropertyValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);

/** A data line's points: its parts worked out (lists broadcast), grouped by period or category when asked. */
export function seriesOf(item: PlotItem, evaluated: Evaluated): Series {
	const partList = item.partList ?? [];
	const valueList = partList.map((part) => evaluated.compiled(part)(evaluated.scope));
	const length = Math.max(1, ...valueList.map((value) => (Array.isArray(value) ? value.length : 1)));
	const at = (value: Value, index: number): Value => (Array.isArray(value) ? (value[index] ?? Number.NaN) : value);
	const rawX = Array.from({ length }, (_, index) => at(valueList[0]!, index));
	let yList = Array.from({ length }, (_, index) => toNumber(at(valueList[1]!, index)));
	const zList = valueList[2] !== undefined ? Array.from({ length }, (_, index) => toNumber(at(valueList[2]!, index))) : undefined;
	const xType = evaluated.columnType(partList[0]!);
	const dateAxis = xType === 'Date' || xType === 'DateTime';
	const period = (['Day', 'Week', 'Month', 'Year'] as const).find((name) => name === textOf(item.style.get('Group')));
	const way = (['Sum', 'Average', 'Count', 'Min', 'Max'] as const).find((name) => name === textOf(item.style.get('Combine')));
	const categorical = !zList && rawX.some((value) => typeof value === 'string');
	if (categorical) {
		const categoryList: string[] = [];
		const groupMap = new Map<string, number[]>();
		rawX.forEach((value, index) => {
			const name = String(value);
			if (!groupMap.has(name)) {
				groupMap.set(name, []);
				categoryList.push(name);
			}
			groupMap.get(name)!.push(yList[index]!);
		});
		return { xList: categoryList.map((_, index) => index), yList: categoryList.map((name) => combine(groupMap.get(name)!, way ?? 'Sum')), categoryList, dateAxis: false };
	}
	let xList = rawX.map(toNumber);
	if (!zList && (period || way)) {
		const groupMap = new Map<number, number[]>();
		xList.forEach((x, index) => {
			if (!Number.isFinite(x)) return;
			const key = period ? periodStart(x, period) : x;
			if (!groupMap.has(key)) groupMap.set(key, []);
			groupMap.get(key)!.push(yList[index]!);
		});
		const keyList = [...groupMap.keys()].sort((a, b) => a - b);
		xList = keyList;
		yList = keyList.map((key) => combine(groupMap.get(key)!, way ?? 'Sum'));
	}
	return { xList, yList, zList, dateAxis };
}

/** Points written out (`(1, 2)`, `[(0, 0), (1, 1)]`, `(a, f(a))`), lists broadcast. */
export function pointListOf(item: PlotItem, evaluated: Evaluated): number[][] {
	const node = item.node;
	const tupleList = node.kind === 'List' ? node.itemList : [node];
	const pointList: number[][] = [];
	for (const tuple of tupleList) {
		if (tuple.kind !== 'Tuple') continue;
		const valueList = tuple.itemList.map((part) => evaluated.compiled(part)(evaluated.scope));
		const length = Math.max(1, ...valueList.map((value) => (Array.isArray(value) ? value.length : 1)));
		for (let index = 0; index < length; index++) pointList.push(valueList.map((value) => toNumber(Array.isArray(value) ? (value[index] ?? Number.NaN) : value)));
	}
	return pointList;
}

/** A plot's program, read once per body. */
const programCache = new Map<string, PlotProgram>();
export function programOf(body: string, dimension: number | undefined): PlotProgram {
	const key = `${dimension ?? ''}|${body}`;
	let program = programCache.get(key);
	if (!program) {
		program = parsePlot(body, dimension);
		if (programCache.size > 64) programCache.clear();
		programCache.set(key, program);
	}
	return program;
}
