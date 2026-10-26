/**
 * How many seconds a failed request was told to wait before asking again, when
 * its response said.
 *
 * `$fetch` rejects with a `FetchError` whose `response` is the native
 * `Response`, so the server's `retry-after` is read from its headers. Only the
 * delta-seconds form counts: it is the one this server writes beside a
 * transient refusal (`rethrowGraphicsAssetApiError`), and an HTTP-date or a
 * value that is not a number reads as no answer rather than a guess.
 */
export function failureRetryAfterSeconds(caught: unknown): number | undefined {
	const failure = caught as { response?: { headers?: Headers } } | null;
	const retryAfter = failure?.response?.headers?.get('retry-after')?.trim();
	return retryAfter && /^\d+$/.test(retryAfter)
		? Number(retryAfter)
		: undefined;
}
