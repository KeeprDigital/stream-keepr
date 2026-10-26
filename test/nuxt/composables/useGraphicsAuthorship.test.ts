import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * What a refused Library Workspace action says to its author: every catch on that surface
 * routes through `describeFailure` (#350), and a 401 asks them to sign in (#398).
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

	// The browser still believes in the refused session; without a fresh read first,
	// the page gate's "already signed in" arm sends the operator straight back.
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
