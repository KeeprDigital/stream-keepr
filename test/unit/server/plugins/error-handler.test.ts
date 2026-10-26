import type { LoggedNitroError } from '~~/server/utils/errorLogFields';
import type { MappableNitroError } from '~~/server/utils/nitroErrorMapping';
import { describe, expect, it } from 'vitest';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library/errors';
import { errorLogFields } from '~~/server/utils/errorLogFields';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import {
	ServiceConfigurationError,
	StateConflictError,
	TemporarilyUnavailableError,
} from '~~/server/utils/errors';
import { MeleeCredentialCryptoError } from '~~/server/utils/meleeCredentialCrypto';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { REALTIME_PUBLISH_FAILED_MESSAGE, RealtimePublishError } from '~~/server/utils/realtimePublishFailure';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import { ErrorInfoShaped, providerRefusal } from '~~/test/helpers/providerRefusal';

describe('error-handler mapping logic', () => {
	it('maps Broadcast Deck provider outages to a stable retryable API failure', () => {
		const error: MappableNitroError = {
			statusCode: 500,
			message: 'Something went wrong',
			cause: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
		};

		mapPublicNitroError(error);

		expect(error).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Card data provider is temporarily unavailable. Try again later.',
			data: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
			unhandled: false,
		});
	});

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
			expect(errorLogFields(failed({
				cause: providerRefusal(),
			}), '/api/events/1')).toMatchObject({
				// A genuine `ErrorInfo` never assigns `name`, so the sibling field
				// reports the inherited 'Error' and identifies nothing. The code is the
				// only thing in the line that can name the refusal.
				errorName: 'Error',
				errorCode: 40400,
			});
		});

		it('still carries a provider code that arrives as a string', () => {
			// Node's own convention, and the shape the previous guard was written for.
			expect(errorLogFields(failed({
				cause: { name: 'SystemError', code: 'ENOENT' },
			}), '/api/events/1'))
				.toMatchObject({ errorName: 'SystemError', errorCode: 'ENOENT' });
		});

		it('reports a NaN code as absent rather than as a number', () => {
			// The Ably transport builds `Number(headers['x-ably-errorcode'])` for a
			// response carrying no Ably error body, so NaN is a shape that reaches
			// here. #253 guards the same value the same way in the publish log.
			expect(errorLogFields(failed({
				cause: new ErrorInfoShaped('', Number.NaN, 502),
			}), '/api/events/1'))
				.toMatchObject({ errorCode: null });
			expect(errorLogFields(failed({
				cause: new ErrorInfoShaped('', Number.POSITIVE_INFINITY, 502),
			}), '/api/events/1'))
				.toMatchObject({ errorCode: null });
		});

		it('reports a code that is neither string nor number as absent', () => {
			// Widening the guard must not turn it into no guard: an object or a
			// boolean in `code` is not an identifier anyone can look up.
			expect(errorLogFields(failed({
				cause: {
					code: { value: 40400 },
				},
			}), '/api/events/1'))
				.toMatchObject({ errorCode: null });
			expect(errorLogFields(failed({
				cause: { code: true },
			}), '/api/events/1'))
				.toMatchObject({ errorCode: null });
		});

		it('walks the cause chain for a code the nearest cause does not carry, keeping the class name', () => {
			// #323: a class like `TemporarilyUnavailableError` names the failure but
			// carries no code, so before this walk the store exception's own code —
			// the one thing that says WHY the store refused — never reached the log.
			const error = failed({
				cause: new TemporarilyUnavailableError('Graphic Asset Content is temporarily unavailable', {
					cause: { name: 'R2Error', code: 'R2_CONNECTION_LOST' },
				}),
			});
			expect(errorLogFields(error, '/api/events/1')).toMatchObject({
				errorName: 'TemporarilyUnavailableError',
				errorCode: 'R2_CONNECTION_LOST',
			});
		});

		it('prefers the nearest valid code over a deeper one', () => {
			// A domain error's own code is the classification; the store code under it
			// is only the fallback for a level that classifies nothing.
			const error = failed({
				cause: {
					name: 'GraphicsAssetLibraryError',
					code: 'invalid-ingestion-input',
					cause: { code: 'ENOENT' },
				},
			});
			expect(errorLogFields(error, '/api/events/1')).toMatchObject({
				errorName: 'GraphicsAssetLibraryError',
				errorCode: 'invalid-ingestion-input',
			});
		});

		it('skips an invalid code and keeps walking', () => {
			// An object in `code` is not an identifier anyone can look up; the number
			// beneath it is.
			expect(errorLogFields(failed({
				cause: {
					code: { value: 1 },
					cause: { code: 40400 },
				},
			}), '/api/events/1'))
				.toMatchObject({ errorCode: 40400 });
		});

		it('bounds the walk, so a cycle terminates and a too-deep code stays absent', () => {
			const cyclic: { code?: unknown; cause?: unknown } = {};
			cyclic.cause = cyclic;
			expect(errorLogFields(failed({ cause: cyclic }), '/api/events/1'))
				.toMatchObject({ errorCode: null });

			const tooDeep = [
				...Array.from({ length: 5 }),
			].reduce<object>(
				cause => ({ cause }),
				{ code: 'BURIED' },
			);
			expect(errorLogFields(failed({ cause: tooDeep }), '/api/events/1'))
				.toMatchObject({ errorCode: null });
		});

		it('reports an absent unhandled flag as handled, and a set one as unhandled', () => {
			// `unhandled: false` means something classified the failure, never that the flag was absent.
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

		// The client's conflict retry replays a write only for a lost race, never
		// for a refusal — and the two arrive as the same 409 unless the race is
		// marked (#381). The mark rides the body's `data.code`, the seam the
		// Broadcast Graphics rejection codes already cross the wire on.
		it('marks the body as a state conflict, so a refusal 409 stays distinguishable', () => {
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Something went wrong',
				cause: new StateConflictError('Screen', 3),
				unhandled: true,
			};
			mapPublicNitroError(error);
			expect(error.data).toEqual({ code: STATE_CONFLICT_CODE });
		});

		it('leaves a refusal 409 unmarked', () => {
			const error: MappableNitroError = {
				statusCode: 409,
				statusMessage: 'Conflict',
				message: 'Graphic Asset Reference at graphics.lower-third.items.logo.asset is not selectable',
				unhandled: false,
			};
			mapPublicNitroError(error);
			expect(error.data).toBeUndefined();
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
			const sanitized = {
				statusCode: 503,
				message: 'signing key missing',
				cause: new Error('signing key missing'),
			};

			mapPublicNitroError(sanitized);

			expect(sanitized.message).toBe('Internal Server Error');
		});
	});

	describe('realtimePublishError mapping', () => {
		it('answers a refused publish in its own name rather than the provider\'s status', () => {
			// A refused publish answers in its own name, not with the provider's 404 (#264).
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
			// Nitro masks the body message of an error still marked unhandled.
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

		it('strips data from an unmapped 5xx along with its message', () => {
			// #347: the message rewrite below never touched `data`, so a throw site
			// that attached a payload to a 5xx handed it to every caller while its
			// sentence was being sanitized. An unmapped 5xx publishes nothing; the
			// deliberate 5xx payloads all ride mapped errors, which never get here.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'internal detail',
				data: { code: 'MELEE_CREDENTIAL_DECRYPTION_FAILED' },
				cause: new Error('a cause the mapper does not classify'),
			};

			mapPublicNitroError(error);

			expect(error.message).toBe('Internal Server Error');
			expect(error.data).toBeUndefined();
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
				cause: {
					code: 'IMPORTED_CARD_LOOKUP_UNAVAILABLE',
					details: ['private upstream body'],
				},
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

	describe('melee credential keyring configuration mapping', () => {
		it('keeps a sentence naming the keyring setting an operator must fix', () => {
			// A keyring fault names the setting, never a value; the crypto error stays on the cause (#347).
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Melee credential encryption is unavailable',
				cause: new MeleeCredentialCryptoError(
					'MELEE_CREDENTIAL_KEY_VERSION_MISSING',
					'Melee credential encryption key version is not configured',
				),
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION is not configured',
				unhandled: false,
			});
			// The classified 503 keeps the crypto error where the failure log reads
			// it — the cause is not consumed by the mapping.
			expect(errorLogFields({ name: 'H3Error', statusCode: error.statusCode, cause: error.cause }, '/api/events/1/melee-config')).toMatchObject({
				errorName: 'MeleeCredentialCryptoError',
				errorCode: 'MELEE_CREDENTIAL_KEY_VERSION_MISSING',
			});
		});

		it('classifies an unparseable previous-keys setting as the same deployment fault', () => {
			// The keyring parser's code is the same deployment fault as the crypto utility's.
			const error: MappableNitroError = {
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Melee credential encryption is unavailable',
				cause: new MeleeCredentialCryptoError(
					'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
					'Melee credential previous encryption keys must be a JSON object of key versions to base64 keys',
				),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS is not a JSON object of key versions to base64 keys',
			});
		});

		it('discriminates on the code, so a corrupt envelope stays a sanitized 500', () => {
			// A corrupt stored envelope is an internal failure no setting fixes, so it is sanitized.
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Melee credential encryption is unavailable',
				cause: new MeleeCredentialCryptoError(
					'MELEE_CREDENTIAL_DECRYPTION_FAILED',
					'Stored Melee credential could not be decrypted',
				),
			};

			mapPublicNitroError(error);

			expect(error).toMatchObject({
				statusCode: 500,
				statusMessage: 'Internal Server Error',
				message: 'Internal Server Error',
			});
			expect(errorLogFields({ name: 'H3Error', statusCode: error.statusCode, cause: error.cause }, '/api/events/1/melee-config')).toMatchObject({
				errorName: 'MeleeCredentialCryptoError',
				errorCode: 'MELEE_CREDENTIAL_DECRYPTION_FAILED',
			});
		});
	});

	describe('graphics asset library unavailability mapping', () => {
		it('keeps the sentence naming which store the library could not reach', () => {
			// Which store went away is the part an operator can act on (#294).
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
			// Many throw sites share the code, so the branch carries the library's own wording.
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

	// Every family whose prose survives the sanitizer: the list `failureSentence` relies on.
	describe('the families whose prose survives, enumerated', () => {
		const preserved: readonly { family: string; cause: unknown; sentence: string }[] = [
			{
				family: 'a setting that was never configured (#233)',
				cause: new ServiceConfigurationError('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY', 'is not set'),
				sentence: 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set',
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
				family: 'a Broadcast Deck List card provider outage',
				cause: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
				sentence: 'Card data provider is temporarily unavailable. Try again later.',
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
				family: 'a subsystem a route classified as momentarily out of reach (#321)',
				cause: new TemporarilyUnavailableError('Graphic Asset Content is temporarily unavailable'),
				sentence: 'Graphic Asset Content is temporarily unavailable',
			},
		];

		it.each(preserved)('says something an operator can act on for $family', ({ cause, sentence }) => {
			const error: MappableNitroError = {
				statusCode: 500,
				message: 'Something went wrong',
				cause,
				unhandled: true,
			};

			mapPublicNitroError(error);

			expect(error.message).toBe(sentence);
			expect(error.unhandled).toBe(false);
		});

		// A family raised at 500 would be quoted by nothing: the client refuses that status.
		it.each(preserved)('answers away from 500 for $family', ({ cause }) => {
			const error: MappableNitroError = { statusCode: 500, message: 'Something went wrong', cause };

			mapPublicNitroError(error);

			expect(error.statusCode).not.toBe(500);
			expect([502, 503, 504, 507]).toContain(error.statusCode);
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
