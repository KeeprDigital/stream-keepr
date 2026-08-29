import type { BoardSelection } from '~~/shared/types/enums';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import { computeBoardScopedCardMetrics } from '~~/server/services/metagameMetrics';
import { getCardTypeBucket, isMetagameAnalysisCard } from '~~/shared/utils/metagame';

export interface AggregatedMetagameCardRow {
	cardId: number;
	name: string;
	cardType: string | null;
	scryfallId: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
	totalCopies: number;
	mainboardCount: number;
	sideboardCount: number;
	mainboardDeckCount: number;
	sideboardDeckCount: number;
	deckCount: number;
}

export function isEligibleMetagameCard(cardType: string | null): boolean {
	return isMetagameAnalysisCard(cardType);
}

/**
 * Predicate over an excluded-bucket list. An empty/absent list excludes
 * nothing; buckets use the shared front-face classification, so a filtered
 * breakdown matches the client-side bucket toggles exactly.
 */
export function createCardTypeBucketFilter(
	excludeTypes: readonly CardTypeBucket[] | undefined,
): (cardType: string | null) => boolean {
	if (!excludeTypes || excludeTypes.length === 0) {
		return () => true;
	}

	const excluded = new Set<CardTypeBucket>(excludeTypes);
	return cardType => !excluded.has(getCardTypeBucket(cardType));
}

export function toCardBreakdownEntry(
	row: AggregatedMetagameCardRow,
	totalDecks: number,
	board: BoardSelection,
): CardBreakdownEntry {
	const metrics = computeBoardScopedCardMetrics(row, totalDecks, board);

	return {
		id: row.cardId,
		name: row.name,
		cardType: row.cardType,
		scryfallId: row.scryfallId,
		colors: row.colors,
		cmc: row.cmc,
		manaCost: row.manaCost,
		inclusionRate: metrics.inclusionRate,
		avgCopies: metrics.avgCopies,
		totalCopies: metrics.totalCopies,
		mainboardCount: row.mainboardCount,
		sideboardCount: row.sideboardCount,
		mainboardDeckCount: row.mainboardDeckCount,
		sideboardDeckCount: row.sideboardDeckCount,
		deckCount: metrics.deckCount,
	};
}

export function compareCardBreakdownEntries(
	sortBy: 'inclusionRate' | 'avgCopies' | 'totalCopies',
	a: CardBreakdownEntry,
	b: CardBreakdownEntry,
): number {
	switch (sortBy) {
		case 'avgCopies': return b.avgCopies - a.avgCopies;
		case 'totalCopies': return b.totalCopies - a.totalCopies;
		default: return b.inclusionRate - a.inclusionRate;
	}
}
