import { describe, expect, it } from 'vitest';
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
 * The lapse arm comes first and is unconditional, which matters because a `401` from an
 * ingestion route *does* carry a sentence — 'An authenticated graphics author session is
 * required' — and quoting it would tell an author what was missing while leaving out the
 * one thing they can act on.
 */
describe('useGraphicsAuthorSession', () => {
	it('quotes the sentence the library wrote about the refusal rather than the transport line', () => {
		const { describeFailure } = useGraphicsAuthorSession();

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
		const { describeFailure } = useGraphicsAuthorSession();

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
		const { describeFailure } = useGraphicsAuthorSession();

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

	it('names the lapse for a 401, in preference to the sentence that 401 carries', () => {
		const { describeFailure, lapsed } = useGraphicsAuthorSession();

		const said = describeFailure(
			transportFailure({
				status: 401,
				statusText: 'Unauthorized',
				body: { message: 'An authenticated graphics author session is required' },
				request: `[POST] "/api/graphics-assets/ingestion-operations"`,
			}),
			'Graphic Asset upload failed.',
		);

		expect(said).toContain('Your graphics author session has lapsed');
		expect(said).not.toContain('An authenticated graphics author session is required');
		expect(lapsed.value).toBe(true);
	});

	/**
	 * A failure that never reached the server carries nothing the authority wrote, so its
	 * own message is all there is and is the right thing to show. Reading the sentence
	 * first must not disturb that.
	 */
	it('keeps a client-side failure\'s own message, and calls no session lapsed for it', () => {
		const { describeFailure, lapsed } = useGraphicsAuthorSession();

		const said = describeFailure(
			new Error('The chosen file could not be read'),
			'Graphic Asset upload failed.',
		);

		expect(said).toBe('The chosen file could not be read');
		expect(lapsed.value).toBe(false);
	});

	it('falls back to the caller\'s wording for a throw that is not an Error', () => {
		const { describeFailure } = useGraphicsAuthorSession();

		expect(describeFailure('not an error', 'Cancellation failed.')).toBe('Cancellation failed.');
	});
});
