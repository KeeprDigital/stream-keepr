import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * What a refused Library Workspace action says to the author who provoked it.
 *
 * Every catch on that surface routes through `describeFailure`, so what it reaches for is
 * what an author is shown for a lifecycle action, a metadata save, a replacement, an
 * upload, a retry, a cancellation, an approved remote copy, a staged-source confirmation
 * and a reconnect — nine catches, one answer. It reached for `Error.message`, which on a
 * `$fetch` failure is the transport's line: method, URL and status, and never the sentence
 * the route wrote about what it refused (#350).
 *
 * The signed-out arm comes first and is unconditional, which matters because a `401` from
 * an ingestion route *does* carry a sentence — the boundary's 'Authentication is required'
 * — and quoting it would tell an author what was missing while leaving out the one thing
 * they can act on. Since #398 that thing is signing in, not reloading: a reload used to
 * mint a fresh anonymous author, and nothing is minted any more.
 */

const { mockLoad, mockNavigateTo, mockRoute } = vi.hoisted(() => ({
	mockLoad: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockRoute: { fullPath: '/graphics-assets' },
}));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ load: mockLoad }),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useRoute', () => () => mockRoute);

describe('useGraphicsAuthorship', () => {
	beforeEach(() => {
		mockLoad.mockReset().mockResolvedValue('signed-out');
		mockNavigateTo.mockReset();
	});

	it('quotes the sentence the library wrote about the refusal rather than the transport line', () => {
		const { describeFailure } = useGraphicsAuthorship();

		const said = describeFailure(
			transportFailure({
				status: 409,
				body: { message: 'A Graphic Asset Revision is in use and cannot enter Trash' },
				request: `[POST] "/api/graphics-assets/asset-1/lifecycle-actions"`,
			}),
			'Graphic Asset lifecycle action failed.',
		);

		expect(said).toBe('A Graphic Asset Revision is in use and cannot enter Trash');
	});

	/**
	 * The 5xx half of #286: a named dependency being down is a deployment fault an
	 * operator can act on, so the mapper preserves its prose rather than sanitizing it,
	 * and this surface is one of the places that prose was going unread.
	 */
	it('quotes a 5xx sentence the server deliberately kept', () => {
		const { describeFailure } = useGraphicsAuthorship();

		const said = describeFailure(
			transportFailure({
				status: 503,
				body: { message: 'The Graphics Asset Library store is unavailable' },
				request: `[POST] "/api/graphics-assets/ingestion-operations"`,
			}),
			'Graphic Asset upload failed.',
		);

		expect(said).toBe('The Graphics Asset Library store is unavailable');
	});

	it('falls back to the transport line when the sanitizer got to the 5xx first', () => {
		const { describeFailure } = useGraphicsAuthorship();

		const said = describeFailure(
			transportFailure({
				status: 503,
				body: { message: 'Internal Server Error' },
				request: `[POST] "/api/graphics-assets/ingestion-operations"`,
			}),
			'Graphic Asset upload failed.',
		);

		expect(said)
			.toBe('[POST] "/api/graphics-assets/ingestion-operations": 503 Service Unavailable');
	});

	it('names the ended session for a 401, in preference to the sentence that 401 carries', () => {
		const { describeFailure, signedOut } = useGraphicsAuthorship();

		const said = describeFailure(
			transportFailure({
				status: 401,
				statusText: 'Unauthorized',
				body: { message: 'Authentication is required' },
				request: `[POST] "/api/graphics-assets/ingestion-operations"`,
			}),
			'Graphic Asset upload failed.',
		);

		expect(said).toContain('This browser is no longer signed in');
		expect(said).toContain('Sign in again');
		expect(said).not.toContain('Authentication is required');
		expect(signedOut.value).toBe(true);
	});

	/**
	 * A failure that never reached the server carries nothing the authority wrote, so its
	 * own message is all there is and is the right thing to show. Reading the sentence
	 * first must not disturb that.
	 */
	it('keeps a client-side failure\'s own message, and calls nobody signed out for it', () => {
		const { describeFailure, signedOut } = useGraphicsAuthorship();

		const said = describeFailure(
			new Error('The chosen file could not be read'),
			'Graphic Asset upload failed.',
		);

		expect(said).toBe('The chosen file could not be read');
		expect(signedOut.value).toBe(false);
	});

	it('falls back to the caller\'s wording for a throw that is not an Error', () => {
		const { describeFailure } = useGraphicsAuthorship();

		expect(describeFailure('not an error', 'Cancellation failed.')).toBe('Cancellation failed.');
	});

	/**
	 * The trip to the login page, and the read that has to happen before it.
	 *
	 * `ensure()` treats `signed-in` as settled and never re-asks, so at the moment a
	 * 401 arrives the browser still believes in the session the server has just
	 * refused. Navigating with that belief intact puts the operator in front of the
	 * page gate's "already signed in" arm, which sends them straight back to the page
	 * that refused them — a loop, not a sign-in. The unconditional read is what
	 * replaces the stale answer, so it is pinned as an order rather than as two calls.
	 */
	it('asks the server who this browser is before sending it to sign in', async () => {
		const order: string[] = [];
		mockLoad.mockImplementation(async () => {
			order.push('load');
			return 'signed-out';
		});
		mockNavigateTo.mockImplementation(() => {
			order.push('navigate');
		});

		await useGraphicsAuthorship().signIn();

		expect(order).toEqual(['load', 'navigate']);
	});

	it('carries the page the operator was on, so signing in returns them to it', async () => {
		await useGraphicsAuthorship().signIn();

		expect(mockNavigateTo).toHaveBeenCalledWith('/login?redirect=%2Fgraphics-assets');
	});
});
