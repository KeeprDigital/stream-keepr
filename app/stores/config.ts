export const useConfigStore = defineStore('Config', () => {
  const toast = useToast()
  const loaded = ref(false)
  const state = ref<ConfigData>()
  const initialState = ref<ConfigData>()

  const { socket } = useWS({
    topic: 'config',
    actions: {
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
        title: 'Event Settings Updated',
        icon: 'i-heroicons-check-circle',
        color: 'success',
      })
    }
  }

  function reset() {
    if (initialState.value) {
      state.value = { ...initialState.value }
    }
  }

  return {
    loaded,
    state,
    isDirty,
    save,
    reset,
  }
})
