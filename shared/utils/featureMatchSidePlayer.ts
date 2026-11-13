import type { PlayerSlotData } from '~~/shared/api';
import type { PlayerSide, Seat } from '~~/shared/types/enums';
import type { FeatureMatchSnapshotPlayer, FeatureMatchSnapshotPlayerData } from '~~/shared/types/featureMatchSession';

/** The parts of a Feature Match Slot, and its active Session, that seat its players. */
export interface FeatureMatchSlotSides {
	player1Id: number | null;
	player2Id: number | null;
	player1Data: PlayerSlotData | null;
	player2Data: PlayerSlotData | null;
	activeSession?: {
		sourceSnapshot: Record<PlayerSide, FeatureMatchSnapshotPlayer | null | undefined>;
	} | null;
}

/** The Slot field holding each side's data, in the Slot's own order. */
export const SLOT_SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, keyof FeatureMatchSlotSides>;
/** The Slot field holding each Seat's data: the pair every Slot has, then a Commander Slot's Seats 3 and 4 (ADR-0086). */
export const SLOT_SEAT_DATA_KEY = {
	...SLOT_SIDE_DATA_KEY,
	player3: 'player3Data',
	player4: 'player4Data',
} as const satisfies Record<Seat, string>;
/** The Slot field seating each side's Player, in the Slot's own order. */
export const SLOT_SIDE_PLAYER_KEY = { player1: 'player1Id', player2: 'player2Id' } as const satisfies Record<PlayerSide, keyof FeatureMatchSlotSides>;

export interface FeatureMatchSidePlayer {
	playerId: number | null;
	data: FeatureMatchSnapshotPlayerData | PlayerSlotData | null;
}

/**
 * The player one side of a Feature Match Slot shows.
 *
 * The active Feature Match Session owns which side each player sits on, and the
 * Slot keeps its pairing order (ADR-0058): `SwapPlayers` moves players in the
 * Session's source snapshot and never on the Slot. So a side reads the snapshot
 * while a Session is active, and the Slot's own side otherwise.
 */
export function featureMatchSidePlayer(slot: FeatureMatchSlotSides | null | undefined, side: PlayerSide): FeatureMatchSidePlayer {
	if (!slot)
		return { playerId: null, data: null };
	const snapshot = slot.activeSession?.sourceSnapshot;
	if (snapshot) {
		const seated = snapshot[side];
		return { playerId: seated?.playerId ?? null, data: seated?.data ?? null };
	}
	return side === 'player1'
		? { playerId: slot.player1Id, data: slot.player1Data }
		: { playerId: slot.player2Id, data: slot.player2Data };
}
