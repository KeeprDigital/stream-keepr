import type { Commander } from '~~/shared/types/game';
import { describe, expect, it } from 'vitest';
import { commanderDeckIdentity, commanderOfScryfallCard } from '~~/shared/utils/commander';

function commander(name: string, colorIdentity: string): Commander {
	return {
		scryfallId: `id-${name}`,
		name,
		colorIdentity,
		setCode: 'cmd',
		collectorNumber: '1',
	};
}

describe('a Seat\'s deck, from its Commanders', () => {
	// The deck is the Commanders' names; its colours are their colour identity, each once, in WUBRG order.
	it.each([
		{
			held: 'one Commander',
			commanders: [
				commander('Atraxa', 'WUBG'),
			],
			deck: { deckName: 'Atraxa', deckColors: 'WUBG' },
		},
		{
			held: 'a pair, in WUBRG order whatever order they are held in',
			commanders: [
				commander('Kraum', 'UR'),
				commander('Tymna', 'WB'),
			],
			deck: { deckName: 'Kraum / Tymna', deckColors: 'WUBR' },
		},
		{
			held: 'a pair sharing colours',
			commanders: [
				commander('Atraxa', 'WUBG'),
				commander('Tymna', 'WB'),
			],
			deck: { deckName: 'Atraxa / Tymna', deckColors: 'WUBG' },
		},
		{
			held: 'a colourless Commander',
			commanders: [
				commander('Kozilek', ''),
			],
			deck: { deckName: 'Kozilek', deckColors: 'C' },
		},
		{
			held: 'a colourless Commander beside a coloured one',
			commanders: [
				commander('Kozilek', ''),
				commander('Krenko', 'R'),
			],
			deck: { deckName: 'Kozilek / Krenko', deckColors: 'R' },
		},
		{
			held: 'no Commander',
			commanders: [],
			deck: { deckName: null, deckColors: null },
		},
	])('reads $held as $deck', ({ commanders, deck }) => {
		expect(commanderDeckIdentity(commanders)).toEqual(deck);
	});
});

describe('a Commander picked from a Scryfall card', () => {
	it.each([
		{
			card: 'a single-faced card',
			scryfall: {
				id: 'a1',
				name: 'Atraxa, Praetors\' Voice',
				color_identity: ['B', 'G', 'U', 'W'],
				set: 'cm2',
				collector_number: '10',
			},
			picked: {
				scryfallId: 'a1',
				name: 'Atraxa, Praetors\' Voice',
				colorIdentity: 'WUBG',
				setCode: 'cm2',
				collectorNumber: '10',
			},
		},
		{
			card: 'a two-faced card, by its front face',
			scryfall: {
				id: 'e2',
				name: 'Esika, God of the Tree // The Prismatic Bridge',
				color_identity: ['B', 'G', 'R', 'U', 'W'],
				set: 'khm',
				collector_number: '168',
			},
			picked: {
				scryfallId: 'e2',
				name: 'Esika, God of the Tree',
				colorIdentity: 'WUBRG',
				setCode: 'khm',
				collectorNumber: '168',
			},
		},
		{
			card: 'a colourless card',
			scryfall: {
				id: 'k3',
				name: 'Kozilek, the Great Distortion',
				color_identity: [],
				set: 'ogw',
				collector_number: '4',
			},
			picked: {
				scryfallId: 'k3',
				name: 'Kozilek, the Great Distortion',
				colorIdentity: '',
				setCode: 'ogw',
				collectorNumber: '4',
			},
		},
	])('holds $card as that printing', ({ scryfall, picked }) => {
		expect(commanderOfScryfallCard(scryfall)).toEqual(picked);
	});
});
