import type { ArchetypeBreakdownEntry, ArchetypeBreakdownResponse } from '~~/shared/types/metagame';
import { describe, expect, it } from 'vitest';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { METAGAME_CHART_MAX_ARCHETYPES, projectMetagameChart } from '~~/shared/utils/metagameChart';
import { metagameScreenQuery } from '~~/shared/utils/metagameQuery';

function entry(id: number, name: string, count: number, overrides: Partial<ArchetypeBreakdownEntry> = {}): ArchetypeBreakdownEntry {
	return {
		id,
		name,
		colors: null,
		count,
		metaShare: 0,
		winRate: null,
		avgPosition: null,
		conversionRate: null,
		keyCards: [],
		...overrides,
	};
}

function breakdown(entries: ArchetypeBreakdownEntry[], classifiedPlayers: number): ArchetypeBreakdownResponse {
	return { entries, totalPlayers: classifiedPlayers, classifiedPlayers, scope: 'all' };
}

describe('projectMetagameChart', () => {
	it('draws one bar per archetype in the breakdown order, labelled with its name and meta share', () => {
		const bars = projectMetagameChart(breakdown([
			entry(4, 'Boros Energy', 5, { metaShare: 50, colors: 'RW' }),
			entry(9, 'Eldrazi Ramp', 3, { metaShare: 30 }),
			entry(2, 'Domain Zoo', 2, { metaShare: 20 }),
		], 10));

		expect(bars.map(bar => [bar.name, bar.metaShare, bar.colors])).toEqual([
			['Boros Energy', 50, 'RW'],
			['Eldrazi Ramp', 30, null],
			['Domain Zoo', 20, null],
		]);
	});

	it('sizes each bar against the largest share, so the leader spans the plot', () => {
		const bars = projectMetagameChart(breakdown([
			entry(1, 'A', 4, { metaShare: 40 }),
			entry(2, 'B', 2, { metaShare: 20 }),
			entry(3, 'C', 1, { metaShare: 10 }),
		], 10));

		expect(bars.map(bar => bar.length)).toEqual([1, 0.5, 0.25]);
	});

	it('keeps the server\'s Other row last, uncoloured', () => {
		const bars = projectMetagameChart(breakdown([
			entry(1, 'A', 6, { metaShare: 60 }),
			entry(-1, 'Other', 4, { metaShare: 40 }),
		], 10));

		expect(bars.at(-1)).toMatchObject({ name: 'Other', isOther: true, colourSlot: null, metaShare: 40 });
		expect(bars[0]).toMatchObject({ isOther: false });
	});

	it(`folds archetypes past the ${METAGAME_CHART_MAX_ARCHETYPES}th into Other, with the server's Other`, () => {
		const named = Array.from({ length: 10 }, (_, index) => entry(index + 1, `Archetype ${index + 1}`, 1, { metaShare: 8.33 }));
		const bars = projectMetagameChart(breakdown([...named, entry(-1, 'Other', 2, { metaShare: 16.67 })], 12));

		expect(bars).toHaveLength(METAGAME_CHART_MAX_ARCHETYPES + 1);
		expect(bars.slice(0, -1).map(bar => bar.name)).toEqual(named.slice(0, 8).map(item => item.name));
		// Archetypes 9 and 10 (one Player each) join the server's Other (two Players): 4 of 12.
		expect(bars.at(-1)).toMatchObject({ name: 'Other', isOther: true, count: 4, metaShare: 33.33, colourSlot: null });
	});

	it('gives every archetype on the chart a distinct colour', () => {
		const named = Array.from({ length: 8 }, (_, index) => entry((index + 1) * 8, `Archetype ${index}`, 1));
		const slots = projectMetagameChart(breakdown(named, 8)).map(bar => bar.colourSlot);

		expect(new Set(slots).size).toBe(8);
		expect(slots.every(slot => slot != null && slot >= 1 && slot <= METAGAME_CHART_MAX_ARCHETYPES)).toBe(true);
	});

	it('colours an archetype by what it is, not where it ranks', () => {
		const first = projectMetagameChart(breakdown([
			entry(3, 'Boros Energy', 5),
			entry(7, 'Eldrazi Ramp', 3),
			entry(12, 'Domain Zoo', 2),
		], 10));
		const reordered = projectMetagameChart(breakdown([
			entry(12, 'Domain Zoo', 5),
			entry(3, 'Boros Energy', 3),
			entry(7, 'Eldrazi Ramp', 2),
		], 10));

		const slotsOf = (bars: typeof first) => Object.fromEntries(bars.map(bar => [bar.name, bar.colourSlot]));
		expect(slotsOf(reordered)).toEqual(slotsOf(first));
	});

	it('keeps an archetype\'s colour when another archetype leaves the chart', () => {
		const before = projectMetagameChart(breakdown([
			entry(3, 'Boros Energy', 5),
			entry(7, 'Eldrazi Ramp', 3),
			entry(12, 'Domain Zoo', 2),
		], 10));
		const after = projectMetagameChart(breakdown([
			entry(3, 'Boros Energy', 5),
			entry(12, 'Domain Zoo', 2),
		], 7));

		expect(after.find(bar => bar.name === 'Domain Zoo')?.colourSlot)
			.toBe(before.find(bar => bar.name === 'Domain Zoo')?.colourSlot);
		expect(after.find(bar => bar.name === 'Boros Energy')?.colourSlot)
			.toBe(before.find(bar => bar.name === 'Boros Energy')?.colourSlot);
	});

	it('draws nothing for an empty breakdown', () => {
		expect(projectMetagameChart(breakdown([], 0))).toEqual([]);
	});
});

describe('metagameScreenQuery for the chart display', () => {
	it('reads the archetype table\'s breakdown: the same scope, sort and Top archetypes limit', () => {
		const config = {
			...getDefaultConfigForMode('metagame'),
			scope: 'topN' as const,
			topN: 16,
			sortBy: 'count' as const,
			archetypeLimit: 5,
		};

		expect(metagameScreenQuery({ ...config, viewMode: 'chart' })).toEqual({
			viewMode: 'archetype',
			query: { scope: 'topN', topN: 16, sortBy: 'count', limit: 5 },
		});
		expect(metagameScreenQuery({ ...config, viewMode: 'chart' }))
			.toEqual(metagameScreenQuery({ ...config, viewMode: 'archetype' }));
	});
});
