export function useMatchClock(matchId: string) {
  const matchStore = useMatchStore()
  const timeStore = useTimeStore()

  timeStore.startPeriodicSync()

  const match = computed(() => matchStore.getMatch(matchId))

  const clock = computed(() => match.value?.clock)

  const hasClock = computed(() => !!clock.value)
  const isRunning = computed(() => clock.value?.running ?? false)
  const clockMode = computed(() => clock.value?.mode ?? 'countdown')
  const isExpired = computed(() => {
    if (!clock.value)
      return false
    return matchClockUtils.isExpired(clock.value, timeStore.currentTime.getTime())
  })

  const currentRemainingTime = computed(() => {
    if (!clock.value)
      return 0
    return matchClockUtils.getRemainingTime(clock.value, timeStore.currentTime.getTime())
  })

  const currentElapsedTime = computed(() => {
    if (!clock.value)
      return 0
    return matchClockUtils.getCurrentElapsedTime(clock.value, timeStore.currentTime.getTime())
  })

  const currentDisplayTime = computed(() => {
    if (!clock.value)
      return 0
    return clock.value.mode === 'countup'
      ? currentElapsedTime.value
      : currentRemainingTime.value
  })

  const formattedDisplayTime = computed(() => {
    if (!clock.value)
      return 0
    return durationUtils.msToParts(currentDisplayTime.value)
  })

  const progress = computed(() => {
    if (!clock.value || clock.value.mode === 'countup')
      return 0
    const elapsed = currentElapsedTime.value
    const total = clock.value.totalDuration
    return Math.max(0, Math.min(100, (elapsed / total) * 100))
  })

  function start() {
    matchStore.controlClock({ id: matchId, action: 'start' })
  }

  function pause() {
    matchStore.controlClock({ id: matchId, action: 'pause' })
  }

  function resume() {
    matchStore.controlClock({ id: matchId, action: 'resume' })
  }

  function reset() {
    matchStore.controlClock({ id: matchId, action: 'reset' })
  }

  function setDuration(milliseconds: number) {
    matchStore.controlClock({ id: matchId, action: 'set', value: milliseconds })
  }

  function adjustTime(milliseconds: number) {
    matchStore.controlClock({ id: matchId, action: 'adjust', value: milliseconds })
  }

  function setMode(mode: MatchClockMode) {
    if (isRunning.value) {
      return
    }
    matchStore.controlClock({ id: matchId, action: 'setMode', mode })
  }

  function toggle() {
    if (isRunning.value) {
      pause()
    }
    else if (currentElapsedTime.value > 0) {
      resume()
    }
    else {
      start()
    }
  }

  return {
    currentElapsedTime,
    currentRemainingTime,
    currentDisplayTime,
    clockMode,
    isRunning,
    isExpired,
    hasClock,
    progress,
    formattedDisplayTime,
    reset,
    setDuration,
    adjustTime,
    setMode,
    toggle,
  }
}
