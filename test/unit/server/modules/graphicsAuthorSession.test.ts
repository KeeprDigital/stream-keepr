import type { H3Event } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * How long a graphics author session survives, and what keeps it alive.
 *
 * A graphics author session is the only identity a Graphics Ingestion Operation
 * has, so the moment it lapses every operation it started stops existing for the
 * person who started it. That makes its lifetime a product guarantee rather than
 * a storage detail, and the guarantee is stated in seconds here so it cannot
 * drift silently: **eight hours from the last request the session made**, not
 * eight hours from the moment it was minted.
 *
 * The distinction is the whole point. An absolute lifetime expires an author who
 * is actively uploading; an idle lifetime cannot, because a transfer in progress
 * is itself a request. See ADR-0003.
 */

const mockKv = {
	get: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
};
const mockGetCookie = vi.fn();
const mockSetCookie = vi.fn();

vi.mock('hub:kv', () => ({ kv: mockKv }));
vi.mock('h3', () => ({
	createError: (input: { statusCode: number; statusMessage: string; message: string }) =>
		Object.assign(new Error(input.message), input),
	getCookie: mockGetCookie,
	getRequestURL: () => new URL('https://stream.example/api/graphics-assets/ingestion-operations'),
	setCookie: mockSetCookie,
}));

const {
	ensureGraphicsAuthorSession,
	optionalGraphicsAuthorSession,
	requireGraphicsAuthorSession,
} = await import('~~/server/modules/graphics-author-session');

/** Eight hours, in the seconds the cookie and the KV entry are both written in. */
const TTL_SECONDS = 8 * 60 * 60;
/** How stale a session's recorded life may be before a request rewrites it. */
const REFRESH_AFTER_SECONDS = 60;

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const COOKIE_NAME = 'stream_keepr_graphics_author_session';
const TOKEN = 'a-token-the-browser-is-already-carrying';
const AUTHOR_ID = 'f2b1c4d6-9a83-4e17-8b5c-2d7e6a091f34';

const event = {} as H3Event;

/** The single KV key the module derives from `TOKEN`, computed the same way. */
async function storedKey() {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN));
	const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
	return `graphics-author-session:${hex}`;
}

/** A live session whose recorded life was last written `agoSeconds` ago. */
function storedSession(agoSeconds: number) {
	return { authorId: AUTHOR_ID, expiresAt: NOW + (TTL_SECONDS - agoSeconds) * 1000 };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	mockKv.get.mockReset();
	mockKv.set.mockReset();
	mockKv.del.mockReset();
	mockGetCookie.mockReset();
	mockSetCookie.mockReset();
	mockGetCookie.mockReturnValue(TOKEN);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a graphics author session that is still being used', () => {
	it('is carried forward a further eight hours by the request that used it', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));

		await expect(requireGraphicsAuthorSession(event)).resolves.toBe(AUTHOR_ID);

		expect(mockKv.set).toHaveBeenCalledWith(
			await storedKey(),
			{ authorId: AUTHOR_ID, expiresAt: NOW + TTL_SECONDS * 1000 },
			{ ttl: TTL_SECONDS },
		);
	});

	it('keeps the browser carrying the same session for as long as the library does', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));

		await requireGraphicsAuthorSession(event);

		expect(mockSetCookie).toHaveBeenCalledWith(
			event,
			COOKIE_NAME,
			TOKEN,
			expect.objectContaining({ maxAge: TTL_SECONDS, httpOnly: true, path: '/' }),
		);
	});

	it('keeps its author identity, so the operations it started stay its own', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));

		await requireGraphicsAuthorSession(event);

		expect(mockKv.set.mock.calls[0]?.[1]).toMatchObject({ authorId: AUTHOR_ID });
	});

	it('is carried forward by an unauthenticated reading of it too', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));

		await expect(optionalGraphicsAuthorSession(event)).resolves.toBe(AUTHOR_ID);

		expect(mockKv.set).toHaveBeenCalledOnce();
	});

	it('is carried forward by an ordinary page navigation rather than left to run down', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));

		await expect(ensureGraphicsAuthorSession(event)).resolves.toBe(AUTHOR_ID);

		expect(mockKv.set).toHaveBeenCalledOnce();
		expect(mockKv.set.mock.calls[0]?.[1]).toMatchObject({ authorId: AUTHOR_ID });
	});

	/**
	 * A resumable transfer sends a request per part, so rewriting the session on
	 * every one would cost a durable write per part for no added life. Within the
	 * grace the session is already worth what a rewrite would make it worth.
	 */
	it('is not rewritten again by the requests that immediately follow', async () => {
		mockKv.get.mockResolvedValue(storedSession(REFRESH_AFTER_SECONDS - 1));

		await requireGraphicsAuthorSession(event);

		expect(mockKv.set).not.toHaveBeenCalled();
		expect(mockSetCookie).not.toHaveBeenCalled();
	});

	/**
	 * Failing to extend a session is not a reason to refuse the request that was
	 * extending it. The caller still holds a live session; declining to slide it
	 * costs at most the life the next request would have added.
	 */
	it('answers the request even when its life could not be written down', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));
		mockKv.set.mockRejectedValue(new Error('KV is unavailable'));

		await expect(requireGraphicsAuthorSession(event)).resolves.toBe(AUTHOR_ID);
	});
});

describe('a graphics author session that has lapsed', () => {
	it('is refused as unauthorized rather than silently reissued', async () => {
		mockKv.get.mockResolvedValue({ authorId: AUTHOR_ID, expiresAt: NOW - 1 });

		await expect(requireGraphicsAuthorSession(event)).rejects.toMatchObject({ statusCode: 401 });
		expect(mockKv.set).not.toHaveBeenCalled();
	});

	it('leaves nothing behind for its token to name', async () => {
		mockKv.get.mockResolvedValue({ authorId: AUTHOR_ID, expiresAt: NOW - 1 });

		await expect(requireGraphicsAuthorSession(event)).rejects.toMatchObject({ statusCode: 401 });
		expect(mockKv.del).toHaveBeenCalledWith(await storedKey());
	});

	/**
	 * The state an author is actually in after expiry: the browser still carries a
	 * cookie, and nothing answers to it. A navigation mints a new session — and a
	 * new author, which is why ADR-0003 exists.
	 */
	it('is replaced by a new session, and a new author, on the next navigation', async () => {
		mockKv.get.mockResolvedValue(undefined);

		const authorId = await ensureGraphicsAuthorSession(event);

		expect(authorId).not.toBe(AUTHOR_ID);
		expect(mockSetCookie).toHaveBeenCalledWith(
			event,
			COOKIE_NAME,
			expect.not.stringContaining(TOKEN),
			expect.objectContaining({ maxAge: TTL_SECONDS }),
		);
	});
});
