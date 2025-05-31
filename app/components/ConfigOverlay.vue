<script lang="ts" setup>
type Emits = {
  (e: 'save'): void
  (e: 'reset'): void
}

type Props = {
  dirty: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const state = defineModel<ConfigOverlay>()
</script>

<template>
  <UForm v-if="state" :state="state" @submit="emit('save')">
    <UCard variant="subtle">
      <div class="w-full flex flex-col gap-4">
        <UFormField
          name="matchOrientation"
          label="Match Orientation"
          description="The orientation of the matches."
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <USelect v-model="state.matchOrientation" :items="matchOrientationOptions" class="w-64" />
        </UFormField>
        <USeparator />
        <UFormField
          name="cardTimeout"
          label="Card Timeout"
          description="How long to show the card. 0 = never hide."
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <UInputNumber v-model="state.cardTimeout" :min="0" />
        </UFormField>
        <USeparator />
        <UFormField
          name="clearPreviewOnShow"
          label="Clear Preview on Show"
          description="Whether to clear the preview when the card is shown."
          class="flex max-sm:flex-col justify-between gap-4 items-center"
        >
          <USwitch v-model="state.clearPreviewOnShow" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex justify-between items-center gap-4">
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
      </template>
    </UCard>
  </UForm>
</template>
