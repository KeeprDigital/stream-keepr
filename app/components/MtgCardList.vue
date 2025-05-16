<script lang="ts" setup>
const cardStore = useCardStore()
</script>

<template>
  <div class="card-list-container">
    <div class="card-list">
      <MtgCardImage
        v-for="card in cardStore.cardList"
        :key="card.name"
        class="card-list-item"
        :card="card"
        :hoverable="true"
        @click="cardStore.selectCard(card)"
      />
    </div>
  </div>
</template>

<style scoped>
.card-list-container {
  container-name: card-list;
  container-type: inline-size;

  .card-list {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1.5rem;
  }

  @container (max-width: 1600px) {
    .card-list {
      grid-template-columns: repeat(6, 1fr);
    }
  }

  @container (max-width: 1440px) {
    .card-list {
      grid-template-columns: repeat(5, 1fr);
    }
  }

  @container (max-width: 1024px) {
    .card-list {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  @container (max-width: 768px) {
    .card-list {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @container (max-width: 480px) {
    .card-list {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @container (max-width: 320px) {
    .card-list {
      grid-template-columns: repeat(1, 1fr);
    }
  }
}
</style>
