/**
 * The still-image fixtures the acceptance harness sends are exactly what the
 * server's own validator accepts (#302).
 *
 * The deployed-ingestion acceptance exists to prove the codec Wasm decodes on
 * the real runtime, so a fixture the validator rejects for reasons of its own
 * — a malformed comment segment, a RIFF length left stale by the marker chunk
 * — would fail the run while saying nothing about Wasm. Running each fixture
 * through `processStillImage` here pins the boundary: under Node this decodes
 * through the same `runtime/graphics-still-image-codecs` module the Worker
 * runs (vitest compiles the `?module` imports via `build/wasmModulePlugin`),
 * so a red here is a fixture defect and a red only on workerd is a runtime
 * one — which is the discrimination #302 needs.
 *
 * Distinctness is load-bearing the same way it is for the PNG fixture: the
 * library content-addresses sources, so two runs sending identical bytes would
 * share one revision and every later assertion would be about an asset two
 * runs believe they own (#159's lesson, restated for the harness).
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	distinctPixelJpeg,
	distinctPixelPng,
	distinctPixelWebp,
} from '../../../scripts/graphics-acceptance/installation.mjs';
import { processStillImage } from '../../../server/modules/graphics-asset-library/still-image';

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('graphics acceptance still-image fixtures', () => {
	const fixtures = [
		{
			label: 'PNG',
			format: 'png',
			canonicalMime: 'image/png',
			bytesFor: distinctPixelPng,
		},
		{
			label: 'JPEG',
			format: 'jpeg',
			canonicalMime: 'image/jpeg',
			bytesFor: distinctPixelJpeg,
		},
		{
			label: 'WebP',
			format: 'webp',
			canonicalMime: 'image/webp',
			bytesFor: distinctPixelWebp,
		},
	] as const;

	it.each(fixtures)('$label bytes differ per marker and repeat per marker', ({ bytesFor }) => {
		const first = bytesFor('marker-one');
		const second = bytesFor('marker-two');
		expect(sha256(first)).not.toBe(sha256(second));
		// Deterministic per marker, so a retry within one run re-sends the same
		// source instead of quietly staging a second asset.
		expect(sha256(bytesFor('marker-one'))).toBe(sha256(first));
	});

	it.each(fixtures)(
		'a marked $label fixture is accepted whole by the still-image validator',
		async ({ bytesFor, format, canonicalMime }) => {
			const bytes = bytesFor('validator-pin');
			const { report } = await processStillImage(bytes);

			expect(report).toMatchObject({
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
					frameCount: 1,
					orientation: 'normal',
				},
			});
		},
	);
});
