import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockPlayer, createMockUiArchetype } from '~~/test/helpers/fixtures';
import { lastCallTo } from '~~/test/helpers/lastCallTo';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const { deliver } = realtimeHandlersFor();

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

describe('useMetagameStore', () => {
	let store: ReturnType<typeof useMetagameStore>;

	beforeEach(() => {
		store = useMetagameStore();
		store.$reset();
		mockFetch.mockResolvedValue(makeSummaryData());
	});

	describe('loadSummary', () => {
		it('asks for the summary in the shared scope and holds it', async () => {
			store.scope = 'topN';
			store.topN = 16;
			const data = makeSummaryData();
			mockFetch.mockResolvedValue(data);

			await store.loadSummary(1);

			const [, options] = lastCallTo(mockFetch, '/api/events/1/metagame');
			expect(options.query).toMatchObject({ scope: 'topN', topN: 16 });
			expect(store.summaryData).toEqual(data);
			expect(store.loading).toBe(false);
		});

		it('keeps the latest response when requests resolve out of order', async () => {
			const older = deferred<ReturnType<typeof makeSummaryData>>();
			const newer = deferred<ReturnType<typeof makeSummaryData>>();
			mockFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

			const oldRequest = store.loadSummary(1);
			const newRequest = store.loadSummary(1);
			const latest = {
				...makeSummaryData(),
				totalPlayers: 9,
			};
			newer.resolve(latest);
			await newRequest;
			older.resolve({
				...makeSummaryData(),
				totalPlayers: 2,
			});
			await oldRequest;

			expect(store.summaryData).toEqual(latest);
			expect(store.loading).toBe(false);
		});

		// `useMetagamePage` raises this string as the toast's title, so it is all an operator reads (#286).
		it.each([
			[
				'the sentence the authority wrote',
				403,
				'This player list belongs to another Event',
				'This player list belongs to another Event',
			],
			[
				'its own line once the sanitizer got to a 5xx first',
				500,
				'Internal Server Error',
				'Failed to load metagame summary',
			],
		])('reports a refused summary with %s', async (_, status, message, reported) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockFetch.mockRejectedValue(transportFailure({
				status,
				body: { message },
			}));

			await store.loadSummary(1);

			expect(store.error).toBe(reported);
		});
	});

	describe('invalidation', () => {
		it('drops the held summary and ticks the version views watch', () => {
			store.summaryData = makeSummaryData();
			const version = store.invalidationVersion;

			store.applyRemoteInvalidated();

			expect(store.summaryData).toBeNull();
			expect(store.invalidationVersion).toBe(version + 1);
		});

		it('follows a reset, which also restores the default scope and conversion target', () => {
			store.scope = 'topN';
			store.conversionMetric = 'minPoints';
			store.summaryData = makeSummaryData();
			const version = store.invalidationVersion;

			store.$reset();

			expect(store.scopeQuery).toEqual({ scope: 'all' });
			expect(store.conversionQuery).toEqual({ conversionMetric: 'topN', conversionThreshold: 8 });
			expect(store.summaryData).toBeNull();
			expect(store.invalidationVersion).toBe(version + 1);
		});

		it.each([
			[
				'player:updated',
				{
					player: createMockPlayer({ id: 1 }),
				},
			],
			[
				'archetype:created',
				{
					archetype: createMockUiArchetype({ id: 1 }),
				},
			],
			[
				'archetype:keyCardsUpdated',
				{ archetypeId: 1, keyCards: [] },
			],
			[
				'playerList:membersChanged',
				{
					listId: 1,
					action: 'added',
					playerIds: [],
					memberCount: 0,
				},
			],
		])('follows a peer\'s %s', (type, payload) => {
			store.summaryData = makeSummaryData();

			deliver(type as never, payload as never);

			expect(store.summaryData).toBeNull();
		});
	});
});
