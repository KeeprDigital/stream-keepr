import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceConfigurationError } from '~~/server/utils/errors';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { serverMiddlewareFiles } from '~~/test/helpers/routeRefusalScan';

/**
 * The deny-by-default API boundary as the middleware answers it (#396,
 * ADR-0010).
 *
 * The path policy is exercised against every route on disk in
 * `test/unit/server/utils/apiBoundary.test.ts`; what is left for here is what
 * this file adds to it — that a private path with no session is refused with
 * the one uniform 401, that a session admits, that an exempt path is not asked
 * about a session **at all**, and that a blank secret arrives as the 503 naming
 * the setting rather than as a 401 about a password.
 *
 * The last of those is not a nicety. The session read is the first thing inside
 * the boundary that can fail on configuration, and it now runs on every
 * `/api/**` request in the application; an operator whose deployment is missing
 * `NUXT_BETTER_AUTH_SECRET` needs the name of the setting, not an invitation to
 * sign in again with credentials that would never have worked.
 */

/**
 * The one session read a request makes, mocked as the middleware calls it (#398).
 *
 * It asks `requestUserSession` rather than `serverAuth().api.getSession` so the
 * handler behind it reuses this answer instead of reading the same row again;
 * what the middleware does with the answer — refuse, admit, or not ask at all —
 * is unchanged, and is what the rows below are about.
 */
const mockRequestUserSession = vi.fn();

vi.mock('~~/server/utils/auth', () => ({
	requestUserSession: mockRequestUserSession,
}));

const mockGetRequestURL = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestURL', mockGetRequestURL);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

const handler = (await import('~~/server/middleware/api-session')).default;

/** A request for `path`, carrying the headers Better Auth would read a cookie from. */
function request(path: string, method = 'GET', headers: Record<string, string> = {}) {
	mockGetRequestURL.mockReturnValue(new URL(`https://stream.example${path}`));
	return stubH3Event({
		method,
		headers: new Headers({ cookie: 'better-auth.session_token=a-token', ...headers }),
	});
}

const SESSION = {
	session: { id: 'a-session' },
	user: { id: 'a-user' },
};

describe('the API boundary middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refuses a private route with no session, as one uniform 401', async () => {
		mockRequestUserSession.mockResolvedValue(null);

		await expect(handler(request('/api/events/1/players'))).rejects.toMatchObject({
			statusCode: 401,
			message: 'Authentication is required',
		});
	});

	it('answers every private route with the same refusal, so the census has one entry', async () => {
		// The uniformity is what keeps this to a single entry in the refusal lists
		// that have to stay exhaustive (`SCREEN_COMMAND_ROUTE_REFUSALS`), and it is
		// also all a caller can act on: every reason a session is absent is
		// answered by signing in again.
		mockRequestUserSession.mockResolvedValue(null);

		const refusals = [];
		for (const path of ['/api/events/1/screens/2/command', '/api/graphics-assets', '/api/_test/ordinary-mutation'])
			refusals.push(await handler(request(path)).catch((error: Error) => error.message));

		expect(new Set(refusals)).toEqual(new Set(['Authentication is required']));
	});

	it('admits a request that carries a session', async () => {
		mockRequestUserSession.mockResolvedValue({
			session: { id: 'a-session' },
			user: { id: 'a-user' },
		});

		await expect(handler(request('/api/events/1/players'))).resolves.toBeUndefined();
		expect(mockRequestUserSession).toHaveBeenCalledOnce();
	});

	it('does not ask about a session on an exempt path, rather than asking and allowing', async () => {
		// Asking would cost a session lookup per Screen Output request and, on a
		// checkout with no `NUXT_BETTER_AUTH_SECRET`, would turn the clock and the
		// capability surface into 503s — the two surfaces that have to keep working
		// for a machine showing program.
		mockRequestUserSession.mockResolvedValue(null);

		for (const path of [
			'/api/time',
			'/api/auth/sign-in/email',
			'/api/screen-output/screens/7/asset-capability-session',
			'/api/admin/graphics-assets/health',
			'/api/bootstrap/ensure-admin',
			'/login',
		])
			await expect(handler(request(path))).resolves.toBeUndefined();

		expect(mockRequestUserSession).not.toHaveBeenCalled();
	});

	// The Screen Output Link exchange carries its credential in its body: OBS's
	// browser source or a script POSTs it with no `Origin`, and no Session is read.
	it.each([
		['naming no origin', {}],
		[
			'from its own page',
			{ 'sec-fetch-site': 'same-origin', 'origin': 'https://stream.example' },
		],
		[
			'from another site',
			{ 'sec-fetch-site': 'cross-site', 'origin': 'https://not-this-installation.example' },
		],
	])('admits a Screen Output Link exchange %s without asking about a session', async (_from, headers) => {
		mockRequestUserSession.mockResolvedValue(SESSION);

		await expect(handler(request('/api/screen-output/link', 'POST', {
			'content-type': 'application/json',
			...headers,
		}))).resolves.toBeUndefined();

		expect(mockRequestUserSession).not.toHaveBeenCalled();
	});

	// Wiring for `requestIsCrossSiteMutation`: a signed-in browser made to POST
	// by another site is refused before a handler runs; its own page, and a
	// client that names no origin at all, are admitted.
	it.each([
		[
			'its own page',
			'admitted',
			{ 'sec-fetch-site': 'same-origin', 'origin': 'https://stream.example' },
		],
		[
			'its own page, in a browser without Sec-Fetch-Site',
			'admitted',
			{ origin: 'https://stream.example' },
		],
		['a script or test that names no origin', 'admitted', {}],
		[
			'a sibling subdomain',
			403,
			{ 'sec-fetch-site': 'same-site', 'origin': 'https://evil.example' },
		],
		[
			'another site',
			403,
			{ 'sec-fetch-site': 'cross-site', 'origin': 'https://not-this-installation.example' },
		],
		[
			'another site, in a browser without Sec-Fetch-Site',
			403,
			{ origin: 'https://not-this-installation.example' },
		],
	] as const)('answers a signed-in POST from %s: %s', async (_from, outcome, headers) => {
		mockRequestUserSession.mockResolvedValue(SESSION);

		const answered = await Promise.resolve(handler(request('/api/events/1/screens/2/command', 'POST', headers))).then(
			() => 'admitted',
			(refusal: { statusCode: number }) => refusal.statusCode,
		);

		expect(answered).toBe(outcome);
	});

	it('refuses a cross-site POST as Forbidden, in words that say why', async () => {
		mockRequestUserSession.mockResolvedValue(SESSION);

		await expect(handler(request('/api/events', 'POST', { 'sec-fetch-site': 'cross-site' }))).rejects.toMatchObject({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'Cross-site request refused',
		});
	});

	it.each([
		['a cross-site read of a private route', '/api/events', 'GET'],
		// These carry their own credential and no Session cookie decides them:
		// Better Auth checks its own origin, the rest present a token or a bearer.
		['a cross-site POST to Better Auth\'s router', '/api/auth/sign-in/email', 'POST'],
		['a cross-site POST to the capability surface', '/api/screen-output/screens/7/asset-capability-session', 'POST'],
		['a cross-site POST to the Graphics Administrator surface', '/api/admin/users', 'POST'],
		['a cross-site POST to the first-admin bootstrap', '/api/bootstrap/ensure-admin', 'POST'],
	])('leaves %s to its own guard', async (_case, path, method) => {
		mockRequestUserSession.mockResolvedValue(SESSION);

		await expect(handler(request(path, method, {
			'sec-fetch-site': 'cross-site',
			'origin': 'https://not-this-installation.example',
		}))).resolves.toBeUndefined();
	});

	it('sorts ahead of every other middleware, which is the order Nitro composes them in', () => {
		// Load-bearing, and the reason the file is named `api-session.ts` rather
		// than anything more descriptive:
		//
		// - `event-exists.ts` answers 404 for an Event that is not there. Running it
		//   first would let an anonymous caller ask which Event ids exist and read
		//   the answer off the difference between 404 and 401. The integration suite
		//   pins that pair against a real server; this pins why it holds.
		// - `request-body-limit.ts` would otherwise stream an unauthenticated
		//   upload and answer 413, telling a caller with no session what the body
		//   ceiling is.
		//
		// Read off the directory, so a middleware added tomorrow with an earlier
		// name fails here rather than silently running in front of the boundary.
		const names = serverMiddlewareFiles().map(file => file.slice(file.lastIndexOf('/') + 1));

		expect(names[0]).toBe('api-session.ts');
		expect([...names].sort()).toEqual(names);
	});

	it('lets a blank secret arrive as the 503 that names the setting', async () => {
		mockRequestUserSession.mockRejectedValue(
			new ServiceConfigurationError('NUXT_BETTER_AUTH_SECRET', 'is not configured'),
		);

		await expect(handler(request('/api/events/1/players'))).rejects.toThrow(/NUXT_BETTER_AUTH_SECRET/);
	});
});
