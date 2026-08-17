/**
 * Which pages a browser without a session may reach, and where it is sent
 * instead.
 */

/**
 * The Screen Output page, the one page that renders without a session.
 *
 * A Screen Output is credential-free in ADR-0008's sense and stays that way
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
 * Whether this page may be rendered without a session.
 *
 * Deny-by-default in the same sense ADR-0010 gives the API boundary: a page
 * added tomorrow is gated without anyone remembering to gate it, and the two
 * exemptions are the whole of the exception list.
 */
export function pageRequiresSession(path: string): boolean {
	if (path === LOGIN_PATH)
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
 * The page a sign-in should return to, or `null` where the caller should pick
 * its own default.
 *
 * The gate writes the interrupted page into `?redirect=`, so by the time it is
 * read again it has been through the address bar and is attacker-typeable.
 * Only a path *within this app* is honoured. The three refusals below are the
 * three ways a string that looks like a path is not one:
 *
 * - `https://evil.example/…` — an origin stated outright.
 * - `//evil.example/…` — protocol-relative; an origin without the scheme, and
 *   the one that reads as a path to a `startsWith('/')` check.
 * - `/\evil.example/…` — the same trick spelled with a backslash, which
 *   browsers normalise to `//` and a naive check does not.
 *
 * The login page itself is refused last, and for a different reason: it is
 * perfectly same-origin, it would just send a freshly signed-in operator back
 * to the form they have finished with.
 */
export function safeRedirectTarget(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length === 0)
		return null;

	if (!raw.startsWith('/'))
		return null;

	if (raw.startsWith('//') || raw.startsWith('/\\'))
		return null;

	if (raw === LOGIN_PATH || raw.startsWith(`${LOGIN_PATH}?`) || raw.startsWith(`${LOGIN_PATH}/`))
		return null;

	return raw;
}
