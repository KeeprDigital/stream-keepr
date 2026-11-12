<script setup lang="ts">
import type { Component } from 'vue';
import type { DeckSource } from '~~/shared/screenModeConfigs/deck';
import type { EventReferenceKind } from '~~/shared/screenModeConfigs/eventReferences';
import type { SettingsPageField } from '~/modules/screen-mode/settingsPage';
import ScreenArchetypeField from '~/components/Screen/ArchetypeField.vue';
import ScreenFeatureMatchSlotField from '~/components/Screen/FeatureMatchSlotField.vue';
import ScreenPhaseField from '~/components/Screen/PhaseField.vue';
import ScreenPlayerField from '~/components/Screen/PlayerField.vue';
import ScreenPlayerListField from '~/components/Screen/PlayerListField.vue';
import ScreenRoundField from '~/components/Screen/RoundField.vue';
import ScreenTalentField from '~/components/Screen/TalentField.vue';
import { fieldDescription, fieldLabel, fieldOptions, fieldValue } from '~/modules/screen-mode/settingsPage';

const props = defineProps<{
	entry: SettingsPageField;
	eventId: number;
	/** Its control alone, named by its label, in a row its group's title labels. */
	inline?: boolean;
}>();

const emit = defineEmits<{
	update: [value: unknown];
}>();

/**
 * One contract field's control on a generic settings page (#1094): a plain
 * control by its kind (`ScreenConfigField`), its Event Reference kind's picker
 * (ADR-0038), or a set's checkboxes, labelled, described, offered and bounded
 * as its editor description says for this Screen. It emits the field's new
 * value, a set's in the order its values run; the page writes the patch
 * naming the field.
 */
/**
 * The picker of each Event Reference kind naming one id, and what it takes
 * beyond its label, description, value and none label. A Deck Source is a
 * union, so it has a picker of its own.
 */
const ID_PICKERS: Partial<Record<EventReferenceKind, { picker: Component; withEvent: boolean; props?: Record<string, unknown> }>> = {
	round: { picker: ScreenRoundField, withEvent: true },
	player: { picker: ScreenPlayerField, withEvent: true },
	playerList: { picker: ScreenPlayerListField, withEvent: true },
	featureMatchSlot: {
		picker: ScreenFeatureMatchSlotField,
		withEvent: true,
		props: { detailed: true },
	},
	archetype: { picker: ScreenArchetypeField, withEvent: true },
	phase: { picker: ScreenPhaseField, withEvent: true },
	// The Event's Talents ride on the Event itself.
	talent: { picker: ScreenTalentField, withEvent: false },
};

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
const idPicker = computed(() => props.entry.field.reference === undefined
	? undefined
	: ID_PICKERS[props.entry.field.reference]);
const idPickerProps = computed(() => ({
	label: field.value.label,
	description: description.value,
	modelValue: referenceId.value,
	...(nullLabel.value
		? { nullLabel: nullLabel.value }
		: {}),
	...(idPicker.value?.withEvent
		? { eventId: props.eventId }
		: {}),
	...idPicker.value?.props,
}));
/** A bound following the Screen's content, in displayed units. */
const contentMax = computed(() => {
	const max = props.entry.field.maxFor?.(props.entry.context);
	return max === undefined
		? undefined
		: max / props.entry.field.displayScale;
});

/** A set with `value` checked or not, in the order its values run, whatever order they were picked in. */
function toggledSet(value: string, checked: boolean): string[] {
	const chosen = new Set(setValue.value);
	if (checked)
		chosen.add(value);
	else
		chosen.delete(value);
	return setItems.value.map(item => item.value).filter(item => chosen.has(item));
}
</script>

<template>
	<template v-if="field.control === 'reference'">
		<component
			:is="idPicker.picker"
			v-if="idPicker"
			v-bind="idPickerProps"
			@update:model-value="emit('update', $event)"
		/>
		<ScreenDeckSourceField
			v-else-if="field.reference === 'deckSource'"
			:model-value="value as DeckSource"
			:event-id="eventId"
			@update:model-value="emit('update', $event)"
		/>
	</template>
	<ScreenSettingsField
		v-else-if="field.control === 'set'"
		:label="field.label"
		:description="description"
	>
		<div class="flex flex-wrap gap-x-4 gap-y-2">
			<UCheckbox
				v-for="item in setItems"
				:key="item.value"
				:label="item.label"
				:model-value="setValue.includes(item.value)"
				@update:model-value="emit('update', toggledSet(item.value, $event === true))"
			/>
		</div>
	</ScreenSettingsField>
	<ScreenConfigField
		v-else
		:field="field"
		:model-value="plainValue"
		:description="description"
		:items="items"
		:placeholder="field.placeholder"
		:nullable="field.clearable"
		:max="contentMax"
		:inline="inline"
		@update:model-value="emit('update', field.control === 'toggle' ? $event === true : $event)"
	/>
</template>
