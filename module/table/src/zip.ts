// Zip files as Excel writes them (.xlsx is a zip of XML parts): reading every entry, and writing
// them back with only the changed ones packed again, so the rest stays byte for byte. Deflate is
// the browser's own (DecompressionStream, CompressionStream); no library.

export interface ZipEntry {
	name: string;
	/** 0 stored, 8 deflate. */
	method: number;
	crc: number;
	size: number;
	/** The entry's bytes as they are in the zip (packed when method is 8). */
	raw: Uint8Array;
	time: number;
	date: number;
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The entries of a zip; throws when it isn't one. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
	const data = view(bytes);
	let end = -1;
	for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
		if (data.getUint32(at, true) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new Error('not a zip file');
	const count = data.getUint16(end + 10, true);
	let at = data.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const list: ZipEntry[] = [];
	for (let index = 0; index < count; index++) {
		if (data.getUint32(at, true) !== 0x02014b50) throw new Error('a broken zip file');
		const method = data.getUint16(at + 10, true);
		const time = data.getUint16(at + 12, true);
		const date = data.getUint16(at + 14, true);
		const crc = data.getUint32(at + 16, true);
		const packedSize = data.getUint32(at + 20, true);
		const size = data.getUint32(at + 24, true);
		const nameLength = data.getUint16(at + 28, true);
		const extraLength = data.getUint16(at + 30, true);
		const commentLength = data.getUint16(at + 32, true);
		const local = data.getUint32(at + 42, true);
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true);
		list.push({ name, method, crc, size, raw: bytes.slice(start, start + packedSize), time, date });
		at += 46 + nameLength + extraLength + commentLength;
	}
	return list;
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
	const result = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
	return new Uint8Array(await result.arrayBuffer());
}

/** An entry's content. */
export async function entryBytes(entry: ZipEntry): Promise<Uint8Array> {
	if (entry.method === 0) return entry.raw;
	if (entry.method !== 8) throw new Error(`${entry.name} is packed in a way this app can’t read`);
	return pipe(entry.raw, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

export async function entryText(entry: ZipEntry): Promise<string> {
	return new TextDecoder().decode(await entryBytes(entry));
}

let crcTable: Uint32Array | undefined;

export function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** An entry with new content, packed again. */
export async function packEntry(entry: ZipEntry, content: string | Uint8Array): Promise<ZipEntry> {
	const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	const raw = await pipe(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
	return { ...entry, method: 8, crc: crc32(bytes), size: bytes.length, raw };
}

/** A zip of these entries, in this order. */
export function writeZip(entryList: readonly ZipEntry[]): Uint8Array {
	const encoder = new TextEncoder();
	const localList: Uint8Array[] = [];
	const centralList: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entryList) {
		const name = encoder.encode(entry.name);
		const flag = /[^\x20-\x7e]/.test(entry.name) ? 0x0800 : 0;
		const local = new Uint8Array(30 + name.length);
		const l = view(local);
		l.setUint32(0, 0x04034b50, true);
		l.setUint16(4, 20, true);
		l.setUint16(6, flag, true);
		l.setUint16(8, entry.method, true);
		l.setUint16(10, entry.time, true);
		l.setUint16(12, entry.date, true);
		l.setUint32(14, entry.crc, true);
		l.setUint32(18, entry.raw.length, true);
		l.setUint32(22, entry.size, true);
		l.setUint16(26, name.length, true);
		local.set(name, 30);
		const central = new Uint8Array(46 + name.length);
		const c = view(central);
		c.setUint32(0, 0x02014b50, true);
		c.setUint16(4, 20, true);
		c.setUint16(6, 20, true);
		c.setUint16(8, flag, true);
		c.setUint16(10, entry.method, true);
		c.setUint16(12, entry.time, true);
		c.setUint16(14, entry.date, true);
		c.setUint32(16, entry.crc, true);
		c.setUint32(20, entry.raw.length, true);
		c.setUint32(24, entry.size, true);
		c.setUint16(28, name.length, true);
		c.setUint32(42, offset, true);
		central.set(name, 46);
		localList.push(local, entry.raw);
		centralList.push(central);
		offset += local.length + entry.raw.length;
	}
	const centralSize = centralList.reduce((total, item) => total + item.length, 0);
	const end = new Uint8Array(22);
	const e = view(end);
	e.setUint32(0, 0x06054b50, true);
	e.setUint16(8, entryList.length, true);
	e.setUint16(10, entryList.length, true);
	e.setUint32(12, centralSize, true);
	e.setUint32(16, offset, true);
	const out = new Uint8Array(offset + centralSize + 22);
	let at = 0;
	for (const part of [...localList, ...centralList, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
