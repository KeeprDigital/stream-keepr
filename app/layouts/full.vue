<script setup lang="ts">
useHead({
  bodyAttrs: {
    class: 'transparent-body-override',
  },
})
</script>

<template>
  <UMain class="grid place-items-center">
    <slot />
  </UMain>
</template>
