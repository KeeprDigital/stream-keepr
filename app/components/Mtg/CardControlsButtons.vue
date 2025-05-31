<script lang="ts" setup>
import { LazyMtgCardPrinting } from '#components'

const cardStore = useMtgCardStore()

const {
  selectMeldCardPart,
} = cardStore

const {
  previewCard,
  previewCardPrintings,
  activeCard,
} = storeToRefs(cardStore)

const modal = useOverlay().create(LazyMtgCardPrinting)

function openPrintList() {
  modal.open(LazyMtgCardPrinting)
}

function cardAction(action: MtgPreviewCardAction) {
  cardStore.controlPreviewCard(action)
}
</script>

<template>
  <div v-if="previewCard" class="flex flex-col gap-2">
    <UButton
      v-if="activeCard"
      variant="outline"
      icon="i-lucide-replace"
      block
      color="warning"
      @click="cardAction('show')"
    >
      Replace
    </UButton>
    <UButton
      v-else
      variant="outline"
      icon="i-lucide-eye"
      block
      @click="cardAction('show')"
    >
      Show
    </UButton>

    <USeparator v-if="previewCard.meldData" />
    <UButtonGroup v-if="previewCard.meldData" orientation="horizontal">
      <UButton
        v-if="previewCard.meldData?.meldPartOne"
        variant="outline"
        color="info"
        block
        :disabled="previewCard.name === previewCard.meldData?.meldPartOne"
        @click="selectMeldCardPart(previewCard.meldData?.meldPartOne)"
      >
        {{ previewCard.meldData?.meldPartOne }}
      </UButton>
      <UButton
        v-if="previewCard.meldData?.meldPartTwo"
        variant="outline"
        color="info"
        block
        :disabled="previewCard.name === previewCard.meldData?.meldPartTwo"
        @click="selectMeldCardPart(previewCard.meldData?.meldPartTwo)"
      >
        {{ previewCard.meldData?.meldPartTwo }}
      </UButton>
    </UButtonGroup>
    <UButton
      v-if="previewCard.meldData?.meldResult"
      variant="outline"
      color="info"
      block
      icon="i-lucide-flip-horizontal"
      :disabled="previewCard.name === previewCard.meldData?.meldResult"
      @click="selectMeldCardPart(previewCard.meldData?.meldResult)"
    >
      {{ previewCard.meldData?.meldResult }}
    </UButton>
    <USeparator v-if="previewCard.orientationData.turnable || previewCard.orientationData.rotateable || previewCard.orientationData.counterRotateable" />
    <UButton
      v-if="previewCard.orientationData.turnable"
      variant="outline"
      color="info"
      icon="i-lucide-flip-horizontal"
      block
      @click="cardAction('turnOver')"
    >
      Turn Over
    </UButton>
    <UButton
      v-if="previewCard.orientationData.rotateable"
      variant="outline"
      color="info"
      icon="i-lucide-rotate-cw"
      block
      @click="cardAction('rotate')"
    >
      Rotate
    </UButton>
    <UButton
      v-if="previewCard.orientationData.counterRotateable"
      variant="outline"
      color="info"
      icon="i-lucide-rotate-ccw"
      block
      @click="cardAction('counterRotate')"
    >
      Rotate
    </UButton>
    <UButton
      v-if="previewCard.orientationData.flipable"
      :ui="{
        leadingIcon: 'rotate-90',
      }"
      variant="outline"
      color="info"
      icon="i-lucide-rotate-cw"
      block
      @click="cardAction('flip')"
    >
      Flip
    </UButton>
    <UButton
      v-if="previewCardPrintings.length > 1"
      variant="outline"
      color="warning"
      icon="i-lucide-printer"
      block
      @click="openPrintList"
    >
      Switch Printing
    </UButton>
  </div>
</template>
