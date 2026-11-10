import type { Game, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameScope, MetagameSortBy } from '../types/enums';
import { getMetagameRules } from '../config/games';
import { scryfallCardImageUrl } from './scryfallCardImage';

export function getFrontFaceCardType(cardType: string | null | undefined): string {
	return (cardType ?? '').split(' // ')[0]?.trim() ?? '';
}

export const CARD_TYPE_BUCKET_ORDER = [
	'Creature',
	'Planeswalker',
	'Battle',
	'Instant',
	'Sorcery',
	'Artifact',
	'Enchantment',
	'Land',
	'Other',
] as const;

export type CardTypeBucket = typeof CARD_TYPE_BUCKET_ORDER[number];

/**
 * Which type names a card of several: a land of a second type (Urza's Saga, an
 * artifact land) is a Land, as `isLandCardType` reads it, and only a creature
 * land (Dryad Arbor) is not.
 */
const CARD_TYPE_BUCKET_PRECEDENCE = [
	'Creature',
	'Land',
	...CARD_TYPE_BUCKET_ORDER.filter(bucket => bucket !== 'Creature' && bucket !== 'Land' && bucket !== 'Other'),
] as const;

export function getCardTypeBucket(cardType: string | null | undefined): CardTypeBucket {
	const frontFaceType = getFrontFaceCardType(cardType);

	for (const bucket of CARD_TYPE_BUCKET_PRECEDENCE) {
		if (frontFaceType.includes(bucket)) {
			return bucket;
		}
	}

	return 'Other';
}

/**
 * A One Piece Card Game Metagame's card types: its catalogue categories past
 * the Leader, which is the Archetype rather than a card it counts (ADR-0074).
 */
export const OP_CARD_TYPE_BUCKET_ORDER = [
	'Character',
	'Event',
	'Stage',
] as const;

export type OpCardTypeBucket = typeof OP_CARD_TYPE_BUCKET_ORDER[number];

/** Every Card Game's Metagame card types: what a card type filter may name. */
export const METAGAME_CARD_TYPE_BUCKETS = [
	...CARD_TYPE_BUCKET_ORDER,
	...OP_CARD_TYPE_BUCKET_ORDER,
] as const;

export type MetagameCardTypeBucket = typeof METAGAME_CARD_TYPE_BUCKETS[number];

/** The card types a Metagame of `game` groups its cards by, in order. */
export function getMetagameCardTypeBuckets(game: Game | undefined): readonly MetagameCardTypeBucket[] {
	return game === 'op'
		? OP_CARD_TYPE_BUCKET_ORDER
		: CARD_TYPE_BUCKET_ORDER;
}

/**
 * The type a Metagame card breakdown entry of `game` counts under. An OP
 * entry's card type is already its bucket; an MTG one's is its type line.
 */
export function getMetagameCardTypeBucket(game: Game | undefined, cardType: string | null | undefined): MetagameCardTypeBucket {
	if (game === 'op') {
		return OP_CARD_TYPE_BUCKET_ORDER.find(bucket => bucket === cardType) ?? 'Other';
	}

	return getCardTypeBucket(cardType);
}

export function getCardTypeBucketOrder(cardType: string | null | undefined): number {
	return CARD_TYPE_BUCKET_ORDER.indexOf(getCardTypeBucket(cardType));
}

export function getCardTypeDisplayLabel(
	cardType: string | null | undefined,
	options: { nonbasicLandLabel?: boolean } = {},
): string {
	// An OP Metagame entry's card type is already its bucket (ADR-0074).
	const opBucket = OP_CARD_TYPE_BUCKET_ORDER.find(bucket => bucket === cardType);
	if (opBucket) {
		return opBucket;
	}

	const bucket = getCardTypeBucket(cardType);
	if (bucket === 'Land' && options.nonbasicLandLabel) {
		return 'Nonbasic Land';
	}

	return bucket;
}

export function isLandCardType(cardType: string | null | undefined): boolean {
	return getFrontFaceCardType(cardType).toLowerCase().includes('land');
}

export function isBasicLandCardType(cardType: string | null | undefined): boolean {
	const frontFace = getFrontFaceCardType(cardType).toLowerCase();
	return frontFace.includes('basic') && frontFace.includes('land');
}

export function isMetagameAnalysisCard(cardType: string | null | undefined): boolean {
	return !isBasicLandCardType(cardType);
}

/** The columns that read standings, which a participation-only Metagame shows none of (ADR-0074). */
const STANDINGS_COLUMNS: ReadonlySet<MetagameArchetypeColumnKey | MetagameCardColumnKey> = new Set(['winRate', 'avgPlace', 'conversionRate']);
/** The card columns only Magic's cards fill: a mana cost and a Sideboard. */
const MTG_CARD_COLUMNS: ReadonlySet<MetagameArchetypeColumnKey | MetagameCardColumnKey> = new Set(['manaCost', 'sideboardCount']);

/** Whether a Metagame of `game` shows the archetype or card column `key`. */
export function isMetagameColumnOffered(game: Game | undefined, key: MetagameArchetypeColumnKey | MetagameCardColumnKey): boolean {
	if (game === undefined || game === 'mtg')
		return true;
	if (STANDINGS_COLUMNS.has(key))
		return getMetagameRules(game).readsStandings;
	return !MTG_CARD_COLUMNS.has(key);
}

/** Whether a Metagame of `game` orders its archetypes by `sortBy`: win rate and Conversion Rate read standings. */
export function isMetagameSortOffered(game: Game | undefined, sortBy: MetagameSortBy): boolean {
	if (game === undefined || (sortBy !== 'winRate' && sortBy !== 'conversionRate'))
		return true;
	return getMetagameRules(game).readsStandings;
}

/** The scope a Metagame of `game` reads for `scope`: one it does not offer reads every Player, as the server does. */
export function offeredMetagameScope(game: Game | undefined, scope: MetagameScope): MetagameScope {
	return game === undefined || getMetagameRules(game).scopes.includes(scope)
		? scope
		: 'all';
}

/** A Metagame card's image: an OP card's standard Printing, else its Scryfall face. */
export function metagameCardImageUrl(card: { imageUrl?: string | null; scryfallId: string | null }): string | null {
	return card.imageUrl ?? scryfallCardImageUrl(card.scryfallId);
}
