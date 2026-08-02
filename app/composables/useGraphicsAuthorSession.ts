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

export function useGraphicsAuthorSession() {
	const lapsed = ref(false);

	/**
	 * Records what a failure was and returns what to say about it.
	 *
	 * Every catch on this surface routes through here so that no single one can
	 * be the branch that forgot, which is how the surface came to have no `401`
	 * handling at all.
	 */
	function describeFailure(caught: unknown, fallback: string): string {
		if (graphicsAuthorSessionLapsed(caught)) {
			lapsed.value = true;
			return GRAPHICS_AUTHOR_SESSION_LAPSED_MESSAGE;
		}
		return caught instanceof Error ? caught.message : fallback;
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
