<script setup lang="ts">
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { GraphicFill, GraphicFillKind } from '~~/shared/types/graphics';
import { MAX_GRAPHIC_FILL_STOPS, MIN_GRAPHIC_FILL_STOPS } from '~~/shared/types/graphics';

/**
 * The one Graphic Fill fields control, for a Graphic Item's own fill (through a
 * Graphic Surface Style) and a Graphic Style Set fill entry.
 *
 * It is presentational: it shows a Graphic Fill and reports each change as a
 * `GraphicFillEdit`, leaving the host to apply it (`applyGraphicSurfaceStyleEdit`
 * for an item, `applyGraphicStyleFillEntryEdit` for an entry), so both get the
 * same two to four gradient stops by the same rules.
 *
 * The colour field is the `color` slot, as in the border and glow fields: an item
 * takes the default hex picker, and a Style Set entry passes a palette entry
 * picker, so its fill's colours are palette entry ids.
 */
const props = withDefaults(defineProps<{
	fill: GraphicFill;
	disabled?: boolean;
	size?: 'xs' | 'sm';
	/** Qualifies accessible names where one form shows several surfaces. */
	ariaLabelPrefix?: string;
	/** Prefixes every test id: `<prefix>-kind`, `<prefix>-color`, `<prefix>-stop`… */
	testIdPrefix?: string;
}>(), {
	size: 'sm',
	testIdPrefix: 'graphic-fill',
});

const emit = defineEmits<{ edit: [edit: GraphicFillEdit] }>();

defineSlots<{
	/** Replaces the colour picker for a solid fill's colour and each stop's. */
	color?: (props: {
		value: string;
		label: string;
		disabled: boolean;
		testId: string;
		update: (value: string) => void;
	}) => unknown;
}>();

const FILL_KIND_OPTIONS = [
	{ label: 'Solid', value: 'solid' },
	{ label: 'Linear gradient', value: 'linear-gradient' },
] satisfies Array<{ label: string; value: GraphicFillKind }>;

/** "Stop 1 colour" alone; "Win box stop 1 colour" where a prefix tells surfaces apart. */
function ariaLabel(label: string) {
	return props.ariaLabelPrefix ? `${props.ariaLabelPrefix} ${label.toLowerCase()}` : label;
}

function testId(suffix: string) {
	return `${props.testIdPrefix}-${suffix}`;
}

/** The default picker's colour; a cleared one is black. */
function pickedColor(value: unknown) {
	return value?.toString() || '#000000';
}

function editSolid(color: string) {
	emit('edit', { kind: 'solid-fill', color });
}

function editStop(index: number, patch: Extract<GraphicFillEdit, { kind: 'gradient-stop' }>['patch']) {
	emit('edit', { kind: 'gradient-stop', index, patch });
}
</script>

<template>
	<div class="space-y-2">
		<UFormField label="Graphic Fill" :size="size">
			<USelect
				:model-value="fill.type"
				:items="FILL_KIND_OPTIONS"
				value-key="value"
				:size="size"
				class="w-full"
				:disabled="disabled"
				:aria-label="ariaLabel('Graphic Fill')"
				:data-testid="testId('kind')"
				@update:model-value="emit('edit', { kind: 'fill-kind', fillKind: $event as GraphicFillKind })"
			/>
		</UFormField>

		<UFormField v-if="fill.type === 'solid'" label="Fill colour" :size="size">
			<slot
				name="color"
				:value="fill.color"
				:label="ariaLabel('Fill colour')"
				:disabled="disabled"
				:test-id="testId('color')"
				:update="editSolid"
			>
				<UIColorPicker
					:model-value="fill.color"
					:disabled="disabled"
					:size="size"
					:aria-label="ariaLabel('Fill colour')"
					:data-testid="testId('color')"
					@update:model-value="editSolid(pickedColor($event))"
				/>
			</slot>
		</UFormField>

		<template v-else>
			<UFormField label="Gradient angle" :size="size">
				<UInputNumber
					:model-value="fill.angle"
					:min="-360"
					:max="360"
					:size="size"
					:disabled="disabled"
					class="w-full"
					:aria-label="ariaLabel('Gradient angle')"
					:data-testid="testId('angle')"
					@update:model-value="emit('edit', { kind: 'gradient-angle', angle: $event ?? 0 })"
				/>
			</UFormField>
			<div
				v-for="(stop, index) in fill.stops"
				:key="index"
				class="grid grid-cols-3 gap-2"
				:data-testid="testId('stop')"
			>
				<UFormField :label="`Stop ${index + 1}`" :size="size">
					<slot
						name="color"
						:value="stop.color"
						:label="ariaLabel(`Stop ${index + 1} colour`)"
						:disabled="disabled"
						:test-id="testId('stop-color')"
						:update="(color: string) => editStop(index, { color })"
					>
						<UIColorPicker
							:model-value="stop.color"
							:disabled="disabled"
							:size="size"
							:aria-label="ariaLabel(`Stop ${index + 1} colour`)"
							:data-testid="testId('stop-color')"
							@update:model-value="editStop(index, { color: pickedColor($event) })"
						/>
					</slot>
				</UFormField>
				<UFormField label="Position" :size="size">
					<UInputNumber
						:model-value="stop.position"
						:min="0"
						:max="1"
						:step="0.05"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel(`Stop ${index + 1} position`)"
						@update:model-value="editStop(index, { position: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Opacity" :size="size">
					<UIOpacityInput
						:model-value="stop.opacity"
						:size="size"
						:disabled="disabled"
						class="w-full"
						:aria-label="ariaLabel(`Stop ${index + 1} opacity`)"
						@update:model-value="editStop(index, { opacity: $event ?? 1 })"
					/>
				</UFormField>
			</div>
			<div class="flex gap-2">
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-plus"
					:disabled="disabled || fill.stops.length >= MAX_GRAPHIC_FILL_STOPS"
					:data-testid="testId('add-stop')"
					@click="emit('edit', { kind: 'stop-count', delta: 1 })"
				>
					Stop
				</UButton>
				<UButton
					size="xs"
					variant="soft"
					icon="i-lucide-minus"
					:disabled="disabled || fill.stops.length <= MIN_GRAPHIC_FILL_STOPS"
					:data-testid="testId('remove-stop')"
					@click="emit('edit', { kind: 'stop-count', delta: -1 })"
				>
					Stop
				</UButton>
			</div>
		</template>
	</div>
</template>
