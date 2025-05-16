<script lang="ts" setup>
import { LazyMtgCardPrinting } from '#components'

const cardStore = useMtgCardStore()
const {
  showCard,
  clearCard,
  turnOverCard,
  rotateCard,
  counterRotateCard,
  flipCard,
  hideCard,
  selectMeldCardPart,
} = cardStore
const {
  card,
  cardPrintList,
  remaining,
  isActive,
} = storeToRefs(cardStore)

const overlay = useOverlay()
const modal = overlay.create(LazyMtgCardPrinting)

defineShortcuts({
  ctrl_s: () => card.value?.displayData.hidden ? showCard() : hideCard(),
})

function openPrintList() {
  modal.open(LazyMtgCardPrinting)
}
</script>

<template>
  <div v-if="card" class="card-controls">
    <div class="card-info">
      <h1 class="name">
        {{ card.name }}
      </h1>
      <p v-if="card.points > 0" class="points">
        {{ `${card.points} ${card.points === 1 ? 'point' : 'points'}` }}
      </p>
    </div>
    <div class="image-container" :class="{ hide: card.displayData.hidden }">
      <MtgCardImage
        v-model:flipped="card.displayData.flipped"
        v-model:rotated="card.displayData.rotated"
        v-model:turned-over="card.displayData.turnedOver"
        v-model:counter-rotated="card.displayData.counterRotated"
        class="image"
        :card="card"
        :show-flip-button="false"
      />
    </div>
    <div class="buttons">
      <UButton
        v-if="!card.displayData.hidden"
        variant="outline"
        icon="i-lucide-eye-off"
        size="xl"
        block
        color="warning"
        @click="hideCard"
      >
        {{ isActive ? `Hide (${remaining}s)` : 'Hide' }}
      </UButton>
      <UButton
        v-else
        variant="outline"
        icon="i-lucide-eye"
        size="xl"
        block
        @click="showCard"
      >
        Show
      </UButton>
      <UInputNumber
        v-model="cardStore.selectedTimeoutSeconds"
        :min="0"
        size="xl"
        :disabled="isActive"
      />

      <USeparator v-if="card.meldData" />
      <UButtonGroup v-if="card.meldData" orientation="horizontal">
        <UButton
          v-if="card.meldData?.meldPartOne"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="card.name === card.meldData?.meldPartOne"
          @click="selectMeldCardPart(card.meldData?.meldPartOne)"
        >
          {{ card.meldData?.meldPartOne }}
        </UButton>
        <UButton
          v-if="card.meldData?.meldPartTwo"
          variant="outline"
          color="info"
          size="xl"
          block
          :disabled="card.name === card.meldData?.meldPartTwo"
          @click="selectMeldCardPart(card.meldData?.meldPartTwo)"
        >
          {{ card.meldData?.meldPartTwo }}
        </UButton>
      </UButtonGroup>
      <UButton
        v-if="card.meldData?.meldResult"
        variant="outline"
        color="info"
        size="xl"
        block
        icon="i-lucide-flip-horizontal"
        :disabled="card.name === card.meldData?.meldResult"
        @click="selectMeldCardPart(card.meldData?.meldResult)"
      >
        {{ card.meldData?.meldResult }}
      </UButton>
      <USeparator />
      <UButton
        v-if="card.orientationData.turnable"
        variant="outline"
        color="info"
        icon="i-lucide-flip-horizontal"
        size="xl"
        block
        @click="turnOverCard"
      >
        Turn Over
      </UButton>
      <UButton
        v-if="card.orientationData.rotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="rotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="card.orientationData.counterRotateable"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-ccw"
        size="xl"
        block
        @click="counterRotateCard"
      >
        Rotate
      </UButton>
      <UButton
        v-if="card.orientationData.flipable"
        :ui="{
          leadingIcon: 'rotate-90',
        }"
        variant="outline"
        color="info"
        icon="i-lucide-rotate-cw"
        size="xl"
        block
        @click="flipCard"
      >
        Flip
      </UButton>
      <UButton
        v-if="cardPrintList.length > 1"
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
        @click="clearCard"
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

.points {
  font-size: 1rem;
  text-align: center;
  font-style: italic;
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
