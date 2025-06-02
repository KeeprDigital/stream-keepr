<script setup lang="ts">
const cardStore = useOpCardStore()
const { activeCard } = storeToRefs(cardStore)

const configStore = useConfigStore()
const { overlay } = storeToRefs(configStore)
</script>

<template>
  <transition mode="out-in" name="zoom-fade">
    <div
      v-if="activeCard"
      :key="activeCard.id"
      :style="{
        width: `${overlay.cardSize}px`,
      }"
    >
      <OpCardImage :card="activeCard" />
    </div>
  </transition>
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
</style>
