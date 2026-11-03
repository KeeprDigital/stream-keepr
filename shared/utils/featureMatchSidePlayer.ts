import type { PlayerSlotData } from '~~/shared/api';
import type { PlayerSide } from '~~/shared/types/enums';
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
