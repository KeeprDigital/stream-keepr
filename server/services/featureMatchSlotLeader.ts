import type { PlayerSlotData } from '~~/shared/api';
import type { OpLeader, OpPlayerGameData, PlayerGameData } from '~~/shared/types/game';
import { opCardCatalogueService } from '~~/server/services/opCardCatalogue';
import { catalogueOpLeader } from '~~/shared/utils/card/op';
import { getOpGameData, storedOpLeader } from '~~/shared/utils/gameData';

/**
 * A Feature Match Slot side's Leader references the card catalogue by number
 * (ADR-0074). A side stores only `{ number }`; every read of a Slot fills the
 * Leader from the catalogue's row, so a reader sees the whole card, and a
 * number the catalogue lacks reads as no Leader.
 */

const SIDE_KEYS = ['player1Data', 'player2Data'] as const;

interface SlotSides {
	player1Data?: PlayerSlotData | null;
	player2Data?: PlayerSlotData | null;
}

/** The card number of a One Piece side's Leader, or `null` for a side with none. */
export function slotLeaderNumberOf(data: PlayerSlotData | null | undefined): string | null {
	if (data?.gameData?.type !== 'op')
		return null;
	const number: unknown = storedOpLeader(data.gameData.leader)?.number;
	return typeof number === 'string'
		? number
		: null;
}

function withLeader(data: PlayerSlotData, leader: OpLeader | null): PlayerSlotData {
	return {
		...data,
		gameData: {
			...getOpGameData(data.gameData),
			leader,
		},
	};
}

function mapLeaderSides<T extends SlotSides>(sides: T, map: (data: PlayerSlotData, number: string) => PlayerSlotData): T {
	const mapped = { ...sides };
	for (const key of SIDE_KEYS) {
		const data = sides[key];
		const number = slotLeaderNumberOf(data);
		if (data && number !== null)
			mapped[key] = map(data, number);
	}
	return mapped;
}

/**
 * A One Piece side linked to a Player shows that Player's Leader and Deck List,
 * by reference (ADR-0074): its game data is the Player's, as a Slot stores it,
 * and the side holds no Feature Match Deck List of its own.
 */
export function linkedOpSideGameData(playerGameData: PlayerGameData | null | undefined): OpPlayerGameData {
	const deckList = playerGameData?.type === 'op'
		? playerGameData.deckList ?? null
		: null;
	return {
		type: 'op',
		leader: deckList?.leaderNumber
			? { number: deckList.leaderNumber } as OpLeader
			: null,
		deckList,
	};
}

/** The sides as a Slot stores them: each Leader its card number only. */
export function toStoredSlotLeaders<T extends SlotSides>(sides: T): T {
	// The stored shape is the reference alone; reads restore the card (`withCatalogueLeaders`).
	return mapLeaderSides(sides, (data, number) => withLeader(data, { number } as OpLeader));
}

/** Slots as read: each side's Leader the catalogue's card for its number, in one catalogue read. */
export async function withCatalogueLeaders<T extends SlotSides>(slots: readonly T[]): Promise<T[]> {
	const numbers = slots.flatMap(slot => SIDE_KEYS.map(key => slotLeaderNumberOf(slot[key])))
		.filter((number): number is string => number !== null);
	if (numbers.length === 0)
		return [...slots];
	const cards = await opCardCatalogueService().findByNumbers([
		...new Set(numbers),
	]);
	return slots.map(slot => mapLeaderSides(slot, (data, number) => {
		const card = cards.get(number);
		return withLeader(data, card
			? catalogueOpLeader(number, card)
			: null);
	}));
}

/** The sides' Leader numbers, for a write to catalogue before it stores them. */
export function slotLeaderNumbers(sides: SlotSides): string[] {
	return [
		...new Set(SIDE_KEYS.map(key => slotLeaderNumberOf(sides[key])).filter((number): number is string => number !== null)),
	];
}
