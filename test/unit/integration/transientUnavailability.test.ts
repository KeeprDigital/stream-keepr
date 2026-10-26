import { describe, expect, it, vi } from 'vitest';
import { throughTransientUnavailability } from '~~/test/integration/transientUnavailability';

/**
 * Re-sending a request the server answered as temporarily unavailable (#633).
 *
 * A multipart part upload answered 503 once under `pnpm verify` and failed a
 * suite about something else. The library answers 503 with `retry-after` only
 * for `graphics-asset-library-unavailable` — a store it could not reach right
 * now — and the production client re-sends such a part. These rows pin that the
 * suite does the same and no more.
 */

function unavailable(seconds = '5') {
	return new Response('{"message":"Multipart part 1 is temporarily unavailable"}', {
		status: 503,
		headers: { 'retry-after': seconds },
	});
}

describe('the integration suite\'s retry of a transient 503', () => {
	it('re-sends after the interval the server asked for, and returns the next answer', async () => {
		const sleep = vi.fn(async () => {});
		const request = vi.fn()
			.mockResolvedValueOnce(unavailable('2'))
			.mockResolvedValue(new Response('{}', { status: 200 }));

		const response = await throughTransientUnavailability(request, { attempts: 3, sleep });

		expect(response.status).toBe(200);
		expect(request).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('returns the last 503 once the attempts are spent, so its body can be reported', async () => {
		const request = vi.fn(async () => unavailable());

		const response = await throughTransientUnavailability(request, {
			attempts: 3,
			sleep: async () => {},
		});

		expect(request).toHaveBeenCalledTimes(3);
		expect(response.status).toBe(503);
		await expect(response.text()).resolves.toContain('temporarily unavailable');
	});

	it('answers anything else on the first attempt', async () => {
		// A 503 without `retry-after` is not the library's transient, and a 409 is
		// the library refusing what was sent: re-sending changes neither.
		for (const answer of [
			new Response('', { status: 503 }),
			new Response('', {
				status: 409,
				headers: { 'retry-after': '5' },
			}),
			new Response('', { status: 500 }),
		]) {
			const request = vi.fn(async () => answer);
			const response = await throughTransientUnavailability(request, {
				attempts: 3,
				sleep: async () => {},
			});
			expect(response).toBe(answer);
			expect(request).toHaveBeenCalledTimes(1);
		}
	});
});
