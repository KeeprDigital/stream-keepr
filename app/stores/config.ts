export const useConfigStore = defineStore('Config', () => {
  const toast = useToast()

  const tournamentFormData = ref<ConfigTournament>()
  const overlayFormData = ref<ConfigOverlay>()
  const talentFormData = ref<ConfigTalent>()

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
      tournamentFormData.value = structuredClone(toRaw(state.value.tournament))
      overlayFormData.value = structuredClone(toRaw(state.value.overlay))
      talentFormData.value = structuredClone(toRaw(state.value.talent))
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

  const matchOrientation = computed(() => {
    return state.value?.overlay?.matchOrientation ?? 'horizontal'
  })

  const roundOptions = computed(() =>
    getRoundOptions(
      tournamentFormData.value?.swissRounds ?? 0,
      tournamentFormData.value?.cutRounds ?? 0,
    ),
  )

  function saveSection(
    sectionKey: keyof ConfigData,
    formData: ConfigTournament | ConfigOverlay | ConfigTalent,
    successMessage: string,
  ) {
    if (state.value && formData) {
      const updatedConfig = {
        ...structuredClone(state.value),
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
            icon: 'i-heroicons-check-circle',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: `Error saving ${sectionKey} settings`,
            icon: 'i-heroicons-exclamation-triangle',
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
    if (tournamentFormData.value)
      saveSection('tournament', tournamentFormData.value, 'Tournament Settings Updated')
  }

  function saveOverlay() {
    if (overlayFormData.value)
      saveSection('overlay', overlayFormData.value, 'Overlay Settings Updated')
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
            icon: 'i-heroicons-check-circle',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: 'Error saving settings',
            icon: 'i-heroicons-exclamation-triangle',
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

  // Individual reset functions
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

    // Computed properties
    matchOrientation,
    roundOptions,

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
  }
})
