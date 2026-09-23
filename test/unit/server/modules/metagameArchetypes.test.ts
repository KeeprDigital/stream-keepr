import type { ArchetypeAccumulator } from '~~/server/modules/metagame/archetypes';
import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import { describe, expect, it } from 'vitest';
import { buildArchetypeBreakdownEntries, compareArchetypeBreakdownEntries, groupClassifiedPlayersByArchetype, limitArchetypeBreakdownEntries } from '~~/server/modules/metagame/archetypes';

describe('metagame archetype rules', () => {
	it('groups classified Players by Archetype and computes aggregate stats', () => {
		const groups = groupClassifiedPlayersByArchetype([
			{ archetypeId: 1, wins: 3, losses: 1, points: 9, position: 2 },
			{ archetypeId: 1, wins: 2, losses: 2, points: 6, position: 4 },
			{ archetypeId: 2, wins: 1, losses: 3, points: 3, position: null },
			{ archetypeId: null, wins: 9, losses: 0, points: 27, position: 1 },
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

	it('reports null conversion rates when no conversion target is given', () => {
		const groups = groupClassifiedPlayersByArchetype([
			{ archetypeId: 1, wins: 3, losses: 1, points: 9, position: 2 },
		]);

		const entries = buildArchetypeBreakdownEntries(groups, [{ id: 1, name: 'Burn', colors: 'R' }], 1, new Map());

		expect(entries[0]!.conversionRate).toBeNull();
	});

	it('computes conversion rate against a Top N placement target', () => {
		const groups = groupClassifiedPlayersByArchetype([
			{ archetypeId: 1, wins: 3, losses: 1, points: 9, position: 2 },
			{ archetypeId: 1, wins: 2, losses: 2, points: 6, position: 8 },
			{ archetypeId: 1, wins: 1, losses: 3, points: 3, position: 9 },
			{ archetypeId: 1, wins: 0, losses: 4, points: 0, position: null },
			{ archetypeId: 2, wins: 0, losses: 4, points: 0, position: 20 },
		], { metric: 'topN', threshold: 8 });

		const entries = buildArchetypeBreakdownEntries(
			groups,
			[{ id: 1, name: 'Burn', colors: 'R' }, { id: 2, name: 'Control', colors: 'U' }],
			5,
			new Map(),
			{ metric: 'topN', threshold: 8 },
		);

		expect(entries).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 1, conversionRate: 50 }),
			expect.objectContaining({ id: 2, conversionRate: 0 }),
		]));
	});

	it('computes conversion rate against a minimum-points target, ignoring null points', () => {
		const groups = groupClassifiedPlayersByArchetype([
			{ archetypeId: 1, wins: 3, losses: 1, points: 9, position: 2 },
			{ archetypeId: 1, wins: 2, losses: 2, points: 12, position: 4 },
			{ archetypeId: 1, wins: 0, losses: 0, points: null, position: null },
		], { metric: 'minPoints', threshold: 12 });

		const entries = buildArchetypeBreakdownEntries(
			groups,
			[{ id: 1, name: 'Burn', colors: 'R' }],
			3,
			new Map(),
			{ metric: 'minPoints', threshold: 12 },
		);

		expect(entries[0]!.conversionRate).toBe(33.33);
	});

	it('sorts Archetype breakdown entries by selected metric with name tie-breaker', () => {
		const a = { id: 1, name: 'Alpha', colors: null, count: 1, metaShare: 50, winRate: 60, avgPosition: null, conversionRate: 25, keyCards: [] };
		const b = { id: 2, name: 'Beta', colors: null, count: 2, metaShare: 50, winRate: 40, avgPosition: null, conversionRate: 75, keyCards: [] };

		expect(compareArchetypeBreakdownEntries('count', a, b)).toBeGreaterThan(0);
		expect(compareArchetypeBreakdownEntries('winRate', a, b)).toBeLessThan(0);
		expect(compareArchetypeBreakdownEntries('metaShare', a, b)).toBeLessThan(0);
		expect(compareArchetypeBreakdownEntries('conversionRate', a, b)).toBeGreaterThan(0);
	});

	it('sorts null conversion rates below zero conversion rates', () => {
		const a = { id: 1, name: 'Alpha', colors: null, count: 1, metaShare: 50, winRate: null, avgPosition: null, conversionRate: null, keyCards: [] };
		const b = { id: 2, name: 'Beta', colors: null, count: 2, metaShare: 50, winRate: null, avgPosition: null, conversionRate: 0, keyCards: [] };

		expect(compareArchetypeBreakdownEntries('conversionRate', a, b)).toBeGreaterThan(0);
	});

	describe('limitArchetypeBreakdownEntries', () => {
		function entry(id: number, name: string, count: number): ArchetypeBreakdownEntry {
			return { id, name, colors: null, count, metaShare: 0, winRate: null, avgPosition: null, conversionRate: null, keyCards: [] };
		}

		function accumulator(overrides: Partial<ArchetypeAccumulator>): ArchetypeAccumulator {
			return { wins: 0, losses: 0, totalPosition: 0, playersWithPosition: 0, convertedCount: 0, count: 0, ...overrides };
		}

		const entries = [entry(1, 'Burn', 4), entry(2, 'Control', 3), entry(3, 'Midrange', 2), entry(4, 'Combo', 1)];
		const groups = new Map<number, ArchetypeAccumulator>([
			[1, accumulator({ wins: 8, losses: 4, totalPosition: 6, playersWithPosition: 4, count: 4 })],
			[2, accumulator({ wins: 5, losses: 5, totalPosition: 12, playersWithPosition: 3, count: 3 })],
			[3, accumulator({ wins: 3, losses: 5, totalPosition: 15, playersWithPosition: 2, count: 2 })],
			[4, accumulator({ wins: 1, losses: 3, totalPosition: 20, playersWithPosition: 1, count: 1 })],
		]);

		it('returns entries unchanged when no limit is given', () => {
			expect(limitArchetypeBreakdownEntries(entries, groups, 10)).toBe(entries);
		});

		it('returns entries unchanged when the limit is not exceeded', () => {
			expect(limitArchetypeBreakdownEntries(entries, groups, 10, 4)).toBe(entries);
		});

		it('rolls entries beyond the limit into an aggregate Other row', () => {
			const limited = limitArchetypeBreakdownEntries(entries, groups, 10, 2);

			expect(limited).toHaveLength(3);
			expect(limited[0]).toBe(entries[0]);
			expect(limited[1]).toBe(entries[1]);
			expect(limited[2]).toEqual({
				id: -1,
				name: 'Other',
				colors: null,
				count: 3,
				metaShare: 30,
				winRate: 33.33,
				avgPosition: 11.7,
				conversionRate: null,
				keyCards: [],
			});
		});

		it('aggregates hidden converted counts into the Other row conversion rate', () => {
			const convertedGroups = new Map<number, ArchetypeAccumulator>([
				[1, accumulator({ count: 4, convertedCount: 4 })],
				[2, accumulator({ count: 3, convertedCount: 2 })],
				[3, accumulator({ count: 2, convertedCount: 1 })],
				[4, accumulator({ count: 1, convertedCount: 0 })],
			]);
			const limited = limitArchetypeBreakdownEntries(entries, convertedGroups, 10, 2, { metric: 'topN', threshold: 8 });

			expect(limited[2]).toEqual(expect.objectContaining({
				id: -1,
				name: 'Other',
				count: 3,
				conversionRate: 33.33,
			}));
		});

		it('reports null aggregate stats when hidden entries carry no data', () => {
			const bare = [entry(1, 'Burn', 1), entry(5, 'Unknown', 0)];
			const limited = limitArchetypeBreakdownEntries(bare, new Map([[1, accumulator({ count: 1 })]]), 0, 1);

			expect(limited[1]).toEqual(expect.objectContaining({
				id: -1,
				name: 'Other',
				count: 0,
				metaShare: 0,
				avgPosition: null,
			}));
		});
	});
});
