import { afterAll, describe, expect, it } from 'vitest';
import { fetch, throughOneTransportFailure } from './client';

/**
 * Every request here goes through `throughOneTransportFailure`, and the reason is
 * this file's own doing.
 *
 * The rows below send bodies deliberately over the ceiling, and the server answers
 * 413 while those bytes are still arriving — so it closes a connection with an
 * unread request body on it, and the next request to reuse that pooled socket dies
 * with ECONNRESET or EPIPE before it reaches a handler at all. Observed on the
 * first `it.each` row twice over, in both spellings, once #396's boundary widened
 * the window by resolving a session ahead of the body-limit middleware.
 *
 * A streamed body cannot be replayed once it has been consumed, which is why the
 * request is handed over as a thunk: the second attempt builds a fresh one. This is
 * not a softened assertion — a transport failure is the absence of an answer, and a
 * server that is really broken fails both attempts.
 */
const GENERAL_LIMIT_BYTES = 1024 * 1024;
const RAW_TRANSFER_LIMIT_BYTES = 2 * 1024 * 1024;

function chunkedBody(...chunkSizes: number[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunkSize of chunkSizes)
				controller.enqueue(new Uint8Array(chunkSize));
			controller.close();
		},
	});
}

function streamingMutation(method: 'DELETE' | 'PATCH' | 'POST' | 'PUT', body: ReadableStream<Uint8Array>): RequestInit {
	return {
		method,
		body,
		duplex: 'half',
	} as RequestInit & { duplex: 'half' };
}

describe('request body limits', () => {
	/**
	 * Absorb the last poisoned socket here, rather than leaving it for whoever runs
	 * next.
	 *
	 * The final row above answers 413 with bytes still arriving, so it leaves the
	 * pool holding a connection the next request will die on — and with
	 * `fileParallelism: false` the next request is very often in another **file**,
	 * where the failure would read as that file's defect. One throwaway request
	 * takes it: `/api/time` is outside the boundary and costs nothing, and its own
	 * retry is what makes it the request that dies instead of somebody else's.
	 */
	afterAll(async () => {
		await throughOneTransportFailure(() => fetch('/api/time'));
	});

	it('accepts a raw mutation stream above the general limit when the route declares a larger limit', async () => {
		const receivedBytes = GENERAL_LIMIT_BYTES + 1;

		const response = await throughOneTransportFailure(() => fetch(
			'/api/_test/bounded-raw-mutation',
			streamingMutation('POST', chunkedBody(GENERAL_LIMIT_BYTES, 1)),
		));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ receivedBytes });
	});

	it('rejects a raw mutation whose declared length exceeds its route limit', async () => {
		const response = await throughOneTransportFailure(() => fetch('/api/_test/bounded-raw-mutation', {
			method: 'POST',
			body: new Uint8Array(RAW_TRANSFER_LIMIT_BYTES + 1),
		}));

		expect(response.status).toBe(413);
	});

	it('rejects a raw mutation when unknown-length streamed bytes exceed its route limit', async () => {
		const response = await throughOneTransportFailure(() => fetch(
			'/api/_test/bounded-raw-mutation',
			streamingMutation('POST', chunkedBody(RAW_TRANSFER_LIMIT_BYTES, 1)),
		));

		expect(response.status).toBe(413);
	});

	it.each(['DELETE', 'PATCH', 'POST', 'PUT'] as const)(
		'keeps the general limit on ordinary %s mutations',
		async (method) => {
			const response = await throughOneTransportFailure(() => fetch(
				'/api/_test/ordinary-mutation',
				streamingMutation(method, chunkedBody(GENERAL_LIMIT_BYTES, 1)),
			));

			expect(response.status).toBe(413);
		},
	);

	it('does not apply a registered limit to another method at the same path', async () => {
		const response = await throughOneTransportFailure(() => fetch('/api/_test/bounded-raw-mutation', {
			method: 'PUT',
			body: new Uint8Array(GENERAL_LIMIT_BYTES + 1),
		}));

		expect(response.status).toBe(413);
	});
});
