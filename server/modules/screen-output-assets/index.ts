import {
	ifNoneMatchMatches,
	rangePermitted,
	requestedByteRange,
} from '~~/server/utils/byteRangeContentDelivery';
import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';
import {
	screenOutputAssetCapabilityDigest,
	screenOutputAssetRepresentationTag,
} from './capability';

interface ScreenOutputAssetAuthorizationInput {
	screenId: number;
	capabilityDigest: string;
	assetId: string;
	revisionId: string;
	/**
	 * The playback engine of the browser asking for these exact bytes.
	 *
	 * Carried per request rather than per capability session because that is the
	 * granularity the answer has: a Screen may publish one revision only Chromium
	 * can play and a dozen every engine can, and refusing the session for the first
	 * loses the output all twelve (#98).
	 */
	actualVideoTarget: 'chromium' | 'safari' | 'other';
}

type ScreenOutputAssetAuthorization
	= { outcome: 'authorized'; contentIdentity: string }
		| { outcome: 'missing' }
		| { outcome: 'incompatible'; code: 'vp9-alpha-chromium-required' };

type ScreenOutputAssetResolution
	= {
		outcome: 'available';
		body: ReadableStream<Uint8Array>;
		byteLength: number;
		contentType: string;
	}
	| { outcome: 'missing' }
	| { outcome: 'unavailable'; retryable: true };

type ScreenOutputAssetInspection
	= {
		outcome: 'available';
		byteLength: number;
		contentType: string;
	}
	| { outcome: 'missing' }
	| { outcome: 'unavailable'; retryable: true };

interface ScreenOutputAssetCache {
	match: (request: Request) => Promise<Response | undefined>;
	put: (request: Request, response: Response) => Promise<void>;
}

interface ScreenOutputAssetDeliveryDependencies {
	signingKey: string;
	authorize: (
		input: ScreenOutputAssetAuthorizationInput,
	) => Promise<ScreenOutputAssetAuthorization>;
	inspect: (input: {
		assetId: string;
		revisionId: string;
	}) => Promise<ScreenOutputAssetInspection>;
	resolve: (input: {
		assetId: string;
		revisionId: string;
		range?: { offset: number; length: number };
	}) => Promise<ScreenOutputAssetResolution>;
	cache?: ScreenOutputAssetCache;
	defer?: (promise: Promise<unknown>) => void;
}

interface ScreenOutputAssetDeliveryInput {
	screenId: number;
	capability: string;
	assetId: string;
	revisionId: string;
	headers: Headers;
}

type ScreenOutputAssetDeliveryOutcome
	= { outcome: 'delivered'; response: Response }
		| { outcome: 'missing' }
		| { outcome: 'incompatible'; code: 'vp9-alpha-chromium-required' }
		| { outcome: 'unavailable'; retryable: true };

function opaqueEtag(representationTag: string): string {
	return `"sk-${representationTag}"`;
}

function internalCacheRequest(
	representationTag: string,
	requestHeaders: Headers,
): Request {
	const headers = new Headers();
	for (const name of ['range', 'if-none-match', 'if-modified-since'] as const) {
		const value = requestHeaders.get(name);
		if (value)
			headers.set(name, value);
	}
	return new Request(`https://screen-output-content.invalid/${representationTag}`, {
		headers,
	});
}

function publicHeaders(headers: Headers): Headers {
	const result = new Headers(headers);
	result.set('cache-control', 'private, no-store');
	result.set('vary', 'authorization, cookie');
	// eslint-disable-next-line drizzle/enforce-delete-with-where -- Web Headers API, not a Drizzle table.
	result.delete('cache-tag');
	return result;
}

function publicResponse(response: Response): Response {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: publicHeaders(response.headers),
	});
}

function immutableHeaders(input: {
	contentType: string;
	byteLength: number;
	etag: string;
}): Headers {
	return new Headers({
		'accept-ranges': 'bytes',
		'cache-control': 'public, max-age=31536000, immutable',
		'content-length': String(input.byteLength),
		'content-type': input.contentType,
		'etag': input.etag,
	});
}

export function createScreenOutputAssetDelivery(
	dependencies: ScreenOutputAssetDeliveryDependencies,
) {
	async function deliver(
		input: ScreenOutputAssetDeliveryInput,
	): Promise<ScreenOutputAssetDeliveryOutcome> {
		let authorization: ScreenOutputAssetAuthorization;
		try {
			authorization = await dependencies.authorize({
				screenId: input.screenId,
				capabilityDigest: await screenOutputAssetCapabilityDigest(input.capability),
				assetId: input.assetId,
				revisionId: input.revisionId,
				actualVideoTarget: graphicsVideoTargetForUserAgent(
					input.headers.get('user-agent') ?? '',
				),
			});
		}
		catch {
			return { outcome: 'unavailable', retryable: true };
		}
		if (authorization.outcome === 'missing')
			return { outcome: 'missing' };
		if (authorization.outcome === 'incompatible')
			return authorization;

		const representationTag = await screenOutputAssetRepresentationTag({
			signingKey: dependencies.signingKey,
			contentIdentity: authorization.contentIdentity,
		});
		const etag = opaqueEtag(representationTag);
		const cacheRequest = internalCacheRequest(representationTag, input.headers);
		if (dependencies.cache) {
			const cached = await dependencies.cache.match(cacheRequest).catch(() => undefined);
			if (cached)
				return { outcome: 'delivered', response: publicResponse(cached) };
		}

		let inspection: ScreenOutputAssetInspection;
		try {
			inspection = await dependencies.inspect({
				assetId: input.assetId,
				revisionId: input.revisionId,
			});
		}
		catch {
			return { outcome: 'unavailable', retryable: true };
		}
		if (inspection.outcome === 'missing')
			return { outcome: 'missing' };
		if (inspection.outcome === 'unavailable')
			return inspection;

		const headers = immutableHeaders({
			contentType: inspection.contentType,
			byteLength: inspection.byteLength,
			etag,
		});
		if (ifNoneMatchMatches(input.headers.get('if-none-match'), etag)) {
			return {
				outcome: 'delivered',
				response: new Response(null, {
					status: 304,
					headers: publicHeaders(headers),
				}),
			};
		}

		const requestedRange = rangePermitted(input.headers.get('if-range'), etag)
			? requestedByteRange(input.headers.get('range'), inspection.byteLength)
			: undefined;
		if (requestedRange === 'unsatisfiable') {
			headers.set('content-range', `bytes */${inspection.byteLength}`);
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Web Headers API, not a Drizzle table.
			headers.delete('content-length');
			return {
				outcome: 'delivered',
				response: new Response(null, {
					status: 416,
					headers: publicHeaders(headers),
				}),
			};
		}
		if (requestedRange) {
			const rangeLength = requestedRange.end - requestedRange.start + 1;
			let resolution: ScreenOutputAssetResolution;
			try {
				resolution = await dependencies.resolve({
					assetId: input.assetId,
					revisionId: input.revisionId,
					range: { offset: requestedRange.start, length: rangeLength },
				});
			}
			catch {
				return { outcome: 'unavailable', retryable: true };
			}
			if (resolution.outcome === 'missing')
				return { outcome: 'missing' };
			if (resolution.outcome === 'unavailable')
				return resolution;
			if (
				resolution.byteLength !== inspection.byteLength
				|| resolution.contentType !== inspection.contentType
			) {
				await resolution.body.cancel();
				return { outcome: 'unavailable', retryable: true };
			}
			headers.set(
				'content-range',
				`bytes ${requestedRange.start}-${requestedRange.end}/${inspection.byteLength}`,
			);
			headers.set('content-length', String(rangeLength));
			return {
				outcome: 'delivered',
				response: new Response(
					resolution.body,
					{
						status: 206,
						headers: publicHeaders(headers),
					},
				),
			};
		}

		let resolution: ScreenOutputAssetResolution;
		try {
			resolution = await dependencies.resolve({
				assetId: input.assetId,
				revisionId: input.revisionId,
			});
		}
		catch {
			return { outcome: 'unavailable', retryable: true };
		}
		if (resolution.outcome === 'missing')
			return { outcome: 'missing' };
		if (resolution.outcome === 'unavailable')
			return resolution;
		if (
			resolution.byteLength !== inspection.byteLength
			|| resolution.contentType !== inspection.contentType
		) {
			await resolution.body.cancel();
			return { outcome: 'unavailable', retryable: true };
		}
		const immutableResponse = new Response(resolution.body, { headers });
		if (dependencies.cache && dependencies.defer) {
			dependencies.defer(
				dependencies.cache
					.put(internalCacheRequest(representationTag, new Headers()), immutableResponse.clone())
					.catch(() => undefined),
			);
		}
		return {
			outcome: 'delivered',
			response: publicResponse(immutableResponse),
		};
	}

	return { deliver };
}

export type {
	ScreenOutputAssetAuthorizationInput,
	ScreenOutputAssetDeliveryOutcome,
};
