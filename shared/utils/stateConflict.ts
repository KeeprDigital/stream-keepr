/**
 * The mark a lost concurrency race carries across the wire.
 *
 * Every 409 used to read as one thing to the client, and they are two: a stale
 * `stateVersion` — somebody else got there first, and a refresh-and-retry can
 * cure it — and a refusal, the authority's judgement about the request itself,
 * which no refresh changes. `mapPublicNitroError` stamps this code onto the
 * body of every `StateConflictError`, and the client's conflict retry consults
 * it before replaying a write: an unmarked 409 is a refusal to be surfaced,
 * not a race to be re-run (#381).
 *
 * Carried at `data.code` on the response body, the same seam the Broadcast
 * Graphics rejection codes use, so `$fetch` failures answer it at
 * `error.data.data.code`.
 */
export const STATE_CONFLICT_CODE = 'state-conflict';

/** Whether a `$fetch` failure is a marked lost concurrency race. */
export function isStateConflictFetchFailure(failure: unknown): boolean {
	if (typeof failure !== 'object' || failure === null)
		return false;

	const status = failure as { statusCode?: unknown; status?: unknown };
	if (status.statusCode !== 409 && status.status !== 409)
		return false;

	const body = (failure as { data?: { data?: { code?: unknown } } }).data;
	return body?.data?.code === STATE_CONFLICT_CODE;
}
