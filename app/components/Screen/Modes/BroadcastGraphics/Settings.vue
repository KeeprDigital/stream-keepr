<script setup lang="ts">
import type { BroadcastGraphicsBackgroundConfig } from '~~/shared/animationEffects';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import type { BroadcastGraphicsWorkspace, BroadcastGraphicsWorkspaceLocation } from '~/modules/broadcast-graphics/workspace';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { eventCanvasOf } from '~~/shared/eventCanvas';
import {
	BROADCAST_GRAPHICS_GRAPHIC_QUERY_KEY,
	BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY,
	broadcastGraphicsWorkspaceQuery,
	resolveBroadcastGraphicsWorkspace,
	resolveSelectedBroadcastGraphicId,
} from '~/modules/broadcast-graphics/workspace';
import { graphicsSelectionGraphicId } from '~/modules/graphics/selection';
import BroadcastGraphicsEditWorkspace from './EditWorkspace.vue';
import BroadcastGraphicsLiveWorkspace from './LiveWorkspace.vue';
import BroadcastGraphicsProgramMonitor from './ProgramMonitor.vue';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const route = useRoute();
const router = useRouter();
const eventStore = useEventStore();

const { config, saving, saveState, saveError, updateConfig, resetConfig, retry } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'broadcast-graphics',
);

defineExpose({ resetConfig, saving });

/** Every Broadcast Graphic is authored in its Event's canvas, set in Event Presentation Settings (ADR-0051). */
const eventCanvas = computed(() => eventCanvasOf(eventStore.event));
const canvasWidth = computed(() => eventCanvas.value.width);
const canvasHeight = computed(() => eventCanvas.value.height);

/** The Screen's authored back-to-front stack of Broadcast Graphics. */
const graphics = computed<readonly BroadcastGraphicConfig[]>(() => config.value.graphics ?? []);

/** The Screen's Graphic Channels: its optional playout lanes and their Handoff Policies. */
const channels = computed<readonly GraphicChannelConfig[]>(() => config.value.channels ?? []);

/** The Screen's Broadcast Graphics Background, or none authored. */
const background = computed<BroadcastGraphicsBackgroundConfig | undefined>(() => config.value.background);

const workspace = computed(() => resolveBroadcastGraphicsWorkspace(route.query[BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY]));

/**
 * The Screen's graphics Edit workspace is one leased authoring artifact, and the
 * lease is asked for only while that workspace is open. The Live workspace never
 * consults it: Live Control is not lease-restricted, and the way to keep that true
 * is for the live path not to know the lease exists.
 */
const editLease = useGraphicsAuthoringLease({
	endpoint: () => `/api/events/${props.eventId}/screens/${props.screen.id}/graphics-authoring-lease`,
	enabled: () => workspace.value === 'edit',
});

/**
 * The Broadcast Graphics Live Session, kept honest for both workspaces (#373).
 *
 * The Program monitor is hoisted above the workspace switch, and the facts it
 * and the Edit workspace's on-air marks project — playout, rendered input
 * values — come from the Live Session store. Before this, only the Live
 * workspace loaded that store, so an operator landing straight in Edit
 * projected from a session never loaded. The Live workspace keeps its own sync
 * for its own `disconnected` reading; a second load of the same snapshot is
 * superseded by the store's keyed guarded sequence, never doubled.
 */
const { disconnected: playoutDisconnected } = useBroadcastGraphicsLiveSessionSync(
	() => props.eventId,
	() => props.screen.id,
);
const selectedGraphicId = computed(() => resolveSelectedBroadcastGraphicId(
	route.query[BROADCAST_GRAPHICS_GRAPHIC_QUERY_KEY],
	graphics.value,
));
const selectedTarget = ref<GraphicsSelectionTarget>({ type: 'canvas' });

const WORKSPACE_OPTIONS = [
	{ label: 'Live', value: 'live', icon: 'i-lucide-radio' },
	{ label: 'Edit', value: 'edit', icon: 'i-lucide-pencil-ruler' },
] satisfies Array<{ label: string; value: BroadcastGraphicsWorkspace; icon: string }>;

function navigate(location: BroadcastGraphicsWorkspaceLocation) {
	void router.replace({
		query: {
			...route.query,
			...broadcastGraphicsWorkspaceQuery(location),
		},
	});
}

/** Both workspaces are URL-addressable, and the selected Broadcast Graphic travels with them. */
function setWorkspace(next: BroadcastGraphicsWorkspace) {
	navigate({ workspace: next, selectedGraphicId: selectedGraphicId.value });
}

function setSelectedTarget(target: GraphicsSelectionTarget) {
	selectedTarget.value = target;
	const graphicId = graphicsSelectionGraphicId(target);
	if (graphicId !== selectedGraphicId.value)
		navigate({ workspace: workspace.value, selectedGraphicId: graphicId });
}

watch(selectedGraphicId, (graphicId) => {
	if (graphicsSelectionGraphicId(selectedTarget.value) === graphicId)
		return;
	selectedTarget.value = graphicId
		? { type: 'graphic', graphicId }
		: { type: 'canvas' };
}, { immediate: true });

/**
 * The single write funnel for the authored stack, so one check covers every
 * authoring control the Edit workspace offers. The server refuses an observer's
 * write regardless; this keeps a read-only editor from ever asking.
 */
function updateGraphics(next: BroadcastGraphicConfig[]) {
	if (!editLease.writable.value)
		return;
	updateConfig({ graphics: next });
}

/**
 * Declaring a Graphic Channel and joining a Broadcast Graphic to one are one write.
 *
 * Deleting a channel has to release its members in the same patch, or the Screen
 * would briefly hold graphics naming a lane it no longer declares — resolved
 * tolerantly everywhere, but a state no authoring action should be able to create.
 */
function updateChannels(next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }) {
	if (!editLease.writable.value)
		return;
	updateConfig(next);
}

/** The Screen's Broadcast Graphics Background, through the same lease-gated funnel. */
function updateBackground(next: BroadcastGraphicsBackgroundConfig) {
	if (!editLease.writable.value)
		return;
	updateConfig({ background: next });
}
</script>

<template>
	<div class="space-y-6">
		<section class="rounded-lg border border-default/70 bg-default p-3">
			<div class="grid gap-3">
				<UFormField label="Workspace" size="sm">
					<div class="flex flex-wrap items-center gap-2">
						<UFieldGroup size="sm">
							<UButton
								v-for="option in WORKSPACE_OPTIONS"
								:key="option.value"
								:icon="option.icon"
								:color="workspace === option.value ? 'primary' : 'neutral'"
								:variant="workspace === option.value ? 'subtle' : 'outline'"
								:data-testid="`workspace-${option.value}`"
								:aria-pressed="workspace === option.value"
								@click="setWorkspace(option.value)"
							>
								{{ option.label }}
							</UButton>
						</UFieldGroup>
						<!-- Editor Focus Mode is the Edit workspace's alone (#744): Live keeps the page as it is. -->
						<GraphicsEditorFocusModeToggle v-if="workspace === 'edit'" />
					</div>
				</UFormField>
			</div>
		</section>

		<!--
			The Program monitor is hoisted above the workspace switch so it is one
			persistent instance in both workspaces (story 23, #335): the same element
			across a switch, so program never reloads in front of the operator. It sits
			first in this container in both layouts, which is what keeps its iframe in
			place while the workspace beside it changes.
		-->
		<div
			:class="workspace === 'edit'
				? 'space-y-4'
				: 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]'"
		>
			<BroadcastGraphicsProgramMonitor
				:event-id="eventId"
				:screen="screen"
				:graphics="graphics"
				:channels="channels"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				:compact="workspace === 'edit'"
			/>

			<BroadcastGraphicsEditWorkspace
				v-if="workspace === 'edit'"
				:event-id="eventId"
				:screen="screen"
				:graphics="graphics"
				:channels="channels"
				:background="background"
				:selected-target="selectedTarget"
				:selected-graphic-id="selectedGraphicId"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				:writable="editLease.writable.value"
				:lease-status="editLease.status.value"
				:can-take-over="editLease.canTakeOver.value"
				:holder-name="editLease.holderName.value"
				:playout-disconnected="playoutDisconnected"
				:save-state="saveState"
				:save-error="saveError"
				@update:graphics="updateGraphics"
				@update:channels="updateChannels"
				@update:background="updateBackground"
				@update:selected-target="setSelectedTarget"
				@take-over="editLease.takeOver"
				@retry-save="retry"
			/>

			<BroadcastGraphicsLiveWorkspace
				v-else
				:event-id="eventId"
				:screen="screen"
				:graphics="graphics"
				:channels="channels"
				:selected-graphic-id="selectedGraphicId"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				@select="setSelectedTarget({ type: 'graphic', graphicId: $event })"
			/>
		</div>
	</div>
</template>
