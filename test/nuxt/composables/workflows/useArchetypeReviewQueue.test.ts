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
		// Unreviewed decks 1 to 3 in list order, then deck 4 reviewed before deck 5.
		beforeEach(() => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
				mtgPlayer(3, 'Deck C'),
				mtgPlayer(4, 'Deck D', { deckReviewed: true }),
				mtgPlayer(5, 'Deck E', { deckReviewed: true }),
			];
		});

		function makeReviewQueue() {
			const queue = makeQueue();
			mockPlayerDeckStore.decks[3]!.reviewedAt = new Date('2026-01-01');
			mockPlayerDeckStore.decks[4]!.reviewedAt = new Date('2026-01-02');
			return queue;
		}

		function review(deckId: number) {
			const deck = mockPlayerDeckStore.decks.find(entry => entry.id === deckId)!;
			deck.archetypeId = 9;
			deck.reviewedAt = new Date();
		}

		function removeDeck(deckId: number) {
			mockPlayerDeckStore.decks = mockPlayerDeckStore.decks.filter(entry => entry.id !== deckId);
		}

		const shown = (queue: ReturnType<typeof makeQueue>) => queue.currentEntry.value?.deck.id ?? null;

		it('lists reviewed decks most recently reviewed first, after the unreviewed', () => {
			const queue = makeReviewQueue();

			queue.queueFilter.value = 'all';

			expect(queue.filteredQueue.value.map(entry => entry.deck.id)).toEqual([1, 2, 3, 5, 4]);
		});

		it('steps forward through its list to the last deck', () => {
			const queue = makeReviewQueue();
			const seen = [
				shown(queue),
			];

			for (let step = 0; step < 3; step++) {
				queue.advance();
				seen.push(shown(queue));
			}

			expect(seen).toEqual([1, 2, 3, 3]);
			expect(queue.canAdvance.value).toBe(false);
		});

		it('has nothing to go back to before a second deck is shown', () => {
			const queue = makeReviewQueue();

			queue.goBack();

			expect(queue.canGoBack.value).toBe(false);
			expect(shown(queue)).toBe(1);
		});

		it('goes back to the deck just reviewed, though its list no longer holds it', async () => {
			const queue = makeReviewQueue();
			const transition = queue.prepareAdvance();
			review(1);
			transition.commit();
			await nextTick();
			expect(shown(queue)).toBe(2);

			queue.goBack();

			expect(shown(queue)).toBe(1);
			expect(queue.queueFilter.value).toBe('unreviewed');
			expect(queue.currentIndex.value).toBe(-1);
		});

		it('retraces its steps forward, then carries on through the list', () => {
			const queue = makeReviewQueue();
			queue.advance();
			queue.goBack();
			const seen = [
				shown(queue),
			];

			queue.advance();
			seen.push(shown(queue));
			queue.advance();
			seen.push(shown(queue));

			expect(seen).toEqual([1, 2, 3]);
		});

		it('forgets the way forward once another deck is picked', () => {
			const queue = makeReviewQueue();
			queue.advance();
			queue.goBack();
			queue.jumpToDeck(5);

			queue.goBack();
			queue.advance();

			expect(shown(queue)).toBe(5);
		});

		it('passes over a deck the Event no longer holds', async () => {
			const queue = makeReviewQueue();
			queue.advance();
			queue.advance();
			removeDeck(2);
			await nextTick();

			queue.goBack();

			expect(shown(queue)).toBe(1);
		});

		it('resumes its list where it left it, from a deck outside the list', () => {
			const queue = makeReviewQueue();
			queue.advance();
			queue.jumpToDeck(5);

			queue.advance();

			expect(shown(queue)).toBe(2);
		});

		it.each([
			['keeps the deck shown when the new list holds it', 'all', 2],
			['shows the new list\'s first deck when it does not', 'reviewed', 5],
		] as const)('%s, on a change of filter', async (_, filter, deckId) => {
			const queue = makeReviewQueue();
			queue.advance();

			queue.queueFilter.value = filter;
			await nextTick();

			expect(shown(queue)).toBe(deckId);
		});

		it('shows no deck for an empty list, and goes back to the deck it left', async () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
			];
			const queue = makeQueue();

			queue.queueFilter.value = 'reviewed';
			await nextTick();
			expect(shown(queue)).toBeNull();

			queue.goBack();

			expect(shown(queue)).toBe(1);
		});

		it('stays on the deck shown when its list loses it', async () => {
			const queue = makeReviewQueue();
			queue.advance();

			review(2);
			await nextTick();

			expect(shown(queue)).toBe(2);
		});

		it('shows the deck now at that place when the Event loses the deck shown', async () => {
			const queue = makeReviewQueue();
			queue.advance();

			removeDeck(2);
			await nextTick();

			expect(shown(queue)).toBe(3);
		});

		it.each([
			['the next deck of its list', 1, 2],
			['the deck now last in its list, after its last deck', 3, 2],
		])('advances from a reviewed deck to %s', async (_, deckId, nextDeckId) => {
			const queue = makeReviewQueue();
			queue.jumpToDeck(deckId);

			const transition = queue.prepareAdvance();
			review(deckId);
			await nextTick();
			expect(shown(queue)).toBe(deckId);
			transition.commit();
			await nextTick();

			expect(shown(queue)).toBe(nextDeckId);
		});

		it('shows no deck once its list\'s only deck is reviewed, and goes back to it', async () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
			];
			const queue = makeQueue();

			const transition = queue.prepareAdvance();
			review(1);
			transition.commit();
			await nextTick();
			expect(shown(queue)).toBeNull();

			queue.goBack();

			expect(shown(queue)).toBe(1);
		});
	});

	describe('jumping to a deck', () => {
		it.each([
			['a deck in its list', 2, true, 2],
			['a deck outside its list', 3, true, 3],
			[
				'no deck the Event does not hold',
				999,
				false,
				1,
			],
		])('shows %s, keeping the filter', (_, deckId, found, shownDeckId) => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
				mtgPlayer(3, 'Deck C', { deckReviewed: true }),
			];
			const { currentEntry, queueFilter, canGoBack, jumpToDeck } = makeQueue();

			expect(jumpToDeck(deckId)).toBe(found);

			expect(currentEntry.value?.deck.id).toBe(shownDeckId);
			expect(queueFilter.value).toBe('unreviewed');
			expect(canGoBack.value).toBe(found);
		});

		it('leaves nothing to go back to when the page opens on the deck', () => {
			mockPlayerStore.players = [
				mtgPlayer(1, 'Deck A'),
				mtgPlayer(2, 'Deck B'),
			];
			const { currentEntry, canGoBack, jumpToDeck } = makeQueue();

			jumpToDeck(2, { history: false });

			expect(currentEntry.value?.deck.id).toBe(2);
			expect(canGoBack.value).toBe(false);
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
