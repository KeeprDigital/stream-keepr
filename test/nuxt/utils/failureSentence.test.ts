import { describe, expect, it } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * Which failures may be quoted, at the one boundary the whole application asks.
 *
 * The rule up to #271 was a status boundary and nothing else: below 500 the server was
 * answering *this* request and its words could be shown, at or above it the server was
 * failing and `mapPublicNitroError` had already replaced its words with a placeholder.
 * #286 is the exclusion that rule was missing. Some 5xx bodies are deliberately spared
 * the sanitizer — a missing setting (#233), an unwired component (#243), an exhausted
 * byte store, a named dependency that is down — and those are the only 5xx an operator
 * can act on, so refusing them suppressed exactly the messages the server went to the
 * trouble of preserving.
 *
 * The shapes below are the ones the running server produces, not invented ones. Driving
 * `GET /api/events/1/screens/1/asset-capability` against a `nuxt dev` whose signing key
 * is invalid answers a `FetchError` with `statusCode` 503, `statusText`
 * 'Service Unavailable', and a body whose `message` names the setting; every other 5xx
 * that server could be provoked into carried 'Internal Server Error' in that field.
 */
describe('failureSentence', () => {
	const MISSING_SETTING
		= 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not 32-byte base64, '
			+ 'so Screen Output asset capabilities are unavailable';

	describe('a 5xx whose prose the server preserved', () => {
		it('quotes the setting a 503 says was never configured', () => {
			const failure = transportFailure({
				status: 503,
				body: { error: true, statusCode: 503, statusMessage: 'Service Unavailable', message: MISSING_SETTING },
				request: `[GET] "/api/events/1/screens/1/asset-capability"`,
			});

			expect(failureSentence(failure)).toBe(MISSING_SETTING);
			expect(isSanitizedFailure(failure)).toBe(false);
		});

		it('quotes the component a 503 says was assembled without its collaborator', () => {
			const wiring = 'The Broadcast Graphics Live Session module was constructed without '
				+ 'the Graphics Asset Library. This is a defect in how the server was assembled, '
				+ 'not a setting that can be changed.';

			expect(failureSentence(transportFailure({
				status: 503,
				body: { message: wiring },
			}))).toBe(wiring);
		});

		it('quotes the dependency a 502 names', () => {
			expect(failureSentence(transportFailure({
				status: 502,
				statusText: 'Bad Gateway',
				body: { message: 'Melee.gg is temporarily unavailable. Try again later.' },
			}))).toBe('Melee.gg is temporarily unavailable. Try again later.');
		});

		it('quotes an exhausted byte store, whose 507 is nowhere near the boundary', () => {
			expect(failureSentence(transportFailure({
				status: 507,
				statusText: 'Insufficient Storage',
				body: { message: 'Canonical byte store capacity is exhausted' },
			}))).toBe('Canonical byte store capacity is exhausted');
		});

		/**
		 * The shape the three Graphics Administrator surfaces actually get, since they
		 * read `useFetch`'s `error` rather than catching one: `useAsyncData` re-wraps
		 * whatever it caught in `createError`, which rebuilds it as an `H3Error` whose own
		 * properties are `statusCode` and `data`. Whether `status` survives that depends
		 * on which h3 build answers the import — imported from `@nuxt/nitro-server/h3` in
		 * a bare node process it does not — so the row below asserts only `statusCode`,
		 * and the row after it is the reason `failureStatus` reads `statusCode` first.
		 */
		it('reads a useFetch failure, which createError rebuilds around statusCode', () => {
			const wrapped = createError(transportFailure({
				status: 503,
				body: { message: MISSING_SETTING },
			}));

			expect(wrapped.statusCode).toBe(503);
			expect(failureSentence(wrapped)).toBe(MISSING_SETTING);
		});

		it('reads a failure carrying statusCode and no status at all', () => {
			const rebuilt = Object.assign(
				new Error(`[GET] "/api/events/1/screens/1/asset-capability": 503 Service Unavailable`),
				{ statusCode: 503, data: { message: MISSING_SETTING } },
			);

			expect((rebuilt as { status?: number }).status).toBeUndefined();
			expect(failureSentence(rebuilt)).toBe(MISSING_SETTING);
		});
	});

	describe('a 5xx the sanitizer got to', () => {
		/**
		 * The two sentences that mean the server has decided to say nothing:
		 * `mapPublicNitroError` writes the first over any 5xx it did not map, and Nitro's
		 * own handler writes the second into the body of anything unhandled or fatal.
		 * A 503 is not evidence of a preserved message — `requireGraphicsAuthorSession`
		 * raises one whose cause matches no branch, and so does an unavailable Graphics
		 * Asset Library.
		 */
		it('refuses the mapper placeholder even at a status the mapper also uses', () => {
			const failure = transportFailure({
				status: 503,
				body: { message: 'Internal Server Error' },
				request: `[GET] "/api/graphics-assets"`,
			});

			expect(failureSentence(failure)).toBeUndefined();
			expect(isSanitizedFailure(failure)).toBe(true);
		});

		it('refuses Nitro own mask on an unhandled failure', () => {
			expect(failureSentence(transportFailure({
				status: 502,
				body: { message: 'Server Error' },
			}))).toBeUndefined();
		});

		/**
		 * 500 stays refused whatever the body says, and that is a decision rather than an
		 * omission: 500 means this server broke, which is the case where nothing it
		 * carries may be quoted, and no preserved family is raised there — every one of
		 * them is a 502, 503, 504 or 507.
		 */
		it('refuses a 500 body that reads like prose', () => {
			const failure = transportFailure({
				status: 500,
				body: { message: 'D1_ERROR: no such table: rounds' },
				request: `[POST] "/api/events/1/rounds"`,
			});

			expect(failureSentence(failure)).toBeUndefined();
			expect(isSanitizedFailure(failure)).toBe(true);
		});

		it('refuses a 5xx that wrote no body at all', () => {
			expect(failureSentence(transportFailure({ status: 503 }))).toBeUndefined();
		});

		it('refuses a 5xx whose body is not a record', () => {
			expect(failureSentence(transportFailure({
				status: 503,
				body: '<!DOCTYPE html><title>503 Service Unavailable</title>',
			}))).toBeUndefined();
		});

		it('refuses a preserved-looking body that is empty', () => {
			expect(failureSentence(transportFailure({
				status: 503,
				body: { message: '' },
			}))).toBeUndefined();
		});
	});

	describe('what the exclusion did not change', () => {
		it('still quotes a refusal the authority wrote about this request', () => {
			expect(failureSentence(transportFailure({
				status: 403,
				body: { message: 'This Event belongs to another installation' },
			}))).toBe('This Event belongs to another installation');
		});

		it('still declines a failure that never reached the server', () => {
			const unsent = Object.assign(new Error('Failed to fetch'), {
				data: { message: 'a body nobody wrote' },
			});

			expect(failureSentence(unsent)).toBeUndefined();
			expect(isSanitizedFailure(unsent)).toBe(false);
		});

		it('still reads the boundary at 500, not above it', () => {
			expect(failureSentence(transportFailure({
				status: 499,
				statusText: 'Client Closed Request',
				body: { message: 'The operator navigated away' },
			}))).toBe('The operator navigated away');
		});
	});
});
