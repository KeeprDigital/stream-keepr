import type { ArchetypeBreakdownEntry, ArchetypeBreakdownResponse } from '~~/shared/types/metagame';
import { OTHER_ARCHETYPE_ID } from '~~/shared/types/metagame';

/**
 * The most Archetypes the Metagame chart draws, one per categorical colour
 * slot. Archetypes past it fold into Other, so a chart never generates a
 * ninth colour or a second page.
 */
export const METAGAME_CHART_MAX_ARCHETYPES = 8;

/** One bar of the Metagame chart: an Archetype, or the Other group. */
export interface MetagameChartBar {
	/** Archetype id, or {@link OTHER_ARCHETYPE_ID} for Other. */
	id: number;
	name: string;
	/** The Archetype's mana colours, or null. */
	colors: string | null;
	/** Percentage of classified Players in scope. */
	metaShare: number;
	/** The bar's length against the largest share on the chart, 0 to 1. */
	length: number;
	/** Categorical colour slot, 1 to {@link METAGAME_CHART_MAX_ARCHETYPES}; null for Other, which is neutral. */
	colorSlot: number | null;
}

function isAggregate(entry: ArchetypeBreakdownEntry): boolean {
	return entry.id < 0;
}

function shareOf(count: number, classifiedPlayers: number): number {
	// The breakdown's own rounding, so a folded Other reads like the server's.
	return classifiedPlayers > 0 ? Math.round((count / classifiedPlayers) * 10000) / 100 : 0;
}

/**
 * Gives each Archetype on the chart a distinct colour slot by its id rather
 * than its rank, so a reload or a re-sort leaves every colour where it was.
 * Each prefers the slot its id lands on; a clash moves the higher id to the
 * next free slot. Eight slots cannot hold every id, so an Archetype entering
 * or leaving the chart can move one whose preferred slot it shares, and only
 * that one.
 */
function assignColorSlots(ids: number[]): Map<number, number> {
	const slots = new Map<number, number>();
	const taken = new Set<number>();

	for (const id of [...ids].sort((a, b) => a - b)) {
		const preferred = ((id - 1) % METAGAME_CHART_MAX_ARCHETYPES + METAGAME_CHART_MAX_ARCHETYPES) % METAGAME_CHART_MAX_ARCHETYPES;
		for (let offset = 0; offset < METAGAME_CHART_MAX_ARCHETYPES; offset++) {
			const slot = ((preferred + offset) % METAGAME_CHART_MAX_ARCHETYPES) + 1;
			if (!taken.has(slot)) {
				taken.add(slot);
				slots.set(id, slot);
				break;
			}
		}
	}

	return slots;
}

/**
 * The Metagame chart's bars, read off the same archetype breakdown the
 * archetype table renders (same scope, sort and Top archetypes limit). The
 * breakdown's order is kept, Other last; Archetypes past
 * {@link METAGAME_CHART_MAX_ARCHETYPES} join Other.
 */
export function projectMetagameChart(breakdown: ArchetypeBreakdownResponse): MetagameChartBar[] {
	const archetypes = breakdown.entries.filter(entry => !isAggregate(entry));
	const shown = archetypes.slice(0, METAGAME_CHART_MAX_ARCHETYPES);
	const otherCount = archetypes.slice(METAGAME_CHART_MAX_ARCHETYPES)
		.concat(breakdown.entries.filter(isAggregate))
		.reduce((total, entry) => total + entry.count, 0);

	const colorSlots = assignColorSlots(shown.map(entry => entry.id));
	const rows: Omit<MetagameChartBar, 'length'>[] = shown.map(entry => ({
		id: entry.id,
		name: entry.name,
		colors: entry.colors,
		metaShare: entry.metaShare,
		colorSlot: colorSlots.get(entry.id) ?? null,
	}));

	if (otherCount > 0) {
		rows.push({
			id: OTHER_ARCHETYPE_ID,
			name: 'Other',
			colors: null,
			metaShare: shareOf(otherCount, breakdown.classifiedPlayers),
			colorSlot: null,
		});
	}

	const largestShare = Math.max(0, ...rows.map(row => row.metaShare));
	return rows.map(row => ({ ...row, length: largestShare > 0 ? row.metaShare / largestShare : 0 }));
}
