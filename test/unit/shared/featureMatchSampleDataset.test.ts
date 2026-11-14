import { describe, expect, it } from 'vitest';
import { opDeckListView } from '~~/server/modules/op-deck-list-write/paste';
import { EVENT_KIND_VALUES } from '~~/shared/config/games';
import {
	FEATURE_MATCH_SAMPLE_CONTEXT,
	FEATURE_MATCH_SAMPLE_TOKEN_VALUES,
	featureMatchSampleDataset,
	featureMatchSampleDatasetIsComplete,
	OP_FEATURE_MATCH_SAMPLE_SIDES,
} from '~~/shared/featureMatchSampleDataset';
import { featureMatchTokenCatalogue } from '~~/shared/featureMatchTokenCatalogue';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';
import { isScryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

// What matters about the canonical preview dataset is not its values but that it
// covers every token and is awkward in the ways real data is.
describe('the canonical Feature Match sample dataset', () => {
	// Exactly its Event's tokens: a blank preview hides what an author judges, and a value no token names is dead.
	it.each(EVENT_KIND_VALUES)('holds a value for each token a %s Event is offered, and no other', (kind) => {
		const { tokenValues } = featureMatchSampleDataset(kind);

		expect(Object.keys(tokenValues).sort()).toEqual(featureMatchTokenCatalogue(kind).map(token => token.key).sort());
		expect(featureMatchSampleDatasetIsComplete()).toBe(true);
	});

	it('samples a Commander game seating four: a pair and single Commanders, a colourless deck, life apart', () => {
		const { tokenValues, context } = featureMatchSampleDataset('mtg-commander');

		// A long name beside a short one, as the pair's sample has.
		expect(String(tokenValues.player1Name).length).toBeGreaterThan(20);
		expect(String(tokenValues.player2Name).length).toBeLessThan(12);
		// Each Seat's first Commander is a card on air; only a pair has a second.
		for (const seat of SEAT_VALUES)
			expect(isScryfallCardImageUrl(String(tokenValues[`${seat}Commander1Image`])), seat).toBe(true);
		expect(SEAT_VALUES.filter(seat => tokenValues[`${seat}Commander2Image`] !== '')).toEqual(['player1']);
		expect(String(tokenValues.player1Deck)).toContain(' / ');
		expect(tokenValues.player4DeckColors).toBe('C');
		// One game, every Seat in it at a different life.
		expect(context.emptySeats ?? []).toEqual([]);
		expect(new Set(SEAT_VALUES.map(seat => context[seat]?.lifeTotal)).size).toBe(4);
		expect(context.bestOf).toBe(1);
		// A turn, Commander Damage and an Eliminated Seat, so each Commander item previews something.
		expect(context.activeSeat).toBe('player2');
		expect(SEAT_VALUES.filter(seat => context[seat]?.eliminated)).toEqual(['player4']);
		expect(context.player1.commanderDamage!.filter(count => count.damage > 0)).toHaveLength(1);
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

	it('samples a One Piece Match named by its Leaders, with a long name beside a short one', () => {
		const { tokenValues, context } = featureMatchSampleDataset('op');

		expect(String(tokenValues.player1Name).length).toBeGreaterThan(20);
		expect(String(tokenValues.player1Name).length).toBeGreaterThan(String(tokenValues.player2Name).length);
		// Each side's deck is named, coloured and imaged by its Leader, a real Printing.
		OP_FEATURE_MATCH_SAMPLE_SIDES.forEach(({ leader }, index) => {
			const side = `player${index + 1}`;
			expect(tokenValues[`${side}Deck`]).toBe(leader.name);
			expect(tokenValues[`${side}DeckColors`]).toBe(leader.colors.join('/'));
			expect(isOpCardImageUrl(String(tokenValues[`${side}LeaderImage`]))).toBe(true);
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
		const view = opDeckListView(player1.deckList);

		expect(view.warnings).toEqual([]);
		expect(view).toMatchObject({ leaderNumber: player1.leader.number, mainboardCount: 50 });
		expect(player1.deckList.every(entry => entry.card && isOpCardImageUrl(entry.card.imageUrl))).toBe(true);
	});
});
