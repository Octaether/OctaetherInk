// A .zip of files, stored without compression, to download the notes kept in this browser in one
// go. Notes are small text and pictures are compressed already, so storing is enough, and every
// system opens the result.

export interface ZipEntry {
	/** The path inside the .zip, with "/" between folders. */
	path: string;
	data: Uint8Array<ArrayBuffer>;
	time?: Date;
}

let crcTable: Uint32Array | undefined;

/** The CRC-32 a .zip keeps of each file. */
export function crc32(data: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let byte = 0; byte < 256; byte++) {
			let value = byte;
			for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
			crcTable[byte] = value >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** Time and date as a .zip writes them (MS-DOS: two-second steps, from 1980). */
function dosTime(date: Date): { time: number; day: number } {
	const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

/** The .zip of `entryList` (UTF-8 names; up to 65,535 files and 4 GB, which notes never reach). */
export function makeZip(entryList: readonly ZipEntry[]): Blob {
	const encoder = new TextEncoder();
	const partList: BlobPart[] = [];
	const centralList: BlobPart[] = [];
	let offset = 0;
	let centralSize = 0;
	for (const entry of entryList) {
		const name = encoder.encode(entry.path);
		const crc = crc32(entry.data);
		const { time, day } = dosTime(entry.time ?? new Date());
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		// bit 11: the name is UTF-8
		local.setUint16(6, 0x0800, true);
		local.setUint16(10, time, true);
		local.setUint16(12, day, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, entry.data.length, true);
		local.setUint32(22, entry.data.length, true);
		local.setUint16(26, name.length, true);
		partList.push(local.buffer, name, entry.data);
		const central = new DataView(new ArrayBuffer(46));
		central.setUint32(0, 0x02014b50, true);
		central.setUint16(4, 20, true);
		central.setUint16(6, 20, true);
		central.setUint16(8, 0x0800, true);
		central.setUint16(12, time, true);
		central.setUint16(14, day, true);
		central.setUint32(16, crc, true);
		central.setUint32(20, entry.data.length, true);
		central.setUint32(24, entry.data.length, true);
		central.setUint16(28, name.length, true);
		central.setUint32(42, offset, true);
		centralList.push(central.buffer, name);
		offset += 30 + name.length + entry.data.length;
		centralSize += 46 + name.length;
	}
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, entryList.length, true);
	end.setUint16(10, entryList.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);
	return new Blob([...partList, ...centralList, end.buffer], { type: 'application/zip' });
}
