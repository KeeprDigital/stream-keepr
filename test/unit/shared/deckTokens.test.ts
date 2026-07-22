import { describe, expect, it } from 'vitest';
import { deriveDeckTokensFromScryfallCard, uniqueDeckTokens } from '~~/shared/utils/deckTokens';

describe('deck token derivation', () => {
	it('detects linked token parts from Scryfall all_parts', () => {
		expect(deriveDeckTokensFromScryfallCard({
			all_parts: [
				{ id: 'source', component: 'combo_piece', name: 'Source Card' },
				{ id: 'treasure-token', component: 'token', name: 'Treasure Token', type_line: 'Token Artifact — Treasure', uri: 'https://api.scryfall.com/cards/treasure-token' },
				{ id: 'soldier-token', component: 'token', name: 'Soldier Token', type_line: 'Token Creature — Soldier', uri: 'https://api.scryfall.com/cards/soldier-token' },
			],
		})).toEqual([
			{
				id: 'treasure-token',
				scryfallId: 'treasure-token',
				name: 'Treasure Token',
				typeLine: 'Token Artifact — Treasure',
				uri: 'https://api.scryfall.com/cards/treasure-token',
			},
			{
				id: 'soldier-token',
				scryfallId: 'soldier-token',
				name: 'Soldier Token',
				typeLine: 'Token Creature — Soldier',
				uri: 'https://api.scryfall.com/cards/soldier-token',
			},
		]);
	});

	it('deduplicates tokens by name', () => {
		expect(uniqueDeckTokens([
			{ id: 'treasure-a', scryfallId: 'treasure-a', name: 'Treasure Token', typeLine: 'Token Artifact — Treasure', uri: null },
			{ id: 'treasure-b', scryfallId: 'treasure-b', name: 'Treasure Token', typeLine: 'Token Artifact — Treasure', uri: null },
			{ id: 'clue', scryfallId: 'clue', name: 'Clue Token', typeLine: 'Token Artifact — Clue', uri: null },
		])).toEqual([
			{ id: 'clue', scryfallId: 'clue', name: 'Clue Token', typeLine: 'Token Artifact — Clue', uri: null },
			{ id: 'treasure-a', scryfallId: 'treasure-a', name: 'Treasure Token', typeLine: 'Token Artifact — Treasure', uri: null },
		]);
	});
});
