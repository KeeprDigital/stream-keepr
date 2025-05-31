<script setup lang="ts">
import { LazyMtgCardHistory } from '#components'

const searchTerm = ref('')

const cardStore = useMtgCardStore()
const modal = useOverlay().create(LazyMtgCardHistory)

function openHistory() {
  modal.open(LazyMtgCardHistory)
}

const search = useDebounceFn(() => {
  cardStore.searchFuzzyCardName(searchTerm.value)
}, 300)

function searchImmediate() {
  cardStore.searchFuzzyCardName(searchTerm.value)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    searchImmediate()
  }
}

function clearSearch() {
  cardStore.clearSearch()
  searchTerm.value = ''
}
</script>

<template>
  <div class="flex flex-row items-center gap-4">
    <div class="flex-1 w-38">
      <UInput
        v-model="searchTerm"
        class="w-full"
        placeholder="Search Card Name"
        size="xl"
        trailing
        :loading="cardStore.searching"
        @update:model-value="search"
        @keydown="handleKeydown"
      />
    </div>

    <UButton
      size="xl"
      :disabled="!searchTerm?.length"
      variant="outline"
      color="neutral"
      class="clear-button"
      @click="clearSearch"
    >
      Clear
    </UButton>

    <USelect
      v-model="cardStore.selectedSearchFormat"
      size="xl"
      :items="mtgSets"
      class="w-38"
      :ui="{
        content: 'max-h-90',
      }"
      @update:model-value="searchImmediate"
    />

    <UButton
      :disabled="!cardStore.selectionHistory.length"
      size="xl"
      variant="outline"
      color="neutral"
      class="history-button"
      icon="i-lucide-history"
      @click="openHistory"
    >
      History
    </UButton>
  </div>
</template>
