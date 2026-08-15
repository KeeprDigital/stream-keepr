import type { H3Event } from 'h3';

/**
 * The interval every retryable upstream site uses: a floor on how hard to retry,
 * not an estimate of when the provider returns.
 */
const RETRYABLE_UPSTREAM_INTERVAL_SECONDS = 5;

/**
 * Refuse a request because an upstream provider is temporarily unreachable: a
 * `retry-after` beside a cause-only throw.
 *
 * The sentence a caller receives says *temporarily*, so the response owes the
 * caller an interval — #346, the same defect #337 fixed at the author-session
 * 503. The interval is the same whether the upstream timed out or answered
 * badly, because both are the same advice to a caller.
 *
 * The payload carries only the cause, on purpose (#355): `mapPublicNitroError`
 * classifies by the code it finds there and owns the whole public spelling —
 * status, statusMessage, sentence, all of it. A status or sentence written here
 * would be dead to every caller and free to drift from the mapper's; #346's
 * verification proved exactly that of the ones the call sites used to restate.
 * If the mapper somehow did not fire, the h3 defaults (500, empty message)
 * sanitize to a bare Internal Server Error rather than publish anything.
 *
 * Call this only with a cause the mapper classifies as a retryable upstream
 * failure (the `MELEE_UPSTREAM_FAILURE` and `SCRYFALL_UPSTREAM_FAILURE`
 * branches today), and only from a branch where waiting can resolve the
 * failure — each call site says why the refusals beside it do not qualify.
 */
export function throwRetryableUpstreamRefusal(requestEvent: H3Event, upstreamError: unknown): never {
	setResponseHeader(requestEvent, 'retry-after', RETRYABLE_UPSTREAM_INTERVAL_SECONDS);
	throw createError({ cause: upstreamError });
}
