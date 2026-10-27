<script setup lang="ts">
import type { ThemeTypography } from '~~/shared/modules/theme';
import type { GraphicFontSource } from '~~/shared/types/graphics';
import { DEFAULT_GRAPHIC_FONT_ID } from '~~/shared/modules/graphics/typography';
import { GRAPHIC_TEXT_TRANSFORM_VALUES } from '~~/shared/types/graphics';

// A typography token: an application font or one exact library font revision
// (ADR-0050), and how it is set. It has no size; each consumer owns its own.
// Each field commits the whole token.

const props = defineProps<{
	modelValue: ThemeTypography;
	label: string;
	/** The Event whose adopted assets the font picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: ThemeTypography];
}>();

const WEIGHT_ITEMS = [
	100,
	200,
	300,
	400,
	500,
	600,
	700,
	800,
	900,
].map(weight => ({
	label: String(weight),
	value: weight,
}));
const CASE_LABELS: Record<ThemeTypography['case'], string> = {
	none: 'As written',
	uppercase: 'Uppercase',
	lowercase: 'Lowercase',
	capitalize: 'Capitalised',
};
const CASE_ITEMS = GRAPHIC_TEXT_TRANSFORM_VALUES.map(value => ({ label: CASE_LABELS[value], value }));

function commit(patch: Partial<ThemeTypography>) {
	emit('commit', {
		...props.modelValue,
		...patch,
	});
}

/**
 * The font arm shown, held here: choosing "Library font" pins nothing until a
 * revision is picked, and a typography token must always name a font.
 */
const fontSource = ref<GraphicFontSource>(props.modelValue.font.kind);
watch(() => props.modelValue.font.kind, (kind) => {
	fontSource.value = kind;
});

function chooseFontSource(source: GraphicFontSource) {
	fontSource.value = source;
	if (source === 'application' && props.modelValue.font.kind !== 'application')
		commit({ font: { kind: 'application', fontId: DEFAULT_GRAPHIC_FONT_ID } });
}

function commitNumber(field: 'lineHeight' | 'tracking', value: number | null | undefined) {
	if (typeof value === 'number' && Number.isFinite(value) && value !== props.modelValue[field])
		commit({ [field]: value });
}
</script>

<template>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
		<div class="flex flex-col gap-2 sm:col-span-2" data-token-part="font" :data-font-kind="modelValue.font.kind">
			<GraphicsCompositorFontSelectionField
				:source="fontSource"
				:font="modelValue.font"
				:event-id="eventId"
				:field-label="`${label} font`"
				size="sm"
				:test-id-prefix="`theme-${label}`"
				@update:source="chooseFontSource"
				@application="fontId => commit({ font: { kind: 'application', fontId } })"
				@select="(_asset, reference) => commit({ font: { kind: 'asset', reference } })"
				@clear="chooseFontSource('application')"
			/>
		</div>
		<UFormField label="Weight">
			<USelect
				:model-value="modelValue.weight"
				:items="WEIGHT_ITEMS"
				size="sm"
				class="w-full"
				:aria-label="`${label} weight`"
				data-token-part="weight"
				@update:model-value="weight => commit({ weight })"
			/>
		</UFormField>
		<UFormField label="Line height">
			<UInputNumber
				:model-value="modelValue.lineHeight"
				:min="0.5"
				:max="3"
				:step="0.05"
				size="sm"
				:aria-label="`${label} line height`"
				data-token-part="line-height"
				@update:model-value="value => commitNumber('lineHeight', value)"
			/>
		</UFormField>
		<UFormField label="Tracking (em)">
			<UInputNumber
				:model-value="modelValue.tracking"
				:min="-0.5"
				:max="1"
				:step="0.01"
				size="sm"
				:aria-label="`${label} tracking`"
				data-token-part="tracking"
				@update:model-value="value => commitNumber('tracking', value)"
			/>
		</UFormField>
		<UFormField label="Case" class="col-span-2 sm:col-span-5">
			<USelect
				:model-value="modelValue.case"
				:items="CASE_ITEMS"
				size="sm"
				class="w-48"
				:aria-label="`${label} case`"
				data-token-part="case"
				@update:model-value="value => commit({ case: value })"
			/>
		</UFormField>
	</div>
</template>
