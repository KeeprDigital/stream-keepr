<script lang="ts" setup>
type Props = {
  game: ConfigGame
}

const props = defineProps<Props>()
</script>

<template>
  <div class="card-controls">
    <template v-if="props.game === 'mtg'">
      <MtgCardControlsPreview class="preview" />
      <MtgCardControlsButtons class="buttons" />
      <MtgCardControlsActive class="active" />
    </template>
    <template v-else-if="props.game === 'op'">
      <OpCardControlsPreview class="preview" />
      <OpCardControlsButtons class="buttons" />
      <OpCardControlsActive class="active" />
    </template>
  </div>
</template>

<style scoped>
.card-controls {
  overflow: hidden;
  height: 100%;
  display: grid;
  grid-template-rows: min-content 1fr min-content;
  gap: 1rem;
  padding: 1rem;

  .preview {
    grid-row: 1;
  }

  .buttons {
    grid-row: 2;
  }

  .active {
    grid-row: 3;
  }
}
</style>
