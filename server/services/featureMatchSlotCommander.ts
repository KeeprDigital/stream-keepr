import type { ManualPlayerSlotData, UpdateFeatureMatchInput } from '~~/shared/api';
import { commanderDeckIdentity } from '~~/shared/utils/commander';
import { SLOT_SEAT_DATA_KEY } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * A Commander Event's Feature Match Slot Seats (ADR-0087). The Event has no
 * Players, so every Seat is typed and holds one or two Commanders, and a Seat
 * of any other Event holds none.
 */

const SEAT_DATA_KEYS = Object.values(SLOT_SEAT_DATA_KEY);
/** Seats 3 and 4, which only a Commander Event's Slot holds. */
const COMMANDER_ONLY_SEAT_DATA_KEYS = [SLOT_SEAT_DATA_KEY.player3, SLOT_SEAT_DATA_KEY.player4];

/** What a typed Seat keeps of a save: no record, and no deck but its Commanders'. */
const TYPED_SEAT_FIELDS = ['name', 'pronouns', 'lgs'] as const;

/**
 * A Seat as a Commander Slot stores it: its name, pronouns and LGS, and its
 * Commanders, which name and colour its deck. A Seat holding none of them is empty.
 */
export function commanderSeatData(data: ManualPlayerSlotData | null | undefined): ManualPlayerSlotData | null {
	if (!data)
		return null;
	const seat: ManualPlayerSlotData = {};
	for (const field of TYPED_SEAT_FIELDS) {
		if (data[field])
			seat[field] = data[field];
	}
	const commanders = data.gameData?.type === 'mtg'
		? data.gameData.commanders ?? []
		: [];
	if (commanders.length > 0) {
		seat.gameData = {
			type: 'mtg',
			commanders,
			...commanderDeckIdentity(commanders),
		};
	}
	return Object.keys(seat).length > 0
		? seat
		: null;
}

/** A setup save with each Seat it edits as a Commander Slot stores it. */
export function withCommanderSeats(input: UpdateFeatureMatchInput): UpdateFeatureMatchInput {
	const output = { ...input };
	for (const key of SEAT_DATA_KEYS) {
		if (input[key] !== undefined)
			output[key] = commanderSeatData(input[key]);
	}
	return output;
}

/** Whether a setup save writes what only a Commander Slot holds: Seat 3 or 4, or a Seat's Commanders. */
export function writesCommanderSeats(input: UpdateFeatureMatchInput): boolean {
	return COMMANDER_ONLY_SEAT_DATA_KEYS.some(key => input[key] !== undefined)
		|| SEAT_DATA_KEYS.some((key) => {
			const gameData = input[key]?.gameData;
			return gameData?.type === 'mtg' && gameData.commanders !== undefined;
		});
}
