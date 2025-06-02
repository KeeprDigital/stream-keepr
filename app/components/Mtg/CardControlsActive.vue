<script lang="ts" setup>
const cardStore = useMtgCardStore()

const { activeCard } = storeToRefs(cardStore)
</script>

<template>
  <transition mode="out-in" name="cross-fade">
    <div v-if="activeCard" :key="activeCard.id">
      <h2 class="text-center font-bold">
        {{ activeCard.name }}
      </h2>
      <MtgCardImage
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
  </transition>
</template>

<style scoped>
.cross-fade-enter-active,
.cross-fade-leave-active {
  transition: opacity 0.5s ease;
}

.cross-fade-enter-from,
.cross-fade-leave-to {
  opacity: 0;
}
</style>
