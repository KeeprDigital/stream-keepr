<script setup lang="ts">
const cardsStore = useCardsStore()
const searchTerm = ref('')

const search = useDebounceFn(() => {
  cardsStore.searchFuzzyCardName(searchTerm.value)
}, 300)

function searchImmediate() {
  cardsStore.searchFuzzyCardName(searchTerm.value)
}

// Handle enter key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    searchImmediate()
  }
}
</script>

<template>
  <UInput
    v-model="searchTerm"
    class="input"
    placeholder="Search Card Name"
    size="xl"
    :ui="{ trailing: 'pe-1' }"
    @update:model-value="search"
    @keydown="handleKeydown"
  >
    <template v-if="searchTerm?.length" #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        icon="i-lucide-circle-x"
        aria-label="Clear input"
        @click="searchTerm = ''"
      />
    </template>
  </UInput>
</template>

<style scoped>
.input {
  width: 100%;
}
</style>
