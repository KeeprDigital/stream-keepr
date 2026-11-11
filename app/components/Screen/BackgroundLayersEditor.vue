<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { GraphicLinearGradientFill } from '~~/shared/types/graphics';
import type { BackgroundLayer, BackgroundLayerType, ScreenMediaSource } from '~~/shared/types/screenConfig';
import type { MediaFieldsPatch } from '~/utils/mediaFields';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
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
 * layer's colour and the `update` that writes a new one. A gradient layer is
 * edited with the one Graphic Fill control, held to the gradient kind; a CSS
 * gradient string stored before the layer held a fill is shown, and replaced.
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

/** What a new gradient layer starts on, and what replaces a stored CSS gradient string. */
function startingGradient(): GraphicLinearGradientFill {
	return {
		type: 'linear-gradient',
		angle: 180,
		stops: [
			{ color: '#0f172a', position: 0, opacity: 1 },
			{ color: '#020617', position: 1, opacity: 1 },
		],
	};
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
			return {
				...base,
				type,
				gradient: startingGradient(),
			};
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

/** The fill control never changes kind here, so the edited fill is still a gradient. */
function editGradient(id: string, gradient: GraphicLinearGradientFill, edit: GraphicFillEdit) {
	const next = applyGraphicFillEdit(gradient, edit);
	if (next.type === 'linear-gradient')
		patchLayer(id, { gradient: next });
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
		<ScreenSettingsHint>
			Layers paint in order: the first layer is the bottom of the stack.
		</ScreenSettingsHint>

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
					<GraphicsOpacityField
						label="Opacity"
						:model-value="layer.opacity"
						data-testid="layer-opacity"
						@update:model-value="patchLayer(layer.id, { opacity: $event ?? 1 })"
					/>
				</div>

				<ScreenSettingsField v-if="layer.type === 'color'" label="Colour" stacked>
					<slot name="color" :value="layer.color" :update="(color: string) => patchLayer(layer.id, { color })">
						<UIColorPicker
							:model-value="layer.color"
							placeholder="#000000"
							@update:model-value="color => color && patchLayer(layer.id, { color })"
						/>
					</slot>
				</ScreenSettingsField>

				<template v-if="layer.type === 'gradient'">
					<div v-if="typeof layer.gradient === 'string'" class="space-y-2">
						<ScreenSettingsHint>
							This layer holds a CSS gradient from an earlier version. It paints as stored until you replace it.
						</ScreenSettingsHint>
						<code data-testid="stored-css-gradient" class="block break-all text-xs">{{ layer.gradient }}</code>
						<UButton
							data-testid="replace-stored-gradient"
							label="Replace with a gradient"
							icon="i-lucide-replace"
							variant="soft"
							size="xs"
							@click="patchLayer(layer.id, { gradient: startingGradient() })"
						/>
					</div>
					<GraphicsFillFields
						v-else
						:fill="layer.gradient"
						fixed-kind
						aria-label-prefix="Gradient"
						test-id-prefix="background-gradient"
						@edit="editGradient(layer.id, layer.gradient, $event)"
					/>
				</template>

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
			<ScreenSettingsField
				label="Add layer"
				data-testid="add-layer-type"
				class="grow"
				stacked
			>
				<USelect
					:model-value="addLayerType"
					:items="addLayerOptions"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="addLayerType = $event as BackgroundLayerType"
				/>
			</ScreenSettingsField>
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
