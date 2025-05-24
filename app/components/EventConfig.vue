<script lang="ts" setup>
import type { ConfigData } from '~~/shared/schemas/config'
import { gameOptions } from '~~/shared/utils/games'

const props = defineProps<{
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'save'): void
}>()

const state = defineModel<ConfigData>()
</script>

<template>
  <UForm v-if="state" :state="state">
    <UPageCard variant="subtle">
      <UFormField
        name="game"
        label="Game"
        description="The game of the event."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <USelect v-model="state.game" :items="gameOptions" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="name"
        label="Event Name"
        description="The name of the event."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput v-model="state.name" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="description"
        label="Event Description"
        description="A description of the event."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput v-model="state.description" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="days"
        label="Number of days"
        description="The number of days the event will run."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInputNumber v-model="state.days" :min="1" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="swissRounds"
        label="Number of swiss rounds"
        description="The number of swiss rounds."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInputNumber v-model="state.swissRounds" :min="1" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="cutRounds"
        label="Number of cut rounds"
        description="The number of cut rounds, if any."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInputNumber v-model="state.cutRounds" :min="0" class="w-64" />
      </UFormField>
      <USeparator />
      <UFormField
        name="playerCount"
        label="Number of players"
        description="The number of players participating in the event."
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInputNumber v-model="state.playerCount" :min="0" class="w-64" />
      </UFormField>
      <USeparator />
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
