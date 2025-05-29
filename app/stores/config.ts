export const useConfigStore = defineStore('Config', () => {
  const toast = useToast()
  const formData = ref<ConfigData>()
  const state = shallowRef<ConfigData>()

  const { optimisticEmit } = useWS({
    topic: 'config',
    serverEvents: {
      connected: data => state.value = data,
      sync: data => state.value = data,
    },
  })

  watch(state, (newVal) => {
    formData.value = structuredClone(toRaw(newVal))
  })

  const isDirty = computed(() => {
    return JSON.stringify(state.value) !== JSON.stringify(formData.value)
  })

  const matchOrientation = computed(() => {
    return state.value?.matchOrientation ?? defaultConfigData.matchOrientation
  })

  const roundOptions = computed(() =>
    getRoundOptions(formData.value?.swissRounds ?? 0, formData.value?.cutRounds ?? 0),
  )

  function save() {
    if (formData.value) {
      optimisticEmit('set', {
        initialState: state.value,
        action: () => state.value = formData.value,
        onSuccess: () => {
          toast.add({
            title: 'Event Settings Updated',
            icon: 'i-heroicons-check-circle',
            color: 'success',
          })
        },
        onError: () => {
          toast.add({
            title: 'Error saving event settings',
            icon: 'i-heroicons-exclamation-triangle',
            color: 'error',
          })
        },
        rollback: initialState => state.value = initialState,
      }, formData.value)
    }
  }

  function reset() {
    formData.value = structuredClone(state.value)
  }

  return {
    formData,
    isDirty,
    matchOrientation,
    roundOptions,
    save,
    reset,
  }
})
