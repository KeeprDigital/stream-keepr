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
 * Read from a failure carrying a status below 500, and from a 5xx whose prose the
 * server deliberately kept. A 4xx is the authority answering *this*
 * request: the Screen is not in Broadcast Graphics mode, the epoch has ended, the
 * revision has gone — the server chose those words about the show. A 5xx is usually
 * the server failing, and this server rewrites those on the way out:
 * `mapPublicNitroError` replaces any unmapped 5xx message with 'Internal Server
 * Error', and Nitro writes 'Server Error' for anything that arrives unhandled.
 * Quoting either back would put a placeholder in front of an operator dressed as the
 * authority's own words, which is worse than the status line — a status line at least
 * reads as machinery. `preservedServerSentence` is what tells the two apart, and #286
 * is why it has to: the families that name a deployment fault rather than a fact about
 * the show are the ones an operator can actually act on (#233).
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
 * The two things this server says when it has decided to say nothing.
 *
 * `mapPublicNitroError` writes the first over any 5xx it did not deliberately map, and
 * Nitro's own handler writes the second into the body of anything that arrives unhandled
 * or fatal. Between them they are the complete vocabulary of a sanitized 5xx body, which
 * is what makes a 5xx body saying anything *else* recognisable.
 */
const SANITIZED_SERVER_MESSAGES: readonly string[] = ['Internal Server Error', 'Server Error'];

/**
 * The sentence a 5xx carries when the server meant it to be read.
 *
 * `mapPublicNitroError` sanitizes every 5xx on the way out **except** the families it
 * flags `hasMappedPublicServerMessage`: a missing setting (#233), a realtime publish the
 * show could not go without, an exhausted byte store, a Graphics Asset Library store
 * that cannot be reached, a Graphics Author Session store in the same state (#294), a
 * subsystem a route classified as momentarily out of reach
 * (#321), and the three upstream-unavailable codes. Those name a deployment fault or a
 * named dependency rather than a fact about the show, and the only reader who can act on
 * one is the operator this function exists to get the words to.
 *
 * The flag itself never leaves the server, so this reads the two marks it leaves on the
 * response instead — and both halves are load-bearing:
 *
 * - **Not 500.** Every preserved family is raised at 502, 503, 504 or 507, and that is a
 *   decision rather than an accident: 500 means this server broke, which is precisely the
 *   case where nothing it has to say may be quoted. Leaving 500 to the refusal keeps the
 *   strictest reading where the server is least trustworthy, and costs nothing, because no
 *   preserved family is raised there.
 * - **Not one of the sanitizer's own sentences.** A 5xx that is *not* 500 is not thereby
 *   mapped: a route may raise one the mapper does not recognise, in which case the
 *   sanitizer rewrites its body and this refuses it on exactly that evidence.
 *
 *   **No `createError` in `server/` raises one today, and that is a fact with a date on
 *   it.** This bullet has named two pairs of live examples and outlived both. The
 *   Graphics Author Session and Graphics Asset Library stores were the clearest until
 *   #294 taught the server to preserve them; `requireGraphicsAdministrator`'s
 *   unconfigured-token 503 and the Screen Output capability session's causeless one
 *   replaced them and were closed the same way by #321, which classified the last eight
 *   hand-rolled 5xx. That enumeration is every `createError` under `server/` whose status
 *   is a readable non-500 5xx, so the mark is presently belt-and-braces and its rows in
 *   `failureSentence.test.ts` are constructed rather than observed.
 *
 *   It stays because what produces such a body has not gone anywhere: h3 adopts
 *   `statusCode` from anything thrown, so a dependency's own object can arrive at 503
 *   unrecognised and be masked as 'Server Error', and the next hand-rolled `createError`
 *   is one edit away — this class of defect has now been filed five times (#233, #243,
 *   #246, #294, #321). Removing the mark would make that edit's placeholder quotable in
 *   an operator's face, which is the failure this function exists to prevent and not one
 *   worth reopening to delete a comparison.
 *
 * Established by execution rather than reasoned about. Driving the real route with the
 * signing key invalid — `GET /api/events/1/screens/1/asset-capability` — answers a
 * `FetchError` with `statusCode` 503 and `data.message` naming the setting, which is the
 * shape. The enumeration is separate: `mapPublicNitroError` was driven across all eleven
 * preserved branches and they come out at 502/503/504/507, never 500, while an unmapped
 * 5xx keeps its own non-500 status and carries the placeholder (#286's review; #321
 * added the shared branch and closed the live unmapped examples; #344 retired the
 * wiring branch #243 had added).
 *
 * A `useFetch` error is that failure rebuilt by `createError`, which keeps `statusCode`
 * and `data` and does not always keep `status` — imported from `@nuxt/nitro-server/h3` in
 * a bare node process it does not. That is why `failureStatus` reads `statusCode` first,
 * and it is the whole reason the three `useFetch` errors this application reads —
 * `GraphicsAsset/FocusPicker.vue`'s listing and `pages/graphics-assets/index.vue`'s
 * listing and capacity, across two components — can use this at all.
 *
 * What it cannot tell apart is prose written by something that is not this server — an
 * edge or proxy answering 503 with its own JSON body would be quoted. That is a limit
 * worth stating rather than closing: such a message is still about the request, and the
 * refusal exists to keep *this* server's placeholders out of an operator's face.
 *
 * The sub-500 guard below is what makes this answerable on its own rather than only in
 * the order its caller happens to ask. It is unreachable through that caller today —
 * `isSanitizedFailure` short-circuits on `status >= 500` first — so a mutation removing
 * it survives, and the survivor is the redundancy rather than a gap in coverage. The two
 * bullets above are the halves that are not redundant, and both are killed.
 */
function preservedServerSentence(caught: unknown): string | undefined {
	const status = failureStatus(caught);
	if (status === undefined || status < 500)
		return undefined;
	if (status === 500)
		return undefined;

	const message = (caught as { data?: { message?: unknown } } | null)?.data?.message;
	if (typeof message !== 'string' || message.length === 0)
		return undefined;

	return SANITIZED_SERVER_MESSAGES.includes(message) ? undefined : message;
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
 * A 5xx carrying a preserved sentence is **not** sanitized, and that exclusion is #286.
 * Without it the refusal suppresses exactly the messages #233 exists to deliver,
 * and it does so silently: the sentence naming the setting an operator has to go and set
 * becomes '503 Service Unavailable'. Asking `preservedServerSentence` here rather than at
 * each surface keeps the question "may this body be quoted?" with one answer in this
 * application rather than several that must agree.
 *
 * A failure carrying no status is not sanitized. It never reached the server, so nothing
 * replaced its prose on the way out — what it may be quoted *for* is a separate question,
 * and `failureSentence` answers that one by declining.
 */
export function isSanitizedFailure(caught: unknown): boolean {
	const status = failureStatus(caught);
	return status !== undefined && status >= 500 && preservedServerSentence(caught) === undefined;
}

/**
 * What a failure says to the person who was watching, in one line.
 *
 * The sentence the authority wrote where it wrote one; otherwise the failure's own
 * `message`, which for a `$fetch` failure is the transport's line and reads as
 * machinery rather than as words anyone chose; otherwise the caller's static wording,
 * for a throw that is not an `Error` at all and therefore carries no line to fall back
 * to.
 *
 * The ordering is the whole content, and it is #245's judgement applied twice: quote
 * the authority where quoting it is honest, and where it is not, show machinery as
 * machinery rather than dressing a placeholder as the authority's own words. Which
 * bodies may be quoted is not decided here — `failureSentence` owns that question, and
 * this adds nothing to it.
 *
 * `fallback` is optional because two kinds of caller ask this. A `catch` holds
 * `unknown` and must say *something*, so it names the line to print when the throw was
 * not an `Error`. A surface reading `useFetch`'s `error` holds an `Error` or nothing,
 * so its "nothing" case is the absent failure rather than an unusable one, and
 * `undefined` is the honest answer — `reportedMessage(undefined)` is `undefined`,
 * which is what those computeds already returned for an absent error.
 *
 * Filed as #299: eight call sites across seven surfaces had written this out, four with
 * a fallback and four without, and #286 had to be applied to every one of them by hand.
 * The seam is here so the next discrimination between quotable and unquotable prose is
 * made once. Two further `failureSentence` call sites deliberately do **not** use this and
 * are worth naming, because each looks like an oversight and is not: `stores/metagame.ts`
 * wants the static line for *any* unsentenced failure rather than the transport's, and
 * `useRequestFeedback`'s `getErrorMessage` reads five more fields after this one.
 *
 * `stores/screen.ts` was a third until #341, on the reading that it re-raises rather than
 * reports. It does both: its three loaders report to the store's own `error` and now ask
 * this, and its writes re-raise through `withFailureSentence` below, which is the shape it
 * had written out by hand. Neither half was an exception to the seam — the store was one
 * surface doing both jobs, and the census could not see it because it reached this file
 * indirectly through the copies.
 */
export function reportedMessage(caught: unknown, fallback: string): string;
export function reportedMessage(caught: unknown, fallback?: string): string | undefined;
export function reportedMessage(caught: unknown, fallback?: string): string | undefined {
	return failureSentence(caught) ?? (caught instanceof Error ? caught.message : fallback);
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
