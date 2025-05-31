<script lang="ts" setup>
const cardStore = useOpCardStore()

const { activeCard } = storeToRefs(cardStore)
</script>

<template>
  <div v-if="activeCard" class="active-card">
    <h2 class="text-center font-bold">
      {{ activeCard.name }}
    </h2>
    <OpCardImage
      class="image"
      :card="activeCard"
    />
    <UButton
      class="mt-4"
      color="warning"
      variant="outline"
      block
      @click="cardStore.controlActiveCard('clear')"
    >
      {{ cardStore.timeout.isActive ? `Clear (${cardStore.timeout.remaining}s)` : 'Clear' }}
    </UButton>
  </div>
</template>
