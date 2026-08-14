import type { H3Event } from 'h3';
import {
	createError,
	getCookie,
	getRequestURL,
	setCookie,
	setResponseHeader,
} from 'h3';
import { kv } from 'hub:kv';
import { GraphicsAuthorSessionUnavailableError } from '~~/server/utils/errors';

const GRAPHICS_AUTHOR_SESSION_COOKIE = 'stream_keepr_graphics_author_session';

/**
 * How long a graphics author session survives **its last request**, not its
 * first.
 *
 * This session is the only identity a Graphics Ingestion Operation has, so when
 * it lapses every operation it started becomes unreachable to the person who
 * started it — reloading mints a new session, and a new author. An absolute
 * lifetime therefore expired authors mid-upload; an idle one cannot, because a
 * transfer in progress is itself a stream of requests. ADR-0003 records why the
 * absolute bound was not worth what it cost.
 */
const GRAPHICS_AUTHOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * How stale a session's recorded life may get before a request rewrites it.
 *
 * Not only a cost decision. Workers KV rate-limits writes to a **single key** to
 * roughly one per second, and a resumable transfer sends its parts concurrently
 * — so a session rewritten on literally every request would be rewritten many
 * times a second under exactly the load an idle lifetime exists to protect. The
 * grace takes that from one write per request to at most one per sender per
 * minute: a hundred-part transfer stops costing a hundred writes.
 *
 * It does not serialise those senders, and is not trying to. The decision below
 * is made from the `expiresAt` each sender has just read, so concurrent senders
 * can read the same stale value and all write at once — a burst of up to the
 * concurrent-part limit, once a minute. That is safe rather than merely rare:
 * the write is idempotent in effect, whichever one lands extends the session by
 * the same amount, and a rejected one is swallowed below. The guarantee this
 * buys is "the TTL, give or take a minute".
 */
const GRAPHICS_AUTHOR_SESSION_REFRESH_AFTER_SECONDS = 60;

interface GraphicsAuthorSession {
	authorId: string;
	expiresAt: number;
}

async function sessionKey(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const hex = Array.from(
		new Uint8Array(digest),
		byte => byte.toString(16).padStart(2, '0'),
	).join('');
	return `graphics-author-session:${hex}`;
}

function issueSessionCookie(event: H3Event, token: string): void {
	setCookie(event, GRAPHICS_AUTHOR_SESSION_COOKIE, token, {
		httpOnly: true,
		maxAge: GRAPHICS_AUTHOR_SESSION_TTL_SECONDS,
		path: '/',
		sameSite: 'strict',
		secure: getRequestURL(event).protocol === 'https:',
	});
}

/**
 * Moves a live session's expiry out to a full TTL from now.
 *
 * Both halves have to move together or the shorter one decides: the browser
 * drops a cookie whose `maxAge` elapsed however much life KV still holds, and KV
 * forgets a session the cookie still names. The cookie is only re-issued once
 * the durable write has succeeded, so the browser is never told the session
 * lasts longer than the library believes.
 *
 * Failing to extend a session is not a reason to refuse the request that was
 * extending it — the caller holds a session that is live right now, and the only
 * cost of not sliding it is the life this one request would have added.
 */
async function carrySessionForward(
	event: H3Event,
	token: string,
	key: string,
	session: GraphicsAuthorSession,
): Promise<void> {
	const unspentMilliseconds = session.expiresAt - Date.now();
	const refreshBelow
		= (GRAPHICS_AUTHOR_SESSION_TTL_SECONDS - GRAPHICS_AUTHOR_SESSION_REFRESH_AFTER_SECONDS) * 1000;
	if (unspentMilliseconds > refreshBelow)
		return;
	try {
		await kv.set(
			key,
			{
				authorId: session.authorId,
				expiresAt: Date.now() + GRAPHICS_AUTHOR_SESSION_TTL_SECONDS * 1000,
			},
			{ ttl: GRAPHICS_AUTHOR_SESSION_TTL_SECONDS },
		);
		issueSessionCookie(event, token);
	}
	catch {
		// The identity stands; only its extension was lost.
	}
}

async function readSession(event: H3Event): Promise<GraphicsAuthorSession | undefined> {
	const token = getCookie(event, GRAPHICS_AUTHOR_SESSION_COOKIE);
	if (!token)
		return;
	const key = await sessionKey(token);
	const session = await kv.get<GraphicsAuthorSession>(key);
	if (
		!session
		|| typeof session.authorId !== 'string'
		|| typeof session.expiresAt !== 'number'
		|| session.expiresAt <= Date.now()
	) {
		await kv.del(key);
		return;
	}
	await carrySessionForward(event, token, key, session);
	return session;
}

/**
 * The refusal both entry points raise when the session store cannot be reached.
 *
 * The sentence is written for an operator, and reaching one is what the named
 * cause is for: `mapPublicNitroError` rewrites any 5xx it cannot recognise to
 * 'Internal Server Error', and a raw store exception is unrecognisable. Raising
 * the bare `createError` here again would restore that (#294).
 *
 * `requireGraphicsAuthorSession` is the site a caller meets today;
 * `ensureGraphicsAuthorSession`'s only caller is the middleware, which swallows
 * the refusal and logs. It raises the same one anyway so that a second caller —
 * a route minting a session directly — inherits the sentence rather than the
 * placeholder the middleware never had to care about.
 *
 * `retry-after` beside it because the sentence says *temporarily*, and the seven
 * sites #321 classified as retryable all set one. A caller told a thing is
 * momentary and given no number has to invent an interval, which is the half of
 * #321's finding that was left out of its scope and filed as #337. The number is
 * the same 5 seconds those sites use: it is a floor on how hard to retry, not an
 * estimate of when the store returns, and a second spelling of that floor would
 * only invite the two to drift.
 *
 * The middleware swallows this refusal, so a page load made while the store is
 * down answers 200 carrying a `retry-after` nothing will read — `Retry-After` is
 * defined for the statuses that carry it and is inert on a 200. That is the
 * accepted cost of the number living with the refusal rather than at each of the
 * two throw sites, where it could be reverted at one and kept at the other.
 *
 * **The status is deliberately not readable from source, and the refusal scan
 * says so.** `statusCode: failure.statusCode` is a property access, and
 * `test/helpers/routeRefusalScan.ts` reads a `createError`'s halves out of the
 * syntax — so this surfaces as `statusCode: undefined`, the #330(1) class at a
 * status rather than at a message. Two consequences, both wanted: the
 * exhaustiveness check in `test/unit/integration/realtimeDiagnosis.test.ts` would
 * report this site rather than drop it, the day a route's own import graph reaches
 * this file; and the `carriesCause` census added by #339 cannot read a status here
 * to hold it to, so this site satisfies that guard by being unreadable rather than
 * by naming a cause. It does name one — `cause: failure` in the call below — and
 * the pins for that are in `test/unit/server/modules/graphicsAuthorSession.test.ts`.
 * Spelling the status as a literal 503 would make both readable; it would also put
 * the number in two places, which is what the property access exists to avoid.
 */
function graphicsAuthorSessionUnavailable(event: H3Event, cause: unknown) {
	const failure = new GraphicsAuthorSessionUnavailableError(cause);
	setResponseHeader(event, 'retry-after', 5);
	return createError({
		statusCode: failure.statusCode,
		statusMessage: 'Service Unavailable',
		message: failure.message,
		cause: failure,
	});
}

export async function ensureGraphicsAuthorSession(event: H3Event): Promise<string> {
	try {
		const existing = await readSession(event);
		if (existing)
			return existing.authorId;

		const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
		const session: GraphicsAuthorSession = {
			authorId: crypto.randomUUID(),
			expiresAt: Date.now() + GRAPHICS_AUTHOR_SESSION_TTL_SECONDS * 1000,
		};
		await kv.set(
			await sessionKey(token),
			session,
			{ ttl: GRAPHICS_AUTHOR_SESSION_TTL_SECONDS },
		);
		issueSessionCookie(event, token);
		return session.authorId;
	}
	catch (error) {
		throw graphicsAuthorSessionUnavailable(event, error);
	}
}

/**
 * The asking session's identity when it has one, and nothing when it does not.
 *
 * Session-scoped rights that a caller may simply not have — a Graphics Authoring
 * Lease is one — need to distinguish "no session" from "unauthorized" rather than
 * refuse the request outright.
 */
export async function optionalGraphicsAuthorSession(event: H3Event): Promise<string | undefined> {
	try {
		return (await readSession(event))?.authorId;
	}
	catch {
		return undefined;
	}
}

/**
 * Refuses a caller carrying no Graphics Author Session.
 *
 * **This is attribution, not authentication, and that is a decision rather than an
 * oversight.** A session is anonymous and self-issued: the middleware mints one on
 * any non-`/api/` HTML `GET`, so a caller willing to request a page — any page,
 * including one that does not exist — is admitted afterwards. What this refuses is
 * a caller that never made that request: a bare `curl`, a scanner, a script with no
 * cookie jar. It raises the cost of reaching these routes; it does not prevent it
 * for anyone determined.
 *
 * The application has no authentication yet **by design**, and app-level
 * authentication is planned. Every guard resting on this call — #90's ingestion and
 * lifecycle routes, #116's lifecycle actions, #172's library reads — is therefore
 * the structural seam a real credential strengthens when that lands, rather than a
 * boundary anyone believes is holding today. Resolved on #205; the identity itself
 * is defined in `CONTEXT.md` and its ownership rules in ADR-0003.
 *
 * So: do not read a guarded route as protected, and do not remove a guard on the
 * grounds that it protects nothing. Both readings have been reached before.
 */
export async function requireGraphicsAuthorSession(event: H3Event): Promise<string> {
	try {
		const session = await readSession(event);
		if (session)
			return session.authorId;
	}
	catch (error) {
		throw graphicsAuthorSessionUnavailable(event, error);
	}
	throw createError({
		statusCode: 401,
		statusMessage: 'Unauthorized',
		message: 'An authenticated graphics author session is required',
	});
}
