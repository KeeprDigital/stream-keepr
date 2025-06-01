<script lang="ts" setup>
const emit = defineEmits<{
  (e: 'close'): void
}>()

const cardStore = useMtgCardStore()

function selectPreviewCard(card: MtgCardData) {
  cardStore.selectPreviewCard(card)
  emit('close')
}
</script>

<template>
  <UModal
    :title="`${cardStore.previewCard?.name}`"
    description="Alternative printings"
    :ui="{
      content: 'sm:max-w-screen-xl',
    }"
  >
    <template #body>
      <div class="card-list">
        <div
          v-for="card, index in cardStore.previewCardPrintings"
          :key="index"
          class="card-list-item"
        >
          <MtgCardImage
            class="card-list-item-image"
            :card="card"
            :display="card.displayData"
            display-mode="list"
            @click="selectPreviewCard(card)"
          />
          <div class="card-list-item-title">
            {{ card.set }}
          </div>
        </div>
        <div class="card-list-item" />
        <div class="card-list-item" />
        <div class="card-list-item" />
        <div class="card-list-item" />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.card-list {
  display: flex;
  flex-flow: row wrap;
  justify-content: space-between;
  row-gap: 0.75rem;

  .card-list-item {
    width: 19%;

    .card-list-item-title {
      text-align: center;
      font-size: 1rem;
    }

    .card-list-item-image {
      width: 100%;
    }
  }
}
</style>
