import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { processPng } from '~~/server/modules/graphics-asset-library/png';

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++)
			value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array) {
	let crc = 0xFFFFFFFF;
	for (const byte of bytes)
		crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.byteLength);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, checksum]);
}

function onePixelInterlacedPng(
	extraChunks: Uint8Array[] = [],
	lateChunks: Uint8Array[] = [],
) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(1, 0);
	header.writeUInt32BE(1, 4);
	header.set([8, 6, 0, 0, 1], 8);
	return Uint8Array.from(Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		...extraChunks,
		chunk('IDAT', deflateSync(Uint8Array.of(0, 20, 40, 60, 128))),
		...lateChunks,
		chunk('IEND', new Uint8Array()),
	]));
}

describe('the settled PNG compatibility profile', () => {
	it('decodes a complete Adam7-interlaced 8-bit SDR frame', async () => {
		const processed = await processPng(onePixelInterlacedPng());

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			compatibilityProfile: 'png-v1',
			facts: {
				width: 1,
				height: 1,
				bitDepth: 8,
				colorModel: 'rgba',
				hasAlpha: true,
			},
		});
		expect(Array.from(processed.thumbnail.slice(0, 8)))
			.toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	});

	it('rejects duplicate colour-profile chunks as malformed', async () => {
		const duplicateProfile = onePixelInterlacedPng([
			chunk('sRGB', Uint8Array.of(0)),
			chunk('sRGB', Uint8Array.of(0)),
		]);

		await expect(processPng(duplicateProfile)).rejects.toMatchObject({
			issue: { code: 'unsupported-png-profile' },
		});
	});

	it('rejects colour-profile chunks declared after image data', async () => {
		const lateProfile = onePixelInterlacedPng([], [
			chunk('sRGB', Uint8Array.of(0)),
		]);

		await expect(processPng(lateProfile)).rejects.toMatchObject({
			issue: { code: 'unsupported-png-profile' },
		});
	});
});
