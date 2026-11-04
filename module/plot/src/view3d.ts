// 3D plots with WebGL2 (our own small renderer): shaded surfaces with a depth buffer, implicit
// surfaces, curves as ribbons, points as round sprites, a box with ticks. Drag turns it, Shift +
// drag or a right drag moves it, the wheel zooms (after a click). A plot off screen gives back its
// WebGL context and shows its last picture, so a note may hold many.

import type { PropertyValue } from '@octaether/core-format';
import { type RenderContext, type ResolvedBlock, escapeHtml } from '@octaether/core-sdk';
import { numberTickList } from './axis';
import { type Box, type Matrix, type Mesh, curveList, fromBox, implicitMesh, multiply, orbitMatrix, perspective, project, surfaceMesh, toBox } from './mesh';
import type { PlotItem, PlotProgram } from './parse';
import { type Evaluated, localScope, pointListOf, seriesOf, toNumber } from './program';
import { type Stage, type StageHost, keepNumber } from './view';

interface Drawable {
	kind: 'Mesh' | 'Line' | 'Point';
	color: [number, number, number];
	/** Surfaces colored by height (no Color given). */
	ramp: boolean;
	opacity: number;
	mesh?: Mesh;
	lineList?: number[][];
	pointList?: number[];
	width?: number;
}

const rangeOf = (value: PropertyValue | undefined): [number, number] | undefined => {
	if (!Array.isArray(value) || value.length < 2) return undefined;
	const [a, b] = value.map(Number);
	return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : undefined;
};

function rgbOf(color: string): [number, number, number] {
	const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (hex) {
		const value = Number.parseInt(hex[1]!, 16);
		return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
	}
	const rgb = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(color);
	if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
	return [0.83, 0.66, 0.29];
}

/** A CSS color (a variable included) as the browser computes it. */
function computedColor(element: HTMLElement, css: string): string {
	const probe = document.createElement('span');
	probe.style.color = css;
	probe.style.display = 'none';
	element.append(probe);
	const value = getComputedStyle(probe).color;
	probe.remove();
	return value;
}

const meshVertex = `#version 300 es
in vec3 aPosition; in vec3 aNormal; in float aHeight;
uniform mat4 uMatrix; out vec3 vNormal; out float vHeight;
void main() { vNormal = aNormal; vHeight = aHeight; gl_Position = uMatrix * vec4(aPosition, 1.0); }`;
const meshFragment = `#version 300 es
precision mediump float;
in vec3 vNormal; in float vHeight;
uniform vec3 uColor; uniform vec3 uLow; uniform vec3 uHigh; uniform float uRamp; uniform float uOpacity; uniform vec3 uLight;
out vec4 color;
void main() {
	vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
	float light = 0.5 + 0.55 * max(dot(n, uLight), 0.0) + 0.12 * pow(max(dot(n, normalize(uLight + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
	vec3 base = mix(uColor, mix(uLow, uHigh, vHeight), uRamp);
	color = vec4(base * light, uOpacity);
}`;
const lineVertex = `#version 300 es
in vec3 aPosition; in vec3 aOther; in float aSide;
uniform mat4 uMatrix; uniform vec2 uSize; uniform float uWidth;
void main() {
	vec4 a = uMatrix * vec4(aPosition, 1.0);
	vec4 b = uMatrix * vec4(aOther, 1.0);
	vec2 sa = a.xy / a.w * uSize; vec2 sb = b.xy / b.w * uSize;
	vec2 dir = normalize(sb - sa + vec2(1e-6, 0.0));
	vec2 offset = vec2(-dir.y, dir.x) * aSide * uWidth;
	gl_Position = vec4((sa + offset) / uSize * a.w, a.z, a.w);
}`;
const pointVertex = `#version 300 es
in vec3 aPosition; uniform mat4 uMatrix; uniform float uWidth;
void main() { gl_Position = uMatrix * vec4(aPosition, 1.0); gl_PointSize = uWidth; }`;
const flatFragment = `#version 300 es
precision mediump float; uniform vec3 uColor; uniform float uOpacity; uniform float uRound; out vec4 color;
void main() {
	if (uRound > 0.5 && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
	color = vec4(uColor, uOpacity);
}`;

class Stage3D implements Stage {
	readonly element: HTMLElement;
	readonly noteMap = new Map<PlotItem, string>();
	private canvas: HTMLCanvasElement | undefined;
	private gl: WebGL2RenderingContext | undefined;
	private programMap = new Map<string, WebGLProgram>();
	private readonly label: HTMLElement;
	private readonly still: HTMLImageElement;
	private drawableList: Drawable[] = [];
	private box: Box = { x: [-5, 5], y: [-5, 5], z: [-5, 5] };
	/** The camera and box you moved to; undefined: the block's. */
	private camera: { yaw: number; pitch: number; distance: number } | undefined;
	private ownBox: Box | undefined;
	private blockCamera = { yaw: 35, pitch: 25, distance: 5.6 };
	private rebuild: (() => void) | undefined;
	private frame = 0;
	private visible = true;
	private readonly observer: IntersectionObserver | undefined;
	private readonly resize: ResizeObserver | undefined;
	private readonly pointerMap = new Map<number, { x: number; y: number }>();
	private gesture: { kind: 'Turn' | 'Move' | 'Pinch'; x: number; y: number; distance: number; camera: { yaw: number; pitch: number; distance: number }; box: Box } | undefined;
	private problem: string | undefined;

	constructor(private readonly host: StageHost) {
		this.element = document.createElement('div');
		this.element.className = 'oi-plot-stage oi-plot-stage-3d';
		this.label = document.createElement('div');
		this.label.className = 'oi-plot-3d-label';
		this.still = document.createElement('img');
		this.still.className = 'oi-plot-still';
		this.still.alt = '';
		this.still.hidden = true;
		this.element.append(this.still, this.label);
		this.bind();
		this.observer =
			typeof IntersectionObserver === 'undefined'
				? undefined
				: new IntersectionObserver((entryList) => {
						const visible = entryList.some((entry) => entry.isIntersecting);
						if (visible === this.visible) return;
						this.visible = visible;
						if (visible) this.wake();
						else this.sleep();
					}, { rootMargin: '200px' });
		this.observer?.observe(this.element);
		this.resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.schedule());
		this.resize?.observe(this.element);
	}

	destroy(): void {
		this.observer?.disconnect();
		this.resize?.disconnect();
		cancelAnimationFrame(this.frame);
		this.sleep(false);
	}

	moved(): boolean {
		return this.camera !== undefined || this.ownBox !== undefined;
	}

	resetView(): void {
		this.camera = undefined;
		this.ownBox = undefined;
		this.rebuild?.();
		this.host.viewChanged();
	}

	keptView(): Map<string, PropertyValue> {
		const camera = this.camera ?? this.blockCamera;
		const box = this.box;
		const keep = (range: [number, number]): number[] => [keepNumber(range[0], range[1] - range[0]), keepNumber(range[1], range[1] - range[0])];
		return new Map<string, PropertyValue>([
			['X', keep(box.x)],
			['Y', keep(box.y)],
			['Z', keep(box.z)],
			['Camera', new Map<string, PropertyValue>([['Yaw', Math.round(camera.yaw)], ['Pitch', Math.round(camera.pitch)]])],
		]);
	}

	zoom(factor: number): void {
		this.scaleBox(factor);
	}

	private scaleBox(factor: number): void {
		const scale = (range: [number, number]): [number, number] => {
			const middle = (range[0] + range[1]) / 2;
			return [middle - (middle - range[0]) * factor, middle + (range[1] - middle) * factor];
		};
		this.ownBox = { x: scale(this.box.x), y: scale(this.box.y), z: scale(this.box.z) };
		this.rebuild?.();
		this.host.viewChanged();
	}

	draw(program: PlotProgram, evaluated: Evaluated, colorOf: (item: PlotItem) => string, block: ResolvedBlock, context: RenderContext): void {
		const cameraValue = block.property.get('Camera');
		this.blockCamera = {
			yaw: cameraValue instanceof Map && typeof cameraValue.get('Yaw') === 'number' ? (cameraValue.get('Yaw') as number) : 35,
			pitch: cameraValue instanceof Map && typeof cameraValue.get('Pitch') === 'number' ? Math.max(-89, Math.min(89, cameraValue.get('Pitch') as number)) : 25,
			distance: 5.6,
		};
		this.rebuild = () => {
			this.build(program, evaluated, colorOf, block, context);
			this.schedule();
		};
		this.rebuild();
	}

	private build(program: PlotProgram, evaluated: Evaluated, colorOf: (item: PlotItem) => string, block: ResolvedBlock, context: RenderContext): void {
		this.noteMap.clear();
		const resolve = (color: string): [number, number, number] => rgbOf(computedColor(this.element, context.resolveColor(color) ?? color));
		const own = this.ownBox;
		const x = own?.x ?? rangeOf(block.property.get('X')) ?? [-5, 5];
		const y = own?.y ?? rangeOf(block.property.get('Y')) ?? [-5, 5];
		let z = own?.z ?? rangeOf(block.property.get('Z'));
		const surfaceList: { item: PlotItem; work: (x: number, y: number) => number }[] = [];
		const pointBag: { item: PlotItem; pointList: number[][] }[] = [];
		for (const item of program.itemList) {
			try {
				if (item.kind === 'Explicit' && item.name === 'z') {
					const run = evaluated.compiled(item.right!);
					const { scope, variable } = localScope(evaluated.scope);
					surfaceList.push({
						item,
						work: (px, py) => {
							variable.x = px;
							variable.y = py;
							return toNumber(run(scope));
						},
					});
				} else if (item.kind === 'Data' && item.partList?.length === 3) {
					const series = seriesOf(item, evaluated);
					pointBag.push({ item, pointList: series.xList.map((value, index) => [value, series.yList[index]!, series.zList?.[index] ?? Number.NaN]) });
				} else if (item.kind === 'Point' && item.space) pointBag.push({ item, pointList: pointListOf(item, evaluated) });
			} catch (error) {
				this.noteMap.set(item, error instanceof Error ? error.message : String(error));
			}
		}
		if (!z) {
			// fit the heights of the surfaces and points (outliers trimmed)
			const valueList: number[] = [];
			for (const { work } of surfaceList) for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
				const value = work(x[0] + ((x[1] - x[0]) * i) / 16, y[0] + ((y[1] - y[0]) * j) / 16);
				if (Number.isFinite(value)) valueList.push(value);
			}
			for (const { pointList } of pointBag) for (const point of pointList) if (Number.isFinite(point[2]!)) valueList.push(point[2]!);
			valueList.sort((a, b) => a - b);
			if (valueList.length) {
				const low = valueList[Math.floor(valueList.length * 0.02)]!;
				const high = valueList[Math.ceil(valueList.length * 0.98) - 1]!;
				const pad = (high - low) * 0.08 || 1;
				z = [low - pad, high + pad];
			} else z = [-5, 5];
		}
		const box: Box = { x, y, z };
		this.box = box;
		const list: Drawable[] = [];
		const opacityOf = (item: PlotItem): number => (typeof item.style.get('Opacity') === 'number' ? Math.max(0.05, Math.min(1, item.style.get('Opacity') as number)) : 1);
		for (const { item, work } of surfaceList) {
			if (item.style.get('Hidden') === true) continue;
			list.push({ kind: 'Mesh', color: resolve(colorOf(item)), ramp: !item.style.has('Color'), opacity: opacityOf(item), mesh: surfaceMesh(work, box, 72) });
		}
		for (const item of program.itemList) {
			if (item.style.get('Hidden') === true) continue;
			try {
				if (item.kind === 'Implicit' && item.relation === '=') {
					const runLeft = evaluated.compiled(item.left!);
					const runRight = evaluated.compiled(item.right!);
					const { scope, variable } = localScope(evaluated.scope);
					const mesh = implicitMesh((px, py, pz) => {
						variable.x = px;
						variable.y = py;
						variable.z = pz;
						return toNumber(runLeft(scope)) - toNumber(runRight(scope));
					}, box, 36);
					list.push({ kind: 'Mesh', color: resolve(colorOf(item)), ramp: !item.style.has('Color'), opacity: opacityOf(item), mesh });
				} else if (item.kind === 'Parametric' && item.partList?.length === 3) {
					const [nx, ny, nz] = item.partList.map((part) => evaluated.compiled(part));
					const { scope, variable } = localScope(evaluated.scope);
					const range = rangeOf(item.style.get('T')) ?? [0, 2 * Math.PI];
					const lineList = curveList(
						(t) => {
							variable.t = t;
							return [toNumber(nx!(scope)), toNumber(ny!(scope)), toNumber(nz!(scope))];
						},
						range[0],
						range[1],
						box,
						500,
					);
					list.push({ kind: 'Line', color: resolve(colorOf(item)), ramp: false, opacity: opacityOf(item), lineList, width: typeof item.style.get('Width') === 'number' ? (item.style.get('Width') as number) : 2.5 });
				} else if (item.kind === 'Implicit') this.noteMap.set(item, 'regions (<, >) are drawn in 2D plots only');
			} catch (error) {
				this.noteMap.set(item, error instanceof Error ? error.message : String(error));
			}
		}
		for (const { item, pointList } of pointBag) {
			if (item.style.get('Hidden') === true) continue;
			const flat: number[] = [];
			for (const [px, py, pz] of pointList) if (Number.isFinite(px!) && Number.isFinite(py!) && Number.isFinite(pz!)) flat.push(toBox(px!, box.x), toBox(py!, box.y), toBox(pz!, box.z));
			list.push({ kind: 'Point', color: resolve(colorOf(item)), ramp: false, opacity: 1, pointList: flat, width: 7 });
		}
		this.drawableList = list;
		this.lowColor = rgbOf(computedColor(this.element, '#3d8a7a'));
		this.highColor = rgbOf(computedColor(this.element, context.resolveColor('Accent') ?? '#d4a84b'));
		this.boxColor = rgbOf(computedColor(this.element, 'var(--oi-color-text-muted)'));
		this.gridColor = rgbOf(computedColor(this.element, 'var(--oi-color-border)'));
	}

	private lowColor: [number, number, number] = [0.35, 0.24, 0.17];
	private highColor: [number, number, number] = [0.83, 0.66, 0.29];
	private boxColor: [number, number, number] = [0.5, 0.5, 0.5];
	private gridColor: [number, number, number] = [0.85, 0.85, 0.85];

	// ------------------------------------------------------------ WebGL

	private schedule(): void {
		cancelAnimationFrame(this.frame);
		this.frame = requestAnimationFrame(() => this.paint());
	}

	private ensureContext(): WebGL2RenderingContext | undefined {
		if (this.gl && !this.gl.isContextLost()) return this.gl;
		if (!this.visible) return undefined;
		this.canvas?.remove();
		const canvas = document.createElement('canvas');
		canvas.className = 'oi-plot-canvas';
		const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false }) ?? undefined;
		if (!gl) {
			this.problem = 'This browser can’t draw 3D (WebGL 2 is off or missing).';
			this.label.innerHTML = `<div class="oi-plot-3d-problem" data-oi-problem>${escapeHtml(this.problem)}</div>`;
			return undefined;
		}
		canvas.addEventListener('webglcontextlost', (event) => {
			event.preventDefault();
			this.gl = undefined;
			this.programMap.clear();
		});
		this.element.prepend(canvas);
		this.canvas = canvas;
		this.gl = gl;
		this.programMap.clear();
		this.still.hidden = true;
		return gl;
	}

	private programOf(gl: WebGL2RenderingContext, name: string, vertex: string, fragment: string): WebGLProgram {
		let program = this.programMap.get(name);
		if (program) return program;
		const compile = (type: number, source: string): WebGLShader => {
			const shader = gl.createShader(type)!;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
			return shader;
		};
		program = gl.createProgram()!;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
		gl.linkProgram(program);
		this.programMap.set(name, program);
		return program;
	}

	private attribute(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, data: Float32Array, size: number): WebGLBuffer | undefined {
		const location = gl.getAttribLocation(program, name);
		if (location < 0) return undefined;
		const buffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
		return buffer;
	}

	private matrix(width: number, height: number): Matrix {
		const camera = this.camera ?? this.blockCamera;
		return multiply(perspective((32 * Math.PI) / 180, width / height, 0.1, 50), orbitMatrix(camera.yaw, camera.pitch, camera.distance));
	}

	private paint(): void {
		const width = Math.max(120, this.element.clientWidth || 600);
		const height = Math.max(80, this.element.clientHeight || 320);
		const gl = this.ensureContext();
		if (!gl || !this.canvas) return;
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(width * ratio);
		this.canvas.height = Math.round(height * ratio);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		const matrix = this.matrix(width, height);
		const bufferList: WebGLBuffer[] = [];
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		const keep = (buffer: WebGLBuffer | undefined): void => {
			if (buffer) bufferList.push(buffer);
		};
		const drawLine = (lineList: number[][], color: [number, number, number], lineWidth: number, opacity: number): void => {
			const program = this.programOf(gl, 'Line', lineVertex, flatFragment);
			gl.useProgram(program);
			const position: number[] = [];
			const other: number[] = [];
			const side: number[] = [];
			for (const line of lineList) {
				for (let index = 0; index + 5 < line.length; index += 3) {
					const a = line.slice(index, index + 3);
					const b = line.slice(index + 3, index + 6);
					// two triangles per piece, each corner knowing the other end
					for (const [here, there, s] of [
						[a, b, 1],
						[a, b, -1],
						[b, a, 1],
						[a, b, -1],
						[b, a, 1],
						[b, a, -1],
					] as [number[], number[], number][]) {
						position.push(...here);
						other.push(...there);
						side.push(here === a ? s : -s);
					}
				}
			}
			if (position.length === 0) return;
			keep(this.attribute(gl, program, 'aPosition', new Float32Array(position), 3));
			keep(this.attribute(gl, program, 'aOther', new Float32Array(other), 3));
			keep(this.attribute(gl, program, 'aSide', new Float32Array(side), 1));
			gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uMatrix'), false, matrix);
			gl.uniform2f(gl.getUniformLocation(program, 'uSize'), this.canvas!.width / 2, this.canvas!.height / 2);
			gl.uniform1f(gl.getUniformLocation(program, 'uWidth'), (lineWidth * ratio) / 2);
			gl.uniform3fv(gl.getUniformLocation(program, 'uColor'), color);
			gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), opacity);
			gl.uniform1f(gl.getUniformLocation(program, 'uRound'), 0);
			gl.drawArrays(gl.TRIANGLES, 0, position.length / 3);
		};
		// the box: floor grid, then edges
		const xTick = numberTickList(this.box.x[0], this.box.x[1], 260, 70);
		const yTick = numberTickList(this.box.y[0], this.box.y[1], 260, 70);
		const zTick = numberTickList(this.box.z[0], this.box.z[1], 220, 60);
		const floor: number[][] = [];
		for (const tick of xTick) floor.push([toBox(tick.value, this.box.x), -1, -1, toBox(tick.value, this.box.x), 1, -1]);
		for (const tick of yTick) floor.push([-1, toBox(tick.value, this.box.y), -1, 1, toBox(tick.value, this.box.y), -1]);
		drawLine(floor, this.gridColor, 1, 0.9);
		const edge = [
			[-1, -1, -1, 1, -1, -1], [1, -1, -1, 1, 1, -1], [1, 1, -1, -1, 1, -1], [-1, 1, -1, -1, -1, -1],
			[-1, -1, 1, 1, -1, 1], [1, -1, 1, 1, 1, 1], [1, 1, 1, -1, 1, 1], [-1, 1, 1, -1, -1, 1],
			[-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [1, 1, -1, 1, 1, 1], [-1, 1, -1, -1, 1, 1],
		];
		drawLine(edge, this.boxColor, 1, 0.45);
		// solid surfaces first, see-through ones after (without writing depth)
		const meshList = this.drawableList.filter((item) => item.kind === 'Mesh');
		for (const pass of ['Solid', 'Clear'] as const) {
			gl.depthMask(pass === 'Solid');
			for (const item of meshList) {
				if ((item.opacity < 1) !== (pass === 'Clear') || !item.mesh || item.mesh.vertexCount === 0) continue;
				const program = this.programOf(gl, 'Mesh', meshVertex, meshFragment);
				gl.useProgram(program);
				keep(this.attribute(gl, program, 'aPosition', item.mesh.position, 3));
				keep(this.attribute(gl, program, 'aNormal', item.mesh.normal, 3));
				keep(this.attribute(gl, program, 'aHeight', item.mesh.height, 1));
				gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uMatrix'), false, matrix);
				gl.uniform3fv(gl.getUniformLocation(program, 'uColor'), item.color);
				gl.uniform3fv(gl.getUniformLocation(program, 'uLow'), this.lowColor);
				gl.uniform3fv(gl.getUniformLocation(program, 'uHigh'), this.highColor);
				gl.uniform1f(gl.getUniformLocation(program, 'uRamp'), item.ramp ? 1 : 0);
				gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), item.opacity);
				const camera = this.camera ?? this.blockCamera;
				const a = (camera.yaw * Math.PI) / 180;
				gl.uniform3f(gl.getUniformLocation(program, 'uLight'), 0.35 * Math.sin(a) - 0.3, -0.35 * Math.cos(a) - 0.2, 0.85);
				gl.drawArrays(gl.TRIANGLES, 0, item.mesh.vertexCount);
			}
		}
		gl.depthMask(true);
		for (const item of this.drawableList) if (item.kind === 'Line' && item.lineList) drawLine(item.lineList, item.color, item.width ?? 2.5, item.opacity);
		for (const item of this.drawableList) {
			if (item.kind !== 'Point' || !item.pointList?.length) continue;
			const program = this.programOf(gl, 'Point', pointVertex, flatFragment);
			gl.useProgram(program);
			keep(this.attribute(gl, program, 'aPosition', new Float32Array(item.pointList), 3));
			gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uMatrix'), false, matrix);
			gl.uniform1f(gl.getUniformLocation(program, 'uWidth'), (item.width ?? 7) * ratio);
			gl.uniform3fv(gl.getUniformLocation(program, 'uColor'), item.color);
			gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), 1);
			gl.uniform1f(gl.getUniformLocation(program, 'uRound'), 1);
			gl.drawArrays(gl.POINTS, 0, item.pointList.length / 3);
		}
		gl.bindVertexArray(null);
		gl.deleteVertexArray(vao);
		for (const buffer of bufferList) gl.deleteBuffer(buffer);
		this.paintLabel(matrix, width, height, xTick, yTick, zTick);
	}

	/** Tick numbers along the box edges nearest you, and the axis names. */
	private paintLabel(matrix: Matrix, width: number, height: number, xTick: { value: number; label: string }[], yTick: { value: number; label: string }[], zTick: { value: number; label: string }[]): void {
		const camera = this.camera ?? this.blockCamera;
		const a = (camera.yaw * Math.PI) / 180;
		// the edges on the side of the box that faces you
		const nearY = Math.cos(a) >= 0 ? -1 : 1;
		const nearX = Math.sin(a) >= 0 ? 1 : -1;
		let html = '';
		const put = (point: [number, number, number], text: string, className = ''): void => {
			const spot = project(matrix, point, width, height);
			if (!spot) return;
			html += `<span class="oi-plot-3d-tick${className}" style="left:${spot.x.toFixed(1)}px;top:${spot.y.toFixed(1)}px">${escapeHtml(text)}</span>`;
		};
		for (const tick of xTick) put([toBox(tick.value, this.box.x), nearY * 1.12, -1], tick.label);
		for (const tick of yTick) put([nearX * 1.12, toBox(tick.value, this.box.y), -1], tick.label);
		for (const tick of zTick) put([-nearX * 1.08, nearY * 1.08, toBox(tick.value, this.box.z)], tick.label);
		put([0, nearY * 1.32, -1], 'x', ' oi-plot-3d-axis');
		put([nearX * 1.32, 0, -1], 'y', ' oi-plot-3d-axis');
		put([-nearX * 1.1, nearY * 1.1, 1.2], 'z', ' oi-plot-3d-axis');
		this.label.innerHTML = this.problem ? `<div class="oi-plot-3d-problem" data-oi-problem>${escapeHtml(this.problem)}</div>` : html;
	}

	/** Off screen: keep a picture, give the WebGL context back. */
	private sleep(picture = true): void {
		if (!this.gl || !this.canvas) return;
		if (picture) {
			try {
				this.still.src = this.canvas.toDataURL();
				this.still.hidden = false;
			} catch {
				this.still.hidden = true;
			}
		}
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
		this.gl = undefined;
		this.programMap.clear();
		this.canvas.remove();
		this.canvas = undefined;
	}

	private wake(): void {
		this.schedule();
	}

	// ------------------------------------------------------------ pointer

	private bind(): void {
		const element = this.element;
		element.addEventListener('contextmenu', (event) => {
			if (this.host.interactive()) event.preventDefault();
		});
		element.addEventListener('pointerdown', (event) => {
			if (!this.host.interactive() || (event.target as Element).closest('button')) return;
			this.host.focus();
			element.setPointerCapture(event.pointerId);
			this.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
			this.startGesture(event.shiftKey || event.button === 2);
			event.preventDefault();
		});
		element.addEventListener('pointermove', (event) => {
			const known = this.pointerMap.get(event.pointerId);
			if (!known || !this.gesture) return;
			known.x = event.clientX;
			known.y = event.clientY;
			const list = [...this.pointerMap.values()];
			const { camera, box } = this.gesture;
			if (this.gesture.kind === 'Pinch' && list.length >= 2) {
				const distance = Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y) || 1;
				this.ownBox = box;
				this.box = box;
				this.scaleBox(this.gesture.distance / distance);
				return;
			}
			const dx = list[0]!.x - this.gesture.x;
			const dy = list[0]!.y - this.gesture.y;
			if (this.gesture.kind === 'Turn') this.camera = { ...camera, yaw: camera.yaw - dx * 0.45, pitch: Math.max(-89, Math.min(89, camera.pitch + dy * 0.45)) };
			else {
				// move the box's window along the floor, the way the camera faces
				const a = (camera.yaw * Math.PI) / 180;
				const scale = 2.4 / Math.max(120, element.clientWidth);
				const along = (range: [number, number], amount: number): [number, number] => {
					const shift = ((range[1] - range[0]) / 2) * amount;
					return [range[0] - shift, range[1] - shift];
				};
				const mx = dx * scale * Math.cos(a) - dy * scale * Math.sin(a) * -1;
				const my = dx * scale * Math.sin(a) + dy * scale * Math.cos(a) * -1;
				this.ownBox = { x: along(box.x, mx), y: along(box.y, my), z: box.z };
				this.rebuild?.();
			}
			this.schedule();
			this.host.viewChanged();
		});
		const end = (event: PointerEvent): void => {
			if (!this.pointerMap.delete(event.pointerId)) return;
			this.gesture = undefined;
			if (this.pointerMap.size > 0) this.startGesture(false);
		};
		element.addEventListener('pointerup', end);
		element.addEventListener('pointercancel', end);
		element.addEventListener(
			'wheel',
			(event) => {
				if (!this.host.interactive() || !(this.host.focused() || event.ctrlKey)) return;
				event.preventDefault();
				this.scaleBox(Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015) * (event.deltaMode === 1 ? 16 : 1)));
			},
			{ passive: false },
		);
		element.addEventListener('dblclick', (event) => {
			if (!this.host.interactive()) return;
			event.preventDefault();
			this.resetView();
		});
	}

	private startGesture(move: boolean): void {
		const list = [...this.pointerMap.values()];
		if (list.length === 0) return;
		const camera = this.camera ?? this.blockCamera;
		const box = { x: [...this.box.x] as [number, number], y: [...this.box.y] as [number, number], z: [...this.box.z] as [number, number] };
		if (list.length >= 2) this.gesture = { kind: 'Pinch', x: 0, y: 0, distance: Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y) || 1, camera, box };
		else this.gesture = { kind: move ? 'Move' : 'Turn', x: list[0]!.x, y: list[0]!.y, distance: 1, camera, box };
	}
}

export function createStage3D(host: StageHost): Stage {
	return new Stage3D(host);
}

export { fromBox };
