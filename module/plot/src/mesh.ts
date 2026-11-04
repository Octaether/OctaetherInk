// Geometry for 3D plots, in "box" space: the plot's X, Y, and Z ranges each map to −1…1, so any
// ranges fill the same cube. Surfaces z = f(x, y) are a grid; implicit surfaces F(x, y, z) = 0 come
// from marching tetrahedra (small tables, no gaps); normals point the way the value grows.

export interface Box {
	x: [number, number];
	y: [number, number];
	z: [number, number];
}

export interface Mesh {
	/** x, y, z per vertex, in box space. */
	position: Float32Array;
	normal: Float32Array;
	/** 0…1 per vertex: its height in the box (for color). */
	height: Float32Array;
	vertexCount: number;
}

export const toBox = (value: number, range: [number, number]): number => ((value - range[0]) / (range[1] - range[0])) * 2 - 1;
export const fromBox = (value: number, range: [number, number]): number => range[0] + ((value + 1) / 2) * (range[1] - range[0]);

function normalize(x: number, y: number, z: number): [number, number, number] {
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

/** z = f(x, y) over the box's x and y, as triangles; cells with a gap (NaN, ±∞) or far outside are left out. */
export function surfaceMesh(work: (x: number, y: number) => number, box: Box, count = 72): Mesh {
	const size = count + 1;
	const zGrid = new Float64Array(size * size);
	for (let row = 0; row < size; row++) {
		for (let column = 0; column < size; column++) {
			const x = fromBox((column / count) * 2 - 1, box.x);
			const y = fromBox((row / count) * 2 - 1, box.y);
			let z: number;
			try {
				z = work(x, y);
			} catch {
				z = Number.NaN;
			}
			zGrid[row * size + column] = Number.isFinite(z) ? toBox(z, box.z) : Number.NaN;
		}
	}
	const at = (column: number, row: number): number => zGrid[Math.min(count, Math.max(0, row)) * size + Math.min(count, Math.max(0, column))]!;
	const step = 2 / count;
	const position: number[] = [];
	const normal: number[] = [];
	const height: number[] = [];
	const vertex = (column: number, row: number): void => {
		const z = at(column, row);
		position.push((column / count) * 2 - 1, (row / count) * 2 - 1, Math.max(-1.6, Math.min(1.6, z)));
		// the slope from the neighbours (one side at an edge or a gap)
		const left = at(column - 1, row);
		const right = at(column + 1, row);
		const down = at(column, row - 1);
		const up = at(column, row + 1);
		const dx = Number.isFinite(left) && Number.isFinite(right) ? (right - left) / (2 * step) : Number.isFinite(right) ? (right - z) / step : Number.isFinite(left) ? (z - left) / step : 0;
		const dy = Number.isFinite(down) && Number.isFinite(up) ? (up - down) / (2 * step) : Number.isFinite(up) ? (up - z) / step : Number.isFinite(down) ? (z - down) / step : 0;
		normal.push(...normalize(-dx, -dy, 1));
		height.push(Math.max(0, Math.min(1, (z + 1) / 2)));
	};
	for (let row = 0; row < count; row++) {
		for (let column = 0; column < count; column++) {
			const a = at(column, row);
			const b = at(column + 1, row);
			const c = at(column + 1, row + 1);
			const d = at(column, row + 1);
			const inside = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= 1.6;
			if (inside(a) && inside(b) && inside(c)) {
				vertex(column, row);
				vertex(column + 1, row);
				vertex(column + 1, row + 1);
			}
			if (inside(a) && inside(c) && inside(d)) {
				vertex(column, row);
				vertex(column + 1, row + 1);
				vertex(column, row + 1);
			}
		}
	}
	return { position: new Float32Array(position), normal: new Float32Array(normal), height: new Float32Array(height), vertexCount: position.length / 3 };
}

// a cube as six tetrahedra around its main diagonal (corner index: bit 0 x, bit 1 y, bit 2 z)
const tetrahedronList = [
	[0, 1, 3, 7],
	[0, 3, 2, 7],
	[0, 2, 6, 7],
	[0, 6, 4, 7],
	[0, 4, 5, 7],
	[0, 5, 1, 7],
] as const;

/** F(x, y, z) = 0 inside the box, as triangles (marching tetrahedra on a grid of `count`³ cells). */
export function implicitMesh(work: (x: number, y: number, z: number) => number, box: Box, count = 36): Mesh {
	const size = count + 1;
	const value = new Float64Array(size * size * size);
	const sample = (bx: number, by: number, bz: number): number => {
		try {
			const result = work(fromBox(bx, box.x), fromBox(by, box.y), fromBox(bz, box.z));
			return Number.isFinite(result) ? result : Number.NaN;
		} catch {
			return Number.NaN;
		}
	};
	for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) value[(k * size + j) * size + i] = sample((i / count) * 2 - 1, (j / count) * 2 - 1, (k / count) * 2 - 1);
	const step = 2 / count;
	const position: number[] = [];
	const normal: number[] = [];
	const height: number[] = [];
	const gradient = (x: number, y: number, z: number): [number, number, number] => {
		const h = step / 2;
		return normalize(sample(x + h, y, z) - sample(x - h, y, z), sample(x, y + h, z) - sample(x, y - h, z), sample(x, y, z + h) - sample(x, y, z - h));
	};
	const push = (point: [number, number, number]): void => {
		position.push(...point);
		const [nx, ny, nz] = gradient(...point);
		normal.push(Number.isFinite(nx) ? nx : 0, Number.isFinite(ny) ? ny : 0, Number.isFinite(nz) ? nz : 1);
		height.push(Math.max(0, Math.min(1, (point[2] + 1) / 2)));
	};
	const corner = new Array<[number, number, number]>(8);
	const cornerValue = new Array<number>(8);
	for (let k = 0; k < count; k++) {
		for (let j = 0; j < count; j++) {
			for (let i = 0; i < count; i++) {
				let finite = true;
				for (let c = 0; c < 8; c++) {
					const ci = i + (c & 1);
					const cj = j + ((c >> 1) & 1);
					const ck = k + ((c >> 2) & 1);
					corner[c] = [(ci / count) * 2 - 1, (cj / count) * 2 - 1, (ck / count) * 2 - 1];
					cornerValue[c] = value[(ck * size + cj) * size + ci]!;
					if (Number.isNaN(cornerValue[c])) finite = false;
				}
				if (!finite) continue;
				for (const tetrahedron of tetrahedronList) {
					const inside: number[] = [];
					const outside: number[] = [];
					for (const c of tetrahedron) (cornerValue[c]! < 0 ? inside : outside).push(c);
					if (inside.length === 0 || outside.length === 0) continue;
					const cross = (a: number, b: number): [number, number, number] => {
						const va = cornerValue[a]!;
						const vb = cornerValue[b]!;
						const t = va / (va - vb);
						const pa = corner[a]!;
						const pb = corner[b]!;
						return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
					};
					if (inside.length === 1 || outside.length === 1) {
						const [one, rest] = inside.length === 1 ? [inside[0]!, outside] : [outside[0]!, inside];
						push(cross(one, rest[0]!));
						push(cross(one, rest[1]!));
						push(cross(one, rest[2]!));
					} else {
						const [a, b] = inside as [number, number];
						const [c, d] = outside as [number, number];
						const p = cross(a, c);
						const q = cross(a, d);
						const r = cross(b, d);
						const s = cross(b, c);
						push(p);
						push(q);
						push(r);
						push(p);
						push(r);
						push(s);
					}
				}
			}
		}
	}
	return { position: new Float32Array(position), normal: new Float32Array(normal), height: new Float32Array(height), vertexCount: position.length / 3 };
}

/** A curve in space through a parameter, in box space; broken where it is undefined. */
export function curveList(work: (t: number) => [number, number, number], from: number, to: number, box: Box, count = 400): number[][] {
	const lineList: number[][] = [];
	let line: number[] = [];
	for (let index = 0; index <= count; index++) {
		const t = from + ((to - from) * index) / count;
		let point: [number, number, number] | undefined;
		try {
			const [x, y, z] = work(t);
			if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) point = [toBox(x, box.x), toBox(y, box.y), toBox(z, box.z)];
		} catch {
			point = undefined;
		}
		if (point) line.push(...point);
		else if (line.length) {
			if (line.length >= 6) lineList.push(line);
			line = [];
		}
	}
	if (line.length >= 6) lineList.push(line);
	return lineList;
}

// ---------------------------------------------------------------- camera

export type Matrix = Float32Array;

export function multiply(a: Matrix, b: Matrix): Matrix {
	const out = new Float32Array(16);
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!;
			out[column * 4 + row] = sum;
		}
	}
	return out;
}

export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Matrix {
	const f = 1 / Math.tan(fieldOfView / 2);
	const out = new Float32Array(16);
	out[0] = f / aspect;
	out[5] = f;
	out[10] = (far + near) / (near - far);
	out[11] = -1;
	out[14] = (2 * far * near) / (near - far);
	return out;
}

/** A camera looking at the box's middle from `yaw` around z and `pitch` up (degrees), z up. */
export function orbitMatrix(yaw: number, pitch: number, distance: number): Matrix {
	const a = (yaw * Math.PI) / 180;
	const b = (pitch * Math.PI) / 180;
	const eye: [number, number, number] = [distance * Math.cos(b) * Math.sin(a), -distance * Math.cos(b) * Math.cos(a), distance * Math.sin(b)];
	const forward = normalize(-eye[0], -eye[1], -eye[2]);
	const side = normalize(forward[1] * 1 - forward[2] * 0, forward[2] * 0 - forward[0] * 1, 0);
	const up: [number, number, number] = [side[1] * forward[2] - side[2] * forward[1], side[2] * forward[0] - side[0] * forward[2], side[0] * forward[1] - side[1] * forward[0]];
	const out = new Float32Array(16);
	out[0] = side[0];
	out[4] = side[1];
	out[8] = side[2];
	out[1] = up[0];
	out[5] = up[1];
	out[9] = up[2];
	out[2] = -forward[0];
	out[6] = -forward[1];
	out[10] = -forward[2];
	out[12] = -(side[0] * eye[0] + side[1] * eye[1] + side[2] * eye[2]);
	out[13] = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
	out[14] = forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2];
	out[15] = 1;
	return out;
}

/** A point in box space → pixels on a canvas (undefined behind the camera). */
export function project(matrix: Matrix, point: readonly [number, number, number], width: number, height: number): { x: number; y: number; depth: number } | undefined {
	const [x, y, z] = point;
	const cx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
	const cy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
	const cz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
	const cw = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
	if (cw <= 1e-6) return undefined;
	return { x: ((cx / cw + 1) / 2) * width, y: ((1 - cy / cw) / 2) * height, depth: cz / cw };
}
