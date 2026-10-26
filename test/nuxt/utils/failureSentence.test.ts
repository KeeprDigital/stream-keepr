import { describe, expect, it } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';

/**
 * Which failures may be quoted. Below 500 the authority answered this request; a 5xx
 * is quoted only when the server deliberately preserved its prose through
 * `mapPublicNitroError` (#286, #294). This suite is the home of that rule; every
 * surface that reports failures has one routing test of its own.
 */
describe('failureSentence', () => {
	const MISSING_SETTING
		= 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not 32-byte base64, '
			+ 'so Screen Output asset capabilities are unavailable';

	describe('a 5xx whose prose the server preserved', () => {
		it.each([
			['a setting a 503 says was never configured', 503, MISSING_SETTING],
			['the dependency a 502 names', 502, 'Melee.gg is temporarily unavailable. Try again later.'],
			['the store a 503 could not reach', 503, 'Graphics Asset catalogue is unavailable'],
			['an exhausted byte store\'s 507', 507, 'Canonical byte store capacity is exhausted'],
		])('quotes %s', (_, status, message) => {
			const failure = transportFailure({
				status,
				body: { statusCode: status, message },
			});

			expect(failureSentence(failure)).toBe(message);
			expect(isSanitizedFailure(failure)).toBe(false);
		});

		// `useFetch` errors are rebuilt by `createError` around `statusCode`; `status` may not survive.
		it('reads a useFetch failure, which createError rebuilds around statusCode', () => {
			const wrapped = createError(transportFailure({
				status: 503,
				body: { message: MISSING_SETTING },
			}));

			expect(wrapped.statusCode).toBe(503);
			expect(failureSentence(wrapped)).toBe(MISSING_SETTING);
		});

		it('reads a failure carrying statusCode and no status at all', () => {
			const rebuilt = Object.assign(new Error('503 Service Unavailable'), {
				statusCode: 503,
				data: { message: MISSING_SETTING },
			});

			expect(failureSentence(rebuilt)).toBe(MISSING_SETTING);
		});
	});

	describe('a 5xx the sanitizer got to, or that carries nothing to quote', () => {
		it.each([
			[
				'the mapper placeholder, even at a status the mapper also uses',
				{
					status: 503,
					body: { message: 'Internal Server Error' },
				},
			],
			[
				'Nitro\'s own mask on an unhandled failure',
				{
					status: 502,
					body: { message: 'Server Error' },
				},
			],
			[
				'a 500 body that reads like prose, since a 500 is this server breaking',
				{
					status: 500,
					body: { message: 'D1_ERROR: no such table: rounds' },
				},
			],
			[
				'a 5xx with no body',
				{ status: 503 },
			],
			[
				'a 5xx whose body is not a record',
				{ status: 503, body: '<!DOCTYPE html><title>503 Service Unavailable</title>' },
			],
			[
				'an empty sentence',
				{
					status: 503,
					body: { message: '' },
				},
			],
		])('refuses %s', (_, response) => {
			expect(failureSentence(transportFailure(response as Parameters<typeof transportFailure>[0]))).toBeUndefined();
		});

		it('names a sanitized failure as sanitized', () => {
			expect(isSanitizedFailure(transportFailure({
				status: 500,
				body: { message: 'D1_ERROR' },
			}))).toBe(true);
		});
	});

	describe('below the 5xx boundary', () => {
		it.each([
			['a refusal the authority wrote about this request', 403, 'This Event belongs to another installation'],
			['a 499, since the boundary is 500', 499, 'The operator navigated away'],
		])('quotes %s', (_, status, message) => {
			expect(failureSentence(transportFailure({
				status,
				body: { message },
			}))).toBe(message);
		});

		it('declines a failure that never reached the server, whatever it carries', () => {
			const unsent = Object.assign(new Error('Failed to fetch'), {
				data: { message: 'a body nobody wrote' },
			});

			expect(failureSentence(unsent)).toBeUndefined();
			expect(isSanitizedFailure(unsent)).toBe(false);
		});
	});
});

/** The one line a surface shows: the authority's sentence, else the failure's own line, else the caller's wording (#299). */
describe('reportedMessage', () => {
	it('prefers the sentence the authority wrote over the transport line', () => {
		const refused = transportFailure({
			status: 403,
			body: { message: 'An authenticated graphics author session is required' },
			request: `[GET] "/api/graphics-assets"`,
		});

		expect(reportedMessage(refused, 'a fallback nobody should see'))
			.toBe('An authenticated graphics author session is required');
	});

	// A status line reads as machinery; static wording in its place would hide a real line (#245).
	it('falls back to the transport line, not the caller\'s wording, when the sanitizer wrote the body', () => {
		const sanitized = transportFailure({
			status: 500,
			body: { message: 'Internal Server Error' },
			request: `[GET] "/api/graphics-assets"`,
		});

		expect(reportedMessage(sanitized, 'a fallback nobody should see'))
			.toBe(`[GET] "/api/graphics-assets": 500 Internal Server Error`);
	});

	it('uses the caller\'s wording only for a throw carrying no line at all', () => {
		expect(reportedMessage('a bare string nobody wrapped', 'The style update could not be applied'))
			.toBe('The style update could not be applied');
	});

	it('answers nothing for an absent failure', () => {
		expect(reportedMessage(undefined)).toBeUndefined();
		expect(reportedMessage(null)).toBeUndefined();
	});
});
