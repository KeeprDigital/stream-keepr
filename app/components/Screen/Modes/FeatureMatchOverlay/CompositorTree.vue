<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { featureMatchLayoutStack } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_OVERLAY_HOST_CONTRACT } from '~~/shared/modules/graphics';

/**
 * The Feature Match Layout's shared authoring tree.
 *
 * A thin adapter around the shared compositor's own tree: it translates the one
 * composition into the stack of one the compositor authors, and translates the
 * emitted stack back into the layout's composition. Everything the tree offers —
 * which Graphic Item Definitions the palette shows, whether a stack is authored at
 * all — comes from the Host Contract rather than from anything decided here.
 *
 * The stack the compositor emits always has exactly one member, because the
 * contract's `single` composition means nothing offers to add, reorder, or remove
 * one. Reading `[0]` and ignoring a longer stack would hide a contract violation,
 * so the write is refused instead: a tree that somehow produced two compositions
 * has lost the property this host depends on, and silently keeping the first would
 * discard an author's work.
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	writable?: boolean;
}>();

const emit = defineEmits<{
	'update:composition': [composition: BroadcastGraphicConfig];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
}>();

const stack = computed(() => featureMatchLayoutStack(props.layout));

function updateStack(next: BroadcastGraphicConfig[]) {
	const composition = next.length === 1 ? next[0] : undefined;
	if (composition)
		emit('update:composition', composition);
}
</script>

<template>
	<GraphicsCompositorStackTree
		:graphics="stack"
		:selected-target="selectedTarget"
		:selected-graphic-id="stack[0]!.id"
		:contract="FEATURE_MATCH_OVERLAY_HOST_CONTRACT"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
		:writable="writable"
		@update:graphics="updateStack"
		@update:selected-target="emit('update:selectedTarget', $event)"
	/>
</template>
