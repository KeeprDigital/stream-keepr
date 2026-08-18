/**
 * One retry, for a request that never reached a verdict (#396).
 *
 * `requestBodyLimits.test.ts` deliberately sends bodies over the ceiling, and the
 * server answers 413 while those bytes are still arriving — so it closes a
 * connection with an unread request body on it, and the next request to reuse that
 * pooled socket dies with ECONNRESET or EPIPE before it reaches a handler at all.
 * Latent before the API boundary and observed twice after it, in both spellings:
 * the boundary resolves a session ahead of the body-limit middleware, which widens
 * the window between "the client is still writing" and "the server has already
 * refused".
 *
 * Retrying is not weakening an assertion. These are failures of the socket rather
 * than answers from the server: there is no status to have been wrong about, and a
 * server that is really broken fails both attempts.
 *
 * **Its own module, importing nothing, so the "once" can be tested.** The first
 * version of this lived in `client.ts` twice over — here as a thunk, and again
 * inside `fetch` and `$fetch` — so a caller that wrapped a replayable body got up
 * to four attempts from two docblocks that each promised one. Nothing failed,
 * because a promise in a docblock is not a test. `test/unit/integration/transportRetry.test.ts`
 * is now the thing that would have caught it.
 *
 * The request arrives as a thunk because the body has to be built again: a
 * `ReadableStream` is consumed by the first attempt, and silently sending a
 * truncated second copy would be worse than the flake. That is also why this
 * belongs to the caller that creates the condition rather than to the client,
 * which cannot know how to build a fresh stream.
 */

/** The transport failures that mean no verdict was produced. */
export const RETRYABLE_TRANSPORT_CODES: readonly string[] = ['EPIPE', 'ECONNRESET', 'UND_ERR_SOCKET'];

/**
 * Whether this failure is the socket's rather than the server's.
 *
 * `fetch` wraps the underlying error as `cause`, so the code is read from there
 * first and from the error itself second — the second is for anything that throws
 * the socket error directly rather than wrapping it.
 */
export function isRetryableTransportFailure(error: unknown): boolean {
	const cause = (error as { cause?: unknown })?.cause;
	const code = (cause as { code?: unknown })?.code ?? (error as { code?: unknown })?.code;
	return typeof code === 'string' && RETRYABLE_TRANSPORT_CODES.includes(code);
}

/**
 * Run `request`, and run it once more if the first attempt failed at the transport.
 *
 * Exactly once more. A second transport failure is reported, not retried: at that
 * point the server is not answering, and a loop would turn an outage into a hang.
 */
export async function throughOneTransportFailure<T>(request: () => Promise<T>): Promise<T> {
	try {
		return await request();
	}
	catch (error) {
		if (!isRetryableTransportFailure(error))
			throw error;
		return await request();
	}
}
