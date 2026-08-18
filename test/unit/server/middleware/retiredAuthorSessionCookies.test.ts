import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

/**
 * The cutover's cookie hygiene (#398, ADR-0010).
 *
 * Two things are worth pinning about a middleware whose whole job is to forget
 * something. That it expires **both** retired names, because the second one — the
 * issue-failed marker — is the easy one to leave behind: it was written only on a
 * failed mint, so a browser that never met a session-store outage does not carry
 * it and a hand test would not notice. And that it writes nothing for a request
 * that presents neither, because this runs in front of every route in the
 * application and a `Set-Cookie` on every response for the life of the
 * installation is a worse residue than the cookies it is clearing.
 */

const mockGetCookie = vi.fn();
const mockDeleteCookie = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getCookie', mockGetCookie);
vi.stubGlobal('deleteCookie', mockDeleteCookie);

const handler = (await import('~~/server/middleware/retired-author-session-cookies')).default;

const SESSION_COOKIE = 'stream_keepr_graphics_author_session';
const ISSUE_FAILED_COOKIE = 'stream_keepr_graphics_author_session_issue_failed';

/** A request presenting exactly the named cookies. */
function requestCarrying(...cookies: string[]) {
	mockGetCookie.mockImplementation((_event, name: string) => cookies.includes(name) ? '1' : undefined);
	return stubH3Event();
}

describe('the retired author-session cookies', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('expires the session cookie a pre-cutover browser is still sending', () => {
		handler(requestCarrying(SESSION_COOKIE));

		expect(mockDeleteCookie).toHaveBeenCalledWith(expect.anything(), SESSION_COOKIE, { path: '/' });
	});

	it('expires the issue-failed marker too, which nothing else would ever clear', () => {
		// The middleware that used to remove it on a successful mint is gone, so
		// without this a browser that met one session-store outage keeps the marker
		// forever.
		handler(requestCarrying(ISSUE_FAILED_COOKIE));

		expect(mockDeleteCookie).toHaveBeenCalledWith(expect.anything(), ISSUE_FAILED_COOKIE, { path: '/' });
	});

	it('writes nothing for a browser that holds neither', () => {
		handler(requestCarrying());

		expect(mockDeleteCookie).not.toHaveBeenCalled();
	});

	it('refuses nothing, because it is composed around every route there is', () => {
		// The property the refusal scan's narrowing rests on: a middleware's graph
		// stops at `server/modules/**`, so a refusal raised here would be one every
		// route inherits and no exhaustiveness check could see.
		expect(() => handler(requestCarrying(SESSION_COOKIE, ISSUE_FAILED_COOKIE))).not.toThrow();
	});
});
