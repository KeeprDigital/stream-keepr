import { describe, expect, it } from 'vitest';
import { StateConflictError } from '~~/server/utils/errors';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';

describe('error-handler mapping logic', () => {
	describe('stateConflictError mapping', () => {
		it('maps to 409 Conflict', () => {
			const error = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new StateConflictError('match', 42),
				unhandled: true,
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
			expect(error.statusMessage).toBe('Conflict');
			expect(error.message).toContain('match 42 state was modified concurrently');
			expect(error.unhandled).toBe(false);
		});
	});

	describe('drizzle unique constraint mapping', () => {
		it('maps UNIQUE constraint failed to 409', () => {
			const error = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new Error('UNIQUE constraint failed: screens.slug'),
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
			expect(error.statusMessage).toBe('Conflict');
			expect(error.message).toBe('Resource already exists');
		});
	});

	describe('zodError mapping', () => {
		it('maps ZodError to 400 Validation Error', () => {
			const zodLikeError = { name: 'ZodError', message: 'Validation failed', issues: [] };
			const error = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: zodLikeError,
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(400);
			expect(error.statusMessage).toBe('Validation Error');
		});
	});

	describe('500 sanitization', () => {
		it('sanitizes 500 errors with a cause', () => {
			const error = {
				statusCode: 500,
				message: 'Sensitive database error details',
				cause: new Error('connection pool exhausted'),
			};
			mapPublicNitroError(error);
			expect(error.message).toBe('Internal Server Error');
			expect(error.statusMessage).toBe('Internal Server Error');
		});

		it('sanitizes explicit 500 errors even when they have no cause', () => {
			const error = {
				statusCode: 500,
				message: 'Encryption key version retired is missing',
			};
			mapPublicNitroError(error);
			expect(error.message).toBe('Internal Server Error');
			expect(error.statusMessage).toBe('Internal Server Error');
		});
	});

	describe('upstream error mapping', () => {
		it('returns a safe 503 when imported card lookup preserved existing data', () => {
			const error = {
				statusCode: 500,
				message: 'Scryfall batch leaked detail',
				cause: { code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE', details: ['private upstream body'] },
			};
			mapPublicNitroError(error);
			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.',
			});
			expect(error.message).not.toContain('private upstream body');
		});

		it('maps Melee timeouts to a safe 504', () => {
			const error = {
				statusCode: 500,
				message: 'socket detail',
				cause: { code: 'MELEE_UPSTREAM_FAILURE', category: 'timeout' },
				unhandled: true,
			};
			mapPublicNitroError(error);
			expect(error).toMatchObject({
				statusCode: 504,
				statusMessage: 'Gateway Timeout',
				message: 'Melee.gg is temporarily unavailable. Try again later.',
				unhandled: false,
			});
		});

		it('maps Scryfall provider failures to a safe 502', () => {
			const error = {
				statusCode: 500,
				message: 'socket detail',
				cause: { code: 'SCRYFALL_UPSTREAM_FAILURE', notFound: false },
			};
			mapPublicNitroError(error);
			expect(error).toMatchObject({
				statusCode: 502,
				statusMessage: 'Bad Gateway',
				message: 'Card data provider is temporarily unavailable. Try again later.',
			});
		});
	});

	describe('priority ordering', () => {
		it('stateConflictError takes precedence over 500 sanitization', () => {
			const error = {
				statusCode: 500,
				message: 'Error',
				cause: new StateConflictError('screen', 1),
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
		});

		it('uNIQUE constraint takes precedence over 500 sanitization', () => {
			const error = {
				statusCode: 500,
				message: 'Error',
				cause: new Error('UNIQUE constraint failed: events.slug'),
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
		});
	});
});
