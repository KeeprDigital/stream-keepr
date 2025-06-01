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
const isReady = ref(false)
const isTransitioning = ref(false)
const show = ref(false)

const mode = computed(() => {
  return mtgCardDisplayModes[props.displayMode]
})

const transition = computed(() => {
  return mode.value.transition ? 'cross-fade' : 'none'
})

const canPreviewBack = computed(() => {
  return props.card.imageData.back
    && mode.value.turnoverable
    && frontLoaded.value
    && backLoaded.value
})

// watch(() => props.card, (newCard) => {
//   if (newCard === null) {
//     show.value = false
//     nextTick(() => {
//       show.value = true
//     })
//   }
// })

function selected() {
  if (mode.value.selectable && !isTransitioning.value)
    emit('selected', previewingBack.value)
}

// Show the card in default state before animating, card id is used as the key
onMounted(() => {
  // if (mode.value.transition) {
  //   show.value = true
  // }

  nextTick(() => {
    show.value = true
    setTimeout(() => {
      isReady.value = true
    }, 500)
  })
})
</script>

<template>
  <transition :name="transition" mode="out-in">
    <div
      v-if="show"
      class="card-image"
      :class="{
        'is-hoverable': mode.selectable && !isTransitioning,
        'is-transitioning': isTransitioning,
      }"
      @click="selected()"
    >
      <div
        class="card"
        :class="{
          'flipped': isReady && props.display.flipped,
          'rotated': isReady && props.display.rotated,
          'turned-over': isReady && (props.display.turnedOver || previewingBack),
          'counter-rotated': isReady && props.display.counterRotated,
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
        v-if="canPreviewBack && !isTransitioning"
        @preview-back="previewingBack = $event"
      />
    </div>
  </transition>
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

  &.is-transitioning {
    pointer-events: none;
  }

  .card {
    position: relative;
    transform-style: preserve-3d;
    transform-origin: center;
    width: 100%;
    height: 100%;
    opacity: 1;
    transition: opacity 0.15s ease-in-out;

    &.animated {
      transition:
        transform 0.6s ease-in-out,
        opacity 0.15s ease-in-out;
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

.cross-fade-enter-active,
.cross-fade-leave-active {
  transition: opacity 0.5s ease;
}

.cross-fade-enter-from,
.cross-fade-leave-to {
  opacity: 0;
}
</style>
