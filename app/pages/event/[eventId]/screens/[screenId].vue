<script setup lang="ts">
import type { BackgroundLayersCapableMode } from '~~/shared/screenModes';
import type { Screen, ScreenCommand, ScreenMode } from '~/types';
import { screenModeSupportsBackgroundLayers } from '~~/shared/screenModes';
import { useEditorFocusMode } from '~/modules/graphics/editorFocusMode';
import { getScreenModeConfigurationPolicy, getScreenModeLabel, getScreenModeSettingsComponent, useEventScreenModeSelectOptions } from '~/modules/screen-mode';

definePageMeta({
	title: 'Screen Configuration',
	layout: false,
});

const route = useRoute();
const eventStore = useEventStore();
const screenStore = useScreenStore();
const { runRequest } = useRequestFeedback();

const event = computed(() => eventStore.event);
const eventId = computed(() => event.value?.id ?? 0);
const screenId = computed(() => Number(route.params.screenId));

const screen = ref<Screen | null>(null);
const loading = ref(true);
const isUpdating = ref(false);

// The Screen's Screen Theme Overrides and its one read of the Event's Theme,
// for every card below: a group's Look shows in Editor Focus Mode too.
provideScreenThemeOverrides(screen, eventId);

/**
 * Editor Focus Mode (#744): while a graphics editor's Edit workspace offers it
 * and it is on, the editor gets the page. The layout drops the app sidebar and
 * this page drops the Screen-level cards around the editor — the header and
 * Background & Placement — keeping the save failure,
 * the way back to Screens, and the Screen's name in the navbar.
 */
const { active: editorFocus } = useEditorFocusMode();

const screenModeConfigurationPolicy = computed(() => {
	const mode = screen.value?.currentMode;
	return mode
		? getScreenModeConfigurationPolicy(mode)
		: null;
});
const usesFullWidthConfiguration = computed(() => screenModeConfigurationPolicy.value?.fullWidthConfiguration === true);
const isControlScreen = computed(() => screenModeConfigurationPolicy.value?.displayType === 'control');
// Connected count from presence
const connectedCount = computed(() => screen.value
	? screenStore.getConnectedCount(screen.value.id)
	: 0);

// Outputs self-reporting degraded card data through presence (#465). They are
// already re-fetching on their own; this row is where the operator learns that
// program is showing placeholder cards, since the output itself never says so.
const degradedCardDataCount = useScreenOutputCardDataHealth(() => screenId.value);

const modeSettingsComponent = computed(() => {
	const mode = screen.value?.currentMode;
	if (!mode)
		return null;
	return getScreenModeSettingsComponent(mode);
});

// The current mode, when it carries its own Background Layers stack.
const backgroundLayersMode = computed<BackgroundLayersCapableMode | null>(() => {
	const mode = screen.value?.currentMode;
	return mode && screenModeSupportsBackgroundLayers(mode)
		? mode
		: null;
});

// Reset: restores the current mode's display settings (preserves bindings and Theme overrides).
// A mode whose reset is an authoring write says so while its Graphics Authoring Lease is another's.
const modeControlsRef = ref<{ resetConfig?: () => void; resetBlocked?: boolean; saving?: boolean } | null>(null);
const showResetConfirm = ref(false);
const showCapabilityRotationConfirm = ref(false);
const rotatingCapability = ref(false);

const backgroundLayersControlsRef = ref<{ saving?: boolean } | null>(null);

// Centralized saving indicator — true when mode or background-layer config is saving
const isSaving = computed(() =>
	modeControlsRef.value?.saving === true
	|| backgroundLayersControlsRef.value?.saving === true,
);

const resetBlocked = computed(() => modeControlsRef.value?.resetBlocked === true);

function confirmResetAll() {
	modeControlsRef.value?.resetConfig?.();
	showResetConfirm.value = false;
}

/**
 * This Screen's address, shown so an operator can read where its outputs live.
 *
 * Deliberately not the URL the controls beside it hand out: that one carries this
 * Screen Output Asset Capability, which is a secret and does not belong on a page
 * anyone can be standing behind. Copy and open produce it; reading this one off the
 * screen and typing it produces an output with no media (#231).
 */
const screenUrl = computed(() => {
	if (!screen.value)
		return '';
	const baseUrl = window.location.origin;
	return `${baseUrl}/event/${eventId.value}/screen/${screen.value.slug}`;
});

const modeOptions = useEventScreenModeSelectOptions();

// The Screen whose presence this page holds a watch on. The watch is counted, so
// the page lets go only of the one it took: the Screens list may hold it too.
let watchedPresenceId: number | null = null;

function releasePresence() {
	if (watchedPresenceId === null)
		return;
	screenStore.unsubscribeFromScreenPresence(watchedPresenceId);
	watchedPresenceId = null;
}

// Load screen and subscribe to presence for the current screenId, tearing down
// the previous subscription first. Sidebar links reuse this component across
// sibling screen routes, so this must react to route param changes, not just mount.
// `latestKey` discards a stale response from a screenId that's since been
// superseded, so a slow load for an intermediate screenId can't overwrite
// `screen`/`loading` or open a presence subscription nothing will ever close.
async function loadScreen(id: number) {
	if (!eventId.value)
		return;
	await runRequest(
		() => screenStore.getScreenById(eventId.value, id),
		{
			latestKey: 'screen',
			loadingRef: loading,
			success: false,
			error: {
				title: 'Error',
				description: 'Failed to load screen',
				color: 'error',
			},
			onSuccess: (data) => {
				screen.value = data;
				// Subscribe to presence after screen loads
				releasePresence();
				screenStore.subscribeToScreenPresence(id);
				watchedPresenceId = id;
			},
		},
	);
}

watch(screenId, (newId) => {
	releasePresence();
	if (newId) {
		screen.value = null;
		void loadScreen(newId);
	}
}, { immediate: true });

onBeforeUnmount(releasePresence);

// Keep screen in sync with store updates (targeted by ID, avoids deep watch)
const storeScreen = computed(() =>
	screenStore.screens.find(s => s.id === screenId.value) ?? null,
);
watch(storeScreen, (updated, previous) => {
	if (updated) {
		screen.value = updated;
	}
	// The Screen left the list of an Event still held, so it was deleted: stop
	// offering its settings. An Event that is ending empties the list as well.
	else if (previous && eventId.value && screen.value?.id === previous.id) {
		screen.value = null;
	}
});

async function setMode(mode: ScreenMode) {
	if (!screen.value || isUpdating.value || mode === screen.value.currentMode)
		return;

	await runRequest(
		() => screenStore.setScreenMode(eventId.value, screen.value!.id, mode),
		{
			loadingRef: isUpdating,
			success: {
				title: 'Mode Changed',
				description: `Screen mode set to ${getScreenModeLabel(mode)}`,
				color: 'success',
			},
			error: {
				title: 'Error',
				description: 'Failed to change screen mode',
				color: 'error',
			},
		},
	);
}

async function rotateAssetCapability() {
	if (!screen.value)
		return;
	await runRequest(
		() => $fetch<{ assetCapability: string }>(
			`/api/events/${eventId.value}/screens/${screen.value!.id}/asset-capability`,
			{ method: 'POST' },
		),
		{
			loadingRef: rotatingCapability,
			success: {
				title: 'Asset Access Rotated',
				description: 'Previously copied Screen URLs can no longer resolve Graphic Assets.',
				color: 'success',
			},
			error: {
				title: 'Rotation Failed',
				description: 'Screen Output asset access could not be rotated.',
				color: 'error',
			},
			onSuccess: () => {
				showCapabilityRotationConfirm.value = false;
			},
		},
	);
}

/**
 * The Screen Mode's own Screen Outputs, which the hand-out offers after the Screen's
 * output, each named by the output it is (#266, #1104).
 */
const ownOutputs = computed(() => screenModeConfigurationPolicy.value?.outputs ?? []);

/**
 * The actions an operator rarely needs, and the two that destroy something, kept
 * away from Refresh. Rotate and Reset only ask here: a menu closes on a choice, so
 * each confirms in a dialog, and the write is that dialog's button.
 */
const moreActionItems = computed(() => [
	[
		{
			label: 'Identify',
			icon: 'i-lucide-scan-eye',
			onSelect: () => void sendCommand('identify'),
		},
		{
			label: 'Debug',
			icon: 'i-lucide-bug',
			onSelect: () => void sendCommand('debug'),
		},
	],
	[
		{
			label: 'Rotate Asset Access',
			icon: 'i-lucide-key-round',
			color: 'warning' as const,
			onSelect: () => {
				showCapabilityRotationConfirm.value = true;
			},
		},
		{
			label: 'Reset mode settings',
			icon: 'i-lucide-rotate-ccw',
			color: 'error' as const,
			disabled: resetBlocked.value,
			description: resetBlocked.value
				? 'Another session is editing this Screen\'s graphics'
				: undefined,
			onSelect: () => {
				showResetConfirm.value = true;
			},
		},
	],
]);

async function sendCommand(command: ScreenCommand) {
	if (!screen.value)
		return;
	const labels: Record<ScreenCommand, string> = {
		refresh: 'Refresh command sent',
		identify: 'Identify command sent',
		debug: 'Debug toggle sent',
	};
	await runRequest(
		async () => {
			await screenStore.sendScreenCommand(screen.value!.id, command);
			return true;
		},
		{
			success: {
				title: 'Command Sent',
				description: labels[command],
				color: 'success',
			},
			error: {
				title: 'Command Failed',
				description: 'Failed to send screen command',
				color: 'error',
			},
		},
	);
}
</script>

<template>
	<NuxtLayout name="default" :editor-focus="editorFocus">
		<template v-if="editorFocus && screen" #navbar-center>
			<span class="hidden truncate text-sm text-muted sm:inline" data-testid="focused-screen-name">{{ screen.name }}</span>
		</template>
		<template #actions>
			<UButton
				variant="outline"
				icon="i-lucide-arrow-left"
				:to="`/event/${eventId}/screens`"
			>
				Back to Screens
			</UButton>
		</template>

		<UContainer :class="usesFullWidthConfiguration ? '!max-w-none' : undefined">
			<UILoadingSpinner v-if="loading" size="sm" />

			<UIEmptyState
				v-else-if="!screen"
				icon="i-lucide-monitor-x"
				title="Screen not found"
				description="This screen could not be loaded for the current event."
			/>

			<div v-else class="flex flex-col gap-6">
				<!-- Screen Header -->
				<UCard v-if="!editorFocus">
					<div class="flex flex-col gap-3">
						<!-- Title Row -->
						<div class="flex items-center justify-between gap-4">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<h2 class="text-xl font-semibold">
										{{ screen.name }}
									</h2>
									<UBadge
										size="xs"
										:color="isControlScreen ? 'info' : 'neutral'"
										variant="subtle"
									>
										<UIcon
											:name="isControlScreen ? 'i-lucide-sliders-horizontal' : 'i-lucide-monitor'"
											class="size-3 mr-1"
										/>
										{{ isControlScreen ? 'Control' : 'Overlay' }}
									</UBadge>
								</div>
								<div class="flex items-center gap-2 mt-1 text-sm text-muted">
									<span class="truncate">{{ screenUrl }}</span>
								</div>
							</div>

							<!-- Mode Selector -->
							<USelect
								:model-value="screen.currentMode"
								:items="modeOptions"
								:loading="isUpdating"
								color="neutral"
								variant="outline"
								class="w-44 shrink-0"
								aria-label="Screen mode"
								@update:model-value="setMode($event)"
							/>
						</div>

						<!-- Controls Row -->
						<div class="flex items-center gap-3">
							<ScreenOutputHandOut
								:event-id="eventId"
								:screen="screen"
								:outputs="ownOutputs"
								data-header-action="hand-out"
							/>
							<UFieldGroup size="sm">
								<UTooltip text="Refresh all clients">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-refresh-cw"
										label="Refresh"
										data-header-action="refresh"
										@click="sendCommand('refresh')"
									/>
								</UTooltip>
								<UDropdownMenu :items="moreActionItems">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-ellipsis"
										aria-label="More Screen actions"
										data-header-action="more"
										data-testid="screen-actions-menu"
									/>
								</UDropdownMenu>
							</UFieldGroup>

							<!-- Status Indicators -->
							<UBadge v-if="isSaving" color="warning" variant="subtle">
								Saving...
							</UBadge>
							<span v-if="connectedCount > 0" class="flex items-center gap-1.5 text-xs text-success">
								<span class="relative flex size-2">
									<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
									<span class="relative inline-flex rounded-full size-2 bg-current" />
								</span>
								{{ connectedCount }} live
							</span>
							<span v-else class="text-xs text-muted">
								No clients
							</span>
							<span
								v-if="degradedCardDataCount > 0"
								class="flex items-center gap-1.5 text-xs text-warning"
								data-testid="card-data-degraded"
							>
								<UIcon name="i-lucide-triangle-alert" class="size-3.5" />
								Card data incomplete on {{ degradedCardDataCount }} {{ degradedCardDataCount === 1 ? 'output' : 'outputs' }} — re-fetching until Scryfall answers
							</span>
						</div>
					</div>

					<UModal
						v-model:open="showCapabilityRotationConfirm"
						title="Rotate Asset Access"
						description="Rotate this Screen Output's asset access? Previously copied URLs will stop resolving Graphic Assets immediately."
						:ui="{ footer: 'justify-end' }"
					>
						<template #footer>
							<UButton
								variant="ghost"
								color="neutral"
								label="Cancel"
								:disabled="rotatingCapability"
								@click="() => { showCapabilityRotationConfirm = false }"
							/>
							<UButton
								color="warning"
								label="Rotate Access"
								:loading="rotatingCapability"
								@click="rotateAssetCapability"
							/>
						</template>
					</UModal>

					<UModal
						v-model:open="showResetConfirm"
						title="Reset mode settings"
						description="Reset this mode's display settings to defaults? Theme overrides and bindings will be preserved."
						:ui="{ footer: 'justify-end' }"
					>
						<template #footer>
							<UButton
								variant="ghost"
								color="neutral"
								label="Cancel"
								@click="() => { showResetConfirm = false }"
							/>
							<UButton
								color="error"
								label="Reset"
								@click="confirmResetAll"
							/>
						</template>
					</UModal>
				</UCard>

				<!-- Mode-specific Settings -->
				<component
					:is="modeSettingsComponent"
					v-if="modeSettingsComponent"
					ref="modeControlsRef"
					:screen="screen"
					:event-id="eventId"
				/>

				<!-- Background & Placement (modes that carry their own stack) -->
				<ScreenModeBackgroundLayersSettings
					v-if="backgroundLayersMode && !editorFocus"
					:key="backgroundLayersMode"
					ref="backgroundLayersControlsRef"
					:screen="screen"
					:event-id="eventId"
					:mode="backgroundLayersMode"
				/>
			</div>
		</UContainer>
	</NuxtLayout>
</template>
