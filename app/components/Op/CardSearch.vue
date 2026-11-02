<script setup lang="ts">
import type { OpCardCategory, OpCardColor } from '~~/shared/types/card/op';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';

/** One Piece card search: name or text, or a card number, narrowed by colour and category. */
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
	color.value = ANY;
	category.value = ANY;
	searchNow();
}

// An empty search lists cards, and says at once whether card data is available.
onMounted(searchNow);
</script>

<template>
	<div class="flex items-center gap-4">
		<UInput
			v-model="text"
			size="xl"
			class="flex-1"
			placeholder="Search name, text or card number"
			:loading="cardStore.opSearching"
			aria-label="Search cards"
			@update:model-value="search"
			@keydown.enter="searchNow"
		/>
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
		<UButton
			size="xl"
			variant="outline"
			color="neutral"
			@click="clear"
		>
			Clear
		</UButton>
	</div>
</template>
