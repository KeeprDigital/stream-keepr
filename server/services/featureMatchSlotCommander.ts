import type { ManualPlayerSlotData, UpdateFeatureMatchInput } from '~~/shared/api';
import { commanderDeckIdentity } from '~~/shared/utils/commander';
import { COMMANDER_SEAT_DATA_KEYS, SLOT_SEAT_DATA_KEY } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * A Commander Event's Feature Match Slot Seats (ADR-0087). The Event has no
 * Players, so every Seat is typed and holds one or two Commanders, and a Seat
 * of any other Event holds none.
 */

const SEAT_DATA_KEYS = Object.values(SLOT_SEAT_DATA_KEY);

/** What a typed Seat keeps of a save: no record, and no deck but its Commanders'. */
const TYPED_SEAT_FIELDS = ['name', 'pronouns', 'lgs'] as const;

/** Whether a write's Deck List references are the Slot's own, settled by the setup write, or to be left out. */
interface CommanderSeatOptions {
	/** A setup save's, once settled; a create's names no Deck List the Slot could hold. */
	keepsDeckList: boolean;
}

/**
 * A Seat as a Commander Slot stores it: its name, pronouns and LGS, its
 * Commanders, which name and colour its deck, and its Feature Match Deck List
 * by reference. A Seat holding none of them is empty.
 */
export function commanderSeatData(data: ManualPlayerSlotData | null | undefined, { keepsDeckList }: CommanderSeatOptions): ManualPlayerSlotData | null {
	if (!data)
		return null;
	const seat: ManualPlayerSlotData = {};
	for (const field of TYPED_SEAT_FIELDS) {
		if (data[field])
			seat[field] = data[field];
	}
	const held = data.gameData?.type === 'mtg'
		? data.gameData
		: null;
	const commanders = held?.commanders ?? [];
	const featureMatchDeckList = keepsDeckList
		? held?.featureMatchDeckList ?? null
		: null;
	if (commanders.length > 0 || featureMatchDeckList) {
		seat.gameData = {
			type: 'mtg',
			commanders,
			...commanderDeckIdentity(commanders),
			...(featureMatchDeckList
				? { featureMatchDeckList }
				: {}),
		};
	}
	return Object.keys(seat).length > 0
		? seat
		: null;
}

/** A write with each Seat it names as a Commander Slot stores it. */
export function withCommanderSeats(input: UpdateFeatureMatchInput, options: CommanderSeatOptions): UpdateFeatureMatchInput {
	const output = { ...input };
	for (const key of SEAT_DATA_KEYS) {
		if (input[key] !== undefined)
			output[key] = commanderSeatData(input[key], options);
	}
	return output;
}

/**
 * Whether a setup save writes what only a Commander Slot holds: Seat 3 or 4,
 * or a Seat's Commanders or its Deck List of Magic: The Gathering cards.
 */
export function writesCommanderSeats(input: UpdateFeatureMatchInput): boolean {
	return COMMANDER_SEAT_DATA_KEYS.some(key => input[key] !== undefined)
		|| SEAT_DATA_KEYS.some((key) => {
			const gameData = input[key]?.gameData;
			return gameData?.type === 'mtg'
				&& (gameData.commanders !== undefined || gameData.featureMatchDeckList !== undefined);
		});
}
