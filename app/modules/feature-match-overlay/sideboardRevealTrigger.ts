import type { PlayerSide } from '~~/shared/types/enums';
import type { BroadcastGraphicConfig, DeckListGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsAnimationProjection } from '~/modules/graphics/renderModel';
import { graphicAnimationRecipeEndMs } from '~~/shared/modules/graphics';

/**
 * The per-item reveal trigger's bookkeeping (#492): which Deck List Graphic
 * Items are currently playing an authored `enter` or `exit` off a
 * `sideboardRevealed` edge, and when each began.
 *
 * Pure functions over a plain trigger list, so the mechanism is testable without
 * a clock or a component: the composable that watches the live flag owns *when*
 * (edge detection, a rAF clock), and everything about *what* — which items an
 * edge reaches, how a new edge supersedes running motion, when a trigger is
 * settled, and the projection shape the compositor takes — lives here.
 *
 * An edge supersedes: revealing removes whatever the side's items were playing
 * and starts their `enter`s; hiding removes and starts their `exit`s. Running
 * the superseded phase to completion instead would leave a finished exit
 * projecting its hidden end-state over the item the operator just revealed. The
 * cost is that a mid-flight interruption restarts the new phase from the
 * Graphic Resting State rather than from the frame on screen — accepted for a
 * sub-second, operator-paced toggle.
 */
export interface SideboardRevealTrigger {
	itemId: string;
	phase: 'enter' | 'exit';
	/** The host clock reading at the edge; elapsed time is measured from it. */
	startedAt: number;
	/** `startedAt` + the recipe's own end, the instant the trigger is settled. */
	endsAt: number;
}

/**
 * The side's Deck List Graphic Items an edge reaches: authored-visible — at the
 * top level or inside a visible Graphic Group — and bound to the side. Authored
 * `visible: false` short-circuits everything, no animation and no render
 * (ADR 0015), and matches the compositor's own render filter.
 */
function sideboardDeckListItems(
	composition: BroadcastGraphicConfig,
	side: PlayerSide,
): DeckListGraphicItemConfig[] {
	const items: DeckListGraphicItemConfig[] = [];
	for (const item of composition.items) {
		if (!item.visible)
			continue;
		if (item.type === 'deck-list' && item.playerSide === side)
			items.push(item);
		if (item.type !== 'group')
			continue;
		for (const child of item.children) {
			if (child.visible && child.type === 'deck-list' && child.playerSide === side)
				items.push(child);
		}
	}
	return items;
}

/**
 * Fold one `sideboardRevealed` edge into the running triggers.
 *
 * A false→true edge plays each reachable item's authored `enter`; true→false
 * plays its `exit`. An item with no recipe for the edge's phase starts nothing —
 * an absent recipe is a Cut, the flag alone decides, immediately — but the edge
 * still supersedes whatever that item was playing.
 */
export function applySideboardRevealEdge(
	triggers: readonly SideboardRevealTrigger[],
	composition: BroadcastGraphicConfig,
	side: PlayerSide,
	revealed: boolean,
	now: number,
): SideboardRevealTrigger[] {
	const phase = revealed ? 'enter' as const : 'exit' as const;
	const reached = sideboardDeckListItems(composition, side);
	const reachedIds = new Set(reached.map(item => item.id));

	return [
		...triggers.filter(trigger => !reachedIds.has(trigger.itemId)),
		...reached.flatMap((item) => {
			const recipe = item.animation?.[phase];
			if (!recipe)
				return [];
			return [{ itemId: item.id, phase, startedAt: now, endsAt: now + graphicAnimationRecipeEndMs(recipe) }];
		}),
	];
}

/**
 * Drop every trigger whose recipe's own end has passed.
 *
 * The compositor is told to expect exactly this: a settled `enter` projects the
 * Graphic Resting State so dropping it changes no frame, while a settled `exit`
 * projects its hidden end-state forever — dropping it is what hands the item
 * back to the flag's renders-nothing state.
 */
export function settleSideboardRevealTriggers(
	triggers: readonly SideboardRevealTrigger[],
	now: number,
): SideboardRevealTrigger[] {
	return triggers.filter(trigger => now < trigger.endsAt);
}

/**
 * The running triggers as the per-item projection map the Feature Match Overlay
 * host adapter takes, at one clock reading. `undefined` while nothing runs, so
 * the settled overlay passes the compositor exactly the input it passed before
 * this mechanism existed.
 */
export function sideboardRevealItemAnimation(
	triggers: readonly SideboardRevealTrigger[],
	now: number,
): Record<string, GraphicsAnimationProjection[]> | undefined {
	if (triggers.length === 0)
		return undefined;

	const animation: Record<string, GraphicsAnimationProjection[]> = {};
	for (const trigger of triggers) {
		(animation[trigger.itemId] ??= []).push({
			phase: trigger.phase,
			elapsed: now - trigger.startedAt,
		});
	}
	return animation;
}
