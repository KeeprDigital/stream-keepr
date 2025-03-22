export const useSettingsStore = defineStore('Settings', () => {
  const { send, incoming } = useWebSocketChannel('settings')
  const toast = useToast()
  const loading = ref(false)

  const state = ref<EventSettingsData>({
    matchCount: 3,
  })

  const { cloned, sync } = useCloned(state, { manual: true })

  watch(incoming, (data) => {
    if (data) {
      state.value = data.settings
      sync()
    }
  }, {
    immediate: true,
  })

  function reset() {
    state.value = cloned.value
    sync()
  }

  async function save() {
    loading.value = true
    send({
      action: 'set',
      settings: state.value,
    })

    sync()

    toast.add({
      title: 'Event Settings Updated',
    })

    loading.value = false
  }

  return {
    loading,
    state,
    save,
    reset,
  }
})
