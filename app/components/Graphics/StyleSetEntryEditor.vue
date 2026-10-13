<script setup lang="ts">
import type { GraphicAnimationChannelKey, GraphicAnimationChannels, ShapeGeometryPresetId, ShapeGeometrySize } from '~~/shared/modules/graphics';
import type { AnimationRecipeGraphicStyleEntryValue, GraphicStyleSetEntry, SurfaceStyleGraphicStyleEntryValue } from '~~/shared/types/graphicStyleSet';
import type { BorderGlowEdit } from '~/types/borderGlow';
import { getGraphicItemDefinition, getShapeGeometryPreset, mergeGraphicAnimationRecipeChannel } from '~~/shared/modules/graphics';
import { MEDIA_GRAPHIC_ITEM_FIT_VALUES } from '~~/shared/types/graphicItem';
import {
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
} from '~~/shared/types/graphics';

/**
 * The value controls for one Graphic Style Set entry.
 *
 * Every colour is a *picker of palette entries* rather than a colour input, and that
 * is the whole point of the kind: a preset that stored a colour would make a brand
 * change a find-and-replace across every preset that happened to use it. Only a
 * palette entry itself has a colour input.
 *
 * The bounds match the property each preset produces, because a preset outside the
 * document's bounds would publish cleanly and then make every template referencing it
 * unwritable.
 */
const props = defineProps<{
	entry: GraphicStyleSetEntry;
	/** Every entry in the draft, so a reference picker can offer the right kinds. */
	entries: readonly GraphicStyleSetEntry[];
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: GraphicStyleSetEntry['value']] }>();

const disabled = computed(() => props.writable !== true);

const paletteOptions = computed(() => props.entries
	.filter(entry => entry.kind === 'palette')
	.map(entry => ({ label: entry.name, value: entry.id })));

const fillOptions = computed(() => props.entries
	.filter(entry => entry.kind === 'fill')
	.map(entry => ({ label: entry.name, value: entry.id })));

const geometryOptions = computed(() => props.entries
	.filter(entry => entry.kind === 'shape-geometry')
	.map(entry => ({ label: entry.name, value: entry.id })));

const FIT_OPTIONS = MEDIA_GRAPHIC_ITEM_FIT_VALUES.map(value => ({ label: value, value }));

/** Merge into the entry's value, so a single-field edit never drops its siblings. */
function patch(fields: Record<string, unknown>) {
	emit('update:value', { ...(props.entry.value as object), ...fields } as GraphicStyleSetEntry['value']);
}

/** One channel of a Graphic Animation Recipe entry, through the compositor's own merge. */
function patchRecipeChannel<K extends GraphicAnimationChannelKey>(channel: K, fields: Partial<GraphicAnimationChannels[K]> | null) {
	const recipe = props.entry.value as AnimationRecipeGraphicStyleEntryValue;
	emit('update:value', mergeGraphicAnimationRecipeChannel(recipe, channel, fields));
}

/**
 * A Graphic Surface Style preset's outline and glow name a palette entry where an
 * item's own would hold a colour; switching one on starts it from the first palette
 * entry.
 */
function editSurfaceBorderGlow(edit: BorderGlowEdit) {
	if (edit.kind === 'border-side')
		return;
	const value = props.entry.value as SurfaceStyleGraphicStyleEntryValue;
	const firstPaletteEntryId = paletteOptions.value[0]?.value ?? '';
	const { color, ...fields } = edit.patch ?? {};
	const colorEntry = color === undefined ? {} : { colorEntryId: color };
	if (edit.kind === 'border') {
		patch({ outline: edit.patch ? { ...(value.outline ?? { colorEntryId: firstPaletteEntryId, width: 2 }), ...fields, ...colorEntry } : undefined });
		return;
	}
	patch({ glow: edit.patch ? { ...(value.glow ?? { colorEntryId: firstPaletteEntryId, size: 8, opacity: 0.5 }), ...fields, ...colorEntry } : undefined });
}

/**
 * The bounds a Shape Geometry preset is initialised against. A Style Set entry has
 * no bounds of its own, so it takes a new Shape Graphic Item's on a 1080p canvas.
 */
const SHAPE_GEOMETRY_PRESET_BOUNDS: ShapeGeometrySize = (() => {
	const { width, height } = getGraphicItemDefinition('shape')
		.createDefault({ id: 'shape', label: 'Shape', canvasWidth: 1920, canvasHeight: 1080 });
	return { width, height };
})();

function applyShapeGeometryPreset(presetId: ShapeGeometryPresetId) {
	emit('update:value', getShapeGeometryPreset(presetId).apply(SHAPE_GEOMETRY_PRESET_BOUNDS).geometry);
}
</script>

<template>
	<div class="space-y-2" :data-testid="`style-entry-value-${entry.kind}`">
		<template v-if="entry.kind === 'palette'">
			<UFormField label="Colour" size="xs">
				<UIColorPicker
					:model-value="entry.value.color"
					hex-only
					size="xs"
					:disabled="disabled"
					data-testid="style-entry-palette-color"
					@update:model-value="patch({ color: String($event) })"
				/>
			</UFormField>
		</template>

		<template v-else-if="entry.kind === 'typography'">
			<GraphicsTypographyFields
				:typography="entry.value"
				:disabled="disabled"
				size="xs"
				test-id-prefix="style-entry-typography"
				@update="patch"
			>
				<template #font>
					<GraphicsCompositorFontSelectionField
						application-only
						:font="entry.value.font"
						:disabled="disabled"
						size="xs"
						test-id-prefix="style-entry-typography"
						@application="patch({ font: { kind: 'application', fontId: $event } })"
					/>
				</template>
				<template #color>
					<UFormField
						label="Colour"
						size="xs"
						class="col-span-2"
						help="A palette entry, so a brand change reaches every preset that links to it."
					>
						<USelect
							:model-value="entry.value.colorEntryId"
							:items="paletteOptions"
							value-key="value"
							size="xs"
							class="w-full"
							:disabled="disabled"
							data-testid="style-entry-typography-color"
							@update:model-value="patch({ colorEntryId: $event })"
						/>
					</UFormField>
				</template>
			</GraphicsTypographyFields>
		</template>

		<template v-else-if="entry.kind === 'fill'">
			<UFormField label="Kind" size="xs">
				<USelect
					:model-value="entry.value.type"
					:items="[{ label: 'Solid', value: 'solid' }, { label: 'Linear gradient', value: 'linear-gradient' }]"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					data-testid="style-entry-fill-kind"
					@update:model-value="$event === 'solid'
						? emit('update:value', { type: 'solid', colorEntryId: paletteOptions[0]?.value ?? '' })
						: emit('update:value', {
							type: 'linear-gradient',
							angle: 90,
							stops: [
								{ colorEntryId: paletteOptions[0]?.value ?? '', position: 0, opacity: 1 },
								{ colorEntryId: paletteOptions[0]?.value ?? '', position: 1, opacity: 1 },
							],
						})"
				/>
			</UFormField>

			<UFormField v-if="entry.value.type === 'solid'" label="Colour" size="xs">
				<USelect
					:model-value="entry.value.colorEntryId"
					:items="paletteOptions"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					data-testid="style-entry-fill-color"
					@update:model-value="patch({ colorEntryId: $event })"
				/>
			</UFormField>

			<template v-else>
				<UFormField label="Angle" size="xs">
					<UInputNumber
						:model-value="entry.value.angle"
						:min="-360"
						:max="360"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ angle: $event ?? 0 })"
					/>
				</UFormField>
				<div
					v-for="(stop, index) in entry.value.stops"
					:key="index"
					class="grid grid-cols-3 gap-2"
				>
					<UFormField :label="`Stop ${index + 1}`" size="xs">
						<USelect
							:model-value="stop.colorEntryId"
							:items="paletteOptions"
							value-key="value"
							size="xs"
							class="w-full"
							:disabled="disabled"
							@update:model-value="patch({
								stops: (entry.value as { stops: unknown[] }).stops
									.map((existing, at) => at === index ? { ...(existing as object), colorEntryId: $event } : existing),
							})"
						/>
					</UFormField>
					<UFormField label="Position" size="xs">
						<UInputNumber
							:model-value="stop.position"
							:min="0"
							:max="1"
							:step="0.05"
							size="xs"
							:disabled="disabled"
							@update:model-value="patch({
								stops: (entry.value as { stops: unknown[] }).stops
									.map((existing, at) => at === index ? { ...(existing as object), position: $event ?? 0 } : existing),
							})"
						/>
					</UFormField>
					<UFormField label="Opacity" size="xs">
						<UIOpacityInput
							:model-value="stop.opacity"
							size="xs"
							:disabled="disabled"
							@update:model-value="patch({
								stops: (entry.value as { stops: unknown[] }).stops
									.map((existing, at) => at === index ? { ...(existing as object), opacity: $event ?? 1 } : existing),
							})"
						/>
					</UFormField>
				</div>
			</template>
		</template>

		<template v-else-if="entry.kind === 'surface-style'">
			<UFormField
				label="Graphic Fill preset"
				size="xs"
				help="Optional. Without one, the items that inherit this keep their own fill."
			>
				<USelect
					:model-value="entry.value.fillEntryId"
					:items="fillOptions"
					value-key="value"
					size="xs"
					class="w-full"
					placeholder="Keep the item's fill"
					:disabled="disabled"
					data-testid="style-entry-surface-fill"
					@update:model-value="patch({ fillEntryId: $event ?? undefined })"
				/>
			</UFormField>
			<UFormField label="Fill opacity" size="xs">
				<UIOpacityInput
					:model-value="entry.value.fillOpacity"
					size="xs"
					:disabled="disabled"
					@update:model-value="patch({ fillOpacity: $event ?? 1 })"
				/>
			</UFormField>
			<GraphicsBorderGlowFields
				border-label="Outline"
				:border="entry.value.outline ? { color: entry.value.outline.colorEntryId, width: entry.value.outline.width } : null"
				:glow="entry.value.glow ? { color: entry.value.glow.colorEntryId, size: entry.value.glow.size, opacity: entry.value.glow.opacity } : null"
				:disabled="disabled"
				size="xs"
				border-test-id="style-entry-surface-outline"
				glow-test-id="style-entry-surface-glow"
				@edit="editSurfaceBorderGlow"
			>
				<template #color="{ value, label, update }">
					<USelect
						:model-value="value"
						:items="paletteOptions"
						value-key="value"
						size="xs"
						class="w-full"
						:aria-label="label"
						:disabled="disabled"
						@update:model-value="update($event)"
					/>
				</template>
			</GraphicsBorderGlowFields>
		</template>

		<template v-else-if="entry.kind === 'shape-geometry'">
			<GraphicsShapeGeometryFields
				:geometry="entry.value"
				size="xs"
				:disabled="disabled"
				@update="patch"
				@preset="applyShapeGeometryPreset"
			/>
		</template>

		<template v-else-if="entry.kind === 'media-treatment'">
			<UFormField label="Fit" size="xs">
				<USelect
					:model-value="entry.value.fit"
					:items="FIT_OPTIONS"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					@update:model-value="patch({ fit: $event })"
				/>
			</UFormField>
			<div class="grid grid-cols-3 gap-2">
				<UFormField label="Focal X" size="xs">
					<UInputNumber
						:model-value="entry.value.focalPosition.horizontal"
						:min="0"
						:max="1"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ focalPosition: { ...(entry.value as { focalPosition: object }).focalPosition, horizontal: $event ?? 0.5 } })"
					/>
				</UFormField>
				<UFormField label="Focal Y" size="xs">
					<UInputNumber
						:model-value="entry.value.focalPosition.vertical"
						:min="0"
						:max="1"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ focalPosition: { ...(entry.value as { focalPosition: object }).focalPosition, vertical: $event ?? 0.5 } })"
					/>
				</UFormField>
				<UFormField label="Opacity" size="xs">
					<UIOpacityInput
						:model-value="entry.value.opacity"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ opacity: $event ?? 1 })"
					/>
				</UFormField>
			</div>
			<UFormField label="Clip to Shape Geometry preset" size="xs">
				<USelect
					:model-value="entry.value.clipGeometryEntryId"
					:items="geometryOptions"
					value-key="value"
					size="xs"
					class="w-full"
					placeholder="No clipping"
					:disabled="disabled"
					@update:model-value="patch({ clipGeometryEntryId: $event ?? undefined })"
				/>
			</UFormField>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Playback rate" size="xs" help="Silent video only.">
					<UInputNumber
						:model-value="entry.value.playbackRate ?? 1"
						:min="MIN_GRAPHIC_MEDIA_PLAYBACK_RATE"
						:max="MAX_GRAPHIC_MEDIA_PLAYBACK_RATE"
						:step="0.25"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ playbackRate: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Loop" size="xs">
					<USwitch
						:model-value="entry.value.loop === true"
						:disabled="disabled"
						@update:model-value="patch({ loop: $event })"
					/>
				</UFormField>
			</div>
		</template>

		<template v-else-if="entry.kind === 'animation-recipe'">
			<!--
				On-screen-only defaults, hence cycling. A template may assign this same preset
				to any lifecycle phase, and the three that do not cycle simply never receive
				them — which is why they are authored here rather than being a separate kind.
			-->
			<GraphicsAnimationRecipeFields
				:recipe="entry.value"
				cycling
				:disabled="disabled"
				test-id-prefix="style-entry-animation"
				@update="patch"
				@channel="patchRecipeChannel"
			/>
		</template>
	</div>
</template>
