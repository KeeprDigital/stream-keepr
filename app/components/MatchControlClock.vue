<script lang="ts" setup>
import { getCurrentRoundInfo } from '~~/shared/utils/rounds'

type Props = {
  matchId: string
}

const props = defineProps<Props>()

const {
  isRunning,
  clockMode,
  hasClock,
  currentElapsedTime,
  formattedDisplayTime,
  setMode,
  reset,
  toggle,
  setDuration,
  adjustTime,
  // isExpired,
  // progress,
} = useMatchClock(props.matchId)

const eventStore = useEventStore()
const configStore = useConfigStore()

const currentRoundInfo = computed(() => {
  // Check if we're in manual event mode
  if (configStore.tournament.eventMode === 'manual') {
    const defaultDuration = configStore.tournament.defaultClockDuration
    const hasTimeLimit = defaultDuration > 0
    return {
      round: 'Manual Control',
      isSwiss: false,
      hasTimeLimit,
      duration: defaultDuration,
      formattedDuration: hasTimeLimit
        ? `Default: ${durationUtils.msToParts(defaultDuration).display}`
        : 'Default: No time limit',
      isManual: true,
    }
  }

  const currentRound = eventStore.formData?.currentRound || ''
  if (!currentRound) {
    return {
      round: 'No Round Selected',
      isSwiss: false,
      hasTimeLimit: false,
      duration: 0,
      formattedDuration: 'No round',
      isManual: false,
    }
  }

  const roundInfo = getCurrentRoundInfo(
    currentRound,
    configStore.tournament.swissRoundTime,
    configStore.tournament.cutRoundTime,
    configStore.tournament.swissRounds,
    configStore.tournament.cutRounds,
  )

  const hasTimeLimit = roundInfo.duration > 0

  return {
    round: currentRound,
    isSwiss: roundInfo.isSwiss,
    hasTimeLimit,
    duration: roundInfo.duration,
    formattedDuration: hasTimeLimit ? durationUtils.msToParts(roundInfo.duration).display : 'No time limit',
    isManual: false,
  }
})

const popoverOpen = ref(false)

// Time input state
const timeInput = ref({
  hours: 0,
  minutes: 0,
  seconds: 0,
})

const timeInputValid = computed(() => {
  return timeInput.value.hours >= 0 && timeInput.value.hours <= 23
    && timeInput.value.minutes >= 0 && timeInput.value.minutes <= 59
    && timeInput.value.seconds >= 0 && timeInput.value.seconds <= 59
    && (timeInput.value.hours > 0 || timeInput.value.minutes > 0 || timeInput.value.seconds > 0)
})

const timeInputInMs = computed(() => {
  if (!timeInputValid.value)
    return 0
  return durationUtils.partsToMs(timeInput.value)
})

function clearTimeInput() {
  timeInput.value = { hours: 0, minutes: 0, seconds: 0 }
}

const displayTime = computed(() => {
  if (!hasClock.value)
    return '--:--'

  // Show "No Limit" for countup mode with no time limit
  if (clockMode.value === 'countup' && currentRoundInfo.value && !currentRoundInfo.value.hasTimeLimit) {
    if (formattedDisplayTime.value !== 0)
      return formattedDisplayTime.value.display
    return '00:00'
  }

  if (formattedDisplayTime.value !== 0)
    return formattedDisplayTime.value.display
  return '--:--'
})

const buttonColor = computed(() => {
  if (isRunning.value)
    return 'primary'
  if (clockMode.value === 'countup' && currentRoundInfo.value && !currentRoundInfo.value.hasTimeLimit) {
    return 'success'
  }
  return 'neutral'
})

function handleSetClock() {
  if (timeInputValid.value && clockMode.value === 'countdown') {
    setDuration(timeInputInMs.value)
    clearTimeInput()
  }
}

function handleAdjustClock(direction: 'up' | 'down') {
  if (timeInputValid.value) {
    const milliseconds = timeInputInMs.value
    const adjustment = direction === 'up' ? milliseconds : -milliseconds
    adjustTime(adjustment)
    clearTimeInput()
  }
}
</script>

<template>
  <UPopover v-model:open="popoverOpen">
    <UButton
      class="col-start-2 font-mono justify-center min-w-[5rem]"
      :color="buttonColor"
      variant="outline"
    >
      {{ displayTime }}
    </UButton>

    <template #content>
      <div class="controls-container">
        <!-- Round information -->
        <div :style="{ gridArea: 'info' }" class="text-center text-sm text-gray-600 dark:text-gray-400">
          <div class="font-medium">
            {{ currentRoundInfo.round }}
          </div>
          <div class="text-xs">
            <template v-if="currentRoundInfo.isManual">
              {{ configStore.tournament.defaultClockMode === 'countup' ? 'Count Up' : 'Countdown' }} • {{ currentRoundInfo.formattedDuration }}
            </template>
            <template v-else-if="currentRoundInfo.round === 'No Round Selected'">
              No Active Round
            </template>
            <template v-else>
              {{ currentRoundInfo.isSwiss ? 'Swiss' : 'Cut' }} • {{ currentRoundInfo.formattedDuration }}
            </template>
          </div>
        </div>

        <!-- Mode selector -->
        <UButtonGroup
          :style="{ gridArea: 'mode' }"
          size="sm"
          class="w-full"
        >
          <UButton
            :color="clockMode === 'countdown' ? 'primary' : 'neutral'"
            :variant="clockMode === 'countdown' ? 'subtle' : 'outline'"
            class="flex-1"
            :disabled="isRunning"
            @click="() => setMode('countdown')"
          >
            Countdown
          </UButton>
          <UButton
            :color="clockMode === 'countup' ? 'primary' : 'neutral'"
            :variant="clockMode === 'countup' ? 'subtle' : 'outline'"
            class="flex-1"
            :disabled="isRunning"
            @click="() => setMode('countup')"
          >
            Count Up
          </UButton>
        </UButtonGroup>

        <!-- Control buttons -->
        <UButton
          :style="{ gridArea: 'reset', justifyContent: 'center' }"
          color="error"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          size="xl"
          :disabled="isRunning"
          @click="reset"
        >
          Reset
        </UButton>

        <UButton
          :style="{ gridArea: 'play', justifyContent: 'center' }"
          :color="isRunning ? 'warning' : 'primary'"
          variant="subtle"
          :icon="isRunning ? 'i-lucide-pause' : 'i-lucide-play'"
          size="xl"
          @click="toggle"
        >
          {{ isRunning ? 'Pause' : currentElapsedTime > 0 ? 'Resume' : 'Start' }}
        </UButton>

        <!-- Time input controls -->
        <UButtonGroup :style="{ gridArea: 'h' }" size="xl" class="w-full">
          <UBadge color="neutral" variant="subtle" label="H" />
          <UInput
            v-model.number="timeInput.hours"
            type="number"
            :min="0"
            :max="23"
            class="flex-1"
            placeholder="0"
          />
        </UButtonGroup>

        <UButtonGroup :style="{ gridArea: 'm' }" size="xl" class="w-full">
          <UBadge color="neutral" variant="subtle" label="M" />
          <UInput
            v-model.number="timeInput.minutes"
            type="number"
            :min="0"
            :max="59"
            class="flex-1"
            placeholder="0"
          />
        </UButtonGroup>

        <UButtonGroup :style="{ gridArea: 's' }" size="xl" class="w-full">
          <UBadge color="neutral" variant="subtle" label="S" />
          <UInput
            v-model.number="timeInput.seconds"
            type="number"
            :min="0"
            :max="59"
            class="flex-1"
            placeholder="0"
          />
        </UButtonGroup>

        <UButton
          :style="{ gridArea: 'sub', justifyContent: 'center' }"
          color="neutral"
          variant="outline"
          icon="i-lucide-minus"
          size="xl"
          :disabled="!timeInputValid"
          @click="() => handleAdjustClock('down')"
        >
          Subtract
        </UButton>

        <UButton
          v-if="clockMode === 'countdown'"
          :style="{ gridArea: 'set', justifyContent: 'center' }"
          color="neutral"
          variant="outline"
          size="xl"
          :disabled="!timeInputValid"
          @click="handleSetClock"
        >
          Set Duration
        </UButton>

        <UButton
          :style="{ gridArea: 'add', justifyContent: 'center' }"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          size="xl"
          :disabled="!timeInputValid"
          @click="() => handleAdjustClock('up')"
        >
          Add
        </UButton>
      </div>
    </template>
  </UPopover>
</template>

<style scoped>
.controls-container {
  padding: 1rem;
  display: grid;
  grid-template:
    'info info info info info info' auto
    'mode mode mode mode mode mode' auto
    'reset reset reset play play play' 1fr
    'h h m m s s' 1fr
    'sub sub set set add add' 1fr /
    1fr 1fr 1fr 1fr 1fr 1fr;
  gap: 1rem;
}
</style>
