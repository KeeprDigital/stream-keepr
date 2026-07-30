<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { BROADCAST_GRAPHICS_HOST_CONTRACT } from '~~/shared/modules/graphics';
import GraphicsCompositorInspector from '~/components/Graphics/Compositor/Inspector.vue';
import GraphicsCompositorPreview from '~/components/Graphics/Compositor/Preview.vue';
import GraphicsCompositorStackTree from '~/components/Graphics/Compositor/StackTree.vue';

/**
 * The Edit workspace of a Broadcast Graphics Screen: the shared compositor's
 * authoring tree, preview, and inspector over the Screen's authored stack.
 */
defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
}>();
</script>

<template>
	<div class="grid min-h-[calc(100vh-18rem)] items-start gap-4 xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(19rem,24rem)] 2xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(24rem,30rem)]">
		<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
			<GraphicsCompositorStackTree
				:graphics="graphics"
				:selected-target="selectedTarget"
				:selected-graphic-id="selectedGraphicId"
				:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				@update:graphics="emit('update:graphics', $event)"
				@update:selected-target="emit('update:selectedTarget', $event)"
			/>
		</section>

		<section class="min-w-0 xl:sticky xl:top-4">
			<GraphicsCompositorPreview
				:event-id="eventId"
				:screen="screen"
				:graphics="graphics"
				:selected-target="selectedTarget"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				@select-target="emit('update:selectedTarget', $event)"
			/>
		</section>

		<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
			<GraphicsCompositorInspector
				:graphics="graphics"
				:selected-target="selectedTarget"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				@update:graphics="emit('update:graphics', $event)"
			/>
		</section>
	</div>
</template>
