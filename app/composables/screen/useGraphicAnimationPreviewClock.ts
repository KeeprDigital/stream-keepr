import type { Ref } from 'vue';
import type { GraphicAnimationTimelineSegment } from '~~/shared/modules/graphics';
import type { GraphicAnimationPhase } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan } from '~/modules/graphics/previewMessages';
import { graphicAnimationTimelineAt, graphicAnimationTimelineDurationMs } from '~~/shared/modules/graphics';

/**
 * The Graphic Animation Preview clock a preview frame runs over the plan its
 * editor sent, shared by every graphics host.
 *
 * The editor sends a plan; the clock lives here, beside the composition it
 * animates. Elapsed time is the only thing that advances, and the frame is a
 * pure projection of it, so a run is repeatable and identical at the same
 * elapsed time however it was reached. A live output has no plan, so it never
 * starts this clock.
 *
 * A new run token restarts the clock; that is the only thing that does. Editing
 * the composition mid-run changes what is projected without disturbing when.
 * A completed run holds its last phase settled, unless it loops.
 */
export function useGraphicAnimationPreviewClock(
	plan: Ref<GraphicsPreviewAnimationPlan | null>,
	timeline: Ref<readonly GraphicAnimationTimelineSegment[]>,
) {
	const elapsed = ref(0);
	let frame: number | null = null;
	let startedAt = 0;

	function stop() {
		if (frame !== null && import.meta.client)
			cancelAnimationFrame(frame);
		frame = null;
	}

	function advance() {
		const current = plan.value;
		if (!current) {
			stop();
			elapsed.value = 0;
			return;
		}

		const total = graphicAnimationTimelineDurationMs(timeline.value);
		const next = (performance.now() - startedAt) * current.speed;

		if (total > 0 && next >= total && current.loop) {
			startedAt = performance.now();
			elapsed.value = 0;
		}
		else {
			// Held rather than reset once a run completes: the last phase settled is
			// what the author just watched arrive.
			elapsed.value = next;
		}

		frame = requestAnimationFrame(advance);
	}

	watch(
		() => (plan.value
			? `${plan.value.graphicId}:${plan.value.itemId ?? ''}:${plan.value.run}`
			: null),
		(token) => {
			stop();
			elapsed.value = 0;
			if (token === null || !import.meta.client)
				return;
			startedAt = performance.now();
			frame = requestAnimationFrame(advance);
		},
	);

	onScopeDispose(stop);

	return {
		/** Where the run is: a phase and the time into it, or null with nothing playing. */
		position: computed<{ phase: GraphicAnimationPhase; elapsed: number } | null>(() =>
			plan.value
				? graphicAnimationTimelineAt(timeline.value, elapsed.value)
				: null),
	};
}
