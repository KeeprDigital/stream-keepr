import type { LoggedNitroError } from '~~/server/utils/errorLogFields';
import type { MappableNitroError } from '~~/server/utils/nitroErrorMapping';
import { describe, expect, it } from 'vitest';
import { errorLogFields } from '~~/server/utils/errorLogFields';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import { ServiceConfigurationError, ServiceWiringError, StateConflictError } from '~~/server/utils/errors';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { REALTIME_PUBLISH_FAILED_MESSAGE, RealtimePublishError } from '~~/server/utils/realtimePublishFailure';
import { ErrorInfoShaped, providerRefusal } from '~~/test/helpers/providerRefusal';

describe('error-handler mapping logic', () => {
	describe('log path safety', () => {
		it('redacts Screen Output asset delivery identities and query parameters', () => {
			expect(safeErrorLogPath(
				'/api/screen-output/screens/17/assets/asset-secret/revisions/revision-secret/content?debug=1',
			)).toBe('/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content');
		});

		it('preserves unrelated paths', () => {
			expect(safeErrorLogPath('/api/events/17')).toBe('/api/events/17');
		});
	});

	describe('the fields a failed request logs', () => {
		function failed(overrides: Partial<LoggedNitroError>): LoggedNitroError {
			return { name: 'Error', statusCode: 500, ...overrides };
		}

		it('carries a provider code that arrives as a number', () => {
			// #264, the whole of it: Ably's `ErrorInfo.code` is 40400, a number, and
			// the string-only guard this replaces logged `null` for precisely the
			// failure the field exists to name. A rejected key then spent an outbound
			// request per Screen mutation with nothing in the log to say why.
			expect(errorLogFields(failed({ cause: providerRefusal() }), '/api/events/1')).toMatchObject({
				// A genuine `ErrorInfo` never assigns `name`, so the sibling field
				// reports the inherited 'Error' and identifies nothing. The code is the
				// only thing in the line that can name the refusal.
				errorName: 'Error',
				errorCode: 40400,
			});
		});

		it('still carries a provider code that arrives as a string', () => {
			// Node's own convention, and the shape the previous guard was written for.
			expect(errorLogFields(failed({ cause: { name: 'SystemError', code: 'ENOENT' } }), '/api/events/1'))
				.toMatchObject({ errorName: 'SystemError', errorCode: 'ENOENT' });
		});

		it('reports a NaN code as absent rather than as a number', () => {
			// The Ably transport builds `Number(headers['x-ably-errorcode'])` for a
			// response carrying no Ably error body, so NaN is a shape that reaches
			// here. #253 guards the same value the same way in the publish log.
			expect(errorLogFields(failed({ cause: new ErrorInfoShaped('', Number.NaN, 502) }), '/api/events/1'))
				.toMatchObject({ errorCode: null });
			expect(errorLogFields(failed({ cause: new ErrorInfoShaped('', Number.POSITIVE_INFINITY, 502) }), '/api/events/1'))
				.toMatchObject({ errorCode: null });
		});

		it('reports a code that is neither string nor number as absent', () => {
			// Widening the guard must not turn it into no guard: an object or a
			// boolean in `code` is not an identifier anyone can look up.
			expect(errorLogFields(failed({ cause: { code: { value: 40400 } } }), '/api/events/1'))
				.toMatchObject({ errorCode: null });
			expect(errorLogFields(failed({ cause: { code: true } }), '/api/events/1'))
				.toMatchObject({ errorCode: null });
		});

		it('reports an absent unhandled flag as handled, and a set one as unhandled', () => {
			// The field decides how a reader triages the line: `unhandled` is Nitro's
			// mark for an error nothing classified, and the mapper clears it for every
			// failure it recognises. So `false` has to mean "something owned this" and
			// not "the property was missing" — an absent flag defaulting the other way
			// would report every classified failure as an unexplained crash.
			expect(errorLogFields(failed({}), '/api/events/1')).toMatchObject({ unhandled: false });
			expect(errorLogFields(failed({ unhandled: false }), '/api/events/1')).toMatchObject({ unhandled: false });
			expect(errorLogFields(failed({ unhandled: true }), '/api/events/1')).toMatchObject({ unhandled: true });
		});

		it('falls back to the error\'s own name, and to no code at all, without a cause', () => {
			expect(errorLogFields(failed({ name: 'TypeError', statusCode: 500, unhandled: true }), undefined)).toEqual({
				message: 'api_request_failed',
				path: null,
				statusCode: 500,
				errorName: 'TypeError',
				errorCode: null,
				unhandled: true,
			});
		});
	});

	describe('stateConflictError mapping', () => {
		it('maps to 409 Conflict', () => {
			const error: MappableNitroError = {
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

	describe('serviceConfigurationError mapping', () => {
		it('keeps the setting name the message exists to carry', () => {
			// Sanitizing this one would leave the only person who can fix it with
			// 'Internal Server Error' for a one-line environment change — #233.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new ServiceConfigurationError('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY', 'is not set'),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set',
				unhandled: false,
			});
		});

		it('survives the 5xx sanitizer that every other server error meets', () => {
			// The sanitizer runs last and rewrites any unmapped 5xx. This asserts
			// the mapping is reached, not merely that a 503 comes out.
			const sanitized = { statusCode: 503, message: 'signing key missing', cause: new Error('signing key missing') };

			mapPublicNitroError(sanitized);

			expect(sanitized.message).toBe('Internal Server Error');
		});
	});

	describe('serviceWiringError mapping', () => {
		it('names the collaborator a component was assembled without', () => {
			// #243: the sibling of the above with the opposite cause — nothing is
			// missing from the environment, the server was built wrong. Sanitizing
			// it leaves the operator with 'Internal Server Error' and nothing to
			// report to whoever can fix it.
			//
			// The component is the Broadcast Graphics Live Session module rather than
			// #243's Screen write module, which no longer raises one: #247 made its
			// collaborators required at the type level, so the branch is gone. #246
			// left this module's two, which are what this mapping now serves.
			const error: MappableNitroError = {
				statusCode: 503,
				message: 'The Broadcast Graphics Live Session module was constructed without the Graphics Asset Library',
				cause: new ServiceWiringError('The Broadcast Graphics Live Session module', 'the Graphics Asset Library'),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: expect.stringContaining('was constructed without the Graphics Asset Library'),
			});
		});

		it('clears unhandled, without which Nitro masks the message regardless', () => {
			// Nitro's own handler builds the response body as
			// `message: (unhandled || fatal) ? 'Server Error' : error.message`, and it
			// runs after this hook. So leaving `unhandled` set would reinstate exactly
			// the masking #243 removed — whatever is written above would never reach
			// the caller.
			//
			// A wiring fault can genuinely arrive unhandled: h3 marks any non-H3Error
			// that way, and a bare `throw new ServiceWiringError(...)` is one.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new ServiceWiringError('The Broadcast Graphics Live Session module', 'the Graphics Asset Library'),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: expect.stringContaining('was constructed without the Graphics Asset Library'),
				unhandled: false,
			});
		});
	});

	describe('realtimePublishError mapping', () => {
		it('answers a refused publish in its own name rather than the provider\'s status', () => {
			// #264: `publishScreenCommand` used to propagate Ably's `ErrorInfo`
			// untouched, and h3 adopts `statusCode` from anything thrown — so a key
			// Ably refuses made the Screen-command route answer 404, the same answer
			// it gives for a Screen that does not exist. The two are different
			// failures with different owners, and now say so.
			const error: MappableNitroError = {
				statusCode: 404,
				message: 'No application found',
				cause: new RealtimePublishError(providerRefusal()),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 502,
				statusMessage: 'Bad Gateway',
				message: REALTIME_PUBLISH_FAILED_MESSAGE,
				unhandled: false,
			});
		});

		it('clears unhandled, without which Nitro masks the message regardless', () => {
			// The same reason as the wiring branch above: a bare `throw` of a
			// non-H3Error arrives unhandled, and Nitro's handler runs after this hook
			// and rewrites the body message to 'Server Error' when it still is. The
			// integration diagnosis reads that message, so leaving it masked would
			// cost the whole classification.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new RealtimePublishError(providerRefusal()),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error.unhandled).toBe(false);
			expect(error.message).toBe(REALTIME_PUBLISH_FAILED_MESSAGE);
		});

		it('tells the caller nothing about the provider and the log everything', () => {
			// The split the cluster is built on. The response says a realtime publish
			// failed; the log line names which refusal it was, which is the field
			// #264 found logging null.
			const error = {
				name: 'Error',
				statusCode: 500,
				message: 'Something went wrong',
				cause: new RealtimePublishError(providerRefusal()),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error.message).not.toContain('No application found');
			expect(error.message).not.toContain('40400');
			expect(errorLogFields(error, '/api/events/1/screens/2/command')).toEqual({
				message: 'api_request_failed',
				path: '/api/events/1/screens/2/command',
				statusCode: 502,
				errorName: 'RealtimePublishError',
				errorCode: 40400,
				unhandled: false,
			});
		});
	});

	describe('drizzle unique constraint mapping', () => {
		it('maps UNIQUE constraint failed to 409', () => {
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Sensitive database error details',
				cause: new Error('connection pool exhausted'),
			};
			mapPublicNitroError(error);
			expect(error.message).toBe('Internal Server Error');
			expect(error.statusMessage).toBe('Internal Server Error');
		});

		it('sanitizes explicit 500 errors even when they have no cause', () => {
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
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
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Error',
				cause: new StateConflictError('screen', 1),
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
		});

		it('uNIQUE constraint takes precedence over 500 sanitization', () => {
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Error',
				cause: new Error('UNIQUE constraint failed: events.slug'),
			};
			mapPublicNitroError(error);
			expect(error.statusCode).toBe(409);
		});
	});
});
