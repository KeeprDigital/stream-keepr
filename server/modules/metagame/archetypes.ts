import type { ArchetypeBreakdownEntry, CardResponse } from '~~/shared/types/metagame';
import { computeMetagameWinRate } from '~~/server/services/metagameMetrics';

export interface ClassifiedArchetypePlayerRow {
	archetypeId: number | null;
	wins: number | null;
	losses: number | null;
	position: number | null;
}

export interface MetagameArchetypeRow {
	id: number;
	name: string;
	colors: string | null;
}

interface ArchetypeAccumulator {
	wins: number;
	losses: number;
	totalPosition: number;
	playersWithPosition: number;
	count: number;
}

export function groupClassifiedPlayersByArchetype(rows: ClassifiedArchetypePlayerRow[]): Map<number, ArchetypeAccumulator> {
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
	}

	return groups;
}

export function buildArchetypeBreakdownEntries(
	groups: Map<number, ArchetypeAccumulator>,
	archetypes: MetagameArchetypeRow[],
	classifiedPlayers: number,
	keyCardsByArchetypeId: Map<number, CardResponse[]>,
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
			keyCards: keyCardsByArchetypeId.get(archetypeId) ?? [],
		});
	}

	return entries;
}

export function compareArchetypeBreakdownEntries(
	sortBy: 'count' | 'winRate' | 'metaShare',
	a: ArchetypeBreakdownEntry,
	b: ArchetypeBreakdownEntry,
): number {
	const primaryDifference = (() => {
		switch (sortBy) {
			case 'count': return b.count - a.count;
			case 'winRate': return (b.winRate ?? -1) - (a.winRate ?? -1);
			default: return b.metaShare - a.metaShare;
		}
	})();

	if (primaryDifference !== 0)
		return primaryDifference;

	return a.name.localeCompare(b.name);
}
