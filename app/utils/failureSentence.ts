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
	const status = failureStatus(caught);
	if (status === undefined || status >= 500)
		return undefined;

	const message = (caught as { data?: { message?: unknown } } | null)?.data?.message;
	return typeof message === 'string' && message.length > 0 ? message : undefined;
}
