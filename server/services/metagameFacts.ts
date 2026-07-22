import type {
	ArchetypeBreakdownEntry,
	CardBreakdownEntry,
	MetagameCardSplitFact,
	MetagameFact,
	MetagameSimpleFact,
} from '~~/shared/types/metagame';

interface BuildMetagameFactsOptions {
	totalPlayers: number;
	classifiedPlayers: number;
	totalDecks: number;
	archetypes: ArchetypeBreakdownEntry[];
	cards: CardBreakdownEntry[];
	minArchetypePlayers?: number;
	minCardDecks?: number;
}

function formatPercent(value: number | null | undefined) {
	return value == null ? '-' : `${value}%`;
}

function formatDeckShare(deckCount: number, totalDecks: number) {
	if (totalDecks <= 0)
		return '0.0%';

	return `${(Math.round((deckCount / totalDecks) * 1000) / 10).toFixed(1)}%`;
}

function buildSimpleFact(fact: Omit<MetagameSimpleFact, 'kind'>): MetagameSimpleFact {
	return { kind: 'simple', ...fact };
}

function buildCardSplitFact(fact: Omit<MetagameCardSplitFact, 'kind'>): MetagameCardSplitFact {
	return { kind: 'cardSplit', ...fact };
}

export function buildMetagameFacts({
	totalPlayers: _totalPlayers,
	classifiedPlayers: _classifiedPlayers,
	totalDecks,
	archetypes,
	cards,
	minArchetypePlayers = 5,
	minCardDecks = 5,
}: BuildMetagameFactsOptions): MetagameFact[] {
	const facts: MetagameFact[] = [];

	const mostPlayedArchetype = archetypes
		.filter(archetype => archetype.count > 0)
		.sort((left, right) => right.count - left.count)[0];
	if (mostPlayedArchetype) {
		facts.push(buildSimpleFact({
			key: 'mostPlayedArchetype',
			title: 'Most PLayed Archetype',
			value: mostPlayedArchetype.name,
			detail: `${mostPlayedArchetype.count} players · ${formatPercent(mostPlayedArchetype.metaShare)} of field`,
			tone: 'neutral',
		}));
	}

	const majorArchetype = archetypes
		.filter(archetype => archetype.count >= minArchetypePlayers && archetype.winRate != null)
		.sort((left, right) => (right.winRate ?? -1) - (left.winRate ?? -1))[0];
	if (majorArchetype) {
		facts.push(buildSimpleFact({
			key: 'bestMajorWinRate',
			title: `Best Win Rate (${minArchetypePlayers}+ players)`,
			value: formatPercent(majorArchetype.winRate),
			detail: `${majorArchetype.name} · ${majorArchetype.count} players`,
			tone: 'neutral',
		}));
	}

	const mostPlayedMainboardCard = cards
		.filter(card => card.mainboardCount > 0)
		.sort((left, right) => {
			if (right.mainboardCount !== left.mainboardCount)
				return right.mainboardCount - left.mainboardCount;
			return right.deckCount - left.deckCount;
		})[0];
	const mostPlayedSideboardCard = cards
		.filter(card => card.sideboardCount > 0)
		.sort((left, right) => {
			if (right.sideboardCount !== left.sideboardCount)
				return right.sideboardCount - left.sideboardCount;
			return right.deckCount - left.deckCount;
		})[0];
	if (totalDecks > 0 && (mostPlayedMainboardCard || mostPlayedSideboardCard)) {
		facts.push(buildCardSplitFact({
			key: 'mostPlayedCards',
			title: 'Most Played Cards',
			mainboard: mostPlayedMainboardCard
				? {
						label: 'Mainboard',
						value: mostPlayedMainboardCard.name,
						detail: `${mostPlayedMainboardCard.mainboardCount} copies across ${mostPlayedMainboardCard.mainboardDeckCount} decks · ${formatDeckShare(mostPlayedMainboardCard.mainboardDeckCount, totalDecks)} of decks`,
					}
				: null,
			sideboard: mostPlayedSideboardCard
				? {
						label: 'Sideboard',
						value: mostPlayedSideboardCard.name,
						detail: `${mostPlayedSideboardCard.sideboardCount} copies across ${mostPlayedSideboardCard.sideboardDeckCount} decks · ${formatDeckShare(mostPlayedSideboardCard.sideboardDeckCount, totalDecks)} of decks`,
					}
				: null,
			tone: 'neutral',
		}));
	}

	const highestAvgCopiesMainboardCard = cards
		.filter(card => card.mainboardDeckCount >= minCardDecks)
		.sort((left, right) => {
			const leftAvg = left.mainboardDeckCount > 0 ? left.mainboardCount / left.mainboardDeckCount : 0;
			const rightAvg = right.mainboardDeckCount > 0 ? right.mainboardCount / right.mainboardDeckCount : 0;
			if (rightAvg !== leftAvg)
				return rightAvg - leftAvg;
			return right.mainboardDeckCount - left.mainboardDeckCount;
		})[0];

	const highestAvgCopiesSideboardCard = cards
		.filter(card => card.sideboardDeckCount >= minCardDecks)
		.sort((left, right) => {
			const leftAvg = left.sideboardDeckCount > 0 ? left.sideboardCount / left.sideboardDeckCount : 0;
			const rightAvg = right.sideboardDeckCount > 0 ? right.sideboardCount / right.sideboardDeckCount : 0;
			if (rightAvg !== leftAvg)
				return rightAvg - leftAvg;
			return right.sideboardDeckCount - left.sideboardDeckCount;
		})[0];
	if (highestAvgCopiesMainboardCard || highestAvgCopiesSideboardCard) {
		facts.push(buildCardSplitFact({
			key: 'highestAvgCopiesCards',
			title: `Highest Avg Copies (${minCardDecks}+ decks)`,
			mainboard: highestAvgCopiesMainboardCard
				? {
						label: 'Mainboard',
						value: highestAvgCopiesMainboardCard.name,
						detail: `${Math.round((highestAvgCopiesMainboardCard.mainboardCount / highestAvgCopiesMainboardCard.mainboardDeckCount) * 100) / 100} avg copies across ${highestAvgCopiesMainboardCard.mainboardDeckCount} decks · ${formatDeckShare(highestAvgCopiesMainboardCard.mainboardDeckCount, totalDecks)} of decks`,
					}
				: null,
			sideboard: highestAvgCopiesSideboardCard
				? {
						label: 'Sideboard',
						value: highestAvgCopiesSideboardCard.name,
						detail: `${Math.round((highestAvgCopiesSideboardCard.sideboardCount / highestAvgCopiesSideboardCard.sideboardDeckCount) * 100) / 100} avg copies across ${highestAvgCopiesSideboardCard.sideboardDeckCount} decks · ${formatDeckShare(highestAvgCopiesSideboardCard.sideboardDeckCount, totalDecks)} of decks`,
					}
				: null,
			tone: 'neutral',
		}));
	}

	return facts;
}
