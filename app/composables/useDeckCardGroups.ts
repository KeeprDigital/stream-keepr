import type { MaybeRefOrGetter } from 'vue';
import type { GroupableCard } from '~~/shared/utils/deckGrouping';
import { groupByCmc, groupByType } from '~~/shared/utils/deckGrouping';
import { getCardTypeBucketOrder } from '~~/shared/utils/metagame';

/**
 * Reactive deck card groupings derived from a cards array.
 * Accepts any card type extending GroupableCard (DeckListCard, PlayerDeckCardEntry, etc.).
 */
export function useDeckCardGroups<T extends GroupableCard>(cards: MaybeRefOrGetter<T[]>) {
	const resolved = computed(() => toValue(cards));

	const mainboardCards = computed(() =>
		resolved.value
			.filter(card => card.compartment === 'mainboard')
			.sort((a, b) => getCardTypeBucketOrder(a.cardType) - getCardTypeBucketOrder(b.cardType) || a.name.localeCompare(b.name)),
	);

	const sideboardCards = computed(() =>
		resolved.value
			.filter(card => card.compartment === 'sideboard')
			.sort((a, b) => getCardTypeBucketOrder(a.cardType) - getCardTypeBucketOrder(b.cardType) || a.name.localeCompare(b.name)),
	);

	const mainboardTotal = computed(() => mainboardCards.value.reduce((sum, c) => sum + c.quantity, 0));
	const sideboardTotal = computed(() => sideboardCards.value.reduce((sum, c) => sum + c.quantity, 0));

	const mainboardByType = computed(() => groupByType(mainboardCards.value));
	const sideboardByType = computed(() => groupByType(sideboardCards.value));
	const mainboardByCmc = computed(() => groupByCmc(mainboardCards.value));

	return {
		mainboardCards,
		sideboardCards,
		mainboardTotal,
		sideboardTotal,
		mainboardByType,
		sideboardByType,
		mainboardByCmc,
	};
}
