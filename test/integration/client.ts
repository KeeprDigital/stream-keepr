import {
	$fetch as unauthenticated$Fetch,
	fetch as unauthenticatedFetch,
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
 * **The session is appended, never substituted.** Several suites present a
 * Graphics Author cookie of their own, and that identity answers a different
 * question — one says who owns an operation, the other says the request is allowed
 * in at all. A client that replaced the header would turn every graphics
 * authorisation test into an anonymous-author test.
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
 * covers `/api/**`, and `graphicsAuthorSession.ts` reads `Set-Cookie` off a page
 * request whose answer must be the one a real browser gets.
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

async function signInAsOperator(): Promise<string> {
	const ensured = await unauthenticatedFetch('/api/bootstrap/ensure-admin', {
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

	const signIn = await unauthenticatedFetch('/api/auth/sign-in/email', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
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
 * The transport failures that mean **no verdict was produced**, and the one
 * retry they get.
 *
 * `requestBodyLimits.test.ts` deliberately sends bodies over the ceiling, and the
 * server answers 413 while those bytes are still arriving — so it closes a
 * connection with an unread request body on it, and the next request to reuse that
 * pooled socket dies with EPIPE or ECONNRESET before it ever reaches a handler.
 * That was latent before #396 and observable after it: the boundary resolves a
 * session before the body-limit middleware reads anything, which widens the window
 * between "the client is still writing" and "the server has already refused".
 *
 * Retrying is not weakening an assertion. These are failures of the socket rather
 * than answers from the server: there is no status to have been wrong about, and
 * the alternative is a run that fails in whichever file happens to inherit the
 * poisoned connection. A **real** server crash still fails, because it fails twice.
 *
 * Only once, and only where the body can be sent again — a `ReadableStream` cannot
 * be replayed, and silently sending a truncated second copy would be worse than the
 * flake.
 */
const RETRYABLE_TRANSPORT_CODES = new Set(['EPIPE', 'ECONNRESET', 'UND_ERR_SOCKET']);

function isRetryableTransportFailure(error: unknown): boolean {
	const cause = (error as { cause?: unknown })?.cause;
	const code = (cause as { code?: unknown })?.code ?? (error as { code?: unknown })?.code;
	return typeof code === 'string' && RETRYABLE_TRANSPORT_CODES.has(code);
}

/**
 * Whether this body can be sent a second time.
 *
 * A `ReadableStream` cannot: it is consumed by the first attempt, and a silently
 * truncated second copy would be a worse outcome than the flake — those are
 * exactly `requestBodyLimits.test.ts`' streamed oversized bodies, where what the
 * server received is the whole assertion. `FormData` is excluded for no better
 * reason than that nothing here sends one, and a conservative answer costs a
 * retry rather than a wrong one.
 */
function isReplayable(body: unknown): boolean {
	return body === undefined
		|| body === null
		|| typeof body === 'string'
		|| body instanceof Uint8Array
		|| (typeof body === 'object' && !(body instanceof ReadableStream) && !(body instanceof FormData));
}

/** Whether this failure earns the second attempt, shared by both wrappers below. */
function deservesSecondAttempt(body: unknown, error: unknown): boolean {
	return isReplayable(body) && isRetryableTransportFailure(error);
}

/**
 * One request, made again if the first never reached a verdict — for the caller
 * that can rebuild its own body.
 *
 * The wrappers below cannot retry a streamed body: the stream is consumed by the
 * first attempt, and this is the shape that actually fails.
 * `requestBodyLimits.test.ts` streams bodies over the ceiling, the server answers
 * 413 with those bytes still arriving, and the request after it — its own next
 * row, streamed too — dies on the poisoned socket. Handing the whole request in
 * as a thunk is what makes the second attempt possible, because the body is
 * constructed inside it.
 *
 * It belongs to the caller that creates the condition rather than to the client,
 * which cannot know how to build a fresh stream.
 */
export async function throughOneTransportFailure<T>(request: () => Promise<T>): Promise<T> {
	try {
		return await request();
	}
	catch (error) {
		if (!isRetryableTransportFailure(error))
			throw error;
		return await request();
	}
}

/** One request's headers with the operator's session appended to whatever was there. */
async function signed(path: string, headers: HeadersInit | undefined): Promise<Record<string, string>> {
	const merged = new Headers(headers ?? {});
	if (requestCarriesSession(path))
		merged.set('cookie', [merged.get('cookie'), await operatorSessionCookie()].filter(Boolean).join('; '));

	return Object.fromEntries(merged);
}

/**
 * `@nuxt/test-utils`' `fetch`, signed in.
 *
 * Same signature, so a suite reads exactly as it did before the boundary existed —
 * which is the point: what changed is who the suite is, not what it asserts.
 */
export const fetch: typeof unauthenticatedFetch = async (path, options) => {
	const request = { ...options, headers: await signed(path, options?.headers) };
	try {
		return await unauthenticatedFetch(path, request);
	}
	catch (error) {
		if (!deservesSecondAttempt(options?.body, error))
			throw error;
		return await unauthenticatedFetch(path, request);
	}
};

/**
 * The same function with its route inference switched off, for use inside the
 * wrapper only.
 *
 * Nitro types `$fetch` against every route in the application, and instantiating
 * that machinery **twice in one function** — the call and its retry — exhausts
 * TypeScript's depth budget: `vue-tsc` answers TS2321 "Excessive stack depth", the
 * family `docs/agents/parallel-rounds.md` records as revealing one error at a time.
 * Measured rather than guessed at: with the retry written through a generic helper
 * it was seven errors, inlined as a `try`/`catch` it was six, and it is nil with
 * the callee narrowed here.
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
	const request = { ...options, headers: await signed(path, options?.headers as HeadersInit | undefined) };
	try {
		return await untyped$Fetch(path, request);
	}
	catch (error) {
		if (!deservesSecondAttempt(options?.body, error))
			throw error;
		return await untyped$Fetch(path, request);
	}
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
