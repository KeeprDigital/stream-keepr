/**
 * Which requests the API boundary requires a Better Auth session for (#396,
 * ADR-0010's protection boundary).
 *
 * Deny-by-default, in the same sense `app/modules/auth/pageGate.ts` gives the
 * page gate one layer up: a route added tomorrow is private without anybody
 * remembering to make it private. The posture this replaces was guard-by-guard,
 * and it left all ninety-six `events/**` routes public — the on-air Screen
 * command route and the Melee credential write among them — because a guard has
 * to be *added* to each one and nothing counts the ones nobody added it to.
 *
 * The path policy lives apart from `server/middleware/api-session.ts` for two
 * reasons. It can be exercised as a function, against every route file on disk
 * (`test/unit/server/utils/apiBoundary.test.ts`), rather than only through a
 * mocked event; and the middleware then reads as the two sentences it actually
 * is, with the whole of the decision in one place a reviewer can audit.
 *
 * **The exemptions below are the whole of the exception list.** Adding to it is
 * a decision about what this installation publishes to the internet, so it is
 * one edit in one file, and the test named above pins the resulting set against
 * a literal — a new public route fails that test until somebody writes it down.
 */

/**
 * Every path under here is the boundary's business. Pages, static assets and
 * the SPA shell are outside it altogether: they are unavoidably public under
 * `ssr: false`, and ADR-0010 gates them client-side (`app/middleware/auth.global.ts`)
 * as UX rather than as security.
 */
const API_PREFIX = '/api/';

/**
 * Exempt by exact path.
 *
 * Exact rather than prefixed, per entry:
 *
 * - `/api/time` — the Screen Output page's drift correction. A clock reading,
 *   no Event or Screen identity in it, and the one thing an output machine
 *   needs before anything has authorised it.
 * - `/api/realtime/token` — an Ably token request. Public today because the
 *   Screen Output page needs one and has no session; #397 narrows what an
 *   unauthenticated caller is granted (ADR-0010's dual-grant), which is a
 *   change to what the route *issues* rather than to whether it is reachable.
 * - `/api/bootstrap/ensure-admin` — the first-admin bootstrap (#394). It cannot
 *   require a session: it exists for the installation that has no account to
 *   sign in to, and for the lockout that has lost the only one. It carries its
 *   own credential — a Worker secret an operator arms for the length of one
 *   curl — and answers 503 while that secret is blank.
 *
 * The bootstrap route is the reason this list exists separately from the
 * prefixes below. It is deliberately not under `/api/admin/` or `/api/auth/`,
 * because both of those prefixes already mean something here, and an entry
 * written as a prefix would hand every future sibling under `/api/bootstrap/`
 * the same exemption without anyone deciding to.
 */
export const SESSION_EXEMPT_API_PATHS: readonly string[] = [
	'/api/time',
	'/api/realtime/token',
	'/api/bootstrap/ensure-admin',
];

/**
 * Exempt by prefix, because each of these is one surface with many paths.
 *
 * - `/api/auth/` — Better Auth's own router. Sign-in must be reachable without
 *   a session, or nothing ever acquires one. Its own endpoints refuse on their
 *   own terms (a wrong password is a 401 from Better Auth, sign-up is disabled).
 * - `/api/screen-output/` — the Screen Output Asset Capability surface. Every
 *   route under it is authorised by the bearer token the output page already
 *   holds in its URL hash, and refuses **404** rather than 401/403 so a caller
 *   without one cannot use it to enumerate assets. A session requirement here
 *   would put a 401 in front of that posture and hand back the distinction the
 *   404 exists to withhold.
 * - `/api/admin/` — the Graphics Administrator surface. `x-graphics-admin-token`
 *   alone satisfies the boundary here, which is exactly today's posture:
 *   ADR-0010 leaves the shared token untouched until a roles-and-permissions
 *   effort redraws that seam, and it names that as the successor work.
 *
 * **The admin exemption is an exemption, not a second guard.** Every route
 * under `/api/admin/` calls `requireGraphicsAdministrator`
 * itself, and that — not this file — is what refuses a caller with no token.
 * Checking the token here instead would look stronger and be worse: the guard
 * lives in `server/modules/**`, which a middleware's refusal graph deliberately
 * stops short of (`test/helpers/routeRefusalScan.ts`), so its 403 would become
 * a refusal composed around every route in the application that no
 * exhaustiveness check could see. The residual — an admin route added without
 * its own guard — is closed by a test that reads every one of those graphs
 * instead.
 */
export const SESSION_EXEMPT_API_PREFIXES: readonly string[] = [
	'/api/auth/',
	'/api/screen-output/',
	'/api/admin/',
];

/**
 * The path as the exemptions are written, with the one trailing slash Nitro
 * ignores removed.
 *
 * Nitro strips a trailing slash before it matches a route
 * (`withoutTrailingSlash` in its own handler), so `/api/time/` reaches the same
 * handler `/api/time` does. An exemption list that did not know that would read
 * the two spellings differently from the router — which is a difference between
 * what is exempt and what is reachable, and the wrong half of it is somebody
 * getting a private route with no session.
 */
function canonicalPath(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Whether this path is the boundary's business at all.
 *
 * Compared case-insensitively, and only in this direction: a request to
 * `/API/events` is treated as an API request and therefore as private. Nothing
 * in this application asks for that spelling, so the cost is nil, and the
 * alternative is trusting that no router, proxy or runtime between here and the
 * handler ever folds case — which is a bet where losing means a private route
 * answered without a session.
 */
function isApiPath(path: string): boolean {
	const folded = path.toLowerCase();
	// The bare form as well as the prefix: no handler answers `/api`, and a path the
	// boundary did not recognise at all is the one shape that would reach a handler
	// unauthenticated if that ever changed.
	return folded === API_PREFIX.slice(0, -1) || folded.startsWith(API_PREFIX);
}

/**
 * Whether this request must present a Better Auth session.
 *
 * `false` for everything outside `/api/**`, so the caller does not have to ask
 * two questions; the middleware's whole decision is this function.
 *
 * Give it the **normalised** pathname — `getRequestURL(event).pathname`, which
 * the WHATWG URL parser has already resolved `..` out of. That is the safe
 * direction of the one disagreement with Nitro's router, which matches the raw
 * path: `/api/screen-output/../events/1/players` normalises to a private path
 * here (session required) and matches no route there (404), while
 * `/api/events/../time` normalises to an exempt path here and again matches no
 * route there. Neither spelling reaches a private handler unauthenticated.
 */
export function apiPathRequiresSession(pathname: string): boolean {
	const path = canonicalPath(pathname);

	if (!isApiPath(path))
		return false;

	if (SESSION_EXEMPT_API_PATHS.includes(path))
		return false;

	return !SESSION_EXEMPT_API_PREFIXES.some(prefix => path.startsWith(prefix));
}
