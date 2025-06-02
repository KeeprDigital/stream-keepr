<script setup lang="ts">
type Props = {
  card: OpCardData
  selectable?: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'selected'): void
}>()
const loaded = ref(false)
</script>

<template>
  <div
    class="card-image"
    :class="{
      hoverable: props.selectable,
    }"
    @click="emit('selected')"
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

  &.hoverable {
    cursor: pointer;

    &:hover {
      scale: 1.02;
    }
  }
}
</style>
