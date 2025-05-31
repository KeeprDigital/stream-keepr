<script lang="ts" setup>
const cardStore = useMtgCardStore()

const { previewCard } = storeToRefs(cardStore)
</script>

<template>
  <div v-if="previewCard">
    <div class="info">
      <h1 class="name">
        {{ previewCard.name }}
      </h1>
      <p v-if="previewCard.points > 0" class="points">
        {{ `${previewCard.points} ${previewCard.points === 1 ? 'point' : 'points'}` }}
      </p>
    </div>
    <MtgCardImage
      :flipped="previewCard.displayData.flipped"
      :rotated="previewCard.displayData.rotated"
      :turned-over="previewCard.displayData.turnedOver"
      :card="previewCard"
      :counter-rotated="previewCard.displayData.counterRotated"
      :show-flip-button="false"
      class="image"
    />
  </div>
</template>

<style scoped>
.info {
  margin-bottom: 0.5rem;
  .name {
    font-weight: 500;
    text-align: center;
  }

  .points {
    font-size: 0.875rem;
    text-align: center;
    font-style: italic;
  }
}

.image {
  width: 100%;
}
</style>
