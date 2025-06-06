export const useConfigStore = defineStore('Config', () => {
  const toast = useToast()

  const tournamentFormData = ref<ConfigTournament>(defaultConfigData.tournament)
  const overlayFormData = ref<ConfigOverlay>(defaultConfigData.overlay)
  const talentFormData = ref<ConfigTalent>(defaultConfigData.talent)

  const state = shallowRef<ConfigData>()

  const { optimisticEmit } = useWS({
    topic: 'config',
    serverEvents: {
      connected: (data) => {
        state.value = data
        syncFormData()
      },
      sync: (data) => {
        state.value = data
        syncFormData()
      },
    },
  })

  function syncFormData() {
    if (state.value) {
      tournamentFormData.value = JSON.parse(JSON.stringify(
        {
          ...state.value.tournament,
          defaultClockDuration: durationUtils.msToMinutes(state.value.tournament.defaultClockDuration),
          swissRoundTime: durationUtils.msToMinutes(state.value.tournament.swissRoundTime),
          cutRoundTime: durationUtils.msToMinutes(state.value.tournament.cutRoundTime),
        },
      ))

      overlayFormData.value = JSON.parse(JSON.stringify(state.value.overlay))
      talentFormData.value = JSON.parse(JSON.stringify(state.value.talent))
    }
  }

  watch(state, syncFormData)

  // Individual dirty state computeds
  const isTournamentDirty = computed(() => {
    return JSON.stringify(state.value?.tournament) !== JSON.stringify(tournamentFormData.value)
  })

  const isOverlayDirty = computed(() => {
    return JSON.stringify(state.value?.overlay) !== JSON.stringify(overlayFormData.value)
  })

  const isTalentDirty = computed(() => {
    return JSON.stringify(state.value?.talent) !== JSON.stringify(talentFormData.value)
  })

  const isDirty = computed(() => {
    return isTournamentDirty.value || isOverlayDirty.value || isTalentDirty.value
  })

  // Sections of the config
  const overlay = computed(() => {
    return state.value?.overlay ?? defaultConfigData.overlay
  })

  const tournament = computed(() => {
    return state.value?.tournament ?? defaultConfigData.tournament
  })

  const talent = computed(() => {
    return state.value?.talent ?? defaultConfigData.talent
  })

  const roundOptions = computed(() =>
    getRoundOptions(
      tournamentFormData.value?.swissRounds ?? 0,
      tournamentFormData.value?.cutRounds ?? 0,
    ),
  )

  const dayOptions = computed(() => {
    const days = tournamentFormData.value?.days ?? 1
    return Array.from({ length: days }, (_, i) => `Day ${i + 1}`)
  })

  const talentOptions = computed(() => {
    return [...(state.value?.talent?.talents?.map(talent => talent.name) ?? []), '<Blank>']
  })

  function saveSection(
    sectionKey: keyof ConfigData,
    formData: ConfigTournament | ConfigOverlay | ConfigTalent,
    successMessage: string,
  ) {
    if (state.value && formData) {
      const updatedConfig = {
        ...JSON.parse(JSON.stringify(state.value)),
        [sectionKey]: formData,
      }

      optimisticEmit('set', {
        initialState: state.value,
        action: () => {
          state.value = updatedConfig
        },
        onSuccess: () => {
          toast.add({
            title: successMessage,
            icon: 'i-lucide-circle-check',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: `Error saving ${sectionKey} settings`,
            icon: 'i-lucide-triangle-alert',
            color: 'error',
          })
        },
        rollback: (initialState) => {
          state.value = initialState
          syncFormData()
        },
      }, updatedConfig)
    }
  }

  function saveTournament() {
    if (tournamentFormData.value) {
      const updatedTournament = {
        ...tournamentFormData.value,
        defaultClockDuration: durationUtils.minutesToMs(tournamentFormData.value.defaultClockDuration),
        swissRoundTime: durationUtils.minutesToMs(tournamentFormData.value.swissRoundTime),
        cutRoundTime: durationUtils.minutesToMs(tournamentFormData.value.cutRoundTime),
      }
      saveSection('tournament', updatedTournament, 'Tournament Settings Updated')
    }
  }

  function saveOverlay() {
    if (overlayFormData.value) {
      const updatedOverlay = {
        ...overlayFormData.value,
        cardTimeout: durationUtils.minutesToMs(overlayFormData.value.cardTimeout),
      }
      saveSection('overlay', updatedOverlay, 'Overlay Settings Updated')
    }
  }

  function saveTalent() {
    if (talentFormData.value)
      saveSection('talent', talentFormData.value, 'Talent Settings Updated')
  }

  function saveAll() {
    if (state.value && tournamentFormData.value && overlayFormData.value && talentFormData.value) {
      const updatedConfig: ConfigData = {
        tournament: tournamentFormData.value,
        overlay: overlayFormData.value,
        talent: talentFormData.value,
      }

      optimisticEmit('set', {
        initialState: state.value,
        action: () => {
          state.value = updatedConfig
        },
        onSuccess: () => {
          toast.add({
            title: 'All Settings Updated',
            icon: 'i-lucide-circle-check',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: 'Error saving settings',
            icon: 'i-lucide-triangle-alert',
            color: 'error',
          })
        },
        rollback: (initialState) => {
          state.value = initialState
          syncFormData()
        },
      }, updatedConfig)
    }
  }

  function resetTournament() {
    if (state.value?.tournament) {
      tournamentFormData.value = structuredClone(state.value.tournament)
    }
  }

  function resetOverlay() {
    if (state.value?.overlay) {
      overlayFormData.value = structuredClone(state.value.overlay)
    }
  }

  function resetTalent() {
    if (state.value?.talent) {
      talentFormData.value = structuredClone(state.value.talent)
    }
  }

  function resetAll() {
    syncFormData()
  }

  function createTalent(name: string) {
    if (talentFormData.value) {
      talentFormData.value.talents.push({ name })
      saveTalent()
    }
  }

  return {
    // Form data
    tournamentFormData,
    overlayFormData,
    talentFormData,

    // Dirty states
    isDirty,
    isTournamentDirty,
    isOverlayDirty,
    isTalentDirty,

    // Sections of the config
    overlay,
    tournament,
    talent,

    // Computed properties
    roundOptions,
    dayOptions,
    talentOptions,

    // Save functions
    saveTournament,
    saveOverlay,
    saveTalent,
    saveAll,

    // Reset functions
    resetTournament,
    resetOverlay,
    resetTalent,
    resetAll,

    createTalent,
  }
})
