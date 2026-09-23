/**
 * Which pages a browser without a session may reach, and where it is sent
 * instead.
 */

import { PASSWORD_RESET_PAGE_PATH } from '~~/shared/utils/passwordResetLink';

/**
 * The Screen Output page, the one page that renders without a session.
 *
 * A Screen Output is credential-free in ADR-0010's sense and stays that way
 * under ADR-0010: the Screen Output Asset Capability already in its URL hash
 * _is_ its credential, and the machine showing it has no operator to sign in.
 * Gating it would put a login form on program output.
 *
 * Spelled as the route rather than read from page metadata because the near
 * miss is a single letter: `/event/12/screens/3` is the operator's Screen
 * control surface and is gated, while `/event/12/screen/main` is the output and
 * is not. `authPageGate.test.ts` holds both spellings apart.
 */
const SCREEN_OUTPUT_PAGE = /^\/event\/[^/]+\/screen\/[^/]+\/?$/;

/** Where a browser without a session is sent, and where it signs in. */
export const LOGIN_PATH = '/login';

/**
 * Anything a URL parser deletes before it resolves the address.
 *
 * Tab, newline and carriage return are removed outright by the WHATWG URL
 * parser, so a string checked as written and a string navigated as parsed are
 * not the same string — which is the whole of the trick.
 */
const CONTROL_CHARACTER = /[\t\n\r]/;

/**
 * Whether this page may be rendered without a session.
 *
 * Deny-by-default in the same sense ADR-0010 gives the API boundary: a page
 * added tomorrow is gated without anyone remembering to gate it, and the three
 * exemptions are the whole of the exception list.
 *
 * The password reset page (#399) is the third, and gating it would be a
 * circular refusal: everybody following one of those links is signed out, and
 * an invited account has no credential at all until the link is redeemed — so
 * requiring a session there would mean an invite only somebody who did not need
 * it could accept. The page carries no authority of its own; the token in its
 * URL fragment is what `/api/auth/reset-password` accepts or refuses, and the
 * page is the form that presents it.
 */
export function pageRequiresSession(path: string): boolean {
	if (path === LOGIN_PATH || path === PASSWORD_RESET_PAGE_PATH)
		return false;

	return !SCREEN_OUTPUT_PAGE.test(path);
}

/** The query name the gate and the login page agree on. */
export const REDIRECT_QUERY = 'redirect';

/**
 * Where to send a browser that has been refused `fullPath`.
 *
 * The interrupted page rides along so sign-in returns to it rather than to the
 * home page — a mid-show navigation that hits a lapsed session should cost the
 * operator a password, not their place. Anything that could not be returned to
 * safely is simply left off: the login page still works, it just lands on the
 * default afterwards.
 */
export function loginPathFor(fullPath: string): string {
	const target = safeRedirectTarget(fullPath);
	if (target === null || target === '/')
		return LOGIN_PATH;

	return `${LOGIN_PATH}?${REDIRECT_QUERY}=${encodeURIComponent(target)}`;
}

/**
 * Where a browser goes once it has a session: back to the page the gate wrote
 * into `?redirect=`, or home.
 *
 * Both the gate and the login page need this answer — the gate for an operator
 * who turns out to be signed in already, the page for one who has just signed
 * in — and "home when there is nothing safe to return to" is a policy, not a
 * fallback each of them should be reinventing. One function means the two
 * cannot drift into disagreeing about where sign-in leads.
 */
export function postSignInPath(query: Record<string, unknown>): string {
	return safeRedirectTarget(query[REDIRECT_QUERY]) ?? '/';
}

/**
 * The page a sign-in should return to, or `null` where the caller should pick
 * its own default.
 *
 * The gate writes the interrupted page into `?redirect=`, so by the time it is
 * read again it has been through the address bar and is attacker-typeable.
 * Only a path _within this app_ is honoured. The four refusals below are the
 * four ways a string that looks like a path is not one:
 *
 * - `https://evil.example/…` — an origin stated outright.
 * - `//evil.example/…` — protocol-relative; an origin without the scheme, and
 *   the one that reads as a path to a `startsWith('/')` check.
 * - `/\evil.example/…` — the same trick spelled with a backslash, which
 *   browsers normalise to `//` and a naive check does not.
 * - `/<tab>/evil.example/…` — the same trick again, hidden behind a character
 *   the URL parser deletes before resolving, so what a checker reads and what
 *   a browser navigates to are different strings. Refused rather than
 *   stripped: no page in this app has a tab or a newline in its path, so a
 *   value carrying one is not a path that lost its way.
 *
 * The login page itself is refused last, and for a different reason: it is
 * perfectly same-origin, it would just send a freshly signed-in operator back
 * to the form they have finished with.
 */
export function safeRedirectTarget(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length === 0)
		return null;

	if (CONTROL_CHARACTER.test(raw))
		return null;

	if (!raw.startsWith('/'))
		return null;

	if (raw.startsWith('//') || raw.startsWith('/\\'))
		return null;

	if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`) || raw.startsWith(`${LOGIN_PATH}/`))
		return null;

	return raw;
}
