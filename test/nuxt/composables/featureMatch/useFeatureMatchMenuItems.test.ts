import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAW, ZORO } from '~~/test/helpers/opCards';
import { createFollowedFeatureMatchSessions, followNoSession, followSwappedSession } from '~~/test/nuxt/helpers/followedFeatureMatchSession';

const alice = {
	name: 'Alice',
	gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
};
const bob = {
	name: 'Bob',
	gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
};
const ana = {
	name: 'Ana',
	gameData: { type: 'op', leader: ZORO },
};
const ben = {
	name: 'Ben',
	gameData: { type: 'op', leader: LAW },
};

const mockMatches = [
	{
		id: 1,
		player1Id: 11,
		player1Data: alice,
		player2Id: 12,
		player2Data: bob,
	},
	{
		id: 2,
		player1Data: { name: 'Charlie', gameData: null },
		player2Data: null,
	},
	// A One Piece Slot seats typed players, with no Player ids (ADR-0057).
	{
		id: 3,
		player1Id: null,
		player1Data: ana,
		player2Id: null,
		player2Data: ben,
	},
];

const followed = createFollowedFeatureMatchSessions();

mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: mockMatches }));
mockNuxtImport('useFeatureMatchStateStore', () => () => followed);

describe('useFeatureMatchMenuItems', () => {
	beforeEach(() => {
		followNoSession(followed);
	});

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

	// The followed Session owns which side each player sits on (ADR-0058).
	it.each([
		{
			game: 'MTG',
			slot: 1,
			session: 'no',
			label: 'Match 1 — Alice vs Bob',
			player1Name: 'Alice',
			player1DeckName: 'Azorius Control',
		},
		{
			game: 'MTG',
			slot: 1,
			session: 'a swapped',
			label: 'Match 1 — Bob vs Alice',
			player1Name: 'Bob',
			player1DeckName: 'Mono Red',
		},
		{
			game: 'OP',
			slot: 3,
			session: 'no',
			label: 'Match 3 — Ana vs Ben',
			player1Name: 'Ana',
			player1DeckName: null,
		},
		{
			game: 'OP',
			slot: 3,
			session: 'a swapped',
			label: 'Match 3 — Ben vs Ana',
			player1Name: 'Ben',
			player1DeckName: null,
		},
	])('names a $game Slot\'s players in the order $session Session seats them', ({ game: _game, slot, session, ...named }) => {
		if (session === 'a swapped')
			followSwappedSession(followed, mockMatches.find(match => match.id === slot)!);

		expect(useFeatureMatchMenuItems().value.find(item => item.value === slot)).toMatchObject(named);
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
