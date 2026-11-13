import type { ClockType } from '~~/shared/types/enums';
import type { FeatureMatchSnapshotPlayer, FeatureMatchSnapshotPlayerData, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { Commander } from '~~/shared/types/game';
import { getMatchFormatDefaults } from '~~/shared/config/games';
import { commanderDeckIdentity } from '~~/shared/utils/commander';
import { ATRAXA, KRAUM, TYMNA } from './commanders';

/** Source snapshots of Feature Match Sessions, as each kind of Event's Slot opens one (ADR-0087). */

/** A typed Seat as a Commander Slot stores it: a name and its Commanders. */
export function seatedPlayer(name: string, commanders: Commander[] = []): FeatureMatchSnapshotPlayerData {
	return {
		name,
		...(commanders.length > 0
			? {
					gameData: {
						type: 'mtg',
						commanders,
						...commanderDeckIdentity(commanders),
					},
				}
			: {}),
	};
}

function seat(data: FeatureMatchSnapshotPlayerData | null): FeatureMatchSnapshotPlayer {
	return { playerId: null, data };
}

interface CommanderSnapshotOptions {
	/** Each Seat's player; `null` leaves the Seat empty. */
	player1?: FeatureMatchSnapshotPlayerData | null;
	player2?: FeatureMatchSnapshotPlayerData | null;
	player3?: FeatureMatchSnapshotPlayerData | null;
	player4?: FeatureMatchSnapshotPlayerData | null;
	startingLife?: number;
	clockType?: ClockType;
}

/**
 * A Commander Slot's snapshot with four Seats filled: Ana (Atraxa), Ben (Tymna),
 * Cleo (Tymna and Kraum, a pair) and Dara (Atraxa), at 40 life and untimed.
 */
export function commanderSnapshot(options: CommanderSnapshotOptions = {}): FeatureMatchSourceSnapshot {
	const defaults = getMatchFormatDefaults('mtg-commander');
	const seated = {
		player1: seatedPlayer('Ana', [ATRAXA]),
		player2: seatedPlayer('Ben', [TYMNA]),
		player3: seatedPlayer('Cleo', [TYMNA, KRAUM]),
		player4: seatedPlayer('Dara', [ATRAXA]),
		...options,
	};
	return {
		eventId: 1,
		slotId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		bestOf: 1,
		playerDisplayMode: 'score',
		game: 'mtg',
		variant: 'commander',
		defaults: {
			...defaults,
			startingLife: options.startingLife ?? defaults.startingLife,
			clockType: options.clockType ?? defaults.clockType,
		},
		player1: seat(seated.player1),
		player2: seat(seated.player2),
		player3: seat(seated.player3),
		player4: seat(seated.player4),
		createdAt: 1000,
	};
}

/** A Two-Player Magic: The Gathering Slot's snapshot, as every Session held before Commander. */
export function twoPlayerSnapshot(overrides: Partial<FeatureMatchSourceSnapshot> = {}): FeatureMatchSourceSnapshot {
	return {
		eventId: 1,
		slotId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		bestOf: 3,
		playerDisplayMode: 'score',
		game: 'mtg',
		defaults: getMatchFormatDefaults('mtg-two-player'),
		player1: seat({ name: 'Alice' }),
		player2: seat({ name: 'Bob' }),
		createdAt: 1000,
		...overrides,
	};
}
