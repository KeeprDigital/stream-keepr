import { MAX_API_REQUEST_BODY_BYTES } from '~~/server/utils/payloadLimits';

const PAYLOAD_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

function requestPayloadTooLarge(): never {
	throw createError({
		statusCode: 413,
		statusMessage: 'Payload Too Large',
		message: `Request body must not exceed ${MAX_API_REQUEST_BODY_BYTES} bytes`,
	});
}

/**
 * Apply one bounded stream to every mutation request before a route calls
 * H3's buffering body helpers. Route-specific limits can still impose a lower
 * ceiling, but even unknown-length/chunked bodies cannot consume unbounded
 * Worker memory first.
 */
export default defineEventHandler((event) => {
	if (!PAYLOAD_METHODS.has(event.method))
		return;

	const contentLength = getRequestHeader(event, 'content-length');
	if (contentLength && /^\d+$/.test(contentLength.trim())) {
		if (Number(contentLength) > MAX_API_REQUEST_BODY_BYTES)
			requestPayloadTooLarge();
	}

	const source = getRequestWebStream(event);
	if (!source)
		return;

	let totalBytes = 0;
	event._requestBody = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			totalBytes += chunk.byteLength;
			if (totalBytes > MAX_API_REQUEST_BODY_BYTES)
				requestPayloadTooLarge();
			controller.enqueue(chunk);
		},
	}));
});
