<script setup lang="ts">
type Props = {
  dirty: boolean
}

type Emits = {
  (e: 'save'): void
  (e: 'reset'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const state = defineModel<EventData>()
</script>

<template>
  <UCard variant="subtle">
    <UForm
      v-if="state"
      :state="state"
      class="w-full flex flex-col gap-4"
      @submit="emit('save')"
    >
      <UFormField label="Current Round" name="currentRound">
        <UInput v-model="state.currentRound" class="w-full" />
      </UFormField>
      <div class="flex gap-4">
        <UFormField class="w-full" label="Left Talent" name="leftTalent">
          <UInput v-model="state.leftTalent" class="w-full" />
        </UFormField>
        <UFormField class="w-full" label="Right Talent" name="rightTalent">
          <UInput v-model="state.rightTalent" class="w-full" />
        </UFormField>
      </div>
      <UFormField label="Holding Text" name="holdingText">
        <UInput v-model="state.holdingText" class="w-full" />
      </UFormField>
      <div class="flex justify-between items-center gap-4 mt-4">
        <UButton
          label="Reset"
          color="error"
          variant="outline"
          type="button"
          :disabled="!props.dirty"
          @click="emit('reset')"
        />
        <UButton
          label="Save"
          color="primary"
          variant="outline"
          type="submit"
          :disabled="!props.dirty"
        />
      </div>
    </UForm>
  </UCard>
</template>
