import type { MeleeServiceOptions } from '~~/server/services/melee';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('~~/server/mappers/melee', () => ({
	mapMeleePlayersToDb: vi.fn().mockReturnValue([]),
}));

const { meleeService } = await import('~~/server/services/melee');

const credentials = {
	clientId: 'test-client',
	clientSecret: 'test-secret',
	eventId: 'event-123',
};

const eventData = { ID: 123, Name: 'Test Tournament', Game: 'Magic: The Gathering', Phases: [] };
const mockSleep = vi.fn<(delayMs: number) => Promise<void>>();
const mockLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

function jsonResponse(
	body: unknown,
	status: number = 200,
	headers?: HeadersInit,
): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

function paginated<T>(
	Content: T[],
	options: {
		page?: number;
		pageSize?: number;
		recordsFiltered?: number;
		recordsTotal?: number;
		hasMore?: boolean;
	} = {},
) {
	const RecordsFiltered = options.recordsFiltered ?? Content.length;
	return {
		Page: options.page ?? 1,
		PageSize: options.pageSize ?? 100,
		RecordsFiltered,
		RecordsTotal: options.recordsTotal ?? RecordsFiltered,
		Content,
		HasMore: options.hasMore ?? false,
	};
}

function transportOptions(overrides: MeleeServiceOptions = {}): MeleeServiceOptions {
	return {
		maxAttempts: 3,
		baseRetryDelayMs: 100,
		maxRetryDelayMs: 5_000,
		sleep: mockSleep,
		now: () => 1_000_000,
		random: () => 1,
		logger: mockLogger,
		...overrides,
	};
}

describe('meleeService', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockSleep.mockReset();
		mockSleep.mockResolvedValue();
		mockLogger.info.mockReset();
		mockLogger.warn.mockReset();
		mockLogger.error.mockReset();
	});

	describe('fetchEvent', () => {
		it('returns event data from API', async () => {
			// Phases is required by the Zod schema; Name and other fields pass through
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(eventData),
			});

			const result = await meleeService(credentials).fetchEvent();

			expect(result).toEqual(eventData);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining(`/tournament/${credentials.eventId}`),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: expect.stringContaining('Basic'),
					}),
				}),
			);
		});

		it('encodes configured Event identity as one URL path segment', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(eventData),
			});

			await meleeService({ ...credentials, eventId: '123?unexpected=true' }).fetchEvent();

			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				'https://www.melee.gg/api/tournament/123%3Funexpected%3Dtrue',
			);
		});
	});

	describe('transport reliability', () => {
		it('passes a fresh configured timeout signal to each request attempt', async () => {
			const signals = [new AbortController().signal, new AbortController().signal];
			const createTimeoutSignal = vi.fn()
				.mockReturnValueOnce(signals[0])
				.mockReturnValueOnce(signals[1]);

			mockFetch
				.mockResolvedValueOnce(jsonResponse({}, 503))
				.mockResolvedValueOnce(jsonResponse(eventData));

			await meleeService(credentials, transportOptions({
				requestTimeoutMs: 1_234,
				createTimeoutSignal,
			})).fetchEvent();

			expect(createTimeoutSignal).toHaveBeenNthCalledWith(1, 1_234);
			expect(createTimeoutSignal).toHaveBeenNthCalledWith(2, 1_234);
			expect(mockFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: signals[0] }));
			expect(mockFetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ signal: signals[1] }));
		});

		it('retries retryable statuses with bounded exponential backoff', async () => {
			mockFetch
				.mockResolvedValueOnce(jsonResponse({}, 429))
				.mockResolvedValueOnce(jsonResponse({}, 503))
				.mockResolvedValueOnce(jsonResponse(eventData));

			const result = await meleeService(credentials, transportOptions()).fetchEvent();

			expect(result).toEqual(eventData);
			expect(mockFetch).toHaveBeenCalledTimes(3);
			expect(mockSleep).toHaveBeenNthCalledWith(1, 100);
			expect(mockSleep).toHaveBeenNthCalledWith(2, 200);
			expect(mockLogger.warn).toHaveBeenNthCalledWith(1, expect.objectContaining({
				endpoint: 'event',
				outcome: 'retry',
				status: 429,
				retryDelayMs: 100,
				retryDelaySource: 'exponential_backoff',
			}));
			expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
				endpoint: 'event',
				outcome: 'success',
				attempt: 3,
				retryCount: 2,
			}));
		});

		it.each([408, 425, 429, 500, 502, 503, 504])('retries status %i', async (status) => {
			mockFetch
				.mockResolvedValueOnce(jsonResponse({}, status))
				.mockResolvedValueOnce(jsonResponse(eventData));

			await meleeService(credentials, transportOptions({ maxAttempts: 2 })).fetchEvent();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('honours Retry-After delay seconds and caps excessive delays', async () => {
			mockFetch
				.mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '120' }))
				.mockResolvedValueOnce(jsonResponse(eventData));

			await meleeService(credentials, transportOptions({ maxRetryDelayMs: 2_500 })).fetchEvent();

			expect(mockSleep).toHaveBeenCalledWith(2_500);
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
				retryDelayMs: 2_500,
				retryDelaySource: 'retry_after',
			}));
		});

		it('honours an HTTP-date Retry-After value', async () => {
			const retryAt = new Date(1_004_000).toUTCString();
			mockFetch
				.mockResolvedValueOnce(jsonResponse({}, 503, { 'Retry-After': retryAt }))
				.mockResolvedValueOnce(jsonResponse(eventData));

			await meleeService(credentials, transportOptions()).fetchEvent();

			expect(mockSleep).toHaveBeenCalledWith(4_000);
		});

		it.each([400, 401, 403, 404])('does not retry deterministic HTTP status %i', async (status) => {
			mockFetch.mockResolvedValue(jsonResponse({}, status));

			await expect(
				meleeService(credentials, transportOptions()).fetchEvent(),
			).rejects.toThrow(`status ${status}`);

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockSleep).not.toHaveBeenCalled();
		});

		it('does not retry invalid JSON or schema validation failures', async () => {
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
				} as unknown as Response)
				.mockResolvedValueOnce(jsonResponse({ ID: 'not-a-number', Name: 'Invalid', Phases: [] }));

			await expect(
				meleeService(credentials, transportOptions()).fetchEvent(),
			).rejects.toThrow('invalid JSON response');

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockLogger.error).toHaveBeenLastCalledWith(expect.objectContaining({
				failureCategory: 'response_parse',
			}));

			mockFetch.mockReset();
			mockFetch.mockResolvedValue(jsonResponse({ ID: 'not-a-number', Name: 'Invalid', Phases: [] }));

			let validationError: unknown;
			try {
				await meleeService(credentials, transportOptions()).fetchEvent();
			}
			catch (error) {
				validationError = error;
			}

			expect(validationError).toMatchObject({
				name: 'MeleeTransportError',
				code: 'MELEE_UPSTREAM_FAILURE',
				category: 'schema_validation',
				message: 'Melee.gg API response failed schema validation for event',
			});
			expect(String(validationError)).not.toContain('not-a-number');
			expect(String(validationError)).not.toContain('Invalid');

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockLogger.error).toHaveBeenLastCalledWith(expect.objectContaining({
				failureCategory: 'schema_validation',
			}));
		});

		it('rejects invalid UTF-8 response bytes as a parse failure', async () => {
			const invalidUtf8Json = new Uint8Array([0x7B, 0x22, 0x78, 0x22, 0x3A, 0x22, 0xC3, 0x28, 0x22, 0x7D]);
			mockFetch.mockResolvedValue(new Response(invalidUtf8Json, { status: 200 }));

			await expect(meleeService(credentials, transportOptions()).fetchEvent()).rejects.toMatchObject({
				code: 'MELEE_UPSTREAM_FAILURE',
				category: 'response_parse',
			});
			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it('retries a timeout that occurs while reading the response body', async () => {
			const first = new AbortController();
			first.abort(new DOMException('timed out', 'TimeoutError'));
			const second = new AbortController();
			const createTimeoutSignal = vi.fn()
				.mockReturnValueOnce(first.signal)
				.mockReturnValueOnce(second.signal);
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					json: vi.fn().mockRejectedValue(first.signal.reason),
				} as unknown as Response)
				.mockResolvedValueOnce(jsonResponse(eventData));

			await expect(meleeService(credentials, transportOptions({
				maxAttempts: 2,
				createTimeoutSignal,
			})).fetchEvent()).resolves.toEqual(eventData);

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockSleep).toHaveBeenCalledOnce();
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
				failureCategory: 'timeout',
				outcome: 'retry',
				status: 200,
			}));
		});

		it('retries transient network failures and classifies aborted requests as timeouts', async () => {
			mockFetch
				.mockRejectedValueOnce(new TypeError('network unavailable'))
				.mockResolvedValueOnce(jsonResponse(eventData));

			await meleeService(credentials, transportOptions()).fetchEvent();

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
				failureCategory: 'network',
			}));

			mockFetch.mockReset();
			const controller = new AbortController();
			controller.abort(new DOMException('timed out', 'TimeoutError'));
			mockFetch.mockRejectedValue(controller.signal.reason);

			await expect(meleeService(credentials, transportOptions({
				maxAttempts: 1,
				createTimeoutSignal: () => controller.signal,
			})).fetchEvent()).rejects.toThrow('timeout');

			expect(mockLogger.error).toHaveBeenLastCalledWith(expect.objectContaining({
				failureCategory: 'timeout',
			}));
		});

		it('logs redacted endpoint metadata without URLs, credentials, or payloads', async () => {
			const sensitiveCredentials = {
				clientId: 'private-client-id',
				clientSecret: 'private-client-secret',
				eventId: 'private-event-id',
			};
			mockFetch.mockResolvedValue(jsonResponse({
				...eventData,
				Name: 'private-response-payload',
			}));

			await meleeService(sensitiveCredentials, transportOptions()).fetchEvent();

			expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
				service: 'melee',
				event: 'api_request',
				endpoint: 'event',
				page: null,
				durationMs: 0,
				retryCount: 0,
			}));

			const logs = JSON.stringify([
				...mockLogger.info.mock.calls,
				...mockLogger.warn.mock.calls,
				...mockLogger.error.mock.calls,
			]);
			expect(logs).not.toContain('private-client-id');
			expect(logs).not.toContain('private-client-secret');
			expect(logs).not.toContain('private-event-id');
			expect(logs).not.toContain('private-response-payload');
			expect(logs).not.toContain('https://');
		});

		it('logs the sanitized endpoint and page for paginated requests', async () => {
			mockFetch.mockResolvedValue(jsonResponse(paginated([])));

			await meleeService(credentials, transportOptions()).fetchPlayers();

			expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
				endpoint: 'players',
				page: 1,
				outcome: 'success',
			}));
		});

		it('rejects unsafe transport configuration before making a request', () => {
			expect(() => meleeService(credentials, { requestTimeoutMs: 0 })).toThrow('requestTimeoutMs');
			expect(() => meleeService(credentials, { maxAttempts: 6 })).toThrow('maxAttempts');
			expect(() => meleeService(credentials, { maxResponseBytes: 512 })).toThrow('maxResponseBytes');
			expect(() => meleeService(credentials, { maxCollectionItems: 0 })).toThrow('maxCollectionItems');
			expect(() => meleeService(credentials, { maxCollectionBytes: 512 })).toThrow('maxCollectionBytes');
			expect(() => meleeService(credentials, {
				baseRetryDelayMs: 1_000,
				maxRetryDelayMs: 500,
			})).toThrow('maxRetryDelayMs');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('rejects a response body before it can consume unbounded Worker memory', async () => {
			mockFetch.mockResolvedValue(jsonResponse({
				...eventData,
				Name: 'x'.repeat(2_000),
			}));

			await expect(meleeService(credentials, transportOptions({
				maxResponseBytes: 1_024,
			})).fetchEvent()).rejects.toThrow('configured size limit');
			expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
				failureCategory: 'response_size',
			}));
		});
	});

	describe('fetchPlayers', () => {
		it('returns all players across pages', async () => {
			// PlayerName, PronounsDescription, Decklists are required by the Zod schema
			const player = (id: number) => ({ TeamId: id, PlayerName: `Player ${id}`, PronounsDescription: null, Decklists: [] });
			const page1 = paginated([player(1)], { recordsFiltered: 2, hasMore: true });
			const page2 = paginated([player(2)], { page: 2, recordsFiltered: 2 });
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page1) })
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page2) });

			const result = await meleeService(credentials).fetchPlayers();

			expect(result).toHaveLength(2);
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('returns empty array when no players', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([])),
			});

			const result = await meleeService(credentials).fetchPlayers();

			expect(result).toEqual([]);
		});

		it('bounds the number of items accumulated across pages', async () => {
			const players = [1, 2].map(id => ({
				TeamId: id,
				PlayerName: `Player ${id}`,
				PronounsDescription: null,
				Decklists: [],
			}));
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated(players)),
			});

			await expect(meleeService(credentials, {
				maxCollectionItems: 1,
			}).fetchPlayers()).rejects.toThrow('exceeded 1 items');
		});

		it('bounds the approximate bytes accumulated across pages', async () => {
			const players = Array.from({ length: 10 }, (_, index) => ({
				TeamId: index + 1,
				PlayerName: `Player ${'x'.repeat(190)}`,
				PronounsDescription: null,
				Decklists: [],
			}));
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated(players)),
			});

			await expect(meleeService(credentials, {
				maxCollectionBytes: 1_024,
			}).fetchPlayers()).rejects.toThrow('collection exceeded the configured size limit');
		});

		it('rejects an empty intermediate page instead of accepting a partial snapshot', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([], { recordsFiltered: 1, hasMore: true })),
			});

			await expect(meleeService(credentials).fetchPlayers()).rejects.toMatchObject({
				category: 'schema_validation',
				message: expect.stringContaining('empty page claimed more records'),
			});
		});

		it('rejects pagination metadata that changes between pages', async () => {
			const player = (id: number) => ({ TeamId: id, PlayerName: `Player ${id}`, PronounsDescription: null, Decklists: [] });
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(paginated([player(1)], { recordsFiltered: 2, hasMore: true })),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve(paginated([player(2)], { page: 2, recordsFiltered: 3, recordsTotal: 3 })),
				});

			await expect(meleeService(credentials).fetchPlayers()).rejects.toMatchObject({
				category: 'schema_validation',
				message: expect.stringContaining('record counts changed between pages'),
			});
		});
	});

	describe('fetchCurrentStandings', () => {
		it('returns all standings across pages', async () => {
			const standing = { TeamId: 1, Rank: 1, Points: 9, MatchWins: 3, MatchLosses: 0, MatchDraws: 0 };
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([standing])),
			});

			const result = await meleeService(credentials).fetchCurrentStandings();

			expect(result).toHaveLength(1);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/standing/list/current/'),
				expect.any(Object),
			);
		});
	});

	describe('fetchStandingsByRound', () => {
		it('returns standings for a specific round', async () => {
			const standing = { TeamId: 1, Rank: 1, Points: 9, MatchWins: 3, MatchLosses: 0, MatchDraws: 0 };
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([standing])),
			});

			const result = await meleeService(credentials).fetchStandingsByRound(42);

			expect(result).toHaveLength(1);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/standing/list/round/42'),
				expect.any(Object),
			);
		});

		it('returns empty array when no standings', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([])),
			});

			const result = await meleeService(credentials).fetchStandingsByRound(42);

			expect(result).toEqual([]);
		});
	});

	describe('fetchMatchesByRound', () => {
		it('returns matches for a round', async () => {
			// TableNumber may be null in real Melee payloads, but the match envelope is still valid.
			const match = {
				Guid: 'match-1',
				TableNumber: 1,
				Competitors: [],
				HasResult: false,
				ResultString: null,
				GameDraws: 0,
				ByeReason: null,
			};
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([match])),
			});

			const result = await meleeService(credentials).fetchMatchesByRound(42);

			expect(result).toHaveLength(1);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/match/list/round/42'),
				expect.any(Object),
			);
		});

		it('accepts null table numbers and null game wins from Melee', async () => {
			const match = {
				Guid: 'match-nullables',
				TableNumber: null,
				HasResult: false,
				ResultString: null,
				GameDraws: null,
				ByeReason: null,
				Competitors: [
					{ TeamId: 1, SortOrder: 0, GameWins: null, Decklists: [] },
				],
			};
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(paginated([match])),
			});

			const result = await meleeService(credentials).fetchMatchesByRound(42);

			expect(result[0]?.TableNumber).toBeNull();
			expect(result[0]?.Competitors[0]?.GameWins).toBeNull();
		});
	});

	describe('fetchMergedPlayers', () => {
		it('fetches players and standings then maps them', async () => {
			mockFetch
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(paginated([])) })
				.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(paginated([])) });

			const result = await meleeService(credentials).fetchMergedPlayers();

			expect(result).toEqual([]);
		});
	});
});
