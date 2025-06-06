export const useMatchStore = defineStore('Match', () => {
  const formData = ref<MatchData[]>([])
  const state = shallowRef<MatchData[]>([])

  const eventStore = useEventStore()
  const configStore = useConfigStore()

  const toast = useToast()
  const timeStore = useTimeStore()

  const { optimisticEmit } = useWS({
    topic: 'matches',
    serverEvents: {
      connected: (data) => {
        state.value = data
        formData.value = JSON.parse(JSON.stringify(data))
      },
      sync: (data) => {
        state.value = data
      },
    },
  })

  watch(state, (newVal) => {
    formData.value = JSON.parse(JSON.stringify(newVal))
  })

  // Watch for changes in event mode, current round, or tournament configuration
  // and automatically sync match clocks when in tournament structure mode
  watch(
    [
      () => configStore.tournament.eventMode,
      () => eventStore.formData?.currentRound,
      () => configStore.tournament.swissRoundTime,
      () => configStore.tournament.cutRoundTime,
      () => configStore.tournament.swissRounds,
      () => configStore.tournament.cutRounds,
    ],
    () => {
      try {
        syncClocksWithTournamentStructure()
      }
      catch (error) {
        console.error('Failed to sync clocks with tournament structure:', error)
        toast.add({
          title: 'Clock sync failed',
          description: 'Failed to update match clocks for current round',
          icon: 'i-lucide-triangle-alert',
          color: 'error',
        })
      }
    },
    { immediate: true, deep: true },
  )

  const isDirty = computed(() => {
    return (id: string) => {
      const serverMatch = state.value.find(match => match.id === id)
      const formMatch = formData.value.find(match => match.id === id)

      if (!serverMatch && !formMatch)
        return false
      if (!serverMatch || !formMatch)
        return true

      return JSON.stringify(serverMatch) !== JSON.stringify(formMatch)
    }
  })

  const getMatch = computed(() => {
    return (id: string) => formData.value.find(match => match.id === id)
  })

  function addMatch() {
    optimisticEmit('add', {
      initialState: state.value,
      action: () => {
        const id = crypto.randomUUID()
        const match = createDefaultMatch({
          id,
        })
        formData.value.push(match)
        return id
      },
      onSuccess: (response, result) => {
        const match = formData.value.find(match => match.id === result)
        if (match) {
          match.id = response.matchId
          match.name = response.matchName
          match.clock = response.clock
        }

        state.value = formData.value

        toast.add({
          title: 'Match Added',
          icon: 'i-lucide-circle-check',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error adding match',
          icon: 'i-lucide-triangle-alert',
          color: 'error',
        })
      },
      rollback: initialState => state.value = initialState,
    })
  }

  function removeMatch(id: string) {
    optimisticEmit('remove', {
      initialState: state.value,
      action: () => state.value = formData.value.filter(match => match.id !== id),
      onSuccess: () => {
        toast.add({
          title: 'Match Removed',
          icon: 'i-lucide-circle-check',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error removing match',
          icon: 'i-lucide-triangle-alert',
          color: 'error',
        })
      },
      rollback: initialState => state.value = initialState,
    }, id)
  }

  async function saveMatch(id: string) {
    const updatedMatch = formData.value.find(match => match.id === id)
    if (!updatedMatch)
      return
    optimisticEmit('set', {
      initialState: state.value,
      action: () => state.value = formData.value,
      onSuccess: () => {
        toast.add({
          title: 'Match Saved',
          icon: 'i-lucide-circle-check',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error saving match',
          icon: 'i-lucide-triangle-alert',
          color: 'error',
        })
      },
      rollback: initialState => state.value = initialState,
    }, updatedMatch)
  }

  function updateMatch(updatedMatch: MatchData) {
    const index = formData.value.findIndex(match => match.id === updatedMatch.id)
    if (index !== -1) {
      formData.value[index] = updatedMatch
    }
  }

  function syncClocksWithTournamentStructure() {
    // Only sync clocks when in tournament structure mode
    if (configStore.tournament.eventMode !== 'tournament') {
      return
    }

    const currentRound = eventStore.formData?.currentRound
    if (!currentRound) {
      return
    }

    const roundInfo = getCurrentRoundInfo(
      currentRound,
      configStore.tournament.swissRoundTime,
      configStore.tournament.cutRoundTime,
      configStore.tournament.swissRounds,
      configStore.tournament.cutRounds,
    )

    const { duration, mode } = roundInfo
    let updatedCount = 0

    // Update all non-running clocks to match current round settings
    formData.value.forEach((match) => {
      if (match.clock && !match.clock.running) {
        match.clock.initialDuration = duration
        match.clock.mode = mode
        match.clock.totalDuration = mode === 'countup' ? Number.MAX_SAFE_INTEGER : duration
        match.clock.elapsedTime = 0
        match.clock.startTime = null
        updatedCount++
      }
    })

    // Only trigger reactivity update if clocks were actually modified
    if (updatedCount > 0) {
      formData.value = [...formData.value]
    }
  }

  function controlClock(payload: MatchClockActionPayload) {
    const match = getMatch.value(payload.id)
    if (!match || !match.clock)
      return

    const currentTime = timeStore.currentTime.getTime()

    optimisticEmit('clock', {
      initialState: formData.value,
      action: () => {
        updateClockState(match.clock!, payload, currentTime)
        formData.value = [...formData.value]
      },
      onSuccess: () => {
        // Server successfully processed the clock action
        // The state is already updated optimistically
      },
      onError: () => {
        toast.add({
          title: 'Clock action failed',
          description: 'Failed to synchronize clock action with server',
          icon: 'i-lucide-triangle-alert',
          color: 'error',
        })
      },
      rollback: (initialState) => {
        formData.value = initialState
      },
    }, payload)
  }

  return {
    state: readonly(state),
    formData,
    isDirty,
    getMatch,
    saveMatch,
    addMatch,
    removeMatch,
    updateMatch,
    syncClocksWithTournamentStructure,
    controlClock,
  }
})
