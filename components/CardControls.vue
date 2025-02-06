<script lang="ts" setup>
import { LazyCardPrintList } from '#components'

const cardStore = useCardStore()
const modal = useModal()

function openPrintList() {
  modal.open(LazyCardPrintList)
}
</script>

<template>
  <div v-if="cardStore.card" class="card-controls">
    <h1 class="name">
      {{ cardStore.card.name }}
    </h1>
    <div class="image-container" :class="{ hide: cardStore.cardDisplay.hidden }">
      <CardImage
        v-model:flipped="cardStore.cardDisplay.flipped"
        v-model:rotated="cardStore.cardDisplay.rotated"
        v-model:turned-over="cardStore.cardDisplay.turnedOver"
        v-model:counter-rotated="cardStore.cardDisplay.counterRotated"
        class="image"
        :card="cardStore.card"
        :show-flip-button="false"
      />
    </div>
    <div class="buttons">
      <UButton
        v-if="!cardStore.cardDisplay.hidden"
        variant="outline"
        icon="i-lucide-eye-off"
        size="xl"
        block
        color="warning"
        @click="cardStore.hideCard"
      >
        Hide
      </UButton>
      <UButton
        v-else
        variant="outline"
        icon="i-lucide-eye"
        size="xl"
        block
        @click="cardStore.showCard"
      >
        Show
      </UButton>
      <USeparator v-if="cardStore.card.meldData" />
      <UButtonGroup v-if="cardStore.card.meldData" orientation="horizontal">
        <UButton
          v-if="cardStore.card.meldData?.meldPartOne"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="cardStore.card.name === cardStore.card.meldData?.meldPartOne"
          @click="cardStore.selectMeldCardPart(cardStore.card.meldData?.meldPartOne)"
        >
          {{ cardStore.card.meldData?.meldPartOne }}
        </UButton>
        <UButton
          v-if="cardStore.card.meldData?.meldPartTwo"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="cardStore.card.name === cardStore.card.meldData?.meldPartTwo"
          @click="cardStore.selectMeldCardPart(cardStore.card.meldData?.meldPartTwo)"
        >
          {{ cardStore.card.meldData?.meldPartTwo }}
        </UButton>
      </UButtonGroup>
      <UButton
        v-if="cardStore.card.meldData?.meldResult"
        variant="outline"
        color="info"
        size="xl"
        block
        icon="i-lucide-flip-horizontal"
        :disabled="cardStore.card.name === cardStore.card.meldData?.meldResult"
        @click="cardStore.selectMeldCardPart(cardStore.card.meldData?.meldResult)"
      >
        {{ cardStore.card.meldData?.meldResult }}
      </UButton>
      <USeparator />
      <UButton
        v-if="cardStore.card.orientationData.turnable"
        variant="outline"
        color="info"
        icon="i-lucide-flip-horizontal"
        size="xl"
        block
        @click="cardStore.turnOverCard"
      >
        Turn Over
      </UButton>
      <UButton
        v-if="cardStore.card.orientationData.rotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="cardStore.rotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="cardStore.card.orientationData.counterRotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-ccw"
        size="xl"
        block
        @click="cardStore.counterRotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="cardStore.card.orientationData.flipable"
        :ui="{
          leadingIcon: 'rotate-90',
        }"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="cardStore.flipCard"
      >
        Flip
      </UButton>
      <UButton
        v-if="cardStore.cardPrintList.length > 1"
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
        @click="cardStore.clearCard"
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
