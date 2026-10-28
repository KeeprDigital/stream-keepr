<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { BackgroundLayer, BackgroundLayerType, ScreenMediaSource } from '~~/shared/types/screenConfig';
import type { MediaFieldsPatch } from '~/utils/mediaFields';
import { BACKGROUND_LAYER_TYPE_VALUES } from '~~/shared/types/screenConfig';
import { randomUuid } from '~~/shared/utils/uuid';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';

/**
 * Edits one ordered Background Layer stack. The Background Screen's settings
 * edit its `layers` through this; every plain overlay mode's settings edit
 * that mode's own `backgroundLayers` through the same editor. The owner wires
 * `update:layers` to its own configuration write — the editor never saves.
 * Without an `eventId`, as in the Theme editor, media layers take a Remote
 * Media URL only. Its `color` slot replaces a colour layer's picker, given the
 * layer's colour and the `update` that writes a new one.
 */
const props = defineProps<{
	layers: BackgroundLayer[];
	eventId?: number;
}>();

const emit = defineEmits<{
	'update:layers': [layers: BackgroundLayer[]];
}>();

const hasAnimationLayer = computed(() => props.layers.some(layer => layer.type === 'animation'));

const LAYER_TYPE_LABELS: Record<BackgroundLayerType, string> = {
	color: 'Colour',
	gradient: 'Gradient',
	image: 'Image',
	video: 'Video',
	animation: 'Animation',
};

const addLayerType = ref<BackgroundLayerType>('color');

/** One animation layer per stack — the schema's rule, refused here before the write. */
const addLayerOptions = computed(() => BACKGROUND_LAYER_TYPE_VALUES.map(type => ({
	label: LAYER_TYPE_LABELS[type],
	value: type,
	disabled: type === 'animation' && hasAnimationLayer.value,
})));

function writeLayers(nextLayers: BackgroundLayer[]) {
	emit('update:layers', nextLayers);
}

/** A new layer's starting values, per type. A new animation layer starts on fog. */
function newLayer(type: BackgroundLayerType): BackgroundLayer {
	const base = {
		id: randomUuid(),
		enabled: true,
		opacity: 1,
	};
	switch (type) {
		case 'color':
			return { ...base, type, color: '#000000' };
		case 'gradient':
			return { ...base, type, gradient: 'linear-gradient(180deg, #0f172a 0%, #020617 100%)' };
		case 'image':
			return {
				...base,
				type,
				source: { kind: 'url', url: '' },
				fit: 'cover',
			};
		case 'video':
			return {
				...base,
				type,
				source: { kind: 'url', url: '' },
				fit: 'cover',
				playbackRate: 1,
				loop: true,
			};
		case 'animation':
			return {
				...base,
				type,
				animation: { effect: 'fog' },
			};
	}
}

function addLayer() {
	if (addLayerType.value === 'animation' && hasAnimationLayer.value)
		return;
	writeLayers([
		...props.layers,
		newLayer(addLayerType.value),
	]);
}

function removeLayer(id: string) {
	writeLayers(props.layers.filter(layer => layer.id !== id));
}

function moveLayer(id: string, direction: -1 | 1) {
	const current = [...props.layers];
	const index = current.findIndex(layer => layer.id === id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= current.length)
		return;
	const [moved] = current.splice(index, 1);
	current.splice(target, 0, moved!);
	writeLayers(current);
}

function patchLayer(id: string, updates: Partial<BackgroundLayer>) {
	writeLayers(props.layers.map(layer =>
		layer.id === id
			? {
					...layer,
					...updates,
				} as BackgroundLayer
			: layer,
	));
}

/** A media layer's fit and playback; its opacity is the layer's own, edited above. */
function patchLayerMedia(id: string, patch: MediaFieldsPatch) {
	patchLayer(id, resolveMediaFieldsPatch(patch) as Partial<BackgroundLayer>);
}

/** A layer's source is required, so a cleared choice stores an unset URL. */
function updateSource(id: string, source: ScreenMediaSource | null) {
	patchLayer(id, { source: source ?? { kind: 'url', url: '' } });
}

function updateAnimationSelection(id: string, selection: AnimationEffectSelection) {
	patchLayer(id, { animation: selection });
}
</script>

<template>
	<div class="space-y-4">
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
						<UIOpacityInput
							:model-value="layer.opacity"
							size="sm"
							class="w-full"
							@update:model-value="patchLayer(layer.id, { opacity: $event ?? 1 })"
						/>
					</UFormField>
				</div>

				<UFormField v-if="layer.type === 'color'" label="Colour">
					<slot name="color" :value="layer.color" :update="(color: string) => patchLayer(layer.id, { color })">
						<UIColorPicker
							:model-value="layer.color"
							placeholder="#000000"
							@update:model-value="patchLayer(layer.id, { color: $event || '#000000' })"
						/>
					</slot>
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
					<ScreenMediaSourceField
						:model-value="layer.source"
						:event-id="eventId"
						:asset-kind="layer.type === 'video' ? 'silent-video' : 'image'"
						:label="layer.type === 'video' ? 'Video asset' : 'Image asset'"
						@update:model-value="updateSource(layer.id, $event)"
					/>

					<GraphicsMediaFields
						:media="layer"
						:playback="layer.type === 'video'"
						@update="patchLayerMedia(layer.id, $event)"
					/>
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
	</div>
</template>
