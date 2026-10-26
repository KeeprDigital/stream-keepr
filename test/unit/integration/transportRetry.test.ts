import { describe, expect, it, vi } from 'vitest';
import {
	isRetryableTransportFailure,
	RETRYABLE_TRANSPORT_CODES,
	throughOneTransportFailure,
} from '~~/test/integration/transportRetry';

/** The integration client retries a transport failure exactly once, in exactly one place. */

/** An error shaped the way `fetch` reports a socket failure: the code on `cause`. */
function transportFailure(code: string) {
	return Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error(code), { code }),
	});
}

describe('the integration suite\'s transport retry', () => {
	it('makes the second attempt, and only the second', async () => {
		// The whole of what the broken version got wrong. Two attempts, never three
		// — a third would mean a second layer had grown back.
		const request = vi.fn()
			.mockRejectedValueOnce(transportFailure('ECONNRESET'))
			.mockResolvedValue('answered');

		await expect(throughOneTransportFailure(request)).resolves.toBe('answered');
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('does not attempt twice when the first attempt answered', async () => {
		const request = vi.fn().mockResolvedValue('answered');

		await expect(throughOneTransportFailure(request)).resolves.toBe('answered');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('reports a second transport failure rather than looping on it', async () => {
		// At that point the server is not answering, and a loop would turn an outage
		// into a hang — which is the failure mode a retry is supposed to prevent,
		// wearing the retry's own clothes.
		const request = vi.fn().mockRejectedValue(transportFailure('EPIPE'));

		await expect(throughOneTransportFailure(request)).rejects.toThrow('fetch failed');
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('does not retry an answer the server gave, however wrong', async () => {
		// The line that keeps this from softening an assertion: a refusal, a 500, a
		// failed expectation — anything that is not the socket — is a verdict, and a
		// verdict is not retried.
		const request = vi.fn().mockRejectedValue(new Error('expected 413 to be 200'));

		await expect(throughOneTransportFailure(request)).rejects.toThrow('expected 413 to be 200');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('recognises the socket failures by code, wrapped or bare', async () => {
		// `fetch` wraps the socket error as `cause`; anything throwing it directly is
		// read too, so the predicate does not depend on which layer reported it.
		for (const code of RETRYABLE_TRANSPORT_CODES) {
			expect(isRetryableTransportFailure(transportFailure(code))).toBe(true);
			expect(isRetryableTransportFailure(Object.assign(new Error(code), { code }))).toBe(true);
		}

		expect(RETRYABLE_TRANSPORT_CODES).toContain('ECONNRESET');
		expect(RETRYABLE_TRANSPORT_CODES).toContain('EPIPE');
	});

	it('reads nothing into an error carrying no code at all', () => {
		expect(isRetryableTransportFailure(new Error('something else'))).toBe(false);
		expect(isRetryableTransportFailure(transportFailure('ENOTFOUND'))).toBe(false);
		expect(isRetryableTransportFailure(undefined)).toBe(false);
		expect(isRetryableTransportFailure('ECONNRESET')).toBe(false);
	});
});
