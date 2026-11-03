import type { GraphicAnimationTimelineSegment } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig, GraphicAnimationPhase, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan } from './previewMessages';
import { broadcastGraphicAnimationTimeline, flattenGraphicItems } from '~~/shared/modules/graphics';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';

/**
 * What one Graphic Animation Preview run plays: the graphic as it composes for
 * the run, and the run's timeline.
 *
 * A run over the whole graphic plays it as authored. A run over one Graphic Item
 * plays that item alone: every other owner — the graphic itself, its siblings,
 * and the Graphic Group it sits in — is held at its Graphic Resting State, and
 * the item starts at the run's start rather than at its place in a container's
 * stagger. A selected Graphic Group keeps its children and its own stagger over
 * them, because that is the group's motion.
 *
 * Isolation strips motion and nothing else, so the run composes through exactly
 * the projection a live output uses. An owner held at rest also loses its
 * animation Theme bindings: the render model paints bindings, and a bound phase
 * would otherwise be painted straight back.
 *
 * The graphic is expected painted already, so a phase a Theme binds is timed by
 * the recipe it shows. `lifecycle` is the host's own phase order: a host with no
 * update phase leaves it out, so a lifecycle run never pauses on one.
 */
export function resolveGraphicAnimationPreview(
	graphic: BroadcastGraphicConfig,
	plan: GraphicsPreviewAnimationPlan,
	lifecycle: readonly GraphicAnimationPhase[] = GRAPHIC_ANIMATION_PHASE_VALUES,
): { graphic: BroadcastGraphicConfig; timeline: GraphicAnimationTimelineSegment[] } {
	if (!lifecycle.includes(plan.phase))
		return { graphic, timeline: [] };
	const phases = plan.scope === 'phase'
		? [plan.phase]
		: lifecycle.slice(lifecycle.indexOf(plan.phase));

	if (plan.itemId === undefined) {
		return {
			graphic,
			timeline: broadcastGraphicAnimationTimeline(graphic, phases),
		};
	}

	const itemId = plan.itemId;
	const subject = flattenGraphicItems(graphic).find(item => item.id === itemId);
	if (!subject)
		return { graphic, timeline: [] };

	const isolated: BroadcastGraphicConfig = {
		...atRest(graphic),
		items: graphic.items.map((item) => {
			if (item.id === itemId)
				return item;
			const rested = atRest(item);
			return rested.type === 'group'
				? {
						...rested,
						children: rested.children.map(child => child.id === itemId
							? child
							: atRest(child)),
					}
				: rested;
		}),
	};

	// The item as its own one-item graphic: its delays, and a group's stagger over
	// its children, measured from the run's start.
	return {
		graphic: isolated,
		timeline: broadcastGraphicAnimationTimeline({
			items: [subject],
		}, phases),
	};
}

function atRest<T extends BroadcastGraphicConfig | GraphicItemConfig>(owner: T): T {
	const { animation: _animation, themeBindings, ...rest } = owner;
	const kept = Object.entries(themeBindings ?? {}).filter(([slot]) => !slot.startsWith('animation.'));
	return (kept.length > 0
		? {
				...rest,
				themeBindings: Object.fromEntries(kept),
			}
		: rest) as T;
}
