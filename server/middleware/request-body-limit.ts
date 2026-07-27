import { MAX_API_REQUEST_BODY_BYTES } from '~~/server/utils/payloadLimits';
import { boundedRawMutationPolicy } from '~~/server/utils/rawMutationRoutes';
import { MUTATION_BODY_METHODS } from '~~/shared/utils/requestBodyLimits';

const PAYLOAD_METHODS = new Set<string>(MUTATION_BODY_METHODS);

function requestPayloadTooLarge(maxBytes: number, label: string): never {
	throw createError({
		statusCode: 413,
		statusMessage: 'Payload Too Large',
		message: `${label} must not exceed ${maxBytes} bytes`,
	});
}

/**
 * Apply one bounded stream to every mutation request before a route calls
 * H3's buffering body helpers. Explicit raw mutation route rules can replace
 * the general ceiling with a route-owned limit, while unknown-length/chunked
 * bodies remain bounded as their bytes arrive.
 */
export default defineEventHandler((event) => {
	if (!PAYLOAD_METHODS.has(event.method))
		return;

	const routePolicy = boundedRawMutationPolicy(getRouteRules(event), event.method);
	const maxBytes = routePolicy?.maxBytes ?? MAX_API_REQUEST_BODY_BYTES;
	const label = routePolicy?.label ?? 'Request body';
	const contentLength = getRequestHeader(event, 'content-length');
	if (contentLength && /^\d+$/.test(contentLength.trim())) {
		if (Number(contentLength) > maxBytes)
			requestPayloadTooLarge(maxBytes, label);
	}

	const source = getRequestWebStream(event);
	if (!source)
		return;

	let totalBytes = 0;
	event._requestBody = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			totalBytes += chunk.byteLength;
			if (totalBytes > maxBytes)
				requestPayloadTooLarge(maxBytes, label);
			controller.enqueue(chunk);
		},
	}));
});
