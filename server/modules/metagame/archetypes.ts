import type { MetagameConversionMetric } from '~~/shared/types/enums';
import type { ArchetypeBreakdownEntry, CardResponse } from '~~/shared/types/metagame';
import { computeMetagameWinRate } from '~~/server/services/metagameMetrics';

export interface ClassifiedArchetypePlayerRow {
	archetypeId: number | null;
	wins: number | null;
	losses: number | null;
	points: number | null;
	position: number | null;
}

/**
 * Target a player must reach to count as "converted": a Top N placement
 * (`position <= threshold`) or a minimum match-point total
 * (`points >= threshold`). Evaluated against every player in the current
 * scope — it never narrows the scope itself.
 */
export interface ArchetypeConversionTarget {
	metric: MetagameConversionMetric;
	threshold: number;
}

export function isConvertedPlayer(
	row: { position: number | null; points: number | null },
	target: ArchetypeConversionTarget,
): boolean {
	if (target.metric === 'topN')
		return row.position != null && row.position <= target.threshold;

	return row.points != null && row.points >= target.threshold;
}

function computeConversionRate(convertedCount: number, count: number, target: ArchetypeConversionTarget | undefined): number | null {
	if (!target || count === 0)
		return null;

	return Math.round((convertedCount / count) * 10000) / 100;
}

export interface MetagameArchetypeRow {
	id: number;
	name: string;
	colors: string | null;
}

export interface ArchetypeAccumulator {
	wins: number;
	losses: number;
	totalPosition: number;
	playersWithPosition: number;
	convertedCount: number;
	count: number;
}

const OTHER_ARCHETYPE_ID = -1;

export function groupClassifiedPlayersByArchetype(
	rows: ClassifiedArchetypePlayerRow[],
	conversionTarget?: ArchetypeConversionTarget,
): Map<number, ArchetypeAccumulator> {
	const groups = new Map<number, ArchetypeAccumulator>();

	for (const row of rows) {
		if (!row.archetypeId)
			continue;

		if (!groups.has(row.archetypeId)) {
			groups.set(row.archetypeId, {
				wins: 0,
				losses: 0,
				totalPosition: 0,
				playersWithPosition: 0,
				convertedCount: 0,
				count: 0,
			});
		}

		const group = groups.get(row.archetypeId)!;
		group.count++;
		group.wins += row.wins ?? 0;
		group.losses += row.losses ?? 0;

		if (row.position != null) {
			group.totalPosition += row.position;
			group.playersWithPosition++;
		}

		if (conversionTarget && isConvertedPlayer(row, conversionTarget))
			group.convertedCount++;
	}

	return groups;
}

export function buildArchetypeBreakdownEntries(
	groups: Map<number, ArchetypeAccumulator>,
	archetypes: MetagameArchetypeRow[],
	classifiedPlayers: number,
	keyCardsByArchetypeId: Map<number, CardResponse[]>,
	conversionTarget?: ArchetypeConversionTarget,
): ArchetypeBreakdownEntry[] {
	const archetypeMap = new Map(archetypes.map(archetype => [archetype.id, archetype]));
	const entries: ArchetypeBreakdownEntry[] = [];

	for (const [archetypeId, group] of groups) {
		const archetype = archetypeMap.get(archetypeId);
		if (!archetype)
			continue;

		entries.push({
			id: archetypeId,
			name: archetype.name,
			colors: archetype.colors,
			count: group.count,
			metaShare: classifiedPlayers > 0 ? Math.round((group.count / classifiedPlayers) * 10000) / 100 : 0,
			winRate: computeMetagameWinRate(group.wins, group.losses),
			avgPosition: group.playersWithPosition > 0 ? Math.round((group.totalPosition / group.playersWithPosition) * 10) / 10 : null,
			conversionRate: computeConversionRate(group.convertedCount, group.count, conversionTarget),
			keyCards: keyCardsByArchetypeId.get(archetypeId) ?? [],
		});
	}

	return entries;
}

export function compareArchetypeBreakdownEntries(
	sortBy: 'count' | 'winRate' | 'metaShare' | 'conversionRate',
	a: ArchetypeBreakdownEntry,
	b: ArchetypeBreakdownEntry,
): number {
	const primaryDifference = (() => {
		switch (sortBy) {
			case 'count': return b.count - a.count;
			case 'winRate': return (b.winRate ?? -1) - (a.winRate ?? -1);
			case 'conversionRate': return (b.conversionRate ?? -1) - (a.conversionRate ?? -1);
			default: return b.metaShare - a.metaShare;
		}
	})();

	if (primaryDifference !== 0)
		return primaryDifference;

	return a.name.localeCompare(b.name);
}

export function limitArchetypeBreakdownEntries(
	entries: ArchetypeBreakdownEntry[],
	groups: Map<number, ArchetypeAccumulator>,
	classifiedPlayers: number,
	limit?: number,
	conversionTarget?: ArchetypeConversionTarget,
): ArchetypeBreakdownEntry[] {
	if (limit == null || entries.length <= limit) {
		return entries;
	}

	const visibleEntries = entries.slice(0, limit);
	const hiddenEntries = entries.slice(limit);
	const hiddenTotals = hiddenEntries.reduce<ArchetypeAccumulator>((totals, entry) => {
		const group = groups.get(entry.id);
		if (!group) {
			return totals;
		}

		totals.wins += group.wins;
		totals.losses += group.losses;
		totals.totalPosition += group.totalPosition;
		totals.playersWithPosition += group.playersWithPosition;
		totals.convertedCount += group.convertedCount;
		totals.count += group.count;
		return totals;
	}, {
		wins: 0,
		losses: 0,
		totalPosition: 0,
		playersWithPosition: 0,
		convertedCount: 0,
		count: 0,
	});

	return [
		...visibleEntries,
		{
			id: OTHER_ARCHETYPE_ID,
			name: 'Other',
			colors: null,
			count: hiddenTotals.count,
			metaShare: classifiedPlayers > 0
				? Math.round((hiddenTotals.count / classifiedPlayers) * 10000) / 100
				: 0,
			winRate: computeMetagameWinRate(hiddenTotals.wins, hiddenTotals.losses),
			avgPosition: hiddenTotals.playersWithPosition > 0
				? Math.round((hiddenTotals.totalPosition / hiddenTotals.playersWithPosition) * 10) / 10
				: null,
			conversionRate: computeConversionRate(hiddenTotals.convertedCount, hiddenTotals.count, conversionTarget),
			keyCards: [],
		},
	];
}
