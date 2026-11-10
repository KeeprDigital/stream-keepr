<script setup lang="ts">
import type { BorderFieldsValue, BorderGlowEdit, GlowFieldsValue } from '~/types/borderGlow';
import { OPACITY_INPUT } from '~/utils/opacityInput';

/**
 * The one border and glow fields control, for a Graphic Surface Style's
 * outline and glow wherever one is edited: a Graphic Item and a Theme.
 *
 * It is presentational: it shows a neutral, uniform border and glow and
 * reports each change as a `BorderGlowEdit`, leaving the host to say what it
 * stores. The host names its border with `borderLabel`. The colour field is
 * the `color` slot, so a host can offer its own colour picker.
 */
const props = withDefaults(defineProps<{
	/** What the host calls its border: "Outline". */
	borderLabel: string;
	/** The border, or null while it is off. */
	border: BorderFieldsValue | null;
	/** The glow, or null while it is off. */
	glow: GlowFieldsValue | null;
	/** The default colour picker accepts complete `#rrggbb` values only. */
	hexOnly?: boolean;
	disabled?: boolean;
	size?: 'xs' | 'sm';
	/** Qualifies accessible names where one form shows several surfaces. */
	ariaLabelPrefix?: string;
	borderTestId?: string;
	glowTestId?: string;
}>(), {
	size: 'sm',
});

const emit = defineEmits<{ edit: [edit: BorderGlowEdit] }>();

defineSlots<{
	/** Replaces the colour picker for the border's colour and the glow's. */
	color?: (props: {
		target: 'border' | 'glow';
		value: string | undefined;
		label: string;
		disabled: boolean;
		update: (value: string | undefined) => void;
	}) => unknown;
}>();

/** The UI bound for border width and glow size; every host's schema allows at least this. */
const MAX_PIXELS = 500;

/** "Outline width" alone; "Won box outline width" where a prefix tells surfaces apart. */
function ariaLabel(label: string) {
	return props.ariaLabelPrefix
		? `${props.ariaLabelPrefix} ${label.toLowerCase()}`
		: label;
}

function editBorder(patch: Partial<BorderFieldsValue> | null) {
	emit('edit', { kind: 'border', patch });
}

function editGlow(patch: Partial<GlowFieldsValue> | null) {
	emit('edit', { kind: 'glow', patch });
}
</script>

<template>
	<div class="space-y-3">
		<UFormField :label="borderLabel" :size="size">
			<USwitch
				:model-value="border !== null"
				:disabled="disabled"
				:aria-label="ariaLabel(borderLabel)"
				:data-testid="borderTestId"
				@update:model-value="editBorder($event ? {} : null)"
			/>
		</UFormField>

		<div v-if="border" class="grid grid-cols-2 gap-2">
			<UFormField :label="`${borderLabel} colour`" :size="size">
				<slot
					name="color"
					target="border"
					:value="border.color"
					:label="ariaLabel(`${borderLabel} colour`)"
					:disabled="disabled"
					:update="(value: string | undefined) => editBorder({ color: value })"
				>
					<UIColorPicker
						:model-value="border.color"
						v-bind="hexOnly ? { hexOnly: true } : { alpha: true }"
						:disabled="disabled"
						:size="size"
						:aria-label="ariaLabel(`${borderLabel} colour`)"
						@update:model-value="color => color && editBorder({ color })"
					/>
				</slot>
			</UFormField>
			<GraphicsNumberField
				:label="`${borderLabel} width`"
				:size="size"
				:model-value="border.width"
				:min="0"
				:max="MAX_PIXELS"
				:disabled="disabled"
				:aria-label="ariaLabel(`${borderLabel} width`)"
				@update:model-value="editBorder({ width: $event ?? 0 })"
			/>
		</div>

		<UFormField label="Glow" :size="size">
			<USwitch
				:model-value="glow !== null"
				:disabled="disabled"
				:aria-label="ariaLabel('Glow')"
				:data-testid="glowTestId"
				@update:model-value="editGlow($event ? {} : null)"
			/>
		</UFormField>

		<div v-if="glow" class="grid grid-cols-3 gap-2">
			<UFormField label="Glow colour" :size="size">
				<slot
					name="color"
					target="glow"
					:value="glow.color"
					:label="ariaLabel('Glow colour')"
					:disabled="disabled"
					:update="(value: string | undefined) => editGlow({ color: value })"
				>
					<UIColorPicker
						:model-value="glow.color"
						:hex-only="hexOnly"
						:disabled="disabled"
						:size="size"
						:aria-label="ariaLabel('Glow colour')"
						@update:model-value="color => color && editGlow({ color })"
					/>
				</slot>
			</UFormField>
			<GraphicsNumberField
				label="Glow size"
				:size="size"
				:model-value="glow.size"
				:min="0"
				:max="MAX_PIXELS"
				:disabled="disabled"
				:aria-label="ariaLabel('Glow size')"
				@update:model-value="editGlow({ size: $event ?? 0 })"
			/>
			<GraphicsNumberField
				label="Glow opacity"
				:size="size"
				v-bind="OPACITY_INPUT"
				:model-value="glow.opacity"
				:disabled="disabled"
				:aria-label="ariaLabel('Glow opacity')"
				@update:model-value="editGlow({ opacity: $event ?? 1 })"
			/>
		</div>
	</div>
</template>
