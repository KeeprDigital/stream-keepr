<script setup lang="ts">
type Props = {
  card: MtgCardData
  turnoverable?: boolean
  hoverable?: boolean
  flipped?: boolean
  rotated?: boolean
  counterRotated?: boolean
  turnedOver?: boolean
  disableAnimation?: boolean
}

const props = defineProps<Props>()

const frontLoaded = ref(false)
const backLoaded = ref(false)
const previewingBack = ref(false)
const previewingBackTimeout = ref<NodeJS.Timeout | null>(null)
const showInitialState = ref(false)
const initialAnimationDelay = 500
const previousCardId = ref<string | null>(null)
const hasHandledInitialAnimation = ref(false)

// Computed to check if any transformation is active
const hasTransformation = computed(() =>
  props.flipped || props.rotated || props.counterRotated || props.turnedOver,
)

// Computed to check if images are ready
const imagesReady = computed(() => {
  if (props.card.imageData.back?.normal) {
    return frontLoaded.value && backLoaded.value
  }
  return frontLoaded.value
})

// Get unique identifier for the card
const cardId = computed(() => {
  return `${props.card.id || props.card.name || ''}-${props.card.imageData.front?.normal || ''}`
})

// Watch for card changes vs display option changes
watch([cardId, hasTransformation, imagesReady], ([newCardId, hasTransform, ready], [oldCardId]) => {
  const isNewCard = newCardId !== previousCardId.value

  if (isNewCard) {
    // New card - reset states
    frontLoaded.value = false
    backLoaded.value = false
    hasHandledInitialAnimation.value = false
    showInitialState.value = false
    previousCardId.value = newCardId

    // Handle initial animation when images are ready
    if (ready && hasTransform && !props.disableAnimation) {
      hasHandledInitialAnimation.value = true
      showInitialState.value = true
      setTimeout(() => {
        showInitialState.value = false
      }, initialAnimationDelay)
    }
  }
  else if (ready && !props.disableAnimation) {
    // Same card, different display options - animate directly
    showInitialState.value = false
  }
}, { immediate: true })

// Handle initial animation when images load for new card
watch([imagesReady], ([ready]) => {
  if (ready && hasTransformation.value && !hasHandledInitialAnimation.value && !props.disableAnimation) {
    hasHandledInitialAnimation.value = true
    showInitialState.value = true
    setTimeout(() => {
      showInitialState.value = false
    }, initialAnimationDelay)
  }
})

function previewBack() {
  if (previewingBack.value && previewingBackTimeout.value) {
    previewingBack.value = false
    clearTimeout(previewingBackTimeout.value)
  }
  else {
    previewingBack.value = true

    previewingBackTimeout.value = setTimeout(() => {
      previewingBack.value = false
    }, 2000)
  }
}

// Reset states when component unmounts
onUnmounted(() => {
  if (previewingBackTimeout.value) {
    clearTimeout(previewingBackTimeout.value)
  }
})
</script>

<template>
  <div
    class="card-image"
    :class="{
      'is-hoverable': props.hoverable,
    }"
  >
    <div
      class="card"
      :class="{
        'is-flipped': flipped && !showInitialState,
        'is-rotated': rotated && !showInitialState,
        'is-turned-over': (turnedOver || previewingBack) && !showInitialState,
        'is-counter-rotated': counterRotated && !showInitialState,
        'is-disable-animation': disableAnimation,
        'is-showing-initial': showInitialState,
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
        v-if="props.card.imageData.back?.normal"
        class="face back"
      >
        <NuxtImg
          class="image"
          :src="props.card.imageData.back?.normal"
          loading="lazy"
          placeholder
          @load="backLoaded = true"
        />
      </div>
    </div>
    <button
      v-if="props.card.imageData.back && props.turnoverable && frontLoaded && backLoaded"
      class="turnover-button"
      :class="{ 'is-turned-over': turnedOver || previewingBack }"
      @click.stop="previewBack"
    >
      <svg
        focusable="false"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1024 1024"
      >
        <path d="M884.3,357.6c116.8,117.7,151.7,277-362.2,320V496.4L243.2,763.8L522,1031.3V860.8C828.8,839.4,1244.9,604.5,884.3,357.6z" />
        <path d="M557.8,288.2v138.4l230.8-213.4L557.8,0v142.8c-309.2,15.6-792.1,253.6-426.5,503.8C13.6,527.9,30,330.1,557.8,288.2z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.card-image {
  aspect-ratio: 61/85;
  perspective: 2000px;
  position: relative;
  transition: scale 0.1s ease-in-out;

  .card {
    position: relative;
    transform-style: preserve-3d;
    transition: transform 0.6s ease-in-out;
    transform-origin: center;
    width: 100%;
    height: 100%;

    &.is-disable-animation {
      transition: none;
    }

    &.is-showing-initial {
      transform: none !important;
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

  &.is-hoverable {
    cursor: pointer;

    &:hover {
      scale: 1.02;
    }
  }

  .turnover-button {
    position: absolute;
    opacity: 0.6;
    background: white;
    border-radius: 100%;
    border: 2px solid #343242;
    display: block;
    height: 44px;
    width: 44px;
    padding: 7px;
    cursor: pointer;
    top: 26%;
    left: 75%;
    transform-style: flat;
    transition:
      background-color 200ms linear,
      opacity 50ms linear;
    z-index: 1000;
    transform: translateZ(0.01px);

    svg {
      fill: #343242;
      transition: fill 200ms linear;
    }

    &.is-flipped {
      border-color: #fff;
      background-color: #343242;

      svg {
        fill: #fff;
      }
    }

    &.is-turned-over {
      border-color: #fff;
      background-color: #343242;

      svg {
        fill: #fff;
      }
    }

    &:hover {
      opacity: 1;
    }
  }
}
</style>
