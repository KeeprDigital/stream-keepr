import type { ArchetypeBreakdownEntry, CardBreakdownEntry } from '~~/shared/types/metagame';
import { describe, expect, it } from 'vitest';
import { buildMetagameFacts } from '~~/server/services/metagameFacts';

function makeArchetype(overrides?: Partial<ArchetypeBreakdownEntry>): ArchetypeBreakdownEntry {
	return {
		id: 1,
		name: 'Azorius Control',
		colors: 'WU',
		count: 12,
		metaShare: 24,
		winRate: 62.5,
		avgPosition: 3.5,
		conversionRate: null,
		keyCards: [],
		...overrides,
	};
}

function makeCard(overrides?: Partial<CardBreakdownEntry>): CardBreakdownEntry {
	return {
		id: 1,
		name: 'Lightning Bolt',
		cardType: 'Instant',
		scryfallId: null,
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		inclusionRate: 65,
		avgCopies: 3.2,
		totalCopies: 32,
		mainboardCount: 30,
		sideboardCount: 2,
		mainboardDeckCount: 10,
		sideboardDeckCount: 2,
		deckCount: 10,
		...overrides,
	};
}

describe('buildMetagameFacts', () => {
	it('builds the default factual callouts in order', () => {
		const facts = buildMetagameFacts({
			totalPlayers: 20,
			classifiedPlayers: 18,
			totalDecks: 16,
			archetypes: [
				makeArchetype(),
				makeArchetype({ id: 2, name: 'Domain Ramp', count: 8, metaShare: 16, winRate: 68.2 }),
				makeArchetype({ id: 3, name: 'Mono Red', count: 5, metaShare: 10, winRate: 54.5 }),
			],
			cards: [
				makeCard(),
				makeCard({ id: 2, name: 'Counterspell', inclusionRate: 55, avgCopies: 3.8, deckCount: 8, mainboardCount: 19, sideboardCount: 6, mainboardDeckCount: 5, sideboardDeckCount: 5 }),
			],
		});

		expect(facts.map((fact: { key: string }) => fact.key)).toEqual([
			'mostPlayedArchetype',
			'bestMajorWinRate',
			'mostPlayedCards',
			'highestAvgCopiesCards',
		]);
		expect(facts[0]).toMatchObject({
			kind: 'simple',
			title: 'Most PLayed Archetype',
			value: 'Azorius Control',
			detail: '12 players · 24% of field',
		});
		expect(facts[1]).toMatchObject({
			kind: 'simple',
			title: 'Best Win Rate (5+ players)',
			value: '68.2%',
			detail: 'Domain Ramp · 8 players',
		});
		expect(facts[2]).toMatchObject({
			kind: 'cardSplit',
			title: 'Most Played Cards',
			mainboard: {
				label: 'Mainboard',
				value: 'Lightning Bolt',
				detail: '30 copies across 10 decks · 62.5% of decks',
			},
			sideboard: {
				label: 'Sideboard',
				value: 'Counterspell',
				detail: '6 copies across 5 decks · 31.3% of decks',
			},
		});
		expect(facts[3]).toMatchObject({
			kind: 'cardSplit',
			title: 'Highest Avg Copies (5+ decks)',
			mainboard: {
				label: 'Mainboard',
				value: 'Counterspell',
				detail: '3.8 avg copies across 5 decks · 31.3% of decks',
			},
			sideboard: {
				label: 'Sideboard',
				value: 'Counterspell',
				detail: '1.2 avg copies across 5 decks · 31.3% of decks',
			},
		});
	});

	it('never includes an unclassified fact', () => {
		const facts = buildMetagameFacts({
			totalPlayers: 8,
			classifiedPlayers: 8,
			totalDecks: 0,
			archetypes: [makeArchetype({ count: 8, metaShare: 100, winRate: 60 })],
			cards: [],
		});

		expect(facts.some((fact: { key: string }) => fact.key === 'unclassifiedPlayers')).toBe(false);
	});
});
