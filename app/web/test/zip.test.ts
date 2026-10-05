// The .zip download of the notes kept in the browser: read back the way an unzip tool reads it.
import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from '../src/zip';

const encoder = new TextEncoder();

/** The files of a stored .zip, found through its central directory. */
function readZip(bytes: Uint8Array): { path: string; text: string; crc: number }[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = bytes.length - 22;
	expect(view.getUint32(end, true)).toBe(0x06054b50);
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const list: { path: string; text: string; crc: number }[] = [];
	for (let index = 0; index < count; index++) {
		expect(view.getUint32(at, true)).toBe(0x02014b50);
		const crc = view.getUint32(at + 16, true);
		const size = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
		expect(view.getUint32(local, true)).toBe(0x04034b50);
		const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		list.push({ path, text: new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size)), crc });
		at += 46 + nameLength;
	}
	return list;
}

describe('zip', () => {
	it('computes the CRC-32 a .zip keeps', () => {
		expect(crc32(encoder.encode('hello'))).toBe(0x3610a686);
		expect(crc32(new Uint8Array())).toBe(0);
	});

	it('stores files with their folders and UTF-8 names', async () => {
		const blob = makeZip([
			{ path: 'Lab/Titration.oi', data: encoder.encode('pH 7\n'), time: new Date(2026, 9, 4, 12, 30) },
			{ path: 'Équation α.oi', data: encoder.encode('Math: e^{i\\pi}\n') },
		]);
		expect(blob.type).toBe('application/zip');
		const list = readZip(new Uint8Array(await blob.arrayBuffer()));
		expect(list.map((file) => [file.path, file.text])).toEqual([
			['Lab/Titration.oi', 'pH 7\n'],
			['Équation α.oi', 'Math: e^{i\\pi}\n'],
		]);
		expect(list[0]!.crc).toBe(crc32(encoder.encode('pH 7\n')));
	});
});
