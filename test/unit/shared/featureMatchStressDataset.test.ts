import { describe, expect, it } from 'vitest';
import { updateEventSchema } from '~~/server/schemas/api/event';
import { featureMatchSampleDataset } from '~~/shared/featureMatchSampleDataset';
import { featureMatchStressDataset } from '~~/shared/featureMatchStressDataset';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { GAME_VALUES } from '~~/shared/types/enums';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';

// The Stress Dataset exists to be wider than anything a show will hold, so each
// value is checked against the approved list (#743, E17) and against the sample.
describe('the Feature Match Stress Dataset', () => {
	it.each(GAME_VALUES)('covers every token for %s, none narrower than the sample\'s', (game) => {
		const { tokenValues } = featureMatchStressDataset(game, { untimed: false });
		const sample = featureMatchSampleDataset(game).tokenValues;

		expect(FEATURE_MATCH_TOKEN_KEYS.filter(key => !(key in tokenValues))).toEqual([]);
		const narrower = FEATURE_MATCH_TOKEN_KEYS.filter(key =>
			!key.endsWith('LeaderImage') && String(tokenValues[key]).length < String(sample[key]).length);
		expect(narrower).toEqual([]);
	});

	it.each([
		['mtg', 'Magic: The Gathering Regional Championship Qualifier - Sample City'],
		['op', 'One Piece Card Game Regional Championship - Sample City'],
	] as const)('holds the shared values, and %s\'s own Event name', (game, eventName) => {
		expect(featureMatchStressDataset(game, { untimed: false }).tokenValues).toMatchObject({
			player1Name: 'Maximiliano Alessandro Fitzgerald-Okonkwo',
			player2Name: 'Siobhán Nakamura-Vandenberghe',
			player1Pronouns: 'they/them/theirs',
			player2Pronouns: 'she/they',
			player1Lgs: 'The Wandering Wizard Games & Collectibles',
			player2Lgs: 'Dragon\'s Hoard Tabletop Café',
			round: 'Round 15',
			stage: 'Top 8 Quarterfinals',
			table: 'Feature Match Table 128',
			eventName,
		});
	});

	it.each([
		{ game: 'mtg', untimed: false, clock: '1:23:45' },
		{ game: 'op', untimed: false, clock: '1:23:45' },
		{ game: 'mtg', untimed: true, clock: 'label' },
		{ game: 'op', untimed: true, clock: 'label' },
	] as const)('shows $game\'s widest clock, or with untimed $untimed the longest Untimed Label an Event can hold', ({ game, untimed, clock }) => {
		const { clockDisplayTime } = featureMatchStressDataset(game, { untimed }).context;

		if (clock === 'label') {
			const accepts = (label: string) => updateEventSchema.safeParse({ featureMatchDefaultUntimedLabel: label }).success;
			expect(clockDisplayTime).toHaveLength(100);
			expect(accepts(clockDisplayTime)).toBe(true);
			expect(accepts(`${clockDisplayTime}!`)).toBe(false);
		}
		else {
			expect(clockDisplayTime).toBe(clock);
		}
	});

	it('stresses a Magic Match\'s records, decks, format and live state', () => {
		const { tokenValues, context } = featureMatchStressDataset('mtg', { untimed: false });

		expect(tokenValues).toMatchObject({
			player1Record: '12-2-1',
			player2Record: '11-3-1',
			player1Deck: 'Temur Rhinos Crashing Footfalls',
			player2Deck: 'Rakdos Scam Evoke Midrange',
			player1DeckColors: 'WUBRG',
			player2DeckColors: 'URG',
			format: 'Canadian Highlander',
		});
		expect(context).toMatchObject({
			bestOf: 5,
			player1: { lifeTotal: 999, gameWins: 2, sideboardRevealed: true },
			player2: { lifeTotal: -999, gameWins: 2, sideboardRevealed: true },
		});
		const sideboards = [context.player1.sideboard!, context.player2.sideboard!];
		expect(sideboards.map(cards => cards.reduce((total, card) => total + card.quantity, 0))).toEqual([15, 15]);
		expect(sideboards.flat().map(card => card.name)).toEqual(expect.arrayContaining([
			'Asmoranomardicadaistinaculdacar',
			'Circle of Protection: Artifacts',
			'Delver of Secrets // Insectile Aberration',
			'Kozilek, Butcher of Truth',
			'Sorin, Vengeful Bloodlord',
		]));
	});

	it('names a One Piece Match by the catalogue\'s longest two-colour Leaders, with no record, life or sideboard', () => {
		const { tokenValues, context } = featureMatchStressDataset('op', { untimed: false });

		expect(tokenValues).toMatchObject({
			player1Record: '',
			player2Record: '',
			player1Deck: 'Donquixote Doflamingo',
			player1DeckColors: 'Green/Purple',
			player2Deck: 'Donquixote Rosinante',
			player2DeckColors: 'Purple/Yellow',
		});
		expect(isOpCardImageUrl(String(tokenValues.player1LeaderImage))).toBe(true);
		expect(context).toMatchObject({
			player1: { lifeTotal: null, sideboard: null },
			player2: { lifeTotal: null, sideboard: null },
		});
	});
});
