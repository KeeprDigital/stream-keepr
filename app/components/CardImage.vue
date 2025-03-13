<script setup lang="ts">
type Props = {
  card: CardData
  showTurnedOverButton?: boolean
  hoverable?: boolean
}

const props = defineProps<Props>()

const flipped = defineModel<boolean>('flipped')
const rotated = defineModel<boolean>('rotated')
const counterRotated = defineModel<boolean>('counterRotated')
const turnedOver = defineModel<boolean>('turnedOver')

function toggleTurnedOver() {
  turnedOver.value = !turnedOver.value
}
</script>

<template>
  <div
    class="card-list-item" :class="{
      'is-hoverable': props.hoverable,
    }"
  >
    <div
      class="card"
      :class="{
        'is-flipped': flipped,
        'is-rotated': rotated,
        'is-turned-over': turnedOver,
        'is-counter-rotated': counterRotated,
      }"
    >
      <div class="face front">
        <NuxtImg
          class="image"
          width="245"
          height="342"
          :src="props.card.imageData.front?.normal"
          loading="lazy"
        />
      </div>
      <div class="face back">
        <NuxtImg
          class="image"
          width="245"
          height="342"
          :src="props.card.imageData.back?.normal"
          loading="lazy"
        />
      </div>
    </div>
    <button
      v-if="props.card.imageData.back && props.showTurnedOverButton"
      class="turnover-button"
      :class="{ 'is-turned-over': turnedOver }"
      @click.stop="toggleTurnedOver"
    >
      <svg focusable="false" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <path d="M884.3,357.6c116.8,117.7,151.7,277-362.2,320V496.4L243.2,763.8L522,1031.3V860.8C828.8,839.4,1244.9,604.5,884.3,357.6z" />
        <path d="M557.8,288.2v138.4l230.8-213.4L557.8,0v142.8c-309.2,15.6-792.1,253.6-426.5,503.8C13.6,527.9,30,330.1,557.8,288.2z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.card-list-item {
  perspective: 2000px;
  position: relative;
  transition: scale 0.1s ease-in-out;

  .card {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    padding-bottom: 140%;
    transition: transform 0.2s;

    .face {
      position: absolute;
      inset: 0;
      backface-visibility: hidden;

      &.front {
        transform: rotateY(0deg);
        transform: rotate(0deg);
      }

      &.back {
        transform: rotateY(180deg);
      }

      .image {
        border-radius: 4.75% / 4%;
      }
    }

    &.is-flipped {
      transform: rotate(180deg);
      transition: transform 0.6s ease-in-out;
    }

    &.is-rotated {
      transform: rotate(90deg);
      transition: transform 0.6s ease-in-out;
    }

    &.is-counter-rotated {
      transform: rotate(-90deg);
      transition: transform 0.6s ease-in-out;
    }

    &.is-turned-over {
      transform: rotateY(180deg);
      transition: transform 0.6s ease-in-out;
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

    &.is-flipped {
      border-color: #fff;
      background-color: #343242;
      fill: #fff;
    }

    &:hover {
      opacity: 1;
    }
  }
}
</style>
