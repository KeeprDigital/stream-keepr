import { describe, expect, it } from 'vitest';
import { anonymousFetch, fetch } from './client';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

/**
 * The deny-by-default API boundary as a request meets it (#396, ADR-0010).
 *
 * What this file owns over the unit suite is that the middleware is **mounted and
 * composed around real routes** — that Nitro runs it before the handler, before
 * `event-exists.ts`, and on paths nobody wrote it a rule for. The path policy
 * itself is exercised against every route file on disk in
 * `test/unit/server/utils/apiBoundary.test.ts`, which is the only place the claim
 * "exhaustive" can be checked.
 *
 * Every request here goes through `anonymousFetch`, deliberately. The rest of the
 * suite is signed in (see `client.ts`), and a boundary proved only by the absence
 * of failures elsewhere is a boundary nobody tested: the same green run would come
 * back from a middleware that admitted everybody.
 */

const REFUSAL = 'Authentication is required';

async function anonymous(path: string, init: RequestInit = {}) {
	const response = await anonymousFetch(path, init);
	const text = await response.text();
	return {
		status: response.status,
		message: (() => {
			try {
				return (JSON.parse(text) as { message?: string }).message;
			}
			catch {
				return undefined;
			}
		})(),
	};
}

describe('the API boundary', () => {
	/**
	 * One route per shape of private path, rather than one per route: what is
	 * being established is that the middleware runs at all and refuses by
	 * default. The set is exhaustive against the routes on disk in the unit
	 * suite, where it can be, and a census by HTTP would be a hundred and sixty
	 * requests establishing the same thing.
	 */
	it.each([
		// A collection read, and the plainest possible case.
		['GET', '/api/graphics-assets'],
		// A write. The boundary must refuse before the body is read, not after.
		['POST', '/api/events'],
		// The on-air Screen command route: the one ADR-0010 names as the reason
		// guard-by-guard protection was not good enough.
		['POST', '/api/events/1/screens/1/command'],
		// The Melee credential write, the other named one.
		['PUT', '/api/events/1/melee-config'],
		// Under `/api/events/:id/**`, so `event-exists.ts` would answer 404 for a
		// missing Event if it ran first. It must not: the difference between 404
		// and 401 is an Event-existence oracle for anybody who asks.
		['GET', '/api/events/999999999/players'],
		// The Screen lookup by slug, which ADR-0010 moves off the public surface.
		// #397 gives it the capability posture; until then it is private.
		['GET', '/api/events/1/screens/slug/anything'],
		// A path no handler answers. Private by default reaches further than the
		// routes that exist, which is the posture rather than a side effect.
		['GET', '/api/not-a-route-at-all'],
	])('refuses an anonymous %s %s with one uniform 401', async (method, path) => {
		const { status, message } = await anonymous(path, { method });

		expect(status).toBe(401);
		expect(message).toBe(REFUSAL);
	});

	it('refuses before the Event-existence middleware can say whether the Event is there', async () => {
		// Read as a pair, because the leak is a difference rather than a status: an
		// Event that exists and one that does not have to be indistinguishable to a
		// caller with no session.
		const missing = await anonymous('/api/events/999999999/players');
		const present = await anonymous('/api/events/1/players');

		expect(missing).toEqual(present);
		expect(missing.status).toBe(401);
	});

	/**
	 * There is no row here for an **oversized** mutation being answered 401 rather
	 * than 413, and the absence is deliberate rather than an oversight.
	 *
	 * The claim is true and was observed: a body over `MAX_API_REQUEST_BODY_BYTES`
	 * comes back 401. But refusing before the body is read is exactly what leaves
	 * the request's bytes unconsumed, so the server closes the connection on them
	 * and the **next** request to reuse that pooled socket fails with ECONNRESET —
	 * in the next file as readily as the next test, since the suite runs one worker
	 * with `fileParallelism: false`. A row that poisons whatever runs after it is
	 * worth less than the flake it costs.
	 *
	 * What is pinned instead is the property the ordering rests on: `api-session.ts`
	 * sorts first in `server/middleware/`, which is the order Nitro composes them
	 * in (`test/unit/server/middleware/apiSession.test.ts`). The half that only a
	 * real request can establish — that `event-exists.ts` really does run after
	 * this — is the pair of rows above.
	 */
	it('admits the same request once it carries a session', async () => {
		// The negative control for every row above: they would all pass against a
		// middleware that refused everything, which is a broken installation rather
		// than a boundary. `/api/events` because it is behind the boundary and
		// nothing else — the graphics routes want a Graphics Author session too, and
		// a control that failed for that reason would read as a broken boundary.
		const response = await fetch('/api/events');

		expect(response.status).toBe(200);
	});

	it('answers 401 rather than 404 for a private path that does not exist', async () => {
		// Stated on its own because it is a deliberate consequence: the boundary
		// runs before the router, so an unauthenticated caller cannot use "Cannot
		// find any route matching" to map the API. `realtimeDiagnosis.ts` reads
		// that message for its own purposes and does so from authenticated runs.
		const { message } = await anonymous('/api/events/1/screens/1/not-a-real-action', { method: 'POST' });

		expect(message).toBe(REFUSAL);
		expect(message).not.toContain('Cannot find any route matching');
	});
});

describe('the surfaces the boundary exempts', () => {
	it('answers the clock without a session, because output machines have none', async () => {
		const { status } = await anonymous('/api/time');

		expect(status).toBe(200);
	});

	it('reaches Better Auth, or nothing could ever sign in', async () => {
		// A wrong password rather than a right one: what is being established is
		// that the boundary did not stand in front of the router. Better Auth's own
		// 401 is a different refusal from the boundary's, and the message is what
		// tells them apart.
		const { status, message } = await anonymous('/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'nobody@keepr.digital', password: 'not-a-password' }),
		});

		expect(status).toBe(401);
		expect(message).not.toBe(REFUSAL);
	});

	it('keeps the capability surface refusing 404, not 401', async () => {
		// The posture that must survive the boundary: a caller with no capability
		// learns nothing about whether the Screen or the asset exists. A 401 here
		// would hand back exactly the distinction the 404 withholds.
		const { status, message } = await anonymous(
			'/api/screen-output/screens/1/assets/nothing/revisions/nothing/content',
		);

		expect(status).toBe(404);
		expect(message).not.toBe(REFUSAL);
	});

	it('lets the admin token alone satisfy the boundary', async () => {
		// ADR-0010 leaves the Graphics Administrator shared token untouched until a
		// roles effort redraws that seam, so these eighteen routes answer to it and
		// to no session. A 401 here would mean an operator's curl stopped working
		// on the day the boundary landed.
		const { status } = await anonymous('/api/admin/graphics-assets/health', {
			headers: { 'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN },
		});

		expect(status).toBe(200);
	});

	it('still refuses an admin route that presents no token, on the route\'s own terms', async () => {
		// The exemption is from the *session* requirement, not from authorisation:
		// each admin route calls `requireGraphicsAdministrator` itself, and its 403
		// is what a caller with neither credential meets.
		const { status, message } = await anonymous('/api/admin/graphics-assets/health');

		expect(status).toBe(403);
		expect(message).not.toBe(REFUSAL);
	});

	it('answers the first-admin bootstrap, which exists for installations with no account', async () => {
		// A wrong token, because a right one would create an account this file has
		// no business creating. 403 rather than 401 is the route's own refusal, and
		// the point is that the boundary let the request reach it.
		const { status, message } = await anonymous('/api/bootstrap/ensure-admin', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-admin-bootstrap-token': 'not-the-token' },
			body: JSON.stringify({ email: 'nobody@keepr.digital', password: 'not-a-password-that-is-used' }),
		});

		expect(status).toBe(403);
		expect(message).not.toBe(REFUSAL);
	});
});
