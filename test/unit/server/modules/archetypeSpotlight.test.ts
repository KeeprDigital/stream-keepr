import type { ArchetypeDetailResponse, ArchetypePlayerEntry, CardBreakdownEntry } from '~~/shared/types/metagame';
import { describe, expect, it } from 'vitest';
import { projectArchetypeSpotlight } from '~~/server/modules/metagame/archetypeSpotlight';

function pilot(id: number, name: string, position: number | null, record: [number, number, number] = [3, 1, 0]): ArchetypePlayerEntry {
	return {
		id,
		name,
		deckName: 'Mono Red',
		position,
		points: record[0] * 3 + record[2],
		wins: record[0],
		losses: record[1],
		draws: record[2],
		colors: 'R',
	};
}

function card(id: number, name: string, cardType: string, inclusionRate: number): CardBreakdownEntry {
	return {
		id,
		name,
		cardType,
		scryfallId: null,
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		inclusionRate,
		avgCopies: 4,
		totalCopies: 8,
		mainboardCount: 8,
		sideboardCount: 0,
		mainboardDeckCount: 2,
		sideboardDeckCount: 0,
		deckCount: 2,
	};
}

/** The archetype detail page's read for Mono Red: three pilots, one unplaced, and its cards by inclusion. */
const detail: ArchetypeDetailResponse = {
	id: 7,
	name: 'Mono Red',
	colors: 'R',
	keyCards: [],
	playerCount: 3,
	metaShare: 37.5,
	winRate: 61.5,
	avgPosition: 4.5,
	convertedCount: 1,
	conversionRate: 33.33,
	cardBreakdown: [
		card(1, 'Monastery Swiftspear', 'Creature — Human Monk', 100),
		card(2, 'Sunbaked Canyon', 'Land', 100),
		card(3, 'Lightning Bolt', 'Instant', 100),
		card(4, 'Eidolon of the Great Revel', 'Enchantment Creature — Spirit', 66.67),
		card(5, 'Skewer the Critics', 'Sorcery', 33.33),
	],
	players: [
		pilot(11, 'Unplaced Ursula', null, [0, 0, 0]),
		pilot(12, 'Second Sam', 8, [5, 2, 1]),
		pilot(13, 'First Fran', 1, [7, 0, 1]),
	],
};

describe('projectArchetypeSpotlight', () => {
	it('carries the archetype detail page\'s meta share and Conversion Rate unchanged', () => {
		const spotlight = projectArchetypeSpotlight(detail, { cardLimit: 10, excludedCardTypes: [] });

		expect(spotlight).toMatchObject({
			archetype: { id: 7, name: 'Mono Red', colors: 'R' },
			playerCount: 3,
			metaShare: 37.5,
			convertedCount: 1,
			conversionRate: 33.33,
		});
	});

	it('lists the pilots by position, with their record, placed pilots first', () => {
		const { pilots } = projectArchetypeSpotlight(detail, { cardLimit: 10, excludedCardTypes: [] });

		expect(pilots).toEqual([
			{
				id: 13,
				name: 'First Fran',
				position: 1,
				points: 22,
				wins: 7,
				losses: 0,
				draws: 1,
			},
			{
				id: 12,
				name: 'Second Sam',
				position: 8,
				points: 16,
				wins: 5,
				losses: 2,
				draws: 1,
			},
			{
				id: 11,
				name: 'Unplaced Ursula',
				position: null,
				points: 0,
				wins: 0,
				losses: 0,
				draws: 0,
			},
		]);
	});

	it('shows the most-included cards, up to the card limit, after dropping excluded card types', () => {
		const { topCards } = projectArchetypeSpotlight(detail, {
			cardLimit: 3,
			excludedCardTypes: ['Land'],
		});

		expect(topCards.map(entry => entry.name)).toEqual(['Monastery Swiftspear', 'Lightning Bolt', 'Eidolon of the Great Revel']);
		expect(topCards[2]).toMatchObject({ inclusionRate: 66.67 });
	});

	it('keeps every card type when none is excluded', () => {
		const { topCards } = projectArchetypeSpotlight(detail, { cardLimit: 2, excludedCardTypes: [] });

		expect(topCards.map(entry => entry.name)).toEqual(['Monastery Swiftspear', 'Sunbaked Canyon']);
	});
});
