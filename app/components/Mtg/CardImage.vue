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
const transitioning = ref(false)
const show = ref(false)

const mode = computed(() => {
  return mtgCardDisplayModes[props.displayMode]
})

const canPreviewBack = computed(() => {
  return props.card.imageData.back
    && mode.value.turnoverable
    && frontLoaded.value
    && backLoaded.value
})

const scaleFactor = computed(() => {  
  if (!show.value)
    return 1

  const isRotated = props.display.rotated && mode.value.rotatable
  const isCounterRotated = props.display.counterRotated && mode.value.counterRotatable

  return (isRotated || isCounterRotated) ? 61 / 85 : 1
})

function selected() {
  if (mode.value.selectable && !transitioning.value)
    emit('selected', previewingBack.value)
}

// Show the card in default state before animating, card id is used as the key
onMounted(() => {
  nextTick(() => {
    setTimeout(() => {
      show.value = true
    }, 1000)
  })
})
</script>

<template>
  <div
    class="warpper"
    :class="{
      animated: mode.animated,
      hoverable: mode.selectable && !transitioning,
      transitioning,
    }"
    @click="selected()"
  >
    <div
      class="card-image"
    >
      <div
        class="card"
        :class="{
          'flipped': show && props.display.flipped,
          'rotated': show && mode.rotatable && props.display.rotated,
          'counter-rotated': show && mode.counterRotatable && props.display.counterRotated,
          'turned-over': show && (props.display.turnedOver || previewingBack),
          'animated': mode.animated,
        }"
      >
        <div class="face front">
          <NuxtImg
            class="image"
            :src="props.card.imageData.front?.normal"
            loading="lazy"
            laceholder
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
      <MtgCardImageTurnover
        v-if="canPreviewBack && !transitioning"
        @preview-back="previewingBack = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.warpper {
  scale: v-bind(scaleFactor);

  &.animated {
    transition: scale 0.6s ease-in-out;
    .card {
      transition: transform 0.6s ease-in-out;
    }
  }

  &.hoverable {
    cursor: pointer;
    transition: scale 0.1s ease-in-out;
    &:hover {
      scale: 1.02;
    }
  }

  &.transitioning {
    pointer-events: none;
  }
}

.card-image {
  aspect-ratio: 61/85;
  perspective: 2000px;
  position: relative;

  .card {
    position: relative;
    transform-style: preserve-3d;
    transform-origin: center;
    width: 100%;
    height: 100%;

    .face {
      position: absolute;
      inset: 0;
      backface-visibility: hidden;

      .image {
        border-radius: 4.75% / 4%;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      &.front {
        transform: rotateY(0deg);
      }
      &.back {
        transform: rotateY(180deg);
      }
    }

    &.flipped {
      transform: rotate(180deg);
    }
    &.rotated {
      transform: rotate(90deg);
    }
    &.counter-rotated {
      transform: rotate(-90deg);
    }
    &.turned-over {
      transform: rotateY(180deg);
    }
  }
}
</style>
