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
      :flipped="activeCard.displayData.flipped"
      :rotated="activeCard.displayData.rotated"
      :turned-over="activeCard.displayData.turnedOver"
      :counter-rotated="activeCard.displayData.counterRotated"
      :disable-animation="false"
      :card="activeCard"
      :show-flip-button="false"
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
