import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMatches = [
	{
		id: 1,
		player1Data: {
			name: 'Alice',
			gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		},
		player2Data: {
			name: 'Bob',
			gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
		},
	},
	{
		id: 2,
		player1Data: { name: 'Charlie', gameData: null },
		player2Data: { name: 'Diana', gameData: { type: 'mtg', deckName: 'Golgari Midrange', deckColors: 'BG' } },
	},
	{
		id: 3,
		player1Data: null,
		player2Data: null,
	},
];

mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: mockMatches,
}));

describe('useFeatureMatchMenuItems', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns menu items for each match', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value).toHaveLength(3);
	});

	it('formats label with match number and player names', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value[0]!.label).toBe('Match 1 — Alice vs Bob');
		expect(items.value[1]!.label).toBe('Match 2 — Charlie vs Diana');
	});

	it('includes value as match ID', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value[0]!.value).toBe(1);
		expect(items.value[1]!.value).toBe(2);
		expect(items.value[2]!.value).toBe(3);
	});

	it('includes player deck names and colors', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value[0]!.player1DeckName).toBe('Azorius Control');
		expect(items.value[0]!.player1Colors).toBe('WU');
		expect(items.value[0]!.player2DeckName).toBe('Mono Red');
		expect(items.value[0]!.player2Colors).toBe('R');
	});

	it('handles missing deck data gracefully', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value[1]!.player1DeckName).toBeNull();
		expect(items.value[1]!.player1Colors).toBeNull();
		expect(items.value[1]!.player2DeckName).toBe('Golgari Midrange');
		expect(items.value[1]!.player2Colors).toBe('BG');
	});

	it('handles null player data gracefully', () => {
		const items = useFeatureMatchMenuItems();
		expect(items.value[2]!.player1Name).toBeNull();
		expect(items.value[2]!.player1DeckName).toBeNull();
		expect(items.value[2]!.player1Colors).toBeNull();
		expect(items.value[2]!.player2Name).toBeNull();
		expect(items.value[2]!.player2DeckName).toBeNull();
		expect(items.value[2]!.player2Colors).toBeNull();
	});
});
