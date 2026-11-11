<script setup lang="ts">
import type { SettingsPageField } from '~/modules/screen-mode/settingsPage';
import { fieldDescription, fieldLabel, fieldOptions, fieldValue } from '~/modules/screen-mode/settingsPage';

/**
 * One contract field's control on a generic settings page (#1094): a plain
 * control by its kind (`ScreenConfigField`), its Event Reference kind's picker
 * (ADR-0038), or a set's checkboxes, labelled, described and offered as its
 * editor description says for this Screen. It emits the field's new value;
 * the page writes the patch naming the field.
 */
const props = defineProps<{
	entry: SettingsPageField;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [value: unknown];
}>();

const field = computed(() => ({
	...props.entry.field,
	label: fieldLabel(props.entry),
}));
const description = computed(() => fieldDescription(props.entry));
const value = computed(() => fieldValue(props.entry));
const items = computed(() => fieldOptions(props.entry));
/** A plain control's value; its contract's schema fixes which of these it is. */
const plainValue = computed(() => value.value as string | number | boolean | null | undefined);
const referenceId = computed(() => typeof value.value === 'number'
	? value.value
	: null);
const nullLabel = computed(() => props.entry.field.placeholder);
const setValue = computed(() => Array.isArray(value.value)
	? value.value as string[]
	: []);
const setItems = computed(() => items.value
	?? (props.entry.field.values ?? []).map(option => ({ label: option, value: option })));
</script>

<template>
	<template v-if="field.control === 'reference'">
		<ScreenRoundField
			v-if="field.reference === 'round'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenPlayerField
			v-else-if="field.reference === 'player'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenPlayerListField
			v-else-if="field.reference === 'playerList'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenFeatureMatchSlotField
			v-else-if="field.reference === 'featureMatchSlot'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			detailed
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenArchetypeField
			v-else-if="field.reference === 'archetype'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenPhaseField
			v-else-if="field.reference === 'phase'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			:event-id="eventId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenTalentField
			v-else-if="field.reference === 'talent'"
			:label="field.label"
			:description="description"
			:model-value="referenceId"
			v-bind="nullLabel ? { nullLabel } : {}"
			@update:model-value="emit('update', $event)"
		/>
	</template>
	<ScreenSettingsField
		v-else-if="field.control === 'set'"
		:label="field.label"
		:description="description"
	>
		<UCheckboxGroup
			:model-value="setValue"
			:items="setItems"
			orientation="horizontal"
			@update:model-value="emit('update', $event)"
		/>
	</ScreenSettingsField>
	<ScreenConfigField
		v-else
		:field="field"
		:model-value="plainValue"
		:description="description"
		:items="items"
		:placeholder="field.placeholder"
		:nullable="field.clearable"
		@update:model-value="emit('update', field.control === 'toggle' ? $event === true : $event)"
	/>
</template>
