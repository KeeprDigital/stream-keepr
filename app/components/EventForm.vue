<script setup lang="ts">
type Props = {
  roundOptions: string[]
  talentOptions: string[]
  dirty: boolean
}

type Emits = {
  (e: 'save'): void
  (e: 'reset'): void
  (e: 'createTalent', name: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const state = defineModel<EventData>()

function createTalent(name: string) {
  emit('createTalent', name)
}
</script>

<template>
  <UForm
    v-if="state"
    :state="state"
    @submit="emit('save')"
  >
    <UCard variant="subtle">
      <div class="w-full flex flex-col gap-4">
        <UFormField label="Current Round" name="currentRound">
          <USelect v-model="state.currentRound" class="w-full" :items="roundOptions" />
        </UFormField>
        <div class="flex gap-4">
          <UFormField class="w-full" label="Left Talent" name="leftTalent">
            <UInputMenu
              v-model="state.leftTalent"
              :items="talentOptions"
              class="w-full"
              :create-item="{ when: 'always', position: 'top' }"
              ignore-filter
              @create="createTalent"
            />
          </UFormField>
          <UFormField class="w-full" label="Right Talent" name="rightTalent">
            <UInputMenu
              v-model="state.rightTalent"
              :items="talentOptions"
              class="w-full"
              :create-item="{ when: 'always', position: 'top' }"
              ignore-filter
              @create="createTalent"
            />
          </UFormField>
        </div>
        <UFormField label="Holding Text" name="holdingText">
          <UInput v-model="state.holdingText" class="w-full" />
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
