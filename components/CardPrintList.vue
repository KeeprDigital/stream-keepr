<script lang="ts" setup>
import type { CardData } from '~/types/cardData'

const cardsStore = useCardsStore()
const modal = useModal()

function selectCard(card: CardData) {
  modal.close()
  cardsStore.selectCard(card)
}
</script>

<template>
  <UModal
    :title="`${cardsStore.card?.name}`"
    :ui="{
      content: 'sm:max-w-screen-xl',
    }"
  >
    <template #body>
      <div class="card-list">
        <div
          v-for="card, index in cardsStore.cardPrintList"
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
