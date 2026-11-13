import type { PlayerSlotData } from '../api';
import type { EventKind } from '../config/games';
import type { PlayerSide, Seat } from '../types/enums';
import type { FeatureMatchSnapshotPlayer, FeatureMatchSnapshotPlayerData } from '../types/featureMatchSession';
import { SEAT_VALUES } from '../types/enums';

/** The parts of a Feature Match Slot, and its active Session, that seat its players. */
export interface FeatureMatchSlotSides {
	player1Id: number | null;
	player2Id: number | null;
	player1Data: PlayerSlotData | null;
	player2Data: PlayerSlotData | null;
	/** Seats 3 and 4, which only a Commander Slot holds (ADR-0087). */
	player3Data?: PlayerSlotData | null;
	player4Data?: PlayerSlotData | null;
	activeSession?: {
		sourceSnapshot: Record<PlayerSide, FeatureMatchSnapshotPlayer | null | undefined>
			& Partial<Record<Exclude<Seat, PlayerSide>, FeatureMatchSnapshotPlayer | null>>;
	} | null;
}

/** A Seat's number, as an operator reads it: Seat 1 to Seat 4. */
export function seatNumber(seat: Seat): number {
	return SEAT_VALUES.indexOf(seat) + 1;
}

/** A Seat as a layout's author names it: a Commander Slot's are Seats, a pair's its two Players. */
export function seatLabel(kind: EventKind, seat: Seat): string {
	return `${kind === 'mtg-commander'
		? 'Seat'
		: 'Player'} ${seatNumber(seat)}`;
}

/** The Slot field holding each side's data, in the Slot's own order. */
export const SLOT_SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, keyof FeatureMatchSlotSides>;
/** The Slot field holding each Seat's data: the pair every Slot has, then a Commander Slot's Seats 3 and 4 (ADR-0087). */
export const SLOT_SEAT_DATA_KEY = {
	...SLOT_SIDE_DATA_KEY,
	player3: 'player3Data',
	player4: 'player4Data',
} as const satisfies Record<Seat, string>;
/** The Slot fields of Seats 3 and 4, which only a Commander Event's Slot holds (ADR-0087). */
export const COMMANDER_SEAT_DATA_KEYS = [SLOT_SEAT_DATA_KEY.player3, SLOT_SEAT_DATA_KEY.player4] as const;
/** The Slot field seating each side's Player, in the Slot's own order. */
export const SLOT_SIDE_PLAYER_KEY = { player1: 'player1Id', player2: 'player2Id' } as const satisfies Record<PlayerSide, keyof FeatureMatchSlotSides>;

export interface FeatureMatchSidePlayer {
	playerId: number | null;
	data: FeatureMatchSnapshotPlayerData | PlayerSlotData | null;
}

/**
 * The player one Seat of a Feature Match Slot shows.
 *
 * The active Feature Match Session owns which side each player sits on, and the
 * Slot keeps its pairing order (ADR-0058): `SwapPlayers` moves players in the
 * Session's source snapshot and never on the Slot. So a side reads the snapshot
 * while a Session is active, and the Slot's own side otherwise. Seats 3 and 4
 * are a Commander Slot's, typed and linking no Player (ADR-0087).
 */
export function featureMatchSidePlayer(slot: FeatureMatchSlotSides | null | undefined, side: Seat): FeatureMatchSidePlayer {
	if (!slot)
		return { playerId: null, data: null };
	const snapshot = slot.activeSession?.sourceSnapshot;
	if (snapshot) {
		const seated = snapshot[side];
		return { playerId: seated?.playerId ?? null, data: seated?.data ?? null };
	}
	if (side === 'player1')
		return { playerId: slot.player1Id, data: slot.player1Data };
	if (side === 'player2')
		return { playerId: slot.player2Id, data: slot.player2Data };
	return { playerId: null, data: slot[SLOT_SEAT_DATA_KEY[side]] ?? null };
}
