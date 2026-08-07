import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Ably ──

const mockAbly = createMockRealtime();
const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation(
	(storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
		ablyCallbacks[storeName] = callbacks;
	},
);

mockNuxtImport('useRealtime', () => () => mockAbly);

// ── Mock $fetch ──

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

// ── Helpers ──

function makeSummaryData() {
	return {
		totalPlayers: 4,
		classifiedPlayers: 3,
		totalDecks: 2,
		totalArchetypes: 2,
		scopedArchetypeCount: 2,
		scope: 'all' as const,
		facts: [],
		topArchetypes: [],
		topCards: [],
	};
}

// ── Tests ──

describe('useMetagameStore', () => {
	let store: ReturnType<typeof useMetagameStore>;

	beforeEach(() => {
		store = useMetagameStore();
		store.$reset();
		vi.clearAllMocks();
		mockFetch.mockResolvedValue(makeSummaryData());
		mockAbly.onRoom.mockImplementation(
			(storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
				ablyCallbacks[storeName] = callbacks;
			},
		);
		ablyCallbacks.metagame = {
			'player:updated': () => store.applyRemoteInvalidated(),
			'archetype:created': () => store.applyRemoteInvalidated(),
			'archetype:updated': () => store.applyRemoteInvalidated(),
			'archetype:deleted': () => store.applyRemoteInvalidated(),
			'archetype:keyCardsUpdated': () => store.applyRemoteInvalidated(),
		};
	});

	// ── scopeQuery computed ──

	describe('scopeQuery', () => {
		it('scope=\'all\' → { scope: \'all\' }', () => {
			store.scope = 'all';
			expect(store.scopeQuery).toEqual({ scope: 'all' });
		});

		it('scope=\'topN\', topN=16 → { scope: \'topN\', topN: 16 }', () => {
			store.scope = 'topN';
			store.topN = 16;
			expect(store.scopeQuery).toEqual({ scope: 'topN', topN: 16 });
		});

		it('scope=\'playerList\', playerListId=3 → { scope: \'playerList\', playerListId: 3 }', () => {
			store.scope = 'playerList';
			store.playerListId = 3;
			expect(store.scopeQuery).toEqual({ scope: 'playerList', playerListId: 3 });
		});

		it('is reactive: updates when scope changes', () => {
			store.scope = 'all';
			expect(store.scopeQuery.scope).toBe('all');
			store.scope = 'topN';
			expect(store.scopeQuery.scope).toBe('topN');
		});
	});

	// ── buildScopeQuery (inspected via loadSummary) ──

	describe('buildScopeQuery', () => {
		it('scope=\'topN\', topN=8 → includes topN: 8', async () => {
			store.scope = 'topN';
			store.topN = 8;
			await store.loadSummary(1);

			const query = (mockFetch.mock.calls[0] as any)[1].query;
			expect(query).toMatchObject({ scope: 'topN', topN: 8 });
		});

		it('scope=\'playerList\', playerListId=5 → includes playerListId: 5', async () => {
			store.scope = 'playerList';
			store.playerListId = 5;
			await store.loadSummary(1);

			const query = (mockFetch.mock.calls[0] as any)[1].query;
			expect(query).toMatchObject({ scope: 'playerList', playerListId: 5 });
		});
	});

	// ── loadSummary ──

	describe('loadSummary', () => {
		it('loading is true during fetch, false after', async () => {
			const loadingDuringFetch: boolean[] = [];
			mockFetch.mockImplementation(async () => {
				loadingDuringFetch.push(store.loading);
				return makeSummaryData();
			});

			await store.loadSummary(1);

			expect(loadingDuringFetch[0]).toBe(true);
			expect(store.loading).toBe(false);
		});

		it('summaryData populated on success', async () => {
			const data = makeSummaryData();
			mockFetch.mockResolvedValue(data);

			await store.loadSummary(1);

			expect(store.summaryData).toEqual(data);
			expect(store.error).toBeNull();
		});

		it('keeps the latest scoped response when requests resolve out of order', async () => {
			let resolveOld!: (value: ReturnType<typeof makeSummaryData>) => void;
			let resolveNew!: (value: ReturnType<typeof makeSummaryData>) => void;
			mockFetch
				.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
				.mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve; }));

			const oldRequest = store.loadSummary(1);
			const newRequest = store.loadSummary(1);
			const latest = { ...makeSummaryData(), totalPlayers: 9 };
			resolveNew(latest);
			await newRequest;
			resolveOld({ ...makeSummaryData(), totalPlayers: 2 });
			await oldRequest;

			expect(store.summaryData).toEqual(latest);
			expect(store.loading).toBe(false);
		});

		/**
		 * What a refused summary says, which until #286 was nothing.
		 *
		 * This store swallowed the failure and wrote a static line, so a summary refused
		 * for a nameable reason reported only that something had failed — and
		 * `useMetagamePage` re-raises this string as the toast's title, so the static line
		 * was the whole of what an operator read. It is now the fallback rather than the
		 * answer, on `failureSentence`'s rule: a refusal's own sentence, or the preserved
		 * prose of a 5xx that named a deployment fault.
		 */
		describe('when the summary is refused', () => {
			beforeEach(() => {
				// The store logs the failure it swallows; the row is about `error`, not the log.
				vi.spyOn(console, 'error').mockImplementation(() => {});
			});

			it('reports the sentence the authority wrote about the request', async () => {
				mockFetch.mockRejectedValue(transportFailure({
					status: 403,
					body: { message: 'This player list belongs to another Event' },
					request: `[GET] "/api/events/1/metagame/summary"`,
				}));

				await store.loadSummary(1);

				expect(store.error).toBe('This player list belongs to another Event');
			});

			it('reports a 5xx whose prose the server preserved through sanitizing', async () => {
				mockFetch.mockRejectedValue(transportFailure({
					status: 503,
					body: { message: 'Card data provider is temporarily unavailable. Try again later.' },
					request: `[GET] "/api/events/1/metagame/summary"`,
				}));

				await store.loadSummary(1);

				expect(store.error).toBe('Card data provider is temporarily unavailable. Try again later.');
			});

			it('falls back to its own line when the sanitizer got to the 5xx first', async () => {
				mockFetch.mockRejectedValue(transportFailure({
					status: 500,
					body: { message: 'Internal Server Error' },
					request: `[GET] "/api/events/1/metagame/summary"`,
				}));

				await store.loadSummary(1);

				expect(store.error).toBe('Failed to load metagame summary');
			});
		});
	});

	// ── applyRemoteInvalidated ──

	describe('applyRemoteInvalidated', () => {
		it('clears summaryData to null', () => {
			store.summaryData = makeSummaryData();

			store.applyRemoteInvalidated();

			expect(store.summaryData).toBeNull();
		});

		it('increments invalidationVersion', () => {
			const previousVersion = store.invalidationVersion;

			store.applyRemoteInvalidated();

			expect(store.invalidationVersion).toBe(previousVersion + 1);
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('restores scope=all, topN=8, playerListId=undefined, clears data, loading=false, error=null', () => {
			store.scope = 'topN';
			store.topN = 16;
			store.playerListId = 5;
			store.summaryData = makeSummaryData();
			store.loading = true;
			store.error = 'some error';
			store.invalidationVersion = 10;

			store.$reset();

			expect(store.scope).toBe('all');
			expect(store.topN).toBe(8);
			expect(store.playerListId).toBeUndefined();
			expect(store.summaryData).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.error).toBeNull();
			expect(store.invalidationVersion).toBe(11);
		});
	});

	// ── Ably: metagame channel ──

	describe('realtime: metagame channel', () => {
		it('player:updated triggers invalidate() (data becomes null)', () => {
			store.summaryData = makeSummaryData();

			ablyCallbacks.metagame!['player:updated']!({ id: 1, name: 'Player 1' });

			expect(store.summaryData).toBeNull();
		});
	});

	// ── Ably: archetype invalidation messages ──

	describe('realtime: archetype invalidation messages', () => {
		const events = ['archetype:created', 'archetype:updated', 'archetype:deleted', 'archetype:keyCardsUpdated'] as const;

		it.each(events)('%s triggers invalidate()', (event) => {
			store.summaryData = makeSummaryData();

			ablyCallbacks.metagame![event]!({ id: 1 });

			expect(store.summaryData).toBeNull();
		});
	});
});
