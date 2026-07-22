import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockPlayer } from '~~/test/helpers/fixtures';

const mockPlayerStore = {
	players: [
		createMockPlayer({
			id: 1,
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Deck1', deckColors: 'WU' },
		}),
		createMockPlayer({
			id: 2,
			name: 'Bob',
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		}),
	],
};

const mockEventStore = {
	event: createMockEvent(),
	eventId: 1,
};

const mockDeckCache = {
	fetchDeck: vi.fn().mockResolvedValue(null),
	getCachedDeck: vi.fn().mockReturnValue(null),
};

const mockOverlay = {
	create: vi.fn(() => ({ open: vi.fn() })),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckCache', () => () => mockDeckCache);
mockNuxtImport('useOverlay', () => () => mockOverlay);

describe('useFeatureMatchDeckList', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createPlayerData(overrides: Record<string, any> = {}) {
		return computed(() => ({
			name: 'Alice',
			...overrides,
		}));
	}

	it('finds player1ForDeckList by matching name', () => {
		const player1Data = createPlayerData({ name: 'Alice' });
		const player2Data = createPlayerData({ name: 'Bob' });
		const { player1ForDeckList } = useFeatureMatchDeckList(player1Data, player2Data);
		expect(player1ForDeckList.value?.id).toBe(1);
	});

	it('returns null for player not found', () => {
		const player1Data = createPlayerData({ name: 'Unknown' });
		const player2Data = createPlayerData({ name: 'Bob' });
		const { player1ForDeckList } = useFeatureMatchDeckList(player1Data, player2Data);
		expect(player1ForDeckList.value).toBeNull();
	});

	it('reports hasDeckList correctly based on deckName', () => {
		const player1Data = createPlayerData({ name: 'Alice' });
		const player2Data = createPlayerData({ name: 'Bob' });
		const { player1HasDeckList, player2HasDeckList } = useFeatureMatchDeckList(player1Data, player2Data);
		// Alice has deckName set, Bob does not
		expect(player1HasDeckList.value).toBe(true);
		expect(player2HasDeckList.value).toBe(false);
	});

	it('getDeckForCurrentPhase returns deck data from gameData', () => {
		const player1Data = createPlayerData();
		const player2Data = createPlayerData();
		const { getDeckForCurrentPhase } = useFeatureMatchDeckList(player1Data, player2Data);

		// Player 1 (Alice) has deckName = 'Deck1', deckColors = 'WU'
		const result = getDeckForCurrentPhase(1, 'Default', 'WU');
		expect(result.name).toBe('Deck1');
		expect(result.colors).toBe('WU');
	});

	it('getDeckForCurrentPhase returns defaults when player not found', () => {
		const player1Data = createPlayerData();
		const player2Data = createPlayerData();
		const { getDeckForCurrentPhase } = useFeatureMatchDeckList(player1Data, player2Data);

		const result = getDeckForCurrentPhase(999, 'Default', 'WU');
		expect(result.name).toBe('Default');
		expect(result.colors).toBe('WU');
	});

	it('getDeckForCurrentPhase returns defaults when playerId is null', () => {
		const player1Data = createPlayerData();
		const player2Data = createPlayerData();
		const { getDeckForCurrentPhase } = useFeatureMatchDeckList(player1Data, player2Data);

		const result = getDeckForCurrentPhase(null, 'Fallback', null);
		expect(result.name).toBe('Fallback');
	});
});
