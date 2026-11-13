import type { Seat } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig, SeatIndicatorGraphicItemConfig, SeatIndicatorState } from '~~/shared/types/graphics';
import type { SideboardRevealTrigger } from './sideboardRevealTrigger';
import { applyItemPhaseEdge } from './sideboardRevealTrigger';

/**
 * The Seat Indicator's half of the per-item phase trigger (ADR-0015, ADR-0087):
 * which indicators a Seat's state flip reaches. How an edge supersedes and
 * when a trigger settles is the Sideboard reveal trigger's own bookkeeping.
 */

/**
 * The Seat Indicators one Seat's state reaches: authored-visible, at the top
 * level or inside a visible Graphic Group, and set to that Seat and state.
 */
function seatIndicators(composition: BroadcastGraphicConfig, seat: Seat, state: SeatIndicatorState): SeatIndicatorGraphicItemConfig[] {
	return composition.items
		.filter(item => item.visible)
		.flatMap(item => item.type === 'group'
			? item.children.filter(child => child.visible)
			: [item])
		.filter((item): item is SeatIndicatorGraphicItemConfig =>
			item.type === 'seat-indicator' && item.playerSide === seat && item.state === state);
}

/** Fold one Seat's state flip into the running triggers: entering the state plays its indicators' `enter`, leaving it their `exit`. */
export function applySeatIndicatorEdge(
	triggers: readonly SideboardRevealTrigger[],
	composition: BroadcastGraphicConfig,
	seat: Seat,
	state: SeatIndicatorState,
	inState: boolean,
	now: number,
): SideboardRevealTrigger[] {
	return applyItemPhaseEdge(triggers, seatIndicators(composition, seat, state), inState, now);
}
