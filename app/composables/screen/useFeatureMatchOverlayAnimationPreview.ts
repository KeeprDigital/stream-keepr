import type { Ref } from 'vue';
import type { GraphicThemeTokens } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan } from '~/modules/graphics/previewMessages';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { paintBroadcastGraphicThemeBindings } from '~~/shared/modules/graphics';
import { resolveGraphicAnimationPreview } from '~/modules/graphics/animationPreview';
import {
	isGraphicsPreviewAnimationMessage,
	readGraphicsPreviewAnimationPlan,
} from '~/modules/graphics/previewMessages';
import { useGraphicAnimationPreviewClock } from './useGraphicAnimationPreviewClock';

/**
 * The Feature Match Overlay preview frame's half of the Graphic Animation
 * Preview (#749): it hears a run from the editor that embedded it and runs the
 * shared preview clock over the working Feature Match Layout.
 *
 * A run plays the whole composition, or one Graphic Item alone (E31). It moves
 * Graphic Items only: the Frame and its Animation Effect are host-owned and keep
 * running (E32).
 *
 * Only a preview listens. A live Screen Output installs no listener, so a run
 * posted at one reaches nothing, and nothing here writes Screen state.
 */
export function useFeatureMatchOverlayAnimationPreview(
	composition: Ref<BroadcastGraphicConfig>,
	themeTokens: Ref<GraphicThemeTokens>,
	isPreview: Ref<boolean> | undefined,
) {
	const plan = ref<GraphicsPreviewAnimationPlan | null>(null);

	const preview = computed(() => {
		const current = plan.value;
		if (!current || current.graphicId !== FEATURE_MATCH_LAYOUT_COMPOSITION_ID)
			return null;
		// Painted first, so a phase bound to a Theme token is timed by what it shows.
		return resolveGraphicAnimationPreview(paintBroadcastGraphicThemeBindings(composition.value, themeTokens.value), current);
	});
	const { position } = useGraphicAnimationPreviewClock(
		computed(() => preview.value ? plan.value : null),
		computed(() => preview.value?.timeline ?? []),
	);

	function handleMessage(message: MessageEvent) {
		if (isGraphicsPreviewAnimationMessage(message, { origin: window.location.origin, source: window.parent }))
			plan.value = readGraphicsPreviewAnimationPlan(message.data.plan);
	}

	onMounted(() => {
		if (isPreview?.value)
			window.addEventListener('message', handleMessage);
	});
	onBeforeUnmount(() => window.removeEventListener('message', handleMessage));

	return {
		/** The composition as the run composes it: one item's motion isolated, or as authored. */
		composition: computed(() => preview.value?.graphic ?? composition.value),
		/** The composition's lifecycle phases for the compositor, or nothing at rest. */
		animation: computed(() => position.value ? [position.value] : undefined),
	};
}
