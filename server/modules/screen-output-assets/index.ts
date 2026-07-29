import {
	screenOutputAssetCapabilityDigest,
	screenOutputAssetRepresentationTag,
} from './capability';

interface ScreenOutputAssetAuthorizationInput {
	screenId: number;
	capabilityDigest: string;
	assetId: string;
	revisionId: string;
}

type ScreenOutputAssetAuthorization
	= { outcome: 'authorized'; contentIdentity: string }
		| { outcome: 'missing' };

type ScreenOutputAssetResolution
	= {
		outcome: 'available';
		body: ReadableStream<Uint8Array>;
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
	resolve: (input: {
		assetId: string;
		revisionId: string;
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
		| { outcome: 'unavailable'; retryable: true };

interface ByteRange {
	start: number;
	end: number;
}

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

function weakEtag(value: string): string {
	return value.trim().replace(/^W\//i, '');
}

function ifNoneMatchMatches(value: string | null, etag: string): boolean {
	if (!value)
		return false;
	return value.split(',').some(candidate =>
		candidate.trim() === '*' || weakEtag(candidate) === weakEtag(etag),
	);
}

function requestedByteRange(value: string | null, byteLength: number): ByteRange | 'unsatisfiable' | undefined {
	if (!value)
		return;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!match || (!match[1] && !match[2]))
		return 'unsatisfiable';

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)
			return 'unsatisfiable';
		return {
			start: Math.max(0, byteLength - suffixLength),
			end: byteLength - 1,
		};
	}

	const start = Number(match[1]);
	const requestedEnd = match[2] ? Number(match[2]) : byteLength - 1;
	if (
		!Number.isSafeInteger(start)
		|| !Number.isSafeInteger(requestedEnd)
		|| start < 0
		|| requestedEnd < start
		|| start >= byteLength
	) {
		return 'unsatisfiable';
	}
	return {
		start,
		end: Math.min(requestedEnd, byteLength - 1),
	};
}

function rangePermitted(ifRange: string | null, etag: string): boolean {
	if (!ifRange)
		return true;
	return ifRange.trim() === etag;
}

function sliceByteStream(
	body: ReadableStream<Uint8Array>,
	range: ByteRange,
): ReadableStream<Uint8Array> {
	let sourceOffset = 0;
	return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			const chunkStart = sourceOffset;
			const chunkEnd = sourceOffset + chunk.byteLength - 1;
			sourceOffset += chunk.byteLength;
			if (chunkEnd < range.start)
				return;
			if (chunkStart > range.end) {
				controller.terminate();
				return;
			}
			const start = Math.max(0, range.start - chunkStart);
			const end = Math.min(chunk.byteLength, range.end - chunkStart + 1);
			if (end > start)
				controller.enqueue(chunk.subarray(start, end));
			if (chunkEnd >= range.end)
				controller.terminate();
		},
	}));
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
			});
		}
		catch {
			return { outcome: 'unavailable', retryable: true };
		}
		if (authorization.outcome === 'missing')
			return { outcome: 'missing' };

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

		const headers = immutableHeaders({
			contentType: resolution.contentType,
			byteLength: resolution.byteLength,
			etag,
		});
		if (ifNoneMatchMatches(input.headers.get('if-none-match'), etag)) {
			await resolution.body.cancel();
			return {
				outcome: 'delivered',
				response: new Response(null, {
					status: 304,
					headers: publicHeaders(headers),
				}),
			};
		}

		const requestedRange = rangePermitted(input.headers.get('if-range'), etag)
			? requestedByteRange(input.headers.get('range'), resolution.byteLength)
			: undefined;
		if (requestedRange === 'unsatisfiable') {
			await resolution.body.cancel();
			headers.set('content-range', `bytes */${resolution.byteLength}`);
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
			headers.set(
				'content-range',
				`bytes ${requestedRange.start}-${requestedRange.end}/${resolution.byteLength}`,
			);
			headers.set('content-length', String(rangeLength));
			return {
				outcome: 'delivered',
				response: new Response(
					sliceByteStream(resolution.body, requestedRange),
					{
						status: 206,
						headers: publicHeaders(headers),
					},
				),
			};
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
