/**
 * The sentence the authoritative side wrote about a refused request, when it wrote
 * one an operator can act on.
 *
 * A `$fetch` failure's own `message` is the transport's line — `[POST] "…": 409
 * Conflict` — which names neither what was refused nor what to do about it. The
 * sentence is in the parsed response body, which `$fetch` hangs off `error.data`,
 * at the `message` every `createError({ statusCode, message })` on this server
 * writes. Reaching for `Error.message` and finding a status line is the defect
 * #230 named for coded refusals and #245 for everything else.
 *
 * Read only from a failure carrying a status below 500, and that boundary is the
 * whole of the judgement here. A 4xx is the authority answering *this* request:
 * the Screen is not in Broadcast Graphics mode, the epoch has ended, the revision
 * has gone — the server chose those words about the show. A 5xx is the server
 * failing, and this server rewrites those on the way out: `mapPublicNitroError`
 * replaces any unmapped 5xx message with 'Internal Server Error', and Nitro writes
 * 'Server Error' for anything that arrives unhandled. Quoting either back would put
 * a placeholder in front of an operator dressed as the authority's own words, which
 * is worse than the status line — a status line at least reads as machinery. The
 * two 5xx families whose prose does survive sanitizing (a missing setting, an
 * unwired component) name a deployment fault rather than a fact about the show, and
 * are reported by the surfaces that own them (#233, #243).
 *
 * One exception to "a 4xx is the authority": h3's own router mints a 404 before any
 * handler runs, and its body message is machinery — 'Cannot find any route matching
 * …'. No route this is used against can produce one, since a caller reaching a
 * renamed route would be a build fault rather than something an operator meets; and
 * a quoted path is in any case more diagnostic than the status line it would replace.
 * Widening this read to a surface that can meet an unrouted request means revisiting
 * that.
 *
 * A failure with no status at all never reached the server, so nothing it carries
 * was written by the authority and none of it may be quoted as though it were.
 *
 * Note this is about *prose*, not about recognising a refusal. Whether a failure is
 * a domain refusal — a code a surface acts on, from a vocabulary it knows — is a
 * different question, asked by `broadcastGraphicsCommandRefusal`. A conflict can
 * gain a sentence here and still be no refusal at all.
 */
export function failureSentence(caught: unknown): string | undefined {
	if (failureStatus(caught) === undefined || isSanitizedFailure(caught))
		return undefined;

	const message = (caught as { data?: { message?: unknown } } | null)?.data?.message;
	return typeof message === 'string' && message.length > 0 ? message : undefined;
}

/**
 * Whether the words this failure carries are the machinery's rather than the authority's.
 *
 * The boundary `failureSentence` reads at, named separately because one surface needs the
 * same judgement about *other* fields. `useRequestFeedback`'s `getErrorMessage` reaches for
 * `data.statusMessage`, `data.error` and the reason phrase as well as `data.message`, and on
 * a sanitized 5xx every one of those says 'Internal Server Error' — so gating only the field
 * `failureSentence` reads would move the placeholder one line down rather than refuse it
 * (#271). Refusing them all leaves the transport's own line, which at least reads as
 * machinery; that is #245's judgement and this is the same one.
 *
 * A failure carrying no status is not sanitized. It never reached the server, so nothing
 * replaced its prose on the way out — what it may be quoted *for* is a separate question,
 * and `failureSentence` answers that one by declining.
 */
export function isSanitizedFailure(caught: unknown): boolean {
	const status = failureStatus(caught);
	return status !== undefined && status >= 500;
}

/**
 * Run one action, re-raising a failure that wrote a sentence as an `Error` whose own
 * message is that sentence.
 *
 * The re-raise is what makes the sentence travel. Every reporting seam in this
 * application — `useAsyncAction`, the Event Data lifecycle's own load catch, a
 * component's `catch` — ends up reading `Error.message`, and on a `$fetch` failure that
 * is the transport's line: `[POST] "…": 409 Conflict`. A sentence living in the response
 * body therefore reaches a reader only by becoming the message of the error carrying it
 * (#245, #262).
 *
 * The original failure is kept as the `cause`, so its status and body survive for anyone
 * downstream who wants them. They do not survive on the raised error itself, which is
 * deliberate: this is the boundary where a failure stops being a transport event and
 * becomes something to say, and a caller that needs to *branch* on a status should read
 * it before this rather than after. A failure that wrote no sentence is re-raised
 * untouched, so nothing that already handles one is disturbed.
 *
 * Gaining a sentence is not being recognised as a refusal — a code a surface acts on is
 * a separate question, asked elsewhere and unaffected here (#230).
 */
export async function withFailureSentence<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	}
	catch (failure) {
		const sentence = failureSentence(failure);
		throw sentence === undefined ? failure : new Error(sentence, { cause: failure });
	}
}
