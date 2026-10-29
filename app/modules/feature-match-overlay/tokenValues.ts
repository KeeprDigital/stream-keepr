import type { FeatureMatchTokenValuesInput } from '~~/shared/featureMatchOverlayValues';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { GraphicsDeckListCard, GraphicsFeatureMatchContext } from '~/modules/graphics/renderModel';
import type { Event } from '~/types';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';

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
		},
		player2: {
			lifeTotal: input.matchState?.player2?.lifeTotal ?? null,
			gameWins: input.matchState?.player2?.gameWins ?? 0,
			sideboard: sideboards?.player2 ?? null,
			sideboardRevealed: input.matchState?.player2?.sideboardRevealed ?? false,
		},
		bestOf: input.featureMatch?.activeSession?.sourceSnapshot?.bestOf
			?? input.featureMatch?.bestOf
			?? toFeatureMatchDefaults(input.event).bestOf,
	};
}
