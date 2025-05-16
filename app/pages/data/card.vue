<script setup lang="ts">
definePageMeta({
  layout: false,
})
useHead({
  bodyAttrs: {
    class: 'transparent-body-override',
  },
})

const cardStore = useMtgCardStore()
const { card } = storeToRefs(cardStore)
</script>

<template>
  <div class="flex h-screen w-screen items-center justify-center">
    <transition name="zoom-fade">
      <CardImage
        v-if="card && !card.displayData.hidden"
        v-model:flipped="card.displayData.flipped"
        v-model:rotated="card.displayData.rotated"
        v-model:turned-over="card.displayData.turnedOver"
        v-model:counter-rotated="card.displayData.counterRotated"
        class="image"
        :card="card"
        :show-flip-button="false"
      />
    </transition>
  </div>
</template>

<style scoped>
.zoom-fade-enter-active,
.zoom-fade-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.5, 0, 0.5, 1),
    opacity 0.2s ease-out;
}

.zoom-fade-enter-from {
  opacity: 0;
  transform: scale(0.7);
}

.zoom-fade-enter-to {
  opacity: 1;
  transform: scale(1);
}

.zoom-fade-leave-from {
  opacity: 1;
  transform: scale(1);
}

.zoom-fade-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.image {
  width: 300px;
}
</style>
