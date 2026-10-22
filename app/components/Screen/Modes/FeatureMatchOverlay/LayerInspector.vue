<script setup lang="ts">
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlaySelectionTarget } from '~/types';
import {
	FEATURE_MATCH_SOURCE_ITEM_ICON,
	FEATURE_MATCH_SOURCE_ITEM_LABEL,
} from '~~/shared/featureMatchSourceItems';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { sourceSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { resolveFeatureMatchOverlaySelection } from '~/modules/feature-match-overlay/selection';
import FeatureMatchOverlayFrameStyleCard from './FrameStyleCard.vue';
import FeatureMatchOverlayInspectorSource from './InspectorSource.vue';

/**
 * The host-owned half of the Feature Match Overlay property panel: the Frame —
 * shown as the canvas — and the Source Items.
 *
 * Graphic Items are edited by the shared compositor's own inspector. Choosing
 * what to edit happens in the editor's one layer list, not here.
 */

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	eventId: number;
	selectedTarget: FeatureMatchOverlaySelectionTarget;
}>();

const emit = defineEmits<{
	remove: [itemId: string];
	duplicate: [itemId: string];
}>();

const { patchFrame } = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
});

/** The selection target resolved against the Feature Match Layout. */
const selection = computed(() => resolveFeatureMatchOverlaySelection(props.config.layout, props.selectedTarget));

const header = computed(() => {
	const current = selection.value;

	if (current.kind === 'canvas') {
		return {
			icon: 'i-lucide-panels-top-left',
			label: 'Canvas',
			badge: 'Frame',
			summary: `${props.screenWidth}×${props.screenHeight} frame and background`,
		};
	}

	if (current.kind === 'source') {
		return {
			icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
			label: current.item.label,
			badge: FEATURE_MATCH_SOURCE_ITEM_LABEL,
			summary: sourceSummary(current.item),
		};
	}

	return {
		icon: 'i-lucide-circle-help',
		label: 'Selection unavailable',
		badge: 'Missing',
		summary: 'Choose the Canvas or another layer',
	};
});
</script>

<template>
	<section class="min-w-0" data-testid="overlay-layer-inspector">
		<div class="mb-1 border-b border-default/70 pb-3">
			<div class="flex min-w-0 items-start gap-3">
				<UIcon :name="header.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
				<div class="min-w-0 flex-1">
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						<p class="truncate text-sm font-semibold">
							{{ header.label }}
						</p>
						<UBadge size="xs" variant="soft">
							{{ header.badge }}
						</UBadge>
					</div>
					<p class="mt-0.5 truncate text-xs text-muted">
						{{ header.summary }}
					</p>
				</div>
			</div>
		</div>

		<FeatureMatchOverlayFrameStyleCard
			v-if="selection.kind === 'canvas'"
			:config="config"
			:patch-frame="patchFrame"
			:event-id="eventId"
		/>

		<FeatureMatchOverlayInspectorSource
			v-else-if="selection.kind === 'source'"
			:config="config"
			:update-config="updateConfig"
			:screen-width="screenWidth"
			:screen-height="screenHeight"
			:item="selection.item"
			@remove="emit('remove', $event)"
			@duplicate="emit('duplicate', $event)"
		/>
	</section>
</template>
