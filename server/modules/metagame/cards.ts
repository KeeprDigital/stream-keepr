import type { OpCardCategory } from '~~/shared/types/card/op';
import type { BoardSelection, Game } from '~~/shared/types/enums';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import type { MetagameCardTypeBucket, OpCardTypeBucket } from '~~/shared/utils/metagame';
import { computeBoardScopedCardMetrics } from '~~/server/services/metagameMetrics';
import { decodeOpCatalogueColors } from '~~/server/services/opCardCatalogue';
import { formatOpColors } from '~~/shared/utils/card/op';
import { getMetagameCardTypeBucket, isMetagameAnalysisCard } from '~~/shared/utils/metagame';

export interface AggregatedMetagameCardRow {
	cardId: number;
	name: string;
	cardType: string | null;
	scryfallId: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
	cardNumber: string | null;
	imageUrl: string | null;
	totalCopies: number;
	mainboardCount: number;
	sideboardCount: number;
	mainboardDeckCount: number;
	sideboardDeckCount: number;
	deckCount: number;
}

/** The catalogue fields a card's Metagame type is read from: MTG's type line, OP's category. */
export interface MetagameCardTypeFacts {
	cardType: string | null;
	category?: OpCardCategory | null;
}

const OP_CARD_TYPE_BY_CATEGORY: Record<OpCardCategory, OpCardTypeBucket | null> = {
	leader: null,
	character: 'Character',
	event: 'Event',
	stage: 'Stage',
};

/**
 * The card type a Metagame of `game` shows a card under, or null when it
 * counts no such card. An OP card's is its category, and a Leader is the
 * Archetype rather than a card (ADR-0074).
 */
export function metagameCardType(game: Game, card: MetagameCardTypeFacts): string | null {
	if (game === 'op')
		return card.category ? OP_CARD_TYPE_BY_CATEGORY[card.category] : null;

	return card.cardType;
}

/** A card's colours as a Metagame of `game` shows them: OP's as `Red/Green`, as its Archetypes' are. */
export function metagameCardColors(game: Game, colors: string | null): string | null {
	if (game === 'op')
		return formatOpColors(decodeOpCatalogueColors(colors)) || null;

	return colors;
}

/** Whether a Metagame of `game` counts the card: MTG leaves basic lands out, OP its Leaders. */
export function isEligibleMetagameCard(game: Game, card: MetagameCardTypeFacts): boolean {
	if (game === 'op')
		return metagameCardType(game, card) !== null;

	return isMetagameAnalysisCard(card.cardType);
}

/**
 * Predicate over an excluded-bucket list. An empty/absent list excludes
 * nothing; buckets use the shared front-face classification, so a filtered
 * breakdown matches the client-side bucket toggles exactly.
 */
export function createCardTypeBucketFilter(
	game: Game,
	excludeTypes: readonly MetagameCardTypeBucket[] | undefined,
): (cardType: string | null) => boolean {
	if (!excludeTypes || excludeTypes.length === 0) {
		return () => true;
	}

	const excluded = new Set<MetagameCardTypeBucket>(excludeTypes);
	return cardType => !excluded.has(getMetagameCardTypeBucket(game, cardType));
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
		cardNumber: row.cardNumber,
		imageUrl: row.imageUrl,
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
	const primaryDifference = (() => {
		switch (sortBy) {
			case 'avgCopies': return b.avgCopies - a.avgCopies;
			case 'totalCopies': return b.totalCopies - a.totalCopies;
			default: return b.inclusionRate - a.inclusionRate;
		}
	})();

	if (primaryDifference !== 0)
		return primaryDifference;

	// A total order: tied cards keep their places across re-reads.
	return a.name.localeCompare(b.name) || a.id - b.id;
}
