import {
	$fetch as unauthenticated$Fetch,
	fetch as unauthenticatedFetch,
	url,
} from '@nuxt/test-utils/e2e';
import {
	INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
	INTEGRATION_OPERATOR_EMAIL,
	INTEGRATION_OPERATOR_PASSWORD,
} from './environment';

/**
 * The integration suite's HTTP client: `@nuxt/test-utils`' own, signed in (#396).
 *
 * ADR-0010's deny-by-default boundary means there is no unauthenticated client for
 * these routes any more, so **every suite imports `fetch` and `$fetch` from here
 * rather than from `@nuxt/test-utils/e2e`**. That is the whole of the change to
 * fifty-odd suites, and it is an explicit import rather than a global patch on
 * purpose:
 *
 * - A patched `globalThis.fetch` does not work here at all, which is worth writing
 *   down because it looks like it should. `@nuxt/test-utils` calls `ofetch`'s
 *   `fetch`, which dereferences its own realm's global — and an externalised
 *   dependency's realm is not the test file's, so the patch is installed, visible
 *   from the test, and never consulted. Measured, not assumed: a direct
 *   `globalThis.fetch` call answered 200 through the patch in the same run where
 *   the helper answered 401 around it.
 * - Even where it worked it would be invisible. A suite whose requests are
 *   authenticated by machinery in a config file reads as a suite testing
 *   unauthenticated routes, and the next person to add one would find out from a
 *   wall of 401s.
 *
 * `test/unit/integration/integrationClient.test.ts` keeps it honest: no file under
 * `test/integration/` may import the raw helpers except this one.
 *
 * **The session is appended, never substituted — and never appended to a request
 * that carries one already** (see `signed` below, and `./identities.ts` for the
 * two identities a suite can present instead of the operator).
 */

/** The paths that get a session, which is every API path but two surfaces. */
const UNAUTHENTICATED_API_PREFIXES = ['/api/auth/', '/api/bootstrap/'] as const;

/**
 * Whether this path is one the client signs.
 *
 * Deliberately **not** derived from `apiPathRequiresSession`. A client built from
 * the boundary's own allowlist could not catch a mistake in it: both would exempt
 * the same path and the suite would pass. So this is its own list, and it is a
 * short one — Better Auth's router, where `auth.test.ts` manages cookies itself and
 * a second live session in the header would falsify its sign-out assertion; and the
 * first-admin bootstrap, which is how this file acquires a session in the first
 * place.
 *
 * Pages are left alone because nothing about them needs a session: the boundary
 * covers `/api/**`, and a page request's answer must be the one a real browser
 * gets.
 */
export function requestCarriesSession(path: string): boolean {
	if (!path.startsWith('/api/'))
		return false;

	return !UNAUTHENTICATED_API_PREFIXES.some(prefix => path.startsWith(prefix));
}

let sessionCookie: Promise<string> | undefined;

/**
 * The operator's session cookie, minted once per process.
 *
 * Memoised on the promise rather than on the value, so the several requests a test
 * file makes before the first one resolves share one sign-in instead of racing to
 * create the same account three times.
 *
 * The account is created through the first-admin bootstrap rather than by direct
 * SQL because that route is armed for the whole run anyway, and "can somebody sign
 * in now" is the only question its answer is worth anything for.
 */
export function operatorSessionCookie(): Promise<string> {
	sessionCookie ??= signInAsOperator();
	return sessionCookie;
}

/**
 * Create the operator if needed and sign it in, returning its session cookie.
 *
 * Takes the transport so `globalSetup` can sign in to each server it starts
 * before any test context exists; test files use the defaults.
 */
export async function signInAsOperator(
	request: (path: string, init?: RequestInit) => Promise<Response> = unauthenticatedFetch,
	origin: string = url('/'),
): Promise<string> {
	const ensured = await request('/api/bootstrap/ensure-admin', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-admin-bootstrap-token': INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
		},
		body: JSON.stringify({
			email: INTEGRATION_OPERATOR_EMAIL,
			password: INTEGRATION_OPERATOR_PASSWORD,
			name: 'Integration Operator',
		}),
	});
	if (!ensured.ok) {
		throw new Error(
			`The integration suite could not create its operator: ${ensured.status} from the first-admin bootstrap. `
			+ 'Every route behind the API boundary answers 401 without one, so the run would fail wholesale with '
			+ 'nothing naming the cause.',
		);
	}

	const signIn = await request('/api/auth/sign-in/email', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Better Auth refuses a state-changing request with no `Origin` —
			// `403 MISSING_OR_NULL_ORIGIN`, its CSRF defence. `nuxt dev` does not
			// enforce it and a built Worker does, so this suite would have gone on
			// passing while every non-browser sign-in against a real deployment was
			// refused. Found by running the fan-out probe against `pnpm preview`;
			// sent here too so the suite's own client asks the way a browser does
			// rather than the way only the dev server tolerates.
			origin,
		},
		body: JSON.stringify({
			email: INTEGRATION_OPERATOR_EMAIL,
			password: INTEGRATION_OPERATOR_PASSWORD,
		}),
	});
	if (!signIn.ok)
		throw new Error(`The integration suite's operator could not sign in: ${signIn.status}.`);

	// Every cookie the response set, not the session token by name: Better Auth
	// writes `__Secure-`-prefixed names over https, and the suite should not depend
	// on which scheme its spawned server happened to use.
	const cookie = signIn.headers.getSetCookie()
		.map(value => value.split(';', 1)[0] ?? '')
		.filter(pair => pair.includes('='))
		.join('; ');
	if (!cookie)
		throw new Error('The integration suite\'s operator signed in and was issued no session cookie.');

	return cookie;
}

/**
 * The one retry in this suite, re-exported so a caller needs one import.
 *
 * It lives in `./transportRetry` rather than here because it is the only thing in
 * this file that can be tested without a spawned server — and it needed to be,
 * since the defect it had was a docblock promising "once" while two layers each
 * retried. `test/unit/integration/transportRetry.test.ts` pins it now.
 *
 * Deliberately **not** applied inside `fetch` and `$fetch` below: they cannot
 * rebuild a streamed body, which is the shape that actually fails, so a retry there
 * would be the layer that cannot do the job doing it twice.
 */
export { throughOneTransportFailure } from './transportRetry';

/**
 * A Better Auth session cookie, under either name it can be issued as.
 *
 * The `__Secure-` prefix is added over https, so which name a run sees depends on
 * the scheme the spawned server happened to use.
 */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

/**
 * One request's headers, signed as the operator unless the caller signed it as
 * somebody else.
 *
 * **A caller's own session wins, and that rule arrived with #398.** Before the
 * cutover the identity a graphics suite presented was a Graphics Author Session
 * under a name of its own, so appending the operator's cookie beside it was two
 * different questions answered by two different cookies. Since the cutover both
 * are `better-auth.session_token`: appending would put the same cookie name in one
 * header twice and leave which identity the server reads to whichever end of the
 * header it parsed first. So a request that already carries a session is left
 * exactly as the caller wrote it — which is also what makes `./identities.ts`
 * work at all.
 */
async function signed(path: string, headers: HeadersInit | undefined): Promise<Record<string, string>> {
	const merged = new Headers(headers ?? {});
	const own = merged.get('cookie');
	if (requestCarriesSession(path) && !SESSION_COOKIE.test(own ?? ''))
		merged.set('cookie', [own, await operatorSessionCookie()].filter(Boolean).join('; '));

	return Object.fromEntries(merged);
}

/**
 * `@nuxt/test-utils`' `fetch`, signed in.
 *
 * Same signature, so a suite reads exactly as it did before the boundary existed —
 * which is the point: what changed is who the suite is, not what it asserts.
 */
export const fetch: typeof unauthenticatedFetch = async (path, options) => {
	return await unauthenticatedFetch(path, { ...options, headers: await signed(path, options?.headers) });
};

/**
 * The same function with its route inference switched off, for use inside the
 * wrapper only.
 *
 * Nitro types `$fetch` against every route in the application, and instantiating
 * that machinery inside a wrapper exhausts TypeScript's depth budget: `vue-tsc`
 * answers TS2321 "Excessive stack depth", a family that reveals only one or two
 * errors at a time.
 * Measured rather than guessed at: seven errors with the call passed through a
 * generic helper, six with it inlined, nil with the callee narrowed here.
 *
 * Nothing is lost by narrowing, because the exported binding is declared as
 * `typeof unauthenticated$Fetch`: every **caller** keeps the real types, including
 * the `$fetch<Screen>(…)` generics the suites rely on. What is narrowed is only
 * this file's own view of the callee.
 */
const untyped$Fetch = unauthenticated$Fetch as unknown as (
	path: string,
	options?: Record<string, unknown>,
) => Promise<unknown>;

/** `@nuxt/test-utils`' `$fetch`, signed in. */
export const $fetch: typeof unauthenticated$Fetch = (async (path: string, options?: Record<string, unknown>) => {
	return await untyped$Fetch(path, {
		...options,
		headers: await signed(path, options?.headers as HeadersInit | undefined),
	});
}) as typeof unauthenticated$Fetch;

/**
 * The same two helpers with no session at all, for the suite that tests the
 * boundary itself.
 *
 * Exported from here rather than left to a direct import of the raw module, so the
 * structural guard can stay absolute — and so an anonymous request says out loud
 * that it is one.
 */
export const anonymousFetch = unauthenticatedFetch;
export const anonymous$Fetch = unauthenticated$Fetch;

/**
 * The rest of `@nuxt/test-utils/e2e`'s surface, passed straight through.
 *
 * Nothing about these needs a session — they start the server, publish its URL, and
 * resolve a path against it. They are re-exported so the structural guard can be
 * absolute: **one** file in `test/integration/` names the raw module, and it is this
 * one, so "is this suite authenticated?" has a single answer everywhere else.
 */
export { createTest, exposeContextToEnv, url } from '@nuxt/test-utils/e2e';
