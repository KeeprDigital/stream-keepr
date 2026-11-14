import type { FeatureMatchResponse } from '~~/shared/api';
import type { FeatureMatchTokenValuesInput } from '~~/shared/featureMatchOverlayValues';
import type { FeatureMatchDefaultColumns } from '~~/shared/types/featureMatchDefaults';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { eventKind, eventSeats } from '~~/shared/config/games';
import { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { projectFeatureMatchClock, readStoredClock } from '~~/shared/utils/clock';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * The row the public Feature Match read answers (ADR-0056): every Feature
 * Match token the Overlay resolves for the Event's kind, then the clock at
 * `now` and each Seat's live state.
 *
 * All strings, and the same fields whatever the Slot holds, because a vMix
 * JSON Data Source binds a title's fields by name and shows `null` as text.
 */

export interface FeatureMatchPublicRowInput extends FeatureMatchTokenValuesInput {
	event: NonNullable<FeatureMatchTokenValuesInput['event']> & Partial<FeatureMatchDefaultColumns>;
	featureMatch: FeatureMatchResponse;
}

/**
 * A yes or no as a colour a vMix shape can bind to: white for yes, transparent
 * for no. Eight hex digits read the same as ARGB or RGBA.
 */
function flagColour(flag: boolean): string {
	return flag
		? '#FFFFFFFF'
		: '#00000000';
}

function lifeOf(lifeTotal: number | null | undefined): string {
	return lifeTotal == null
		? ''
		: String(lifeTotal);
}

/** The pair's life and game wins, and each one's first and second game win as a colour. */
function pairLiveValues(state: FeatureMatchState | null): Record<string, string> {
	const winColour = (gameWins: number | undefined, game: number) => flagColour((gameWins ?? 0) >= game);

	return {
		player1Life: lifeOf(state?.player1.lifeTotal),
		player1GameWins: String(state?.player1.gameWins ?? 0),
		player2Life: lifeOf(state?.player2.lifeTotal),
		player2GameWins: String(state?.player2.gameWins ?? 0),
		player1Game1Win: winColour(state?.player1.gameWins, 1),
		player1Game2Win: winColour(state?.player1.gameWins, 2),
		player2Game1Win: winColour(state?.player2.gameWins, 1),
		player2Game2Win: winColour(state?.player2.gameWins, 2),
	};
}

/**
 * A Commander Slot's four Seats: each one's life, and whether it is Eliminated
 * as a colour. A Commander game has no game wins. An empty Seat is not in the
 * game, so it reads as no life and not Eliminated whatever state the Session
 * holds for it (ADR-0087).
 */
function commanderLiveValues(featureMatch: FeatureMatchResponse, state: FeatureMatchState | null): Record<string, string> {
	const values: Record<string, string> = {};
	for (const seat of eventSeats('mtg-commander')) {
		const seatState = featureMatchSidePlayer(featureMatch, seat).data == null
			? undefined
			: state?.[seat];
		values[`${seat}Life`] = lifeOf(seatState?.lifeTotal);
		values[`${seat}Eliminated`] = flagColour(seatState?.eliminated ?? false);
	}
	return values;
}

export function featureMatchPublicRow(input: FeatureMatchPublicRowInput, now: number): Record<string, string> {
	const state = input.featureMatch.activeSession?.currentState ?? null;

	return {
		...featureMatchTokenValues(input),
		clock: projectFeatureMatchClock(state ? readStoredClock(state.clock) : null, now, toFeatureMatchDefaults(input.event).untimedLabel).display,
		...(eventKind(input.event) === 'mtg-commander'
			? commanderLiveValues(input.featureMatch, state)
			: pairLiveValues(state)),
	};
}
