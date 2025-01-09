<script lang="ts" setup>
const cardsStore = useCardsStore()
</script>

<template>
  <div class="card-list">
    <CardImage
      v-for="card in cardsStore.cardList"
      :key="card.name"
      class="card-list-item"
      :show-turned-over-button="true"
      :card="card"
      :hoverable="true"
      @click="cardsStore.selectCard(card)"
    />
    <div class="card-list-item" />
    <div class="card-list-item" />
    <div class="card-list-item" />
  </div>
</template>

<style scoped>
.card-list {
  display: flex;
  flex-flow: row wrap;
  justify-content: space-between;
  row-gap: 0.75rem;

  .card-list-item {
    width: 24%;
  }
}
</style>
