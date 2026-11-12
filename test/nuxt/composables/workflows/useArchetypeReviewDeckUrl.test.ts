import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';

const mockPlayerStore = reactive({ players: [] as any[] });
const mockPlayerDeckStore = reactive({ decks: [] as any[] });

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: vi.fn().mockResolvedValue(null),
}));

// The router is the boundary: a replace lands in the route, as the real one's does.
const route = reactive({ query: {} as Record<string, string> });
const replace = vi.fn(async (to: { query?: Record<string, string | undefined> }) => {
	route.query = Object.fromEntries(
		Object.entries(to.query ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
});
mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useRouter', () => () => ({
	replace,
	// Nuxt's own plugins register these on boot.
	beforeEach: () => () => {},
	beforeResolve: () => () => {},
	afterEach: () => () => {},
	onError: () => () => {},
}));

function deck(id: number, name: string, reviewed = false) {
	return {
		id,
		eventId: 1,
		playerId: id,
		name,
		colors: 'R',
		archetypeId: reviewed ? 50 : null,
		reviewedAt: reviewed
			? new Date()
			: null,
		isPrimary: true,
	};
}

describe('the deck Archetype Review shows, and its URL', () => {
	let scope: ReturnType<typeof effectScope>;

	beforeEach(() => {
		scope = effectScope();
		route.query = {};
		replace.mockClear();
		// Unreviewed decks 1 to 3, in queue order, then the reviewed deck 4.
		mockPlayerDeckStore.decks = [
			deck(1, 'Aggro'),
			deck(2, 'Burn'),
			deck(3, 'Control'),
			deck(4, 'Dredge', true),
		];
		mockPlayerStore.players = mockPlayerDeckStore.decks.map(({ id }) => createMockPlayer({ id, name: `Player ${id}` }));
	});

	afterEach(() => {
		scope.stop();
	});

	/** Opens the page on a URL, its Event Data arriving after its first render. */
	async function arrive(query: Record<string, string> = {}) {
		route.query = query;
		const loading = ref(true);
		const queue = scope.run(() => {
			const reviewQueue = useArchetypeReviewQueue();
			useArchetypeReviewDeckUrl({ loading, queue: reviewQueue });
			return reviewQueue;
		})!;
		await nextTick();
		loading.value = false;
		await nextTick();
		return queue;
	}

	const shownDeckId = (queue: Awaited<ReturnType<typeof arrive>>) => queue.currentEntry.value?.deck.id;

	it.each([
		['an unreviewed deck', '2'],
		['a reviewed deck, outside the default filter', '4'],
	])('opens on %s the URL names', async (_, deckId) => {
		const queue = await arrive({ deckId });

		expect(shownDeckId(queue)).toBe(Number(deckId));
	});

	it('arrives with nothing to go back to', async () => {
		const queue = await arrive({ deckId: '2' });

		expect(queue.canGoBack.value).toBe(false);
	});

	// The queue rebuilds its entries on every Player or deck message: none of them is a request for the URL's deck.
	it('stays on the deck stepped to when the Event\'s data changes', async () => {
		const queue = await arrive({ deckId: '1' });

		queue.advance();
		await nextTick();
		mockPlayerStore.players = mockPlayerStore.players.map(player => ({
			...player,
			updatedAt: new Date(),
		}));
		await nextTick();

		expect(shownDeckId(queue)).toBe(2);
	});

	it.each([
		[
			'stepping',
			(queue: Awaited<ReturnType<typeof arrive>>) => queue.advance(),
			'2',
		],
		[
			'jumping',
			(queue: Awaited<ReturnType<typeof arrive>>) => queue.jumpToDeck(4),
			'4',
		],
	])('names the deck shown after %s', async (_, move, deckId) => {
		const queue = await arrive();

		move(queue);
		await nextTick();

		expect(route.query.deckId).toBe(deckId);
	});

	it('names the deck it opens on when the URL named none', async () => {
		await arrive();

		expect(route.query.deckId).toBe('1');
	});

	it('shows the queue\'s first deck, in its filter, for a URL naming no deck of the Event', async () => {
		const queue = await arrive({ deckId: '999' });

		expect(shownDeckId(queue)).toBe(1);
		expect(queue.queueFilter.value).toBe('unreviewed');
		expect(route.query.deckId).toBe('1');
	});

	it('follows a link to another deck while open', async () => {
		const queue = await arrive({ deckId: '1' });

		route.query = { deckId: '3' };
		await nextTick();

		expect(shownDeckId(queue)).toBe(3);
	});

	it('names no deck once none is shown, keeping the rest of the URL', async () => {
		const queue = await arrive({ tab: 'x' });

		mockPlayerDeckStore.decks = [];
		await nextTick();
		await nextTick();

		expect(queue.currentEntry.value).toBeNull();
		expect(route.query).toEqual({ tab: 'x' });
	});
});
