import type { BoardSelection } from '~~/shared/types/enums';

interface AggregatedCardMetrics {
	totalCopies: number;
	mainboardCount: number;
	sideboardCount: number;
	mainboardDeckCount: number;
	sideboardDeckCount: number;
	deckCount: number;
}

export function computeMetagameWinRate(wins: number, losses: number): number | null {
	const total = wins + losses;
	if (total === 0)
		return null;
	return Math.round((wins / total) * 10000) / 100;
}

export function computeBoardScopedCardMetrics(
	row: AggregatedCardMetrics,
	totalDecks: number,
	board: BoardSelection,
) {
	const deckCount = board === 'mainboard'
		? row.mainboardDeckCount
		: board === 'sideboard'
			? row.sideboardDeckCount
			: row.deckCount;
	const totalCopies = board === 'mainboard'
		? row.mainboardCount
		: board === 'sideboard'
			? row.sideboardCount
			: row.totalCopies;

	return {
		deckCount,
		totalCopies,
		inclusionRate: totalDecks > 0 ? Math.round((deckCount / totalDecks) * 10000) / 100 : 0,
		avgCopies: deckCount > 0 ? Math.round((totalCopies / deckCount) * 100) / 100 : 0,
	};
}
