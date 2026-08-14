/**
 * The graphics author session a Library Workspace is working under, as far as
 * the browser can tell.
 *
 * The session is minted server-side on an ordinary page navigation and carried
 * in an `httpOnly` cookie, so the browser can never read it, count down to its
 * expiry, or renew it deliberately. What the browser *can* know is the one thing
 * that matters: the library answered `401`, so whatever session this page was
 * working under is gone.
 *
 * That is worth a seam of its own because a lapsed session is not an ordinary
 * failure. Every other ingestion failure leaves the operation where it was and
 * retrying is the right move; a lapsed session leaves the operation owned by an
 * identity nobody holds, and retrying — including reloading — cannot get it
 * back. ADR-0003 records why ownership is kept that way, and this is where the
 * Workspace says so: once before an upload starts, and again in the exact terms
 * of what was lost if it happens.
 */

/**
 * What the Workspace states before an upload starts.
 *
 * The fourth acceptance criterion of #176 is that an author is told what an
 * upload is staked on *before* staking it, not after losing it.
 */
export const GRAPHICS_AUTHOR_SESSION_OWNERSHIP_NOTICE = {
	title: 'An upload belongs to this browser session',
	body: 'A Graphics Ingestion Operation records the graphics author session that started it and nothing more durable. The session lasts eight hours from your last request, so a transfer in progress keeps it alive. If it does lapse, reloading starts a new session and a new author: operations the old session started cannot be resumed, and their staged input is reclaimed on the ordinary retention schedule. The same person in a second browser is already a second author.',
} as const;

/** What the Workspace states once the session has gone. */
export const GRAPHICS_AUTHOR_SESSION_LAPSED_NOTICE = {
	title: 'Your graphics author session has lapsed',
	body: 'The Graphics Asset Library no longer recognises this browser as an author. Reload the page to start a new session. Operations started before the lapse belong to the session that started them and cannot be resumed; their staged input is reclaimed on the ordinary retention schedule.',
} as const;

/** The one sentence a failed action shows in place of its own message. */
export const GRAPHICS_AUTHOR_SESSION_LAPSED_MESSAGE
	= `${GRAPHICS_AUTHOR_SESSION_LAPSED_NOTICE.title}. Reload the page to start a new session.`;

/**
 * Whether a failure means the asking session is gone.
 *
 * Only `401` qualifies. A `404` from an ingestion route is the *other* half of
 * per-session ownership — a live session asking about an operation that is not
 * its own — and treating it as a lapse would tell an author their session had
 * ended when it had not.
 */
export function graphicsAuthorSessionLapsed(caught: unknown): boolean {
	return failureStatus(caught) === 401;
}

/**
 * `lapsed` is per-caller, not a shared singleton.
 *
 * Each call mints its own `ref`, so one surface noticing a lapse does not light
 * up another. That is deliberate: a surface reports the refusals *it* provoked,
 * and a library nobody has touched should not grow an alert about somebody
 * else's failed upload. The session it describes is of course shared — it is one
 * cookie — so anything wanting a page-wide announcement needs shared state
 * rather than a second call to this.
 */
export function useGraphicsAuthorSession() {
	const lapsed = ref(false);

	/**
	 * Records what a failure was and returns what to say about it.
	 *
	 * Every catch on this surface routes through here so that no single one can
	 * be the branch that forgot, which is how the surface came to have no `401`
	 * handling at all.
	 *
	 * The lapse is asked first and unconditionally, because a `401` from an
	 * ingestion route does carry a sentence of its own — 'An authenticated
	 * graphics author session is required' — and quoting it would name what was
	 * missing while leaving out the one thing the author can do about it.
	 *
	 * Everything else is `reportedMessage`, which reads the sentence the route
	 * wrote before falling back to the failure's own line. This arm was that
	 * fallback alone, and on a `$fetch` failure the line is the transport's —
	 * '[POST] "/api/graphics-assets/ingestion-operations": 503 Service
	 * Unavailable' — so the prose #294, #321 and #293 worked to preserve arrived
	 * here and was dropped (#350). `failureSentence` owns which bodies may be
	 * quoted; a sanitized 5xx writes none and still falls back to that line, and
	 * a failure that never reached the server keeps its own message untouched.
	 */
	function describeFailure(caught: unknown, fallback: string): string {
		if (graphicsAuthorSessionLapsed(caught)) {
			lapsed.value = true;
			return GRAPHICS_AUTHOR_SESSION_LAPSED_MESSAGE;
		}
		return reportedMessage(caught, fallback);
	}

	function reload() {
		window.location.reload();
	}

	return {
		lapsed,
		ownershipNotice: GRAPHICS_AUTHOR_SESSION_OWNERSHIP_NOTICE,
		lapsedNotice: GRAPHICS_AUTHOR_SESSION_LAPSED_NOTICE,
		describeFailure,
		reload,
	};
}
