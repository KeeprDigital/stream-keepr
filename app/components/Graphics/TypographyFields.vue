<script setup lang="ts">
import type { GraphicTypography } from '~~/shared/types/graphics';
import { DEFAULT_GRAPHIC_TYPOGRAPHY } from '~~/shared/modules/graphics';
import { THEME_TYPOGRAPHY_BOUNDS } from '~~/shared/modules/theme';
import {
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_FONT_SIZE,
	MAX_GRAPHIC_FONT_WEIGHT,
	MAX_GRAPHIC_LETTER_SPACING,
	MAX_GRAPHIC_LINE_HEIGHT,
	MIN_GRAPHIC_FONT_SIZE,
	MIN_GRAPHIC_FONT_WEIGHT,
	MIN_GRAPHIC_LETTER_SPACING,
	MIN_GRAPHIC_LINE_HEIGHT,
} from '~~/shared/types/graphics';

/**
 * The one typography editor, for a Graphic Item's base typography, a Graphic
 * Placeholder Style and a Theme's typography token.
 *
 * It owns the grid every one of them shares — size, weight, letter spacing, line
 * height, style and case — with the bounds each one's schema accepts, and emits
 * one field at a time, held within those bounds. What differs between the hosts
 * is which font they may name and how they name a colour, so both are slots: the
 * font above the grid, the colour inside it (where a host may add its own cells,
 * as the Inspector adds text alignment).
 *
 * `variant` says which typography it edits:
 * - `base` names every value, so a cleared field returns to the default typography.
 * - `placeholder` is a Graphic Placeholder Style: every value is optional and an
 *   absent one is the item's base typography. A cleared field emits `undefined`,
 *   style and case offer "same as base", and line height is absent because it lays
 *   out the whole text block rather than one run inside it.
 * - `theme` is a typography token: no size, which each consumer owns, and no
 *   style; letter spacing is in em, and the bounds are the token's. A cleared
 *   field emits nothing, since a token names every value.
 */
type TypographyFieldKey = 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight' | 'fontStyle' | 'textTransform';
type TypographyFieldValues = Pick<GraphicTypography, TypographyFieldKey>;
type NumericKey = 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight';

const props = withDefaults(defineProps<{
	typography: Partial<TypographyFieldValues>;
	variant?: 'base' | 'placeholder' | 'theme';
	disabled?: boolean;
	size?: 'sm' | 'xs';
	/** Distinguishes this control's fields from another typography control on the panel. */
	testIdPrefix: string;
	/** Qualifies accessible names where one form shows several typographies. */
	ariaLabelPrefix?: string;
}>(), {
	variant: 'base',
	size: 'sm',
});

const emit = defineEmits<{ update: [patch: Partial<TypographyFieldValues>] }>();

const BASE_OPTION = { label: 'Same as base', value: 'base' } as const;

interface NumberFieldSpec {
	key: NumericKey;
	label: string;
	ariaLabel: string;
	testId: string;
	min: number;
	max: number;
	step: number | undefined;
}

const GRAPHIC_FIELDS: NumberFieldSpec[] = [
	{
		key: 'fontSize',
		label: 'Size',
		ariaLabel: 'Font size',
		testId: 'size',
		min: MIN_GRAPHIC_FONT_SIZE,
		max: MAX_GRAPHIC_FONT_SIZE,
		step: undefined,
	},
	{
		key: 'fontWeight',
		label: 'Weight',
		ariaLabel: 'Font weight',
		testId: 'weight',
		min: MIN_GRAPHIC_FONT_WEIGHT,
		max: MAX_GRAPHIC_FONT_WEIGHT,
		step: undefined,
	},
	{
		key: 'letterSpacing',
		label: 'Letter spacing',
		ariaLabel: 'Letter spacing',
		testId: 'letter-spacing',
		min: MIN_GRAPHIC_LETTER_SPACING,
		max: MAX_GRAPHIC_LETTER_SPACING,
		step: undefined,
	},
	{
		key: 'lineHeight',
		label: 'Line height',
		ariaLabel: 'Line height',
		testId: 'line-height',
		min: MIN_GRAPHIC_LINE_HEIGHT,
		max: MAX_GRAPHIC_LINE_HEIGHT,
		step: 0.05,
	},
];

const THEME_FIELDS: NumberFieldSpec[] = [
	{
		key: 'fontWeight',
		label: 'Weight',
		ariaLabel: 'Font weight',
		testId: 'weight',
		...THEME_TYPOGRAPHY_BOUNDS.weight,
		step: 100,
	},
	{
		key: 'letterSpacing',
		label: 'Letter spacing (em)',
		ariaLabel: 'Letter spacing',
		testId: 'letter-spacing',
		...THEME_TYPOGRAPHY_BOUNDS.tracking,
		step: 0.01,
	},
	{
		key: 'lineHeight',
		label: 'Line height',
		ariaLabel: 'Line height',
		testId: 'line-height',
		...THEME_TYPOGRAPHY_BOUNDS.lineHeight,
		step: 0.05,
	},
];

const numberFields = computed(() => {
	switch (props.variant) {
		case 'theme':
			return THEME_FIELDS;
		// Line height lays out the whole block, so a placeholder's run cannot set it.
		case 'placeholder':
			return GRAPHIC_FIELDS.filter(field => field.key !== 'lineHeight');
		default:
			return GRAPHIC_FIELDS;
	}
});

const inheritable = computed(() => props.variant === 'placeholder');

const fontStyleOptions = computed(() => [
	...(inheritable.value
		? [BASE_OPTION]
		: []),
	...GRAPHIC_FONT_STYLE_VALUES.map(value => ({
		label: optionLabel(value),
		value,
	})),
]);

const caseOptions = computed(() => [
	...(inheritable.value
		? [BASE_OPTION]
		: []),
	...GRAPHIC_TEXT_TRANSFORM_VALUES.map(value => ({
		label: optionLabel(value),
		value,
	})),
]);

/** "Font weight" alone; "Heading font weight" where a prefix tells typographies apart. */
function ariaLabel(label: string) {
	return props.ariaLabelPrefix
		? `${props.ariaLabelPrefix} ${label.toLowerCase()}`
		: label;
}

function updateNumber(field: NumberFieldSpec, value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		if (props.variant === 'theme')
			return;
		emit('update', {
			[field.key]: inheritable.value ? undefined : DEFAULT_GRAPHIC_TYPOGRAPHY[field.key],
		});
		return;
	}
	const bounded = Math.min(field.max, Math.max(field.min, value));
	emit('update', {
		[field.key]: field.key === 'fontWeight'
			? Math.round(bounded)
			: bounded,
	});
}

function updateChoice(key: 'fontStyle' | 'textTransform', value: string) {
	emit('update', {
		[key]: value === BASE_OPTION.value
			? undefined
			: value,
	});
}

/** An unset choice reads as "same as base" in the placeholder variant, the only one it can be unset in. */
const unsetChoice = computed(() => inheritable.value ? BASE_OPTION.value : undefined);
</script>

<template>
	<slot name="font" />

	<div class="grid grid-cols-2 gap-2" :data-testid="`${testIdPrefix}-grid`">
		<GraphicsNumberField
			v-for="field in numberFields"
			:key="field.key"
			:label="field.label"
			:size="size"
			:model-value="typography[field.key]"
			:min="field.min"
			:max="field.max"
			:step="field.step"
			:disabled="disabled"
			:aria-label="ariaLabel(field.ariaLabel)"
			:data-testid="`${testIdPrefix}-${field.testId}`"
			@update:model-value="updateNumber(field, $event)"
		/>
		<UFormField v-if="variant !== 'theme'" label="Style" :size="size">
			<USelect
				:model-value="typography.fontStyle ?? unsetChoice"
				:items="fontStyleOptions"
				value-key="value"
				:size="size"
				class="w-full"
				:disabled="disabled"
				:aria-label="ariaLabel('Font style')"
				:data-testid="`${testIdPrefix}-font-style`"
				@update:model-value="updateChoice('fontStyle', $event)"
			/>
		</UFormField>
		<UFormField label="Case" :size="size">
			<USelect
				:model-value="typography.textTransform ?? unsetChoice"
				:items="caseOptions"
				value-key="value"
				:size="size"
				class="w-full"
				:disabled="disabled"
				:aria-label="ariaLabel('Case')"
				:data-testid="`${testIdPrefix}-case`"
				@update:model-value="updateChoice('textTransform', $event)"
			/>
		</UFormField>
		<slot name="color" />
	</div>
</template>
