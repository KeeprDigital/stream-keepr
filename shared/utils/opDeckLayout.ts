import type { FeatureMatchDeckListEntry } from '../types/featureMatchDeckList';

/**
 * How a Deck List Screen lays out a One Piece Card Game Deck List: its
 * Mainboard grouped Character, Event, Stage, each by cost, and its cost
 * curve. The Leader is shown apart, so it is in neither. A number-only entry,
 * which bandai-keepr did not know, is grouped last and has no cost.
 */

export type OpDeckGroupKey = 'character' | 'event' | 'stage' | 'unknown';

export interface OpDeckCard {
	number: string;
	/** `null` for a number-only entry. */
	name: string | null;
	quantity: number;
	cost: number | null;
	imageUrl: string | null;
}

export interface OpDeckGroup {
	key: OpDeckGroupKey;
	label: string;
	/** Its cards' quantities, summed. */
	count: number;
	cards: OpDeckCard[];
}

export interface OpCostBucket {
	cost: number;
	count: number;
}

export interface OpDeckLayout {
	groups: OpDeckGroup[];
	/** Every cost from 0 (or 1, when nothing costs 0) to the highest, empty ones included. */
	costCurve: OpCostBucket[];
}

const GROUPS: ReadonlyArray<{ key: OpDeckGroupKey; label: string }> = [
	{ key: 'character', label: 'Character' },
	{ key: 'event', label: 'Event' },
	{ key: 'stage', label: 'Stage' },
	{ key: 'unknown', label: 'Unknown' },
];

function groupOf(entry: FeatureMatchDeckListEntry): OpDeckGroupKey | null {
	const category = entry.card?.category;
	if (!category)
		return 'unknown';
	return category === 'leader'
		? null
		: category;
}

function byCostThenNumber(left: OpDeckCard, right: OpDeckCard): number {
	const cost = (left.cost ?? Number.POSITIVE_INFINITY) - (right.cost ?? Number.POSITIVE_INFINITY);
	if (cost !== 0 && !Number.isNaN(cost))
		return cost;
	return left.number.localeCompare(right.number);
}

export function opDeckLayout(entries: readonly FeatureMatchDeckListEntry[]): OpDeckLayout {
	const cardsByGroup = new Map<OpDeckGroupKey, OpDeckCard[]>();
	for (const entry of entries) {
		const key = groupOf(entry);
		if (!key)
			continue;
		const cards = cardsByGroup.get(key) ?? [];
		cards.push({
			number: entry.number,
			name: entry.card?.name ?? null,
			quantity: entry.quantity,
			cost: entry.card?.cost ?? null,
			imageUrl: entry.card?.imageUrl ?? null,
		});
		cardsByGroup.set(key, cards);
	}

	const groups = GROUPS.flatMap(({ key, label }) => {
		const cards = cardsByGroup.get(key);
		return cards
			? [
					{
						key,
						label,
						count: cards.reduce((total, card) => total + card.quantity, 0),
						cards: cards.toSorted(byCostThenNumber),
					},
				]
			: [];
	});

	const countByCost = new Map<number, number>();
	for (const card of groups.flatMap(group => group.cards)) {
		if (card.cost !== null)
			countByCost.set(card.cost, (countByCost.get(card.cost) ?? 0) + card.quantity);
	}
	const costs = [
		...countByCost.keys(),
	];
	const costCurve = costs.length === 0
		? []
		: Array.from({ length: Math.max(...costs) - Math.min(1, ...costs) + 1 }, (_, index) => {
				const cost = Math.min(1, ...costs) + index;
				return { cost, count: countByCost.get(cost) ?? 0 };
			});

	return { groups, costCurve };
}
