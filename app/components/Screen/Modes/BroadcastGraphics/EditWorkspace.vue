<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsAuthoringLeaseStatus } from '~/composables/screen/useGraphicsAuthoringLease';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { BROADCAST_GRAPHICS_HOST_CONTRACT } from '~~/shared/modules/graphics';
import GraphicsCompositorInspector from '~/components/Graphics/Compositor/Inspector.vue';
import GraphicsCompositorPreview from '~/components/Graphics/Compositor/Preview.vue';
import GraphicsCompositorStackTree from '~/components/Graphics/Compositor/StackTree.vue';

/**
 * The Edit workspace of a Broadcast Graphics Screen: the shared compositor's
 * authoring tree, preview, and inspector over the Screen's authored stack.
 *
 * The whole workspace is the artifact one Graphics Authoring Lease covers, so
 * exactly one session authors it and every other session observes it. An observer
 * gets the same workspace read-only — the same stack, the same preview, the same
 * properties — because watching a colleague compose is the point, and it takes the
 * lease over when it needs to author instead.
 */
const props = withDefaults(defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	/** Whether this session currently holds the workspace's Graphics Authoring Lease. */
	writable?: boolean;
	leaseStatus?: GraphicsAuthoringLeaseStatus;
	canTakeOver?: boolean;
}>(), { writable: true, leaseStatus: 'ready', canTakeOver: false });

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
	'takeOver': [];
}>();

const leaseNotice = computed(() => {
	if (props.writable)
		return null;
	if (props.leaseStatus === 'error')
		return 'The Graphics Authoring Lease for this Edit workspace could not be checked, so authoring stays read-only.';
	if (props.leaseStatus !== 'ready')
		return 'Checking the Graphics Authoring Lease for this Edit workspace.';
	return 'Another session holds the Graphics Authoring Lease for this Edit workspace. You are observing its accepted changes read-only.';
});
</script>

<template>
	<div>
		<div
			v-if="leaseNotice"
			class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
			data-testid="edit-lease-notice"
		>
			<UIcon name="i-lucide-eye" class="size-4 shrink-0 text-warning" />
			<p class="min-w-0 flex-1 text-sm">
				{{ leaseNotice }}
			</p>
			<UButton
				v-if="canTakeOver"
				size="xs"
				variant="soft"
				icon="i-lucide-pencil-ruler"
				data-testid="edit-lease-take-over"
				@click="emit('takeOver')"
			>
				Take over
			</UButton>
		</div>

		<div class="grid min-h-[calc(100vh-18rem)] items-start gap-4 xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(19rem,24rem)] 2xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(24rem,30rem)]">
			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<GraphicsCompositorStackTree
					:graphics="graphics"
					:selected-target="selectedTarget"
					:selected-graphic-id="selectedGraphicId"
					:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:writable="writable"
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
					:writable="writable"
					@update:graphics="emit('update:graphics', $event)"
				/>
			</section>
		</div>
	</div>
</template>
