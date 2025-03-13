export const usePlayerStore = defineStore('Player', () => {
  const { send, incoming } = useWebSocketChannel('player')
  const toast = useToast()
  const loading = ref(false)

  const playerState = ref<PlayersData>({
    playerOne: {
      name: '',
      proNouns: '',
      deck: '',
      position: '',
      score: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    },
    playerTwo: {
      name: '',
      proNouns: '',
      deck: '',
      position: '',
      score: {
        wins: 0,
        losses: 0,
        draws: 0,
      },
    },
  })

  const { cloned, sync } = useCloned(playerState, { manual: true })

  watch(incoming, (data) => {
    if (data) {
      playerState.value = data.players
      sync()
    }
  }, {
    immediate: true,
  })

  function reset() {
    playerState.value = cloned.value
    sync()
  }

  async function save() {
    loading.value = true
    send({
      action: 'set',
      players: playerState.value,
    })

    sync()

    toast.add({
      title: 'Player Details Updated',
    })

    loading.value = false
  }

  return {
    loading,
    playerState,
    save,
    reset,
  }
})
