<script lang="ts" setup>
const config = useConfigStore()
</script>

<template>
  <ConfigOverlay
    v-model="config.overlayFormData"
    :dirty="config.isDirty"
    @save="config.saveOverlay"
    @reset="config.resetOverlay"
  />
</template>
