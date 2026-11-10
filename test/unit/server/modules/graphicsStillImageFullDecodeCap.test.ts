import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processStillImage } from '~~/server/modules/graphics-asset-library/still-image';
import { grayscalePng, jpegDeclaring, webpDeclaring } from '~~/test/helpers/graphicsImageFixtures';

// The codec port: a call here is the full Wasm decode the cap exists to prevent.
const codecs = vi.hoisted(() => ({
	decodeJpeg: vi.fn(),
	decodeWebp: vi.fn(),
}));
vi.mock('~~/runtime/graphics-still-image-codecs', () => codecs);

const FORMATS = {
	JPEG: { declaring: jpegDeclaring, decode: codecs.decodeJpeg },
	WebP: { declaring: webpDeclaring, decode: codecs.decodeWebp },
} as const;

function decodesTo(width: number, height: number) {
	const frame = {
		width,
		height,
		data: new Uint8ClampedArray(width * height * 4),
	} as ImageData;
	codecs.decodeJpeg.mockResolvedValue(frame);
	codecs.decodeWebp.mockResolvedValue(frame);
}

beforeEach(() => {
	codecs.decodeJpeg.mockReset();
	codecs.decodeWebp.mockReset();
});

describe('the full-decode pixel cap on JPEG and WebP ingestion', () => {
	it.each([
		{ format: 'JPEG', width: 3840, height: 2160 },
		{ format: 'WebP', width: 3840, height: 2160 },
		{ format: 'JPEG', width: 2160, height: 3840 },
	] as const)('accepts a $format of $width × $height, exactly at the cap', async ({ format, width, height }) => {
		decodesTo(width, height);

		const processed = await processStillImage(FORMATS[format].declaring(width, height));

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			facts: { width, height, pixelCount: 8_294_400 },
		});
		expect(FORMATS[format].decode).toHaveBeenCalledOnce();
	});

	// Refused from the header alone: the decoder is never handed the bytes.
	it.each([
		{
			format: 'JPEG',
			over: 'row',
			width: 3840,
			height: 2161,
		},
		{
			format: 'JPEG',
			over: 'column',
			width: 3841,
			height: 2160,
		},
		{
			format: 'WebP',
			over: 'row',
			width: 3840,
			height: 2161,
		},
		{
			format: 'WebP',
			over: 'column',
			width: 3841,
			height: 2160,
		},
	] as const)('refuses a $format one $over over the cap before decoding it', async ({ format, width, height }) => {
		decodesTo(width, height);

		await expect(processStillImage(FORMATS[format].declaring(width, height))).rejects.toMatchObject({
			issue: {
				severity: 'error',
				code: 'image-pixels-exceeded',
				message: expect.stringMatching(new RegExp(`^${format}.*8,294,400.*3840 × 2160.*${width} × ${height}.*PNG`)),
			},
		});
		expect(codecs.decodeJpeg).not.toHaveBeenCalled();
		expect(codecs.decodeWebp).not.toHaveBeenCalled();
	});

	it('leaves a PNG of the same over-cap size accepted', async () => {
		const processed = await processStillImage(grayscalePng(3840, 2161));

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			facts: { format: 'png', width: 3840, height: 2161 },
		});
	});

	// A revision accepted before the cap must still re-read as the same facts.
	it.each([
		{ format: 'JPEG' },
		{ format: 'WebP' },
	] as const)('still re-reads a stored $format over the cap', async ({ format }) => {
		decodesTo(3840, 2161);

		const processed = await processStillImage(FORMATS[format].declaring(3840, 2161), {}, { bounds: 'stored' });

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			facts: { width: 3840, height: 2161 },
		});
	});

	it.each([
		{ format: 'JPEG' },
		{ format: 'WebP' },
	] as const)('holds a stored $format to the profile\'s own pixel bound', async ({ format }) => {
		decodesTo(4097, 4097);

		await expect(processStillImage(FORMATS[format].declaring(4097, 4097), {}, { bounds: 'stored' }))
			.rejects
			.toMatchObject({
				issue: { code: 'image-pixels-exceeded' },
			});
		expect(FORMATS[format].decode).not.toHaveBeenCalled();
	});
});
