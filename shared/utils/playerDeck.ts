import type { MtgCard } from '../types/card/mtg';
import type { DeckCompanion } from '../types/deckCompanion';
import type { DeckListStats, ManaCurve, ManaPipCounts, PlayerDeckList } from '../types/deckList';
import type { PlayerDeckResponse } from '../types/metagame';

interface CreatePlayerDeckListOptions {
	phaseName?: string | null;
	stats?: DeckListStats;
	pips?: ManaPipCounts;
	curve?: ManaCurve;
}

export function isReviewedPlayerDeck(deck: { archetypeId: number | null; reviewedAt: Date | string | null }): boolean {
	return deck.reviewedAt != null && deck.archetypeId != null;
}

export function createPlayerDeckList(
	deckResponse: PlayerDeckResponse,
	options: CreatePlayerDeckListOptions = {},
): PlayerDeckList {
	return {
		deckId: deckResponse.id,
		externalId: deckResponse.externalId,
		formatExternalId: deckResponse.formatExternalId,
		phaseIds: [...deckResponse.phaseIds],
		phaseName: options.phaseName ?? deckResponse.phaseName,
		name: deckResponse.name,
		colors: deckResponse.colors,
		isPrimary: deckResponse.isPrimary,
		cards: deckResponse.cards as unknown as PlayerDeckList['cards'],
		...(options.stats ? { stats: options.stats } : {}),
		...(options.pips ? { pips: options.pips } : {}),
		...(options.curve ? { curve: options.curve } : {}),
		companion: deckResponse.companion ?? null,
		highlander: deckResponse.highlander,
	};
}

interface DeckLookupCardLike {
	name: string;
	scryfallId: string | null;
}

export function createDeckLookupCards<T extends DeckLookupCardLike>(
	cards: T[],
	companion?: Pick<DeckCompanion, 'name' | 'scryfallId'> | null,
): Array<Pick<DeckLookupCardLike, 'name' | 'scryfallId'>> {
	return companion
		? [...cards, { name: companion.name, scryfallId: companion.scryfallId }]
		: cards;
}

export function getDeckCardImageUrl(
	cardDataMap: Map<string, MtgCard>,
	card: DeckLookupCardLike,
): string | null {
	const mtgCard = card.scryfallId
		? cardDataMap.get(card.scryfallId) ?? null
		: cardDataMap.get(`name:${card.name.toLowerCase()}`) ?? null;

	return mtgCard?.imageData?.front?.normal ?? null;
}
