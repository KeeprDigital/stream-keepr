/**
 * Shared Graphics byte fixtures: the 1×1 PNG, distinct-digest and padded
 * variants of it, the 16×16 poster PNG, the validator's silent videos, and
 * their sha256.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import silentVideoFixturesJson from '~~/scripts/silent-video-validator-fixtures.json';

function fromBase64(base64: string) {
	return Uint8Array.from(Buffer.from(base64, 'base64'));
}

/** A valid 1×1 greyscale PNG. */
export const pixelPng = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');

/** A valid 16×16 RGBA PNG, large enough to pass as a silent video's poster. */
export const sixteenPixelPng = fromBase64('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=');

/** An empty, CRC-valid `tEXt` chunk: inserting it changes a PNG's digest, not its pixels. */
export const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/** `pixelPng` with `count` empty `tEXt` chunks before `IEND`: a distinct digest per count. */
export function pngWithTextChunks(count: number): Uint8Array {
	return Uint8Array.from(Buffer.concat([
		pixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		pixelPng.slice(-12),
	]));
}

/** The same 1×1 image as `pixelPng` under a different digest. */
export const replacementPng = pngWithTextChunks(1);

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1
				? 0xEDB88320 ^ (value >>> 1)
				: value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xFFFFFFFF;
	for (const byte of bytes)
		crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32(value: number): Uint8Array {
	return Uint8Array.of(
		(value >>> 24) & 0xFF,
		(value >>> 16) & 0xFF,
		(value >>> 8) & 0xFF,
		value & 0xFF,
	);
}

/**
 * `pixelPng` padded to exactly `byteLength` bytes by one CRC-valid ancillary
 * chunk before `IDAT`: a valid 1×1 PNG of any size, such as one that outgrows
 * a multipart part.
 */
export function pngOfByteLength(byteLength: number): Uint8Array {
	const idatOffset = 33;
	const type = new TextEncoder().encode('skPR');
	const payload = new Uint8Array(byteLength - pixelPng.byteLength - 12);
	const checksumInput = new Uint8Array(type.byteLength + payload.byteLength);
	checksumInput.set(type);
	checksumInput.set(payload, type.byteLength);
	const chunk = new Uint8Array(12 + payload.byteLength);
	chunk.set(uint32(payload.byteLength));
	chunk.set(type, 4);
	chunk.set(payload, 8);
	chunk.set(uint32(crc32(checksumInput)), chunk.byteLength - 4);
	const result = new Uint8Array(pixelPng.byteLength + chunk.byteLength);
	result.set(pixelPng.subarray(0, idatOffset));
	result.set(chunk, idatOffset);
	result.set(pixelPng.subarray(idatOffset), idatOffset + chunk.byteLength);
	return result;
}

/** Hex sha256 of `bytes`: the content digest the Graphics library keys on. */
export function digestOf(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export type SilentVideoFixtureName = keyof typeof silentVideoFixturesJson;

/** `scripts/silent-video-validator-fixtures.json`: each video's bytes and the facts the inspector derives. */
export const silentVideoFixtures = Object.fromEntries(
	Object.entries(silentVideoFixturesJson).map(([name, { base64, facts }]) => [
		name,
		{
			bytes: fromBase64(base64),
			facts,
		},
	]),
) as {
	[Name in SilentVideoFixtureName]: {
		bytes: Uint8Array;
		facts: (typeof silentVideoFixturesJson)[Name]['facts'];
	};
};

export const vp9Webm = silentVideoFixtures.vp9Webm.bytes;
export const vp9AlphaWebm = silentVideoFixtures.vp9AlphaWebm.bytes;
export const h264Mp4 = silentVideoFixtures.h264Mp4.bytes;
