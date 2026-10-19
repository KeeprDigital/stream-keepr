/**
 * Re-send a request the server answered as temporarily unavailable (#633).
 *
 * On the Graphics Asset routes, 503 with `retry-after` is
 * `graphics-asset-library-unavailable` (`rethrowGraphicsAssetApiError`): a store
 * the library could not reach right now. For a multipart part that is a
 * documented transient — the part is checkpointed as failed and may be sent
 * again, up to the transfer's `maximumPartAttempts`. A part PUT once answered
 * 503 under `pnpm verify` and failed a preflight suite that was about something
 * else; seven further full runs never repeated it.
 *
 * This is a narrower form of `useGraphicsIngestionTransfer`'s retry, which
 * re-sends on any 5xx, 408, 429 or transport failure, after `retry-after` or a
 * backoff (#639). Only a 503 that asks to be retried is retried here, after the
 * interval it names: a 503 without `retry-after` (the dev server's own) is not
 * the library's transient, and must stay visible. The last answer is returned
 * whatever it is, so the caller's status assertion reports its body.
 *
 * The request arrives as a thunk because a body may have to be built again, as in
 * `./transportRetry`. Its own module, importing nothing, so it can be tested.
 */
export async function throughTransientUnavailability(
	request: () => Promise<Response>,
	options: { attempts: number; sleep?: (milliseconds: number) => Promise<void> },
): Promise<Response> {
	const sleep = options.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
	for (let attempt = 1; ; attempt++) {
		const response = await request();
		const retryAfter = response.headers.get('retry-after');
		if (response.status !== 503 || retryAfter === null || attempt >= options.attempts)
			return response;
		console.warn(`[integration] retrying after a transient 503: ${await response.text()}`);
		await sleep(Number(retryAfter) * 1000);
	}
}
