import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_SAMPLE_CONTEXT,
	FEATURE_MATCH_SAMPLE_TOKEN_VALUES,
	featureMatchSampleDatasetIsComplete,
} from '~~/shared/featureMatchSampleDataset';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';

/**
 * The canonical Feature Match sample dataset.
 *
 * What is worth pinning about a fixed dataset is not the values — an author may
 * change `Kenji Sato` to anything — but the two properties that make it usable as
 * the one dataset previews resolve against.
 */
describe('the canonical Feature Match sample dataset', () => {
	/**
	 * A preview exists so an author can see whether real values fit inside the bounds
	 * they drew. A token with no sample value previews blank, which is the exact
	 * failure the dataset was added to remove — so a token added to the catalogue
	 * without a sample fails here rather than showing up as one mysteriously empty
	 * name plate.
	 */
	it('covers every entry of the Feature Match token binding catalogue', () => {
		const missing = FEATURE_MATCH_TOKEN_KEYS
			.filter(key => !(key in FEATURE_MATCH_SAMPLE_TOKEN_VALUES));

		expect(missing).toEqual([]);
		expect(featureMatchSampleDatasetIsComplete()).toBe(true);
	});

	/**
	 * "Canonical" is the load-bearing word. Two authors comparing the same layout
	 * must see the same preview, and the same layout before and after an edit must
	 * differ only by the edit — which holds only while the dataset is fixed data
	 * rather than anything derived from the installation, the clock, or an Event.
	 */
	it('is fixed data rather than anything sampled from the installation', () => {
		expect(FEATURE_MATCH_SAMPLE_TOKEN_VALUES).toEqual({ ...FEATURE_MATCH_SAMPLE_TOKEN_VALUES });
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.clockDisplayTime).toBe('12:34');
		// A game-wins state partway through the Match, so a win-box indicator draws
		// filled and unfilled boxes rather than a row of empties.
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.bestOf).toBe(3);
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.gameWins).toBeGreaterThan(0);
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.gameWins + FEATURE_MATCH_SAMPLE_CONTEXT.player2.gameWins)
			.toBeLessThan(FEATURE_MATCH_SAMPLE_CONTEXT.bestOf);
		// Player life totals that differ, so a layout showing both cannot look right
		// by accident.
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.lifeTotal)
			.not
			.toBe(FEATURE_MATCH_SAMPLE_CONTEXT.player2.lifeTotal);
	});

	/**
	 * Values chosen to be awkward in the ways real ones are. A dataset of `Player 1`
	 * and `0-0` would make every layout look like it fits, which is worse than no
	 * preview at all because it is confidently wrong.
	 */
	it('samples values long enough to expose a layout that does not fit', () => {
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name).length).toBeGreaterThan(20);
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name).length)
			.toBeGreaterThan(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player2Name).length);
		// A record with a draw in it, which is the longer of the two shapes a record
		// takes.
		expect(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Record).toBe('5-1-1');
	});
});
