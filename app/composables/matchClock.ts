function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  const paddedMinutes = minutes.toString().padStart(2, '0')
  const paddedSeconds = seconds.toString().padStart(2, '0')

  return {
    minutes: paddedMinutes,
    seconds: paddedSeconds,
    display: `${paddedMinutes}:${paddedSeconds}`,
    totalSeconds,
    totalMinutes: minutes,
  }
}

export function useMatchClock(matchId: string) {
  const matchStore = useMatchStore()
  const timeStore = useTimeStore()

  timeStore.startPeriodicSync()

  const match = computed(() => matchStore.getMatch(matchId))

  const currentClockTime = computed(() => {
    const clock = match.value?.clock
    if (!clock)
      return 0

    if (!clock.running)
      return clock.duration

    const elapsed = timeStore.currentTime.getTime() - clock.startTime
    return Math.max(0, clock.duration - elapsed)
  })

  const formattedTime = computed(() => formatTime(currentClockTime.value))

  const isRunning = computed(() => match.value?.clock?.running || false)
  const isExpired = computed(() => currentClockTime.value <= 0 && isRunning.value)
  const hasExpired = computed(() => currentClockTime.value <= 0)
  const hasClock = computed(() => !!match.value?.clock)

  const progress = computed(() => {
    if (!match.value?.clock)
      return 0
    const initial = match.value.clock.initialDuration
    const current = currentClockTime.value
    return Math.max(0, Math.min(100, (current / initial) * 100))
  })

  function start() {
    matchStore.controlClock({
      id: matchId,
      action: 'start',
      timestamp: timeStore.currentTime.getTime(),
    })
  }

  function pause() {
    matchStore.controlClock({
      id: matchId,
      action: 'pause',
      timestamp: timeStore.currentTime.getTime(),
    })
  }

  function resume() {
    matchStore.controlClock({
      id: matchId,
      action: 'resume',
      timestamp: timeStore.currentTime.getTime(),
    })
  }

  function reset() {
    matchStore.controlClock({
      id: matchId,
      action: 'reset',
      timestamp: timeStore.currentTime.getTime(),
    })
  }

  function setTime(milliseconds: number) {
    matchStore.controlClock({
      id: matchId,
      action: 'set',
      timestamp: timeStore.currentTime.getTime(),
      value: milliseconds,
    })
  }

  function adjustTime(milliseconds: number) {
    matchStore.controlClock({
      id: matchId,
      action: 'adjust',
      timestamp: timeStore.currentTime.getTime(),
      value: milliseconds,
    })
  }

  function toggle() {
    if (isRunning.value) {
      pause()
    }
    else {
      start()
    }
  }

  return {
    // Data
    match,
    formattedTime,

    // States
    isRunning,
    isExpired,
    hasExpired,
    hasClock,
    progress,

    // Actions
    start,
    pause,
    resume,
    reset,
    setTime,
    adjustTime,
    toggle,
  }
}
