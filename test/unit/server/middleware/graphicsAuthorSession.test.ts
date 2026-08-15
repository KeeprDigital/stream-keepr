import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

/**
 * That this middleware cannot answer a request with a refusal.
 *
 * Not a property anyone chose for its own sake — it is the precondition the refusal
 * scan's one narrowing rests on. `test/helpers/routeRefusalScan.ts` scans every
 * middleware as its own entry point, because Nitro composes them around every route,
 * and then stops each middleware's graph at `server/modules/**`: middleware is global,
 * so following it into the domain layer would charge every route with every refusal any
 * service raises. `test/unit/integration/realtimeDiagnosis.test.ts` asserts the
 * narrowing directly (`scan.files` does not contain
 * `server/modules/graphics-author-session.ts`), and names what survives it as "a
 * middleware refusing through the domain layer". `routeRefusalScan.ts`'s own
 * `serverMiddlewareFiles` docblock puts it as the open question: "The residual is a
 * middleware that genuinely refuses through a service; there is none today."
 *
 * This is the one place that could stop being true. The module next door raises a
 * banded 401 from `requireGraphicsAuthorSession`, and this middleware is its neighbour's
 * only middleware-side caller. If the 401 ever escaped here, the realtime diagnosis
 * would meet a refusal in the credential band that the exhaustiveness check cannot see
 * — #268's hole, reopened somewhere no test was looking.
 *
 * So these pin the **property**, not the spelling: whichever entry point the handler
 * reaches for, a refusal from it does not leave. A test that asserted
 * `ensureGraphicsAuthorSession` was the callee would pass a rename and miss the point;
 * a test that asserted the `catch` exists would be reading the source rather than the
 * behaviour. #330(2).
 */

const mockEnsure = vi.fn();
const mockRequire = vi.fn();

vi.mock('~~/server/modules/graphics-author-session', () => ({
	ensureGraphicsAuthorSession: mockEnsure,
	requireGraphicsAuthorSession: mockRequire,
	optionalGraphicsAuthorSession: vi.fn(),
}));

const mockGetRequestHeader = vi.fn();
const mockGetRequestURL = vi.fn();
const mockGetCookie = vi.fn();
const mockSetCookie = vi.fn();
const mockDeleteCookie = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getRequestURL', mockGetRequestURL);
vi.stubGlobal('getCookie', mockGetCookie);
vi.stubGlobal('setCookie', mockSetCookie);
vi.stubGlobal('deleteCookie', mockDeleteCookie);

const handler = (await import('~~/server/middleware/graphics-author-session')).default;

/** A page request: the shape that reaches the session call at all. */
function pageRequest() {
	mockGetRequestURL.mockReturnValue(new URL('https://stream.example/events/1'));
	mockGetRequestHeader.mockReturnValue('text/html,application/xhtml+xml');
	return { method: 'GET' } as never;
}

/** The warn line this middleware writes, named so a stray console call cannot supply it. */
function isSessionIssueFailure(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"graphics_author_session_issue_failed"');
}

/** The 401 `requireGraphicsAuthorSession` raises, as h3 builds it. */
function bandedRefusal() {
	return Object.assign(new Error('An authenticated graphics author session is required'), {
		statusCode: 401,
		statusMessage: 'Unauthorized',
	});
}

describe('the graphics author session middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('lets no refusal out, whichever entry point it reaches for', async () => {
		// Both are armed, so this survives the call switching from one to the other —
		// which is exactly the edit that would otherwise open the hole in silence.
		mockEnsure.mockRejectedValue(bandedRefusal());
		mockRequire.mockRejectedValue(bandedRefusal());

		await expect(handler(pageRequest())).resolves.toBeUndefined();
	});

	it('lets no unreachable-store refusal out either', async () => {
		// The 503 `ensureGraphicsAuthorSession` really does raise (#294). Outside the
		// credential band, so it would not defeat the diagnosis — but a page request
		// answering 503 because a session could not be minted is its own defect, and the
		// swallow is what prevents it.
		mockEnsure.mockRejectedValue(Object.assign(new Error('Graphics author sessions are temporarily unavailable'), {
			statusCode: 503,
		}));

		await expect(handler(pageRequest())).resolves.toBeUndefined();
	});

	it('says which path the session could not be issued for, rather than failing silently', async () => {
		// The swallow is only defensible because it leaves a record. A catch that logged
		// nothing would make a store outage look like nothing at all.
		mockEnsure.mockRejectedValue(bandedRefusal());

		await handler(pageRequest());

		const [line] = lastCallTo(vi.mocked(console.warn), isSessionIssueFailure);
		expect(JSON.parse(line as string)).toEqual({
			message: 'graphics_author_session_issue_failed',
			path: '/events/1',
		});
	});

	it('reaches the session module on the ordinary page request, so the swallow is not hiding a dead path', async () => {
		// The negative control for the three above: they would all pass on a middleware
		// that had stopped calling anything at all. Counted across both entry points on
		// purpose — pinning `ensure` specifically would fail on the require-vs-ensure
		// switch, which is an edit that does *not* open the hole and must not read as
		// though it did.
		mockEnsure.mockResolvedValue('an-author-id');
		mockRequire.mockResolvedValue('an-author-id');

		await handler(pageRequest());

		expect(mockEnsure.mock.calls.length + mockRequire.mock.calls.length).toBe(1);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('marks a failed issue where the page can read it, since the swallow hides it from the response', async () => {
		// #206(2): the served page's session cookie is httpOnly, so this readable
		// marker is the only way the Library Workspace can tell "never issued a
		// session" from "session lapsed" — the first is not healed by the reload
		// the lapse notice prescribes.
		mockEnsure.mockRejectedValue(bandedRefusal());

		await handler(pageRequest());

		expect(mockSetCookie).toHaveBeenCalledWith(
			expect.anything(),
			'stream_keepr_graphics_author_session_issue_failed',
			'1',
			expect.objectContaining({ httpOnly: false }),
		);
	});

	it('withdraws the marker once a session is issued again, and only then', async () => {
		// A recovered store must stop claiming failure, and the ordinary
		// navigation — which never failed — must not write a header at all.
		mockEnsure.mockResolvedValue('an-author-id');

		mockGetCookie.mockReturnValue('1');
		await handler(pageRequest());
		expect(mockDeleteCookie).toHaveBeenCalledWith(
			expect.anything(),
			'stream_keepr_graphics_author_session_issue_failed',
			expect.anything(),
		);

		mockDeleteCookie.mockClear();
		mockSetCookie.mockClear();
		mockGetCookie.mockReturnValue(undefined);
		await handler(pageRequest());
		expect(mockDeleteCookie).not.toHaveBeenCalled();
		expect(mockSetCookie).not.toHaveBeenCalled();
	});

	it('does not reach the session call for an API request', async () => {
		mockGetRequestURL.mockReturnValue(new URL('https://stream.example/api/graphics-assets'));
		mockGetRequestHeader.mockReturnValue('text/html');

		await handler({ method: 'GET' } as never);

		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('does not reach the session call for a request that is not asking for a page', async () => {
		mockGetRequestURL.mockReturnValue(new URL('https://stream.example/events/1'));
		mockGetRequestHeader.mockReturnValue('application/json');

		await handler({ method: 'GET' } as never);

		expect(mockEnsure).not.toHaveBeenCalled();
	});
});
