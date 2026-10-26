import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';

const modal = {
	open: vi.fn(),
	patch: vi.fn(),
};
const overlay = {
	create: vi.fn(() => modal),
};
const eventStore = reactive({ eventId: 1 as number | null });
const deckCache = {
	getDeckLists: vi.fn(),
	fetchDecks: vi.fn(),
};

function deckList(name: string) {
	return { deckId: 1, externalId: `deck-${name}`, formatExternalId: 'modern', phaseIds: [1], phaseName: null, name, colors: 'R', isPrimary: true, cards: [] };
}

mockNuxtImport('useOverlay', () => () => overlay);
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerDeckCache', () => () => deckCache);

const player = (id: number, name: string) => ({ id, name, updatedAt: new Date('2026-02-01') }) as never;

describe('usePlayerDeckListModal', () => {
	beforeEach(() => {
		eventStore.eventId = 1;
		deckCache.getDeckLists.mockReturnValue([]);
		deckCache.fetchDecks.mockResolvedValue(undefined);
	});

	it('shows a Player\'s cached deck lists at once, fetching nothing', async () => {
		const cached = [deckList('Main')];
		deckCache.getDeckLists.mockReturnValue(cached);

		await usePlayerDeckListModal().openPlayerDeckList(player(7, 'Alice'));

		expect(modal.open).toHaveBeenCalledWith({ playerName: 'Alice', playerId: 7, deckLists: cached, loading: false });
		expect(deckCache.fetchDecks).not.toHaveBeenCalled();
	});

	it('opens loading for an uncached Player, then fills in what the fetch brought', async () => {
		const fetched = [deckList('Fetched')];
		deckCache.getDeckLists.mockReturnValueOnce([]).mockReturnValueOnce(fetched);

		await usePlayerDeckListModal().openPlayerDeckList(player(8, 'Bob'));

		expect(modal.open).toHaveBeenCalledWith(expect.objectContaining({ playerId: 8, deckLists: [], loading: true }));
		expect(deckCache.fetchDecks).toHaveBeenCalledWith(8, 1, new Date('2026-02-01'));
		expect(modal.patch).toHaveBeenCalledWith({ deckLists: fetched, loading: false });
	});

	it('drops a fetch that a later Player\'s opening overtook', async () => {
		const bobFetch = deferred();
		deckCache.fetchDecks.mockReturnValueOnce(bobFetch.promise);
		const { openPlayerDeckList } = usePlayerDeckListModal();

		const bob = openPlayerDeckList(player(8, 'Bob'));
		await openPlayerDeckList(player(9, 'Cara'));
		modal.patch.mockClear();
		bobFetch.resolve();
		await bob;

		expect(modal.patch).not.toHaveBeenCalled();
	});
});
