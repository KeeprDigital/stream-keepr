import { expect } from 'vitest';

/**
 * Assert a raw response's status, and on a mismatch fail with its body (#633).
 *
 * `expect(response.status).toBe(200)` throws away the one account the server
 * gave of a refusal: a 503 part upload failed a run with nothing to say which
 * store refused or why. The body is read only on a mismatch, from a clone, so a
 * caller that goes on to read the response on success still can.
 *
 * Its own module, importing only vitest, so it can be tested without a server.
 */
export async function expectResponseStatus(response: Response, expected: number): Promise<void> {
	if (response.status === expected)
		return;
	const body = await response.clone().text().catch((error: unknown) => `<body unreadable: ${String(error)}>`);
	expect(response.status, `response body: ${body}`).toBe(expected);
}
