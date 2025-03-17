<script lang="ts" setup>
const emit = defineEmits<{
  (e: 'close'): void
}>()

const cardStore = useCardStore()

function selectCard(card: CardData) {
  cardStore.selectCard(card)
  emit('close')
}
</script>

<template>
  <UModal
    :title="`${cardStore.card?.name}`"
    description="other printings of this card"
    :ui="{
      content: 'sm:max-w-screen-xl',
    }"
  >
    <template #body>
      <div class="card-list">
        <div
          v-for="card, index in cardStore.cardPrintList"
          :key="index"
          class="card-list-item"
        >
          <CardImage
            class="card-list-item-image"
            :show-turned-over-button="true"
            :card="card"
            :hoverable="true"
            @click="selectCard(card)"
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
