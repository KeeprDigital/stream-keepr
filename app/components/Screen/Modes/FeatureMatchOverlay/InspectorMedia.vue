<script setup lang="ts">
import type { ShapeGeometry, ShapeGeometryCorner } from '~~/shared/types/graphicItem';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchMediaGraphicItemConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayConfigUpdater } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import type { FeatureMatchOverlayAnchorValue } from '~/utils/featureMatchOverlayGeometry';
import { useFeatureMatchOverlayConfigEditor } from '~/composables/screen/useFeatureMatchOverlayConfigEditor';
import { rectSummary } from '~/modules/feature-match-overlay/layerSummaries';
import { anchorFeatureMatchOverlayRect } from '~/utils/featureMatchOverlayGeometry';
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
const cornerKindOptions = [
	{ label: 'Square', value: 'square' },
	{ label: 'Rounded', value: 'rounded' },
	{ label: 'Cut', value: 'cut' },
];
const cornerFields = [
	{ key: 'topLeft', label: 'Top left' },
	{ key: 'topRight', label: 'Top right' },
	{ key: 'bottomRight', label: 'Bottom right' },
	{ key: 'bottomLeft', label: 'Bottom left' },
] as const;
function defaultClipGeometry(): ShapeGeometry {
	return {
		topLeft: { kind: 'square' },
		topRight: { kind: 'square' },
		bottomRight: { kind: 'square' },
		bottomLeft: { kind: 'square' },
	};
}
const clipGeometry = computed(() => props.item.clipGeometry ?? defaultClipGeometry());
const focalPosition = computed(() => props.item.focalPosition ?? { horizontal: 0.5, vertical: 0.5 });

function patch(updates: Partial<FeatureMatchMediaGraphicItemConfig>) {
	editor.updateItem(props.item.id, updates);
}

function patchClipGeometry(updates: Partial<ShapeGeometry>) {
	patch({ clipGeometry: { ...clipGeometry.value, ...updates } });
}

function patchCorner(field: typeof cornerFields[number]['key'], kind: ShapeGeometryCorner['kind']) {
	const current = clipGeometry.value[field];
	patchClipGeometry({
		[field]: kind === 'square'
			? { kind }
			: { kind, size: current.kind === 'square' ? 24 : current.size },
	});
}

function patchCornerSize(field: typeof cornerFields[number]['key'], size: number) {
	const current = clipGeometry.value[field];
	if (current.kind !== 'square')
		patchClipGeometry({ [field]: { ...current, size } });
}

function cornerSize(field: typeof cornerFields[number]['key']) {
	const corner = clipGeometry.value[field];
	return corner.kind === 'square' ? 0 : corner.size;
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
				<UFormField label="Horizontal focal position">
					<UInputNumber
						:model-value="focalPosition.horizontal"
						:min="0"
						:max="1"
						:step="0.05"
						@update:model-value="patch({ focalPosition: { ...focalPosition, horizontal: Number($event) } })"
					/>
				</UFormField>
				<UFormField label="Vertical focal position">
					<UInputNumber
						:model-value="focalPosition.vertical"
						:min="0"
						:max="1"
						:step="0.05"
						@update:model-value="patch({ focalPosition: { ...focalPosition, vertical: Number($event) } })"
					/>
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

		<FeatureMatchOverlayControlSection title="Shape Geometry" :summary="item.clipGeometry ? 'Custom clipping' : 'No clipping'">
			<div class="space-y-3">
				<div class="flex justify-end">
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-rotate-ccw"
						:disabled="!item.clipGeometry"
						@click="patch({ clipGeometry: undefined })"
					>
						Clear Shape
					</UButton>
				</div>
				<div class="grid gap-3 md:grid-cols-2">
					<UFormField v-for="corner in cornerFields" :key="corner.key" :label="corner.label">
						<div class="grid grid-cols-2 gap-2">
							<USelect
								:model-value="clipGeometry[corner.key].kind"
								:items="cornerKindOptions"
								value-key="value"
								@update:model-value="patchCorner(corner.key, $event as ShapeGeometryCorner['kind'])"
							/>
							<UInputNumber
								v-if="clipGeometry[corner.key].kind !== 'square'"
								:model-value="cornerSize(corner.key)"
								:min="0"
								@update:model-value="patchCornerSize(corner.key, Number($event))"
							/>
						</div>
					</UFormField>
					<UFormField label="Left edge slant">
						<UInputNumber
							:model-value="clipGeometry.leftEdgeSlant ?? 0"
							:min="0"
							@update:model-value="patchClipGeometry({ leftEdgeSlant: Number($event) })"
						/>
					</UFormField>
					<UFormField label="Right edge slant">
						<UInputNumber
							:model-value="clipGeometry.rightEdgeSlant ?? 0"
							:min="0"
							@update:model-value="patchClipGeometry({ rightEdgeSlant: Number($event) })"
						/>
					</UFormField>
				</div>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayOrderSection
			@send-to-back="editor.sendItemToBack(item.id)"
			@move="delta => editor.moveItemOrder(item.id, delta)"
			@bring-to-front="editor.bringItemToFront(item.id)"
		/>
	</div>
</template>
