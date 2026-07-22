import { describe, expect, it } from 'vitest';
import { buildArchetypeBreakdownEntries, compareArchetypeBreakdownEntries, groupClassifiedPlayersByArchetype } from '~~/server/modules/metagame/archetypes';

describe('metagame archetype rules', () => {
	it('groups classified Players by Archetype and computes aggregate stats', () => {
		const groups = groupClassifiedPlayersByArchetype([
			{ archetypeId: 1, wins: 3, losses: 1, position: 2 },
			{ archetypeId: 1, wins: 2, losses: 2, position: 4 },
			{ archetypeId: 2, wins: 1, losses: 3, position: null },
			{ archetypeId: null, wins: 9, losses: 0, position: 1 },
		]);

		const entries = buildArchetypeBreakdownEntries(
			groups,
			[
				{ id: 1, name: 'Burn', colors: 'R' },
				{ id: 2, name: 'Control', colors: 'U' },
			],
			3,
			new Map([[1, [{ id: 10, name: 'Lightning Bolt', game: 'mtg', scryfallId: null, oracleId: null, cardType: 'Instant', colors: 'R', cmc: 1, manaCost: '{R}' }]]]),
		);

		expect(entries).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: 1,
				count: 2,
				metaShare: 66.67,
				winRate: 62.5,
				avgPosition: 3,
				keyCards: [expect.objectContaining({ name: 'Lightning Bolt' })],
			}),
			expect.objectContaining({ id: 2, count: 1, metaShare: 33.33, winRate: 25, avgPosition: null }),
		]));
	});

	it('sorts Archetype breakdown entries by selected metric with name tie-breaker', () => {
		const a = { id: 1, name: 'Alpha', colors: null, count: 1, metaShare: 50, winRate: 60, avgPosition: null, keyCards: [] };
		const b = { id: 2, name: 'Beta', colors: null, count: 2, metaShare: 50, winRate: 40, avgPosition: null, keyCards: [] };

		expect(compareArchetypeBreakdownEntries('count', a, b)).toBeGreaterThan(0);
		expect(compareArchetypeBreakdownEntries('winRate', a, b)).toBeLessThan(0);
		expect(compareArchetypeBreakdownEntries('metaShare', a, b)).toBeLessThan(0);
	});
});
