import type { H3Event } from 'h3';
import {
	createError,
	getCookie,
	getRequestURL,
	setCookie,
} from 'h3';
import { kv } from 'hub:kv';

const GRAPHICS_AUTHOR_SESSION_COOKIE = 'stream_keepr_graphics_author_session';
const GRAPHICS_AUTHOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

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
		setCookie(event, GRAPHICS_AUTHOR_SESSION_COOKIE, token, {
			httpOnly: true,
			maxAge: GRAPHICS_AUTHOR_SESSION_TTL_SECONDS,
			path: '/',
			sameSite: 'strict',
			secure: getRequestURL(event).protocol === 'https:',
		});
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
