export const useEventStore = defineStore('Event', () => {
  const toast = useToast()
  const loaded = ref(false)
  const state = ref<EventData>()
  const initialState = ref<EventData>()

  const { socket } = useWS({
    topic: 'event',
    serverEvents: {
      connected: (data) => {
        loaded.value = true
        state.value = data
        initialState.value = data
      },
      sync: (data) => {
        state.value = data
        initialState.value = data
      },
    },
  })

  const isDirty = computed(() => {
    return JSON.stringify(state.value) !== JSON.stringify(initialState.value)
  })

  function save() {
    if (state.value) {
      loaded.value = false
      socket.emit('set', state.value)
      initialState.value = { ...state.value }

      toast.add({
        title: 'Event updated',
        icon: 'i-heroicons-check-circle',
        color: 'success',
      })
      loaded.value = true
    }
  }

  function reset() {
    if (initialState.value) {
      state.value = { ...initialState.value }
    }
  }

  return {
    state,
    loaded,
    isDirty,
    save,
    reset,
  }
})
