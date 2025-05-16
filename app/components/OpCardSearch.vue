<script setup lang="ts">
import { LazyOpCardHistory } from '#components'

const opCardStore = useOpCardStore()
const searchTerm = ref('')
const overlay = useOverlay()
const modal = overlay.create(LazyOpCardHistory)

function openHistory() {
  modal.open()
}

const search = useDebounceFn(() => {
  opCardStore.searchFuzzyCardName(searchTerm.value)
}, 300)

function searchImmediate() {
  opCardStore.searchFuzzyCardName(searchTerm.value)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    searchImmediate()
  }
}

function clearSearch() {
  opCardStore.clearSearch()
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
        trailing
        :loading="false"
        @update:model-value="search"
        @keydown="handleKeydown"
      />
    </div>

    <UInput
      v-model="opCardStore.cost"
      size="xl"
      class="w-36"
      placeholder="Cost"
      @update:model-value="searchImmediate"
    />

    <USelect
      v-model="opCardStore.selectedColour"
      :items="opColours"
      size="xl"
      class="w-36"
      placeholder="Colour"
      :ui="{
        content: 'max-h-90',
      }"
      @update:model-value="searchImmediate"
    />

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

    <UButton
      :disabled="!opCardStore.history.length"
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
    flex: 1 1 60%;

    .input {
      width: 100%;
    }
  }
}
</style>
