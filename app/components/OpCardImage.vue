<script setup lang="ts">
import type { OpCardData } from '~~/shared/schemas/opCard'

type Props = {
  card: OpCardData
  hoverable?: boolean
}
const props = defineProps<Props>()
const loaded = ref(false)
</script>

<template>
  <div
    class="card-image"
    :class="{
      'is-hoverable': props.hoverable,
    }"
  >
    <NuxtImg
      class="image"
      :src="props.card.image_url"
      loading="lazy"
      placeholder
      @load="loaded = true"
    />
  </div>
</template>

<style scoped>
.card-image {
  aspect-ratio: 61/85;
  transition: scale 0.1s ease-in-out;

  .image {
    border-radius: 4.75% / 4%;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &.is-hoverable {
    cursor: pointer;

    &:hover {
      scale: 1.02;
    }
  }
}
</style>
