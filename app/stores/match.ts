import type { MatchData, MatchDataList } from '~~/shared/schemas/matches'

export const useMatchStore = defineStore('Match', () => {
  const storeId = 'match-store'
  const socketStore = useSocket()
  const toast = useToast()
  const loading = ref(false)

  const state = ref<MatchDataList>([])

  const { cloned, sync } = useCloned(state, { manual: true })

  function init() {
    if (!socketStore.isSubscribed('matches')) {
      socketStore.subscribe('matches', storeId, handleMatch, handleSubscribed)
    }
  }

  function handleMatch(data: MatchDataList | null) {
    if (data) {
      state.value = data
    }
    loading.value = false
    sync()
  }

  function handleSubscribed(data: MatchDataList | null) {
    if (data) {
      state.value = data
    }
    loading.value = false
    sync()
  }

  function reset() {
    state.value = cloned.value
    sync()
  }

  function addMatch() {
    socketStore.publish('matches', {
      action: 'add',
    })
    toast.add({
      title: 'Match Added',
    })
  }

  function removeMatch(id: string) {
    socketStore.publish('matches', {
      action: 'remove',
      id,
    })
  }

  async function saveMatch(id: string) {
    loading.value = true
    sync()
    const match = state.value.find(match => match.id === id)
    if (!match) {
      return
    }
    toast.add({
      title: 'Match Saved',
    })
    socketStore.publish('matches', {
      action: 'set',
      match: {
        id,
        tableNumber: match.tableNumber,
        playerOne: match.playerOne,
        playerTwo: match.playerTwo,
      },
    })

    loading.value = false
  }

  function updateMatch(match: MatchData) {
    const index = state.value.findIndex(m => m.id === match.id)
    if (index !== -1) {
      state.value[index] = match
    }
  }
  init()

  return {
    state,
    loading,
    init,
    reset,
    saveMatch,
    addMatch,
    removeMatch,
    updateMatch,
  }
})
