<script setup lang="ts">
type Props = {
  card: MtgCardData
  display: MtgCardDisplayData
  displayMode: MtgCardDisplayMode
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'selected', turnedOver: boolean): void
}>()
const frontLoaded = ref(false)
const backLoaded = ref(false)
const previewingBack = ref(false)

const mode = computed(() => {
  return mtgCardDisplayModes[props.displayMode]
})

const canPreviewBack = computed(() => {
  return props.card.imageData.back && mode.value.turnoverable && frontLoaded.value && backLoaded.value
})

function selected() {
  if (mode.value.selectable)
    emit('selected', previewingBack.value)
}
</script>

<template>
  <div
    class="card-image"
    :class="{ 'is-hoverable': mode.selectable }"
    @click="selected()"
  >
    <div
      class="card"
      :class="{
        'is-flipped': props.display.flipped,
        'is-rotated': props.display.rotated,
        'is-turned-over': props.display.turnedOver || previewingBack,
        'is-counter-rotated': props.display.counterRotated,
        'is-animated': mode.animated,
      }"
    >
      <div class="face front">
        <NuxtImg
          class="image"
          :src="props.card.imageData.front?.normal"
          loading="lazy"
          placeholder
          @load="frontLoaded = true"
        />
      </div>
      <div
        v-if="props.card.imageData.back"
        class="face back"
      >
        <NuxtImg
          class="image"
          :src="props.card.imageData.back.normal"
          loading="lazy"
          placeholder
          @load="backLoaded = true"
        />
      </div>
    </div>
    <MtgCardImageTurnover v-if="canPreviewBack" @preview-back="previewingBack = $event" />
  </div>
</template>

<style scoped>
.card-image {
  aspect-ratio: 61/85;
  perspective: 2000px;
  position: relative;
  transition: scale 0.1s ease-in-out;

  &.is-hoverable {
    cursor: pointer;

    &:hover {
      scale: 1.02;
    }
  }

  .card {
    position: relative;
    transform-style: preserve-3d;
    transform-origin: center;
    width: 100%;
    height: 100%;

    &.is-animated {
      transition: transform 0.6s ease-in-out;
    }

    .face {
      position: absolute;
      inset: 0;
      backface-visibility: hidden;

      &.front {
        transform: rotateY(0deg);
      }

      &.back {
        transform: rotateY(180deg);
      }

      .image {
        border-radius: 4.75% / 4%;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    &.is-flipped {
      transform: rotate(180deg);
    }

    &.is-rotated {
      transform: rotate(90deg);
    }

    &.is-counter-rotated {
      transform: rotate(-90deg);
    }

    &.is-turned-over {
      transform: rotateY(180deg);
    }
  }
}
</style>
