import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyStaticFontBrowserLoad } from '~/utils/verifyStaticFontBrowserLoad';

const challenge = {
	digest: 'a'.repeat(64),
	codePoints: [65, 48],
};

function canvasContext(options: { fallbackDependent?: boolean } = {}) {
	let font = '';
	const canvas = { width: 128, height: 96 };
	return {
		canvas,
		clearRect: vi.fn(),
		fillText: vi.fn(),
		textBaseline: 'alphabetic',
		get font() {
			return font;
		},
		set font(value: string) {
			font = value;
		},
		getImageData: () => {
			const exact = font.includes('stream-keepr-font-validation-');
			const mono = font.includes('monospace');
			const marker = exact
				? (options.fallbackDependent && mono ? 4 : 1)
				: mono
					? 3
					: 2;
			return { data: Uint8ClampedArray.of(marker, 0, 0, 255) };
		},
	} as unknown as CanvasRenderingContext2D;
}

describe('static font browser challenge proof', () => {
	beforeEach(() => {
		Object.defineProperty(document, 'fonts', {
			configurable: true,
			value: {
				add: vi.fn(),
				delete: vi.fn(),
				load: vi.fn().mockResolvedValue([]),
				check: vi.fn().mockReturnValue(true),
			},
		});
		class MockFontFace {
			async load() {
				return this;
			}
		}
		vi.stubGlobal('FontFace', MockFontFace);
	});

	it('binds every server-selected code point to identical exact-face rasters across distinct fallbacks', async () => {
		const context = canvasContext();
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
			.mockReturnValue(context);

		const evidence = await verifyStaticFontBrowserLoad(
			new Blob([Uint8Array.of(1, 2, 3)]),
			challenge,
		);

		expect(evidence).toMatchObject({
			outcome: 'font-loaded',
			challengeDigest: challenge.digest,
			glyphProofs: challenge.codePoints.map(codePoint => ({
				codePoint,
				exactWithSansDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
				exactWithMonoDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			})),
		});
		if (evidence.outcome !== 'font-loaded')
			throw new Error('Expected loaded evidence');
		expect(evidence.glyphProofs.every(proof =>
			proof.exactWithSansDigest === proof.exactWithMonoDigest
			&& proof.sansFallbackDigest !== proof.monoFallbackDigest,
		)).toBe(true);
	});

	it('rejects a challenged glyph when changing the fallback changes its raster', async () => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
			.mockReturnValue(canvasContext({ fallbackDependent: true }));

		await expect(verifyStaticFontBrowserLoad(
			new Blob([Uint8Array.of(1, 2, 3)]),
			challenge,
		)).resolves.toMatchObject({
			outcome: 'font-rejected',
			challengeDigest: challenge.digest,
			stage: 'render',
		});
	});
});
