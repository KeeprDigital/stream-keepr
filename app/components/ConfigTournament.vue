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

const state = defineModel<ConfigTournament>()
</script>

<template>
  <UForm v-if="state" :state="state" @submit="emit('save')">
    <UCard variant="subtle">
      <div class="w-full flex flex-col gap-4">
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
          name="eventMode"
          label="Event Mode"
          description="Choose how the event is structured and managed."
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <USelect
            v-model="state.eventMode"
            :items="[
              { label: 'Tournament Structure', value: 'tournament' },
              { label: 'Manual Control', value: 'manual' },
            ]"
            class="w-64"
          />
        </UFormField>
        <template v-if="state.eventMode === 'manual'">
          <USeparator />
          <UFormField
            name="defaultClockDuration"
            label="Default Clock Duration"
            description="Default time for new match clocks (in minutes). 0 for no time limit."
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInputNumber v-model="state.defaultClockDuration" :min="0" class="w-64" />
          </UFormField>
          <USeparator />
          <UFormField
            name="defaultClockMode"
            label="Default Clock Mode"
            description="Default counting mode for new match clocks."
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <USelect
              v-model="state.defaultClockMode"
              :items="[
                { label: 'Countdown', value: 'countdown' },
                { label: 'Count Up', value: 'countup' },
              ]"
              class="w-64"
            />
          </UFormField>
        </template>
        <template v-if="state.eventMode === 'tournament'">
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
            name="swissRoundTime"
            label="Swiss round time"
            description="Round time for swiss rounds. 0 for no time limit."
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInputNumber v-model="state.swissRoundTime" :min="0" class="w-64" />
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
            name="cutRoundTime"
            label="Cut round time"
            description="Round time for cut rounds. 0 for no time limit."
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInputNumber v-model="state.cutRoundTime" :min="0" class="w-64" />
          </UFormField>
        </template>
        <UFormField
          name="playerCount"
          label="Number of players"
          description="The number of players participating in the event."
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <UInputNumber v-model="state.playerCount" :min="0" class="w-64" />
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
