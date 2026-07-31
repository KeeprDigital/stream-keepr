<script setup lang="ts">
import type { GraphicSurfaceStyleEdit } from '~~/shared/modules/graphics';
import type { GRAPHIC_FILL_KIND_VALUES, GraphicSurfaceStyle } from '~~/shared/types/graphics';
import { MAX_GRAPHIC_FILL_STOPS, MIN_GRAPHIC_FILL_STOPS } from '~~/shared/types/graphics';

/**
 * The property controls for one Graphic Surface Style: its Graphic Fill, fill
 * opacity, uniform outline, and glow.
 *
 * One component rather than one block per surface, because a Game Wins Graphic
 * Item has three — its own, and the two that paint a win box before and after the
 * Player wins it — and every one of them is the same shared visual treatment.
 * What differs between them is only which one is being edited, so this reports
 * *what the author changed* and leaves the caller to say *which surface* it
 * belongs to.
 *
 * Shape Geometry is deliberately absent: corners and slants belong to the
 * geometry, not to the surface painted inside it.
 */
const props = defineProps<{
	/**
	 * The style being edited, or null where the item paints no surface of its own.
	 *
	 * Not named `style`: Vue reserves that name for the element attribute, so a prop
	 * called `style` would never arrive.
	 */
	surfaceStyle: GraphicSurfaceStyle | null;
	title: string;
	/**
	 * The label for the switch that decides whether the item paints a surface at
	 * all. Omitted where the slot is required — a win box always paints one — and
	 * the switch is then not offered.
	 */
	presenceLabel?: string;
	/**
	 * Distinguishes this surface's controls from a sibling's. Empty for an item's
	 * own Graphic Surface Style, which is the one every host has always had.
	 */
	testIdPrefix?: string;
}>();

const emit = defineEmits<{ edit: [edit: GraphicSurfaceStyleEdit] }>();

const FILL_KIND_OPTIONS = [
	{ label: 'Solid', value: 'solid' },
	{ label: 'Linear gradient', value: 'linear-gradient' },
] satisfies Array<{ label: string; value: typeof GRAPHIC_FILL_KIND_VALUES[number] }>;

function testId(suffix: string): string {
	return props.testIdPrefix ? `${props.testIdPrefix}-${suffix}` : suffix;
}
</script>

<template>
	<div class="rounded-lg border border-default/70 p-3 space-y-2">
		<p class="text-xs font-semibold text-muted">
			{{ title }}
		</p>

		<!--
			Where this surface inherits from, when the composition is linked to a Graphic
			Style Set. A slot rather than props for the same reason the surface itself is
			reported as an edit: this component knows what a Graphic Surface Style is and
			deliberately not *which* one it is, and a Style Set reference is a fact about
			which one. The caller already says that, so it fills this in too — and a
			caller with no Style Set fills in nothing.
		-->
		<slot name="style-ref" />

		<UFormField v-if="presenceLabel" :label="presenceLabel" size="sm">
			<USwitch
				:model-value="surfaceStyle !== null"
				:data-testid="testId('surface-style-own')"
				@update:model-value="emit('edit', { kind: 'present', present: $event })"
			/>
		</UFormField>

		<template v-if="surfaceStyle">
			<UFormField label="Graphic Fill" size="sm">
				<USelect
					:model-value="surfaceStyle.fill.type"
					:items="FILL_KIND_OPTIONS"
					value-key="value"
					class="w-full"
					:data-testid="testId('graphic-fill-kind')"
					@update:model-value="emit('edit', { kind: 'fill-kind', fillKind: $event as never })"
				/>
			</UFormField>

			<UFormField v-if="surfaceStyle.fill.type === 'solid'" label="Fill colour" size="sm">
				<UIColorPicker
					:model-value="surfaceStyle.fill.color"
					:data-testid="testId('shape-fill')"
					@update:model-value="emit('edit', { kind: 'solid-fill', color: $event?.toString() || '#000000' })"
				/>
			</UFormField>

			<template v-else>
				<UFormField label="Gradient angle" size="sm">
					<UInputNumber
						:model-value="surfaceStyle.fill.angle"
						:min="-360"
						:max="360"
						size="sm"
						class="w-full"
						:data-testid="testId('graphic-fill-angle')"
						:aria-label="`${title} gradient angle`"
						@update:model-value="emit('edit', { kind: 'gradient-angle', angle: $event ?? 0 })"
					/>
				</UFormField>
				<div
					v-for="(stop, index) in surfaceStyle.fill.stops"
					:key="index"
					class="grid grid-cols-3 gap-2"
					:data-testid="testId('graphic-fill-stop')"
				>
					<UFormField :label="`Stop ${index + 1}`" size="sm">
						<UIColorPicker
							:model-value="stop.color"
							@update:model-value="emit('edit', { kind: 'gradient-stop', index, patch: { color: $event?.toString() || '#000000' } })"
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
							:aria-label="`${title} stop ${index + 1} position`"
							@update:model-value="emit('edit', { kind: 'gradient-stop', index, patch: { position: $event ?? 0 } })"
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
							:aria-label="`${title} stop ${index + 1} opacity`"
							@update:model-value="emit('edit', { kind: 'gradient-stop', index, patch: { opacity: $event ?? 1 } })"
						/>
					</UFormField>
				</div>
				<div class="flex gap-2">
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-plus"
						:disabled="surfaceStyle.fill.stops.length >= MAX_GRAPHIC_FILL_STOPS"
						:data-testid="testId('graphic-fill-add-stop')"
						@click="emit('edit', { kind: 'stop-count', delta: 1 })"
					>
						Stop
					</UButton>
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-minus"
						:disabled="surfaceStyle.fill.stops.length <= MIN_GRAPHIC_FILL_STOPS"
						:data-testid="testId('graphic-fill-remove-stop')"
						@click="emit('edit', { kind: 'stop-count', delta: -1 })"
					>
						Stop
					</UButton>
				</div>
			</template>

			<UFormField label="Fill opacity" size="sm">
				<UInputNumber
					:model-value="surfaceStyle.fillOpacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					:aria-label="`${title} fill opacity`"
					@update:model-value="emit('edit', { kind: 'fill-opacity', fillOpacity: $event ?? 1 })"
				/>
			</UFormField>

			<UFormField label="Outline" size="sm">
				<USwitch
					:model-value="surfaceStyle.outline !== undefined"
					:data-testid="testId('graphic-outline-enabled')"
					@update:model-value="emit('edit', { kind: 'outline', patch: $event ? {} : null })"
				/>
			</UFormField>
			<div v-if="surfaceStyle.outline" class="grid grid-cols-2 gap-2">
				<UFormField label="Outline colour" size="sm">
					<UIColorPicker
						:model-value="surfaceStyle.outline.color"
						@update:model-value="emit('edit', { kind: 'outline', patch: { color: $event?.toString() || '#ffffff' } })"
					/>
				</UFormField>
				<UFormField label="Outline width" size="sm">
					<UInputNumber
						:model-value="surfaceStyle.outline.width"
						:min="0"
						size="sm"
						class="w-full"
						:aria-label="`${title} outline width`"
						@update:model-value="emit('edit', { kind: 'outline', patch: { width: $event ?? 0 } })"
					/>
				</UFormField>
			</div>

			<UFormField label="Glow" size="sm">
				<USwitch
					:model-value="surfaceStyle.glow !== undefined"
					:data-testid="testId('graphic-glow-enabled')"
					@update:model-value="emit('edit', { kind: 'glow', patch: $event ? {} : null })"
				/>
			</UFormField>
			<div v-if="surfaceStyle.glow" class="grid grid-cols-3 gap-2">
				<UFormField label="Glow colour" size="sm">
					<UIColorPicker
						:model-value="surfaceStyle.glow.color"
						@update:model-value="emit('edit', { kind: 'glow', patch: { color: $event?.toString() || '#ffffff' } })"
					/>
				</UFormField>
				<UFormField label="Glow size" size="sm">
					<UInputNumber
						:model-value="surfaceStyle.glow.size"
						:min="0"
						size="sm"
						class="w-full"
						:aria-label="`${title} glow size`"
						@update:model-value="emit('edit', { kind: 'glow', patch: { size: $event ?? 0 } })"
					/>
				</UFormField>
				<UFormField label="Glow opacity" size="sm">
					<UInputNumber
						:model-value="surfaceStyle.glow.opacity"
						:min="0"
						:max="1"
						:step="0.05"
						size="sm"
						class="w-full"
						:aria-label="`${title} glow opacity`"
						@update:model-value="emit('edit', { kind: 'glow', patch: { opacity: $event ?? 1 } })"
					/>
				</UFormField>
			</div>
		</template>
	</div>
</template>
