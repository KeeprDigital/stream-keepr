import type { DbCardInsert } from '~~/server/db/schema';
import type { OpCardCategory, OpCardSummary } from '~~/shared/types/card/op';
import type { FeatureMatchDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { OpLeader } from '~~/shared/types/game';

/** One Piece card fixtures: a searched card as bandai-keepr's proxy answers it, and a Slot side's Leader snapshot. */

/** A Leader card as the Event's `op-cards` search answers it. */
export function opCardSummary(overrides: Partial<OpCardSummary> = {}): OpCardSummary {
	return {
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
		cost: null,
		life: 5,
		power: 5000,
		counter: null,
		types: ['Supernovas'],
		effect: null,
		trigger: null,
		printingId: 'OP01-001',
		imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		...overrides,
	};
}

/** A Leader as a Feature Match Slot side holds it, imaged by its standard Printing. */
export function opLeader(number: string, name: string, colors: OpLeader['colors']): OpLeader {
	return {
		number,
		name,
		colors,
		imageUrl: `https://cards-img.keepr.digital/${number}.png`,
	};
}

export const ZORO = opLeader('OP01-001', 'Roronoa Zoro', ['Red']);
export const LUFFY = opLeader('OP01-003', 'Monkey.D.Luffy', ['Red', 'Green']);
export const NAMI = opLeader('OP01-016', 'Nami', ['Blue']);
export const LAW = opLeader('OP01-002', 'Trafalgar Law', ['Red', 'Green']);

/** The card catalogue's row for a Leader, so a Slot side referencing its number reads it (ADR-0074). */
export function opLeaderCatalogueRow(leader: OpLeader): DbCardInsert {
	return {
		name: leader.name,
		game: 'op',
		cardNumber: leader.number,
		category: 'leader',
		colors: JSON.stringify(leader.colors),
		imageUrl: leader.imageUrl,
	};
}

/** A Feature Match Deck List entry snapshotting a known card; `category: null` makes it number-only. */
export function opDeckListEntry(number: string, quantity: number, category: OpCardCategory | null, cost: number | null = null): FeatureMatchDeckListEntry {
	return {
		number,
		quantity,
		card: category === null
			? null
			: {
					name: `Card ${number}`,
					category,
					colors: ['Red'],
					cost,
					power: null,
					counter: null,
					imageUrl: `https://cards-img.keepr.digital/${number}.png`,
				},
	};
}

/** A One Piece Feature Match Slot side's slot data: its name, Leader and Deck List reference. */
export function opSlotSide(name: string, leader: OpLeader | null, deckListId: number | null) {
	return {
		name,
		gameData: {
			type: 'op' as const,
			leader,
			featureMatchDeckList: deckListId === null
				? null
				: { id: deckListId, mainboardCount: 50 },
		},
	};
}

/** A Card as bandai-keepr's `GET /cards/:number` answers it, with its standard Printing. */
export function bandaiKeeprCard(overrides: {
	number: string;
	name: string;
	category: string;
	colors: string[];
	cost?: number | null;
	power?: number | null;
	counter?: number | null;
}) {
	return {
		sourcePrintingId: overrides.number,
		cost: null,
		life: null,
		power: null,
		counter: null,
		types: [],
		effect: null,
		trigger: null,
		...overrides,
		printings: [
			{
				id: overrides.number,
				setId: 'OP-01',
				kind: 'standard',
				rarity: 'C',
			},
		],
	};
}

/** A card as the bulk lookup port answers it, imaged by its standard Printing. */
export function knownOpCard(card: Pick<OpCardSummary, 'number' | 'name' | 'category' | 'colors'> & Partial<OpCardSummary>): OpCardSummary {
	return opCardSummary({
		cost: null,
		life: null,
		power: null,
		counter: null,
		types: [],
		printingId: card.number,
		imageUrl: `https://cards-img.keepr.digital/${card.number}.png`,
		...card,
	});
}

/**
 * Fakes the bandai-keepr bulk lookup port (`lookUpOpCards`): it knows `cards`
 * by number and answers any other as not found. `batches()` lists the numbers
 * each call asked for since `reset()`; `fail()` makes every call throw.
 */
export function fakeOpCardBulkLookup(cards: OpCardSummary[]) {
	const byNumber = new Map(cards.map(card => [card.number, card]));
	let batches: string[][] = [];
	let failure: Error | null = null;
	return {
		lookUpOpCards: async (_config: unknown, numbers: readonly string[]) => {
			batches.push([...numbers]);
			if (failure)
				throw failure;
			return {
				cards: numbers.flatMap(number => byNumber.get(number) ?? []),
				notFound: numbers.filter(number => !byNumber.has(number)),
			};
		},
		batches: () => batches.map(batch => [...batch]),
		know: (card: OpCardSummary) => {
			byNumber.set(card.number, card);
		},
		fail: (error: Error) => {
			failure = error;
		},
		reset: () => {
			batches = [];
			failure = null;
		},
	};
}
