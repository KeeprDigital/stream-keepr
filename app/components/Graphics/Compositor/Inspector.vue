<script setup lang="ts">
import type { ShapeGeometryPresetId } from '~~/shared/modules/graphics';
import type {
	BroadcastGraphicConfig,
	GRAPHIC_FILL_KIND_VALUES,
	GraphicAnchorPoint,
	GraphicFillStop,
	GraphicGeometryUnit,
	GraphicGlow,
	GraphicGroupChildSizing,
	GraphicGroupItemConfig,
	GraphicInputChoiceOption,
	GraphicInputDeclaration,
	GraphicInputType,
	GraphicItemConfig,
	GraphicOutline,
	GraphicPlaceholderStyle,
	GraphicSurfaceStyle,
	GraphicTypography,
	OnAirUpdatePolicy,
	ShapeCorner,
	ShapeCornerKey,
	ShapeGeometry,
	TEXT_OVERFLOW_POLICY_VALUES,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	addGraphicInput,
	anchoredGraphicPosition,
	applyShapeGeometryPreset,
	changeGraphicGradientStopCount,
	clearGraphicSurfaceStyle,
	deleteGraphicInput,
	displayGraphicGeometryValue,
	GRAPHIC_ANCHOR_POINTS,
	GRAPHIC_FONT_OPTIONS,
	graphicItemIcon,
	graphicItemKindLabel,
	graphicItemSummary,
	graphicTextTemplateInputKeys,
	moveGraphicRectToAnchoredPosition,
	parseGraphicGeometryValue,
	patchBroadcastGraphic,
	patchGraphicGlow,
	patchGraphicGradientAngle,
	patchGraphicGradientStop,
	patchGraphicGroup,
	patchGraphicGroupChildSizing,
	patchGraphicGroupDefaultChildSurfaceStyle,
	patchGraphicInput,
	patchGraphicItem,
	patchGraphicOutline,
	patchGraphicPlaceholderStyle,
	patchGraphicSolidFill,
	patchGraphicSurfaceStyle,
	patchGraphicTypography,
	patchShapeCorner,
	patchShapeGeometry,
	patchTextGraphicItem,
	replaceBroadcastGraphic,
	resizeGraphicRectFromAnchor,
	setGraphicFillKind,
	setGraphicInputChoiceOptions,
	SHAPE_GEOMETRY_PRESETS,
} from '~~/shared/modules/graphics';
import {
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_GEOMETRY_UNIT_VALUES,
	GRAPHIC_GROUP_ALIGN_VALUES,
	GRAPHIC_GROUP_ARRANGEMENT_VALUES,
	GRAPHIC_GROUP_JUSTIFY_VALUES,
	GRAPHIC_INPUT_TYPE_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_TEXT_LENGTH,
	MIN_GRAPHIC_FILL_STOPS,
	SHAPE_CORNER_KEYS,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';
import GraphicsCompositorAnimation from './Animation.vue';

/**
 * Property controls for the current selection: the Broadcast Graphic, or one
 * Graphic Item's geometry, Graphic Anchor Point, Graphic Surface Style, and
 * kind-specific properties. Geometry is authored in any Graphic Geometry Unit
 * and always stored as canonical canvas pixels.
 *
 * Every nested property group goes through its own merge helper, so editing one
 * field of a Shape Geometry, Graphic Fill, or typography never drops its siblings.
 *
 * A row or column Graphic Group child is positioned by its group rather than by
 * a coordinate, so it offers main-axis sizing instead of X, Y, and Graphic
 * Rotation. A canvas-positioned child offers all three, projected against its
 * group's own bounds.
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
const FILL_KIND_OPTIONS = [
	{ label: 'Solid', value: 'solid' },
	{ label: 'Linear gradient', value: 'linear-gradient' },
] satisfies Array<{ label: string; value: typeof GRAPHIC_FILL_KIND_VALUES[number] }>;
const CORNER_TREATMENT_OPTIONS = SHAPE_CORNER_TREATMENT_VALUES.map(value => ({ label: value, value }));
const GEOMETRY_PRESET_OPTIONS = SHAPE_GEOMETRY_PRESETS.map(preset => ({
	label: preset.label,
	value: preset.id,
	icon: preset.icon,
}));
const ARRANGEMENT_OPTIONS = GRAPHIC_GROUP_ARRANGEMENT_VALUES.map(value => ({ label: value, value }));
const ALIGN_OPTIONS = GRAPHIC_GROUP_ALIGN_VALUES.map(value => ({ label: value, value }));
const JUSTIFY_OPTIONS = GRAPHIC_GROUP_JUSTIFY_VALUES.map(value => ({ label: value, value }));
const SIZING_MODE_OPTIONS = [
	{ label: 'Fixed', value: 'fixed' },
	{ label: 'Weighted fill', value: 'fill' },
] satisfies Array<{ label: string; value: GraphicGroupChildSizing['mode'] }>;
const CORNER_LABELS: Record<ShapeCornerKey, string> = {
	topLeft: 'Top left',
	topRight: 'Top right',
	bottomRight: 'Bottom right',
	bottomLeft: 'Bottom left',
};

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
const parentGroup = computed<GraphicGroupItemConfig | null>(() =>
	selection.value.kind === 'item' ? selection.value.group ?? null : null,
);
const selectedTextItem = computed<TextGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'text' ? selectedItem.value : null,
);
const selectedGroup = computed<GraphicGroupItemConfig | null>(() =>
	selectedItem.value?.type === 'group' ? selectedItem.value : null,
);
/** A Shape Graphic Item and a Graphic Group both own a Shape Geometry. */
const selectedGeometry = computed<ShapeGeometry | null>(() => {
	const item = selectedItem.value;
	if (item?.type === 'shape' || item?.type === 'group')
		return item.geometry;
	return null;
});

/** Only a canvas-positioned item has a coordinate and a Graphic Rotation. */
const isCanvasPositioned = computed(() =>
	selectedItem.value !== null && (parentGroup.value === null || parentGroup.value.arrangement === 'canvas'),
);
const isStackedChild = computed(() =>
	parentGroup.value !== null && parentGroup.value.arrangement !== 'canvas',
);

/**
 * Only an item's own Graphic Surface Style is editable here. A Graphic Group
 * child with none of its own inherits the group's local style default, which is
 * edited on the group itself.
 */
const ownSurfaceStyle = computed<GraphicSurfaceStyle | null>(() => selectedItem.value?.surfaceStyle ?? null);

/** A Graphic Geometry Unit projects against the containing canvas — a Graphic Group for its children. */
function axisTotal(axis: 'x' | 'y') {
	const group = parentGroup.value;
	if (group)
		return axis === 'x' ? group.width : group.height;
	return axis === 'x' ? props.canvasWidth : props.canvasHeight;
}

const anchoredPosition = computed(() => selectedItem.value
	? anchoredGraphicPosition(selectedItem.value, selectedItem.value.anchor)
	: { x: 0, y: 0 });

function displayedPosition(axis: 'x' | 'y') {
	return displayGraphicGeometryValue(anchoredPosition.value[axis], axisTotal(axis), geometryUnit.value, true);
}

function displayedSize(axis: 'width' | 'height') {
	const item = selectedItem.value;
	if (!item)
		return 0;
	return displayGraphicGeometryValue(item[axis], axisTotal(axis === 'width' ? 'x' : 'y'), geometryUnit.value);
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
		axisTotal(axis === 'width' ? 'x' : 'y'),
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

/** One switch owns whether the item paints a surface of its own at all. */
function updateOwnSurfaceStyle(present: boolean) {
	applyToSelectedGraphic((graphic, itemId) => present
		? patchGraphicSurfaceStyle(graphic, itemId, {})
		: clearGraphicSurfaceStyle(graphic, itemId));
}

function updateFillKind(kind: typeof GRAPHIC_FILL_KIND_VALUES[number]) {
	applyToSelectedGraphic((graphic, itemId) => setGraphicFillKind(graphic, itemId, kind));
}

function updateSolidFill(color: string) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicSolidFill(graphic, itemId, color));
}

function updateGradientAngle(angle: number) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGradientAngle(graphic, itemId, angle));
}

function updateGradientStop(index: number, patch: Partial<GraphicFillStop>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGradientStop(graphic, itemId, index, patch));
}

function changeStopCount(delta: 1 | -1) {
	applyToSelectedGraphic((graphic, itemId) => changeGraphicGradientStopCount(graphic, itemId, delta));
}

function updateOutline(patch: Partial<GraphicOutline> | null) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicOutline(graphic, itemId, patch));
}

function updateGlow(patch: Partial<GraphicGlow> | null) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGlow(graphic, itemId, patch));
}

function updateGeometry(patch: Partial<ShapeGeometry>) {
	applyToSelectedGraphic((graphic, itemId) => patchShapeGeometry(graphic, itemId, patch));
}

function updateCorner(corner: ShapeCornerKey, patch: Partial<ShapeCorner>) {
	applyToSelectedGraphic((graphic, itemId) => patchShapeCorner(graphic, itemId, corner, patch));
}

function applyPreset(presetId: ShapeGeometryPresetId) {
	applyToSelectedGraphic((graphic, itemId) => applyShapeGeometryPreset(graphic, itemId, presetId));
}

function updateGroup(patch: Partial<Omit<GraphicGroupItemConfig, 'type' | 'id' | 'children'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroup(graphic, itemId, patch));
}

function updateDefaultChildStyle(patch: Partial<GraphicSurfaceStyle> | null) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroupDefaultChildSurfaceStyle(graphic, itemId, patch));
}

function updateChildSizing(patch: Partial<GraphicGroupChildSizing>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroupChildSizing(graphic, itemId, patch));
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

/* ────────────────────────────────────────────────
 * Graphic Inputs
 * ──────────────────────────────────────────────── */

/**
 * The typed Graphic Inputs the selected Broadcast Graphic declares.
 *
 * They belong to the graphic rather than to any one Graphic Item, because a
 * `{inputKey}` placeholder in any of its Text Graphic Items may name the same
 * input — so this panel appears with the Broadcast Graphic selected.
 */
const selectedGraphicInputs = computed<GraphicInputDeclaration[]>(() =>
	selection.value.kind === 'graphic' ? selection.value.graphic.inputs ?? [] : [],
);

const INPUT_TYPE_OPTIONS = GRAPHIC_INPUT_TYPE_VALUES.map(value => ({ label: value, value }));
const UPDATE_POLICY_OPTIONS = [
	{ label: 'Staged', value: 'staged' },
	{ label: 'Live', value: 'live' },
] satisfies Array<{ label: string; value: OnAirUpdatePolicy }>;

function applyToGraphicInputs(
	merge: (graphics: readonly BroadcastGraphicConfig[], graphicId: string) => BroadcastGraphicConfig[],
) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'graphic')
		return;
	emit('update:graphics', merge(props.graphics, current.graphic.id));
}

const newInputType = ref<GraphicInputType>('text');

/** A Graphic Input key written the way a Graphic Text Template names it. */
function placeholderToken(key: string): string {
	return `{${key}}`;
}

function addInput() {
	applyToGraphicInputs((graphics, graphicId) => addGraphicInput(graphics, graphicId, newInputType.value));
}

function updateInput(key: string, patch: Partial<Omit<GraphicInputDeclaration, 'key' | 'type'>>) {
	applyToGraphicInputs((graphics, graphicId) => patchGraphicInput(graphics, graphicId, key, patch));
}

function removeInput(key: string) {
	applyToGraphicInputs((graphics, graphicId) => deleteGraphicInput(graphics, graphicId, key));
}

function updateChoiceOptions(key: string, options: GraphicInputChoiceOption[]) {
	applyToGraphicInputs((graphics, graphicId) => setGraphicInputChoiceOptions(graphics, graphicId, key, options));
}

/**
 * A choice Graphic Input's options as one line per option, `value=label`.
 *
 * A bounded list of short pairs is exactly what a textarea is good at, and it
 * keeps the option list one control rather than a nested editor inside a property
 * panel.
 */
function choiceOptionsText(input: GraphicInputDeclaration): string {
	return input.type === 'choice'
		? input.options.map(option => `${option.value}=${option.label}`).join('\n')
		: '';
}

function parseChoiceOptions(key: string, value: string) {
	const options = value
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.map((line) => {
			const [optionValue, ...rest] = line.split('=');
			const trimmed = (optionValue ?? '').trim();
			return { value: trimmed, label: rest.join('=').trim() || trimmed };
		})
		.filter(option => option.value.length > 0);

	updateChoiceOptions(key, options.slice(0, MAX_GRAPHIC_INPUT_CHOICE_OPTIONS));
}

/* ────────────────────────────────────────────────
 * Graphic Placeholder Styles
 * ──────────────────────────────────────────────── */

/**
 * The `{inputKey}` placeholders of the selected Text Graphic Item that name a
 * declared Graphic Input.
 *
 * Only declared ones: styling a placeholder nothing declares would be styling
 * something that renders nothing.
 */
const styleablePlaceholders = computed(() => {
	const current = selection.value;
	if (current.kind !== 'item' || current.item.type !== 'text')
		return [];

	const declared = new Set((current.graphic.inputs ?? []).map(input => input.key));
	return graphicTextTemplateInputKeys(current.item.text).filter(key => declared.has(key));
});

function placeholderStyleFor(inputKey: string): GraphicPlaceholderStyle {
	return selectedTextItem.value?.placeholderStyles?.[inputKey] ?? {};
}

function updatePlaceholderStyle(inputKey: string, patch: Partial<GraphicPlaceholderStyle> | null) {
	applyToSelectedGraphic((graphic, itemId) =>
		patchGraphicPlaceholderStyle(graphic, itemId, inputKey, patch),
	);
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

		<!--
			Graphic Inputs belong to the Broadcast Graphic, not to one Graphic Item: any
			of its Text Graphic Items may name the same `{inputKey}`.
		-->
		<template v-if="selection.kind === 'graphic'">
			<div class="flex items-end gap-2">
				<UFormField label="Graphic Inputs" size="sm" class="flex-1">
					<USelect
						:model-value="newInputType"
						:items="INPUT_TYPE_OPTIONS"
						class="w-full"
						size="sm"
						data-testid="graphic-input-type"
						@update:model-value="newInputType = $event"
					/>
				</UFormField>
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-plus"
					data-testid="graphic-input-add"
					@click="addInput()"
				>
					Declare
				</UButton>
			</div>

			<div
				v-for="input in selectedGraphicInputs"
				:key="input.key"
				class="space-y-2 rounded-lg border border-default/70 p-2"
				:data-graphic-input-declaration="input.key"
			>
				<div class="flex items-center gap-2">
					<UInput
						:model-value="input.label"
						class="min-w-0 flex-1"
						size="sm"
						:maxlength="MAX_GRAPHIC_INPUT_LABEL_LENGTH"
						data-testid="graphic-input-label"
						@update:model-value="updateInput(input.key, { label: String($event) })"
					/>
					<UBadge size="xs" variant="soft">
						{{ input.type }}
					</UBadge>
					<UButton
						size="xs"
						variant="ghost"
						color="error"
						icon="i-lucide-trash-2"
						aria-label="Stop declaring this Graphic Input"
						data-testid="graphic-input-delete"
						@click="removeInput(input.key)"
					/>
				</div>

				<!--
					The key is generated once and never edited: a placeholder, a binding, a
					Graphic Placeholder Style, and every accepted value in a running Live
					Session all name it. The label is what an author renames.
				-->
				<p class="font-mono text-xs text-muted" data-testid="graphic-input-key">
					{{ placeholderToken(input.key) }}
				</p>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Required" size="xs">
						<USwitch
							:model-value="input.required"
							size="sm"
							data-testid="graphic-input-required"
							@update:model-value="updateInput(input.key, { required: Boolean($event) })"
						/>
					</UFormField>
					<UFormField label="On-air Update Policy" size="xs">
						<USelect
							:model-value="input.updatePolicy"
							:items="UPDATE_POLICY_OPTIONS"
							class="w-full"
							size="sm"
							data-testid="graphic-input-policy"
							@update:model-value="updateInput(input.key, { updatePolicy: $event })"
						/>
					</UFormField>
				</div>

				<UFormField v-if="input.type === 'text'" label="Default" size="xs">
					<UInput
						:model-value="input.default"
						class="w-full"
						size="sm"
						:maxlength="input.maxLength"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: String($event) })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'number'" label="Default" size="xs">
					<UInputNumber
						:model-value="input.default ?? undefined"
						class="w-full"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: $event ?? null })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'toggle'" label="Default" size="xs">
					<USwitch
						:model-value="input.default"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: Boolean($event) })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'color'" label="Default" size="xs">
					<UInput
						type="color"
						:model-value="input.default ?? '#000000'"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: String($event) })"
					/>
				</UFormField>

				<UFormField
					v-if="input.type === 'choice'"
					label="Options"
					size="xs"
					:help="`One per line, as value=label. Up to ${MAX_GRAPHIC_INPUT_CHOICE_OPTIONS}.`"
				>
					<UTextarea
						:model-value="choiceOptionsText(input)"
						class="w-full"
						size="sm"
						:rows="3"
						data-testid="graphic-input-options"
						@update:model-value="parseChoiceOptions(input.key, String($event))"
					/>
				</UFormField>
			</div>
		</template>

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

			<UFormField v-if="isCanvasPositioned" label="Graphic Anchor Point" size="sm">
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
				<UFormField v-if="isCanvasPositioned" label="X" size="sm">
					<UInputNumber
						:model-value="displayedPosition('x')"
						size="sm"
						class="w-full"
						aria-label="Item x"
						@update:model-value="updatePosition('x', $event)"
					/>
				</UFormField>
				<UFormField v-if="isCanvasPositioned" label="Y" size="sm">
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

			<UFormField v-if="isCanvasPositioned" label="Graphic Rotation" size="sm">
				<UInputNumber
					:model-value="selectedItem.rotation ?? 0"
					:min="-360"
					:max="360"
					size="sm"
					class="w-full"
					data-testid="graphic-item-rotation"
					aria-label="Graphic Rotation"
					@update:model-value="patchSelectedItem({ rotation: $event ?? 0 })"
				/>
			</UFormField>
		</template>

		<template v-if="isStackedChild && selectedItem">
			<div class="rounded-lg border border-default/70 p-3">
				<p class="mb-2 text-xs font-semibold text-muted">
					Graphic Group sizing
				</p>
				<UFormField label="Main axis" size="sm">
					<USelect
						:model-value="selectedItem.sizing?.mode ?? 'fixed'"
						:items="SIZING_MODE_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="graphic-group-child-sizing-mode"
						@update:model-value="updateChildSizing({ mode: $event as GraphicGroupChildSizing['mode'] })"
					/>
				</UFormField>
				<UFormField
					v-if="(selectedItem.sizing?.mode ?? 'fixed') === 'fixed'"
					label="Fixed size"
					size="sm"
				>
					<UInputNumber
						:model-value="selectedItem.sizing?.size ?? selectedItem.width"
						:min="0"
						size="sm"
						class="w-full"
						aria-label="Fixed main axis size"
						@update:model-value="updateChildSizing({ size: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField v-else label="Fill weight" size="sm">
					<UInputNumber
						:model-value="selectedItem.sizing?.weight ?? 1"
						:min="0"
						:step="0.5"
						size="sm"
						class="w-full"
						aria-label="Fill weight"
						@update:model-value="updateChildSizing({ weight: $event ?? 1 })"
					/>
				</UFormField>
			</div>
		</template>

		<template v-if="selectedGroup">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Graphic Group
				</p>
				<UFormField label="Arrangement" size="sm">
					<USelect
						:model-value="selectedGroup.arrangement"
						:items="ARRANGEMENT_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="graphic-group-arrangement"
						@update:model-value="updateGroup({ arrangement: $event as never })"
					/>
				</UFormField>
				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Padding" size="sm">
						<UInputNumber
							:model-value="selectedGroup.padding"
							:min="0"
							size="sm"
							class="w-full"
							aria-label="Group padding"
							@update:model-value="updateGroup({ padding: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Gap" size="sm">
						<UInputNumber
							:model-value="selectedGroup.gap"
							:min="0"
							size="sm"
							class="w-full"
							aria-label="Group gap"
							@update:model-value="updateGroup({ gap: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Align" size="sm">
						<USelect
							:model-value="selectedGroup.align"
							:items="ALIGN_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="updateGroup({ align: $event as never })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Justify" size="sm">
						<USelect
							:model-value="selectedGroup.justify"
							:items="JUSTIFY_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="updateGroup({ justify: $event as never })"
						/>
					</UFormField>
				</div>
				<UFormField label="Clip children" size="sm">
					<USwitch
						:model-value="selectedGroup.clip"
						data-testid="graphic-group-clip"
						@update:model-value="updateGroup({ clip: $event })"
					/>
				</UFormField>
				<UFormField label="Child style default" size="sm">
					<USwitch
						:model-value="selectedGroup.defaultChildSurfaceStyle !== undefined"
						data-testid="graphic-group-child-style-default"
						@update:model-value="updateDefaultChildStyle($event ? {} : null)"
					/>
				</UFormField>
				<UFormField
					v-if="selectedGroup.defaultChildSurfaceStyle"
					label="Child fill opacity"
					size="sm"
				>
					<UInputNumber
						:model-value="selectedGroup.defaultChildSurfaceStyle.fillOpacity"
						:min="0"
						:max="1"
						:step="0.05"
						size="sm"
						class="w-full"
						aria-label="Child fill opacity"
						@update:model-value="updateDefaultChildStyle({ fillOpacity: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField
					v-if="selectedGroup.defaultChildSurfaceStyle?.fill.type === 'solid'"
					label="Child fill"
					size="sm"
				>
					<UIColorPicker
						:model-value="selectedGroup.defaultChildSurfaceStyle.fill.color"
						data-testid="graphic-group-child-fill"
						@update:model-value="updateDefaultChildStyle({ fill: { type: 'solid', color: $event?.toString() || '#000000' } })"
					/>
				</UFormField>
			</div>
		</template>

		<template v-if="selectedTextItem">
			<UFormField label="Text" size="sm">
				<UTextarea
					:model-value="selectedTextItem.text"
					:rows="3"
					:maxlength="MAX_GRAPHIC_TEXT_LENGTH"
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

			<!--
				One optional typography override per `{inputKey}` this Graphic Text Template
				names. Literal text always uses the base typography above, and only
				placeholders naming a declared Graphic Input can be styled — styling one
				that nothing declares would style something that renders nothing.
			-->
			<div
				v-for="inputKey in styleablePlaceholders"
				:key="inputKey"
				class="space-y-2 rounded-lg border border-default/70 p-2"
				:data-graphic-placeholder-style="inputKey"
			>
				<div class="flex items-center gap-2">
					<span class="min-w-0 flex-1 truncate font-mono text-xs">{{ placeholderToken(inputKey) }}</span>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						data-testid="graphic-placeholder-style-clear"
						@click="updatePlaceholderStyle(inputKey, null)"
					>
						Use base
					</UButton>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Size" size="xs">
						<UInputNumber
							:model-value="placeholderStyleFor(inputKey).fontSize"
							:min="1"
							size="sm"
							class="w-full"
							data-testid="graphic-placeholder-style-size"
							@update:model-value="updatePlaceholderStyle(inputKey, { fontSize: $event ?? undefined })"
						/>
					</UFormField>
					<UFormField label="Weight" size="xs">
						<UInputNumber
							:model-value="placeholderStyleFor(inputKey).fontWeight"
							:min="100"
							:max="900"
							:step="100"
							size="sm"
							class="w-full"
							data-testid="graphic-placeholder-style-weight"
							@update:model-value="updatePlaceholderStyle(inputKey, { fontWeight: $event ?? undefined })"
						/>
					</UFormField>
					<UFormField label="Colour" size="xs" class="col-span-2">
						<UIColorPicker
							:model-value="placeholderStyleFor(inputKey).color ?? selectedTextItem.typography.color"
							data-testid="graphic-placeholder-style-color"
							@update:model-value="updatePlaceholderStyle(inputKey, { color: $event?.toString() || undefined })"
						/>
					</UFormField>
				</div>
			</div>
		</template>

		<template v-if="selectedGeometry">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Shape Geometry
				</p>
				<UFormField label="Preset" size="sm">
					<USelect
						:items="GEOMETRY_PRESET_OPTIONS"
						value-key="value"
						placeholder="Apply preset..."
						class="w-full"
						data-testid="shape-geometry-preset"
						@update:model-value="applyPreset($event as ShapeGeometryPresetId)"
					/>
				</UFormField>

				<div v-for="corner in SHAPE_CORNER_KEYS" :key="corner" class="grid grid-cols-2 gap-2">
					<UFormField :label="CORNER_LABELS[corner]" size="sm">
						<USelect
							:model-value="selectedGeometry[corner].treatment"
							:items="CORNER_TREATMENT_OPTIONS"
							value-key="value"
							class="w-full"
							:data-testid="`shape-corner-${corner}`"
							@update:model-value="updateCorner(corner, { treatment: $event as never })"
						/>
					</UFormField>
					<UFormField
						v-if="selectedGeometry[corner].treatment !== 'square'"
						label="Size"
						size="sm"
					>
						<UInputNumber
							:model-value="selectedGeometry[corner].size"
							:min="0"
							size="sm"
							class="w-full"
							:aria-label="`${CORNER_LABELS[corner]} size`"
							@update:model-value="updateCorner(corner, { size: $event ?? 0 })"
						/>
					</UFormField>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Left slant" size="sm">
						<UInputNumber
							:model-value="selectedGeometry.leftSlant"
							size="sm"
							class="w-full"
							data-testid="shape-left-slant"
							aria-label="Left edge slant"
							@update:model-value="updateGeometry({ leftSlant: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField label="Right slant" size="sm">
						<UInputNumber
							:model-value="selectedGeometry.rightSlant"
							size="sm"
							class="w-full"
							data-testid="shape-right-slant"
							aria-label="Right edge slant"
							@update:model-value="updateGeometry({ rightSlant: $event ?? 0 })"
						/>
					</UFormField>
				</div>
			</div>
		</template>

		<template v-if="selectedItem">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Graphic Surface Style
				</p>

				<UFormField
					:label="parentGroup ? 'Override group style default' : 'Paint a surface'"
					size="sm"
				>
					<USwitch
						:model-value="ownSurfaceStyle !== null"
						data-testid="surface-style-own"
						@update:model-value="updateOwnSurfaceStyle($event)"
					/>
				</UFormField>

				<template v-if="ownSurfaceStyle">
					<UFormField label="Graphic Fill" size="sm">
						<USelect
							:model-value="ownSurfaceStyle.fill.type"
							:items="FILL_KIND_OPTIONS"
							value-key="value"
							class="w-full"
							data-testid="graphic-fill-kind"
							@update:model-value="updateFillKind($event as never)"
						/>
					</UFormField>

					<UFormField v-if="ownSurfaceStyle.fill.type === 'solid'" label="Fill colour" size="sm">
						<UIColorPicker
							:model-value="ownSurfaceStyle.fill.color"
							data-testid="shape-fill"
							@update:model-value="updateSolidFill($event?.toString() || '#000000')"
						/>
					</UFormField>

					<template v-else>
						<UFormField label="Gradient angle" size="sm">
							<UInputNumber
								:model-value="ownSurfaceStyle.fill.angle"
								:min="-360"
								:max="360"
								size="sm"
								class="w-full"
								data-testid="graphic-fill-angle"
								aria-label="Gradient angle"
								@update:model-value="updateGradientAngle($event ?? 0)"
							/>
						</UFormField>
						<div
							v-for="(stop, index) in ownSurfaceStyle.fill.stops"
							:key="index"
							class="grid grid-cols-3 gap-2"
							data-testid="graphic-fill-stop"
						>
							<UFormField :label="`Stop ${index + 1}`" size="sm">
								<UIColorPicker
									:model-value="stop.color"
									@update:model-value="updateGradientStop(index, { color: $event?.toString() || '#000000' })"
								/>
							</UFormField>
							<UFormField label="At" size="sm">
								<UInputNumber
									:model-value="stop.position"
									:min="0"
									:max="1"
									:step="0.05"
									size="sm"
									class="w-full"
									:aria-label="`Stop ${index + 1} position`"
									@update:model-value="updateGradientStop(index, { position: $event ?? 0 })"
								/>
							</UFormField>
							<UFormField label="Opacity" size="sm">
								<UInputNumber
									:model-value="stop.opacity"
									:min="0"
									:max="1"
									:step="0.05"
									size="sm"
									class="w-full"
									:aria-label="`Stop ${index + 1} opacity`"
									@update:model-value="updateGradientStop(index, { opacity: $event ?? 1 })"
								/>
							</UFormField>
						</div>
						<div class="flex gap-2">
							<UButton
								size="xs"
								variant="soft"
								icon="i-lucide-plus"
								:disabled="ownSurfaceStyle.fill.stops.length >= MAX_GRAPHIC_FILL_STOPS"
								data-testid="graphic-fill-add-stop"
								@click="changeStopCount(1)"
							>
								Stop
							</UButton>
							<UButton
								size="xs"
								variant="soft"
								icon="i-lucide-minus"
								:disabled="ownSurfaceStyle.fill.stops.length <= MIN_GRAPHIC_FILL_STOPS"
								data-testid="graphic-fill-remove-stop"
								@click="changeStopCount(-1)"
							>
								Stop
							</UButton>
						</div>
					</template>

					<UFormField label="Fill opacity" size="sm">
						<UInputNumber
							:model-value="ownSurfaceStyle.fillOpacity"
							:min="0"
							:max="1"
							:step="0.05"
							size="sm"
							class="w-full"
							aria-label="Fill opacity"
							@update:model-value="updateSurfaceStyle({ fillOpacity: $event ?? 1 })"
						/>
					</UFormField>

					<UFormField label="Outline" size="sm">
						<USwitch
							:model-value="ownSurfaceStyle.outline !== undefined"
							data-testid="graphic-outline-enabled"
							@update:model-value="updateOutline($event ? {} : null)"
						/>
					</UFormField>
					<div v-if="ownSurfaceStyle.outline" class="grid grid-cols-2 gap-2">
						<UFormField label="Outline colour" size="sm">
							<UIColorPicker
								:model-value="ownSurfaceStyle.outline.color"
								@update:model-value="updateOutline({ color: $event?.toString() || '#ffffff' })"
							/>
						</UFormField>
						<UFormField label="Outline width" size="sm">
							<UInputNumber
								:model-value="ownSurfaceStyle.outline.width"
								:min="0"
								size="sm"
								class="w-full"
								aria-label="Outline width"
								@update:model-value="updateOutline({ width: $event ?? 0 })"
							/>
						</UFormField>
					</div>

					<UFormField label="Glow" size="sm">
						<USwitch
							:model-value="ownSurfaceStyle.glow !== undefined"
							data-testid="graphic-glow-enabled"
							@update:model-value="updateGlow($event ? {} : null)"
						/>
					</UFormField>
					<div v-if="ownSurfaceStyle.glow" class="grid grid-cols-3 gap-2">
						<UFormField label="Glow colour" size="sm">
							<UIColorPicker
								:model-value="ownSurfaceStyle.glow.color"
								@update:model-value="updateGlow({ color: $event?.toString() || '#ffffff' })"
							/>
						</UFormField>
						<UFormField label="Glow size" size="sm">
							<UInputNumber
								:model-value="ownSurfaceStyle.glow.size"
								:min="0"
								size="sm"
								class="w-full"
								aria-label="Glow size"
								@update:model-value="updateGlow({ size: $event ?? 0 })"
							/>
						</UFormField>
						<UFormField label="Glow opacity" size="sm">
							<UInputNumber
								:model-value="ownSurfaceStyle.glow.opacity"
								:min="0"
								:max="1"
								:step="0.05"
								size="sm"
								class="w-full"
								aria-label="Glow opacity"
								@update:model-value="updateGlow({ opacity: $event ?? 1 })"
							/>
						</UFormField>
					</div>
				</template>
			</div>
		</template>

		<GraphicsCompositorAnimation
			:graphics="graphics"
			:selected-target="selectedTarget"
			:writable="writable"
			@update:graphics="emit('update:graphics', $event)"
		/>
	</fieldset>
</template>
