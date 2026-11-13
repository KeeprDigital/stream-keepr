import { describe, expect, it } from 'vitest';
import { commanderMainboard, commanderMainboardCount, commanderOfDeckListEntry } from '~~/shared/utils/commanderDeckList';
import { ANIMAR, ASHLING, deckListEntryOf, MOXFIELD_CARDS } from '~~/test/helpers/magicDeckText';

// A Commander Seat's list holds every card kept; the Seat names its Commanders (ADR-0087).

const { ashling, animar, forest, eirdu } = MOXFIELD_CARDS;
const LIST = [
	deckListEntryOf(ashling),
	deckListEntryOf(animar),
	deckListEntryOf(forest, 3),
];

describe('a Commander deck\'s Mainboard', () => {
	it.each([
		{
			commanders: 'one Commander',
			held: [ASHLING],
			mainboard: [
				[1, animar.name],
				[3, forest.name],
			],
		},
		{
			commanders: 'a pair',
			held: [ASHLING, ANIMAR],
			mainboard: [
				[3, forest.name],
			],
		},
		{
			commanders: 'a Commander the list holds several copies of',
			held: [
				{ scryfallId: forest.id },
			],
			mainboard: [
				[1, ashling.name],
				[1, animar.name],
				[2, forest.name],
			],
		},
		{
			commanders: 'a Commander the list does not hold',
			held: [
				{ scryfallId: eirdu.id },
			],
			mainboard: [
				[1, ashling.name],
				[1, animar.name],
				[3, forest.name],
			],
		},
	])('is every copy but one of each, for $commanders', ({ held, mainboard }) => {
		expect(commanderMainboard(LIST, held).map(entry => [entry.quantity, entry.name])).toEqual(mainboard);
		expect(commanderMainboardCount(LIST, held)).toBe(mainboard.reduce((total, [quantity]) => total + (quantity as number), 0));
	});
});

describe('the Commander a card of the list is', () => {
	it('is that printing, named by its front face, its colour identity in WUBRG order', () => {
		expect(commanderOfDeckListEntry({
			...deckListEntryOf(eirdu),
			colorIdentity: 'BW',
		})).toEqual({
			scryfallId: eirdu.id,
			name: 'Eirdu, Carrier of Dawn',
			colorIdentity: 'WB',
			setCode: 'ecl',
			collectorNumber: '13',
		});
	});
});
