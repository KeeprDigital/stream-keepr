<script lang="ts" setup>
const cardStore = useMtgCardStore()

const { activeCard } = storeToRefs(cardStore)
</script>

<template>
  <div v-if="activeCard" class="active-card">
    <h2 class="text-center font-bold">
      {{ activeCard.name }}
    </h2>
    <MtgCardImage
      :key="activeCard.id"
      :card="activeCard"
      :display="activeCard.displayData"
      display-mode="output"
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
