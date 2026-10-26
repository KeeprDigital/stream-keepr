/**
 * Shared Graphics byte fixtures: the 1×1 PNG, distinct-digest variants of it,
 * the 16×16 poster PNG, the validator's silent videos, and their sha256.
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
