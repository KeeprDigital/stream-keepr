import { describe, expect, it } from 'vitest';
import { updateEventSchema } from '~~/server/schemas/api/event';
import { featureMatchSampleDataset } from '~~/shared/featureMatchSampleDataset';
import { featureMatchStressDataset } from '~~/shared/featureMatchStressDataset';
import { EVENT_KIND_VALUES } from '~~/shared/config/games';
import { featureMatchTokenCatalogue } from '~~/shared/featureMatchTokenCatalogue';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';
import { formatClockTime } from '~~/shared/utils/clock';

// The Stress Dataset exists to be wider than anything a show holds: wider than
// the sample everywhere, and at a bound wherever the app has one.
describe('the Feature Match Stress Dataset', () => {
	it.each(EVENT_KIND_VALUES)('holds each token a %s Event is offered and no other, none narrower than the sample\'s', (kind) => {
		const { tokenValues } = featureMatchStressDataset(kind, { untimed: false });
		const sample = featureMatchSampleDataset(kind).tokenValues;
		const keys = featureMatchTokenCatalogue(kind).map(token => token.key);

		expect(Object.keys(tokenValues).sort()).toEqual([...keys].sort());
		// A card image is a URL, whose length says nothing of how wide it paints.
		const narrower = keys.filter(key =>
			!key.endsWith('Image') && String(tokenValues[key]).length < String(sample[key]).length);
		expect(narrower).toEqual([]);
	});

	it.each(EVENT_KIND_VALUES.flatMap(kind => [
		{ kind, untimed: false },
		{ kind, untimed: true },
	]))('shows a $kind Event\'s widest clock, or with untimed $untimed the longest Untimed Label an Event can hold', ({ kind, untimed }) => {
		const { clockDisplayTime } = featureMatchStressDataset(kind, { untimed }).context;

		if (untimed) {
			const accepts = (label: string) => updateEventSchema.safeParse({ featureMatchDefaultUntimedLabel: label }).success;
			expect(accepts(clockDisplayTime)).toBe(true);
			expect(accepts(`${clockDisplayTime}!`)).toBe(false);
			expect(clockDisplayTime.trim()).toBe(clockDisplayTime);
		}
		else {
			// Hours, minutes and seconds: the widest form a Session clock formats to.
			expect(clockDisplayTime).toBe(formatClockTime(((1 * 60 + 23) * 60 + 45) * 1000));
		}
	});

	it('stresses a Magic Match\'s live state: three-digit life either way, a best-of-five one game from decided, full revealed sideboards', () => {
		const { context } = featureMatchStressDataset('mtg-two-player', { untimed: false });
		const { player1, player2, bestOf } = context;

		expect([player1.lifeTotal, player2.lifeTotal].map(String)).toEqual(['999', '-999']);
		expect(bestOf).toBe(5);
		expect([player1.gameWins, player2.gameWins]).toEqual([2, 2]);
		for (const { sideboard, sideboardRevealed } of [player1, player2]) {
			expect(sideboardRevealed).toBe(true);
			// Fifteen singletons: the most rows a sideboard holds, with no art fetched.
			expect(sideboard).toHaveLength(15);
			expect(sideboard!.every(card => card.quantity === 1 && card.imageUrl === null)).toBe(true);
		}
		expect(Math.max(...player1.sideboard!.map(card => card.name.length))).toBeGreaterThan(40);
	});

	it('names a One Piece Match by two-colour Leaders, with no record, life or sideboard', () => {
		const { tokenValues, context } = featureMatchStressDataset('op', { untimed: false });

		for (const side of ['player1', 'player2']) {
			expect(tokenValues[`${side}Record`]).toBe('');
			expect(String(tokenValues[`${side}DeckColors`]).split('/')).toHaveLength(2);
			expect(isOpCardImageUrl(String(tokenValues[`${side}LeaderImage`]))).toBe(true);
		}
		expect(context).toMatchObject({
			player1: { lifeTotal: null, sideboard: null },
			player2: { lifeTotal: null, sideboard: null },
		});
	});

	it('stresses a Commander game: four Seats, each a pair of Commanders, three-digit life either way', () => {
		const { tokenValues, context } = featureMatchStressDataset('mtg-commander', { untimed: false });

		for (const seat of SEAT_VALUES) {
			expect(String(tokenValues[`${seat}Deck`]).length, seat).toBeGreaterThan(50);
			expect(tokenValues[`${seat}Commander2Image`], seat).not.toBe('');
			expect(String(context[seat]?.lifeTotal), seat).toHaveLength(seat === 'player1' || seat === 'player3'
				? 3
				: 4);
		}
		expect(String(tokenValues.player1DeckColors)).toHaveLength(4);
	});
});
