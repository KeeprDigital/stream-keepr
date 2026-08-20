import type { H3Event } from 'h3';
import process from 'node:process';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getCookie, setCookie } from 'h3';
import { db, schema } from 'hub:db';
import {
	LOCAL_DEVELOPER_SESSION_COOKIE,
	LOCAL_DEVELOPER_SESSION_ID_PREFIX,
	LOCAL_DEVELOPER_USER_EMAIL,
	LOCAL_DEVELOPER_USER_ID,
	LOCAL_DEVELOPER_USER_NAME,
	localAuthBypassEnabled,
} from '~~/shared/utils/localDeveloperAuth';
import { authStaticOptions } from './authOptions';
import { ServiceConfigurationError } from './errors';

/** The environment name behind `runtimeConfig.betterAuthSecret`, as the operator sets it. */
const BETTER_AUTH_SECRET_SETTING = 'NUXT_BETTER_AUTH_SECRET';

/**
 * What is unavailable without the secret, completing "<name> is not configured, so …".
 *
 * `build/localConfiguration.ts` quotes this surface verbatim in the notice a dev server
 * prints when the name is missing, the way it quotes `requireGraphicsAdministrator`'s
 * clause — which is why the wording lives here, beside the refusal, rather than being
 * invented there.
 *
 * It said only "is not configured" until #396. That was accurate and useless: this is the
 * instance every `/api/**` request now resolves a session through
 * (`server/middleware/api-session.ts`), so a blank secret is the whole authenticated
 * surface answering 503, not just the sign-in form. A clause naming only sign-in would
 * leave a developer to find the rest one route at a time.
 */
const BETTER_AUTH_SECRET_UNAVAILABLE_CLAUSE
	= 'is not configured, so signing in and every authenticated API route are unavailable';

/**
 * This installation's Better Auth instance, as a type.
 *
 * Named so a caller can be handed a *different* instance of the same shape —
 * `betterAuthBootstrapPort` takes one, which is what lets the unit suite build
 * the first-admin bootstrap over a throwaway auth with no database behind it.
 */
export type ServerAuth = ReturnType<typeof createAuth>;

let auth: ServerAuth | null = null;

function createAuth(secret: string) {
	return betterAuth({
		...authStaticOptions,
		// Sessions live in D1 through the Drizzle adapter — deliberately not KV
		// `secondaryStorage` (ADR decided on #386): native sliding expiry with no
		// KV single-key write cap to protect.
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema,
		}),
		secret,
	});
}

/**
 * The Better Auth instance, constructed on first use because the secret only
 * exists at runtime. Outside the development-only Local Developer Session, a
 * missing secret is an unfinished deployment, and the
 * classification is what lets the response name the setting instead of a
 * stack-free 500 — same reasoning as `getAblyClient`.
 *
 * **Blank means whitespace as well as empty**, which it did not until #396. The
 * local-configuration notice in `build/localConfiguration.ts` counts a name as
 * missing when it trims to nothing, and says it does so "because that is how the readers
 * count it" — true of `requireGraphicsAdministrator` and of the capability
 * signing key, and false here while this test was `!config.betterAuthSecret`. A
 * name set to a space is the likeliest way to hold one at all (`cp
 * .env.example .env` and a stray keystroke), and the old reading answered it by
 * signing every session in the installation with that space instead of naming
 * the setting. Made to matter by this ticket, which is where the name became one
 * a checkout is required to have.
 *
 * The configured value is passed on **as written**, not trimmed: what a blank
 * test decides is whether the surface is armed, and quietly signing with a
 * different string than the operator set is not this function's business.
 */
export function serverAuth() {
	if (!auth) {
		const config = useRuntimeConfig();

		if (!config.betterAuthSecret?.trim()) {
			throw new ServiceConfigurationError(BETTER_AUTH_SECRET_SETTING, BETTER_AUTH_SECRET_UNAVAILABLE_CLAUSE);
		}

		auth = createAuth(config.betterAuthSecret);
	}

	return auth;
}

/**
 * The session this request carries, or `null` — for the routes that answer to
 * more than one credential (#397).
 *
 * `server/middleware/api-session.ts` is the only caller that *requires* a
 * session, and the routes ADR-0010 exempts from it are exempt precisely because
 * something else may vouch for them: a Screen Output presents a Screen Output
 * Asset Capability and has no session at all. Those routes need to ask rather
 * than demand, and they need the answer to be a value instead of a refusal.
 *
 * **A missing `NUXT_BETTER_AUTH_SECRET` answers `null` rather than raising**
 * when the local bypass is inactive,
 * which is the one judgement in here. Everywhere else that 503 is the right
 * answer — it names the setting to an operator who can go and set it. Here it
 * would take the credential-free surface down with the configuration fault: an
 * output machine showing program has no session to lose, and refusing it because
 * sign-in is unconfigured would be the boundary reaching past what it protects. On
 * such a checkout an operator cannot sign in to anything anyway, every other route
 * says so with the name, and `pnpm dev` warned at boot; so nothing is hidden by
 * this that is not already being said loudly.
 *
 * **Which makes it fail-open, so the invariant is a precondition on the caller,
 * not on this function: only a route with a credential-free arm may use it.** Every
 * caller has one. The capability admits the Screen lookup and the realtime token on
 * its own, and for them a blank secret costs an operator's *convenience* arm while
 * the output keeps working; the two optional identities below are read on surfaces
 * that are already admitted — by the shared administrator token, or by the session
 * middleware itself — where the fail-open costs a recorded name or a lease holder on
 * a deployment that has no sessions to hold one. A route where the session is the only way in must
 * use the middleware, or demand `serverAuth()` itself and let the 503 out; asking
 * this instead would turn an unconfigured deployment into a plain refusal, which is
 * the diagnosis #233 spent three tickets learning to give. Pinned in
 * `test/unit/server/utils/auth.test.ts` so the fail-open half is a behaviour on
 * record rather than a sentence.
 */
export async function optionalUserSession(event: H3Event) {
	try {
		return await requestUserSession(event);
	}
	catch (failure) {
		if (failure instanceof ServiceConfigurationError)
			return null;
		throw failure;
	}
}

/** This request's session as Better Auth answers it. */
export type UserSession = Awaited<ReturnType<ServerAuth['api']['getSession']>>;

/** Whether this request is allowed to substitute the Local Developer Session. */
export function localAuthBypassIsActive(_event: H3Event): boolean {
	return localAuthBypassEnabled({
		dev: process.env.NODE_ENV !== 'production',
		value: process.env.NUXT_LOCAL_AUTH_BYPASS,
	});
}

const LOCAL_SESSION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DEVELOPER_CREATED_AT = new Date(0);
const LOCAL_DEVELOPER_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z');

/**
 * The synthetic Better Auth boundary reading used by local development.
 *
 * The User id is constant because work belongs to the person-shaped local
 * identity. The Session id comes from an http-only session cookie, so reloads in
 * one browser remain one editor while another browser receives another editor.
 */
function localDeveloperSession(event: H3Event): NonNullable<UserSession> {
	const presented = getCookie(event, LOCAL_DEVELOPER_SESSION_COOKIE);
	const token = presented && LOCAL_SESSION_TOKEN.test(presented) ? presented : crypto.randomUUID();

	if (token !== presented) {
		setCookie(event, LOCAL_DEVELOPER_SESSION_COOKIE, token, {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
		});
	}

	const sessionId = `${LOCAL_DEVELOPER_SESSION_ID_PREFIX}${token}`;
	return {
		session: {
			id: sessionId,
			userId: LOCAL_DEVELOPER_USER_ID,
			createdAt: LOCAL_DEVELOPER_CREATED_AT,
			updatedAt: LOCAL_DEVELOPER_CREATED_AT,
			expiresAt: LOCAL_DEVELOPER_EXPIRES_AT,
			token: sessionId,
			ipAddress: null,
			userAgent: event.headers.get('user-agent'),
		},
		user: {
			id: LOCAL_DEVELOPER_USER_ID,
			name: LOCAL_DEVELOPER_USER_NAME,
			email: LOCAL_DEVELOPER_USER_EMAIL,
			emailVerified: true,
			createdAt: LOCAL_DEVELOPER_CREATED_AT,
			updatedAt: LOCAL_DEVELOPER_CREATED_AT,
			image: null,
			role: 'admin',
			banned: false,
			banReason: null,
			banExpires: null,
		},
	};
}

/**
 * Where a request keeps the session it has already resolved.
 *
 * `event.context` rather than a module-level map because the lifetime wanted is
 * exactly the request's: the context is created with the event and collected
 * with it, so nothing has to remember to forget.
 */
const REQUEST_SESSION_CONTEXT_KEY = 'userSession';

/**
 * The session this request carries, resolved **once** however many times it is
 * asked for.
 *
 * Every `/api/**` request already resolves a session in
 * `server/middleware/api-session.ts` before a handler runs, and the identities
 * below then ask again — an ingestion route asks who the person is, and a leased
 * write asks which browser they are in. Three reads of the same D1 row, on a
 * route a resumable transfer calls once per part. Memoising here makes the extra
 * questions free rather than making each caller thread a session through.
 *
 * The **promise** is memoised, not the session: a route that asks two identity
 * questions concurrently would otherwise miss the cache twice and issue the
 * second read before the first had landed.
 *
 * A configuration fault is not cached, because `serverAuth()` raises before there
 * is a promise to keep — so a request that meets a blank secret meets the same
 * 503 every time it asks, which is what the caller that swallows it expects.
 */
export async function requestUserSession(event: H3Event): Promise<UserSession> {
	const resolved = event.context[REQUEST_SESSION_CONTEXT_KEY] as Promise<UserSession> | undefined;
	if (resolved)
		return await resolved;

	const resolving = localAuthBypassIsActive(event)
		? Promise.resolve(localDeveloperSession(event))
		: serverAuth().api.getSession({ headers: event.headers });
	event.context[REQUEST_SESSION_CONTEXT_KEY] = resolving;
	return await resolving;
}

/**
 * The person this request is acting as (ADR-0010's credential model, cut over on
 * #398).
 *
 * This is what a Graphics Ingestion Operation records as its initiator and what
 * an author-scoped route matches on, and it is deliberately **the user rather
 * than the browser**: an operation paused overnight at `awaiting-confirmation`
 * survives the browser that started it, and signing in from any machine resumes
 * it. The same widening makes the idempotency scope `(initiatedBy,
 * idempotencyKey)` per-person, so the same key sent from two browsers dedupes to
 * one operation — intended dedupe, not a side effect. `optionalBrowserSessionId`
 * below is the other granularity, for the one thing that needs it.
 *
 * **The refusal is unreachable through the routes that call this, and is spelled
 * anyway** — see `requireUserSession` below, which owns it. What that closes is
 * the day a caller stops being a private `/api/**` path.
 *
 * **Some routes call this for the refusal alone and discard the id** — the
 * template and Style Set libraries, and the two library reads. That is
 * deliberate rather than a leftover: it keeps each route's own graph refusing
 * before it touches the library, which is a property the unit suites pin per
 * route (`rejects the read before touching the library …`), and which the
 * boundary — composed around every route at once — cannot state about any one of
 * them.
 */
export async function requireUserId(event: H3Event): Promise<string> {
	return (await requireUserSession(event)).user.id;
}

/**
 * Which browser this request is coming from, where it must have one.
 *
 * The lease routes: taking, keeping, or taking over a Graphics Authoring Lease
 * all name a holder, and the holder is a browser (see
 * `optionalBrowserSessionId`). Required rather than optional because a lease with
 * no holder is not a lease — the admissions that merely *consult* one are the
 * optional readers.
 */
export async function requireBrowserSessionId(event: H3Event): Promise<string> {
	return (await requireUserSession(event)).session.id;
}

/**
 * The session, or the boundary's own refusal.
 *
 * The 401's halves are written here as literals matching
 * `server/middleware/api-session.ts`, and not imported from it, for the reason
 * that middleware gives for writing its own: `test/helpers/routeRefusalScan.ts`
 * resolves a `const` only within the file it is reading, so an imported status or
 * message arrives at the exhaustiveness check as a refusal it cannot read. Two
 * files spelling one sentence is the cost; the pair is identical, so the census
 * that has to stay exhaustive gains no entry from this one.
 */
async function requireUserSession(event: H3Event): Promise<NonNullable<UserSession>> {
	const session = await requestUserSession(event);
	if (session)
		return session;

	throw createError({
		statusCode: 401,
		statusMessage: 'Unauthorized',
		message: 'Authentication is required',
	});
}

/**
 * The person this request is acting as, where there may not be one.
 *
 * For the surfaces outside the session boundary that record who acted when they
 * can: the Graphics Administrator routes are admitted by a shared token that
 * names nobody, and an operator working the cockpit in a browser is also signed
 * in. Inherits `optionalUserSession`'s fail-open on an unconfigured secret, which
 * is right here for the same reason — the admin token is the credential, and the
 * ledger losing a name is not worth refusing the action over.
 */
export async function optionalUserId(event: H3Event): Promise<string | undefined> {
	return (await optionalUserSession(event))?.user.id;
}

/**
 * Which browser this request is coming from, where there is one.
 *
 * The Better Auth session id, and the one identity ADR-0010 keeps at browser
 * granularity: a Graphics Authoring Lease guards concurrent *editors*, and one
 * person signed in from two browsers is two editors. A lease held by a userId
 * would let them overwrite each other's composition in silence, which is the harm
 * the lease exists to prevent — so `holderSessionId` carries this, and the
 * takeover surface resolves it back to a user for display.
 *
 * Optional because a lease admission has to tell "no session" from "somebody
 * else's lease" rather than refuse outright.
 */
export async function optionalBrowserSessionId(event: H3Event): Promise<string | undefined> {
	return (await optionalUserSession(event))?.session.id;
}
