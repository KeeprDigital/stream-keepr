import { describe, expect, it, vi } from 'vitest';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
} from '~~/server/modules/graphics-asset-library/object-store';
import {
	createSilentVideoPlaybackServiceBindingValidator,
	createUnavailableSilentVideoPlaybackValidator,
	silentVideoPlaybackValidationIssue,
} from '~~/server/modules/graphics-asset-library/silent-video-playback-validator';

const input = {
	operationId: graphicsIngestionOperationId('operation-1'),
	idempotencyKey: 'silent-video-playback-v1:operation-1:source:facts',
	sourceDigest: 'a'.repeat(64),
	sourceByteLength: 1234,
	sourceContentType: 'video/webm' as const,
	factsDigest: 'b'.repeat(64),
	inspectedFacts: {
		kind: 'silent-video' as const,
		format: 'webm' as const,
		codec: 'vp9' as const,
		canonicalMime: 'video/webm' as const,
		byteLength: 1234,
		sha256: 'a'.repeat(64),
		width: 16,
		height: 16,
		durationSeconds: 1,
		frameRate: 2,
		frameCount: 2,
		bitDepth: 8 as const,
		colorSpace: 'sdr' as const,
		chromaSubsampling: '4:2:0' as const,
		hasAlpha: false,
		fastStart: null,
		seekable: true as const,
		posterTimeSeconds: 0.1,
		targetCompatibility: 'all-supported' as const,
	},
};

function boundHeaders(extra: Record<string, string> = {}) {
	return {
		'x-stream-keepr-operation-id': input.operationId,
		'x-stream-keepr-idempotency-key': input.idempotencyKey,
		'x-stream-keepr-source-digest': input.sourceDigest,
		'x-stream-keepr-facts-digest': input.factsDigest,
		...extra,
	};
}

describe('silent-video playback validation runtime adapter', () => {
	it('binds the Workflow request and streams its trusted deterministic poster result', async () => {
		const poster = Uint8Array.of(1, 2, 3);
		const fetch = vi.fn(async (_request: Request) => new Response(poster, {
			headers: boundHeaders({
				'content-length': String(poster.byteLength),
				'x-stream-keepr-video-width': '16',
				'x-stream-keepr-video-height': '16',
				'x-stream-keepr-video-duration': '1',
				'x-stream-keepr-poster-time': '0.1',
				'x-stream-keepr-muted-inline-playback': 'true',
				'x-stream-keepr-seeked': 'true',
				'x-stream-keepr-transparency-rendered': 'false',
				'x-stream-keepr-poster-digest': 'c'.repeat(64),
			}),
		}));
		const validator = createSilentVideoPlaybackServiceBindingValidator({ fetch });

		const result = await validator.validate(input);

		expect(fetch).toHaveBeenCalledOnce();
		const request = fetch.mock.calls[0]![0];
		expect(request.headers.get('idempotency-key')).toBe(input.idempotencyKey);
		await expect(request.json()).resolves.toMatchObject({
			operationId: input.operationId,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			inspectedFacts: { codec: 'vp9' },
		});
		expect(result).toMatchObject({
			outcome: 'accepted',
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			mutedInlinePlayback: true,
			seeked: true,
		});
		if (result.outcome !== 'accepted')
			throw new Error('Expected an accepted validation result');
		await expect(consumeBoundedByteStream(result.poster)).resolves.toEqual(poster);
	});

	it.each([429, 500, 503])('maps service status %s to retryable unavailable', async (status) => {
		const validator = createSilentVideoPlaybackServiceBindingValidator({
			fetch: async () => new Response(null, { status }),
		});
		await expect(validator.validate(input)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});

	it.each([
		['x-stream-keepr-muted-inline-playback', 'false'],
		['x-stream-keepr-seeked', 'false'],
		['x-stream-keepr-transparency-rendered', 'not-a-boolean'],
	] as const)('fails closed for invalid trusted proof header %s', async (header, value) => {
		const validator = createSilentVideoPlaybackServiceBindingValidator({
			fetch: async () => new Response(Uint8Array.of(1), {
				headers: boundHeaders({
					'content-length': '1',
					'x-stream-keepr-video-width': '16',
					'x-stream-keepr-video-height': '16',
					'x-stream-keepr-video-duration': '1',
					'x-stream-keepr-poster-time': '0.1',
					'x-stream-keepr-muted-inline-playback': 'true',
					'x-stream-keepr-seeked': 'true',
					'x-stream-keepr-transparency-rendered': 'false',
					'x-stream-keepr-poster-digest': 'c'.repeat(64),
					[header]: value,
				}),
			}),
		});

		await expect(validator.validate(input)).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});

	it('fails closed when no production binding is configured', async () => {
		await expect(
			createUnavailableSilentVideoPlaybackValidator().validate(input),
		).resolves.toEqual({
			outcome: 'unavailable',
			retryable: true,
		});
	});

	it('requires the trusted result to prove transparency for VP9 alpha', async () => {
		const alphaInput = {
			...input,
			inspectedFacts: {
				...input.inspectedFacts,
				hasAlpha: true,
				targetCompatibility: 'chromium-transparency' as const,
			},
		};
		const accepted = {
			outcome: 'accepted' as const,
			operationId: alphaInput.operationId,
			idempotencyKey: alphaInput.idempotencyKey,
			sourceDigest: alphaInput.sourceDigest,
			factsDigest: alphaInput.factsDigest,
			width: alphaInput.inspectedFacts.width,
			height: alphaInput.inspectedFacts.height,
			durationSeconds: alphaInput.inspectedFacts.durationSeconds,
			posterTimeSeconds: alphaInput.inspectedFacts.posterTimeSeconds,
			mutedInlinePlayback: true as const,
			seeked: true as const,
			transparencyRendered: false,
			posterDigest: 'c'.repeat(64),
			poster: createBoundedByteStream(Uint8Array.of(1), {
				byteLength: 1,
				maximumByteLength: 2 * 1024 * 1024,
			}),
		};

		expect(silentVideoPlaybackValidationIssue(alphaInput, accepted))
			.toBe('vp9-alpha-chromium-required');
		expect(silentVideoPlaybackValidationIssue(alphaInput, {
			...accepted,
			transparencyRendered: true,
		})).toBeUndefined();
	});
});
