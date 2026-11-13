import type { FeatureMatchTokenValuesInput } from '~~/shared/featureMatchOverlayValues';
import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { GraphicsCommanderDamageCount, GraphicsDeckListCard, GraphicsFeatureMatchContext, GraphicsFeatureMatchPlayerState } from '~/modules/graphics/renderModel';
import type { Event } from '~/types';
import { eventKind } from '~~/shared/config/games';
import { commanderDamageFrom } from '~~/shared/modules/feature-match-session';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

export { featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';

/**
 * What a Feature Match Overlay supplies to the shared compositor.
 *
 * Two things, resolved together because they read the same sources: the values
 * behind the Feature Match token binding catalogue (`featureMatchTokenValues`,
 * shared with the public Feature Match read), which answer a Graphic Text
 * Template's placeholders, and the live session state, which answers the
 * context-gated Clock, Player Life, and Game Wins Definitions.
 *
 * Resolved here rather than in the render model so the model stays pure. Every
 * Screen Output of one Screen resolves the same snapshot and derives the same
 * frame from it, which is what makes the Overlay, Fill, and Key Outputs agree.
 */

export interface FeatureMatchOverlayHostStateInput extends FeatureMatchTokenValuesInput {
	event: (FeatureMatchTokenValuesInput['event'] & Pick<Event, 'featureMatchDefaultBestOf'>) | null | undefined;
	matchState: FeatureMatchState | null | undefined;
	/** The Feature Match Session clock, already formatted by its own composable; null while there is none to show. */
	displayTime: string | null;
}

/**
 * The per-side Sideboard card data the host resolved client-side (#491), in the
 * shape the shared render model reads — never the full MTG card type. `null` is
 * a side whose deck data did not resolve; `[]` is a genuinely empty Sideboard.
 */
export interface FeatureMatchOverlaySideboards {
	player1: ReadonlyArray<GraphicsDeckListCard> | null;
	player2: ReadonlyArray<GraphicsDeckListCard> | null;
}

/**
 * The Commander Damage a Seat has taken: one count per Commander each other
 * Seat holds, in Seat order, with that Commander's card (ADR-0087).
 */
function commanderDamageCounts(input: FeatureMatchOverlayHostStateInput, seat: Seat): GraphicsCommanderDamageCount[] {
	return SEAT_VALUES
		.filter(opposing => opposing !== seat)
		.flatMap(opposing => (getMtgGameData(featureMatchSidePlayer(input.featureMatch, opposing).data?.gameData).commanders ?? [])
			.map((commander, index) => ({
				damage: commanderDamageFrom(input.matchState?.[seat], {
					seat: opposing,
					commander: index === 0
						? 1
						: 2,
				}),
				imageUrl: scryfallCardImageUrl(commander.scryfallId),
			})));
}

/** What a Commander game adds to a Seat's live state: whether it is Eliminated, and the Commander Damage it has taken. */
function commanderGameState(input: FeatureMatchOverlayHostStateInput, seat: Seat): Pick<GraphicsFeatureMatchPlayerState, 'eliminated' | 'commanderDamage'> {
	return {
		eliminated: input.matchState?.[seat]?.eliminated ?? false,
		commanderDamage: commanderDamageCounts(input, seat),
	};
}

/** A Commander Seat's live state: its life, with no game wins or Sideboard to show (ADR-0087). */
function commanderSeatState(input: FeatureMatchOverlayHostStateInput, seat: Seat): GraphicsFeatureMatchPlayerState {
	return {
		lifeTotal: input.matchState?.[seat]?.lifeTotal ?? null,
		gameWins: 0,
		sideboard: null,
		sideboardRevealed: false,
		...commanderGameState(input, seat),
	};
}

/** One of the pair's Seats: a Commander game's state on a Commander Event, and nothing more on any other. */
function pairGameState(input: FeatureMatchOverlayHostStateInput, seat: Seat): Pick<GraphicsFeatureMatchPlayerState, 'eliminated' | 'commanderDamage'> {
	return isCommanderEvent(input)
		? commanderGameState(input, seat)
		: {};
}

/**
 * What a Commander Slot adds to the context: Seats 3 and 4, and the Seats
 * nobody sits in. A Seat is in the game while it is filled, by the active
 * Session's snapshot or else the Slot's own Seats, so an unbound Overlay's are
 * all empty. Every other Event's context holds neither (ADR-0087).
 */
function isCommanderEvent(input: FeatureMatchOverlayHostStateInput): boolean {
	return input.event != null && eventKind(input.event) === 'mtg-commander';
}

function commanderSeats(input: FeatureMatchOverlayHostStateInput): Pick<GraphicsFeatureMatchContext, 'player3' | 'player4' | 'emptySeats'> {
	if (!isCommanderEvent(input))
		return {};
	return {
		player3: commanderSeatState(input, 'player3'),
		player4: commanderSeatState(input, 'player4'),
		emptySeats: SEAT_VALUES.filter(seat => featureMatchSidePlayer(input.featureMatch, seat).data == null),
	};
}

/**
 * The live session state the context-gated Definitions read.
 *
 * `bestOf` prefers the active Feature Match Session's own source snapshot over the
 * Slot's current value, so a Match promoted into the Slot mid-session cannot change
 * how many win boxes the session in progress draws. With no Slot, the Event's Match
 * Format still determines the empty indicators rather than an unrelated hard-coded
 * best-of-three.
 */
export function featureMatchGraphicsContext(
	input: FeatureMatchOverlayHostStateInput,
	sideboards?: FeatureMatchOverlaySideboards | null,
): GraphicsFeatureMatchContext {
	return {
		clockDisplayTime: input.displayTime,
		player1: {
			lifeTotal: input.matchState?.player1?.lifeTotal ?? null,
			gameWins: input.matchState?.player1?.gameWins ?? 0,
			// Resolved by the host's deck card data path (#491); absent deck data
			// stays `null`, so a Deck List Graphic Item renders nothing rather than
			// a placeholder sideboard.
			sideboard: sideboards?.player1 ?? null,
			// Hidden by default (#490): absent state, and states persisted before
			// the flag existed, both read as not yet revealed.
			sideboardRevealed: input.matchState?.player1?.sideboardRevealed ?? false,
			...pairGameState(input, 'player1'),
		},
		player2: {
			lifeTotal: input.matchState?.player2?.lifeTotal ?? null,
			gameWins: input.matchState?.player2?.gameWins ?? 0,
			sideboard: sideboards?.player2 ?? null,
			sideboardRevealed: input.matchState?.player2?.sideboardRevealed ?? false,
			...pairGameState(input, 'player2'),
		},
		...commanderSeats(input),
		// Whose turn it is, on any Event that tracks one.
		activeSeat: input.matchState?.activePlayer ?? null,
		bestOf: input.featureMatch?.activeSession?.sourceSnapshot?.bestOf
			?? input.featureMatch?.bestOf
			?? toFeatureMatchDefaults(input.event).bestOf,
	};
}
