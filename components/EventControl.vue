<script setup lang="ts">
import { type Event, eventSchema } from '~/types/overlay'

const state = defineModel<Event>(
  {
    default: {
      name: '',
      currentRound: '',
      leftTallent: '',
      rightTallent: '',
    },
  },
)
</script>

<template>
  <UForm class="event-controls" :state="state" :schema="eventSchema">
    <UFormField label="Event Name" name="eventName">
      <UInput v-model="state.name" class="input" />
    </UFormField>
    <UFormField label="Current Round" name="currentRound">
      <UInput v-model="state.currentRound" class="input" />
    </UFormField>
    <div class="tallent">
      <UFormField class="tallent-field" label="Left Tallent" name="leftTalent">
        <UInput v-model="state.leftTalent" class="input" />
      </UFormField>
      <UFormField class="tallent-field" label="Right Tallent" name="rightTalent">
        <UInput v-model="state.rightTalent" class="input" />
      </UFormField>
    </div>
  </UForm>
</template>

<style scoped>
.event-controls {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .tallent {
    display: flex;
    flex-direction: row;
    gap: 1rem;

    .tallent-field {
      width: 100%;
    }
  }

  .input {
    width: 100%;
  }
}
</style>
