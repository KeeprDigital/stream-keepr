<script setup lang="ts">
import type { GraphicThemeTokens } from '~~/shared/modules/graphics';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { featureMatchLayoutStack } from '~~/shared/featureMatchLayoutComposition';
import { featureMatchOverlayHostContract } from '~~/shared/modules/graphics';

/**
 * The Feature Match Layout's shared property panel.
 *
 * The same adapter as the authoring tree, over the same stack of one. Passing the
 * Host Contract is what withholds the Graphic Inputs declaration controls and
 * offers the Feature Match token binding catalogue in their place — a Feature Match
 * Overlay declares no Graphic Inputs, so there is nothing here to declare.
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	eventId: number;
	writable?: boolean;
	/** The Foundation Tokens the editor previews under (#829). */
	themeTokens?: GraphicThemeTokens;
}>();

const emit = defineEmits<{ 'update:composition': [composition: BroadcastGraphicConfig] }>();

const stack = computed(() => featureMatchLayoutStack(props.layout));

/** This Event's contract: its token catalogue and Seats are a Commander Event's four where it is one (ADR-0087). */
const eventKind = useEventKind();
const contract = computed(() => featureMatchOverlayHostContract(eventKind.value ?? 'mtg-two-player'));

function updateStack(next: BroadcastGraphicConfig[]) {
	const composition = next.length === 1
		? next[0]
		: undefined;
	if (composition)
		emit('update:composition', composition);
}
</script>

<template>
	<GraphicsCompositorInspector
		:graphics="stack"
		:selected-target="selectedTarget"
		:contract="contract"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
		:event-id="eventId"
		:writable="writable"
		:theme-tokens="themeTokens"
		@update:graphics="updateStack"
	/>
</template>
