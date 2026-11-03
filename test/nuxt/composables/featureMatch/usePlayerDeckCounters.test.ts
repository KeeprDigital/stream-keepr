import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockPlayer } from '~~/test/helpers/fixtures';
import { usePlayerDeckCounters } from '~/composables/featureMatch/usePlayerDeckCounters';

const ana = createMockPlayer({
	id: 21,
	name: 'Ana',
	gameData: { type: 'mtg', deckName: 'Toxic' },
});
const ben = createMockPlayer({
	id: 22,
	name: 'Ben',
	gameData: { type: 'mtg', deckName: 'Energy' },
});
const counterTypesByPlayer: Record<number, string[]> = {
	21: ['poison'],
	22: ['energy'],
};

mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	displayEvent: createMockEvent({ game: 'mtg' }),
}));
mockNuxtImport('usePlayerStore', () => () => ({
	players: [ana, ben],
	getPlayerById: vi.fn(),
}));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: async (playerId: number) => ({
		cards: [
			{ deckCounterTypes: counterTypesByPlayer[playerId] },
		],
	}),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: [
		{
			id: 1,
			player1Id: 21,
			player2Id: 22,
			player1Data: { name: 'Ana' },
			player2Data: { name: 'Ben' },
			activeSession: null,
		},
	],
}));
// The followed Session, swapped: Ben sits on player1's side.
mockNuxtImport('useFeatureMatchStateStore', () => () => ({
	sessionIdBySlotId: new Map([
		[1, 90],
	]),
	featureMatchSessions: new Map([
		[
			90,
			{
				sourceSnapshot: {
					playersSwapped: true,
					player1: {
						playerId: 22,
						data: { name: 'Ben' },
					},
					player2: {
						playerId: 21,
						data: { name: 'Ana' },
					},
				},
			},
		],
	]),
}));

describe('usePlayerDeckCounters', () => {
	// The Session owns side order and the Slot keeps pairing order (ADR-0058).
	it.each([
		{ side: 'player1' as const, counter: 'energy' },
		{ side: 'player2' as const, counter: 'poison' },
	])('offers $side the counters of the deck the followed Session seats there', async ({ side, counter }) => {
		const { availableCounterTypes } = usePlayerDeckCounters(1, side);
		await flushPromises();

		expect(availableCounterTypes.value?.map(config => config.key)).toEqual([counter]);
	});
});
