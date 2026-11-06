<script setup lang="ts">
import type { OpCardCategory, OpCardColor } from '~~/shared/types/card/op';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';

/**
 * One Piece card search, as Magic: The Gathering's: part of a name or card
 * number, listed as it is typed from three characters,
 * found by bandai-keepr's `name` search, narrowed by colour and category.
 */
const cardStore = useCardStore();

const ANY = 'any';
const text = ref('');
const color = ref<OpCardColor | typeof ANY>(ANY);
const category = ref<OpCardCategory | typeof ANY>(ANY);

const colorItems = [
	{ label: 'Any colour', value: ANY },
	...OP_CARD_COLORS.map(value => ({ label: value, value })),
];
const categoryItems = [
	{ label: 'Any category', value: ANY },
	{ label: 'Leader', value: 'leader' },
	{ label: 'Character', value: 'character' },
	{ label: 'Event', value: 'event' },
	{ label: 'Stage', value: 'stage' },
];

function searchNow() {
	void cardStore.searchOpCards({
		text: text.value,
		color: color.value === ANY
			? null
			: color.value,
		category: category.value === ANY
			? null
			: category.value,
	});
}

const search = useDebounceFn(searchNow, 300);

function clear() {
	text.value = '';
	searchNow();
}
</script>

<template>
	<div class="flex items-center gap-4">
		<UInput
			v-model="text"
			size="xl"
			class="flex-1"
			placeholder="Search card name or number"
			:loading="cardStore.opSearching"
			aria-label="Search cards"
			@update:model-value="search"
			@keydown.enter="searchNow"
		/>
		<UButton
			size="xl"
			:disabled="!text.length"
			variant="outline"
			color="neutral"
			@click="clear"
		>
			Clear
		</UButton>
		<USelect
			v-model="color"
			size="xl"
			:items="colorItems"
			class="w-38"
			aria-label="Card colour"
			@update:model-value="searchNow"
		/>
		<USelect
			v-model="category"
			size="xl"
			:items="categoryItems"
			class="w-38"
			aria-label="Card category"
			@update:model-value="searchNow"
		/>
	</div>
</template>
