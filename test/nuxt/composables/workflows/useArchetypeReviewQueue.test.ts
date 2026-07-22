import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

// ── Mock stores ──

const mockPlayerStore = reactive({
	players: [] as any[],
	isLoaded: false,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
});

const mockEventStore = reactive({
	eventId: 1 as number | null,
	$reset: vi.fn(),
});

const mockArchetypeStore = reactive({
	archetypes: [] as any[],
	$reset: vi.fn(),
});

const mockPlayerDeckStore = reactive({
	decks: [] as any[],
});

const mockDeckCache = {
	fetchDeck: vi.fn().mockResolvedValue(null),
};

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useArchetypeStore', () => () => mockArchetypeStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('usePlayerDeckCache', () => () => mockDeckCache);

// ── Helpers ──

function mtgPlayer(id: number, deckName: string, opts?: {
	archetypeId?: number | null;
	deckColors?: string;
	deckReviewed?: boolean | null;
}) {
	return {
		id,
		eventId: 1,
		name: `Player ${id}`,
		gameData: {
			type: 'mtg',
			deckName,
			deckColors: opts?.deckColors ?? 'W',
			deckReviewed: opts?.deckReviewed,
		} as any,
		archetypeId: opts?.archetypeId ?? null,
		wins: null,
		losses: null,
		draws: null,
		position: null,
		points: null,
		pronouns: null,
		externalId: null,
		externalSource: null,
		lgs: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function opPlayer(id: number) {
	return {
		id,
		eventId: 1,
		name: `Player ${id}`,
		gameData: { type: 'op', leader: 'Luffy' } as any,
		archetypeId: null,
		wins: null,
		losses: null,
		draws: null,
		position: null,
		points: null,
		pronouns: null,
		externalId: null,
		externalSource: null,
		lgs: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

// ── Tests ──

describe('useArchetypeReviewQueue', () => {
	// Each test gets a fresh effectScope so watchers don't accumulate across tests
	let scope: ReturnType<typeof effectScope>;

	beforeEach(() => {
		scope = effectScope();
		mockPlayerStore.players = [];
		mockArchetypeStore.archetypes = [];
		mockPlayerDeckStore.decks = [];
		vi.clearAllMocks();
	});

	afterEach(() => {
		scope.stop();
	});

	function syncDecksFromPlayers() {
		mockPlayerDeckStore.decks = mockPlayerStore.players.flatMap((player, index) => {
			const gameData = player.gameData;
			if (gameData?.type !== 'mtg' || !gameData.deckName)
				return [];
			return [{
				id: index + 1,
				eventId: 1,
				playerId: player.id,
				name: gameData.deckName,
				colors: gameData.deckColors ?? '',
				archetypeId: gameData.deckReviewed ? player.archetypeId ?? 999 : player.archetypeId,
				reviewedAt: gameData.deckReviewed ? new Date() : null,
				isPrimary: true,
			}];
		});
	}

	/** Run the composable inside the current test's scope. */
	function makeQueue() {
		syncDecksFromPlayers();
		return scope.run(() => useArchetypeReviewQueue())!;
	}

	// ── allEntries ──

	describe('allEntries', () => {
		it('only includes MTG players, skips OP and others', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				opPlayer(2),
				mtgPlayer(3, 'Deck B'),
			];
			const { allEntries } = makeQueue();
			expect(allEntries.value).toHaveLength(2);
			expect(allEntries.value.map(e => e.player.id)).toEqual([1, 3]);
		});

		it('sorts entries within same review status alphabetically by deckName', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Zebra'),
				mtgPlayer(2, 'Alpha'),
				mtgPlayer(3, 'Monkey'),
			];
			const { allEntries } = makeQueue();
			expect(allEntries.value.map(e => e.displayName)).toEqual(['Alpha', 'Monkey', 'Zebra']);
		});

		it('excludes MTG players with no deckName', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				{ ...mtgPlayer(2, 'ignored'), gameData: { type: 'mtg', deckName: null } },
				{ ...mtgPlayer(3, 'ignored'), gameData: { type: 'mtg' } },
			];
			const { allEntries } = makeQueue();
			expect(allEntries.value).toHaveLength(1);
			expect(allEntries.value[0]!.player.id).toBe(1);
		});

		it('returns empty array when no players', () => {
			mockPlayerStore.players = [];
			const { allEntries } = makeQueue();
			expect(allEntries.value).toHaveLength(0);
		});

		it('queues multiple submitted decks for one player independently', () => {
			mockPlayerStore.players = [mtgPlayer(1, 'Primary')];
			const { allEntries, reviewedCount } = makeQueue();
			mockPlayerDeckStore.decks = [
				{ ...mockPlayerDeckStore.decks[0], id: 10, name: 'Primary', reviewedAt: null },
				{ ...mockPlayerDeckStore.decks[0], id: 20, name: 'Finals', archetypeId: 5, reviewedAt: new Date(), isPrimary: false },
			];

			expect(allEntries.value.map(entry => entry.deck.id)).toEqual([10, 20]);
			expect(reviewedCount.value).toBe(1);
		});
	});

	// ── filteredQueue ──

	describe('filteredQueue', () => {
		beforeEach(() => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { archetypeId: null, deckReviewed: false }),
				mtgPlayer(2, 'Deck B', { archetypeId: 5, deckReviewed: true }),
				mtgPlayer(3, 'Deck C', { archetypeId: 5, deckReviewed: false }),
			];
		});

		it('filter=\'unreviewed\' returns only players whose deck is not reviewed', () => {
			const { filteredQueue, queueFilter } = makeQueue();
			queueFilter.value = 'unreviewed';
			expect(filteredQueue.value.map(e => e.player.id)).toEqual([1, 3]);
		});

		it('filter=\'reviewed\' returns only reviewed decks', () => {
			const { filteredQueue, queueFilter } = makeQueue();
			queueFilter.value = 'reviewed';
			expect(filteredQueue.value.map(e => e.player.id)).toEqual([2]);
		});

		it('filter=\'all\' returns all MTG entries', () => {
			const { filteredQueue, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			expect(filteredQueue.value).toHaveLength(3);
		});
	});

	// ── currentEntry ──

	describe('currentEntry', () => {
		it('returns the entry at currentIndex', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
			];
			const { currentEntry, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			expect(currentEntry.value?.displayName).toBe('Deck A');
		});
	});

	// ── advance / goBack ──

	describe('advance', () => {
		beforeEach(() => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
				mtgPlayer(3, 'Deck C'),
			];
		});

		it('increments currentIndex', () => {
			const { currentIndex, advance, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			advance();
			expect(currentIndex.value).toBe(1);
		});

		it('calls the onNavigate callback when advancing', () => {
			const callback = vi.fn();
			const { advance, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			advance(callback);
			expect(callback).toHaveBeenCalledOnce();
		});
	});

	describe('goBack', () => {
		beforeEach(() => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
			];
		});

		it('decrements currentIndex', () => {
			const { currentIndex, advance, goBack, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			advance();
			expect(currentIndex.value).toBe(1);
			goBack();
			expect(currentIndex.value).toBe(0);
		});

		it('calls the onNavigate callback when going back', () => {
			const callback = vi.fn();
			const { advance, goBack, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			advance();
			goBack(callback);
			expect(callback).toHaveBeenCalledOnce();
		});
	});

	// ── queueFilter watch ──

	describe('queueFilter change', () => {
		it('resets currentIndex to 0 when filter changes', async () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { archetypeId: null }),
				mtgPlayer(2, 'Deck B', { archetypeId: null }),
			];
			const { currentIndex, advance, queueFilter } = makeQueue();
			queueFilter.value = 'unreviewed';
			advance();
			expect(currentIndex.value).toBe(1);

			queueFilter.value = 'all';
			await nextTick();
			expect(currentIndex.value).toBe(0);
		});

		it('clamps currentIndex when the filtered queue shrinks', async () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { archetypeId: null }),
				mtgPlayer(2, 'Deck B', { archetypeId: null }),
			];

			const { currentEntry, currentIndex, advance, queueFilter } = makeQueue();
			queueFilter.value = 'unreviewed';
			advance();
			expect(currentIndex.value).toBe(1);

			mockPlayerDeckStore.decks[1]!.reviewedAt = new Date();
			mockPlayerDeckStore.decks[1]!.archetypeId = 5;
			await nextTick();

			expect(currentIndex.value).toBe(0);
			expect(currentEntry.value?.player.id).toBe(1);
		});
	});

	// ── archetypePlayerCounts ──

	describe('archetypePlayerCounts', () => {
		it('counts players by archetype id', () => {
			mockArchetypeStore.archetypes = [
				{ id: 1, name: 'Control' },
				{ id: 2, name: 'Aggro' },
			];
			mockPlayerStore.players = [
				mtgPlayer(1, 'Control', { archetypeId: 1 }),
				mtgPlayer(2, 'Control', { archetypeId: null }),
				mtgPlayer(3, 'Aggro', { archetypeId: 2 }),
			];
			const { archetypePlayerCounts } = makeQueue();
			expect(archetypePlayerCounts.value.get(1)).toBe(1);
			expect(archetypePlayerCounts.value.get(2)).toBe(1);
		});

		it('excludes players without an archetypeId', () => {
			mockArchetypeStore.archetypes = [{ id: 1, name: 'Control' }];
			mockPlayerStore.players = [
				mtgPlayer(1, 'Control', { archetypeId: null }),
			];
			const { archetypePlayerCounts } = makeQueue();
			expect(archetypePlayerCounts.value.has(1)).toBe(false);
		});

		it('returns empty map when no players', () => {
			mockPlayerStore.players = [];
			const { archetypePlayerCounts } = makeQueue();
			expect(archetypePlayerCounts.value.size).toBe(0);
		});
	});

	// ── deck loading ──
	// Each test in this block uses its own effectScope so watchers from previous
	// tests don't accumulate and skew fetchDeck call counts.

	describe('deck loading', () => {
		let scope: ReturnType<typeof effectScope>;

		beforeEach(() => {
			scope = effectScope();
		});

		afterEach(() => {
			scope.stop();
		});

		function makeQueue() {
			syncDecksFromPlayers();
			return scope.run(() => useArchetypeReviewQueue())!;
		}

		it('fetchDeck called when currentEntry changes', async () => {
			mockDeckCache.fetchDeck.mockResolvedValue(null);
			mockPlayerStore.players = [mtgPlayer(1, 'Deck A')];

			makeQueue();
			await nextTick();
			await nextTick();

			expect(mockDeckCache.fetchDeck).toHaveBeenCalledWith(
				1,
				1,
				expect.any(Date),
				{ deckId: 1 },
			);
		});

		it('fetchDeck called on every navigation; module-level cache handles deduplication', async () => {
			mockDeckCache.fetchDeck.mockResolvedValue({ id: 1, cards: [] });
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
			];

			const { advance, goBack, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			await nextTick();
			await nextTick();

			expect(mockDeckCache.fetchDeck).toHaveBeenCalledTimes(1);

			advance();
			await nextTick();
			await nextTick();

			expect(mockDeckCache.fetchDeck).toHaveBeenCalledTimes(2);

			// Back to player 1 — fetchDeck called again; usePlayerDeckCache returns
			// immediately from its module-level cache when updatedAt is unchanged
			goBack();
			await nextTick();
			await nextTick();

			expect(mockDeckCache.fetchDeck).toHaveBeenCalledTimes(3);
		});

		it('activeDeck populated after fetch resolves', async () => {
			const mockDeck = { id: 1, cards: [{ cardId: 1, name: 'Lightning Bolt', scryfallId: null, cardType: 'Instant', colors: 'R', cmc: 1, quantity: 4, compartment: 'mainboard', sortOrder: 0 }] };
			mockDeckCache.fetchDeck.mockResolvedValue(mockDeck);
			mockPlayerStore.players = [mtgPlayer(1, 'Deck A')];

			const { activeDeck, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			await nextTick();
			await nextTick();

			expect(activeDeck.value).toEqual(mockDeck);
		});

		it('prepareAdvance pins the current deck until commit in unreviewed queue', async () => {
			mockDeckCache.fetchDeck.mockResolvedValue({ id: 1, cards: [] });
			mockPlayerStore.players = [mtgPlayer(1, 'Deck A'), mtgPlayer(2, 'Deck B')];

			const { currentEntry, prepareAdvance } = makeQueue();
			await nextTick();
			await nextTick();

			const transition = prepareAdvance();
			mockPlayerStore.players[0]!.archetypeId = 55;
			await nextTick();

			expect(currentEntry.value?.player.id).toBe(1);

			transition.commit();
			await nextTick();

			expect(currentEntry.value?.player.id).toBe(2);
		});
	});

	// ── Progress stats ──

	describe('progress stats', () => {
		it('progressPercent is 100 when totalDecks is 0 (no division by zero)', () => {
			mockPlayerStore.players = [];
			const { progressPercent } = makeQueue();
			expect(progressPercent.value).toBe(100);
		});

		it('progressPercent is 0 when no decks are reviewed', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { archetypeId: null }),
				mtgPlayer(2, 'Deck B', { archetypeId: null }),
			];
			const { progressPercent } = makeQueue();
			expect(progressPercent.value).toBe(0);
		});

		it('progressPercent is 100 when all decks are reviewed', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { deckReviewed: true }),
				mtgPlayer(2, 'Deck B', { deckReviewed: true }),
			];
			const { progressPercent } = makeQueue();
			expect(progressPercent.value).toBe(100);
		});

		it('progressPercent is 50 when half are reviewed', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { deckReviewed: true }),
				mtgPlayer(2, 'Deck B', { deckReviewed: false }),
			];
			const { progressPercent } = makeQueue();
			expect(progressPercent.value).toBe(50);
		});

		it('reviewedCount reflects only entries with reviewedAt set', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { deckReviewed: true }),
				mtgPlayer(2, 'Deck B', { deckReviewed: false }),
				mtgPlayer(3, 'Deck C', { deckReviewed: true }),
			];
			const { reviewedCount, totalDecks } = makeQueue();
			expect(totalDecks.value).toBe(3);
			expect(reviewedCount.value).toBe(2);
		});
	});
});
