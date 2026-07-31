<script setup lang="ts">
import type { ShapeCorner, ShapeCornerKey, ShapeGeometry } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { GRAPHIC_FONT_OPTIONS } from '~~/shared/modules/graphics';
import { MEDIA_GRAPHIC_ITEM_FIT_VALUES } from '~~/shared/types/graphicItem';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	SHAPE_CORNER_KEYS,
	SHAPE_CORNER_TREATMENT_VALUES,
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

const FONT_STYLE_OPTIONS = GRAPHIC_FONT_STYLE_VALUES.map(value => ({ label: value, value }));
const TEXT_TRANSFORM_OPTIONS = GRAPHIC_TEXT_TRANSFORM_VALUES.map(value => ({ label: value, value }));
const FIT_OPTIONS = MEDIA_GRAPHIC_ITEM_FIT_VALUES.map(value => ({ label: value, value }));
const EASING_OPTIONS = GRAPHIC_ANIMATION_EASING_VALUES.map(value => ({ label: value, value }));
const DIRECTION_OPTIONS = GRAPHIC_SLIDE_DIRECTION_VALUES.map(value => ({ label: value, value }));
const DISTANCE_MODE_OPTIONS = GRAPHIC_SLIDE_DISTANCE_MODE_VALUES.map(value => ({ label: value, value }));
const REVEAL_EDGE_OPTIONS = GRAPHIC_REVEAL_EDGE_VALUES.map(value => ({ label: value, value }));
const CORNER_TREATMENT_OPTIONS = SHAPE_CORNER_TREATMENT_VALUES.map(value => ({ label: value, value }));
const ANIMATION_ORIGIN_OPTIONS = GRAPHIC_ANIMATION_ORIGIN_VALUES.map(value => ({ label: value, value }));

/** Merge into the entry's value, so a single-field edit never drops its siblings. */
function patch(fields: Record<string, unknown>) {
	emit('update:value', { ...(props.entry.value as object), ...fields } as GraphicStyleSetEntry['value']);
}

function patchCorner(corner: ShapeCornerKey, fields: Partial<ShapeCorner>) {
	const geometry = props.entry.value as ShapeGeometry;
	patch({ [corner]: { ...geometry[corner], ...fields } });
}
</script>

<template>
	<div class="space-y-2" :data-testid="`style-entry-value-${entry.kind}`">
		<template v-if="entry.kind === 'palette'">
			<UFormField label="Colour" size="xs">
				<UInput
					type="color"
					:model-value="entry.value.color"
					size="xs"
					:disabled="disabled"
					data-testid="style-entry-palette-color"
					@update:model-value="patch({ color: String($event) })"
				/>
			</UFormField>
		</template>

		<template v-else-if="entry.kind === 'typography'">
			<UFormField label="Font" size="xs">
				<USelect
					:model-value="entry.value.fontId"
					:items="GRAPHIC_FONT_OPTIONS"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					@update:model-value="patch({ fontId: $event })"
				/>
			</UFormField>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Size" size="xs">
					<UInputNumber
						:model-value="entry.value.fontSize"
						:min="1"
						:max="600"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ fontSize: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Weight" size="xs">
					<UInputNumber
						:model-value="entry.value.fontWeight"
						:min="1"
						:max="1000"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ fontWeight: $event ?? 400 })"
					/>
				</UFormField>
				<UFormField label="Letter spacing" size="xs">
					<UInputNumber
						:model-value="entry.value.letterSpacing"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ letterSpacing: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Line height" size="xs">
					<UInputNumber
						:model-value="entry.value.lineHeight"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ lineHeight: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Style" size="xs">
					<USelect
						:model-value="entry.value.fontStyle"
						:items="FONT_STYLE_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ fontStyle: $event })"
					/>
				</UFormField>
				<UFormField label="Case" size="xs">
					<USelect
						:model-value="entry.value.textTransform"
						:items="TEXT_TRANSFORM_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ textTransform: $event })"
					/>
				</UFormField>
			</div>
			<UFormField label="Colour" size="xs" help="A palette entry, so a brand change reaches every preset that links to it.">
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
						<UInputNumber
							:model-value="stop.opacity"
							:min="0"
							:max="1"
							:step="0.05"
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
				<UInputNumber
					:model-value="entry.value.fillOpacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="xs"
					:disabled="disabled"
					@update:model-value="patch({ fillOpacity: $event ?? 1 })"
				/>
			</UFormField>
			<UFormField label="Outline" size="xs">
				<USwitch
					:model-value="entry.value.outline !== undefined"
					:disabled="disabled"
					data-testid="style-entry-surface-outline"
					@update:model-value="patch({
						outline: $event ? { colorEntryId: paletteOptions[0]?.value ?? '', width: 2 } : undefined,
					})"
				/>
			</UFormField>
			<div v-if="entry.value.outline" class="grid grid-cols-2 gap-2">
				<UFormField label="Outline colour" size="xs">
					<USelect
						:model-value="entry.value.outline.colorEntryId"
						:items="paletteOptions"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ outline: { ...(entry.value as { outline: object }).outline, colorEntryId: $event } })"
					/>
				</UFormField>
				<UFormField label="Width" size="xs">
					<UInputNumber
						:model-value="entry.value.outline.width"
						:min="0"
						:max="500"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ outline: { ...(entry.value as { outline: object }).outline, width: $event ?? 0 } })"
					/>
				</UFormField>
			</div>
			<UFormField label="Glow" size="xs">
				<USwitch
					:model-value="entry.value.glow !== undefined"
					:disabled="disabled"
					data-testid="style-entry-surface-glow"
					@update:model-value="patch({
						glow: $event ? { colorEntryId: paletteOptions[0]?.value ?? '', size: 8, opacity: 0.5 } : undefined,
					})"
				/>
			</UFormField>
			<div v-if="entry.value.glow" class="grid grid-cols-3 gap-2">
				<UFormField label="Colour" size="xs">
					<USelect
						:model-value="entry.value.glow.colorEntryId"
						:items="paletteOptions"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ glow: { ...(entry.value as { glow: object }).glow, colorEntryId: $event } })"
					/>
				</UFormField>
				<UFormField label="Size" size="xs">
					<UInputNumber
						:model-value="entry.value.glow.size"
						:min="0"
						:max="500"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ glow: { ...(entry.value as { glow: object }).glow, size: $event ?? 0 } })"
					/>
				</UFormField>
				<UFormField label="Opacity" size="xs">
					<UInputNumber
						:model-value="entry.value.glow.opacity"
						:min="0"
						:max="1"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ glow: { ...(entry.value as { glow: object }).glow, opacity: $event ?? 1 } })"
					/>
				</UFormField>
			</div>
		</template>

		<template v-else-if="entry.kind === 'shape-geometry'">
			<div v-for="corner in SHAPE_CORNER_KEYS" :key="corner" class="grid grid-cols-2 gap-2">
				<UFormField :label="corner" size="xs">
					<USelect
						:model-value="entry.value[corner].treatment"
						:items="CORNER_TREATMENT_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patchCorner(corner, { treatment: $event })"
					/>
				</UFormField>
				<UFormField label="Size" size="xs">
					<UInputNumber
						:model-value="entry.value[corner].size"
						:min="0"
						size="xs"
						:disabled="disabled || entry.value[corner].treatment === 'square'"
						@update:model-value="patchCorner(corner, { size: $event ?? 0 })"
					/>
				</UFormField>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Left slant" size="xs">
					<UInputNumber
						:model-value="entry.value.leftSlant"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ leftSlant: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Right slant" size="xs">
					<UInputNumber
						:model-value="entry.value.rightSlant"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ rightSlant: $event ?? 0 })"
					/>
				</UFormField>
			</div>
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
					<UInputNumber
						:model-value="entry.value.opacity"
						:min="0"
						:max="1"
						:step="0.05"
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
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Duration (ms)" size="xs">
					<UInputNumber
						:model-value="entry.value.duration"
						:min="MIN_GRAPHIC_ANIMATION_DURATION_MS"
						:max="MAX_GRAPHIC_ANIMATION_DURATION_MS"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ duration: $event ?? MIN_GRAPHIC_ANIMATION_DURATION_MS })"
					/>
				</UFormField>
				<UFormField label="Delay (ms)" size="xs">
					<UInputNumber
						:model-value="entry.value.delay ?? 0"
						:min="0"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ delay: $event ?? 0 })"
					/>
				</UFormField>
			</div>
			<UFormField label="Easing" size="xs">
				<USelect
					:model-value="entry.value.easing"
					:items="EASING_OPTIONS"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					@update:model-value="patch({ easing: $event })"
				/>
			</UFormField>

			<UFormField label="Fade" size="xs">
				<USwitch
					:model-value="entry.value.fade !== undefined"
					:disabled="disabled"
					data-testid="style-entry-animation-fade"
					@update:model-value="patch({ fade: $event ? { opacity: 0 } : undefined })"
				/>
			</UFormField>
			<UFormField v-if="entry.value.fade" label="Fade from opacity" size="xs">
				<UInputNumber
					:model-value="entry.value.fade.opacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="xs"
					:disabled="disabled"
					@update:model-value="patch({ fade: { opacity: $event ?? 0 } })"
				/>
			</UFormField>

			<UFormField label="Slide" size="xs">
				<USwitch
					:model-value="entry.value.slide !== undefined"
					:disabled="disabled"
					@update:model-value="patch({
						slide: $event ? { direction: 'north', distanceMode: 'fixed', distance: 40 } : undefined,
					})"
				/>
			</UFormField>
			<div v-if="entry.value.slide" class="grid grid-cols-3 gap-2">
				<UFormField label="Direction" size="xs">
					<USelect
						:model-value="entry.value.slide.direction"
						:items="DIRECTION_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ slide: { ...(entry.value as { slide: object }).slide, direction: $event } })"
					/>
				</UFormField>
				<UFormField label="Mode" size="xs">
					<USelect
						:model-value="entry.value.slide.distanceMode"
						:items="DISTANCE_MODE_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ slide: { ...(entry.value as { slide: object }).slide, distanceMode: $event } })"
					/>
				</UFormField>
				<UFormField label="Distance" size="xs">
					<UInputNumber
						:model-value="entry.value.slide.distance"
						:min="0"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ slide: { ...(entry.value as { slide: object }).slide, distance: $event ?? 0 } })"
					/>
				</UFormField>
			</div>

			<UFormField label="Scale" size="xs">
				<USwitch
					:model-value="entry.value.scale !== undefined"
					:disabled="disabled"
					data-testid="style-entry-animation-scale"
					@update:model-value="patch({ scale: $event ? { factor: 0.9, origin: 'center' } : undefined })"
				/>
			</UFormField>
			<div v-if="entry.value.scale" class="grid grid-cols-2 gap-2">
				<UFormField label="Scale from" size="xs">
					<UInputNumber
						:model-value="entry.value.scale.factor"
						:min="0"
						:max="MAX_GRAPHIC_ANIMATION_SCALE"
						:step="0.05"
						size="xs"
						:disabled="disabled"
						@update:model-value="patch({ scale: { ...(entry.value as { scale: object }).scale, factor: $event ?? 1 } })"
					/>
				</UFormField>
				<UFormField label="Origin" size="xs">
					<USelect
						:model-value="entry.value.scale.origin"
						:items="ANIMATION_ORIGIN_OPTIONS"
						value-key="value"
						size="xs"
						class="w-full"
						:disabled="disabled"
						@update:model-value="patch({ scale: { ...(entry.value as { scale: object }).scale, origin: $event } })"
					/>
				</UFormField>
			</div>

			<UFormField label="Reveal" size="xs">
				<USwitch
					:model-value="entry.value.reveal !== undefined"
					:disabled="disabled"
					@update:model-value="patch({ reveal: $event ? { edge: 'left' } : undefined })"
				/>
			</UFormField>
			<UFormField v-if="entry.value.reveal" label="Reveal edge" size="xs">
				<USelect
					:model-value="entry.value.reveal.edge"
					:items="REVEAL_EDGE_OPTIONS"
					value-key="value"
					size="xs"
					class="w-full"
					:disabled="disabled"
					@update:model-value="patch({ reveal: { edge: $event } })"
				/>
			</UFormField>

			<!--
				On-screen-only defaults. A template may assign this same preset to any
				lifecycle phase, and the three that do not cycle simply never receive them —
				which is why they are authored here rather than being a separate kind.
			-->
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Pause between cycles (ms)" size="xs">
					<UInputNumber
						:model-value="entry.value.pause ?? 0"
						:min="0"
						:max="MAX_GRAPHIC_ANIMATION_PAUSE_MS"
						size="xs"
						:disabled="disabled"
						data-testid="style-entry-animation-pause"
						@update:model-value="patch({ pause: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Repeat" size="xs">
					<UInputNumber
						:model-value="entry.value.repeat === 'indefinite' ? undefined : Number(entry.value.repeat ?? 1)"
						:min="MIN_GRAPHIC_ANIMATION_REPEAT"
						:max="MAX_GRAPHIC_ANIMATION_REPEAT"
						:disabled="disabled || entry.value.repeat === 'indefinite'"
						size="xs"
						data-testid="style-entry-animation-repeat"
						@update:model-value="patch({ repeat: $event ?? 1 })"
					/>
				</UFormField>
			</div>
			<UFormField label="Repeat indefinitely" size="xs">
				<USwitch
					:model-value="entry.value.repeat === 'indefinite'"
					:disabled="disabled"
					data-testid="style-entry-animation-repeat-indefinite"
					@update:model-value="patch({ repeat: $event ? 'indefinite' : 1 })"
				/>
			</UFormField>
		</template>
	</div>
</template>
