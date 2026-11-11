<script setup lang="ts" generic="Item extends { label: string; value: number }">
/**
 * The field row every Event Reference picker of Screen settings is (ADR-0038),
 * so picking works one way whatever is picked: the kind's `items` under its
 * label, emitting the picked id, or `null` for none (ADR-0041). A short list is
 * a select whose first option is `nullLabel`; a `searchable` one is a combobox
 * with `nullLabel` as its placeholder and a clear button. Each kind's picker
 * (`ScreenPlayerField`, `ScreenRoundField`, …) loads what it lists and passes
 * it here; a settings page mounts those, never this.
 *
 * A kind that searches by more than its labels binds `v-model:search-term` and
 * filters `items` itself. `wide` fits labels longer than a name; `stacked` puts
 * the label above a control taking the row's width.
 */
const props = defineProps<{
	label: string;
	description?: string;
	modelValue?: number | null;
	items: Item[];
	/** What none reads as: "Select a player…", "Current standings". */
	nullLabel: string;
	searchable?: boolean;
	searchTerm?: string;
	wide?: boolean;
	stacked?: boolean;
}>();

const emit = defineEmits<{
	'update:modelValue': [id: number | null];
	'update:searchTerm': [term: string];
}>();

defineSlots<{
	/** A listed item's label, where a kind shows more than its text. */
	'item-label'?: (props: { item: Item }) => unknown;
}>();

interface Choice {
	label: string;
	value: number | null;
}

// The controls see plain choices; the `item-label` slot gets each kind's own item back.
const choices = computed<Choice[]>(() => props.items);
const options = computed<Choice[]>(() => [
	{ label: props.nullLabel, value: null },
	...props.items,
]);

const width = computed(() => props.stacked
	? 'w-full'
	: props.wide
		? 'w-72'
		: 'w-64');

function pick(id: unknown) {
	emit('update:modelValue', typeof id === 'number'
		? id
		: null);
}
</script>

<template>
	<ScreenSettingsField :label="label" :description="description" :stacked="stacked">
		<UInputMenu
			v-if="searchable"
			:model-value="modelValue ?? undefined"
			:items="choices"
			value-key="value"
			:search-term="searchTerm"
			:ignore-filter="searchTerm !== undefined"
			:placeholder="nullLabel"
			icon="i-lucide-search"
			clear
			:class="width"
			@update:search-term="emit('update:searchTerm', $event)"
			@update:model-value="pick"
		/>
		<USelect
			v-else
			:model-value="modelValue ?? null"
			:items="options"
			:class="width"
			:ui="wide ? { content: 'min-w-fit' } : undefined"
			@update:model-value="pick"
		>
			<template v-if="$slots['item-label']" #item-label="{ item }">
				<slot v-if="item.value !== null" name="item-label" :item="item as unknown as Item" />
				<template v-else>
					{{ item.label }}
				</template>
			</template>
		</USelect>
	</ScreenSettingsField>
</template>
