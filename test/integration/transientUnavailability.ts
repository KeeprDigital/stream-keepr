/**
 * Re-send a request the server answered as temporarily unavailable (#633).
 *
 * The library answers 503 with `retry-after` only for
 * `graphics-asset-library-unavailable` (`rethrowGraphicsAssetApiError`): a store
 * it could not reach right now. For a multipart part that is a documented
 * transient — the part is checkpointed as failed and may be sent again, up to
 * the transfer's `maximumPartAttempts` — and `useGraphicsIngestionTransfer`
 * re-sends it. A part PUT once answered 503 under `pnpm verify` and failed a
 * preflight suite that was about something else; seven further full runs never
 * repeated it, so the suite now does what the production client does.
 *
 * Only that answer is retried. A 503 without `retry-after` is not the library's,
 * and any other status is a verdict a second send would not change. The last
 * answer is returned whatever it is, so the caller's status assertion reports
 * its body.
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
