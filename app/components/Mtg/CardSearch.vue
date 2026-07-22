<script setup lang="ts">
const cardStore = useCardStore();

const searchTerm = ref('');

const search = useDebounceFn(() => {
	void cardStore.searchFuzzyCardName(searchTerm.value);
}, 300);

function searchImmediate() {
	void cardStore.searchFuzzyCardName(searchTerm.value);
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		searchImmediate();
	}
}

function clearSearch() {
	cardStore.clearSearch();
	searchTerm.value = '';
}
</script>

<template>
	<div class="flex items-center gap-4">
		<!-- Search Input -->
		<UInput
			v-model="searchTerm"
			size="xl"
			class="flex-1"
			placeholder="Search Card Name"
			:loading="cardStore.searching"
			aria-label="Search cards"
			@update:model-value="search"
			@keydown="handleKeydown"
		/>

		<UButton
			size="xl"
			:disabled="!searchTerm?.length"
			variant="outline"
			color="neutral"
			@click="clearSearch"
		>
			Clear
		</UButton>

		<USelect
			v-model="cardStore.selectedSearchFormat"
			size="xl"
			:items="mtgSets"
			class="w-38"
			aria-label="Card search format"
			:ui="{
				content: 'max-h-90',
			}"
			@update:model-value="searchImmediate"
		/>
	</div>
</template>
