<script lang="ts" setup>
const state = defineModel<EventSettingsData>({
  default: {
    matchCount: 3,
  },
})
</script>

<template>
  <UForm :state="state">
    <UPageCard variant="subtle">
      <UFormField
        name="matchCount"
        label="Number of feature matches"
        description="The number of matches to control."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInputNumber v-model="state.matchCount" :min="1" :max="3" />
      </UFormField>
    </UPageCard>
  </UForm>
</template>
