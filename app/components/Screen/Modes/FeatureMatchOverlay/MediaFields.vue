<script setup lang="ts">
import type { ShapeGeometry, ShapeGeometryCorner } from '~~/shared/types/graphicItem';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchMediaGraphicItemContentConfig } from '~~/shared/types/screenConfig';
import FeatureMatchOverlayControlSection from './ControlSection.vue';

const props = defineProps<{
	media: FeatureMatchMediaGraphicItemContentConfig;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchMediaGraphicItemContentConfig>];
}>();

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

const clipGeometry = computed(() => props.media.clipGeometry ?? defaultClipGeometry());
const focalPosition = computed(() => props.media.focalPosition ?? { horizontal: 0.5, vertical: 0.5 });

function patch(updates: Partial<FeatureMatchMediaGraphicItemContentConfig>) {
	emit('update', updates);
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
					loop: props.media.loop ?? true,
					playbackRate: props.media.playbackRate ?? 1,
				}
			: {
					videoCompatibility: undefined,
					loop: undefined,
					playbackRate: undefined,
				}),
	});
}
</script>

<template>
	<FeatureMatchOverlayControlSection title="Content" :summary="media.asset ? media.mediaKind : 'Choose an asset'" default-open>
		<div class="grid gap-3 md:grid-cols-2">
			<UFormField label="Video target" class="md:col-span-2">
				<USelect
					:model-value="media.videoTarget ?? 'safari'"
					:items="targetOptions"
					value-key="value"
					class="w-full"
					@update:model-value="patch({ videoTarget: $event as FeatureMatchMediaGraphicItemContentConfig['videoTarget'] })"
				/>
			</UFormField>
			<UFormField label="Media" class="md:col-span-2">
				<GraphicsAssetFocusPicker
					:model-value="media.asset"
					:event-id="eventId"
					field-label="Media Graphic Item"
					:asset-kind="['image', 'silent-video']"
					:video-target="media.videoTarget ?? 'safari'"
					@update:model-value="patch({ asset: $event })"
					@select="selectAsset"
				/>
			</UFormField>
			<UFormField label="Fit">
				<USelect
					:model-value="media.fit"
					:items="fitOptions"
					value-key="value"
					@update:model-value="patch({ fit: $event as FeatureMatchMediaGraphicItemContentConfig['fit'] })"
				/>
			</UFormField>
			<UFormField label="Opacity">
				<UInputNumber
					:model-value="media.opacity"
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
			<template v-if="media.mediaKind === 'silent-video'">
				<UFormField label="Playback rate">
					<UInputNumber
						:model-value="media.playbackRate ?? 1"
						:min="0.25"
						:max="4"
						:step="0.05"
						@update:model-value="patch({ playbackRate: Number($event) })"
					/>
				</UFormField>
				<ScreenSettingsToggle label="Loop" :model-value="media.loop ?? true" @update:model-value="patch({ loop: $event })" />
			</template>
		</div>
	</FeatureMatchOverlayControlSection>

	<FeatureMatchOverlayControlSection title="Shape Geometry" :summary="media.clipGeometry ? 'Custom clipping' : 'No clipping'">
		<div class="space-y-3">
			<div class="flex justify-end">
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-rotate-ccw"
					:disabled="!media.clipGeometry"
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
</template>
