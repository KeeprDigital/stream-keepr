import { describe, expect, it } from 'vitest';
import { featureMatchDeckListView } from '~~/server/modules/feature-match-deck-list/paste';
import {
	FEATURE_MATCH_SAMPLE_CONTEXT,
	FEATURE_MATCH_SAMPLE_TOKEN_VALUES,
	featureMatchSampleDataset,
	featureMatchSampleDatasetIsComplete,
	OP_FEATURE_MATCH_SAMPLE_SIDES,
} from '~~/shared/featureMatchSampleDataset';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { GAME_VALUES } from '~~/shared/types/enums';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';

// What matters about the canonical preview dataset is not its values but that it
// covers every token and is awkward in the ways real data is.
describe('the canonical Feature Match sample dataset', () => {
	it.each(GAME_VALUES)('covers every entry of the Feature Match token binding catalogue for %s', (game) => {
		const { tokenValues } = featureMatchSampleDataset(game);
		const missing = FEATURE_MATCH_TOKEN_KEYS.filter(key => !(key in tokenValues));

		expect(missing).toEqual([]);
		expect(featureMatchSampleDatasetIsComplete()).toBe(true);
	});

	it('samples a Magic Match awkward in the ways real ones are', () => {
		const { player1, player2, bestOf } = FEATURE_MATCH_SAMPLE_CONTEXT;
		const player1Name = String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name);

		// A long name, longer than its opponent's.
		expect(player1Name.length).toBeGreaterThan(20);
		expect(player1Name.length).toBeGreaterThan(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player2Name).length);
		// A record with a draw in it, the longer of the two shapes.
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Record).split('-')).toHaveLength(3);
		// A Match partway through, with differing life totals.
		expect(player1.gameWins).toBeGreaterThan(0);
		expect(player1.gameWins + player2.gameWins).toBeLessThan(bestOf);
		expect(player1.lifeTotal).not.toBe(player2.lifeTotal);
		// Full, differently-shaped fifteen-card sideboards with no remote art.
		for (const player of [player1, player2]) {
			expect(player.sideboard!.reduce((total, card) => total + card.quantity, 0)).toBe(15);
			expect(player.sideboard!.every(card => card.imageUrl === null)).toBe(true);
		}
		expect(player1.sideboard!.length).not.toBe(player2.sideboard!.length);
		expect(Math.max(...player1.sideboard!.map(card => card.name.length))).toBeGreaterThan(20);
	});

	it('samples a One Piece Match by its Leaders, with a long name beside a short one', () => {
		const { tokenValues, context } = featureMatchSampleDataset('op');

		expect(String(tokenValues.player1Name).length).toBeGreaterThan(20);
		expect(String(tokenValues.player1Name).length).toBeGreaterThan(String(tokenValues.player2Name).length);
		expect(tokenValues).toMatchObject({
			player1Deck: 'Monkey.D.Luffy',
			player1DeckColors: 'Purple',
			player1LeaderImage: 'https://cards-img.keepr.digital/OP05-060.png',
			player2Deck: 'Enel',
			player2DeckColors: 'Yellow',
			player2LeaderImage: 'https://cards-img.keepr.digital/OP05-098.png',
			format: 'One Piece',
		});
		// No life or sideboard is tracked, and a One Piece Match is best-of-one.
		expect(context).toMatchObject({
			bestOf: 1,
			player1: { lifeTotal: null, sideboard: null },
			player2: { lifeTotal: null, sideboard: null },
		});
	});

	// A preview showing deck rule warnings would teach an operator nothing about their Theme.
	it('holds a One Piece Deck List that breaks no deck rule, imaged from the Printing host', () => {
		const [player1] = OP_FEATURE_MATCH_SAMPLE_SIDES;
		const view = featureMatchDeckListView(player1.deckList);

		expect(view.warnings).toEqual([]);
		expect(view).toMatchObject({ leaderNumber: player1.leader.number, mainboardCount: 50 });
		expect(player1.deckList.every(entry => entry.card && isOpCardImageUrl(entry.card.imageUrl))).toBe(true);
	});
});
