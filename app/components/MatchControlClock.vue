<script lang="ts" setup>

</script>

<template>
  <UPopover>
    <UButton
      class="col-start-2 font-mono justify-center"
      color="neutral"
      variant="outline"
    >
      {{ '35:00' }}
    </UButton>
    <template #content>
      <div class="flex flex-col gap-4">
        <!-- TODO: Add clock controls -->
      </div>
    </template>
  </UPopover>
</template>
