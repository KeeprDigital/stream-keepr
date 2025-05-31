<script lang="ts" setup>
const cardStore = useOpCardStore()

const { previewCard } = storeToRefs(cardStore)
</script>

<template>
  <div v-if="previewCard">
    <h1 class="name">
      {{ previewCard.name }}
    </h1>
    <OpCardImage :card="previewCard" />
  </div>
</template>

<style scoped>
.name {
  margin-bottom: 0.5rem;
  font-weight: 500;
  text-align: center;
}

.image {
  width: 100%;
}
</style>
