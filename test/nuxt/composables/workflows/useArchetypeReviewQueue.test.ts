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
		...mtgPlayer(id, ''),
		gameData: { type: 'op', leader: 'Luffy' } as any,
	};
}

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
			return [
				{
					id: index + 1,
					eventId: 1,
					playerId: player.id,
					name: gameData.deckName,
					colors: gameData.deckColors ?? '',
					archetypeId: gameData.deckReviewed
						? player.archetypeId ?? 999
						: player.archetypeId,
					reviewedAt: gameData.deckReviewed
						? new Date()
						: null,
					isPrimary: true,
				},
			];
		});
	}

	/** Run the composable inside the current test's scope. */
	function makeQueue() {
		syncDecksFromPlayers();
		return scope.run(() => useArchetypeReviewQueue())!;
	}

	// ── allEntries ──

	describe('the queue', () => {
		it('holds each MTG Player with a deck, sorted by deck name', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Zebra'),
				opPlayer(2),
				mtgPlayer(3, 'Alpha'),
				{
					...mtgPlayer(4, 'ignored'),
					gameData: { type: 'mtg', deckName: null },
				},
				{
					...mtgPlayer(5, 'ignored'),
					gameData: { type: 'mtg' },
				},
			];

			const { allEntries } = makeQueue();

			expect(allEntries.value.map(e => [e.player.id, e.displayName])).toEqual([
				[3, 'Alpha'],
				[1, 'Zebra'],
			]);
		});

		it('queues multiple submitted decks for one player independently', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Primary'),
			];
			const { allEntries, reviewedCount } = makeQueue();
			mockPlayerDeckStore.decks = [
				{
					...mockPlayerDeckStore.decks[0],
					id: 10,
					name: 'Primary',
					reviewedAt: null,
				},
				{
					...mockPlayerDeckStore.decks[0],
					id: 20,
					name: 'Finals',
					archetypeId: 5,
					reviewedAt: new Date(),
					isPrimary: false,
				},
			];

			expect(allEntries.value.map(entry => entry.deck.id)).toEqual([10, 20]);
			expect(reviewedCount.value).toBe(1);
		});

		it.each([
			[
				'unreviewed',
				[1, 3],
			],
			[
				'reviewed',
				[2],
			],
			[
				'all',
				[1, 3, 2],
			],
		] as const)('filters to the %s decks, unreviewed first', (filter, expected) => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A', { archetypeId: null, deckReviewed: false }),
				mtgPlayer(2, 'Deck B', { archetypeId: 5, deckReviewed: true }),
				mtgPlayer(3, 'Deck C', { archetypeId: 5, deckReviewed: false }),
			];
			const { filteredQueue, queueFilter } = makeQueue();

			queueFilter.value = filter;

			expect(filteredQueue.value.map(e => e.player.id)).toEqual(expected);
		});

		it.each([
			['no decks', [], 100, 0],
			[
				'no deck reviewed',
				[false, false],
				0,
				0,
			],
			[
				'half the decks reviewed',
				[true, false],
				50,
				1,
			],
			[
				'every deck reviewed',
				[true, true],
				100,
				2,
			],
		])('reports progress with %s', (_, reviewed, percent, reviewedCount) => {
			mockPlayerStore.players = reviewed.map((deckReviewed, i) => mtgPlayer(i + 1, `Deck ${i}`, { deckReviewed }));

			const queue = makeQueue();

			expect(queue.progressPercent.value).toBe(percent);
			expect(queue.reviewedCount.value).toBe(reviewedCount);
		});

		it('counts the Players of each Archetype', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Control', { archetypeId: 1 }),
				mtgPlayer(2, 'Control', { archetypeId: null }),
				mtgPlayer(3, 'Aggro', { archetypeId: 2 }),
				mtgPlayer(4, 'Aggro', { archetypeId: 2 }),
			];

			expect([
				...makeQueue().archetypePlayerCounts.value,
			]).toEqual([
				[1, 1],
				[2, 2],
			]);
		});
	});

	describe('navigation', () => {
		beforeEach(() => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
				mtgPlayer(3, 'Deck C'),
			];
		});

		it('steps through the queue, telling the caller each time', () => {
			const onNavigate = vi.fn();
			const { currentEntry, advance, goBack, queueFilter } = makeQueue();
			queueFilter.value = 'all';
			expect(currentEntry.value?.displayName).toBe('Deck A');

			advance(onNavigate);
			expect(currentEntry.value?.displayName).toBe('Deck B');
			goBack(onNavigate);
			expect(currentEntry.value?.displayName).toBe('Deck A');
			expect(onNavigate).toHaveBeenCalledTimes(2);
		});

		it('starts over when the filter changes', async () => {
			const { currentIndex, advance, queueFilter } = makeQueue();
			advance();

			queueFilter.value = 'all';
			await nextTick();

			expect(currentIndex.value).toBe(0);
		});

		it('stays on the last entry when the filtered queue shrinks under it', async () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
			];
			const { currentEntry, advance } = makeQueue();
			advance();

			mockPlayerDeckStore.decks[1]!.reviewedAt = new Date();
			mockPlayerDeckStore.decks[1]!.archetypeId = 5;
			await nextTick();

			expect(currentEntry.value?.player.id).toBe(1);
		});

		it('keeps a just-reviewed deck on screen until the advance commits', async () => {
			const { currentEntry, prepareAdvance } = makeQueue();
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

	it('loads the current entry\'s deck', async () => {
		const deck = {
			id: 1,
			cards: [
				{
					cardId: 1,
					name: 'Lightning Bolt',
					quantity: 4,
					compartment: 'mainboard',
				},
			],
		};
		mockDeckCache.fetchDeck.mockResolvedValue(deck);
		mockPlayerStore.players = [
			mtgPlayer(1, 'Deck A'),
		];

		const { activeDeck } = makeQueue();
		await nextTick();
		await nextTick();

		expect(mockDeckCache.fetchDeck).toHaveBeenCalledWith(1, 1, expect.any(Date), { deckId: 1 });
		expect(activeDeck.value).toEqual(deck);
	});
});
