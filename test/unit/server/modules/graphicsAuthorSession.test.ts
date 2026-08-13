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
	// Nothing here calls it. The module reaches `server/utils/errors` for the error
	// class an unreachable session store raises, and that module imports it.
	isError: (candidate: unknown) => candidate instanceof Error,
	setCookie: mockSetCookie,
}));

const {
	ensureGraphicsAuthorSession,
	optionalGraphicsAuthorSession,
	requireGraphicsAuthorSession,
} = await import('~~/server/modules/graphics-author-session');
const { GraphicsAuthorSessionUnavailableError } = await import('~~/server/utils/errors');
const { mapPublicNitroError } = await import('~~/server/utils/nitroErrorMapping');

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

	/**
	 * The cookie is the browser's copy of a fact the library owns, so it may never
	 * be written first. A cookie promising eight hours against a KV entry that was
	 * never extended is a session the browser keeps presenting and the library has
	 * already forgotten — the author would be logged out at the old expiry while
	 * still holding a cookie that says otherwise, which is the divergence the
	 * ordering exists to prevent.
	 */
	it('does not tell the browser it lasts longer than the library believes', async () => {
		mockKv.get.mockResolvedValue(storedSession(7 * 60 * 60));
		mockKv.set.mockRejectedValue(new Error('KV is unavailable'));

		await requireGraphicsAuthorSession(event);

		expect(mockSetCookie).not.toHaveBeenCalled();
	});

	/**
	 * What the grace is allowed to cost, pinned as a number rather than left to a
	 * constant nobody reads. Raising it silently degrades the guarantee: at an hour
	 * the promise quietly becomes "seven to eight hours from your last request",
	 * and every other test in this file would still pass.
	 */
	it('is carried forward by a request one grace-width after the last write', async () => {
		mockKv.get.mockResolvedValue(storedSession(REFRESH_AFTER_SECONDS + 1));

		await requireGraphicsAuthorSession(event);

		expect(mockKv.set).toHaveBeenCalledOnce();
	});
});

/**
 * What a caller is told when the store the session lives in cannot be reached.
 *
 * The sentence is written for an operator — it says sessions are unavailable, not
 * that the server broke — and it only reaches one because the refusal names the
 * failure it is. #294: both sites used to hand `mapPublicNitroError` whatever
 * `kv.get` threw, and a raw store exception matches no branch there, so the
 * sanitizer replaced the whole thing with 'Internal Server Error'.
 */
describe('a graphics author session whose store cannot be reached', () => {
	const storeFailure = new Error('KV GET failed');

	it('refuses a guarded request with a sentence the mapper keeps', async () => {
		mockKv.get.mockRejectedValue(storeFailure);

		const refusal = await requireGraphicsAuthorSession(event).catch((error: unknown) => error);

		expect(refusal).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphics author sessions are temporarily unavailable',
		});
		expect((refusal as { cause?: unknown }).cause).toBeInstanceOf(GraphicsAuthorSessionUnavailableError);
	});

	it('refuses the minting of a session the same way', async () => {
		// The site the ticket did not name. A page navigation mints sessions through
		// here, so a store that is down would otherwise answer 'Internal Server
		// Error' on the very first request an author makes.
		mockKv.get.mockRejectedValue(storeFailure);

		const refusal = await ensureGraphicsAuthorSession(event).catch((error: unknown) => error);

		expect(refusal).toMatchObject({
			statusCode: 503,
			message: 'Graphics author sessions are temporarily unavailable',
		});
		expect((refusal as { cause?: unknown }).cause).toBeInstanceOf(GraphicsAuthorSessionUnavailableError);
	});

	it('keeps the store\'s own account of the failure for the log', async () => {
		// The response says which subsystem is unavailable and no more; the
		// exception the store raised stays reachable behind it, which is what the
		// error plugin logs.
		mockKv.get.mockRejectedValue(storeFailure);

		const refusal = await requireGraphicsAuthorSession(event).catch((error: unknown) => error);

		expect((refusal as { cause: Error }).cause.cause).toBe(storeFailure);
	});

	it('reaches the caller with its sentence intact once the mapper has run', async () => {
		// The two halves together: raising a named error is only worth anything if
		// the mapper spares it, and sparing it is only reachable if the throw site
		// raises one. Either half reverted and this row fails.
		mockKv.get.mockRejectedValue(storeFailure);

		const refusal = await requireGraphicsAuthorSession(event).catch((error: unknown) => error);
		mapPublicNitroError(refusal as Parameters<typeof mapPublicNitroError>[0]);

		expect(refusal).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphics author sessions are temporarily unavailable',
			unhandled: false,
		});
	});

	it('is still no reason to refuse a request that only asked in passing', async () => {
		// Unchanged by #294. A caller with no session-scoped right at stake gets no
		// identity rather than a refusal, and a store that is down is one way to
		// have no identity.
		mockKv.get.mockRejectedValue(storeFailure);

		await expect(optionalGraphicsAuthorSession(event)).resolves.toBeUndefined();
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
