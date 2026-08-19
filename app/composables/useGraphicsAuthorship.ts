import { LOGIN_PATH, loginPathFor } from '~/modules/auth/pageGate';
import { useAuthSession } from '~/modules/auth/session';

/**
 * Who a Library Workspace's work belongs to, and what it says when a refusal
 * means this browser is no longer signed in.
 *
 * This replaces `useGraphicsAuthorSession` at ADR-0010's cutover (#398). The
 * seam is the same one #176 asked for and the news it carries is different in
 * both directions:
 *
 * - **Ownership outlives the browser.** A Graphics Ingestion Operation records
 *   the person who started it, not the browser they started it in, so an upload
 *   interrupted overnight is resumed by signing in — here or anywhere else —
 *   rather than lost with the session. The sentence this surface used to state
 *   before an upload ("the same person in a second browser is already a second
 *   author") is retired with the identity that made it true.
 * - **A 401 is still the one refusal with an action attached**, and the action
 *   changed: reloading minted a new anonymous author, which is why the old
 *   notice prescribed it. Nothing is minted now, so the only thing that helps is
 *   signing in again — and unlike a reload, it returns the operator to the page
 *   they were on with their work still theirs.
 */

/**
 * What the Workspace states before an upload starts.
 *
 * #176's fourth acceptance criterion — an author is told what an upload is
 * staked on *before* staking it — survives the cutover; what it is staked on is
 * now an account rather than a cookie. It is still worth stating rather than
 * dropping as good news, because two of its consequences are surprising: nobody
 * else can finish an operation for you (an operator waiting on a colleague's
 * half-finished upload cannot take it over), and the same upload started twice
 * under one account is one operation rather than two.
 */
export const GRAPHICS_AUTHOR_OWNERSHIP_NOTICE = {
	title: 'An upload belongs to your account',
	body: 'A Graphics Ingestion Operation records the person who started it, so it outlives this browser: sign in again, here or on another machine, and an operation left part-finished is still yours to resume. Nobody else can resume it, and staged input for an operation nobody finishes is reclaimed on the ordinary retention schedule. Starting the same upload a second time under the same account continues the first operation instead of beginning another.',
} as const;

/** What the Workspace states once the library has stopped recognising this browser. */
export const GRAPHICS_AUTHOR_SIGNED_OUT_NOTICE = {
	title: 'This browser is no longer signed in',
	body: 'The Graphics Asset Library refused this browser, so the session it was working under has ended — it expired, or it was signed out or revoked elsewhere. Nothing was lost: operations you started are recorded against your account, and signing in again brings you back to this page with them still yours to resume.',
} as const;

/** The one sentence a failed action shows in place of its own message. */
export const GRAPHICS_AUTHOR_SIGNED_OUT_MESSAGE
	= `${GRAPHICS_AUTHOR_SIGNED_OUT_NOTICE.title}. Sign in again to continue.`;

/**
 * Whether a failure means this browser has no session any more.
 *
 * Only `401` qualifies, and it is now the API boundary's uniform refusal rather
 * than a sentence about authorship (`server/middleware/api-session.ts`). A `404`
 * from an ingestion route is the *other* half of per-person ownership — a signed-in
 * operator asking about somebody else's operation — and reading it as a lost
 * session would tell an author to sign in over work they can see.
 */
export function graphicsAuthorSignedOut(caught: unknown): boolean {
	return failureStatus(caught) === 401;
}

/**
 * `signedOut` is per-caller, not a shared singleton.
 *
 * Each call mints its own `ref`, so one surface noticing a refusal does not light
 * up another: a surface reports the refusals *it* provoked, and a library nobody
 * has touched should not grow an alert about somebody else's failed upload. The
 * session it describes is of course shared — it is one cookie — so anything
 * wanting a page-wide announcement needs shared state rather than a second call
 * to this.
 */
export function useGraphicsAuthorship() {
	const signedOut = ref(false);
	// Read at call time, which is setup time: `signIn` is invoked from a click
	// handler after an await, where the composable-context reads are no longer
	// valid.
	const route = useRoute();
	const session = useAuthSession();

	/**
	 * Records what a failure was and returns what to say about it.
	 *
	 * Every catch on this surface routes through here so that no single one can be
	 * the branch that forgot, which is how the surface came to have no `401`
	 * handling at all.
	 *
	 * The refusal is asked about first and unconditionally, because the 401 does
	 * carry a sentence of its own — 'Authentication is required' — and quoting it
	 * would name what was missing while leaving out the one thing the author can
	 * do about it. Since #360 that judgement covers the whole surface, reads
	 * included: a read's 401 means this browser holds no session either, and the
	 * operator's next action is the same sign-in whether or not anything was
	 * staked on the session that went.
	 *
	 * Everything else is `reportedMessage`, which reads the sentence the route
	 * wrote before falling back to the failure's own line. That fallback matters
	 * on a `$fetch` failure, whose line is the transport's — '[POST]
	 * "/api/graphics-assets/ingestion-operations": 503 Service Unavailable' — so
	 * the prose #294, #321 and #293 worked to preserve would otherwise arrive here
	 * and be dropped (#350). `failureSentence` owns which bodies may be quoted; a
	 * sanitized 5xx writes none and still falls back to that line, and a failure
	 * that never reached the server keeps its own message untouched.
	 */
	function describeFailure(caught: unknown, fallback: string): string {
		if (graphicsAuthorSignedOut(caught)) {
			signedOut.value = true;
			return GRAPHICS_AUTHOR_SIGNED_OUT_MESSAGE;
		}
		return reportedMessage(caught, fallback);
	}

	/**
	 * Takes the operator to the login page, with this page to come back to.
	 *
	 * The unconditional `load()` before the navigation is what makes the trip
	 * work. `ensure()` treats `signed-in` as settled and does not re-ask, so the
	 * browser still believes in the session the server has just refused; arriving
	 * at the login page with that belief intact, the page gate would read
	 * "already signed in" and send the operator straight back to the page that
	 * refused them. Asking the server outright replaces the stale answer with the
	 * true one before the gate reads it.
	 */
	async function signIn(): Promise<void> {
		await session.load();
		await navigateTo(loginPathFor(route.fullPath));
	}

	return {
		signedOut,
		ownershipNotice: GRAPHICS_AUTHOR_OWNERSHIP_NOTICE,
		signedOutNotice: GRAPHICS_AUTHOR_SIGNED_OUT_NOTICE,
		loginPath: LOGIN_PATH,
		describeFailure,
		signIn,
	};
}
