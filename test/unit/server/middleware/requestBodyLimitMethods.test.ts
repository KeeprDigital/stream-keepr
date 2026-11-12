import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_API_REQUEST_BODY_BYTES } from '~~/server/utils/payloadLimits';
import { MUTATION_BODY_METHODS } from '~~/shared/utils/requestBodyLimits';

// Which requests the body limit bounds, and at which limit: every mutation
// method at the general one, and a route's own only for the method it names.

const mockGetRequestHeader = vi.fn();
const mockGetRequestWebStream = vi.fn();
const mockGetRouteRules = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getRequestWebStream', mockGetRequestWebStream);
vi.stubGlobal('getRouteRules', mockGetRouteRules);
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; message: string }) => Object.assign(
	new Error(input.message),
	input,
));

const handler = (await import('~~/server/middleware/request-body-limit')).default;

const RAW_LIMIT_BYTES = 2 * MAX_API_REQUEST_BODY_BYTES;

function streamOf(...chunkSizes: number[]) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const size of chunkSizes)
				controller.enqueue(new Uint8Array(size));
			controller.close();
		},
	});
}

/** The bytes a route would read from the request the middleware bounded. */
async function bytesReadThrough(method: string, body: ReadableStream<Uint8Array>) {
	mockGetRequestWebStream.mockReturnValue(body);
	const event = { method } as any;
	handler(event);

	let bytes = 0;
	const reader = (event._requestBody as ReadableStream<Uint8Array>).getReader();
	for (let read = await reader.read(); !read.done; read = await reader.read())
		bytes += read.value.byteLength;
	return bytes;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetRequestHeader.mockReturnValue(null);
	mockGetRequestWebStream.mockReturnValue(undefined);
	mockGetRouteRules.mockReturnValue({});
});

describe.each(MUTATION_BODY_METHODS)('a streamed %s body of unknown length', (method) => {
	it('is read whole at the general limit', async () => {
		await expect(bytesReadThrough(method, streamOf(MAX_API_REQUEST_BODY_BYTES)))
			.resolves
			.toBe(MAX_API_REQUEST_BODY_BYTES);
	});

	it('is refused one byte past the general limit', async () => {
		await expect(bytesReadThrough(method, streamOf(MAX_API_REQUEST_BODY_BYTES, 1)))
			.rejects
			.toMatchObject({ statusCode: 413 });
	});
});

describe('a route registering its own limit for one method', () => {
	beforeEach(() => {
		mockGetRouteRules.mockReturnValue({
			boundedRawMutations: {
				POST: { maxBytes: RAW_LIMIT_BYTES, label: 'Raw transfer' },
			},
		});
	});

	it.each([
		[
			'a streamed body at its own limit',
			() => streamOf(MAX_API_REQUEST_BODY_BYTES, MAX_API_REQUEST_BODY_BYTES),
			RAW_LIMIT_BYTES,
		],
		[
			'a streamed body past its own limit',
			() => streamOf(RAW_LIMIT_BYTES, 1),
			413,
		],
	])('takes %s on that method: %s', async (_case, body, outcome) => {
		const read = bytesReadThrough('POST', body()).catch((refusal: { statusCode: number }) => refusal.statusCode);

		await expect(read).resolves.toBe(outcome);
	});

	it.each([
		[
			'one byte past its own limit on that method',
			'POST',
			RAW_LIMIT_BYTES + 1,
			413,
		],
		[
			'at its own limit on that method',
			'POST',
			RAW_LIMIT_BYTES,
			'admitted',
		],
		[
			'one byte past the general limit on another method',
			'PUT',
			MAX_API_REQUEST_BODY_BYTES + 1,
			413,
		],
	])('answers a declared length %s: %s', (_case, method, declared, outcome) => {
		mockGetRequestHeader.mockReturnValue(String(declared));

		let answered: unknown = 'admitted';
		try {
			handler({ method } as any);
		}
		catch (refusal) {
			answered = (refusal as { statusCode: number }).statusCode;
		}

		expect(answered).toBe(outcome);
	});
});
