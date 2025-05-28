export const useMatchStore = defineStore('Match', () => {
  const formData = ref<MatchData[]>([])
  const state = shallowRef<MatchData[]>([])

  const toast = useToast()
  const { optimisticEmit } = useWS({
    topic: 'matches',
    serverEvents: {
      connected: data => state.value = data,
      sync: data => state.value = data,
    },
  })

  watch(state, (newVal) => {
    formData.value = JSON.parse(JSON.stringify(newVal))
  })

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

  function addMatch() {
    optimisticEmit('add', {
      initialState: state.value,
      action: () => {
        const id = crypto.randomUUID()
        formData.value.push({
          ...defaultMatchData,
          id,
        })
        return id
      },
      onSuccess: (response, result) => {
        const match = formData.value.find(match => match.id === result)
        if (match) {
          match.id = response.matchId
        }
        toast.add({
          title: 'Match Added',
          icon: 'i-heroicons-check-circle',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error adding match',
          icon: 'i-heroicons-exclamation-triangle',
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
          icon: 'i-heroicons-check-circle',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error removing match',
          icon: 'i-heroicons-exclamation-triangle',
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
          icon: 'i-heroicons-check-circle',
          color: 'success',
        })
      },
      onError: () => {
        toast.add({
          title: 'Error saving match',
          icon: 'i-heroicons-exclamation-triangle',
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

  return {
    formData,
    isDirty,
    saveMatch,
    addMatch,
    removeMatch,
    updateMatch,
  }
})
