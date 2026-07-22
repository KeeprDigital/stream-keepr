import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

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

function deckList(overrides = {}) {
	return {
		deckId: 1,
		externalId: 'deck-1',
		formatExternalId: 'modern',
		phaseIds: [1],
		phaseName: null,
		name: 'Main',
		colors: 'R',
		isPrimary: true,
		cards: [],
		...overrides,
	};
}

mockNuxtImport('useOverlay', () => () => overlay);
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerDeckCache', () => () => deckCache);

describe('usePlayerDeckListModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		eventStore.eventId = 1;
		deckCache.getDeckLists.mockReturnValue([]);
		deckCache.fetchDecks.mockResolvedValue(undefined);
	});

	it('opens explicit deck lists without forcing loading', () => {
		const deckLists = [deckList()];
		const { openDeckLists } = usePlayerDeckListModal();

		openDeckLists({ playerName: 'Alice', playerId: 7, deckLists });

		expect(overlay.create).toHaveBeenCalledOnce();
		expect(modal.open).toHaveBeenCalledWith({
			playerName: 'Alice',
			playerId: 7,
			deckLists,
			loading: false,
		});
	});

	it('patches the modal after fetching a missing player deck', async () => {
		const fetchedDeckLists = [deckList({ deckId: 2, externalId: 'deck-2', phaseIds: [2], phaseName: 'Finals', name: 'Fetched', colors: 'G' })];
		deckCache.getDeckLists
			.mockReturnValueOnce([])
			.mockReturnValueOnce(fetchedDeckLists);
		const updatedAt = new Date('2026-02-01');
		const { openPlayerDeckList } = usePlayerDeckListModal();

		await openPlayerDeckList({ id: 8, name: 'Bob', updatedAt } as never);

		expect(modal.open).toHaveBeenCalledWith(expect.objectContaining({
			playerName: 'Bob',
			playerId: 8,
			deckLists: [],
			loading: true,
		}));
		expect(deckCache.fetchDecks).toHaveBeenCalledWith(8, 1, updatedAt);
		expect(modal.patch).toHaveBeenCalledWith({ deckLists: fetchedDeckLists, loading: false });
	});
});
