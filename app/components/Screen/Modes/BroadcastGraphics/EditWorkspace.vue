<script setup lang="ts">
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
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
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	/** The Screen's Graphic Channels: its optional playout lanes. */
	channels: readonly GraphicChannelConfig[];
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	/** Whether this session currently holds the workspace's Graphics Authoring Lease. */
	writable?: boolean;
	leaseStatus?: GraphicsAuthoringLeaseStatus;
	canTakeOver?: boolean;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	/**
	 * Declaring, renaming, repolicying, or deleting a Graphic Channel, together with
	 * any membership the change releases or assigns — one write, because deleting a
	 * lane and releasing its members must never be two.
	 */
	'update:channels': [next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
	'takeOver': [];
}>();

/**
 * The Broadcast Graphic an author can save as a Broadcast Graphic Template.
 *
 * Saving copies one finished design, not the Screen's whole stack, so the library
 * offers exactly the graphic the author is looking at.
 */
const selectedGraphic = computed(() =>
	props.graphics.find(graphic => graphic.id === props.selectedGraphicId) ?? null,
);

/**
 * The published Graphic Style Set the selected Broadcast Graphic inherits from.
 *
 * Loaded here rather than in the inspector because the same context serves the
 * property pickers and the library card beside them, and because it follows the
 * *selection*: two Broadcast Graphics on one Screen may be linked to different Style
 * Sets, or to none.
 */
const styleSetAuthoring = useGraphicStyleSetAuthoring(selectedGraphic);

/**
 * The game of the Event this Screen belongs to.
 *
 * The inspector needs it to author Graphic Input Bindings: the field catalog
 * separates stable common fields from ones specific to the current Event's game, and
 * an author must never be offered a field this Event cannot resolve.
 */
const eventStore = useEventStore();
const game = computed(() => eventStore.event?.game);

/** One edited Broadcast Graphic back into the Screen's stack. */
function replaceSelectedGraphic(graphic: BroadcastGraphicConfig) {
	emit('update:graphics', props.graphics.map(entry => entry.id === graphic.id ? graphic : entry));
}

/** A placement is a new Broadcast Graphic, and the author is put straight on it. */
function selectPlacedGraphic(graphicId: string) {
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

/**
 * Fail closed: until a caller says this session holds the lease, the workspace is
 * an observer's. An unstated permission must never read as one that was granted.
 */
const canAuthor = computed(() => props.writable === true);

const leaseNotice = computed(() => {
	if (canAuthor.value)
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
				v-if="canTakeOver === true"
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
					:writable="canAuthor"
					@update:graphics="emit('update:graphics', $event)"
					@update:selected-target="emit('update:selectedTarget', $event)"
				/>

				<!--
					The Broadcast Graphic Template library lives in the Edit workspace and
					nowhere else: saving and placing designs is authoring, and the Live
					workspace deliberately has no route to either.
				-->
				<GraphicsBroadcastGraphicTemplateLibrary
					class="mt-4 block"
					:event-id="eventId"
					:screen-id="screen.id"
					:selected-graphic="selectedGraphic"
					:writable="canAuthor"
					@placed="selectPlacedGraphic"
				/>

				<!--
					Graphic Channels sit beside the stack rather than in it: a lane decides
					which graphics replace each other on air, and never what composites over
					what.
				-->
				<ScreenModesBroadcastGraphicsChannels
					class="mt-4 block"
					:graphics="graphics"
					:channels="channels"
					:writable="canAuthor"
					@update:channels="emit('update:channels', $event)"
				/>

				<!--
					The Graphic Style Set library sits beside the template library because
					they answer one question together: what a design is, and what visual
					language it speaks. Both are authoring, and neither has a route from the
					Live workspace.
				-->
				<GraphicsStyleSetLibrary
					class="mt-4 block"
					:selected-graphic="selectedGraphic"
					:writable="canAuthor"
					@update:graphic="replaceSelectedGraphic"
					@published="styleSetAuthoring.refreshLinked()"
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
					:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:event-id="eventId"
					:game="game"
					:writable="canAuthor"
					:style-set="styleSetAuthoring.context.value ?? undefined"
					@update:graphics="emit('update:graphics', $event)"
				/>
			</section>
		</div>
	</div>
</template>
