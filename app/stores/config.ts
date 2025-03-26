export const useConfigStore = defineStore('Config', () => {
  const storeId = 'config-store'
  const socketStore = useSocket()
  const toast = useToast()

  const loading = ref(false)

  const state = ref<ConfigData>(defaultConfigData)

  const { cloned, sync } = useCloned(state, { manual: true })

  function init() {
    if (!socketStore.isSubscribed('config')) {
      socketStore.subscribe('config', storeId, handleConfig, handleSubscribed)
    }
  }

  function handleConfig(data: ConfigData | null) {
    if (data) {
      state.value = data
    }
    loading.value = false
    sync()
  }

  function handleSubscribed(data: ConfigData | null) {
    if (data) {
      state.value = data
      loading.value = false
      sync()
    }
  }

  function reset() {
    state.value = cloned.value
    sync()
  }

  async function save() {
    loading.value = true

    sync()

    socketStore.publish('config', {
      action: 'set',
      config: state.value,
    })

    toast.add({
      title: 'Event Settings Updated',
    })

    loading.value = false
  }

  onUnmounted(() => {
    socketStore.unsubscribe('config', storeId)
  })

  init()

  return {
    loading,
    state,
    save,
    reset,
  }
})
