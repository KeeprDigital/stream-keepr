<script setup lang="ts">
import type { GraphicAnimationChannelKey, GraphicAnimationChannels, GraphicFillEdit, ShapeGeometryPresetId, ShapeGeometrySize } from '~~/shared/modules/graphics';
import type { AnimationRecipeGraphicStyleEntryValue, FillGraphicStyleEntryValue, GraphicStyleSetEntry, SurfaceStyleGraphicStyleEntryValue } from '~~/shared/types/graphicStyleSet';
import type { BorderGlowEdit } from '~/types/borderGlow';
import type { MediaFieldsValue } from '~/utils/mediaFields';
import { applyGraphicStyleFillEntryEdit, graphicFillOfStyleEntry } from '~~/shared/modules/graphic-style-sets';
import { getGraphicItemDefinition, getShapeGeometryPreset, mergeGraphicAnimationRecipeChannel } from '~~/shared/modules/graphics';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';

/**
 * The value controls for one Graphic Style Set entry.
 *
 * Every colour is a *picker of palette entries* rather than a colour input, and that
 * is the whole point of the kind: an entry that stored a colour would make a brand
 * change a find-and-replace across every entry that happened to use it. Only a
 * palette entry itself has a colour input.
 *
 * The bounds match the property each entry produces, because an entry outside the
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

/** A media treatment's optional playback shows as a Media Graphic Item's default. */
const mediaTreatment = computed<MediaFieldsValue | undefined>(() => props.entry.kind === 'media-treatment'
	? { ...props.entry.value, playbackRate: props.entry.value.playbackRate ?? 1, loop: props.entry.value.loop === true }
	: undefined);

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
 * A Graphic Fill entry takes the same edits as an item's fill, by the same rules,
 * on palette entry ids: two to four stops, and a change of kind that keeps the
 * palette entry the author was working with.
 */
function editFill(edit: GraphicFillEdit) {
	emit('update:value', applyGraphicStyleFillEntryEdit(props.entry.value as FillGraphicStyleEntryValue, edit));
}

/**
 * A Graphic Surface Style entry's outline and glow name a palette entry where an
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
					<GraphicsApplicationFontField
						:font-id="entry.value.font.fontId"
						:disabled="disabled"
						size="xs"
						test-id-prefix="style-entry-typography"
						@update:font-id="patch({ font: { kind: 'application', fontId: $event } })"
					/>
				</template>
				<template #color>
					<UFormField
						label="Colour"
						size="xs"
						class="col-span-2"
						help="A palette entry, so a brand change reaches every other entry that links to it."
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
			<GraphicsFillFields
				:fill="graphicFillOfStyleEntry(entry.value)"
				:disabled="disabled"
				size="xs"
				test-id-prefix="style-entry-fill"
				@edit="editFill"
			>
				<template #color="{ value, label, testId, update }">
					<USelect
						:model-value="value"
						:items="paletteOptions"
						value-key="value"
						size="xs"
						class="w-full"
						:aria-label="label"
						:disabled="disabled"
						:data-testid="testId"
						@update:model-value="update($event)"
					/>
				</template>
			</GraphicsFillFields>
		</template>

		<template v-else-if="entry.kind === 'surface-style'">
			<UFormField
				label="Graphic Fill entry"
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
			<GraphicsMediaFields
				:media="mediaTreatment!"
				opacity
				focal
				playback
				size="xs"
				:disabled="disabled"
				@update="patch(resolveMediaFieldsPatch($event))"
			/>
			<p class="text-xs text-muted">
				Playback rate and loop apply to silent video only.
			</p>
			<UFormField label="Clip to Shape Geometry entry" size="xs">
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
		</template>

		<template v-else-if="entry.kind === 'animation-recipe'">
			<!--
				On-screen-only defaults, hence cycling. A template may assign this same entry
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
