<script setup lang="ts">
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchMediaGraphicItemConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { appearanceSummary, rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';
import FeatureMatchOverlayGeometryFields from './GeometryFields.vue';
import FeatureMatchOverlayOrderSection from './OrderSection.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	updateConfig: FeatureMatchOverlayConfigUpdater;
	screenWidth: number;
	screenHeight: number;
	eventId: number;
	item: FeatureMatchMediaGraphicItemConfig;
}>();

const emit = defineEmits<{ removed: [] }>();
const editor = useFeatureMatchOverlayConfigEditor({
	config: toRef(props, 'config'),
	updateConfig: props.updateConfig,
	screenWidth: toRef(props, 'screenWidth'),
	screenHeight: toRef(props, 'screenHeight'),
});
const anchorValue = computed<FeatureMatchOverlayAnchorValue>(() => props.item.anchor ?? 'top-left');
const fitOptions = [
	{ label: 'Contain', value: 'contain' },
	{ label: 'Cover', value: 'cover' },
	{ label: 'Fill', value: 'fill' },
];
const targetOptions = [
	{ label: 'Safari-compatible', value: 'safari' },
	{ label: 'Chromium', value: 'chromium' },
];

function patch(updates: Partial<FeatureMatchMediaGraphicItemConfig>) {
	editor.updateItem(props.item.id, updates);
}

function selectAsset(asset: GraphicAsset, reference: GraphicAssetReference) {
	patch({
		asset: reference,
		mediaKind: asset.kind === 'silent-video' ? 'silent-video' : 'image',
		...(asset.facts.kind === 'silent-video'
			? {
					videoCompatibility: asset.facts.targetCompatibility,
					loop: props.item.loop ?? true,
					playbackRate: props.item.playbackRate ?? 1,
				}
			: {
					videoCompatibility: undefined,
					loop: undefined,
					playbackRate: undefined,
				}),
	});
}

function removeSelf() {
	editor.removeItem(props.item.id);
	emit('removed');
}
</script>

<template>
	<div class="min-w-0">
		<FeatureMatchOverlayControlSection
			title="Details"
			default-open
			badge="Media"
			:summary="item.label"
		>
			<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
				<UFormField label="Name">
					<UInput
						:model-value="item.label"
						size="sm"
						class="w-full"
						@update:model-value="patch({ label: String($event) })"
					/>
				</UFormField>
				<ScreenSettingsToggle label="Visible" :model-value="item.visible" @update:model-value="patch({ visible: $event })" />
				<UButton
					color="error"
					variant="soft"
					icon="i-lucide-trash-2"
					aria-label="Remove layer"
					@click="removeSelf"
				/>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Bounds" :summary="rectSummary(item)" default-open>
			<FeatureMatchOverlayGeometryFields
				:rect="anchorFeatureMatchOverlayRect(item, anchorValue)"
				:screen-width="screenWidth"
				:screen-height="screenHeight"
				:anchor-value="anchorValue"
				@update-anchor="value => patch({ anchor: value as FeatureMatchOverlayAnchorValue })"
				@update="(field, value, unit) => editor.updateItemRectFromAnchor(item.id, field, value, unit)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Content" :summary="item.asset ? item.mediaKind : 'Choose an asset'" default-open>
			<div class="grid gap-3 md:grid-cols-2">
				<UFormField label="Screen output target" class="md:col-span-2">
					<USelect
						:model-value="item.videoTarget ?? 'safari'"
						:items="targetOptions"
						value-key="value"
						class="w-full"
						@update:model-value="patch({ videoTarget: $event as FeatureMatchMediaGraphicItemConfig['videoTarget'] })"
					/>
				</UFormField>
				<UFormField label="Media" class="md:col-span-2">
					<GraphicsAssetFocusPicker
						:model-value="item.asset"
						:event-id="eventId"
						field-label="Media Graphic Item"
						:asset-kind="['image', 'silent-video']"
						:video-target="item.videoTarget ?? 'safari'"
						@update:model-value="patch({ asset: $event })"
						@select="selectAsset"
					/>
				</UFormField>
				<UFormField label="Fit">
					<USelect
						:model-value="item.fit"
						:items="fitOptions"
						value-key="value"
						@update:model-value="patch({ fit: $event as FeatureMatchMediaGraphicItemConfig['fit'] })"
					/>
				</UFormField>
				<UFormField label="Opacity">
					<UInputNumber
						:model-value="item.opacity"
						:min="0"
						:max="1"
						:step="0.05"
						@update:model-value="patch({ opacity: Number($event) })"
					/>
				</UFormField>
				<UFormField label="Radius">
					<UInputNumber :model-value="item.borderRadius" :min="0" @update:model-value="patch({ borderRadius: Number($event) })" />
				</UFormField>
				<template v-if="item.mediaKind === 'silent-video'">
					<UFormField label="Playback rate">
						<UInputNumber
							:model-value="item.playbackRate ?? 1"
							:min="0.25"
							:max="4"
							:step="0.05"
							@update:model-value="patch({ playbackRate: Number($event) })"
						/>
					</UFormField>
					<ScreenSettingsToggle label="Loop" :model-value="item.loop ?? true" @update:model-value="patch({ loop: $event })" />
				</template>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Appearance" :summary="appearanceSummary(item.surfaceStyle)">
			<FeatureMatchOverlayBoxStyleFields
				:box-style="item.surfaceStyle"
				include-border
				include-padding
				include-overflow
				@update="updates => editor.updateItemSurfaceStyle(item.id, updates)"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayOrderSection
			:z-index="item.zIndex ?? 0"
			@send-to-back="editor.sendItemToBack(item.id)"
			@move="delta => editor.moveItemOrder(item.id, delta)"
			@bring-to-front="editor.bringItemToFront(item.id)"
			@update-z-index="zIndex => editor.setItemOrder(item.id, zIndex)"
		/>
	</div>
</template>
