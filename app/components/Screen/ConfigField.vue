<script setup lang="ts" generic="Value extends string | number | boolean">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';

/**
 * One Screen Mode config field, rendered from its contract metadata (ADR-0037):
 * a number, toggle, select, text or colour control by `field.control`, with its
 * label, bounds and step read from the field, so an editor never writes a
 * literal label or bound for a declared field. The contract-driven twin of
 * `ScreenAnimationEffectFields`.
 *
 * It shows a `displayScale` field in displayed units and emits in stored units.
 * With `nullable`, an emptied field emits the `null` that deletes it
 * (ADR-0041); without it, an emptied number or colour emits nothing, and
 * emptied text emits `''`.
 *
 * A toggle may be feature-gated (`enabled`), as `ScreenSettingsToggle` gates it.
 */
const props = withDefaults(defineProps<{
	field: ScreenModeConfigField;
	modelValue?: Value | null;
	description?: string;
	/** A select's labelled options, each drawn from `field.values`. Unlabelled values when absent. */
	items?: { label: string; value: Value | null }[];
	placeholder?: string;
	nullable?: boolean;
	/** A tighter upper bound than the field's own, in displayed units, such as a page smaller than the ranking. */
	max?: number;
	/** A toggle's feature gate: when `false` it shows off, disabled, with `disabledDescription`, and never writes. */
	enabled?: boolean;
	disabledDescription?: string;
}>(), {
	// Absent is ungated, not a boolean prop's `false`.
	enabled: undefined,
});

const emit = defineEmits<{
	'update:modelValue': [value: Value | null];
}>();

/** A select offers only values its field allows: an enum value outside them would be refused on write. */
function assertItemsInFieldValues(field: ScreenModeConfigField, items: { value: unknown }[] | undefined) {
	if (!items || !field.values)
		return;
	const outside = items.filter(item => item.value !== null && !field.values!.includes(String(item.value)));
	if (outside.length > 0)
		throw new Error(`Select items for "${field.key}" name ${outside.map(item => `"${String(item.value)}"`).join(', ')}, outside its values: ${field.values.join(', ')}.`);
}

if (import.meta.dev || import.meta.test) {
	watch(() => [props.field, props.items] as const, ([field, items]) => assertItemsInFieldValues(field, items), { immediate: true });
}

const selectItems = computed(() => props.items
	?? (props.field.values ?? []).map(value => ({ label: value, value })));

// `USelect` infers its value type from its items, which a generic `Value` defeats.
const selectValue = computed(() => (props.modelValue ?? null) as never);

const numberMax = computed(() => {
	const own = props.field.max;
	if (props.max === undefined)
		return own;
	return own === undefined
		? props.max
		: Math.min(own, props.max);
});

function isEmpty(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

/** An emptied field: `null` when nullable, otherwise nothing, or `fallback` where the control has an empty value of its own. */
function emitEmpty(fallback?: Value) {
	if (props.nullable)
		emit('update:modelValue', null);
	else if (fallback !== undefined)
		emit('update:modelValue', fallback);
}

function updateNumber(value: number | null | undefined) {
	if (isEmpty(value))
		emitEmpty();
	else
		emit('update:modelValue', Number(value) as Value);
}

function updateValue(value: unknown) {
	if (isEmpty(value))
		emitEmpty();
	else
		emit('update:modelValue', value as Value);
}

/** A select's null option, where it offers one, is a choice of its own, `nullable` or not. */
function updateSelect(value: unknown) {
	if (value === null && selectItems.value.some(item => item.value === null))
		emit('update:modelValue', null);
	else
		updateValue(value);
}

function updateText(value: unknown) {
	if (isEmpty(value))
		emitEmpty('' as Value);
	else
		emit('update:modelValue', String(value) as Value);
}
</script>

<template>
	<ScreenSettingsToggle
		v-if="field.control === 'toggle'"
		:data-config-field="field.key"
		:label="field.label"
		:description="description"
		:enabled="enabled"
		:disabled-description="disabledDescription"
		:model-value="modelValue === null || modelValue === undefined ? undefined : Boolean(modelValue)"
		@update:model-value="updateValue($event)"
	/>
	<ScreenSettingsField
		v-else
		:data-config-field="field.key"
		:label="field.label"
		:description="description"
	>
		<ScreenSettingsNumberField
			v-if="field.control === 'number'"
			:model-value="typeof modelValue === 'number' ? modelValue : undefined"
			:min="field.min"
			:max="numberMax"
			:step="field.step"
			:display-scale="field.displayScale"
			@update:model-value="updateNumber($event)"
		/>
		<USelect
			v-else-if="field.control === 'select'"
			:model-value="selectValue"
			:items="selectItems"
			:placeholder="placeholder"
			class="w-48"
			@update:model-value="updateSelect($event)"
		/>
		<UIColorPicker
			v-else-if="field.control === 'color'"
			:model-value="typeof modelValue === 'string' ? modelValue : undefined"
			:placeholder="placeholder"
			@update:model-value="updateValue($event)"
		/>
		<UInput
			v-else
			:model-value="modelValue === null || modelValue === undefined ? '' : String(modelValue)"
			:placeholder="placeholder"
			class="w-64"
			@update:model-value="updateText($event)"
		/>
	</ScreenSettingsField>
</template>
