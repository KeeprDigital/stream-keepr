<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayPresetId } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget, Screen } from '~/types';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT, DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH } from '~~/shared/types/screenConfig';
import FeatureMatchOverlayCompositorInspector from './CompositorInspector.vue';
import FeatureMatchOverlayCompositorTree from './CompositorTree.vue';
import FeatureMatchOverlayLayerInspector from './LayerInspector.vue';
import FeatureMatchOverlayPreviewOutputAside from './PreviewOutputAside.vue';

const props = defineProps<{ screen: Screen; eventId: number }>();

const featureMatchStore = useFeatureMatchStore();
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
	'feature-match-overlay',
);

const settingsSaving = computed(() => saving.value || screenConfigSaving.value);
const {
	eligibility: assetPublicationEligibility,
	blocked: assetPublicationBlocked,
	reason: assetPublicationBlockReason,
	retry: retryAssetPublicationEligibility,
} = useGraphicAssetPublicationEligibility(config);

defineExpose({ resetConfig, saving: settingsSaving });

onMounted(async () => {
	await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	if (!props.screen.screenConfig?.width || !props.screen.screenConfig?.height) {
		await screenStore.updateScreenConfig(props.eventId, props.screen.id, {
			width: props.screen.screenConfig?.width ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
			height: props.screen.screenConfig?.height ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
		});
	}
});

const matchOptions = useFeatureMatchMenuItems();
const presetOptions = FEATURE_MATCH_OVERLAY_PRESETS.map(preset => ({ label: preset.label, value: preset.id, description: preset.description }));
const confirmPresetId = ref<FeatureMatchOverlayPresetId | null>(null);
const selectedTarget = ref<FeatureMatchOverlaySelectionTarget>({ type: 'canvas' });
const screenWidth = computed(() => screenConfig.value.width ?? props.screen.screenConfig?.width ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH);
const screenHeight = computed(() => screenConfig.value.height ?? props.screen.screenConfig?.height ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT);
const selectedPreset = computed(() => FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === config.value.presetId));
const aspectMismatch = computed(() => {
	if (!selectedPreset.value)
		return false;
	const actual = screenWidth.value / screenHeight.value;
	return Math.abs(actual - selectedPreset.value.aspectRatio) > 0.05;
});

const showPresetConfirm = computed({
	get: () => confirmPresetId.value !== null,
	set: (value: boolean) => {
		if (!value)
			confirmPresetId.value = null;
	},
});

function applyPreset() {
	if (!confirmPresetId.value)
		return;
	updateConfig(applyFeatureMatchOverlayPreset(config.value, confirmPresetId.value));
	clearSelection();
	confirmPresetId.value = null;
}

function resetToPreset() {
	updateConfig(applyFeatureMatchOverlayPreset(config.value, config.value.presetId));
	clearSelection();
}

function updateCanvasDimension(field: 'width' | 'height', value: number | null | undefined) {
	updateScreenConfig({
		[field]: value ?? (field === 'width' ? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH : DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT),
	});
}

/* ────────────────────────────────────────────────
 * Shared compositor
 * ──────────────────────────────────────────────── */

/**
 * The shared item tree's own selection, held separately from the host-owned one.
 *
 * Two refs rather than one union, because they address different things: the shared
 * one names a Graphic Item inside the one composition, and the host-owned one names
 * the Frame, a Source Item, or a legacy widget. Merging them would make every
 * consumer of either handle both, and the two authoring surfaces are exactly what
 * the contract ticket will separate.
 *
 * They are nonetheless one selection, because there is one property panel. Choosing
 * in either surface clears the other, so exactly one of them is ever non-canvas.
 * Without that, selecting a shared Graphic Item and then a legacy widget updates the
 * host-owned ref while the panel keeps showing the compositor's — leaving the legacy
 * inspector unreachable until the author happens to re-select the canvas.
 */
const compositorTarget = ref<GraphicsSelectionTarget>({ type: 'canvas' });

function selectCompositorTarget(target: GraphicsSelectionTarget) {
	compositorTarget.value = target;
	if (target.type !== 'canvas')
		selectedTarget.value = { type: 'canvas' };
}

function selectHostTarget(target: FeatureMatchOverlaySelectionTarget) {
	selectedTarget.value = target;
	if (target.type !== 'canvas')
		compositorTarget.value = { type: 'canvas' };
}

/** Both surfaces return to the canvas: a preset replaces what either could name. */
function clearSelection() {
	selectedTarget.value = { type: 'canvas' };
	compositorTarget.value = { type: 'canvas' };
}

/**
 * The single write funnel for the shared item tree.
 *
 * It writes the whole layout rather than the composition alone, because the mode
 * config's merge is a shallow spread: sending `{ layout: { composition } }` would
 * replace the Frame and the legacy items with nothing.
 */
function updateComposition(composition: BroadcastGraphicConfig) {
	updateConfig({ layout: { ...config.value.layout, composition } });
}
</script>

<template>
	<div class="space-y-6">
		<section class="rounded-lg border border-default/70 bg-default p-3">
			<div class="grid gap-3 xl:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1.2fr)_minmax(16rem,0.85fr)_auto] xl:items-end">
				<UFormField label="Feature Match Slot" size="sm">
					<USelect
						:model-value="config.featureMatchId ?? undefined"
						:items="matchOptions"
						value-key="value"
						placeholder="Select a slot..."
						class="w-full"
						@update:model-value="updateConfig({ featureMatchId: $event })"
					/>
				</UFormField>
				<UFormField label="Preset" size="sm">
					<UFieldGroup class="w-full">
						<USelect
							:model-value="config.presetId"
							:items="presetOptions"
							value-key="value"
							class="min-w-0 flex-1"
							@update:model-value="confirmPresetId = $event"
						/>
						<UButton
							size="sm"
							variant="soft"
							data-testid="reset-preset"
							@click="resetToPreset"
						>
							Reset
						</UButton>
					</UFieldGroup>
				</UFormField>
				<UFormField label="Canvas Size" size="sm">
					<UFieldGroup class="w-full">
						<UInputNumber
							:model-value="screenWidth"
							:placeholder="String(DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH)"
							:min="1"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas width"
							@update:model-value="updateCanvasDimension('width', $event)"
						/>
						<UInputNumber
							:model-value="screenHeight"
							:placeholder="String(DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT)"
							:min="1"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas height"
							@update:model-value="updateCanvasDimension('height', $event)"
						/>
					</UFieldGroup>
				</UFormField>
				<UBadge
					v-if="aspectMismatch"
					color="warning"
					variant="soft"
					icon="i-lucide-triangle-alert"
					class="justify-center xl:mb-1"
				>
					Aspect mismatch
				</UBadge>
			</div>
			<UAlert
				v-if="aspectMismatch"
				class="mt-3"
				color="warning"
				variant="soft"
				title="Preset aspect ratio mismatch"
				description="This preset was designed for 16:9. You can still use it, but geometry may need adjustment."
			/>
			<UAlert
				v-if="assetPublicationBlocked"
				data-testid="graphic-asset-publication-block"
				class="mt-3"
				:color="assetPublicationEligibility.outcome === 'missing' ? 'error' : 'warning'"
				variant="soft"
				:title="assetPublicationEligibility.outcome === 'missing'
					? 'Missing Graphic Asset Reference'
					: assetPublicationEligibility.outcome === 'unavailable'
						? 'Unavailable Graphic Asset Content'
						: 'Checking Graphic Asset References'"
				:description="assetPublicationBlockReason"
			/>
			<UButton
				v-if="assetPublicationEligibility.outcome === 'unavailable'"
				data-testid="retry-graphic-asset-publication"
				class="mt-2"
				color="warning"
				variant="soft"
				icon="i-lucide-refresh-cw"
				@click="retryAssetPublicationEligibility"
			>
				Retry Graphic Asset Content
			</UButton>
		</section>

		<div class="grid min-h-[calc(100vh-18rem)] items-start gap-4 xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(19rem,24rem)] 2xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(24rem,30rem)]">
			<section class="min-w-0 space-y-4 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<!--
					The Feature Match Layout's shared item tree, authored by the shared
					compositor behind the Feature Match Overlay Host Contract.
				-->
				<FeatureMatchOverlayCompositorTree
					:selected-target="compositorTarget"
					:layout="config.layout"
					:canvas-width="screenWidth"
					:canvas-height="screenHeight"
					writable
					@update:selected-target="selectCompositorTarget"
					@update:composition="updateComposition"
				/>

				<!--
					The Frame, Source Items, and Frame cutouts stay host-owned, and so does
					the legacy widget list until the contract ticket removes it. Both are
					reached through the editor that already knows their vocabulary.
				-->
				<FeatureMatchOverlayLayerInspector
					:selected-target="selectedTarget"
					variant="tree"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:event-id="eventId"
					@update:selected-target="selectHostTarget"
				/>
			</section>

			<section class="min-w-0 xl:sticky xl:top-4">
				<FeatureMatchOverlayPreviewOutputAside
					:event-id="eventId"
					:screen="screen"
					:config="config"
					:selected-target="selectedTarget"
					:compositor-target="compositorTarget"
					:publication-blocked="assetPublicationBlocked"
					:publication-block-reason="assetPublicationBlockReason"
					@select-target="selectHostTarget"
					@select-compositor-target="selectCompositorTarget"
				/>
			</section>

			<section class="min-w-0 space-y-4 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<FeatureMatchOverlayCompositorInspector
					v-if="compositorTarget.type !== 'canvas'"
					:layout="config.layout"
					:selected-target="compositorTarget"
					:canvas-width="screenWidth"
					:canvas-height="screenHeight"
					:event-id="eventId"
					writable
					@update:composition="updateComposition"
				/>
				<FeatureMatchOverlayLayerInspector
					v-else
					:selected-target="selectedTarget"
					variant="inspector"
					:config="config"
					:update-config="updateConfig"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:event-id="eventId"
					@update:selected-target="selectHostTarget"
				/>
			</section>
		</div>

		<UModal v-model:open="showPresetConfirm">
			<template #content>
				<div class="p-6 space-y-4">
					<h3 class="text-lg font-semibold">
						Apply preset?
					</h3>
					<p class="text-sm text-muted">
						This will overwrite Feature Match Overlay geometry and styles, while preserving the selected Feature Match Slot.
					</p>
					<div class="flex justify-end gap-2">
						<UButton variant="soft" @click="() => { confirmPresetId = null }">
							Cancel
						</UButton>
						<UButton color="primary" @click="applyPreset">
							Apply
						</UButton>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>
