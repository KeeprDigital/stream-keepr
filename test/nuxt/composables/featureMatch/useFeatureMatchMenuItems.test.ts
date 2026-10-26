import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';

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
		player2Data: null,
	},
];

mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: mockMatches }));

describe('useFeatureMatchMenuItems', () => {
	it('offers each Feature Match Slot with its Players and their decks', () => {
		expect(useFeatureMatchMenuItems().value[0]).toMatchObject({
			value: 1,
			label: 'Match 1 — Alice vs Bob',
			player1DeckName: 'Azorius Control',
			player1Colors: 'WU',
			player2DeckName: 'Mono Red',
			player2Colors: 'R',
		});
	});

	it('leaves blank what a Slot does not hold', () => {
		expect(useFeatureMatchMenuItems().value[1]).toMatchObject({
			value: 2,
			player1Name: 'Charlie',
			player1DeckName: null,
			player1Colors: null,
			player2Name: null,
			player2DeckName: null,
		});
	});
});
