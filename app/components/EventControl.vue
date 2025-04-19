<script setup lang="ts">
import type { EventData } from '~~/shared/schemas/event'
import { defaultEventData } from '~~/shared/utils/defaults'

const props = defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'save'): void
}>()

const state = defineModel<EventData>({
  default: defaultEventData,
})
</script>

<template>
  <UForm :state="state">
    <UPageCard variant="subtle">
      <UFormField label="Current Round" name="currentRound">
        <UInput v-model="state.currentRound" class="w-full" />
      </UFormField>
      <div class="flex gap-4">
        <UFormField class="w-full" label="Left Tallent" name="leftTalent">
          <UInput v-model="state.leftTalent" class="w-full" />
        </UFormField>
        <UFormField class="w-full" label="Right Tallent" name="rightTalent">
          <UInput v-model="state.rightTalent" class="w-full" />
        </UFormField>
      </div>
      <UFormField label="Holding Text" name="holdingText">
        <UTextarea v-model="state.holdingText" class="w-full" />
      </UFormField>
      <UButton
        form="config"
        label="Save"
        color="primary"
        variant="outline"
        type="submit"
        class="w-fit lg:ms-auto"
        :disabled="props.loading"
        @click="emit('save')"
      />
    </UPageCard>
  </UForm>
</template>
