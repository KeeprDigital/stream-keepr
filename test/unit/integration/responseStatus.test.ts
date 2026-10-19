import { describe, expect, it } from 'vitest';
import { expectResponseStatus } from '~~/test/integration/responseStatus';

/**
 * A status assertion that says what the server said (#633).
 *
 * A multipart part upload once answered 503 where a suite expected 200, and the
 * assertion read only `response.status`, so the body naming which store refused
 * was discarded with the run. Nobody could say why it failed.
 */
describe('expectResponseStatus', () => {
	it('lets a response with the expected status through unread', async () => {
		const response = new Response('{"stage":"transferring"}', { status: 200 });

		await expectResponseStatus(response, 200);

		expect(response.bodyUsed).toBe(false);
		await expect(response.json()).resolves.toEqual({ stage: 'transferring' });
	});

	it('fails with the status and the body the server answered', async () => {
		const response = new Response(
			'{"statusCode":503,"message":"Multipart part 1 is temporarily unavailable"}',
			{ status: 503, headers: { 'retry-after': '5' } },
		);

		await expect(expectResponseStatus(response, 200)).rejects.toThrow(
			/Multipart part 1 is temporarily unavailable[\s\S]*expected 503 to be 200/,
		);
	});
});
