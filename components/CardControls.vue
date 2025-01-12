<script lang="ts" setup>
import { LazyCardPrintList } from '#components'

const cardsStore = useCardsStore()
const modal = useModal()

function openPrintList() {
  modal.open(LazyCardPrintList)
}
</script>

<template>
  <div v-if="cardsStore.card" class="card-controls">
    <h1 class="name">
      {{ cardsStore.card.name }}
    </h1>
    <div class="image-container" :class="{ hide: cardsStore.card.hidden }">
      <CardImage
        v-model:flipped="cardsStore.card.flipped"
        v-model:rotated="cardsStore.card.rotated"
        v-model:turned-over="cardsStore.card.turnedOver"
        v-model:counter-rotated="cardsStore.card.counterRotated"
        class="image"
        :card="cardsStore.card"
        :show-flip-button="false"
      />
    </div>
    <div class="buttons">
      <UButton
        v-if="!cardsStore.card.hidden"
        variant="outline"
        icon="i-lucide-eye-off"
        size="xl"
        block
        color="warning"
        @click="cardsStore.hideCard"
      >
        Hide
      </UButton>
      <UButton
        v-else
        variant="outline"
        icon="i-lucide-eye"
        size="xl"
        block
        @click="cardsStore.showCard"
      >
        Show
      </UButton>
      <USeparator v-if="cardsStore.card.meldData" />
      <UButtonGroup v-if="cardsStore.card.meldData" orientation="horizontal">
        <UButton
          v-if="cardsStore.card.meldData?.meldPartOne"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="cardsStore.card.name === cardsStore.card.meldData?.meldPartOne"
          @click="cardsStore.selectMeldCardPart(cardsStore.card.meldData?.meldPartOne)"
        >
          {{ cardsStore.card.meldData?.meldPartOne }}
        </UButton>
        <UButton
          v-if="cardsStore.card.meldData?.meldPartTwo"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="cardsStore.card.name === cardsStore.card.meldData?.meldPartTwo"
          @click="cardsStore.selectMeldCardPart(cardsStore.card.meldData?.meldPartTwo)"
        >
          {{ cardsStore.card.meldData?.meldPartTwo }}
        </UButton>
      </UButtonGroup>
      <UButton
        v-if="cardsStore.card.meldData?.meldResult"
        variant="outline"
        color="info"
        size="xl"
        block
        icon="i-lucide-flip-horizontal"
        :disabled="cardsStore.card.name === cardsStore.card.meldData?.meldResult"
        @click="cardsStore.selectMeldCardPart(cardsStore.card.meldData?.meldResult)"
      >
        {{ cardsStore.card.meldData?.meldResult }}
      </UButton>
      <USeparator />
      <UButton
        v-if="cardsStore.card.orientationData.turnable"
        variant="outline"
        color="info"
        icon="i-lucide-flip-horizontal"
        size="xl"
        block
        @click="cardsStore.turnOverCard"
      >
        Turn Over
      </UButton>
      <UButton
        v-if="cardsStore.card.orientationData.rotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="cardsStore.rotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="cardsStore.card.orientationData.counterRotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-ccw"
        size="xl"
        block
        @click="cardsStore.counterRotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="cardsStore.card.orientationData.flipable"
        :ui="{
          leadingIcon: 'rotate-90',
        }"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="cardsStore.flipCard"
      >
        Flip
      </UButton>
      <UButton
        v-if="cardsStore.cardPrintList.length > 1"
        variant="outline"
        color="warning"
        icon="i-lucide-printer"
        size="xl"
        block
        @click="openPrintList"
      >
        Switch Printing
      </UButton>
      <UButton
        variant="outline"
        color="error"
        icon="i-lucide-circle-x"
        size="xl"
        block
        @click="cardsStore.clearCard"
      >
        Clear
      </UButton>
    </div>
  </div>
</template>

<style scoped>
.card-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.name {
  font-size: 1.5rem;
  font-weight: 500;
  text-align: center;
}

.buttons {
  width: 245px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.image-container {
  width: 245px;
  height: 342px;
  position: relative;

  .image {
    border-radius: 4.75% / 4%;
    position: relative;
    transition: opacity 0.2s ease-in-out;
  }

  &.hide {
    .image {
      opacity: 0.5;
      filter: blur(1px);
    }

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/></g></svg>');
      background-size: 30%;
      background-repeat: no-repeat;
      background-position: center;
    }
  }
}
</style>
