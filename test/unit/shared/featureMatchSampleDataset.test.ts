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
	 *
	 * Pinned by writing the whole dataset out a second time. Every value is here
	 * rather than a representative few, because what is fixed is the dataset and not
	 * one sample of it: a single token quietly derived from `Date.now()` or from
	 * whatever the installation holds is exactly the defect, and a spot check would
	 * pass over it. The duplication is the price of "canonical" — changing a sample
	 * value is a two-file edit, deliberately.
	 *
	 * What this cannot do is pin the derivation rather than the value. A token
	 * computed from something that happens to equal the literal today — a year
	 * arithmetic that currently lands on the right number — passes here and starts
	 * failing on its own schedule. That is a limit of asserting values at all, not
	 * one this assertion could be rewritten out of.
	 */
	it('is fixed data rather than anything sampled from the installation', () => {
		expect(FEATURE_MATCH_SAMPLE_TOKEN_VALUES).toEqual({
			player1Name: 'Alexandra Whitfield-Moreau',
			player1Record: '5-1-1',
			player1Deck: 'Boros Convoke',
			player1DeckColors: 'RW',
			player1Pronouns: 'she/her',
			player1Lgs: 'Northgate Games',
			player2Name: 'Kenji Sato',
			player2Record: '6-1',
			player2Deck: 'Dimir Midrange',
			player2DeckColors: 'UB',
			player2Pronouns: 'he/him',
			player2Lgs: 'The Battered Sleeve',
			round: 'Round 8',
			stage: 'Quarterfinals',
			table: 'Table 1',
			format: 'Standard',
			eventName: 'Sample Regional Championship',
		});
		expect(FEATURE_MATCH_SAMPLE_CONTEXT).toEqual({
			clockDisplayTime: '12:34',
			player1: {
				lifeTotal: 17,
				gameWins: 1,
				sideboard: [
					{ name: 'Rest in Peace', quantity: 2, imageUrl: null },
					{ name: 'Wear // Tear', quantity: 2, imageUrl: null },
					{ name: 'Pithing Needle', quantity: 1, imageUrl: null },
					{ name: 'Elspeth, Knight-Errant', quantity: 1, imageUrl: null },
					{ name: 'Celestial Purge', quantity: 3, imageUrl: null },
					{ name: 'Burrenton Forge-Tender', quantity: 4, imageUrl: null },
					{ name: 'Path to Exile', quantity: 2, imageUrl: null },
				],
			},
			player2: {
				lifeTotal: 4,
				gameWins: 1,
				sideboard: [
					{ name: 'Duress', quantity: 3, imageUrl: null },
					{ name: 'Negate', quantity: 2, imageUrl: null },
					{ name: 'Sheoldred, the Apocalypse', quantity: 2, imageUrl: null },
					{ name: 'Gix\'s Command', quantity: 2, imageUrl: null },
					{ name: 'Cut Down', quantity: 3, imageUrl: null },
					{ name: 'Disdainful Stroke', quantity: 3, imageUrl: null },
				],
			},
			bestOf: 3,
		});
	});

	/**
	 * Values chosen to be awkward in the ways real ones are. A dataset of `Player 1`
	 * and `0-0` would make every layout look like it fits, which is worse than no
	 * preview at all because it is confidently wrong.
	 *
	 * Stated as relations rather than as the literals the test above pins, because
	 * these are the reasons those literals were chosen: an author replacing the
	 * sample names has to keep the awkwardness, not the exact strings.
	 */
	it('samples values awkward in the ways real ones are', () => {
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name).length).toBeGreaterThan(20);
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Name).length)
			.toBeGreaterThan(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player2Name).length);
		// A record with a draw in it, which is the longer of the two shapes a record
		// takes.
		expect(String(FEATURE_MATCH_SAMPLE_TOKEN_VALUES.player1Record).split('-')).toHaveLength(3);
		// A game-wins state partway through the Match, so a win-box indicator draws
		// filled and unfilled boxes rather than a row of empties.
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.gameWins).toBeGreaterThan(0);
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.gameWins + FEATURE_MATCH_SAMPLE_CONTEXT.player2.gameWins)
			.toBeLessThan(FEATURE_MATCH_SAMPLE_CONTEXT.bestOf);
		// Player life totals that differ, so a layout showing both cannot look right
		// by accident.
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.lifeTotal)
			.not
			.toBe(FEATURE_MATCH_SAMPLE_CONTEXT.player2.lifeTotal);
		// Full fifteen-card sideboards, so a Deck List Graphic Item's bounds are
		// judged against the worst case rather than a tidy four-card one — and with
		// differing entry counts, so a layout showing both cannot look right by
		// accident. Art stays unset: the canonical dataset never depends on a remote
		// image, so the preview shows the text-placeholder cards.
		for (const player of [FEATURE_MATCH_SAMPLE_CONTEXT.player1, FEATURE_MATCH_SAMPLE_CONTEXT.player2] as const) {
			expect(player.sideboard!.reduce((total, card) => total + card.quantity, 0)).toBe(15);
			expect(player.sideboard!.every(card => card.imageUrl === null)).toBe(true);
		}
		expect(FEATURE_MATCH_SAMPLE_CONTEXT.player1.sideboard!.length)
			.not
			.toBe(FEATURE_MATCH_SAMPLE_CONTEXT.player2.sideboard!.length);
		// A long card name beside short ones, so the list view's shrink is exercised.
		expect(Math.max(...FEATURE_MATCH_SAMPLE_CONTEXT.player1.sideboard!.map(card => card.name.length)))
			.toBeGreaterThan(20);
	});
});
