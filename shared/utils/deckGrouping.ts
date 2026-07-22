import { CARD_TYPE_BUCKET_ORDER, getCardTypeBucket } from './metagame';

/**
 * Minimal structural interface satisfied by both DeckListCard and PlayerDeckCardEntry.
 * Used as the generic constraint for grouping utilities and useDeckCardGroups.
 */
export interface GroupableCard {
	compartment: string;
	cardType?: string | null;
	cmc?: number | null;
	name: string;
	quantity: number;
}

const CMC_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7+', '?'] as const;

/**
 * Group cards by card type. Preserves the concrete card type T.
 */
export function groupByType<T extends GroupableCard>(cards: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const card of cards) {
		const type = getCardTypeBucket(card.cardType);
		if (!groups.has(type))
			groups.set(type, []);
		groups.get(type)!.push(card);
	}

	const sorted = new Map<string, T[]>();
	for (const type of CARD_TYPE_BUCKET_ORDER) {
		if (groups.has(type)) {
			sorted.set(type, groups.get(type)!);
		}
	}

	return sorted;
}

/**
 * Group cards by CMC, bucketing >= 7 as '7+' and null as '?'.
 * Returns a map sorted in CMC order. Preserves the concrete card type T.
 */
export function groupByCmc<T extends GroupableCard>(cards: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const card of cards) {
		const key = card.cmc == null ? '?' : card.cmc >= 7 ? '7+' : String(Math.floor(card.cmc));
		if (!groups.has(key))
			groups.set(key, []);
		groups.get(key)!.push(card);
	}
	const sorted = new Map<string, T[]>();
	for (const k of CMC_ORDER) {
		if (groups.has(k))
			sorted.set(k, groups.get(k)!);
	}
	return sorted;
}
