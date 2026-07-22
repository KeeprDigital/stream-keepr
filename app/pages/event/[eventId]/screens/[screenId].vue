<script setup lang="ts">
import type { ScreenColorMode } from '~~/shared/types/enums';
import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import type { Screen, ScreenCommand, ScreenMode } from '~/types';
import { SCREEN_COLOR_MODE_SELECT_OPTIONS } from '~~/shared/utils/selectOptions';
import { useScreenConfigUpdate } from '~/composables/screen/useScreenConfigUpdate';
import { getScreenModeConfigurationPolicy, getScreenModeLabel, getScreenModeSelectOptions, getScreenModeSettingsComponent } from '~/modules/screen-mode';

definePageMeta({
	title: 'Screen Configuration',
	layout: false,
});

const route = useRoute();
const eventStore = useEventStore();
const screenStore = useScreenStore();
const { copyToClipboard } = useCopyToClipboard();
const { runRequest } = useRequestFeedback();

const event = computed(() => eventStore.event);
const eventId = computed(() => event.value?.id ?? 0);
const screenId = computed(() => Number(route.params.screenId));

const screen = ref<Screen | null>(null);
const loading = ref(true);
const isUpdating = ref(false);

const screenModeConfigurationPolicy = computed(() => {
	const mode = screen.value?.currentMode;
	return mode ? getScreenModeConfigurationPolicy(mode) : null;
});
const isFeatureMatchOverlayScreen = computed(() => screen.value?.currentMode === 'feature-match-overlay');
const isControlScreen = computed(() => screenModeConfigurationPolicy.value?.displayType === 'control');
const containerControls = computed(() => screenModeConfigurationPolicy.value?.containerControls ?? null);
const containerControlPlacement = computed(() => screenModeConfigurationPolicy.value?.containerControlPlacement ?? null);
const hasContainerSettings = computed(() => {
	if (isControlScreen.value)
		return true;
	if (!containerControls.value || !containerControlPlacement.value)
		return false;

	return Object.entries(containerControls.value).some(([key, enabled]) =>
		enabled && containerControlPlacement.value?.[key as keyof typeof containerControls.value] === 'container',
	);
});

// Connected count from presence
const connectedCount = computed(() => screen.value ? screenStore.getConnectedCount(screen.value.id) : 0);

const modeSettingsComponent = computed(() => {
	const mode = screen.value?.currentMode;
	if (!mode)
		return null;
	return getScreenModeSettingsComponent(mode);
});

// Screen-level config (container settings: background, width, height)
const {
	screenConfig,
	saving: screenConfigSaving,
	saveError: screenConfigSaveError,
	updateScreenConfig,
	resetScreenConfig,
	retry: retryScreenConfig,
} = useScreenConfigUpdate(
	() => eventId.value,
	() => screenId.value,
);

// Global reset: resets container config + current mode display settings (preserves bindings)
const modeControlsRef = ref<{ resetConfig?: () => void; saving?: boolean } | null>(null);
const showResetConfirm = ref(false);

// Centralized saving indicator — true when either container or mode config is saving
const isSaving = computed(() => screenConfigSaving.value || modeControlsRef.value?.saving === true);

function confirmResetAll() {
	resetScreenConfig(screenModeConfigurationPolicy.value?.resetScreenConfigDefaults);
	modeControlsRef.value?.resetConfig?.();
	showResetConfirm.value = false;
}

const screenUrl = computed(() => {
	if (!screen.value)
		return '';
	const baseUrl = window.location.origin;
	return `${baseUrl}/event/${eventId.value}/screen/${screen.value.slug}`;
});

const modeOptions = getScreenModeSelectOptions();

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
				screenStore.subscribeToScreenPresence(id);
			},
		},
	);
}

watch(screenId, (newId, oldId) => {
	if (oldId)
		screenStore.unsubscribeFromScreenPresence(oldId);
	if (newId) {
		screen.value = null;
		void loadScreen(newId);
	}
}, { immediate: true });

onBeforeUnmount(() => {
	if (screenId.value) {
		screenStore.unsubscribeFromScreenPresence(screenId.value);
	}
});

// Keep screen in sync with store updates (targeted by ID, avoids deep watch)
const storeScreen = computed(() =>
	screenStore.screens.find(s => s.id === screenId.value) ?? null,
);
watch(storeScreen, (updated) => {
	if (updated) {
		screen.value = updated;
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

async function copyUrl() {
	await copyToClipboard(screenUrl, {
		successTitle: 'URL Copied',
		successDescription: 'Screen URL copied to clipboard',
		errorDescription: 'Failed to copy screen URL to clipboard.',
	});
}

function screenDimensionFallback(field: 'width' | 'height') {
	return screenModeConfigurationPolicy.value?.dimensions[field].defaultValue ?? null;
}

function updateScreenDimension(field: 'width' | 'height', value: number | null | undefined) {
	updateScreenConfig({ [field]: value ?? screenDimensionFallback(field) });
}

function screenOutputUrl(output: FeatureMatchOverlayOutput) {
	if (!screen.value)
		return '';
	const baseUrl = window.location.origin;
	return `${baseUrl}/event/${eventId.value}/screen/${screen.value.slug}?output=${output}`;
}

function openInNewTab() {
	window.open(screenUrl.value, '_blank', 'noopener,noreferrer');
}

function openOutputInNewTab(output: FeatureMatchOverlayOutput) {
	window.open(screenOutputUrl(output), '_blank', 'noopener,noreferrer');
}

const openOutputItems = computed(() => [
	[{ label: 'Open default screen', icon: 'i-lucide-external-link', onSelect: openInNewTab }],
	...(screenModeConfigurationPolicy.value?.outputOptions.length
		? [screenModeConfigurationPolicy.value.outputOptions.map(option => ({
				label: option.label,
				icon: option.icon,
				onSelect: () => openOutputInNewTab(option.value),
			}))]
		: []),
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
	<NuxtLayout name="default">
		<template #actions>
			<UButton
				variant="outline"
				icon="i-lucide-arrow-left"
				:to="`/event/${eventId}/screens`"
			>
				Back to Screens
			</UButton>
		</template>

		<UContainer :class="isFeatureMatchOverlayScreen ? '!max-w-none' : undefined">
			<UILoadingSpinner v-if="loading" size="sm" />

			<UIEmptyState
				v-else-if="!screen"
				icon="i-lucide-monitor-x"
				title="Screen not found"
				description="This screen could not be loaded for the current event."
			/>

			<div v-else class="flex flex-col gap-6">
				<UAlert
					v-if="screenConfigSaveError"
					color="error"
					variant="subtle"
					icon="i-lucide-circle-alert"
					title="Screen settings have not been saved"
					:description="screenConfigSaveError"
				>
					<template #actions>
						<UButton
							color="error"
							variant="soft"
							size="sm"
							@click="retryScreenConfig"
						>
							Try Again
						</UButton>
					</template>
				</UAlert>

				<!-- Screen Header -->
				<UCard>
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
									<UTooltip text="Copy URL">
										<UButton
											variant="ghost"
											size="xs"
											icon="i-lucide-copy"
											aria-label="Copy screen URL"
											@click="copyUrl"
										/>
									</UTooltip>
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
							<UFieldGroup size="sm">
								<UDropdownMenu :items="openOutputItems">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-external-link"
										trailing-icon="i-lucide-chevron-down"
										label="Open"
									/>
								</UDropdownMenu>
								<UTooltip text="Refresh all clients">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-refresh-cw"
										label="Refresh"
										@click="sendCommand('refresh')"
									/>
								</UTooltip>
								<UTooltip text="Flash screen identifier">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-scan-eye"
										label="Identify"
										@click="sendCommand('identify')"
									/>
								</UTooltip>
								<UTooltip text="Toggle debug overlay">
									<UButton
										variant="soft"
										color="neutral"
										icon="i-lucide-bug"
										label="Debug"
										@click="sendCommand('debug')"
									/>
								</UTooltip>

								<USeparator orientation="vertical" class="h-6" />

								<UPopover v-model:open="showResetConfirm">
									<UTooltip text="Reset all display settings">
										<UButton
											variant="soft"
											color="error"
											icon="i-lucide-rotate-ccw"
											label="Reset"
										/>
									</UTooltip>
									<template #content>
										<div class="p-3 flex flex-col gap-3 w-64">
											<p class="text-sm">
												Reset layout and mode-specific display settings to defaults? Theme colors and bindings will be preserved.
											</p>
											<div class="flex justify-end gap-2">
												<UButton
													size="xs"
													variant="ghost"
													color="neutral"
													label="Cancel"
													@click="() => { showResetConfirm = false }"
												/>
												<UButton
													size="xs"
													color="error"
													label="Reset"
													@click="confirmResetAll"
												/>
											</div>
										</div>
									</template>
								</UPopover>
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
						</div>
					</div>
				</UCard>

				<!-- Screen-level Container Settings -->
				<ScreenSettingsCard v-if="hasContainerSettings" title="Container" :default-open="!isFeatureMatchOverlayScreen">
					<!-- Color Mode (control screens only) -->
					<UFormField
						v-if="isControlScreen"
						label="Color Mode"
						description="Appearance for this control screen only."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<USelect
							:model-value="screenConfig.colorMode ?? 'system'"
							:items="SCREEN_COLOR_MODE_SELECT_OPTIONS"
							class="w-32"
							@update:model-value="updateScreenConfig({ colorMode: ($event as ScreenColorMode) })"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.dimensions && containerControlPlacement?.dimensions === 'container'"
						label="Width"
						:description="screenModeConfigurationPolicy?.dimensions.width.description"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="screenConfig.width"
							:placeholder="screenModeConfigurationPolicy?.dimensions.width.placeholder"
							class="w-32"
							@update:model-value="updateScreenDimension('width', $event)"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.dimensions && containerControlPlacement?.dimensions === 'container'"
						label="Height"
						:description="screenModeConfigurationPolicy?.dimensions.height.description"
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="screenConfig.height"
							:placeholder="screenModeConfigurationPolicy?.dimensions.height.placeholder"
							class="w-32"
							@update:model-value="updateScreenDimension('height', $event)"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.padding && containerControlPlacement?.padding === 'container'"
						label="Horizontal Padding"
						description="Inset content from the left and right edges in pixels."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="screenConfig.paddingX"
							placeholder="0"
							:min="0"
							class="w-32"
							@update:model-value="updateScreenConfig({ paddingX: $event ?? null })"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.padding && containerControlPlacement?.padding === 'container'"
						label="Vertical Padding"
						description="Inset content from the top and bottom edges in pixels."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UInputNumber
							:model-value="screenConfig.paddingY"
							placeholder="0"
							:min="0"
							class="w-32"
							@update:model-value="updateScreenConfig({ paddingY: $event ?? null })"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.textColors && containerControlPlacement?.textColors === 'container'"
						label="Primary Text Color"
						description="Main text color that display modes can use for headings and primary labels."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UIColorPicker
							:model-value="screenConfig.primaryTextColor"
							placeholder="#ffffff"
							@update:model-value="updateScreenConfig({ primaryTextColor: $event?.toString() || null })"
						/>
					</UFormField>

					<UFormField
						v-if="!isControlScreen && containerControls?.textColors && containerControlPlacement?.textColors === 'container'"
						label="Secondary Text Color"
						description="Secondary text color that display modes can use for muted or supporting text."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UIColorPicker
							:model-value="screenConfig.secondaryTextColor"
							placeholder="#9ca3af"
							@update:model-value="updateScreenConfig({ secondaryTextColor: $event?.toString() || null })"
						/>
					</UFormField>

					<!-- Background (overlay screens only) -->
					<UFormField
						v-if="!isControlScreen && containerControls?.background && containerControlPlacement?.background === 'container'"
						label="Background"
						description="Pick a color or enter any CSS background value, including gradients or transparent."
						class="flex max-sm:flex-col justify-between items-start gap-4"
					>
						<UIColorPicker
							:model-value="screenConfig.background"
							allow-raw-value
							placeholder="transparent, #ffffff, linear-gradient(...)"
							@update:model-value="updateScreenConfig({ background: $event?.toString() || null })"
						/>
					</UFormField>
				</ScreenSettingsCard>

				<!-- Mode-specific Settings -->
				<component
					:is="modeSettingsComponent"
					v-if="modeSettingsComponent"
					ref="modeControlsRef"
					:screen="screen"
					:event-id="eventId"
				/>
			</div>
		</UContainer>
	</NuxtLayout>
</template>
