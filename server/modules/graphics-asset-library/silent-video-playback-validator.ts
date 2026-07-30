import type {
	GraphicAssetSilentVideoFacts,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type { BoundedByteStream } from './object-store';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

export interface SilentVideoPlaybackValidationInput {
	operationId: GraphicsIngestionOperationId;
	idempotencyKey: string;
	sourceDigest: string;
	sourceByteLength: number;
	sourceContentType: 'video/mp4' | 'video/webm';
	factsDigest: string;
	inspectedFacts: GraphicAssetSilentVideoFacts;
}

interface SilentVideoPlaybackValidationBinding {
	operationId: GraphicsIngestionOperationId;
	idempotencyKey: string;
	sourceDigest: string;
	factsDigest: string;
}

export type SilentVideoPlaybackValidationResult
	= | (SilentVideoPlaybackValidationBinding & {
		outcome: 'accepted';
		width: number;
		height: number;
		durationSeconds: number;
		posterTimeSeconds: number;
		mutedInlinePlayback: true;
		seeked: true;
		transparencyRendered: boolean;
		posterDigest: string;
		poster: BoundedByteStream;
	})
	| (SilentVideoPlaybackValidationBinding & {
		outcome: 'rejected';
		stage: 'metadata' | 'playback' | 'seek' | 'poster' | 'transparency';
	})
	| {
		outcome: 'unavailable';
		retryable: true;
	};

/**
 * Internal Graphics Asset Library boundary for the idempotent Workflow that
 * runs pinned native media tooling in the scale-to-zero validation Container.
 */
export interface SilentVideoPlaybackValidator {
	validate: (
		input: SilentVideoPlaybackValidationInput,
	) => Promise<SilentVideoPlaybackValidationResult>;
}

export interface SilentVideoValidationServiceBinding {
	fetch: (input: Request) => Promise<Response>;
}

export function silentVideoPlaybackValidationIssue(
	input: SilentVideoPlaybackValidationInput,
	result: Exclude<SilentVideoPlaybackValidationResult, { outcome: 'unavailable' }>,
) {
	if (result.outcome === 'rejected') {
		return result.stage === 'transparency'
			? 'vp9-alpha-chromium-required' as const
			: 'browser-video-playback-failed' as const;
	}
	if (input.inspectedFacts.hasAlpha && !result.transparencyRendered)
		return 'vp9-alpha-chromium-required' as const;
}

function requiredHeader(response: Response, name: string) {
	const value = response.headers.get(name);
	if (!value)
		throw new Error(`Silent-video validation response omitted ${name}`);
	return value;
}

function bindingFromResponse(response: Response): SilentVideoPlaybackValidationBinding {
	return {
		operationId: requiredHeader(response, 'x-stream-keepr-operation-id') as GraphicsIngestionOperationId,
		idempotencyKey: requiredHeader(response, 'x-stream-keepr-idempotency-key'),
		sourceDigest: requiredHeader(response, 'x-stream-keepr-source-digest'),
		factsDigest: requiredHeader(response, 'x-stream-keepr-facts-digest'),
	};
}

function finiteHeader(response: Response, name: string) {
	const value = Number(requiredHeader(response, name));
	if (!Number.isFinite(value))
		throw new Error(`Silent-video validation response has invalid ${name}`);
	return value;
}

function booleanHeader(response: Response, name: string) {
	const value = requiredHeader(response, name);
	if (value !== 'true' && value !== 'false')
		throw new Error(`Silent-video validation response has invalid ${name}`);
	return value === 'true';
}

function provenTrueHeader(response: Response, name: string): true {
	if (!booleanHeader(response, name))
		throw new Error(`Silent-video validation response did not prove ${name}`);
	return true;
}

/**
 * Provider detail stays behind the validator boundary. The bound service must
 * start/reconnect the Workflow; it must not invoke an untracked Container run.
 */
export function createSilentVideoPlaybackServiceBindingValidator(
	binding: SilentVideoValidationServiceBinding,
): SilentVideoPlaybackValidator {
	return {
		async validate(input) {
			let response: Response;
			try {
				response = await binding.fetch(new Request(
					'https://silent-video-playback-validator.internal/validate',
					{
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'idempotency-key': input.idempotencyKey,
						},
						body: JSON.stringify(input),
					},
				));
			}
			catch {
				return { outcome: 'unavailable', retryable: true };
			}
			if (response.status === 429 || response.status >= 500)
				return { outcome: 'unavailable', retryable: true };
			if (response.status === 422) {
				try {
					const body = await response.json() as { stage?: unknown };
					if (!['metadata', 'playback', 'seek', 'poster', 'transparency'].includes(String(body.stage)))
						return { outcome: 'unavailable', retryable: true };
					return {
						outcome: 'rejected',
						...bindingFromResponse(response),
						stage: body.stage as Extract<SilentVideoPlaybackValidationResult, { outcome: 'rejected' }>['stage'],
					};
				}
				catch {
					return { outcome: 'unavailable', retryable: true };
				}
			}
			if (!response.ok || !response.body)
				return { outcome: 'unavailable', retryable: true };
			try {
				const posterByteLength = Number(requiredHeader(response, 'content-length'));
				if (
					!Number.isSafeInteger(posterByteLength)
					|| posterByteLength <= 0
					|| posterByteLength > MAX_SILENT_VIDEO_POSTER_BYTES
				) {
					return { outcome: 'unavailable', retryable: true };
				}
				return {
					outcome: 'accepted',
					...bindingFromResponse(response),
					width: finiteHeader(response, 'x-stream-keepr-video-width'),
					height: finiteHeader(response, 'x-stream-keepr-video-height'),
					durationSeconds: finiteHeader(response, 'x-stream-keepr-video-duration'),
					posterTimeSeconds: finiteHeader(response, 'x-stream-keepr-poster-time'),
					mutedInlinePlayback: provenTrueHeader(
						response,
						'x-stream-keepr-muted-inline-playback',
					),
					seeked: provenTrueHeader(
						response,
						'x-stream-keepr-seeked',
					),
					transparencyRendered: booleanHeader(
						response,
						'x-stream-keepr-transparency-rendered',
					),
					posterDigest: requiredHeader(response, 'x-stream-keepr-poster-digest'),
					poster: {
						body: response.body,
						byteLength: posterByteLength,
						maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
					},
				};
			}
			catch {
				return { outcome: 'unavailable', retryable: true };
			}
		},
	};
}

export function createUnavailableSilentVideoPlaybackValidator(): SilentVideoPlaybackValidator {
	return {
		async validate() {
			return { outcome: 'unavailable', retryable: true };
		},
	};
}
