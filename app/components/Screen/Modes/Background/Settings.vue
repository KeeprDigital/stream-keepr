<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer, BackgroundLayerType, ScreenMediaBackgroundFit, ScreenMediaSource } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { BACKGROUND_LAYER_TYPE_VALUES } from '~~/shared/types/screenConfig';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'background',
);

defineExpose({ resetConfig, saving });

const layers = computed<BackgroundLayer[]>(() => config.value.layers ?? []);
const hasAnimationLayer = computed(() => layers.value.some(layer => layer.type === 'animation'));

const LAYER_TYPE_LABELS: Record<BackgroundLayerType, string> = {
	color: 'Colour',
	gradient: 'Gradient',
	image: 'Image',
	video: 'Video',
	animation: 'Animation',
};

const FIT_OPTIONS = [
	{ label: 'Cover', value: 'cover' },
	{ label: 'Contain', value: 'contain' },
	{ label: 'Fill', value: 'fill' },
] satisfies Array<{ label: string; value: ScreenMediaBackgroundFit }>;

const SOURCE_KIND_OPTIONS = [
	{ label: 'Asset library', value: 'asset' },
	{ label: 'Remote URL', value: 'url' },
];

const addLayerType = ref<BackgroundLayerType>('color');

/** One animation layer per Screen — the schema's rule, refused here before the write. */
const addLayerOptions = computed(() => BACKGROUND_LAYER_TYPE_VALUES.map(type => ({
	label: LAYER_TYPE_LABELS[type],
	value: type,
	disabled: type === 'animation' && hasAnimationLayer.value,
})));

function writeLayers(nextLayers: BackgroundLayer[]) {
	updateConfig({ layers: nextLayers });
}

/** A new layer's starting values, per type. A new animation layer starts on fog. */
function newLayer(type: BackgroundLayerType): BackgroundLayer {
	const base = { id: crypto.randomUUID(), enabled: true, opacity: 1 };
	switch (type) {
		case 'color':
			return { ...base, type, color: '#000000' };
		case 'gradient':
			return { ...base, type, gradient: 'linear-gradient(180deg, #0f172a 0%, #020617 100%)' };
		case 'image':
			return { ...base, type, source: { kind: 'url', url: '' }, fit: 'cover' };
		case 'video':
			return { ...base, type, source: { kind: 'url', url: '' }, fit: 'cover', playbackRate: 1, loop: true };
		case 'animation':
			return { ...base, type, animation: { effect: 'fog' } };
	}
}

function addLayer() {
	if (addLayerType.value === 'animation' && hasAnimationLayer.value)
		return;
	writeLayers([...layers.value, newLayer(addLayerType.value)]);
}

function removeLayer(id: string) {
	writeLayers(layers.value.filter(layer => layer.id !== id));
}

function moveLayer(id: string, direction: -1 | 1) {
	const current = [...layers.value];
	const index = current.findIndex(layer => layer.id === id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= current.length)
		return;
	const [moved] = current.splice(index, 1);
	current.splice(target, 0, moved!);
	writeLayers(current);
}

function patchLayer(id: string, updates: Partial<BackgroundLayer>) {
	writeLayers(layers.value.map(layer =>
		layer.id === id ? { ...layer, ...updates } as BackgroundLayer : layer,
	));
}

function updateSource(layer: BackgroundLayer & { type: 'image' | 'video' }, source: ScreenMediaSource) {
	patchLayer(layer.id, { source });
}

/**
 * Which source kind each media layer's editor is showing, held as UI state
 * rather than written through: an asset source without a picked revision is not
 * a storable value (the schema requires the ids), so switching to the library
 * only changes what the row offers until an asset is actually chosen. Switching
 * to URL starts over — a reference and a URL are different choices, not two
 * spellings of one.
 */
const sourceKindDrafts = ref<Record<string, 'asset' | 'url'>>({});

function sourceKind(layer: BackgroundLayer & { type: 'image' | 'video' }): 'asset' | 'url' {
	return sourceKindDrafts.value[layer.id] ?? layer.source.kind;
}

function selectSourceKind(layer: BackgroundLayer & { type: 'image' | 'video' }, kind: 'asset' | 'url') {
	sourceKindDrafts.value = { ...sourceKindDrafts.value, [layer.id]: kind };
	if (kind === 'url' && layer.source.kind !== 'url')
		updateSource(layer, { kind: 'url', url: '' });
}

function selectAssetSource(
	layer: BackgroundLayer & { type: 'image' | 'video' },
	asset: GraphicAsset,
	reference: GraphicAssetReference,
) {
	updateSource(layer, {
		kind: 'asset',
		assetId: reference.assetId,
		revisionId: reference.revisionId,
		...(asset.facts.kind === 'silent-video'
			? { videoCompatibility: asset.facts.targetCompatibility }
			: {}),
	});
}

function clearAssetSource(layer: BackgroundLayer & { type: 'image' | 'video' }, reference: GraphicAssetReference | undefined) {
	if (reference === undefined)
		updateSource(layer, { kind: 'url', url: '' });
	else
		updateSource(layer, { kind: 'asset', assetId: reference.assetId, revisionId: reference.revisionId });
}

function sourceReference(layer: BackgroundLayer & { type: 'image' | 'video' }): GraphicAssetReference | undefined {
	return layer.source.kind === 'asset' && layer.source.assetId
		? { assetId: layer.source.assetId, revisionId: layer.source.revisionId }
		: undefined;
}

function updateAnimationSelection(id: string, selection: AnimationEffectSelection) {
	patchLayer(id, { animation: selection });
}
</script>

<template>
	<ScreenSettingsCard title="Background Layers">
		<p class="text-xs text-muted">
			Layers paint in order: the first layer is the bottom of the stack.
		</p>

		<div class="space-y-3">
			<div
				v-for="(layer, index) in layers"
				:key="layer.id"
				data-testid="background-layer-row"
				:data-layer-id="layer.id"
				class="space-y-3 rounded-md border border-default/60 p-3"
			>
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium">{{ LAYER_TYPE_LABELS[layer.type] }}</span>
					<span class="grow" />
					<UButton
						data-testid="move-layer-back"
						icon="i-lucide-arrow-up"
						variant="ghost"
						size="xs"
						:disabled="index === 0"
						aria-label="Move toward the bottom of the stack"
						@click="moveLayer(layer.id, -1)"
					/>
					<UButton
						data-testid="move-layer-forward"
						icon="i-lucide-arrow-down"
						variant="ghost"
						size="xs"
						:disabled="index === layers.length - 1"
						aria-label="Move toward the top of the stack"
						@click="moveLayer(layer.id, 1)"
					/>
					<UButton
						data-testid="remove-layer"
						icon="i-lucide-trash-2"
						variant="ghost"
						color="error"
						size="xs"
						aria-label="Remove layer"
						@click="removeLayer(layer.id)"
					/>
				</div>

				<div class="grid gap-3 sm:grid-cols-2 sm:items-end">
					<ScreenSettingsToggle
						label="Enabled"
						:model-value="layer.enabled"
						@update:model-value="patchLayer(layer.id, { enabled: $event })"
					/>
					<UFormField label="Opacity" data-testid="layer-opacity">
						<UInputNumber
							:model-value="layer.opacity"
							:step="0.05"
							:min="0"
							:max="1"
							size="sm"
							class="w-full"
							@update:model-value="patchLayer(layer.id, { opacity: Number($event) })"
						/>
					</UFormField>
				</div>

				<UFormField v-if="layer.type === 'color'" label="Colour">
					<UIColorPicker
						:model-value="layer.color"
						placeholder="#000000"
						@update:model-value="patchLayer(layer.id, { color: $event || '#000000' })"
					/>
				</UFormField>

				<UFormField v-if="layer.type === 'gradient'" label="CSS gradient">
					<UInput
						:model-value="layer.gradient"
						placeholder="linear-gradient(180deg, #0f172a 0%, #020617 100%)"
						size="sm"
						class="w-full"
						@update:model-value="patchLayer(layer.id, { gradient: String($event) })"
					/>
				</UFormField>

				<template v-if="layer.type === 'image' || layer.type === 'video'">
					<div class="grid gap-3 sm:grid-cols-2">
						<UFormField label="Source">
							<USelect
								:model-value="sourceKind(layer)"
								:items="SOURCE_KIND_OPTIONS"
								value-key="value"
								size="sm"
								class="w-full"
								@update:model-value="selectSourceKind(layer, $event as 'asset' | 'url')"
							/>
						</UFormField>
						<UFormField label="Fit">
							<USelect
								:model-value="layer.fit"
								:items="FIT_OPTIONS"
								value-key="value"
								size="sm"
								class="w-full"
								@update:model-value="patchLayer(layer.id, { fit: $event as ScreenMediaBackgroundFit })"
							/>
						</UFormField>
					</div>

					<UFormField v-if="sourceKind(layer) === 'url'" label="Media URL">
						<UInput
							:model-value="layer.source.kind === 'url' ? layer.source.url : ''"
							placeholder="https://example.com/background.mp4"
							size="sm"
							class="w-full"
							@update:model-value="updateSource(layer, { kind: 'url', url: String($event) })"
						/>
					</UFormField>
					<UFormField v-else :label="layer.type === 'video' ? 'Video asset' : 'Image asset'">
						<GraphicsAssetFocusPicker
							:model-value="sourceReference(layer)"
							:event-id="eventId"
							:field-label="layer.type === 'video' ? 'Video asset' : 'Image asset'"
							:asset-kind="layer.type === 'video' ? 'silent-video' : 'image'"
							video-target="chromium"
							@select="(asset, reference) => selectAssetSource(layer, asset, reference)"
							@update:model-value="clearAssetSource(layer, $event)"
						/>
					</UFormField>

					<div v-if="layer.type === 'video'" class="grid gap-3 sm:grid-cols-2 sm:items-end">
						<UFormField label="Playback rate">
							<UInputNumber
								:model-value="layer.playbackRate"
								:step="0.05"
								:min="0.1"
								:max="16"
								size="sm"
								class="w-full"
								@update:model-value="patchLayer(layer.id, { playbackRate: Number($event) })"
							/>
						</UFormField>
						<ScreenSettingsToggle
							label="Loop"
							:model-value="layer.loop"
							@update:model-value="patchLayer(layer.id, { loop: $event })"
						/>
					</div>
				</template>

				<ScreenAnimationEffectFields
					v-if="layer.type === 'animation'"
					:selection="layer.animation"
					@update:selection="updateAnimationSelection(layer.id, $event)"
				/>
			</div>
		</div>

		<div class="flex items-end gap-2">
			<UFormField label="Add layer" data-testid="add-layer-type" class="grow">
				<USelect
					:model-value="addLayerType"
					:items="addLayerOptions"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="addLayerType = $event as BackgroundLayerType"
				/>
			</UFormField>
			<UButton
				data-testid="add-layer"
				label="Add"
				icon="i-lucide-plus"
				size="sm"
				:disabled="addLayerType === 'animation' && hasAnimationLayer"
				@click="addLayer"
			/>
		</div>
	</ScreenSettingsCard>
</template>
