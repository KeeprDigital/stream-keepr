import type { LoggedNitroError } from '~~/server/utils/errorLogFields';
import type { MappableNitroError } from '~~/server/utils/nitroErrorMapping';
import { describe, expect, it } from 'vitest';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library/errors';
import { errorLogFields } from '~~/server/utils/errorLogFields';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import {
	GraphicsAuthorSessionUnavailableError,
	ServiceConfigurationError,
	ServiceWiringError,
	StateConflictError,
	TemporarilyUnavailableError,
} from '~~/server/utils/errors';
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
			// The component named is the Broadcast Graphics Live Session module, but no
			// production code raises a ServiceWiringError any more: #247 made screen
			// write's collaborators required at the type level and #265 did the same to
			// this module's, so both branches #243 and #246 wrote are gone. The class
			// and this mapping stay for the next component that needs them, which makes
			// these tests the only thing holding the behaviour in place — and the reason
			// they construct the cause directly rather than driving a module to throw.
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

	describe('graphics asset library unavailability mapping', () => {
		it('keeps the sentence naming which store the library could not reach', () => {
			// #294: the library says which of its stores went away — the catalogue,
			// the staging byte store, the canonical one — and the sanitizer was
			// replacing all three with 'Internal Server Error'. That sentence is the
			// only part of the failure an operator can act on: it says whether a
			// binding is missing or a bucket is refusing, and the alternative is
			// reading the logs of a server whose own database is the thing that is
			// down. Preserved for the same reason as #233 and #243.
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphics Asset catalogue is unavailable',
				cause: new GraphicsAssetLibraryError(
					'Graphics Asset catalogue is unavailable',
					'graphics-asset-library-unavailable',
				),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphics Asset catalogue is unavailable',
				unhandled: false,
			});
		});

		it('preserves the byte store\'s own wording rather than a sentence of its own', () => {
			// Twenty-three throw sites share the one code — this comment said three
			// until #321 counted them — and each names a different store or a
			// different interrupted operation, so the branch may not substitute a
			// message of its own. It carries whichever one the library wrote.
			const error: MappableNitroError = {
				statusCode: 503,
				message: 'Graphics Asset staging byte store is unavailable',
				cause: new GraphicsAssetLibraryError(
					'Graphics Asset staging byte store is unavailable',
					'graphics-asset-library-unavailable',
				),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Graphics Asset staging byte store is unavailable');
		});

		it('discriminates on the library code rather than on the prose', () => {
			// A bare Error carrying the same words is not the library saying so, and
			// still meets the sanitizer.
			const error: MappableNitroError = {
				statusCode: 503,
				message: 'Graphics Asset catalogue is unavailable',
				cause: new Error('Graphics Asset catalogue is unavailable'),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
		});

		it('leaves the library\'s other codes to the routes that already answer them', () => {
			// `rethrowGraphicsAssetApiError` answers every other code below 500, so a
			// 5xx carrying one is not a store that went away and gets no exemption.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Ingestion operation not found',
				cause: new GraphicsAssetLibraryError(
					'Ingestion operation not found',
					'ingestion-operation-not-found',
				),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
		});
	});

	describe('graphics author session store mapping', () => {
		it('keeps the sentence a route wrote about an unreachable session store', () => {
			// #294's other half. This one could not be discriminated in the mapper at
			// all until the throw sites started raising a named error: their 503
			// carried whatever `kv.get` threw as its cause, which says nothing about
			// what failed.
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphics author sessions are temporarily unavailable',
				cause: new GraphicsAuthorSessionUnavailableError(new Error('KV GET failed')),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphics author sessions are temporarily unavailable',
				unhandled: false,
			});
		});

		it('sanitizes the raw store failure the throw sites used to hand it', () => {
			// The shape before #294, kept as a row because it is what a throw site
			// reverted to a bare `createError` would produce: the store's own
			// exception as the cause, matching no branch, sanitized on the way out.
			const error: MappableNitroError = {
				statusCode: 503,
				message: 'Graphics author sessions are temporarily unavailable',
				cause: new Error('KV GET failed'),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
		});
	});

	describe('temporarily unavailable mapping', () => {
		it('keeps the sentence a route wrote about something momentarily out of reach', () => {
			// #321: seven routes wrote an operator a sentence, set `retry-after` beside
			// it, and had the sentence replaced with 'Internal Server Error' on the way
			// out — retry guidance in the header and nothing in the body saying what for.
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphic Asset thumbnail is temporarily unavailable',
				cause: new TemporarilyUnavailableError('Graphic Asset thumbnail is temporarily unavailable'),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphic Asset thumbnail is temporarily unavailable',
				unhandled: false,
			});
		});

		it('carries each raiser\'s own words, having none of its own', () => {
			// The one class is shared by every subsystem that raises it, so it may not
			// substitute a sentence: a Screen Output whose delivery is down and an author
			// whose staged bytes are unreadable are told different things.
			for (const sentence of [
				'Screen Output asset delivery is temporarily unavailable',
				'Staged Graphic Asset source bytes are temporarily unavailable',
				'The Template Package could not be exported',
			]) {
				const error: MappableNitroError = {
					statusCode: 503,
					message: sentence,
					cause: new TemporarilyUnavailableError(sentence),
				};

				mapPublicNitroError(error);

				expect(error.message).toBe(sentence);
			}
		});

		it('sanitizes the bare 503 the routes raised before they classified it', () => {
			// The shape #321 found at all seven sites, kept as a row because it is what
			// any of them reverted to a causeless `createError` would produce.
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphic Asset thumbnail is temporarily unavailable',
				cause: undefined,
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
		});

		it('does not exempt a store failure that merely reached the same route', () => {
			// The class is the mark, not the status: the authorizer's own exception
			// carried as the cause says nothing a caller may be shown.
			const error: MappableNitroError = {
				statusCode: 503,
				message: 'Screen Output asset capability session is temporarily unavailable',
				cause: new Error('D1_ERROR: network error'),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
		});
	});

	/**
	 * Every family whose prose survives the sanitizer, driven in one place.
	 *
	 * The client reads this list without being able to see it: `failureSentence`
	 * quotes a 5xx body it did not recognise as a placeholder, and the two marks it
	 * decides on — not 500, not one of the sanitizer's own sentences — are properties
	 * of this table rather than of that function. Its docstring cites the count and
	 * the statuses as established by driving the mapper; this is that drive, so the
	 * claim fails here rather than drifting quietly.
	 */
	describe('the families whose prose survives, enumerated', () => {
		const preserved: readonly { family: string; cause: unknown; sentence: string }[] = [
			{
				family: 'a setting that was never configured (#233)',
				cause: new ServiceConfigurationError('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY', 'is not set'),
				sentence: 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set',
			},
			{
				family: 'a component assembled without a collaborator (#243)',
				cause: new ServiceWiringError('The Broadcast Graphics Live Session module', 'the Graphics Asset Library'),
				sentence: new ServiceWiringError('The Broadcast Graphics Live Session module', 'the Graphics Asset Library').message,
			},
			{
				family: 'a realtime publish the request could not go on without',
				cause: new RealtimePublishError(providerRefusal()),
				sentence: REALTIME_PUBLISH_FAILED_MESSAGE,
			},
			{
				family: 'an exhausted staging byte store',
				cause: new GraphicsAssetLibraryError('Staging byte store capacity is exhausted', 'staging-capacity-exhausted'),
				sentence: 'Staging byte store capacity is exhausted',
			},
			{
				family: 'an exhausted canonical byte store',
				cause: new GraphicsAssetLibraryError('Canonical byte store capacity is exhausted', 'canonical-capacity-exhausted'),
				sentence: 'Canonical byte store capacity is exhausted',
			},
			{
				family: 'a card lookup that preserved the deck it could not enrich',
				cause: { code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE' },
				sentence: 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.',
			},
			{
				family: 'a Melee request that timed out',
				cause: { code: 'MELEE_UPSTREAM_FAILURE', category: 'timeout' },
				sentence: 'Melee.gg is temporarily unavailable. Try again later.',
			},
			{
				family: 'a Melee request the provider refused',
				cause: { code: 'MELEE_UPSTREAM_FAILURE', category: 'http' },
				sentence: 'Melee.gg is temporarily unavailable. Try again later.',
			},
			{
				family: 'a Scryfall request the provider refused',
				cause: { code: 'SCRYFALL_UPSTREAM_FAILURE' },
				sentence: 'Card data provider is temporarily unavailable. Try again later.',
			},
			{
				family: 'a Graphics Asset Library store that could not be reached (#294)',
				cause: new GraphicsAssetLibraryError('Graphics Asset catalogue is unavailable', 'graphics-asset-library-unavailable'),
				sentence: 'Graphics Asset catalogue is unavailable',
			},
			{
				family: 'a Graphics Author Session store in the same state (#294)',
				cause: new GraphicsAuthorSessionUnavailableError(new Error('KV GET failed')),
				sentence: 'Graphics author sessions are temporarily unavailable',
			},
			{
				family: 'a subsystem a route classified as momentarily out of reach (#321)',
				cause: new TemporarilyUnavailableError('Graphic Asset Content is temporarily unavailable'),
				sentence: 'Graphic Asset Content is temporarily unavailable',
			},
		];

		it.each(preserved)('says something an operator can act on for $family', ({ cause, sentence }) => {
			const error: MappableNitroError = { statusCode: 500, message: 'Something went wrong', cause, unhandled: true };

			mapPublicNitroError(error);

			expect(error.message).toBe(sentence);
			expect(error.unhandled).toBe(false);
		});

		/**
		 * The first of the two marks the client decides on. A family raised at 500
		 * would be quoted by nothing, because 500 is where this server says it broke
		 * and the client refuses that status whatever the body carries.
		 */
		it.each(preserved)('answers away from 500 for $family', ({ cause }) => {
			const error: MappableNitroError = { statusCode: 500, message: 'Something went wrong', cause };

			mapPublicNitroError(error);

			expect(error.statusCode).not.toBe(500);
			expect([502, 503, 504, 507]).toContain(error.statusCode);
		});

		/**
		 * The count `failureSentence`'s docstring quotes. It was nine until #294 added
		 * two and eleven until #321 added the shared one, and the number is load-bearing
		 * on the client's side of the boundary: it is the enumeration behind "every
		 * preserved family comes out non-500", which is the whole reason the status mark
		 * can be trusted.
		 */
		it('is twelve families wide', () => {
			expect(preserved).toHaveLength(12);
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
