import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { processStillImage } from '~~/server/modules/graphics-asset-library/still-image';

const jpegPixel = Uint8Array.from(Buffer.from(
	'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
	'base64',
));
const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function jpegSegment(marker: number, payload: Uint8Array) {
	const length = payload.byteLength + 2;
	return Uint8Array.of(0xFF, marker, length >>> 8, length & 0xFF, ...payload);
}

function insertAfterJpegSignature(bytes: Uint8Array, segment: Uint8Array) {
	return Uint8Array.of(...bytes.subarray(0, 2), ...segment, ...bytes.subarray(2));
}

function extendedWebp(flags: number) {
	const payload = webpPixel.subarray(12);
	const riffLength = 4 + 8 + 10 + payload.byteLength;
	return Uint8Array.of(
		0x52,
		0x49,
		0x46,
		0x46,
		riffLength,
		0,
		0,
		0,
		0x57,
		0x45,
		0x42,
		0x50,
		0x56,
		0x50,
		0x38,
		0x58,
		10,
		0,
		0,
		0,
		flags,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		...payload,
	);
}

function jpegFrameDataOffset(bytes: Uint8Array) {
	for (let index = 0; index < bytes.byteLength - 1; index++) {
		if (bytes[index] === 0xFF && (bytes[index + 1] === 0xC0 || bytes[index + 1] === 0xC2))
			return index + 4;
	}
	throw new Error('JPEG fixture does not contain a supported frame marker');
}

describe('the still-image-v1 Graphic Asset Compatibility Profile', () => {
	it.each([
		{
			label: 'JPEG',
			bytes: jpegPixel,
			sourceFileName: 'scoreboard.jpg',
			declaredMime: 'image/jpeg',
			format: 'jpeg',
			canonicalMime: 'image/jpeg',
			colorModel: 'rgb',
			hasAlpha: false,
		},
		{
			label: 'WebP',
			bytes: webpPixel,
			sourceFileName: 'scoreboard.webp',
			declaredMime: 'image/webp',
			format: 'webp',
			canonicalMime: 'image/webp',
			colorModel: 'rgba',
			hasAlpha: true,
		},
	])('accepts one complete decodable $label frame', async ({
		bytes,
		sourceFileName,
		declaredMime,
		format,
		canonicalMime,
		colorModel,
		hasAlpha,
	}) => {
		const processed = await processStillImage(bytes, {
			sourceFileName,
			declaredMime,
		});

		expect(processed.report).toEqual({
			outcome: 'accepted',
			compatibilityProfile: 'still-image-v1',
			issues: [],
			facts: {
				kind: 'image',
				format,
				canonicalMime,
				byteLength: bytes.byteLength,
				sha256: sha256(bytes),
				width: 1,
				height: 1,
				pixelCount: 1,
				frameCount: 1,
				bitDepth: 8,
				colorSpace: 'srgb',
				colorModel,
				hasAlpha,
				orientation: 'normal',
			},
		});
		expect(Array.from(processed.thumbnail.slice(0, 8)))
			.toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		await expect(processStillImage(bytes, {
			sourceFileName,
			declaredMime,
		})).resolves.toMatchObject({
			thumbnail: processed.thumbnail,
		});
	});

	it('rejects JPEG orientation metadata that would silently rotate rendering', async () => {
		const exifOrientationSix = Uint8Array.of(
			0x45,
			0x78,
			0x69,
			0x66,
			0,
			0,
			0x49,
			0x49,
			0x2A,
			0,
			8,
			0,
			0,
			0,
			1,
			0,
			0x12,
			0x01,
			3,
			0,
			1,
			0,
			0,
			0,
			6,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
		);
		const rotated = insertAfterJpegSignature(
			jpegPixel,
			jpegSegment(0xE1, exifOrientationSix),
		);

		await expect(processStillImage(rotated, {
			sourceFileName: 'rotated.jpg',
			declaredMime: 'image/jpeg',
		})).rejects.toMatchObject({
			issue: { code: 'unsupported-image-orientation' },
		});
	});

	it('rejects truncated JPEG EXIF metadata as malformed', async () => {
		const truncatedExif = insertAfterJpegSignature(
			jpegPixel,
			jpegSegment(0xE1, Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0)),
		);

		await expect(processStillImage(truncatedExif, {
			sourceFileName: 'truncated-exif.jpg',
			declaredMime: 'image/jpeg',
		})).rejects.toMatchObject({
			issue: { code: 'malformed-jpeg' },
		});
	});

	it.each([
		{
			label: 'axis',
			width: 8193,
			height: 1,
			code: 'image-dimensions-exceeded',
		},
		{
			label: 'decoded-pixel',
			width: 4097,
			height: 4097,
			code: 'image-pixels-exceeded',
		},
	])('rejects JPEG $label limits from bounded frame evidence', async ({
		width,
		height,
		code,
	}) => {
		const outOfBounds = Uint8Array.from(jpegPixel);
		const frameOffset = jpegFrameDataOffset(outOfBounds);
		outOfBounds[frameOffset + 1] = height >>> 8;
		outOfBounds[frameOffset + 2] = height & 0xFF;
		outOfBounds[frameOffset + 3] = width >>> 8;
		outOfBounds[frameOffset + 4] = width & 0xFF;

		await expect(processStillImage(outOfBounds, {
			sourceFileName: 'out-of-bounds.jpg',
			declaredMime: 'image/jpeg',
		})).rejects.toMatchObject({
			issue: { code },
		});
	});

	it('rejects JPEG bit depths outside the 8-bit SDR profile', async () => {
		const twelveBit = Uint8Array.from(jpegPixel);
		twelveBit[jpegFrameDataOffset(twelveBit)] = 12;

		await expect(processStillImage(twelveBit, {
			sourceFileName: 'twelve-bit.jpg',
			declaredMime: 'image/jpeg',
		})).rejects.toMatchObject({
			issue: { code: 'unsupported-jpeg-colour' },
		});
	});

	it('rejects embedded JPEG colour profiles', async () => {
		const profiled = insertAfterJpegSignature(
			jpegPixel,
			jpegSegment(0xE2, new TextEncoder().encode('ICC_PROFILE\0')),
		);

		await expect(processStillImage(profiled, {
			sourceFileName: 'profiled.jpg',
			declaredMime: 'image/jpeg',
		})).rejects.toMatchObject({
			issue: { code: 'unsupported-jpeg-profile' },
		});
	});

	it('rejects malformed WebP extended-header feature bits', async () => {
		await expect(processStillImage(extendedWebp(0x01), {
			sourceFileName: 'reserved.webp',
			declaredMime: 'image/webp',
		})).rejects.toMatchObject({
			issue: { code: 'malformed-webp' },
		});
	});

	it('rejects animated WebP feature evidence', async () => {
		await expect(processStillImage(extendedWebp(0x02), {
			sourceFileName: 'animated.webp',
			declaredMime: 'image/webp',
		})).rejects.toMatchObject({
			issue: { code: 'unsupported-webp-animation' },
		});
	});

	it('reconciles WebP extended alpha evidence with the frame payload', async () => {
		await expect(processStillImage(extendedWebp(0), {
			sourceFileName: 'missing-alpha-flag.webp',
			declaredMime: 'image/webp',
		})).rejects.toMatchObject({
			issue: { code: 'malformed-webp' },
		});
		await expect(processStillImage(extendedWebp(0x10), {
			sourceFileName: 'alpha.webp',
			declaredMime: 'image/webp',
		})).resolves.toMatchObject({
			report: {
				outcome: 'accepted',
				facts: { colorModel: 'rgba', hasAlpha: true },
			},
		});
	});

	it('rejects non-zero WebP lossless format versions as an unsupported profile', async () => {
		const unsupportedVersion = Uint8Array.from(webpPixel);
		unsupportedVersion[24] = unsupportedVersion[24]! | 0x20;

		await expect(processStillImage(unsupportedVersion, {
			sourceFileName: 'future.webp',
			declaredMime: 'image/webp',
		})).rejects.toMatchObject({
			issue: { code: 'unsupported-webp-profile' },
		});
	});

	it('rejects non-zero WebP extended-header reserved bytes as malformed', async () => {
		const reservedHeader = extendedWebp(0);
		reservedHeader[21] = 1;

		await expect(processStillImage(reservedHeader, {
			sourceFileName: 'reserved-header.webp',
			declaredMime: 'image/webp',
		})).rejects.toMatchObject({
			issue: { code: 'malformed-webp' },
		});
	});

	it.each([
		{
			label: 'extension',
			declarations: {
				sourceFileName: 'scoreboard.png',
				declaredMime: 'image/jpeg',
			},
			code: 'conflicting-image-extension',
		},
		{
			label: 'MIME',
			declarations: {
				sourceFileName: 'scoreboard.jpg',
				declaredMime: 'image/webp',
			},
			code: 'conflicting-image-mime',
		},
	])('rejects a conflicting JPEG $label declaration with a stable code', async ({
		declarations,
		code,
	}) => {
		await expect(processStillImage(jpegPixel, declarations)).rejects.toMatchObject({
			issue: { code },
		});
	});

	it.each([
		{
			label: 'JPEG',
			bytes: jpegPixel,
			sourceFileName: 'partial.jpg',
			declaredMime: 'image/jpeg',
			code: 'incomplete-jpeg-frame',
		},
		{
			label: 'WebP',
			bytes: webpPixel,
			sourceFileName: 'partial.webp',
			declaredMime: 'image/webp',
			code: 'malformed-webp',
		},
	])('rejects a partial $label decode with a stable code', async ({
		bytes,
		sourceFileName,
		declaredMime,
		code,
	}) => {
		await expect(processStillImage(bytes.subarray(0, -1), {
			sourceFileName,
			declaredMime,
		})).rejects.toMatchObject({
			issue: { code },
		});
	});
});
