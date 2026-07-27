import type { H3Event } from 'h3';

const textEncoder = new TextEncoder();

export const MAX_API_REQUEST_BODY_BYTES = 1024 * 1024;

function payloadTooLarge(maxBytes: number, label: string): never {
	throw createError({
		statusCode: 413,
		statusMessage: 'Payload Too Large',
		message: `${label} must not exceed ${maxBytes} bytes`,
	});
}

function invalidJsonPayload(label: string): never {
	throw createError({
		statusCode: 400,
		statusMessage: 'Bad Request',
		message: `${label} must be valid JSON`,
	});
}

export function jsonPayloadByteLength(value: unknown): number {
	return textEncoder.encode(JSON.stringify(value)).byteLength;
}

export function assertJsonPayloadSize(value: unknown, maxBytes: number, label: string): void {
	if (jsonPayloadByteLength(value) <= maxBytes)
		return;

	payloadTooLarge(maxBytes, label);
}

/**
 * Return the request stream installed by the mutation body-limit middleware.
 * Raw transfer routes should consume this stream instead of H3's original
 * Request body, which the limiting transform has already locked.
 */
export function getBoundedRequestBodyStream(event: H3Event): ReadableStream<Uint8Array> | undefined {
	const boundedRequestBody = event._requestBody;
	return boundedRequestBody
		&& typeof boundedRequestBody === 'object'
		&& 'getReader' in boundedRequestBody
		&& typeof boundedRequestBody.getReader === 'function'
		? boundedRequestBody as ReadableStream<Uint8Array>
		: getRequestWebStream(event) as ReadableStream<Uint8Array> | undefined;
}

/**
 * Read and parse a JSON request while enforcing the limit as bytes arrive.
 * Checking a parsed value is insufficient because H3's readBody() buffers the
 * complete request first, which lets a chunked request exhaust Worker memory
 * before the application can return 413.
 */
export async function readJsonPayloadLimited(
	event: H3Event,
	maxBytes: number,
	label: string,
): Promise<unknown> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new TypeError('maxBytes must be a positive safe integer');

	const contentLength = getRequestHeader(event, 'content-length');
	if (contentLength && /^\d+$/.test(contentLength.trim())) {
		const declaredBytes = Number(contentLength);
		if (declaredBytes > maxBytes)
			payloadTooLarge(maxBytes, label);
	}

	const stream = getBoundedRequestBodyStream(event);
	if (!stream) {
		const value = await readBody(event);
		assertJsonPayloadSize(value, maxBytes, label);
		return value;
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				try {
					await reader.cancel();
				}
				catch {
					// The 413 is authoritative; transport cleanup is best-effort.
				}
				payloadTooLarge(maxBytes, label);
			}
			chunks.push(value);
		}
	}
	finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	}
	catch {
		return invalidJsonPayload(label);
	}

	try {
		return JSON.parse(text) as unknown;
	}
	catch {
		return invalidJsonPayload(label);
	}
}
