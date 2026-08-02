import type { H3Event } from 'h3';
import {
	createError,
	getCookie,
	getRequestURL,
	setCookie,
} from 'h3';
import { kv } from 'hub:kv';

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
 * — so a session rewritten on literally every request would be rewritten several
 * times a second under exactly the load an idle lifetime exists to protect. The
 * grace makes the effective idle window "the TTL, give or take a minute", which
 * is the same guarantee at a write rate the platform will accept.
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
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphics author sessions are temporarily unavailable',
			cause: error,
		});
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

export async function requireGraphicsAuthorSession(event: H3Event): Promise<string> {
	try {
		const session = await readSession(event);
		if (session)
			return session.authorId;
	}
	catch (error) {
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphics author sessions are temporarily unavailable',
			cause: error,
		});
	}
	throw createError({
		statusCode: 401,
		statusMessage: 'Unauthorized',
		message: 'An authenticated graphics author session is required',
	});
}
