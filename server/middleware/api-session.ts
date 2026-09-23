import { apiPathRequiresSession } from '~~/server/utils/apiBoundary';
import { requestUserSession } from '~~/server/utils/auth';

/**
 * The deny-by-default API boundary (#396, ADR-0010): every `/api/**` route
 * requires a session through the authentication interface unless
 * `apiPathRequiresSession` exempts it. In an ordinary run that is a Better Auth
 * session; an explicitly bypassed dev server supplies the Local Developer
 * Session through the same `requestUserSession` call.
 *
 * This is the wall. The page gate in `app/middleware/auth.global.ts` is UX — it
 * spares a signed-out browser a shell of pages whose every request comes back
 * 401 — and a client-side gate protects nothing on its own. What protects this
 * installation is that an unauthenticated request to a private path never
 * reaches a handler.
 *
 * **Named to sort first.** Nitro composes `server/middleware/**` in filename
 * order, and this file's name puts it ahead of all three of its neighbours,
 * which is load-bearing rather than incidental:
 *
 * - `event-exists.ts` answers 404 for an Event that is not there. Running it
 *   first would let an anonymous caller ask which Event ids exist and read the
 *   answer off the difference between 404 and 401.
 * - `request-body-limit.ts` wraps the request body in a bounded stream, and
 *   `retired-author-session-cookies.ts` expires stale cookies. Neither is work
 *   worth doing for a request that is about to be refused.
 *
 * **The 401 is written out here, as literals, on purpose.** It is composed
 * around every route in the application, so it lands in every graph
 * `test/helpers/routeRefusalScan.ts` builds — and that scan resolves a `const`
 * only within the file it is reading. A status or a message imported from
 * elsewhere would arrive at the exhaustiveness check as a refusal it could not
 * read, which is the shape #277 was filed over. It is the same reason the
 * refusal is raised in this file rather than in a helper under
 * `server/utils/`: one uniform 401 for the whole boundary, in the one place a
 * reader of the middleware directory will find it.
 *
 * `test/integration/apiBoundary.test.ts` is where a real anonymous request
 * meets it; `test/unit/server/middleware/apiSession.test.ts` pins the shape.
 */
export default defineEventHandler(async (event) => {
	if (!apiPathRequiresSession(getRequestURL(event).pathname))
		return;

	// Outside the opt-in Local Developer Session, a blank
	// `NUXT_BETTER_AUTH_SECRET` raises out of here as the
	// `ServiceConfigurationError` 503 that names the setting — an unfinished
	// deployment answered with the name of the thing to go and set, rather than
	// with a 401 that would send an operator looking for their password. It is
	// also why that name is locally *required* as of this ticket
	// (`build/localConfiguration.ts`): with a boundary in front of `/api/**`, a
	// checkout without the secret has no way to sign in to anything.
	//
	// Through `requestUserSession` rather than `serverAuth()` directly, so this
	// resolution is the one the handler behind it reuses (#398). Since the
	// Graphics Author Session was retired, a route asks the same request who the
	// person is and which browser they are in; without the memo those are two
	// more reads of the row this line has just read, on routes a resumable
	// transfer calls once per part.
	const session = await requestUserSession(event);

	if (!session) {
		// One message for every refusal inside the boundary. A per-route or
		// per-reason sentence would be a census entry each, and would say which
		// of "no cookie", "expired", "revoked" or "unknown user" happened — none
		// of which the caller can act on differently, and all of which are
		// answered by signing in again.
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'Authentication is required',
		});
	}
});
