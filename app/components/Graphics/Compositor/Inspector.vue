<script setup lang="ts">
import type {
	BroadcastGraphicConfig,
	GraphicAnchorPoint,
	GraphicGeometryUnit,
	GraphicItemConfig,
	GraphicSurfaceStyle,
	GraphicTypography,
	TEXT_OVERFLOW_POLICY_VALUES,

	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	anchoredGraphicPosition,
	displayGraphicGeometryValue,
	GRAPHIC_ANCHOR_POINTS,
	GRAPHIC_FONT_OPTIONS,
	graphicItemIcon,
	graphicItemKindLabel,
	graphicItemSummary,
	moveGraphicRectToAnchoredPosition,
	parseGraphicGeometryValue,
	patchBroadcastGraphic,
	patchGraphicItem,
	patchGraphicSurfaceStyle,
	patchGraphicTypography,
	patchShapeGeometry,
	patchTextGraphicItem,
	replaceBroadcastGraphic,
	resizeGraphicRectFromAnchor,
} from '~~/shared/modules/graphics';
import {
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_GEOMETRY_UNIT_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';

/**
 * Property controls for the current selection: the Broadcast Graphic, or one
 * Graphic Item's geometry, Graphic Anchor Point, and kind-specific properties.
 * Geometry is authored in any Graphic Geometry Unit and always stored as
 * canonical canvas pixels.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * Whether this session may author the selection. A session observing an artifact
	 * another session's Graphics Authoring Lease covers reads every property and
	 * changes none.
	 */
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();

/**
 * Fail closed: a caller that does not grant authoring gets a read-only editor.
 * Only a session confirmed to hold the artifact's Graphics Authoring Lease authors
 * it, so an absent prop must never read as permission.
 */
const canAuthor = computed(() => props.writable === true);

const geometryUnit = ref<GraphicGeometryUnit>('px');

const GEOMETRY_UNIT_OPTIONS = GRAPHIC_GEOMETRY_UNIT_VALUES.map(unit => ({
	label: unit === 'px' ? 'px' : unit === 'percent' ? '%' : 'grid',
	value: unit,
}));
const ANCHOR_OPTIONS = GRAPHIC_ANCHOR_POINTS.map(point => ({ label: point.label, value: point.value }));
const OVERFLOW_POLICY_OPTIONS = [
	{ label: 'Clip', value: 'clip' },
	{ label: 'Ellipsis', value: 'ellipsis' },
	{ label: 'Shrink then ellipsis', value: 'shrink' },
] satisfies Array<{ label: string; value: typeof TEXT_OVERFLOW_POLICY_VALUES[number] }>;
const TEXT_ALIGN_OPTIONS = GRAPHIC_TEXT_ALIGN_VALUES.map(value => ({ label: value, value }));
const TEXT_TRANSFORM_OPTIONS = GRAPHIC_TEXT_TRANSFORM_VALUES.map(value => ({ label: value, value }));
const FONT_STYLE_OPTIONS = GRAPHIC_FONT_STYLE_VALUES.map(value => ({ label: value, value }));

const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

const header = computed(() => {
	const current = selection.value;
	if (current.kind === 'canvas') {
		return {
			icon: 'i-lucide-panels-top-left',
			label: 'Canvas',
			badge: 'Screen',
			summary: `${props.canvasWidth}x${props.canvasHeight} Broadcast Graphics canvas`,
		};
	}
	if (current.kind === 'graphic') {
		return {
			icon: 'i-lucide-layers',
			label: current.graphic.name,
			badge: 'Broadcast Graphic',
			summary: `${current.graphic.items.length} Graphic Items`,
		};
	}
	if (current.kind === 'item') {
		return {
			icon: graphicItemIcon(current.item.type),
			label: current.item.label,
			badge: graphicItemKindLabel(current.item.type),
			summary: graphicItemSummary(current.item),
		};
	}
	return {
		icon: 'i-lucide-circle-help',
		label: 'Selection unavailable',
		badge: 'Missing',
		summary: 'Choose another Broadcast Graphic or Graphic Item',
	};
});

const selectedItem = computed(() => selection.value.kind === 'item' ? selection.value.item : null);
const selectedTextItem = computed<TextGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'text' ? selectedItem.value : null,
);
const anchoredPosition = computed(() => selectedItem.value
	? anchoredGraphicPosition(selectedItem.value, selectedItem.value.anchor)
	: { x: 0, y: 0 });

function axisTotal(axis: 'x' | 'y') {
	return axis === 'x' ? props.canvasWidth : props.canvasHeight;
}

function displayedPosition(axis: 'x' | 'y') {
	return displayGraphicGeometryValue(anchoredPosition.value[axis], axisTotal(axis), geometryUnit.value, true);
}

function displayedSize(axis: 'width' | 'height') {
	const item = selectedItem.value;
	if (!item)
		return 0;
	return displayGraphicGeometryValue(
		item[axis],
		axis === 'width' ? props.canvasWidth : props.canvasHeight,
		geometryUnit.value,
	);
}

function patchSelectedItem(patch: Partial<GraphicItemConfig>) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		patchGraphicItem(current.graphic, current.item.id, patch),
	));
}

function updatePosition(axis: 'x' | 'y', value: number | null | undefined) {
	const item = selectedItem.value;
	if (!item)
		return;
	const pixels = parseGraphicGeometryValue(value ?? 0, axisTotal(axis), geometryUnit.value, true);
	patchSelectedItem(moveGraphicRectToAnchoredPosition(item, axis, pixels, item.anchor));
}

function updateSize(axis: 'width' | 'height', value: number | null | undefined) {
	const item = selectedItem.value;
	if (!item)
		return;
	const pixels = parseGraphicGeometryValue(
		value ?? 0,
		axis === 'width' ? props.canvasWidth : props.canvasHeight,
		geometryUnit.value,
	);
	patchSelectedItem(resizeGraphicRectFromAnchor(item, { [axis]: Math.max(1, pixels) }, item.anchor));
}

/** Nested property groups go through their own merge, so a single-field edit keeps its siblings. */
function applyToSelectedGraphic(
	merge: (graphic: BroadcastGraphicConfig, itemId: string) => BroadcastGraphicConfig,
) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(props.graphics, merge(current.graphic, current.item.id)));
}

function updateTypography(patch: Partial<GraphicTypography>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicTypography(graphic, itemId, patch));
}

function updateSurfaceStyle(patch: Partial<GraphicSurfaceStyle>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicSurfaceStyle(graphic, itemId, patch));
}

function updateShapeGeometry(patch: Partial<ShapeGeometry>) {
	applyToSelectedGraphic((graphic, itemId) => patchShapeGeometry(graphic, itemId, patch));
}

function updateTextItem(patch: Partial<Omit<TextGraphicItemConfig, 'type' | 'id'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchTextGraphicItem(graphic, itemId, patch));
}

function updateGraphicName(value: string) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'graphic')
		return;
	emit('update:graphics', patchBroadcastGraphic(props.graphics, current.graphic.id, { name: value }));
}
</script>

<template>
	<!--
		A disabled fieldset is what makes the read-only editor read-only in the
		browser rather than merely discouraging: every native control it contains
		stops accepting input. The guards above are the same rule stated where a
		programmatic change would otherwise slip through.
	-->
	<fieldset class="min-w-0 space-y-4" :disabled="!canAuthor">
		<div class="border-b border-default/70 pb-3">
			<div class="flex min-w-0 items-start gap-3">
				<UIcon :name="header.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
				<div class="min-w-0 flex-1">
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						<p class="truncate text-sm font-semibold">
							{{ header.label }}
						</p>
						<UBadge size="xs" variant="soft">
							{{ header.badge }}
						</UBadge>
					</div>
					<p class="mt-0.5 truncate text-xs text-muted">
						{{ header.summary }}
					</p>
				</div>
			</div>
		</div>

		<UFormField v-if="selection.kind === 'graphic'" label="Name" size="sm">
			<UInput
				:model-value="selection.graphic.name"
				class="w-full"
				data-testid="broadcast-graphic-name"
				@update:model-value="updateGraphicName(String($event))"
			/>
		</UFormField>

		<template v-if="selectedItem">
			<UFormField label="Label" size="sm">
				<UInput
					:model-value="selectedItem.label"
					class="w-full"
					data-testid="graphic-item-label"
					@update:model-value="patchSelectedItem({ label: String($event) })"
				/>
			</UFormField>

			<UFormField label="Visible" size="sm">
				<USwitch
					:model-value="selectedItem.visible"
					data-testid="graphic-item-visible"
					@update:model-value="patchSelectedItem({ visible: $event })"
				/>
			</UFormField>

			<UFormField label="Graphic Anchor Point" size="sm">
				<USelect
					:model-value="selectedItem.anchor"
					:items="ANCHOR_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="graphic-item-anchor"
					@update:model-value="patchSelectedItem({ anchor: $event as GraphicAnchorPoint })"
				/>
			</UFormField>

			<UFormField label="Graphic Geometry Unit" size="sm">
				<USelect
					v-model="geometryUnit"
					:items="GEOMETRY_UNIT_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="graphic-geometry-unit"
				/>
			</UFormField>

			<div class="grid grid-cols-2 gap-2">
				<UFormField label="X" size="sm">
					<UInputNumber
						:model-value="displayedPosition('x')"
						size="sm"
						class="w-full"
						aria-label="Item x"
						@update:model-value="updatePosition('x', $event)"
					/>
				</UFormField>
				<UFormField label="Y" size="sm">
					<UInputNumber
						:model-value="displayedPosition('y')"
						size="sm"
						class="w-full"
						aria-label="Item y"
						@update:model-value="updatePosition('y', $event)"
					/>
				</UFormField>
				<UFormField label="Width" size="sm">
					<UInputNumber
						:model-value="displayedSize('width')"
						size="sm"
						class="w-full"
						aria-label="Item width"
						@update:model-value="updateSize('width', $event)"
					/>
				</UFormField>
				<UFormField label="Height" size="sm">
					<UInputNumber
						:model-value="displayedSize('height')"
						size="sm"
						class="w-full"
						aria-label="Item height"
						@update:model-value="updateSize('height', $event)"
					/>
				</UFormField>
			</div>
		</template>

		<template v-if="selectedTextItem">
			<UFormField label="Text" size="sm">
				<UTextarea
					:model-value="selectedTextItem.text"
					:rows="3"
					class="w-full"
					data-testid="graphic-item-text"
					@update:model-value="updateTextItem({ text: String($event) })"
				/>
			</UFormField>

			<UFormField label="Font" size="sm">
				<USelect
					:model-value="selectedTextItem.typography.fontId"
					:items="GRAPHIC_FONT_OPTIONS"
					value-key="value"
					class="w-full"
					@update:model-value="updateTypography({ fontId: $event as never })"
				/>
			</UFormField>

			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Size" size="sm">
					<UInputNumber
						:model-value="selectedTextItem.typography.fontSize"
						:min="1"
						size="sm"
						class="w-full"
						aria-label="Font size"
						@update:model-value="updateTypography({ fontSize: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Weight" size="sm">
					<UInputNumber
						:model-value="selectedTextItem.typography.fontWeight"
						:min="1"
						:max="1000"
						size="sm"
						class="w-full"
						aria-label="Font weight"
						@update:model-value="updateTypography({ fontWeight: $event ?? 400 })"
					/>
				</UFormField>
				<UFormField label="Letter spacing" size="sm">
					<UInputNumber
						:model-value="selectedTextItem.typography.letterSpacing"
						size="sm"
						class="w-full"
						aria-label="Letter spacing"
						@update:model-value="updateTypography({ letterSpacing: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Line height" size="sm">
					<UInputNumber
						:model-value="selectedTextItem.typography.lineHeight"
						:step="0.05"
						size="sm"
						class="w-full"
						aria-label="Line height"
						@update:model-value="updateTypography({ lineHeight: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Style" size="sm">
					<USelect
						:model-value="selectedTextItem.typography.fontStyle"
						:items="FONT_STYLE_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ fontStyle: $event as never })"
					/>
				</UFormField>
				<UFormField label="Case" size="sm">
					<USelect
						:model-value="selectedTextItem.typography.textTransform"
						:items="TEXT_TRANSFORM_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ textTransform: $event as never })"
					/>
				</UFormField>
				<UFormField label="Align" size="sm">
					<USelect
						:model-value="selectedTextItem.typography.textAlign"
						:items="TEXT_ALIGN_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ textAlign: $event as never })"
					/>
				</UFormField>
				<UFormField label="Colour" size="sm">
					<UIColorPicker
						:model-value="selectedTextItem.typography.color"
						@update:model-value="updateTypography({ color: $event?.toString() || '#ffffff' })"
					/>
				</UFormField>
			</div>

			<UFormField label="Text Overflow Policy" size="sm">
				<USelect
					:model-value="selectedTextItem.overflowPolicy"
					:items="OVERFLOW_POLICY_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="text-overflow-policy"
					@update:model-value="updateTextItem({ overflowPolicy: $event })"
				/>
			</UFormField>

			<UFormField
				v-if="selectedTextItem.overflowPolicy === 'shrink'"
				label="Minimum font size"
				size="sm"
			>
				<UInputNumber
					:model-value="selectedTextItem.minFontSize"
					:min="1"
					size="sm"
					class="w-full"
					data-testid="text-min-font-size"
					aria-label="Minimum font size"
					@update:model-value="updateTextItem({ minFontSize: $event ?? 1 })"
				/>
			</UFormField>
		</template>

		<template v-if="selectedItem?.type === 'shape'">
			<UFormField label="Fill" size="sm">
				<UIColorPicker
					:model-value="selectedItem.surfaceStyle.fill"
					data-testid="shape-fill"
					@update:model-value="updateSurfaceStyle({ fill: $event?.toString() || '#000000' })"
				/>
			</UFormField>
			<UFormField label="Fill opacity" size="sm">
				<UInputNumber
					:model-value="selectedItem.surfaceStyle.fillOpacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					aria-label="Fill opacity"
					@update:model-value="updateSurfaceStyle({ fillOpacity: $event ?? 1 })"
				/>
			</UFormField>
			<UFormField label="Corner radius" size="sm">
				<UInputNumber
					:model-value="selectedItem.geometry.cornerRadius"
					:min="0"
					size="sm"
					class="w-full"
					data-testid="shape-corner-radius"
					aria-label="Corner radius"
					@update:model-value="updateShapeGeometry({ cornerRadius: $event ?? 0 })"
				/>
			</UFormField>
		</template>
	</fieldset>
</template>
