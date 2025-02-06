<script setup lang="ts">
import { LazyCardHistory } from '#components'
import { mtgSets } from '~/data/mtgSets'

const cardStore = useCardStore()
const searchTerm = ref('')
const modal = useModal()

function openHistory() {
  modal.open(LazyCardHistory)
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
  <div class="card-search">
    <div class="input-container">
      <UInput
        v-model="searchTerm"
        class="input"
        placeholder="Search Card Name"
        size="xl"
        @update:model-value="search"
        @keydown="handleKeydown"
      />
      <UProgress
        v-if="cardStore.loading"
        class="loader"
        animation="swing"
        size="sm"
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
      v-model="cardStore.selectedFormat"
      size="xl"
      :items="mtgSets"
      class="w-36"
      :ui="{
        content: 'max-h-90',
      }"
      @update:model-value="searchImmediate"
    />

    <UButton
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

<style scoped>
.card-search {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 1rem;

  .input-container {
    overflow: hidden;
    position: relative;
    flex: 1 1 60%;

    .input {
      width: 100%;
    }

    .loader {
      position: absolute;
      bottom: 1px;
    }
  }
}
</style>
