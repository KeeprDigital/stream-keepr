import type { ArchetypeBreakdownEntry, ArchetypeBreakdownResponse } from '~~/shared/types/metagame';

/**
 * The most Archetypes the Metagame chart draws, one per categorical colour
 * slot. Archetypes past it fold into Other, so a chart never generates a
 * ninth colour or a second page.
 */
export const METAGAME_CHART_MAX_ARCHETYPES = 8;

/** The id the Metagame breakdown reserves for its Other row (any negative id is an aggregate). */
const OTHER_BAR_ID = -1;

/** One bar of the Metagame chart: an Archetype, or the Other group. */
export interface MetagameChartBar {
	/** Archetype id, or a negative id for Other. */
	id: number;
	name: string;
	/** The Archetype's mana colours, or null. */
	colors: string | null;
	count: number;
	/** Percentage of classified Players in scope. */
	metaShare: number;
	/** The bar's length against the largest share on the chart, 0 to 1. */
	length: number;
	isOther: boolean;
	/** Categorical colour slot, 1 to {@link METAGAME_CHART_MAX_ARCHETYPES}; null for Other, which is neutral. */
	colourSlot: number | null;
}

function isAggregate(entry: ArchetypeBreakdownEntry): boolean {
	return entry.id < 0;
}

function shareOf(count: number, classifiedPlayers: number): number {
	// The breakdown's own rounding, so a folded Other reads like the server's.
	return classifiedPlayers > 0 ? Math.round((count / classifiedPlayers) * 10000) / 100 : 0;
}

/**
 * Gives each Archetype a distinct colour slot by its id rather than its rank,
 * so a reload, a re-sort or a live update leaves its colour where it was.
 * Each prefers the slot its id lands on; a clash moves the higher id to the
 * next free slot.
 */
function assignColourSlots(ids: number[]): Map<number, number> {
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

	const colourSlots = assignColourSlots(shown.map(entry => entry.id));
	const rows = shown.map(entry => ({
		id: entry.id,
		name: entry.name,
		colors: entry.colors,
		count: entry.count,
		metaShare: entry.metaShare,
		isOther: false,
		colourSlot: colourSlots.get(entry.id) ?? null,
	}));

	if (otherCount > 0) {
		rows.push({
			id: OTHER_BAR_ID,
			name: 'Other',
			colors: null,
			count: otherCount,
			metaShare: shareOf(otherCount, breakdown.classifiedPlayers),
			isOther: true,
			colourSlot: null,
		});
	}

	const largestShare = Math.max(0, ...rows.map(row => row.metaShare));
	return rows.map(row => ({ ...row, length: largestShare > 0 ? row.metaShare / largestShare : 0 }));
}
