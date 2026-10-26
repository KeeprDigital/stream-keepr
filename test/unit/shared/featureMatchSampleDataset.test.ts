import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_SAMPLE_CONTEXT,
	FEATURE_MATCH_SAMPLE_TOKEN_VALUES,
	featureMatchSampleDatasetIsComplete,
} from '~~/shared/featureMatchSampleDataset';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';

// What matters about the canonical preview dataset is not its values but that it
// covers every token and is awkward in the ways real data is.
describe('the canonical Feature Match sample dataset', () => {
	it('covers every entry of the Feature Match token binding catalogue', () => {
		const missing = FEATURE_MATCH_TOKEN_KEYS
			.filter(key => !(key in FEATURE_MATCH_SAMPLE_TOKEN_VALUES));

		expect(missing).toEqual([]);
		expect(featureMatchSampleDatasetIsComplete()).toBe(true);
	});

	it('samples values awkward in the ways real ones are', () => {
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
});
