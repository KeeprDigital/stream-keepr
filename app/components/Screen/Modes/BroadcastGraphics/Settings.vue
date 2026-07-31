<script setup lang="ts">
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import type { BroadcastGraphicsWorkspace, BroadcastGraphicsWorkspaceLocation } from '~/modules/broadcast-graphics/workspace';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { getScreenModeGraphicsCanvas } from '~~/shared/screenModes';
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

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const route = useRoute();
const router = useRouter();
const screenStore = useScreenStore();

const {
	screenConfig,
	saving: screenConfigSaving,
	updateScreenConfig,
} = useScreenConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
);

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'broadcast-graphics',
);

const settingsSaving = computed(() => saving.value || screenConfigSaving.value);

defineExpose({ resetConfig, saving: settingsSaving });

const canvasDefaults = getScreenModeGraphicsCanvas('broadcast-graphics');

onMounted(async () => {
	if (!props.screen.screenConfig?.width || !props.screen.screenConfig?.height) {
		await screenStore.updateScreenConfig(props.eventId, props.screen.id, {
			width: props.screen.screenConfig?.width ?? canvasDefaults.width,
			height: props.screen.screenConfig?.height ?? canvasDefaults.height,
		});
	}
});

const canvasWidth = computed(() => screenConfig.value.width ?? props.screen.screenConfig?.width ?? canvasDefaults.width);
const canvasHeight = computed(() => screenConfig.value.height ?? props.screen.screenConfig?.height ?? canvasDefaults.height);

/** The Screen's authored back-to-front stack of Broadcast Graphics. */
const graphics = computed<readonly BroadcastGraphicConfig[]>(() => config.value.graphics ?? []);

/** The Screen's Graphic Channels: its optional playout lanes and their Handoff Policies. */
const channels = computed<readonly GraphicChannelConfig[]>(() => config.value.channels ?? []);

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
	void router.replace({ query: { ...route.query, ...broadcastGraphicsWorkspaceQuery(location) } });
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
	selectedTarget.value = graphicId ? { type: 'graphic', graphicId } : { type: 'canvas' };
}, { immediate: true });

/**
 * The canvas belongs to the leased Edit workspace, but its controls sit outside
 * both workspaces. Gating them on the lease alone would disable them for a Live
 * operator who has no editor open at all — and an artifact nobody holds is
 * writable by anyone. So they close only while this session is looking at an Edit
 * workspace it does not hold; the server refuses the resize either way.
 */
const canvasWritable = computed(() => workspace.value !== 'edit' || editLease.writable.value);

function updateCanvasDimension(field: 'width' | 'height', value: number | null | undefined) {
	if (!canvasWritable.value)
		return;
	updateScreenConfig({
		[field]: value ?? (field === 'width' ? canvasDefaults.width : canvasDefaults.height),
	});
}

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
function updateChannels(next: { channels: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }) {
	if (!editLease.writable.value)
		return;
	updateConfig(next.graphics ? { channels: next.channels, graphics: next.graphics } : { channels: next.channels });
}
</script>

<template>
	<div class="space-y-6">
		<section class="rounded-lg border border-default/70 bg-default p-3">
			<div class="grid gap-3 xl:grid-cols-[auto_minmax(16rem,0.85fr)] xl:items-end">
				<UFormField label="Workspace" size="sm">
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
				</UFormField>

				<UFormField label="Canvas Size" size="sm" description="Every Broadcast Graphic is authored in this pixel canvas.">
					<UFieldGroup class="w-full">
						<UInputNumber
							:model-value="canvasWidth"
							:placeholder="String(canvasDefaults.width)"
							:min="1"
							:disabled="!canvasWritable"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas width"
							@update:model-value="updateCanvasDimension('width', $event)"
						/>
						<UInputNumber
							:model-value="canvasHeight"
							:placeholder="String(canvasDefaults.height)"
							:min="1"
							:disabled="!canvasWritable"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas height"
							@update:model-value="updateCanvasDimension('height', $event)"
						/>
					</UFieldGroup>
				</UFormField>
			</div>
		</section>

		<BroadcastGraphicsEditWorkspace
			v-if="workspace === 'edit'"
			:event-id="eventId"
			:screen="screen"
			:graphics="graphics"
			:channels="channels"
			:selected-target="selectedTarget"
			:selected-graphic-id="selectedGraphicId"
			:canvas-width="canvasWidth"
			:canvas-height="canvasHeight"
			:writable="editLease.writable.value"
			:lease-status="editLease.status.value"
			:can-take-over="editLease.canTakeOver.value"
			@update:graphics="updateGraphics"
			@update:channels="updateChannels"
			@update:selected-target="setSelectedTarget"
			@take-over="editLease.takeOver"
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
</template>
